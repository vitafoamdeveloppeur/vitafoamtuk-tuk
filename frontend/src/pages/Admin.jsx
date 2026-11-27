import { useEffect, useState } from 'react'
import { api, post, put, del } from '../lib/api.js'
import { ariary, dateFr, tel, nomComplet } from '../lib/format.js'
import { navigate } from '../lib/router.js'
import {
  useApp, useCan, useApi, useAction, PageHead, PageTabs, Card, DataTable, Badge, Button, ErrorBox, Loading, Modal, Field, Input, Textarea, Select, Check,
  DL, Stat, Icon, Info, Tabs,
} from '../components/ui.jsx'

const ONGLETS = [
  { to: '/agences', label: 'Agences', droit: 'agences.lire' }, { to: '/utilisateurs', label: 'Utilisateurs', droit: 'utilisateurs.lire' },
  { to: '/roles', label: 'Rôles et droits', droit: 'roles.lire' }, { to: '/parametres', label: 'Paramètres', droit: 'parametres.lire' },
]

export default function Admin({ path, params }) {
  if (params.id) return <FicheAgence id={params.id} />
  if (path === '/utilisateurs') return <Utilisateurs />
  if (path === '/roles') return <Roles />
  if (path === '/parametres') return <Parametres />
  return <Agences />
}

