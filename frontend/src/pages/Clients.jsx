import { useState } from 'react'
import { post, put, qs, exportUrl } from '../lib/api.js'
import { ariary, dateFr, tel, nomComplet } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import {
  useApp, useCan, useApi, useFilters, useAction, PageHead, PageTabs, Card, DataTable, Pagination, Toolbar, SearchBox, Select, AgenceSelect, PeriodePicker,
  Badge, Button, ErrorBox, Loading, Modal, Field, Input, DL, Timeline, Link, Icon, Info,
} from '../components/ui.jsx'

const ONGLETS = [{ to: '/clients', label: 'Clients', droit: 'clients.lire' }, { to: '/ventes', label: 'Ventes Odoo', droit: 'ventes.lire' }]

export default function Clients({ path, params }) {
  if (path === '/ventes') return <Ventes />
  return params.id ? <FicheClient id={params.id} /> : <Liste />
}

function Liste() {
  const can = useCan()
  const [f, set] = useFilters({})
  const { data, error, loading, reload } = useApi(`clients${qs(f)}`)
  return (
    <>
      <PageHead title="Clients" subtitle="Clients amenés par les conducteurs (attribution 12 mois)">
        {can('clients.exporter') && <a className="btn btn-ghost" href={exportUrl('clients', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/clients" />
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="Nom, téléphone, quartier, code conducteur" />
        <Select value={f.attribution} onChange={v => set('attribution', v)} options={{ active: 'Attribution en cours', libre: 'Sans attribution' }} placeholder="Toutes attributions" />
        <Select value={f.odoo} onChange={v => set('odoo', v)} options={{ synchronise: 'Envoyé à Odoo', en_attente: 'En attente', erreur: 'Erreur Odoo' }} placeholder="Odoo : tous" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucun client." onRow={r => navigate(`/clients/${r.id}`)} columns={[
            { label: 'Client', render: r => <b>{nomComplet(r.nom, r.prenom)}</b> }, { label: 'Téléphone', render: r => tel(r.telephone) },
            { label: 'Quartier', render: r => r.quartier || '—' }, { label: 'Agence', key: 'agence' },
            { label: 'Conducteur', render: r => r.conducteur_code || '—' },
            { label: "Fin d'attribution", render: r => dateFr(r.attribution_fin, false) }, { label: 'Visites', key: 'visites', num: true },
            { label: 'Odoo', render: r => <Badge statut={r.odoo_statut}>{{ synchronise: 'Envoyé', en_attente: 'En attente', erreur: 'Erreur' }[r.odoo_statut]}</Badge> },
          ]} />
        )}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
    </>
  )
}

function FicheClient({ id }) {
  const { ref, toast } = useApp()
  const can = useCan()
  const [busy, run] = useAction()
  const [edit, setEdit] = useState(null)
  const { data, error, loading, reload } = useApi(`clients/${id}`)
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { client: c, fiches, ventes, commissions, chronologie } = data
  const save = async () => { try { await put(`clients/${c.id}`, edit); toast('Client modifié.'); setEdit(null); reload() } catch (e) { toast(e.message, 'erreur') } }
  return (
    <>
      <PageHead title={nomComplet(c.nom, c.prenom)} subtitle={`${tel(c.telephone)} — agence ${c.agence}`} back="/clients">
        {can('clients.modifier') && <Button variant="ghost" icon="edit" onClick={() => setEdit({ nom: c.nom, prenom: c.prenom || '', quartier: c.quartier || '' })}>Modifier</Button>}
        {can('ventes.synchroniser') && c.odoo_statut !== 'synchronise' && <Button icon="sync" busy={busy === 'o'} onClick={() => run('o', () => post(`clients/${c.id}/odoo`), 'Client envoyé vers Odoo.', reload)}>Envoyer vers Odoo</Button>}
      </PageHead>
      {c.odoo_statut === 'erreur' && <Info tone="rouge" icon="sync_problem">Envoi vers Odoo en échec : {c.odoo_erreur}</Info>}
      <div className="grid-2">
        <Card title="Client">
          <DL items={[['Téléphone', tel(c.telephone)], ['Quartier', c.quartier], ['Agence', c.agence], ['Créé le', dateFr(c.created_at)],
            ['Contact Odoo', c.odoo_partenaire_id ? `#${c.odoo_partenaire_id}` : '—'], ['Dernier envoi Odoo', dateFr(c.odoo_synchronise_le)]]} />
        </Card>
        <Card title="Attribution">
          {c.conducteur_id ? <DL items={[['Conducteur', <Link key="c" to={`/conducteurs/${c.conducteur_id}`}>{c.conducteur_code} — {nomComplet(c.conducteur_nom, c.conducteur_prenom)}</Link>],
            ['Depuis le', dateFr(c.attribue_le, false)], ["Jusqu'au", dateFr(c.attribution_fin, false)]]} /> : <p className="muted">Aucune attribution en cours : le prochain conducteur qui l’amène sera attributaire.</p>}
        </Card>
      </div>
      <Card title="Visites" pad={false}>
        <DataTable rows={fiches} onRow={r => navigate(`/fiches/${r.id}`)} columns={[{ label: 'Fiche', render: r => <b>{r.numero}</b> }, { label: 'Date', render: r => dateFr(r.date_visite) },
          { label: 'Conducteur', key: 'conducteur_code' }, { label: 'Statut', render: r => <><Badge statut={r.statut} refName="STATUTS_FICHE" />{r.est_doublon ? <Badge statut="rejetee">Doublon</Badge> : null}</> }]} />
      </Card>
      <div className="grid-2">
        <Card title="Ventes Odoo" pad={false}>
          <DataTable rows={ventes} empty="Aucune vente." columns={[{ label: 'Document', render: v => <>{v.reference}<div className="muted small">{ref.TYPES_VENTE[v.type]}</div></> },
            { label: 'Date', render: v => dateFr(v.date_document, false) }, { label: 'État', key: 'etat_libelle' }, { label: 'Montant', num: true, render: v => ariary(v.montant_total) }]} />
        </Card>
        <Card title="Commissions" pad={false}>
          <DataTable rows={commissions} empty="Aucune commission." columns={[{ label: 'Conducteur', key: 'conducteur_code' }, { label: 'Type', render: r => ref.TYPES_COMMISSION[r.type] },
            { label: 'Montant', num: true, render: r => ariary(r.montant) }, { label: 'Statut', render: r => <Badge statut={r.statut} refName="STATUTS_COMMISSION" /> }]} />
        </Card>
      </div>
      <Card title="Chronologie"><Timeline items={chronologie} /></Card>
      {edit && (
        <Modal title="Modifier le client" onClose={() => setEdit(null)} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Annuler</Button><Button onClick={save}>Enregistrer</Button></>}>
          <Field label="Nom" required><Input value={edit.nom} onChange={v => setEdit({ ...edit, nom: v })} /></Field>
          <Field label="Prénom"><Input value={edit.prenom} onChange={v => setEdit({ ...edit, prenom: v })} /></Field>
          <Field label="Quartier"><Input value={edit.quartier} onChange={v => setEdit({ ...edit, quartier: v })} /></Field>
          <p className="muted small">Le téléphone identifie le client (contrôle doublon) : il ne se modifie pas.</p>
        </Modal>
      )}
    </>
  )
}

