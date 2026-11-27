-- =====================================================================
-- Suivi Tuk-tuk & Cyclo — schéma MariaDB / MySQL complet (idempotent)
-- Exécuté par « npm run db:init ». Les dates et heures sont enregistrées
-- à l'heure locale de Madagascar (Indian/Antananarivo).
-- =====================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  cle VARCHAR(40) NOT NULL PRIMARY KEY,
  libelle VARCHAR(100) NOT NULL,
  droits JSON NULL,
  portee_defaut VARCHAR(10) NOT NULL DEFAULT 'agences',
  systeme TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS utilisateurs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  telephone VARCHAR(20) NULL,
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'commercial',
  portee VARCHAR(10) NOT NULL DEFAULT 'agences',      -- agences | toutes
  actif TINYINT(1) NOT NULL DEFAULT 1,
  protege TINYINT(1) NOT NULL DEFAULT 0,
  mot_de_passe_provisoire TINYINT(1) NOT NULL DEFAULT 0,
  notifications JSON NULL,                              -- { commissions, alertes, compte_rendu }
  derniere_connexion_le DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  KEY idx_utilisateurs_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(43) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at INT UNSIGNED NOT NULL,
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tentatives (
  cle VARCHAR(190) NOT NULL PRIMARY KEY,
  nb INT UNSIGNED NOT NULL DEFAULT 0,
  debut INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agences (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(150) NOT NULL,
  code VARCHAR(3) NOT NULL UNIQUE,
  ville VARCHAR(100) NULL,
  adresse VARCHAR(200) NULL,
  telephone VARCHAR(20) NULL,
  horaires VARCHAR(150) NULL,
  responsable_id INT UNSIGNED NULL,
  statut VARCHAR(10) NOT NULL DEFAULT 'active',        -- active | fermee
  odoo_nom VARCHAR(150) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  CONSTRAINT fk_agences_resp FOREIGN KEY (responsable_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agence_utilisateur (
  agence_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (agence_id, user_id),
  CONSTRAINT fk_au_agence FOREIGN KEY (agence_id) REFERENCES agences(id) ON DELETE CASCADE,
  CONSTRAINT fk_au_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parametres (
  cle VARCHAR(60) NOT NULL PRIMARY KEY,
  valeur TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Barème de rémunération par niveau
CREATE TABLE IF NOT EXISTS baremes (
  niveau VARCHAR(20) NOT NULL PRIMARY KEY,           -- visite | entree_gamme | coussins | haut_gamme
  libelle VARCHAR(150) NOT NULL,
  montant INT UNSIGNED NOT NULL,
  rang TINYINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Référentiel des produits classés par niveau (correspondance avec Odoo)
CREATE TABLE IF NOT EXISTS produits (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(150) NOT NULL,
  reference VARCHAR(100) NULL,
  odoo_produit_id BIGINT UNSIGNED NULL,
  odoo_categorie_id BIGINT UNSIGNED NULL,
  niveau VARCHAR(20) NOT NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_produits_ref (reference),
  KEY idx_produits_odoo (odoo_produit_id),
  KEY idx_produits_categ (odoo_categorie_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conducteurs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,                  -- TT-ABC-0001 / CP-ABC-0001
  numero INT UNSIGNED NOT NULL,
  type VARCHAR(10) NOT NULL,                         -- tuktuk | cyclo
  agence_id INT UNSIGNED NOT NULL,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NULL,
  telephone VARCHAR(20) NOT NULL UNIQUE,
  cin VARCHAR(20) NOT NULL UNIQUE,
  immatriculation VARCHAR(30) NULL UNIQUE,
  photo VARCHAR(200) NULL,
  mode_paiement VARCHAR(15) NOT NULL DEFAULT 'especes',
  operateur_mobile VARCHAR(15) NULL,
  numero_mobile_money VARCHAR(20) NULL,
  statut VARCHAR(10) NOT NULL DEFAULT 'actif',       -- actif | suspendu | radie
  motif_statut VARCHAR(250) NULL,
  charte_signee_le DATETIME NULL,
  charte_signature VARCHAR(200) NULL,
  commissions_bloquees TINYINT(1) NOT NULL DEFAULT 0,
  cree_par INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_conducteur_numero (agence_id, type, numero),
  CONSTRAINT fk_conducteurs_agence FOREIGN KEY (agence_id) REFERENCES agences(id),
  CONSTRAINT fk_conducteurs_createur FOREIGN KEY (cree_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clients (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NULL,
  telephone VARCHAR(20) NOT NULL UNIQUE,             -- +261…
  quartier VARCHAR(100) NULL,
  agence_id INT UNSIGNED NOT NULL,
  conducteur_id INT UNSIGNED NULL,                   -- apporteur (12 mois)
  attribue_le DATE NULL,
  attribution_fin DATE NULL,
  odoo_partenaire_id BIGINT UNSIGNED NULL,
  odoo_statut VARCHAR(15) NOT NULL DEFAULT 'en_attente', -- en_attente | synchronise | erreur
  odoo_erreur TEXT NULL,
  odoo_synchronise_le DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  KEY idx_clients_odoo (odoo_partenaire_id),
  CONSTRAINT fk_clients_agence FOREIGN KEY (agence_id) REFERENCES agences(id),
  CONSTRAINT fk_clients_conducteur FOREIGN KEY (conducteur_id) REFERENCES conducteurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fiches_suivi (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(30) NOT NULL UNIQUE,                -- FS-ABC-2026-00001
  agence_id INT UNSIGNED NOT NULL,
  conducteur_id INT UNSIGNED NOT NULL,
  client_id INT UNSIGNED NOT NULL,
  conseiller_id INT UNSIGNED NULL,
  saisi_par INT UNSIGNED NOT NULL,
  motif VARCHAR(15) NOT NULL,                        -- demande_prix | achat
  produits_interet JSON NULL,
  remarque TEXT NULL,
  statut VARCHAR(20) NOT NULL DEFAULT 'enregistree',
  date_visite DATETIME NOT NULL,
  date_limite DATE NOT NULL,
  est_doublon TINYINT(1) NOT NULL DEFAULT 0,
  motif_doublon VARCHAR(250) NULL,
  valide_par INT UNSIGNED NULL,
  valide_le DATETIME NULL,
  motif_rejet VARCHAR(250) NULL,
  saisie_papier TINYINT(1) NOT NULL DEFAULT 0,
  numero_fiche_papier VARCHAR(30) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  KEY idx_fiches_statut (statut),
  KEY idx_fiches_date (date_visite),
  CONSTRAINT fk_fiches_agence FOREIGN KEY (agence_id) REFERENCES agences(id),
  CONSTRAINT fk_fiches_conducteur FOREIGN KEY (conducteur_id) REFERENCES conducteurs(id),
  CONSTRAINT fk_fiches_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_fiches_conseiller FOREIGN KEY (conseiller_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  CONSTRAINT fk_fiches_saisi FOREIGN KEY (saisi_par) REFERENCES utilisateurs(id),
  CONSTRAINT fk_fiches_valide FOREIGN KEY (valide_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ventes issues d'Odoo : devis / commandes (sale.order) et factures (account.move)
CREATE TABLE IF NOT EXISTS ventes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  odoo_modele VARCHAR(20) NOT NULL,
  odoo_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(10) NOT NULL,                         -- devis | commande | facture | avoir
  reference VARCHAR(100) NULL,
  client_id INT UNSIGNED NOT NULL,
  fiche_suivi_id INT UNSIGNED NULL,
  agence_id INT UNSIGNED NOT NULL,
  etat VARCHAR(20) NOT NULL,
  etat_paiement VARCHAR(20) NULL,
  montant_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  montant_restant DECIMAL(14,2) NOT NULL DEFAULT 0,
  niveau VARCHAR(20) NULL,
  niveau_par_defaut TINYINT(1) NOT NULL DEFAULT 0,
  lignes JSON NULL,
  date_document DATE NULL,
  encaisse_le DATETIME NULL,
  odoo_commande_id BIGINT UNSIGNED NULL,
  odoo_modifie_le VARCHAR(30) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_ventes_odoo (odoo_modele, odoo_id),
  CONSTRAINT fk_ventes_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_ventes_fiche FOREIGN KEY (fiche_suivi_id) REFERENCES fiches_suivi(id) ON DELETE SET NULL,
  CONSTRAINT fk_ventes_agence FOREIGN KEY (agence_id) REFERENCES agences(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS paiements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(30) NOT NULL UNIQUE,                -- PAY-ABC-2026-0001
  conducteur_id INT UNSIGNED NOT NULL,
  agence_id INT UNSIGNED NOT NULL,
  periode_debut DATE NOT NULL,
  periode_fin DATE NOT NULL,
  montant_commissions INT NOT NULL,
  montant_regularisations INT NOT NULL,
  montant_net INT NOT NULL,
  mode VARCHAR(15) NOT NULL,                         -- especes | mvola | orange_money | airtel_money
  reference_transaction VARCHAR(100) NULL,
  signature VARCHAR(200) NULL,
  paye_par INT UNSIGNED NOT NULL,
  paye_le DATETIME NOT NULL,
  statut VARCHAR(10) NOT NULL DEFAULT 'paye',
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_paiements_conducteur FOREIGN KEY (conducteur_id) REFERENCES conducteurs(id),
  CONSTRAINT fk_paiements_agence FOREIGN KEY (agence_id) REFERENCES agences(id),
  CONSTRAINT fk_paiements_user FOREIGN KEY (paye_par) REFERENCES utilisateurs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS commissions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conducteur_id INT UNSIGNED NOT NULL,
  client_id INT UNSIGNED NOT NULL,
  fiche_suivi_id INT UNSIGNED NULL,
  vente_id INT UNSIGNED NULL,
  agence_id INT UNSIGNED NOT NULL,
  type VARCHAR(15) NOT NULL,                         -- visite | complement | regularisation
  niveau VARCHAR(20) NOT NULL,
  montant_bareme INT NOT NULL,
  montant_deduit INT NOT NULL DEFAULT 0,
  montant INT NOT NULL,
  statut VARCHAR(15) NOT NULL DEFAULT 'a_valider',   -- a_valider | validee | payee | rejetee | bloquee | annulee
  controles JSON NULL,
  motif VARCHAR(250) NULL,
  valide_par INT UNSIGNED NULL,
  valide_le DATETIME NULL,
  paiement_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  KEY idx_commissions_statut (statut),
  CONSTRAINT fk_comm_conducteur FOREIGN KEY (conducteur_id) REFERENCES conducteurs(id),
  CONSTRAINT fk_comm_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_comm_fiche FOREIGN KEY (fiche_suivi_id) REFERENCES fiches_suivi(id) ON DELETE SET NULL,
  CONSTRAINT fk_comm_vente FOREIGN KEY (vente_id) REFERENCES ventes(id) ON DELETE SET NULL,
  CONSTRAINT fk_comm_agence FOREIGN KEY (agence_id) REFERENCES agences(id),
  CONSTRAINT fk_comm_valide FOREIGN KEY (valide_par) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  CONSTRAINT fk_comm_paiement FOREIGN KEY (paiement_id) REFERENCES paiements(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alertes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(30) NOT NULL,                         -- visites_excessives | taux_transformation | client_doublon | odoo
  gravite VARCHAR(10) NOT NULL DEFAULT 'moyenne',
  agence_id INT UNSIGNED NULL,
  conducteur_id INT UNSIGNED NULL,
  client_id INT UNSIGNED NULL,
  fiche_suivi_id INT UNSIGNED NULL,
  message VARCHAR(500) NOT NULL,
  donnees JSON NULL,
  cle_unicite VARCHAR(190) NULL UNIQUE,
  statut VARCHAR(10) NOT NULL DEFAULT 'ouverte',     -- ouverte | traitee
  action VARCHAR(25) NULL,
  commentaire TEXT NULL,
  traitee_par INT UNSIGNED NULL,
  traitee_le DATETIME NULL,
  created_at DATETIME NOT NULL,
  CONSTRAINT fk_alertes_agence FOREIGN KEY (agence_id) REFERENCES agences(id) ON DELETE SET NULL,
  CONSTRAINT fk_alertes_conducteur FOREIGN KEY (conducteur_id) REFERENCES conducteurs(id) ON DELETE SET NULL,
  CONSTRAINT fk_alertes_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_alertes_fiche FOREIGN KEY (fiche_suivi_id) REFERENCES fiches_suivi(id) ON DELETE SET NULL,
  CONSTRAINT fk_alertes_user FOREIGN KEY (traitee_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comptes_rendus (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agence_id INT UNSIGNED NOT NULL,
  semaine_debut DATE NOT NULL,
  semaine_fin DATE NOT NULL,
  donnees JSON NOT NULL,
  commentaire TEXT NULL,
  statut VARCHAR(10) NOT NULL DEFAULT 'brouillon',   -- brouillon | valide | envoye
  valide_par INT UNSIGNED NULL,
  valide_le DATETIME NULL,
  envoye_le DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  UNIQUE KEY uq_cr (agence_id, semaine_debut),
  CONSTRAINT fk_cr_agence FOREIGN KEY (agence_id) REFERENCES agences(id),
  CONSTRAINT fk_cr_user FOREIGN KEY (valide_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS odoo_synchronisations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation VARCHAR(30) NOT NULL,                    -- envoi_client | import_ventes | test_connexion | champs
  statut VARCHAR(10) NOT NULL,                       -- succes | erreur | partiel
  nb_elements INT UNSIGNED NOT NULL DEFAULT 0,
  nb_erreurs INT UNSIGNED NOT NULL DEFAULT 0,
  message TEXT NULL,
  details JSON NULL,
  user_id INT UNSIGNED NULL,
  debut DATETIME NOT NULL,
  fin DATETIME NULL,
  CONSTRAINT fk_odoo_user FOREIGN KEY (user_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historique fonctionnel : visites, ventes, commissions, paiements
CREATE TABLE IF NOT EXISTS evenements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(20) NOT NULL,
  action VARCHAR(40) NOT NULL,
  libelle VARCHAR(255) NOT NULL,
  montant INT NULL,
  agence_id INT UNSIGNED NULL,
  conducteur_id INT UNSIGNED NULL,
  client_id INT UNSIGNED NULL,
  fiche_suivi_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  KEY idx_evt_type (type),
  KEY idx_evt_date (created_at),
  KEY idx_evt_fiche (fiche_suivi_id),
  KEY idx_evt_conducteur (conducteur_id),
  KEY idx_evt_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Journal d'audit technique (connexions, modifications)
CREATE TABLE IF NOT EXISTS audit_log (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  user_nom VARCHAR(150) NULL,
  action VARCHAR(40) NOT NULL,
  objet VARCHAR(40) NULL,
  objet_id VARCHAR(40) NULL,
  detail VARCHAR(500) NULL,
  ip VARCHAR(64) NULL,
  at DATETIME NOT NULL,
  KEY idx_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modeles_email (
  cle VARCHAR(60) NOT NULL PRIMARY KEY,
  libelle VARCHAR(150) NOT NULL,
  sujet VARCHAR(250) NOT NULL,
  corps TEXT NOT NULL,
  variables VARCHAR(250) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- données de départ
INSERT IGNORE INTO baremes (niveau, libelle, montant, rang) VALUES
  ('visite', 'Client amené sans achat', 1000, 1),
  ('entree_gamme', 'Achat entrée de gamme (facture encaissée)', 5000, 2),
  ('coussins', 'Achat coussins (facture encaissée)', 5000, 3),
  ('haut_gamme', 'Achat matelas haut de gamme (facture encaissée)', 10000, 4);

INSERT IGNORE INTO modeles_email (cle, libelle, sujet, corps, variables) VALUES
  ('alerte', 'Nouvelle alerte', 'Alerte : {type}',
   'Une alerte a été levée pour l''agence {agence}.\n\n{message}\n\nMerci de la traiter dans l''application (commentaire, suspension du conducteur ou blocage des commissions).',
   '{type} {message} {agence}'),
  ('commissions_a_valider', 'Rappel des commissions à valider', '{nombre} commission(s) à valider',
   '{nombre} commission(s) pour un total de {montant} attendent votre validation ({agences}).', '{nombre} {montant} {agences}'),
  ('compte_rendu_a_valider', 'Compte-rendu à relire (Responsable)', 'Compte-rendu {agence} à relire',
   'Le compte-rendu hebdomadaire de l''agence {agence} (semaine du {semaine}) est prêt. Merci de le relire, de le commenter et de le valider : il sera alors envoyé à la Direction.',
   '{agence} {semaine}'),
  ('compte_rendu', 'Compte-rendu hebdomadaire (Direction)', 'Compte-rendu hebdomadaire {agence} — semaine du {semaine}',
   'Veuillez trouver ci-dessous le compte-rendu de l''agence {agence} pour la semaine du {semaine}.\n\nClients orientés : {orientes} — clients acheteurs : {acheteurs} — CA généré : {ca}.\n\nCommentaire du Responsable : {commentaire}\n\nVersion imprimable : {lien}',
   '{agence} {semaine} {orientes} {acheteurs} {ca} {commentaire} {lien}');
