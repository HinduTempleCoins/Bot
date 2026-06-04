// groceries.mjs — a groceries price aggregator for SoapBox (queue task #235), the Flipp/Basket
// model: one grocery item priced across stores, a whole basket totalled across stores with the
// cheapest flagged, weekly-ad link-outs, and a recent price trend. Built to fuse THREE clearly
// separated provenance lanes per the v3 owned-data pattern:
//   • open-prices — Open Food Facts' Open Prices (prices.openfoodfacts.org), the open, STORABLE
//     community grocery-price source. Keyless GET; soft-fails to nothing.
//   • crowdsource — our OWNED fresh local-price layer, reused via DEFENSIVE import of
//     crowdsource-prices.mjs (its outlierFilter + store + submission shape). We do NOT duplicate
//     its fusion/reward logic; we inject the crowd source so tests stay 100% offline.
//   • official — the gov series already wired in coliving.mjs (groceryPrices / USDA), reused
//     defensively as the stabilizing anchor when crowd + open-prices are thin.
//
// DESIGN INVARIANTS (strict, matching the sibling soapbox modules):
//   • ESM .mjs, soft-fail (a public fn NEVER throws — returns [] / null / a degraded shape).
//   • Injectable fetch (__setFetch) + injectable crowdsource source + injectable open-prices /
//     official sources via `deps` → fully offline tests.
//   • Reuse crowdsource-prices.mjs + coliving.mjs by DEFENSIVE import; a missing/renamed export
//     degrades that one lane, never crashes.
//   • ESCAPE every rendered string (renderPage). NO secrets read or logged here (keys, if any,
//     live inside coliving's own getters / the injected sources).
//   • Every priced line is PROVENANCE-TAGGED (crowd | open-prices | official | fused) with an
//     `asOf` ISO timestamp.
//   • weeklyAd link-outs are WINDOWED links only — never fetched, never stored.
//
//   import { productPrices, basketCompare, weeklyAd, priceTrend, renderPage, dataNote }
//     from './soapbox/groceries.mjs'
//   node integrations/soapbox/groceries.mjs "milk" "Denver"

// ── defensive reuse (no duplication) — every USE is guarded ────────────────────────────────
import * as crowdsource from '../crowdsource-prices.mjs';
import * as coliving from './coliving.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxGroceries/1.0 (+https://data.soapbox.community)' };

// ── tiny helpers ───────────────────────────────────────────────────────────────────────────
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;
const normKey = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

// HTML-escape for any rendered text (matches sibling soapbox modules).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const PROVENANCE = Object.freeze({ CROWD: 'crowdsource', OPEN: 'open-prices', OFFICIAL: 'official', FUSED: 'fused' });

// ── open-prices lane ────────────────────────────────────────────────────────────────────────
// Open Food Facts' Open Prices: a community, openly-licensed, STORABLE grocery price dataset.
// We pull recent price rows for an item (+ optional location string) and normalize each into a
// store line. Soft-fails to [] (network down / no key / shape change → never throws).
//
// deps.openPrices may be injected for offline tests:
//   • a function ({ item, city }) → rawRows[]   OR
//   • an object { search({ item, city }) → rawRows[] }
// When not injected we call the live keyless endpoint via _fetch.
async function fetchOpenPrices({ item, city }, deps = {}) {
  const inj = deps.openPrices;
  try {
    if (typeof inj === 'function') return normalizeOpenPrices(await inj({ item, city }) || [], { city });
    if (inj && typeof inj.search === 'function') return normalizeOpenPrices(await inj.search({ item, city }) || [], { city });
  } catch { return []; }

  // live (keyless) — best effort. Open Prices REST returns { items: [...] }.
  try {
    const q = new URLSearchParams({ product_name: String(item || ''), order_by: '-created', size: '25' });
    const r = await _fetch(`https://prices.openfoodfacts.org/api/v1/prices?${q.toString()}`, { headers: UA });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (Array.isArray(j?.items) ? j.items : []);
    return normalizeOpenPrices(rows, { city });
  } catch { return []; }
}

