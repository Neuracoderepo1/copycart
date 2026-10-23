import { el, pct, num, freshnessText, confidenceText, DEFINITIONS } from './dom.js';
import { outboundUrl } from './api.js';

/** @typedef {import('./api.js').Trader} Trader */
/** @typedef {import('./api.js').Score} Score */

/** @param {Trader} t */
export function sourceChips(t) {
  return el('div', { class: 'chips' }, [
    t.isDemo
      ? el('span', { class: 'chip demo', text: 'DEMO · SYNTHETIC' })
      : el('span', {
          class: 'chip ok',
          text: t.source.kind === 'verified_live' ? 'LIVE · VERIFIED' : 'LIVE · UNVERIFIED',
        }),
    el('span', { class: 'chip', text: freshnessText(t.freshness.ageDays) }),
    el('span', { class: 'chip', text: confidenceText(t.confidence) }),
    ...t.flags
      .filter((f) => f.severity === 'caution')
      .map((f) => el('span', { class: 'chip caution', text: f.code.replaceAll('_', ' ') })),
  ]);
}

/**
 * @param {Trader} t
 * @param {{ selected: boolean, onView: () => void, onToggleCompare: (checked: boolean) => void, compareDisabled: boolean }} h
 */
export function traderCard(t, h) {
  const pillClass = t.riskLabel === 'Low' ? 'low' : t.riskLabel === 'High' ? 'high' : 'moderate';
  const checkbox = el('input', {
    attrs: { type: 'checkbox', 'aria-label': `Add ${t.displayName} to comparison` },
  });
  const box = /** @type {HTMLInputElement} */ (checkbox);
  box.checked = h.selected;
  box.disabled = h.compareDisabled && !h.selected;
  box.addEventListener('change', () => h.onToggleCompare(box.checked));
  const view = el('button', { text: `View ${t.displayName} profile ↗`, attrs: { type: 'button' } });
  view.addEventListener('click', h.onView);
  const scored = t.score !== null;
  return el('article', { class: 'trader' }, [
    el('div', { class: 'trader-top' }, [
      el('div', {
        class: `avatar ${['green', 'violet', 'blue', 'orange'][t.id.length % 4]}`,
        text: t.displayName[0],
      }),
      el('small', { text: t.isDemo ? 'DEMO PROFILE' : 'PROFILE' }),
    ]),
    el('h3', { text: t.displayName }),
    el('p', {
      class: 'strategy',
      text: `${t.strategy} · ${t.markets.join(' / ')} · ${t.exchangeName}`,
    }),
    el('div', { class: 'score-line' }, [
      el('div', {}, [
        el('small', { text: scored ? 'SCORE (PROVISIONAL)' : 'SCORE UNAVAILABLE' }),
        el(
          'strong',
          { class: 'score', text: scored ? String(t.score) : '—' },
          scored ? [el('span', { text: '/100' })] : [],
        ),
      ]),
      el('span', { class: `pill ${pillClass}`, text: `${t.riskLabel} risk` }),
    ]),
    el('hr'),
    el('div', { class: 'metrics' }, [
      el('div', {}, [
        el('small', { text: 'Max drawdown' }),
        el('strong', { text: pct(t.metrics.maxDrawdown) }),
      ]),
      el('div', {}, [
        el('small', { text: 'Observations' }),
        el('strong', { text: String(t.metrics.observations) }),
      ]),
    ]),
    sourceChips(t),
    el('div', { class: 'card-actions' }, [el('label', {}, [checkbox, 'Compare']), view]),
  ]);
}

/**
 * @param {Array<{ ts: string, cumulativeReturn: number }>} series
 */
export function curve(series) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 500 160');
  svg.setAttribute('class', 'curve');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Cumulative return curve from observed series');
  if (series.length < 2) return svg;
  const ys = series.map((p) => p.cumulativeReturn);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(0, ...ys);
  const span = hi - lo || 1;
  const pts = series.map(
    (p, i) =>
      `${((i / (series.length - 1)) * 500).toFixed(1)},${(150 - ((p.cumulativeReturn - lo) / span) * 140).toFixed(1)}`,
  );
  const zero = document.createElementNS(ns, 'line');
  const zy = (150 - ((0 - lo) / span) * 140).toFixed(1);
  for (const [k, v] of Object.entries({
    x1: '0',
    x2: '500',
    y1: zy,
    y2: zy,
    stroke: '#3a444f',
    'stroke-dasharray': '4 4',
  }))
    zero.setAttribute(k, v);
  const line = document.createElementNS(ns, 'polyline');
  for (const [k, v] of Object.entries({
    points: pts.join(' '),
    fill: 'none',
    stroke: '#b5f36d',
    'stroke-width': '2.5',
  }))
    line.setAttribute(k, v);
  svg.append(zero, line);
  return svg;
}

/** @param {Score} s */
export function componentBars(s) {
  return el(
    'div',
    {},
    s.components.map((c) =>
      el('div', { class: 'component' }, [
        el('header', {}, [
          el('strong', { text: c.label }),
          el('span', {
            text:
              c.score === null ? 'n/a' : `${c.score}/100 · weight ${(c.weight * 100).toFixed(0)}%`,
          }),
        ]),
        el(
          'div',
          {
            class: 'bar',
            attrs: { role: 'img', 'aria-label': `${c.label} ${c.score ?? 'not available'}` },
          },
          [
            (() => {
              const i = el('i');
              i.style.width = `${c.score ?? 0}%`;
              return i;
            })(),
          ],
        ),
        el('p', { text: c.explanation }),
      ]),
    ),
  );
}

