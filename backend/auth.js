/**
 * Authentification, sessions, rôles et droits, portée par agence, comptes utilisateurs
 */
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { query, queryOne, execute, inList } from './db.js'
import { ApiError, text, now, nowSeconds, parseJson, normaliserTelephone, recordId } from './util.js'
import { ROLES, TOUS_DROITS, droitsParDefaut, PORTEE_PAR_DEFAUT } from './ref.js'
import { audit } from './journal.js'

export const COOKIE = 'tuktuk_session'
const TIMING_FALLBACK_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10)
const sha256 = v => crypto.createHash('sha256').update(v).digest('base64url')
export const hashPassword = p => bcrypt.hash(p, 12)

// ---------------------------------------------------------------- anti force brute
export async function assertNotLimited(cle, max, fenetre) {
  const row = await queryOne('SELECT nb, debut FROM tentatives WHERE cle = ?', [cle])
  if (row && row.debut > nowSeconds() - fenetre && row.nb >= max) {
    const minutes = Math.ceil((row.debut + fenetre - nowSeconds()) / 60)
    throw new ApiError(429, `Trop de tentatives. Réessayez dans ${minutes} minute(s).`)
  }
}
export async function registerAttempt(cle, fenetre) {
  const t = nowSeconds()
  await execute(`INSERT INTO tentatives (cle, nb, debut) VALUES (?, 1, ?)
    ON DUPLICATE KEY UPDATE nb = IF(debut < ?, 1, nb + 1), debut = IF(debut < ?, VALUES(debut), debut)`, [cle, t, t - fenetre, t - fenetre])
}
export const clearAttempts = cle => execute('DELETE FROM tentatives WHERE cle = ?', [cle])

// ---------------------------------------------------------------- rôles
export async function seedRoles() {
  const defauts = droitsParDefaut()
  for (const [cle, libelle] of Object.entries(ROLES)) {
    await execute('INSERT IGNORE INTO roles (cle, libelle, droits, portee_defaut, systeme) VALUES (?, ?, ?, ?, 1)',
      [cle, libelle, JSON.stringify(defauts[cle] || []), PORTEE_PAR_DEFAUT[cle] || 'agences'])
  }
}

let rolesCache = null
export async function roles() {
  if (!rolesCache) {
    const rows = await query('SELECT cle, libelle, droits, portee_defaut, systeme FROM roles ORDER BY systeme DESC, libelle')
    rolesCache = rows.map(r => ({ ...r, systeme: !!r.systeme, droits: parseJson(r.droits, []) || [] }))
  }
  return rolesCache
}
export const resetRolesCache = () => { rolesCache = null }

// ---------------------------------------------------------------- utilisateur courant
const USER_COLUMNS = 'u.id, u.nom, u.email, u.telephone, u.role, u.portee, u.actif, u.protege, u.mot_de_passe_provisoire, u.notifications, u.derniere_connexion_le'

async function enrichir(row) {
  const r = (await roles()).find(x => x.cle === row.role)
  const superAdmin = row.role === 'super-admin'
  const droits = superAdmin ? TOUS_DROITS : (r?.droits || [])
  const toutes = superAdmin || row.portee === 'toutes'
  const agenceIds = toutes
    ? (await query('SELECT id FROM agences')).map(a => a.id)
    : (await query('SELECT agence_id FROM agence_utilisateur WHERE user_id = ?', [row.id])).map(a => a.agence_id)
  return {
    id: row.id, nom: row.nom, email: row.email, telephone: row.telephone, role: row.role, roleLibelle: r?.libelle || row.role,
    portee: toutes ? 'toutes' : 'agences', actif: !!row.actif, protege: !!row.protege,
    motDePasseProvisoire: !!row.mot_de_passe_provisoire,
    notifications: { commissions: true, alertes: true, compte_rendu: true, ...(parseJson(row.notifications, {}) || {}) },
    droits, agenceIds,
  }
}

