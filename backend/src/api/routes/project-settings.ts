import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { projectSettings, OUTBOUND_MODES } from '../../db/schema'
import type { Env, Variables } from '../types'
import { verifyProject } from '../project-helpers'

export const projectSettingsRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

const DEFAULTS = {
  outboundMode: 'send' as const,
  senderEmailAlias: null,
  senderDisplayName: null,
  unsubscribeEnabled: true,
}

const settingsCols = {
  projectId: projectSettings.projectId,
  outboundMode: projectSettings.outboundMode,
  senderEmailAlias: projectSettings.senderEmailAlias,
  senderDisplayName: projectSettings.senderDisplayName,
  unsubscribeEnabled: projectSettings.unsubscribeEnabled,
  updatedAt: projectSettings.updatedAt,
}

projectSettingsRouter.get('/projects/:id/settings', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!(await verifyProject(db, projectId, tenantId))) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const [row] = await db
    .select(settingsCols)
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1)
  if (!row) {
    return c.json({ projectId, ...DEFAULTS, updatedAt: null })
  }
  return c.json(row)
})

const updateSchema = z
  .object({
    outboundMode: z.enum(OUTBOUND_MODES).optional(),
    senderEmailAlias: z.email().nullable().optional(),
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

    // On UPDATE, set only columns the caller explicitly provided. Omitted columns
    // keep their existing DB value — avoids the read-modify-write race where two
    // concurrent PUTs both pre-load the same row and the loser's patch wipes the
    // winner's untouched fields.
    const updateSet = {
      ...(patch.outboundMode !== undefined ? { outboundMode: patch.outboundMode } : {}),
      ...(patch.senderEmailAlias !== undefined ? { senderEmailAlias: patch.senderEmailAlias } : {}),
      ...(patch.senderDisplayName !== undefined ? { senderDisplayName: patch.senderDisplayName } : {}),
      ...(patch.unsubscribeEnabled !== undefined ? { unsubscribeEnabled: patch.unsubscribeEnabled } : {}),
      updatedAt: now,
    }

    const [row] = await db
      .insert(projectSettings)
      .values({
        projectId,
        tenantId,
        outboundMode: patch.outboundMode ?? DEFAULTS.outboundMode,
        senderEmailAlias: patch.senderEmailAlias ?? DEFAULTS.senderEmailAlias,
        senderDisplayName: patch.senderDisplayName ?? DEFAULTS.senderDisplayName,
        unsubscribeEnabled: patch.unsubscribeEnabled ?? DEFAULTS.unsubscribeEnabled,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectSettings.projectId,
        set: updateSet,
      })
      .returning(settingsCols)

    return c.json(row)
  },
)
