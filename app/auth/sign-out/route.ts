import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getRequestOrigin, isSameOriginRequest } from '@/lib/request-security';
import { AUTH_COOKIE_NAME, authCookieOptions } from '@/lib/supabase/config';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'This request must come from the archive.' }, { status: 403 });
  }

  const cookieStore = await cookies();
  const sessionCookies = cookieStore.getAll().filter(({ name }) => name === AUTH_COOKIE_NAME || name.startsWith(`${AUTH_COOKIE_NAME}.`));
  try {
    const supabase = await getSupabaseServerClient();
    if (supabase) await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Always end this browser's session, even when Auth is temporarily unreachable.
  }

  const response = NextResponse.redirect(new URL('/login', getRequestOrigin(request)), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  for (const { name } of sessionCookies) response.cookies.set(name, '', { ...authCookieOptions, name, maxAge: 0 });
  return response;
}
