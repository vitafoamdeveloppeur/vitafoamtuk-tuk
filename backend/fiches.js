/**
 * Circuit d'une visite :
 * Conducteur → saisie du client → contrôle doublon → fiche enregistrée → visite validée par le Responsable.
 */
import { query, queryOne, execute, transaction } from './db.js'
import { ApiError, regle, now, today, addDays, addMonths, dateFr, normaliserTelephone } from './util.js'
import { STATUTS_CONDUCTEUR, STATUTS_FICHE, lib } from './ref.js'
import * as P from './parametres.js'
import { evenement, liensFiche } from './journal.js'
import { numeroFiche } from './numerotation.js'
import * as Commissions from './commissions.js'
import * as Alertes from './alertes.js'
import { estEncaissee, estAnnulee, estFacture } from './ventes-utils.js'

const nomComplet = x => [x?.nom, x?.prenom].filter(Boolean).join(' ')
const attributionActive = (client, a = now()) => !!(client.conducteur_id && client.attribution_fin && `${client.attribution_fin} 23:59:59` >= a)

/** Résultat du contrôle doublon pour un téléphone (affiché pendant la saisie) */
export async function controleDoublon(telephone, conducteurId) {
  const tel = normaliserTelephone(telephone)
  if (!tel) return null
  const client = await queryOne(`SELECT cl.*, c.code AS conducteur_code, c.nom AS conducteur_nom, c.prenom AS conducteur_prenom
    FROM clients cl LEFT JOIN conducteurs c ON c.id = cl.conducteur_id WHERE cl.telephone = ?`, [tel])
  if (!client) return { niveau: 'ok', message: 'Nouveau client : il sera attribué à ce conducteur.', client: null }
  const resume = { id: client.id, nom: client.nom, prenom: client.prenom, quartier: client.quartier }
  if (attributionActive(client)) {
    if (conducteurId && client.conducteur_id === Number(conducteurId)) {
      return { niveau: 'info', message: `Client déjà amené par ce conducteur (attribution jusqu'au ${dateFr(client.attribution_fin)}) : pas de nouvelle rémunération de visite.`, client: resume }
    }
    return { niveau: 'doublon', message: `DOUBLON : client déjà attribué à ${client.conducteur_code} ${[client.conducteur_nom, client.conducteur_prenom].filter(Boolean).join(' ')} jusqu'au ${dateFr(client.attribution_fin)}. Aucune commission pour ce conducteur.`, client: resume }
  }
  return { niveau: 'info', message: 'Client déjà connu, sans attribution en cours : il sera attribué à ce conducteur.', client: resume }
}

