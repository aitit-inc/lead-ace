import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, sql, desc, or, ilike } from 'drizzle-orm'
import { organizations, prospects, projectProspects } from '../../db/schema'
import type { Env, Variables } from '../types'

export const organizationsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// GET /organizations — list organizations in the tenant with prospect / project counts.
// Query params: q (substring on name or domain), limit (default 200, max 500).
organizationsRouter.get('/organizations', async (c) => {
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 500) : 200
  const q = c.req.query('q')?.trim()

  const conditions = [eq(organizations.tenantId, tenantId)]
  if (q) {
    const like = `%${q}%`
    conditions.push(or(ilike(organizations.name, like), ilike(organizations.domain, like))!)
  }

  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      domain: organizations.domain,
      websiteUrl: organizations.websiteUrl,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
      prospectCount: sql<number>`COUNT(DISTINCT ${prospects.id})::int`,
      projectCount: sql<number>`COUNT(DISTINCT ${projectProspects.projectId})::int`,
    })
    .from(organizations)
    .leftJoin(prospects, eq(prospects.organizationId, organizations.id))
    .leftJoin(projectProspects, eq(projectProspects.prospectId, prospects.id))
    .where(and(...conditions))
    .groupBy(organizations.id)
    .orderBy(desc(organizations.updatedAt))
    .limit(limit)

  return c.json({ organizations: rows, total: rows.length })
})

// GET /organizations/:id — single organization plus all prospects in the tenant
// that belong to it (across every project).
organizationsRouter.get('/organizations/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const db = c.get('db')
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.tenantId, tenantId)))
    .limit(1)

  if (!org) return c.json({ error: 'Organization not found' }, 404)

  const orgProspects = await db
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
      snsAccounts: prospects.snsAccounts,
      doNotContact: prospects.doNotContact,
      notes: prospects.notes,
      createdAt: prospects.createdAt,
      projectCount: sql<number>`(SELECT COUNT(DISTINCT pp.project_id)::int FROM project_prospects pp WHERE pp.prospect_id = ${prospects.id})`,
    })
    .from(prospects)
    .where(and(eq(prospects.organizationId, id), eq(prospects.tenantId, tenantId)))
    .orderBy(desc(prospects.createdAt))

  return c.json({ organization: org, prospects: orgProspects })
})

// PATCH /organizations/:id — update name and/or websiteUrl. Domain is immutable
// because it is the dedup key for organizations within a tenant.
const updateOrgSchema = z
  .object({
    name: z.string().min(1).optional(),
    websiteUrl: z.url().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  })

organizationsRouter.patch('/organizations/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const db = c.get('db')
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = updateOrgSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400)

  const [updated] = await db
    .update(organizations)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(organizations.id, id), eq(organizations.tenantId, tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Organization not found' }, 404)
  return c.json({ organization: updated })
})
