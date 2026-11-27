# Déploiement sur le VPS OVH (Ubuntu)

Cible : **https://tuktuk.vitafoampointage.com**, application Node sur le port **3002**, dossier `/home/ubuntu/PROJET/TUK-TUK`, base **MySQL**.

> Ce guide crée uniquement des éléments nouveaux (une base, un utilisateur MySQL, un processus PM2 « tuktuk », un fichier Nginx `tuktuk.conf`). Il ne modifie **aucun** autre site, ni `pointage-test.conf`, ni le port 3001.

## 0. Prérequis (vérification)

```bash
node -v      # 20.19 ou plus récent (22 conseillé)
mysql --version
pm2 -v       # sinon : sudo npm install -g pm2
nginx -v
```

Le DNS `tuktuk.vitafoampointage.com` doit pointer vers 149.56.208.132 : `dig +short tuktuk.vitafoampointage.com`.

## 1. Base de données MySQL

```bash
sudo mysql
```
```sql
CREATE DATABASE suivi_tuktuk CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tuktuk'@'localhost' IDENTIFIED BY 'UN_MOT_DE_PASSE_SOLIDE';
GRANT ALL PRIVILEGES ON suivi_tuktuk.* TO 'tuktuk'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 2. Récupérer le code

```bash
cd /home/ubuntu/PROJET
# Le dossier TUK-TUK existe déjà et est vide : on clone dedans
git clone https://github.com/vitafoamdeveloppeur/vitafoamtuk-tuk.git TUK-TUK
cd TUK-TUK
```

## 3. Configuration (.env)

```bash
cp .env.example .env
openssl rand -hex 32        # copier le résultat dans SESSION_SECRET
nano .env
```

À remplir au minimum :

| Variable | Valeur |
|---|---|
| `SESSION_SECRET` | le résultat de `openssl rand -hex 32` |
| `DB_PASSWORD` | le mot de passe MySQL de l'étape 1 |
| `ADMIN_EMAIL` | l'e-mail du premier super administrateur |
| `ADMIN_INITIAL_PASSWORD` | mot de passe provisoire (10 caractères minimum), à changer à la 1re connexion |
| `SMTP_*` | facultatif, pour les alertes, rappels et comptes-rendus par e-mail |

`PORT=3002` et `HOST=127.0.0.1` sont déjà réglés : l'application n'est joignable que via Nginx.

```bash
chmod 600 .env
```

## 4. Installation, build et initialisation de la base

```bash
npm ci
npm run build       # génère dist/ (l'interface React)
npm run db:init     # crée les tables, le barème, les modèles d'e-mails et le compte admin
```

Test rapide (Ctrl+C pour arrêter) :
```bash
npm start
# dans un autre terminal : curl -s http://127.0.0.1:3002/api/health
```

## 5. Lancement permanent avec PM2

```bash
pm2 start ecosystem.config.cjs     # processus nommé « tuktuk »
pm2 save                            # mémorise la liste (les autres applis restent inchangées)
pm2 logs tuktuk --lines 50
```

Si PM2 n'est pas encore lancé au démarrage du serveur : `pm2 startup` puis exécuter la commande affichée (déjà fait si PointagePro tourne sous PM2).

## 6. Nginx et HTTPS

On obtient d'abord le certificat avec une configuration temporaire sur le port 80, puis on installe la configuration finale (même modèle que `pointage-test.conf`).

```bash
# 6.1 configuration temporaire (port 80)
sudo cp deploy/nginx-tuktuk-http.conf /etc/nginx/sites-available/tuktuk.conf
sudo ln -s /etc/nginx/sites-available/tuktuk.conf /etc/nginx/sites-enabled/tuktuk.conf
sudo nginx -t && sudo systemctl reload nginx

# 6.2 certificat Let's Encrypt (certonly : certbot ne modifie aucun fichier Nginx)
sudo certbot certonly --nginx -d tuktuk.vitafoampointage.com

# 6.3 configuration finale HTTPS (443 ssl + redirection 301 du port 80)
sudo cp deploy/nginx-tuktuk.conf /etc/nginx/sites-available/tuktuk.conf
sudo nginx -t && sudo systemctl reload nginx
```

Si `nginx -t` signale une erreur, **ne pas recharger** : corriger seulement `tuktuk.conf`. Le renouvellement automatique du certificat est déjà géré par le timer certbot (`sudo certbot renew --dry-run` pour vérifier).

Ouvrir **https://tuktuk.vitafoampointage.com** et se connecter avec `ADMIN_EMAIL` / `ADMIN_INITIAL_PASSWORD`. Le mot de passe provisoire doit être changé immédiatement.

## 7. Premiers réglages dans l'application

1. **Administration › Agences** : créer les agences (le code sert aux numéros TT-XXX-0001, FS-XXX-…).
2. **Administration › Utilisateurs** : créer les comptes et les rattacher aux agences.
3. **Administration › Paramètres** : vérifier le barème (1000 / 5000 / 10000 Ar), les délais (60 jours, 12 mois), les modèles d'e-mails.
4. **Odoo** (Paramètres › Odoo) : URL, base, identifiant et clé API (stockée chiffrée), puis « Tester », « Installer les champs » et activer la synchronisation.
5. **E-mail** : bouton « Envoyer un e-mail de test » si SMTP est rempli.

## 8. Mise à jour

```bash
cd /home/ubuntu/PROJET/TUK-TUK
git pull
npm ci
npm run build
pm2 restart tuktuk
```

Les nouvelles tables ou colonnes sont appliquées automatiquement au démarrage.

## 9. Sauvegardes

```bash
mysqldump -u tuktuk -p suivi_tuktuk | gzip > ~/sauvegarde-tuktuk-$(date +%F).sql.gz
tar czf ~/storage-tuktuk-$(date +%F).tar.gz -C /home/ubuntu/PROJET/TUK-TUK storage
```

Le dossier `storage/` contient les photos et signatures (privées, servies uniquement aux utilisateurs connectés).

## 10. Dépannage

| Symptôme | Vérification |
|---|---|
| 502 Bad Gateway | `pm2 status` / `pm2 logs tuktuk` ; l'appli écoute-t-elle ? `ss -ltnp \| grep 3002` |
| « SESSION_SECRET trop court » | 32 caractères minimum dans `.env`, puis `pm2 restart tuktuk` |
| Erreur MySQL au démarrage | identifiants `DB_*` dans `.env`, `sudo systemctl status mysql` |
| Envoi de photo refusé | taille > 15 Mo (`client_max_body_size`) |
| Heures décalées | `TIMEZONE=Indian/Antananarivo` dans `.env` |

## Différences avec l'ancienne version Laravel

- Même fonctionnement métier (conducteurs, fiches de suivi, contrôle doublon, commissions et compléments, paiements, alertes, comptes-rendus, synchro Odoo, journaux, rôles et droits).
- **Retirés** : double authentification (2FA) et « mot de passe oublié ». Un administrateur réinitialise le mot de passe depuis Administration › Utilisateurs.
- Les documents PDF (carte, charte, reçu, fiche papier, compte-rendu) sont remplacés par des pages imprimables : bouton « Imprimer », puis « Enregistrer en PDF » si besoin.
- Les données de l'ancienne base ne sont pas reprises automatiquement.
