/**
 * Routes de l'API (toutes sous /api, session obligatoire sauf connexion et santé)
 */
import express from 'express'
import { query, queryOne, execute, transaction, scalar, inList } from './db.js'
import {
  ApiError, regle, text, textOrNull, recordId, oneOf, parseJson, now, today, periode, normaliserTelephone, sendCsv, afficherTelephone,
  dateFr, validDate, addDays,
} from './util.js'
import {
  REFERENTIELS, TYPES_VEHICULE, STATUTS_CONDUCTEUR, STATUTS_FICHE, STATUTS_COMMISSION, TYPES_COMMISSION, NIVEAUX, NIVEAUX_PRODUIT,
  MODES_PAIEMENT, TYPES_VENTE, TYPES_ALERTE, TYPES_EVENEMENT, MOTIFS_VISITE, lib,
} from './ref.js'
import {
  requireUser, getUser, login, logout, changePassword, saveNotifications, can, assertCan, assertAgence, scope,
  listUsers, saveUser, roles, saveRole,
} from './auth.js'
import * as P from './parametres.js'
import { evenement, audit } from './journal.js'
import { codeConducteur } from './numerotation.js'
import * as Fiches from './fiches.js'
import * as Commissions from './commissions.js'
import * as Paiements from './paiements.js'
import * as Alertes from './alertes.js'
import * as Stats from './stats.js'
import * as CR from './comptes-rendus.js'
import * as Odoo from './odoo.js'
import * as Docs from './documents.js'
import { enregistrerImage, envoyerFichier } from './storage.js'
import { libelleEtat, estEncaissee } from './ventes-utils.js'
import { envoyerTest, mailConfigure } from './mail.js'

const r = express.Router()
const PAGE = 50

const route = handler => (req, res, next) => {
  Promise.resolve(handler(req, res)).then(result => {
    if (result !== undefined && !res.headersSent) res.json(result)
  }).catch(next)
}
/** Route authentifiée ; `droit` facultatif ('module.action') */
const auth = (droit, handler) => route(async (req, res) => {
  const user = await requireUser(req)
  if (droit) assertCan(user, droit)
  return handler(req, res, user)
})
const exportCsv = req => req.query.format === 'csv'
const nomComplet = x => [x?.nom, x?.prenom].filter(Boolean).join(' ')
const baseUrl = req => `${req.protocol}://${req.get('host')}`

