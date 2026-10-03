import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fixtures, startSupabase } from './helpers/supabase.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSm0AAAAASUVORK5CYII=', 'base64');

function entry(name, kind = 'Organization') {
  return {
    id: crypto.randomUUID(), name, kind, aliases: '', summary: 'Synthetic integration test record.',
    body: 'Synthetic test content, not factual archive content.', status: 'Draft', certainty: 'Unverified',
    asOf: '2026-09-29', period: '',
    sources: [{ id: crypto.randomUUID(), title: 'Test reference', publisher: 'Test fixture', url: 'https://example.com', date: '2026-09-29', note: 'Test only.' }],
    relations: [], images: [], version: 0, updatedAt: '',
  };
}

function relation(record, parentId) {
  return { id: crypto.randomUUID(), parentId, role: 'Lieutenant', certainty: 'Alleged', from: '2020-01-01', to: '', asOf: '2026-09-29', sourceIds: [record.sources[0].id], note: 'Synthetic relationship.' };
}

function imageForm(bytes = png, type = 'image/png', name = 'test.png') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return form;
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startApp(supabase) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      SUPABASE_URL: supabase.url, SUPABASE_PUBLISHABLE_KEY: fixtures.publicKey,
      SUPABASE_SECRET_KEY: fixtures.secretKey, OWNER_EMAIL: fixtures.ownerEmail,
      SUPABASE_STORAGE_BUCKET: 'archive-images',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(force);
    }
  };
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Next.js exited: ${output}`);
      try {
        const response = await fetch(`${base}/login`);
        if (response.ok) return { base, close, output: () => output };
      } catch { /* The server is still starting. */ }
      await delay(100);
    }
    throw new Error(`Next.js did not become ready: ${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}

function browser(base) {
  const cookies = new Map();
  return {
    cookies,
    async request(path, { method = 'GET', body, origin = base, headers = {} } = {}) {
      const requestHeaders = new Headers(headers);
      if (cookies.size) requestHeaders.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
      if (method !== 'GET' && origin !== null) requestHeaders.set('Origin', origin);
      if (body && !(body instanceof FormData) && !(body instanceof URLSearchParams)) {
        requestHeaders.set('Content-Type', 'application/json');
        body = JSON.stringify(body);
      }
      const response = await fetch(base + path, { method, headers: requestHeaders, body, redirect: 'manual' });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        const name = pair.slice(0, separator);
        const value = pair.slice(separator + 1);
        if (!value || /max-age=0(?:;|$)/i.test(cookie)) cookies.delete(name);
        else cookies.set(name, value);
      }
      const contentType = response.headers.get('Content-Type') ?? '';
      const data = contentType.includes('application/json') ? await response.json()
        : contentType.startsWith('image/') ? Buffer.from(await response.arrayBuffer()) : await response.text();
      return { status: response.status, data, headers: response.headers };
    },
  };
}

function plantSession(client, session) {
  client.cookies.clear();
  client.cookies.set('narcohistoria-auth', `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`);
}

