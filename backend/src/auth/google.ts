import { sql, eq } from 'drizzle-orm'
import type { Db } from '../db/connection'
import { projectSettings } from '../db/schema'
import { signUnsubscribeToken } from './unsubscribe-token'

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
  extraHeaders?: Record<string, string>
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
  if (args.extraHeaders) {
    for (const [name, value] of Object.entries(args.extraHeaders)) {
      lines.push(`${name}: ${value}`)
    }
  }
  lines.push('MIME-Version: 1.0')
  lines.push('Content-Type: text/plain; charset=UTF-8')
  lines.push('Content-Transfer-Encoding: 8bit')
  lines.push('')
  lines.push(args.body)
  return lines.join('\r\n')
}

export type ProjectSendSettings = {
  senderEmailAlias: string | null
  senderDisplayName: string | null
  unsubscribeEnabled: boolean
}

// Defaults match project_settings DB defaults — used when no row exists.
const DEFAULT_SEND_SETTINGS: ProjectSendSettings = {
  senderEmailAlias: null,
  senderDisplayName: null,
  unsubscribeEnabled: true,
}

export async function loadProjectSendSettings(
  db: Db,
  projectId: string,
): Promise<ProjectSendSettings> {
  const [row] = await db
    .select({
      senderEmailAlias: projectSettings.senderEmailAlias,
      senderDisplayName: projectSettings.senderDisplayName,
      unsubscribeEnabled: projectSettings.unsubscribeEnabled,
    })
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1)
  return row ?? DEFAULT_SEND_SETTINGS
}

// Build the body footer + RFC 8058 List-Unsubscribe headers for a prospect.
// Returns null when unsubscribe is disabled, or when the prospect has no email
// channel (no recipient = no point in adding a footer). Pure CPU — caller
// supplies the already-known prospect email so we don't reissue a SELECT
// during a request that has often loaded the same row already.
export async function buildUnsubscribeAttachments(args: {
  prospectId: number
  tenantId: string
  prospectEmail: string | null
  unsubscribeEnabled: boolean
  appUrl: string
  apiUrl: string
  secret: string
}): Promise<{ footer: string; headers: Record<string, string> } | null> {
  if (!args.unsubscribeEnabled || !args.prospectEmail) return null

  const token = await signUnsubscribeToken(
    { prospectId: args.prospectId, tenantId: args.tenantId },
    args.secret,
  )
  const userUrl = `${args.appUrl}/unsubscribe/${token}`
  const oneClickUrl = `${args.apiUrl}/api/unsubscribe/${token}`

  const footer = `\n\n---\nDon't want these emails? Unsubscribe: ${userUrl}`
  const headers: Record<string, string> = {
    'List-Unsubscribe': `<${oneClickUrl}>, <${userUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
  return { footer, headers }
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

// Discriminated union so callers can map to HTTP status without re-implementing
// the same error mapping in every route handler.
export type GmailSendForUserResult =
  | { ok: true; messageId: string; threadId: string; from: string }
  | { ok: false; httpStatus: 412; error: 'Gmail not connected' | 'Gmail token revoked'; detail: string }
  | { ok: false; httpStatus: 502; error: 'Send failed'; detail: string; from: string }

function formatFromHeader(email: string, displayName: string | null): string {
  if (!displayName) return email
  // RFC 5322 display-name with double quotes; escape inner quotes/backslashes.
  const escaped = displayName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}" <${email}>`
}

export async function sendGmailForUser(
  db: Db,
  args: {
    tenantId: string
    userId: string
    encryptionKey: string
    clientId: string
    clientSecret: string
    to: string[]
    cc?: string[]
    bcc?: string[]
    subject: string
    body: string
    inReplyTo?: string
    extraHeaders?: Record<string, string>
    // Optional Send-As alias to use as From:. Must already be verified by the
    // user in Gmail web UI (we have no scope to verify programmatically — that
    // would require gmail.settings.basic which is Restricted/CASA-gated).
    // Gmail rejects unverified aliases at send time; we surface that error.
    senderEmailAlias?: string | null
    senderDisplayName?: string | null
  },
): Promise<GmailSendForUserResult> {
  const creds = await loadGmailRefreshToken(db, args)
  if (!creds) {
    return {
      ok: false,
      httpStatus: 412,
      error: 'Gmail not connected',
      detail: 'Connect your Google account in Settings to enable email sending.',
    }
  }

  let accessToken: string
  try {
    accessToken = await refreshGoogleAccessToken(creds.refreshToken, args.clientId, args.clientSecret)
  } catch (e) {
    if (e instanceof GoogleAuthError && (e.status === 400 || e.status === 401)) {
      return {
        ok: false,
        httpStatus: 412,
        error: 'Gmail token revoked',
        detail: 'Reconnect your Google account in Settings.',
      }
    }
    throw e
  }

  const sendAsEmail = args.senderEmailAlias?.trim() || creds.email
  const fromHeader = formatFromHeader(sendAsEmail, args.senderDisplayName ?? null)

  const rfc822 = buildRfc822({
    from: fromHeader,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    body: args.body,
    inReplyTo: args.inReplyTo,
    extraHeaders: args.extraHeaders,
  })

  try {
    const result = await sendGmailMessage({ accessToken, rfc822 })
    return { ok: true, messageId: result.id, threadId: result.threadId, from: sendAsEmail }
  } catch (e) {
    return {
      ok: false,
      httpStatus: 502,
      error: 'Send failed',
      detail: e instanceof Error ? e.message : String(e),
      from: sendAsEmail,
    }
  }
}