async function paginer(req, sql, params, order) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const total = Number(await scalar(`SELECT COUNT(*) FROM (${sql}) t`, params))
  const rows = await query(`${sql} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, params)
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) }
}

/** Construit une clause WHERE à partir de fragments [sql, ...params] (ignorés si la valeur est vide) */
function where(parts) {
  const sql = []
  const params = []
  for (const [frag, ...vals] of parts) {
    if (vals.some(v => v === undefined || v === null || v === '')) continue
    sql.push(frag)
    params.push(...vals)
  }
  return { sql: sql.length ? sql.join(' AND ') : '1 = 1', params }
}
const like = v => (v ? `%${String(v).trim()}%` : '')

// =====================================================================
// Public : santé et connexion
// =====================================================================
r.get('/health', route(async () => ({ ok: true, db: Number(await scalar('SELECT 1')) === 1, time: now() })))
r.post('/auth/login', route(login))
r.post('/auth/logout', route(logout))
r.get('/auth/me', route(async req => ({ user: await getUser(req) })))
r.post('/auth/password', auth(null, (req, res, u) => changePassword(req, u)))
r.put('/auth/notifications', auth(null, (req, res, u) => saveNotifications(req, u)))

// Référentiels, agences accessibles et utilisateurs (listes déroulantes)
r.get('/ref', auth(null, async (req, res, u) => ({
  ref: REFERENTIELS,
  agences: await query(`SELECT id, nom, code, statut FROM agences WHERE id IN (${inList(u.agenceIds)}) ORDER BY nom`, u.agenceIds),
  roles: (await roles()).map(x => ({ cle: x.cle, libelle: x.libelle })),
  odooUrl: String(await P.get('odoo_url') || '').replace(/\/+$/, ''),
  entreprise: await P.get('entreprise_nom'),
})))

// =====================================================================
// Tableau de bord
// =====================================================================
r.get('/tableau-de-bord', auth('tableau_bord.lire', async (req, res, u) => {
  const p = periode(req.query)
  const ids = req.query.agence ? u.agenceIds.filter(i => i === Number(req.query.agence)) : u.agenceIds
  const type = TYPES_VEHICULE[req.query.type] ? req.query.type : null
  return {
    periode: p,
    indicateurs: await Stats.indicateurs(ids, p.debut, p.fin, type),
    attente: await Stats.actionsEnAttente(ids),
    top: await Stats.topConducteurs(ids, p.debut, p.fin, type, 5),
    series: await Stats.seriesHebdomadaires(ids, 8, type),
    parType: type ? null : await Stats.parType(ids, p.debut, p.fin),
    alertes: await query(`SELECT id, type, gravite, message, created_at FROM alertes WHERE statut = 'ouverte' AND agence_id IN (${inList(ids)}) ORDER BY created_at DESC LIMIT 5`, ids),
  }
}))

// =====================================================================
// Conducteurs
// =====================================================================
const CONDUCTEUR_SQL = `SELECT c.*, a.nom AS agence, a.code AS agence_code FROM conducteurs c JOIN agences a ON a.id = c.agence_id`

async function chargerConducteur(id, u) {
  const c = await queryOne(`${CONDUCTEUR_SQL} WHERE c.id = ?`, [recordId(id)])
  if (!c) throw new ApiError(404, 'Conducteur introuvable.')
  assertAgence(u, c.agence_id)
  return c
}

r.get('/conducteurs', auth('conducteurs.lire', async (req, res, u) => {
  const s = scope(u, 'c', req.query.agence)
  const q = like(req.query.q)
  const w = where([[s.sql, ...s.params], ['c.type = ?', req.query.type], ['c.statut = ?', req.query.statut],
    ['(c.code LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ? OR c.telephone = ? OR c.cin LIKE ? OR c.immatriculation LIKE ?)', ...(q ? [q, q, q, normaliserTelephone(req.query.q) || '§', q, q] : [''])]])
  const sql = `SELECT c.id, c.code, c.type, c.nom, c.prenom, c.telephone, c.cin, c.immatriculation, c.statut, c.commissions_bloquees, c.charte_signee_le, c.created_at, a.nom AS agence,
      (SELECT COUNT(*) FROM fiches_suivi f WHERE f.conducteur_id = c.id AND f.statut <> 'rejetee') AS visites,
      (SELECT COUNT(DISTINCT f.client_id) FROM fiches_suivi f WHERE f.conducteur_id = c.id AND f.statut IN ('facturee','encaissee')) AS acheteurs
    FROM conducteurs c JOIN agences a ON a.id = c.agence_id WHERE ${w.sql}`
  if (exportCsv(req)) {
    assertCan(u, 'conducteurs.exporter')
    return sendCsv(res, 'conducteurs', [
      { label: 'Code', value: 'code' }, { label: 'Type', value: x => TYPES_VEHICULE[x.type] }, { label: 'Nom', value: 'nom' }, { label: 'Prénom', value: 'prenom' },
      { label: 'Téléphone', value: x => afficherTelephone(x.telephone) }, { label: 'CIN', value: 'cin' }, { label: 'Immatriculation', value: 'immatriculation' },
      { label: 'Agence', value: 'agence' }, { label: 'Statut', value: x => lib(STATUTS_CONDUCTEUR, x.statut) }, { label: 'Visites', value: 'visites' },
      { label: 'Acheteurs', value: 'acheteurs' }, { label: 'Inscrit le', value: x => dateFr(x.created_at) },
    ], await query(`${sql} ORDER BY c.code`, w.params))
  }
  return paginer(req, sql, w.params, 'c.code')
}))

// Recherche rapide (comptoir) et conducteurs les plus présents ces 7 derniers jours
r.get('/conducteurs/recherche', auth('fiches.creer', async (req, res, u) => {
  const s = scope(u, 'c')
  const q = String(req.query.q || '').trim()
  if (q.length < 2) {
    return query(`SELECT c.id, c.code, c.nom, c.prenom, c.type, c.statut, a.nom AS agence,
        (SELECT COUNT(*) FROM fiches_suivi f WHERE f.conducteur_id = c.id AND f.date_visite >= ?) AS recentes
      FROM conducteurs c JOIN agences a ON a.id = c.agence_id WHERE ${s.sql} AND c.statut = 'actif' ORDER BY recentes DESC, c.code LIMIT 6`,
    [`${addDays(today(), -7)} 00:00:00`, ...s.params])
  }
  const l = `%${q}%`
  const tel = normaliserTelephone(q)
  return query(`SELECT c.id, c.code, c.nom, c.prenom, c.type, c.statut, a.nom AS agence FROM conducteurs c JOIN agences a ON a.id = c.agence_id
    WHERE ${s.sql} AND (c.code LIKE ? OR c.nom LIKE ? OR c.prenom LIKE ? OR c.immatriculation LIKE ? OR c.telephone = ?) ORDER BY c.code LIMIT 8`,
  [...s.params, l, l, l, l, tel || '§'])
}))

r.get('/conducteurs/:id', auth('conducteurs.lire', async (req, res, u) => {
  const c = await chargerConducteur(req.params.id, u)
  const comm = await query(`SELECT statut, paiement_id IS NULL AS non_paye, SUM(montant) AS total, COUNT(*) AS nb FROM commissions
    WHERE conducteur_id = ? AND statut IN ('a_valider','validee','payee','bloquee') GROUP BY statut, non_paye`, [c.id])
  const somme = f => comm.filter(f).reduce((s, l) => s + Number(l.total), 0)
  const createur = c.cree_par ? await queryOne('SELECT nom FROM utilisateurs WHERE id = ?', [c.cree_par]) : null
  return {
    conducteur: { ...c, createur: createur?.nom || null, photo: !!c.photo, charte_signature: !!c.charte_signature },
    stats: {
      visites: Number(await scalar("SELECT COUNT(*) FROM fiches_suivi WHERE conducteur_id = ? AND statut <> 'rejetee'", [c.id])),
      acheteurs: Number(await scalar("SELECT COUNT(DISTINCT client_id) FROM fiches_suivi WHERE conducteur_id = ? AND statut IN ('facturee','encaissee')", [c.id])),
      clients: Number(await scalar('SELECT COUNT(*) FROM clients WHERE conducteur_id = ?', [c.id])),
      gagne: somme(() => true), a_valider: somme(l => l.statut === 'a_valider'),
      nb_a_valider: comm.filter(l => l.statut === 'a_valider').reduce((s, l) => s + Number(l.nb), 0),
      bloque: somme(l => l.statut === 'bloquee'), a_payer: somme(l => l.statut === 'validee' && Number(l.non_paye)),
      paye: Number(await scalar('SELECT COALESCE(SUM(montant_net), 0) FROM paiements WHERE conducteur_id = ?', [c.id])),
      nb_paiements: Number(await scalar('SELECT COUNT(*) FROM paiements WHERE conducteur_id = ?', [c.id])),
    },
    apercu: can(u, 'paiements.payer') ? await Paiements.apercu(c.id) : null,
    peutValiderEnPayant: can(u, 'commissions.valider') && !(await P.get('separation_validation_paiement')),
  }
}))

r.get('/conducteurs/:id/onglet/:onglet', auth('conducteurs.lire', async (req, res, u) => {
  const c = await chargerConducteur(req.params.id, u)
  switch (req.params.onglet) {
    case 'clients': return paginer(req, 'SELECT id, nom, prenom, telephone, quartier, attribue_le, attribution_fin, odoo_statut FROM clients WHERE conducteur_id = ?', [c.id], 'attribue_le DESC')
    case 'ventes': return paginer(req, `SELECT v.*, cl.nom AS client_nom, cl.prenom AS client_prenom FROM ventes v JOIN fiches_suivi f ON f.id = v.fiche_suivi_id
      JOIN clients cl ON cl.id = v.client_id WHERE f.conducteur_id = ?`, [c.id], 'v.date_document DESC').then(p => ({ ...p, rows: p.rows.map(v => ({ ...v, etat_libelle: libelleEtat(v), lignes: undefined })) }))
    case 'commissions': return paginer(req, `SELECT cm.*, cl.nom AS client_nom, cl.prenom AS client_prenom, f.numero AS fiche FROM commissions cm JOIN clients cl ON cl.id = cm.client_id
      LEFT JOIN fiches_suivi f ON f.id = cm.fiche_suivi_id WHERE cm.conducteur_id = ?`, [c.id], 'cm.id DESC')
    case 'paiements': return paginer(req, 'SELECT p.*, u.nom AS paye_par_nom FROM paiements p JOIN utilisateurs u ON u.id = p.paye_par WHERE p.conducteur_id = ?', [c.id], 'p.paye_le DESC')
    default: return paginer(req, `SELECT f.id, f.numero, f.date_visite, f.statut, f.motif, f.est_doublon, cl.nom AS client_nom, cl.prenom AS client_prenom, cl.telephone AS client_telephone
      FROM fiches_suivi f JOIN clients cl ON cl.id = f.client_id WHERE f.conducteur_id = ?`, [c.id], 'f.date_visite DESC')
  }
}))

r.get('/conducteurs/:id/photo', auth('conducteurs.lire', async (req, res, u) => envoyerFichier(res, (await chargerConducteur(req.params.id, u)).photo)))

async function lireConducteur(b, u, id) {
  const nom = text(b.nom, 'Nom', { required: true, max: 100 }).toUpperCase()
  const prenom = textOrNull(b.prenom, 'Prénom', { max: 100 })
  const telephone = normaliserTelephone(b.telephone)
  if (!telephone) throw regle('Numéro de téléphone invalide (ex. 034 12 345 67).')
  const cin = text(b.cin, 'N° CIN', { required: true, max: 20 }).replace(/\s+/g, '')
  const type = id ? null : oneOf(b.type, TYPES_VEHICULE, 'Type de véhicule')
  const immat = b.immatriculation ? String(b.immatriculation).trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 30) : null
  const agenceId = Number(b.agence_id)
  assertAgence(u, agenceId)
  const mode = oneOf(b.mode_paiement || 'especes', { especes: 1, mobile_money: 1 }, 'Mode de paiement')
  let operateur = null
  let numeroMm = null
  if (mode === 'mobile_money') {
    operateur = oneOf(b.operateur_mobile, REFERENTIELS.OPERATEURS, 'Opérateur Mobile Money')
    numeroMm = normaliserTelephone(b.numero_mobile_money)
    if (!numeroMm) throw regle('Numéro Mobile Money invalide.')
  }
  for (const [col, val, label] of [['telephone', telephone, 'ce téléphone'], ['cin', cin, 'ce N° CIN'], ['immatriculation', immat, 'cette immatriculation']]) {
    if (!val) continue
    const d = await queryOne(`SELECT code FROM conducteurs WHERE ${col} = ? AND id <> ?`, [val, id || 0])
    if (d) throw regle(`Doublon : ${label} est déjà celui de ${d.code}.`)
  }
  return { nom, prenom, telephone, cin, type, immatriculation: immat, agence_id: agenceId, mode_paiement: mode, operateur_mobile: operateur, numero_mobile_money: numeroMm }
}

r.post('/conducteurs', auth('conducteurs.creer', async (req, res, u) => {
  const v = await lireConducteur(req.body || {}, u, null)
  if (v.type === 'tuktuk' && !v.immatriculation) throw regle("L'immatriculation est obligatoire pour un tuk-tuk.")
  const photo = req.body.photo ? enregistrerImage(req.body.photo, 'photos', 'conducteur') : null
  const c = await transaction(async conn => {
    const agence = await queryOne('SELECT * FROM agences WHERE id = ? FOR UPDATE', [v.agence_id], conn)
    const { code, numero } = await codeConducteur(conn, agence, v.type)
    const ins = await execute(`INSERT INTO conducteurs (code, numero, type, agence_id, nom, prenom, telephone, cin, immatriculation, photo, mode_paiement, operateur_mobile,
      numero_mobile_money, statut, cree_par, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'actif', ?, ?)`,
    [code, numero, v.type, v.agence_id, v.nom, v.prenom, v.telephone, v.cin, v.immatriculation, photo, v.mode_paiement, v.operateur_mobile, v.numero_mobile_money, u.id, now()], conn)
    await evenement('conducteur', 'inscription', `Inscription de ${code} ${nomComplet(v)} (${TYPES_VEHICULE[v.type]})`, { agence_id: v.agence_id, conducteur_id: ins.insertId, user_id: u.id }, null, conn)
    return { id: ins.insertId, code }
  })
  await audit(req, u, 'creer', 'conducteurs', c.id, c.code)
  return c
}))

r.put('/conducteurs/:id', auth('conducteurs.modifier', async (req, res, u) => {
  const c = await chargerConducteur(req.params.id, u)
  const v = await lireConducteur(req.body || {}, u, c.id)
  if (c.type === 'tuktuk' && !v.immatriculation) throw regle("L'immatriculation est obligatoire pour un tuk-tuk.")
  const photo = req.body.photo ? enregistrerImage(req.body.photo, 'photos', 'conducteur') : c.photo
  // Changement d'agence : le code partenaire est conservé
  await execute(`UPDATE conducteurs SET nom = ?, prenom = ?, telephone = ?, cin = ?, immatriculation = ?, agence_id = ?, mode_paiement = ?, operateur_mobile = ?,
    numero_mobile_money = ?, photo = ?, updated_at = ? WHERE id = ?`, [v.nom, v.prenom, v.telephone, v.cin, v.immatriculation, v.agence_id, v.mode_paiement,
    v.operateur_mobile, v.numero_mobile_money, photo, now(), c.id])
  await audit(req, u, 'modifier', 'conducteurs', c.id, c.code)
  return { ok: true }
}))

r.post('/conducteurs/:id/statut', auth('conducteurs.modifier', async (req, res, u) => {
  const c = await chargerConducteur(req.params.id, u)
  const statut = oneOf(req.body?.statut, STATUTS_CONDUCTEUR, 'Statut')
  const motif = textOrNull(req.body?.motif, 'Motif', { max: 250 })
  if (statut !== 'actif' && !motif) throw regle('Indiquez le motif.')
  await execute('UPDATE conducteurs SET statut = ?, motif_statut = ?, updated_at = ? WHERE id = ?', [statut, motif, now(), c.id])
  await evenement('conducteur', 'statut', `${c.code} : statut ${STATUTS_CONDUCTEUR[statut]}${motif ? ` (${motif})` : ''}`, { agence_id: c.agence_id, conducteur_id: c.id, user_id: u.id })
  return { ok: true }
}))

r.post('/conducteurs/:id/charte', auth('conducteurs.modifier', async (req, res, u) => {
  const c = await chargerConducteur(req.params.id, u)
  if (!req.body?.signature) throw regle('Faites signer le conducteur dans le cadre.')
  const chemin = enregistrerImage(req.body.signature, 'signatures', `charte-${c.id}`, { formats: ['png'], max: 1024 * 1024 })
  await execute('UPDATE conducteurs SET charte_signee_le = ?, charte_signature = ?, updated_at = ? WHERE id = ?', [now(), chemin, now(), c.id])
  await evenement('conducteur', 'charte', `${c.code} a signé la charte du programme`, { agence_id: c.agence_id, conducteur_id: c.id, user_id: u.id })
  return { ok: true }
}))

r.post('/conducteurs/:id/blocage', auth('alertes.traiter', async (req, res, u) => {
  const c = await chargerConducteur(req.params.id, u)
  await transaction(conn => Alertes.bloquerCommissions(c, !c.commissions_bloquees, u.id, conn))
  return { bloquees: !c.commissions_bloquees }
}))

r.post('/conducteurs/:id/payer', auth('paiements.payer', async (req, res, u) => Paiements.payer(recordId(req.params.id), req.body || {}, u)))

// =====================================================================
// Fiches de suivi
// =====================================================================
r.post('/fiches/controle-doublon', auth('fiches.creer', async req => ({ resultat: await Fiches.controleDoublon(req.body?.telephone, req.body?.conducteur_id) })))
r.get('/fiches/conseillers', auth('fiches.creer', async (req, res, u) => {
  const agence = Number(req.query.agence) || null
  return query(`SELECT DISTINCT u.id, u.nom FROM utilisateurs u LEFT JOIN agence_utilisateur au ON au.user_id = u.id
    WHERE u.actif = 1 ${agence ? 'AND (u.portee = \'toutes\' OR au.agence_id = ?)' : ''} ORDER BY u.nom`, agence ? [agence] : [])
}))

r.post('/fiches', auth('fiches.creer', async (req, res, u) => {
  const f = await Fiches.creer(req.body || {}, u)
  return { id: f.id, numero: f.numero, est_doublon: !!f.est_doublon }
}))

r.get('/fiches', auth('fiches.lire', async (req, res, u) => {
  const s = scope(u, 'f', req.query.agence)
  const p = req.query.du || req.query.au ? periode(req.query) : null
  const q = like(req.query.q)
  const w = where([[s.sql, ...s.params], ['f.statut = ?', req.query.statut], ['ct.type = ?', req.query.type], ['f.conducteur_id = ?', req.query.conducteur],
    ['f.est_doublon = 1 AND ? = ?', req.query.doublon ? 1 : '', 1], ['f.date_visite BETWEEN ? AND ?', p?.debut, p?.fin],
    ['(f.numero LIKE ? OR cl.nom LIKE ? OR cl.prenom LIKE ? OR cl.telephone LIKE ? OR ct.code LIKE ?)', q, q, q, q, q]])
  const sql = `SELECT f.id, f.numero, f.date_visite, f.statut, f.motif, f.est_doublon, f.motif_doublon, f.saisie_papier, f.date_limite, f.saisi_par,
      cl.nom AS client_nom, cl.prenom AS client_prenom, cl.telephone AS client_telephone, ct.code AS conducteur_code, ct.type AS conducteur_type, a.nom AS agence
    FROM fiches_suivi f JOIN clients cl ON cl.id = f.client_id JOIN conducteurs ct ON ct.id = f.conducteur_id JOIN agences a ON a.id = f.agence_id WHERE ${w.sql}`
  if (exportCsv(req)) {
    assertCan(u, 'fiches.exporter')
    return sendCsv(res, 'fiches_de_suivi', [
      { label: 'N° fiche', value: 'numero' }, { label: 'Date de visite', value: x => dateFr(x.date_visite) }, { label: 'Agence', value: 'agence' },
      { label: 'Conducteur', value: 'conducteur_code' }, { label: 'Client', value: x => nomComplet({ nom: x.client_nom, prenom: x.client_prenom }) },
      { label: 'Téléphone', value: x => afficherTelephone(x.client_telephone) }, { label: 'Motif', value: x => lib(MOTIFS_VISITE, x.motif) },
      { label: 'Statut', value: x => lib(STATUTS_FICHE, x.statut) }, { label: 'Doublon', value: x => (x.est_doublon ? 'Oui' : '') },
      { label: 'Date limite', value: x => dateFr(x.date_limite) },
    ], await query(`${sql} ORDER BY f.date_visite DESC`, w.params))
  }
  return paginer(req, sql, w.params, 'f.date_visite DESC')
}))

r.get('/fiches/:id', auth('fiches.lire', async (req, res, u) => {
  const f = await queryOne(`SELECT f.*, cl.nom AS client_nom, cl.prenom AS client_prenom, cl.telephone AS client_telephone, cl.quartier AS client_quartier,
      cl.conducteur_id AS client_conducteur_id, cl.attribution_fin, ct.code AS conducteur_code, ct.nom AS conducteur_nom, ct.prenom AS conducteur_prenom, ct.type AS conducteur_type,
      a.nom AS agence, us.nom AS saisi_par_nom, uv.nom AS valide_par_nom, uc.nom AS conseiller_nom
    FROM fiches_suivi f JOIN clients cl ON cl.id = f.client_id JOIN conducteurs ct ON ct.id = f.conducteur_id JOIN agences a ON a.id = f.agence_id
    LEFT JOIN utilisateurs us ON us.id = f.saisi_par LEFT JOIN utilisateurs uv ON uv.id = f.valide_par LEFT JOIN utilisateurs uc ON uc.id = f.conseiller_id
    WHERE f.id = ?`, [recordId(req.params.id)])
  if (!f) throw new ApiError(404, 'Fiche introuvable.')
  assertAgence(u, f.agence_id)
  const ventes = (await query('SELECT * FROM ventes WHERE fiche_suivi_id = ? ORDER BY date_document', [f.id])).map(v => ({ ...v, etat_libelle: libelleEtat(v), encaissee: estEncaissee(v), lignes: parseJson(v.lignes, []) }))
  const commissions = (await query('SELECT * FROM commissions WHERE fiche_suivi_id = ? ORDER BY id', [f.id])).map(c => ({ ...c, controles: parseJson(c.controles, []) }))
  const chronologie = await query('SELECT e.*, u.nom AS user_nom FROM evenements e LEFT JOIN utilisateurs u ON u.id = e.user_id WHERE e.fiche_suivi_id = ? ORDER BY e.created_at, e.id', [f.id])
  return { fiche: { ...f, produits_interet: parseJson(f.produits_interet, []) }, ventes, commissions, chronologie }
}))

r.post('/fiches/valider-groupe', auth('fiches.valider', async (req, res, u) => Fiches.validerGroupe((req.body?.ids || []).slice(0, 200), u)))
r.post('/fiches/:id/valider', auth('fiches.valider', async (req, res, u) => { await Fiches.valider(recordId(req.params.id), u); return { ok: true } }))
r.post('/fiches/:id/rejeter', auth('fiches.valider', async (req, res, u) => { await Fiches.rejeter(recordId(req.params.id), u, String(req.body?.motif || '').trim()); return { ok: true } }))

// =====================================================================
// Clients et ventes
// =====================================================================
r.get('/clients', auth('clients.lire', async (req, res, u) => {
  const s = scope(u, 'cl', req.query.agence)
  const q = like(req.query.q)
  const attrib = req.query.attribution
  const w = where([[s.sql, ...s.params], ['cl.odoo_statut = ?', req.query.odoo],
    [attrib === 'active' ? 'cl.attribution_fin >= ?' : attrib === 'libre' ? '(cl.attribution_fin IS NULL OR cl.attribution_fin < ?)' : '1 = 1', attrib ? today() : undefined].filter(x => x !== undefined),
    ['(cl.nom LIKE ? OR cl.prenom LIKE ? OR cl.telephone LIKE ? OR cl.quartier LIKE ? OR ct.code LIKE ?)', q, q, q, q, q]])
  const sql = `SELECT cl.id, cl.nom, cl.prenom, cl.telephone, cl.quartier, cl.attribue_le, cl.attribution_fin, cl.odoo_statut, cl.odoo_partenaire_id, cl.created_at,
      ct.code AS conducteur_code, a.nom AS agence,
      (SELECT COUNT(*) FROM fiches_suivi f WHERE f.client_id = cl.id) AS visites
    FROM clients cl JOIN agences a ON a.id = cl.agence_id LEFT JOIN conducteurs ct ON ct.id = cl.conducteur_id WHERE ${w.sql}`
  if (exportCsv(req)) {
    assertCan(u, 'clients.exporter')
    return sendCsv(res, 'clients', [
      { label: 'Nom', value: 'nom' }, { label: 'Prénom', value: 'prenom' }, { label: 'Téléphone', value: x => afficherTelephone(x.telephone) },
      { label: 'Quartier', value: 'quartier' }, { label: 'Agence', value: 'agence' }, { label: 'Conducteur', value: 'conducteur_code' },
      { label: 'Attribué le', value: x => dateFr(x.attribue_le) }, { label: "Fin d'attribution", value: x => dateFr(x.attribution_fin) },
      { label: 'Odoo', value: 'odoo_statut' }, { label: 'Visites', value: 'visites' },
    ], await query(`${sql} ORDER BY cl.nom`, w.params))
  }
  return paginer(req, sql, w.params, 'cl.created_at DESC')
}))

r.get('/clients/:id', auth('clients.lire', async (req, res, u) => {
  const cl = await queryOne(`SELECT cl.*, ct.code AS conducteur_code, ct.nom AS conducteur_nom, ct.prenom AS conducteur_prenom, a.nom AS agence
    FROM clients cl JOIN agences a ON a.id = cl.agence_id LEFT JOIN conducteurs ct ON ct.id = cl.conducteur_id WHERE cl.id = ?`, [recordId(req.params.id)])
  if (!cl) throw new ApiError(404, 'Client introuvable.')
  assertAgence(u, cl.agence_id)
  return {
    client: cl,
    fiches: await query('SELECT f.id, f.numero, f.date_visite, f.statut, f.est_doublon, ct.code AS conducteur_code FROM fiches_suivi f JOIN conducteurs ct ON ct.id = f.conducteur_id WHERE f.client_id = ? ORDER BY f.date_visite DESC', [cl.id]),
    ventes: (await query('SELECT * FROM ventes WHERE client_id = ? ORDER BY date_document DESC', [cl.id])).map(v => ({ ...v, etat_libelle: libelleEtat(v), lignes: undefined })),
    commissions: await query('SELECT cm.*, ct.code AS conducteur_code FROM commissions cm JOIN conducteurs ct ON ct.id = cm.conducteur_id WHERE cm.client_id = ? ORDER BY cm.id DESC', [cl.id]),
    chronologie: await query('SELECT e.*, u.nom AS user_nom FROM evenements e LEFT JOIN utilisateurs u ON u.id = e.user_id WHERE e.client_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT 100', [cl.id]),
  }
}))

r.put('/clients/:id', auth('clients.modifier', async (req, res, u) => {
  const cl = await queryOne('SELECT * FROM clients WHERE id = ?', [recordId(req.params.id)])
  if (!cl) throw new ApiError(404, 'Client introuvable.')
  assertAgence(u, cl.agence_id)
  const b = req.body || {}
  await execute('UPDATE clients SET nom = ?, prenom = ?, quartier = ?, updated_at = ? WHERE id = ?',
    [text(b.nom, 'Nom', { required: true, max: 100 }), textOrNull(b.prenom, 'Prénom', { max: 100 }), textOrNull(b.quartier, 'Quartier', { max: 100 }), now(), cl.id])
  await audit(req, u, 'modifier', 'clients', cl.id, cl.telephone)
  return { ok: true }
}))

r.post('/clients/:id/odoo', auth('ventes.synchroniser', async (req, res, u) => {
  const cl = await queryOne('SELECT agence_id FROM clients WHERE id = ?', [recordId(req.params.id)])
  if (!cl) throw new ApiError(404, 'Client introuvable.')
  assertAgence(u, cl.agence_id)
  if (!(await Odoo.estConfigure())) throw regle('Odoo n’est pas configuré (page Paramètres).')
  try { await Odoo.envoyerClient(Number(req.params.id)) } catch (e) { throw new ApiError(502, e.message) }
  return { ok: true }
}))

r.get('/ventes', auth('ventes.lire', async (req, res, u) => {
  const s = scope(u, 'v', req.query.agence)
  const p = req.query.du || req.query.au ? periode(req.query) : null
  const q = like(req.query.q)
  const w = where([[s.sql, ...s.params], ['v.type = ?', req.query.type], ['v.etat_paiement = ?', req.query.paiement],
    ['v.date_document BETWEEN ? AND ?', p?.du, p?.au], ['(v.reference LIKE ? OR cl.nom LIKE ? OR cl.telephone LIKE ? OR ct.code LIKE ?)', q, q, q, q]])
  const sql = `SELECT v.id, v.odoo_modele, v.odoo_id, v.type, v.reference, v.etat, v.etat_paiement, v.montant_total, v.montant_restant, v.niveau, v.niveau_par_defaut,
      v.date_document, v.fiche_suivi_id, cl.id AS client_id, cl.nom AS client_nom, cl.prenom AS client_prenom, f.numero AS fiche, ct.code AS conducteur_code, a.nom AS agence
    FROM ventes v JOIN clients cl ON cl.id = v.client_id JOIN agences a ON a.id = v.agence_id
    LEFT JOIN fiches_suivi f ON f.id = v.fiche_suivi_id LEFT JOIN conducteurs ct ON ct.id = f.conducteur_id WHERE ${w.sql}`
  const map = v => ({ ...v, etat_libelle: libelleEtat(v), encaissee: estEncaissee(v) })
  if (exportCsv(req)) {
    assertCan(u, 'ventes.exporter')
    return sendCsv(res, 'ventes_odoo', [
      { label: 'Référence', value: 'reference' }, { label: 'Type', value: x => TYPES_VENTE[x.type] }, { label: 'Date', value: x => dateFr(x.date_document) },
      { label: 'Client', value: x => nomComplet({ nom: x.client_nom, prenom: x.client_prenom }) }, { label: 'Fiche', value: 'fiche' },
      { label: 'Conducteur', value: 'conducteur_code' }, { label: 'Agence', value: 'agence' }, { label: 'État', value: x => libelleEtat(x) },
      { label: 'Montant', value: 'montant_total' }, { label: 'Reste dû', value: 'montant_restant' }, { label: 'Niveau', value: x => lib(NIVEAUX, x.niveau) },
    ], await query(`${sql} ORDER BY v.date_document DESC`, w.params))
  }
  const res2 = await paginer(req, sql, w.params, 'v.date_document DESC, v.id DESC')
  return { ...res2, rows: res2.rows.map(map) }
}))

// =====================================================================
// Odoo
// =====================================================================
r.post('/odoo/synchroniser', auth('ventes.synchroniser', async (req, res, u) => Odoo.synchroniser(u.id)))
r.post('/odoo/tester', auth('parametres.modifier', async (req, res, u) => Odoo.tester(u.id)))
r.post('/odoo/champs', auth('parametres.modifier', async (req, res, u) => ({ crees: await Odoo.installerChamps(u.id) })))
r.get('/odoo/journal', auth('parametres.lire', async req => {
  const w = where([['statut = ?', req.query.statut], ['operation = ?', req.query.operation]])
  return {
    ...(await paginer(req, `SELECT s.*, u.nom AS user_nom FROM odoo_synchronisations s LEFT JOIN utilisateurs u ON u.id = s.user_id WHERE ${w.sql}`, w.params, 's.id DESC')),
    derniere: await P.get('odoo_derniere_synchro'), actif: await Odoo.estActif(), configure: await Odoo.estConfigure(),
    clients_en_erreur: Number(await scalar("SELECT COUNT(*) FROM clients WHERE odoo_statut = 'erreur'")),
    clients_en_attente: Number(await scalar("SELECT COUNT(*) FROM clients WHERE odoo_statut = 'en_attente'")),
  }
}))

// =====================================================================
// Commissions et paiements
// =====================================================================
r.get('/commissions', auth('commissions.lire', async (req, res, u) => {
  const s = scope(u, 'cm', req.query.agence)
  const p = req.query.du || req.query.au ? periode(req.query) : null
  const q = like(req.query.q)
  const w = where([[s.sql, ...s.params], ['cm.statut = ?', req.query.statut], ['cm.type = ?', req.query.type], ['cm.conducteur_id = ?', req.query.conducteur],
    ['cm.created_at BETWEEN ? AND ?', p?.debut, p?.fin], ['(ct.code LIKE ? OR cl.nom LIKE ? OR f.numero LIKE ?)', q, q, q]])
  const sql = `SELECT cm.*, ct.code AS conducteur_code, ct.nom AS conducteur_nom, ct.prenom AS conducteur_prenom, cl.nom AS client_nom, cl.prenom AS client_prenom,
      f.numero AS fiche, f.saisi_par, v.reference AS vente_reference, a.nom AS agence, uv.nom AS valide_par_nom, pa.numero AS paiement_numero
    FROM commissions cm JOIN conducteurs ct ON ct.id = cm.conducteur_id JOIN clients cl ON cl.id = cm.client_id JOIN agences a ON a.id = cm.agence_id
    LEFT JOIN fiches_suivi f ON f.id = cm.fiche_suivi_id LEFT JOIN ventes v ON v.id = cm.vente_id LEFT JOIN utilisateurs uv ON uv.id = cm.valide_par
    LEFT JOIN paiements pa ON pa.id = cm.paiement_id WHERE ${w.sql}`
  if (exportCsv(req)) {
    assertCan(u, 'commissions.exporter')
    return sendCsv(res, 'commissions', [
      { label: 'Date', value: x => dateFr(x.created_at) }, { label: 'Conducteur', value: 'conducteur_code' }, { label: 'Client', value: x => nomComplet({ nom: x.client_nom, prenom: x.client_prenom }) },
      { label: 'Fiche', value: 'fiche' }, { label: 'Facture', value: 'vente_reference' }, { label: 'Type', value: x => lib(TYPES_COMMISSION, x.type) },
      { label: 'Niveau', value: x => lib(NIVEAUX, x.niveau) }, { label: 'Barème', value: 'montant_bareme' }, { label: 'Déjà accordé', value: 'montant_deduit' },
      { label: 'Montant', value: 'montant' }, { label: 'Statut', value: x => lib(STATUTS_COMMISSION, x.statut) }, { label: 'Motif', value: 'motif' },
      { label: 'Agence', value: 'agence' }, { label: 'Paiement', value: 'paiement_numero' },
    ], await query(`${sql} ORDER BY cm.id DESC`, w.params))
  }
  const page = await paginer(req, sql, w.params, 'cm.id DESC')
  const totaux = await query(`SELECT cm.statut, COUNT(*) AS nb, SUM(cm.montant) AS total FROM commissions cm JOIN conducteurs ct ON ct.id = cm.conducteur_id JOIN clients cl ON cl.id = cm.client_id
    LEFT JOIN fiches_suivi f ON f.id = cm.fiche_suivi_id WHERE ${w.sql} GROUP BY cm.statut`, w.params)
  return { ...page, rows: page.rows.map(c => ({ ...c, controles: parseJson(c.controles, []) })), totaux }
}))
r.post('/commissions/valider-groupe', auth('commissions.valider', async (req, res, u) => Commissions.validerGroupe((req.body?.ids || []).slice(0, 500), u)))
r.post('/commissions/:id/valider', auth('commissions.valider', async (req, res, u) => { await Commissions.valider(recordId(req.params.id), u); return { ok: true } }))
r.post('/commissions/:id/rejeter', auth('commissions.valider', async (req, res, u) => { await Commissions.rejeter(recordId(req.params.id), u, String(req.body?.motif || '').trim()); return { ok: true } }))

r.get('/paiements/etat', auth('paiements.lire', async (req, res, u) => {
  const ids = req.query.agence ? u.agenceIds.filter(i => i === Number(req.query.agence)) : u.agenceIds
  return { lignes: await Paiements.etat(ids), jour_paiement: await P.entier('jour_paiement') }
}))
r.get('/paiements', auth('paiements.lire', async (req, res, u) => {
  const s = scope(u, 'p', req.query.agence)
  const pr = req.query.du || req.query.au ? periode(req.query) : null
  const q = like(req.query.q)
  const w = where([[s.sql, ...s.params], ['p.mode = ?', req.query.mode], ['p.paye_le BETWEEN ? AND ?', pr?.debut, pr?.fin], ['(p.numero LIKE ? OR c.code LIKE ? OR c.nom LIKE ?)', q, q, q]])
  const sql = `SELECT p.id, p.numero, p.paye_le, p.mode, p.reference_transaction, p.montant_commissions, p.montant_regularisations, p.montant_net, p.periode_debut, p.periode_fin,
      p.signature IS NOT NULL AS a_signature, c.id AS conducteur_id, c.code AS conducteur_code, c.nom AS conducteur_nom, c.prenom AS conducteur_prenom, a.nom AS agence, u.nom AS paye_par_nom
    FROM paiements p JOIN conducteurs c ON c.id = p.conducteur_id JOIN agences a ON a.id = p.agence_id JOIN utilisateurs u ON u.id = p.paye_par WHERE ${w.sql}`
  if (exportCsv(req)) {
    assertCan(u, 'paiements.exporter')
    return sendCsv(res, 'paiements', [
      { label: 'N°', value: 'numero' }, { label: 'Payé le', value: x => dateFr(x.paye_le) }, { label: 'Conducteur', value: 'conducteur_code' },
      { label: 'Nom', value: x => nomComplet({ nom: x.conducteur_nom, prenom: x.conducteur_prenom }) }, { label: 'Agence', value: 'agence' },
      { label: 'Mode', value: x => MODES_PAIEMENT[x.mode] }, { label: 'Référence', value: 'reference_transaction' }, { label: 'Commissions', value: 'montant_commissions' },
      { label: 'Régularisations', value: 'montant_regularisations' }, { label: 'Net', value: 'montant_net' }, { label: 'Payé par', value: 'paye_par_nom' },
    ], await query(`${sql} ORDER BY p.paye_le DESC`, w.params))
  }
  return paginer(req, sql, w.params, 'p.paye_le DESC')
}))
r.get('/paiements/:id/signature', auth('paiements.lire', async (req, res, u) => {
  const p = await queryOne('SELECT agence_id, signature FROM paiements WHERE id = ?', [recordId(req.params.id)])
  if (!p) throw new ApiError(404, 'Paiement introuvable.')
  assertAgence(u, p.agence_id)
  return envoyerFichier(res, p.signature)
}))

// =====================================================================
// Alertes
// =====================================================================
r.get('/alertes', auth('alertes.lire', async (req, res, u) => {
  const s = scope(u, 'al', req.query.agence)
  const statut = req.query.statut ?? 'ouverte'
  const w = where([[`(${s.sql}${req.query.agence ? '' : ' OR al.agence_id IS NULL'})`, ...s.params], ['al.statut = ?', statut], ['al.type = ?', req.query.type], ['al.gravite = ?', req.query.gravite]])
  const sql = `SELECT al.*, a.nom AS agence, ct.code AS conducteur_code, ct.statut AS conducteur_statut, ct.commissions_bloquees, f.numero AS fiche, u.nom AS traitee_par_nom
    FROM alertes al LEFT JOIN agences a ON a.id = al.agence_id LEFT JOIN conducteurs ct ON ct.id = al.conducteur_id
    LEFT JOIN fiches_suivi f ON f.id = al.fiche_suivi_id LEFT JOIN utilisateurs u ON u.id = al.traitee_par WHERE ${w.sql}`
  return paginer(req, sql, w.params, "al.statut = 'ouverte' DESC, FIELD(al.gravite, 'haute', 'moyenne', 'faible'), al.created_at DESC")
}))
r.post('/alertes/:id/traiter', auth('alertes.traiter', async (req, res, u) => {
  await Alertes.traiter(recordId(req.params.id), String(req.body?.action || 'commentaire'), textOrNull(req.body?.commentaire, 'Commentaire', { max: 2000 }), u)
  return { ok: true }
}))

// =====================================================================
// Rapports et comptes-rendus
// =====================================================================
r.get('/rapports', auth('rapports.lire', async (req, res, u) => {
  const p = periode(req.query)
  const ids = req.query.agence ? u.agenceIds.filter(i => i === Number(req.query.agence)) : u.agenceIds
  const type = TYPES_VEHICULE[req.query.type] ? req.query.type : null
  const agences = await Stats.parAgence(ids, p.debut, p.fin, type)
  const top = await Stats.topConducteurs(ids, p.debut, p.fin, type, 20)
  if (exportCsv(req)) {
    assertCan(u, 'rapports.exporter')
    if (req.query.vue === 'conducteurs') {
      return sendCsv(res, 'rapport_conducteurs', [
        { label: 'Code', value: x => x.conducteur.code }, { label: 'Nom', value: x => nomComplet(x.conducteur) }, { label: 'Type', value: x => TYPES_VEHICULE[x.conducteur.type] },
        { label: 'Clients orientés', value: 'orientes' }, { label: 'Clients acheteurs', value: 'acheteurs' }, { label: 'Taux (%)', value: 'taux' }, { label: 'CA encaissé', value: 'ca' },
      ], top)
    }
    return sendCsv(res, 'rapport_agences', [
      { label: 'Agence', value: x => x.agence.nom }, { label: 'Conducteurs actifs', value: 'conducteurs_actifs' }, { label: 'Visites', value: 'visites' },
      { label: 'Clients orientés', value: 'clients_orientes' }, { label: 'Clients acheteurs', value: 'clients_acheteurs' }, { label: 'Taux (%)', value: 'taux_transformation' },
      { label: 'CA encaissé', value: 'ca' }, { label: 'Coût commissions', value: 'cout_commissions' }, { label: 'Coût / CA (%)', value: 'ratio_cout_ca' },
      { label: 'Commissions payées', value: 'commissions_payees' }, { label: 'Commissions dues', value: 'commissions_dues' },
    ], agences)
  }
  return {
    periode: p, indicateurs: await Stats.indicateurs(ids, p.debut, p.fin, type), agences, top,
    parType: await Stats.parType(ids, p.debut, p.fin), series: await Stats.seriesHebdomadaires(ids, 12, type),
  }
}))

r.get('/comptes-rendus', auth('comptes_rendus.lire', async (req, res, u) => {
  const s = scope(u, 'cr', req.query.agence)
  const w = where([[s.sql, ...s.params], ['cr.statut = ?', req.query.statut]])
  const page = await paginer(req, `SELECT cr.id, cr.agence_id, cr.semaine_debut, cr.semaine_fin, cr.statut, cr.valide_le, cr.envoye_le, cr.donnees, a.nom AS agence, u.nom AS valide_par_nom
    FROM comptes_rendus cr JOIN agences a ON a.id = cr.agence_id LEFT JOIN utilisateurs u ON u.id = cr.valide_par WHERE ${w.sql}`, w.params, 'cr.semaine_debut DESC, a.nom')
  return { ...page, rows: page.rows.map(x => { const d = parseJson(x.donnees, {}); return { ...x, donnees: undefined, visites: d.visites, acheteurs: d.clients_acheteurs, ca: d.ca } }) }
}))
r.get('/comptes-rendus/:id', auth('comptes_rendus.lire', async (req, res, u) => {
  const cr = await queryOne('SELECT cr.*, a.nom AS agence, u.nom AS valide_par_nom FROM comptes_rendus cr JOIN agences a ON a.id = cr.agence_id LEFT JOIN utilisateurs u ON u.id = cr.valide_par WHERE cr.id = ?', [recordId(req.params.id)])
  if (!cr) throw new ApiError(404, 'Compte-rendu introuvable.')
  assertAgence(u, cr.agence_id)
  return { ...cr, donnees: parseJson(cr.donnees, {}) }
}))
r.post('/comptes-rendus/generer', auth('comptes_rendus.valider', async (req, res, u) => {
  const agenceId = Number(req.body?.agence_id)
  assertAgence(u, agenceId)
  const date = validDate(req.body?.date) ? req.body.date : today()
  return { id: await CR.generer(agenceId, date) }
}))
r.post('/comptes-rendus/:id/valider', auth('comptes_rendus.valider', async (req, res, u) => {
  await CR.valider(recordId(req.params.id), u, textOrNull(req.body?.commentaire, 'Commentaire', { max: 3000 }), baseUrl(req))
  return { ok: true }
}))

// =====================================================================
// Journaux
// =====================================================================
r.get('/historique', auth('historique.lire', async (req, res, u) => {
  const s = scope(u, 'e', req.query.agence)
  const p = req.query.du || req.query.au ? periode(req.query) : null
  const q = like(req.query.q)
  const w = where([[`(${s.sql}${req.query.agence ? '' : ' OR e.agence_id IS NULL'})`, ...s.params], ['e.type = ?', req.query.type], ['e.created_at BETWEEN ? AND ?', p?.debut, p?.fin],
    ['e.libelle LIKE ?', q], ['e.conducteur_id = ?', req.query.conducteur]])
  const sql = `SELECT e.*, u.nom AS user_nom, a.nom AS agence FROM evenements e LEFT JOIN utilisateurs u ON u.id = e.user_id LEFT JOIN agences a ON a.id = e.agence_id WHERE ${w.sql}`
  if (exportCsv(req)) {
    assertCan(u, 'historique.exporter')
    return sendCsv(res, 'historique', [
      { label: 'Date', value: x => dateFr(x.created_at) }, { label: 'Type', value: x => lib(TYPES_EVENEMENT, x.type) }, { label: 'Événement', value: 'libelle' },
      { label: 'Montant', value: 'montant' }, { label: 'Agence', value: 'agence' }, { label: 'Par', value: 'user_nom' },
    ], await query(`${sql} ORDER BY e.created_at DESC, e.id DESC LIMIT 20000`, w.params))
  }
  return paginer(req, sql, w.params, 'e.created_at DESC, e.id DESC')
}))

r.get('/audit', auth('audit.lire', async (req, res, u) => {
  const p = req.query.du || req.query.au ? periode(req.query) : null
  const q = like(req.query.q)
  const w = where([['action = ?', req.query.action], ['at BETWEEN ? AND ?', p?.debut, p?.fin], ['(user_nom LIKE ? OR detail LIKE ? OR objet LIKE ?)', q, q, q]])
  const sql = `SELECT * FROM audit_log WHERE ${w.sql}`
  if (exportCsv(req)) {
    assertCan(u, 'audit.exporter')
    return sendCsv(res, 'journal_audit', [
      { label: 'Date', value: x => dateFr(x.at) }, { label: 'Utilisateur', value: 'user_nom' }, { label: 'Action', value: 'action' }, { label: 'Objet', value: 'objet' },
      { label: 'Id', value: 'objet_id' }, { label: 'Détail', value: 'detail' }, { label: 'IP', value: 'ip' },
    ], await query(`${sql} ORDER BY id DESC LIMIT 20000`, w.params))
  }
  return paginer(req, sql, w.params, 'id DESC')
}))

// =====================================================================
// Agences
// =====================================================================
r.get('/agences', auth('agences.lire', async (req, res, u) => query(`SELECT a.*, u.nom AS responsable,
    (SELECT COUNT(*) FROM conducteurs c WHERE c.agence_id = a.id AND c.statut = 'actif') AS conducteurs_actifs,
    (SELECT COUNT(*) FROM fiches_suivi f WHERE f.agence_id = a.id AND f.date_visite >= ?) AS visites_mois,
    (SELECT COUNT(*) FROM utilisateurs x JOIN agence_utilisateur au ON au.user_id = x.id WHERE au.agence_id = a.id AND x.actif = 1) AS utilisateurs
  FROM agences a LEFT JOIN utilisateurs u ON u.id = a.responsable_id WHERE a.id IN (${inList(u.agenceIds)}) ORDER BY a.nom`, [`${today().slice(0, 8)}01 00:00:00`, ...u.agenceIds])))

r.get('/agences/:id', auth('agences.lire', async (req, res, u) => {
  const id = recordId(req.params.id)
  assertAgence(u, id)
  const a = await queryOne('SELECT a.*, u.nom AS responsable FROM agences a LEFT JOIN utilisateurs u ON u.id = a.responsable_id WHERE a.id = ?', [id])
  if (!a) throw new ApiError(404, 'Agence introuvable.')
  const p = periode({})
  return {
    agence: a, indicateurs: await Stats.indicateurs([id], p.debut, p.fin),
    utilisateurs: await query('SELECT x.id, x.nom, x.email, x.role FROM utilisateurs x JOIN agence_utilisateur au ON au.user_id = x.id WHERE au.agence_id = ? ORDER BY x.nom', [id]),
    top: await Stats.topConducteurs([id], p.debut, p.fin, null, 5),
  }
}))

async function lireAgence(b) {
  const code = text(b.code, 'Code', { required: true, max: 3 }).toUpperCase()
  if (!/^[A-Z0-9]{3}$/.test(code)) throw regle('Le code agence fait exactement 3 lettres ou chiffres (ex. TNR).')
  const tel = b.telephone ? normaliserTelephone(b.telephone) : null
  if (b.telephone && !tel) throw regle('Téléphone invalide.')
  return [text(b.nom, 'Nom', { required: true, max: 150 }), code, textOrNull(b.ville, 'Ville', { max: 100 }), textOrNull(b.adresse, 'Adresse', { max: 200 }),
    tel, textOrNull(b.horaires, 'Horaires', { max: 150 }), Number(b.responsable_id) || null, b.statut === 'fermee' ? 'fermee' : 'active', textOrNull(b.odoo_nom, 'Nom Odoo', { max: 150 })]
}
r.post('/agences', auth('agences.creer', async (req, res, u) => {
  const v = await lireAgence(req.body || {})
  try {
    const ins = await execute('INSERT INTO agences (nom, code, ville, adresse, telephone, horaires, responsable_id, statut, odoo_nom, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...v, now()])
    if (v[6]) await execute('INSERT IGNORE INTO agence_utilisateur (agence_id, user_id) VALUES (?, ?)', [ins.insertId, v[6]])
    await audit(req, u, 'creer', 'agences', ins.insertId, v[0])
    return { id: ins.insertId }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'Ce code agence existe déjà.')
    throw e
  }
}))
r.put('/agences/:id', auth('agences.modifier', async (req, res, u) => {
  const id = recordId(req.params.id)
  assertAgence(u, id)
  const v = await lireAgence(req.body || {})
  const ancien = await queryOne('SELECT code FROM agences WHERE id = ?', [id])
  if (ancien && ancien.code !== v[1] && await queryOne('SELECT id FROM conducteurs WHERE agence_id = ? LIMIT 1', [id])) {
    throw regle("Le code d'une agence qui a déjà des conducteurs ne peut plus changer (il figure dans leurs codes partenaires).")
  }
  try {
    await execute('UPDATE agences SET nom = ?, code = ?, ville = ?, adresse = ?, telephone = ?, horaires = ?, responsable_id = ?, statut = ?, odoo_nom = ?, updated_at = ? WHERE id = ?', [...v, now(), id])
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'Ce code agence existe déjà.')
    throw e
  }
  if (v[6]) await execute('INSERT IGNORE INTO agence_utilisateur (agence_id, user_id) VALUES (?, ?)', [id, v[6]])
  await audit(req, u, 'modifier', 'agences', id, v[0])
  return { ok: true }
}))

// =====================================================================
// Utilisateurs, rôles, paramètres
// =====================================================================
r.get('/utilisateurs', auth('utilisateurs.lire', async () => listUsers()))
r.post('/utilisateurs', auth('utilisateurs.creer', (req, res, u) => saveUser(req, u, null)))
r.put('/utilisateurs/:id', auth('utilisateurs.modifier', (req, res, u) => saveUser(req, u, req.params.id)))

r.get('/roles', auth('roles.lire', async () => ({ roles: await roles(), modules: REFERENTIELS.MODULES, actions: REFERENTIELS.ACTIONS })))
r.post('/roles', auth('roles.modifier', (req, res, u) => saveRole(req, u, null)))
r.put('/roles/:cle', auth('roles.modifier', (req, res, u) => saveRole(req, u, req.params.cle)))

r.get('/parametres', auth('parametres.lire', async () => ({
  parametres: await P.pourAffichage(),
  baremes: await query('SELECT * FROM baremes ORDER BY rang'),
  produits: await query('SELECT * FROM produits ORDER BY niveau, nom'),
  modeles: await query('SELECT * FROM modeles_email ORDER BY libelle'),
  smtp: mailConfigure(),
})))
r.put('/parametres', auth('parametres.modifier', async (req, res, u) => {
  const valeurs = req.body?.valeurs || {}
  for (const [k, v] of Object.entries(valeurs)) {
    const def = P.DEFAUTS[k]
    if (!def || def[2] === 'interne') continue
    if (def[1] === 'secret' && !v) continue // champ laissé vide : on garde la clé enregistrée
    if (def[1] === 'entier' && (!Number.isInteger(Number(v)) || Number(v) < 0)) throw regle(`${def[3]} : nombre entier attendu.`)
    if (k === 'jour_paiement' && (Number(v) < 1 || Number(v) > 7)) throw regle('Jour de paiement : de 1 (lundi) à 7 (dimanche).')
    await P.set(k, def[1] === 'booleen' ? !!v : v)
  }
  await audit(req, u, 'modifier', 'parametres', '', Object.keys(valeurs).join(', '))
  return { ok: true }
}))
r.put('/baremes', auth('parametres.modifier', async (req, res, u) => {
  for (const b of req.body?.baremes || []) {
    const m = Number(b.montant)
    if (!NIVEAUX[b.niveau] || !Number.isInteger(m) || m < 0) throw regle('Montant de barème invalide.')
    await execute('UPDATE baremes SET montant = ?, libelle = ? WHERE niveau = ?', [m, text(b.libelle, 'Libellé', { required: true, max: 150 }), b.niveau])
  }
  await audit(req, u, 'modifier', 'baremes', '', 'Barème modifié')
  return { ok: true }
}))
r.post('/produits', auth('parametres.modifier', async (req, res, u) => {
  const b = req.body || {}
  const vals = [text(b.nom, 'Nom', { required: true, max: 150 }), textOrNull(b.reference, 'Référence', { max: 100 }), Number(b.odoo_produit_id) || null,
    Number(b.odoo_categorie_id) || null, oneOf(b.niveau, NIVEAUX_PRODUIT, 'Niveau'), b.actif === false ? 0 : 1]
  if (b.id) await execute('UPDATE produits SET nom = ?, reference = ?, odoo_produit_id = ?, odoo_categorie_id = ?, niveau = ?, actif = ? WHERE id = ?', [...vals, recordId(b.id)])
  else await execute('INSERT INTO produits (nom, reference, odoo_produit_id, odoo_categorie_id, niveau, actif) VALUES (?, ?, ?, ?, ?, ?)', vals)
  await audit(req, u, b.id ? 'modifier' : 'creer', 'produits', b.id || '', vals[0])
  return { ok: true }
}))
r.delete('/produits/:id', auth('parametres.modifier', async (req, res, u) => {
  await execute('DELETE FROM produits WHERE id = ?', [recordId(req.params.id)])
  await audit(req, u, 'supprimer', 'produits', req.params.id)
  return { ok: true }
}))
r.put('/modeles-email/:cle', auth('parametres.modifier', async (req, res, u) => {
  await execute('UPDATE modeles_email SET sujet = ?, corps = ? WHERE cle = ?',
    [text(req.body?.sujet, 'Sujet', { required: true, max: 250 }), text(req.body?.corps, 'Texte', { required: true, max: 5000 }), req.params.cle])
  await audit(req, u, 'modifier', 'modeles_email', req.params.cle)
  return { ok: true }
}))
r.post('/mail/test', auth('parametres.modifier', async (req, res, u) => {
  try { await envoyerTest(req.body?.to || u.email) } catch (e) { throw new ApiError(502, e.message) }
  return { ok: true }
}))

// =====================================================================
// Recherche globale
// =====================================================================
r.get('/recherche', auth(null, async (req, res, u) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return []
  const l = `%${q}%`
  const tel = normaliserTelephone(q)
  const out = []
  const s = ids => inList(ids)
  if (can(u, 'conducteurs.lire')) {
    for (const c of await query(`SELECT id, code, nom, prenom FROM conducteurs WHERE agence_id IN (${s(u.agenceIds)}) AND (code LIKE ? OR nom LIKE ? OR telephone = ?) LIMIT 5`, [...u.agenceIds, l, l, tel || '§'])) {
      out.push({ type: 'Conducteur', label: `${c.code} — ${nomComplet(c)}`, lien: `/conducteurs/${c.id}` })
    }
  }
  if (can(u, 'clients.lire')) {
    for (const c of await query(`SELECT id, nom, prenom, telephone FROM clients WHERE agence_id IN (${s(u.agenceIds)}) AND (nom LIKE ? OR prenom LIKE ? OR telephone = ?) LIMIT 5`, [...u.agenceIds, l, l, tel || '§'])) {
      out.push({ type: 'Client', label: `${nomComplet(c)} — ${afficherTelephone(c.telephone)}`, lien: `/clients/${c.id}` })
    }
  }
  if (can(u, 'fiches.lire')) {
    for (const f of await query(`SELECT id, numero FROM fiches_suivi WHERE agence_id IN (${s(u.agenceIds)}) AND numero LIKE ? LIMIT 5`, [...u.agenceIds, l])) {
      out.push({ type: 'Fiche', label: f.numero, lien: `/fiches/${f.id}` })
    }
  }
  return out
}))

// =====================================================================
// Documents imprimables
// =====================================================================
const html = fn => auth(null, async (req, res, u) => {
  res.set('content-type', 'text/html; charset=utf-8')
  res.send(await fn(req, u))
})
r.get('/documents/conducteurs/:id/carte', html((req, u) => { assertCan(u, 'conducteurs.lire'); return Docs.carte(recordId(req.params.id), u) }))
r.get('/documents/conducteurs/:id/charte', html((req, u) => { assertCan(u, 'conducteurs.lire'); return Docs.charte(recordId(req.params.id), u) }))
r.get('/documents/paiements/:id/recu', html((req, u) => { assertCan(u, 'paiements.lire'); return Docs.recu(recordId(req.params.id), u) }))
r.get('/documents/fiche-papier', html((req, u) => { assertCan(u, 'fiches.creer'); return Docs.fichePapier() }))
r.get('/documents/comptes-rendus/:id', html((req, u) => { assertCan(u, 'comptes_rendus.lire'); return Docs.compteRendu(recordId(req.params.id), u) }))

export default r
