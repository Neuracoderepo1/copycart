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
