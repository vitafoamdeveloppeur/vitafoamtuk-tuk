import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api, qs } from '../lib/api.js'
import { couleur, lib } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { iconClass } from '../lib/icons.js'

// ---------------------------------------------------------------- contexte de l'application
export const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)
export function useCan() {
  const { user } = useApp()
  return droit => !!user?.droits?.includes(droit)
}

export function Icon({ name, size, className = '' }) {
  return <i className={`ico ${iconClass(name)} ${className}`} style={size ? { fontSize: size } : undefined} aria-hidden="true" />
}

// ---------------------------------------------------------------- thème clair / sombre / système
const THEMES = ['system', 'light', 'dark']
const lireTheme = () => { try { return localStorage.getItem('tuktuk:theme') || 'system' } catch { return 'system' } }
export function appliquerTheme(t) {
  const sombre = t === 'dark' || (t === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = sombre ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sombre ? '#0b0f1a' : '#0c1445')
}
export function useTheme() {
  const [theme, setTheme] = useState(lireTheme)
  useEffect(() => {
    appliquerTheme(theme)
    try { localStorage.setItem('tuktuk:theme', theme) } catch { /* stockage indisponible */ }
    if (theme !== 'system') return undefined
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const f = () => appliquerTheme('system')
    mq?.addEventListener('change', f)
    return () => mq?.removeEventListener('change', f)
  }, [theme])
  const suivant = () => setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])
  return [theme, suivant]
}
export function ThemeToggle({ className = 'icon-btn' }) {
  const [theme, suivant] = useTheme()
  const info = { system: ['contrast', 'Thème du système'], light: ['light_mode', 'Thème clair'], dark: ['dark_mode', 'Thème sombre'] }[theme]
  return <button type="button" className={className} title={`${info[1]} (cliquer pour changer)`} aria-label={info[1]} onClick={suivant}><Icon name={info[0]} size={17} /></button>
}

export function Link({ to, children, className = '', title }) {
  return (
    <a href={to} className={className} title={title} onClick={e => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
      e.preventDefault()
      navigate(to)
    }}>{children}</a>
  )
}

export function Badge({ statut, refName, children, tone }) {
  const { ref } = useApp()
  const label = children ?? (refName ? lib(ref?.[refName], statut) : statut)
  return <span className={`badge badge-${tone || couleur(statut)}`}>{label}</span>
}

export function Button({ icon, children, variant = 'primary', busy, className = '', ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy ? <span className="spin" /> : icon && <Icon name={icon} size={18} />}
      {children && <span>{children}</span>}
    </button>
  )
}

