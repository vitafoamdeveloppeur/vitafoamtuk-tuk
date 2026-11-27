/**
 * Documents imprimables (HTML A4 / carte) : carte partenaire, charte, reçu de paiement, fiche papier, compte-rendu.
 * Ouverts dans un nouvel onglet ; le bouton « Imprimer » permet aussi d'enregistrer en PDF.
 */
import { queryOne, query } from './db.js'
import { ApiError, escapeHtml as h, dateFr, ariary, afficherTelephone, parseJson } from './util.js'
import { TYPES_VEHICULE, MODES_PAIEMENT, OPERATEURS, MODES_PAIEMENT_CONDUCTEUR, STATUTS_CR, lib } from './ref.js'
import * as P from './parametres.js'
import { dataUrl } from './storage.js'

const STYLE = `
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1c2032;margin:0;background:#eef1f6;font-size:13px}
.page{background:#fff;width:210mm;min-height:297mm;margin:16px auto;padding:16mm 15mm;box-shadow:0 2px 12px rgba(0,0,0,.12)}
h1{font-size:20px;margin:0 0 4px;color:#0c1445}h2{font-size:15px;margin:22px 0 8px;color:#0c1445;border-bottom:2px solid #e0e9fe;padding-bottom:4px}
.entete{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0c1445;padding-bottom:10px;margin-bottom:16px}
.entete img{height:42px}.muted{color:#687188}table{width:100%;border-collapse:collapse;margin:6px 0}
th,td{border:1px solid #dde2ec;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f3f8;font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}.total td{font-weight:700;background:#f7f9fc}
.grille{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}.lbl{color:#687188;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.sig{border:1px solid #dde2ec;height:90px;display:flex;align-items:center;justify-content:center}.sig img{max-height:86px;max-width:100%}
.barre{position:sticky;top:0;background:#0c1445;color:#fff;padding:10px;text-align:center}.barre button{font-size:14px;padding:6px 18px;border:0;border-radius:6px;background:#f5a500;color:#0c1445;font-weight:700;cursor:pointer}
.carte{width:85.6mm;height:54mm;border-radius:4mm;background:linear-gradient(135deg,#0c1445,#1d3fce);color:#fff;padding:4mm 5mm;display:flex;gap:4mm;position:relative;overflow:hidden;margin:20px auto}
.carte .photo{width:22mm;height:28mm;border-radius:2mm;background:#fff3;object-fit:cover}.carte .code{font-size:17px;font-weight:800;letter-spacing:.06em;color:#ffc235}
.carte .nom{font-size:13px;font-weight:700;margin:2mm 0}.carte small{opacity:.8;font-size:9px;display:block}.carte .pied{position:absolute;bottom:3mm;left:5mm;right:5mm;font-size:8px;opacity:.85;display:flex;justify-content:space-between}
.case{display:inline-block;width:12px;height:12px;border:1px solid #1c2032;margin-right:6px;vertical-align:middle}.ligne{border-bottom:1px dotted #8e97ad;height:26px}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:auto}.barre{display:none}}`

