import { useState } from 'react'
import { post } from '../lib/api.js'
import { Button, ErrorBox, Field, Input, Check } from '../components/ui.jsx'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async e => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { onLogin((await post('auth/login', { email, password, remember })).user) } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <div className="auth">
      <div className="auth-visuel" style={{ backgroundImage: 'url(/connexion-tuktuk.webp)' }}>
        <div className="auth-visuel-txt"><h2>Programme partenaires</h2><p>Tuk-tuk et cyclo-pousse : chaque client amené en agence est suivi, de la visite jusqu'à la commission.</p></div>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <img src="/vitafoam-logo.png" alt="Vitafoam" className="auth-logo" />
        <h1>Suivi Tuk-tuk & Cyclo</h1>
        <p className="muted">Connectez-vous avec votre adresse e-mail.</p>
        <ErrorBox error={error} />
        <Field label="E-mail"><Input type="email" value={email} onChange={setEmail} autoComplete="username" required autoFocus /></Field>
        <Field label="Mot de passe"><Input type="password" value={password} onChange={setPassword} autoComplete="current-password" required /></Field>
        <Check checked={remember} onChange={setRemember} label="Rester connecté 30 jours sur cet appareil" />
        <Button type="submit" busy={busy} className="btn-block">Se connecter</Button>
        <p className="muted small">Mot de passe oublié : demandez à un administrateur de le réinitialiser.</p>
      </form>
    </div>
  )
}

export function ChangerMotDePasse({ onDone, onLogout }) {
  const [actuel, setActuel] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirme, setConfirme] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const submit = async e => {
    e.preventDefault()
    if (nouveau !== confirme) return setError(new Error('Les deux nouveaux mots de passe ne correspondent pas.'))
    setBusy(true)
    setError(null)
    try { await post('auth/password', { actuel, nouveau }); onDone() } catch (err) { setError(err) } finally { setBusy(false) }
  }
  return (
    <div className="auth auth-seul">
      <form className="auth-form" onSubmit={submit}>
        <img src="/vitafoam-logo.png" alt="Vitafoam" className="auth-logo" />
        <h1>Nouveau mot de passe</h1>
        <p className="muted">Votre mot de passe est provisoire : choisissez-en un nouveau (10 caractères minimum).</p>
        <ErrorBox error={error} />
        <Field label="Mot de passe actuel"><Input type="password" value={actuel} onChange={setActuel} autoComplete="current-password" required /></Field>
        <Field label="Nouveau mot de passe"><Input type="password" value={nouveau} onChange={setNouveau} autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirmer"><Input type="password" value={confirme} onChange={setConfirme} autoComplete="new-password" required /></Field>
        <Button type="submit" busy={busy} className="btn-block">Enregistrer</Button>
        <Button variant="ghost" onClick={onLogout} className="btn-block">Se déconnecter</Button>
      </form>
    </div>
  )
}