/** Enregistre une fiche de suivi */
export async function creer(d, user) {
  const conducteur = await queryOne('SELECT * FROM conducteurs WHERE id = ?', [Number(d.conducteur_id) || 0])
  if (!conducteur) throw regle('Code conducteur inconnu.')
  if (conducteur.statut !== 'actif') throw regle(`Conducteur ${conducteur.code} ${lib(STATUTS_CONDUCTEUR, conducteur.statut).toLowerCase()} : la visite ne peut pas être enregistrée.`)
  const agenceId = Number(d.agence_id || conducteur.agence_id)
  if (!user.agenceIds.includes(agenceId)) throw regle("Vous n'avez pas accès à cette agence.")
  const tel = normaliserTelephone(d.telephone)
  if (!tel) throw regle('Numéro de téléphone du client invalide (format malgache attendu, ex. 034 12 345 67).')
  const nom = String(d.nom || '').trim()
  if (!nom) throw regle('Nom du client obligatoire.')
  if (!['demande_prix', 'achat'].includes(d.motif)) throw regle('Motif de visite invalide.')
  const produits = (Array.isArray(d.produits_interet) ? d.produits_interet : []).filter(p => ['entree_gamme', 'coussins', 'haut_gamme'].includes(p))

  let dateVisite = now()
  if (d.saisie_papier) {
    if (!d.numero_fiche_papier) throw regle('Indiquez le n° de la fiche papier.')
    if (!d.date_visite) throw regle('Indiquez la date de visite de la fiche papier.')
    dateVisite = String(d.date_visite).replace('T', ' ').slice(0, 16) + ':00'
    if (dateVisite > now() || dateVisite < `${addDays(today(), -7)} 00:00:00`) throw regle('Ressaisie de fiche papier : la date de visite doit être comprise dans les 7 derniers jours.')
  }
  const jour = dateVisite.slice(0, 10)
  const mois = await P.entier('attribution_mois')
  const delai = await P.entier('delai_achat_jours')
  let nouveauClient = false

  const fiche = await transaction(async conn => {
    let client = await queryOne('SELECT * FROM clients WHERE telephone = ? FOR UPDATE', [tel], conn)
    if (client) {
      const existante = await queryOne(`SELECT numero FROM fiches_suivi WHERE client_id = ? AND conducteur_id = ? AND DATE(date_visite) = ? AND statut <> 'rejetee'`,
        [client.id, conducteur.id, jour], conn)
      if (existante) throw regle(`Double saisie : une fiche existe déjà ce jour pour ce client et ce conducteur (${existante.numero}).`)
    }
    let doublon = false
    let motifDoublon = null
    if (!client) {
      nouveauClient = true
      const r = await execute(`INSERT INTO clients (nom, prenom, telephone, quartier, agence_id, conducteur_id, attribue_le, attribution_fin, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [nom.slice(0, 100), String(d.prenom || '').trim().slice(0, 100) || null, tel, String(d.quartier || '').trim().slice(0, 100) || null,
        agenceId, conducteur.id, jour, addMonths(jour, mois), now()], conn)
      client = await queryOne('SELECT * FROM clients WHERE id = ?', [r.insertId], conn)
    } else if (attributionActive(client, dateVisite)) {
      if (client.conducteur_id !== conducteur.id) {
        const proprio = await queryOne('SELECT code FROM conducteurs WHERE id = ?', [client.conducteur_id], conn)
        doublon = true
        motifDoublon = `Client déjà attribué à ${proprio.code} jusqu'au ${dateFr(client.attribution_fin)}`
      }
    } else {
      // Pas d'attribution en cours : le client est attribué à ce conducteur pour la durée réglée
      await execute('UPDATE clients SET conducteur_id = ?, attribue_le = ?, attribution_fin = ?, quartier = COALESCE(quartier, ?), updated_at = ? WHERE id = ?',
        [conducteur.id, jour, addMonths(jour, mois), String(d.quartier || '').trim() || null, now(), client.id], conn)
    }
    const agence = await queryOne('SELECT * FROM agences WHERE id = ?', [agenceId], conn)
    const numero = await numeroFiche(conn, agence)
    const r = await execute(`INSERT INTO fiches_suivi (numero, agence_id, conducteur_id, client_id, conseiller_id, saisi_par, motif, produits_interet, remarque,
        statut, date_visite, date_limite, est_doublon, motif_doublon, saisie_papier, numero_fiche_papier, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'enregistree', ?, ?, ?, ?, ?, ?, ?)`, [numero, agenceId, conducteur.id, client.id, Number(d.conseiller_id) || null, user.id,
      d.motif, JSON.stringify(produits), String(d.remarque || '').slice(0, 500) || null, dateVisite, addDays(jour, delai), doublon ? 1 : 0, motifDoublon,
      d.saisie_papier ? 1 : 0, d.saisie_papier ? String(d.numero_fiche_papier).slice(0, 30) : null, now()], conn)
    const f = await queryOne('SELECT * FROM fiches_suivi WHERE id = ?', [r.insertId], conn)
    await evenement('visite', 'creation', `Fiche ${f.numero} enregistrée : ${nomComplet(client)} amené par ${conducteur.code}${f.saisie_papier ? ` (ressaisie fiche papier ${f.numero_fiche_papier || ''})` : ''}`, liensFiche(f, user.id), null, conn)
    if (doublon) await evenement('visite', 'doublon', `Doublon signalé : ${motifDoublon}`, liensFiche(f, user.id), null, conn)
    return f
  })

  if (fiche.est_doublon) await Alertes.clientDoublon(fiche)
  await Alertes.verifierVisitesDuJour(conducteur, jour)
  // Envoi du client vers Odoo en arrière-plan (nouvel essai à chaque synchronisation en cas d'échec)
  const client = await queryOne('SELECT id, odoo_statut FROM clients WHERE id = ?', [fiche.client_id])
  if (nouveauClient || client.odoo_statut !== 'synchronise') {
    import('./odoo.js').then(o => o.envoyerClientSiActif(client.id, fiche.id)).catch(e => console.error('[odoo]', e.message))
  }
  return fiche
}

