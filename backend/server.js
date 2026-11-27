/**
 * Suivi Tuk-tuk & Cyclo — API Express + MySQL
 * Sert aussi le frontend compilé (dist/) : Nginx relaie tout le trafic HTTPS vers ce serveur (port 3002).
 */
import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

import { ApiError } from './util.js'
import api from './api.js'
import { migrate } from './migrate.js'
import { seedAdmin } from './auth.js'
import { demarrerTaches } from './scheduler.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { version: APP_VERSION } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const app = express()
const PORT = Number(process.env.PORT || 3002)

app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback')
app.disable('x-powered-by')
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"],
      connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))
app.use((req, res, next) => { res.set('permissions-policy', 'camera=(self), geolocation=(), microphone=()'); next() })
// Photos des conducteurs (4 Mo) et signatures envoyées en base64 : corps JSON limité à 8 Mo
app.use(express.json({ limit: '8mb' }))
app.use(cookieParser())

app.use('/api/', rateLimit({ windowMs: 60000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes. Réessayez dans un instant.' } }))
app.use('/api/', (req, res, next) => {
  res.set('cache-control', 'no-store')
  // Protection CSRF : les requêtes qui modifient des données doivent venir du même site
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin
    if (origin) {
      let host = ''
      try { host = new URL(origin).host } catch { /* origine illisible */ }
      if (host !== req.headers.host) return next(new ApiError(403, 'Origine non autorisée.'))
    }
  }
  next()
})
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }))
app.use('/api', api)
app.use('/api/', (req, res, next) => next(new ApiError(404, 'Service introuvable.')))

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') error = new ApiError(413, 'Envoi trop volumineux : utilisez une image plus légère.')
  else if (error.type === 'entity.parse.failed') error = new ApiError(400, 'Données envoyées illisibles.')
  if (!(error instanceof ApiError)) console.error('Erreur API', error)
  const status = error instanceof ApiError ? error.status : 500
  res.status(status).json({ error: error instanceof ApiError ? error.message : 'Erreur interne du serveur. Réessayez dans un instant.' })
})

// ---------------------------------------------------------------- frontend compilé
const distPath = path.join(__dirname, '..', 'dist')
app.use(express.static(distPath, {
  index: false,
  setHeaders: (res, filePath) => {
    const rel = path.relative(distPath, filePath).split(path.sep).join('/')
    res.set('cache-control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  },
}))
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), err => {
    if (err && !res.headersSent) res.status(404).send('Interface non compilée : lancez « npm run build » sur le serveur.')
  })
})
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (error instanceof URIError) return res.status(400).send('Adresse invalide.')
  console.error('Erreur serveur', error)
  res.status(500).send('Erreur interne du serveur.')
})

async function main() {
  if (process.env.NODE_ENV === 'production' && (process.env.SESSION_SECRET || '').length < 32) {
    console.error('[config] SESSION_SECRET absent ou trop court (32 caractères minimum) : générez-en un avec « openssl rand -hex 32 » dans .env puis redémarrez.')
    process.exit(1)
  }
  try { await migrate() } catch (e) { console.error('[migration]', e.message) }
  try { await seedAdmin() } catch (e) { console.error('[seed]', e.message) }
  demarrerTaches()
  const host = process.env.HOST || '127.0.0.1'
  app.listen(PORT, host, () => console.log(`Suivi Tuk-tuk ${APP_VERSION} — http://${host}:${PORT}`))
}

main()
