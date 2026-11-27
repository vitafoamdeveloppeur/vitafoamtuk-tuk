import { useState } from 'react'
import { post, qs, exportUrl, docUrl } from '../lib/api.js'
import { ariary, dateFr, nombre, nomComplet, periodes, isoDate } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import {
  useApp, useCan, useApi, useFilters, PageHead, PageTabs, Card, DataTable, Pagination, Toolbar, Select, AgenceSelect, PeriodePicker,
  Badge, Button, ErrorBox, Loading, Modal, Field, Textarea, Input, Stat, BarChart, Icon, Info,
} from '../components/ui.jsx'

const ONGLETS = [{ to: '/rapports', label: 'Rapports', droit: 'rapports.lire' }, { to: '/comptes-rendus', label: 'Comptes-rendus', droit: 'comptes_rendus.lire' }]

export default function Rapports({ path, params }) {
  if (params.id) return <DetailCR id={params.id} />
  return path === '/comptes-rendus' ? <ListeCR /> : <Rapport />
}

function Rapport() {
  const { ref } = useApp()
  const can = useCan()
  const P = periodes()
  const [f, set] = useFilters({ du: P.mois.du, au: P.mois.au })
  const { data, error, loading, reload } = useApi(`rapports${qs(f)}`)
  const i = data?.indicateurs
  return (
    <>
      <PageHead title="Rapports" subtitle="Performance du programme par agence, par type de véhicule et par conducteur">
        {can('rapports.exporter') && <>
          <a className="btn btn-ghost" href={exportUrl('rapports', { ...f, vue: 'agences' })}><Icon name="download" size={18} /> Agences (CSV)</a>
          <a className="btn btn-ghost" href={exportUrl('rapports', { ...f, vue: 'conducteurs' })}><Icon name="download" size={18} /> Conducteurs (CSV)</a>
        </>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/rapports" />
      <Toolbar>
        <Select value="" onChange={k => k && set({ du: P[k].du, au: P[k].au })} options={Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.label]))} placeholder="Période rapide…" />
        <PeriodePicker du={f.du} au={f.au} onChange={(du, au) => set({ du, au })} />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
        <Select value={f.type} onChange={v => set('type', v)} options={ref.TYPES_VEHICULE} placeholder="Tuk-tuk et cyclo" />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="stats">
            <Stat icon="directions_walk" label="Clients orientés" value={nombre(i.clients_orientes)} hint={`${i.visites} visite(s)`} />
            <Stat icon="shopping_cart" label="Clients acheteurs" value={nombre(i.clients_acheteurs)} hint={`Taux ${i.taux_transformation} %`} tone="green" />
            <Stat icon="point_of_sale" label="CA encaissé" value={ariary(i.ca)} tone="violet" />
            <Stat icon="payments" label="Coût des commissions" value={ariary(i.cout_commissions)} hint={`${i.ratio_cout_ca} % du CA`} tone="amber" />
            <Stat icon="paid" label="Payé" value={ariary(i.commissions_payees)} hint={`Reste dû ${ariary(i.commissions_dues)}`} tone="teal" />
          </div>
          <Card title="12 dernières semaines">
            <BarChart labels={data.series.libelles} series={[{ label: 'Visites', values: data.series.visites }, { label: 'Acheteurs', values: data.series.acheteurs }]} />
          </Card>
          <div className="grid-2">
            <Card title="CA encaissé par semaine"><BarChart labels={data.series.libelles} series={[{ label: 'CA', values: data.series.ca }]} format={ariary} /></Card>
            <Card title="Commissions par semaine"><BarChart labels={data.series.libelles} series={[{ label: 'Commissions', values: data.series.commissions }]} format={ariary} /></Card>
          </div>
          <Card title="Par agence" pad={false}>
            <DataTable rows={data.agences.map(a => ({ ...a, id: a.agence.id }))} columns={[
              { label: 'Agence', render: a => <b>{a.agence.nom}</b> }, { label: 'Conducteurs', key: 'conducteurs_actifs', num: true }, { label: 'Visites', key: 'visites', num: true },
              { label: 'Orientés', key: 'clients_orientes', num: true }, { label: 'Acheteurs', key: 'clients_acheteurs', num: true }, { label: 'Taux', num: true, render: a => `${a.taux_transformation} %` },
              { label: 'CA', num: true, render: a => ariary(a.ca) }, { label: 'Commissions', num: true, render: a => ariary(a.cout_commissions) }, { label: 'Coût / CA', num: true, render: a => `${a.ratio_cout_ca} %` },
            ]} />
          </Card>
          <div className="grid-2">
            <Card title="Tuk-tuk / cyclo-pousse" pad={false}>
              <DataTable rows={Object.entries(data.parType).map(([t, v]) => ({ id: t, t, ...v }))} columns={[
                { label: 'Type', render: r => ref.TYPES_VEHICULE[r.t] }, { label: 'Orientés', key: 'clients_orientes', num: true }, { label: 'Acheteurs', key: 'clients_acheteurs', num: true },
                { label: 'Taux', num: true, render: r => `${r.taux_transformation} %` }, { label: 'CA', num: true, render: r => ariary(r.ca) },
              ]} />
            </Card>
            <Card title="Top 20 conducteurs" pad={false}>
              <DataTable rows={data.top.map(t => ({ ...t, id: t.conducteur.id }))} onRow={r => navigate(`/conducteurs/${r.id}`)} empty="Aucune visite." columns={[
                { label: 'Conducteur', render: r => <><b>{r.conducteur.code}</b> <span className="muted small">{nomComplet(r.conducteur.nom, r.conducteur.prenom)}</span></> },
                { label: 'Orientés', key: 'orientes', num: true }, { label: 'Acheteurs', key: 'acheteurs', num: true }, { label: 'CA', num: true, render: r => ariary(r.ca) },
              ]} />
            </Card>
          </div>
        </>
      )}
    </>
  )
}

