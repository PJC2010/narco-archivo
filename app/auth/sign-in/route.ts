import { NextResponse } from 'next/server';
import { isOwnerUser } from '@/lib/auth';
import { getRequestOrigin, isSameOriginRequest } from '@/lib/request-security';
import { isOwnerAuthConfigured } from '@/lib/supabase/config';
import { getSupabaseServerClient } from '@/lib/supabase/server';

function goTo(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, getRequestOrigin(request)), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: 'This request must come from the archive.' }, { status: 403 });
  }
  if (!isOwnerAuthConfigured()) return goTo(request, '/login?error=unavailable');
  if (Number(request.headers.get('content-length')) > 8192) return goTo(request, '/login?error=credentials');

  try {
    const form = await request.formData();
    const email = form.get('email');
    const password = form.get('password');
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || email.length > 320 || password.length > 1024) {
      return goTo(request, '/login?error=credentials');
    }

    const supabase = await getSupabaseServerClient();
    if (!supabase) return goTo(request, '/login?error=unavailable');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return goTo(request, '/login?error=credentials');

    const { data, error: verificationError } = await supabase.auth.getUser();
    if (verificationError || !isOwnerUser(data.user)) {
      await supabase.auth.signOut({ scope: 'local' });
      return goTo(request, '/login?error=credentials');
    }
    return goTo(request, '/manage');
  } catch {
    return goTo(request, '/login?error=unavailable');
  }
}
