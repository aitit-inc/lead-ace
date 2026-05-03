import { Hono } from 'hono'
import type { Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import {
  prospects,
  organizations,
  outreachLogs,
  responses,
  REJECTION_PRIMARY_REASONS,
  REJECTION_RECONTACT_WINDOWS,
  type RejectionFeedbackV1,
} from '../../db/schema'
import {
  InvalidUnsubscribeTokenError,
  verifyUnsubscribeToken,
  type UnsubscribeTokenPayload,
} from '../../auth/unsubscribe-token'
import type { Env } from '../types'

// Public, unauthenticated unsubscribe routes. The HMAC token in the URL is
// the auth — anyone holding a valid token can flip do_not_contact for that
// prospect. No user session, no RLS (we use createDb() directly to bypass).
//
// Mounted BEFORE the /api/* auth middleware. UX:
//   GET  /api/unsubscribe/:token              -> returns prospect summary for confirmation page
//   POST /api/unsubscribe/:token              -> sets do_not_contact=true (idempotent, RFC 8058 one-click target)
//   POST /api/unsubscribe/:token/with-reason  -> same DNC ratchet PLUS records a structured rejection
//                                                 (responses + rejection_feedback) for /check-feedback aggregation.

export const unsubscribeRouter = new Hono<{ Bindings: Env }>()

const withReasonBodySchema = z.object({
  primary_reason: z.enum(REJECTION_PRIMARY_REASONS),
  secondary_reasons: z.array(z.enum(REJECTION_PRIMARY_REASONS)).max(5).optional(),
  free_text: z.string().max(500).optional(),
  preferred_recontact_window: z.enum(REJECTION_RECONTACT_WINDOWS).optional(),
  consent: z.object({
    gdpr_erasure_request: z.boolean().optional(),
    ccpa_opt_out: z.boolean().optional(),
    marketing_opt_out: z.boolean().optional(),
  }).optional(),
})

// Returns the verified payload or a ready-to-return 400 Response. Centralizes
// the InvalidUnsubscribeTokenError → 400 mapping that all three handlers share.
async function verifyTokenOrFail(
  c: Context<{ Bindings: Env }>,
  token: string,
): Promise<UnsubscribeTokenPayload | Response> {
  try {
    return await verifyUnsubscribeToken(token, c.env.UNSUBSCRIBE_TOKEN_SECRET)
  } catch (e) {
    if (e instanceof InvalidUnsubscribeTokenError) {
      return c.json({ error: 'Invalid or tampered unsubscribe link' }, 400)
    }
    throw e
  }
}

unsubscribeRouter.get('/unsubscribe/:token', async (c) => {
  const result = await verifyTokenOrFail(c, c.req.param('token'))
  if (result instanceof Response) return result
  const payload = result

  const db = createDb(c.env.DATABASE_URL)
  const [row] = await db
    .select({
      email: prospects.email,
      doNotContact: prospects.doNotContact,
      organizationName: organizations.name,
    })
    .from(prospects)
    .innerJoin(organizations, eq(organizations.id, prospects.organizationId))
    .where(eq(prospects.id, payload.prospectId))
    .limit(1)

  if (!row || row.email === null) {
    // Either deleted entirely, or this prospect has no email channel — in
    // both cases the link is no longer actionable.
    return c.json({ error: 'Unsubscribe link is no longer valid' }, 404)
  }

  return c.json({
    email: row.email,
    organizationName: row.organizationName,
    alreadyUnsubscribed: row.doNotContact,
  })
})

unsubscribeRouter.post('/unsubscribe/:token', async (c) => {
  const result = await verifyTokenOrFail(c, c.req.param('token'))
  if (result instanceof Response) return result
  const payload = result

  const db = createDb(c.env.DATABASE_URL)
  const [updated] = await db
    .update(prospects)
    .set({ doNotContact: true, updatedAt: new Date() })
    .where(eq(prospects.id, payload.prospectId))
    .returning({ id: prospects.id })

  if (!updated) {
    return c.json({ error: 'Unsubscribe link is no longer valid' }, 404)
  }

  return c.json({ unsubscribed: true })
})

unsubscribeRouter.post(
  '/unsubscribe/:token/with-reason',
  zValidator('json', withReasonBodySchema),
  async (c) => {
    const result = await verifyTokenOrFail(c, c.req.param('token'))
    if (result instanceof Response) return result
    const payload = result

    const body = c.req.valid('json')
    const submittedAt = new Date()

    const db = createDb(c.env.DATABASE_URL)

    // Read prospect (existence + tenantId) and the latest outreach log in parallel.
    // Both are keyed on payload.prospectId; latestLog is wasted work if the prospect
    // was deleted, but it's a single indexed lookup and saves one round-trip on the
    // happy path.
    const [[prospect], [latestLog]] = await Promise.all([
      db
        .select({ id: prospects.id, tenantId: prospects.tenantId })
        .from(prospects)
        .where(eq(prospects.id, payload.prospectId))
        .limit(1),
      db
        .select({ id: outreachLogs.id, channel: outreachLogs.channel })
        .from(outreachLogs)
        .where(eq(outreachLogs.prospectId, payload.prospectId))
        .orderBy(desc(outreachLogs.sentAt))
        .limit(1),
    ])

    if (!prospect) {
      return c.json({ error: 'Unsubscribe link is no longer valid' }, 404)
    }

    const feedback: RejectionFeedbackV1 = {
      version: 1,
      primary_reason: body.primary_reason,
      ...(body.secondary_reasons ? { secondary_reasons: body.secondary_reasons } : {}),
      ...(body.free_text ? { free_text: body.free_text } : {}),
      ...(body.preferred_recontact_window ? { preferred_recontact_window: body.preferred_recontact_window } : {}),
      ...(body.consent ? { consent: body.consent } : {}),
      submitted_at: submittedAt.toISOString(),
    }

    let responseId: number | undefined
    if (latestLog) {
      const [inserted] = await db
        .insert(responses)
        .values({
          tenantId: prospect.tenantId,
          outreachLogId: latestLog.id,
          channel: latestLog.channel,
          content: body.free_text ?? '(unsubscribe via link)',
          sentiment: 'negative',
          responseType: 'rejection',
          receivedAt: submittedAt,
          rejectionFeedback: feedback,
        })
        .returning({ id: responses.id })
      responseId = inserted?.id
    }

    // The unsubscribe form's whole purpose is to stop further contact, so DNC
    // is unconditional here — there is no "give feedback but keep emailing me"
    // mode. The conditional opt-out logic in /responses (feedbackForcesDoNotContact)
    // is only relevant when the caller might NOT intend to unsubscribe.
    await db
      .update(prospects)
      .set({ doNotContact: true, updatedAt: new Date() })
      .where(eq(prospects.id, payload.prospectId))

    return c.json({ unsubscribed: true, responseId })
  },
)
