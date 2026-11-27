import { useState } from 'react'
import { qs } from '../lib/api.js'
import { ariary, nombre, periodes, nomComplet, dateFr } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import { useApi, useApp, useCan, PageHead, Stat, Card, BarChart, Loading, ErrorBox, Select, AgenceSelect, DataTable, Link, Badge, Empty, Toolbar } from '../components/ui.jsx'

export default function Dashboard() {
  const { ref, user } = useApp()
  const can = useCan()
  const P = periodes()
  const [per, setPer] = useState('mois')
  const [agence, setAgence] = useState('')
  const [type, setType] = useState('')
  const { data, error, loading, reload } = useApi(`tableau-de-bord${qs({ du: P[per].du, au: P[per].au, agence, type })}`)
  const i = data?.indicateurs
  const a = data?.attente
  return (
    <>
      <PageHead title={`Bonjour ${user.nom.split(' ')[0]}`} subtitle="Activité du programme partenaires tuk-tuk et cyclo-pousse" />
      <div className="filtre-barre">
        <div className="segments" role="tablist" aria-label="Période">
          {Object.entries(P).map(([k, v]) => <button key={k} type="button" role="tab" aria-selected={per === k} className={per === k ? 'on' : ''} onClick={() => setPer(k)}>{v.label}</button>)}
        </div>
        <Toolbar>
          <AgenceSelect value={agence} onChange={setAgence} />
          <Select value={type} onChange={setType} options={ref.TYPES_VEHICULE} placeholder="Tous véhicules" />
        </Toolbar>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="attente">
            {can('fiches.valider') && a.fiches_a_valider > 0 && <button type="button" onClick={() => navigate('/fiches?statut=enregistree')}><b>{a.fiches_a_valider}</b> visite(s) à valider</button>}
            {can('commissions.valider') && a.commissions_a_valider > 0 && <button type="button" onClick={() => navigate('/commissions?statut=a_valider')}><b>{a.commissions_a_valider}</b> commission(s) à valider</button>}
            {can('paiements.lire') && a.commissions_a_payer > 0 && <button type="button" onClick={() => navigate('/paiements')}><b>{a.commissions_a_payer}</b> commission(s) à payer</button>}
            {can('alertes.lire') && a.alertes_ouvertes > 0 && <button type="button" className="rouge" onClick={() => navigate('/alertes')}><b>{a.alertes_ouvertes}</b> alerte(s) ouverte(s)</button>}
            {can('comptes_rendus.lire') && a.comptes_rendus_a_valider > 0 && <button type="button" onClick={() => navigate('/comptes-rendus?statut=brouillon')}><b>{a.comptes_rendus_a_valider}</b> compte(s)-rendu(s) à relire</button>}
          </div>
          <div className="stats">
            <Stat icon="electric_rickshaw" label="Conducteurs actifs" value={nombre(i.conducteurs_actifs)} hint={`${i.tuktuk_actifs} tuk-tuk · ${i.cyclo_actifs} cyclo`} />
            <Stat icon="directions_walk" label="Clients orientés" value={nombre(i.clients_orientes)} hint={`${i.visites} visite(s)`} tone="teal" />
            <Stat icon="shopping_cart" label="Clients acheteurs" value={nombre(i.clients_acheteurs)} hint={`Taux de transformation ${i.taux_transformation} %`} tone="green" />
            <Stat icon="point_of_sale" label="CA encaissé" value={ariary(i.ca)} hint="Factures payées rattachées à une fiche" tone="violet" />
            <Stat icon="payments" label="Commissions de la période" value={ariary(i.cout_commissions)} hint={`Coût / CA : ${i.ratio_cout_ca} %`} tone="amber" />
            <Stat icon="account_balance_wallet" label="Payé aux conducteurs" value={ariary(i.commissions_payees)} hint={`Reste dû : ${ariary(i.commissions_dues)}`} tone="blue" />
          </div>
          <div className="grid-2">
            <Card title="8 dernières semaines">
              <BarChart labels={data.series.libelles} series={[{ label: 'Visites', values: data.series.visites }, { label: 'Acheteurs', values: data.series.acheteurs }]} />
            </Card>
            <Card title="Meilleurs conducteurs" pad={false}>
              <DataTable rows={data.top.map(t => ({ ...t, id: t.conducteur.id }))} empty="Aucune visite sur la période." onRow={r => navigate(`/conducteurs/${r.id}`)} columns={[
                { label: 'Conducteur', render: r => <><b>{r.conducteur.code}</b><div className="muted small">{nomComplet(r.conducteur.nom, r.conducteur.prenom)}</div></> },
                { label: 'Orientés', key: 'orientes', num: true }, { label: 'Acheteurs', key: 'acheteurs', num: true },
                { label: 'Taux', num: true, render: r => `${r.taux} %` }, { label: 'CA', num: true, render: r => ariary(r.ca) },
              ]} />
            </Card>
          </div>
          <div className="grid-2">
            {data.parType && (
              <Card title="Tuk-tuk / cyclo-pousse" pad={false}>
                <DataTable rows={Object.entries(data.parType).map(([t, v]) => ({ id: t, t, ...v }))} columns={[
                  { label: 'Type', render: r => ref.TYPES_VEHICULE[r.t] }, { label: 'Actifs', key: 'conducteurs_actifs', num: true },
                  { label: 'Orientés', key: 'clients_orientes', num: true }, { label: 'Acheteurs', key: 'clients_acheteurs', num: true },
                  { label: 'CA', num: true, render: r => ariary(r.ca) }, { label: 'Commissions', num: true, render: r => ariary(r.cout_commissions) },
                ]} />
              </Card>
            )}
            {can('alertes.lire') && (
              <Card title="Dernières alertes" actions={<Link to="/alertes">Tout voir</Link>}>
                {data.alertes.length ? <ul className="liste">{data.alertes.map(al => <li key={al.id}><Badge statut={al.gravite}>{ref.TYPES_ALERTE[al.type]}</Badge> {al.message} <span className="muted small">{dateFr(al.created_at)}</span></li>)}</ul> : <Empty icon="verified">Aucune alerte ouverte.</Empty>}
              </Card>
            )}
          </div>
        </>
      )}
    </>
  )
}
