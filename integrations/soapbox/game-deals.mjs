// game-deals.mjs — the SoapBox new/digital game-price reader. Reads the CheapShark API
// (cheapshark.com/api/1.0) — free, FULLY keyless — for current digital prices across PC stores
// (Steam, GOG, Epic, Humble, Fanatical, GreenManGaming, …). Powers the Gamer Hub "what's the best
// price on this game right now" pages for collectors and players.
//
//   CheapShark endpoints we use (all keyless):
//     /deals?title=<t>           → array of deal rows { title, storeID, salePrice, normalPrice, savings, dealID, … }
//     /games?title=<t>&limit=N   → game lookup by title → [{ gameID, external, cheapest, thumb }]
//     /stores                    → store directory → [{ storeID, storeName, isActive, images }]
//
// Pattern matches worldbank.mjs / macro.mjs: ESM, zero deps, keyless, __setFetch hook, graceful
// soft-fail (return []/null on error, NEVER throw), a guarded CLI block, escaped rendered HTML, no
// secrets, source/as-of provenance discipline.
//
//   import { dealsFor, bestPrice, storeList, renderDeals, dataNote, __setFetch } from './game-deals.mjs'
//   node integrations/soapbox/game-deals.mjs "Hollow Knight"      # best digital prices
//   node integrations/soapbox/game-deals.mjs --stores            # the store directory

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// CheapShark asks nothing of clients (keyless); identify ourselves anyway, like the sibling modules.
const UA = { 'User-Agent': 'SoapBoxGameDeals/1.0 (+https://data.soapbox.community)' };

const BASE = 'https://www.cheapshark.com/api/1.0';

// CheapShark store directory is keyed by numeric storeID; we keep a small built-in map so a deal row
// can be labeled with a human store name even when /stores hasn't been fetched (and as a test seed).
// This is a convenience cache, refreshed by storeList() — not authoritative.
export const KNOWN_STORES = {
  '1': 'Steam', '2': 'GamersGate', '3': 'GreenManGaming', '7': 'GOG', '8': 'Origin',
  '11': 'Humble Store', '13': 'Uplay', '15': 'Fanatical', '21': 'WinGameStore',
  '23': 'GameBillet', '24': 'Voidu', '25': 'Epic Games Store', '27': 'Gamesplanet',
  '30': 'IndieGala', '31': 'Blizzard Shop', '33': 'DLGamer', '34': 'Noctre', '35': 'DreamGame',
};

// ── pure helpers (unit-tested offline) ──────────────────────────────────────────────────────────────

// Minimal HTML-escape for rendered text (matches the sibling soapbox modules).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Number(null)/Number('') coerce to 0, which is wrong for prices — null/'' means "no value reported".
const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

// Resolve a storeID → store name using the live directory if provided, else the built-in map.
export function storeName(storeID, directory) {
  const id = String(storeID == null ? '' : storeID);
  if (directory && typeof directory === 'object' && directory[id]) return directory[id];
  return KNOWN_STORES[id] || `Store ${id || '?'}`;
}

// Normalize one CheapShark /deals row → a clean { title, store, storeID, price, retail, savings, dealUrl }.
// Returns null for unusable rows. `directory` is an optional { storeID: name } map for labeling.
export function normalizeDeal(row, directory) {
  if (!row || typeof row !== 'object') return null;
  const price = num(row.salePrice);
  if (price == null) return null;
  const retail = num(row.normalPrice);
  const savings = num(row.savings); // CheapShark gives savings as a 0..100 percent string
  const storeID = row.storeID != null ? String(row.storeID) : null;
  // CheapShark deep-link: /redirect?dealID=… (the canonical "go buy" link, not a scrape).
  const dealUrl = row.dealID ? `${BASE}/deal?dealID=${encodeURIComponent(String(row.dealID))}` : null;
  return {
    title: row.title != null ? String(row.title) : null,
    store: storeName(storeID, directory),
    storeID,
    price,
    retail: retail != null ? retail : price,
    savings: savings != null ? Math.round(savings * 10) / 10 : null,
    dealUrl,
  };
}

// ── live data (keyless; each fails soft to []/null) ─────────────────────────────────────────────────

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Current digital deals for a game title across stores, cheapest first.
 * Returns a normalized [{ title, store, storeID, price, retail, savings, dealUrl }] (ascending price),
 * or [] on any failure / empty result.
 * @param {string} title
 * @param {{limit?:number, directory?:object}} [opts]
 */
