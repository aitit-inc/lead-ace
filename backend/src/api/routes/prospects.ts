import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, sql, desc, or, ilike, inArray } from 'drizzle-orm'
import {
  organizations,
  prospects,
  projectProspects,
  formTypeEnum,
  prospectStatusEnum,
} from '../../db/schema'
import {
  getRemainingOutreachQuota,
  getTenantPlan,
  getPlanLimits,
  countTenantProspects,
  formatOutreachQuotaError,
  isOutreachQuotaExhausted,
} from '../plan-limits'
import type { Env, Variables } from '../types'
import type { SnsAccounts } from '../../db/schema'
import { verifyProject, findExistingProjectLink } from '../project-helpers'

const snsAccountsSchema = z.object({
  x: z.string().optional(),
  linkedin: z.string().optional(),
  instagram: z.string().optional(),
  facebook: z.string().optional(),
})

const prospectInputSchema = z.object({
  // Organization
  organizationDomain: z.string().min(1),
  organizationName: z.string().min(1),
  organizationWebsiteUrl: z.url(),
  // Prospect
  name: z.string().min(1),
  contactName: z.string().optional(),
  department: z.string().optional(),
  overview: z.string().min(1),
  industry: z.string().optional(),
  websiteUrl: z.url(),
  email: z.email().optional(),
  contactFormUrl: z.url().optional(),
  formType: z.enum(formTypeEnum.enumValues).optional(),
  snsAccounts: snsAccountsSchema.optional(),
  notes: z.string().optional(),
  // One-way ratchet on import: true sets/keeps DNC; false (or omitted) never clears an existing flag.
  doNotContact: z.boolean().optional(),
  // Linking — only consulted when projectId is set on the request
  matchReason: z.string().min(1).optional(),
  priority: z.number().int().min(1).max(5).default(3),
}).refine(
  (p) => p.email || p.contactFormUrl || (p.snsAccounts && Object.values(p.snsAccounts).some(Boolean)),
  { message: 'At least one contact channel (email, contactFormUrl, or snsAccounts) is required' },
)

const batchSchema = z.object({
  projectId: z.string().min(1).optional(),
  prospects: z.array(prospectInputSchema).min(1).max(100),
})

const importSchema = z.object({
  projectId: z.string().min(1).optional(),
  csvText: z.string().min(1),
  dedupPolicy: z.enum(['skip', 'overwrite']).default('skip'),
})

type ProspectInput = z.infer<typeof prospectInputSchema>

// Minimal RFC 4180 CSV parser. Supports quoted fields, escaped quotes ("") and CRLF/LF.
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue }
        inQuotes = false
        continue
      }
      field += c
      continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
      continue
    }
    if (c === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
      continue
    }
    field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const REQUIRED_CSV_HEADERS = [
  'organizationDomain',
  'organizationName',
  'organizationWebsiteUrl',
  'name',
  'overview',
  'websiteUrl',
] as const

const ALLOWED_CSV_HEADERS = new Set<string>([
  ...REQUIRED_CSV_HEADERS,
  'matchReason',
  'contactName',
  'department',
  'industry',
  'email',
  'contactFormUrl',
  'formType',
  'snsAccounts.x',
  'snsAccounts.linkedin',
  'snsAccounts.instagram',
  'snsAccounts.facebook',
  'notes',
  'priority',
  'doNotContact',
])

const DNC_TRUTHY = new Set(['1', 'true', 'yes', 'on'])
const DNC_FALSY = new Set(['0', 'false', 'no', 'off'])

const MAX_IMPORT_ROWS = 1000

