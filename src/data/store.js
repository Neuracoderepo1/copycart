import { createAdapters, assertNormalizedTrader } from '../adapters/index.js';
import { scoreTrader } from '../scoring.js';

/**
 * @typedef {import('../adapters/index.js').NormalizedTrader} NormalizedTrader
 * @typedef {import('../scoring.js').ScoreResult} ScoreResult
 * @typedef {'Low' | 'Moderate' | 'High' | 'Unknown'} RiskLabel
 * @typedef {NormalizedTrader & {
 *   score: ScoreResult, riskLabel: RiskLabel,
 *   freshness: { lastObservation: string | null, ageDays: number | null }
 * }} TraderRecord
 */

const DAY_MS = 86_400_000;

/** @param {ScoreResult} s @returns {RiskLabel} */
export function riskLabel(s) {
  const mdd = s.metrics.maxDrawdown;
  if (s.status !== 'scored' || mdd === null) return 'Unknown';
  if (mdd < 0.1) return 'Low';
  if (mdd < 0.25) return 'Moderate';
  return 'High';
}

/** @param {{ now?: () => Date }} [opts] */
export function createStore(opts = {}) {
  const now = opts.now ?? (() => new Date());
  const adapters = createAdapters();
  /** @type {TraderRecord[] | null} */
  let cache = null;
  let cacheDay = '';

  async function load() {
    const today = now().toISOString().slice(0, 10);
    if (cache && cacheDay === today) return cache;
    const raw = (await Promise.all(adapters.map((a) => a.listTraders({ now: now() })))).flat();
    cache = raw.map((r) => {
      const t = assertNormalizedTrader(r);
      const score = scoreTrader(t.observations, t.source, { asOf: now().toISOString() });
      const last = t.observations.length ? t.observations[t.observations.length - 1].ts : null;
      return {
        ...t,
        score,
        riskLabel: riskLabel(score),
        freshness: {
          lastObservation: last,
          ageDays: last ? Math.max(0, (now().getTime() - Date.parse(last)) / DAY_MS) : null,
        },
      };
    });
    cacheDay = today;
    return cache;
  }

  /**
   * @param {{ q?: string, exchange?: string, risk?: string, sort?: string, order?: string, page?: number, pageSize?: number }} query
   */
  async function listTraders(query) {
    const all = await load();
    const q = (query.q ?? '').trim().toLowerCase();
    let rows = all.filter((t) => {
      const hay =
        `${t.displayName} ${t.strategy} ${t.markets.join(' ')} ${t.horizon}`.toLowerCase();
      return (
        (!q || hay.includes(q)) &&
        (!query.exchange || t.exchangeId === query.exchange) &&
        (!query.risk || t.riskLabel === query.risk)
      );
    });
    const sort = query.sort ?? 'score';
    const dir = query.order === 'asc' ? 1 : -1;
    /** @param {TraderRecord} t @returns {number | string} */
    const key = (t) =>
      sort === 'name'
        ? t.displayName.toLowerCase()
        : sort === 'drawdown'
          ? (t.score.metrics.maxDrawdown ?? Infinity)
          : sort === 'return'
            ? (t.score.metrics.totalReturn ?? -Infinity)
            : (t.score.score ?? -1);
    rows = [...rows].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const c = ka < kb ? -1 : ka > kb ? 1 : 0;
      return (c || a.id.localeCompare(b.id)) * dir;
    });
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 50);
    const page = Math.max(query.page ?? 1, 1);
    return {
      total: rows.length,
      page,
      pageSize,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  /** @param {string} id */
  async function getTrader(id) {
    return (await load()).find((t) => t.id === id) ?? null;
  }

  return { listTraders, getTrader, adapters };
}

/** Cumulative curve for the performance endpoint. @param {NormalizedTrader} t */
export function performanceSeries(t) {
  let eq = 1;
  return t.observations.map((o) => {
    eq *= 1 + o.ret;
    return { ts: o.ts, periodReturn: o.ret, cumulativeReturn: eq - 1 };
  });
}
