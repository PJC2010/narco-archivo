import { bucket, db, isOwner, failure } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'private, no-store' };

function notFound() {
  return new Response('Not found', { status: 404, headers: noStore });
}

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(key)) return notFound();
    if (!await isOwner()) {
      const { data, error } = await db()
        .from('entries')
        .select('id')
        .eq('deleted', false)
        .eq('status', 'Published')
        .contains('payload', { images: [{ key }] })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return notFound();
    }
    const { data, error } = await bucket().download(key);
    if (error) {
      const storageError = error as { status?: number; statusCode?: string | number };
      if (storageError.status === 404 || String(storageError.statusCode) === '404') return notFound();
      throw error;
    }
    if (!data) return notFound();
    const extension = key.split('.').pop();
    return new Response(data, {
      headers: {
        ...noStore,
        'Content-Type': extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
