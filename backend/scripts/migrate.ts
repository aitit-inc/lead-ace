/**
 * Apply pending Drizzle migrations, each in its own transaction.
 *
 * drizzle-orm's built-in pg migrator wraps every pending migration into one
 * transaction. Postgres requires `ALTER TYPE ... ADD VALUE` and any usage of
 * the new value to live in separate transactions, so the bundled migrator
 * fails when both ship in a single push. This script runs each migration in
 * its own transaction and reuses drizzle's bookkeeping table layout
 * (`drizzle.__drizzle_migrations` with columns `id`, `hash`, `created_at`)
 * so it is interchangeable with `drizzle-kit migrate`.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/migrate.ts
 *   (also wired into `npm run db:migrate`)
 *
 * Auto-loads DATABASE_URL from .dev.vars when not set in env, mirroring
 * drizzle.config.ts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import postgres from 'postgres'

if (!process.env['DATABASE_URL'] && existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf-8').split('\n')) {
    const m = line.match(/^DATABASE_URL\s*=\s*"?([^"\n]+?)"?\s*$/)
    if (m) {
      process.env['DATABASE_URL'] = m[1]
      break
    }
  }
}

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

async function main() {
  const migrations = readMigrationFiles({ migrationsFolder: './drizzle' })
  const sql = postgres(DATABASE_URL!, { max: 1, prepare: false })

  try {
    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle')
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `)

    // Match drizzle-kit's idempotency check: only the highest applied
    // `created_at` is compared. Hashes are stored but not used to gate re-runs,
    // so historical SQL edits (after a migration has already been applied) do
    // not retrigger the migration on later CI runs.
    const lastApplied = await sql<{ created_at: string | number | null }[]>`
      SELECT created_at FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC LIMIT 1
    `
    const lastAppliedMillis = lastApplied[0]?.created_at != null
      ? Number(lastApplied[0].created_at)
      : null

    let appliedCount = 0
    for (const migration of migrations) {
      if (lastAppliedMillis !== null && lastAppliedMillis >= migration.folderMillis) {
        continue
      }

      console.log(
        `Applying ${migration.hash.slice(0, 12)}… (folderMillis=${migration.folderMillis})`,
      )
      await sql.begin(async (tx) => {
        for (const stmt of migration.sql) {
          await tx.unsafe(stmt)
        }
        await tx`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${migration.hash}, ${migration.folderMillis})
        `
      })
      appliedCount++
    }

    console.log(
      appliedCount === 0
        ? 'No pending migrations.'
        : `Applied ${appliedCount} migration(s).`,
    )
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
