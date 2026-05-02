import { eq, and, gte, sql } from 'drizzle-orm'
import { tenantPlans, outreachLogs, projectProspects } from '../db/schema'
import type { createDb } from '../db/connection'

// ---------------------------------------------------------------------------
// Plan tier definitions
// ---------------------------------------------------------------------------

// 'unlimited' is a special internal-only tier with no Stripe price. It is set
// manually in the DB (`UPDATE tenant_plans SET plan = 'unlimited'`) for staff /
// complimentary accounts. The Stripe webhook must never overwrite this tier.
export type PlanTier = 'free' | 'starter' | 'pro' | 'scale' | 'unlimited'

export type OutreachWindowKind = 'daily' | 'lifetime' | 'monthly'

// Each plan can apply zero or more outreach caps simultaneously. Free uses
// daily + lifetime (whichever runs out first blocks send). Paid plans use
// monthly. null on any field = that cap doesn't apply for the tier.
export interface PlanLimits {
  maxProjects: number | null
  maxOutreachPerDay: number | null
  maxOutreachLifetime: number | null
  maxOutreachPerMonth: number | null
  maxProspects: number | null
}

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free:      { maxProjects: 1,    maxOutreachPerDay: 5,    maxOutreachLifetime: 50,   maxOutreachPerMonth: null,  maxProspects: 500 },
  starter:   { maxProjects: 1,    maxOutreachPerDay: null, maxOutreachLifetime: null, maxOutreachPerMonth: 1500,  maxProspects: null },
  pro:       { maxProjects: 5,    maxOutreachPerDay: null, maxOutreachLifetime: null, maxOutreachPerMonth: 10000, maxProspects: null },
  scale:     { maxProjects: null, maxOutreachPerDay: null, maxOutreachLifetime: null, maxOutreachPerMonth: null,  maxProspects: null },
  unlimited: { maxProjects: null, maxOutreachPerDay: null, maxOutreachLifetime: null, maxOutreachPerMonth: null,  maxProspects: null },
}

export function getPlanLimits(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan]
}

// ---------------------------------------------------------------------------
// Get tenant plan from DB (defaults to free if no record)
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createDb>

export async function getTenantPlan(db: Db, tenantId: string): Promise<{
  plan: PlanTier
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
}> {
  const [row] = await db
    .select({
      plan: tenantPlans.plan,
      currentPeriodStart: tenantPlans.currentPeriodStart,
      currentPeriodEnd: tenantPlans.currentPeriodEnd,
    })
    .from(tenantPlans)
    .where(eq(tenantPlans.tenantId, tenantId))
    .limit(1)

  if (!row) {
    return { plan: 'free', currentPeriodStart: null, currentPeriodEnd: null }
  }

  return {
    plan: row.plan,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
  }
}

// ---------------------------------------------------------------------------
// Count sent outreach in a window
// ---------------------------------------------------------------------------

// `since=null` means lifetime (no lower bound).
async function countSentOutreach(db: Db, tenantId: string, since: Date | null): Promise<number> {
  const conditions = [
    eq(outreachLogs.tenantId, tenantId),
    eq(outreachLogs.status, 'sent'),
  ]
  if (since) conditions.push(gte(outreachLogs.sentAt, since))

  const [result] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(outreachLogs)
    .where(and(...conditions))

  return result?.total ?? 0
}

