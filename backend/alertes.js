/** Contrôles anti-abus et alertes au Responsable */
import { query, queryOne, execute, transaction } from './db.js'
import { ApiError, regle, now, today, addDays, dateFr, isoWeek } from './util.js'
import { TYPES_ALERTE, lib } from './ref.js'
import * as P from './parametres.js'
import { evenement } from './journal.js'
import { envoyerModele } from './mail.js'
import { responsablesAgence, utilisateursRole } from './auth.js'

export async function creer(d, userId = null) {
  let id
  try {
    const r = await execute(`INSERT INTO alertes (type, gravite, agence_id, conducteur_id, client_id, fiche_suivi_id, message, donnees, cle_unicite, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [d.type, d.gravite || 'moyenne', d.agence_id ?? null, d.conducteur_id ?? null, d.client_id ?? null,
      d.fiche_suivi_id ?? null, String(d.message).slice(0, 500), d.donnees ? JSON.stringify(d.donnees) : null, d.cle_unicite ?? null, now()])
    id = r.insertId
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return null // alerte déjà levée
    throw e
  }
  await evenement('alerte', 'creation', `Alerte : ${d.message}`, { ...d, user_id: userId })
  notifier(d).catch(e => console.error('[alerte mail]', e.message))
  return id
}

async function notifier(d) {
  const dest = d.agence_id ? await responsablesAgence(d.agence_id, 'alertes') : await utilisateursRole(['super-admin', 'direction'], 'alertes')
  const agence = d.agence_id ? await queryOne('SELECT nom FROM agences WHERE id = ?', [d.agence_id]) : null
  await envoyerModele('alerte', dest.map(u => u.email), { type: lib(TYPES_ALERTE, d.type), message: d.message, agence: agence?.nom || 'toutes' })
}

/** Alerte au-delà de N visites par jour pour un même conducteur */
export async function verifierVisitesDuJour(conducteur, jour) {
  const seuil = await P.entier('alerte_visites_jour')
  const nb = Number((await queryOne('SELECT COUNT(*) AS n FROM fiches_suivi WHERE conducteur_id = ? AND DATE(date_visite) = ?', [conducteur.id, jour])).n)
  if (nb > seuil) {
    await creer({
      type: 'visites_excessives', gravite: 'haute', agence_id: conducteur.agence_id, conducteur_id: conducteur.id,
      message: `${conducteur.code} : ${nb} visites le ${dateFr(jour)} (seuil : ${seuil})`, donnees: { nb, seuil, jour },
      cle_unicite: `visites:${conducteur.id}:${jour}`,
    })
  }
}

/** Alerte si le taux de transformation est inférieur au seuil sur la période (tâche quotidienne) */
export async function verifierTauxTransformation() {
  const jours = await P.entier('alerte_taux_jours')
  const seuil = Number(await P.get('alerte_taux_min'))
  const minVisites = await P.entier('alerte_taux_min_visites')
  const stats = await query(`SELECT conducteur_id, COUNT(DISTINCT client_id) AS orientes,
      COUNT(DISTINCT CASE WHEN statut IN ('facturee','encaissee') THEN client_id END) AS acheteurs
    FROM fiches_suivi WHERE date_visite >= ? AND statut <> 'rejetee' GROUP BY conducteur_id`, [`${addDays(today(), -jours)} 00:00:00`])
  let n = 0
  for (const s of stats) {
    const orientes = Number(s.orientes)
    const acheteurs = Number(s.acheteurs)
    if (orientes < minVisites) continue
    const taux = Math.round((acheteurs * 1000) / orientes) / 10
    if (taux >= seuil) continue
    const c = await queryOne('SELECT * FROM conducteurs WHERE id = ?', [s.conducteur_id])
    if (!c || c.statut !== 'actif') continue
    const id = await creer({
      type: 'taux_transformation', gravite: 'moyenne', agence_id: c.agence_id, conducteur_id: c.id,
      message: `${c.code} : taux de transformation de ${taux} % sur ${jours} jours (${acheteurs} acheteur(s) / ${orientes} client(s) orienté(s), seuil ${seuil} %)`,
      donnees: { taux, orientes, acheteurs }, cle_unicite: `taux:${c.id}:${isoWeek(today())}`,
    })
    if (id) n++
  }
  return n
}

export async function clientDoublon(fiche) {
  const c = await queryOne('SELECT code FROM conducteurs WHERE id = ?', [fiche.conducteur_id])
  const cl = await queryOne('SELECT nom, prenom FROM clients WHERE id = ?', [fiche.client_id])
  await creer({
    type: 'client_doublon', gravite: 'moyenne', agence_id: fiche.agence_id, conducteur_id: fiche.conducteur_id,
    client_id: fiche.client_id, fiche_suivi_id: fiche.id,
    message: `Fiche ${fiche.numero} : ${c.code} a présenté ${[cl.nom, cl.prenom].filter(Boolean).join(' ')}. ${fiche.motif_doublon}.`,
    cle_unicite: `doublon:${fiche.id}`,
  })
}

export async function erreurOdoo(message) {
  await creer({ type: 'odoo', gravite: 'haute', message: `Synchronisation Odoo en échec : ${String(message).slice(0, 200)}`, cle_unicite: `odoo:${now().slice(0, 13)}` })
}

export async function bloquerCommissions(conducteur, bloquer, userId, conn) {
  await execute('UPDATE conducteurs SET commissions_bloquees = ?, updated_at = ? WHERE id = ?', [bloquer ? 1 : 0, now(), conducteur.id], conn)
  if (bloquer) {
    await execute(`UPDATE commissions SET statut = 'bloquee', motif = 'Bloquée suite à une alerte' WHERE conducteur_id = ?
      AND statut IN ('a_valider','validee') AND paiement_id IS NULL AND montant > 0`, [conducteur.id], conn)
  } else {
    await execute(`UPDATE commissions SET statut = 'a_valider', motif = NULL, valide_par = NULL, valide_le = NULL WHERE conducteur_id = ? AND statut = 'bloquee'`, [conducteur.id], conn)
  }
  await evenement('conducteur', bloquer ? 'blocage' : 'deblocage', `Commissions de ${conducteur.code} ${bloquer ? 'bloquées' : 'débloquées'}`,
    { agence_id: conducteur.agence_id, conducteur_id: conducteur.id, user_id: userId }, null, conn)
}

export const libelleAction = a => ({ suspension: 'suspension du conducteur', blocage_commissions: 'blocage des commissions', deblocage_commissions: 'déblocage des commissions' }[a] || 'commentaire')

/** Traitement d'une alerte : commentaire, suspension du conducteur, blocage ou déblocage des commissions */
export async function traiter(id, action, commentaire, user) {
  if (!['commentaire', 'suspension', 'blocage_commissions', 'deblocage_commissions'].includes(action)) throw regle('Action inconnue.')
  return transaction(async conn => {
    const a = await queryOne('SELECT * FROM alertes WHERE id = ? FOR UPDATE', [id], conn)
    if (!a) throw new ApiError(404, 'Alerte introuvable.')
    if (a.agence_id && !user.agenceIds.includes(a.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à cette agence.")
    const c = a.conducteur_id ? await queryOne('SELECT * FROM conducteurs WHERE id = ?', [a.conducteur_id], conn) : null
    if (action !== 'commentaire' && !c) throw regle('Cette alerte ne concerne pas un conducteur.')
    if (action === 'suspension') {
      await execute("UPDATE conducteurs SET statut = 'suspendu', motif_statut = ?, updated_at = ? WHERE id = ?", [`Alerte : ${a.message}`.slice(0, 250), now(), c.id], conn)
      await evenement('conducteur', 'suspension', `${c.code} suspendu suite à une alerte`, { agence_id: c.agence_id, conducteur_id: c.id, user_id: user.id }, null, conn)
    } else if (action === 'blocage_commissions') await bloquerCommissions(c, true, user.id, conn)
    else if (action === 'deblocage_commissions') await bloquerCommissions(c, false, user.id, conn)
    await execute("UPDATE alertes SET statut = 'traitee', action = ?, commentaire = ?, traitee_par = ?, traitee_le = ? WHERE id = ?",
      [action, commentaire || null, user.id, now(), id], conn)
    await evenement('alerte', 'traitement', `Alerte traitée (${libelleAction(action)}) : ${a.message}`,
      { agence_id: a.agence_id, conducteur_id: a.conducteur_id, client_id: a.client_id, fiche_suivi_id: a.fiche_suivi_id, user_id: user.id }, null, conn)
  })
}
