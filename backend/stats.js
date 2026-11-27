/**
 * Indicateurs du tableau de bord, du compte-rendu hebdomadaire et des rapports.
 * agenceIds : agences prises en compte (déjà filtrées selon les droits). type : null, 'tuktuk' ou 'cyclo'.
 */
import { query, queryOne, inList } from './db.js'
import { today, addDays, mondayOf } from './util.js'
import { STATUTS_COMMISSION_ACTIFS } from './ref.js'

const n = v => Number(v) || 0
const sActifs = inList(STATUTS_COMMISSION_ACTIFS)

function filtreFiches(agenceIds, debut, fin, type) {
  return {
    join: type ? 'JOIN conducteurs ct ON ct.id = f.conducteur_id' : '',
    where: `f.agence_id IN (${inList(agenceIds)}) AND f.date_visite BETWEEN ? AND ? AND f.statut <> 'rejetee'${type ? ' AND ct.type = ?' : ''}`,
    params: [...agenceIds, debut, fin, ...(type ? [type] : [])],
  }
}
function filtreVentes(agenceIds, debut, fin, type) {
  return {
    join: `JOIN fiches_suivi f ON f.id = v.fiche_suivi_id${type ? ' JOIN conducteurs ct ON ct.id = f.conducteur_id' : ''}`,
    where: `v.agence_id IN (${inList(agenceIds)}) AND v.odoo_modele = 'account.move' AND v.type = 'facture' AND v.etat = 'posted' AND v.etat_paiement = 'paid'
      AND v.date_document BETWEEN ? AND ?${type ? ' AND ct.type = ?' : ''}`,
    params: [...agenceIds, debut.slice(0, 10), fin.slice(0, 10), ...(type ? [type] : [])],
  }
}
const typeComm = type => (type ? ' AND c.conducteur_id IN (SELECT id FROM conducteurs WHERE type = ?)' : '')

export async function indicateurs(agenceIds, debut, fin, type = null) {
  const F = filtreFiches(agenceIds, debut, fin, type)
  const fi = await queryOne(`SELECT COUNT(*) AS visites, COUNT(DISTINCT f.client_id) AS orientes,
      COUNT(DISTINCT CASE WHEN f.statut IN ('facturee','encaissee') THEN f.client_id END) AS acheteurs
    FROM fiches_suivi f ${F.join} WHERE ${F.where}`, F.params)
  const V = filtreVentes(agenceIds, debut, fin, type)
  const ca = n((await queryOne(`SELECT SUM(v.montant_total) AS ca FROM ventes v ${V.join} WHERE ${V.where}`, V.params)).ca)
  const tp = type ? [type] : []
  const dues = n((await queryOne(`SELECT SUM(c.montant) AS s FROM commissions c WHERE c.agence_id IN (${inList(agenceIds)}) AND c.statut IN ('a_valider','validee','bloquee')${typeComm(type)}`, [...agenceIds, ...tp])).s)
  const payees = n((await queryOne(`SELECT SUM(p.montant_net) AS s FROM paiements p WHERE p.agence_id IN (${inList(agenceIds)}) AND p.paye_le BETWEEN ? AND ?${type ? ' AND p.conducteur_id IN (SELECT id FROM conducteurs WHERE type = ?)' : ''}`, [...agenceIds, debut, fin, ...tp])).s)
  const cout = n((await queryOne(`SELECT SUM(c.montant) AS s FROM commissions c WHERE c.agence_id IN (${inList(agenceIds)}) AND c.statut IN (${sActifs}) AND c.created_at BETWEEN ? AND ?${typeComm(type)}`,
    [...agenceIds, ...STATUTS_COMMISSION_ACTIFS, debut, fin, ...tp])).s)
  const cd = await queryOne(`SELECT COUNT(*) AS total, SUM(type = 'tuktuk') AS tuktuk, SUM(type = 'cyclo') AS cyclo FROM conducteurs
    WHERE agence_id IN (${inList(agenceIds)}) AND statut = 'actif'${type ? ' AND type = ?' : ''}`, [...agenceIds, ...tp])
  const orientes = n(fi.orientes)
  const acheteurs = n(fi.acheteurs)
  return {
    conducteurs_actifs: n(cd.total), tuktuk_actifs: n(cd.tuktuk), cyclo_actifs: n(cd.cyclo),
    visites: n(fi.visites), clients_orientes: orientes, clients_acheteurs: acheteurs,
    taux_transformation: orientes ? Math.round((acheteurs * 1000) / orientes) / 10 : 0,
    ca, commissions_dues: dues, commissions_payees: payees, cout_commissions: cout,
    ratio_cout_ca: ca > 0 ? Math.round((cout * 10000) / ca) / 100 : 0,
  }
}