// Normalize raw Open Prices rows into store lines. Tolerant of the public shape AND of simple
// injected fixtures ({ store, price, unit, date }). Drops rows without a usable price.
function normalizeOpenPrices(rows, { city } = {}) {
  const cityKey = normKey(city);
  const out = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || typeof row !== 'object') continue;
    const price = num(row.price);
    if (price == null || price <= 0) continue;
    const store = String(
      row.store
      ?? row.location_osm_name
      ?? (row.location && (row.location.osm_name || row.location.name))
      ?? 'Open Prices',
    ).trim() || 'Open Prices';
    // honor an optional city filter when the row carries a location hint
    if (cityKey) {
      const loc = normKey(row.city ?? (row.location && (row.location.osm_city || row.location.city)) ?? '');
      if (loc && loc !== cityKey) continue;
    }
    const asOf = row.asOf ?? row.date ?? row.created ?? null;
    out.push({
      store,
      price: round2(price),
      unit: String(row.unit ?? row.price_per ?? 'each').trim() || 'each',
      source: PROVENANCE.OPEN,
      asOf: toIso(asOf),
    });
  }
  return out;
}

function toIso(v) {
  if (v == null) return null;
  if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? String(v) : new Date(t).toISOString();
}

// ── crowdsource lane (reused defensively) ────────────────────────────────────────────────────
// Pull this item/city's owned crowd submissions through the injected source, then run them
// through crowdsource-prices.mjs' outlierFilter (robust median/MAD). Soft-fails to [].
//
// deps.crowd may be:
//   • a function ({ item, city }) → submissions[]   OR
//   • an object { list({ item, city }) }  (matches the crowdsource store contract)   OR
//   • a `store` with .list (we adapt it)
async function fetchCrowd({ item, city }, deps = {}) {
  const cityKey = normKey(city);
  const itemKey = normKey(item);
  let subs = [];
  try {
    const src = deps.crowd ?? deps.crowdSource ?? deps.store;
    if (typeof src === 'function') subs = await src({ item: itemKey, city: cityKey }) || [];
    else if (src && typeof src.list === 'function') subs = await src.list({ item: itemKey, city: cityKey }) || [];
  } catch { return []; }

  if (!Array.isArray(subs) || !subs.length) return [];

  // robust aggregate via the reused outlierFilter (defensive — degrade to a plain mean if absent).
  let agg = null;
  try {
    if (typeof crowdsource.outlierFilter === 'function') {
      agg = crowdsource.outlierFilter(subs, { now: Date.now() });
    }
  } catch { agg = null; }

  let price = null;
  let n = 0;
  let asOf = null;
  if (agg && agg.price != null) {
    price = agg.price;
    n = (agg.kept && agg.kept.length) || agg.n || subs.length;
    asOf = latestAt(agg.kept && agg.kept.length ? agg.kept : subs);
  } else {
    const vals = subs.map((s) => num(s.price)).filter((v) => v != null && v > 0);
    if (!vals.length) return [];
    price = round2(vals.reduce((a, b) => a + b, 0) / vals.length);
    n = vals.length;
    asOf = latestAt(subs);
  }
  if (price == null) return [];

  const unit = (subs[0] && subs[0].unit) ? String(subs[0].unit) : 'each';
  // crowd is a city-level blended figure, not per-store; surface it as one "Local (crowd)" line.
  return [{ store: 'Local (crowd)', price, unit, source: PROVENANCE.CROWD, asOf, n }];
}

function latestAt(rows) {
  let best = null;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const t = num(r && r.at);
    if (t != null && (best == null || t > best)) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}

// ── official lane (reused defensively from coliving) ─────────────────────────────────────────
// The gov grocery proxy (USDA via coliving.groceryPrices) as the stabilizing anchor. Injectable
// for offline tests via deps.official (function|{groceryLine}); otherwise the defensive call to
// coliving.groceryPrices. Soft-fails to null. Returns one store line tagged `official` or null.
async function fetchOfficial({ item }, deps = {}) {
  const itemKey = normKey(item);
  try {
    const inj = deps.official;
    let rec = null;
    if (typeof inj === 'function') rec = await inj({ item: itemKey });
    else if (inj && typeof inj.groceryLine === 'function') rec = await inj.groceryLine({ item: itemKey });
    else if (typeof coliving.groceryPrices === 'function') {
      // map a few common items to USDA commodity codes; default MILK as the basket proxy.
      const commodity = COMMODITY_MAP[itemKey] || 'MILK';
      rec = await coliving.groceryPrices({ commodity });
    }
    const value = num(rec && rec.value);
    if (value == null || value <= 0) return null;
    return {
      store: 'National avg (official)',
      price: round2(value),
      unit: String((rec && rec.unit) || 'each'),
      source: PROVENANCE.OFFICIAL,
      asOf: rec && rec.fetched_at ? rec.fetched_at : null,
    };
  } catch { return null; }
}