function ListeCR() {
  const { agences, toast } = useApp()
  const can = useCan()
  const [f, set] = useFilters({})
  const [gen, setGen] = useState(null)
  const { data, error, loading, reload } = useApi(`comptes-rendus${qs(f)}`)
  const generer = async () => {
    try { const r = await post('comptes-rendus/generer', gen); toast('Compte-rendu généré.'); setGen(null); navigate(`/comptes-rendus/${r.id}`) } catch (e) { toast(e.message, 'erreur') }
  }
  return (
    <>
      <PageHead title="Comptes-rendus hebdomadaires" subtitle="Générés chaque lundi matin, relus et validés par le Responsable, puis envoyés à la Direction">
        {can('comptes_rendus.valider') && <Button icon="add" onClick={() => setGen({ agence_id: agences[0]?.id || '', date: isoDate(new Date()) })}>Générer</Button>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/comptes-rendus" />
      <Toolbar>
        <Select value={f.statut} onChange={v => set('statut', v)} options={{ brouillon: 'À relire', valide: 'Validés', envoye: 'Envoyés' }} placeholder="Tous" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucun compte-rendu." onRow={r => navigate(`/comptes-rendus/${r.id}`)} columns={[
            { label: 'Semaine', render: r => `${dateFr(r.semaine_debut, false)} → ${dateFr(r.semaine_fin, false)}` }, { label: 'Agence', key: 'agence' },
            { label: 'Visites', key: 'visites', num: true }, { label: 'Acheteurs', key: 'acheteurs', num: true }, { label: 'CA', num: true, render: r => ariary(r.ca) },
            { label: 'Statut', render: r => <Badge statut={r.statut} refName="STATUTS_CR" /> },
          ]} />
        )}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
      {gen && (
        <Modal title="Générer un compte-rendu" onClose={() => setGen(null)} footer={<><Button variant="ghost" onClick={() => setGen(null)}>Annuler</Button><Button onClick={generer}>Générer</Button></>}>
          <Field label="Agence"><Select value={gen.agence_id} onChange={v => setGen({ ...gen, agence_id: v })} options={agences.map(a => ({ value: a.id, label: a.nom }))} /></Field>
          <Field label="Un jour de la semaine voulue" hint="Semaine du lundi au dimanche"><Input type="date" value={gen.date} onChange={v => setGen({ ...gen, date: v })} /></Field>
          <Info>Un compte-rendu encore « à relire » est recalculé ; un compte-rendu validé n’est jamais réécrit.</Info>
        </Modal>
      )}
    </>
  )
}

