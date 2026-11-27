/** Règles de lecture d'une vente Odoo */
import { ETATS_PAIEMENT, lib } from './ref.js'

export const estFacture = v => v.odoo_modele === 'account.move'
export const estEncaissee = v => estFacture(v) && v.type === 'facture' && v.etat === 'posted' && v.etat_paiement === 'paid'
export const estAnnulee = v => v.etat === 'cancel' || v.etat_paiement === 'reversed'

export function libelleEtat(v) {
  if (estFacture(v)) return v.etat === 'cancel' ? 'Annulée' : v.etat === 'draft' ? 'Brouillon' : lib(ETATS_PAIEMENT, v.etat_paiement)
  return { draft: 'Devis', sent: 'Devis envoyé', sale: 'Commande confirmée', done: 'Verrouillée', cancel: 'Annulée' }[v.etat] || v.etat
}