export const can = (user, droit) => !!user?.droits?.includes(droit)
export function assertCan(user, droit) {
  if (!can(user, droit)) throw new ApiError(403, "Vous n'avez pas le droit d'effectuer cette action.")
}
/** L'objet (ligne avec agence_id) est-il dans la portée de l'utilisateur ? */
export function assertAgence(user, agenceId) {
  if (!user.agenceIds.includes(Number(agenceId))) throw new ApiError(403, "Vous n'avez pas accès à cette agence.")
}
/** Clause SQL « alias.agence_id IN (…) » pour la portée de l'utilisateur, éventuellement filtrée sur une agence */
export function scope(user, alias, agenceFiltre) {
  let ids = user.agenceIds
  if (agenceFiltre) ids = ids.filter(id => id === Number(agenceFiltre))
  return { sql: `${alias}.agence_id IN (${inList(ids)})`, params: ids }
}

export async function getUser(req) {
  const token = req.cookies?.[COOKIE]
  if (!token) return null
  const row = await queryOne(`SELECT ${USER_COLUMNS} FROM sessions s JOIN utilisateurs u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`, [sha256(token), nowSeconds()])
  return row && row.actif ? enrichir(row) : null
}

export async function requireUser(req) {
  const user = await getUser(req)
  if (!user) throw new ApiError(401, 'Session expirée. Connectez-vous à nouveau.')
  return user
}

// ---------------------------------------------------------------- premier compte
export async function seedAdmin() {
  await seedRoles()
  if (await queryOne('SELECT id FROM utilisateurs LIMIT 1')) return
  const email = (process.env.ADMIN_EMAIL || 'admin@vitafoam.mg').toLowerCase()
  const mdp = process.env.ADMIN_INITIAL_PASSWORD || ''
  if (mdp.length < 10 || /CHANGEZ_MOI/i.test(mdp)) {
    throw new Error('ADMIN_INITIAL_PASSWORD absent, trop court (10 caractères minimum) ou laissé à la valeur d’exemple : compte administrateur non créé.')
  }
  await execute(`INSERT INTO utilisateurs (nom, email, password_hash, role, portee, actif, protege, mot_de_passe_provisoire, created_at)
    VALUES ('Administrateur', ?, ?, 'super-admin', 'toutes', 1, 1, 1, ?)`, [email, await hashPassword(mdp), now()])
  console.log(`[seed] Super administrateur créé : ${email} (mot de passe à changer à la première connexion).`)
}

// ---------------------------------------------------------------- sessions
function cookieOptions(req, maxAgeMs) {
  const forced = process.env.COOKIE_SECURE
  return {
    httpOnly: true,
    secure: forced === 'true' ? true : forced === 'false' ? false : req.secure,
    sameSite: 'lax', maxAge: maxAgeMs, path: '/',
  }
}

export async function login(req, res) {
  await seedAdmin()
  const b = req.body || {}
  const email = String(b.email || '').trim().toLowerCase().slice(0, 190)
  const ip = req.ip || '?'
  await assertNotLimited(`login:${email}:${ip}`, 5, 900)
  await assertNotLimited(`login-user:${email}`, 30, 900)
  const row = await queryOne(`SELECT ${USER_COLUMNS}, u.password_hash FROM utilisateurs u WHERE u.email = ?`, [email])
  const password = String(b.password || '').slice(0, 200)
  const ok = row ? await bcrypt.compare(password, row.password_hash) : await bcrypt.compare(password, TIMING_FALLBACK_HASH) && false
  if (!ok || !row.actif) {
    await registerAttempt(`login:${email}:${ip}`, 900)
    await registerAttempt(`login-user:${email}`, 900)
    await audit(req, null, 'connexion_echec', 'utilisateurs', '', `E-mail « ${email} »`)
    throw new ApiError(401, row && !row.actif && ok ? 'Compte désactivé.' : 'E-mail ou mot de passe incorrect.')
  }
  await clearAttempts(`login:${email}:${ip}`)
  const token = crypto.randomBytes(32).toString('base64url')
  const ttl = b.remember === true ? 30 * 86400 : 12 * 3600
  const t = nowSeconds()
  await execute('DELETE FROM sessions WHERE expires_at < ?', [t])
  await execute('DELETE FROM tentatives WHERE debut < ?', [t - 86400])
  await execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), row.id, t + ttl])
  await execute('UPDATE utilisateurs SET derniere_connexion_le = ? WHERE id = ?', [now(), row.id])
  const user = await enrichir(row)
  await audit(req, user, 'connexion', 'utilisateurs', row.id)
  res.cookie(COOKIE, token, cookieOptions(req, ttl * 1000))
  return { user }
}

