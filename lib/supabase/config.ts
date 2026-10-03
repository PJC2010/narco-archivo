import 'server-only';

export const AUTH_COOKIE_NAME = 'narcohistoria-auth';

export const authCookieOptions = {
  name: AUTH_COOKIE_NAME,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

function supabaseUrl(): string | null {
  const value = process.env.SUPABASE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getSupabasePublicConfig() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function getSupabaseAdminConfig() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function ownerEmail(): string | null {
  return process.env.OWNER_EMAIL?.trim().toLowerCase() || null;
}

export function isOwnerAuthConfigured(): boolean {
  return Boolean(getSupabasePublicConfig() && ownerEmail());
}

// Never cache requests containing sessions, private drafts, or access checks.
export const uncachedFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });
