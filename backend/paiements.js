/** Paiement des conducteurs : état à payer, net, preuve (signature ou référence Mobile Money), reçu */
import { query, queryOne, execute, transaction } from './db.js'
import { ApiError, regle, now, today, ariary } from './util.js'
import { MODES_PAIEMENT } from './ref.js'
import * as P from './parametres.js'
import { evenement } from './journal.js'
import { numeroPaiement } from './numerotation.js'
import * as Commissions from './commissions.js'
import { enregistrerImage } from './storage.js'
import { can } from './auth.js'

/** État de paiement : par conducteur, commissions validées non payées moins les régularisations */
export async function etat(agenceIds) {
  if (!agenceIds.length) return []
  const rows = await query(`SELECT c.conducteur_id, ct.code, ct.nom, ct.prenom, ct.type, ct.mode_paiement, ct.operateur_mobile, ct.agence_id, a.nom AS agence,
      SUM(CASE WHEN c.montant > 0 THEN c.montant ELSE 0 END) AS commissions,
      SUM(CASE WHEN c.montant < 0 THEN c.montant ELSE 0 END) AS regularisations,
      SUM(CASE WHEN c.montant > 0 THEN 1 ELSE 0 END) AS nb
    FROM commissions c JOIN conducteurs ct ON ct.id = c.conducteur_id JOIN agences a ON a.id = ct.agence_id
    WHERE c.statut = 'validee' AND c.paiement_id IS NULL AND c.agence_id IN (${agenceIds.map(() => '?').join(',')})
    GROUP BY c.conducteur_id ORDER BY ct.code`, agenceIds)
  return rows.map(r => ({ ...r, commissions: Number(r.commissions), regularisations: Number(r.regularisations), nb: Number(r.nb), net: Number(r.commissions) + Number(r.regularisations) }))
}

/** Situation d'un conducteur avant paiement */
export async function apercu(conducteurId) {
  const l = await query("SELECT statut, montant FROM commissions WHERE conducteur_id = ? AND paiement_id IS NULL AND statut IN ('a_valider','validee')", [conducteurId])
  const av = l.filter(c => c.statut === 'a_valider')
  const va = l.filter(c => c.statut === 'validee')
  const brut = va.filter(c => c.montant > 0).reduce((s, c) => s + c.montant, 0)
  const regul = va.filter(c => c.montant < 0).reduce((s, c) => s + c.montant, 0)
  const aValider = av.reduce((s, c) => s + c.montant, 0)
  return {
    nb_a_valider: av.length, a_valider: aValider, nb_validees: va.filter(c => c.montant > 0).length,
    commissions: brut, regularisations: regul, net: brut + regul, net_avec_validation: brut + regul + aValider,
  }
}

/** Paie toutes les commissions validées du conducteur (option : valider d'abord les commissions « à valider ») */
export async function payer(conducteurId, b, user) {
  const separation = !!(await P.get('separation_validation_paiement'))
  const validerAvant = !!b.valider_avant && can(user, 'commissions.valider')
  if (validerAvant && separation) throw regle('Séparation validation / paiement activée : la commission doit être validée par un autre utilisateur avant le paiement.')
  const mode = String(b.mode || '')
  if (!MODES_PAIEMENT[mode]) throw regle('Mode de paiement inconnu.')
  const reference = String(b.reference || '').trim().slice(0, 100)
  if (mode !== 'especes' && !reference) throw regle('Paiement Mobile Money : la référence de transaction est obligatoire.')
  if (mode === 'especes' && !b.signature) throw regle('Paiement en espèces : la signature du conducteur est obligatoire.')
  const conducteur = await queryOne('SELECT ct.*, a.code AS agence_code FROM conducteurs ct JOIN agences a ON a.id = ct.agence_id WHERE ct.id = ?', [conducteurId])
  if (!conducteur) throw new ApiError(404, 'Conducteur introuvable.')
  if (!user.agenceIds.includes(conducteur.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à ce conducteur.")
  const signature = mode === 'especes' ? enregistrerImage(b.signature, 'signatures', `paiement-${conducteur.id}`, { formats: ['png'], max: 1024 * 1024 }) : null

  return transaction(async conn => {
    if (validerAvant) {
      const av = await query("SELECT id FROM commissions WHERE conducteur_id = ? AND statut = 'a_valider' AND paiement_id IS NULL FOR UPDATE", [conducteur.id], conn)
      for (const c of av) await Commissions.valider(c.id, user, conn)
    }
    const comms = await query("SELECT id, montant, valide_par, created_at FROM commissions WHERE conducteur_id = ? AND statut = 'validee' AND paiement_id IS NULL FOR UPDATE", [conducteur.id], conn)
    if (!comms.length) throw regle('Aucune commission validée à payer pour ce conducteur.')
    if (separation && comms.some(c => c.valide_par === user.id)) throw regle('Séparation des tâches : vous avez validé une de ces commissions, un autre utilisateur doit effectuer le paiement.')
    const brut = comms.filter(c => c.montant > 0).reduce((s, c) => s + c.montant, 0)
    const regul = comms.filter(c => c.montant < 0).reduce((s, c) => s + c.montant, 0)
    const net = brut + regul
    if (net <= 0) throw regle('Net à payer nul ou négatif : les régularisations seront déduites du prochain paiement.')
    const debut = comms.map(c => c.created_at).sort()[0].slice(0, 10)
    const numero = await numeroPaiement(conn, { code: conducteur.agence_code })
    const r = await execute(`INSERT INTO paiements (numero, conducteur_id, agence_id, periode_debut, periode_fin, montant_commissions, montant_regularisations, montant_net,
        mode, reference_transaction, signature, paye_par, paye_le, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [numero, conducteur.id, conducteur.agence_id, debut, today(), brut, regul, net, mode, reference || null, signature, user.id, now(), now()], conn)
    await execute(`UPDATE commissions SET statut = 'payee', paiement_id = ?, updated_at = ? WHERE id IN (${comms.map(() => '?').join(',')})`, [r.insertId, now(), ...comms.map(c => c.id)], conn)
    await evenement('paiement', 'paiement', `Paiement ${numero} : ${ariary(net)} versés à ${conducteur.code} (${MODES_PAIEMENT[mode]})`,
      { agence_id: conducteur.agence_id, conducteur_id: conducteur.id, user_id: user.id }, net, conn)
    return { id: r.insertId, numero, net }
  })
}