function csvRowToInput(header: string[], row: string[]): { ok: true; value: ProspectInput } | { ok: false; error: string } {
  const obj: Record<string, unknown> = {}
  const sns: Record<string, string> = {}
  for (let j = 0; j < header.length; j++) {
    const key = header[j]
    if (!key) continue
    const raw = row[j] ?? ''
    const val = raw.trim()
    if (val === '') continue
    if (key.startsWith('snsAccounts.')) {
      sns[key.slice('snsAccounts.'.length)] = val
    } else if (key === 'priority') {
      const n = Number.parseInt(val, 10)
      if (!Number.isFinite(n)) return { ok: false, error: 'priority: not an integer' }
      obj.priority = n
    } else if (key === 'doNotContact') {
      const lower = val.toLowerCase()
      if (DNC_TRUTHY.has(lower)) obj.doNotContact = true
      else if (DNC_FALSY.has(lower)) obj.doNotContact = false
      else return { ok: false, error: `doNotContact: not a boolean (got "${val}")` }
    } else {
      obj[key] = val
    }
  }
  if (Object.keys(sns).length > 0) obj.snsAccounts = sns

  const parsed = prospectInputSchema.safeParse(obj)
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((iss) => `${iss.path.join('.') || '<root>'}: ${iss.message}`)
      .join('; ')
    return { ok: false, error: msg }
  }
  return { ok: true, value: parsed.data }
}

