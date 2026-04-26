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

const codeKey = (code: string) => `code:${code}`
const sessionKey = (id: string) => `session:${id}`
const clientKey = (id: string) => `client:${id}`

async function getAuthCode(kv: KVNamespace, code: string): Promise<AuthCode | null> {
  return await kv.get<AuthCode>(codeKey(code), 'json')
}

async function putAuthCode(kv: KVNamespace, code: string, data: AuthCode): Promise<void> {
  await kv.put(codeKey(code), JSON.stringify(data), { expirationTtl: AUTH_CODE_TTL_SECONDS })
}

async function deleteAuthCode(kv: KVNamespace, code: string): Promise<void> {
  await kv.delete(codeKey(code))
}

async function getAuthSession(kv: KVNamespace, id: string): Promise<AuthSession | null> {
  return await kv.get<AuthSession>(sessionKey(id), 'json')
}

async function putAuthSession(kv: KVNamespace, id: string, data: AuthSession): Promise<void> {
  await kv.put(sessionKey(id), JSON.stringify(data), { expirationTtl: AUTH_SESSION_TTL_SECONDS })
}

async function deleteAuthSession(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(sessionKey(id))
}

async function getRegisteredClient(kv: KVNamespace, id: string): Promise<RegisteredClient | null> {
  return await kv.get<RegisteredClient>(clientKey(id), 'json')
}

async function putRegisteredClient(kv: KVNamespace, id: string, client: RegisteredClient): Promise<void> {
  await kv.put(clientKey(id), JSON.stringify(client), { expirationTtl: CLIENT_TTL_SECONDS })
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
    return Response.json({ error: 'invalid_request' }, { status: 400 })
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

  await putRegisteredClient(kv, clientId, client)

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
  await putAuthSession(kv, sessionId, {
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
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }
  const session = await getAuthSession(kv, sessionId)
  if (!session || session.expiresAt < Date.now()) {
    return Response.json({ error: 'invalid_session' }, { status: 404 })
  }

  let clientName: string | undefined
  if (session.clientId) {
    const registered = await getRegisteredClient(kv, session.clientId)
    clientName = registered?.client_name
  }

  return Response.json({
    clientId: session.clientId,
    clientName: clientName ?? null,
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
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  const sessionId = body.session
  const accessToken = body.access_token
  const refreshToken = body.refresh_token
  if (!sessionId || !accessToken || !refreshToken) {
    return Response.json(
      { error: 'invalid_request', error_description: 'session, access_token, refresh_token are required' },
      { status: 400 },
    )
  }

  const userId = await verifySupabaseJwt(accessToken, jwtSecret, supabaseUrl)
  if (!userId) {
    return Response.json(
      { error: 'invalid_token', error_description: 'Supabase access_token failed verification' },
      { status: 401 },
    )
  }

  const session = await getAuthSession(kv, sessionId)
  if (!session || session.expiresAt < Date.now()) {
    return Response.json(
      { error: 'invalid_session', error_description: 'Authorization session expired or unknown' },
      { status: 404 },
    )
  }

  const code = generateId()
  await putAuthCode(kv, code, {
    clientId: session.clientId,
    codeChallenge: session.codeChallenge,
    redirectUri: session.redirectUri,
    supabaseAccessToken: accessToken,
    supabaseRefreshToken: refreshToken,
    expiresAt: Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
  })

  await deleteAuthSession(kv, sessionId)

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
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  const grantType = body['grant_type']

  if (grantType === 'authorization_code') {
    return handleAuthCodeGrant(body, kv)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshGrant(body, supabaseUrl, supabaseAnonKey)
  }

  return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
}

async function handleAuthCodeGrant(body: Record<string, string>, kv: KVNamespace): Promise<Response> {
  const { code, code_verifier, redirect_uri } = body

  if (!code || !code_verifier) {
    return Response.json({ error: 'invalid_request', error_description: 'code and code_verifier required' }, { status: 400 })
  }

  const stored = await getAuthCode(kv, code)
  if (!stored || stored.expiresAt < Date.now()) {
    return Response.json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, { status: 400 })
  }

  if (redirect_uri && redirect_uri !== stored.redirectUri) {
    return Response.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, { status: 400 })
  }

  const pkceValid = await verifyPkce(code_verifier, stored.codeChallenge)
  if (!pkceValid) {
    return Response.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 })
  }

  await deleteAuthCode(kv, code)

  return Response.json({
    access_token: stored.supabaseAccessToken,
    refresh_token: stored.supabaseRefreshToken,
    token_type: 'Bearer',
    expires_in: 3600,
  })
}

async function handleRefreshGrant(
  body: Record<string, string>,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<Response> {
  const refreshToken = body['refresh_token']
  if (!refreshToken) {
    return Response.json({ error: 'invalid_request', error_description: 'refresh_token required' }, { status: 400 })
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  if (!res.ok) {
    return Response.json({ error: 'invalid_grant', error_description: 'Refresh failed' }, { status: 400 })
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in?: number }

  return Response.json({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: 'Bearer',
    expires_in: data.expires_in ?? 3600,
  })
}
