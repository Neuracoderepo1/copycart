import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server.js';
import { hashKey, isValidKey, createRateLimiter } from '../src/auth.js';
import { randomBytes } from 'node:crypto';

const KEY = `cc_${randomBytes(32).toString('base64url')}`;
/** @type {string} */ let base;
/** @type {import('node:http').Server} */ let server;
/** @type {string} */ let limitedBase;
/** @type {import('node:http').Server} */ let limitedServer;

/** @param {import('node:http').Server} s */
const listen = (s) =>
  new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () =>
      resolve(
        `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (s.address()).port}`,
      ),
    ),
  );

before(async () => {
  ({ server } = createAppServer({ apiKeyHashes: [hashKey(KEY)], rateLimitAnon: 1000 }));
  base = /** @type {string} */ (await listen(server));
  ({ server: limitedServer } = createAppServer({ rateLimitAnon: 3 }));
  limitedBase = /** @type {string} */ (await listen(limitedServer));
});
after(() => {
  server.close();
  limitedServer.close();
  server.closeAllConnections();
  limitedServer.closeAllConnections();
});

/** @param {string} path @param {RequestInit} [init] */
const call = (path, init) => fetch(base + path, { redirect: 'manual', ...init });

/** @param {string} path @param {RequestInit} [init] */
const callJson = async (path, init) => /** @type {any} */ (await (await call(path, init)).json());

test('health reports demo mode and no live data', async () => {
  const b = await callJson('/api/v1/health');
  assert.equal(b.status, 'ok');
  assert.equal(b.dataMode, 'demo');
  assert.equal(b.liveExchangeData, false);
});

test('methodology and exchanges expose provisional status and planned adapters', async () => {
  const m = await callJson('/api/v1/methodology');
  assert.equal(m.status, 'provisional');
  const e = await callJson('/api/v1/exchanges');
  assert.ok(e.data.every((/** @type {{status: string}} */ x) => x.status === 'planned'));
});

test('traders list, detail, performance and score endpoints', async () => {
  const list = await callJson('/api/v1/traders?sort=score&pageSize=3');
  assert.equal(list.data.length, 3);
  assert.ok(list.data.every((/** @type {{isDemo: boolean}} */ t) => t.isDemo));
  const id = list.data[0].id;
  const detail = await callJson(`/api/v1/traders/${id}`);
  assert.equal(detail.data.id, id);
  const perf = await callJson(`/api/v1/traders/${id}/performance`);
  assert.ok(perf.data.series.length > 30);
  const score = await callJson(`/api/v1/traders/${id}/score`);
  assert.equal(score.data.components.length, 4);
});

test('validation: bad params return 400 with a safe error shape', async () => {
  for (const q of [
    'sort=bogus',
    'risk=Extreme',
    'page=0',
    'pageSize=500',
    'page=abc',
    `q=${'a'.repeat(100)}`,
    'exchange=%3Cscript%3E',
  ]) {
    const r = await call(`/api/v1/traders?${q}`);
    assert.equal(r.status, 400, q);
    const b = /** @type {any} */ (await r.json());
    assert.equal(b.error.code, 'invalid_request');
  }
});

test('404 for unknown route and trader; 405 for wrong method', async () => {
  assert.equal((await call('/api/v1/nope')).status, 404);
  assert.equal((await call('/api/v1/traders/unknown-id')).status, 404);
  assert.equal((await call('/api/v1/traders/Bad%20Id')).status, 400);
  assert.equal((await call('/api/v1/traders', { method: 'POST' })).status, 405);
});

test('auth: invalid key is 401; analytics summary needs a valid key', async () => {
  assert.equal((await call('/api/v1/traders', { headers: { 'x-api-key': 'wrong' } })).status, 401);
  assert.equal((await call('/api/v1/analytics/summary')).status, 401);
  const ok = await call('/api/v1/analytics/summary', { headers: { 'x-api-key': KEY } });
  assert.equal(ok.status, 200);
  assert.equal(/** @type {any} */ (await ok.json()).conversions, null);
});

test('auth helpers: format checks, constant-time compare, hash only', () => {
  assert.equal(isValidKey(KEY, [hashKey(KEY)]), true);
  assert.equal(isValidKey(KEY, []), false);
  assert.equal(isValidKey(undefined, [hashKey(KEY)]), false);
  assert.equal(isValidKey('cc_short', [hashKey('cc_short')]), false);
});

