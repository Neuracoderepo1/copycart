'use strict';
// End-to-end smoke test: starts the real server process and makes real HTTP requests.
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const PORT = 3100 + Math.floor(Math.random() * 800);
/** @param {string} p @param {object} [o] */
function get(p, o = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, ...o }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
  console.log(`ok  ${msg}`);
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        await get('/api/v1/health');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const health = await get('/api/v1/health');
    assert(
      health.status === 200 && JSON.parse(health.body).dataMode === 'demo',
      'health reports demo data mode',
    );
    const list = JSON.parse((await get('/api/v1/traders')).body);
    assert(
      list.total >= 6 && list.data.every((/** @type {{isDemo: boolean}} */ t) => t.isDemo),
      'traders list is labelled demo',
    );
    const one = await get(`/api/v1/traders/${list.data[0].id}/score`);
    assert(
      one.status === 200 && Array.isArray(JSON.parse(one.body).data.components),
      'score endpoint returns components',
    );
    assert((await get('/api/v1/traders/nope-x')).status === 404, 'unknown trader is 404');
    assert((await get('/api/v1/traders?sort=bogus')).status === 400, 'invalid sort is 400');
    assert(
      (await get('/api/v1/health', { headers: { 'x-api-key': 'bad' } })).status === 401,
      'bad API key is 401',
    );
    const out = await get('/api/v1/outbound/binance?utm_campaign=smoke');
    assert(
      out.status === 302 && new URL(String(out.headers.location)).hostname.endsWith('binance.com'),
      'outbound redirect is allow-listed',
    );
    assert(
      (await get('/api/v1/outbound/evil.com')).status === 404,
      'unknown outbound destination rejected',
    );
    const page = await get('/');
    assert(
      page.status === 200 &&
        page.body.includes('CopyCart') &&
        !!page.headers['content-security-policy'],
      'index served with CSP',
    );
    assert((await get('/..%2f..%2fpackage.json')).status !== 200, 'path traversal blocked');
    console.log('Smoke test passed.');
  } finally {
    child.kill();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
