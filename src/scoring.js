// CopyCart scoring engine. Pure, deterministic, no I/O, no UI.
// Weights are PROVISIONAL: not validated against historical outcomes.
// The score describes the quality of an observed record; it does not predict future profit.

export const SCORING_VERSION = '0.1.0-provisional';

export const WEIGHTS = Object.freeze({
  riskAdjustedReturn: 0.35,
  drawdown: 0.25,
  consistency: 0.2,
  dataReliability: 0.2,
});

export const MIN_OBSERVATIONS = 30;
export const TARGET_OBSERVATIONS = 90;
const DAY_MS = 86_400_000;
const WINDOW = 7;

/**
 * @typedef {{ ts: string, ret: number }} Observation  ret = simple period return, e.g. 0.01 = +1%
 * @typedef {{ kind: 'demo' | 'verified_live' | 'unverified_live', asOf?: string }} SourceInfo
 * @typedef {{
 *   key: string, label: string, score: number | null, weight: number,
 *   value: number | null, explanation: string
 * }} Component
 * @typedef {{ code: string, severity: 'info' | 'caution', message: string }} Flag
 * @typedef {{
 *   version: string, status: 'scored' | 'insufficient_history' | 'unscorable',
 *   score: number | null, confidence: 'high' | 'medium' | 'low' | 'demo',
 *   components: Component[], flags: Flag[],
 *   metrics: Metrics, dataQuality: { received: number, valid: number, dropped: number }
 * }} ScoreResult
 * @typedef {{
 *   observations: number, periodDays: number | null, totalReturn: number | null,
 *   annualizedSharpe: number | null, maxDrawdown: number | null,
 *   positiveWindowShare: number | null, volatilityDaily: number | null
 * }} Metrics
 */

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** @param {unknown} n @returns {n is number} */
function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Drop invalid rows, sort by time, de-duplicate timestamps (keep last).
 * A return <= -100% is impossible for a long-only equity curve and is rejected.
 * @param {unknown} raw
 * @returns {{ obs: Array<{ t: number, ret: number }>, received: number }}
 */
export function cleanObservations(raw) {
  const list = Array.isArray(raw) ? raw : [];
  /** @type {Map<number, number>} */
  const byTime = new Map();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const { ts, ret } = /** @type {{ ts?: unknown, ret?: unknown }} */ (row);
    const t = typeof ts === 'string' ? Date.parse(ts) : NaN;
    if (!Number.isFinite(t) || !isFiniteNumber(ret) || ret <= -1 || ret > 10) continue;
    byTime.set(t, ret);
  }
  const obs = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, ret]) => ({ t, ret }));
  return { obs, received: list.length };
}

/** @param {number[]} xs */
export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Sample standard deviation. @param {number[]} xs */
export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Maximum peak-to-trough decline of the compounded curve, as a positive fraction. @param {number[]} rets */
export function maxDrawdown(rets) {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const r of rets) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, (peak - equity) / peak);
  }
  return worst;
}

/** @param {number[]} rets */
export function totalReturn(rets) {
  return rets.reduce((eq, r) => eq * (1 + r), 1) - 1;
}

/**
 * Score one trader record.
 * @param {unknown} observations
 * @param {SourceInfo} source
 * @param {{ asOf?: string }} [opts]
 * @returns {ScoreResult}
 */
