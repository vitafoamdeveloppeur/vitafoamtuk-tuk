/**
 * Envoi des e-mails (SMTP du fichier .env) à partir des modèles modifiables dans les Paramètres
 */
import nodemailer from 'nodemailer'
import { queryOne } from './db.js'
import { escapeHtml } from './util.js'

let transport = null
export const mailConfigure = () => !!process.env.SMTP_HOST

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' } : undefined,
    })
  }
  return transport
}

const remplir = (modele, vars) => modele.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))

/** Envoie le modèle `cle` à une liste d'adresses. Sans SMTP configuré : rien n'est envoyé (journal console). */
export async function envoyerModele(cle, destinataires, vars = {}) {
  const adresses = [...new Set(destinataires.filter(Boolean))]
  if (!adresses.length) return 0
  const m = await queryOne('SELECT sujet, corps FROM modeles_email WHERE cle = ?', [cle])
  if (!m) return 0
  const sujet = remplir(m.sujet, vars)
  const corps = remplir(m.corps, vars)
  if (!mailConfigure()) {
    console.log(`[mail] SMTP non configuré : « ${sujet} » non envoyé à ${adresses.join(', ')}`)
    return 0
  }
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c2032;line-height:1.5">${escapeHtml(corps).replace(/\n/g, '<br>')}</div>`
  let n = 0
  for (const to of adresses) {
    try {
      await getTransport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject: sujet, text: corps, html })
      n++
    } catch (e) {
      console.error('[mail]', to, e.message)
    }
  }
  return n
}

export async function envoyerTest(to) {
  if (!mailConfigure()) throw new Error('SMTP non configuré dans le fichier .env (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM).')
  await getTransport().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject: 'Test Suivi Tuk-tuk', text: 'La configuration e-mail fonctionne.' })
}
