/**
 * Historique fonctionnel (événements) et journal d'audit
 */
import { execute } from './db.js'
import { now } from './util.js'

/** Événement métier affiché dans l'Historique et la chronologie des fiches */
export async function evenement(type, action, libelle, liens = {}, montant = null, conn) {
  await execute(`INSERT INTO evenements (type, action, libelle, montant, agence_id, conducteur_id, client_id, fiche_suivi_id, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    type, action, String(libelle).slice(0, 250), montant == null ? null : Math.round(montant),
    liens.agence_id ?? null, liens.conducteur_id ?? null, liens.client_id ?? null, liens.fiche_suivi_id ?? null,
    liens.user_id ?? null, now(),
  ], conn)
}

export const liensFiche = (fiche, userId = null) => ({
  agence_id: fiche.agence_id, conducteur_id: fiche.conducteur_id, client_id: fiche.client_id, fiche_suivi_id: fiche.id, user_id: userId,
})

/** Journal d'audit (connexions, créations, modifications) */
export async function audit(req, user, action, objet = '', objetId = '', detail = '') {
  try {
    await execute('INSERT INTO audit_log (user_id, user_nom, action, objet, objet_id, detail, ip, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      user?.id ?? null, user?.nom ?? null, action, objet, String(objetId ?? ''), String(detail || '').slice(0, 500), req?.ip || null, now(),
    ])
  } catch (e) {
    console.error('[audit]', e.message)
  }
}
