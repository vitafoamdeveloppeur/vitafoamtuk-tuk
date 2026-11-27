import { useEffect, useState } from 'react'
import { api, post, docUrl } from '../lib/api.js'
import { nomComplet, isoDate } from '../lib/format.js'
import { navigate, queryParam } from '../lib/router.js'
import { useApp, PageHead, Card, Button, Field, Input, Textarea, Select, Check, ErrorBox, Badge, Icon, Info, Link } from '../components/ui.jsx'

const ETAPES = ['Conducteur', 'Client', 'Confirmation', 'Terminé']

export default function NouveauClient() {
  const { ref, user } = useApp()
  const [etape, setEtape] = useState(1)
  const [conducteur, setConducteur] = useState(null)
  const [recherche, setRecherche] = useState('')
  const [resultats, setResultats] = useState([])
  const vide = { nom: '', prenom: '', telephone: '', quartier: '', motif: 'demande_prix', produits_interet: [], remarque: '', conseiller_id: String(user.id), saisie_papier: false, numero_fiche_papier: '', date_visite: '' }
  const [f, setF] = useState(vide)
  const [doublon, setDoublon] = useState(null)
  const [conseillers, setConseillers] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cree, setCree] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  // Conducteur passé dans l'adresse (?conducteur=12), sinon conducteurs les plus présents
  useEffect(() => {
    const id = queryParam('conducteur')
    if (id) api(`conducteurs/${id}`).then(d => { setConducteur(d.conducteur); setEtape(2) }).catch(() => {})
  }, [])
  useEffect(() => {
    const t = setTimeout(() => api(`conducteurs/recherche?q=${encodeURIComponent(recherche)}`).then(setResultats).catch(() => setResultats([])), recherche ? 250 : 0)
    return () => clearTimeout(t)
  }, [recherche])
  useEffect(() => {
    if (conducteur) api(`fiches/conseillers?agence=${conducteur.agence_id || ''}`).then(setConseillers).catch(() => {})
  }, [conducteur])
  useEffect(() => {
    if (!conducteur || f.telephone.replace(/\D/g, '').length < 9) { setDoublon(null); return undefined }
    const t = setTimeout(() => post('fiches/controle-doublon', { telephone: f.telephone, conducteur_id: conducteur.id }).then(r => {
      setDoublon(r.resultat)
      if (r.resultat?.client && !f.nom) setF(x => ({ ...x, nom: r.resultat.client.nom, prenom: r.resultat.client.prenom || '', quartier: r.resultat.client.quartier || '' }))
    }).catch(() => {}), 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.telephone, conducteur])

  const choisir = async c => {
    if (c.statut !== 'actif') return setError(new Error(`Conducteur ${c.code} ${ref.STATUTS_CONDUCTEUR[c.statut].toLowerCase()} : saisie impossible.`))
    setError(null)
    const d = await api(`conducteurs/${c.id}`).catch(e => { setError(e); return null })
    if (d) { setConducteur(d.conducteur); setEtape(2) }
  }
  const verifier = () => {
    if (!f.nom.trim()) return setError(new Error('Nom du client obligatoire.'))
    if (f.telephone.replace(/\D/g, '').length < 9) return setError(new Error('Numéro de téléphone invalide (ex. 034 12 345 67).'))
    if (f.saisie_papier && (!f.numero_fiche_papier || !f.date_visite)) return setError(new Error('Ressaisie papier : indiquez le n° et la date de la fiche.'))
    setError(null)
    setEtape(3)
  }
  const enregistrer = async () => {
    setBusy(true)
    setError(null)
    try {
      setCree(await post('fiches', { ...f, conducteur_id: conducteur.id }))
      setEtape(4)
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const recommencer = meme => { setF({ ...vide }); setDoublon(null); setCree(null); setError(null); if (!meme) setConducteur(null); setEtape(meme ? 2 : 1) }
  const toggleProduit = p => set('produits_interet', f.produits_interet.includes(p) ? f.produits_interet.filter(x => x !== p) : [...f.produits_interet, p])
  const min = new Date(); min.setDate(min.getDate() - 7)

  return (
    <>
      <PageHead title="Nouveau client" subtitle="Enregistrer la visite d'un client amené par un conducteur">
        <a className="btn btn-ghost" href={docUrl('fiche-papier')} target="_blank" rel="noreferrer"><Icon name="print" size={18} /> Fiche papier (secours)</a>
      </PageHead>
      <ol className="etapes">{ETAPES.map((e, i) => <li key={e} className={i + 1 === etape ? 'active' : i + 1 < etape ? 'fait' : ''}><span>{i + 1}</span>{e}</li>)}</ol>
      <ErrorBox error={error} />

      {etape === 1 && (
        <Card title="Quel conducteur amène le client ?">
          <Field label="Code partenaire, nom ou immatriculation"><Input value={recherche} onChange={setRecherche} placeholder="ex. TT-TNR-0012" autoFocus /></Field>
          {!recherche && <p className="muted small">Conducteurs les plus présents ces 7 derniers jours :</p>}
          <div className="choix-grille">
            {resultats.map(c => (
              <button type="button" key={c.id} className="choix" onClick={() => choisir(c)}>
                <Icon name={c.type === 'tuktuk' ? 'electric_rickshaw' : 'pedal_bike'} />
                <div><b>{c.code}</b><div className="muted small">{nomComplet(c.nom, c.prenom)} · {c.agence}</div></div>
                {c.statut !== 'actif' && <Badge statut={c.statut} refName="STATUTS_CONDUCTEUR" />}
              </button>
            ))}
          </div>
          {recherche.length >= 2 && !resultats.length && <Info tone="orange" icon="search_off">Aucun conducteur trouvé. <Link to="/conducteurs/nouveau">Inscrire un nouveau conducteur</Link></Info>}
        </Card>
      )}

      {etape >= 2 && etape < 4 && conducteur && (
        <div className="bandeau-conducteur">
          <Icon name={conducteur.type === 'tuktuk' ? 'electric_rickshaw' : 'pedal_bike'} />
          <div><b>{conducteur.code}</b> — {nomComplet(conducteur.nom, conducteur.prenom)} <span className="muted">({ref.TYPES_VEHICULE[conducteur.type]}, {conducteur.agence})</span></div>
          {etape === 2 && <Button variant="ghost" onClick={() => recommencer(false)}>Changer</Button>}
        </div>
      )}

      {etape === 2 && (
        <Card title="Le client">
          <div className="form-grid">
            <Field label="Téléphone du client" required hint="Contrôle doublon immédiat"><Input value={f.telephone} onChange={v => set('telephone', v)} placeholder="034 12 345 67" inputMode="tel" autoFocus /></Field>
            <div>{doublon && <Info tone={doublon.niveau === 'doublon' ? 'rouge' : doublon.niveau === 'ok' ? 'vert' : 'bleu'} icon={doublon.niveau === 'doublon' ? 'report' : 'info'}>{doublon.message}</Info>}</div>
            <Field label="Nom" required><Input value={f.nom} onChange={v => set('nom', v)} /></Field>
            <Field label="Prénom"><Input value={f.prenom} onChange={v => set('prenom', v)} /></Field>
            <Field label="Quartier"><Input value={f.quartier} onChange={v => set('quartier', v)} /></Field>
            <Field label="Motif de la visite" required><Select value={f.motif} onChange={v => set('motif', v)} options={ref.MOTIFS_VISITE} /></Field>
            <Field label="Produits d'intérêt" className="span-2">
              <div className="chips">{Object.entries(ref.NIVEAUX_PRODUIT).map(([k, l]) => <button type="button" key={k} className={`chip${f.produits_interet.includes(k) ? ' on' : ''}`} onClick={() => toggleProduit(k)}>{l}</button>)}</div>
            </Field>
            <Field label="Conseiller"><Select value={f.conseiller_id} onChange={v => set('conseiller_id', v)} options={conseillers.map(c => ({ value: String(c.id), label: c.nom }))} placeholder="—" /></Field>
            <Field label="Remarque"><Textarea value={f.remarque} onChange={v => set('remarque', v)} /></Field>
            <div className="span-2"><Check checked={f.saisie_papier} onChange={v => set('saisie_papier', v)} label="Ressaisie d'une fiche papier (coupure réseau ou électricité)" /></div>
            {f.saisie_papier && <>
              <Field label="N° de la fiche papier" required><Input value={f.numero_fiche_papier} onChange={v => set('numero_fiche_papier', v)} /></Field>
              <Field label="Date et heure de la visite" required hint="Dans les 7 derniers jours"><Input type="datetime-local" value={f.date_visite} onChange={v => set('date_visite', v)} min={`${isoDate(min)}T00:00`} max={`${isoDate(new Date())}T23:59`} /></Field>
            </>}
          </div>
          <div className="form-actions"><Button icon="arrow_forward" onClick={verifier}>Vérifier</Button></div>
        </Card>
      )}

      {etape === 3 && (
        <Card title="Vérifiez avant d'enregistrer">
          <dl className="dl">
            <div><dt>Client</dt><dd>{nomComplet(f.nom, f.prenom)}</dd></div>
            <div><dt>Téléphone</dt><dd>{f.telephone}</dd></div>
            <div><dt>Quartier</dt><dd>{f.quartier || '—'}</dd></div>
            <div><dt>Motif</dt><dd>{ref.MOTIFS_VISITE[f.motif]}</dd></div>
            <div><dt>Produits</dt><dd>{f.produits_interet.map(p => ref.NIVEAUX_PRODUIT[p]).join(', ') || '—'}</dd></div>
            {f.saisie_papier && <div><dt>Fiche papier</dt><dd>{f.numero_fiche_papier} du {f.date_visite.replace('T', ' ')}</dd></div>}
          </dl>
          {doublon?.niveau === 'doublon' && <Info tone="rouge" icon="report">{doublon.message} La fiche sera enregistrée et signalée au Responsable.</Info>}
          <div className="form-actions">
            <Button variant="ghost" icon="arrow_back" onClick={() => setEtape(2)}>Modifier</Button>
            <Button icon="save" busy={busy} onClick={enregistrer}>Enregistrer la fiche</Button>
          </div>
        </Card>
      )}

      {etape === 4 && cree && (
        <Card>
          <div className="succes">
            <Icon name={cree.est_doublon ? 'report' : 'task_alt'} size={52} />
            <h2>Fiche {cree.numero} enregistrée</h2>
            <p className="muted">{cree.est_doublon ? 'Client déjà attribué à un autre conducteur : aucune commission, alerte transmise au Responsable.' : 'La visite attend la validation du Responsable d’agence.'}</p>
            <div className="form-actions center">
              <Button icon="person_add" onClick={() => recommencer(true)}>Autre client du même conducteur</Button>
              <Button variant="ghost" icon="restart_alt" onClick={() => recommencer(false)}>Nouveau conducteur</Button>
              <Button variant="ghost" icon="visibility" onClick={() => navigate(`/fiches/${cree.id}`)}>Voir la fiche</Button>
            </div>
          </div>
        </Card>
      )}
    </>
  )
}
