import { post, qs, exportUrl } from '../lib/api.js'
import { ariary, dateFr } from '../lib/format.js'
import { useApp, useCan, useApi, useFilters, useAction, PageHead, PageTabs, Card, DataTable, Pagination, Toolbar, SearchBox, Select, AgenceSelect, PeriodePicker, Badge, Button, ErrorBox, Loading, Icon, Stat, Info } from '../components/ui.jsx'

const ONGLETS = [{ to: '/historique', label: 'Historique', droit: 'historique.lire' }, { to: '/audit', label: "Journal d'audit", droit: 'audit.lire' }, { to: '/odoo', label: 'Synchronisation Odoo', droit: 'parametres.lire' }]

export default function Journaux({ path }) {
  if (path === '/audit') return <Audit />
  if (path === '/odoo') return <JournalOdoo />
  return <Historique />
}

function Historique() {
  const { ref } = useApp()
  const can = useCan()
  const [f, set] = useFilters({})
  const { data, error, loading, reload } = useApi(`historique${qs(f)}`)
  return (
    <>
      <PageHead title="Journaux" subtitle="Historique des visites, ventes, commissions, paiements et décisions">
        {can('historique.exporter') && <a className="btn btn-ghost" href={exportUrl('historique', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/historique" />
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="Rechercher dans les événements" />
        <Select value={f.type} onChange={v => set('type', v)} options={ref.TYPES_EVENEMENT} placeholder="Tous les types" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
        <PeriodePicker du={f.du} au={f.au} onChange={(du, au) => set({ du, au })} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : <DataTable rows={data?.rows} empty="Aucun événement." columns={[
          { label: 'Date', render: e => dateFr(e.created_at) }, { label: 'Type', render: e => <Badge tone="gris">{ref.TYPES_EVENEMENT[e.type] || e.type}</Badge> },
          { label: 'Événement', key: 'libelle' }, { label: 'Montant', num: true, render: e => (e.montant == null ? '' : ariary(e.montant)) },
          { label: 'Agence', render: e => e.agence || '—' }, { label: 'Par', render: e => e.user_nom || 'Automatique' },
        ]} />}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
    </>
  )
}

function Audit() {
  const can = useCan()
  const [f, set] = useFilters({})
  const { data, error, loading, reload } = useApi(`audit${qs(f)}`)
  return (
    <>
      <PageHead title="Journaux" subtitle="Connexions et modifications des données">
        {can('audit.exporter') && <a className="btn btn-ghost" href={exportUrl('audit', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/audit" />
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="Utilisateur, objet, détail" />
        <Select value={f.action} onChange={v => set('action', v)} options={{ connexion: 'Connexion', connexion_echec: 'Échec de connexion', creer: 'Création', modifier: 'Modification', supprimer: 'Suppression', mot_de_passe: 'Mot de passe' }} placeholder="Toutes les actions" />
        <PeriodePicker du={f.du} au={f.au} onChange={(du, au) => set({ du, au })} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : <DataTable rows={data?.rows} empty="Aucune entrée." columns={[
          { label: 'Date', render: a => dateFr(a.at) }, { label: 'Utilisateur', render: a => a.user_nom || '—' },
          { label: 'Action', render: a => <Badge tone={a.action === 'connexion_echec' ? 'rouge' : 'gris'}>{a.action}</Badge> },
          { label: 'Objet', render: a => `${a.objet || ''}${a.objet_id ? ` #${a.objet_id}` : ''}` }, { label: 'Détail', key: 'detail' }, { label: 'IP', key: 'ip' },
        ]} />}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
    </>
  )
}

function JournalOdoo() {
  const can = useCan()
  const [f, set] = useFilters({})
  const [busy, run] = useAction()
  const { data, error, loading, reload } = useApi(`odoo/journal${qs(f)}`)
  const OPS = { envoi_client: 'Envoi client', import_ventes: 'Import des ventes', test_connexion: 'Test de connexion', champs: 'Champs personnalisés' }
  return (
    <>
      <PageHead title="Journaux" subtitle="Échanges avec Odoo : envoi des clients, import des devis, commandes et factures">
        {can('ventes.synchroniser') && <Button icon="sync" busy={busy === 's'} onClick={() => run('s', () => post('odoo/synchroniser'), r => `${r.elements} document(s) importé(s), ${r.clients_envoyes} client(s) envoyé(s).`, reload)}>Synchroniser maintenant</Button>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/odoo" />
      <ErrorBox error={error} onRetry={reload} />
      {data && <>
        {!data.configure && <Info tone="orange">Odoo n’est pas configuré : renseignez l’adresse, la base, l’utilisateur et la clé API dans Configuration › Paramètres.</Info>}
        <div className="stats">
          <Stat icon={data.actif ? 'sync' : 'sync_disabled'} label="Synchronisation automatique" value={data.actif ? 'Activée' : 'Désactivée'} tone={data.actif ? 'green' : 'red'} />
          <Stat icon="schedule" label="Dernière synchronisation réussie" value={data.derniere ? dateFr(data.derniere.slice(0, 19).replace('T', ' ')) : '—'} hint="Heure UTC" />
          <Stat icon="hourglass_top" label="Clients en attente d’envoi" value={data.clients_en_attente} tone="amber" />
          <Stat icon="sync_problem" label="Clients en erreur" value={data.clients_en_erreur} tone="red" />
        </div>
      </>}
      <Toolbar>
        <Select value={f.operation} onChange={v => set('operation', v)} options={OPS} placeholder="Toutes les opérations" />
        <Select value={f.statut} onChange={v => set('statut', v)} options={{ succes: 'Succès', partiel: 'Partiel', erreur: 'Erreur' }} placeholder="Tous les statuts" />
      </Toolbar>
      <Card pad={false}>
        {loading && !data ? <Loading /> : <DataTable rows={data?.rows} empty="Aucun échange enregistré." columns={[
          { label: 'Date', render: s => dateFr(s.debut) }, { label: 'Opération', render: s => OPS[s.operation] || s.operation },
          { label: 'Statut', render: s => <Badge statut={s.statut}>{s.statut}</Badge> }, { label: 'Éléments', key: 'nb_elements', num: true }, { label: 'Erreurs', key: 'nb_erreurs', num: true },
          { label: 'Message', render: s => <span className="pre small">{s.message}</span> }, { label: 'Par', render: s => s.user_nom || 'Automatique' },
        ]} />}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
    </>
  )
}
