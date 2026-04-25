import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import { tenantPlans, tenantMembers } from '../../db/schema'
import type { Env } from '../types'

// ---------------------------------------------------------------------------
// Stripe webhook signature verification (Web Crypto API for Workers)
// ---------------------------------------------------------------------------

async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const parts = sigHeader.split(',').reduce(
    (acc, part) => {
      const [k, v] = part.split('=')
      if (k === 't') acc.timestamp = v!
      if (k === 'v1') acc.signatures.push(v!)
      return acc
    },
    { timestamp: '', signatures: [] as string[] },
  )

  if (!parts.timestamp || parts.signatures.length === 0) return false

  // Check timestamp tolerance
  const ts = parseInt(parts.timestamp, 10)
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false

  // Compute expected signature
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${parts.timestamp}.${payload}`),
  )
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return parts.signatures.includes(expected)
}

// Map Stripe price metadata to plan tier
function planFromMetadata(metadata: Record<string, string> | undefined): 'starter' | 'pro' | 'scale' | null {
  const plan = metadata?.['plan']
  if (plan === 'starter' || plan === 'pro' || plan === 'scale') return plan
  return null
}

// ---------------------------------------------------------------------------
// Stripe API helper
// ---------------------------------------------------------------------------

async function stripeApi(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: Record<string, string> | null,
  secretKey: string,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, data }
}

// Cancel a Stripe subscription immediately and refund the latest paid charge.
// Used when we detect a critical configuration error (e.g. missing plan metadata)
// after a successful Checkout — the user paid but we cannot deliver, so we
// undo the charge. Best-effort: each step logs CRITICAL on failure but never
// throws (the webhook must always return 200 to stop Stripe from retrying).
async function cancelAndRefund(
  subscriptionId: string,
  sub: Record<string, unknown> | null,
  secretKey: string,
  context: string,
): Promise<void> {
  const cancel = await stripeApi('DELETE', `/subscriptions/${subscriptionId}`, null, secretKey)
  if (!cancel.ok) {
    console.error(`CRITICAL ${context}: failed to cancel subscription`, { subscriptionId, error: cancel.data })
  } else {
    console.error(`CRITICAL ${context}: subscription canceled`, { subscriptionId })
  }

  let invoiceId = (sub?.['latest_invoice'] as string | null | undefined) ?? null
  if (!invoiceId) {
    const fetched = await stripeApi('GET', `/subscriptions/${subscriptionId}`, null, secretKey)
    if (fetched.ok) invoiceId = (fetched.data['latest_invoice'] as string | null) ?? null
  }
  if (!invoiceId) {
    console.error(`CRITICAL ${context}: no invoice on subscription, nothing to refund`, { subscriptionId })
    return
  }

  const inv = await stripeApi('GET', `/invoices/${invoiceId}`, null, secretKey)
  if (!inv.ok) {
    console.error(`CRITICAL ${context}: failed to fetch invoice`, { invoiceId, error: inv.data })
    return
  }
  const chargeId = inv.data['charge'] as string | null
  if (!chargeId) {
    console.error(`CRITICAL ${context}: no charge on invoice (likely $0 trial); skipping refund`, { invoiceId })
    return
  }

  const refund = await stripeApi('POST', '/refunds', { charge: chargeId }, secretKey)
  if (!refund.ok) {
    console.error(`CRITICAL ${context}: refund failed`, { chargeId, error: refund.data })
  } else {
    console.error(`CRITICAL ${context}: refund issued`, { chargeId, refundId: refund.data['id'] })
  }
}

// ---------------------------------------------------------------------------
// Router (no auth middleware — uses Stripe signature verification)
// ---------------------------------------------------------------------------

export const stripeWebhookRouter = new Hono<{ Bindings: Env }>()

stripeWebhookRouter.post('/stripe/webhook', async (c) => {
  const signature = c.req.header('stripe-signature')
  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400)
  }

  const rawBody = await c.req.text()

  const valid = await verifyStripeSignature(rawBody, signature, c.env.STRIPE_WEBHOOK_SECRET)
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const event = JSON.parse(rawBody) as {
    type: string
    data: { object: Record<string, unknown> }
  }

  const db = createDb(c.env.DATABASE_URL)

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const userId = session['client_reference_id'] as string | null
      const customerId = session['customer'] as string | null
      const subscriptionId = session['subscription'] as string | null

      if (!userId || !customerId || !subscriptionId) {
        console.error('checkout.session.completed: missing required fields', { userId, customerId, subscriptionId })
        break
      }

      // Look up tenantId from userId via tenant_members
      const [member] = await db
        .select({ tenantId: tenantMembers.tenantId })
        .from(tenantMembers)
        .where(eq(tenantMembers.userId, userId))
        .limit(1)

      if (!member) {
        console.error('checkout.session.completed: no tenant found for user', userId)
        break
      }

      const tenantId = member.tenantId

      // Guard: never overwrite an internal 'unlimited' tier with a paid plan.
      // Unlimited tenants are not expected to go through Checkout (UI hides Upgrade),
      // but if they somehow do, we abort so their special status is preserved.
      const [existingPlan] = await db
        .select({ plan: tenantPlans.plan })
        .from(tenantPlans)
        .where(eq(tenantPlans.tenantId, tenantId))
        .limit(1)

      if (existingPlan?.plan === 'unlimited') {
        console.error(
          'CRITICAL checkout.session.completed: tenant is on unlimited plan, refusing to overwrite',
          { tenantId, userId, subscriptionId },
        )
        break
      }

      // Retrieve subscription to get plan from price metadata
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}` },
      })
      const sub = (await subRes.json()) as Record<string, unknown>
      const items = sub['items'] as { data: Array<{ price: { metadata: Record<string, string> } }> } | undefined
      const priceMetadata = items?.data?.[0]?.price?.metadata
      const plan = planFromMetadata(priceMetadata)

      // CRITICAL: a Checkout session completed against a Price with no valid
      // `plan` metadata means our Stripe configuration is broken (setup-stripe.ts
      // would have set this; someone edited it in the Dashboard or the wrong
      // Price ID was used). The user has paid but we cannot map them to a tier,
      // so we cancel and refund rather than guessing or silently upgrading.
      if (!plan) {
        console.error(
          'CRITICAL checkout.session.completed: missing or invalid plan metadata on price; cancelling subscription and refunding charge',
          { tenantId, userId, subscriptionId, priceMetadata },
        )
        await cancelAndRefund(subscriptionId, sub, c.env.STRIPE_SECRET_KEY, 'checkout.session.completed')
        break
      }

      const periodStart = sub['current_period_start'] as number | undefined
      const periodEnd = sub['current_period_end'] as number | undefined

      const now = new Date()
      await db
        .insert(tenantPlans)
        .values({
          tenantId,
          plan,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          currentPeriodStart: periodStart ? new Date(periodStart * 1000) : now,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tenantPlans.tenantId,
          set: {
            plan,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            currentPeriodStart: periodStart ? new Date(periodStart * 1000) : now,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : now,
            updatedAt: now,
          },
        })

      console.log(`Tenant ${tenantId} (user ${userId}) subscribed to ${plan} plan`)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object
      const subscriptionId = sub['id'] as string

      // Find tenant by subscription ID
      const [row] = await db
        .select({ tenantId: tenantPlans.tenantId, plan: tenantPlans.plan })
        .from(tenantPlans)
        .where(eq(tenantPlans.stripeSubscriptionId, subscriptionId))
        .limit(1)

      if (!row) {
        console.error('subscription.updated: no tenant found for subscription', subscriptionId)
        break
      }

      // Guard: never demote an internal 'unlimited' tier (defensive — a tenant
      // on this tier should not have a Stripe subscription, but if one is ever
      // attached, refuse to overwrite their special status).
      if (row.plan === 'unlimited') {
        console.error(
          'CRITICAL subscription.updated: tenant on unlimited plan has Stripe subscription; refusing to update',
          { tenantId: row.tenantId, subscriptionId },
        )
        break
      }

      const items = sub['items'] as { data: Array<{ price: { metadata: Record<string, string> } }> } | undefined
      const priceMetadata = items?.data?.[0]?.price?.metadata
      const plan = planFromMetadata(priceMetadata)
      const status = sub['status'] as string
      const periodStart = sub['current_period_start'] as number | undefined
      const periodEnd = sub['current_period_end'] as number | undefined

      // CRITICAL: an active subscription with missing plan metadata means our
      // Stripe configuration drifted (someone edited the Price metadata in the
      // Dashboard). Don't auto-cancel a running subscription mid-period — leave
      // the existing DB row intact and alert via logs for operator action.
      if ((status === 'active' || status === 'trialing') && !plan) {
        console.error(
          'CRITICAL subscription.updated: active subscription with missing plan metadata; not modifying DB (operator must fix Price metadata)',
          { tenantId: row.tenantId, subscriptionId, status, priceMetadata },
        )
        break
      }

      // If subscription is no longer active, downgrade to free.
      const activePlan = (status === 'active' || status === 'trialing') && plan ? plan : 'free'

      await db
        .update(tenantPlans)
        .set({
          plan: activePlan,
          currentPeriodStart: periodStart ? new Date(periodStart * 1000) : undefined,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(tenantPlans.tenantId, row.tenantId))

      console.log(`Tenant ${row.tenantId} plan updated to ${activePlan}`)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object
      const subscriptionId = sub['id'] as string

      const [row] = await db
        .select({ tenantId: tenantPlans.tenantId, plan: tenantPlans.plan })
        .from(tenantPlans)
        .where(eq(tenantPlans.stripeSubscriptionId, subscriptionId))
        .limit(1)

      if (!row) {
        console.error('subscription.deleted: no tenant found for subscription', subscriptionId)
        break
      }

      // Guard: never demote unlimited tenants (see subscription.updated).
      if (row.plan === 'unlimited') {
        console.error(
          'CRITICAL subscription.deleted: tenant on unlimited plan has Stripe subscription; refusing to downgrade to free',
          { tenantId: row.tenantId, subscriptionId },
        )
        break
      }

      await db
        .update(tenantPlans)
        .set({ plan: 'free', updatedAt: new Date() })
        .where(eq(tenantPlans.tenantId, row.tenantId))

      console.log(`Subscription ${subscriptionId} deleted, tenant ${row.tenantId} downgraded to free`)
      break
    }

    default:
      // Ignore unhandled event types
      break
  }

  return c.json({ received: true })
})