function startOfTodayUtc(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// ---------------------------------------------------------------------------
// Count total prospects registered by tenant (for free plan lifetime limit)
// ---------------------------------------------------------------------------

export async function countTenantProspects(db: Db, tenantId: string): Promise<number> {
  const [result] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(projectProspects)
    .where(eq(projectProspects.tenantId, tenantId))

  return result?.total ?? 0
}

// ---------------------------------------------------------------------------
// Outreach quota
// ---------------------------------------------------------------------------

export interface OutreachQuotaWindow {
  used: number
  limit: number
  remaining: number
}

export interface OutreachQuota {
  plan: PlanTier
  // Effective binding values (the cap that runs out first). null = no caps apply.
  remaining: number | null
  limit: number | null
  used: number
  bindingConstraint: OutreachWindowKind | null
  // Per-window breakdown so the frontend can show all applicable caps.
  daily?: OutreachQuotaWindow
  lifetime?: OutreachQuotaWindow
  monthly?: OutreachQuotaWindow
}

// Tie-break ordering when two windows have the same `remaining`: pick the
// most "terminal" (lifetime > monthly > daily) so the UX nudges toward the
// right action ("upgrade" beats "wait until tomorrow" when both are zero).
const TIE_BREAK_ORDER: Record<OutreachWindowKind, number> = {
  lifetime: 0,
  monthly: 1,
  daily: 2,
}

export async function getRemainingOutreachQuota(
  db: Db,
  tenantId: string,
): Promise<OutreachQuota> {
  const tp = await getTenantPlan(db, tenantId)
  const limits = getPlanLimits(tp.plan)

  const candidates: { kind: OutreachWindowKind; window: OutreachQuotaWindow }[] = []

  if (limits.maxOutreachPerDay !== null) {
    const used = await countSentOutreach(db, tenantId, startOfTodayUtc())
    candidates.push({
      kind: 'daily',
      window: {
        used,
        limit: limits.maxOutreachPerDay,
        remaining: Math.max(0, limits.maxOutreachPerDay - used),
      },
    })
  }
  if (limits.maxOutreachLifetime !== null) {
    const used = await countSentOutreach(db, tenantId, null)
    candidates.push({
      kind: 'lifetime',
      window: {
        used,
        limit: limits.maxOutreachLifetime,
        remaining: Math.max(0, limits.maxOutreachLifetime - used),
      },
    })
  }
  if (limits.maxOutreachPerMonth !== null && tp.currentPeriodStart) {
    const used = await countSentOutreach(db, tenantId, tp.currentPeriodStart)
    candidates.push({
      kind: 'monthly',
      window: {
        used,
        limit: limits.maxOutreachPerMonth,
        remaining: Math.max(0, limits.maxOutreachPerMonth - used),
      },
    })
  } else if (limits.maxOutreachPerMonth !== null) {
    // Paid plan with no period start yet (shouldn't happen post-checkout, but
    // guard just in case): treat as fresh window.
    candidates.push({
      kind: 'monthly',
      window: { used: 0, limit: limits.maxOutreachPerMonth, remaining: limits.maxOutreachPerMonth },
    })
  }

  if (candidates.length === 0) {
    return { plan: tp.plan, remaining: null, limit: null, used: 0, bindingConstraint: null }
  }

  // Binding cap = smallest `remaining`; ties broken by TIE_BREAK_ORDER.
  candidates.sort((a, b) => {
    if (a.window.remaining !== b.window.remaining) return a.window.remaining - b.window.remaining
    return TIE_BREAK_ORDER[a.kind] - TIE_BREAK_ORDER[b.kind]
  })
  const binding = candidates[0]!

  const result: OutreachQuota = {
    plan: tp.plan,
    remaining: binding.window.remaining,
    limit: binding.window.limit,
    used: binding.window.used,
    bindingConstraint: binding.kind,
  }
  for (const c of candidates) {
    result[c.kind] = c.window
  }
  return result
}

// Human-readable detail message for a 403 outreach-limit response. Picks the
// most actionable phrasing based on the binding constraint.
export function formatOutreachQuotaError(quota: OutreachQuota): string {
  switch (quota.bindingConstraint) {
    case 'daily':
      return `Your ${quota.plan} plan allows ${quota.limit} outreach per day. Try again tomorrow or upgrade for higher limits.`
    case 'lifetime':
      return `Your ${quota.plan} plan lifetime limit (${quota.limit}) is reached. Upgrade to keep sending.`
    case 'monthly':
      return `Your ${quota.plan} plan allows ${quota.limit} outreach this month. Upgrade your plan to continue.`
    default:
      return 'Outreach limit reached.'
  }
}
