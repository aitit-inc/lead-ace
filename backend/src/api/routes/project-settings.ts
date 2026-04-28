import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import type { Db } from '../../db/connection'
import { projects, projectSettings } from '../../db/schema'
import type { Env, Variables } from '../types'

export const projectSettingsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

async function verifyProject(db: Db, projectId: string, tenantId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1)
  return project
}

type SettingsRow = {
  projectId: string
  outboundMode: 'send' | 'draft'
  senderEmailAlias: string | null
  senderDisplayName: string | null
  unsubscribeEnabled: boolean
  updatedAt: Date
}

const DEFAULTS = {
  outboundMode: 'send' as const,
  senderEmailAlias: null,
  senderDisplayName: null,
  unsubscribeEnabled: true,
}

async function loadSettings(
  db: Db,
  projectId: string,
): Promise<SettingsRow | null> {
  const [row] = await db
    .select({
      projectId: projectSettings.projectId,
      outboundMode: projectSettings.outboundMode,
      senderEmailAlias: projectSettings.senderEmailAlias,
      senderDisplayName: projectSettings.senderDisplayName,
      unsubscribeEnabled: projectSettings.unsubscribeEnabled,
      updatedAt: projectSettings.updatedAt,
    })
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1)
  return row ?? null
}

// GET /projects/:id/settings — returns settings (with defaults if no row exists)
projectSettingsRouter.get('/projects/:id/settings', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!(await verifyProject(db, projectId, tenantId))) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const row = await loadSettings(db, projectId)
  if (!row) {
    return c.json({
      projectId,
      ...DEFAULTS,
      updatedAt: null,
    })
  }
  return c.json(row)
})

// PUT /projects/:id/settings — upsert. Any omitted field keeps its current value.
const updateSchema = z
  .object({
    outboundMode: z.enum(['send', 'draft']).optional(),
    senderEmailAlias: z.string().email().nullable().optional(),
    senderDisplayName: z.string().min(1).max(200).nullable().optional(),
    unsubscribeEnabled: z.boolean().optional(),
  })
  .strict()

projectSettingsRouter.put(
  '/projects/:id/settings',
  zValidator('json', updateSchema),
  async (c) => {
    const projectId = c.req.param('id')
    const tenantId = c.get('tenantId')
    const db = c.get('db')
    const patch = c.req.valid('json')

    if (!(await verifyProject(db, projectId, tenantId))) {
      return c.json({ error: 'Project not found' }, 404)
    }

    const now = new Date()
    const existing = await loadSettings(db, projectId)
    const merged = {
      outboundMode: patch.outboundMode ?? existing?.outboundMode ?? DEFAULTS.outboundMode,
      senderEmailAlias:
        patch.senderEmailAlias !== undefined
          ? patch.senderEmailAlias
          : existing?.senderEmailAlias ?? DEFAULTS.senderEmailAlias,
      senderDisplayName:
        patch.senderDisplayName !== undefined
          ? patch.senderDisplayName
          : existing?.senderDisplayName ?? DEFAULTS.senderDisplayName,
      unsubscribeEnabled:
        patch.unsubscribeEnabled ?? existing?.unsubscribeEnabled ?? DEFAULTS.unsubscribeEnabled,
    }

    const [row] = await db
      .insert(projectSettings)
      .values({
        projectId,
        tenantId,
        ...merged,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectSettings.projectId,
        set: { ...merged, updatedAt: now },
      })
      .returning({
        projectId: projectSettings.projectId,
        outboundMode: projectSettings.outboundMode,
        senderEmailAlias: projectSettings.senderEmailAlias,
        senderDisplayName: projectSettings.senderDisplayName,
        unsubscribeEnabled: projectSettings.unsubscribeEnabled,
        updatedAt: projectSettings.updatedAt,
      })

    return c.json(row)
  },
)
