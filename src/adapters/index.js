// Exchange adapter layer. The core product only sees NormalizedTrader records.
// Only the demo fixture adapter is implemented. Live adapters are planned and disabled until
// API access, documentation, permissions and redistribution terms have been verified.

import { buildFixtureTraders } from '../data/fixtures.js';

/**
 * @typedef {{ kind: 'demo' | 'verified_live' | 'unverified_live', name: string, note?: string }} SourceMeta
 * @typedef {{
 *   id: string, displayName: string, exchangeId: string, strategy: string, markets: string[],
 *   horizon: string, source: SourceMeta, observations: Array<{ ts: string, ret: number }>
 * }} NormalizedTrader
 * @typedef {{
 *   id: string, name: string, status: 'demo' | 'planned' | 'live',
 *   restrictions: string
 * }} ExchangeInfo
 * @typedef {{
 *   exchange: ExchangeInfo,
 *   listTraders: (ctx: { now: Date }) => Promise<NormalizedTrader[]>
 * }} ExchangeAdapter
 */

const UNVERIFIED =
  'Not yet verified: API access, authentication, rate limits, historical coverage and commercial ' +
  'redistribution terms must be confirmed against the exchange documentation before a live adapter is enabled.';

/** @type {ExchangeInfo[]} */
export const EXCHANGES = [
  { id: 'binance', name: 'Binance', status: 'planned', restrictions: UNVERIFIED },
  { id: 'bybit', name: 'Bybit', status: 'planned', restrictions: UNVERIFIED },
  { id: 'okx', name: 'OKX', status: 'planned', restrictions: UNVERIFIED },
  { id: 'bitget', name: 'Bitget', status: 'planned', restrictions: UNVERIFIED },
  { id: 'bingx', name: 'BingX', status: 'planned', restrictions: UNVERIFIED },
  { id: 'deribit', name: 'Deribit', status: 'planned', restrictions: UNVERIFIED },
];

/**
 * Planned adapters intentionally return nothing and never fabricate data.
 * @param {ExchangeInfo} exchange
 * @returns {ExchangeAdapter}
 */
function plannedAdapter(exchange) {
  return { exchange, listTraders: async () => [] };
}

/** @param {Date} d */
function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** @returns {ExchangeAdapter} */
export function createFixtureAdapter() {
  return {
    exchange: {
      id: 'demo',
      name: 'Demo fixtures',
      status: 'demo',
      restrictions: 'Synthetic data only.',
    },
    listTraders: async ({ now }) => buildFixtureTraders(startOfUtcDay(now).toISOString()),
  };
}

export function createAdapters() {
  return [createFixtureAdapter(), ...EXCHANGES.map(plannedAdapter)];
}

/**
 * Contract check used by tests and at load. Throws on records a UI could mislabel.
 * @param {unknown} t
 * @returns {NormalizedTrader}
 */
export function assertNormalizedTrader(t) {
  if (!t || typeof t !== 'object') throw new TypeError('trader must be an object');
  const r = /** @type {Record<string, unknown>} */ (t);
  for (const k of ['id', 'displayName', 'exchangeId', 'strategy', 'horizon']) {
    if (typeof r[k] !== 'string' || !r[k])
      throw new TypeError(`trader.${k} must be a non-empty string`);
  }
  if (!Array.isArray(r.markets) || !Array.isArray(r.observations)) {
    throw new TypeError('trader.markets and trader.observations must be arrays');
  }
  const src = /** @type {Record<string, unknown> | undefined} */ (r.source);
  if (!src || !['demo', 'verified_live', 'unverified_live'].includes(String(src.kind))) {
    throw new TypeError('trader.source.kind must be demo, verified_live or unverified_live');
  }
  return /** @type {NormalizedTrader} */ (t);
}
