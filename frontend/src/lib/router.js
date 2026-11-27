// Navigation minimale (adresses propres /conducteurs/12) sans dépendance externe
import { useEffect, useState } from 'react'

export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname + window.location.search) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to)
  window.dispatchEvent(new Event('tuktuk:navigate'))
  window.scrollTo(0, 0)
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }))
  useEffect(() => {
    const f = () => setLoc({ path: window.location.pathname, search: window.location.search })
    window.addEventListener('popstate', f)
    window.addEventListener('tuktuk:navigate', f)
    return () => { window.removeEventListener('popstate', f); window.removeEventListener('tuktuk:navigate', f) }
  }, [])
  return loc
}

/** Correspondance d'un motif « /conducteurs/:id » ; retourne les paramètres ou null */
export function match(pattern, path) {
  const p = pattern.split('/').filter(Boolean)
  const s = path.split('/').filter(Boolean)
  if (p.length !== s.length) return null
  const params = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i])
    else if (p[i] !== s[i]) return null
  }
  return params
}

export const queryParam = (name, search = window.location.search) => new URLSearchParams(search).get(name)
