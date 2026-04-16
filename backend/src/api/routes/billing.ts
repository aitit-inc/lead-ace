import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import { tenantPlans } from '../../db/schema'
import { getTenantPlan, getPlanLimits, getRemainingOutreachQuota, countTenantProspects } from '../plan-limits'
import type { Env, Variables } from '../types'

// ---------------------------------------------------------------------------
// Stripe helpers (raw fetch — no SDK needed for Workers)
// ---------------------------------------------------------------------------

async function stripeRequest(
  method: string,
  path: string,
  body: Record<string, string> | null,
  secretKey: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  })
  const data = (await res.json()) as Record<string, unknown>
  return { ok: res.ok, data }
}

// Map Stripe price metadata to plan tier
function planFromPriceMetadata(metadata: Record<string, string> | null | undefined): 'starter' | 'pro' | 'scale' | null {
  const plan = metadata?.['plan']
  if (plan === 'starter' || plan === 'pro' || plan === 'scale') return plan
  return null
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const billingRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// ---------------------------------------------------------------------------
// GET /me/plan — current plan + quota info
// ---------------------------------------------------------------------------

billingRouter.get('/me/plan', async (c) => {
  const tenantId = c.get('tenantId')
  const db = createDb(c.env.DATABASE_URL)

  const tenantPlan = await getTenantPlan(db, tenantId)
  const limits = getPlanLimits(tenantPlan.plan)
  const quota = await getRemainingOutreachQuota(db, tenantId)

  const result: Record<string, unknown> = {
    plan: tenantPlan.plan,
    limits: {
      maxProjects: limits.maxProjects,
      maxOutreachPerMonth: limits.maxOutreachPerMonth,
      maxProspects: limits.maxProspects,
      isLifetime: limits.isLifetime,
    },
    outreach: {
      used: quota.used,
      remaining: quota.remaining,
      limit: quota.limit,
    },
  }

  if (limits.maxProspects !== null) {
    const prospectCount = await countTenantProspects(db, tenantId)
    result['prospects'] = {
      used: prospectCount,
      remaining: Math.max(0, limits.maxProspects - prospectCount),
      limit: limits.maxProspects,
    }
  }

  return c.json(result)
})

// ---------------------------------------------------------------------------
// POST /me/checkout — create Stripe Checkout session
// ---------------------------------------------------------------------------

billingRouter.post('/me/checkout', async (c) => {
  const userId = c.get('userId') // userId for Stripe client_reference_id (user identity)
  let body: { priceId: string; successUrl?: string; cancelUrl?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.priceId) {
    return c.json({ error: 'priceId is required' }, 400)
  }

  const { ok, data } = await stripeRequest('POST', '/checkout/sessions', {
    'mode': 'subscription',
    'line_items[0][price]': body.priceId,
    'line_items[0][quantity]': '1',
    'client_reference_id': userId,
    'success_url': body.successUrl ?? `${c.req.url.split('/api')[0]}/settings?checkout=success`,
    'cancel_url': body.cancelUrl ?? `${c.req.url.split('/api')[0]}/settings?checkout=cancel`,
  }, c.env.STRIPE_SECRET_KEY)

  if (!ok) {
    return c.json({ error: 'Failed to create checkout session', detail: data }, 500)
  }

  return c.json({ url: data['url'] })
})

// ---------------------------------------------------------------------------
// POST /me/portal — create Stripe Customer Portal session
// ---------------------------------------------------------------------------

billingRouter.post('/me/portal', async (c) => {
  const tenantId = c.get('tenantId')
  const db = createDb(c.env.DATABASE_URL)
  let body: { returnUrl?: string }
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }

  const [row] = await db
    .select({ stripeCustomerId: tenantPlans.stripeCustomerId })
    .from(tenantPlans)
    .where(eq(tenantPlans.tenantId, tenantId))
    .limit(1)

  if (!row?.stripeCustomerId) {
    return c.json({ error: 'No active subscription found' }, 404)
  }

  const { ok, data } = await stripeRequest('POST', '/billing_portal/sessions', {
    customer: row.stripeCustomerId,
    return_url: body.returnUrl ?? `${c.req.url.split('/api')[0]}/settings`,
  }, c.env.STRIPE_SECRET_KEY)

  if (!ok) {
    return c.json({ error: 'Failed to create portal session', detail: data }, 500)
  }

  return c.json({ url: data['url'] })
})