const COMMODITY_MAP = Object.freeze({
  milk: 'MILK', eggs: 'EGGS', egg: 'EGGS', cheese: 'MILK', butter: 'MILK',
  beef: 'CATTLE', steak: 'CATTLE', pork: 'HOGS', chicken: 'CHICKENS',
  bread: 'WHEAT', flour: 'WHEAT', rice: 'RICE', corn: 'CORN',
});

// ── productPrices: one item across stores, blended + provenance-tagged ───────────────────────
// Returns [{ store, price, unit, source, asOf }] (+ n on crowd). Soft-fails to [].
// Blend = open-prices store lines ∪ crowd local line ∪ official anchor, sorted cheapest-first.
export async function productPrices({ item, city } = {}, deps = {}) {
  if (!item) return [];
  try {
    const [open, crowd, official] = await Promise.all([
      fetchOpenPrices({ item, city }, deps).catch(() => []),
      fetchCrowd({ item, city }, deps).catch(() => []),
      fetchOfficial({ item }, deps).catch(() => null),
    ]);
    const lines = [...(open || []), ...(crowd || [])];
    if (official) lines.push(official);
    // normalize + sort cheapest-first; keep only usable rows.
    return lines
      .filter((l) => l && num(l.price) != null && num(l.price) > 0)
      .map((l) => ({ store: l.store, price: round2(num(l.price)), unit: l.unit || 'each', source: l.source, asOf: l.asOf ?? null, ...(l.n != null ? { n: l.n } : {}) }))
      .sort((a, b) => a.price - b.price);
  } catch {
    return [];
  }
}

// ── basketCompare: total a basket across stores, flag the cheapest ───────────────────────────
// For each item we gather per-store prices (productPrices), then build a per-store total over the
// items that store carries. Each line is provenance-tagged. Returns:
//   { city, items, stores:[ { store, total, lines:[{item,price,unit,source,asOf}], coverage } ],
//     cheapest: storeName|null, asOf }
// Soft-fails to a degraded-but-valid shape (empty stores) — never throws.
export async function basketCompare({ items, city, stores } = {}, deps = {}) {
  const itemList = (Array.isArray(items) ? items : []).map((s) => String(s)).filter(Boolean);
  const asOf = new Date().toISOString();
  const base = { city: normKey(city), items: itemList, stores: [], cheapest: null, asOf };
  if (!itemList.length) return base;

  try {
    // item → store-priced lines
    const perItem = await Promise.all(itemList.map(async (item) => ({
      item,
      prices: await productPrices({ item, city }, deps).catch(() => []),
    })));

    // collect candidate store names (optionally filtered to a requested set)
    const wanted = Array.isArray(stores) && stores.length ? new Set(stores.map((s) => String(s))) : null;
    const storeNames = new Set();
    for (const { prices } of perItem) {
      for (const p of prices) {
        if (!wanted || wanted.has(p.store)) storeNames.add(p.store);
      }
    }

    const storeRows = [];
    for (const store of storeNames) {
      const lines = [];
      let total = 0;
      for (const { item, prices } of perItem) {
        const hit = prices.find((p) => p.store === store);
        if (hit) {
          lines.push({ item, price: hit.price, unit: hit.unit, source: hit.source, asOf: hit.asOf ?? null });
          total += hit.price;
        }
      }
      if (lines.length) {
        storeRows.push({ store, total: round2(total), coverage: lines.length / itemList.length, lines });
      }
    }

    // cheapest = lowest total among stores with FULL coverage when any exist, else lowest total overall.
    const full = storeRows.filter((s) => s.coverage >= 1);
    const pool = full.length ? full : storeRows;
    pool.sort((a, b) => a.total - b.total);
    storeRows.sort((a, b) => a.total - b.total);
    const cheapest = pool.length ? pool[0].store : null;

    return { ...base, stores: storeRows, cheapest };
  } catch {
    return base;
  }
}

// ── weeklyAd: a WINDOWED link-out to a store's official weekly ad (never fetched, never stored) ─
// Returns { store, url, label, window:{ from, to }, stored:false } or null for an unknown store.
// We hold only the canonical weekly-ad landing URL per chain; the link opens the store's own ad.
export const WEEKLY_AD_LINKS = Object.freeze({
  walmart: ['Walmart', 'https://www.walmart.com/store-finder'],
  kroger: ['Kroger', 'https://www.kroger.com/weeklyad'],
  safeway: ['Safeway', 'https://www.safeway.com/weeklyad/'],
  albertsons: ['Albertsons', 'https://www.albertsons.com/weeklyad/'],
  target: ['Target', 'https://weeklyad.target.com/'],
  costco: ['Costco', 'https://www.costco.com/savings.html'],
  aldi: ['ALDI', 'https://www.aldi.us/weekly-specials/'],
  publix: ['Publix', 'https://www.publix.com/savings/weekly-ad'],
  'whole foods': ['Whole Foods', 'https://www.wholefoodsmarket.com/sales-flyer'],
  'trader joe\'s': ['Trader Joe\'s', 'https://www.traderjoes.com/home/products'],
  'food lion': ['Food Lion', 'https://www.foodlion.com/weekly-specials/'],
  meijer: ['Meijer', 'https://www.meijer.com/shopping/weekly-ad.html'],
});