/** @param {Trader} t @param {Score} s */
export function metricGrid(t, s) {
  const m = s.metrics;
  /** @type {Array<[string, string, string]>} */
  const rows = [
    ['TOTAL RETURN', pct(m.totalReturn), DEFINITIONS.totalReturn],
    ['SHARPE-LIKE (ANNUALIZED)', num(m.annualizedSharpe), DEFINITIONS.annualizedSharpe],
    ['MAX DRAWDOWN', pct(m.maxDrawdown), DEFINITIONS.maxDrawdown],
    ['POSITIVE 7-OBS WINDOWS', pct(m.positiveWindowShare, 0), DEFINITIONS.positiveWindowShare],
  ];
  return el(
    'div',
    { class: 'metric-grid' },
    rows.map(([k, v, d]) =>
      el('div', {}, [el('small', { text: k }), el('strong', { text: v }), el('p', { text: d })]),
    ),
  );
}

/**
 * Profile body. Outbound link is a same-origin URL; the server validates the destination.
 * @param {Trader & { score: Score }} t
 * @param {Array<{ ts: string, cumulativeReturn: number }>} series
 */
export function profileBody(t, series) {
  const s = t.score;
  // The click is recorded server-side by the redirect endpoint (one authoritative count), so the
  // browser does not also post an outbound_click event.
  const link = t.outboundAvailable
    ? el('a', {
        class: 'button secondary outbound',
        text: `Open ${t.exchangeName} (outbound link) ↗`,
        attrs: {
          href: outboundUrl(t.exchangeId, t.id),
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      })
    : el('p', {
        class: 'fineprint outbound-unavailable',
        text: t.isDemo
          ? 'No outbound link: this is a synthetic demo profile on a fictional exchange.'
          : 'No outbound link is available for this exchange.',
      });
  return el('div', {}, [
    el('p', { text: `${t.strategy} · ${t.markets.join(' / ')} · ${t.horizon}` }),
    sourceChips(t),
    el('div', { class: 'dialog-note' }, [
      el('strong', {
        text: t.isDemo ? 'Demo only — synthetic data, no live exchange feed' : 'Source provenance',
      }),
      el('p', {
        text: `${t.source.name}. ${t.source.note ?? ''} Score method ${s.version} (provisional, not validated to predict profit).`,
      }),
    ]),
    s.status === 'scored'
      ? el('div', {}, [
          el('h3', { text: `Score ${s.score}/100` }),
          ...s.caps.map((c) =>
            el('p', {
              class: 'fineprint cap-note',
              text: `Capped at ${c.limit}${s.rawScore !== null ? ` (uncapped ${s.rawScore})` : ''}: ${c.reason}`,
            }),
          ),
          componentBars(s),
        ])
      : el('p', { text: 'A score is unavailable because there is not enough valid history.' }),
    metricGrid(t, s),
    curve(series),
    s.flags.length
      ? el('div', {}, [
          el('h3', { text: 'Data and pattern notes' }),
          el(
            'ul',
            {},
            s.flags.map((f) => el('li', { class: 'fineprint', text: f.message })),
          ),
        ])
      : null,
    el('p', {
      class: 'fineprint',
      text: 'Flags are statistical prompts for closer review, not accusations. Outbound clicks are tracked as clicks only; they are not registrations or deposits. Not financial advice.',
    }),
    link,
  ]);
}

/** @param {Array<Trader & { score: Score }>} ts */
export function compareTable(ts) {
  /** @type {Array<[string, (t: Trader & { score: Score }) => string]>} */
  const rows = [
    ['Exchange', (t) => t.exchangeName],
    ['Score (provisional)', (t) => (t.score.score === null ? '—' : String(t.score.score))],
    ['Risk label', (t) => t.riskLabel],
    ['Total return', (t) => pct(t.score.metrics.totalReturn)],
    ['Sharpe-like', (t) => num(t.score.metrics.annualizedSharpe)],
    ['Max drawdown', (t) => pct(t.score.metrics.maxDrawdown)],
    ['Positive windows', (t) => pct(t.score.metrics.positiveWindowShare, 0)],
    ['Observations', (t) => String(t.score.metrics.observations)],
    ['Freshness', (t) => freshnessText(t.freshness.ageDays)],
    ['Confidence', (t) => confidenceText(t.confidence)],
    ['Data source', (t) => (t.isDemo ? 'Demo (synthetic)' : t.source.kind)],
    ['Flags', (t) => t.score.flags.map((f) => f.code.replaceAll('_', ' ')).join(', ') || 'none'],
  ];
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'compare' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'METRIC', attrs: { scope: 'col' } }),
          ...ts.map((t) =>
            el('th', { text: t.displayName.toUpperCase(), attrs: { scope: 'col' } }),
          ),
        ]),
      ]),
      el(
        'tbody',
        {},
        rows.map(([label, fn]) =>
          el('tr', {}, [
            el('th', { text: label, attrs: { scope: 'row' } }),
            ...ts.map((t) => el('td', { text: fn(t) })),
          ]),
        ),
      ),
    ]),
  ]);
}
