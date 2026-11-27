import { useEffect, useState } from 'react'
import { api, post, put, qs, exportUrl, docUrl, lireImage } from '../lib/api.js'
import { ariary, dateFr, tel, nomComplet } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import {
  useApp, useCan, useApi, useFilters, useAction, PageHead, Card, DataTable, Pagination, Toolbar, SearchBox, Select, AgenceSelect,
  Badge, Button, ErrorBox, Loading, Modal, Field, Input, Textarea, DL, Tabs, Stat, Icon, Info, SignaturePad, Check,
} from '../components/ui.jsx'

export default function Conducteurs({ path, params }) {
  if (path === '/conducteurs/nouveau') return <Formulaire />
  if (path.endsWith('/modifier')) return <Formulaire id={params.id} />
  if (params.id) return <FicheConducteur id={params.id} />
  return <Liste />
}

function Liste() {
  const { ref } = useApp()
  const can = useCan()
  const [f, set] = useFilters({ statut: '' })
  const { data, error, loading, reload } = useApi(`conducteurs${qs(f)}`)
  return (
    <>
      <PageHead title="Conducteurs" subtitle="Partenaires tuk-tuk et cyclo-pousse">
        {can('conducteurs.exporter') && <a className="btn btn-ghost" href={exportUrl('conducteurs', f)}><Icon name="download" size={18} /> Export Excel (CSV)</a>}
        {can('conducteurs.creer') && <Button icon="add" onClick={() => navigate('/conducteurs/nouveau')}>Inscrire un conducteur</Button>}
      </PageHead>
      <Toolbar>
        <SearchBox value={f.q} onChange={v => set('q', v)} placeholder="Code, nom, téléphone, CIN, immatriculation" />
        <Select value={f.type} onChange={v => set('type', v)} options={ref.TYPES_VEHICULE} placeholder="Tuk-tuk et cyclo" />
        <Select value={f.statut} onChange={v => set('statut', v)} options={ref.STATUTS_CONDUCTEUR} placeholder="Tous les statuts" />
        <AgenceSelect value={f.agence} onChange={v => set('agence', v)} />
      </Toolbar>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : (
          <DataTable rows={data?.rows} empty="Aucun conducteur." onRow={r => navigate(`/conducteurs/${r.id}`)} columns={[
            { label: 'Code', render: r => <><b>{r.code}</b><div className="muted small">{ref.TYPES_VEHICULE[r.type]}</div></> },
            { label: 'Nom', render: r => nomComplet(r.nom, r.prenom) },
            { label: 'Téléphone', render: r => tel(r.telephone) },
            { label: 'Immatriculation', render: r => r.immatriculation || '—' },
            { label: 'Agence', key: 'agence' },
            { label: 'Visites', key: 'visites', num: true }, { label: 'Acheteurs', key: 'acheteurs', num: true },
            { label: 'Statut', render: r => <><Badge statut={r.statut} refName="STATUTS_CONDUCTEUR" />{r.commissions_bloquees ? <Badge statut="bloquee">Commissions bloquées</Badge> : null}{!r.charte_signee_le ? <Badge tone="orange">Charte non signée</Badge> : null}</> },
          ]} />
        )}
      </Card>
      <Pagination data={data} onPage={p => set('page', p)} />
    </>
  )
}

