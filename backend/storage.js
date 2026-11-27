/** Fichiers privés (photos des conducteurs, signatures) : dossier STORAGE_DIR, jamais servi directement */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { ApiError } from './util.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage'))

const TYPES = { png: { sig: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' }, jpg: { sig: [0xff, 0xd8, 0xff], mime: 'image/jpeg' }, webp: { sig: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' } }

/** Enregistre une image envoyée en data URL. Retourne le chemin relatif. */
export function enregistrerImage(dataUrl, dossier, prefixe, { max = 4 * 1024 * 1024, formats = ['png', 'jpg', 'webp'] } = {}) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(String(dataUrl || ''))
  if (!m) throw new ApiError(422, 'Image invalide.')
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1]
  const buf = Buffer.from(m[2], 'base64')
  if (!formats.includes(ext) || !TYPES[ext].sig.every((b, i) => buf[i] === b)) throw new ApiError(422, 'Format d’image non accepté.')
  if (buf.length > max) throw new ApiError(413, 'Image trop lourde.')
  const rel = path.posix.join(dossier, `${prefixe}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`)
  fs.mkdirSync(path.join(STORAGE_DIR, dossier), { recursive: true })
  fs.writeFileSync(path.join(STORAGE_DIR, rel), buf)
  return rel
}

export function envoyerFichier(res, rel) {
  if (!rel) throw new ApiError(404, 'Fichier introuvable.')
  const abs = path.resolve(STORAGE_DIR, rel)
  if (!abs.startsWith(STORAGE_DIR + path.sep) || !fs.existsSync(abs)) throw new ApiError(404, 'Fichier introuvable.')
  const ext = path.extname(abs).slice(1)
  res.set('content-type', TYPES[ext]?.mime || 'application/octet-stream')
  res.set('cache-control', 'private, max-age=3600')
  res.sendFile(abs)
}

export function dataUrl(rel) {
  try {
    const abs = path.resolve(STORAGE_DIR, rel || '')
    if (!rel || !abs.startsWith(STORAGE_DIR + path.sep) || !fs.existsSync(abs)) return null
    const ext = path.extname(abs).slice(1)
    return `data:${TYPES[ext]?.mime || 'image/png'};base64,${fs.readFileSync(abs).toString('base64')}`
  } catch { return null }
}