export async function actionsEnAttente(agenceIds) {
  const l = inList(agenceIds)
  const c = async (sql) => n((await queryOne(sql, agenceIds)).n)
  return {
    fiches_a_valider: await c(`SELECT COUNT(*) AS n FROM fiches_suivi WHERE agence_id IN (${l}) AND statut = 'enregistree'`),
    commissions_a_valider: await c(`SELECT COUNT(*) AS n FROM commissions WHERE agence_id IN (${l}) AND statut = 'a_valider'`),
    commissions_a_payer: await c(`SELECT COUNT(*) AS n FROM commissions WHERE agence_id IN (${l}) AND statut = 'validee' AND paiement_id IS NULL AND montant > 0`),
    alertes_ouvertes: await c(`SELECT COUNT(*) AS n FROM alertes WHERE agence_id IN (${l}) AND statut = 'ouverte'`),
    comptes_rendus_a_valider: await c(`SELECT COUNT(*) AS n FROM comptes_rendus WHERE agence_id IN (${l}) AND statut = 'brouillon'`),
  }
}

/** Top N conducteurs (clients acheteurs, puis clients orientés) */
export async function topConducteurs(agenceIds, debut, fin, type = null, limite = 10) {
  const F = filtreFiches(agenceIds, debut, fin, type)
  const stats = await query(`SELECT f.conducteur_id, COUNT(DISTINCT f.client_id) AS orientes,
      COUNT(DISTINCT CASE WHEN f.statut IN ('facturee','encaissee') THEN f.client_id END) AS acheteurs
    FROM fiches_suivi f ${F.join} WHERE ${F.where} GROUP BY f.conducteur_id ORDER BY acheteurs DESC, orientes DESC LIMIT ${Number(limite)}`, F.params)
  if (!stats.length) return []
  const V = filtreVentes(agenceIds, debut, fin, type)
  const ca = Object.fromEntries((await query(`SELECT f.conducteur_id, SUM(v.montant_total) AS ca FROM ventes v ${V.join} WHERE ${V.where} GROUP BY f.conducteur_id`, V.params)).map(r => [r.conducteur_id, n(r.ca)]))
  const ids = stats.map(s => s.conducteur_id)
  const cs = Object.fromEntries((await query(`SELECT id, code, nom, prenom, type FROM conducteurs WHERE id IN (${inList(ids)})`, ids)).map(c => [c.id, c]))
  return stats.map(s => ({
    conducteur: cs[s.conducteur_id], orientes: n(s.orientes), acheteurs: n(s.acheteurs),
    taux: n(s.orientes) ? Math.round((n(s.acheteurs) * 1000) / n(s.orientes)) / 10 : 0, ca: ca[s.conducteur_id] || 0,
  })).filter(l => l.conducteur)
}

export async function parAgence(agenceIds, debut, fin, type = null) {
  const agences = await query(`SELECT id, nom, code FROM agences WHERE id IN (${inList(agenceIds)}) ORDER BY nom`, agenceIds)
  const r = []
  for (const a of agences) r.push({ agence: a, ...(await indicateurs([a.id], debut, fin, type)) })
  return r
}

export async function parType(agenceIds, debut, fin) {
  return { tuktuk: await indicateurs(agenceIds, debut, fin, 'tuktuk'), cyclo: await indicateurs(agenceIds, debut, fin, 'cyclo') }
}

/** Séries hebdomadaires pour les graphiques */
export async function seriesHebdomadaires(agenceIds, semaines = 12, type = null) {
  const s = { libelles: [], visites: [], acheteurs: [], ca: [], commissions: [] }
  const lundi = mondayOf(today())
  for (let i = semaines - 1; i >= 0; i--) {
    const d = addDays(lundi, -7 * i)
    const ind = await indicateurs(agenceIds, `${d} 00:00:00`, `${addDays(d, 6)} 23:59:59`, type)
    s.libelles.push(`${d.slice(8, 10)}/${d.slice(5, 7)}`)
    s.visites.push(ind.visites)
    s.acheteurs.push(ind.clients_acheteurs)
    s.ca.push(ind.ca)
    s.commissions.push(ind.cout_commissions)
  }
  return s
}