export function weeklyAd(store) {
  const key = normKey(store);
  if (!key) return null;
  // exact, then substring match (handles "Local (crowd)" and chain-with-suffix names)
  let hit = WEEKLY_AD_LINKS[key];
  if (!hit) {
    const k = Object.keys(WEEKLY_AD_LINKS).find((name) => key.includes(name) || name.includes(key));
    hit = k ? WEEKLY_AD_LINKS[k] : null;
  }
  if (!hit) return null;
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  return {
    store: hit[0],
    url: hit[1],
    label: `${hit[0]} weekly ad`,
    window: { from: new Date(now).toISOString(), to: new Date(now + week).toISOString() },
    stored: false, // link-out only — we never fetch or persist the ad contents
  };
}

// ── priceTrend: recent trend for an item from available (injected) data ──────────────────────
// Builds a time-ordered series of observed prices for item/city from the crowd source (preferred,
// it carries timestamps) and/or open-prices, then summarizes the direction. Soft-fails to an
// empty series. Returns { item, city, series:[{ at, price, source }], change, direction, asOf }.
export async function priceTrend(item, city, deps = {}) {
  const asOf = new Date().toISOString();
  const empty = { item: normKey(item), city: normKey(city), series: [], change: null, direction: 'flat', asOf };
  if (!item) return empty;
  try {
    const points = [];

    // crowd submissions carry per-observation timestamps — the richest trend signal.
    const cityKey = normKey(city);
    const itemKey = normKey(item);
    let subs = [];
    try {
      const src = deps.crowd ?? deps.crowdSource ?? deps.store;
      if (typeof src === 'function') subs = await src({ item: itemKey, city: cityKey }) || [];
      else if (src && typeof src.list === 'function') subs = await src.list({ item: itemKey, city: cityKey }) || [];
    } catch { subs = []; }
    for (const s of (Array.isArray(subs) ? subs : [])) {
      const p = num(s.price); const at = num(s.at);
      if (p != null && p > 0 && at != null) points.push({ at, price: round2(p), source: PROVENANCE.CROWD });
    }

    // open-prices rows (may carry dates)
    const open = await fetchOpenPrices({ item, city }, deps).catch(() => []);
    for (const o of open) {
      const at = o.asOf ? Date.parse(o.asOf) : NaN;
      if (!Number.isNaN(at)) points.push({ at, price: o.price, source: PROVENANCE.OPEN });
    }

    if (!points.length) return empty;
    points.sort((a, b) => a.at - b.at);
    const series = points.map((p) => ({ at: new Date(p.at).toISOString(), price: p.price, source: p.source }));

    const first = points[0].price;
    const last = points[points.length - 1].price;
    const change = first > 0 ? round2(((last - first) / first) * 100) : null;
    const direction = change == null || Math.abs(change) < 0.5 ? 'flat' : (change > 0 ? 'up' : 'down');

    return { item: itemKey, city: cityKey, series, change, direction, asOf };
  } catch {
    return empty;
  }
}

