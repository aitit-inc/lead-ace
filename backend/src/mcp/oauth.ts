/**
 * MCP OAuth 2.1 Authorization Server for Lead Ace.
 *
 * Implements the OAuth endpoints required by the MCP spec:
 * - /.well-known/oauth-authorization-server  (metadata)
 * - /.well-known/oauth-protected-resource    (resource metadata)
 * - /authorize  (GET: login page, POST: handle login)
 * - /token      (POST: code exchange + refresh)
 * - /register   (POST: dynamic client registration)
 *
 * Delegates actual authentication to Supabase Auth.
 * Uses in-memory storage for auth codes and clients (sufficient for local dev;
 * production would use KV).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// In-memory stores (OK for local dev; use KV for production)
// ---------------------------------------------------------------------------

const authCodes = new Map<string, AuthCode>()
const registeredClients = new Map<string, RegisteredClient>()

function generateId(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function cleanExpiredCodes() {
  const now = Date.now()
  for (const [key, val] of authCodes) {
    if (val.expiresAt < now) authCodes.delete(key)
  }
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

export async function handleRegister(request: Request): Promise<Response> {
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

  registeredClients.set(clientId, client)

  return Response.json({
    ...client,
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, { status: 201 })
}

// ---------------------------------------------------------------------------
// Authorization endpoint
// ---------------------------------------------------------------------------

export function handleAuthorizeGet(request: Request, baseUrl: string): Response {
  const url = new URL(request.url)
  const params = url.searchParams

  const loginParams: LoginParams = {
    state: params.get('state') ?? '',
    codeChallenge: params.get('code_challenge') ?? '',
    redirectUri: params.get('redirect_uri') ?? '',
    clientId: params.get('client_id') ?? '',
  }

  return new Response(loginPageHtml(baseUrl, loginParams), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function handleAuthorizePost(
  request: Request,
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

  const { email, password, state, code_challenge, redirect_uri, client_id } = body

  if (!email || !password || !code_challenge || !redirect_uri) {
    return Response.json({ error: 'invalid_request', error_description: 'Missing required fields' }, { status: 400 })
  }

  // Authenticate with Supabase Auth
  const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ email, password }),
  })

  if (!authRes.ok) {
    const err = await authRes.json().catch(() => ({})) as Record<string, string>
    return Response.json({
      error: 'access_denied',
      error_description: err['error_description'] ?? err['msg'] ?? 'Invalid credentials',
    }, { status: 401 })
  }

  const authData = await authRes.json() as { access_token: string; refresh_token: string }

  // Generate authorization code
  cleanExpiredCodes()
  const code = generateId()
  authCodes.set(code, {
    clientId: client_id ?? '',
    codeChallenge: code_challenge,
    redirectUri: redirect_uri,
    supabaseAccessToken: authData.access_token,
    supabaseRefreshToken: authData.refresh_token,
    expiresAt: Date.now() + 120_000, // 2 minutes
  })

  // Return redirect URL as JSON (login page JS will navigate)
  const redirectUrl = new URL(redirect_uri)
  redirectUrl.searchParams.set('code', code)
  if (state) redirectUrl.searchParams.set('state', state)

  return Response.json({ redirect: redirectUrl.toString() })
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export async function handleToken(
  request: Request,
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
    return handleAuthCodeGrant(body)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshGrant(body, supabaseUrl, supabaseAnonKey)
  }

  return Response.json({ error: 'unsupported_grant_type' }, { status: 400 })
}

async function handleAuthCodeGrant(body: Record<string, string>): Promise<Response> {
  const { code, code_verifier, redirect_uri } = body

  if (!code || !code_verifier) {
    return Response.json({ error: 'invalid_request', error_description: 'code and code_verifier required' }, { status: 400 })
  }

  cleanExpiredCodes()
  const stored = authCodes.get(code)
  if (!stored) {
    return Response.json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, { status: 400 })
  }

  // Verify redirect_uri matches
  if (redirect_uri && redirect_uri !== stored.redirectUri) {
    return Response.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, { status: 400 })
  }

  // PKCE verification
  const pkceValid = await verifyPkce(code_verifier, stored.codeChallenge)
  if (!pkceValid) {
    return Response.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 })
  }

  // Consume the code (one-time use)
  authCodes.delete(code)

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

// ---------------------------------------------------------------------------
// Login page HTML
// ---------------------------------------------------------------------------

interface LoginParams {
  state: string
  codeChallenge: string
  redirectUri: string
  clientId: string
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function loginPageHtml(baseUrl: string, p: LoginParams): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Lead Ace — Sign In</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Inter,-apple-system,system-ui,sans-serif;background:#fff;color:#333;display:flex;align-items:center;justify-content:center;min-height:100vh;-webkit-font-smoothing:antialiased}
    .c{width:100%;max-width:340px;padding:0 20px}
    h1{font-family:"JetBrains Mono",monospace;font-size:20px;font-weight:600;margin-bottom:4px}
    .sub{color:#999;font-size:13px;margin-bottom:28px}
    label{display:block;font-size:11px;font-weight:500;color:#666;margin-bottom:4px}
    input[type=email],input[type=password]{width:100%;padding:8px 12px;font-size:13px;color:#333;background:#fafafa;border:none;border-radius:6px;outline:none;margin-bottom:14px}
    input:focus{box-shadow:0 0 0 2px rgba(208,106,87,.3)}
    .err{color:#D06A57;font-size:12px;margin-bottom:12px;display:none}
    button{width:100%;padding:9px;font-size:13px;font-weight:500;color:#fff;background:#333;border:none;border-radius:6px;cursor:pointer;transition:background .15s}
    button:hover{background:#555}
    button:disabled{opacity:.5;cursor:default}
  </style>
</head>
<body>
<div class="c">
  <h1>Lead Ace</h1>
  <p class="sub">Sign in to authorize Claude Code</p>
  <form id="f">
    <label for="e">Email</label>
    <input id="e" type="email" required placeholder="you@example.com" autofocus/>
    <label for="p">Password</label>
    <input id="p" type="password" required/>
    <p id="err" class="err"></p>
    <button type="submit" id="btn">Sign in</button>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=document.getElementById('btn'),err=document.getElementById('err');
  btn.disabled=true;btn.textContent='Signing in...';err.style.display='none';
  try{
    const r=await fetch('${baseUrl}/authorize',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        email:document.getElementById('e').value,
        password:document.getElementById('p').value,
        state:"${escapeAttr(p.state)}",
        code_challenge:"${escapeAttr(p.codeChallenge)}",
        redirect_uri:"${escapeAttr(p.redirectUri)}",
        client_id:"${escapeAttr(p.clientId)}"
      })
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error_description||d.error||'Login failed');
    if(d.redirect)window.location.href=d.redirect;
  }catch(x){
    err.textContent=x.message;err.style.display='block';
    btn.disabled=false;btn.textContent='Sign in';
  }
});
</script>
</body>
</html>`
}
