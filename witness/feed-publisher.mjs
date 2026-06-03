// feed-publisher.mjs — Task #153: Hathor's witness price-feed publisher loop.
//
// Computes a robust median-of-N USD price for MELEK from injectable sources and PREPARES a
// standard Graphene `feed_publish` op — publishing only when the price has drifted past a
// threshold OR the last feed has gone stale. It NEVER holds a key and NEVER signs.
//
// HARD RULE (this repo / CLAUDE.md "Zero WIF"): no WIF private keys live here or on this host.
// Broadcast goes through the MELEK-Signer abstraction behind an opaque bearer token. This module
// only builds the op and hands it to an INJECTED broadcaster; the broadcaster alone holds the
// token. By construction this file cannot sign, and DRY_RUN is the default — even when called
// "live" it only broadcasts if a broadcaster has been explicitly injected.
//
// Companion to the older witness/feed-publisher.js (Phase-1 fixed-rate one-shot via Hathor's
// active key). This is the keyless drift-driven loop intended for the signer-backed deploy.
//
//   import { publishOnce, __setPriceSource, __setBroadcaster } from './feed-publisher.mjs'
//
// Everything is injectable so the tests run fully offline.

// ---- injectable seams (price source, broadcaster, clock) -------------------------------------

// Default price source: defensively reuse the existing multi-source oracle if it imports cleanly.
// If the import or the call fails for any reason, we soft-fail to null (no price) rather than throw.
let _priceSource = async () => {
  try {
    const mod = await import('../integrations/price-oracle.mjs');
    if (typeof mod.priceUsd === 'function') {
      // MELEK isn't on the oracle's xref yet; until it is, there's no live source here.
      // A real deploy injects __setPriceSource with the MELEK market. Return null = no quote.
      return null;
    }
  } catch {
    // oracle unavailable — soft-fail
  }
  return null;
};

// Default broadcaster: there is NONE. With no broadcaster injected, the module can never
// broadcast, regardless of `live`. This is the zero-WIF safety floor.
let _broadcaster = null;

let _now = () => Date.now();

/** Inject the price source: an async () => number|null (USD per 1 MELEK), or { usd, ... }. */
export function __setPriceSource(fn) {
  _priceSource = typeof fn === 'function' ? fn : _priceSource;
}

/** Inject the broadcaster: an async (op) => result. It alone holds the signer bearer token. */
export function __setBroadcaster(fn) {
  _broadcaster = typeof fn === 'function' ? fn : null;
}

/** Inject the clock: a () => epochMs. */
export function __setClock(fn) {
  _now = typeof fn === 'function' ? fn : (() => Date.now());
}

// ---- pure helpers ----------------------------------------------------------------------------

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Robust median over a set of price quotes with outlier rejection: drop any quote that sits
 * more than `tolPct` (default 35%) away from the raw median, then re-median the survivors.
 * Reuses integrations/price-oracle.mjs#robustMedian when importable; otherwise local fallback.
 * Pure. Returns a number, or null when there are no usable quotes.
 */
export async function medianPrice(prices, { tolPct = 0.35 } = {}) {
  const vals = (Array.isArray(prices) ? prices : [])
    .map((x) => +x)
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;

  // Prefer the existing oracle's robustMedian for a single source of truth.
  try {
    const mod = await import('../integrations/price-oracle.mjs');
    if (typeof mod.robustMedian === 'function') {
      const { usd } = mod.robustMedian(vals);
      if (Number.isFinite(usd) && usd > 0) return usd;
    }
  } catch {
    // fall through to local implementation
  }

  const med = median(vals);
  const kept = vals.filter((v) => Math.abs(v - med) / med <= tolPct);
  return median(kept.length ? kept : vals);
}

/**
 * Decide whether to publish a new feed. Pure.
 *  - publish if there is no prior feed at all, or
 *  - publish if |current - lastPublished.price| / lastPublished.price * 100 > driftPct, or
 *  - publish if the last feed is older than maxAgeMs (staleness).
 *
 * @param {number} current
 * @param {{ price:number, at:number }|null} lastPublished
 * @param {{ driftPct?:number, maxAgeMs?:number }} opts
 * @returns {{ publish:boolean, reason:string, driftPct:number|null }}
 */
