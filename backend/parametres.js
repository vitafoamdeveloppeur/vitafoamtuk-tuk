/**
 * Paramètres modifiables sans développement (page Paramètres)
 */
import crypto from 'crypto'
import { query, execute } from './db.js'

/** clé => [valeur par défaut, type, groupe, libellé] */
export const DEFAUTS = {
  delai_achat_jours: [60, 'entier', 'regles', "Délai pour qu'un achat donne droit au complément (jours)"],
  attribution_mois: [12, 'entier', 'regles', "Durée d'attribution d'un client à son conducteur (mois)"],
  jour_paiement: [5, 'entier', 'regles', 'Jour de paiement des conducteurs (1 = lundi … 7 = dimanche)'],
  separation_saisie_validation: [false, 'booleen', 'regles', 'Interdire à celui qui saisit une fiche de valider sa visite et sa commission'],
  separation_validation_paiement: [false, 'booleen', 'regles', 'Interdire à celui qui valide une commission de la payer'],
  alerte_visites_jour: [10, 'entier', 'alertes', 'Alerte au-delà de ce nombre de visites par jour pour un conducteur'],
  alerte_taux_min: [5, 'decimal', 'alertes', 'Alerte si le taux de transformation est inférieur à (%)'],
  alerte_taux_jours: [30, 'entier', 'alertes', 'Période de calcul du taux de transformation (jours)'],
  alerte_taux_min_visites: [10, 'entier', 'alertes', "Nombre minimum de visites sur la période avant d'alerter"],
  odoo_url: ['', 'texte', 'odoo', 'Adresse Odoo (ex. https://odoo.entreprise.mg)'],
  odoo_base: ['', 'texte', 'odoo', 'Base de données Odoo'],
  odoo_utilisateur: ['', 'texte', 'odoo', 'Utilisateur technique Odoo (identifiant)'],
  odoo_cle_api: ['', 'secret', 'odoo', 'Clé API Odoo'],
  odoo_actif: [false, 'booleen', 'odoo', 'Synchronisation Odoo activée'],
  odoo_intervalle_minutes: [15, 'entier', 'odoo', 'Synchronisation automatique toutes les (minutes)'],
  odoo_derniere_synchro: ['', 'texte', 'interne', 'Date de la dernière synchronisation réussie'],
  entreprise_nom: ['Vitafoam Madagascar', 'texte', 'general', "Nom de l'entreprise (reçus, cartes, rapports)"],
  emails_direction: ['', 'texte', 'general', 'Adresses e-mail supplémentaires pour le compte-rendu (séparées par des virgules)'],
}

// ---------------------------------------------------------------- chiffrement des secrets (clé API Odoo)
const cle = () => crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'dev-secret-non-securise').digest()
function chiffrer(valeur) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', cle(), iv)
  const data = Buffer.concat([c.update(String(valeur), 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}
function dechiffrer(valeur) {
  try {
    const [v, iv, tag, data] = String(valeur).split(':')
    if (v !== 'v1') return null
    const d = crypto.createDecipheriv('aes-256-gcm', cle(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')
  } catch { return null }
}

let cache = null

function convertir(cle, brut) {
  const type = DEFAUTS[cle]?.[1] || 'texte'
  if (brut == null) return DEFAUTS[cle]?.[0] ?? null
  switch (type) {
    case 'entier': return parseInt(brut, 10) || 0
    case 'decimal': return parseFloat(brut) || 0
    case 'booleen': return brut === '1' || brut === 'true'
    case 'secret': return brut ? dechiffrer(brut) : ''
    default: return brut
  }
}

export async function tous() {
  if (cache) return cache
  const rows = await query('SELECT cle, valeur FROM parametres')
  const stockes = Object.fromEntries(rows.map(r => [r.cle, r.valeur]))
  cache = {}
  for (const k of Object.keys(DEFAUTS)) cache[k] = convertir(k, stockes[k] ?? null)
  return cache
}

export async function get(cle) {
  return (await tous())[cle]
}
export const entier = async cle => parseInt(await get(cle), 10) || 0

export async function set(cle, valeur) {
  const type = DEFAUTS[cle]?.[1] || 'texte'
  let brut = valeur
  if (type === 'secret') brut = valeur ? chiffrer(valeur) : null
  else if (type === 'booleen') brut = valeur ? '1' : '0'
  else if (brut != null) brut = String(brut)
  await execute('INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON DUPLICATE KEY UPDATE valeur = VALUES(valeur)', [cle, brut])
  cache = null
}

/** Paramètres pour la page Paramètres (le secret n'est jamais renvoyé, seulement « défini ou non ») */
export async function pourAffichage() {
  const t = await tous()
  return Object.entries(DEFAUTS).filter(([, d]) => d[2] !== 'interne').map(([k, [, type, groupe, libelle]]) => ({
    cle: k, type, groupe, libelle, valeur: type === 'secret' ? '' : t[k], defini: type === 'secret' ? !!t[k] : undefined,
  }))
}
