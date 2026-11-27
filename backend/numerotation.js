/** Numéros uniques : codes partenaires, fiches, paiements. À appeler dans une transaction (conn). */
import { queryOne } from './db.js'
import { PREFIXES_CODE } from './ref.js'
import { today } from './util.js'

export async function codeConducteur(conn, agence, type) {
  const row = await queryOne('SELECT MAX(numero) AS m FROM conducteurs WHERE agence_id = ? AND type = ? FOR UPDATE', [agence.id, type], conn)
  const numero = (Number(row?.m) || 0) + 1
  return { code: `${PREFIXES_CODE[type]}-${agence.code.toUpperCase()}-${String(numero).padStart(4, '0')}`, numero }
}

async function suivant(conn, table, prefixe, largeur) {
  const row = await queryOne(`SELECT numero FROM ${table} WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1 FOR UPDATE`, [`${prefixe}%`], conn)
  const n = row ? parseInt(row.numero.slice(-largeur), 10) + 1 : 1
  return prefixe + String(n).padStart(largeur, '0')
}

export const numeroFiche = (conn, agence) => suivant(conn, 'fiches_suivi', `FS-${agence.code}-${today().slice(0, 4)}-`, 5)
export const numeroPaiement = (conn, agence) => suivant(conn, 'paiements', `PAY-${agence.code}-${today().slice(0, 4)}-`, 4)
