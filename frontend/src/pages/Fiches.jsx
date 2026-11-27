import { useState } from 'react'
import { post, qs, exportUrl } from '../lib/api.js'
import { ariary, dateFr, tel, nomComplet } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import {
  useApp, useCan, useApi, useFilters, useAction, PageHead, Card, DataTable, Pagination, Toolbar, SearchBox, Select, AgenceSelect, PeriodePicker,
  Badge, Button, ErrorBox, Loading, PromptModal, DL, Timeline, Link, Icon, Info, Check,
} from '../components/ui.jsx'

export default function Fiches({ params }) {
  return params.id ? <DetailFiche id={params.id} /> : <ListeFiches />
}

function ListeFiches() {
  const { ref } = useApp()
  const can = useCan()
  const [f, set] = useFilters({ statut: '' })
  const [sel, setSel] = useState([])
  const [busy, run] = useAction()
  const [rejet, setRejet] = useState(null)
  const { data, error, loading, reload } = useApi(`fiches${qs(f)}`)
  const validerSel = () => run('groupe', () => post('fiches/valider-groupe', { ids: sel }), r => `${r.ok} visite(s) validée(s)${r.erreurs.length ? ` — ${r.erreurs.length} refus : ${r.erreurs[0]}` : ''}`, () => { setSel([]); reload() })
  return (
    <>
      <PageHead title="Fiches de suivi" subtitle="Visites des clients amenés par les conducteurs">
        {can('fiches.exporter') && <a className="btn btn-ghost" href={exportUrl('fiches', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
        {can('fiches.creer') && <Button icon="person_add" onClick={() => navigate('/fiches/nouvelle')}>Nouveau client</Button>}
      </PageHead>
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="N° de fiche, client, téléphone, code conducteur" />
        <Select value={f.statut} onChange={v => set('statut', v)} options={ref.STATUTS_FICHE} placeholder="Tous les statuts" />
        <Select value={f.type} onChange={v => set('type', v)} options={ref.TYPES_VEHICULE} placeholder="Tuk-tuk et cyclo" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
        <PeriodePicker du={f.du} au={f.au} onChange={(du, au) => set({ du, au })} />
        <Check checked={f.doublon === '1'} onChange={v => set('doublon', v ? '1' : '')} label="Doublons" />
      </Toolbar>
      {can('fiches.valider') && sel.length > 0 && (
        <div className="selection-bar"><span>{sel.length} fiche(s) sélectionnée(s)</span><Button icon="done_all" busy={busy === 'groupe'} onClick={validerSel}>Valider les visites</Button><Button variant="ghost" onClick={() => setSel([])}>Annuler</Button></div>
      )}
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucune fiche." onRow={r => navigate(`/fiches/${r.id}`)}
            selectable={can('fiches.valider') ? r => r.statut === 'enregistree' : null} selected={sel} onSelect={setSel}
            columns={[
              { label: 'Fiche', render: r => <><b>{r.numero}</b>{r.saisie_papier ? <div className="muted small">fiche papier</div> : null}</> },
              { label: 'Date', render: r => dateFr(r.date_visite) },
              { label: 'Client', render: r => <>{nomComplet(r.client_nom, r.client_prenom)}<div className="muted small">{tel(r.client_telephone)}</div></> },
              { label: 'Conducteur', render: r => r.conducteur_code },
              { label: 'Agence', key: 'agence' },
              { label: 'Statut', render: r => <><Badge statut={r.statut} refName="STATUTS_FICHE" />{r.est_doublon ? <Badge statut="rejetee">Doublon</Badge> : null}</> },
              can('fiches.valider') && { label: '', render: r => r.statut === 'enregistree' && (
                <div className="row-actions">
                  <Button variant="ghost" icon="check" busy={busy === r.id} title="Valider la visite" onClick={() => run(r.id, () => post(`fiches/${r.id}/valider`), 'Visite validée.', reload)} />
                  <Button variant="ghost" icon="block" title="Rejeter" onClick={() => setRejet(r)} />
                </div>
              ) },
            ].filter(Boolean)} />
        )}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
      {rejet && <PromptModal title={`Rejeter la fiche ${rejet.numero}`} label="Motif du rejet" confirm="Rejeter" danger onClose={() => setRejet(null)} onSubmit={async m => { await post(`fiches/${rejet.id}/rejeter`, { motif: m }); reload() }} />}
    </>
  )
}

export function Controles({ controles }) {
  if (!controles?.length) return null
  return <ul className="controles">{controles.map(c => <li key={c.etape} className={c.ok ? 'ok' : 'ko'}><Icon name={c.ok ? 'check_circle' : 'cancel'} size={16} /> <b>{c.controle}</b> <span className="muted">— {c.detail}</span></li>)}</ul>
}

function DetailFiche({ id }) {
  const { ref, odooUrl } = useApp()
  const can = useCan()
  const [busy, run] = useAction()
  const [rejet, setRejet] = useState(false)
  const { data, error, loading, reload } = useApi(`fiches/${id}`)
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { fiche: fi, ventes, commissions, chronologie } = data
  return (
    <>
      <PageHead title={`Fiche ${fi.numero}`} subtitle={`${nomComplet(fi.client_nom, fi.client_prenom)} amené par ${fi.conducteur_code}`} back="/fiches">
        <Badge statut={fi.statut} refName="STATUTS_FICHE" />
        {can('fiches.valider') && fi.statut === 'enregistree' && <>
          <Button icon="check" busy={busy === 'v'} onClick={() => run('v', () => post(`fiches/${fi.id}/valider`), 'Visite validée.', reload)}>Valider la visite</Button>
          <Button variant="danger" icon="block" onClick={() => setRejet(true)}>Rejeter</Button>
        </>}
      </PageHead>
      {fi.est_doublon ? <Info tone="rouge" icon="report">Doublon : {fi.motif_doublon}. Aucune commission pour ce conducteur.</Info> : null}
      {fi.motif_rejet && <Info tone="rouge" icon="block">Rejetée : {fi.motif_rejet}</Info>}
      <div className="grid-2">
        <Card title="Visite">
          <DL items={[
            ['Date de visite', dateFr(fi.date_visite)], ['Agence', fi.agence], ['Motif', ref.MOTIFS_VISITE[fi.motif]],
            ['Produits d’intérêt', fi.produits_interet.map(p => ref.NIVEAUX_PRODUIT[p]).join(', ') || '—'],
            ['Date limite d’achat', dateFr(fi.date_limite)], ['Saisie par', fi.saisi_par_nom], ['Conseiller', fi.conseiller_nom],
            ['Validée par', fi.valide_par_nom ? `${fi.valide_par_nom} le ${dateFr(fi.valide_le)}` : '—'],
            fi.saisie_papier ? ['Fiche papier', fi.numero_fiche_papier] : null, ['Remarque', fi.remarque],
          ]} />
        </Card>
        <Card title="Client et conducteur">
          <DL items={[
            ['Client', <Link key="c" to={`/clients/${fi.client_id}`}>{nomComplet(fi.client_nom, fi.client_prenom)}</Link>], ['Téléphone', tel(fi.client_telephone)], ['Quartier', fi.client_quartier],
            ['Conducteur', <Link key="d" to={`/conducteurs/${fi.conducteur_id}`}>{fi.conducteur_code} — {nomComplet(fi.conducteur_nom, fi.conducteur_prenom)}</Link>],
            ['Type', ref.TYPES_VEHICULE[fi.conducteur_type]], ['Attribution du client', fi.attribution_fin ? `jusqu'au ${dateFr(fi.attribution_fin, false)}` : 'aucune'],
          ]} />
        </Card>
      </div>
      <Card title="Ventes Odoo rattachées" pad={false}>
        <DataTable rows={ventes} empty="Aucun devis, commande ou facture pour l’instant." columns={[
          { label: 'Document', render: v => <>{odooUrl ? <a href={`${odooUrl}/web#id=${v.odoo_id}&model=${v.odoo_modele}&view_type=form`} target="_blank" rel="noreferrer">{v.reference}</a> : v.reference}<div className="muted small">{ref.TYPES_VENTE[v.type]}</div></> },
          { label: 'Date', render: v => dateFr(v.date_document, false) }, { label: 'État', render: v => <Badge statut={v.encaissee ? 'paid' : v.etat}>{v.etat_libelle}</Badge> },
          { label: 'Niveau', render: v => ref.NIVEAUX[v.niveau] || '—' }, { label: 'Montant', num: true, render: v => ariary(v.montant_total) },
        ]} />
      </Card>
      <Card title="Commissions" pad={false}>
        <DataTable rows={commissions} empty="Aucune commission (la visite doit être validée)." columns={[
          { label: 'Type', render: c => ref.TYPES_COMMISSION[c.type] }, { label: 'Niveau', render: c => ref.NIVEAUX[c.niveau] },
          { label: 'Montant', num: true, render: c => ariary(c.montant) }, { label: 'Statut', render: c => <Badge statut={c.statut} refName="STATUTS_COMMISSION" /> },
          { label: 'Contrôles', render: c => <><Controles controles={c.controles} />{c.motif && <div className="muted small">{c.motif}</div>}</> },
        ]} />
      </Card>
      <Card title="Chronologie"><Timeline items={chronologie} /></Card>
      {rejet && <PromptModal title={`Rejeter la fiche ${fi.numero}`} label="Motif du rejet" confirm="Rejeter" danger onClose={() => setRejet(false)} onSubmit={async m => { await post(`fiches/${fi.id}/rejeter`, { motif: m }); reload() }} />}
    </>
  )
}
