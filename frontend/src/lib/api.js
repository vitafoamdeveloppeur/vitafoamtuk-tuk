// Couche API centralisée : délai maximal, messages d'erreur en français, signal de session expirée
export async function api(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(`/api/${path.replace(/^\//, '')}`, {
      method, credentials: 'same-origin', signal: controller.signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    throw new Error(cause?.name === 'AbortError' ? 'Le serveur met trop de temps à répondre. Réessayez.' : 'Connexion impossible. Vérifiez votre connexion Internet.')
  } finally {
    clearTimeout(timer)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('auth/')) window.dispatchEvent(new Event('tuktuk:unauthorized'))
    const e = new Error(data.error || `Erreur du serveur (code ${response.status}).`)
    e.status = response.status
    throw e
  }
  return data
}

export const post = (path, body = {}) => api(path, { method: 'POST', body })
export const put = (path, body = {}) => api(path, { method: 'PUT', body })
export const del = path => api(path, { method: 'DELETE' })

/** Construit une chaîne de requête en ignorant les valeurs vides */
export function qs(params) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) if (v !== '' && v != null && v !== false) s.set(k, v)
  const t = s.toString()
  return t ? `?${t}` : ''
}

/** Téléchargement CSV (le navigateur garde la session) */
export const exportUrl = (path, params) => `/api/${path}${qs({ ...params, format: 'csv', page: undefined })}`
export const docUrl = path => `/api/documents/${path}`

/** Lit une image choisie par l'utilisateur, la réduit (côté le plus long : max px) et renvoie une data URL JPEG */
export function lireImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Image illisible.'))
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * k)
        c.height = Math.round(img.height * k)
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
