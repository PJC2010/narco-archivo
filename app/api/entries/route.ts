import { entrySchema } from '@/lib/model';
import { db, entries, isOwner, authorizeWrite, failure } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'private, no-store' };
const maxRecordBytes = 500_000;

type MutationResult = {
  ok: boolean;
  entry?: unknown;
  deleted?: string;
  error?: 'exists' | 'stale' | 'missing_parent' | 'cycle' | 'linked' | 'invalid';
  linkedNames?: string[];
};

function rejected(result: MutationResult, deleting = false) {
  const errors = {
    exists: ['This record already exists. Reload it before saving.', 409],
    stale: [deleting
      ? 'This entry changed. Reload before deleting.'
      : 'This entry changed in another session. Copy your edits, then reload the entry before saving.', 409],
    missing_parent: ['A linked entry no longer exists. Remove or replace that relationship.', 400],
    cycle: ['This relationship would create a circular hierarchy. Choose another parent.', 400],
    linked: [`Remove incoming relationships from ${(result.linkedNames || []).join(', ')} before deleting this entry.`, 409],
    invalid: ['Invalid record', 400],
  } as const;
  const [error, status] = errors[result.error || 'invalid'];
  return Response.json({ error }, { status, headers: noStore });
}

export async function GET(request: Request) {
  try {
    const owner = await isOwner();
    const exporting = new URL(request.url).searchParams.has('export');
    if (exporting && !owner) {
      return Response.json({ error: 'Owner access required' }, { status: 403, headers: noStore });
    }
    const records = await entries(owner);
    return Response.json(
      exporting
        ? { format: 'NarcoHistoria', version: 1, exportedAt: new Date().toISOString(), entries: records }
        : { entries: records, canEdit: owner },
      {
        headers: {
          ...noStore,
          ...(exporting ? { 'Content-Disposition': 'attachment; filename="narcohistoria-records.json"' } : {}),
        },
      },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const forbidden = await authorizeWrite(request);
    if (forbidden) return forbidden;
    if (Number(request.headers.get('content-length')) > maxRecordBytes) {
      return Response.json({ error: 'Record is too large' }, { status: 413, headers: noStore });
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxRecordBytes) {
      return Response.json({ error: 'Record is too large' }, { status: 413, headers: noStore });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid record' }, { status: 400, headers: noStore });
    }
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues.map(issue => issue.message).join('. ') },
        { status: 400, headers: noStore },
      );
    }

    // The database serializes graph validation and the version-checked write together.
    const { data, error } = await db().rpc('save_archive_entry', { p_entry: parsed.data });
    if (error) throw error;
    const result = data as MutationResult | null;
    if (!result) throw new Error('No result returned while saving entry');
    if (!result.ok) return rejected(result);
    return Response.json({ entry: result.entry }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const forbidden = await authorizeWrite(request);
    if (forbidden) return forbidden;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: 'Invalid record' }, { status: 400, headers: noStore });
    }
    const { id, version } = (raw && typeof raw === 'object' ? raw : {}) as { id?: unknown; version?: unknown };
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)
      || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
      return Response.json({ error: 'Invalid record' }, { status: 400, headers: noStore });
    }
    const { data, error } = await db().rpc('delete_archive_entry', { p_id: id, p_version: version });
    if (error) throw error;
    const result = data as MutationResult | null;
    if (!result) throw new Error('No result returned while deleting entry');
    if (!result.ok) return rejected(result, true);
    return Response.json({ deleted: result.deleted }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