export const prospectsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /prospects/batch — batch register prospects with deduplication.
// projectId is optional: when omitted, prospects are saved as tenant-only assets
// (no project_prospects link is created). When provided, every input row must
// also include matchReason.
prospectsRouter.post('/prospects/batch', zValidator('json', batchSchema), async (c) => {
  const { projectId, prospects: inputs } = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (projectId) {
    if (!await verifyProject(db, projectId, tenantId)) {
      return c.json({ error: 'Project not found' }, 404)
    }
    const missingReason = inputs.find((p) => !p.matchReason || p.matchReason.trim() === '')
    if (missingReason) {
      return c.json({
        error: 'matchReason is required for every prospect when projectId is provided',
        detail: `First offending row: ${missingReason.name}`,
      }, 400)
    }
  }

  // Free plan: lifetime prospect limit (null = unlimited / paid tiers; skip the check)
  const tp = await getTenantPlan(db, tenantId)
  const limits = getPlanLimits(tp.plan)

  let prospectBudget: number | null = null
  if (limits.maxProspects !== null) {
    const currentCount = await countTenantProspects(db, tenantId)
    prospectBudget = Math.max(0, limits.maxProspects - currentCount)
    if (prospectBudget === 0) {
      return c.json({
        error: 'Prospect registration limit reached',
        detail: `Your ${tp.plan} plan allows ${limits.maxProspects} prospects. Upgrade your plan to register more.`,
        inserted: 0,
        skipped: inputs.length,
        insertedIds: [],
        skippedDetails: inputs.map((i) => ({ name: i.name, reason: 'plan_limit' })),
      }, 403)
    }
  }

  const inserted: number[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  for (const input of inputs) {
    // Check prospect budget (free plan)
    if (prospectBudget !== null && inserted.length >= prospectBudget) {
      skipped.push({ name: input.name, reason: 'plan_limit' })
      continue
    }

    // Check do_not_contact (scoped to tenant)
    const existingByEmail = input.email
      ? await db
          .select({ id: prospects.id, doNotContact: prospects.doNotContact })
          .from(prospects)
          .where(and(eq(prospects.tenantId, tenantId), eq(prospects.email, input.email)))
          .limit(1)
      : []

    if (existingByEmail[0]?.doNotContact) {
      skipped.push({ name: input.name, reason: 'do_not_contact' })
      continue
    }

    // Check email duplicate (scoped to tenant)
    if (existingByEmail.length > 0) {
      skipped.push({ name: input.name, reason: 'email_duplicate' })
      continue
    }

    // Check contact_form_url duplicate (scoped to tenant)
    if (input.contactFormUrl) {
      const existingByForm = await db
        .select({ id: prospects.id })
        .from(prospects)
        .where(and(eq(prospects.tenantId, tenantId), eq(prospects.contactFormUrl, input.contactFormUrl)))
        .limit(1)

      if (existingByForm.length > 0) {
        skipped.push({ name: input.name, reason: 'form_url_duplicate' })
        continue
      }
    }

    if (projectId) {
      const existing = await findExistingProjectLink(db, {
        projectId,
        tenantId,
        domain: input.organizationDomain,
      })
      if (existing) {
        skipped.push({ name: input.name, reason: 'already_in_project' })
        continue
      }
    }

    // Upsert organization (scoped to tenant)
    const now = new Date()
    const [org] = await db
      .insert(organizations)
      .values({
        tenantId,
        domain: input.organizationDomain,
        name: input.organizationName,
        websiteUrl: input.organizationWebsiteUrl,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [organizations.tenantId, organizations.domain],
        set: {
          name: sql`excluded.name`,
          websiteUrl: sql`excluded.website_url`,
          updatedAt: now,
        },
      })
      .returning({ id: organizations.id })

    if (!org) continue

    // Insert prospect
    const [newProspect] = await db
      .insert(prospects)
      .values({
        tenantId,
        name: input.name,
        contactName: input.contactName ?? null,
        organizationId: org.id,
        department: input.department ?? null,
        overview: input.overview,
        industry: input.industry ?? null,
        websiteUrl: input.websiteUrl,
        email: input.email ?? null,
        contactFormUrl: input.contactFormUrl ?? null,
        formType: input.formType ?? null,
        snsAccounts: (input.snsAccounts as SnsAccounts) ?? null,
        doNotContact: input.doNotContact ?? false,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: prospects.id })

    if (!newProspect) continue

    if (projectId) {
      await db.insert(projectProspects).values({
        tenantId,
        projectId,
        prospectId: newProspect.id,
        matchReason: input.matchReason!,
        priority: input.priority as 1 | 2 | 3 | 4 | 5,
        status: 'new',
        createdAt: now,
        updatedAt: now,
      })
    }

    inserted.push(newProspect.id)
  }

  return c.json({
    inserted: inserted.length,
    skipped: skipped.length,
    insertedIds: inserted,
    skippedDetails: skipped,
  })
})

// POST /prospects/import — bulk import from canonical CSV with skip/overwrite dedup.
// projectId is optional: when omitted, prospects are saved as tenant-only assets
// (no project_prospects link is created or updated, even with dedupPolicy='overwrite').
// matchReason becomes a CSV-level required column only when projectId is provided.
prospectsRouter.post('/prospects/import', zValidator('json', importSchema), async (c) => {
  const { projectId, csvText, dedupPolicy } = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (projectId && !await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  let rows: string[][]
  try {
    rows = parseCsv(csvText)
  } catch (e) {
    return c.json({ error: 'CSV parse error', detail: e instanceof Error ? e.message : String(e) }, 400)
  }

  // Drop trailing empty rows (common when CSV ends with a newline).
  while (rows.length > 0) {
    const last = rows[rows.length - 1]
    if (!last || last.length === 0 || (last.length === 1 && last[0] === '')) rows.pop()
    else break
  }

  if (rows.length < 2) {
    return c.json({ error: 'CSV must contain a header row and at least one data row' }, 400)
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    return c.json({ error: `CSV too large (max ${MAX_IMPORT_ROWS} data rows)` }, 400)
  }

  const header = (rows[0] ?? []).map((h) => h.trim())
  const missing = REQUIRED_CSV_HEADERS.filter((h) => !header.includes(h))
  if (missing.length > 0) {
    return c.json({ error: 'Missing required columns', detail: missing.join(', ') }, 400)
  }
  if (projectId && !header.includes('matchReason')) {
    return c.json({ error: 'Missing required columns', detail: 'matchReason is required when projectId is provided' }, 400)
  }
  const unknown = header.filter((h) => !ALLOWED_CSV_HEADERS.has(h))
  if (unknown.length > 0) {
    return c.json({ error: 'Unknown columns', detail: unknown.join(', ') }, 400)
  }

  // Free plan: lifetime prospect limit (only counts new insertions, not overwrites)
  const tp = await getTenantPlan(db, tenantId)
  const limits = getPlanLimits(tp.plan)
  let prospectBudget: number | null = null
  if (limits.maxProspects !== null) {
    const currentCount = await countTenantProspects(db, tenantId)
    prospectBudget = Math.max(0, limits.maxProspects - currentCount)
  }

  const inserted: number[] = []
  const overwritten: number[] = []
  const skipped: Array<{ row: number; name: string; reason: string }> = []
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0 || (row.length === 1 && (row[0] ?? '').trim() === '')) continue

    const parsed = csvRowToInput(header, row)
    if (!parsed.ok) {
      errors.push({ row: i + 1, error: parsed.error })
      continue
    }
    const input = parsed.value
    const rowKey = input.name

    if (projectId && (!input.matchReason || input.matchReason.trim() === '')) {
      errors.push({ row: i + 1, error: 'matchReason: required when projectId is provided' })
      continue
    }

    // do_not_contact always wins, regardless of dedupPolicy.
    const existingByEmail = input.email
      ? await db
          .select({ id: prospects.id, doNotContact: prospects.doNotContact })
          .from(prospects)
          .where(and(eq(prospects.tenantId, tenantId), eq(prospects.email, input.email)))
          .limit(1)
      : []
    if (existingByEmail[0]?.doNotContact) {
      skipped.push({ row: i + 1, name: rowKey, reason: 'do_not_contact' })
      continue
    }

    const existingByForm = input.contactFormUrl
      ? await db
          .select({ id: prospects.id })
          .from(prospects)
          .where(and(eq(prospects.tenantId, tenantId), eq(prospects.contactFormUrl, input.contactFormUrl)))
          .limit(1)
      : []

    const existingInProject = projectId
      ? await findExistingProjectLink(db, {
          projectId,
          tenantId,
          domain: input.organizationDomain,
        })
      : null

    const existingProspectId =
      existingByEmail[0]?.id ?? existingByForm[0]?.id ?? existingInProject?.prospectId ?? null

    if (existingProspectId !== null) {
      if (dedupPolicy === 'skip') {
        const reason = existingByEmail.length > 0
          ? 'email_duplicate'
          : existingByForm.length > 0
            ? 'form_url_duplicate'
            : 'already_in_project'
        skipped.push({ row: i + 1, name: rowKey, reason })
        continue
      }

      const now = new Date()
      const [org] = await db
        .insert(organizations)
        .values({
          tenantId,
          domain: input.organizationDomain,
          name: input.organizationName,
          websiteUrl: input.organizationWebsiteUrl,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [organizations.tenantId, organizations.domain],
          set: {
            name: sql`excluded.name`,
            websiteUrl: sql`excluded.website_url`,
            updatedAt: now,
          },
        })
        .returning({ id: organizations.id })
      if (!org) continue

      await db
        .update(prospects)
        .set({
          name: input.name,
          contactName: input.contactName ?? null,
          organizationId: org.id,
          department: input.department ?? null,
          overview: input.overview,
          industry: input.industry ?? null,
          websiteUrl: input.websiteUrl,
          email: input.email ?? null,
          contactFormUrl: input.contactFormUrl ?? null,
          formType: input.formType ?? null,
          snsAccounts: (input.snsAccounts as SnsAccounts) ?? null,
          notes: input.notes ?? null,
          // One-way ratchet: only set DNC=true; never clear an existing flag from an import.
          ...(input.doNotContact === true ? { doNotContact: true } : {}),
          updatedAt: now,
        })
        .where(and(eq(prospects.id, existingProspectId), eq(prospects.tenantId, tenantId)))

      if (projectId) {
        await db
          .insert(projectProspects)
          .values({
            tenantId,
            projectId,
            prospectId: existingProspectId,
            matchReason: input.matchReason!,
            priority: input.priority as 1 | 2 | 3 | 4 | 5,
            status: 'new',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [projectProspects.projectId, projectProspects.prospectId],
            set: {
              matchReason: sql`excluded.match_reason`,
              priority: sql`excluded.priority`,
              updatedAt: now,
            },
          })
      }

      overwritten.push(existingProspectId)
      continue
    }

    // No match: insert path. Honour the prospect budget for free plans.
    if (prospectBudget !== null && inserted.length >= prospectBudget) {
      skipped.push({ row: i + 1, name: rowKey, reason: 'plan_limit' })
      continue
    }

    const now = new Date()
    const [org] = await db
      .insert(organizations)
      .values({
        tenantId,
        domain: input.organizationDomain,
        name: input.organizationName,
        websiteUrl: input.organizationWebsiteUrl,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [organizations.tenantId, organizations.domain],
        set: {
          name: sql`excluded.name`,
          websiteUrl: sql`excluded.website_url`,
          updatedAt: now,
        },
      })
      .returning({ id: organizations.id })
    if (!org) continue

    const [newProspect] = await db
      .insert(prospects)
      .values({
        tenantId,
        name: input.name,
        contactName: input.contactName ?? null,
        organizationId: org.id,
        department: input.department ?? null,
        overview: input.overview,
        industry: input.industry ?? null,
        websiteUrl: input.websiteUrl,
        email: input.email ?? null,
        contactFormUrl: input.contactFormUrl ?? null,
        formType: input.formType ?? null,
        snsAccounts: (input.snsAccounts as SnsAccounts) ?? null,
        doNotContact: input.doNotContact ?? false,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: prospects.id })
    if (!newProspect) continue

    if (projectId) {
      await db.insert(projectProspects).values({
        tenantId,
        projectId,
        prospectId: newProspect.id,
        matchReason: input.matchReason!,
        priority: input.priority as 1 | 2 | 3 | 4 | 5,
        status: 'new',
        createdAt: now,
        updatedAt: now,
      })
    }

    inserted.push(newProspect.id)
  }

  return c.json({
    inserted: inserted.length,
    overwritten: overwritten.length,
    skipped: skipped.length,
    errors: errors.length,
    insertedIds: inserted,
    overwrittenIds: overwritten,
    skippedDetails: skipped,
    errorDetails: errors,
  })
})

