import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { callService, forbidden, optional, required, unauthorized, type AuthUser } from '@hireflow/shared';

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const legacySecret = optional('SUPABASE_JWT_SECRET');
const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`), { cooldownDuration: 60_000 });

interface SupabaseClaims extends JWTPayload {
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
}

async function verifyToken(token: string): Promise<SupabaseClaims> {
  try {
    const { alg } = decodeProtectedHeader(token);
    if (alg === 'HS256') {
      if (!legacySecret) throw new Error('HS256 token but SUPABASE_JWT_SECRET is not configured');
      const { payload } = await jwtVerify<SupabaseClaims>(token, new TextEncoder().encode(legacySecret), { audience: 'authenticated' });
      return payload;
    }
    const { payload } = await jwtVerify<SupabaseClaims>(token, jwks, { audience: 'authenticated', issuer: `${supabaseUrl}/auth/v1` });
    return payload;
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

// Small TTL cache: authUserId -> resolved HireFlow user (role, active flag)
const TTL_MS = 60_000;
const cache = new Map<string, { user: AuthUser; expires: number }>();

export function invalidateUserCache(): void {
  cache.clear();
}

/** Verifies the Supabase access token and resolves the HireFlow user + role via identity-service. */
export async function authenticate(authorization: string | undefined): Promise<AuthUser> {
  if (!authorization?.startsWith('Bearer ')) throw unauthorized();
  const claims = await verifyToken(authorization.slice(7));
  const authUserId = claims.sub;
  if (!authUserId || !claims.email) throw unauthorized('Invalid token');

  const hit = cache.get(authUserId);
  if (hit && hit.expires > Date.now()) return hit.user;

  const resolved = await callService<AuthUser & { isActive: boolean }>('identity', '/internal/auth/resolve', {
    method: 'POST',
    body: { authUserId, email: claims.email, name: claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? '' },
  });
  if (!resolved.isActive) throw forbidden('Your account has been deactivated. Contact your administrator.');

  const user: AuthUser = { id: resolved.id, email: resolved.email, role: resolved.role, name: resolved.name };
  if (cache.size > 5000) cache.clear();
  cache.set(authUserId, { user, expires: Date.now() + TTL_MS });
  return user;
}
