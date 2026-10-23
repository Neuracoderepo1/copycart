import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, resolveOutbound, sanitizeUtm, createAnalytics } from '../src/analytics.js';

test('valid events normalise; free-text search is never stored', () => {
  const ev = validateEvent({ type: 'search', usedQuery: true, q: 'secret@example.com' });
  assert.equal(ev.usedQuery, true);
  assert.ok(!JSON.stringify(ev).includes('secret'));
});

test('invalid events are rejected with safe messages', () => {
  assert.throws(() => validateEvent(null), RangeError);
  assert.throws(() => validateEvent({ type: 'purchase' }), RangeError);
  assert.throws(() => validateEvent({ type: 'profile_view', traderId: '../etc' }), RangeError);
  assert.throws(() => validateEvent({ type: 'compare', traderIds: ['a'] }), RangeError);
  assert.throws(
    () => validateEvent({ type: 'compare', traderIds: ['a', 'b', 'c', 'd'] }),
    RangeError,
  );
});

test('utm values are sanitised', () => {
  assert.deepEqual(
    sanitizeUtm({ source: 'x', campaign: '<script>', medium: 'a'.repeat(200), bogus: 'y' }),
    { source: 'x' },
  );
});

test('outbound: default destinations are https on the exchange domain', () => {
  const u = new URL(resolveOutbound('okx', {}) ?? '');
  assert.equal(u.protocol, 'https:');
  assert.ok(u.hostname.endsWith('okx.com'));
});

test('outbound: open-redirect attempts are refused', () => {
  const bad = [
    'https://evil.com/',
    'http://www.okx.com/',
    'https://okx.com.evil.com/',
    'https://evil.com/?u=okx.com',
    'https://user:pw@okx.com/',
    'javascript:alert(1)',
    '//evil.com',
    'not a url',
  ];
  for (const b of bad) assert.equal(resolveOutbound('okx', { REFERRAL_URL_OKX: b }), null, b);
  assert.equal(resolveOutbound('unknown', {}), null);
  assert.ok(resolveOutbound('okx', { REFERRAL_URL_OKX: 'https://www.okx.com/join/ABC' }));
});

test('summary never reports conversions', () => {
  const a = createAnalytics();
  a.record({
    type: 'outbound_click',
    at: new Date().toISOString(),
    exchangeId: 'okx',
    utm: { campaign: 'c1' },
    attribution: 'click_only',
  });
  const s = a.summary();
  assert.equal(s.conversions, null);
  assert.equal(s.outboundClicksByCampaign.c1, 1);
});

test('event buffer is bounded', () => {
  const a = createAnalytics(3);
  for (let i = 0; i < 10; i++) a.record({ type: 'search', at: String(i) });
  assert.equal(a.summary().events, 3);
});
