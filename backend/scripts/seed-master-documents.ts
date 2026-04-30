/**
 * Seed master_documents table with content from plugin reference files.
 *
 * Usage:
 *   # Read DATABASE_URL from current environment
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-master-documents.ts
 *
 *   # Read DATABASE_URL from a dotenv-style file (e.g. backend/.env.production, gitignored)
 *   npx tsx scripts/seed-master-documents.ts --env-file=.env.production
 *
 *   # Preview what would change without writing
 *   npx tsx scripts/seed-master-documents.ts --env-file=.env.production --dry-run
 *
 * Phase 4.7 deleted the plugin reference files from disk and stored their content
 * in the master_documents table. New entries (added since 4.7) live as files in
 * the repo and are read from disk; older legacy entries fall back to git history.
 */

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const __dirname = typeof import.meta.dirname === 'string'
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const envFileArg = args.find((a) => a.startsWith('--env-file='))
if (envFileArg) {
  const envPath = resolve(__dirname, '..', envFileArg.slice('--env-file='.length))
  if (!existsSync(envPath)) {
    console.error(`env file not found: ${envPath}`)
    process.exit(1)
  }
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    let value = m[2]!
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value
  }
}

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required (set in env or via --env-file=...)')
  process.exit(1)
}

const PLUGIN_ROOT = resolve(__dirname, '../../plugin')

const documents = [
  { slug: 'tpl_business', file: 'skills/strategy/references/business-template.md' },
  { slug: 'tpl_sales_strategy', file: 'skills/strategy/references/strategy-template.md' },
  { slug: 'tpl_targeting_guide', file: 'skills/strategy/references/targeting-guide.md' },
  { slug: 'tpl_email_templates', file: 'skills/strategy/references/industry-email-templates.md' },
  { slug: 'tpl_email_guidelines', file: 'skills/outbound/references/email-guidelines.md' },
  { slug: 'tpl_enrich_contacts', file: 'skills/build-list/references/enrich-contacts.md' },
  { slug: 'tpl_analysis_frameworks', file: 'skills/evaluate/references/analysis-frameworks.md' },
  { slug: 'ref_scheduling_services', file: 'skills/check-results/references/scheduling-services.md' },
]

function readContent(relPath: string): string {
  const absPath = resolve(PLUGIN_ROOT, relPath)
  if (existsSync(absPath)) {
    return readFileSync(absPath, 'utf-8')
  }
  // Fallback: read from git history (files deleted in Phase 4.7 commit ce37c7a)
  const gitPath = `plugin/${relPath}`
  return execSync(`git show ce37c7a~1:${gitPath}`, { encoding: 'utf-8', cwd: resolve(__dirname, '../..') })
}

async function main() {
  const sql = postgres(DATABASE_URL!)

  try {
    const existing = new Map<string, string>()
    const rows = await sql<{ slug: string; content: string }[]>`
      SELECT slug, content FROM master_documents WHERE slug = ANY(${documents.map((d) => d.slug)})
    `
    for (const row of rows) existing.set(row.slug, row.content)

    const plan: Array<{
      slug: string
      action: 'INSERT' | 'UPDATE' | 'NOOP'
      bytes: number
      content: string
    }> = []
    for (const doc of documents) {
      const content = readContent(doc.file)
      const prev = existing.get(doc.slug)
      const action = prev === undefined ? 'INSERT' : prev === content ? 'NOOP' : 'UPDATE'
      plan.push({ slug: doc.slug, action, bytes: content.length, content })
    }

    const target = (() => {
      try {
        return new URL(DATABASE_URL!).host
      } catch {
        return '?'
      }
    })()
    console.log(`Target: ${target}`)
    console.log(`Plan (${dryRun ? 'dry-run' : 'apply'}):`)
    for (const p of plan) {
      const marker = p.action === 'NOOP' ? '·' : p.action === 'INSERT' ? '+' : '~'
      console.log(`  ${marker} ${p.slug.padEnd(28)} ${p.action.padEnd(6)} ${p.bytes} chars`)
    }
    const counts = plan.reduce<Record<string, number>>((acc, p) => {
      acc[p.action] = (acc[p.action] ?? 0) + 1
      return acc
    }, {})
    console.log(`Summary: INSERT=${counts['INSERT'] ?? 0}, UPDATE=${counts['UPDATE'] ?? 0}, NOOP=${counts['NOOP'] ?? 0}`)

    if (dryRun) {
      console.log('\nDry run — no changes written.')
      return
    }

    let applied = 0
    for (const p of plan) {
      if (p.action === 'NOOP') continue
      await sql`
        INSERT INTO master_documents (slug, content, version, updated_at)
        VALUES (${p.slug}, ${p.content}, 1, NOW())
        ON CONFLICT (slug)
        DO UPDATE SET content = ${p.content}, version = master_documents.version + 1, updated_at = NOW()
      `
      applied++
    }
    console.log(`\nDone: ${applied} master documents seeded (${documents.length - applied} unchanged).`)
  } finally {
    await sql.end()
  }
}

main()