// GET /projects/:id/prospects/reachable — unreached prospects ordered by priority
prospectsRouter.get('/projects/:id/prospects/reachable', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 50
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Check outreach quota
  const quota = await getRemainingOutreachQuota(db, tenantId)

  if (isOutreachQuotaExhausted(quota)) {
    return c.json({
      prospects: [],
      total: 0,
      byChannel: { email: 0, formOnly: 0, snsOnly: 0 },
      quota,
      message: formatOutreachQuotaError(quota),
    })
  }

  const effectiveLimit = quota.remaining !== null ? Math.min(limit, quota.remaining) : limit

  const reachableCondition = and(
    eq(projectProspects.projectId, projectId),
    eq(projectProspects.tenantId, tenantId),
    eq(projectProspects.status, 'new'),
    eq(prospects.doNotContact, false),
    sql`(${prospects.nextOutreachAfter} IS NULL OR ${prospects.nextOutreachAfter} <= NOW())`,
  )

  const [rows, summaryRows] = await Promise.all([
    db
      .select({
        ppId: projectProspects.id,
        prospectId: prospects.id,
        name: prospects.name,
        contactName: prospects.contactName,
        overview: prospects.overview,
        industry: prospects.industry,
        websiteUrl: prospects.websiteUrl,
        email: prospects.email,
        contactFormUrl: prospects.contactFormUrl,
        formType: prospects.formType,
        snsAccounts: prospects.snsAccounts,
        notes: prospects.notes,
        matchReason: projectProspects.matchReason,
        priority: projectProspects.priority,
        status: projectProspects.status,
        organizationId: prospects.organizationId,
      })
      .from(projectProspects)
      .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
      .where(reachableCondition)
      .orderBy(projectProspects.priority, projectProspects.createdAt)
      .limit(effectiveLimit),
    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        email: sql<number>`COUNT(*) FILTER (WHERE ${prospects.email} IS NOT NULL)::int`,
        formOnly: sql<number>`COUNT(*) FILTER (WHERE ${prospects.email} IS NULL AND ${prospects.contactFormUrl} IS NOT NULL)::int`,
        snsOnly: sql<number>`COUNT(*) FILTER (WHERE ${prospects.email} IS NULL AND ${prospects.contactFormUrl} IS NULL AND ${prospects.snsAccounts} IS NOT NULL)::int`,
      })
      .from(projectProspects)
      .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
      .where(reachableCondition),
  ])

  const summary = summaryRows[0] ?? { total: 0, email: 0, formOnly: 0, snsOnly: 0 }

  return c.json({
    prospects: rows,
    total: summary.total,
    byChannel: {
      email: summary.email,
      formOnly: summary.formOnly,
      snsOnly: summary.snsOnly,
    },
    quota,
  })
})