// ---------------------------------------------------------------- agences
function Agences() {
  const can = useCan()
  const [edit, setEdit] = useState(null)
  const { data, error, loading, reload } = useApi('agences')
  return (
    <>
      <PageHead title="Configuration" subtitle="Agences, utilisateurs, droits et paramètres">
        {can('agences.creer') && <Button icon="add" onClick={() => setEdit({ statut: 'active' })}>Nouvelle agence</Button>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/agences" />
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : <DataTable rows={data} empty="Aucune agence : créez la première pour inscrire des conducteurs." onRow={a => navigate(`/agences/${a.id}`)} columns={[
          { label: 'Code', render: a => <b>{a.code}</b> }, { label: 'Agence', key: 'nom' }, { label: 'Ville', render: a => a.ville || '—' },
          { label: 'Responsable', render: a => a.responsable || '—' }, { label: 'Conducteurs actifs', key: 'conducteurs_actifs', num: true },
          { label: 'Visites du mois', key: 'visites_mois', num: true }, { label: 'Utilisateurs', key: 'utilisateurs', num: true },
          { label: 'Statut', render: a => <Badge statut={a.statut}>{a.statut === 'active' ? 'Active' : 'Fermée'}</Badge> },
          can('agences.modifier') && { label: '', render: a => <Button variant="ghost" icon="edit" onClick={() => setEdit(a)} /> },
        ].filter(Boolean)} />}
      </Card>
      {edit && <FormAgence agence={edit} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  )
}

function FormAgence({ agence, onClose, onDone }) {
  const { toast, reloadRef } = useApp()
  const [v, setV] = useState({ ...agence, telephone: agence.telephone ? tel(agence.telephone) : '' })
  const [users, setUsers] = useState([])
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const can = useCan()
  useEffect(() => { if (can('utilisateurs.lire')) api('utilisateurs').then(setUsers).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, x) => setV(o => ({ ...o, [k]: x }))
  const go = async () => {
    setBusy(true)
    try {
      if (agence.id) await put(`agences/${agence.id}`, v); else await post('agences', v)
      toast('Agence enregistrée.'); reloadRef(); onDone(); onClose()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  return (
    <Modal title={agence.id ? `Modifier ${agence.nom}` : 'Nouvelle agence'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={go}>Enregistrer</Button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Nom" required><Input value={v.nom} onChange={x => set('nom', x)} /></Field>
        <Field label="Code (3 lettres)" required hint="Utilisé dans les codes partenaires TT-XXX-0001"><Input value={v.code} onChange={x => set('code', x.toUpperCase())} maxLength={3} /></Field>
        <Field label="Ville"><Input value={v.ville} onChange={x => set('ville', x)} /></Field>
        <Field label="Téléphone"><Input value={v.telephone} onChange={x => set('telephone', x)} /></Field>
        <Field label="Adresse" className="span-2"><Input value={v.adresse} onChange={x => set('adresse', x)} /></Field>
        <Field label="Horaires"><Input value={v.horaires} onChange={x => set('horaires', x)} placeholder="Lun-Sam 8h-18h" /></Field>
        <Field label="Responsable"><Select value={v.responsable_id ?? ''} onChange={x => set('responsable_id', x)} options={users.filter(u => u.actif).map(u => ({ value: u.id, label: u.nom }))} placeholder="—" /></Field>
        <Field label="Nom dans Odoo" hint="Équipe ou entrepôt, facultatif"><Input value={v.odoo_nom} onChange={x => set('odoo_nom', x)} /></Field>
        <Field label="Statut"><Select value={v.statut} onChange={x => set('statut', x)} options={{ active: 'Active', fermee: 'Fermée' }} /></Field>
      </div>
    </Modal>
  )
}

function FicheAgence({ id }) {
  const can = useCan()
  const [edit, setEdit] = useState(false)
  const { data, error, loading, reload } = useApi(`agences/${id}`)
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { agence: a, indicateurs: i, utilisateurs, top } = data
  return (
    <>
      <PageHead title={a.nom} subtitle={`Code ${a.code}${a.ville ? ` — ${a.ville}` : ''}`} back="/agences">
        <Badge statut={a.statut}>{a.statut === 'active' ? 'Active' : 'Fermée'}</Badge>
        {can('agences.modifier') && <Button variant="ghost" icon="edit" onClick={() => setEdit(true)}>Modifier</Button>}
      </PageHead>
      <div className="stats">
        <Stat icon="electric_rickshaw" label="Conducteurs actifs" value={i.conducteurs_actifs} hint={`${i.tuktuk_actifs} tuk-tuk · ${i.cyclo_actifs} cyclo`} />
        <Stat icon="directions_walk" label="Clients orientés (mois)" value={i.clients_orientes} tone="teal" />
        <Stat icon="shopping_cart" label="Acheteurs (mois)" value={i.clients_acheteurs} hint={`Taux ${i.taux_transformation} %`} tone="green" />
        <Stat icon="point_of_sale" label="CA encaissé (mois)" value={ariary(i.ca)} tone="violet" />
      </div>
      <div className="grid-2">
        <Card title="Informations"><DL items={[['Adresse', a.adresse], ['Téléphone', tel(a.telephone)], ['Horaires', a.horaires], ['Responsable', a.responsable], ['Nom Odoo', a.odoo_nom], ['Créée le', dateFr(a.created_at)]]} /></Card>
        <Card title="Utilisateurs rattachés" pad={false}><DataTable rows={utilisateurs} empty="Aucun utilisateur rattaché." columns={[{ label: 'Nom', key: 'nom' }, { label: 'E-mail', key: 'email' }, { label: 'Rôle', key: 'role' }]} /></Card>
      </div>
      <Card title="Meilleurs conducteurs du mois" pad={false}>
        <DataTable rows={top.map(t => ({ ...t, id: t.conducteur.id }))} onRow={r => navigate(`/conducteurs/${r.id}`)} empty="Aucune visite ce mois-ci." columns={[
          { label: 'Conducteur', render: r => <><b>{r.conducteur.code}</b> {nomComplet(r.conducteur.nom, r.conducteur.prenom)}</> }, { label: 'Orientés', key: 'orientes', num: true },
          { label: 'Acheteurs', key: 'acheteurs', num: true }, { label: 'CA', num: true, render: r => ariary(r.ca) }]} />
      </Card>
      {edit && <FormAgence agence={a} onClose={() => setEdit(false)} onDone={reload} />}
    </>
  )
}

// ---------------------------------------------------------------- utilisateurs
function Utilisateurs() {
  const { roles, agences } = useApp()
  const can = useCan()
  const [edit, setEdit] = useState(null)
  const { data, error, loading, reload } = useApi('utilisateurs')
  const libRole = Object.fromEntries(roles.map(r => [r.cle, r.libelle]))
  return (
    <>
      <PageHead title="Configuration" subtitle="Comptes des utilisateurs">
        {can('utilisateurs.creer') && <Button icon="person_add" onClick={() => setEdit({ role: 'commercial', portee: 'agences', actif: true, agences: [] })}>Nouvel utilisateur</Button>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/utilisateurs" />
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {loading && !data ? <Loading /> : <DataTable rows={data} onRow={can('utilisateurs.modifier') ? u => setEdit(u) : null} columns={[
          { label: 'Nom', render: u => <><b>{u.nom}</b><div className="muted small">{u.email}</div></> }, { label: 'Rôle', render: u => libRole[u.role] || u.role },
          { label: 'Agences', render: u => (u.portee === 'toutes' || u.role === 'super-admin' ? 'Toutes' : agences.filter(a => u.agences.includes(a.id)).map(a => a.code).join(', ') || '—') },
          { label: 'Dernière connexion', render: u => dateFr(u.derniereConnexion) },
          { label: 'Statut', render: u => <>{u.actif ? <Badge statut="actif">Actif</Badge> : <Badge statut="inactif">Désactivé</Badge>}{u.motDePasseProvisoire ? <Badge tone="orange">Mot de passe provisoire</Badge> : null}</> },
        ]} />}
      </Card>
      {edit && <FormUtilisateur u={edit} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  )
}

function FormUtilisateur({ u, onClose, onDone }) {
  const { roles, agences, toast, user } = useApp()
  const [v, setV] = useState({ ...u, telephone: u.telephone ? tel(u.telephone) : '', motDePasse: '' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, x) => setV(o => ({ ...o, [k]: x }))
  const genere = () => set('motDePasse', Array.from(crypto.getRandomValues(new Uint8Array(9)), b => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55]).join('') + '7')
  const go = async () => {
    setBusy(true)
    try {
      if (u.id) await put(`utilisateurs/${u.id}`, v); else await post('utilisateurs', v)
      toast(v.motDePasse ? `Compte enregistré. Mot de passe provisoire à transmettre : ${v.motDePasse}` : 'Compte enregistré.')
      onDone(); onClose()
    } catch (e) { setErr(e) } finally { setBusy(false) }
  }
  const toutes = v.portee === 'toutes' || v.role === 'super-admin'
  return (
    <Modal wide title={u.id ? `Modifier ${u.nom}` : 'Nouvel utilisateur'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={go}>Enregistrer</Button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Nom complet" required><Input value={v.nom} onChange={x => set('nom', x)} /></Field>
        <Field label="E-mail (identifiant de connexion)" required><Input type="email" value={v.email} onChange={x => set('email', x)} /></Field>
        <Field label="Téléphone"><Input value={v.telephone} onChange={x => set('telephone', x)} /></Field>
        <Field label="Rôle" required><Select value={v.role} onChange={x => set('role', x)} options={roles.filter(r => r.cle !== 'super-admin' || user.role === 'super-admin').map(r => ({ value: r.cle, label: r.libelle }))} /></Field>
        <Field label={u.id ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe provisoire'} required={!u.id} hint="10 caractères minimum ; à changer à la première connexion">
          <div className="input-group"><Input value={v.motDePasse} onChange={x => set('motDePasse', x)} /><Button variant="ghost" icon="casino" title="Générer" onClick={genere} /></div>
        </Field>
        <Field label="Portée des données"><Select value={v.portee} onChange={x => set('portee', x)} options={{ agences: 'Ses agences', toutes: 'Toutes les agences' }} /></Field>
        {!toutes && <Field label="Agences" className="span-2"><div className="chips">{agences.map(a => <button type="button" key={a.id} className={`chip${v.agences.includes(a.id) ? ' on' : ''}`} onClick={() => set('agences', v.agences.includes(a.id) ? v.agences.filter(x => x !== a.id) : [...v.agences, a.id])}>{a.nom}</button>)}</div></Field>}
        <div className="span-2"><Check checked={v.actif} onChange={x => set('actif', x)} label="Compte actif" /></div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- rôles et droits
function Roles() {
  const can = useCan()
  const { toast, reloadRef } = useApp()
  const { data, error, loading, reload } = useApi('roles')
  const [sel, setSel] = useState(null)
  const [droits, setDroits] = useState([])
  const [nouveau, setNouveau] = useState(null)
  useEffect(() => { if (data && !sel) { const r = data.roles.find(x => x.cle !== 'super-admin') || data.roles[0]; setSel(r.cle); setDroits(r.droits) } }, [data, sel])
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const role = data.roles.find(r => r.cle === sel)
  const modifiable = can('roles.modifier') && sel !== 'super-admin'
  const save = async () => { try { await put(`roles/${sel}`, { libelle: role.libelle, droits, portee_defaut: role.portee_defaut }); toast('Droits enregistrés.'); reload() } catch (e) { toast(e.message, 'erreur') } }
  const creer = async () => { try { await post('roles', { ...nouveau, droits: [] }); toast('Rôle créé.'); setNouveau(null); reloadRef(); reload() } catch (e) { toast(e.message, 'erreur') } }
  return (
    <>
      <PageHead title="Configuration" subtitle="Droits par page et par action pour chaque rôle">
        {can('roles.modifier') && <Button variant="ghost" icon="add" onClick={() => setNouveau({ cle: '', libelle: '' })}>Nouveau rôle</Button>}
      </PageHead>
      <PageTabs tabs={ONGLETS} current="/roles" />
      <Tabs value={sel} onChange={c => { setSel(c); setDroits(data.roles.find(r => r.cle === c).droits) }} tabs={data.roles.map(r => ({ id: r.cle, label: r.libelle }))} />
      {sel === 'super-admin' && <Info>Le super administrateur a toujours tous les droits.</Info>}
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table matrice">
            <thead><tr><th>Page</th>{Object.entries(data.actions).map(([a, l]) => <th key={a} className="center">{l}</th>)}</tr></thead>
            <tbody>
              {Object.entries(data.modules).map(([m, [libelle, actions]]) => (
                <tr key={m}><td>{libelle}</td>{Object.keys(data.actions).map(a => {
                  const d = `${m}.${a}`
                  return <td key={a} className="center">{actions.includes(a) && <input type="checkbox" disabled={!modifiable} checked={sel === 'super-admin' || droits.includes(d)} onChange={e => setDroits(e.target.checked ? [...droits, d] : droits.filter(x => x !== d))} />}</td>
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {modifiable && <div className="form-actions"><Button icon="save" onClick={save}>Enregistrer les droits de « {role?.libelle} »</Button></div>}
      {nouveau && (
        <Modal title="Nouveau rôle" onClose={() => setNouveau(null)} footer={<><Button variant="ghost" onClick={() => setNouveau(null)}>Annuler</Button><Button onClick={creer}>Créer</Button></>}>
          <Field label="Code" required hint="Lettres minuscules et tirets, ex. superviseur"><Input value={nouveau.cle} onChange={x => setNouveau({ ...nouveau, cle: x })} /></Field>
          <Field label="Libellé" required><Input value={nouveau.libelle} onChange={x => setNouveau({ ...nouveau, libelle: x })} /></Field>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------- paramètres
const GROUPES = { regles: 'Règles de rémunération', alertes: 'Seuils d’alerte', odoo: 'Connexion Odoo', general: 'Général' }

function Parametres() {
  const { ref, toast, reloadRef } = useApp()
  const can = useCan()
  const modif = can('parametres.modifier')
  const [onglet, setOnglet] = useState('regles')
  const [busy, run] = useAction()
  const { data, error, loading, reload } = useApi('parametres')
  const [vals, setVals] = useState({})
  const [baremes, setBaremes] = useState([])
  const [produit, setProduit] = useState(null)
  const [modele, setModele] = useState(null)
  useEffect(() => {
    if (!data) return
    setVals(Object.fromEntries(data.parametres.map(p => [p.cle, p.valeur])))
    setBaremes(data.baremes)
  }, [data])
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const saveParams = groupe => run('p', () => put('parametres', { valeurs: Object.fromEntries(data.parametres.filter(p => p.groupe === groupe).map(p => [p.cle, vals[p.cle]])) }), 'Paramètres enregistrés.', () => { reload(); reloadRef() })
  const champ = p => {
    const v = vals[p.cle]
    const onChange = x => setVals(o => ({ ...o, [p.cle]: x }))
    if (p.type === 'booleen') return <Check key={p.cle} checked={!!v} onChange={onChange} label={p.libelle} />
    return (
      <Field key={p.cle} label={p.libelle} hint={p.type === 'secret' ? (p.defini ? 'Clé enregistrée (chiffrée). Laissez vide pour la conserver.' : 'Aucune clé enregistrée.') : null}>
        <Input type={p.type === 'secret' ? 'password' : ['entier', 'decimal'].includes(p.type) ? 'number' : 'text'} step={p.type === 'decimal' ? '0.1' : undefined} value={v ?? ''} onChange={onChange} disabled={!modif} autoComplete="off" />
      </Field>
    )
  }
  return (
    <>
      <PageHead title="Configuration" subtitle="Paramètres modifiables sans développement" />
      <PageTabs tabs={ONGLETS} current="/parametres" />
      <Tabs value={onglet} onChange={setOnglet} tabs={[...Object.entries(GROUPES).map(([id, label]) => ({ id, label })), { id: 'bareme', label: 'Barème' }, { id: 'produits', label: 'Produits' }, { id: 'emails', label: 'E-mails' }]} />
      {GROUPES[onglet] && (
        <Card title={GROUPES[onglet]}>
          <div className="form-grid">{data.parametres.filter(p => p.groupe === onglet).map(champ)}</div>
          {onglet === 'odoo' && <Info>L’application crée chaque nouveau client comme contact Odoo (avec code conducteur, type, agence, n° de fiche) et récupère devis, commandes et factures. Utilisez un utilisateur technique Odoo et sa clé API (Préférences › Sécurité du compte › Nouvelle clé API).</Info>}
          {modif && <div className="form-actions">
            {onglet === 'odoo' && <>
              <Button variant="ghost" icon="lan" busy={busy === 't'} onClick={() => run('t', () => post('odoo/tester'), r => `Connexion réussie : Odoo ${r.version}, utilisateur #${r.uid}.`)}>Tester la connexion</Button>
              <Button variant="ghost" icon="playlist_add" busy={busy === 'c'} onClick={() => run('c', () => post('odoo/champs'), r => (r.crees.length ? `Champs créés : ${r.crees.join(', ')}` : 'Champs déjà présents dans Odoo.'))}>Créer les champs dans Odoo</Button>
            </>}
            <Button icon="save" busy={busy === 'p'} onClick={() => saveParams(onglet)}>Enregistrer</Button>
          </div>}
        </Card>
      )}
      {onglet === 'bareme' && (
        <Card title="Barème de rémunération" pad={false}>
          <DataTable rows={baremes.map(b => ({ ...b, id: b.niveau }))} columns={[
            { label: 'Niveau', render: b => ref.NIVEAUX[b.niveau] },
            { label: 'Libellé', render: b => <Input value={b.libelle} disabled={!modif} onChange={x => setBaremes(bs => bs.map(y => (y.niveau === b.niveau ? { ...y, libelle: x } : y)))} /> },
            { label: 'Montant (Ar)', render: b => <Input type="number" value={b.montant} disabled={!modif} onChange={x => setBaremes(bs => bs.map(y => (y.niveau === b.niveau ? { ...y, montant: x } : y)))} /> },
          ]} />
          <div className="card-body">
            <p className="muted small">Une seule rémunération par client et par attribution : le montant déjà accordé est déduit du complément (ex. {ariary(baremes.find(b => b.niveau === 'visite')?.montant)} puis complément jusqu’au barème de l’achat). Les nouveaux montants s’appliquent aux prochains calculs.</p>
            {modif && <div className="form-actions"><Button icon="save" busy={busy === 'b'} onClick={() => run('b', () => put('baremes', { baremes: baremes.map(b => ({ ...b, montant: Number(b.montant) })) }), 'Barème enregistré.', reload)}>Enregistrer le barème</Button></div>}
          </div>
        </Card>
      )}
      {onglet === 'produits' && (
        <Card title="Produits classés par niveau (correspondance Odoo)" actions={modif && <Button icon="add" onClick={() => setProduit({ niveau: 'entree_gamme', actif: true })}>Ajouter</Button>} pad={false}>
          <DataTable rows={data.produits} empty="Aucun produit classé : toute facture avec produit non reconnu compte comme « entrée de gamme »." onRow={modif ? p => setProduit({ ...p, actif: !!p.actif }) : null} columns={[
            { label: 'Produit', key: 'nom' }, { label: 'Référence Odoo', render: p => p.reference || '—' }, { label: 'Id produit', render: p => p.odoo_produit_id || '—' },
            { label: 'Id catégorie', render: p => p.odoo_categorie_id || '—' }, { label: 'Niveau', render: p => ref.NIVEAUX_PRODUIT[p.niveau] },
            { label: 'Actif', render: p => (p.actif ? 'Oui' : 'Non') },
          ]} />
          <div className="card-body"><p className="muted small">Reconnaissance d’une ligne de facture : par id de produit Odoo, sinon par référence interne, sinon par catégorie. Facture mixte : le niveau le plus élevé l’emporte.</p></div>
        </Card>
      )}
      {onglet === 'emails' && (
        <>
          <Info tone={data.smtp ? 'vert' : 'orange'} icon="mail">{data.smtp ? 'Serveur d’envoi configuré (fichier .env).' : 'Aucun serveur d’envoi configuré : renseignez SMTP_HOST, SMTP_USER, SMTP_PASSWORD et SMTP_FROM dans le fichier .env du serveur, puis redémarrez.'}
            {data.smtp && modif && <> <Button variant="ghost" busy={busy === 'm'} onClick={() => run('m', () => post('mail/test'), 'E-mail de test envoyé à votre adresse.')}>Envoyer un test</Button></>}</Info>
          <Card title="Modèles d’e-mails" pad={false}>
            <DataTable rows={data.modeles.map(m => ({ ...m, id: m.cle }))} onRow={modif ? m => setModele(m) : null} columns={[{ label: 'Modèle', key: 'libelle' }, { label: 'Sujet', key: 'sujet' }, { label: 'Variables', render: m => <span className="muted small">{m.variables}</span> }]} />
          </Card>
        </>
      )}
      {produit && <ModaleProduit p={produit} onClose={() => setProduit(null)} onDone={reload} />}
      {modele && (
        <Modal wide title={modele.libelle} onClose={() => setModele(null)} footer={<><Button variant="ghost" onClick={() => setModele(null)}>Annuler</Button><Button onClick={async () => { try { await put(`modeles-email/${modele.cle}`, modele); toast('Modèle enregistré.'); setModele(null); reload() } catch (e) { toast(e.message, 'erreur') } }}>Enregistrer</Button></>}>
          <Field label="Sujet"><Input value={modele.sujet} onChange={x => setModele({ ...modele, sujet: x })} /></Field>
          <Field label="Texte" hint={`Variables : ${modele.variables}`}><Textarea rows={8} value={modele.corps} onChange={x => setModele({ ...modele, corps: x })} /></Field>
        </Modal>
      )}
    </>
  )
}

function ModaleProduit({ p, onClose, onDone }) {
  const { ref, toast } = useApp()
  const [v, setV] = useState(p)
  const set = (k, x) => setV(o => ({ ...o, [k]: x }))
  const go = async () => { try { await post('produits', v); toast('Produit enregistré.'); onDone(); onClose() } catch (e) { toast(e.message, 'erreur') } }
  const supprimer = async () => { try { await del(`produits/${p.id}`); toast('Produit supprimé.'); onDone(); onClose() } catch (e) { toast(e.message, 'erreur') } }
  return (
    <Modal title={p.id ? 'Modifier le produit' : 'Nouveau produit'} onClose={onClose} footer={<>{p.id && <Button variant="danger" icon="delete" onClick={supprimer}>Supprimer</Button>}<Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={go}>Enregistrer</Button></>}>
      <div className="form-grid">
        <Field label="Nom" required className="span-2"><Input value={v.nom} onChange={x => set('nom', x)} /></Field>
        <Field label="Référence interne Odoo"><Input value={v.reference} onChange={x => set('reference', x)} /></Field>
        <Field label="Niveau" required><Select value={v.niveau} onChange={x => set('niveau', x)} options={ref.NIVEAUX_PRODUIT} /></Field>
        <Field label="Id produit Odoo"><Input type="number" value={v.odoo_produit_id} onChange={x => set('odoo_produit_id', x)} /></Field>
        <Field label="Id catégorie Odoo"><Input type="number" value={v.odoo_categorie_id} onChange={x => set('odoo_categorie_id', x)} /></Field>
        <Check checked={v.actif} onChange={x => set('actif', x)} label="Actif" />
      </div>
    </Modal>
  )
}
