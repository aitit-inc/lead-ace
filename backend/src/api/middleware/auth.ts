import { createMiddleware } from 'hono/factory'
import { jwtVerify } from 'jose'
import type { Env, Variables } from '../types'

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: Variables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const token = authHeader.slice(7)
    try {
      const secret = new TextEncoder().encode(c.env.SUPABASE_JWT_SECRET)
      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })

      const sub = payload['sub']
      if (typeof sub !== 'string' || !sub) {
        return c.json({ error: 'Invalid token: missing sub' }, 401)
      }

      c.set('userId', sub)
      await next()
    } catch {
      return c.json({ error: 'Invalid token' }, 401)
    }
  },
)
