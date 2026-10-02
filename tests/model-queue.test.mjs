import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { strategyModel } from '../server/strategy-model.mjs';

const input = id => [{ role: 'system', content: 'Return JSON' }, { role: 'user', content: String(id) }];
async function fixture(t, respond, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'copilot-queue-'));
  writeFileSync(join(root, 'token'), 'isolated-test-only');
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/status') { res.end(JSON.stringify({ authenticated: true, models: ['gpt-5.6-sol'], channel: 'dedicated' })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    await respond(JSON.parse(Buffer.concat(chunks)), res);
  });
  await new Promise(resolve => server.listen(join(root, 'model.sock'), resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true }); });
  return strategyModel(root, options);
}
const reply = (res, id) => res.end(JSON.stringify({ model: 'gpt-5.6-sol', content: JSON.stringify({ id }) }));

test('overlapping workbench requests run in FIFO order with one inference at a time', async t => {
  let active = 0, maximum = 0; const order = [];
  const model = await fixture(t, async (body, res) => {
    const id = body.context.messages[0].content;
    order.push(id); maximum = Math.max(maximum, ++active);
    await delay(25); active--; reply(res, id);
  });
  const pending = [1, 2, 3].map(id => model.complete(input(id)));
  const status = await model.status(); assert.equal(status.channel, 'dedicated');
  assert.equal(status.processing, true); assert.ok(status.waiting >= 1);
  assert.deepEqual(await Promise.all(pending), [{ id: '1' }, { id: '2' }, { id: '3' }]);
  assert.deepEqual(order, ['1', '2', '3']); assert.equal(maximum, 1);
});

test('expired queued work is removed and never sent to the model', async t => {
  const sent = [];
  const model = await fixture(t, async (body, res) => {
    const id = body.context.messages[0].content; sent.push(id);
    await delay(60); reply(res, id);
  }, { queueTimeoutMs: 15, maxWaiting: 1 });
  const first = model.complete(input(1));
  const expired = assert.rejects(model.complete(input(2)), error => error.code === 'queue_timeout');
  await assert.rejects(model.complete(input(3)), error => error.code === 'queue_full');
  await Promise.all([first, expired]);
  assert.deepEqual(sent, ['1']);
  assert.deepEqual(await model.complete(input(4)), { id: '4' });
});

test('account saturation, account limits and generation timeouts have distinct safe errors', async t => {
  let code = 'account_queue_timeout';
  const model = await fixture(t, async (_body, res) => {
    res.writeHead(code === 'model_timeout' ? 504 : 429);
    res.end(JSON.stringify({ error: code, private_diagnostic: 'do-not-expose' }));
  });
  for (const expected of ['account_queue_timeout', 'rate_limited', 'model_timeout']) {
    code = expected;
    await assert.rejects(model.complete(input(1)), error => error.code === expected && !error.message.includes('do-not-expose'));
  }
});

test('failed inference releases admission for the next request', async t => {
  let count = 0;
  const model = await fixture(t, async (_body, res) => {
    if (++count === 1) { res.end('broken JSON'); return; }
    reply(res, 'recovered');
  });
  const failure = assert.rejects(model.complete(input(1)), error => error.code === 'invalid_output');
  const next = model.complete(input(2));
  await failure;
  assert.deepEqual(await next, { id: 'recovered' });
});

test('absolute model deadline expires even when the service keeps sending bytes', async t => {
  const model = await fixture(t, async (_body, res) => {
    res.writeHead(200);
    const timer = setInterval(() => res.write(' '), 5);
    res.on('close', () => clearInterval(timer));
  }, { completionTimeoutMs: 35 });
  await assert.rejects(model.complete(input(1)), error => error.code === 'model_timeout');
});
