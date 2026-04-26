import { sql } from 'drizzle-orm'
import type { Db } from '../db/connection'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

export class GoogleAuthError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GoogleAuthError'
    this.status = status
  }
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new GoogleAuthError(`Google token refresh failed (${res.status}): ${detail}`, res.status)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

export async function sendGmailMessage(args: {
  accessToken: string
  rfc822: string
}): Promise<{ id: string; threadId: string }> {
  const raw = base64UrlEncode(args.rfc822)
  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Gmail send failed (${res.status}): ${detail}`)
  }
  return (await res.json()) as { id: string; threadId: string }
}

export function buildRfc822(args: {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body: string
  inReplyTo?: string
}): string {
  const lines: string[] = []
  lines.push(`From: ${args.from}`)
  lines.push(`To: ${args.to.join(', ')}`)
  if (args.cc && args.cc.length > 0) lines.push(`Cc: ${args.cc.join(', ')}`)
  if (args.bcc && args.bcc.length > 0) lines.push(`Bcc: ${args.bcc.join(', ')}`)
  lines.push(`Subject: ${encodeMimeHeader(args.subject)}`)
  if (args.inReplyTo) {
    lines.push(`In-Reply-To: ${args.inReplyTo}`)
    lines.push(`References: ${args.inReplyTo}`)
  }
  lines.push('MIME-Version: 1.0')
  lines.push('Content-Type: text/plain; charset=UTF-8')
  lines.push('Content-Transfer-Encoding: 8bit')
  lines.push('')
  lines.push(args.body)
  return lines.join('\r\n')
}

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeMimeHeader(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `=?UTF-8?B?${btoa(binary)}?=`
}

export async function saveGmailRefreshToken(
  db: Db,
  args: {
    tenantId: string
    userId: string
    refreshToken: string
    scope: string
    email: string
    encryptionKey: string
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO gmail_credentials (tenant_id, user_id, refresh_token, scope, email, granted_at, updated_at)
    VALUES (
      ${args.tenantId},
      ${args.userId},
      pgp_sym_encrypt(${args.refreshToken}::text, ${args.encryptionKey}),
      ${args.scope},
      ${args.email},
      now(),
      now()
    )
    ON CONFLICT (tenant_id, user_id) DO UPDATE SET
      refresh_token = pgp_sym_encrypt(${args.refreshToken}::text, ${args.encryptionKey}),
      scope = ${args.scope},
      email = ${args.email},
      updated_at = now()
  `)
}

export async function loadGmailRefreshToken(
  db: Db,
  args: {
    tenantId: string
    userId: string
    encryptionKey: string
  },
): Promise<{ refreshToken: string; email: string } | null> {
  const rows = await db.execute<{ refresh_token: string; email: string }>(sql`
    SELECT
      pgp_sym_decrypt(refresh_token, ${args.encryptionKey})::text AS refresh_token,
      email
    FROM gmail_credentials
    WHERE tenant_id = ${args.tenantId}
      AND user_id = ${args.userId}
    LIMIT 1
  `)
  const row = rows[0]
  if (!row) return null
  return { refreshToken: row.refresh_token, email: row.email }
}
