/**
 * SQLite via `node:sqlite`, the runtime's own driver.
 *
 * Deliberately not better-sqlite3. That package needs a native toolchain to
 * install, which on Windows is the single most common reason a cloned project
 * does not run — and "clone it and run one command" is a property worth
 * protecting for something whose whole claim is reproducibility. Node 22.5+
 * ships an equivalent synchronous driver with no build step at all.
 *
 * Server-only. Nothing under app/ may import this from a client component.
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SCHEMA } from './schema'

const DB_PATH = process.env.LEDGERLY_DB ?? join(process.cwd(), 'ledgerly.db')

/**
 * Held on globalThis rather than a module-level constant. Next.js reloads
 * modules on every edit in dev, and a fresh connection per reload leaks file
 * handles until the dev server is restarted.
 */
declare global {
  var __ledgerlyDb: DatabaseSync | undefined
}

export function db(): DatabaseSync {
  if (globalThis.__ledgerlyDb) return globalThis.__ledgerlyDb

  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const connection = new DatabaseSync(DB_PATH)
  // WAL lets the SSE progress stream read while a run is still writing.
  connection.exec('PRAGMA journal_mode = WAL')
  connection.exec('PRAGMA foreign_keys = ON')
  connection.exec(SCHEMA)

  globalThis.__ledgerlyDb = connection
  return connection
}

/**
 * node:sqlite hands back null-prototype objects, which React refuses to render
 * and JSON.stringify treats inconsistently. Every read goes through this.
 */
export function rows<T = Record<string, unknown>>(
  sql: string,
  ...params: (string | number | null)[]
): T[] {
  return db()
    .prepare(sql)
    .all(...params)
    .map((r) => ({ ...r })) as T[]
}

export function row<T = Record<string, unknown>>(
  sql: string,
  ...params: (string | number | null)[]
): T | null {
  const result = db().prepare(sql).get(...params)
  return result ? ({ ...result } as T) : null
}

export function run(sql: string, ...params: (string | number | null)[]): void {
  db()
    .prepare(sql)
    .run(...params)
}

/** All-or-nothing. A half-written run would be graded as if it were complete. */
export function transaction<T>(fn: () => T): T {
  const connection = db()
  connection.exec('BEGIN')
  try {
    const result = fn()
    connection.exec('COMMIT')
    return result
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}
