/**
 * Moteur de calcul des commissions (note « Rémunération tuk-tuk et cyclo »)
 *
 *  - Client amené sans achat                      → 1 000 Ar
 *  - Achat entrée de gamme ou coussins, encaissé   → 5 000 Ar
 *  - Achat matelas haut de gamme, encaissé         → 10 000 Ar
 *  - Une seule rémunération par client et par attribution (12 mois) : ce qui est déjà accordé est déduit.
 *  - Facture mixte : niveau le plus élevé, une seule fois.
 *  - Achat (date de facture) au-delà du délai (60 jours) après la visite : 1 000 Ar seulement.
 *  - Paiement en plusieurs fois : complément dû au paiement intégral.
 *  - Facture annulée : complément annulé s'il n'est pas payé, sinon régularisation déduite du prochain paiement.
 * Le calcul est idempotent : il compare le montant dû au montant déjà accordé et n'enregistre que la différence.
 */
import { query, queryOne, execute, transaction, inList } from './db.js'
import { ApiError, regle, now, dateFr, ariary, parseJson } from './util.js'
import { NIVEAUX, STATUTS_CONDUCTEUR, STATUTS_COMMISSION, lib } from './ref.js'
import * as P from './parametres.js'
import { evenement, liensFiche } from './journal.js'
import { estEncaissee, estAnnulee } from './ventes-utils.js'

const DEFAUT_BAREME = {
  visite: { montant: 1000, rang: 1 }, entree_gamme: { montant: 5000, rang: 2 },
  coussins: { montant: 5000, rang: 3 }, haut_gamme: { montant: 10000, rang: 4 },
}

export async function bareme(conn) {
  const rows = await query('SELECT niveau, montant, rang FROM baremes', [], conn)
  const b = { ...DEFAUT_BAREME }
  for (const r of rows) b[r.niveau] = { montant: r.montant, rang: r.rang }
  return b
}

/** Niveau de rémunération d'une liste de niveaux de produits (le plus élevé l'emporte) */
export async function niveauLePlusEleve(niveaux, conn) {
  const b = await bareme(conn)
  const l = niveaux.filter(n => b[n] && n !== 'visite')
  if (!l.length) return null
  l.sort((x, y) => (b[y].montant - b[x].montant) || (b[y].rang - b[x].rang))
  return l[0]
}

const estActif = c => c.statut === 'actif'
const visiteValidee = f => !['enregistree', 'rejetee'].includes(f.statut)

function statutInitial(conducteur) {
  if (!estActif(conducteur)) return ['rejetee', `Conducteur ${lib(STATUTS_CONDUCTEUR, conducteur.statut)} : refus automatique`]
  if (conducteur.commissions_bloquees) return ['bloquee', 'Commissions du conducteur bloquées suite à une alerte']
  return ['a_valider', null]
}

export async function chaineControle(conducteur, client, fiche, vente) {
  const delai = await P.entier('delai_achat_jours')
  return [
    { etape: 1, controle: 'Conducteur actif', ok: estActif(conducteur), detail: lib(STATUTS_CONDUCTEUR, conducteur.statut) },
    { etape: 2, controle: 'Client nouveau ou déjà attribué à ce conducteur', ok: client.conducteur_id === conducteur.id, detail: `Attribué jusqu'au ${dateFr(client.attribution_fin)}` },
    { etape: 3, controle: 'Visite validée par le Responsable', ok: visiteValidee(fiche), detail: fiche.numero + (fiche.valide_le ? ` le ${dateFr(fiche.valide_le)}` : '') },
    { etape: 4, controle: `Facture encaissée dans les ${delai} jours`, ok: !!vente, detail: vente ? `${vente.reference} du ${dateFr(vente.date_document)}` : 'Pas de facture encaissée dans le délai : montant de visite seulement' },
  ]
}

const liens = (fiche, client) => (fiche ? liensFiche(fiche) : { client_id: client.id, agence_id: client.agence_id, conducteur_id: client.conducteur_id })