export async function logout(req, res) {
  const token = req.cookies?.[COOKIE]
  if (token) await execute('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)])
  res.clearCookie(COOKIE, { ...cookieOptions(req, 0), maxAge: undefined })
  return { ok: true }
}

export async function changePassword(req, user) {
  const b = req.body || {}
  const actuel = String(b.actuel || '').slice(0, 200)
  const nouveau = String(b.nouveau || '')
  await assertNotLimited(`password:${user.id}`, 5, 900)
  if (nouveau.length < 10 || nouveau.length > 200) throw new ApiError(422, 'Le nouveau mot de passe doit contenir au moins 10 caractères.')
  if (nouveau === actuel) throw new ApiError(422, 'Le nouveau mot de passe doit être différent de l’actuel.')
  const row = await queryOne('SELECT password_hash FROM utilisateurs WHERE id = ?', [user.id])
  if (!(await bcrypt.compare(actuel, row.password_hash))) {
    await registerAttempt(`password:${user.id}`, 900)
    throw new ApiError(403, 'Le mot de passe actuel est incorrect.')
  }
  await execute('UPDATE utilisateurs SET password_hash = ?, mot_de_passe_provisoire = 0, updated_at = ? WHERE id = ?', [await hashPassword(nouveau), now(), user.id])
  await execute('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [user.id, sha256(req.cookies?.[COOKIE] || '')])
  await clearAttempts(`password:${user.id}`)
  await audit(req, user, 'mot_de_passe', 'utilisateurs', user.id, 'Mot de passe modifié')
  return { ok: true }
}

export async function saveNotifications(req, user) {
  const n = req.body?.notifications || {}
  const val = { commissions: n.commissions !== false, alertes: n.alertes !== false, compte_rendu: n.compte_rendu !== false }
  await execute('UPDATE utilisateurs SET notifications = ? WHERE id = ?', [JSON.stringify(val), user.id])
  return { ok: true }
}

// ---------------------------------------------------------------- administration des comptes
export async function listUsers() {
  const rows = await query(`SELECT ${USER_COLUMNS}, u.created_at FROM utilisateurs u ORDER BY u.nom`)
  const liens = await query('SELECT agence_id, user_id FROM agence_utilisateur')
  return rows.map(r => ({
    id: r.id, nom: r.nom, email: r.email, telephone: r.telephone, role: r.role, portee: r.portee, actif: !!r.actif,
    protege: !!r.protege, motDePasseProvisoire: !!r.mot_de_passe_provisoire, derniereConnexion: r.derniere_connexion_le,
    agences: liens.filter(l => l.user_id === r.id).map(l => l.agence_id),
  }))
}

export async function saveUser(req, current, idParam) {
  const b = req.body || {}
  const id = idParam ? recordId(idParam) : null
  assertCan(current, id ? 'utilisateurs.modifier' : 'utilisateurs.creer')
  const existant = id ? await queryOne('SELECT id, protege, role FROM utilisateurs WHERE id = ?', [id]) : null
  if (id && !existant) throw new ApiError(404, 'Utilisateur introuvable.')
  const nom = text(b.nom, 'Nom', { required: true, max: 150 })
  const email = text(b.email, 'E-mail', { required: true, max: 190 }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'E-mail invalide.')
  const telephone = b.telephone ? normaliserTelephone(b.telephone) : null
  if (b.telephone && !telephone) throw new ApiError(422, 'Téléphone invalide.')
  const role = String(b.role || '')
  if (!(await roles()).some(r => r.cle === role)) throw new ApiError(422, 'Rôle invalide.')
  if (role === 'super-admin' && current.role !== 'super-admin') throw new ApiError(403, 'Seul un super administrateur peut attribuer ce rôle.')
  const portee = b.portee === 'toutes' ? 'toutes' : 'agences'
  const actif = b.actif !== false
  const agences = [...new Set((Array.isArray(b.agences) ? b.agences : []).map(Number).filter(Number.isSafeInteger))]
  if (existant?.protege && (role !== 'super-admin' || !actif)) throw new ApiError(403, 'Le compte administrateur initial reste super administrateur et actif.')
  if (id === current.id && (!actif || role !== current.role)) throw new ApiError(422, 'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte.')
  const mdp = b.motDePasse ? String(b.motDePasse) : ''
  if ((!id || mdp) && (mdp.length < 10 || mdp.length > 200)) throw new ApiError(422, 'Le mot de passe doit contenir au moins 10 caractères.')
  let userId = id
  try {
    if (id) {
      await execute('UPDATE utilisateurs SET nom = ?, email = ?, telephone = ?, role = ?, portee = ?, actif = ?, updated_at = ? WHERE id = ?',
        [nom, email, telephone, role, portee, actif ? 1 : 0, now(), id])
      if (mdp) await execute('UPDATE utilisateurs SET password_hash = ?, mot_de_passe_provisoire = 1 WHERE id = ?', [await hashPassword(mdp), id])
    } else {
      const r = await execute(`INSERT INTO utilisateurs (nom, email, telephone, password_hash, role, portee, actif, mot_de_passe_provisoire, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`, [nom, email, telephone, await hashPassword(mdp), role, portee, actif ? 1 : 0, now()])
      userId = r.insertId
    }
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'Cet e-mail est déjà utilisé.')
    throw e
  }
  await execute('DELETE FROM agence_utilisateur WHERE user_id = ?', [userId])
  for (const a of agences) await execute('INSERT IGNORE INTO agence_utilisateur (agence_id, user_id) SELECT id, ? FROM agences WHERE id = ?', [userId, a])
  if (id && (mdp || !actif)) await execute('DELETE FROM sessions WHERE user_id = ?', [id])
  await audit(req, current, id ? 'modifier' : 'creer', 'utilisateurs', userId, `${email} (${role})`)
  return { ok: true, id: userId }
}

export async function saveRole(req, current, cleParam) {
  assertCan(current, 'roles.modifier')
  const b = req.body || {}
  const cle = cleParam || text(b.cle, 'Code du rôle', { required: true, max: 40 }).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  if (cle === 'super-admin') throw new ApiError(403, 'Le super administrateur a toujours tous les droits.')
  const droits = (Array.isArray(b.droits) ? b.droits : []).filter(d => TOUS_DROITS.includes(d))
  const libelle = text(b.libelle, 'Libellé', { required: true, max: 100 })
  const portee = b.portee_defaut === 'toutes' ? 'toutes' : 'agences'
  await execute(`INSERT INTO roles (cle, libelle, droits, portee_defaut, systeme) VALUES (?, ?, ?, ?, 0)
    ON DUPLICATE KEY UPDATE libelle = VALUES(libelle), droits = VALUES(droits), portee_defaut = VALUES(portee_defaut)`,
  [cle, libelle, JSON.stringify(droits), portee])
  resetRolesCache()
  await audit(req, current, 'modifier', 'roles', cle, `${droits.length} droit(s)`)
  return { ok: true }
}

/** Responsables à notifier pour une agence (droit de valider les fiches ou les commissions) */
export async function responsablesAgence(agenceId, typeNotif) {
  const rs = (await roles()).filter(r => r.droits.includes('fiches.valider') || r.droits.includes('commissions.valider')).map(r => r.cle)
  const rows = await query(`SELECT DISTINCT u.id, u.nom, u.email, u.notifications FROM utilisateurs u
    LEFT JOIN agence_utilisateur au ON au.user_id = u.id
    WHERE u.actif = 1 AND u.role IN (${inList(rs)}) AND (u.portee = 'toutes' OR au.agence_id = ?)
      AND u.role NOT IN ('super-admin', 'direction', 'auditeur')`, [...rs, agenceId])
  return rows.filter(u => (parseJson(u.notifications, {}) || {})[typeNotif] !== false)
}

export async function utilisateursRole(roleCles, typeNotif) {
  const rows = await query(`SELECT id, nom, email, notifications FROM utilisateurs WHERE actif = 1 AND role IN (${inList(roleCles)})`, roleCles)
  return rows.filter(u => (parseJson(u.notifications, {}) || {})[typeNotif] !== false)
}
