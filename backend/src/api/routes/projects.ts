import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import { projects } from '../../db/schema'
import type { Env, Variables } from '../types'

const FREE_PLAN_PROJECT_LIMIT = 1

const createProjectSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'ID must be alphanumeric with _ or -'),
})

export const projectsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /projects — create a project (with free plan limit)
projectsRouter.post('/', zValidator('json', createProjectSchema), async (c) => {
  const { id } = c.req.valid('json')
  const userId = c.get('userId')
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

  // Free plan: limit to 1 project per user
  const [userProjectCount] = await db
    .select({ count: count() })
    .from(projects)
    .where(eq(projects.userId, userId))

  if ((userProjectCount?.count ?? 0) >= FREE_PLAN_PROJECT_LIMIT) {
    return c.json(
      {
        error: 'Project limit reached',
        detail: `Free plan allows ${FREE_PLAN_PROJECT_LIMIT} project. Delete the existing project or upgrade your plan.`,
      },
      403,
    )
  }

  const now = new Date()
  await db.insert(projects).values({ id, userId, createdAt: now, updatedAt: now })

  return c.json({ id, userId, createdAt: now, updatedAt: now }, 201)
})

// DELETE /projects/:id — delete a project (and cascade to all related data)
projectsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  await db.delete(projects).where(eq(projects.id, id))

  return c.json({ deleted: id })
})
