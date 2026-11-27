/**
 * Référentiels et libellés (communs au backend et, via /api/ref, au frontend)
 */
export const ROLES = {
  'super-admin': 'Super administrateur',
  direction: 'Direction',
  'responsable-agence': "Responsable d'agence",
  'service-commercial': 'Service commercial',
  commercial: 'Commercial et conseiller',
  caissier: 'Caissier / comptable',
  auditeur: 'Auditeur',
}

export const TYPES_VEHICULE = { tuktuk: 'Tuk-tuk', cyclo: 'Cyclo-pousse' }
export const PREFIXES_CODE = { tuktuk: 'TT', cyclo: 'CP' }
export const STATUTS_CONDUCTEUR = { actif: 'Actif', suspendu: 'Suspendu', radie: 'Radié' }
export const MODES_PAIEMENT_CONDUCTEUR = { especes: 'Espèces', mobile_money: 'Mobile Money' }
export const OPERATEURS = { mvola: 'MVola', orange_money: 'Orange Money', airtel_money: 'Airtel Money' }
export const MODES_PAIEMENT = { especes: 'Espèces', mvola: 'MVola', orange_money: 'Orange Money', airtel_money: 'Airtel Money' }
export const MOTIFS_VISITE = { demande_prix: 'Demande de prix', achat: 'Achat' }

export const STATUTS_FICHE = {
  enregistree: 'Enregistrée', visite_validee: 'Visite validée', devis: 'Devis', commande: 'Commande',
  facturee: 'Facturée', encaissee: 'Encaissée', annulee: 'Annulée', rejetee: 'Rejetée', expiree: 'Expirée',
}
export const NIVEAUX = {
  visite: 'Client amené sans achat', entree_gamme: 'Entrée de gamme', coussins: 'Coussins', haut_gamme: 'Matelas haut de gamme',
}
export const NIVEAUX_PRODUIT = { entree_gamme: 'Entrée de gamme', coussins: 'Coussins', haut_gamme: 'Matelas haut de gamme' }
export const TYPES_COMMISSION = { visite: 'Visite', complement: 'Complément achat', regularisation: 'Régularisation' }
export const STATUTS_COMMISSION = {
  a_valider: 'À valider', validee: 'Validée', payee: 'Payée', rejetee: 'Rejetée', bloquee: 'Bloquée', annulee: 'Annulée',
}
/** Statuts qui comptent dans les montants (dus, payés, coût) */
export const STATUTS_COMMISSION_ACTIFS = ['a_valider', 'validee', 'payee', 'bloquee']
export const TYPES_VENTE = { devis: 'Devis', commande: 'Commande', facture: 'Facture', avoir: 'Avoir' }
export const ETATS_PAIEMENT = {
  not_paid: 'Non payée', partial: 'Partiellement payée', in_payment: 'En cours de paiement', paid: 'Payée', reversed: 'Extournée', cancel: 'Annulée',
}
export const TYPES_ALERTE = {
  visites_excessives: 'Trop de visites dans la journée', taux_transformation: 'Taux de transformation faible',
  client_doublon: 'Client en doublon', odoo: 'Synchronisation Odoo',
}
export const TYPES_EVENEMENT = { visite: 'Visite', vente: 'Vente', commission: 'Commission', paiement: 'Paiement', conducteur: 'Conducteur', alerte: 'Alerte' }
export const STATUTS_CR = { brouillon: 'Brouillon', valide: 'Validé', envoye: 'Envoyé' }

export const lib = (ref, key) => (key == null ? '—' : (ref[key] ?? key))

