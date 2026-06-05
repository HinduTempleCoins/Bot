// mycoins.mjs — the "My Coins" data layer for the pool-as-wallet.
//
// Holds the user's receive addresses per coin (added at wallet-gen, or pasted), and merges
// them with live stats from the Miningcore API into ONE view model the My Coins page renders.
//
// Two halves, both dependency-injected so this file runs in the browser AND under
// node --test with no real network / no real localStorage:
//   - store:  a tiny localStorage-backed list of { coin, poolId, address, label, addedAt }.
//   - query:  per-address calls to Miningcore (/api/pools/{id}/miners/{addr} + /payments),
//             folded into a per-coin view model (balance, paid, hashrate, workers, payments).
//
// Privacy: the only thing sent anywhere is the user's RECEIVE ADDRESS (already public — it
// is the mining username). No secret keys ever touch this layer.

// ---------------------------------------------------------------------------
// Coin -> Miningcore pool id mapping. Mirrors pool/deploy/miningcore/config.json. The pool
// id is what the Miningcore API keys on; a coin can have several (stagenet/mainnet) — the
// store records the explicit poolId per saved address so there is no ambiguity.
// ---------------------------------------------------------------------------
export const POOL_IDS = {
  monero: { mainnet: 'xmr-mainnet', stagenet: 'xmr-stagenet', testnet: 'xmr-stagenet' },
  zephyr: { mainnet: 'zeph-mainnet' }, // filled in when the ZEPH pool entry lands
  ethereum_classic: { mainnet: 'etc', testnet: 'etc-mordor' },
};

export function defaultPoolId(coin, network = 'mainnet') {
  const m = POOL_IDS[String(coin).toLowerCase()];
  if (!m) return null;
  return m[network] || m.mainnet || Object.values(m)[0] || null;
}

const STORAGE_KEY = 'soapbox.mycoins.v1';

// ---------------------------------------------------------------------------
// Store. Pass a `storage` object with getItem/setItem (browser localStorage satisfies
// this); tests pass an in-memory stub. Records are deduped on (poolId, address).
// ---------------------------------------------------------------------------
export class MyCoinsStore {
  constructor(storage) {
    // Fall back to globalThis.localStorage in the browser; require an explicit stub in node.
    this.storage = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
    if (!this.storage) throw new Error('MyCoinsStore needs a storage backend (localStorage)');
  }

  list() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  _save(arr) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  // Add (or update the label of) a coin address. Returns the saved record.
  add({ coin, address, poolId, label, network = 'mainnet' }) {
    const c = String(coin || '').toLowerCase();
    const addr = String(address || '').trim();
    if (!c) throw new Error('add: coin required');
    if (!addr) throw new Error('add: address required');
    const pid = poolId || defaultPoolId(c, network);
    if (!pid) throw new Error(`add: no pool id known for ${c}`);
    const rec = { coin: c, poolId: pid, address: addr, label: label || '', addedAt: Date.now() };
    const arr = this.list();
    const i = arr.findIndex((r) => r.poolId === pid && r.address === addr);
    if (i >= 0) arr[i] = { ...arr[i], label: rec.label || arr[i].label };
    else arr.push(rec);
    this._save(arr);
    return arr[i >= 0 ? i : arr.length - 1];
  }

  remove({ poolId, address }) {
    const arr = this.list().filter((r) => !(r.poolId === poolId && r.address === address));
    this._save(arr);
    return arr;
  }

  clear() { this._save([]); }
}

// ---------------------------------------------------------------------------
// Query. `fetchImpl` defaults to the global fetch; tests inject a fake. `apiBase` defaults
// to the same-origin /api the pool serves.
// ---------------------------------------------------------------------------
async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res || !res.ok) {
    const status = res ? res.status : 0;
    const err = new Error(`HTTP ${status} for ${url}`);
    err.status = status;
    throw err;
  }
  return res.json();
}

// Normalize one Miningcore miner-stats payload into a flat shape, tolerating field-name
// drift between Miningcore versions. Unknown fields default to 0/[].
export function normalizeMinerStats(raw) {
  const r = raw || {};
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  return {
    pendingBalance: num(r.pendingBalance),
    pendingShares: num(r.pendingShares),
    totalPaid: num(r.totalPaid),
    todayPaid: num(r.todayPaid),
    // performance may be nested or flat depending on version
    hashrate: num(r.performance?.workers
      ? Object.values(r.performance.workers).reduce((s, w) => s + num(w.hashrate), 0)
      : r.hashrate),
    sharesPerSecond: num(r.performance?.workers
      ? Object.values(r.performance.workers).reduce((s, w) => s + num(w.sharesPerSecond), 0)
      : r.sharesPerSecond),
    workerCount: r.performance?.workers ? Object.keys(r.performance.workers).length : num(r.workerCount),
    lastSeen: r.lastSeen || null,
  };
}

// Fetch live stats for one saved address. On any error returns an `error` view (never
// throws) so one dead pool doesn't blank the whole page.
export async function fetchCoinStats(rec, { fetchImpl, apiBase = '/api' } = {}) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (!f) throw new Error('fetchCoinStats needs a fetch implementation');
  const base = `${apiBase}/pools/${encodeURIComponent(rec.poolId)}/miners/${encodeURIComponent(rec.address)}`;
  try {
    const stats = await getJson(f, base);
    let payments = [];
    try {
      payments = await getJson(f, `${base}/payments?page=0&pageSize=10`);
    } catch {
      payments = []; // payments endpoint is optional / may 404 for a never-paid address
    }
    return {
      ...rec,
      ok: true,
      stats: normalizeMinerStats(stats),
      payments: Array.isArray(payments) ? payments : [],
    };
  } catch (e) {
    return { ...rec, ok: false, error: e.message || String(e), stats: normalizeMinerStats(null), payments: [] };
  }
}

// Build the full My Coins view model: every saved address with its live stats, grouped by
// coin. Runs the per-address fetches in parallel. Pure aside from the injected fetch.
export async function buildMyCoinsView(store, { fetchImpl, apiBase = '/api' } = {}) {
  const records = store.list();
  const rows = await Promise.all(records.map((r) => fetchCoinStats(r, { fetchImpl, apiBase })));
  const byCoin = {};
  for (const row of rows) {
    (byCoin[row.coin] ||= { coin: row.coin, addresses: [], totals: { pendingBalance: 0, totalPaid: 0, hashrate: 0 } });
    byCoin[row.coin].addresses.push(row);
    if (row.ok) {
      byCoin[row.coin].totals.pendingBalance += row.stats.pendingBalance;
      byCoin[row.coin].totals.totalPaid += row.stats.totalPaid;
      byCoin[row.coin].totals.hashrate += row.stats.hashrate;
    }
  }
  return {
    coins: Object.values(byCoin),
    empty: records.length === 0,
    generatedAt: Date.now(),
  };
}
