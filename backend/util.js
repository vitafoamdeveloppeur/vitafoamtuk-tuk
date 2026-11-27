/**
 * Utilitaires partagés : erreurs, validation, dates locales, téléphones, montants, CSV
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Erreur de règle métier (affichée telle quelle à l'utilisateur) */
export const regle = message => new ApiError(422, message)

export const TIMEZONE = process.env.TIMEZONE || 'Indian/Antananarivo'

// ---------------------------------------------------------------- validation
export function text(value, label, { max = 200, required = false } = {}) {
  const result = value == null ? '' : String(value).trim()
  if (required && !result) throw new ApiError(422, `${label} obligatoire.`)
  if (result.length > max) throw new ApiError(422, `${label} trop long (${max} caractères maximum).`)
  return result
}
export const textOrNull = (value, label, opts) => text(value, label, opts) || null

export function recordId(value) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, 'Identifiant invalide.')
  return id
}

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function oneOf(value, allowed, label) {
  if (!Object.prototype.hasOwnProperty.call(allowed, value)) throw new ApiError(422, `${label} invalide.`)
  return value
}

// mysql2 renvoie les colonnes JSON déjà décodées (MySQL) ou en texte (MariaDB) : on accepte les deux.
export function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return fallback }
}

// ---------------------------------------------------------------- dates locales (Madagascar)
const pad = n => String(n).padStart(2, '0')

/** 'YYYY-MM-DD HH:MM:SS' à l'heure de l'entreprise */
export function now(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${v.year}-${v.month}-${v.day} ${v.hour}:${v.minute}:${v.second}`
}
export const today = () => now().slice(0, 10)
export const nowSeconds = () => Math.floor(Date.now() / 1000)

const toUtc = d => { const [y, m, j] = d.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, j)) }
const fromUtc = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

export function addDays(dateStr, n) {
  const d = toUtc(dateStr)
  d.setUTCDate(d.getUTCDate() + n)
  return fromUtc(d)
}

/** Ajoute des mois sans débordement (31 janvier + 1 mois = 28/29 février) */
export function addMonths(dateStr, n) {
  const [y, m, j] = dateStr.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(j, last))
  return fromUtc(target)
}

/** Lundi de la semaine de la date */
export function mondayOf(dateStr) {
  const d = toUtc(dateStr)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return fromUtc(d)
}
export const isoWeek = dateStr => {
  const d = toUtc(dateStr)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-${pad(week)}`
}
export const dayOfWeek = dateStr => ((toUtc(dateStr).getUTCDay() + 6) % 7) + 1 // 1 = lundi … 7 = dimanche

/** 'JJ/MM/AAAA' */
export function dateFr(value) {
  if (!value) return '—'
  const s = String(value)
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}${s.length > 10 ? ` ${s.slice(11, 16)}` : ''}`
}

/** Période depuis la requête (du / au) ; par défaut le mois en cours */
export function periode(q = {}) {
  const t = today()
  const du = validDate(q.du) ? q.du : `${t.slice(0, 8)}01`
  const au = validDate(q.au) ? q.au : t
  return { du, au, debut: `${du} 00:00:00`, fin: `${au} 23:59:59` }
}

// ---------------------------------------------------------------- téléphones Madagascar (+261)
/** Retourne +261XXXXXXXXX, ou null si le numéro n'est pas un numéro malgache valide */
export function normaliserTelephone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00261')) digits = digits.slice(5)
  else if (digits.startsWith('261') && digits.length === 12) digits = digits.slice(3)
  else if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1)
  // Mobiles (32, 33, 34, 37, 38, 39) et fixes (20)
  if (!/^(20|3[2-9])\d{7}$/.test(digits)) return null
  return `+261${digits}`
}

export function afficherTelephone(value) {
  if (!value) return '—'
  const m = /^\+261(\d{2})(\d{2})(\d{3})(\d{2})$/.exec(value)
  return m ? `+261 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : value
}

/** Variantes à rechercher dans Odoo (les numéros y sont saisis librement) */
export function variantesTelephone(e164) {
  const local = `0${e164.slice(4)}`
  return [...new Set([e164, e164.slice(1), local, afficherTelephone(e164),
    local.replace(/^(0\d{2})(\d{2})(\d{3})(\d{2})$/, '$1 $2 $3 $4')])]
}

// ---------------------------------------------------------------- montants
export const ariary = n => `${Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/ | /g, ' ')} Ar`

// ---------------------------------------------------------------- CSV (compatible Excel)
export function sendCsv(res, filename, columns, rows) {
  const esc = v => {
    if (v == null) return ''
    const s = String(v)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map(c => esc(c.label)).join(';')]
  for (const r of rows) lines.push(columns.map(c => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(';'))
  res.set('content-type', 'text/csv; charset=utf-8')
  res.set('content-disposition', `attachment; filename="${filename}_${today()}.csv"`)
  res.send(`﻿${lines.join('\r\n')}`)
}

export const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
