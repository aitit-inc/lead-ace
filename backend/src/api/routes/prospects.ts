import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import {
  projects,
  organizations,
  prospects,
  projectProspects,
  formTypeEnum,
} from '../../db/schema'
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
  organizationNormalizedName: z.string().min(1),
  organizationWebsiteUrl: z.string().url(),
  organizationCountry: z.string().length(2).optional(),
  organizationAddress: z.string().optional(),
  organizationIndustry: z.string().optional(),
  organizationOverview: z.string().optional(),
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
})

const batchSchema = z.object({
  projectId: z.string().min(1),
  prospects: z.array(prospectInputSchema).min(1).max(100),
})

export const prospectsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /prospects/batch — batch register prospects with deduplication
prospectsRouter.post('/prospects/batch', zValidator('json', batchSchema), async (c) => {
  const { projectId, prospects: inputs } = c.req.valid('json')
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const inserted: number[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  for (const input of inputs) {
    // Check do_not_contact globally
    const existingByEmail = input.email
      ? await db
          .select({ id: prospects.id, doNotContact: prospects.doNotContact })
          .from(prospects)
          .where(eq(prospects.email, input.email))
          .limit(1)
      : []

    if (existingByEmail[0]?.doNotContact) {
      skipped.push({ name: input.name, reason: 'do_not_contact' })
      continue
    }

    // Check email duplicate
    if (existingByEmail.length > 0) {
      skipped.push({ name: input.name, reason: 'email_duplicate' })
      continue
    }

    // Check contact_form_url duplicate
    if (input.contactFormUrl) {
      const existingByForm = await db
        .select({ id: prospects.id })
        .from(prospects)
        .where(eq(prospects.contactFormUrl, input.contactFormUrl))
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
      .where(
        and(
          eq(projectProspects.projectId, projectId),
          eq(prospects.organizationId, input.organizationDomain),
        ),
      )
      .limit(1)

    if (existingInProject.length > 0) {
      skipped.push({ name: input.name, reason: 'already_in_project' })
      continue
    }

    // Upsert organization
    const now = new Date()
    await db
      .insert(organizations)
      .values({
        domain: input.organizationDomain,
        name: input.organizationName,
        normalizedName: input.organizationNormalizedName,
        websiteUrl: input.organizationWebsiteUrl,
        country: input.organizationCountry ?? null,
        address: input.organizationAddress ?? null,
        industry: input.organizationIndustry ?? null,
        overview: input.organizationOverview ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: organizations.domain,
        set: {
          name: sql`excluded.name`,
          normalizedName: sql`excluded.normalized_name`,
          websiteUrl: sql`excluded.website_url`,
          country: sql`excluded.country`,
          address: sql`excluded.address`,
          industry: sql`excluded.industry`,
          overview: sql`excluded.overview`,
          updatedAt: now,
        },
      })

    // Insert prospect
    const [newProspect] = await db
      .insert(prospects)
      .values({
        name: input.name,
        contactName: input.contactName ?? null,
        organizationId: input.organizationDomain,
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
  const userId = c.get('userId')
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 50
  const db = createDb(c.env.DATABASE_URL)

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Run prospect query and summary counts in parallel
  const reachableCondition = and(
    eq(projectProspects.projectId, projectId),
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
      .limit(limit),
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
  })
})

// GET /projects/:id/prospects/identifiers — all registered prospect identifiers (for dedup)
prospectsRouter.get('/projects/:id/prospects/identifiers', async (c) => {
  const projectId = c.req.param('id')
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const rows = await db
    .select({
      name: prospects.name,
      websiteUrl: prospects.websiteUrl,
      email: prospects.email,
      organizationId: prospects.organizationId,
    })
    .from(projectProspects)
    .innerJoin(prospects, eq(prospects.id, projectProspects.prospectId))
    .where(eq(projectProspects.projectId, projectId))

  return c.json({ identifiers: rows })
})

// PATCH /prospects/:id/status — update prospect status in a project
prospectsRouter.patch('/prospects/:id/status', async (c) => {
  const prospectId = parseInt(c.req.param('id'), 10)
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

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

  const validStatuses = ['new', 'contacted', 'responded', 'converted', 'rejected', 'inactive', 'unreachable']
  if (!validStatuses.includes(status)) {
    return c.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400)
  }

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const [pp] = await db
    .update(projectProspects)
    .set({ status: status as typeof projectProspects.$inferSelect.status, updatedAt: new Date() })
    .where(
      and(
        eq(projectProspects.projectId, projectId),
        eq(projectProspects.prospectId, prospectId),
      ),
    )
    .returning({ id: projectProspects.id })

  if (!pp) {
    return c.json({ error: 'Prospect not found in this project' }, 404)
  }

  return c.json({ updated: true, prospectId, status })
})