async function page(titre, corps) {
  const entreprise = await P.get('entreprise_nom')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${h(titre)}</title><style>${STYLE}</style></head><body>
<div class="barre"><button type="button" id="imprimer">Imprimer / enregistrer en PDF</button></div>
${corps.replace(/\{ENTETE\}/g, `<div class="entete"><div><h1>${h(titre)}</h1><div class="muted">${h(entreprise)} — Programme partenaires tuk-tuk et cyclo-pousse</div></div><img src="/vitafoam-logo.png" alt=""></div>`)}
<script src="/print.js"></script></body></html>`
}

const nom = x => [x?.nom, x?.prenom].filter(Boolean).join(' ')

async function conducteur(id, user) {
  const c = await queryOne('SELECT c.*, a.nom AS agence, a.code AS agence_code, a.adresse AS agence_adresse, a.telephone AS agence_tel FROM conducteurs c JOIN agences a ON a.id = c.agence_id WHERE c.id = ?', [id])
  if (!c) throw new ApiError(404, 'Conducteur introuvable.')
  if (!user.agenceIds.includes(c.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à ce conducteur.")
  return c
}

export async function carte(id, user) {
  const c = await conducteur(id, user)
  const photo = dataUrl(c.photo)
  return page(`Carte partenaire ${c.code}`, `<div class="page">{ENTETE}
  <div class="carte">${photo ? `<img class="photo" src="${photo}" alt="">` : '<div class="photo"></div>'}
    <div><small>Partenaire ${h(TYPES_VEHICULE[c.type])}</small><div class="code">${h(c.code)}</div><div class="nom">${h(nom(c))}</div>
    <small>${c.immatriculation ? `Immatriculation : ${h(c.immatriculation)}<br>` : ''}Agence : ${h(c.agence)}</small></div>
    <div class="pied"><span>Présentez cette carte à chaque visite en agence</span><span>${h(afficherTelephone(c.agence_tel))}</span></div></div>
  <p class="muted" style="text-align:center">Découpez la carte et plastifiez-la. Code à donner au comptoir : <b>${h(c.code)}</b></p></div>`)
}

export async function charte(id, user) {
  const c = await conducteur(id, user)
  const b = Object.fromEntries((await query('SELECT niveau, montant FROM baremes')).map(r => [r.niveau, r.montant]))
  const delai = await P.entier('delai_achat_jours')
  const mois = await P.entier('attribution_mois')
  const sig = dataUrl(c.charte_signature)
  return page('Charte du programme partenaires', `<div class="page">{ENTETE}
  <div class="grille"><div><div class="lbl">Conducteur</div><b>${h(c.code)}</b> — ${h(nom(c))}</div><div><div class="lbl">Véhicule</div>${h(TYPES_VEHICULE[c.type])} ${h(c.immatriculation || '')}</div>
  <div><div class="lbl">CIN</div>${h(c.cin)}</div><div><div class="lbl">Téléphone</div>${h(afficherTelephone(c.telephone))}</div>
  <div><div class="lbl">Agence</div>${h(c.agence)}</div><div><div class="lbl">Paiement</div>${h(lib(MODES_PAIEMENT_CONDUCTEUR, c.mode_paiement))} ${c.operateur_mobile ? h(`${OPERATEURS[c.operateur_mobile]} ${afficherTelephone(c.numero_mobile_money)}`) : ''}</div></div>
  <h2>Engagements</h2>
  <p>1. Le conducteur présente son code partenaire à chaque visite d'un client en agence.</p>
  <p>2. Rémunération : ${ariary(b.visite)} par client amené (visite validée par le Responsable d'agence) ; ${ariary(b.entree_gamme)} pour un achat entrée de gamme ou de coussins ; ${ariary(b.haut_gamme)} pour un achat de matelas haut de gamme. Une seule rémunération par client : les montants déjà versés sont déduits de la commission finale.</p>
  <p>3. La commission d'achat n'est due que si la facture est entièrement encaissée et si l'achat a lieu dans les ${delai} jours suivant la visite.</p>
  <p>4. Un client est attribué au premier conducteur qui l'amène, pour ${mois} mois. Un client déjà attribué à un autre conducteur ne donne droit à aucune commission.</p>
  <p>5. Toute fraude (faux clients, clients déjà connus, visites fictives) entraîne la suspension du conducteur, le blocage de ses commissions et peut conduire à sa radiation.</p>
  <p>6. Les commissions validées sont payées chaque semaine, en espèces contre signature ou par Mobile Money.</p>
  <h2>Signatures</h2>
  <div class="grille"><div><div class="lbl">Le conducteur${c.charte_signee_le ? ` — signé le ${dateFr(c.charte_signee_le)}` : ''}</div><div class="sig">${sig ? `<img src="${sig}" alt="">` : ''}</div></div>
  <div><div class="lbl">Pour l'agence ${h(c.agence)}</div><div class="sig"></div></div></div></div>`)
}

export async function recu(id, user) {
  const p = await queryOne(`SELECT p.*, c.code, c.nom, c.prenom, c.type, a.nom AS agence, u.nom AS caissier FROM paiements p
    JOIN conducteurs c ON c.id = p.conducteur_id JOIN agences a ON a.id = p.agence_id JOIN utilisateurs u ON u.id = p.paye_par WHERE p.id = ?`, [id])
  if (!p) throw new ApiError(404, 'Paiement introuvable.')
  if (!user.agenceIds.includes(p.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à ce paiement.")
  const lignes = await query(`SELECT cm.*, cl.nom AS cl_nom, cl.prenom AS cl_prenom, f.numero AS fiche FROM commissions cm JOIN clients cl ON cl.id = cm.client_id
    LEFT JOIN fiches_suivi f ON f.id = cm.fiche_suivi_id WHERE cm.paiement_id = ? ORDER BY cm.id`, [id])
  const sig = dataUrl(p.signature)
  return page(`Reçu de paiement ${p.numero}`, `<div class="page">{ENTETE}
  <div class="grille"><div><div class="lbl">Conducteur</div><b>${h(p.code)}</b> — ${h(nom(p))}</div><div><div class="lbl">Agence</div>${h(p.agence)}</div>
  <div><div class="lbl">Payé le</div>${dateFr(p.paye_le)} par ${h(p.caissier)}</div><div><div class="lbl">Mode</div>${h(MODES_PAIEMENT[p.mode])}${p.reference_transaction ? ` — réf. ${h(p.reference_transaction)}` : ''}</div>
  <div><div class="lbl">Période</div>du ${dateFr(p.periode_debut)} au ${dateFr(p.periode_fin)}</div></div>
  <h2>Détail</h2><table><tr><th>Fiche</th><th>Client</th><th>Type</th><th class="num">Montant</th></tr>
  ${lignes.map(l => `<tr><td>${h(l.fiche || '—')}</td><td>${h([l.cl_nom, l.cl_prenom].filter(Boolean).join(' '))}</td><td>${h(l.type === 'regularisation' ? 'Régularisation' : l.type === 'visite' ? 'Visite' : 'Complément achat')}</td><td class="num">${ariary(l.montant)}</td></tr>`).join('')}
  <tr><td colspan="3">Commissions</td><td class="num">${ariary(p.montant_commissions)}</td></tr>
  <tr><td colspan="3">Régularisations</td><td class="num">${ariary(p.montant_regularisations)}</td></tr>
  <tr class="total"><td colspan="3">Net payé</td><td class="num">${ariary(p.montant_net)}</td></tr></table>
  <h2>Signatures</h2><div class="grille"><div><div class="lbl">Le conducteur</div><div class="sig">${sig ? `<img src="${sig}" alt="">` : (p.mode !== 'especes' ? '<span class="muted">Paiement Mobile Money</span>' : '')}</div></div>
  <div><div class="lbl">Le caissier</div><div class="sig"></div></div></div></div>`)
}

export async function fichePapier() {
  const ligne = (label) => `<tr><th style="width:38%">${label}</th><td><div class="ligne"></div></td></tr>`
  const bloc = n => `<div style="${n ? 'page-break-before:always;' : ''}">{ENTETE}
  <p class="muted">À utiliser seulement en cas de coupure (réseau, électricité). Ressaisir dans l'application sous 7 jours, avec le n° ci-dessous.</p>
  <table>${ligne('N° de fiche papier')}${ligne('Date et heure de visite')}${ligne('Code conducteur (TT-… / CP-…)')}${ligne('Nom du client')}${ligne('Prénom')}${ligne('Téléphone du client')}${ligne('Quartier')}
  <tr><th>Motif</th><td><span class="case"></span>Demande de prix &nbsp;&nbsp; <span class="case"></span>Achat</td></tr>
  <tr><th>Produits d'intérêt</th><td><span class="case"></span>Entrée de gamme &nbsp; <span class="case"></span>Coussins &nbsp; <span class="case"></span>Matelas haut de gamme</td></tr>
  ${ligne('Conseiller')}${ligne('Remarque')}</table>
  <div class="grille" style="margin-top:18px"><div><div class="lbl">Signature du conducteur</div><div class="sig"></div></div><div><div class="lbl">Visa du conseiller</div><div class="sig"></div></div></div></div>`
  return page('Fiche de suivi (papier)', `<div class="page">${bloc(0)}</div>`)
}

export async function compteRendu(id, user) {
  const cr = await queryOne('SELECT cr.*, a.nom AS agence, u.nom AS valideur FROM comptes_rendus cr JOIN agences a ON a.id = cr.agence_id LEFT JOIN utilisateurs u ON u.id = cr.valide_par WHERE cr.id = ?', [id])
  if (!cr) throw new ApiError(404, 'Compte-rendu introuvable.')
  if (!user.agenceIds.includes(cr.agence_id)) throw new ApiError(403, "Vous n'avez pas accès à cette agence.")
  const d = parseJson(cr.donnees, {})
  const L = (l, v) => `<tr><td>${l}</td><td class="num">${v}</td></tr>`
  return page(`Compte-rendu ${cr.agence}`, `<div class="page">{ENTETE}
  <p><b>Semaine du ${dateFr(cr.semaine_debut)} au ${dateFr(cr.semaine_fin)}</b> — statut : ${h(lib(STATUTS_CR, cr.statut))}${cr.valideur ? `, validé par ${h(cr.valideur)} le ${dateFr(cr.valide_le)}` : ''}</p>
  <h2>Indicateurs</h2><table>
  ${L('Conducteurs actifs (tuk-tuk / cyclo)', `${d.conducteurs_actifs} (${d.tuktuk_actifs} / ${d.cyclo_actifs})`)}${L('Nouveaux conducteurs', d.nouveaux_conducteurs)}
  ${L('Visites', d.visites)}${L('Visites validées / rejetées', `${d.visites_validees} / ${d.visites_rejetees}`)}${L('Doublons signalés', d.doublons)}
  ${L('Clients orientés', d.clients_orientes)}${L('Clients acheteurs', d.clients_acheteurs)}${L('Taux de transformation', `${d.taux_transformation} %`)}
  ${L("Chiffre d'affaires encaissé", ariary(d.ca))}${L('Commissions générées', ariary(d.commissions_generees))}${L('Commissions payées', ariary(d.commissions_payees))}
  ${L('Coût / CA', `${d.ratio_cout_ca} %`)}${L('Alertes', d.alertes)}</table>
  <h2>Par type de véhicule</h2><table><tr><th>Type</th><th class="num">Orientés</th><th class="num">Acheteurs</th><th class="num">CA</th></tr>
  ${Object.entries(d.par_type || {}).map(([t, i]) => `<tr><td>${h(TYPES_VEHICULE[t])}</td><td class="num">${i.orientes}</td><td class="num">${i.acheteurs}</td><td class="num">${ariary(i.ca)}</td></tr>`).join('')}</table>
  <h2>Meilleurs conducteurs</h2><table><tr><th>Code</th><th>Nom</th><th class="num">Orientés</th><th class="num">Acheteurs</th><th class="num">CA</th></tr>
  ${(d.top || []).map(t => `<tr><td>${h(t.code)}</td><td>${h(t.nom)}</td><td class="num">${t.orientes}</td><td class="num">${t.acheteurs}</td><td class="num">${ariary(t.ca)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune visite</td></tr>'}</table>
  <h2>Commentaire du Responsable</h2><p>${h(cr.commentaire || '—').replace(/\n/g, '<br>')}</p></div>`)
}
