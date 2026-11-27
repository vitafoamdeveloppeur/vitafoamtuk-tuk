/**
 * Migrations légères : appliquent le schéma complet (CREATE TABLE IF NOT EXISTS) à chaque démarrage.
 * Ajoutez ici les ALTER TABLE des versions suivantes (chacun protégé : sans erreur s'il est déjà appliqué).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA = path.resolve(__dirname, '../database/schema.sql')

const instructions = sql => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(/;\s*$/m).map(s => s.trim()).filter(Boolean)

export async function migrate() {
  const conn = await pool.getConnection()
  try {
    for (const s of instructions(fs.readFileSync(SCHEMA, 'utf8'))) await conn.query(s)
  } finally {
    conn.release()
  }
}
