import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import {
  GMAIL_SEND_SCOPE,
  GoogleAuthError,
  buildRfc822,
  loadGmailRefreshToken,
  refreshGoogleAccessToken,
  saveGmailRefreshToken,
  sendGmailMessage,
} from '../../auth/google'
import type { Env, Variables } from '../types'

const saveCredentialsSchema = z.object({
  refreshToken: z.string().min(1),
  scope: z.string().min(1),
  email: z.string().email(),
})

export const authRouter = new Hono<{ Bindings: Env; Variables: Variables }>()

// POST /auth/google-credentials
// Frontend calls this immediately after Google OAuth sign-in to persist the
// provider_refresh_token. The Worker uses it later (server-side) to mint
// short-lived access tokens for Gmail API calls.
authRouter.post(
  '/auth/google-credentials',
  zValidator('json', saveCredentialsSchema),
  async (c) => {
    const input = c.req.valid('json')
    const tenantId = c.get('tenantId')
    const userId = c.get('userId')
    const db = c.get('db')

    const grantedScopes = input.scope.split(/\s+/)
    if (!grantedScopes.includes(GMAIL_SEND_SCOPE)) {
      return c.json(
        {
          error: 'Missing required scope',
          detail: `gmail.send scope must be granted. Received: ${input.scope}`,
        },
        400,
      )
    }

    await saveGmailRefreshToken(db, {
      tenantId,
      userId,
      refreshToken: input.refreshToken,
      scope: input.scope,
      email: input.email,
      encryptionKey: c.env.GMAIL_TOKEN_ENCRYPTION_KEY,
    })

    return c.json({ ok: true })
  },
)

// GET /auth/google-credentials/status — UI uses this to decide whether to show
// "Connect Gmail" vs "Connected as <email>"
authRouter.get('/auth/google-credentials/status', async (c) => {
  const tenantId = c.get('tenantId')
  const userId = c.get('userId')
  const db = c.get('db')

  const rows = await db.execute<{ email: string; granted_at: Date; updated_at: Date }>(sql`
    SELECT email, granted_at, updated_at
    FROM gmail_credentials
    WHERE tenant_id = ${tenantId} AND user_id = ${userId}
    LIMIT 1
  `)
  const row = rows[0]
  if (!row) {
    return c.json({ connected: false })
  }
  return c.json({
    connected: true,
    email: row.email,
    grantedAt: row.granted_at,
    updatedAt: row.updated_at,
  })
})

const sendEmailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  inReplyTo: z.string().optional(),
})

// POST /auth/send-email — send via Gmail API without recording an outreach log.
// Used for internal notifications (daily-cycle start/wrap-up emails) that are
// not prospect outreach. For prospect emails, use /outreach/send-and-record.
authRouter.post('/auth/send-email', zValidator('json', sendEmailSchema), async (c) => {
  const input = c.req.valid('json')
  const tenantId = c.get('tenantId')
  const userId = c.get('userId')
  const db = c.get('db')

  const creds = await loadGmailRefreshToken(db, {
    tenantId,
    userId,
    encryptionKey: c.env.GMAIL_TOKEN_ENCRYPTION_KEY,
  })
  if (!creds) {
    return c.json(
      {
        error: 'Gmail not connected',
        detail: 'Connect your Google account in Settings to enable email sending.',
      },
      412,
    )
  }

  let accessToken: string
  try {
    accessToken = await refreshGoogleAccessToken(
      creds.refreshToken,
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
    )
  } catch (e) {
    if (e instanceof GoogleAuthError && (e.status === 400 || e.status === 401)) {
      return c.json(
        {
          error: 'Gmail token revoked',
          detail: 'Reconnect your Google account in Settings.',
        },
        412,
      )
    }
    throw e
  }

  const rfc822 = buildRfc822({
    from: creds.email,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    inReplyTo: input.inReplyTo,
  })

  const result = await sendGmailMessage({ accessToken, rfc822 })
  return c.json({ messageId: result.id, threadId: result.threadId }, 200)
})