function Formulaire({ id }) {
  const { ref, agences, toast } = useApp()
  const [v, setV] = useState({ type: 'tuktuk', mode_paiement: 'especes', agence_id: agences[0]?.id ? String(agences[0].id) : '' })
  const [photo, setPhoto] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, x) => setV(o => ({ ...o, [k]: x }))
  useEffect(() => {
    if (id) api(`conducteurs/${id}`).then(d => { const c = d.conducteur; setV({ ...c, telephone: tel(c.telephone), numero_mobile_money: c.numero_mobile_money ? tel(c.numero_mobile_money) : '', agence_id: String(c.agence_id) }) }).catch(setError)
  }, [id])
  const choisirPhoto = async e => { const file = e.target.files?.[0]; if (file) setPhoto(await lireImage(file).catch(err => { setError(err); return null })) }
  const enregistrer = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = { ...v, photo: photo || undefined }
      if (id) { await put(`conducteurs/${id}`, body); toast('Conducteur modifié.'); navigate(`/conducteurs/${id}`) } else {
        const r = await post('conducteurs', body)
        toast(`Conducteur inscrit avec le code ${r.code}. Faites signer la charte et imprimez la carte partenaire.`)
        navigate(`/conducteurs/${r.id}`)
      }
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  return (
    <>
      <PageHead title={id ? `Modifier ${v.code || ''}` : 'Inscrire un conducteur'} back={id ? `/conducteurs/${id}` : '/conducteurs'} />
      <ErrorBox error={error} />
      <Card>
        <div className="form-grid">
          {!id && <Field label="Type de véhicule" required><Select value={v.type} onChange={x => set('type', x)} options={ref.TYPES_VEHICULE} /></Field>}
          <Field label="Agence" required hint={id ? 'Le code partenaire est conservé en cas de changement' : 'Le code partenaire est attribué automatiquement'}><Select value={v.agence_id} onChange={x => set('agence_id', x)} options={agences.filter(a => a.statut === 'active' || String(a.id) === v.agence_id).map(a => ({ value: String(a.id), label: a.nom }))} placeholder="—" /></Field>
          <Field label="Nom" required><Input value={v.nom} onChange={x => set('nom', x)} /></Field>
          <Field label="Prénom"><Input value={v.prenom} onChange={x => set('prenom', x)} /></Field>
          <Field label="Téléphone" required><Input value={v.telephone} onChange={x => set('telephone', x)} placeholder="034 12 345 67" inputMode="tel" /></Field>
          <Field label="N° CIN" required><Input value={v.cin} onChange={x => set('cin', x)} /></Field>
          <Field label="Immatriculation" required={(id ? v.type : v.type) === 'tuktuk'}><Input value={v.immatriculation} onChange={x => set('immatriculation', x)} /></Field>
          <Field label="Photo" hint="Pour la carte partenaire"><input type="file" accept="image/*" capture="user" className="input" onChange={choisirPhoto} /></Field>
          {photo && <img src={photo} alt="" className="photo-apercu" />}
          <Field label="Mode de paiement" required><Select value={v.mode_paiement} onChange={x => set('mode_paiement', x)} options={ref.MODES_PAIEMENT_CONDUCTEUR} /></Field>
          {v.mode_paiement === 'mobile_money' && <>
            <Field label="Opérateur" required><Select value={v.operateur_mobile} onChange={x => set('operateur_mobile', x)} options={ref.OPERATEURS} placeholder="—" /></Field>
            <Field label="Numéro Mobile Money" required><Input value={v.numero_mobile_money} onChange={x => set('numero_mobile_money', x)} inputMode="tel" /></Field>
          </>}
        </div>
        <div className="form-actions"><Button icon="save" busy={busy} onClick={enregistrer}>{id ? 'Enregistrer' : 'Inscrire'}</Button></div>
      </Card>
    </>
  )
}

