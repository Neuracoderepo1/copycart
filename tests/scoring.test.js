import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreTrader,
  WEIGHTS,
  SCORING_VERSION,
  maxDrawdown,
  totalReturn,
  cleanObservations,
  MIN_OBSERVATIONS,
} from '../src/scoring.js';
import { synthSeries } from '../src/data/fixtures.js';

const END = '2026-10-01T00:00:00.000Z';
const demo = { kind: /** @type {const} */ ('demo') };
const live = { kind: /** @type {const} */ ('verified_live') };
/** @param {Partial<Parameters<typeof synthSeries>[0]>} [o] */
const series = (o = {}) =>
  synthSeries({ seed: 1, n: 120, drift: 0.002, vol: 0.015, endDate: END, ...o });

test('weights sum to 1 and version is provisional', () => {
  assert.ok(Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.match(SCORING_VERSION, /provisional/);
});

test('scoring is deterministic for identical input', () => {
  const a = scoreTrader(series(), demo, { asOf: END });
  const b = scoreTrader(series(), demo, { asOf: END });
  assert.deepEqual(a, b);
});

test('score and components are bounded 0-100 and explained', () => {
  const r = scoreTrader(series(), live, { asOf: END });
  assert.equal(r.status, 'scored');
  assert.ok(r.score !== null && r.score >= 0 && r.score <= 100);
  assert.equal(r.components.length, 4);
  for (const c of r.components) {
    assert.ok(c.explanation.length > 20);
    assert.ok(c.score === null || (c.score >= 0 && c.score <= 100));
  }
});

test('insufficient history yields no score, not a made-up one', () => {
  const r = scoreTrader(series({ n: MIN_OBSERVATIONS - 1 }), demo, { asOf: END });
  assert.equal(r.status, 'insufficient_history');
  assert.equal(r.score, null);
  assert.ok(r.flags.some((f) => f.code === 'insufficient_history'));
});

test('empty and non-array input are unscorable without throwing', () => {
  assert.equal(scoreTrader([], demo).status, 'unscorable');
  assert.equal(scoreTrader(null, demo).status, 'unscorable');
  assert.equal(scoreTrader('nope', demo).score, null);
});

test('invalid values are dropped and reported', () => {
  const bad = [
    ...series(),
    { ts: 'not-a-date', ret: 0.01 },
    { ts: END, ret: Number.NaN },
    { ts: END, ret: -1.5 },
    null,
    { ts: END, ret: '0.1' },
  ];
  const r = scoreTrader(bad, demo, { asOf: END });
  assert.equal(r.dataQuality.dropped, 5);
  assert.ok(r.flags.some((f) => f.code === 'invalid_values_dropped'));
  assert.equal(r.status, 'scored');
});

test('duplicate timestamps keep one observation (last wins)', () => {
  const s = series({ n: 40 });
  const { obs } = cleanObservations([...s, { ts: s[5].ts, ret: 0.5 }]);
  assert.equal(obs.length, 40);
  assert.equal(obs.find((o) => o.t === Date.parse(s[5].ts))?.ret, 0.5);
});

test('zero variance: risk-adjusted component is null and weight is renormalized', () => {
  const flat = series().map((o) => ({ ...o, ret: 0.001 }));
  const r = scoreTrader(flat, demo, { asOf: END });
  const rar = r.components.find((c) => c.key === 'riskAdjustedReturn');
  assert.equal(rar?.score, null);
  assert.equal(r.metrics.annualizedSharpe, null);
  assert.ok(r.score !== null && Number.isFinite(r.score));
});

test('stale data lowers reliability and raises a flag', () => {
  const fresh = scoreTrader(series(), live, { asOf: END });
  const stale = scoreTrader(series(), live, { asOf: '2026-11-15T00:00:00.000Z' });
  const rel = (/** @type {typeof fresh} */ r) =>
    r.components.find((c) => c.key === 'dataReliability')?.score ?? 0;
  assert.ok(rel(stale) < rel(fresh));
  assert.ok(stale.flags.some((f) => f.code === 'stale_data'));
  assert.ok(!fresh.flags.some((f) => f.code === 'stale_data'));
});

test('demo source can never report high confidence', () => {
  assert.equal(scoreTrader(series(), demo, { asOf: END }).confidence, 'demo');
});

test('different observation periods: gaps reduce coverage and are flagged', () => {
  const sparse = series({ n: 200 }).filter((_o, i) => i % 3 === 0);
  const r = scoreTrader(sparse, live, { asOf: END });
  assert.ok(r.flags.some((f) => f.code === 'gappy_history'));
});

test('higher drawdown yields a lower drawdown component', () => {
  const calm = scoreTrader(series({ vol: 0.005 }), live, { asOf: END });
  const wild = scoreTrader(series({ vol: 0.05, drift: 0 }), live, { asOf: END });
  const dd = (/** @type {typeof calm} */ r) =>
    r.components.find((c) => c.key === 'drawdown')?.score ?? 0;
  assert.ok(dd(calm) > dd(wild));
});

test('extreme inputs do not produce NaN or Infinity', () => {
  const s = series().map((o, i) => (i === 50 ? { ...o, ret: 9.9 } : o));
  const r = scoreTrader(s, live, { asOf: END });
  assert.ok(Number.isFinite(r.score));
  assert.ok(
    r.flags.some(
      (f) => f.code === 'extreme_outlier_period' || f.code === 'single_period_concentration',
    ),
  );
});

test('anomaly flag wording is non-accusatory', () => {
  const smooth = scoreTrader(series({ vol: 0.0005, drift: 0.003 }), live, { asOf: END });
  const flag = smooth.flags.find((f) => f.code === 'unusually_smooth_returns');
  assert.ok(flag);
  assert.doesNotMatch(flag.message, /fraud|wash|manipulat|fake|cheat/i);
});

test('math helpers', () => {
  assert.ok(Math.abs(maxDrawdown([0.1, -0.5, 0.2]) - 0.5) < 1e-9);
  assert.equal(maxDrawdown([0.1, 0.1]), 0);
  assert.ok(Math.abs(totalReturn([0.1, 0.1]) - 0.21) < 1e-9);
});