export function shouldPublish(current, lastPublished, { driftPct = 1.0, maxAgeMs } = {}) {
  if (!Number.isFinite(current) || current <= 0) {
    return { publish: false, reason: 'no-price', driftPct: null };
  }
  if (!lastPublished || !Number.isFinite(lastPublished.price) || lastPublished.price <= 0) {
    return { publish: true, reason: 'no-prior-feed', driftPct: null };
  }

  const drift = Math.abs(current - lastPublished.price) / lastPublished.price * 100;

  if (drift > driftPct) {
    return { publish: true, reason: 'drift', driftPct: +drift.toFixed(4) };
  }

  if (Number.isFinite(maxAgeMs) && Number.isFinite(lastPublished.at)) {
    const age = _now() - lastPublished.at;
    if (age > maxAgeMs) {
      return { publish: true, reason: 'stale', driftPct: +drift.toFixed(4) };
    }
  }

  return { publish: false, reason: 'within-threshold', driftPct: +drift.toFixed(4) };
}

/**
 * Build the standard Graphene `feed_publish` operation object. Pure.
 * Matches the shape used in src/chain/graphene.js#publishFeed:
 *   ['feed_publish', { publisher, exchange_rate: { base, quote } }]
 * with base/quote as asset strings, e.g. "1.000 MELEK" / "0.001 USD".
 *
 * @param {{ base?:string, quote?:string, price?:number, publisher?:string, quoteAsset?:string, precision?:number }} args
 */
export function buildFeedOp({
  base = '1.000 MELEK',
  quote,
  price,
  publisher = 'hathor',
  quoteAsset = 'USD',
  precision = 3,
} = {}) {
  const quoteStr = quote ?? `${Number(price).toFixed(precision)} ${quoteAsset}`;
  return [
    'feed_publish',
    {
      publisher,
      exchange_rate: { base, quote: quoteStr },
    },
  ];
}

// ---- in-memory state (a real deploy persists this to disk/DB) --------------------------------

let _state = { lastPublished: null };

export const state = {
  /** @returns {{ price:number, at:number }|null} */
  get() {
    return _state.lastPublished;
  },
  /** @param {{ price:number, at:number }|null} v */
  set(v) {
    _state.lastPublished = v;
  },
  reset() {
    _state.lastPublished = null;
  },
};

// ---- the loop body ---------------------------------------------------------------------------

/** Normalize whatever the price source returned into a number|null. */
function asPrice(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'object') {
    if (Array.isArray(raw)) return null; // arrays go through medianPrice, not here
    const v = +raw.usd;
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const v = +raw;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * One iteration of the publisher loop. Soft-fail: never throws.
 *
 * Fetches price via the injected source (number | {usd} | array-of-quotes), computes the robust
 * median when given an array, decides via shouldPublish, builds the feed op, and ONLY broadcasts
 * when live === true AND a broadcaster has been injected. Otherwise returns the prepared op and
 * the decision without broadcasting.
 *
 * @param {{ driftPct?:number, maxAgeMs?:number, live?:boolean, base?:string, quoteAsset?:string }} opts
 * @returns {Promise<{ published:boolean, op:Array|null, price:number|null, reason:string, dryRun:boolean }>}
 */
export async function publishOnce({
  driftPct = 1.0,
  maxAgeMs,
  live = false,
  base = '1.000 MELEK',
  quoteAsset = 'USD',
} = {}) {
  const dryRun = !live || typeof _broadcaster !== 'function';

  let price = null;
  try {
    const raw = await _priceSource();
    price = Array.isArray(raw) ? await medianPrice(raw) : asPrice(raw);
  } catch {
    price = null;
  }

  if (price == null) {
    return { published: false, op: null, price: null, reason: 'no-price', dryRun };
  }

  const decision = shouldPublish(price, state.get(), { driftPct, maxAgeMs });
  const op = buildFeedOp({ base, price, quoteAsset });

  if (!decision.publish) {
    return { published: false, op, price, reason: decision.reason, dryRun };
  }

  // Decided to publish. Only actually broadcast when live AND a broadcaster is injected.
  if (dryRun) {
    return { published: false, op, price, reason: decision.reason, dryRun: true };
  }

  try {
    await _broadcaster(op);
  } catch {
    // Broadcast failed — soft-fail, don't advance state, try again next tick.
    return { published: false, op, price, reason: 'broadcast-failed', dryRun: false };
  }

  state.set({ price, at: _now() });
  return { published: true, op, price, reason: decision.reason, dryRun: false };
}

// ---- CLI (guarded) ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('feed-publisher.mjs')) {
  const live = process.argv.includes('--live'); // ignored unless a broadcaster is wired (none here)
  const result = await publishOnce({ live });
  const stamp = new Date(_now()).toISOString();
  console.log(`[${stamp}] feed-publisher (DRY-RUN default, never signs locally)`);
  console.log(JSON.stringify(result, null, 2));
  if (result.dryRun) console.log('  dry-run: no broadcast (no signer wired in this repo)');
}
