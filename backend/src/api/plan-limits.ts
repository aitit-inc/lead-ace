import { eq, and, sql } from 'drizzle-orm'
import { tenantPlans, outreachLogs, projectProspects } from '../db/schema'
import type { createDb } from '../db/connection'

// ---------------------------------------------------------------------------
// Plan tier definitions
// ---------------------------------------------------------------------------

type PlanTier = 'free' | 'starter' | 'pro' | 'scale'

interface PlanLimits {
  maxProjects: number | null // null = unlimited
  maxOutreachPerMonth: number | null // null = unlimited
  maxProspects: number | null // null = unlimited (only free has lifetime limit)
  isLifetime: boolean // true = limits are lifetime, false = monthly reset
}

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { maxProjects: 1, maxOutreachPerMonth: 10, maxProspects: 30, isLifetime: true },
  starter: { maxProjects: 1, maxOutreachPerMonth: 1500, maxProspects: null, isLifetime: false },
  pro: { maxProjects: 5, maxOutreachPerMonth: 10000, maxProspects: null, isLifetime: false },
  scale: { maxProjects: null, maxOutreachPerMonth: null, maxProspects: null, isLifetime: false },
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
// Count sent outreach for quota check
// ---------------------------------------------------------------------------

export async function countSentOutreach(
  db: Db,
  tenantId: string,
  plan: PlanTier,
  currentPeriodStart: Date | null,
): Promise<number> {
  // Free plan: lifetime count (all sent ever)
  // Paid plans: current billing period count
  const conditions = [
    eq(outreachLogs.tenantId, tenantId),
    eq(outreachLogs.status, 'sent'),
  ]

  if (plan !== 'free' && currentPeriodStart) {
    conditions.push(sql`${outreachLogs.sentAt} >= ${currentPeriodStart}`)
  }

  const [result] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(outreachLogs)
    .where(and(...conditions))

  return result?.total ?? 0
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
// Compute remaining outreach quota
// ---------------------------------------------------------------------------

export async function getRemainingOutreachQuota(
  db: Db,
  tenantId: string,
): Promise<{ remaining: number | null; limit: number | null; used: number; plan: PlanTier }> {
  const tp = await getTenantPlan(db, tenantId)
  const limits = getPlanLimits(tp.plan)

  if (limits.maxOutreachPerMonth === null) {
    return { remaining: null, limit: null, used: 0, plan: tp.plan }
  }

  const used = await countSentOutreach(db, tenantId, tp.plan, tp.currentPeriodStart)
  const remaining = Math.max(0, limits.maxOutreachPerMonth - used)

  return {
    remaining,
    limit: limits.maxOutreachPerMonth,
    used,
    plan: tp.plan,
  }
}
