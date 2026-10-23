/**
 * Safe element builder: text is always set via textContent, never innerHTML.
 * @param {string} tag
 * @param {{ class?: string, text?: string, attrs?: Record<string, string> }} [opts]
 * @param {Array<Element | string | null | undefined>} [children]
 */
export function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** @param {number | null | undefined} v @param {number} [d] */
export const pct = (v, d = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);

/** @param {number | null | undefined} v @param {number} [d] */
export const num = (v, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d);

/** @param {number | null | undefined} days */
export function freshnessText(days) {
  if (days === null || days === undefined) return 'No observations';
  if (days < 1) return 'Updated today';
  return `Last observation ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago`;
}

/** @param {string} confidence */
export function confidenceText(confidence) {
  return confidence === 'demo'
    ? 'Demo data (synthetic)'
    : `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`;
}

/** Metric definitions shown next to values so numbers are never unexplained. */
export const DEFINITIONS = {
  totalReturn: 'Compounded return over the observed period, as reported by the source.',
  annualizedSharpe:
    'Mean period return ÷ its volatility × √365 (risk-free rate 0). Not a forecast.',
  maxDrawdown: 'Largest peak-to-trough fall of the compounded curve.',
  positiveWindowShare: 'Share of rolling 7-observation windows with a positive return.',
};
