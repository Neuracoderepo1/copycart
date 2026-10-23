/**
 * @typedef {{ code: string, severity: 'info' | 'caution', message: string }} Flag
 * @typedef {{
 *   key: string, label: string, score: number | null, weight: number,
 *   value: number | null, explanation: string
 * }} Component
 * @typedef {{
 *   observations: number, periodDays: number | null, totalReturn: number | null,
 *   annualizedSharpe: number | null, maxDrawdown: number | null,
 *   positiveWindowShare: number | null, volatilityDaily: number | null
 * }} Metrics
 * @typedef {{
 *   version: string, status: string, score: number | null, confidence: string,
 *   components: Component[], flags: Flag[], metrics: Metrics,
 *   dataQuality: { received: number, valid: number, dropped: number }
 * }} Score
 * @typedef {{
 *   id: string, displayName: string, exchangeId: string, strategy: string, markets: string[],
 *   horizon: string, riskLabel: string, score: number | null, scoreStatus: string,
 *   confidence: string, metrics: Metrics, flags: Flag[],
 *   source: { kind: string, name: string, note?: string },
 *   freshness: { lastObservation: string | null, ageDays: number | null }, isDemo: boolean
 * }} Trader
 * @typedef {{ id: string, name: string, status: string, restrictions: string }} Exchange
 */

export class ApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** @param {string} path @param {AbortSignal} [signal] */
async function getJson(path, signal) {
  let res;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' }, signal });
  } catch {
    throw new ApiError('Network error: the data service could not be reached.', 0);
  }
  /** @type {any} */
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body: fall through to status handling
  }
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status}).`, res.status);
  }
  return body;
}

/**
 * @param {{ q: string, exchange: string, risk: string, sort: string }} f
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ data: Trader[], total: number }>}
 */
export function fetchTraders(f, signal) {
  const p = new URLSearchParams({ pageSize: '50' });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (f.sort === 'name' || f.sort === 'drawdown') p.set('order', 'asc');
  return getJson(`/api/v1/traders?${p}`, signal);
}

/** @param {string} id @returns {Promise<{ data: Trader & { score: Score } }>} */
export const fetchTrader = (id) => getJson(`/api/v1/traders/${encodeURIComponent(id)}`);

/** @param {string} id @returns {Promise<{ data: { series: Array<{ ts: string, cumulativeReturn: number }> } }>} */
export const fetchPerformance = (id) =>
  getJson(`/api/v1/traders/${encodeURIComponent(id)}/performance`);

/** @returns {Promise<{ data: Exchange[] }>} */
export const fetchExchanges = () => getJson('/api/v1/exchanges');

const UTM_KEY = 'copycart.utm';

/** Capture utm_* params from the landing URL for session-scoped attribution. */
export function captureUtm() {
  const p = new URLSearchParams(location.search);
  /** @type {Record<string, string>} */
  const utm = {};
  for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
    const v = p.get(`utm_${k}`);
    if (v && /^[A-Za-z0-9._~ -]{1,100}$/.test(v)) utm[k] = v;
  }
  try {
    if (Object.keys(utm).length) sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
  } catch {
    // storage may be unavailable (private mode); attribution is best-effort
  }
}

/** @returns {Record<string, string>} */
export function currentUtm() {
  try {
    return JSON.parse(sessionStorage.getItem(UTM_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Fire-and-forget analytics. Never sends search text, IPs or identifiers beyond ids. @param {Record<string, unknown>} event */
export function track(event) {
  const utm = currentUtm();
  fetch('/api/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...event, ...(Object.keys(utm).length ? { utm } : {}) }),
    keepalive: true,
  }).catch(() => {});
}

/** Same-origin outbound URL; the server validates the destination. @param {string} exchangeId @param {string} traderId */
export function outboundUrl(exchangeId, traderId) {
  const p = new URLSearchParams({ trader: traderId });
  for (const [k, v] of Object.entries(currentUtm())) p.set(`utm_${k}`, v);
  return `/api/v1/outbound/${encodeURIComponent(exchangeId)}?${p}`;
}
