import { useState } from 'react'
import { post } from '../lib/api.js'
import { Button, ErrorBox, Field, Input, Check, Icon, ThemeToggle } from '../components/ui.jsx'

/** Champ mot de passe avec bouton « afficher / masquer » */
function MotDePasse(props) {
  const [voir, setVoir] = useState(false)
  return (
    <div className="champ-mdp">
      <Input {...props} type={voir ? 'text' : 'password'} />
      <button type="button" onClick={() => setVoir(v => !v)} aria-label={voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}><Icon name={voir ? 'visibility_off' : 'visibility'} size={16} /></button>
    </div>
  )
}

/** Gabarit commun des pages de connexion : photo + formulaire */
function AuthPage({ titre, description, children, pied, photo = true }) {
  return (
    <div className={`auth${photo ? '' : ' auth-seul'}`}>
      {photo && (
        <section className="auth-visuel">
          <img className="auth-photo-img" src="/connexion-tuktuk.webp" alt="Tuk-tuk partenaires sur une route de Madagascar" />
          <div className="auth-voile" />
          <div className="auth-visuel-txt">
            <img src="/vitafoam-logo.png" alt="Vitafoam" className="auth-visuel-logo" />
            <div className="auth-legende"><h2>Suivi Tuk-tuk &amp; Cyclo</h2><p>Partenaires conducteurs tuk-tuk et cyclo-pousse : chaque client amené en agence est suivi, de la visite jusqu'à la commission.</p></div>
          </div>
        </section>
      )}
      <main className="auth-cote">
        <div className="auth-theme"><ThemeToggle className="icon-btn rond" /></div>
        <div className="auth-form">
          <div className="auth-marque"><span><Icon name="electric_rickshaw" size={22} /></span><div><b>Suivi Tuk-tuk &amp; Cyclo</b><small>VITAFOAM</small></div></div>
          <h1>{titre}</h1>
          <p className="auth-desc">{description}</p>
          {children}
          {pied && <p className="auth-pied">{pied}</p>}
        </div>
        <footer className="auth-footer">© {new Date().getFullYear()} VITAFOAM · Suivi Tuk-tuk &amp; Cyclo</footer>
      </main>
    </div>
  )
}

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
    <AuthPage titre="Connexion" description="Connectez-vous avec votre adresse e-mail et votre mot de passe." pied="Mot de passe oublié : demandez à un administrateur de le réinitialiser.">
      <form className="auth-formulaire" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="E-mail"><Input type="email" value={email} onChange={setEmail} autoComplete="username" placeholder="nom@vitafoam.mg" required autoFocus /></Field>
        <Field label="Mot de passe"><MotDePasse value={password} onChange={setPassword} autoComplete="current-password" required /></Field>
        <Check checked={remember} onChange={setRemember} label="Rester connecté 30 jours sur cet appareil" />
        <Button type="submit" busy={busy} className="btn-block">Se connecter</Button>
      </form>
    </AuthPage>
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
    <AuthPage titre="Nouveau mot de passe" description="Votre mot de passe est provisoire : choisissez-en un nouveau (10 caractères minimum).">
      <form className="auth-formulaire" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Mot de passe actuel"><MotDePasse value={actuel} onChange={setActuel} autoComplete="current-password" required /></Field>
        <Field label="Nouveau mot de passe"><MotDePasse value={nouveau} onChange={setNouveau} autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirmer"><MotDePasse value={confirme} onChange={setConfirme} autoComplete="new-password" required /></Field>
        <Button type="submit" busy={busy} className="btn-block">Enregistrer</Button>
        <Button variant="ghost" onClick={onLogout} className="btn-block">Se déconnecter</Button>
      </form>
    </AuthPage>
  )
}