export async function dealsFor(title, { limit = 20, directory = null } = {}) {
  const t = typeof title === 'string' ? title.trim() : '';
  if (!t) return [];
  const n = Math.max(1, Math.min(60, Number(limit) || 20));
  const url = `${BASE}/deals?title=${encodeURIComponent(t)}&pageSize=${n}`;
  const j = await getJson(url);
  if (!Array.isArray(j)) return [];
  const out = [];
  for (const row of j) { const d = normalizeDeal(row, directory); if (d) out.push(d); }
  out.sort((a, b) => a.price - b.price);
  return out.slice(0, n);
}

/**
 * The single best (cheapest) current digital price for a title, or null if none.
 * Returns one normalized deal row (the cheapest), with the comparison set count attached.
 * @param {string} title
 * @param {{directory?:object}} [opts]
 */
export async function bestPrice(title, { directory = null } = {}) {
  const deals = await dealsFor(title, { directory });
  if (!deals.length) return null;
  return { ...deals[0], comparedAcross: deals.length };
}

/**
 * The CheapShark store directory: [{ storeID, storeName, isActive }], active stores only.
 * Returns [] on failure. Also usable to build a { storeID: name } labeling map.
 */
export async function storeList() {
  const j = await getJson(`${BASE}/stores`);
  if (!Array.isArray(j)) return [];
  const out = [];
  for (const s of j) {
    if (!s || typeof s !== 'object') continue;
    const storeID = s.storeID != null ? String(s.storeID) : null;
    if (storeID == null) continue;
    // isActive is 0/1 in the API; treat missing as active.
    const isActive = s.isActive == null ? true : Boolean(num(s.isActive));
    out.push({ storeID, storeName: s.storeName != null ? String(s.storeName) : storeName(storeID), isActive });
  }
  return out.filter((s) => s.isActive);
}

/** Build a { storeID: name } map from storeList() output (or KNOWN_STORES fallback). */
export function storeDirectory(stores) {
  const dir = {};
  if (Array.isArray(stores)) for (const s of stores) if (s && s.storeID != null) dir[String(s.storeID)] = s.storeName;
  return dir;
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────────

// Money formatting for display ($9.99). null → em-dash.
function money(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return '$' + Number(v).toFixed(2);
}

/**
 * Escaped HTML deals table for one title. PURE; soft-handles missing fields. Columns: Store, Price,
 * Retail, Savings (with a "go buy" link out per row — never a scrape, the CheapShark redirect).
 * @param {string} title
 * @param {Array} deals  from dealsFor()
 */
export function renderDeals(title, deals = []) {
  const head = `<section class="game-deals"><h2>Digital prices — ${esc(title || 'game')}</h2>`;
  if (!Array.isArray(deals) || !deals.length) {
    return head + `<p class="gd-empty">No current digital deals found.</p>`
      + `<p class="data-note">${esc(dataNote())}</p></section>`;
  }
  const parts = [head];
  parts.push('<table class="gd-table"><thead><tr><th>Store</th><th>Price</th><th>Retail</th><th>Savings</th><th></th></tr></thead><tbody>');
  for (const d of deals) {
    const link = d.dealUrl ? `<a href="${esc(d.dealUrl)}" target="_blank" rel="noopener nofollow">view →</a>` : '';
    const sav = d.savings != null && d.savings > 0 ? `${esc(d.savings)}%` : '—';
    parts.push(`<tr><td>${esc(d.store)}</td><td>${esc(money(d.price))}</td><td>${esc(money(d.retail))}</td><td>${sav}</td><td>${link}</td></tr>`);
  }
  parts.push('</tbody></table>');
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names CheapShark + the live-this-request caveat. */
export function dataNote() {
  return 'source: CheapShark (cheapshark.com), live digital store prices this request';
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('game-deals.mjs')) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--stores') {
    const stores = await storeList();
    console.log('SoapBox Game Deals — CheapShark store directory');
    console.log('─'.repeat(50));
    if (stores.length) stores.forEach((s) => console.log(`  ${s.storeID.padStart(3)}  ${s.storeName}`));
    else console.log('  no data');
  } else {
    const title = argv.join(' ') || 'Hollow Knight';
    const deals = await dealsFor(title);
    console.log(`SoapBox Game Deals — best digital prices for "${title}"`);
    console.log('─'.repeat(50));
    if (deals.length) deals.forEach((d) => console.log(`  ${d.store.padEnd(20)} ${money(d.price).padStart(8)}  (retail ${money(d.retail)}${d.savings ? `, -${d.savings}%` : ''})`));
    else console.log('  no deals found');
    console.log(`  ${dataNote()}`);
  }
}
