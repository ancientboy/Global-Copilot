import { createServer } from 'node:http';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { database } from './database.mjs';
import { strategyModel } from './strategy-model.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const security = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

export function createApplication({ dataDir, origin, basePath = '/', assetsDir = fileURLToPath(new URL('../dist/client/', import.meta.url)), secureCookies = true, modelService }) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error('Invalid base path');
  origin = new URL(origin).origin;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const keyPath = resolve(dataDir, 'encryption.key');
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
  const DB = database(resolve(dataDir, 'copilot.sqlite'));
  const sql = DB.sqlite;
  sql.exec(`CREATE TABLE IF NOT EXISTS selfhost_owner (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS selfhost_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
  const env = { DB, AI_ENCRYPTION_KEY: readFileSync(keyPath, 'utf8').trim(), MODEL_SERVICE: modelService };
  const attempts = new Map();
  const cookie = (token, age) => `gc_session=${token}; Path=${basePath}; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  const owner = () => sql.prepare('SELECT * FROM selfhost_owner WHERE id=1').get();
  const session = request => {
    const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('gc_session='))?.slice(11) || '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return sql.prepare('SELECT token_hash FROM selfhost_sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
  };
  const newSession = () => {
    const token = randomBytes(32).toString('base64url');
    sql.prepare('DELETE FROM selfhost_sessions WHERE expires_at<=?').run(Date.now());
    sql.prepare('INSERT INTO selfhost_sessions VALUES (?,?)').run(hash(token), Date.now() + 30 * 86400000);
    return json({ ok: true }, 200, { 'set-cookie': cookie(token, 30 * 86400) });
  };
  function limit(ip) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (!attempts.has(ip)) {
      if (attempts.size >= 10000) return false;
      attempts.set(ip, { n: 0, until: now + 15 * 60000 });
    }
    return ++attempts.get(ip).n <= 10;
  }
  function asset(path) {
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { return new Response('Not found', { status: 404 }); }
    const root = resolve(assetsDir), file = resolve(root, '.' + decoded);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(file), { headers: { 'content-type': mime[extname(file)] || 'application/octet-stream' } });
  }
  async function handle(request, ip = 'local') {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(basePath)) return json({ error: 'Not found' }, 404);
    const path = '/' + url.pathname.slice(basePath.length);
    if (path === '/healthz' && request.method === 'GET') { sql.prepare('SELECT 1').get(); return json({ ok: true }); }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers.get('origin') !== origin) return json({ error: '请求来源无效，请重新打开本站。' }, 403);
      if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: '需要 JSON 请求' }, 415);
    }
    if (path === '/auth/login' && ['GET', 'HEAD'].includes(request.method)) {
      return new Response(readFileSync(new URL('./login.html', import.meta.url), 'utf8').replaceAll('__BASE__', basePath), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (path === '/auth/login.js' && request.method === 'GET') return new Response(readFileSync(new URL('./login.js', import.meta.url)), { headers: { 'content-type': mime['.js'] } });
    if (path === '/auth/status' && request.method === 'GET') return json({ configured: !!owner() });
    if ((path === '/auth/setup' || path === '/auth/login') && request.method === 'POST') {
      if (!limit(ip)) return json({ error: '尝试次数过多，请 15 分钟后重试。' }, 429);
      let body;
      try { const text = await request.text(); if (text.length > 4096) throw new Error(); body = JSON.parse(text); } catch { return json({ error: '请求格式无效' }, 400); }
      if (typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 256) return json({ error: '密码需为 6–256 个字符。' }, 400);
      const existing = owner();
      if (path === '/auth/setup') {
        if (existing) return json({ error: '账号已创建，请直接登录。' }, 409);
        const bootstrap = resolve(dataDir, 'bootstrap.sha256');
        if (!existsSync(bootstrap) || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return json({ error: '请使用专属首次设置链接。' }, 403);
        const expected = readFileSync(bootstrap, 'utf8').trim();
        if (expected.length !== 64 || !timingSafeEqual(Buffer.from(hash(body.token)), Buffer.from(expected))) return json({ error: '首次设置链接无效。' }, 403);
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await derive(body.password, salt, 64)).toString('hex');
        const created = sql.prepare('INSERT OR IGNORE INTO selfhost_owner VALUES (1,?,?)').run(salt, passwordHash);
        if (!created.changes) return json({ error: '账号已创建，请直接登录。' }, 409);
      } else {
        if (!existing) return json({ error: '请先通过专属设置链接创建账号。' }, 403);
        const candidate = await derive(body.password, existing.salt, 64);
        if (!timingSafeEqual(candidate, Buffer.from(existing.password_hash, 'hex'))) return json({ error: '密码不正确。' }, 401);
      }
      attempts.delete(ip);
      return newSession();
    }
    const current = session(request);
    if (path === '/auth/logout' && request.method === 'POST') {
      if (current) sql.prepare('DELETE FROM selfhost_sessions WHERE token_hash=?').run(current.token_hash);
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    }
    if (path.startsWith('/auth/')) return json({ error: 'Not found' }, 404);
    if (!current) {
      if (path.startsWith('/api/')) return json({ error: '请先登录商务英语工作台。' }, 401);
      return new Response(null, { status: 302, headers: { location: basePath + 'auth/login' } });
    }
    if (!['GET', 'HEAD'].includes(request.method) && !path.startsWith('/api/')) return json({ error: 'Method not allowed' }, 405);
    // Never trust caller-supplied platform identity; only our verified session sets it.
    const headers = new Headers(request.headers);
    headers.delete('oai-authenticated-user-id');
    headers.set('oai-authenticated-user-id', 'selfhost-owner');
    const internal = new Request(origin + path + url.search, { method: request.method, headers, ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}) });
    return worker.fetch(internal, { ...env, ASSETS: { fetch: r => asset(new URL(r.url).pathname === '/' ? '/index.html' : new URL(r.url).pathname) } });
  }
  const server = createServer(async (req, res) => {
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end(); return; }
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 720000) { res.writeHead(413, security); res.end(); return; }
        chunks.push(chunk);
      }
      const request = new Request(origin + req.url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handle(request, req.headers['x-real-ip'] || req.socket.remoteAddress);
      res.writeHead(response.status, { ...security, ...Object.fromEntries(response.headers) });
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('Request failed', error.name);
      if (!res.headersSent) res.writeHead(503, { ...security, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '服务暂时不可用，请重试。' }));
    }
  });
  server.requestTimeout = 360000;
  server.headersTimeout = 15000;
  server.on('close', () => sql.close());
  return { server, handle, database: DB };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required');
  const { server } = createApplication({ dataDir: process.env.DATA_DIR || '/data', origin: process.env.APP_ORIGIN, basePath: process.env.BASE_PATH || '/', modelService: strategyModel(process.env.MODEL_BRIDGE_DIR || '/run/copilot-model') });
  server.listen(Number(process.env.PORT || 3100), process.env.HOST || '0.0.0.0', () => console.log('Global Copilot is ready'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
