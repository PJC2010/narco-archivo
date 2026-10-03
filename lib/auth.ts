import 'server-only';
import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { isOwnerAuthConfigured, ownerEmail } from './supabase/config';
import { getSupabaseServerClient } from './supabase/server';

export function isOwnerUser(user: User | null): user is User {
  const email = ownerEmail();
  return Boolean(email && user?.email_confirmed_at && user.email?.toLowerCase() === email);
}

export async function getOwner(): Promise<User | null> {
  if (!isOwnerAuthConfigured()) return null;
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) return null;
    // getUser checks the session with Supabase Auth; cookie claims alone are untrusted.
    const { data, error } = await supabase.auth.getUser();
    return !error && isOwnerUser(data.user) ? data.user : null;
  } catch {
    return null;
  }
}

export async function isOwner(): Promise<boolean> {
  return Boolean(await getOwner());
}

export async function requireOwner(): Promise<User> {
  const user = await getOwner();
  if (!user) redirect('/login');
  return user;
}
