import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createApplication } from '../server/strategy-index.mjs';
import { database } from '../server/database.mjs';
import { strategyModel } from '../server/strategy-model.mjs';

test('self-hosted HTTP authentication, isolation, conflict protection and persistence', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'copilot-auth-'));
  const token = randomBytes(32).toString('base64url');
  writeFileSync(join(dir, 'bootstrap.sha256'), createHash('sha256').update(token).digest('hex'));
  const origin = 'https://copilot.test';
  let calls = 0;
  const modelService = { model: 'gpt-5.6-sol', async status() { return { configured: true, provider: 'strategy', model: this.model, managed: true }; }, async complete(messages) { calls++; assert.ok(messages.length); return { ok: true, reply: 'Connected' }; } };
  const options = { dataDir: dir, origin, basePath: '/english/', modelService };
  let app = createApplication(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let url = `http://127.0.0.1:${app.server.address().port}/english/`;
  let cookie = '';
  const call = (path, method = 'GET', body, extra = {}) => fetch(url + path, { method, redirect: 'manual', headers: { origin, 'content-type': 'application/json', cookie, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  t.after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); rmSync(dir, { recursive: true }); });
  await t.test('anonymous requests and forged platform identities cannot access learning data', async () => {
    assert.equal((await call('api/state', 'GET', null, { 'oai-authenticated-user-id': 'selfhost-owner' })).status, 401);
    const page = await call(''); assert.equal(page.status, 302); assert.equal(page.headers.get('location'), '/english/auth/login');
    assert.equal((await call('healthz')).status, 200);
  });
  await t.test('setup requires a private token and matching origin, then cannot be replayed', async () => {
    const body = { token, password: '482951' };
    assert.equal((await call('auth/setup', 'POST', { token, password: '48295' })).status, 400);
    assert.equal((await call('auth/setup', 'POST', body, { origin: 'https://evil.test' })).status, 403);
    assert.equal((await call('auth/setup', 'POST', { ...body, token: 'wrong' })).status, 403);
    const result = await call('auth/setup', 'POST', body); assert.equal(result.status, 200);
    assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict;.*Secure/);
    cookie = result.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('auth/setup', 'POST', body)).status, 409);
    assert.ok(!JSON.stringify(app.database.sqlite.prepare('SELECT * FROM selfhost_owner').get()).includes(body.password));
  });
  await t.test('subpath assets load and authenticated state rejects stale or cross-origin writes', async () => {
    const html = await (await call('')).text();
    const builtAsset = html.match(/src="([^\"]+\.js)"/)[1];
    const asset = "/english/" + builtAsset.replace(/^\/english\/|^\//, "");
    assert.equal((await fetch(url.replace('/english/', '') + asset, { headers: { cookie } })).status, 200);
    assert.equal((await call('api/state', 'PUT', { state: { saved: ['hello'] }, revision: 0 })).status, 200);
    assert.equal((await call('api/state', 'PUT', { state: {}, revision: 0 })).status, 409);
    assert.equal((await call('api/state', 'PUT', { state: {}, revision: 1 }, { origin: 'https://evil.test' })).status, 403);
    assert.deepEqual((await (await call('api/state')).json()).state.saved, ['hello']);
  });
  await t.test('managed GPT works without an API key and rejects credential changes', async () => {
    const settings = await (await call('api/settings')).json();
    assert.equal(settings.model, 'gpt-5.6-sol'); assert.equal(settings.managed, true);
    assert.equal((await call('api/settings', 'PUT', { key: 'not-used' })).status, 405);
    const response = await call('api/test-ai', 'POST', {}); assert.equal(response.status, 200);
    assert.equal((await response.json()).model, 'gpt-5.6-sol'); assert.equal(calls, 1);
    assert.equal(app.database.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_credentials').get().n, 0);
  });
  await t.test('restart retains data and sessions; logout revokes the session', async () => {
    const key = readFileSync(join(dir, 'encryption.key'), 'utf8');
    app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
    app = createApplication(options);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${app.server.address().port}/english/`;
    assert.equal(readFileSync(join(dir, 'encryption.key'), 'utf8'), key);
    assert.deepEqual((await (await call('api/state')).json()).state.saved, ['hello']);
    assert.equal((await call('auth/logout', 'POST', {})).status, 200);
    assert.equal((await call('api/state')).status, 401);
    assert.equal((await call('auth/login', 'POST', { password: 'wrong-test-password' })).status, 401);
    assert.equal((await call('auth/login', 'POST', { password: '482951' })).status, 200);
  });
});

test('SQLite batch rolls back the entire transaction on failure', async () => {
  const db = database(':memory:');
  try {
    await assert.rejects(db.batch([
      db.prepare('INSERT INTO ai_requests VALUES (?,?,?)').bind('duplicate', 'user', 1),
      db.prepare('INSERT INTO ai_requests VALUES (?,?,?)').bind('duplicate', 'user', 2),
    ]));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ai_requests').first()).n, 0);
  } finally { db.sqlite.close(); }
});

test('private socket adapter pins GPT 5.6 Sol, parses JSON and sanitizes upstream errors', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'copilot-model-'));
  writeFileSync(join(dir, 'token'), 'test-only-bridge-token');
  let fail = false;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-only-bridge-token');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/status') { res.end(JSON.stringify({ authenticated: true, models: ['gpt-5.6-sol'] })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks)); assert.equal(payload.model, 'gpt-5.6-sol');
    assert.equal(payload.system_prompt, 'Return JSON');
    if (fail) { res.writeHead(429); res.end('{"secret":"must not escape"}'); return; }
    res.end(JSON.stringify({ model: 'gpt-5.6-sol', content: '```json\n{"reply":"Hello"}\n```' }));
  });
  await new Promise(resolve => server.listen(join(dir, 'model.sock'), resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true }); });
  const model = strategyModel(dir);
  assert.equal((await model.status()).configured, true);
  assert.deepEqual(await model.complete([{ role: 'system', content: 'Return JSON' }, { role: 'user', content: 'Hello' }]), { reply: 'Hello' });
  fail = true;
  await assert.rejects(model.complete([{ role: 'system', content: 'Return JSON' }]), error => error.status === 429 && !error.message.includes('secret'));
});
