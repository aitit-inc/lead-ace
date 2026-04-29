import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, ne, sql } from 'drizzle-orm'
import {
  outreachLogs,
  outreachStatusEnum,
  projectProspects,
  prospects,
  responses,
  channelEnum,
} from '../../db/schema'
import { getRemainingOutreachQuota } from '../plan-limits'
import {
  sendGmailForUser,
  buildUnsubscribeAttachments,
  loadProjectSendSettings,
} from '../../auth/google'
import { verifyProject } from '../project-helpers'
import type { Env, Variables } from '../types'

const recordOutreachSchema = z.object({
  projectId: z.string().min(1),
  prospectId: z.number().int().positive(),
  channel: z.enum(channelEnum.enumValues),
  subject: z.string().optional(),
  body: z.string().min(1),
  status: z.enum(outreachStatusEnum.enumValues).default('sent'),
  sentAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
})

export const outreachRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /outreach — record outreach log and update prospect status to 'contacted'
outreachRouter.post('/outreach', zValidator('json', recordOutreachSchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!(await verifyProject(db, input.projectId, tenantId))) {
    return c.json({ error: 'Project not found' }, 404)
  }

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

  // Drafts shouldn't be re-targeted by get_outbound_targets; only 'failed'
  // keeps the prospect available for retry.
  if ((input.status === 'sent' || input.status === 'pending_review') && log) {
    await db
      .update(projectProspects)
      .set({ status: 'contacted', updatedAt: new Date() })
      .where(
        and(
          eq(projectProspects.projectId, input.projectId),
          eq(projectProspects.prospectId, input.prospectId),
          eq(projectProspects.status, 'new'),
        ),
      )
  }

  return c.json({ id: log?.id }, 201)
})

const sendAndRecordSchema = z.object({
  projectId: z.string().min(1),
  prospectId: z.number().int().positive(),
  to: z.array(z.email()).min(1),
  cc: z.array(z.email()).optional(),
  bcc: z.array(z.email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  inReplyTo: z.string().optional(),
})

// POST /outreach/send-and-record — send via Gmail API and log in one atomic step.
// Replaces the prior `gog send` + record_outreach skill flow.
outreachRouter.post(
  '/outreach/send-and-record',
  zValidator('json', sendAndRecordSchema),
  async (c) => {
    const input = c.req.valid('json')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const db = c.get('db')

    const [verified, quota, sendSettings, prospectEmailRow] = await Promise.all([
      verifyProject(db, input.projectId, tenantId),
      getRemainingOutreachQuota(db, tenantId),
      loadProjectSendSettings(db, input.projectId),
      db
        .select({ email: prospects.email })
        .from(prospects)
        .where(eq(prospects.id, input.prospectId))
        .limit(1)
        .then((rows) => rows[0]),
    ])
    if (!verified) {
      return c.json({ error: 'Project not found' }, 404)
    }
    if (quota.remaining !== null && quota.remaining <= 0) {
      return c.json(
        {
          error: 'Outreach limit reached',
          detail: `Your ${quota.plan} plan allows ${quota.limit} outreach actions. Upgrade your plan to continue.`,
        },
        403,
      )
    }

    const unsubscribe = await buildUnsubscribeAttachments({
      prospectId: input.prospectId,
      tenantId,
      prospectEmail: prospectEmailRow?.email ?? null,
      unsubscribeEnabled: sendSettings.unsubscribeEnabled,
      appUrl: c.env.APP_URL,
      apiUrl: new URL(c.req.url).origin,
      secret: c.env.UNSUBSCRIBE_TOKEN_SECRET,
    })
    const sendBody = unsubscribe ? `${input.body}${unsubscribe.footer}` : input.body

    const result = await sendGmailForUser(db, {
      tenantId,
      userId,
      encryptionKey: c.env.GMAIL_TOKEN_ENCRYPTION_KEY,
      clientId: c.env.GOOGLE_CLIENT_ID,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: sendBody,
      inReplyTo: input.inReplyTo,
      extraHeaders: unsubscribe?.headers,
      senderEmailAlias: sendSettings.senderEmailAlias,
      senderDisplayName: sendSettings.senderDisplayName,
    })

    if (!result.ok && result.httpStatus === 412) {
      return c.json({ error: result.error, detail: result.detail }, 412)
    }

    const sentAt = new Date()
    const [log] = await db
      .insert(outreachLogs)
      .values({
        tenantId,
        projectId: input.projectId,
        prospectId: input.prospectId,
        channel: 'email',
        subject: input.subject,
        body: input.body,
        status: result.ok ? 'sent' : 'failed',
        sentAt,
        errorMessage: result.ok ? null : result.detail,
      })
      .returning({ id: outreachLogs.id })

    if (result.ok && log) {
      await db
        .update(projectProspects)
        .set({ status: 'contacted', updatedAt: sentAt })
        .where(
          and(
            eq(projectProspects.projectId, input.projectId),
            eq(projectProspects.prospectId, input.prospectId),
            eq(projectProspects.status, 'new'),
          ),
        )
    }

    if (!result.ok) {
      return c.json({ error: result.error, detail: result.detail, outreachId: log?.id }, 502)
    }
    return c.json({ outreachId: log?.id, messageId: result.messageId, threadId: result.threadId }, 201)
  },
)

// GET /projects/:id/outreach/recent — recent sent/failed outreach logs for check-results.
// Drafts (status='pending_review') are excluded so check-results doesn't mistake them
// for actually-sent emails.
outreachRouter.get('/projects/:id/outreach/recent', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 200) : 100
  const db = c.get('db')

  if (!(await verifyProject(db, projectId, tenantId))) {
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
      responseCount: sql<number>`COALESCE(COUNT(${responses.id})::int, 0)`,
      latestResponseAt: sql<string | null>`MAX(${responses.receivedAt})`,
    })
    .from(outreachLogs)
    .leftJoin(responses, eq(responses.outreachLogId, outreachLogs.id))
    .where(and(
      eq(outreachLogs.projectId, projectId),
      ne(outreachLogs.status, 'pending_review'),
    ))
    .groupBy(outreachLogs.id)
    .orderBy(desc(outreachLogs.sentAt))
    .limit(limit)

  return c.json({ logs })
})