// GET /projects/:id/prospects/identifiers — all registered prospect identifiers (for dedup)
prospectsRouter.get('/projects/:id/prospects/identifiers', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const rows = await db
    .select({
      name: prospects.name,
      websiteUrl: prospects.websiteUrl,
      email: prospects.email,
      organizationDomain: organizations.domain,
    })
    .from(projectProspects)
    .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
    .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
    .where(eq(projectProspects.projectId, projectId))

  return c.json({ identifiers: rows })
})

// PATCH /prospects/:id/status — update prospect status in a project
prospectsRouter.patch('/prospects/:id/status', async (c) => {
  const prospectId = parseInt(c.req.param('id'), 10)
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  let body: { projectId: string; status: string }
  try {
    body = await c.req.json<{ projectId: string; status: string }>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { projectId, status } = body
  if (!projectId || !status) {
    return c.json({ error: 'projectId and status are required' }, 400)
  }

  const validStatuses = prospectStatusEnum.enumValues
  if (!validStatuses.includes(status as typeof validStatuses[number])) {
    return c.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400)
  }

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const [pp] = await db
    .update(projectProspects)
    .set({ status: status as typeof projectProspects.$inferSelect.status, updatedAt: new Date() })
    .where(
      and(
        eq(projectProspects.projectId, projectId),
        eq(projectProspects.prospectId, prospectId),
        eq(projectProspects.tenantId, tenantId),
      ),
    )
    .returning({ id: projectProspects.id })

  if (!pp) {
    return c.json({ error: 'Prospect not found in this project' }, 404)
  }

  return c.json({ updated: true, prospectId, status })
})

