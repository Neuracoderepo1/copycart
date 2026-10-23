import { createHash, timingSafeEqual } from 'node:crypto';

/** @param {string} key */
export function hashKey(key) {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Authentication only: checks a presented key against configured hashes (constant-time).
 * Key generation lives in scripts/generate-api-key.js; provisioning is an operator step.
 * @param {string | undefined} presented
 * @param {string[]} hashes
 */
export function isValidKey(presented, hashes) {
  if (!presented || !/^cc_[A-Za-z0-9_-]{43}$/.test(presented)) return false;
  const h = Buffer.from(hashKey(presented), 'hex');
  let ok = false;
  for (const stored of hashes) {
    const s = Buffer.from(stored, 'hex');
    if (s.length === h.length && timingSafeEqual(s, h)) ok = true;
  }
  return ok;
}

/**
 * Audit trail for privileged operations. Records who (a short key fingerprint, never the key),
 * what, and the outcome. No IPs or request bodies. In memory and stdout only; ship stdout to a
 * durable log sink in production.
 * @param {{ sink?: (line: string) => void, max?: number }} [opts]
 */
export function createAudit(opts = {}) {
  const sink = opts.sink ?? ((line) => console.log(line));
  const max = opts.max ?? 1000;
  /** @type {Array<{ at: string, action: string, outcome: 'allowed' | 'denied', actor: string }>} */
  const entries = [];
  return {
    entries,
    /** @param {string} action @param {'allowed' | 'denied'} outcome @param {string | undefined} key */
    record(action, outcome, key) {
      const actor = key && /^cc_/.test(key) ? `key:${hashKey(key).slice(0, 8)}` : 'anonymous';
      const entry = { at: new Date().toISOString(), action, outcome, actor };
      entries.push(entry);
      if (entries.length > max) entries.shift();
      sink(JSON.stringify({ audit: entry }));
    },
  };
}

/** Fixed-window in-memory rate limiter. @param {number} windowMs @param {() => number} [now] */
export function createRateLimiter(windowMs = 60_000, now = Date.now) {
  /** @type {Map<string, { start: number, count: number }>} */
  const hits = new Map();
  return {
    /** @param {string} id @param {number} limit */
    take(id, limit) {
      const t = now();
      let e = hits.get(id);
      if (!e || t - e.start >= windowMs) {
        e = { start: t, count: 0 };
        hits.set(id, e);
        if (hits.size > 10_000) {
          for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        }
      }
      e.count++;
      return {
        allowed: e.count <= limit,
        remaining: Math.max(0, limit - e.count),
        retryAfterSec: Math.ceil((e.start + windowMs - t) / 1000),
      };
    },
  };
}