/** Droits par page et par action */
export const MODULES = {
  tableau_bord: ['Tableau de bord', ['lire']],
  fiches: ['Fiches de suivi (visites)', ['lire', 'creer', 'valider', 'exporter']],
  conducteurs: ['Conducteurs', ['lire', 'creer', 'modifier', 'exporter']],
  clients: ['Clients', ['lire', 'modifier', 'exporter']],
  ventes: ['Ventes (Odoo)', ['lire', 'synchroniser', 'exporter']],
  commissions: ['Commissions', ['lire', 'valider', 'exporter']],
  paiements: ['Paiements', ['lire', 'payer', 'exporter']],
  alertes: ['Alertes', ['lire', 'traiter']],
  historique: ['Historique', ['lire', 'exporter']],
  rapports: ['Rapports', ['lire', 'exporter']],
  comptes_rendus: ['Comptes-rendus', ['lire', 'valider']],
  agences: ['Agences', ['lire', 'creer', 'modifier']],
  utilisateurs: ['Utilisateurs', ['lire', 'creer', 'modifier']],
  roles: ['Rôles et droits', ['lire', 'modifier']],
  parametres: ['Paramètres (barème, Odoo, e-mails)', ['lire', 'modifier']],
  audit: ["Journal d'audit", ['lire', 'exporter']],
}
export const ACTIONS = {
  lire: 'Lire', creer: 'Créer', modifier: 'Modifier', valider: 'Valider', payer: 'Payer', exporter: 'Exporter', synchroniser: 'Synchroniser', traiter: 'Traiter',
}
export const TOUS_DROITS = Object.entries(MODULES).flatMap(([m, [, actions]]) => actions.map(a => `${m}.${a}`))

export function droitsParDefaut() {
  const lecture = TOUS_DROITS.filter(p => p.endsWith('.lire'))
  const exports = TOUS_DROITS.filter(p => p.endsWith('.exporter'))
  return {
    'super-admin': TOUS_DROITS,
    direction: [...lecture, ...exports].filter(p => !['roles.lire', 'parametres.lire', 'utilisateurs.lire'].includes(p)),
    'responsable-agence': [
      'tableau_bord.lire', 'agences.lire',
      'conducteurs.lire', 'conducteurs.creer', 'conducteurs.modifier', 'conducteurs.exporter',
      'clients.lire', 'clients.modifier', 'clients.exporter',
      'fiches.lire', 'fiches.creer', 'fiches.valider', 'fiches.exporter',
      'ventes.lire', 'ventes.synchroniser', 'ventes.exporter',
      'commissions.lire', 'commissions.valider', 'commissions.exporter',
      'paiements.lire', 'paiements.exporter',
      'alertes.lire', 'alertes.traiter',
      'historique.lire', 'historique.exporter', 'rapports.lire', 'rapports.exporter',
      'comptes_rendus.lire', 'comptes_rendus.valider',
    ],
    'service-commercial': [
      'tableau_bord.lire', 'agences.lire',
      'conducteurs.lire', 'conducteurs.creer', 'conducteurs.modifier', 'conducteurs.exporter',
      'clients.lire', 'clients.modifier', 'clients.exporter',
      'fiches.lire', 'fiches.creer', 'fiches.exporter',
      'ventes.lire', 'ventes.synchroniser', 'ventes.exporter',
      'commissions.lire', 'historique.lire', 'rapports.lire', 'comptes_rendus.lire',
    ],
    commercial: ['tableau_bord.lire', 'conducteurs.lire', 'conducteurs.creer', 'clients.lire', 'fiches.lire', 'fiches.creer', 'ventes.lire'],
    caissier: [
      'tableau_bord.lire', 'conducteurs.lire', 'commissions.lire', 'commissions.exporter',
      'paiements.lire', 'paiements.payer', 'paiements.exporter', 'ventes.lire', 'historique.lire',
    ],
    auditeur: [...lecture, ...exports],
  }
}
export const PORTEE_PAR_DEFAUT = {
  'super-admin': 'toutes', direction: 'toutes', auditeur: 'toutes',
  'responsable-agence': 'agences', 'service-commercial': 'agences', commercial: 'agences', caissier: 'agences',
}

export const REFERENTIELS = {
  ROLES, TYPES_VEHICULE, STATUTS_CONDUCTEUR, MODES_PAIEMENT_CONDUCTEUR, OPERATEURS, MODES_PAIEMENT, MOTIFS_VISITE,
  STATUTS_FICHE, NIVEAUX, NIVEAUX_PRODUIT, TYPES_COMMISSION, STATUTS_COMMISSION, TYPES_VENTE, ETATS_PAIEMENT,
  TYPES_ALERTE, TYPES_EVENEMENT, STATUTS_CR, MODULES, ACTIONS,
}