// GET /projects/:id/prospects — all prospects in a project with optional filters
prospectsRouter.get('/projects/:id/prospects', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 100
  const statusFilter = c.req.query('status')
  const priorityFilter = c.req.query('priority')

  const conditions = [
    eq(projectProspects.projectId, projectId),
    eq(projectProspects.tenantId, tenantId),
  ]

  if (statusFilter && prospectStatusEnum.enumValues.includes(statusFilter as typeof prospectStatusEnum.enumValues[number])) {
    conditions.push(eq(projectProspects.status, statusFilter as typeof prospectStatusEnum.enumValues[number]))
  }

  if (priorityFilter) {
    const p = parseInt(priorityFilter, 10)
    if (p >= 1 && p <= 5) {
      conditions.push(eq(projectProspects.priority, p))
    }
  }

  const where = and(...conditions)

  const [rows, countRows] = await Promise.all([
    db
      .select({
        ppId: projectProspects.id,
        prospectId: prospects.id,
        name: prospects.name,
        contactName: prospects.contactName,
        overview: prospects.overview,
        industry: prospects.industry,
        websiteUrl: prospects.websiteUrl,
        email: prospects.email,
        contactFormUrl: prospects.contactFormUrl,
        formType: prospects.formType,
        snsAccounts: prospects.snsAccounts,
        doNotContact: prospects.doNotContact,
        notes: prospects.notes,
        matchReason: projectProspects.matchReason,
        priority: projectProspects.priority,
        status: projectProspects.status,
        organizationId: prospects.organizationId,
        organizationName: organizations.name,
        createdAt: projectProspects.createdAt,
      })
      .from(projectProspects)
      .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
      .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
      .where(where)
      .orderBy(projectProspects.priority, desc(projectProspects.createdAt))
      .limit(limit),
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(projectProspects)
      .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
      .where(where),
  ])

  return c.json({
    prospects: rows,
    total: countRows[0]?.total ?? 0,
  })
})

