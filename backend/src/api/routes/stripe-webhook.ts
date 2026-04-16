import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createDb } from '../../db/connection'
import { userPlans } from '../../db/schema'
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

      // Retrieve subscription to get plan from price metadata
      const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}` },
      })
      const sub = (await subRes.json()) as Record<string, unknown>
      const items = sub['items'] as { data: Array<{ price: { metadata: Record<string, string> } }> } | undefined
      const priceMetadata = items?.data?.[0]?.price?.metadata
      const plan = planFromMetadata(priceMetadata) ?? 'starter'

      const periodStart = sub['current_period_start'] as number | undefined
      const periodEnd = sub['current_period_end'] as number | undefined

      const now = new Date()
      await db
        .insert(userPlans)
        .values({
          userId,
          plan,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          currentPeriodStart: periodStart ? new Date(periodStart * 1000) : now,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userPlans.userId,
          set: {
            plan,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            currentPeriodStart: periodStart ? new Date(periodStart * 1000) : now,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : now,
            updatedAt: now,
          },
        })

      console.log(`User ${userId} subscribed to ${plan} plan`)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object
      const subscriptionId = sub['id'] as string

      // Find user by subscription ID
      const [row] = await db
        .select({ userId: userPlans.userId })
        .from(userPlans)
        .where(eq(userPlans.stripeSubscriptionId, subscriptionId))
        .limit(1)

      if (!row) {
        console.error('subscription.updated: no user found for subscription', subscriptionId)
        break
      }

      const items = sub['items'] as { data: Array<{ price: { metadata: Record<string, string> } }> } | undefined
      const priceMetadata = items?.data?.[0]?.price?.metadata
      const plan = planFromMetadata(priceMetadata)
      const status = sub['status'] as string
      const periodStart = sub['current_period_start'] as number | undefined
      const periodEnd = sub['current_period_end'] as number | undefined

      // If subscription is no longer active, downgrade to free
      const activePlan = (status === 'active' || status === 'trialing') && plan ? plan : 'free'

      await db
        .update(userPlans)
        .set({
          plan: activePlan,
          currentPeriodStart: periodStart ? new Date(periodStart * 1000) : undefined,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(userPlans.userId, row.userId))

      console.log(`User ${row.userId} plan updated to ${activePlan}`)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object
      const subscriptionId = sub['id'] as string

      await db
        .update(userPlans)
        .set({ plan: 'free', updatedAt: new Date() })
        .where(eq(userPlans.stripeSubscriptionId, subscriptionId))

      console.log(`Subscription ${subscriptionId} deleted, downgraded to free`)
      break
    }

    default:
      // Ignore unhandled event types
      break
  }

  return c.json({ received: true })
})
