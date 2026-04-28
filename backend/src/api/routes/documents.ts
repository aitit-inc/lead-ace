import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { projectDocuments } from '../../db/schema'
import type { Env, Variables } from '../types'
import { verifyProject } from '../project-helpers'

export const documentsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// ---------------------------------------------------------------------------
// GET /projects/:id/documents — list slugs with last updated timestamp
// ---------------------------------------------------------------------------

documentsRouter.get('/projects/:id/documents', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Get the latest entry per slug
  const rows = await db
    .selectDistinctOn([projectDocuments.slug], {
      slug: projectDocuments.slug,
      updatedAt: projectDocuments.createdAt,
    })
    .from(projectDocuments)
    .where(eq(projectDocuments.projectId, projectId))
    .orderBy(projectDocuments.slug, desc(projectDocuments.createdAt))

  return c.json({ documents: rows })
})

// ---------------------------------------------------------------------------
// GET /projects/:id/documents/:slug — latest version
// ---------------------------------------------------------------------------

documentsRouter.get('/projects/:id/documents/:slug', async (c) => {
  const projectId = c.req.param('id')
  const slug = c.req.param('slug')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const [doc] = await db
    .select({
      id: projectDocuments.id,
      slug: projectDocuments.slug,
      content: projectDocuments.content,
      createdAt: projectDocuments.createdAt,
    })
    .from(projectDocuments)
    .where(and(
      eq(projectDocuments.projectId, projectId),
      eq(projectDocuments.slug, slug),
    ))
    .orderBy(desc(projectDocuments.createdAt))
    .limit(1)

  if (!doc) {
    return c.json({ error: 'Document not found' }, 404)
  }

  return c.json(doc)
})

// ---------------------------------------------------------------------------
// GET /projects/:id/documents/:slug/history — version history
// ---------------------------------------------------------------------------

documentsRouter.get('/projects/:id/documents/:slug/history', async (c) => {
  const projectId = c.req.param('id')
  const slug = c.req.param('slug')
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 50) : 10
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!await verifyProject(db, projectId, tenantId)) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const rows = await db
    .select({
      id: projectDocuments.id,
      content: projectDocuments.content,
      createdAt: projectDocuments.createdAt,
    })
    .from(projectDocuments)
    .where(and(
      eq(projectDocuments.projectId, projectId),
      eq(projectDocuments.slug, slug),
    ))
    .orderBy(desc(projectDocuments.createdAt))
    .limit(limit)

  return c.json({ history: rows })
})

// ---------------------------------------------------------------------------
// PUT /projects/:id/documents/:slug — save new version
// ---------------------------------------------------------------------------

const saveDocumentSchema = z.object({
  content: z.string().min(1),
})

documentsRouter.put(
  '/projects/:id/documents/:slug',
  zValidator('json', saveDocumentSchema),
  async (c) => {
    const projectId = c.req.param('id')
    const slug = c.req.param('slug')
    const { content } = c.req.valid('json')
    const tenantId = c.get('tenantId')
    const db = c.get('db')

    if (!await verifyProject(db, projectId, tenantId)) {
      return c.json({ error: 'Project not found' }, 404)
    }

    const [doc] = await db
      .insert(projectDocuments)
      .values({ tenantId, projectId, slug, content })
      .returning({
        id: projectDocuments.id,
        createdAt: projectDocuments.createdAt,
      })

    return c.json({ id: doc!.id, slug, createdAt: doc!.createdAt }, 201)
  },
)
