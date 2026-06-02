// cache.mjs — the condenser's hot cache. The spec (§7/§10) calls for Redis in front of the
// tier feeders so the public site never hammers CoinGecko/Hive-Engine into a rate-limit. This is
// the keyless, dependency-free equivalent: an in-process TTL map with single-flight de-duplication
// (concurrent callers for the same key share ONE in-flight fetch) and a stale-on-error fallback
// (a feeder hiccup serves the last good value instead of a blank page). Swappable for Redis later
// behind the same cached() surface.
//
//   import { cached, TTL } from './cache.mjs'
//   const coins = await cached('top:50', TTL.list, () => topCoins({ limit: 50 }))

// default time-to-live bands (ms). Prices move; metadata doesn't.
export const TTL = {
  price: 60_000,        // CoinGecko's own cache window — no point going faster
  list: 60_000,
  ohlcv: 300_000,       // candles: 5 min
  metadata: 3_600_000,  // name/links/contracts/team: 1 h
  clarity: 1_800_000,   // holder-distribution scan: 30 min (it's a heavier read)
};

const store = new Map();     // key -> { value, expires, stale }
const inflight = new Map();  // key -> Promise (single-flight)

let _now = () => Date.now();
export function __setClock(fn) { _now = fn || (() => Date.now()); }

/**
 * Return a cached value or compute it. While a key is being computed, concurrent callers await the
 * same promise. On compute error, a previously-cached (now-stale) value is served if we have one;
 * otherwise the error propagates so the caller can decide (the site catches → "loading…").
 */
export async function cached(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && hit.expires > _now()) return hit.value;

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await fn();
      store.set(key, { value, expires: _now() + ttlMs, stale: value });
      return value;
    } catch (err) {
      const prev = store.get(key);
      if (prev && prev.stale !== undefined) return prev.stale;  // serve last good value
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Drop a key (or everything) — used by tests and by a manual refresh hook. */
export function invalidate(key) {
  if (key == null) { store.clear(); inflight.clear(); return; }
  store.delete(key);
}

/** Cache introspection for a /health or admin view. */
export function stats() {
  const now = _now();
  let fresh = 0, stale = 0;
  for (const v of store.values()) (v.expires > now ? fresh++ : stale++);
  return { keys: store.size, fresh, stale, inflight: inflight.size };
}