/** Recalcule la rémunération due pour un client auprès de son conducteur attributaire. */
export async function recalculerClient(clientId) {
  return transaction(async conn => {
    const client = await queryOne('SELECT * FROM clients WHERE id = ? FOR UPDATE', [clientId], conn)
    if (!client?.conducteur_id || !client.attribue_le) return
    const conducteur = await queryOne('SELECT * FROM conducteurs WHERE id = ?', [client.conducteur_id], conn)
    const b = await bareme(conn)

    const fiches = await query(`SELECT * FROM fiches_suivi WHERE client_id = ? AND conducteur_id = ? AND date_visite BETWEEN ? AND ?`,
      [client.id, client.conducteur_id, `${client.attribue_le} 00:00:00`, `${client.attribution_fin} 23:59:59`], conn)
    const validees = fiches.filter(visiteValidee).sort((a, z) => a.date_visite.localeCompare(z.date_visite))

    let cible = 0
    let niveau = 'visite'
    let ficheCible = null
    let venteCible = null
    if (validees.length) {
      cible = b.visite.montant
      ficheCible = validees[0]
      const parId = new Map(validees.map(f => [f.id, f]))
      const ventes = await query(`SELECT * FROM ventes WHERE odoo_modele = 'account.move' AND fiche_suivi_id IN (${inList([...parId.keys()])})`, [...parId.keys()], conn)
      for (const v of ventes) {
        const f = parId.get(v.fiche_suivi_id)
        if (!estEncaissee(v) || estAnnulee(v) || !v.date_document || v.date_document > f.date_limite) continue
        const n = v.niveau || 'entree_gamme'
        if (b[n].montant > cible) { cible = b[n].montant; niveau = n; ficheCible = f; venteCible = v }
      }
    }

    const ficheIds = fiches.map(f => f.id)
    const lignes = await query(`SELECT * FROM commissions WHERE client_id = ? AND conducteur_id = ? AND fiche_suivi_id IN (${inList(ficheIds)})
      AND statut <> 'annulee' FOR UPDATE`, [client.id, client.conducteur_id, ...ficheIds], conn)
    let delta = cible - lignes.reduce((s, c) => s + c.montant, 0)
    if (delta === 0) return

    // Baisse : on annule d'abord ce qui n'est pas encore payé (compléments en premier, les plus récents d'abord)
    if (delta < 0) {
      const annulables = lignes.filter(c => c.statut !== 'payee' && c.montant > 0)
        .sort((x, y) => ((x.type === 'complement' ? 0 : 1) - (y.type === 'complement' ? 0 : 1)) || (y.id - x.id))
      for (const c of annulables) {
        if (delta >= 0) break
        await execute("UPDATE commissions SET statut = 'annulee', motif = 'Annulée au recalcul (vente annulée ou modifiée)', updated_at = ? WHERE id = ?", [now(), c.id], conn)
        delta += c.montant
        const f = fiches.find(x => x.id === c.fiche_suivi_id) || ficheCible
        await evenement('commission', 'annulation', `Commission ${c.id} annulée (${ariary(c.montant)}) : vente annulée ou modifiée`, liens(f, client), -c.montant, conn)
      }
    }
    if (delta === 0) return

    const dejaAccorde = cible - delta
    const fiche = ficheCible || [...fiches].sort((a, z) => z.date_visite.localeCompare(a.date_visite))[0]
    if (!fiche) return
    const base = [conducteur.id, client.id, fiche.id, venteCible?.id ?? null, fiche.agence_id]

    if (delta > 0) {
      const [statut, motif] = statutInitial(conducteur)
      const type = dejaAccorde === 0 && niveau === 'visite' ? 'visite' : 'complement'
      const controles = await chaineControle(conducteur, client, fiche, venteCible)
      await execute(`INSERT INTO commissions (conducteur_id, client_id, fiche_suivi_id, vente_id, agence_id, type, niveau, montant_bareme, montant_deduit, montant, statut, motif, controles, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [...base, type, niveau, cible, dejaAccorde, delta, statut, motif, JSON.stringify(controles), now()], conn)
      const libelle = type === 'visite'
        ? `Commission visite ${ariary(delta)} pour ${conducteur.code}`
        : `Complément ${ariary(delta)} (${lib(NIVEAUX, niveau)}, barème ${ariary(cible)} – déjà accordé ${ariary(dejaAccorde)}) pour ${conducteur.code}`
      await evenement('commission', 'creation', libelle + (statut !== 'a_valider' ? ` — ${STATUTS_COMMISSION[statut]}` : ''), liens(fiche, client), delta, conn)
    } else {
      await execute(`INSERT INTO commissions (conducteur_id, client_id, fiche_suivi_id, vente_id, agence_id, type, niveau, montant_bareme, montant_deduit, montant, statut, motif, valide_le, created_at)
        VALUES (?, ?, ?, ?, ?, 'regularisation', ?, ?, ?, ?, 'validee', 'Vente annulée après paiement : montant déduit du prochain paiement', ?, ?)`,
      [...base, niveau, cible, dejaAccorde, delta, now(), now()], conn)
      await evenement('commission', 'regularisation', `Régularisation ${ariary(delta)} pour ${conducteur.code} (vente annulée après paiement)`, liens(fiche, client), delta, conn)
    }
  })
}

/** Commission refusée car le client appartient à un autre conducteur (aucun montant) */
export async function refuserClientAutreConducteur(fiche, conn) {
  const client = await queryOne('SELECT * FROM clients WHERE id = ?', [fiche.client_id], conn)
  const proprietaire = client.conducteur_id ? await queryOne('SELECT code FROM conducteurs WHERE id = ?', [client.conducteur_id], conn) : null
  const conducteur = await queryOne('SELECT * FROM conducteurs WHERE id = ?', [fiche.conducteur_id], conn)
  const b = await bareme(conn)
  const motif = `Client déjà attribué à ${proprietaire?.code || 'un autre conducteur'} : aucune commission`
  await execute(`INSERT INTO commissions (conducteur_id, client_id, fiche_suivi_id, agence_id, type, niveau, montant_bareme, montant_deduit, montant, statut, motif, controles, created_at)
    VALUES (?, ?, ?, ?, 'visite', 'visite', ?, 0, 0, 'rejetee', ?, ?, ?)`,
  [fiche.conducteur_id, client.id, fiche.id, fiche.agence_id, b.visite.montant, motif, JSON.stringify(await chaineControle(conducteur, client, fiche, null)), now()], conn)
  await evenement('commission', 'refus', `Aucune commission pour ${conducteur.code} : ${motif}`, liensFiche(fiche), 0, conn)
}

async function charger(id, user, conn) {
  const c = await queryOne(`SELECT c.*, ct.code AS conducteur_code, ct.statut AS conducteur_statut, ct.commissions_bloquees, f.saisi_par
    FROM commissions c JOIN conducteurs ct ON ct.id = c.conducteur_id LEFT JOIN fiches_suivi f ON f.id = c.fiche_suivi_id
    WHERE c.id = ? FOR UPDATE`, [id], conn)
  if (!c) throw new ApiError(404, 'Commission introuvable.')
  if (!user.agenceIds.includes(c.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à cette agence.")
  return c
}
const liensCommission = (c, userId) => ({ agence_id: c.agence_id, conducteur_id: c.conducteur_id, client_id: c.client_id, fiche_suivi_id: c.fiche_suivi_id, user_id: userId })

/** Validation par le Responsable d'agence */
export async function valider(id, user, conn) {
  const run = async cx => {
    const c = await charger(id, user, cx)
    if (c.statut !== 'a_valider') throw regle('Seule une commission « à valider » peut être validée.')
    if (c.saisi_par === user.id && await P.get('separation_saisie_validation')) throw regle('Séparation des tâches : vous avez saisi cette fiche, vous ne pouvez pas valider sa commission.')
    if (c.conducteur_statut !== 'actif') throw regle(`Conducteur ${lib(STATUTS_CONDUCTEUR, c.conducteur_statut)} : la commission ne peut pas être validée.`)
    if (c.commissions_bloquees) throw regle('Les commissions de ce conducteur sont bloquées.')
    await execute("UPDATE commissions SET statut = 'validee', valide_par = ?, valide_le = ?, updated_at = ? WHERE id = ?", [user.id, now(), now(), id], cx)
    await evenement('commission', 'validation', `Commission ${ariary(c.montant)} validée pour ${c.conducteur_code}`, liensCommission(c, user.id), c.montant, cx)
  }
  return conn ? run(conn) : transaction(run)
}

export async function rejeter(id, user, motif) {
  if (!motif) throw regle('Indiquez le motif du rejet.')
  return transaction(async conn => {
    const c = await charger(id, user, conn)
    if (!['a_valider', 'bloquee'].includes(c.statut)) throw regle('Cette commission ne peut plus être rejetée.')
    await execute("UPDATE commissions SET statut = 'rejetee', motif = ?, valide_par = ?, valide_le = ?, updated_at = ? WHERE id = ?", [motif.slice(0, 250), user.id, now(), now(), id], conn)
    await evenement('commission', 'rejet', `Commission ${ariary(c.montant)} rejetée pour ${c.conducteur_code} : ${motif}`, liensCommission(c, user.id), 0, conn)
  })
}

export async function validerGroupe(ids, user) {
  let ok = 0
  const erreurs = []
  for (const id of ids) {
    try { await valider(Number(id), user); ok++ } catch (e) { erreurs.push(`#${id} : ${e.message}`) }
  }
  return { ok, erreurs }
}

export const controles = c => parseJson(c.controles, [])
