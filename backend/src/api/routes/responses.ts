import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import {
  projects,
  outreachLogs,
  responses,
  projectProspects,
  prospects,
  sentimentEnum,
  responseTypeEnum,
  channelEnum,
} from '../../db/schema'
import type { Env, Variables } from '../types'

const recordResponseSchema = z.object({
  outreachLogId: z.number().int().positive(),
  channel: z.enum(channelEnum.enumValues),
  content: z.string().min(1),
  sentiment: z.enum(sentimentEnum.enumValues),
  responseType: z.enum(responseTypeEnum.enumValues),
  receivedAt: z.string().datetime().optional(),
  // If true, mark the prospect as do_not_contact across all projects
  markDoNotContact: z.boolean().default(false),
})

export const responsesRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /responses — record a response and update prospect status
responsesRouter.post('/responses', zValidator('json', recordResponseSchema), async (c) => {
  const input = c.req.valid('json')
  const userId = c.get('userId')
  const db = createDb(c.env.DATABASE_URL)

  // Fetch the outreach log to verify project ownership and get prospect info
  const [log] = await db
    .select({
      id: outreachLogs.id,
      projectId: outreachLogs.projectId,
      prospectId: outreachLogs.prospectId,
    })
    .from(outreachLogs)
    .where(eq(outreachLogs.id, input.outreachLogId))
    .limit(1)

  if (!log) {
    return c.json({ error: 'Outreach log not found' }, 404)
  }

  // Verify project ownership
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, log.projectId), eq(projects.userId, userId)))
    .limit(1)

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date()

  const [newResponse] = await db
    .insert(responses)
    .values({
      outreachLogId: input.outreachLogId,
      channel: input.channel,
      content: input.content,
      sentiment: input.sentiment,
      responseType: input.responseType,
      receivedAt,
    })
    .returning({ id: responses.id })

  // Determine new status from responseType + sentiment
  let newStatus: typeof projectProspects.$inferSelect.status | null = null
  switch (input.responseType) {
    case 'bounce':
      newStatus = 'inactive'
      break
    case 'auto_reply':
      // No status change for auto-replies
      break
    case 'rejection':
      newStatus = 'rejected'
      break
    case 'meeting_request':
      newStatus = 'responded'
      break
    case 'reply':
      newStatus = input.sentiment === 'negative' ? 'rejected' : 'responded'
      break
  }

  if (newStatus) {
    await db
      .update(projectProspects)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(
        and(
          eq(projectProspects.projectId, log.projectId),
          eq(projectProspects.prospectId, log.prospectId),
        ),
      )
  }

  // Mark do_not_contact globally if requested or if bounce
  if (input.markDoNotContact || input.responseType === 'bounce') {
    await db
      .update(prospects)
      .set({ doNotContact: true, updatedAt: new Date() })
      .where(eq(prospects.id, log.prospectId))
  }

  return c.json({ id: newResponse?.id }, 201)
})
