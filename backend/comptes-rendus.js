/** Compte-rendu hebdomadaire automatique par agence (du lundi au dimanche) */
import { query, queryOne, execute } from './db.js'
import { ApiError, regle, now, today, addDays, mondayOf, dateFr, ariary, parseJson } from './util.js'
import { STATUTS_COMMISSION_ACTIFS } from './ref.js'
import * as Stats from './stats.js'
import * as P from './parametres.js'
import { envoyerModele } from './mail.js'
import { responsablesAgence, utilisateursRole } from './auth.js'

const n = v => Number(v) || 0

export async function generer(agenceId, dateDansSemaine) {
  const lundi = mondayOf(dateDansSemaine)
  const dim = addDays(lundi, 6)
  const debut = `${lundi} 00:00:00`
  const fin = `${dim} 23:59:59`
  const ind = await Stats.indicateurs([agenceId], debut, fin)
  const c = async (sql, p) => n((await queryOne(sql, p)).n)
  const donnees = {
    ...ind,
    nouveaux_conducteurs: await c('SELECT COUNT(*) AS n FROM conducteurs WHERE agence_id = ? AND created_at BETWEEN ? AND ?', [agenceId, debut, fin]),
    visites_validees: await c("SELECT COUNT(*) AS n FROM fiches_suivi WHERE agence_id = ? AND valide_le BETWEEN ? AND ? AND statut <> 'rejetee'", [agenceId, debut, fin]),
    visites_rejetees: await c("SELECT COUNT(*) AS n FROM fiches_suivi WHERE agence_id = ? AND valide_le BETWEEN ? AND ? AND statut = 'rejetee'", [agenceId, debut, fin]),
    doublons: await c('SELECT COUNT(*) AS n FROM fiches_suivi WHERE agence_id = ? AND date_visite BETWEEN ? AND ? AND est_doublon = 1', [agenceId, debut, fin]),
    commissions_generees: n((await queryOne(`SELECT SUM(montant) AS n FROM commissions WHERE agence_id = ? AND created_at BETWEEN ? AND ? AND statut IN (${STATUTS_COMMISSION_ACTIFS.map(() => '?').join(',')})`,
      [agenceId, debut, fin, ...STATUTS_COMMISSION_ACTIFS])).n),
    alertes: await c('SELECT COUNT(*) AS n FROM alertes WHERE agence_id = ? AND created_at BETWEEN ? AND ?', [agenceId, debut, fin]),
    top: (await Stats.topConducteurs([agenceId], debut, fin, null, 5)).map(l => ({
      code: l.conducteur.code, nom: [l.conducteur.nom, l.conducteur.prenom].filter(Boolean).join(' '), orientes: l.orientes, acheteurs: l.acheteurs, ca: l.ca,
    })),
    par_type: Object.fromEntries(Object.entries(await Stats.parType([agenceId], debut, fin)).map(([t, i]) => [t, { orientes: i.clients_orientes, acheteurs: i.clients_acheteurs, ca: i.ca }])),
  }
  const existant = await queryOne('SELECT id, statut FROM comptes_rendus WHERE agence_id = ? AND semaine_debut = ?', [agenceId, lundi])
  if (existant && existant.statut !== 'brouillon') return existant.id // déjà validé : on ne réécrit pas
  if (existant) {
    await execute('UPDATE comptes_rendus SET donnees = ?, updated_at = ? WHERE id = ?', [JSON.stringify(donnees), now(), existant.id])
    return existant.id
  }
  const r = await execute("INSERT INTO comptes_rendus (agence_id, semaine_debut, semaine_fin, donnees, statut, created_at) VALUES (?, ?, ?, ?, 'brouillon', ?)",
    [agenceId, lundi, dim, JSON.stringify(donnees), now()])
  return r.insertId
}

/** Génère les comptes-rendus de la semaine écoulée pour toutes les agences actives (lundi matin) */
export async function genererSemaineEcoulee() {
  const jour = addDays(today(), -7)
  const agences = await query("SELECT id, nom FROM agences WHERE statut = 'active'")
  for (const a of agences) {
    const id = await generer(a.id, jour)
    const cr = await queryOne('SELECT statut, semaine_debut FROM comptes_rendus WHERE id = ?', [id])
    if (cr.statut === 'brouillon') {
      const dest = await responsablesAgence(a.id, 'compte_rendu')
      await envoyerModele('compte_rendu_a_valider', dest.map(u => u.email), { agence: a.nom, semaine: dateFr(cr.semaine_debut) })
    }
  }
  return agences.length
}

/** Relecture, commentaire et validation par le Responsable, puis envoi à la Direction */
export async function valider(id, user, commentaire, baseUrl) {
  const cr = await queryOne('SELECT * FROM comptes_rendus WHERE id = ?', [id])
  if (!cr) throw new ApiError(404, 'Compte-rendu introuvable.')
  if (!user.agenceIds.includes(cr.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à cette agence.")
  if (cr.statut !== 'brouillon') throw regle('Ce compte-rendu est déjà validé.')
  await execute("UPDATE comptes_rendus SET commentaire = ?, statut = 'valide', valide_par = ?, valide_le = ?, updated_at = ? WHERE id = ?",
    [commentaire || null, user.id, now(), now(), id])
  await envoyer(id, baseUrl)
}

export async function envoyer(id, baseUrl = '') {
  const cr = await queryOne('SELECT cr.*, a.nom AS agence FROM comptes_rendus cr JOIN agences a ON a.id = cr.agence_id WHERE cr.id = ?', [id])
  const d = parseJson(cr.donnees, {})
  const direction = await utilisateursRole(['direction'], 'compte_rendu')
  const autres = String(await P.get('emails_direction') || '').split(',').map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  await envoyerModele('compte_rendu', [...direction.map(u => u.email), ...autres], {
    agence: cr.agence, semaine: dateFr(cr.semaine_debut), orientes: d.clients_orientes, acheteurs: d.clients_acheteurs, ca: ariary(d.ca),
    commentaire: cr.commentaire || '—', lien: `${baseUrl}/comptes-rendus/${cr.id}`,
  })
  await execute("UPDATE comptes_rendus SET statut = 'envoye', envoye_le = ? WHERE id = ?", [now(), id])
}
