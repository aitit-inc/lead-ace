/**
 * MCP OAuth 2.1 Authorization Server for LeadAce.
 *
 * Endpoints:
 * - /.well-known/oauth-authorization-server  (metadata)
 * - /.well-known/oauth-protected-resource    (resource metadata)
 * - /authorize           GET → redirect to the frontend consent page
 * - /authorize/session   GET → consent page reads OAuth params here
 * - /authorize/finalize  POST → frontend completes the flow with a verified
 *                                Supabase session, gets back a redirect URL
 * - /token               POST (authorization_code | refresh_token)
 * - /register            POST (RFC 7591 dynamic client registration)
 *
 * The user authenticates via Google on app.leadace.ai (Supabase). The
 * frontend then posts the resulting Supabase tokens to /authorize/finalize,
 * we re-issue them through the OAuth code flow so MCP clients can use a
 * Bearer token. State lives in Cloudflare KV; native TTL handles expiry.
 */

import { verifySupabaseJwt } from '../auth/verify-jwt'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthSession {
  clientId: string
  codeChallenge: string
  redirectUri: string
  state: string
  expiresAt: number
}

interface AuthCode {
  clientId: string
  codeChallenge: string
  redirectUri: string
  supabaseAccessToken: string
  supabaseRefreshToken: string
  expiresAt: number
}

interface RegisteredClient {
  client_id: string
  redirect_uris: string[]
  client_name?: string
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
}

// ---------------------------------------------------------------------------
// KV storage helpers
// ---------------------------------------------------------------------------

const AUTH_CODE_TTL_SECONDS = 600        // 10 minutes (KV minimum is 60)
const AUTH_SESSION_TTL_SECONDS = 600     // 10 minutes
const CLIENT_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

function kvJson<T>(prefix: string, ttlSeconds: number) {
  const k = (id: string) => `${prefix}:${id}`
  return {
    get: (kv: KVNamespace, id: string) => kv.get<T>(k(id), 'json'),
    put: (kv: KVNamespace, id: string, value: T) =>
      kv.put(k(id), JSON.stringify(value), { expirationTtl: ttlSeconds }),
    del: (kv: KVNamespace, id: string) => kv.delete(k(id)),
  }
}

const authCodes = kvJson<AuthCode>('code', AUTH_CODE_TTL_SECONDS)
const authSessions = kvJson<AuthSession>('session', AUTH_SESSION_TTL_SECONDS)
const registeredClients = kvJson<RegisteredClient>('client', CLIENT_TTL_SECONDS)

function oauthError(code: string, status: number, description?: string): Response {
  return Response.json(
    description ? { error: code, error_description: description } : { error: code },
    { status },
  )
}

function generateId(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

async function verifyPkce(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const data = new TextEncoder().encode(codeVerifier)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const computed = base64UrlEncode(new Uint8Array(hashBuffer))
  return computed === codeChallenge
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = ''
  for (const byte of buffer) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------------------------------------------------------------------------
// OAuth metadata
// ---------------------------------------------------------------------------

export function handleMetadata(baseUrl: string): Response {
  return Response.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['read', 'write'],
  })
}

export function handleResourceMetadata(baseUrl: string): Response {
  return Response.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: ['read', 'write'],
  })
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

export async function handleRegister(request: Request, kv: KVNamespace): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return oauthError('invalid_request', 400)
  }

  const clientId = generateId()
  const client: RegisteredClient = {
    client_id: clientId,
    redirect_uris: (body['redirect_uris'] as string[]) ?? [],
    client_name: (body['client_name'] as string) ?? undefined,
    grant_types: (body['grant_types'] as string[]) ?? ['authorization_code', 'refresh_token'],
    response_types: (body['response_types'] as string[]) ?? ['code'],
    token_endpoint_auth_method: (body['token_endpoint_auth_method'] as string) ?? 'none',
  }

  await registeredClients.put(kv, clientId, client)

  return Response.json({
    ...client,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, { status: 201 })
}

// ---------------------------------------------------------------------------
// /authorize GET → redirect to the frontend consent page
// ---------------------------------------------------------------------------

function htmlError(message: string, status: number): Response {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>LeadAce — Authorization error</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F4F2F0;color:#333}p{max-width:420px;padding:24px;font-size:14px;line-height:1.5}</style>
</head><body><p>${safe}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function handleAuthorizeGet(
  request: Request,
  kv: KVNamespace,
  frontendUrl: string,
): Promise<Response> {
  const params = new URL(request.url).searchParams

  const codeChallenge = params.get('code_challenge')
  const redirectUri = params.get('redirect_uri')
  const codeChallengeMethod = params.get('code_challenge_method')

  if (!codeChallenge || !redirectUri) {
    return htmlError('Missing code_challenge or redirect_uri. Run /setup again.', 400)
  }
  if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return htmlError('Only S256 code_challenge_method is supported.', 400)
  }

  const sessionId = generateId()
  await authSessions.put(kv, sessionId, {
    clientId: params.get('client_id') ?? '',
    codeChallenge,
    redirectUri,
    state: params.get('state') ?? '',
    expiresAt: Date.now() + AUTH_SESSION_TTL_SECONDS * 1000,
  })

  const consentUrl = new URL('/mcp-authorize', frontendUrl)
  consentUrl.searchParams.set('session', sessionId)
  return Response.redirect(consentUrl.toString(), 302)
}

// ---------------------------------------------------------------------------
// /authorize/session GET → consent page reads display info
// ---------------------------------------------------------------------------

