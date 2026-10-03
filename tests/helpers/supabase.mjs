import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const fixtures = {
  ownerEmail: 'owner@example.test',
  readerEmail: 'reader@example.test',
  unconfirmedEmail: 'unconfirmed@example.test',
  password: 'integration-test-password',
  publicKey: 'sb_publishable_local_integration_test',
  secretKey: 'sb_secret_local_integration_test',
};

const json = (response, status, value, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(value));
};

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Only transport and Supabase Auth/Storage are doubles. Entry reads and writes
// execute the checked-in PostgreSQL migration, including its graph locks/RPCs.
export async function startSupabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
      file_size_limit bigint, allowed_mime_types text[]
    );
  `);
  const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrationDirectory), 'utf8'));
  }
  const serviceQuery = (query, values) => db.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE service_role');
    return transaction.query(query, values);
  });

  const objects = new Map();
  const sessions = new Map();
  const refreshTokens = new Map();
  const failures = [];
  const requests = [];
  const state = { logoutUnavailable: false };
  const users = new Map([
    [fixtures.ownerEmail, { id: randomUUID(), email: fixtures.ownerEmail, email_confirmed_at: '2026-01-01T00:00:00Z' }],
    [fixtures.readerEmail, { id: randomUUID(), email: fixtures.readerEmail, email_confirmed_at: '2026-01-01T00:00:00Z' }],
    [fixtures.unconfirmedEmail, { id: randomUUID(), email: fixtures.unconfirmedEmail, email_confirmed_at: null }],
  ].map(([email, user]) => [email, {
    ...user, aud: 'authenticated', role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }]));
  function createSession(email, expiresIn = 3600) {
    const user = users.get(email);
    if (!user) throw new Error(`Unknown test user: ${email}`);
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ sub: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', exp: expires, iat: expires - 3600, jti: randomUUID() })}.integration-test-signature`;
    const refreshToken = randomUUID();
    sessions.set(token, user);
    refreshTokens.set(refreshToken, user);
    return {
      access_token: token, token_type: 'bearer', expires_in: expiresIn,
      expires_at: expires, refresh_token: refreshToken, user,
    };
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const authorization = request.headers.authorization;
      const accessToken = authorization?.replace(/^Bearer /, '');
      requests.push({ method: request.method, path: url.pathname });

      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        const input = JSON.parse((await body(request)).toString());
        const user = users.get(input.email.toLowerCase());
        if (!user || input.password !== fixtures.password) {
          return json(response, 400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
        }
        return json(response, 200, createSession(user.email));
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const input = JSON.parse((await body(request)).toString());
        const user = refreshTokens.get(input.refresh_token);
        if (!user) return json(response, 400, { code: 'refresh_token_not_found', message: 'Invalid refresh token' });
        // Single-use refresh tokens catch a proxy that fails to propagate its
        // refreshed session to the downstream route within the same request.
        refreshTokens.delete(input.refresh_token);
        return json(response, 200, createSession(user.email));
      }

      if (url.pathname === '/auth/v1/user') {
        const user = sessions.get(accessToken);
        return user ? json(response, 200, user) : json(response, 401, { code: 'bad_jwt', message: 'Invalid token' });
      }
      if (url.pathname === '/auth/v1/logout') {
        if (state.logoutUnavailable) return json(response, 500, { message: 'Test Auth outage' });
        sessions.delete(accessToken);
        response.writeHead(204);
        return response.end();
      }

      if (request.headers.apikey !== fixtures.secretKey || authorization !== `Bearer ${fixtures.secretKey}`) {
        return json(response, 403, { message: 'Service role required' });
      }

      if (url.pathname === '/rest/v1/entries' && request.method === 'GET') {
        const values = [];
        const filters = [];
        for (const [name, value] of url.searchParams) {
          if (name === 'deleted') {
            filters.push('deleted = false');
          } else if (name === 'status') {
            values.push(value.slice('eq.'.length));
            filters.push(`status = $${values.length}`);
          } else if (name === 'payload') {
            if (!value.startsWith('cs.')) throw new Error(`Unsupported payload query: ${value}`);
            values.push(value.slice(3));
            filters.push(`payload @> $${values.length}::jsonb`);
          } else if (!['select', 'order', 'offset', 'limit'].includes(name)) {
            throw new Error(`Unsupported entry query parameter: ${name}`);
          }
        }
        const columns = url.searchParams.get('select') === 'id' ? 'id' : 'payload';
        const range = request.headers.range?.split('-').map(Number);
        const offset = Number(url.searchParams.get('offset') ?? range?.[0] ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? (range ? range[1] - range[0] + 1 : 1000));
        values.push(limit, offset);
        const result = await serviceQuery(`SELECT ${columns} FROM public.entries ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY updated_at DESC, id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
        return json(response, 200, result.rows, { 'Content-Range': `${offset}-${offset + result.rows.length - 1}/*` });
      }

      if (url.pathname.startsWith('/rest/v1/rpc/') && request.method === 'POST') {
        const input = JSON.parse((await body(request)).toString());
        const procedure = url.pathname.slice('/rest/v1/rpc/'.length);
        let result;
        if (procedure === 'save_archive_entry') {
          result = await serviceQuery('SELECT public.save_archive_entry($1::jsonb) AS result', [JSON.stringify(input.p_entry)]);
        } else if (procedure === 'delete_archive_entry') {
          result = await serviceQuery('SELECT public.delete_archive_entry($1::text, $2::integer) AS result', [input.p_id, input.p_version]);
        } else {
          throw new Error(`Unexpected RPC: ${procedure}`);
        }
        return json(response, 200, result.rows[0].result);
      }

      if (url.pathname.startsWith('/storage/v1/object/')) {
        const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length).replace(/^authenticated\//, ''));
        if (request.method === 'POST') {
          objects.set(path, { bytes: await body(request), type: request.headers['content-type'] });
          return json(response, 200, { Key: path, Id: randomUUID() });
        }
        if (request.method === 'GET') {
          const object = objects.get(path);
          if (!object) return json(response, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
          response.writeHead(200, { 'Content-Type': object.type });
          return response.end(object.bytes);
        }
      }
      throw new Error(`Unexpected Supabase request: ${request.method} ${url.pathname}`);
    } catch (error) {
      failures.push(error);
      if (!response.headersSent) json(response, 500, { message: error.message });
      else response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    db, objects, sessions, requests, failures, state, createSession,
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await db.close();
    },
  };
}
