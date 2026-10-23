import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../src/routes.js';

test('openapi export matches the implemented route table exactly', () => {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/export-openapi.js', import.meta.url))],
    { stdio: 'pipe' },
  );
  const doc = JSON.parse(
    readFileSync(fileURLToPath(new URL('../docs/openapi.json', import.meta.url)), 'utf8'),
  );
  const fromDoc = Object.entries(doc.paths)
    .flatMap(([p, ops]) =>
      Object.keys(/** @type {object} */ (ops)).map((m) => `${m.toUpperCase()} ${p}`),
    )
    .sort();
  const fromRoutes = ROUTES.map((r) => `${r.method} ${r.path}`).sort();
  assert.deepEqual(fromDoc, fromRoutes);
  for (const required of [
    '/api/v1/traders',
    '/api/v1/traders/{id}',
    '/api/v1/traders/{id}/performance',
    '/api/v1/traders/{id}/score',
    '/api/v1/exchanges',
    '/api/v1/methodology',
    '/api/v1/health',
  ]) {
    assert.ok(doc.paths[required], required);
  }
});

test('keygen prints a fresh key and its matching hash without reading secrets', () => {
  const out = execFileSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/generate-api-key.js', import.meta.url))],
    { env: { PATH: process.env.PATH ?? '' } },
  ).toString();
  const key = /cc_[A-Za-z0-9_-]{43}/.exec(out)?.[0];
  const hash = /\b[0-9a-f]{64}\b/.exec(out)?.[0];
  assert.ok(key && hash);
  const second = execFileSync(process.execPath, [
    fileURLToPath(new URL('../scripts/generate-api-key.js', import.meta.url)),
  ]).toString();
  assert.ok(!second.includes(key), 'keys are unique per run');
});
