import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { projects } from '../../db/schema'
import { getTenantPlan, getPlanLimits } from '../plan-limits'
import type { Env, Variables } from '../types'

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
})

export const projectsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// Simple nanoid-like ID generator
function generateId(length = 21): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

// GET /projects — list projects for the current tenant
projectsRouter.get('/', async (c) => {
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))

  return c.json({ projects: rows })
})

// POST /projects — create a project (with plan limit)
projectsRouter.post('/', zValidator('json', createProjectSchema), async (c) => {
  const { name } = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  // Check if project name is already taken in this tenant
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), eq(projects.name, name)))
    .limit(1)

  if (existing.length > 0) {
    return c.json({ error: 'Project name already exists' }, 409)
  }

  // Check project limit based on tenant plan (null = unlimited tier; skip the check)
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

  const id = generateId()
  const now = new Date()
  await db.insert(projects).values({ id, tenantId, name, createdAt: now, updatedAt: now })

  return c.json({ id, name, tenantId, createdAt: now, updatedAt: now }, 201)
})

// DELETE /projects/:id — delete a project (and cascade to all related data)
projectsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

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
