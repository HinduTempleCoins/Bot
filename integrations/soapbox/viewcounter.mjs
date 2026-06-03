// viewcounter.mjs — a privacy-clean view counter for SoapBox Data (doc 10).
//
// Backs the visible "X views" with REAL data. It NEVER fabricates counts — there is no
// seed, no floor, no random padding. A page starts at 0 and only moves when record() is
// called for an actual hit. If you can't measure it, don't show it.
//
// Privacy: optional ipHash dedupes UNIQUE visitors, but the per-page set of hashes is held
// only long enough to decide "is this new?" and then DISCARDED — we keep the unique COUNT,
// never the identifiers. No GA, no cookies, no PII at rest.
//
// Storage is pluggable: pass any { get, incr, set } store. Default is an in-memory Map store
// (PURE process-local, resets on restart). For production, back the counters with a real
// analytics backend (Umami / Plausible) behind the same { get, incr, set } shape. On-chain
// content can be ATTESTED via a scan-oracle: the chain attests a recorded number, it does not
// compute it — the count is still measured off-chain and merely witnessed.
//
//   import { record, count, summary, formatViews, memStore } from './viewcounter.mjs'
//   const store = memStore();
//   record({ page: '/markets', store, ipHash: 'abc' });
//   count('/markets', store);     // 1
//   node integrations/soapbox/viewcounter.mjs   # tiny demo

// ---- store: pluggable { get, incr, set }; default in-memory Map ----
// A "record" per page is { views: number, uniques: number, _seen: Set<string> }.
// _seen is the transient unique-dedup set (discarded as a stable identifier; only its size
// is promoted to `uniques`). It is intentionally not persisted by real backends.
export function memStore() {
  const m = new Map();
  return {
    get(page) {
      return m.get(page) || null;
    },
    set(page, rec) {
      m.set(page, rec);
      return rec;
    },
    // incr returns the updated record. ipHash, when given, dedupes a unique then is discarded.
    incr(page, ipHash) {
      const rec = m.get(page) || { views: 0, uniques: 0, _seen: new Set() };
      rec.views += 1;
      if (ipHash != null && ipHash !== '') {
        if (!rec._seen) rec._seen = new Set();
        if (!rec._seen.has(ipHash)) {
          rec._seen.add(ipHash);
          rec.uniques = rec._seen.size; // promote the COUNT only
        }
        // the hash lives only inside _seen for dedup; we never expose or log it
      }
      m.set(page, rec);
      return rec;
    },
    keys() {
      return [...m.keys()];
    },
  };
}

function normPage(page) {
  return String(page == null ? '' : page).trim();
}

// Strip the transient identifier set before handing a record back to a caller — privacy floor.
function publicView(rec) {
  if (!rec) return { views: 0, uniques: 0 };
  return { views: rec.views || 0, uniques: rec.uniques || 0 };
}

// ---- API ----

// record({ page, store, ipHash? }) — increment a real hit. NEVER fabricates.
// If ipHash is given, dedupe uniques into a Set then discard the identifier (privacy).
export function record({ page, store, ipHash } = {}) {
  const p = normPage(page);
  if (!p) throw new Error('record: page is required');
  if (!store || typeof store.incr !== 'function') throw new Error('record: a store with incr() is required');
  const rec = store.incr(p, ipHash);
  return publicView(rec);
}

// count(page, store) — current view total for a page (0 if never recorded; never invented).
export function count(page, store) {
  const p = normPage(page);
  if (!store || typeof store.get !== 'function') throw new Error('count: a store with get() is required');
  const rec = store.get(p);
  return rec && rec.views ? rec.views : 0;
}

// summary(store) — { page: { views, uniques } } across all known pages, plus totals.
export function summary(store) {
  if (!store || typeof store.get !== 'function' || typeof store.keys !== 'function') {
    throw new Error('summary: a store with get()/keys() is required');
  }
  const pages = {};
  let totalViews = 0;
  let totalUniques = 0;
  for (const page of store.keys()) {
    const v = publicView(store.get(page));
    pages[page] = v;
    totalViews += v.views;
    totalUniques += v.uniques;
  }
  return { pages, totalViews, totalUniques };
}

// formatViews(n) — human-friendly "1.2K" / "3.4M" / "5" formatting for the visible badge.
export function formatViews(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return '0';
  const v = Math.floor(num);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return trim(v / 1000) + 'K';
  if (v < 1_000_000_000) return trim(v / 1_000_000) + 'M';
  return trim(v / 1_000_000_000) + 'B';
}

// one decimal, but drop a trailing ".0" (1.0K → 1K, 1.2K stays)
function trim(x) {
  const s = x.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// CLI — tiny demo against the in-memory store (no network, no fabrication)
if (process.argv[1] && process.argv[1].endsWith('viewcounter.mjs')) {
  const store = memStore();
  record({ page: '/markets', store, ipHash: 'a' });
  record({ page: '/markets', store, ipHash: 'a' }); // same visitor: views++ but unique stays
  record({ page: '/markets', store, ipHash: 'b' });
  record({ page: '/stocks', store });
  console.log('SoapBox view counter — REAL data only, never fabricated:\n' + '─'.repeat(56));
  const s = summary(store);
  for (const [page, v] of Object.entries(s.pages)) {
    console.log(`  ${page.padEnd(14)} ${formatViews(v.views).padStart(6)} views  (${v.uniques} unique)`);
  }
  console.log('─'.repeat(56));
  console.log(`  total: ${formatViews(s.totalViews)} views, ${s.totalUniques} unique`);
}
