export const ariary = n => `${Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ')} Ar`
export const nombre = n => (Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ')
export function dateFr(v, heure = true) {
  if (!v) return '—'
  const s = String(v)
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${heure && s.length > 10 ? ` ${s.slice(11, 16)}` : ''}`
}
export function tel(v) {
  if (!v) return '—'
  const m = /^\+261(\d{2})(\d{2})(\d{3})(\d{2})$/.exec(v)
  return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]}` : v
}
export const nomComplet = (nom, prenom) => [nom, prenom].filter(Boolean).join(' ')
export const lib = (ref, k) => (k == null ? '—' : (ref?.[k] ?? k))

/** Couleur d'un statut : vert (terminé), orange (en cours), rouge (refusé), gris (neutre) */
export function couleur(statut) {
  if (['encaissee', 'validee', 'payee', 'paye', 'actif', 'active', 'paid', 'synchronise', 'succes', 'traitee', 'envoye', 'valide'].includes(statut)) return 'vert'
  if (['annulee', 'rejetee', 'radie', 'cancel', 'erreur', 'bloquee', 'reversed', 'fermee', 'haute', 'suspendu'].includes(statut)) return 'rouge'
  if (['expiree', 'inactif', 'faible'].includes(statut)) return 'gris'
  return 'orange'
}

const pad = n => String(n).padStart(2, '0')
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export function periodes() {
  const t = new Date()
  const lundi = new Date(t); lundi.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  const moisPrec = new Date(t.getFullYear(), t.getMonth() - 1, 1)
  const finMoisPrec = new Date(t.getFullYear(), t.getMonth(), 0)
  const j30 = new Date(t); j30.setDate(t.getDate() - 29)
  return {
    jour: { du: isoDate(t), au: isoDate(t), label: 'Aujourd’hui' },
    semaine: { du: isoDate(lundi), au: isoDate(t), label: 'Cette semaine' },
    mois: { du: isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), au: isoDate(t), label: 'Ce mois' },
    mois_prec: { du: isoDate(moisPrec), au: isoDate(finMoisPrec), label: 'Mois dernier' },
    j30: { du: isoDate(j30), au: isoDate(t), label: '30 derniers jours' },
    annee: { du: `${t.getFullYear()}-01-01`, au: isoDate(t), label: 'Cette année' },
  }
}