test('production Next.js verifies sessions and preserves private archive, PostgreSQL, and image behavior', { timeout: 120_000 }, async t => {
  const supabase = await startSupabase();
  t.after(() => supabase.close());
  const app = await startApp(supabase);
  t.after(() => app.close());
  const anonymous = browser(app.base);
  const owner = browser(app.base);
  const save = async record => {
    const result = await owner.request('/api/entries', { method: 'POST', body: record });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.entry;
  };
  const signIn = (client, email = fixtures.ownerEmail, password = fixtures.password, origin) =>
    client.request('/auth/sign-in', { method: 'POST', body: new URLSearchParams({ email, password }), ...(origin !== undefined ? { origin } : {}) });

  // Supabase's anonymous and ordinary authenticated roles cannot read private
  // data or invoke the privileged write functions directly.
  for (const role of ['anon', 'authenticated']) {
    await supabase.db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(supabase.db.query('SELECT payload FROM public.entries'), /permission denied/);
      await assert.rejects(supabase.db.query('SELECT public.save_archive_entry($1::jsonb)', [JSON.stringify(entry('Direct write denied'))]), /permission denied/);
      await assert.rejects(supabase.db.query('SELECT public.delete_archive_entry($1::text, 1)', ['test']), /permission denied/);
    } finally {
      await supabase.db.exec('RESET ROLE');
    }
  }
  const bucket = await supabase.db.query("SELECT public, file_size_limit FROM storage.buckets WHERE id = 'archive-images'");
  assert.equal(bucket.rows[0].public, false);
  assert.equal(Number(bucket.rows[0].file_size_limit), 4 * 1024 * 1024);

  assert.equal((await anonymous.request('/')).status, 200);
  const loginPage = await anonymous.request('/login');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.data, /action="\/auth\/sign-in"/);
  assert.match(loginPage.data, /name="email"/);
  assert.match(loginPage.data, /name="password"/);

  const publicRead = await anonymous.request('/api/entries');
  assert.equal(publicRead.status, 200, JSON.stringify(publicRead.data));
  assert.equal(publicRead.data.canEdit, false);
  assert.deepEqual(publicRead.data.entries, []);
  assert.equal((await anonymous.request('/api/entries', { method: 'POST', body: entry('Denied') })).status, 403);
  assert.equal((await anonymous.request('/api/entries?export=1')).status, 403);
  const manage = await anonymous.request('/manage');
  assert.equal(manage.status, 307);
  assert.equal(new URL(manage.headers.get('Location'), app.base).pathname, '/login');

  const spoof = {
    Cookie: '__sites_local_auth=1',
    'oai-authenticated-user-id': 'fake-owner',
    'oai-authenticated-user-email': fixtures.ownerEmail,
    'x-forwarded-email': fixtures.ownerEmail,
  };
  assert.equal((await anonymous.request('/api/entries', { headers: spoof })).data.canEdit, false);
  assert.equal((await anonymous.request('/api/entries', { method: 'POST', body: entry('Spoofed owner'), headers: spoof })).status, 403);
  assert.equal((await signIn(owner, fixtures.ownerEmail, fixtures.password, 'https://elsewhere.example')).status, 403);
  assert.equal((await signIn(owner, fixtures.ownerEmail, fixtures.password, null)).status, 403);
  for (const [email, password] of [[fixtures.ownerEmail, 'incorrect'], [fixtures.readerEmail, fixtures.password], [fixtures.unconfirmedEmail, fixtures.password]]) {
    const rejected = browser(app.base);
    const login = await signIn(rejected, email, password);
    assert.equal(login.status, 303, JSON.stringify(login.data));
    assert.equal(new URL(login.headers.get('Location'), app.base).pathname, '/login');
    assert.equal((await rejected.request('/api/entries')).data.canEdit, false);
    assert.equal((await rejected.request('/api/entries', { method: 'POST', body: entry('Rejected account') })).status, 403);
  }
  const reader = browser(app.base);
  plantSession(reader, supabase.createSession(fixtures.readerEmail));
  assert.equal((await reader.request('/api/entries')).data.canEdit, false);
  assert.equal((await reader.request('/api/entries?export=1')).status, 403);
  assert.equal((await reader.request('/api/entries', { method: 'POST', body: entry('Non-owner session') })).status, 403);
  assert.equal((await reader.request('/api/uploads', { method: 'POST', body: imageForm() })).status, 403);
  const unconfirmedOwner = browser(app.base);
  const unconfirmedSession = supabase.createSession(fixtures.ownerEmail);
  supabase.sessions.set(unconfirmedSession.access_token, { ...unconfirmedSession.user, email_confirmed_at: null });
  plantSession(unconfirmedOwner, unconfirmedSession);
  assert.equal((await unconfirmedOwner.request('/api/entries')).data.canEdit, false, 'Owner access requires a confirmed email from Auth, even when cookie metadata claims confirmation');

  const login = await signIn(owner);
  assert.equal(login.status, 303);
  assert.equal(new URL(login.headers.get('Location'), app.base).pathname, '/manage');
  assert.equal(new URL(login.headers.get('Location'), app.base).origin, app.base, 'Authentication redirects must preserve the browser host');
  assert.ok(owner.cookies.size > 0, 'Owner sign-in must persist an application session');
  assert.ok(login.headers.getSetCookie().some(cookie => /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Secure/i.test(cookie)), 'Production session cookies must be HttpOnly, SameSite Lax, and Secure');
  assert.equal((await owner.request('/manage')).status, 200);
  assert.equal((await owner.request('/api/entries')).data.canEdit, true);
  assert.ok(supabase.requests.some(request => request.path === '/auth/v1/user'), 'The application must verify identity with Supabase Auth');
  const expiredSession = supabase.createSession(fixtures.ownerEmail, -60);
  plantSession(owner, expiredSession);
  const oldCookie = owner.cookies.get('narcohistoria-auth');
  const refreshed = await owner.request('/api/entries');
  assert.equal(refreshed.data.canEdit, true, 'The downstream route must receive the proxy-refreshed session');
  assert.notEqual(owner.cookies.get('narcohistoria-auth'), oldCookie, 'The browser must receive the refreshed session cookie');
  assert.match(refreshed.headers.get('Cache-Control'), /no-store/);
  assert.equal((await owner.request('/api/entries')).data.canEdit, true, 'The refreshed cookie must work on the next request');
  for (const origin of ['https://elsewhere.example', null]) {
    assert.equal((await owner.request('/api/entries', { method: 'POST', body: entry('CSRF denied'), origin })).status, 403);
    assert.equal((await owner.request('/api/uploads', { method: 'POST', body: imageForm(), origin })).status, 403);
    assert.equal((await owner.request('/auth/sign-out', { method: 'POST', origin })).status, 403);
  }
  assert.equal((await owner.request('/api/entries', {
    method: 'POST', body: entry('Forwarded host spoof'), origin: 'http://elsewhere.example',
    headers: { 'X-Forwarded-Host': 'elsewhere.example' },
  })).status, 403);

  let organization = await save(entry('Test organization'));
  assert.equal(organization.version, 1);
  assert.ok(organization.updatedAt);
  assert.equal((await anonymous.request('/api/entries')).data.entries.length, 0);
  assert.equal((await owner.request('/api/entries')).data.entries[0].id, organization.id);
  assert.equal((await owner.request('/api/entries', { method: 'POST', body: { ...organization, version: 0 } })).status, 409);

  let person = entry('Test person', 'Person');
  person.relations = [relation(person, organization.id)];
  assert.equal((await anonymous.request('/api/uploads', { method: 'POST', body: imageForm() })).status, 403);
  const uploaded = await owner.request('/api/uploads', { method: 'POST', body: imageForm() });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
  assert.match(uploaded.data.key, /^[a-f0-9-]+\.png$/);
  assert.equal(supabase.objects.size, 1);
  const imagePath = `/api/images/${uploaded.data.key}`;
  assert.equal((await anonymous.request(imagePath)).status, 404, 'An unattached upload is private');
  const ownerImage = await owner.request(imagePath);
  assert.equal(ownerImage.status, 200);
  assert.deepEqual(ownerImage.data, png);
  assert.equal(ownerImage.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(ownerImage.headers.get('X-Content-Type-Options'), 'nosniff');
  person.images = [{ key: uploaded.data.key, caption: 'Synthetic image', credit: 'Test fixture', sourceUrl: 'https://example.com', identity: 'Alleged identification', rights: 'Test fixture' }];
  person = await save(person);
  assert.equal((await anonymous.request(imagePath)).status, 404, 'Images on draft records are private');

  const stalePerson = { ...person };
  person = await save({ ...person, status: 'Published' });
  assert.equal(person.version, 2);
  assert.equal((await owner.request('/api/entries', { method: 'POST', body: stalePerson })).status, 409);
  let published = (await anonymous.request('/api/entries')).data.entries;
  assert.equal(published.length, 1);
  assert.equal(published[0].id, person.id);
  assert.deepEqual(published[0].relations, [], 'Public records must not disclose relationships to private records');
  assert.equal((await anonymous.request(imagePath)).status, 200);
  organization = await save({ ...organization, status: 'Published' });
  published = (await anonymous.request('/api/entries')).data.entries;
  assert.equal(published.find(record => record.id === person.id).relations[0].parentId, organization.id);
  const simultaneous = await Promise.all(['First edit', 'Second edit'].map(summary => owner.request('/api/entries', {
    method: 'POST', body: { ...organization, summary },
  })));
  assert.deepEqual(simultaneous.map(result => result.status).sort(), [200, 409], 'Concurrent saves cannot overwrite each other');
  organization = simultaneous.find(result => result.status === 200).data.entry;

  const cycle = { ...organization, relations: [relation(organization, person.id)] };
  assert.equal((await owner.request('/api/entries', { method: 'POST', body: cycle })).status, 400);
  const missingParent = { ...person, relations: [relation(person, crypto.randomUUID())] };
  assert.equal((await owner.request('/api/entries', { method: 'POST', body: missingParent })).status, 400);
  assert.equal((await owner.request('/api/entries', { method: 'DELETE', body: { id: organization.id, version: organization.version } })).status, 409);
  assert.equal((await owner.request('/api/entries', { method: 'DELETE', body: { id: person.id, version: stalePerson.version } })).status, 409);

  const exported = await owner.request('/api/entries?export=1');
  assert.equal(exported.status, 200);
  assert.equal(exported.data.format, 'NarcoHistoria');
  assert.equal(exported.data.entries.length, 2);
  assert.match(exported.headers.get('Content-Disposition'), /attachment/);
  person = await save({ ...person, status: 'Draft' });
  assert.equal((await anonymous.request(imagePath)).status, 404, 'Unpublishing must immediately revoke public image access');
  assert.equal((await owner.request(imagePath)).status, 200);
  assert.equal((await owner.request('/api/entries', { method: 'POST', body: { ...person, status: 'Published', sources: [], relations: [] } })).status, 400);
  assert.equal((await owner.request('/api/uploads', { method: 'POST', body: imageForm('<svg/>', 'image/svg+xml', 'test.svg') })).status, 400);
  assert.equal((await owner.request('/api/uploads', { method: 'POST', body: imageForm(Buffer.alloc(4 * 1024 * 1024 + 1)) })).status, 400);
  assert.equal((await anonymous.request('/api/images/not-a-valid-key')).status, 404);
  assert.equal((await owner.request('/api/entries', { method: 'DELETE', body: { id: person.id, version: person.version } })).status, 200);
  assert.equal((await owner.request('/api/entries', { method: 'DELETE', body: { id: organization.id, version: organization.version } })).status, 200);
  assert.equal((await owner.request('/api/entries', { method: 'POST', body: { ...person, version: 0 } })).status, 409, 'A deleted ID must not be silently resurrected');
  assert.deepEqual((await owner.request('/api/entries')).data.entries, []);
  assert.deepEqual((await anonymous.request('/api/entries')).data.entries, []);

  // Supabase normally returns at most 1,000 rows. A complete export and public
  // archive must cross that boundary without missing or duplicating entries.
  const largeArchive = Array.from({ length: 1002 }, (_, index) => ({
    ...entry(`Pagination fixture ${index}`), version: 1,
    status: index === 1001 ? 'Draft' : 'Published', updatedAt: '2026-09-29T00:00:00.000Z',
  }));
  await supabase.db.query(`
    INSERT INTO public.entries (id, payload, status, version, updated_at)
    SELECT record->>'id', record, record->>'status', 1, (record->>'updatedAt')::timestamptz
    FROM jsonb_array_elements($1::jsonb) AS record
  `, [JSON.stringify(largeArchive)]);
  const largeExport = (await owner.request('/api/entries?export=1')).data.entries;
  const largePublic = (await anonymous.request('/api/entries')).data.entries;
  assert.equal(largeExport.length, 1002);
  assert.equal(new Set(largeExport.map(record => record.id)).size, 1002);
  assert.equal(largePublic.length, 1001);
  assert.ok(largePublic.every(record => record.status === 'Published'));

  // A cookie with a locally plausible session must still fail if the auth
  // server revokes it. Restore the token only to exercise explicit logout.
  const savedSessions = new Map(supabase.sessions);
  supabase.sessions.clear();
  assert.equal((await owner.request('/api/entries')).data.canEdit, false);
  assert.equal((await owner.request('/api/entries', { method: 'POST', body: entry('Revoked session') })).status, 403);
  for (const [token, user] of savedSessions) supabase.sessions.set(token, user);
  await signIn(owner);
  const logout = await owner.request('/auth/sign-out', { method: 'POST' });
  assert.equal(logout.status, 303);
  assert.equal(owner.cookies.size, 0);
  assert.equal((await owner.request('/api/entries')).data.canEdit, false);
  await signIn(owner);
  supabase.state.logoutUnavailable = true;
  const unavailableLogout = await owner.request('/auth/sign-out', { method: 'POST' });
  assert.equal(unavailableLogout.status, 303);
  assert.equal(owner.cookies.size, 0, 'Sign-out must clear the browser session when Supabase Auth is unavailable');
  assert.equal((await owner.request('/api/entries')).data.canEdit, false);
  assert.deepEqual(supabase.failures, [], app.output());
});
