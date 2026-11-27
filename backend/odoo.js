/**
 * Échanges avec Odoo en JSON-RPC (endpoint /jsonrpc, clé API) :
 *  Application → Odoo : chaque nouveau client devient un contact res.partner (code conducteur, type, agence, n° de fiche).
 *  Odoo → Application : devis / commandes (sale.order) et factures avec état de paiement (account.move).
 */
import { query, queryOne, execute, transaction, inList } from './db.js'
import { ApiError, now, ariary, variantesTelephone, parseJson } from './util.js'
import { TYPES_VEHICULE, TYPES_VENTE } from './ref.js'
import * as P from './parametres.js'
import { evenement } from './journal.js'
import * as Fiches from './fiches.js'
import * as Commissions from './commissions.js'
import * as Alertes from './alertes.js'
import { estEncaissee, libelleEtat } from './ventes-utils.js'

export const CHAMPS = {
  x_code_conducteur: 'Code conducteur (tuk-tuk / cyclo)',
  x_type_vehicule: 'Type de véhicule apporteur',
  x_agence: 'Agence (suivi tuk-tuk)',
  x_numero_fiche: 'N° de fiche de suivi',
}

// ---------------------------------------------------------------- client JSON-RPC
let uidCache = null
async function conf() {
  const t = await P.tous()
  return { url: String(t.odoo_url || '').replace(/\/+$/, ''), base: t.odoo_base, user: t.odoo_utilisateur, key: t.odoo_cle_api, actif: !!t.odoo_actif }
}
export async function estConfigure() { const c = await conf(); return !!(c.url && c.base && c.user && c.key) }
export async function estActif() { return (await estConfigure()) && (await conf()).actif }

async function appel(service, method, args) {
  const c = await conf()
  let rep
  try {
    rep = await fetch(`${c.url}/jsonrpc`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params: { service, method, args } }),
      signal: AbortSignal.timeout(30000),
    })
  } catch (e) {
    throw new Error(`Odoo injoignable : ${e.message}`)
  }
  if (!rep.ok) throw new Error(`Odoo a répondu HTTP ${rep.status}.`)
  const json = await rep.json()
  if (json.error) throw new Error(`Erreur Odoo : ${json.error.data?.message || json.error.message || 'inconnue'}`)
  return json.result ?? null
}

async function uid() {
  const c = await conf()
  const k = `${c.url}|${c.base}|${c.user}`
  if (uidCache?.k === k && uidCache.t > Date.now() - 3600000) return uidCache.uid
  const u = await appel('common', 'authenticate', [c.base, c.user, c.key, {}])
  if (!u) throw new Error("Authentification Odoo refusée : vérifiez la base, l'utilisateur et la clé API.")
  uidCache = { k, uid: u, t: Date.now() }
  return u
}
async function executer(modele, methode, args = [], kwargs = {}) {
  const c = await conf()
  return appel('object', 'execute_kw', [c.base, await uid(), c.key, modele, methode, args, kwargs])
}
const chercherLire = async (modele, domaine, champs, options = {}) => (await executer(modele, 'search_read', [domaine], { fields: champs, ...options })) || []
async function lire(modele, ids, champs) {
  const u = [...new Set(ids)].filter(Boolean)
  if (!u.length) return []
  const r = []
  for (let i = 0; i < u.length; i += 500) r.push(...((await executer(modele, 'read', [u.slice(i, i + 500)], { fields: champs })) || []))
  return r
}

