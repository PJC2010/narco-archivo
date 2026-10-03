import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig, uncachedFetch } from './config';

let admin: SupabaseClient | undefined;

/** A server-only service client. Callers must authorize private reads and every write. */
export function getSupabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const config = getSupabaseAdminConfig();
  if (!config) throw new Error('Archive storage has not been configured.');
  admin = createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: uncachedFetch },
  });
  return admin;
}