function FicheConducteur({ id }) {
  const { ref, toast } = useApp()
  const can = useCan()
  const [onglet, setOnglet] = useState('visites')
  const [page, setPage] = useState(1)
  const [modale, setModale] = useState(null)
  const [busy, run] = useAction()
  const { data, error, loading, reload } = useApi(`conducteurs/${id}`)
  const tab = useApi(`conducteurs/${id}/onglet/${onglet}?page=${page}`, [data])
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { conducteur: c, stats: s, apercu } = data
  const colonnes = {
    visites: [{ label: 'Fiche', render: r => <b>{r.numero}</b> }, { label: 'Date', render: r => dateFr(r.date_visite) }, { label: 'Client', render: r => <>{nomComplet(r.client_nom, r.client_prenom)}<div className="muted small">{tel(r.client_telephone)}</div></> },
      { label: 'Statut', render: r => <><Badge statut={r.statut} refName="STATUTS_FICHE" />{r.est_doublon ? <Badge statut="rejetee">Doublon</Badge> : null}</> }],
    clients: [{ label: 'Client', render: r => nomComplet(r.nom, r.prenom) }, { label: 'Téléphone', render: r => tel(r.telephone) }, { label: 'Quartier', render: r => r.quartier || '—' },
      { label: 'Attribution', render: r => `${dateFr(r.attribue_le, false)} → ${dateFr(r.attribution_fin, false)}` }, { label: 'Odoo', render: r => <Badge statut={r.odoo_statut} /> }],
    ventes: [{ label: 'Document', render: r => <>{r.reference}<div className="muted small">{ref.TYPES_VENTE[r.type]}</div></> }, { label: 'Client', render: r => nomComplet(r.client_nom, r.client_prenom) },
      { label: 'Date', render: r => dateFr(r.date_document, false) }, { label: 'État', render: r => r.etat_libelle }, { label: 'Montant', num: true, render: r => ariary(r.montant_total) }],
    commissions: [{ label: 'Date', render: r => dateFr(r.created_at) }, { label: 'Client', render: r => nomComplet(r.client_nom, r.client_prenom) }, { label: 'Type', render: r => ref.TYPES_COMMISSION[r.type] },
      { label: 'Montant', num: true, render: r => ariary(r.montant) }, { label: 'Statut', render: r => <Badge statut={r.statut} refName="STATUTS_COMMISSION" /> }],
    paiements: [{ label: 'N°', render: r => <b>{r.numero}</b> }, { label: 'Payé le', render: r => dateFr(r.paye_le) }, { label: 'Mode', render: r => ref.MODES_PAIEMENT[r.mode] },
      { label: 'Net', num: true, render: r => ariary(r.montant_net) }, { label: 'Reçu', render: r => <a href={docUrl(`paiements/${r.id}/recu`)} target="_blank" rel="noreferrer">Reçu</a> }],
  }
  const onRow = { visites: r => navigate(`/fiches/${r.id}`), clients: r => navigate(`/clients/${r.id}`) }
  return (
    <>
      <PageHead title={c.code} subtitle={`${nomComplet(c.nom, c.prenom)} — ${ref.TYPES_VEHICULE[c.type]}, agence ${c.agence}`} back="/conducteurs">
        <Badge statut={c.statut} refName="STATUTS_CONDUCTEUR" />
        {can('fiches.creer') && c.statut === 'actif' && <Button icon="person_add" onClick={() => navigate(`/fiches/nouvelle?conducteur=${c.id}`)}>Nouveau client</Button>}
        {can('paiements.payer') && <Button icon="payments" onClick={() => setModale('payer')}>Payer</Button>}
        <a className="btn btn-ghost" href={docUrl(`conducteurs/${c.id}/carte`)} target="_blank" rel="noreferrer"><Icon name="badge" size={18} /> Carte</a>
        <a className="btn btn-ghost" href={docUrl(`conducteurs/${c.id}/charte`)} target="_blank" rel="noreferrer"><Icon name="description" size={18} /> Charte</a>
        {can('conducteurs.modifier') && <Button variant="ghost" icon="edit" onClick={() => navigate(`/conducteurs/${c.id}/modifier`)}>Modifier</Button>}
      </PageHead>
      {c.statut !== 'actif' && <Info tone="rouge" icon="block">{ref.STATUTS_CONDUCTEUR[c.statut]}{c.motif_statut ? ` : ${c.motif_statut}` : ''}</Info>}
      {c.commissions_bloquees ? <Info tone="rouge" icon="lock">Les commissions de ce conducteur sont bloquées.</Info> : null}
      {!c.charte_signee_le && <Info tone="orange" icon="draw">La charte n’est pas encore signée. {can('conducteurs.modifier') && <Button variant="ghost" onClick={() => setModale('charte')}>Faire signer</Button>}</Info>}
      <div className="stats">
        <Stat icon="directions_walk" label="Visites" value={s.visites} hint={`${s.clients} client(s) attribué(s)`} />
        <Stat icon="shopping_cart" label="Clients acheteurs" value={s.acheteurs} tone="green" />
        <Stat icon="hourglass_top" label="À valider" value={ariary(s.a_valider)} hint={`${s.nb_a_valider} commission(s)`} tone="amber" />
        <Stat icon="account_balance_wallet" label="À payer" value={ariary(s.a_payer)} hint={s.bloque ? `${ariary(s.bloque)} bloqués` : null} tone="violet" />
        <Stat icon="paid" label="Déjà payé" value={ariary(s.paye)} hint={`${s.nb_paiements} paiement(s)`} tone="teal" />
      </div>
      <div className="grid-2">
        <Card title="Identité">
          <div className="identite">
            {c.photo ? <img src={`/api/conducteurs/${c.id}/photo`} alt="" className="photo" /> : <div className="photo vide"><Icon name="person" size={40} /></div>}
            <DL items={[
              ['Téléphone', tel(c.telephone)], ['N° CIN', c.cin], ['Immatriculation', c.immatriculation], ['Paiement', `${ref.MODES_PAIEMENT_CONDUCTEUR[c.mode_paiement]}${c.operateur_mobile ? ` — ${ref.OPERATEURS[c.operateur_mobile]} ${tel(c.numero_mobile_money)}` : ''}`],
              ['Charte signée', c.charte_signee_le ? dateFr(c.charte_signee_le) : 'non'], ['Inscrit le', `${dateFr(c.created_at)}${c.createur ? ` par ${c.createur}` : ''}`],
            ]} />
          </div>
        </Card>
        <Card title="Actions">
          <div className="actions-liste">
            {can('conducteurs.modifier') && <Button variant="ghost" icon="swap_horiz" onClick={() => setModale('statut')}>Changer le statut (actif, suspendu, radié)</Button>}
            {can('conducteurs.modifier') && <Button variant="ghost" icon="draw" onClick={() => setModale('charte')}>{c.charte_signee_le ? 'Signer à nouveau la charte' : 'Faire signer la charte'}</Button>}
            {can('alertes.traiter') && <Button variant="ghost" icon={c.commissions_bloquees ? 'lock_open' : 'lock'} busy={busy === 'bloc'} onClick={() => run('bloc', () => post(`conducteurs/${c.id}/blocage`), r => (r.bloquees ? 'Commissions bloquées.' : 'Commissions débloquées.'), reload)}>{c.commissions_bloquees ? 'Débloquer les commissions' : 'Bloquer les commissions'}</Button>}
          </div>
        </Card>
      </div>
      <Tabs value={onglet} onChange={o => { setOnglet(o); setPage(1) }} tabs={[
        { id: 'visites', label: 'Visites', icon: 'assignment' }, { id: 'clients', label: 'Clients', icon: 'groups' }, { id: 'ventes', label: 'Ventes', icon: 'receipt_long' },
        { id: 'commissions', label: 'Commissions', icon: 'payments' }, { id: 'paiements', label: 'Paiements', icon: 'account_balance_wallet' },
      ]} />
      <Card pad={false}>{tab.loading && !tab.data ? <Loading /> : <DataTable rows={tab.data?.rows} columns={colonnes[onglet]} onRow={onRow[onglet]} />}</Card>
      <Pagination data={tab.data} onPage={setPage} />

      {modale === 'statut' && <ModaleStatut c={c} onClose={() => setModale(null)} onDone={() => { toast('Statut mis à jour.'); reload() }} />}
      {modale === 'charte' && <ModaleCharte c={c} onClose={() => setModale(null)} onDone={() => { toast('Charte signée.'); reload() }} />}
      {modale === 'payer' && <ModalePaiement c={c} apercu={apercu} peutValider={data.peutValiderEnPayant} onClose={() => setModale(null)} onDone={reload} />}
    </>
  )
}

