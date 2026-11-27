import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { api, post } from './lib/api.js'
import { navigate, useLocation, match } from './lib/router.js'
import { AppContext, Icon, Link, Loading, Button, ThemeToggle } from './components/ui.jsx'
import Login, { ChangerMotDePasse } from './pages/Login.jsx'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const NouveauClient = lazy(() => import('./pages/NouveauClient.jsx'))
const Fiches = lazy(() => import('./pages/Fiches.jsx'))
const Conducteurs = lazy(() => import('./pages/Conducteurs.jsx'))
const Clients = lazy(() => import('./pages/Clients.jsx'))
const Remuneration = lazy(() => import('./pages/Remuneration.jsx'))
const Alertes = lazy(() => import('./pages/Alertes.jsx'))
const Rapports = lazy(() => import('./pages/Rapports.jsx'))
const Journaux = lazy(() => import('./pages/Journaux.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const MonEspace = lazy(() => import('./pages/MonEspace.jsx'))

// Menu principal : [titre de groupe, [[libellé, icône, [[chemin, droit], …onglets], motifs actifs]]]
const MENU = [
  ['Travail du jour', [
    ['Tableau de bord', 'dashboard', [['/tableau-de-bord', 'tableau_bord.lire']]],
    ['Nouveau client', 'person_add', [['/fiches/nouvelle', 'fiches.creer']]],
    ['Fiches de suivi', 'assignment', [['/fiches', 'fiches.lire']], ['/fiches/']],
    ['Conducteurs', 'electric_rickshaw', [['/conducteurs', 'conducteurs.lire']], ['/conducteurs/']],
    ['Clients', 'groups', [['/clients', 'clients.lire'], ['/ventes', 'ventes.lire']], ['/clients/']],
  ]],
  ['Argent des conducteurs', [
    ['Rémunération', 'payments', [['/commissions', 'commissions.lire'], ['/paiements', 'paiements.lire']]],
    ['Alertes', 'warning', [['/alertes', 'alertes.lire']]],
  ]],
  ['Pilotage', [
    ['Rapports', 'bar_chart', [['/rapports', 'rapports.lire'], ['/comptes-rendus', 'comptes_rendus.lire']], ['/comptes-rendus/']],
    ['Journaux', 'history', [['/historique', 'historique.lire'], ['/audit', 'audit.lire'], ['/odoo', 'parametres.lire']]],
  ]],
  ['Administration', [
    ['Configuration', 'settings', [['/agences', 'agences.lire'], ['/utilisateurs', 'utilisateurs.lire'], ['/roles', 'roles.lire'], ['/parametres', 'parametres.lire']], ['/agences/']],
  ]],
]

const ROUTES = [
  ['/tableau-de-bord', Dashboard],
  ['/fiches/nouvelle', NouveauClient],
  ['/fiches', Fiches], ['/fiches/:id', Fiches],
  ['/conducteurs', Conducteurs], ['/conducteurs/nouveau', Conducteurs], ['/conducteurs/:id', Conducteurs], ['/conducteurs/:id/modifier', Conducteurs],
  ['/clients', Clients], ['/clients/:id', Clients], ['/ventes', Clients],
  ['/commissions', Remuneration], ['/paiements', Remuneration],
  ['/alertes', Alertes],
  ['/rapports', Rapports], ['/comptes-rendus', Rapports], ['/comptes-rendus/:id', Rapports],
  ['/historique', Journaux], ['/audit', Journaux], ['/odoo', Journaux],
  ['/agences', Admin], ['/agences/:id', Admin], ['/utilisateurs', Admin], ['/roles', Admin], ['/parametres', Admin],
  ['/mon-espace', MonEspace],
]

function sections(user) {
  const can = d => user.droits.includes(d)
  return MENU.map(([titre, entrees]) => [titre, entrees.map(([label, icon, onglets, autres = []]) => {
    const visibles = onglets.filter(([, d]) => can(d))
    return visibles.length ? { label, icon, to: visibles[0][0], actifs: [...visibles.map(o => o[0]), ...autres] } : null
  }).filter(Boolean)]).filter(([, e]) => e.length)
}
const estActif = (e, path) => e.actifs.some(a => (a.endsWith('/') ? path.startsWith(a) && path !== '/fiches/nouvelle' : path === a))

function Toasts({ items, onClose }) {
  return (
    <div className="toasts">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} role="status" onClick={() => onClose(t.id)}>
          <Icon name={t.type === 'erreur' ? 'error' : 'check_circle'} /> {t.message}
        </div>
      ))}
    </div>
  )
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return undefined }
    const t = setTimeout(() => api(`recherche?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes([])), 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="gsearch">
      <Icon name="search" size={18} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Code conducteur, client, téléphone, n° de fiche…" aria-label="Recherche" />
      {res.length > 0 && (
        <div className="gsearch-results">
          {res.map(r => <button type="button" key={r.lien} onClick={() => { setQ(''); navigate(r.lien) }}><span className="badge badge-gris">{r.type}</span> {r.label}</button>)}
        </div>
      )}
    </div>
  )
}

function Shell({ user, children, path, onLogout }) {
  const [ouvert, setOuvert] = useState(false)
  const menu = useMemo(() => sections(user), [user])
  useEffect(() => setOuvert(false), [path])
  return (
    <div className={`shell${ouvert ? ' menu-ouvert' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><img src="/vitafoam-logo.png" alt="" /><div><b>Suivi Tuk-tuk</b><small>& Cyclo-pousse</small></div></div>
        <nav>
          {menu.map(([titre, entrees]) => (
            <div key={titre} className="nav-group">
              <div className="nav-title">{titre}</div>
              {entrees.map(e => <Link key={e.label} to={e.to} className={`nav-item${estActif(e, path) ? ' active' : ''}`}><Icon name={e.icon} size={20} />{e.label}</Link>)}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">© {new Date().getFullYear()} Vitafoam Madagascar</div>
      </aside>
      <div className="overlay" onClick={() => setOuvert(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn burger" onClick={() => setOuvert(o => !o)} aria-label="Menu"><Icon name="menu" /></button>
          <GlobalSearch />
          <div className="topbar-right">
            <ThemeToggle />
            <Link to="/mon-espace" className="user-chip"><span className="avatar">{user.nom.slice(0, 1).toUpperCase()}</span><span className="user-txt"><b>{user.nom}</b><small>{user.roleLibelle}</small></span></Link>
            <button type="button" className="icon-btn" title="Déconnexion" onClick={onLogout}><Icon name="logout" /></button>
          </div>
        </header>
        <main className="content"><div className="page" key={path}>{children}</div></main>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(undefined)
  const [refData, setRefData] = useState(null)
  const [toasts, setToasts] = useState([])
  const { path, search } = useLocation()

  const toast = useCallback((message, type = 'succes') => {
    const id = Math.random()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), type === 'erreur' ? 6000 : 3200)
  }, [])

  const chargerRef = useCallback(() => api('ref').then(setRefData).catch(() => {}), [])
  useEffect(() => { api('auth/me').then(d => setUser(d.user)).catch(() => setUser(null)) }, [])
  useEffect(() => { if (user) chargerRef() }, [user, chargerRef])
  useEffect(() => {
    const f = () => setUser(null)
    window.addEventListener('tuktuk:unauthorized', f)
    return () => window.removeEventListener('tuktuk:unauthorized', f)
  }, [])
  useEffect(() => { if (user && path === '/') navigate(user.droits.includes('tableau_bord.lire') ? '/tableau-de-bord' : '/fiches/nouvelle', { replace: true }) }, [user, path])

  const logout = async () => { await post('auth/logout').catch(() => {}); setUser(null); navigate('/') }

  if (user === undefined) return <Loading />
  if (!user) return <Login onLogin={u => { setUser(u); navigate(window.location.pathname === '/' ? '/' : window.location.pathname) }} />
  if (user.motDePasseProvisoire) return <ChangerMotDePasse onDone={() => setUser({ ...user, motDePasseProvisoire: false })} onLogout={logout} />
  if (!refData) return <Loading />

  const ctx = { user, ref: refData.ref, agences: refData.agences, roles: refData.roles, odooUrl: refData.odooUrl, entreprise: refData.entreprise, toast, reloadRef: chargerRef, setUser }
  let Page = null
  let params = {}
  for (const [pattern, Comp] of ROUTES) {
    const m = match(pattern, path)
    if (m) { Page = Comp; params = m; break }
  }
  return (
    <AppContext.Provider value={ctx}>
      <Shell user={user} path={path} onLogout={logout}>
        <Suspense fallback={<Loading />}>
          {Page ? <Page key={path} path={path} params={params} search={search} /> : path === '/' ? <Loading /> : (
            <div className="empty"><Icon name="explore_off" size={40} /><p>Page introuvable.</p><Button onClick={() => navigate('/')}>Accueil</Button></div>
          )}
        </Suspense>
      </Shell>
      <Toasts items={toasts} onClose={id => setToasts(t => t.filter(x => x.id !== id))} />
    </AppContext.Provider>
  )
}