// ── renderPage: escaped HTML basket compare + provenance badges + crowdsource note ───────────
// Renders a basketCompare() result. EVERY user-influenced string (city, item, store, source) is
// escaped. Cheapest store flagged; each line carries a provenance badge.
export function renderPage(data = {}) {
  const city = esc(data.city || 'your area');
  const stores = Array.isArray(data.stores) ? data.stores : [];
  const items = Array.isArray(data.items) ? data.items : [];
  const cheapest = data.cheapest == null ? null : String(data.cheapest);
  const asOf = esc(data.asOf || '');

  const badge = (src) => {
    const s = String(src || 'n/a');
    const cls = s === PROVENANCE.CROWD ? 'badge-crowd'
      : s === PROVENANCE.OPEN ? 'badge-open'
      : s === PROVENANCE.OFFICIAL ? 'badge-official'
      : s === PROVENANCE.FUSED ? 'badge-fused' : 'badge-source';
    return `<span class="badge ${cls}">${esc(s)}</span>`;
  };

  const storeBlocks = stores.map((st) => {
    const isCheapest = cheapest != null && st.store === cheapest;
    const rows = (Array.isArray(st.lines) ? st.lines : []).map((l) => `      <tr>
        <td class="item">${esc(l.item)}</td>
        <td class="price">$${esc(round2(num(l.price)) ?? 'n/a')}</td>
        <td class="unit">${esc(l.unit || 'each')}</td>
        <td class="prov">${badge(l.source)}</td>
      </tr>`).join('\n');
    return `  <section class="store${isCheapest ? ' cheapest' : ''}" data-store="${esc(st.store)}">
    <h4>${esc(st.store)} — $${esc(round2(num(st.total)) ?? 'n/a')}${isCheapest ? ' <span class="badge badge-cheapest">cheapest</span>' : ''}</h4>
    <table class="basket">
      <thead><tr><th>Item</th><th>Price</th><th>Unit</th><th>Source</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
  }).join('\n');

  return `<section class="soapbox-groceries" data-city="${city}">
  <h3>Grocery basket compare — ${city}</h3>
  <p class="basket-items">Basket: ${items.map((i) => esc(i)).join(', ') || '—'}</p>
${storeBlocks || '  <p class="empty">No store prices available yet.</p>'}
  <p class="crowd-note">Some of these are prices <strong>you helped crowdsource</strong> — submit a real local grocery price for your city and earn token. Crowd figures are blended with Open Prices and official series, each provenance-tagged.</p>
  <p class="as-of">As of ${asOf}</p>
</section>`;
}

// ── dataNote: provenance + as-of ─────────────────────────────────────────────────────────────
export function dataNote() {
  return {
    sources: [
      { id: PROVENANCE.OPEN, name: 'Open Food Facts — Open Prices', url: 'https://prices.openfoodfacts.org/', note: 'Open, community-licensed, storable grocery prices.' },
      { id: PROVENANCE.CROWD, name: 'SoapBox crowdsource', note: 'Owned, fresh local prices you submit (token-rewarded), robust-aggregated.' },
      { id: PROVENANCE.OFFICIAL, name: 'USDA / official series', note: 'Gov commodity grocery proxy via coliving.mjs — the stabilizing anchor.' },
    ],
    provenanceTags: [PROVENANCE.CROWD, PROVENANCE.OPEN, PROVENANCE.OFFICIAL, PROVENANCE.FUSED],
    note: 'Each priced line is provenance-tagged (crowd vs open-prices vs official) and carries an as-of timestamp. Weekly-ad links are windowed link-outs to the store\'s own ad — never fetched or stored.',
    asOf: new Date().toISOString(),
  };
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('groceries.mjs')) {
  const item = process.argv[2] || 'milk';
  const city = process.argv[3] || undefined;
  // offline demo sources (no network, no keys)
  const openPrices = ({ item: it }) => [
    { store: 'Kroger', price: it === 'milk' ? 3.49 : 2.99, unit: 'gallon', date: '2026-06-01' },
    { store: 'Walmart', price: it === 'milk' ? 3.29 : 2.79, unit: 'gallon', date: '2026-06-02' },
  ];
  const crowd = () => [
    { item: normKey(item), city: normKey(city), price: 3.6, unit: 'gallon', at: Date.now() - 2 * 86400000 },
    { item: normKey(item), city: normKey(city), price: 3.4, unit: 'gallon', at: Date.now() - 1 * 86400000 },
  ];
  const official = () => ({ value: 3.55, unit: 'gallon', fetched_at: new Date().toISOString() });
  const deps = { openPrices, crowd, official };

  const prices = await productPrices({ item, city }, deps);
  console.log(`\nproductPrices(${item}${city ? `, ${city}` : ''}):`);
  for (const p of prices) console.log(`  ${String(p.store).padEnd(24)} $${p.price}  ${p.unit}  [${p.source}]`);

  const basket = await basketCompare({ items: [item, 'eggs'], city, stores: null }, deps);
  console.log('\nbasketCompare cheapest:', basket.cheapest);
  console.log('\nHTML:\n', renderPage(basket));

  console.log('\nweeklyAd(Kroger):', JSON.stringify(weeklyAd('Kroger')));
  console.log('\npriceTrend:', JSON.stringify(await priceTrend(item, city, deps)));
  console.log('\ndataNote:', JSON.stringify(dataNote(), null, 2));
}
