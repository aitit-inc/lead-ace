import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import { masterDocuments } from '../../db/schema'
import type { Env, Variables } from '../types'

export const masterDocumentsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// ---------------------------------------------------------------------------
// GET /master-documents — list all master documents (slug + version + updatedAt)
// ---------------------------------------------------------------------------

masterDocumentsRouter.get('/master-documents', async (c) => {
  const db = createDb(c.env.DATABASE_URL)

  const rows = await db
    .select({
      slug: masterDocuments.slug,
      version: masterDocuments.version,
      updatedAt: masterDocuments.updatedAt,
    })
    .from(masterDocuments)
    .orderBy(masterDocuments.slug)

  return c.json({ documents: rows })
})

// ---------------------------------------------------------------------------
// GET /master-documents/:slug — get a master document by slug
// ---------------------------------------------------------------------------

masterDocumentsRouter.get('/master-documents/:slug', async (c) => {
  const slug = c.req.param('slug')
  const db = createDb(c.env.DATABASE_URL)

  const [doc] = await db
    .select({
      id: masterDocuments.id,
      slug: masterDocuments.slug,
      content: masterDocuments.content,
      version: masterDocuments.version,
      updatedAt: masterDocuments.updatedAt,
    })
    .from(masterDocuments)
    .where(eq(masterDocuments.slug, slug))
    .limit(1)

  if (!doc) {
    return c.json({ error: 'Master document not found' }, 404)
  }

  return c.json(doc)
})
