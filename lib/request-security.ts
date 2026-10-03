/** Preserve the browser's destination host; Next normalizes loopback URLs. */
export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  const destination = new URL(`${url.protocol}//${host}`);
  if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password || destination.pathname !== '/' || destination.search || destination.hash) {
    throw new Error('Invalid request origin.');
  }
  return destination.origin;
}

/** Native forms and fetch mutations must originate from this deployment. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try {
    return origin === getRequestOrigin(request);
  } catch {
    return false;
  }
}