async function log(operation, statut, nb, nbErreurs, message, details = {}, debut = now(), userId = null) {
  await execute(`INSERT INTO odoo_synchronisations (operation, statut, nb_elements, nb_erreurs, message, details, user_id, debut, fin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [operation, statut, nb, nbErreurs, message ? String(message).slice(0, 5000) : null, JSON.stringify(details), userId, debut, now()])
}

// ---------------------------------------------------------------- opérations
export async function tester(userId) {
  const debut = now()
  try {
    const v = await appel('common', 'version', [])
    uidCache = null
    const u = await uid()
    await log('test_connexion', 'succes', 0, 0, `Connexion réussie (Odoo ${v?.server_version || '?'}, utilisateur #${u})`, {}, debut, userId)
    return { version: v?.server_version || '?', uid: u }
  } catch (e) {
    await log('test_connexion', 'erreur', 0, 1, e.message, {}, debut, userId)
    throw new ApiError(502, e.message)
  }
}

/** Crée les champs personnalisés sur res.partner (droits administrateur Odoo requis) */
export async function installerChamps(userId) {
  try {
    const modele = await chercherLire('ir.model', [['model', '=', 'res.partner']], ['id'])
    if (!modele[0]) throw new Error('Modèle res.partner introuvable.')
    const existants = (await chercherLire('ir.model.fields', [['model', '=', 'res.partner'], ['name', 'in', Object.keys(CHAMPS)]], ['name'])).map(f => f.name)
    const crees = []
    for (const [name, libelle] of Object.entries(CHAMPS)) {
      if (existants.includes(name)) continue
      await executer('ir.model.fields', 'create', [{ model_id: modele[0].id, name, field_description: libelle, ttype: 'char', state: 'manual', store: true, copied: false }])
      crees.push(name)
    }
    await log('champs', 'succes', crees.length, 0, crees.length ? `Champs créés : ${crees.join(', ')}` : 'Champs déjà présents', {}, now(), userId)
    return crees
  } catch (e) {
    await log('champs', 'erreur', 0, 1, e.message, {}, now(), userId)
    throw new ApiError(502, e.message)
  }
}

async function chercherContactParTelephone(tel) {
  const v = variantesTelephone(tel)
  let r
  try {
    r = await chercherLire('res.partner', ['|', ['phone_sanitized', '=', tel], ['phone', 'in', v]], ['id'], { limit: 1, order: 'id asc' })
  } catch {
    r = await chercherLire('res.partner', [['phone', 'in', v]], ['id'], { limit: 1, order: 'id asc' })
  }
  return r[0]?.id || null
}

/** Envoie un client vers Odoo (création, ou rattachement à un contact existant trouvé par téléphone) */
export async function envoyerClient(clientId, ficheId = null) {
  const debut = now()
  const cl = await queryOne(`SELECT cl.*, c.code AS c_code, c.type AS c_type, a.nom AS a_nom, a.odoo_nom AS a_odoo
    FROM clients cl LEFT JOIN conducteurs c ON c.id = cl.conducteur_id JOIN agences a ON a.id = cl.agence_id WHERE cl.id = ?`, [clientId])
  if (!cl) return
  const fiche = ficheId ? await queryOne('SELECT numero FROM fiches_suivi WHERE id = ?', [ficheId])
    : await queryOne('SELECT numero FROM fiches_suivi WHERE client_id = ? ORDER BY date_visite DESC LIMIT 1', [clientId])
  const champs = {
    x_code_conducteur: cl.c_code || false, x_type_vehicule: cl.c_type ? TYPES_VEHICULE[cl.c_type] : false,
    x_agence: cl.a_odoo || cl.a_nom, x_numero_fiche: fiche?.numero || false,
  }
  const nom = [cl.nom, cl.prenom].filter(Boolean).join(' ')
  try {
    let id = cl.odoo_partenaire_id || await chercherContactParTelephone(cl.telephone)
    if (id) await executer('res.partner', 'write', [[Number(id)], champs])
    else id = await executer('res.partner', 'create', [{ name: nom, phone: cl.telephone, ...(cl.quartier ? { street2: cl.quartier } : {}), ...champs, customer_rank: 1 }])
    await execute("UPDATE clients SET odoo_partenaire_id = ?, odoo_statut = 'synchronise', odoo_erreur = NULL, odoo_synchronise_le = ? WHERE id = ?", [id, now(), clientId])
    await log('envoi_client', 'succes', 1, 0, `Client ${nom} envoyé vers le contact Odoo #${id}`, { client_id: clientId }, debut)
  } catch (e) {
    await execute("UPDATE clients SET odoo_statut = 'erreur', odoo_erreur = ? WHERE id = ?", [e.message.slice(0, 500), clientId])
    await log('envoi_client', 'erreur', 1, 1, e.message, { client_id: clientId }, debut)
    throw e
  }
}

export async function envoyerClientSiActif(clientId, ficheId) {
  if (await estActif()) await envoyerClient(clientId, ficheId).catch(() => {})
}

/** Niveau de rémunération déduit des produits (facture mixte : niveau le plus élevé) */
async function niveau(lignes, produits) {
  const ref = await query('SELECT * FROM produits WHERE actif = 1')
  const niveaux = []
  const detail = []
  for (const l of lignes) {
    const pid = Array.isArray(l.product_id) ? l.product_id[0] : null
    const p = pid ? produits[pid] : null
    const match = pid ? (ref.find(r => Number(r.odoo_produit_id) === pid)
      || (p?.default_code ? ref.find(r => r.reference && r.reference.toLowerCase() === String(p.default_code).toLowerCase()) : null)
      || (p?.categ_id ? ref.find(r => Number(r.odoo_categorie_id) === p.categ_id[0]) : null)) : null
    if (match) niveaux.push(match.niveau)
    detail.push({ produit: (Array.isArray(l.product_id) ? l.product_id[1] : null) || l.name || '', quantite: l.product_uom_qty ?? l.quantity ?? 0, montant: l.price_subtotal ?? 0, niveau: match?.niveau || null })
  }
  const n = await Commissions.niveauLePlusEleve(niveaux)
  const avecProduits = lignes.some(l => l.product_id)
  return [n || (avecProduits ? 'entree_gamme' : null), !n && avecProduits, detail]
}

async function ficheARattacher(client, date) {
  const base = `SELECT id, agence_id FROM fiches_suivi WHERE client_id = ? AND statut <> 'rejetee'${date ? ' AND DATE(date_visite) <= ?' : ''}`
  const p = [client.id, ...(date ? [date] : [])]
  return (client.conducteur_id && await queryOne(`${base} AND conducteur_id = ? ORDER BY date_visite DESC LIMIT 1`, [...p, client.conducteur_id]))
    || queryOne(`${base} ORDER BY date_visite DESC LIMIT 1`, p)
}

async function enregistrerVente(client, d, lignes, produits, ficheCommande = null) {
  const [niv, parDefaut, detail] = await niveau(lignes, produits)
  return transaction(async conn => {
    const ex = await queryOne('SELECT * FROM ventes WHERE odoo_modele = ? AND odoo_id = ? FOR UPDATE', [d.odoo_modele, d.odoo_id], conn)
    const v = { ...(ex || {}), ...d, client_id: client.id, agence_id: client.agence_id, niveau: niv, niveau_par_defaut: parDefaut ? 1 : 0 }
    if (!v.fiche_suivi_id) v.fiche_suivi_id = ficheCommande || (await ficheARattacher(client, v.date_document))?.id || null
    if (v.fiche_suivi_id) v.agence_id = (await queryOne('SELECT agence_id FROM fiches_suivi WHERE id = ?', [v.fiche_suivi_id], conn))?.agence_id || v.agence_id
    const etaitEncaissee = ex ? estEncaissee(ex) : false
    if (estEncaissee(v) && !v.encaisse_le) v.encaisse_le = now()
    const cols = ['type', 'reference', 'client_id', 'fiche_suivi_id', 'agence_id', 'etat', 'etat_paiement', 'montant_total', 'montant_restant', 'niveau', 'niveau_par_defaut', 'date_document', 'encaisse_le', 'odoo_commande_id', 'odoo_modifie_le']
    const vals = cols.map(c => v[c] ?? null)
    let id = ex?.id
    if (ex) await execute(`UPDATE ventes SET ${cols.map(c => `${c} = ?`).join(', ')}, lignes = ?, updated_at = ? WHERE id = ?`, [...vals, JSON.stringify(detail), now(), ex.id], conn)
    else id = (await execute(`INSERT INTO ventes (odoo_modele, odoo_id, ${cols.join(', ')}, lignes, created_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?)`,
      [d.odoo_modele, d.odoo_id, ...vals, JSON.stringify(detail), now()], conn)).insertId
    const fiche = v.fiche_suivi_id ? await queryOne('SELECT conducteur_id FROM fiches_suivi WHERE id = ?', [v.fiche_suivi_id], conn) : null
    const liens = { agence_id: v.agence_id, client_id: client.id, fiche_suivi_id: v.fiche_suivi_id, conducteur_id: fiche?.conducteur_id }
    const libType = TYPES_VENTE[v.type]
    if (!ex) await evenement('vente', 'import', `${libType} ${v.reference} reçu(e) d'Odoo : ${ariary(v.montant_total)} — ${libelleEtat(v)}`, liens, v.montant_total, conn)
    else if (libelleEtat(ex) !== libelleEtat(v)) await evenement('vente', 'etat', `${libType} ${v.reference} : état passé de « ${libelleEtat(ex)} » à « ${libelleEtat(v)} »`, liens, v.montant_total, conn)
    if (!etaitEncaissee && estEncaissee(v)) await evenement('vente', 'encaissement', `Facture ${v.reference} encaissée (${ariary(v.montant_total)})`, liens, v.montant_total, conn)
    return { id, fiche_suivi_id: v.fiche_suivi_id }
  })
}

const dateUtc = s => (s ? String(s).slice(0, 10) : null)

/** Récupère devis, commandes et factures modifiés depuis la dernière synchronisation */
export async function importerVentes(userId = null) {
  const debut = now()
  const debutIso = new Date().toISOString()
  const depuis = await P.get('odoo_derniere_synchro')
  const clients = await query('SELECT id, odoo_partenaire_id, agence_id, conducteur_id FROM clients WHERE odoo_partenaire_id IS NOT NULL')
  if (!clients.length) {
    await log('import_ventes', 'succes', 0, 0, 'Aucun client lié à Odoo', {}, debut, userId)
    return { elements: 0, erreurs: 0 }
  }
  const parPartenaire = new Map(clients.map(c => [Number(c.odoo_partenaire_id), c]))
  let elements = 0
  const erreurs = []
  const clientsTouches = new Set()
  const fichesTouchees = new Set()
  const ids = [...parPartenaire.keys()]
  for (let i = 0; i < ids.length; i += 300) {
    const dom = [['partner_id', 'child_of', ids.slice(i, i + 300)]]
    if (depuis) dom.push(['write_date', '>=', new Date(new Date(depuis).getTime() - 300000).toISOString().slice(0, 19).replace('T', ' ')])
    const commandes = await chercherLire('sale.order', dom, ['name', 'partner_id', 'state', 'amount_total', 'date_order', 'order_line', 'write_date'])
    const lignesCmd = await lire('sale.order.line', commandes.flatMap(c => c.order_line || []), ['product_id', 'name', 'product_uom_qty', 'price_subtotal', 'order_id'])
    const factures = await chercherLire('account.move', [...dom, ['move_type', 'in', ['out_invoice', 'out_refund']]],
      ['name', 'partner_id', 'commercial_partner_id', 'state', 'payment_state', 'amount_total', 'amount_residual', 'invoice_date', 'invoice_origin', 'move_type', 'invoice_line_ids', 'write_date'])
    const lignesFact = await lire('account.move.line', factures.flatMap(f => f.invoice_line_ids || []), ['product_id', 'name', 'quantity', 'price_subtotal', 'display_type', 'move_id'])
    const pids = [...lignesCmd, ...lignesFact].map(l => (Array.isArray(l.product_id) ? l.product_id[0] : null)).filter(Boolean)
    const produits = Object.fromEntries((await lire('product.product', pids, ['default_code', 'categ_id'])).map(p => [p.id, p]))

    // Correspondance partenaire Odoo (y compris contacts enfants) → client
    const map = new Map()
    const inconnus = new Set()
    for (const d of [...commandes, ...factures]) {
      for (const k of ['partner_id', 'commercial_partner_id']) {
        const pid = Array.isArray(d[k]) ? d[k][0] : null
        if (!pid) continue
        if (parPartenaire.has(pid)) map.set(pid, parPartenaire.get(pid))
        else inconnus.add(pid)
      }
    }
    for (const p of await lire('res.partner', [...inconnus].filter(x => !map.has(x)), ['commercial_partner_id', 'parent_id'])) {
      for (const k of ['commercial_partner_id', 'parent_id']) {
        const par = Array.isArray(p[k]) ? p[k][0] : null
        if (par && parPartenaire.has(par)) { map.set(p.id, parPartenaire.get(par)); break }
      }
    }
    const idOf = x => (Array.isArray(x) ? x[0] : x)

    for (const c of commandes) {
      try {
        const client = map.get(idOf(c.partner_id))
        if (!client) continue
        const r = await enregistrerVente(client, {
          odoo_modele: 'sale.order', odoo_id: c.id, type: ['sale', 'done'].includes(c.state) ? 'commande' : 'devis',
          reference: c.name, etat: c.state, etat_paiement: null, montant_total: c.amount_total, montant_restant: 0,
          date_document: dateUtc(c.date_order), odoo_modifie_le: c.write_date,
        }, lignesCmd.filter(l => idOf(l.order_id) === c.id), produits)
        elements++
        clientsTouches.add(client.id)
        if (r.fiche_suivi_id) fichesTouchees.add(r.fiche_suivi_id)
      } catch (e) { erreurs.push(`Commande ${c.name} : ${e.message}`) }
    }
    for (const f of factures) {
      try {
        const client = map.get(idOf(f.commercial_partner_id)) || map.get(idOf(f.partner_id))
        if (!client) continue
        const origine = f.invoice_origin ? await queryOne("SELECT odoo_id, fiche_suivi_id FROM ventes WHERE odoo_modele = 'sale.order' AND reference = ?", [String(f.invoice_origin).split(',')[0].trim()]) : null
        const r = await enregistrerVente(client, {
          odoo_modele: 'account.move', odoo_id: f.id, type: f.move_type === 'out_refund' ? 'avoir' : 'facture',
          reference: f.name, etat: f.state, etat_paiement: f.payment_state || null, montant_total: f.amount_total, montant_restant: f.amount_residual,
          date_document: f.invoice_date || null, odoo_commande_id: origine?.odoo_id || null, odoo_modifie_le: f.write_date,
        }, lignesFact.filter(l => idOf(l.move_id) === f.id && !['line_section', 'line_note'].includes(l.display_type || 'product')), produits, origine?.fiche_suivi_id)
        elements++
        clientsTouches.add(client.id)
        if (r.fiche_suivi_id) fichesTouchees.add(r.fiche_suivi_id)
      } catch (e) { erreurs.push(`Facture ${f.name} : ${e.message}`) }
    }
  }
  for (const id of fichesTouchees) await Fiches.majStatutDepuisVentes(id)
  for (const id of clientsTouches) await Commissions.recalculerClient(id)
  if (!erreurs.length) await P.set('odoo_derniere_synchro', debutIso)
  await log('import_ventes', erreurs.length ? 'partiel' : 'succes', elements, erreurs.length,
    erreurs.length ? erreurs.slice(0, 20).join('\n') : `${elements} document(s) importé(s)`, {}, debut, userId)
  return { elements, erreurs: erreurs.length }
}

/** Synchronisation complète : renvoi des clients en attente ou en erreur, puis import des ventes */
let enCours = false
export async function synchroniser(userId = null) {
  if (enCours) throw new ApiError(409, 'Une synchronisation est déjà en cours.')
  if (!(await estConfigure())) throw new ApiError(422, 'Odoo n’est pas configuré (page Paramètres).')
  enCours = true
  try {
    const attente = await query("SELECT id FROM clients WHERE odoo_statut <> 'synchronise' ORDER BY id LIMIT 200")
    let envoyes = 0
    for (const c of attente) { try { await envoyerClient(c.id); envoyes++ } catch { /* journalisé */ } }
    const r = await importerVentes(userId)
    return { ...r, clients_envoyes: envoyes, clients_en_attente: attente.length - envoyes }
  } catch (e) {
    await log('import_ventes', 'erreur', 0, 1, e.message, {}, now(), userId)
    await Alertes.erreurOdoo(e.message)
    throw new ApiError(502, e.message)
  } finally {
    enCours = false
  }
}

export const lignesVente = v => parseJson(v.lignes, [])
export { inList }
