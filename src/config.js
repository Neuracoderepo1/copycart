/**
 * Runtime configuration, read from the environment only. No secrets are stored in source.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  /** @param {string | undefined} v @param {number} d */
  const int = (v, d) => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    // SHA-256 hex digests of valid API keys, comma separated. Raw keys are never configured here.
    apiKeyHashes: (env.COPYCART_API_KEY_HASHES ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[0-9a-f]{64}$/.test(s)),
    requireKey: env.COPYCART_REQUIRE_KEY === '1',
    trustProxy: env.TRUST_PROXY === '1',
    rateLimitAnon: int(env.RATE_LIMIT_ANON, 60),
    rateLimitKey: int(env.RATE_LIMIT_KEY, 600),
    maxBodyBytes: 4096,
    /** Optional per-exchange referral URLs: REFERRAL_URL_BINANCE=https://... */
    env,
  };
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
