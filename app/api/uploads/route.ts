import { authorizeWrite, bucket, failure } from '@/lib/server';
import { MAX_IMAGE_BYTES, IMAGE_SIZE_LABEL } from '@/lib/upload-limits';

export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  try {
    const forbidden = await authorizeWrite(request);
    if (forbidden) return forbidden;
    const declared = Number(request.headers.get('content-length'));
    if (declared > MAX_IMAGE_BYTES + 10_000) {
      return Response.json(
        { error: `Choose an image smaller than ${IMAGE_SIZE_LABEL}.` },
        { status: 413, headers: noStore },
      );
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: 'Invalid image upload.' }, { status: 400, headers: noStore });
    }
    const file = form.get('file');
    if (!(file instanceof File) || file.size > MAX_IMAGE_BYTES || file.size === 0) {
      return Response.json(
        { error: `Choose a JPEG, PNG, or WebP image under ${IMAGE_SIZE_LABEL}.` },
        { status: 400, headers: noStore },
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
    const webp = new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
      && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    const ext = jpg ? 'jpg' : png ? 'png' : webp ? 'webp' : null;
    if (!ext) {
      return Response.json(
        { error: 'Only JPEG, PNG, and WebP image files are supported.' },
        { status: 400, headers: noStore },
      );
    }
    const key = `${crypto.randomUUID()}.${ext}`;
    const { error } = await bucket().upload(key, bytes, {
      contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
      upsert: false,
      cacheControl: '0',
    });
    if (error) throw error;
    return Response.json({ key }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
