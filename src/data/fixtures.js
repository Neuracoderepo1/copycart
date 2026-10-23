// DEMO FIXTURES. Synthetic, deterministic, and NOT exchange data.
// Every record carries source.kind === 'demo' and is labelled as such end to end.

/** @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller using the seeded generator. @param {() => number} rnd */
function gauss(rnd) {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

const DAY_MS = 86_400_000;

/**
 * @typedef {{
 *   seed: number, n: number, drift: number, vol: number,
 *   endLagDays?: number, shock?: { at: number, size: number }
 * }} SeriesParams
 */

/**
 * @param {SeriesParams & { endDate: string }} p
 * @returns {Array<{ ts: string, ret: number }>}
 */
export function synthSeries(p) {
  const rnd = mulberry32(p.seed);
  const end = Date.parse(p.endDate) - (p.endLagDays ?? 0) * DAY_MS;
  const out = [];
  for (let i = 0; i < p.n; i++) {
    let ret = p.drift + p.vol * gauss(rnd);
    if (p.shock && p.shock.at === i) ret = p.shock.size;
    out.push({
      ts: new Date(end - (p.n - 1 - i) * DAY_MS).toISOString(),
      ret: Math.max(ret, -0.9),
    });
  }
  return out;
}

/**
 * @typedef {{
 *   id: string, displayName: string, exchangeId: string, strategy: string,
 *   markets: string[], horizon: string, series: SeriesParams
 * }} FixtureDef
 */

/** @type {FixtureDef[]} */
export const FIXTURE_DEFS = [
  {
    id: 'demo-northstar',
    displayName: 'Northstar',
    exchangeId: 'binance',
    strategy: 'Trend following',
    markets: ['BTC', 'ETH'],
    horizon: 'Swing',
    series: { seed: 11, n: 150, drift: 0.0021, vol: 0.016 },
  },
  {
    id: 'demo-orbit',
    displayName: 'Orbit',
    exchangeId: 'bybit',
    strategy: 'Momentum',
    markets: ['BTC', 'SOL'],
    horizon: 'Short-term',
    series: { seed: 22, n: 140, drift: 0.0026, vol: 0.034 },
  },
  {
    id: 'demo-harbor',
    displayName: 'Harbor',
    exchangeId: 'okx',
    strategy: 'Steady allocation',
    markets: ['BTC', 'ETH'],
    horizon: 'Long-term',
    series: { seed: 33, n: 180, drift: 0.0009, vol: 0.006 },
  },
  {
    id: 'demo-pulse',
    displayName: 'Pulse',
    exchangeId: 'bitget',
    strategy: 'Mean reversion',
    markets: ['ETH', 'SOL'],
    horizon: 'Intraday',
    series: { seed: 44, n: 120, drift: 0.0012, vol: 0.02 },
  },
  {
    id: 'demo-vector',
    displayName: 'Vector',
    exchangeId: 'deribit',
    strategy: 'Options carry',
    markets: ['BTC'],
    horizon: 'Swing',
    series: { seed: 55, n: 110, drift: 0.0007, vol: 0.011, shock: { at: 70, size: -0.12 } },
  },
  {
    id: 'demo-glide',
    displayName: 'Glide',
    exchangeId: 'bingx',
    strategy: 'Grid',
    markets: ['BTC', 'ETH'],
    horizon: 'Short-term',
    series: { seed: 66, n: 120, drift: 0.0035, vol: 0.0012 },
  },
  {
    id: 'demo-ember',
    displayName: 'Ember',
    exchangeId: 'binance',
    strategy: 'Breakout',
    markets: ['SOL'],
    horizon: 'Intraday',
    series: { seed: 77, n: 18, drift: 0.004, vol: 0.03 },
  },
  {
    id: 'demo-lantern',
    displayName: 'Lantern',
    exchangeId: 'okx',
    strategy: 'Basis trading',
    markets: ['BTC', 'ETH'],
    horizon: 'Long-term',
    series: { seed: 88, n: 100, drift: 0.0011, vol: 0.008, endLagDays: 21 },
  },
];

/** @param {string} endDate ISO timestamp of the newest observation to generate */
export function buildFixtureTraders(endDate) {
  return FIXTURE_DEFS.map((d) => ({
    id: d.id,
    displayName: d.displayName,
    exchangeId: d.exchangeId,
    strategy: d.strategy,
    markets: d.markets,
    horizon: d.horizon,
    source: {
      kind: /** @type {const} */ ('demo'),
      name: 'CopyCart synthetic demo fixture',
      note: 'Synthetic data generated deterministically for demonstration. Not exchange data.',
    },
    observations: synthSeries({ ...d.series, endDate }),
  }));
}