async function chargerPourMaj(id, user, conn) {
  const f = await queryOne('SELECT * FROM fiches_suivi WHERE id = ? FOR UPDATE', [id], conn)
  if (!f) throw new ApiError(404, 'Fiche introuvable.')
  if (!user.agenceIds.includes(f.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à cette agence.")
  return f
}

/** Validation de la visite par le Responsable */
export async function valider(id, user) {
  let recalcul = null
  await transaction(async conn => {
    const f = await chargerPourMaj(id, user, conn)
    if (f.statut !== 'enregistree') throw regle(`La fiche ${f.numero} n'est pas en attente de validation.`)
    if (f.saisi_par === user.id && await P.get('separation_saisie_validation')) throw regle(`Séparation des tâches : vous avez saisi la fiche ${f.numero}, un autre responsable doit la valider.`)
    await execute("UPDATE fiches_suivi SET statut = 'visite_validee', valide_par = ?, valide_le = ?, updated_at = ? WHERE id = ?", [user.id, now(), now(), f.id], conn)
    await evenement('visite', 'validation', `Visite ${f.numero} validée`, liensFiche(f, user.id), null, conn)
    const client = await queryOne('SELECT conducteur_id FROM clients WHERE id = ?', [f.client_id], conn)
    if (f.est_doublon || client.conducteur_id !== f.conducteur_id) await Commissions.refuserClientAutreConducteur(f, conn)
    else recalcul = f.client_id
  })
  await majStatutDepuisVentes(id)
  if (recalcul) await Commissions.recalculerClient(recalcul)
}

export async function validerGroupe(ids, user) {
  let ok = 0
  const erreurs = []
  for (const id of ids) {
    try { await valider(Number(id), user); ok++ } catch (e) { erreurs.push(e.message) }
  }
  return { ok, erreurs }
}

export async function rejeter(id, user, motif) {
  if (!motif) throw regle('Indiquez le motif du rejet.')
  await transaction(async conn => {
    const f = await chargerPourMaj(id, user, conn)
    if (f.statut !== 'enregistree') throw regle(`Seule une fiche « enregistrée » peut être rejetée (${f.numero} : ${lib(STATUTS_FICHE, f.statut)}).`)
    await execute("UPDATE fiches_suivi SET statut = 'rejetee', motif_rejet = ?, valide_par = ?, valide_le = ?, updated_at = ? WHERE id = ?", [motif.slice(0, 250), user.id, now(), now(), f.id], conn)
    await evenement('visite', 'rejet', `Visite ${f.numero} rejetée : ${motif}`, liensFiche(f, user.id), null, conn)
    // Si cette fiche était la seule à justifier l'attribution, le client redevient libre
    const client = await queryOne('SELECT * FROM clients WHERE id = ? FOR UPDATE', [f.client_id], conn)
    if (client.conducteur_id === f.conducteur_id && client.attribue_le) {
      const autres = await queryOne(`SELECT id FROM fiches_suivi WHERE client_id = ? AND conducteur_id = ? AND id <> ? AND statut <> 'rejetee' AND date_visite >= ? LIMIT 1`,
        [client.id, f.conducteur_id, f.id, `${client.attribue_le} 00:00:00`], conn)
      if (!autres) {
        await execute('UPDATE clients SET conducteur_id = NULL, attribue_le = NULL, attribution_fin = NULL, updated_at = ? WHERE id = ?', [now(), client.id], conn)
        await evenement('visite', 'attribution', `Attribution du client ${nomComplet(client)} levée suite au rejet`, liensFiche(f), null, conn)
      }
    }
  })
}

/** Statut d'une fiche selon les ventes Odoo rattachées (seules les ventes dans le délai font avancer la fiche) */
export async function majStatutDepuisVentes(ficheId) {
  const f = await queryOne('SELECT * FROM fiches_suivi WHERE id = ?', [ficheId])
  if (!f || ['enregistree', 'rejetee'].includes(f.statut)) return
  const ventes = (await query('SELECT * FROM ventes WHERE fiche_suivi_id = ?', [f.id])).filter(v => !v.date_document || v.date_document <= f.date_limite)
  let statut = 'visite_validee'
  if (ventes.length) {
    const actives = ventes.filter(v => !estAnnulee(v))
    if (actives.some(estEncaissee)) statut = 'encaissee'
    else if (actives.some(v => estFacture(v) && v.type === 'facture' && v.etat === 'posted')) statut = 'facturee'
    else if (actives.some(v => !estFacture(v) && ['sale', 'done'].includes(v.etat))) statut = 'commande'
    else if (actives.some(v => !estFacture(v) && ['draft', 'sent'].includes(v.etat))) statut = 'devis'
    else if (!actives.length) statut = 'annulee'
  }
  if (['visite_validee', 'devis', 'commande'].includes(statut) && f.date_limite < today()) statut = 'expiree'
  if (statut !== f.statut) {
    await execute('UPDATE fiches_suivi SET statut = ?, updated_at = ? WHERE id = ?', [statut, now(), f.id])
    await evenement('visite', 'statut', `Fiche ${f.numero} : statut passé de « ${lib(STATUTS_FICHE, f.statut)} » à « ${STATUTS_FICHE[statut]} »`, liensFiche(f))
  }
}

/** Expiration des fiches sans facture après le délai (tâche quotidienne) */
export async function expirer() {
  const rows = await query("SELECT * FROM fiches_suivi WHERE statut IN ('visite_validee','devis','commande') AND date_limite < ?", [today()])
  for (const f of rows) {
    await execute("UPDATE fiches_suivi SET statut = 'expiree', updated_at = ? WHERE id = ?", [now(), f.id])
    await evenement('visite', 'expiration', `Fiche ${f.numero} expirée : aucun achat dans le délai`, liensFiche(f))
  }
  return rows.length
}
