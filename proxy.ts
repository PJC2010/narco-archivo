import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authCookieOptions, getSupabasePublicConfig, uncachedFetch } from '@/lib/supabase/config';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set('Cache-Control', 'private, no-store');
  const config = getSupabasePublicConfig();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: authCookieOptions,
    global: { fetch: uncachedFetch },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Refresh the downstream request and browser together to avoid stale sessions.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        response.headers.set('Cache-Control', 'private, no-store');
        for (const cookie of previousCookies) response.cookies.set(cookie);
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // Protected pages and handlers independently verify the user and fail closed.
  }
  return response;
}

export const config = {
  matcher: ['/manage/:path*', '/login', '/api/:path*', '/auth/sign-out'],
};