export function scoreTrader(observations, source, opts = {}) {
  const asOfMs = opts.asOf ? Date.parse(opts.asOf) : Date.now();
  const { obs, received } = cleanObservations(observations);
  const rets = obs.map((o) => o.ret);
  const dataQuality = { received, valid: obs.length, dropped: received - obs.length };

  /** @type {Flag[]} */
  const flags = [];
  if (dataQuality.dropped > 0) {
    flags.push({
      code: 'invalid_values_dropped',
      severity: 'info',
      message: `${dataQuality.dropped} observation(s) had invalid timestamps or values and were excluded.`,
    });
  }

  const periodDays = obs.length > 1 ? (obs[obs.length - 1].t - obs[0].t) / DAY_MS : null;
  /** @type {Metrics} */
  const metrics = {
    observations: obs.length,
    periodDays,
    totalReturn: null,
    annualizedSharpe: null,
    maxDrawdown: null,
    positiveWindowShare: null,
    volatilityDaily: null,
  };

  if (obs.length < MIN_OBSERVATIONS) {
    flags.push({
      code: 'insufficient_history',
      severity: 'caution',
      message: `Only ${obs.length} valid observation(s); at least ${MIN_OBSERVATIONS} are required to score.`,
    });
    return {
      version: SCORING_VERSION,
      status: obs.length === 0 ? 'unscorable' : 'insufficient_history',
      score: null,
      confidence: 'low',
      components: [],
      flags,
      metrics,
      dataQuality,
    };
  }

  const sd = stdev(rets);
  metrics.totalReturn = totalReturn(rets);
  metrics.volatilityDaily = sd;
  metrics.maxDrawdown = maxDrawdown(rets);

  // 1. Risk-adjusted return: annualized Sharpe-like ratio (rf = 0). -1 -> 0 points, +3 -> 100.
  /** @type {Component} */
  const rar = {
    key: 'riskAdjustedReturn',
    label: 'Risk-adjusted return',
    score: null,
    weight: WEIGHTS.riskAdjustedReturn,
    value: null,
    explanation: 'Mean period return divided by its volatility, annualized (365 periods).',
  };
  if (sd > 1e-12) {
    const sharpe = (mean(rets) / sd) * Math.sqrt(365);
    metrics.annualizedSharpe = sharpe;
    rar.value = sharpe;
    rar.score = Math.round(clamp(((sharpe + 1) / 4) * 100, 0, 100));
    rar.explanation += ` Observed ${sharpe.toFixed(2)}; -1 maps to 0 and +3 maps to 100.`;
  } else {
    rar.explanation += ' Not computable: returns have (near) zero variance.';
  }

  // 2. Drawdown severity: 0% drawdown -> 100, >=50% -> 0.
  const mdd = /** @type {number} */ (metrics.maxDrawdown);
  /** @type {Component} */
  const dd = {
    key: 'drawdown',
    label: 'Drawdown severity',
    score: Math.round(clamp((1 - mdd / 0.5) * 100, 0, 100)),
    weight: WEIGHTS.drawdown,
    value: mdd,
    explanation: `Maximum peak-to-trough decline of ${(mdd * 100).toFixed(1)}%; 0% maps to 100 and 50% or worse to 0.`,
  };

  // 3. Consistency: share of rolling 7-observation windows with a positive compounded return.
  let positive = 0;
  let windows = 0;
  for (let i = 0; i + WINDOW <= rets.length; i++) {
    windows++;
    if (totalReturn(rets.slice(i, i + WINDOW)) > 0) positive++;
  }
  const share = windows ? positive / windows : 0;
  metrics.positiveWindowShare = share;
  /** @type {Component} */
  const cons = {
    key: 'consistency',
    label: 'Performance consistency',
    score: Math.round(clamp(((share - 0.3) / 0.5) * 100, 0, 100)),
    weight: WEIGHTS.consistency,
    value: share,
    explanation: `${(share * 100).toFixed(0)}% of rolling ${WINDOW}-observation windows were positive; 30% maps to 0 and 80% to 100.`,
  };

  // 4. Data reliability: history depth, freshness, gaps, source kind.
  const last = obs[obs.length - 1].t;
  const ageDays = Math.max(0, (asOfMs - last) / DAY_MS);
  const depth = clamp(obs.length / TARGET_OBSERVATIONS, 0, 1);
  const freshness = ageDays <= 1 ? 1 : clamp(1 - (ageDays - 1) / 13, 0, 1);
  const spanDays = Math.max(1, (periodDays ?? 0) + 1);
  const coverage = clamp(obs.length / spanDays, 0, 1);
  const sourceFactor =
    source.kind === 'verified_live' ? 1 : source.kind === 'unverified_live' ? 0.7 : 0.5;
  const reliability = depth * 0.3 + freshness * 0.3 + coverage * 0.25 + sourceFactor * 0.15;
  /** @type {Component} */
  const rel = {
    key: 'dataReliability',
    label: 'Data reliability',
    score: Math.round(reliability * 100),
    weight: WEIGHTS.dataReliability,
    value: reliability,
    explanation:
      `History depth ${obs.length}/${TARGET_OBSERVATIONS}, last observation ${ageDays.toFixed(1)} day(s) old, ` +
      `${(coverage * 100).toFixed(0)}% calendar coverage, source: ${source.kind}.`,
  };

  if (ageDays > 7) {
    flags.push({
      code: 'stale_data',
      severity: 'caution',
      message: `Latest observation is ${ageDays.toFixed(0)} days old; metrics may not reflect current behavior.`,
    });
  }
  if (coverage < 0.8) {
    flags.push({
      code: 'gappy_history',
      severity: 'info',
      message: `Observations cover ${(coverage * 100).toFixed(0)}% of the calendar span; gaps may distort metrics.`,
    });
  }
  if (obs.length < TARGET_OBSERVATIONS) {
    flags.push({
      code: 'short_history',
      severity: 'info',
      message: `History is shorter than the ${TARGET_OBSERVATIONS}-observation target; treat results as less certain.`,
    });
  }
  flags.push(...anomalyFlags(rets, metrics));

  const components = [rar, dd, cons, rel];
  // Renormalize across components that could be computed. Drawdown, consistency and reliability
  // are always computable here, so a missing risk-adjusted term only shifts weight, never zeroes it.
  const usable = components.filter((c) => c.score !== null);
  const wsum = usable.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(
    usable.reduce((a, c) => a + /** @type {number} */ (c.score) * c.weight, 0) / wsum,
  );

  /** @type {ScoreResult['confidence']} */
  let confidence = 'medium';
  if (source.kind === 'demo') confidence = 'demo';
  else if ((rel.score ?? 0) >= 75 && source.kind === 'verified_live') confidence = 'high';
  else if ((rel.score ?? 0) < 50) confidence = 'low';

  return {
    version: SCORING_VERSION,
    status: 'scored',
    score,
    confidence,
    components,
    flags,
    metrics,
    dataQuality,
  };
}

