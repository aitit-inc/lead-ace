import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import { prospects, organizations } from '../../db/schema'
import {
  InvalidUnsubscribeTokenError,
  verifyUnsubscribeToken,
} from '../../auth/unsubscribe-token'
import type { Env } from '../types'

// Public, unauthenticated unsubscribe routes. The HMAC token in the URL is
// the auth — anyone holding a valid token can flip do_not_contact for that
// prospect. No user session, no RLS (we use createDb() directly to bypass).
//
// Mounted BEFORE the /api/* auth middleware. Two-step UX:
//   GET  /api/unsubscribe/:token  -> returns prospect summary for confirmation page
//   POST /api/unsubscribe/:token  -> sets do_not_contact=true (idempotent)
//
// POST is also wired as the RFC 8058 List-Unsubscribe one-click target.

export const unsubscribeRouter = new Hono<{ Bindings: Env }>()

unsubscribeRouter.get('/unsubscribe/:token', async (c) => {
  const token = c.req.param('token')
  let payload
  try {
    payload = await verifyUnsubscribeToken(token, c.env.UNSUBSCRIBE_TOKEN_SECRET)
  } catch (e) {
    if (e instanceof InvalidUnsubscribeTokenError) {
      return c.json({ error: 'Invalid or tampered unsubscribe link' }, 400)
    }
    throw e
  }

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
  const token = c.req.param('token')
  let payload
  try {
    payload = await verifyUnsubscribeToken(token, c.env.UNSUBSCRIBE_TOKEN_SECRET)
  } catch (e) {
    if (e instanceof InvalidUnsubscribeTokenError) {
      return c.json({ error: 'Invalid or tampered unsubscribe link' }, 400)
    }
    throw e
  }

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
