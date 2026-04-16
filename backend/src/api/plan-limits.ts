import { eq, and, sql, count } from 'drizzle-orm'
import { userPlans, outreachLogs, projectProspects } from '../db/schema'
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
// Get user plan from DB (defaults to free if no record)
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createDb>

export async function getUserPlan(db: Db, userId: string): Promise<{
  plan: PlanTier
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
}> {
  const [row] = await db
    .select({
      plan: userPlans.plan,
      currentPeriodStart: userPlans.currentPeriodStart,
      currentPeriodEnd: userPlans.currentPeriodEnd,
    })
    .from(userPlans)
    .where(eq(userPlans.userId, userId))
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
  userId: string,
  plan: PlanTier,
  currentPeriodStart: Date | null,
): Promise<number> {
  // Free plan: lifetime count (all sent ever, across all user's projects)
  // Paid plans: current billing period count
  const periodFilter = plan === 'free' || !currentPeriodStart
    ? sql`1=1` // no time filter for free (lifetime)
    : sql`${outreachLogs.sentAt} >= ${currentPeriodStart}`

  const [result] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(outreachLogs)
    .innerJoin(
      // Join through projects to filter by userId
      sql`projects ON projects.id = ${outreachLogs.projectId}`,
      sql`projects.user_id = ${userId}`,
    )
    .where(and(eq(outreachLogs.status, 'sent'), periodFilter))

  return result?.total ?? 0
}

// ---------------------------------------------------------------------------
// Count total prospects registered by user (for free plan lifetime limit)
// ---------------------------------------------------------------------------

export async function countUserProspects(db: Db, userId: string): Promise<number> {
  const [result] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(projectProspects)
    .innerJoin(
      sql`projects ON projects.id = ${projectProspects.projectId}`,
      sql`projects.user_id = ${userId}`,
    )

  return result?.total ?? 0
}

// ---------------------------------------------------------------------------
// Compute remaining outreach quota
// ---------------------------------------------------------------------------

export async function getRemainingOutreachQuota(
  db: Db,
  userId: string,
): Promise<{ remaining: number | null; limit: number | null; used: number; plan: PlanTier }> {
  const userPlan = await getUserPlan(db, userId)
  const limits = getPlanLimits(userPlan.plan)

  if (limits.maxOutreachPerMonth === null) {
    return { remaining: null, limit: null, used: 0, plan: userPlan.plan }
  }

  const used = await countSentOutreach(db, userId, userPlan.plan, userPlan.currentPeriodStart)
  const remaining = Math.max(0, limits.maxOutreachPerMonth - used)

  return {
    remaining,
    limit: limits.maxOutreachPerMonth,
    used,
    plan: userPlan.plan,
  }
}
