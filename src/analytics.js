// Referral analytics. Click-level only. No IPs, cookies, user agents or free-text identifiers stored.
// An outbound click is NOT a registration or deposit; no conversion is ever reported here.

export const EVENT_TYPES = ['profile_view', 'search', 'filter', 'compare', 'outbound_click'];
const SAFE = /^[A-Za-z0-9._~ -]{1,100}$/;
const ID = /^[a-z0-9-]{1,64}$/;
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'];

/**
 * @typedef {{
 *   type: string, at: string, traderId?: string, traderIds?: string[], exchangeId?: string,
 *   usedQuery?: boolean, filters?: Record<string, string>,
 *   utm?: Record<string, string>, attribution?: 'click_only'
 * }} AnalyticsEvent
 */

/** @param {unknown} u @returns {Record<string, string>} */
export function sanitizeUtm(u) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!u || typeof u !== 'object') return out;
  const o = /** @type {Record<string, unknown>} */ (u);
  for (const k of UTM_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && SAFE.test(v)) out[k] = v;
  }
  return out;
}

/**
 * Validate and normalise an inbound event. Throws RangeError with a safe message.
 * @param {unknown} body
 * @param {Date} [now]
 * @returns {AnalyticsEvent}
 */
export function validateEvent(body, now = new Date()) {
  if (!body || typeof body !== 'object') throw new RangeError('Event must be a JSON object.');
  const b = /** @type {Record<string, unknown>} */ (body);
  if (typeof b.type !== 'string' || !EVENT_TYPES.includes(b.type)) {
    throw new RangeError(`type must be one of: ${EVENT_TYPES.join(', ')}.`);
  }
  /** @type {AnalyticsEvent} */
  const ev = { type: b.type, at: now.toISOString() };
  if (b.traderId !== undefined) {
    if (typeof b.traderId !== 'string' || !ID.test(b.traderId))
      throw new RangeError('Invalid traderId.');
    ev.traderId = b.traderId;
  }
  if (b.exchangeId !== undefined) {
    if (typeof b.exchangeId !== 'string' || !ID.test(b.exchangeId))
      throw new RangeError('Invalid exchangeId.');
    ev.exchangeId = b.exchangeId;
  }
  if (b.traderIds !== undefined) {
    if (
      !Array.isArray(b.traderIds) ||
      b.traderIds.length > 3 ||
      !b.traderIds.every((x) => typeof x === 'string' && ID.test(x))
    ) {
      throw new RangeError('traderIds must be up to 3 valid ids.');
    }
    ev.traderIds = b.traderIds;
  }
  if (typeof b.usedQuery === 'boolean') ev.usedQuery = b.usedQuery; // never the query text itself
  if (b.filters && typeof b.filters === 'object') {
    ev.filters = {};
    for (const k of ['exchange', 'risk', 'sort']) {
      const v = /** @type {Record<string, unknown>} */ (b.filters)[k];
      if (typeof v === 'string' && /^[a-z0-9-]{1,32}$/i.test(v)) ev.filters[k] = v;
    }
  }
  const utm = sanitizeUtm(b.utm);
  if (Object.keys(utm).length) ev.utm = utm;
  if (ev.type === 'compare' && (!ev.traderIds || ev.traderIds.length < 2)) {
    throw new RangeError('compare events need at least 2 traderIds.');
  }
  return ev;
}

/**
 * Resolve a safe outbound destination. Only https URLs on an allow-listed domain are accepted,
 * so the endpoint can never be used as an open redirect.
 * @param {string} exchangeId
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function resolveOutbound(exchangeId, env) {
  /** @type {Record<string, string>} */
  const allowed = {
    binance: 'binance.com',
    bybit: 'bybit.com',
    okx: 'okx.com',
    bitget: 'bitget.com',
    bingx: 'bingx.com',
    deribit: 'deribit.com',
  };
  const domain = allowed[exchangeId];
  if (!domain) return null;
  const configured = env[`REFERRAL_URL_${exchangeId.toUpperCase()}`] || `https://www.${domain}/`;
  try {
    const u = new URL(configured);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (u.hostname !== domain && !u.hostname.endsWith(`.${domain}`)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function createAnalytics(max = 5000) {
  /** @type {AnalyticsEvent[]} */
  const events = [];
  return {
    /** @param {AnalyticsEvent} e */
    record(e) {
      events.push(e);
      if (events.length > max) events.shift();
    },
    summary() {
      /** @type {Record<string, number>} */
      const byType = {};
      /** @type {Record<string, number>} */
      const byCampaign = {};
      for (const e of events) {
        byType[e.type] = (byType[e.type] ?? 0) + 1;
        const c = e.utm?.campaign;
        if (c && e.type === 'outbound_click') byCampaign[c] = (byCampaign[c] ?? 0) + 1;
      }
      return {
        events: events.length,
        byType,
        outboundClicksByCampaign: byCampaign,
        conversions: null,
        conversionNote:
          'Outbound clicks are not registrations or deposits. Conversions are unavailable until verified partner data is connected.',
      };
    },
  };
}