export async function handleAuthorizeSessionInfo(
  request: Request,
  kv: KVNamespace,
): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get('session')
  if (!sessionId) {
    return oauthError('invalid_request', 400)
  }
  const session = await authSessions.get(kv, sessionId)
  if (!session || session.expiresAt < Date.now()) {
    return oauthError('invalid_session', 404)
  }

  const registered = session.clientId ? await registeredClients.get(kv, session.clientId) : null

  return Response.json({
    clientId: session.clientId,
    clientName: registered?.client_name ?? null,
    redirectUri: session.redirectUri,
    state: session.state,
  })
}

// ---------------------------------------------------------------------------
// /authorize/finalize POST → frontend completes the flow
// ---------------------------------------------------------------------------

export async function handleAuthorizeFinalize(
  request: Request,
  kv: KVNamespace,
  jwtSecret: string,
  supabaseUrl: string,
): Promise<Response> {
  let body: { session?: string; access_token?: string; refresh_token?: string }
  try {
    body = await request.json() as { session?: string; access_token?: string; refresh_token?: string }
  } catch {
    return oauthError('invalid_request', 400)
  }

  const { session: sessionId, access_token: accessToken, refresh_token: refreshToken } = body
  if (!sessionId || !accessToken || !refreshToken) {
    return oauthError('invalid_request', 400, 'session, access_token, refresh_token are required')
  }

  const [userId, session] = await Promise.all([
    verifySupabaseJwt(accessToken, jwtSecret, supabaseUrl),
    authSessions.get(kv, sessionId),
  ])
  if (!userId) {
    return oauthError('invalid_token', 401, 'Supabase access_token failed verification')
  }
  if (!session || session.expiresAt < Date.now()) {
    return oauthError('invalid_session', 404, 'Authorization session expired or unknown')
  }

  const code = generateId()
  await authCodes.put(kv, code, {
    clientId: session.clientId,
    codeChallenge: session.codeChallenge,
    redirectUri: session.redirectUri,
    supabaseAccessToken: accessToken,
    supabaseRefreshToken: refreshToken,
    expiresAt: Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
  })

  await authSessions.del(kv, sessionId)

  const redirectUrl = new URL(session.redirectUri)
  redirectUrl.searchParams.set('code', code)
  if (session.state) redirectUrl.searchParams.set('state', session.state)

  return Response.json({ redirect: redirectUrl.toString() })
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export async function handleToken(
  request: Request,
  kv: KVNamespace,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<Response> {
  let body: Record<string, string>
  try {
    const ct = request.headers.get('Content-Type') ?? ''
    if (ct.includes('application/json')) {
      body = await request.json() as Record<string, string>
    } else {
      const fd = await request.formData()
      body = Object.fromEntries(fd.entries()) as Record<string, string>
    }
  } catch {
    return oauthError('invalid_request', 400)
  }

  const grantType = body['grant_type']

  if (grantType === 'authorization_code') {
    return handleAuthCodeGrant(body, kv)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshGrant(body, supabaseUrl, supabaseAnonKey)
  }

  return oauthError('unsupported_grant_type', 400)
}

async function handleAuthCodeGrant(body: Record<string, string>, kv: KVNamespace): Promise<Response> {
  const { code, code_verifier, redirect_uri } = body

  if (!code || !code_verifier) {
    return oauthError('invalid_request', 400, 'code and code_verifier required')
  }

  const stored = await authCodes.get(kv, code)
  if (!stored || stored.expiresAt < Date.now()) {
    console.log('[oauth.code] invalid/expired code', { hasStored: !!stored, expired: stored ? stored.expiresAt < Date.now() : null })
    return oauthError('invalid_grant', 400, 'Invalid or expired authorization code')
  }

  if (redirect_uri && redirect_uri !== stored.redirectUri) {
    return oauthError('invalid_grant', 400, 'redirect_uri mismatch')
  }

  const pkceValid = await verifyPkce(code_verifier, stored.codeChallenge)
  if (!pkceValid) {
    return oauthError('invalid_grant', 400, 'PKCE verification failed')
  }

  await authCodes.del(kv, code)

  const accessFp = await fingerprint(stored.supabaseAccessToken)
  const refreshFp = await fingerprint(stored.supabaseRefreshToken)
  console.log('[oauth.code] exchanged', { accessFp, refreshFp, clientId: stored.clientId })

  return Response.json({
    access_token: stored.supabaseAccessToken,
    refresh_token: stored.supabaseRefreshToken,
    token_type: 'Bearer',
    expires_in: 3600,
  })
}

// Hash a token for log correlation without leaking the secret value.
async function fingerprint(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(buf).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function handleRefreshGrant(
  body: Record<string, string>,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<Response> {
  const refreshToken = body['refresh_token']
  if (!refreshToken) {
    console.log('[oauth.refresh] missing refresh_token in body')
    return oauthError('invalid_request', 400, 'refresh_token required')
  }

  const inFp = await fingerprint(refreshToken)
  const t0 = Date.now()

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  const elapsed = Date.now() - t0

  if (!res.ok) {
    let supabaseErr: unknown = null
    try {
      supabaseErr = await res.json()
    } catch {
      supabaseErr = await res.text().catch(() => '<no body>')
    }
    console.log('[oauth.refresh] supabase rejected', {
      inFp,
      status: res.status,
      elapsed,
      supabaseErr,
    })
    return oauthError('invalid_grant', 400, 'Refresh failed')
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in?: number }
  const outFp = await fingerprint(data.refresh_token)
  const accessFp = await fingerprint(data.access_token)
  console.log('[oauth.refresh] ok', {
    inFp,
    outFp,
    accessFp,
    rotated: outFp !== inFp,
    expires_in: data.expires_in ?? 3600,
    elapsed,
  })

  return Response.json({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: 'Bearer',
    expires_in: data.expires_in ?? 3600,
  })
}