function Ventes() {
  const { ref, odooUrl } = useApp()
  const can = useCan()
  const [f, set] = useFilters({})
  const [busy, run] = useAction()
  const { data, error, loading, reload } = useApi(`ventes${qs(f)}`)
  return (
    <>
      <PageHead title="Ventes Odoo" subtitle="Devis, commandes et factures des clients amenés, récupérés depuis Odoo">
        {can('ventes.exporter') && <a className="btn btn-ghost" href={exportUrl('ventes', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
        {can('ventes.synchroniser') && <Button icon="sync" busy={busy === 's'} onClick={() => run('s', () => post('odoo/synchroniser'), r => `${r.elements} document(s) importé(s), ${r.clients_envoyes} client(s) envoyé(s)${r.erreurs ? `, ${r.erreurs} erreur(s)` : ''}.`, reload)}>Synchroniser maintenant</Button>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/ventes" />
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="Référence, client, téléphone, code conducteur" />
        <Select value={f.type} onChange={v => set('type', v)} options={ref.TYPES_VENTE} placeholder="Tous les documents" />
        <Select value={f.paiement} onChange={v => set('paiement', v)} options={ref.ETATS_PAIEMENT} placeholder="Tous paiements" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
        <PeriodePicker du={f.du} au={f.au} onChange={(du, au) => set({ du, au })} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucune vente importée." columns={[
            { label: 'Document', render: v => <>{odooUrl ? <a href={`${odooUrl}/web#id=${v.odoo_id}&model=${v.odoo_modele}&view_type=form`} target="_blank" rel="noreferrer">{v.reference}</a> : v.reference}<div className="muted small">{ref.TYPES_VENTE[v.type]}</div></> },
            { label: 'Date', render: v => dateFr(v.date_document, false) },
            { label: 'Client', render: v => <Link to={`/clients/${v.client_id}`}>{nomComplet(v.client_nom, v.client_prenom)}</Link> },
            { label: 'Fiche', render: v => (v.fiche_suivi_id ? <Link to={`/fiches/${v.fiche_suivi_id}`}>{v.fiche}</Link> : '—') },
            { label: 'Conducteur', render: v => v.conducteur_code || '—' },
            { label: 'Niveau', render: v => <>{ref.NIVEAUX[v.niveau] || '—'}{v.niveau_par_defaut ? <div className="muted small">par défaut (produit non classé)</div> : null}</> },
            { label: 'État', render: v => <Badge statut={v.encaissee ? 'paid' : v.etat === 'cancel' ? 'cancel' : 'orange'}>{v.etat_libelle}</Badge> },
            { label: 'Montant', num: true, render: v => ariary(v.montant_total) },
          ]} />
        )}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
    </>
  )
}
