import { createMiddleware } from 'hono/factory'
import { verifySupabaseJwt } from '../../auth/verify-jwt'
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
    await next()
  },
)
