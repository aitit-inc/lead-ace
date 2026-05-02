import { eq, and, sql } from 'drizzle-orm'
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
// Window helpers
// ---------------------------------------------------------------------------

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
  return getRemainingOutreachQuotaForPlan(db, tenantId, tp)
}

// Variant for callers that already loaded the tenant plan (e.g. /me/plan) so
// we don't re-query tenant_plans on the same request.
export async function getRemainingOutreachQuotaForPlan(
  db: Db,
  tenantId: string,
  tp: { plan: PlanTier; currentPeriodStart: Date | null },
): Promise<OutreachQuota> {
  const limits = getPlanLimits(tp.plan)

  const dailySince = limits.maxOutreachPerDay !== null ? startOfTodayUtc() : null
  const monthlySince = limits.maxOutreachPerMonth !== null && tp.currentPeriodStart
    ? tp.currentPeriodStart
    : null
  const includeLifetime = limits.maxOutreachLifetime !== null

  if (!dailySince && !monthlySince && !includeLifetime) {
    return { plan: tp.plan, remaining: null, limit: null, used: 0, bindingConstraint: null }
  }

  // One pass over outreach_logs with conditional FILTER aggregates — replaces
  // up to 2 sequential scans for free (daily + lifetime). Unused windows are
  // selected as 0::int constants which Postgres folds out.
  // Dates are passed as ISO strings + ::timestamptz cast: postgres.js with
  // prepare:false (required for Supabase pooler) can't serialize Date instances
  // through raw sql`` interpolation — it expects string/Buffer/ArrayBuffer.
  const dailySinceIso = dailySince?.toISOString() ?? null
  const monthlySinceIso = monthlySince?.toISOString() ?? null
  const [row] = await db
    .select({
      dailyUsed: dailySinceIso
        ? sql<number>`COUNT(*) FILTER (WHERE ${outreachLogs.sentAt} >= ${dailySinceIso}::timestamptz)::int`
        : sql<number>`0::int`,
      monthlyUsed: monthlySinceIso
        ? sql<number>`COUNT(*) FILTER (WHERE ${outreachLogs.sentAt} >= ${monthlySinceIso}::timestamptz)::int`
        : sql<number>`0::int`,
      lifetimeUsed: includeLifetime
        ? sql<number>`COUNT(*)::int`
        : sql<number>`0::int`,
    })
    .from(outreachLogs)
    .where(and(eq(outreachLogs.tenantId, tenantId), eq(outreachLogs.status, 'sent')))

  const candidates: { kind: OutreachWindowKind; window: OutreachQuotaWindow }[] = []
  const addWindow = (kind: OutreachWindowKind, limit: number, used: number) => {
    candidates.push({ kind, window: { used, limit, remaining: Math.max(0, limit - used) } })
  }
  if (limits.maxOutreachPerDay !== null) addWindow('daily', limits.maxOutreachPerDay, row?.dailyUsed ?? 0)
  if (includeLifetime) addWindow('lifetime', limits.maxOutreachLifetime!, row?.lifetimeUsed ?? 0)
  if (monthlySince) addWindow('monthly', limits.maxOutreachPerMonth!, row?.monthlyUsed ?? 0)

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

// True when the binding cap has been exhausted. Unlimited plans
// (`remaining === null`) always return false.
export function isOutreachQuotaExhausted(quota: OutreachQuota): boolean {
  return quota.remaining !== null && quota.remaining <= 0
}

// Standard 403 body shape for an exhausted-quota response.
export function outreachQuotaExhaustedBody(quota: OutreachQuota): { error: string; detail: string } {
  return { error: 'Outreach limit reached', detail: formatOutreachQuotaError(quota) }
}

// Human-readable detail message for a 403 outreach-limit response. Picks the
// most actionable phrasing based on the binding constraint.
export function formatOutreachQuotaError(quota: OutreachQuota): string {
  const kind = quota.bindingConstraint
  switch (kind) {
    case 'daily':
      return `Your ${quota.plan} plan allows ${quota.limit} outreach per day. Try again tomorrow or upgrade for higher limits.`
    case 'lifetime':
      return `Your ${quota.plan} plan lifetime limit (${quota.limit}) is reached. Upgrade to keep sending.`
    case 'monthly':
      return `Your ${quota.plan} plan allows ${quota.limit} outreach this month. Upgrade your plan to continue.`
    case null:
      // Unreachable when called via isOutreachQuotaExhausted (null binding ⇔ unlimited).
      // Kept for type exhaustiveness.
      return 'Outreach limit reached.'
  }
}
