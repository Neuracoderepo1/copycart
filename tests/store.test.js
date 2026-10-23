import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, performanceSeries } from '../src/data/store.js';
import { createAdapters, assertNormalizedTrader, EXCHANGES } from '../src/adapters/index.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const store = () => createStore({ now: () => NOW });

test('every record is labelled demo and none is presented as live', async () => {
  const { rows } = await store().listTraders({});
  assert.ok(rows.length >= 6);
  for (const t of rows) assert.equal(t.source.kind, 'demo');
});

test('text search matches name, strategy and market case-insensitively', async () => {
  const s = store();
  assert.deepEqual(
    (await s.listTraders({ q: 'NORTHSTAR' })).rows.map((r) => r.id),
    ['demo-northstar'],
  );
  assert.ok((await s.listTraders({ q: 'sol' })).rows.every((r) => r.markets.includes('SOL')));
  assert.equal((await s.listTraders({ q: 'zzzz-none' })).total, 0);
});

test('exchange and risk filters combine', async () => {
  const s = store();
  const okx = await s.listTraders({ exchange: 'okx' });
  assert.ok(okx.rows.length > 0 && okx.rows.every((r) => r.exchangeId === 'okx'));
  const high = await s.listTraders({ risk: 'High' });
  assert.ok(high.rows.every((r) => r.riskLabel === 'High'));
});

test('sorting by score desc, drawdown asc and name asc', async () => {
  const s = store();
  const byScore = (await s.listTraders({ sort: 'score' })).rows.map((r) => r.score.score ?? -1);
  assert.deepEqual(
    byScore,
    [...byScore].sort((a, b) => b - a),
  );
  const dd = (await s.listTraders({ sort: 'drawdown', order: 'asc' })).rows.map(
    (r) => r.score.metrics.maxDrawdown ?? Infinity,
  );
  assert.deepEqual(
    dd,
    [...dd].sort((a, b) => a - b),
  );
  const names = (await s.listTraders({ sort: 'name', order: 'asc' })).rows.map((r) =>
    r.displayName.toLowerCase(),
  );
  assert.deepEqual(names, [...names].sort());
});

test('pagination clamps page size and slices correctly', async () => {
  const s = store();
  const p1 = await s.listTraders({ pageSize: 3, page: 1 });
  const p2 = await s.listTraders({ pageSize: 3, page: 2 });
  assert.equal(p1.rows.length, 3);
  assert.notEqual(p1.rows[0].id, p2.rows[0].id);
  assert.equal((await s.listTraders({ pageSize: 9999 })).pageSize, 50);
});

test('insufficient-history trader is listed but unscored and risk Unknown', async () => {
  const t = await store().getTrader('demo-ember');
  assert.equal(t?.score.status, 'insufficient_history');
  assert.equal(t?.riskLabel, 'Unknown');
});

test('freshness: stale fixture is reported old and flagged', async () => {
  const t = await store().getTrader('demo-lantern');
  assert.ok((t?.freshness.ageDays ?? 0) > 15);
  assert.ok(t?.score.flags.some((f) => f.code === 'stale_data'));
  const fresh = await store().getTrader('demo-northstar');
  assert.ok((fresh?.freshness.ageDays ?? 99) < 2);
});

test('unknown trader returns null', async () => {
  assert.equal(await store().getTrader('nope'), null);
});

test('performance series compounds returns', async () => {
  const t = await store().getTrader('demo-harbor');
  assert.ok(t);
  const s = performanceSeries(t);
  assert.equal(s.length, t.observations.length);
  const expected = t.observations.reduce((e, o) => e * (1 + o.ret), 1) - 1;
  assert.ok(Math.abs(s[s.length - 1].cumulativeReturn - expected) < 1e-9);
});

test('adapter contract: planned exchange adapters return no data, never fabricate', async () => {
  const adapters = createAdapters();
  const ids = new Set(EXCHANGES.map((e) => e.id));
  for (const a of adapters.filter((x) => ids.has(x.exchange.id))) {
    assert.equal(a.exchange.status, 'planned');
    assert.deepEqual(await a.listTraders({ now: NOW }), []);
  }
  const demo = adapters.find((a) => a.exchange.id === 'demo');
  assert.equal(demo?.exchange.status, 'demo');
});

test('assertNormalizedTrader rejects malformed or unlabeled records', () => {
  assert.throws(() => assertNormalizedTrader(null), TypeError);
  assert.throws(() => assertNormalizedTrader({ id: 'x' }), TypeError);
  const ok = {
    id: 'a',
    displayName: 'A',
    exchangeId: 'okx',
    strategy: 's',
    horizon: 'h',
    markets: [],
    observations: [],
  };
  assert.throws(() => assertNormalizedTrader({ ...ok, source: { kind: 'live' } }), TypeError);
  assert.doesNotThrow(() => assertNormalizedTrader({ ...ok, source: { kind: 'demo', name: 'x' } }));
});

test('required exchanges are all registered', () => {
  assert.deepEqual(EXCHANGES.map((e) => e.id).sort(), [
    'binance',
    'bingx',
    'bitget',
    'bybit',
    'deribit',
    'okx',
  ]);
});
