import 'server-only';

import { isOwner } from '@/lib/auth';
import { isSameOriginRequest } from '@/lib/request-security';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { Entry } from './model';

export { isOwner } from '@/lib/auth';

export function db() {
  return getSupabaseAdmin();
}

export function bucket() {
  const name = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'archive-images';
  return db().storage.from(name);
}

export async function entries(owner = false): Promise<Entry[]> {
  const rows: Entry[] = [];
  const pageSize = 1000;

  // PostgREST caps each response; page through the archive so exports are complete.
  for (let offset = 0; ; offset += pageSize) {
    let query = db()
      .from('entries')
      .select('payload')
      .eq('deleted', false)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (!owner) query = query.eq('status', 'Published');
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []).map(row => row.payload as Entry));
    if (!data || data.length < pageSize) break;
  }

  if (owner) return rows;
  const visible = new Set(rows.map(row => row.id));
  return rows.map(row => ({
    ...row,
    relations: row.relations.filter(relation => visible.has(relation.parentId)),
  }));
}

export async function authorizeWrite(request: Request) {
  if (!await isOwner()) {
    return Response.json(
      { error: 'Only the archive owner can make changes. Sign in with the owner account.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: 'This request must come from the archive.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return null;
}

export function failure(error: unknown) {
  console.error('Archive request failed', error);
  return Response.json(
    { error: 'The archive could not be reached. Your changes are still in the editor. Please try again.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