outreachRouter.get('/outreach/:id/responses', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  const [log] = await db
    .select({ id: outreachLogs.id })
    .from(outreachLogs)
    .where(and(eq(outreachLogs.id, id), eq(outreachLogs.tenantId, tenantId)))
    .limit(1)

  if (!log) return c.json({ error: 'Outreach log not found' }, 404)

  const rows = await db
    .select({
      id: responses.id,
      channel: responses.channel,
      content: responses.content,
      sentiment: responses.sentiment,
      responseType: responses.responseType,
      receivedAt: responses.receivedAt,
    })
    .from(responses)
    .where(eq(responses.outreachLogId, id))
    .orderBy(desc(responses.receivedAt))

  return c.json({ responses: rows })
})

// GET /projects/:id/drafts — list pending_review drafts for review
outreachRouter.get('/projects/:id/drafts', async (c) => {
  const projectId = c.req.param('id')
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  if (!(await verifyProject(db, projectId, tenantId))) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const drafts = await db
    .select({
      id: outreachLogs.id,
      prospectId: outreachLogs.prospectId,
      prospectName: prospects.name,
      prospectEmail: prospects.email,
      channel: outreachLogs.channel,
      subject: outreachLogs.subject,
      body: outreachLogs.body,
      createdAt: outreachLogs.sentAt,
    })
    .from(outreachLogs)
    .innerJoin(prospects, eq(prospects.id, outreachLogs.prospectId))
    .where(and(
      eq(outreachLogs.projectId, projectId),
      eq(outreachLogs.status, 'pending_review'),
    ))
    .orderBy(desc(outreachLogs.sentAt))

  return c.json({ drafts })
})

const editDraftSchema = z
  .object({
    subject: z.string().nullable().optional(),
    body: z.string().min(1).optional(),
  })
  .strict()

// PUT /outreach/drafts/:id — edit a pending_review draft's subject/body
outreachRouter.put(
  '/outreach/drafts/:id',
  zValidator('json', editDraftSchema),
  async (c) => {
    const id = parseInt(c.req.param('id'), 10)
    if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
    const tenantId = c.get('tenantId')
    const db = c.get('db')
    const patch = c.req.valid('json')

    const [updated] = await db
      .update(outreachLogs)
      .set({
        ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
      })
      .where(and(
        eq(outreachLogs.id, id),
        eq(outreachLogs.tenantId, tenantId),
        eq(outreachLogs.status, 'pending_review'),
      ))
      .returning({ id: outreachLogs.id })

    if (!updated) {
      return c.json({ error: 'Draft not found or already sent' }, 404)
    }
    return c.json({ id: updated.id })
  },
)

