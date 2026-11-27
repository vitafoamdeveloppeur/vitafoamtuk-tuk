# Suivi Tuk-tuk & Cyclo — Vitafoam

Application de suivi des conducteurs apporteurs d'affaires (tuk-tuk et cyclo-pousse) : enregistrement des conducteurs, fiches de suivi des clients, contrôle des doublons, commissions et compléments selon les ventes Odoo, paiements, alertes, comptes-rendus hebdomadaires.

**Pile :** React + Vite (interface) · Node.js / Express (API, `backend/server.js`) · MySQL (mysql2).

## Démarrage rapide

```bash
cp .env.example .env        # remplir SESSION_SECRET, DB_*, ADMIN_*
npm ci
npm run build
npm run db:init
npm start                   # http://127.0.0.1:3002
```

Développement : `npm run dev` (Vite sur 5174 + API sur 3002).

## Arborescence

| Dossier | Contenu |
|---|---|
| `backend/` | serveur Express, API `/api`, règles métier, synchro Odoo, tâches planifiées |
| `frontend/` | interface React (Vite) ; le build va dans `dist/` |
| `database/schema.sql` | tables MySQL (appliquées automatiquement au démarrage) |
| `deploy/` | configurations Nginx pour `tuktuk.vitafoampointage.com` |
| `docs/DEPLOIEMENT-VPS.md` | guide d'installation sur le VPS (PM2, Nginx, certbot) |

Le fichier `.env` et le dossier `storage/` (photos, signatures) ne sont jamais versionnés.