prospectsRouter.get('/tenant/prospects', async (c) => {
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 1000) : 200
  const q = c.req.query('q')?.trim()
  const industry = c.req.query('industry')?.trim()
  const excludeProjectId = c.req.query('excludeProjectId')?.trim()

  const conditions = [
    eq(prospects.tenantId, tenantId),
    eq(prospects.doNotContact, false),
  ]

  if (industry) {
    conditions.push(eq(prospects.industry, industry))
  }

  if (q) {
    const like = `%${q}%`
    conditions.push(
      or(
        ilike(prospects.name, like),
        ilike(prospects.overview, like),
        ilike(prospects.industry, like),
        ilike(organizations.name, like),
      )!,
    )
  }

  if (excludeProjectId) {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM project_prospects pp WHERE pp.prospect_id = ${prospects.id} AND pp.project_id = ${excludeProjectId})`,
    )
  }

  const rows = await db
    .select({
      id: prospects.id,
      name: prospects.name,
      contactName: prospects.contactName,
      department: prospects.department,
      overview: prospects.overview,
      industry: prospects.industry,
      websiteUrl: prospects.websiteUrl,
      email: prospects.email,
      contactFormUrl: prospects.contactFormUrl,
      formType: prospects.formType,
      snsAccounts: prospects.snsAccounts,
      notes: prospects.notes,
      organizationId: prospects.organizationId,
      organizationDomain: organizations.domain,
      organizationName: organizations.name,
      createdAt: prospects.createdAt,
      linkedProjectIds: sql<string[]>`COALESCE(array_agg(DISTINCT ${projectProspects.projectId}) FILTER (WHERE ${projectProspects.projectId} IS NOT NULL), '{}')`,
    })
    .from(prospects)
    .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
    .leftJoin(projectProspects, eq(projectProspects.prospectId, prospects.id))
    .where(and(...conditions))
    .groupBy(prospects.id, organizations.id)
    .orderBy(desc(prospects.createdAt))
    .limit(limit)

  return c.json({ prospects: rows, total: rows.length })
})

// Creates project_prospects junction rows only; never inserts new prospects or organizations.
const linkSchema = z.object({
  links: z.array(z.object({
    prospectId: z.number().int(),
    matchReason: z.string().min(1),
    priority: z.number().int().min(1).max(5).default(3),
  })).min(1).max(200),
})

prospectsRouter.post('/projects/:id/prospects/link', zValidator('json', linkSchema), async (c) => {
  const projectId = c.req.param('id')
  const { links } = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const ids = links.map((l) => l.prospectId)
  const existing = await db
    .select({ id: prospects.id, doNotContact: prospects.doNotContact })
    .from(prospects)
    .where(and(eq(prospects.tenantId, tenantId), inArray(prospects.id, ids)))

  const byId = new Map(existing.map((r) => [r.id, r]))
  const skipped: Array<{ prospectId: number; reason: string }> = []
  const candidates: typeof links = []

  for (const link of links) {
    const row = byId.get(link.prospectId)
    if (!row) {
      skipped.push({ prospectId: link.prospectId, reason: 'not_found' })
      continue
    }
    if (row.doNotContact) {
      skipped.push({ prospectId: link.prospectId, reason: 'do_not_contact' })
      continue
    }
    candidates.push(link)
  }

  let linkedIds: number[] = []
  if (candidates.length > 0) {
    const now = new Date()
    const inserted = await db
      .insert(projectProspects)
      .values(candidates.map((link) => ({
        tenantId,
        projectId,
        prospectId: link.prospectId,
        matchReason: link.matchReason,
        priority: link.priority as 1 | 2 | 3 | 4 | 5,
        status: 'new' as const,
        createdAt: now,
        updatedAt: now,
      })))
      .onConflictDoNothing({ target: [projectProspects.projectId, projectProspects.prospectId] })
      .returning({ prospectId: projectProspects.prospectId })

    linkedIds = inserted.map((r) => r.prospectId)
  }

  const linkedSet = new Set(linkedIds)
  const alreadyLinkedIds = candidates
    .map((l) => l.prospectId)
    .filter((id) => !linkedSet.has(id))

  return c.json({
    linked: linkedIds.length,
    alreadyLinked: alreadyLinkedIds.length,
    skipped: skipped.length,
    linkedIds,
    alreadyLinkedIds,
    skippedDetails: skipped,
  })
})

// PATCH /prospects/:id/do-not-contact — toggle do_not_contact flag
prospectsRouter.patch('/prospects/:id/do-not-contact', async (c) => {
  const prospectId = parseInt(c.req.param('id'), 10)
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  let body: { doNotContact: boolean }
  try {
    body = await c.req.json<{ doNotContact: boolean }>()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.doNotContact !== 'boolean') {
    return c.json({ error: 'doNotContact (boolean) is required' }, 400)
  }

  // Verify the prospect belongs to this tenant
  const [owned] = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.id, prospectId), eq(prospects.tenantId, tenantId)))
    .limit(1)

  if (!owned) {
    return c.json({ error: 'Prospect not found' }, 404)
  }

  await db
    .update(prospects)
    .set({ doNotContact: body.doNotContact, updatedAt: new Date() })
    .where(eq(prospects.id, prospectId))

  return c.json({ updated: true, prospectId, doNotContact: body.doNotContact })
})
