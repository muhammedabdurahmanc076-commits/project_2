// rateLimiter.js
// Simple in-memory sliding-window rate limiter, keyed by IP + bucket name.
// Good enough for a single-process demo/academic deployment; for a
// multi-process production deployment, back this with Redis instead.

const config = require('./config');

const hits = new Map(); // key -> array of timestamps (ms)

function keyFor(ip, bucket) {
  return `${bucket}:${ip}`;
}

// Read-only: true if still under the limit (does not consume a slot).
function isBlocked(ip, bucket, limit = config.RATE_LIMIT_MAX_ATTEMPTS, windowMs = config.RATE_LIMIT_WINDOW_MS) {
  const key = keyFor(ip, bucket);
  const now = Date.now();
  const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
  hits.set(key, timestamps);
  return timestamps.length >= limit;
}

// Consumes one slot (call this on a failed attempt, or on any attempt for
// buckets — like registration — where every call should count).
function recordAttempt(ip, bucket) {
  const key = keyFor(ip, bucket);
  const timestamps = hits.get(key) || [];
  timestamps.push(Date.now());
  hits.set(key, timestamps);
}

// Convenience used by register: checks and records in one call.
function allow(ip, bucket, limit = config.RATE_LIMIT_MAX_ATTEMPTS, windowMs = config.RATE_LIMIT_WINDOW_MS) {
  if (isBlocked(ip, bucket, limit, windowMs)) return false;
  recordAttempt(ip, bucket);
  return true;
}

// Periodically clear old entries so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of hits.entries()) {
    const fresh = timestamps.filter((t) => now - t < config.RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
}, 10 * 60 * 1000).unref();

module.exports = { allow, isBlocked, recordAttempt };
