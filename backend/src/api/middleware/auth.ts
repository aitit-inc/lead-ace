import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import { verifySupabaseJwt } from '../../auth/verify-jwt'
import { createDb } from '../../db/connection'
import { tenantMembers, tenantPlans, tenants } from '../../db/schema'
import type { Env, Variables } from '../types'

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.slice(7)
    const userId = await verifySupabaseJwt(token, c.env.SUPABASE_JWT_SECRET, c.env.SUPABASE_URL)

    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401)
    }

    c.set('userId', userId)

    // Runs as postgres superuser — bypasses RLS (intentional for tenant resolution)
    const db = createDb(c.env.DATABASE_URL)
    const [membership] = await db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, userId))
      .limit(1)

    if (membership) {
      c.set('tenantId', membership.tenantId)
    } else {
      // Auto-provision tenant for new users
      const tenantId = generateId()
      const now = new Date()
      await db.insert(tenants).values({ id: tenantId, name: 'My Workspace', createdAt: now })
      await db.insert(tenantMembers).values({ tenantId, userId, role: 'owner', createdAt: now })
      await db.insert(tenantPlans).values({ tenantId, plan: 'free', createdAt: now, updatedAt: now })
      c.set('tenantId', tenantId)
    }

    // Store raw db for downstream middleware (rlsMiddleware wraps it in a transaction)
    c.set('db', db)

    await next()
  },
)

// Simple nanoid-like ID generator (no dependency needed)
function generateId(length = 21): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}