function ModaleStatut({ c, onClose, onDone }) {
  const { ref } = useApp()
  const [statut, setStatut] = useState(c.statut)
  const [motif, setMotif] = useState(c.motif_statut || '')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await post(`conducteurs/${c.id}/statut`, { statut, motif }); onDone(); onClose() } catch (e) { setErr(e) } finally { setBusy(false) } }
  return (
    <Modal title={`Statut de ${c.code}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={go}>Enregistrer</Button></>}>
      <ErrorBox error={err} />
      <Field label="Statut"><Select value={statut} onChange={setStatut} options={ref.STATUTS_CONDUCTEUR} /></Field>
      {statut !== 'actif' && <Field label="Motif" required><Textarea value={motif} onChange={setMotif} /></Field>}
      <p className="muted small">Un conducteur suspendu ou radié ne peut plus amener de client et ses nouvelles commissions sont refusées.</p>
    </Modal>
  )
}

function ModaleCharte({ c, onClose, onDone }) {
  const [sig, setSig] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const go = async () => { if (!sig) return setErr(new Error('Faites signer le conducteur dans le cadre.')); setBusy(true); try { await post(`conducteurs/${c.id}/charte`, { signature: sig }); onDone(); onClose() } catch (e) { setErr(e) } finally { setBusy(false) } }
  return (
    <Modal wide title="Charte du programme partenaires" onClose={onClose} footer={<><a className="btn btn-ghost" href={docUrl(`conducteurs/${c.id}/charte`)} target="_blank" rel="noreferrer">Lire la charte complète</a><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={go}>Enregistrer la signature</Button></>}>
      <ErrorBox error={err} />
      <div className="charte-texte">
        <p>1. Le conducteur présente son code partenaire à chaque visite d’un client en agence.</p>
        <p>2. Rémunération selon le barème : client amené, achat entrée de gamme ou coussins, achat matelas haut de gamme. Une seule rémunération par client : ce qui est déjà versé est déduit.</p>
        <p>3. La commission d’achat n’est due que si la facture est entièrement encaissée, dans le délai suivant la visite.</p>
        <p>4. Un client est attribué au premier conducteur qui l’amène. Un client déjà attribué ne donne droit à aucune commission.</p>
        <p>5. Toute fraude entraîne la suspension, le blocage des commissions et peut conduire à la radiation.</p>
        <p>6. Les commissions validées sont payées chaque semaine, en espèces contre signature ou par Mobile Money.</p>
      </div>
      <p><b>{c.code} — {nomComplet(c.nom, c.prenom)}</b> : signature</p>
      <SignaturePad onChange={setSig} />
    </Modal>
  )
}

function ModalePaiement({ c, apercu, peutValider, onClose, onDone }) {
  const { ref, toast } = useApp()
  const [mode, setMode] = useState(c.mode_paiement === 'mobile_money' && c.operateur_mobile ? c.operateur_mobile : 'especes')
  const [reference, setReference] = useState('')
  const [sig, setSig] = useState(null)
  const [validerAvant, setValiderAvant] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fait, setFait] = useState(null)
  const net = validerAvant ? apercu.net_avec_validation : apercu.net
  const go = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await post(`conducteurs/${c.id}/payer`, { mode, reference, signature: mode === 'especes' ? sig : null, valider_avant: validerAvant })
      setFait(r)
      toast(`Paiement ${r.numero} enregistré.`)
      onDone()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  if (fait) {
    return (
      <Modal title="Paiement enregistré" onClose={onClose} footer={<><a className="btn btn-primary" href={docUrl(`paiements/${fait.id}/recu`)} target="_blank" rel="noreferrer"><Icon name="print" size={18} /> Imprimer le reçu</a><Button variant="ghost" onClick={onClose}>Fermer</Button></>}>
        <div className="succes"><Icon name="task_alt" size={48} /><h2>{ariary(fait.net)} versés à {c.code}</h2><p className="muted">Paiement {fait.numero}</p></div>
      </Modal>
    )
  }
  return (
    <Modal wide title={`Payer ${c.code}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button icon="payments" busy={busy} disabled={net <= 0} onClick={go}>Payer {ariary(net)}</Button></>}>
      <ErrorBox error={err} />
      <DL items={[
        ['Commissions validées', `${ariary(apercu.commissions)} (${apercu.nb_validees})`], ['Régularisations', ariary(apercu.regularisations)],
        ['Commissions à valider', `${ariary(apercu.a_valider)} (${apercu.nb_a_valider})`], ['Net à payer', <b key="n">{ariary(net)}</b>],
      ]} />
      {apercu.nb_a_valider > 0 && peutValider && <Check checked={validerAvant} onChange={setValiderAvant} label={`Valider aussi les ${apercu.nb_a_valider} commission(s) à valider avant de payer`} />}
      {net <= 0 && <Info tone="orange">Rien à payer pour l’instant{apercu.nb_a_valider ? ' : des commissions attendent la validation du Responsable' : ''}.</Info>}
      <div className="form-grid">
        <Field label="Mode de paiement"><Select value={mode} onChange={setMode} options={ref.MODES_PAIEMENT} /></Field>
        {mode !== 'especes' && <Field label="Référence de la transaction" required><Input value={reference} onChange={setReference} /></Field>}
      </div>
      {mode === 'especes' && <><p className="muted">Paiement en espèces : signature du conducteur obligatoire.</p><SignaturePad onChange={setSig} /></>}
    </Modal>
  )
}
