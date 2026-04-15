import { jwtVerify, createRemoteJWKSet } from 'jose'

/**
 * Verify a Supabase JWT token.
 *
 * Tries ES256 via JWKS first (new Supabase CLI), falls back to HS256 (legacy).
 * Returns the `sub` claim (user ID) or null if verification fails.
 */
export async function verifySupabaseJwt(
  token: string,
  jwtSecret: string,
  supabaseUrl?: string,
): Promise<string | null> {
  // Try ES256 via JWKS (new Supabase CLI uses EC keys)
  if (supabaseUrl) {
    try {
      const jwksUrl = new URL('/auth/v1/.well-known/jwks.json', supabaseUrl)
      const JWKS = createRemoteJWKSet(jwksUrl)
      const { payload } = await jwtVerify(token, JWKS)
      const sub = payload['sub']
      return typeof sub === 'string' ? sub : null
    } catch {
      // Fall through to HS256
    }
  }

  // Fallback: HS256 with shared secret
  try {
    const secret = new TextEncoder().encode(jwtSecret)
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    const sub = payload['sub']
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}
