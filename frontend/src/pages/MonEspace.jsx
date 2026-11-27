import { useState } from 'react'
import { post, put } from '../lib/api.js'
import { tel } from '../lib/format.js'
import { useApp, PageHead, Card, DL, Field, Input, Button, ErrorBox, Check } from '../components/ui.jsx'

export default function MonEspace() {
  const { user, toast, setUser, agences } = useApp()
  const [mdp, setMdp] = useState({ actuel: '', nouveau: '', confirme: '' })
  const [notif, setNotif] = useState(user.notifications)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const changer = async () => {
    if (mdp.nouveau !== mdp.confirme) return setErr(new Error('Les deux nouveaux mots de passe ne correspondent pas.'))
    setBusy(true)
    setErr(null)
    try { await post('auth/password', mdp); toast('Mot de passe modifié. Vos autres appareils sont déconnectés.'); setMdp({ actuel: '', nouveau: '', confirme: '' }) } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const saveNotif = async () => {
    try { await put('auth/notifications', { notifications: notif }); setUser({ ...user, notifications: notif }); toast('Préférences enregistrées.') } catch (e) { toast(e.message, 'erreur') }
  }
  return (
    <>
      <PageHead title="Mon espace" />
      <div className="grid-2">
        <Card title="Mon compte">
          <DL items={[['Nom', user.nom], ['E-mail', user.email], ['Téléphone', tel(user.telephone)], ['Rôle', user.roleLibelle],
            ['Agences', user.portee === 'toutes' ? 'Toutes les agences' : agences.map(a => a.nom).join(', ') || 'Aucune']]} />
        </Card>
        <Card title="Notifications par e-mail">
          <Check checked={notif.alertes} onChange={v => setNotif({ ...notif, alertes: v })} label="Nouvelles alertes" />
          <Check checked={notif.commissions} onChange={v => setNotif({ ...notif, commissions: v })} label="Rappel quotidien des commissions à valider" />
          <Check checked={notif.compte_rendu} onChange={v => setNotif({ ...notif, compte_rendu: v })} label="Comptes-rendus hebdomadaires" />
          <div className="form-actions"><Button onClick={saveNotif}>Enregistrer</Button></div>
        </Card>
      </div>
      <Card title="Changer mon mot de passe">
        <ErrorBox error={err} />
        <div className="form-grid">
          <Field label="Mot de passe actuel"><Input type="password" value={mdp.actuel} onChange={v => setMdp({ ...mdp, actuel: v })} autoComplete="current-password" /></Field>
          <span />
          <Field label="Nouveau mot de passe" hint="10 caractères minimum"><Input type="password" value={mdp.nouveau} onChange={v => setMdp({ ...mdp, nouveau: v })} autoComplete="new-password" /></Field>
          <Field label="Confirmer"><Input type="password" value={mdp.confirme} onChange={v => setMdp({ ...mdp, confirme: v })} autoComplete="new-password" /></Field>
        </div>
        <div className="form-actions"><Button busy={busy} onClick={changer}>Changer le mot de passe</Button></div>
      </Card>
    </>
  )
}