export function PageHead({ title, subtitle, children, back }) {
  const app = useApp()
  const icone = app?.pageIcon
  return (
    <div className="page-head">
      <div className="page-titre">
        {icone && <span className="page-ico"><Icon name={icone} size={22} /></span>}
        <div>
          {back && <Link to={back} className="back"><Icon name="arrow_back" size={14} /> Retour</Link>}
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter(Boolean).map(t => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={18} />}{t.label}{t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** Onglets de navigation entre pages (ex. Rémunération = Commissions + Paiements) */
export function PageTabs({ tabs, current }) {
  const can = useCan()
  const visibles = tabs.filter(t => !t.droit || can(t.droit))
  if (visibles.length < 2) return null
  return (
    <div className="tabs page-tabs">
      {visibles.map(t => <Link key={t.to} to={t.to} className={current === t.to ? 'active' : ''}>{t.label}</Link>)}
    </div>
  )
}

export function Stat({ icon, label, value, hint, tone = 'blue', onClick }) {
  return (
    <div className={`stat stat-${tone}${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <div className="stat-top">
        <div className="stat-label">{label}</div>
        <div className="stat-ico"><Icon name={icon} size={18} /></div>
      </div>
      <div className="stat-body">
        <div className="stat-value">{value}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  )
}

export function Card({ title, actions, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-head"><h2>{title}</h2><div className="card-actions">{actions}</div></div>}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  )
}

export function Empty({ icon = 'inbox', children = 'Aucun élément.' }) {
  return <div className="empty"><Icon name={icon} size={36} /><p>{children}</p></div>
}

export function Loading() {
  return <div className="loading"><span className="spin big" /></div>
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null
  return <div className="alert alert-rouge"><Icon name="error" /><span>{error.message || String(error)}</span>{onRetry && <Button variant="ghost" onClick={onRetry}>Réessayer</Button>}</div>
}

export function Info({ tone = 'bleu', icon = 'info', children }) {
  return <div className={`alert alert-${tone}`}><Icon name={icon} /><div>{children}</div></div>
}

// ---------------------------------------------------------------- formulaires
export function Field({ label, hint, error, children, required, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}{required && <b className="req"> *</b>}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  )
}

export function Input({ value, onChange, ...p }) {
  return <input className="input" value={value ?? ''} onChange={e => onChange(e.target.value)} {...p} />
}
export function Textarea({ value, onChange, ...p }) {
  return <textarea className="input" rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} {...p} />
}
export function Select({ value, onChange, options, placeholder, ...p }) {
  const list = Array.isArray(options) ? options : Object.entries(options || {}).map(([v, l]) => ({ value: v, label: l }))
  return (
    <select className="input" value={value ?? ''} onChange={e => onChange(e.target.value)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {list.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
export function Check({ checked, onChange, label }) {
  return <label className="check"><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} /> <span>{label}</span></label>
}

// ---------------------------------------------------------------- modale
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="close" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** Petite modale de saisie d'un motif (rejet, suspension…) */
export function PromptModal({ title, label, confirm = 'Confirmer', onSubmit, onClose, required = true, danger }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const go = async () => {
    if (required && !v.trim()) return setErr(new Error('Ce champ est obligatoire.'))
    setBusy(true)
    try { await onSubmit(v.trim()); onClose() } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return (
    <Modal title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={go}>{confirm}</Button></>}>
      <ErrorBox error={err} />
      <Field label={label} required={required}><Textarea value={v} onChange={setV} autoFocus /></Field>
    </Modal>
  )
}

// ---------------------------------------------------------------- données
/** Charge une ressource de l'API ; reload() pour rafraîchir */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return undefined
    let vivant = true
    setState(s => ({ ...s, loading: true, error: null }))
    api(path).then(data => vivant && setState({ data, error: null, loading: false }))
      .catch(error => vivant && setState(s => ({ ...s, error, loading: false })))
    return () => { vivant = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps])
  return { ...state, reload: useCallback(() => setTick(t => t + 1), []) }
}

/** Filtres d'une liste mémorisés dans l'adresse (?statut=…) */
export function useFilters(defaults = {}) {
  const read = () => ({ ...defaults, ...Object.fromEntries(new URLSearchParams(window.location.search)) })
  const [f, setF] = useState(read)
  const set = (k, v) => {
    const patch = typeof k === 'object' ? k : { [k]: v }
    const next = { ...f, ...patch, ...('page' in patch ? {} : { page: '' }) }
    setF(next)
    const clean = Object.fromEntries(Object.entries(next).filter(([key, val]) => val !== '' && val != null && val !== defaults[key]))
    window.history.replaceState(null, '', `${window.location.pathname}${qs(clean)}`)
  }
  return [f, set, setF]
}

/** Tableau de données avec pagination serveur */
export function DataTable({ columns, rows, empty, onRow, selectable, selected, onSelect, rowKey = 'id' }) {
  if (!rows?.length) return <Empty>{empty}</Empty>
  const allSel = selectable && rows.every(r => selected?.includes(r[rowKey]))
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {selectable && <th className="col-check"><input type="checkbox" checked={allSel} onChange={e => onSelect(e.target.checked ? rows.filter(selectable).map(r => r[rowKey]) : [])} aria-label="Tout sélectionner" /></th>}
            {columns.map(c => <th key={c.key || c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r[rowKey]} className={onRow ? 'clickable' : ''} onClick={onRow ? e => { if (!e.target.closest('button,a,input,label')) onRow(r) } : undefined}>
              {selectable && <td className="col-check">{selectable(r) && <input type="checkbox" checked={selected.includes(r[rowKey])} onChange={e => onSelect(e.target.checked ? [...selected, r[rowKey]] : selected.filter(x => x !== r[rowKey]))} />}</td>}
              {columns.map(c => <td key={c.key || c.label} className={c.num ? 'num' : ''} data-label={c.label}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ data, onPage }) {
  if (!data || data.pages <= 1) return data?.total ? <div className="pager muted">{data.total} élément(s)</div> : null
  return (
    <div className="pager">
      <span className="muted">{data.total} élément(s) — page {data.page} / {data.pages}</span>
      <Button variant="ghost" icon="chevron_left" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} />
      <Button variant="ghost" icon="chevron_right" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)} />
    </div>
  )
}

export function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>
}

export function SearchBox({ value, onChange, placeholder = 'Rechercher…' }) {
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  useEffect(() => {
    if (v === (value || '')) return undefined
    const t = setTimeout(() => onChange(v), 350)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  return <label className="search"><Icon name="search" size={18} /><input value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} /></label>
}

export function AgenceSelect({ value, onChange, placeholder = 'Toutes les agences' }) {
  const { agences } = useApp()
  if (agences.length < 2 && placeholder) return null
  return <Select value={value} onChange={onChange} placeholder={placeholder} options={agences.map(a => ({ value: a.id, label: a.nom }))} />
}

export function PeriodePicker({ du, au, onChange }) {
  return (
    <div className="periode">
      <input type="date" className="input" value={du || ''} onChange={e => onChange(e.target.value, au)} aria-label="Du" />
      <span className="muted">au</span>
      <input type="date" className="input" value={au || ''} onChange={e => onChange(du, e.target.value)} aria-label="Au" />
    </div>
  )
}

// ---------------------------------------------------------------- signature au doigt ou à la souris
export function SignaturePad({ onChange }) {
  const canvas = useRef(null)
  const drawing = useRef(false)
  const vide = useRef(true)
  useEffect(() => {
    const c = canvas.current
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0c1445'
  }, [])
  const pos = e => { const r = canvas.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const down = e => { drawing.current = true; canvas.current.setPointerCapture(e.pointerId); const ctx = canvas.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(...pos(e)) }
  const move = e => { if (!drawing.current) return; const ctx = canvas.current.getContext('2d'); ctx.lineTo(...pos(e)); ctx.stroke(); vide.current = false }
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(vide.current ? null : canvas.current.toDataURL('image/png')) }
  const clear = () => { const c = canvas.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); vide.current = true; onChange(null) }
  return (
    <div className="sigpad">
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <div className="sigpad-foot"><span className="muted">Signez dans le cadre</span><Button variant="ghost" icon="restart_alt" onClick={clear}>Effacer</Button></div>
    </div>
  )
}

// ---------------------------------------------------------------- graphique en barres (SVG)
export function BarChart({ labels, series, height = 180, format = v => v }) {
  const max = Math.max(1, ...series.flatMap(s => s.values))
  const n = labels.length
  const w = 100 / n
  return (
    <div className="chart">
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label="Graphique">
        {labels.map((l, i) => series.map((s, j) => {
          const bw = (w * 0.7) / series.length
          const h = (s.values[i] / max) * (height / 3 - 2)
          return <rect key={`${i}-${j}`} x={i * w + w * 0.15 + j * bw} y={height / 3 - h} width={bw * 0.9} height={h} rx="0.6" className={`bar bar-${j}`}><title>{`${l} — ${s.label} : ${format(s.values[i])}`}</title></rect>
        }))}
      </svg>
      <div className="chart-x">{labels.map(l => <span key={l} style={{ width: `${w}%` }}>{l}</span>)}</div>
      <div className="chart-legend">{series.map((s, j) => <span key={s.label}><i className={`dot bar-${j}`} />{s.label}</span>)}</div>
    </div>
  )
}

/** Exécute une action, affiche le résultat dans un toast, puis rafraîchit */
export function useAction() {
  const { toast } = useApp()
  const [busy, setBusy] = useState(null)
  const run = async (key, fn, succes, after) => {
    setBusy(key)
    try {
      const r = await fn()
      if (succes) toast(typeof succes === 'function' ? succes(r) : succes)
      after?.(r)
      return r
    } catch (e) {
      toast(e.message, 'erreur')
      return undefined
    } finally {
      setBusy(null)
    }
  }
  return [busy, run]
}

export function DL({ items }) {
  return <dl className="dl">{items.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>
}

export function Timeline({ items }) {
  if (!items?.length) return <Empty icon="history">Aucun événement.</Empty>
  const ico = { visite: 'assignment', vente: 'receipt_long', commission: 'payments', paiement: 'account_balance_wallet', conducteur: 'electric_rickshaw', alerte: 'warning' }
  return (
    <ul className="timeline">
      {items.map(e => (
        <li key={e.id}><span className={`tl-ico tl-${e.type}`}><Icon name={ico[e.type] || 'circle'} size={16} /></span>
          <div><div>{e.libelle}</div><div className="muted small">{String(e.created_at).slice(8, 10)}/{String(e.created_at).slice(5, 7)}/{String(e.created_at).slice(0, 4)} {String(e.created_at).slice(11, 16)}{e.user_nom ? ` — ${e.user_nom}` : ''}</div></div>
        </li>
      ))}
    </ul>
  )
}
