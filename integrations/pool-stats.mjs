// pool-stats.mjs — KEYLESS, SOFT-FAIL reader for our Miningcore stats API (task #291).
//
// Miningcore (oliverw/miningcore) is the single-binary multi-coin stratum engine we run on
// Server 4 (xmr-stagenet RandomX + etc-mordor Etchash, PRANA slots in next). Its read API binds
// to 127.0.0.1:4000 behind Caddy; the canonical multi-coin menu is `GET /api/pools` (all pools,
// one call) and `GET /api/pools/<id>` for a single pool. See
// `.local/MULTICHAIN_POOLS_WALLETS_DOCS.md` §1.7 for the endpoint catalog and §1.3 for the
// per-coin `rewardRecipients` fee model (the pool fee that routes to Hathor).
//
// This module is a VIEW. It reads — never writes, never holds a key, never broadcasts. It is the
// data source for the witness.melek.salon /pool page.
//
// Discipline (mirrors prana-wallet.mjs / multichain.mjs):
//   - ESM, `__setFetch` hook for offline tests.
//   - SOFT-FAIL EVERYTHING: an unreachable API, a non-2xx, malformed JSON, or a missing field
//     returns [] (or null for a single pool) — never throws to the caller. The page renders an
//     honest empty-state instead of breaking.
//   - Normalizes the raw Miningcore pool shape into a small, stable record the page consumes,
//     so the renderer never reaches into raw API internals.
//
//   import { pools, poolStats, stratumUrl, __setFetch } from './pool-stats.mjs'
//   await pools()           // → [ { id, coin, algorithm, connectedMiners, hashrate, feePercent, paymentScheme, ports:[{port,tls}] }, … ]
//   await poolStats('prana')
//
//   POOL_API_URL=http://127.0.0.1:4000 node integrations/pool-stats.mjs

// The Miningcore read API base. Defaults to the local bind; override in prod via env.
export const POOL_API_URL = (process.env.POOL_API_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
// The public stratum host miners actually connect to (NOT the API host). Override per-deploy.
export const POOL_STRATUM_HOST = process.env.POOL_STRATUM_HOST || 'pool.soapbox.community';

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const TIMEOUT_MS = +(process.env.POOL_API_TIMEOUT_MS || 4000);

// Soft-fail GET → parsed JSON, or null on any failure (network, non-2xx, bad JSON, timeout).
async function getJson(path) {
  const url = `${POOL_API_URL}${path}`;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await _fetch(url, ctrl ? { signal: ctrl.signal } : {});
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const numOr = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

// ── normalization ───────────────────────────────────────────────────────────────────────────
// Miningcore's per-pool object (from /api/pools `pools[]` and /api/pools/<id> `pool`) carries:
//   id, coin:{ type|name|symbol|algorithm }, paymentProcessing:{ payoutScheme, minimumPayment },
//   poolFeePercent, poolStats:{ connectedMiners, poolHashrate }, networkStats:{ networkHashrate,
//   networkDifficulty, blockHeight }, ports:{ "<port>": { tls, difficulty } }.
// We pick a small, stable subset and tolerate field-name drift across Miningcore versions.
export function normalizePool(p) {
  if (!p || typeof p !== 'object') return null;
  const coin = p.coin || {};
  const stats = p.poolStats || {};
  const net = p.networkStats || {};
  const pay = p.paymentProcessing || {};

  // ports: object keyed by port number → array of { port, tls, difficulty }
  const portsObj = p.ports && typeof p.ports === 'object' ? p.ports : {};
  const ports = Object.entries(portsObj).map(([port, cfg]) => ({
    port: numOr(port),
    tls: !!(cfg && cfg.tls),
    difficulty: cfg && Number.isFinite(+cfg.difficulty) ? +cfg.difficulty : null,
  })).filter((x) => x.port > 0).sort((a, b) => a.port - b.port);

  return {
    id: String(p.id || coin.type || coin.symbol || ''),
    coin: String(coin.name || coin.type || coin.symbol || p.id || 'unknown'),
    symbol: String(coin.symbol || coin.type || '').toUpperCase() || null,
    algorithm: String(coin.algorithm || p.algorithm || '') || null,
    connectedMiners: numOr(stats.connectedMiners),
    hashrate: numOr(stats.poolHashrate),
    networkHashrate: numOr(net.networkHashrate),
    blockHeight: numOr(net.blockHeight) || null,
    // poolFeePercent is the operator fee — the cut that (per our config) routes to Hathor.
    feePercent: Number.isFinite(+p.poolFeePercent) ? +p.poolFeePercent : null,
    paymentScheme: String(pay.payoutScheme || '') || null,
    minimumPayment: Number.isFinite(+pay.minimumPayment) ? +pay.minimumPayment : null,
    ports,
  };
}

// ── public readers ──────────────────────────────────────────────────────────────────────────
/**
 * All pools — the multi-coin menu. GET /api/pools → normalized array. Soft-fails to [].
 * Miningcore wraps the list as `{ pools: [...] }`; we also accept a bare array defensively.
 */
export async function pools() {
  const data = await getJson('/api/pools');
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.pools) ? data.pools : []);
  return list.map(normalizePool).filter(Boolean);
}

/**
 * One pool by id. GET /api/pools/<id> → normalized record, or null if missing/unreachable.
 * Miningcore wraps as `{ pool: {...} }`; we accept a bare object too.
 */
export async function poolStats(id) {
  const key = String(id == null ? '' : id).trim();
  if (!key) return null;
  const data = await getJson(`/api/pools/${encodeURIComponent(key)}`);
  if (!data) return null;
  const raw = data.pool || data;
  return normalizePool(raw);
}

/**
 * The stratum connect line for a port: `stratum+tcp://<host>:<port>` (or `stratum+ssl://` for TLS).
 * Pure string helper — the page renders this next to the `wallet.worker` username convention.
 */
export function stratumUrl(port, { tls = false, host = POOL_STRATUM_HOST } = {}) {
  const scheme = tls ? 'stratum+ssl' : 'stratum+tcp';
  return `${scheme}://${host}:${numOr(port)}`;
}

// CLI smoke: print the live menu (soft-fails to []).
if (process.argv[1] && process.argv[1].endsWith('pool-stats.mjs')) {
  pools().then((ps) => {
    console.log(`pool-stats: ${POOL_API_URL}/api/pools → ${ps.length} pool(s)`);
    for (const p of ps) {
      console.log(`  ${p.id}  coin=${p.coin} algo=${p.algorithm} miners=${p.connectedMiners} fee=${p.feePercent}% ports=${p.ports.map((x) => x.port).join(',')}`);
    }
  });
}