// POST /outreach/drafts/:id/send — send a pending_review draft via gmail.send.
// On gmail failure the row flips to status='failed'; the prospect stays
// 'contacted' (re-outreach would create a new row).
outreachRouter.post('/outreach/drafts/:id/send', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  const tenantId = c.get('tenantId')
  const userId = c.get('userId')
  const db = c.get('db')

  const [draft, quota] = await Promise.all([
    db
      .select({
        id: outreachLogs.id,
        projectId: outreachLogs.projectId,
        prospectId: outreachLogs.prospectId,
        subject: outreachLogs.subject,
        body: outreachLogs.body,
        status: outreachLogs.status,
        prospectEmail: prospects.email,
        doNotContact: prospects.doNotContact,
      })
      .from(outreachLogs)
      .innerJoin(prospects, eq(prospects.id, outreachLogs.prospectId))
      .where(and(eq(outreachLogs.id, id), eq(outreachLogs.tenantId, tenantId)))
      .limit(1)
      .then((rows) => rows[0]),
    getRemainingOutreachQuota(db, tenantId),
  ])

  if (!draft) return c.json({ error: 'Draft not found' }, 404)
  if (draft.status !== 'pending_review') {
    return c.json({ error: 'Draft already sent or not in review' }, 409)
  }
  if (!draft.prospectEmail) {
    return c.json({ error: 'Prospect has no email address' }, 422)
  }
  if (draft.doNotContact) {
    return c.json({ error: 'Prospect is on do-not-contact list' }, 422)
  }
  if (quota.remaining !== null && quota.remaining <= 0) {
    return c.json(
      {
        error: 'Outreach limit reached',
        detail: `Your ${quota.plan} plan allows ${quota.limit} outreach actions. Upgrade your plan to continue.`,
      },
      403,
    )
  }

  const sendSettings = await loadProjectSendSettings(db, draft.projectId)
  const unsubscribe = await buildUnsubscribeAttachments({
    prospectId: draft.prospectId,
    tenantId,
    prospectEmail: draft.prospectEmail,
    unsubscribeEnabled: sendSettings.unsubscribeEnabled,
    appUrl: c.env.APP_URL,
    apiUrl: new URL(c.req.url).origin,
    secret: c.env.UNSUBSCRIBE_TOKEN_SECRET,
  })
  const sendBody = unsubscribe ? `${draft.body}${unsubscribe.footer}` : draft.body

  const result = await sendGmailForUser(db, {
    tenantId,
    userId,
    encryptionKey: c.env.GMAIL_TOKEN_ENCRYPTION_KEY,
    clientId: c.env.GOOGLE_CLIENT_ID,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    to: [draft.prospectEmail],
    subject: draft.subject ?? '',
    body: sendBody,
    extraHeaders: unsubscribe?.headers,
    senderEmailAlias: sendSettings.senderEmailAlias,
    senderDisplayName: sendSettings.senderDisplayName,
  })

  if (!result.ok && result.httpStatus === 412) {
    return c.json({ error: result.error, detail: result.detail }, 412)
  }

  await db
    .update(outreachLogs)
    .set({
      status: result.ok ? 'sent' : 'failed',
      sentAt: new Date(),
      errorMessage: result.ok ? null : result.detail,
    })
    .where(eq(outreachLogs.id, draft.id))

  if (!result.ok) {
    return c.json({ error: result.error, detail: result.detail, outreachId: draft.id }, 502)
  }
  return c.json({ outreachId: draft.id, messageId: result.messageId, threadId: result.threadId })
})

// DELETE /outreach/drafts/:id — discard a pending_review draft.
// If this was the only outreach for that prospect, revert prospect status to
// 'new' so /outbound can pick it up again.
outreachRouter.delete('/outreach/drafts/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (Number.isNaN(id)) return c.json({ error: 'Invalid id' }, 400)
  const tenantId = c.get('tenantId')
  const db = c.get('db')

  // Atomic delete-if-pending: either we delete a pending_review row (RETURNING
  // the prospect/project) or no row matches and we surface 404/409 by inspecting
  // why. We avoid the read-then-delete race that would otherwise let a concurrent
  // /send and /delete both succeed.
  const [deleted] = await db
    .delete(outreachLogs)
    .where(and(
      eq(outreachLogs.id, id),
      eq(outreachLogs.tenantId, tenantId),
      eq(outreachLogs.status, 'pending_review'),
    ))
    .returning({
      projectId: outreachLogs.projectId,
      prospectId: outreachLogs.prospectId,
    })

  if (!deleted) {
    const [exists] = await db
      .select({ status: outreachLogs.status })
      .from(outreachLogs)
      .where(and(eq(outreachLogs.id, id), eq(outreachLogs.tenantId, tenantId)))
      .limit(1)
    if (!exists) return c.json({ error: 'Draft not found' }, 404)
    return c.json({ error: 'Cannot discard a sent or failed message' }, 409)
  }

  // Revert prospect to 'new' iff no other outreach exists for this pair.
  await db
    .update(projectProspects)
    .set({ status: 'new', updatedAt: new Date() })
    .where(and(
      eq(projectProspects.projectId, deleted.projectId),
      eq(projectProspects.prospectId, deleted.prospectId),
      eq(projectProspects.status, 'contacted'),
      sql`NOT EXISTS (
        SELECT 1 FROM ${outreachLogs}
        WHERE ${outreachLogs.projectId} = ${deleted.projectId}
          AND ${outreachLogs.prospectId} = ${deleted.prospectId}
      )`,
    ))

  return c.json({ deleted: true })
})
