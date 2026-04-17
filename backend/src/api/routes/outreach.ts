import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { projects, outreachLogs, projectProspects, channelEnum } from '../../db/schema'
import { getRemainingOutreachQuota } from '../plan-limits'
import type { Env, Variables } from '../types'

const recordOutreachSchema = z.object({
  projectId: z.string().min(1),
  prospectId: z.number().int().positive(),
  channel: z.enum(channelEnum.enumValues),
  subject: z.string().optional(),
  body: z.string().min(1),
  status: z.enum(['sent', 'failed']).default('sent'),
  sentAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
})

export const outreachRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /outreach — record outreach log and update prospect status to 'contacted'
outreachRouter.post('/outreach', zValidator('json', recordOutreachSchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.tenantId, tenantId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Quota guard: reject if outreach limit exceeded (only for successful sends)
  if (input.status === 'sent') {
    const quota = await getRemainingOutreachQuota(db, tenantId)
    if (quota.remaining !== null && quota.remaining <= 0) {
      return c.json({
        error: 'Outreach limit reached',
        detail: `Your ${quota.plan} plan allows ${quota.limit} outreach actions. Upgrade your plan to continue.`,
      }, 403)
    }
  }

  const sentAt = input.sentAt ? new Date(input.sentAt) : new Date()

  const [log] = await db
    .insert(outreachLogs)
    .values({
      tenantId,
      projectId: input.projectId,
      prospectId: input.prospectId,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body,
      status: input.status,
      sentAt,
      errorMessage: input.errorMessage ?? null,
    })
    .returning({ id: outreachLogs.id })

  // If sent successfully, update project_prospects status to 'contacted'
  if (input.status === 'sent' && log) {
    await db
      .update(projectProspects)
      .set({ status: 'contacted', updatedAt: new Date() })
      .where(
        and(
          eq(projectProspects.projectId, input.projectId),
          eq(projectProspects.prospectId, input.prospectId),
          eq(projectProspects.status, 'new'), // only update if still 'new'
        ),
      )
  }

  return c.json({ id: log?.id }, 201)
})

// GET /projects/:id/outreach/recent — recent outreach logs for check-results
outreachRouter.get('/projects/:id/outreach/recent', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 100
  const db = c.get('db')

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const logs = await db
    .select({
      id: outreachLogs.id,
      prospectId: outreachLogs.prospectId,
      channel: outreachLogs.channel,
      subject: outreachLogs.subject,
      body: outreachLogs.body,
      status: outreachLogs.status,
      sentAt: outreachLogs.sentAt,
      errorMessage: outreachLogs.errorMessage,
    })
    .from(outreachLogs)
    .where(eq(outreachLogs.projectId, projectId))
    .orderBy(desc(outreachLogs.sentAt))
    .limit(limit)

  return c.json({ logs })
})
