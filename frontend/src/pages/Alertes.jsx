import { useState } from 'react'
import { post, qs } from '../lib/api.js'
import { dateFr } from '../lib/format.js'
import { useApp, useCan, useApi, useFilters, PageHead, Card, DataTable, Pagination, Toolbar, Select, AgenceSelect, Badge, Button, ErrorBox, Loading, Modal, Field, Textarea, Link } from '../components/ui.jsx'

const ACTIONS = { commentaire: 'Commentaire seulement', suspension: 'Suspendre le conducteur', blocage_commissions: 'Bloquer ses commissions', deblocage_commissions: 'Débloquer ses commissions' }

export default function Alertes() {
  const { ref } = useApp()
  const can = useCan()
  const [f, set] = useFilters({ statut: 'ouverte' })
  const [traiter, setTraiter] = useState(null)
  const { data, error, loading, reload } = useApi(`alertes${qs({ ...f, statut: f.statut === 'toutes' ? '' : f.statut })}`)
  return (
    <>
      <PageHead title="Alertes" subtitle="Contrôles anti-abus : visites excessives, taux de transformation faible, doublons, Odoo" />
      <Toolbar>
        <Select value={f.statut} onChange={v => set('statut', v)} options={{ ouverte: 'Ouvertes', traitee: 'Traitées', toutes: 'Toutes' }} />
        <Select value={f.type} onChange={v => set('type', v)} options={ref.TYPES_ALERTE} placeholder="Tous les types" />
        <Select value={f.gravite} onChange={v => set('gravite', v)} options={{ haute: 'Haute', moyenne: 'Moyenne', faible: 'Faible' }} placeholder="Toutes gravités" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucune alerte." columns={[
            { label: 'Date', render: a => dateFr(a.created_at) },
            { label: 'Type', render: a => <><Badge statut={a.gravite}>{a.gravite}</Badge><div className="small">{ref.TYPES_ALERTE[a.type]}</div></> },
            { label: 'Message', render: a => <>{a.message}{a.fiche && <div className="small"><Link to={`/fiches/${a.fiche_suivi_id}`}>{a.fiche}</Link></div>}</> },
            { label: 'Conducteur', render: a => (a.conducteur_id ? <Link to={`/conducteurs/${a.conducteur_id}`}>{a.conducteur_code}</Link> : '—') },
            { label: 'Agence', render: a => a.agence || 'Toutes' },
            { label: 'Statut', render: a => (a.statut === 'traitee' ? <><Badge statut="traitee">Traitée</Badge><div className="muted small">{ACTIONS[a.action] || a.action} — {a.traitee_par_nom} le {dateFr(a.traitee_le)}</div>{a.commentaire && <div className="small">« {a.commentaire} »</div>}</> : <Badge statut="orange">Ouverte</Badge>) },
            can('alertes.traiter') && { label: '', render: a => a.statut === 'ouverte' && <Button variant="ghost" icon="task_alt" onClick={() => setTraiter(a)}>Traiter</Button> },
          ].filter(Boolean)} />
        )}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
      {traiter && <ModaleTraiter alerte={traiter} onClose={() => setTraiter(null)} onDone={reload} />}
    </>
  )
}

function ModaleTraiter({ alerte, onClose, onDone }) {
  const { toast } = useApp()
  const [action, setAction] = useState('commentaire')
  const [commentaire, setCommentaire] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const options = alerte.conducteur_id ? ACTIONS : { commentaire: ACTIONS.commentaire }
  const go = async () => {
    setBusy(true)
    try { await post(`alertes/${alerte.id}/traiter`, { action, commentaire }); toast('Alerte traitée.'); onDone(); onClose() } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return (
    <Modal title="Traiter l'alerte" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={go}>Enregistrer</Button></>}>
      <ErrorBox error={err} />
      <p>{alerte.message}</p>
      <Field label="Décision"><Select value={action} onChange={setAction} options={options} /></Field>
      <Field label="Commentaire"><Textarea value={commentaire} onChange={setCommentaire} /></Field>
    </Modal>
  )
}