/**
 * Explainable statistical flags. These are prompts to look closer, not accusations.
 * @param {number[]} rets @param {Metrics} metrics
 * @returns {Flag[]}
 */
export function anomalyFlags(rets, metrics) {
  /** @type {Flag[]} */
  const flags = [];
  if (metrics.annualizedSharpe !== null && metrics.annualizedSharpe > 6 && rets.length >= 60) {
    flags.push({
      code: 'unusually_smooth_returns',
      severity: 'caution',
      message:
        'Risk-adjusted return is far above typical ranges. This can come from short samples, ' +
        'smoothing in the data source, or low-volatility strategies; verify against raw statements.',
    });
  }
  const gains = rets.filter((r) => r > 0);
  const gainSum = gains.reduce((a, b) => a + b, 0);
  if (gains.length >= 10 && gainSum > 0 && Math.max(...gains) / gainSum > 0.4) {
    flags.push({
      code: 'single_period_concentration',
      severity: 'caution',
      message:
        'One period accounts for over 40% of all positive returns; results may rely on a single event.',
    });
  }
  const sd = stdev(rets);
  if (sd > 0 && rets.some((r) => Math.abs(r - mean(rets)) > 6 * sd)) {
    flags.push({
      code: 'extreme_outlier_period',
      severity: 'info',
      message: 'At least one period deviates by more than 6 standard deviations from the mean.',
    });
  }
  return flags;
}

/** Public, human-readable description of the method for /methodology. */
export function describeMethodology() {
  return {
    version: SCORING_VERSION,
    status: 'provisional',
    summary:
      'A 0-100 descriptive score of an observed track record. Weights are provisional and have not ' +
      'been validated against historical outcomes. The score does not predict future profitability.',
    minimumObservations: MIN_OBSERVATIONS,
    components: [
      {
        key: 'riskAdjustedReturn',
        weight: WEIGHTS.riskAdjustedReturn,
        definition:
          'Annualized mean/volatility of period returns (risk-free rate 0). -1 -> 0, +3 -> 100.',
      },
      {
        key: 'drawdown',
        weight: WEIGHTS.drawdown,
        definition: 'Maximum peak-to-trough decline of the compounded curve. 0% -> 100, 50%+ -> 0.',
      },
      {
        key: 'consistency',
        weight: WEIGHTS.consistency,
        definition:
          'Share of rolling 7-observation windows with a positive return. 30% -> 0, 80% -> 100.',
      },
      {
        key: 'dataReliability',
        weight: WEIGHTS.dataReliability,
        definition:
          'History depth (30%), freshness (30%), calendar coverage (25%), source verification (15%).',
      },
    ],
    flags:
      'Anomaly flags are statistical prompts for further review and are not findings of misconduct.',
    limitations: [
      'Demo fixtures are synthetic and are not exchange data.',
      'Past performance does not guarantee future results.',
      'Returns are as reported by the source and are not independently audited.',
    ],
  };
}