test('requireKey mode protects data routes but leaves health open', async () => {
  const { server: s } = createAppServer({ requireKey: true, apiKeyHashes: [hashKey(KEY)] });
  const url = /** @type {string} */ (await listen(s));
  try {
    assert.equal((await fetch(`${url}/api/v1/traders`)).status, 401);
    assert.equal(
      (await fetch(`${url}/api/v1/traders`, { headers: { 'x-api-key': KEY } })).status,
      200,
    );
    assert.equal((await fetch(`${url}/api/v1/health`)).status, 200);
  } finally {
    s.close();
    s.closeAllConnections();
  }
});

test('rate limiting returns 429 with retry-after', async () => {
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(`${limitedBase}/api/v1/health`)).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  const r = await fetch(`${limitedBase}/api/v1/health`);
  assert.ok(Number(r.headers.get('retry-after')) >= 0);
});

test('rate limiter window resets', () => {
  let t = 0;
  const l = createRateLimiter(1000, () => t);
  assert.equal(l.take('a', 1).allowed, true);
  assert.equal(l.take('a', 1).allowed, false);
  t = 1001;
  assert.equal(l.take('a', 1).allowed, true);
});

test('events: accepts valid, rejects invalid, enforces JSON type and size', async () => {
  const post = (/** @type {string} */ body, type = 'application/json') =>
    call('/api/v1/events', { method: 'POST', headers: { 'content-type': type }, body });
  assert.equal(
    (await post(JSON.stringify({ type: 'profile_view', traderId: 'demo-harbor' }))).status,
    202,
  );
  assert.equal((await post(JSON.stringify({ type: 'bogus' }))).status, 400);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post('x', 'text/plain')).status, 400);
  const big = JSON.stringify({ type: 'search', pad: 'x'.repeat(10_000) });
  const r = await post(big).catch(() => null);
  assert.ok(r === null || r.status === 400);
});

test('outbound redirect: allow-listed, records click, never a conversion', async () => {
  const r = await call('/api/v1/outbound/bybit?trader=demo-orbit&utm_source=t&utm_campaign=c1');
  assert.equal(r.status, 302);
  assert.ok(new URL(r.headers.get('location') ?? '').hostname.endsWith('bybit.com'));
  assert.equal((await call('/api/v1/outbound/evil.com')).status, 404);
  assert.equal((await call('/api/v1/outbound/%2F%2Fevil.com')).status, 404);
  const s = await callJson('/api/v1/analytics/summary', { headers: { 'x-api-key': KEY } });
  assert.ok(s.byType.outbound_click >= 1);
  assert.equal(s.outboundClicksByCampaign.c1, 1);
  assert.equal(s.conversions, null);
});

test('outbound redirect refuses unsafe configured referral URLs', async () => {
  const prev = process.env.REFERRAL_URL_OKX;
  process.env.REFERRAL_URL_OKX = 'https://evil.example/';
  try {
    const { server: s } = createAppServer();
    const url = /** @type {string} */ (await listen(s));
    try {
      assert.equal((await fetch(`${url}/api/v1/outbound/okx`, { redirect: 'manual' })).status, 404);
    } finally {
      s.close();
      s.closeAllConnections();
    }
  } finally {
    if (prev === undefined) delete process.env.REFERRAL_URL_OKX;
    else process.env.REFERRAL_URL_OKX = prev;
  }
});

test('static: index served with security headers; traversal and unknown types blocked', async () => {
  const r = await call('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const html = await r.text();
  assert.match(html, /CopyCart/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/, 'no inline scripts under CSP');
  for (const p of [
    '/..%2f..%2fpackage.json',
    '/%2e%2e/package.json',
    '/js/tsconfig.json',
    '/nope.txt',
    '/%00',
  ]) {
    assert.notEqual((await call(p)).status, 200, p);
  }
  assert.equal((await call('/js/app.js')).status, 200);
});

test('unexpected errors do not leak internals', async () => {
  const r = await call('/api/v1/traders/' + 'a'.repeat(200));
  const text = await r.text();
  assert.doesNotMatch(text, /at .*\.js|node_modules|stack/i);
});
