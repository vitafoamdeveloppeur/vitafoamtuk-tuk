/**
 * Connexion MariaDB / MySQL — Suivi Tuk-tuk & Cyclo
 */
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'tuktuk',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'suivi_tuktuk',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: '+03:00',
  // DATE / DATETIME renvoyés en texte ('2026-11-01 08:30:00') : heure locale de Madagascar, sans conversion
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  decimalNumbers: true,
})

/** Exécute une requête et retourne les lignes */
export async function query(sql, params = [], conn = pool) {
  const [rows] = await conn.query(sql, params)
  return rows
}

/** Première ligne ou null */
export async function queryOne(sql, params = [], conn = pool) {
  const rows = await query(sql, params, conn)
  return rows[0] || null
}

/** Valeur de la première colonne de la première ligne */
export async function scalar(sql, params = [], conn = pool) {
  const row = await queryOne(sql, params, conn)
  return row ? Object.values(row)[0] : null
}

/** INSERT / UPDATE / DELETE : retourne { insertId, affectedRows } */
export async function execute(sql, params = [], conn = pool) {
  const [result] = await conn.query(sql, params)
  return result
}

/** Exécute `task(conn)` dans une transaction : tout est validé, ou rien. */
export async function transaction(task) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await task(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}

/** Liste de « ? » pour une clause IN (au moins un élément : sinon NULL, qui ne correspond à rien) */
export const inList = values => (values.length ? values.map(() => '?').join(', ') : 'NULL')

export default pool
