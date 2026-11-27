import { useState } from 'react'
import { post, qs, exportUrl, docUrl } from '../lib/api.js'
import { ariary, dateFr, nomComplet } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import {
  useApp, useCan, useApi, useFilters, useAction, PageHead, PageTabs, Card, DataTable, Pagination, Toolbar, SearchBox, Select, AgenceSelect, PeriodePicker,
  Badge, Button, ErrorBox, Loading, PromptModal, Link, Icon, Stat, Info,
} from '../components/ui.jsx'
import { Controles } from './Fiches.jsx'

const ONGLETS = [{ to: '/commissions', label: 'Commissions', droit: 'commissions.lire' }, { to: '/paiements', label: 'Paiements', droit: 'paiements.lire' }]

export default function Remuneration({ path }) {
  return path === '/paiements' ? <Paiements /> : <Commissions />
}

function Commissions() {
  const { ref } = useApp()
  const can = useCan()
  const [f, set] = useFilters({ statut: 'a_valider' })
  const [sel, setSel] = useState([])
  const [ouvert, setOuvert] = useState(null)
  const [rejet, setRejet] = useState(null)
  const [busy, run] = useAction()
  const { data, error, loading, reload } = useApi(`commissions${qs(f)}`)
  const tot = Object.fromEntries((data?.totaux || []).map(t => [t.statut, t]))
  return (
    <>
      <PageHead title="Rémunération" subtitle="Commissions des conducteurs : contrôle, validation par le Responsable, paiement">
        {can('commissions.exporter') && <a className="btn btn-ghost" href={exportUrl('commissions', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/commissions" />
      <div className="stats">
        {['a_valider', 'validee', 'bloquee', 'payee'].map(s => (
          <Stat key={s} icon={{ a_valider: 'hourglass_top', validee: 'verified', bloquee: 'lock', payee: 'paid' }[s]} label={ref.STATUTS_COMMISSION[s]}
            value={ariary(tot[s]?.total)} hint={`${tot[s]?.nb || 0} ligne(s)`} tone={{ a_valider: 'amber', validee: 'blue', bloquee: 'red', payee: 'green' }[s]} onClick={() => set('statut', s)} />
        ))}
      </div>
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="Code conducteur, client, n° de fiche" />
        <Select value={f.statut} onChange={v => set('statut', v)} options={ref.STATUTS_COMMISSION} placeholder="Tous les statuts" />
        <Select value={f.type} onChange={v => set('type', v)} options={ref.TYPES_COMMISSION} placeholder="Tous les types" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
        <PeriodePicker du={f.du} au={f.au} onChange={(du, au) => set({ du, au })} />
      </Toolbar>
      {can('commissions.valider') && sel.length > 0 && (
        <div className="selection-bar"><span>{sel.length} commission(s)</span>
          <Button icon="done_all" busy={busy === 'g'} onClick={() => run('g', () => post('commissions/valider-groupe', { ids: sel }), r => `${r.ok} validée(s)${r.erreurs.length ? ` — ${r.erreurs.length} refus : ${r.erreurs[0]}` : ''}`, () => { setSel([]); reload() })}>Valider</Button>
          <Button variant="ghost" onClick={() => setSel([])}>Annuler</Button></div>
      )}
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucune commission." selectable={can('commissions.valider') ? r => r.statut === 'a_valider' : null} selected={sel} onSelect={setSel}
            onRow={r => setOuvert(ouvert === r.id ? null : r.id)} columns={[
              { label: 'Date', render: r => dateFr(r.created_at) },
              { label: 'Conducteur', render: r => <Link to={`/conducteurs/${r.conducteur_id}`}><b>{r.conducteur_code}</b></Link> },
              { label: 'Client / fiche', render: r => <>{nomComplet(r.client_nom, r.client_prenom)}<div className="muted small">{r.fiche ? <Link to={`/fiches/${r.fiche_suivi_id}`}>{r.fiche}</Link> : '—'}{r.vente_reference ? ` · ${r.vente_reference}` : ''}</div></> },
              { label: 'Type', render: r => <>{ref.TYPES_COMMISSION[r.type]}<div className="muted small">{ref.NIVEAUX[r.niveau]}</div></> },
              { label: 'Calcul', render: r => (r.type === 'complement' ? <span className="small">{ariary(r.montant_bareme)} − {ariary(r.montant_deduit)}</span> : <span className="muted small">barème {ariary(r.montant_bareme)}</span>) },
              { label: 'Montant', num: true, render: r => <b>{ariary(r.montant)}</b> },
              { label: 'Statut', render: r => <><Badge statut={r.statut} refName="STATUTS_COMMISSION" />{r.motif && <div className="muted small">{r.motif}</div>}{ouvert === r.id && <Controles controles={r.controles} />}</> },
              can('commissions.valider') && { label: '', render: r => (
                <div className="row-actions">
                  {r.statut === 'a_valider' && <Button variant="ghost" icon="check" title="Valider" busy={busy === r.id} onClick={() => run(r.id, () => post(`commissions/${r.id}/valider`), 'Commission validée.', reload)} />}
                  {['a_valider', 'bloquee'].includes(r.statut) && <Button variant="ghost" icon="block" title="Rejeter" onClick={() => setRejet(r)} />}
                </div>
              ) },
            ].filter(Boolean)} />
        )}
      </Card>
      <p className="muted small">Cliquez sur une ligne pour voir la chaîne de contrôle (conducteur actif, attribution, visite validée, facture encaissée dans le délai).</p>
      <Pagination data={data} onPage={p => set('page', p)} />
      {rejet && <PromptModal title={`Rejeter la commission de ${rejet.conducteur_code}`} label="Motif du rejet" confirm="Rejeter" danger onClose={() => setRejet(null)} onSubmit={async m => { await post(`commissions/${rejet.id}/rejeter`, { motif: m }); reload() }} />}
    </>
  )
}

function Paiements() {
  const { ref } = useApp()
  const can = useCan()
  const [f, set] = useFilters({})
  const etat = useApi(`paiements/etat${qs({ agence: f.agence })}`)
  const { data, error, loading, reload } = useApi(`paiements${qs(f)}`)
  const jours = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
  const totalNet = (etat.data?.lignes || []).reduce((s, l) => s + l.net, 0)
  return (
    <>
      <PageHead title="Rémunération" subtitle="Paiement hebdomadaire des conducteurs">
        {can('paiements.exporter') && <a className="btn btn-ghost" href={exportUrl('paiements', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/paiements" />
      <Toolbar><AgenceSelect value={f.agence} onChange={v => set('agence', v)} /></Toolbar>
      <Card title={`À payer${etat.data ? ` (jour de paiement : ${jours[etat.data.jour_paiement]})` : ''}`} actions={<b>{ariary(totalNet)}</b>} pad={false}>
        {etat.loading && !etat.data ? <Loading /> : (
          <DataTable rows={(etat.data?.lignes || []).map(l => ({ ...l, id: l.conducteur_id }))} empty="Aucune commission validée en attente de paiement." columns={[
            { label: 'Conducteur', render: l => <><b>{l.code}</b><div className="muted small">{nomComplet(l.nom, l.prenom)}</div></> },
            { label: 'Agence', key: 'agence' }, { label: 'Paiement', render: l => (l.mode_paiement === 'mobile_money' ? ref.OPERATEURS[l.operateur_mobile] : 'Espèces') },
            { label: 'Commissions', num: true, render: l => `${ariary(l.commissions)} (${l.nb})` }, { label: 'Régularisations', num: true, render: l => ariary(l.regularisations) },
            { label: 'Net', num: true, render: l => <b>{ariary(l.net)}</b> },
            can('paiements.payer') && { label: '', render: l => l.net > 0 && <Button icon="payments" onClick={() => navigate(`/conducteurs/${l.conducteur_id}`)}>Payer</Button> },
          ].filter(Boolean)} />
        )}
      </Card>
      {can('paiements.payer') && <Info>Le paiement se fait depuis la fiche du conducteur : signature à l’écran pour les espèces, référence de transaction pour le Mobile Money. Le reçu est imprimable aussitôt.</Info>}
      <h2 className="section-title">Historique des paiements</h2>
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="N° de paiement, code ou nom du conducteur" />
        <Select value={f.mode} onChange={v => set('mode', v)} options={ref.MODES_PAIEMENT} placeholder="Tous les modes" />
        <PeriodePicker du={f.du} au={f.au} onChange={(du, au) => set({ du, au })} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucun paiement." columns={[
            { label: 'N°', render: p => <b>{p.numero}</b> }, { label: 'Payé le', render: p => dateFr(p.paye_le) },
            { label: 'Conducteur', render: p => <Link to={`/conducteurs/${p.conducteur_id}`}>{p.conducteur_code}</Link> }, { label: 'Agence', key: 'agence' },
            { label: 'Mode', render: p => <>{ref.MODES_PAIEMENT[p.mode]}{p.reference_transaction && <div className="muted small">{p.reference_transaction}</div>}</> },
            { label: 'Net', num: true, render: p => <b>{ariary(p.montant_net)}</b> }, { label: 'Par', key: 'paye_par_nom' },
            { label: '', render: p => <a href={docUrl(`paiements/${p.id}/recu`)} target="_blank" rel="noreferrer"><Icon name="receipt" size={18} /> Reçu</a> },
          ]} />
        )}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
    </>
  )
}