function DetailCR({ id }) {
  const { ref, toast } = useApp()
  const can = useCan()
  const [commentaire, setCommentaire] = useState(null)
  const [busy, setBusy] = useState(false)
  const { data: cr, error, loading, reload } = useApi(`comptes-rendus/${id}`)
  if (loading && !cr) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const d = cr.donnees
  const valider = async () => {
    setBusy(true)
    try { await post(`comptes-rendus/${cr.id}/valider`, { commentaire: commentaire ?? '' }); toast('Compte-rendu validé et envoyé à la Direction.'); reload() } catch (e) { toast(e.message, 'erreur') } finally { setBusy(false) }
  }
  const L = [['Conducteurs actifs', `${d.conducteurs_actifs} (${d.tuktuk_actifs} tuk-tuk / ${d.cyclo_actifs} cyclo)`], ['Nouveaux conducteurs', d.nouveaux_conducteurs],
    ['Visites', d.visites], ['Visites validées / rejetées', `${d.visites_validees} / ${d.visites_rejetees}`], ['Doublons', d.doublons],
    ['Clients orientés', d.clients_orientes], ['Clients acheteurs', d.clients_acheteurs], ['Taux de transformation', `${d.taux_transformation} %`],
    ['CA encaissé', ariary(d.ca)], ['Commissions générées', ariary(d.commissions_generees)], ['Commissions payées', ariary(d.commissions_payees)], ['Coût / CA', `${d.ratio_cout_ca} %`], ['Alertes', d.alertes]]
  return (
    <>
      <PageHead title={`Compte-rendu ${cr.agence}`} subtitle={`Semaine du ${dateFr(cr.semaine_debut, false)} au ${dateFr(cr.semaine_fin, false)}`} back="/comptes-rendus">
        <Badge statut={cr.statut} refName="STATUTS_CR" />
        <a className="btn btn-ghost" href={docUrl(`comptes-rendus/${cr.id}`)} target="_blank" rel="noreferrer"><Icon name="print" size={18} /> Imprimer / PDF</a>
      </PageHead>
      <div className="grid-2">
        <Card title="Indicateurs" pad={false}><DataTable rows={L.map(([k, v]) => ({ id: k, k, v }))} columns={[{ label: 'Indicateur', key: 'k' }, { label: 'Valeur', key: 'v', num: true }]} /></Card>
        <div>
          <Card title="Par type de véhicule" pad={false}>
            <DataTable rows={Object.entries(d.par_type || {}).map(([t, v]) => ({ id: t, t, ...v }))} columns={[{ label: 'Type', render: r => ref.TYPES_VEHICULE[r.t] },
              { label: 'Orientés', key: 'orientes', num: true }, { label: 'Acheteurs', key: 'acheteurs', num: true }, { label: 'CA', num: true, render: r => ariary(r.ca) }]} />
          </Card>
          <Card title="Meilleurs conducteurs" pad={false}>
            <DataTable rows={(d.top || []).map(t => ({ ...t, id: t.code }))} empty="Aucune visite." columns={[{ label: 'Code', key: 'code' }, { label: 'Nom', key: 'nom' },
              { label: 'Orientés', key: 'orientes', num: true }, { label: 'Acheteurs', key: 'acheteurs', num: true }, { label: 'CA', num: true, render: r => ariary(r.ca) }]} />
          </Card>
        </div>
      </div>
      <Card title="Commentaire du Responsable">
        {cr.statut === 'brouillon' && can('comptes_rendus.valider') ? <>
          <Textarea value={commentaire ?? cr.commentaire ?? ''} onChange={setCommentaire} rows={4} placeholder="Faits marquants de la semaine, actions prévues…" />
          <div className="form-actions"><Button icon="send" busy={busy} onClick={valider}>Valider et envoyer à la Direction</Button></div>
        </> : <p>{cr.commentaire || '—'}</p>}
        {cr.valide_par_nom && <p className="muted small">Validé par {cr.valide_par_nom} le {dateFr(cr.valide_le)}{cr.envoye_le ? `, envoyé le ${dateFr(cr.envoye_le)}` : ''}.</p>}
      </Card>
    </>
  )
}
