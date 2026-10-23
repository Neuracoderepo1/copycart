import { ROUTES, compile } from './routes.js';
import { describeMethodology, SCORING_VERSION } from './scoring.js';
import { EXCHANGES } from './adapters/index.js';
import { performanceSeries } from './data/store.js';
import { validateEvent, resolveOutbound, sanitizeUtm } from './analytics.js';
import { isValidKey } from './auth.js';

/**
 * @typedef {{ status: number, body?: unknown, headers?: Record<string, string> }} ApiResult
 * @typedef {{
 *   method: string, url: URL, headers: Record<string, string | string[] | undefined>,
 *   json: () => Promise<unknown>, clientId: string
 * }} ApiRequest
 */

/** @param {number} status @param {string} code @param {string} message @returns {ApiResult} */
export function err(status, code, message) {
  return { status, body: { error: { code, message } } };
}

const compiled = ROUTES.map((r) => ({ route: r, ...compile(r.path) }));

/**
 * @param {import('./config.js').Config} config
 * @param {ReturnType<typeof import('./data/store.js').createStore>} store
 * @param {ReturnType<typeof import('./analytics.js').createAnalytics>} analytics
 * @param {ReturnType<typeof import('./auth.js').createRateLimiter>} limiter
 */
export function createApi(config, store, analytics, limiter) {
  /** @param {string | null} v @param {number} d */
  const intParam = (v, d) => {
    if (v === null || v === '') return d;
    if (!/^\d{1,6}$/.test(v)) throw new RangeError('Numeric parameter is invalid.');
    return Number(v);
  };
  /** @param {URL} url @param {string} name @param {string[]} allowed */
  const enumParam = (url, name, allowed) => {
    const v = url.searchParams.get(name);
    if (v === null || v === '') return undefined;
    if (!allowed.includes(v))
      throw new RangeError(`${name} must be one of: ${allowed.join(', ')}.`);
    return v;
  };

  /** @param {ApiRequest} req @returns {Promise<ApiResult>} */
  async function handle(req) {
    let matched = null;
    let params = /** @type {Record<string, string>} */ ({});
    let pathMatched = false;
    for (const c of compiled) {
      const m = c.re.exec(req.url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (c.route.method !== req.method) continue;
      matched = c.route;
      params = Object.fromEntries(c.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      break;
    }
    if (!matched) {
      return pathMatched
        ? err(405, 'method_not_allowed', 'Method not allowed.')
        : err(404, 'not_found', 'Route not found.');
    }

    // Authentication: a presented key must always be valid; some routes demand one.
    const presentedRaw = req.headers['x-api-key'];
    const presented = Array.isArray(presentedRaw) ? presentedRaw[0] : presentedRaw;
    const keyOk = presented !== undefined && isValidKey(presented, config.apiKeyHashes);
    if (presented !== undefined && !keyOk)
      return err(401, 'invalid_api_key', 'API key is invalid.');
    if (
      (matched.auth === 'required' || config.requireKey) &&
      !keyOk &&
      matched.operationId !== 'getHealth'
    ) {
      return err(401, 'api_key_required', 'A valid X-API-Key header is required.');
    }

    const limit = keyOk ? config.rateLimitKey : config.rateLimitAnon;
    const rl = limiter.take(`${keyOk ? 'k' : 'a'}:${req.clientId}`, limit);
    const rlHeaders = {
      'x-ratelimit-limit': String(limit),
      'x-ratelimit-remaining': String(rl.remaining),
    };
    if (!rl.allowed) {
      const r = err(429, 'rate_limited', 'Too many requests.');
      r.headers = { ...rlHeaders, 'retry-after': String(rl.retryAfterSec) };
      return r;
    }

    try {
      const out = await dispatch(matched.operationId, req, params);
      out.headers = { ...rlHeaders, ...out.headers };
      return out;
    } catch (e) {
      if (e instanceof RangeError)
        return { ...err(400, 'invalid_request', e.message), headers: rlHeaders };
      console.error('[api] unexpected error', e instanceof Error ? e.message : 'unknown');
      return { ...err(500, 'internal_error', 'Internal server error.'), headers: rlHeaders };
    }
  }

  /** @param {string} op @param {ApiRequest} req @param {Record<string, string>} params @returns {Promise<ApiResult>} */
  async function dispatch(op, req, params) {
    switch (op) {
      case 'getHealth':
        return {
          status: 200,
          body: {
            status: 'ok',
            version: '0.2.0',
            scoringVersion: SCORING_VERSION,
            dataMode: 'demo',
            liveExchangeData: false,
          },
        };
      case 'getMethodology':
        return { status: 200, body: describeMethodology() };
      case 'listExchanges':
        return {
          status: 200,
          body: { data: EXCHANGES, note: 'No live exchange adapter is enabled in this build.' },
        };
      case 'listTraders': {
        const u = req.url;
        const q = u.searchParams.get('q') ?? '';
        if (q.length > 64) throw new RangeError('q must be at most 64 characters.');
        const exchange = u.searchParams.get('exchange') || undefined;
        if (exchange && !/^[a-z0-9-]{1,32}$/.test(exchange))
          throw new RangeError('exchange is invalid.');
        const pageSize = intParam(u.searchParams.get('pageSize'), 20);
        const page = intParam(u.searchParams.get('page'), 1);
        if (page < 1 || pageSize < 1 || pageSize > 50)
          throw new RangeError('page and pageSize are out of range.');
        const r = await store.listTraders({
          q,
          exchange,
          risk: enumParam(u, 'risk', ['Low', 'Moderate', 'High', 'Unknown']),
          sort: enumParam(u, 'sort', ['score', 'return', 'drawdown', 'name']),
          order: enumParam(u, 'order', ['asc', 'desc']),
          page,
          pageSize,
        });
        return {
          status: 200,
          body: {
            data: r.rows.map(summary),
            page: r.page,
            pageSize: r.pageSize,
            total: r.total,
            dataMode: 'demo',
          },
        };
      }
      case 'getTrader':
      case 'getTraderPerformance':
      case 'getTraderScore': {
        if (!/^[a-z0-9-]{1,64}$/.test(params.id)) throw new RangeError('Trader id is invalid.');
        const t = await store.getTrader(params.id);
        if (!t) return err(404, 'trader_not_found', 'Trader not found.');
        if (op === 'getTrader')
          return { status: 200, body: { data: { ...summary(t), score: t.score } } };
        if (op === 'getTraderScore')
          return { status: 200, body: { data: t.score, methodologyVersion: t.score.version } };
        return {
          status: 200,
          body: {
            data: {
              traderId: t.id,
              source: t.source,
              freshness: t.freshness,
              series: performanceSeries(t),
            },
          },
        };
      }
      case 'postEvent': {
        const ev = validateEvent(await req.json());
        analytics.record(ev);
        return { status: 202, body: { accepted: true } };
      }
      case 'outboundRedirect': {
        const dest = resolveOutbound(params.exchangeId, config.env);
        if (!dest) return err(404, 'unknown_destination', 'Unknown or unavailable destination.');
        const utm = sanitizeUtm(
          Object.fromEntries(
            [...req.url.searchParams]
              .filter(([k]) => k.startsWith('utm_'))
              .map(([k, v]) => [k.slice(4), v]),
          ),
        );
        const trader = req.url.searchParams.get('trader') ?? undefined;
        analytics.record({
          type: 'outbound_click',
          at: new Date().toISOString(),
          exchangeId: params.exchangeId,
          ...(trader && /^[a-z0-9-]{1,64}$/.test(trader) ? { traderId: trader } : {}),
          ...(Object.keys(utm).length ? { utm } : {}),
          attribution: 'click_only',
        });
        return { status: 302, headers: { location: dest, 'cache-control': 'no-store' } };
      }
      case 'analyticsSummary':
        return { status: 200, body: analytics.summary() };
      default:
        return err(404, 'not_found', 'Route not found.');
    }
  }

  return { handle };
}

/** @param {import('./data/store.js').TraderRecord} t */
function summary(t) {
  return {
    id: t.id,
    displayName: t.displayName,
    exchangeId: t.exchangeId,
    strategy: t.strategy,
    markets: t.markets,
    horizon: t.horizon,
    riskLabel: t.riskLabel,
    score: t.score.score,
    scoreStatus: t.score.status,
    confidence: t.score.confidence,
    metrics: t.score.metrics,
    flags: t.score.flags,
    source: t.source,
    freshness: t.freshness,
    isDemo: t.source.kind === 'demo',
  };
}
