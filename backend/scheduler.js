/**
 * Tâches automatiques (remplacent le cron Laravel) : vérifiées chaque minute à l'heure de Madagascar.
 *  - Synchronisation Odoo toutes les N minutes (Paramètres)
 *  - 00:30 expiration des fiches · 06:00 contrôle du taux de transformation
 *  - 07:30 (lun-ven) rappel des commissions à valider · lundi 06:30 comptes-rendus de la semaine écoulée
 */
import { query, queryOne, execute } from './db.js'
import { now, dayOfWeek, ariary, parseJson } from './util.js'
import * as P from './parametres.js'
import * as Fiches from './fiches.js'
import * as Alertes from './alertes.js'
import * as CR from './comptes-rendus.js'
import * as Odoo from './odoo.js'
import { envoyerModele } from './mail.js'
import { roles } from './auth.js'

const dejaFait = new Set()
async function unefois(cle, tache) {
  if (dejaFait.has(cle)) return
  dejaFait.add(cle)
  try {
    const r = await tache()
    console.log(`[tâche] ${cle} : ${JSON.stringify(r)}`)
  } catch (e) {
    console.error(`[tâche] ${cle}`, e.message)
  }
}

async function rappelCommissions() {
  const rs = (await roles()).filter(r => r.cle === 'super-admin' || r.droits.includes('commissions.valider')).map(r => r.cle)
  const users = await query(`SELECT id, email, portee, role, notifications FROM utilisateurs WHERE actif = 1 AND role IN (${rs.map(() => '?').join(',')})`, rs)
  let n = 0
  for (const u of users) {
    if ((parseJson(u.notifications, {}) || {}).commissions === false) continue
    const toutes = u.portee === 'toutes' || u.role === 'super-admin'
    const agences = toutes ? await query('SELECT id, nom FROM agences') : await query('SELECT a.id, a.nom FROM agences a JOIN agence_utilisateur au ON au.agence_id = a.id WHERE au.user_id = ?', [u.id])
    if (!agences.length) continue
    const r = await queryOne(`SELECT COUNT(*) AS nb, COALESCE(SUM(montant), 0) AS total FROM commissions WHERE statut = 'a_valider' AND agence_id IN (${agences.map(() => '?').join(',')})`, agences.map(a => a.id))
    if (Number(r.nb) > 0) {
      n += await envoyerModele('commissions_a_valider', [u.email], { nombre: r.nb, montant: ariary(r.total), agences: agences.map(a => a.nom).join(', ') })
    }
  }
  return n
}

let derniereSynchro = 0
async function tick() {
  const t = now()
  const jour = t.slice(0, 10)
  const hm = t.slice(11, 16)
  const dow = dayOfWeek(jour)

  if (await Odoo.estActif()) {
    const intervalle = Math.max(5, await P.entier('odoo_intervalle_minutes')) * 60000
    if (Date.now() - derniereSynchro >= intervalle) {
      derniereSynchro = Date.now()
      Odoo.synchroniser(null).then(r => console.log('[odoo] synchronisation', JSON.stringify(r))).catch(e => console.error('[odoo]', e.message))
    }
  }
  if (hm >= '00:30') await unefois(`expiration:${jour}`, () => Fiches.expirer())
  if (hm >= '06:00') await unefois(`taux:${jour}`, () => Alertes.verifierTauxTransformation())
  if (dow <= 5 && hm >= '07:30' && hm < '12:00') await unefois(`rappel:${jour}`, rappelCommissions)
  if (dow === 1 && hm >= '06:30') await unefois(`cr:${jour}`, () => CR.genererSemaineEcoulee())
  // Ménage : sessions expirées et journal d'audit de plus de 400 jours
  if (hm >= '03:00') await unefois(`menage:${jour}`, async () => {
    await execute('DELETE FROM sessions WHERE expires_at < UNIX_TIMESTAMP()')
    await execute('DELETE FROM audit_log WHERE at < ?', [`${Number(jour.slice(0, 4)) - 1}${jour.slice(4)} 00:00:00`])
    return 'ok'
  })
}

export function demarrerTaches() {
  if (process.env.DISABLE_SCHEDULER === 'true') return
  // Au démarrage, les tâches du jour déjà passées ne sont pas rejouées en rafale : on attend la minute suivante
  setTimeout(() => {
    tick().catch(e => console.error('[tâches]', e.message))
    setInterval(() => tick().catch(e => console.error('[tâches]', e.message)), 60000).unref()
  }, 15000).unref()
}

export { rappelCommissions }
