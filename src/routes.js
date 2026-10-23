// Single source of truth for routes. The router, auth rules and OpenAPI export all read this.

/**
 * @typedef {{
 *   method: 'GET' | 'POST', path: string, operationId: string, summary: string,
 *   auth: 'none' | 'required', query?: Array<{ name: string, description: string, schema: Record<string, unknown> }>,
 *   body?: boolean
 * }} Route
 */

/** @type {Route[]} */
export const ROUTES = [
  {
    method: 'GET',
    path: '/api/v1/health',
    operationId: 'getHealth',
    auth: 'none',
    summary: 'Service health and data mode',
  },
  {
    method: 'GET',
    path: '/api/v1/methodology',
    operationId: 'getMethodology',
    auth: 'none',
    summary: 'Scoring methodology, version and limitations',
  },
  {
    method: 'GET',
    path: '/api/v1/exchanges',
    operationId: 'listExchanges',
    auth: 'none',
    summary: 'Exchanges and adapter status (demo, planned or live)',
  },
  {
    method: 'GET',
    path: '/api/v1/traders',
    operationId: 'listTraders',
    auth: 'none',
    summary: 'Search, filter, sort and paginate traders',
    query: [
      {
        name: 'q',
        description: 'Text search over name, strategy, markets, horizon',
        schema: { type: 'string', maxLength: 64 },
      },
      { name: 'exchange', description: 'Exchange id', schema: { type: 'string' } },
      {
        name: 'risk',
        description: 'Risk label',
        schema: { type: 'string', enum: ['Low', 'Moderate', 'High', 'Unknown'] },
      },
      {
        name: 'sort',
        description: 'Sort key',
        schema: { type: 'string', enum: ['score', 'return', 'drawdown', 'name'] },
      },
      {
        name: 'order',
        description: 'Sort order',
        schema: { type: 'string', enum: ['asc', 'desc'] },
      },
      { name: 'page', description: 'Page number', schema: { type: 'integer', minimum: 1 } },
      {
        name: 'pageSize',
        description: 'Page size (max 50)',
        schema: { type: 'integer', minimum: 1, maximum: 50 },
      },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/traders/{id}',
    operationId: 'getTrader',
    auth: 'none',
    summary: 'Trader profile with score, provenance and freshness',
  },
  {
    method: 'GET',
    path: '/api/v1/traders/{id}/performance',
    operationId: 'getTraderPerformance',
    auth: 'none',
    summary: 'Observation series and cumulative curve',
  },
  {
    method: 'GET',
    path: '/api/v1/traders/{id}/score',
    operationId: 'getTraderScore',
    auth: 'none',
    summary: 'Component scores, explanations and flags',
  },
  {
    method: 'POST',
    path: '/api/v1/events',
    operationId: 'postEvent',
    auth: 'none',
    body: true,
    summary: 'Record a privacy-minimal analytics event',
  },
  {
    method: 'GET',
    path: '/api/v1/outbound/{exchangeId}',
    operationId: 'outboundRedirect',
    auth: 'none',
    summary: 'Validated outbound redirect that records a click (not a conversion)',
  },
  {
    method: 'GET',
    path: '/api/v1/analytics/summary',
    operationId: 'analyticsSummary',
    auth: 'required',
    summary: 'Aggregate analytics counts (API key required)',
  },
];

/** Compile a route path into a matcher. @param {string} path */
export function compile(path) {
  /** @type {string[]} */
  const names = [];
  const re = new RegExp(
    '^' + path.replace(/\{(\w+)\}/g, (_m, n) => (names.push(n), '([^/]+)')) + '/?$',
  );
  return { re, names };
}
