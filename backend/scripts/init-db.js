/**
 * Initialisation de la base : npm run db:init
 *   1. crée la base si elle n'existe pas (si l'utilisateur MySQL en a le droit)
 *   2. crée les tables et les données de départ (barème, modèles d'e-mails, rôles)
 *   3. crée le super administrateur (ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD) si aucun compte n'existe
 */
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()
const DB_NAME = process.env.DB_NAME || 'suivi_tuktuk'

async function main() {
  console.log('Connexion à MySQL…')
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'tuktuk', password: process.env.DB_PASSWORD || '', charset: 'utf8mb4',
  })
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  } catch (e) {
    console.log(`(création de la base ignorée : ${e.message})`)
  }
  await conn.end()
  console.log(`✓ Base « ${DB_NAME} » prête`)
  const { migrate } = await import('../migrate.js')
  const { seedAdmin } = await import('../auth.js')
  const { default: pool } = await import('../db.js')
  await migrate()
  console.log('✓ Tables et données de départ créées')
  await seedAdmin()
  await pool.end()
  console.log('\nBase initialisée. Démarrez le serveur : npm start')
}

main().catch(err => {
  console.error('✗ Erreur :', err.message)
  process.exit(1)
})
