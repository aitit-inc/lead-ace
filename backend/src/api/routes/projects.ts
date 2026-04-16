import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import { projects } from '../../db/schema'
import { getTenantPlan, getPlanLimits } from '../plan-limits'
import type { Env, Variables } from '../types'

const createProjectSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'ID must be alphanumeric with _ or -'),
})

export const projectsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// GET /projects — list projects for the current tenant
projectsRouter.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const db = createDb(c.env.DATABASE_URL)

  const rows = await db
    .select({
      id: projects.id,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))

  return c.json({ projects: rows })
})

// POST /projects — create a project (with plan limit)
projectsRouter.post('/', zValidator('json', createProjectSchema), async (c) => {
  const { id } = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = createDb(c.env.DATABASE_URL)

  // Check if project ID is already taken (by anyone)
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1)

  if (existing.length > 0) {
    return c.json({ error: 'Project ID already exists' }, 409)
  }

  // Check project limit based on tenant plan
  const tp = await getTenantPlan(db, tenantId)
  const limits = getPlanLimits(tp.plan)

  if (limits.maxProjects !== null) {
    const [projectCount] = await db
      .select({ count: count() })
      .from(projects)
      .where(eq(projects.tenantId, tenantId))

    if ((projectCount?.count ?? 0) >= limits.maxProjects) {
      return c.json(
        {
          error: 'Project limit reached',
          detail: `Your ${tp.plan} plan allows ${limits.maxProjects} project(s). Delete an existing project or upgrade your plan.`,
        },
        403,
      )
    }
  }

  const now = new Date()
  await db.insert(projects).values({ id, tenantId, createdAt: now, updatedAt: now })

  return c.json({ id, tenantId, createdAt: now, updatedAt: now }, 201)
})

// DELETE /projects/:id — delete a project (and cascade to all related data)
projectsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = createDb(c.env.DATABASE_URL)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  await db.delete(projects).where(eq(projects.id, id))

  return c.json({ deleted: id })
})
