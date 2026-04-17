import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, sql, desc } from 'drizzle-orm'
import type { Db } from '../../db/connection'
import {
  projects,
  organizations,
  prospects,
  projectProspects,
  formTypeEnum,
  prospectStatusEnum,
} from '../../db/schema'
import { getRemainingOutreachQuota, getTenantPlan, getPlanLimits, countTenantProspects } from '../plan-limits'
import type { Env, Variables } from '../types'
import type { SnsAccounts } from '../../db/schema'

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
  organizationWebsiteUrl: z.string().url(),
  // Prospect
  name: z.string().min(1),
  contactName: z.string().optional(),
  department: z.string().optional(),
  overview: z.string().min(1),
  industry: z.string().optional(),
  websiteUrl: z.string().url(),
  email: z.string().email().optional(),
  contactFormUrl: z.string().url().optional(),
  formType: z.enum(formTypeEnum.enumValues).optional(),
  snsAccounts: snsAccountsSchema.optional(),
  notes: z.string().optional(),
  // Linking
  matchReason: z.string().min(1),
  priority: z.number().int().min(1).max(5).default(3),
}).refine(
  (p) => p.email || p.contactFormUrl || (p.snsAccounts && Object.values(p.snsAccounts).some(Boolean)),
  { message: 'At least one contact channel (email, contactFormUrl, or snsAccounts) is required' },
)

const batchSchema = z.object({
  projectId: z.string().min(1),
  prospects: z.array(prospectInputSchema).min(1).max(100),
})

export const prospectsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// Helper: verify project belongs to tenant
async function verifyProject(db: Db, projectId: string, tenantId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1)
  return project
}

// POST /prospects/batch — batch register prospects with deduplication
prospectsRouter.post('/prospects/batch', zValidator('json', batchSchema), async (c) => {
  const { projectId, prospects: inputs } = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Free plan: lifetime prospect limit
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

    // Check if this domain is already registered in this project
    const existingInProject = await db
      .select({ pp: projectProspects.id })
      .from(projectProspects)
      .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
      .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
      .where(
        and(
          eq(projectProspects.projectId, projectId),
          eq(organizations.tenantId, tenantId),
          eq(organizations.domain, input.organizationDomain),
        ),
      )
      .limit(1)

    if (existingInProject.length > 0) {
      skipped.push({ name: input.name, reason: 'already_in_project' })
      continue
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
        doNotContact: false,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: prospects.id })

    if (!newProspect) continue

    // Link to project
    await db.insert(projectProspects).values({
      tenantId,
      projectId,
      prospectId: newProspect.id,
      matchReason: input.matchReason,
      priority: input.priority as 1 | 2 | 3 | 4 | 5,
      status: 'new',
      createdAt: now,
      updatedAt: now,
    })

    inserted.push(newProspect.id)
  }

  return c.json({
    inserted: inserted.length,
    skipped: skipped.length,
    insertedIds: inserted,
    skippedDetails: skipped,
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

  if (quota.remaining !== null && quota.remaining === 0) {
    return c.json({
      prospects: [],
      total: 0,
      byChannel: { email: 0, formOnly: 0, snsOnly: 0 },
      quota: { remaining: 0, limit: quota.limit, used: quota.used, plan: quota.plan },
      message: `Outreach limit reached (${quota.used}/${quota.limit}). Upgrade your plan to continue.`,
    })
  }

  const effectiveLimit = quota.remaining !== null ? Math.min(limit, quota.remaining) : limit

  const reachableCondition = and(
    eq(projectProspects.projectId, projectId),
    eq(projectProspects.tenantId, tenantId),
    eq(projectProspects.status, 'new'),
    eq(prospects.doNotContact, false),
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
    quota: {
      remaining: quota.remaining,
      limit: quota.limit,
      used: quota.used,
      plan: quota.plan,
    },
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
