/**
 * Seed master_documents table with content from plugin reference files.
 * Files were moved to DB in Phase 4.7 and deleted from the repo.
 * This script reads them from git history (HEAD~1) as a fallback if not on disk.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-master-documents.ts
 */

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const __dirname = typeof import.meta.dirname === 'string'
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url))

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
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
    for (const doc of documents) {
      const content = readContent(doc.file)
      await sql`
        INSERT INTO master_documents (slug, content, version, updated_at)
        VALUES (${doc.slug}, ${content}, 1, NOW())
        ON CONFLICT (slug)
        DO UPDATE SET content = ${content}, version = master_documents.version + 1, updated_at = NOW()
      `
      console.log(`✓ ${doc.slug} (${content.length} chars)`)
    }
    console.log(`\nDone: ${documents.length} master documents seeded.`)
  } finally {
    await sql.end()
  }
}

main()
