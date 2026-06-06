// game-collectibles.mjs — the SoapBox used/retro/collectible game reader. Where game-deals.mjs covers
// NEW digital prices, this covers the SECONDARY market: used cartridges, sealed retro, CIB (complete-
// in-box) console games — the collector's side of the Gamer Hub.
//
// POSTURE — link-out, never scrape. The authoritative used/retro pricing sources (PriceCharting, eBay
// sold listings) are proprietary aggregators whose terms forbid storing/redistributing their numbers.
// So by default this module is `posture:'aggregate'`: it builds DEEP-LINK SEARCH URLs that send the
// collector straight to those sources, and surfaces no scraped price of its own. This is the same
// HOST-vs-WINDOW discipline as posture.mjs — we never persist a WINDOW source's data.
//
//   eBay Browse API (key-gated): if an EBAY_APP_ID (named, not embedded) is present in the environment,
//   ebayBrowse() will return live "buy it now" listing summaries (a WINDOW result — display only,
//   never stored). With NO key it SOFT-SKIPS to null and the link-out builders carry the page. The key
//   is referenced by env-var NAME only; no secret is ever written into this file.
//
// Pattern matches the sibling soapbox modules: ESM, zero deps, keyless-FIRST, __setFetch hook, graceful
// soft-fail (return []/null, NEVER throw), guarded CLI, escaped rendered HTML, no secrets.
//
//   import { collectorLinks, ebayBrowse, hasEbayKey, renderCollectibles, dataNote, __setFetch } from './game-collectibles.mjs'
//   node integrations/soapbox/game-collectibles.mjs "Chrono Trigger" SNES

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxGameCollectibles/1.0 (+https://data.soapbox.community)' };

// The eBay Browse API key is referenced BY NAME only — soft-skip when absent (no secret in this file).
export const API_KEY_ENV = ['EBAY_APP_ID', 'EBAY_OAUTH_TOKEN'];
function resolveKey() {
  for (const name of API_KEY_ENV) { const v = process.env[name]; if (v && String(v).trim()) return String(v).trim(); }
  return '';
}
/** True when an eBay credential is present in the environment (so callers can branch UI). */
export function hasEbayKey() { return Boolean(resolveKey()); }

// eBay Browse API host. Used only when keyed; otherwise we never touch it.
const EBAY_BROWSE = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

// ── pure helpers (unit-tested offline) ──────────────────────────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

// Compose a clean "title + platform" search phrase, trimming/collapsing whitespace.
export function searchPhrase(title, platform) {
  const t = (title == null ? '' : String(title)).trim();
  const p = (platform == null ? '' : String(platform)).trim();
  return [t, p].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/**
 * Build the deep-link search URLs that send a collector to the authoritative used/retro sources.
 * POSTURE: 'aggregate' — link out, never scrape. Returns:
 *   { posture:'aggregate', phrase, links: [{ label, url, source, note }] }
 * Always returns an object (empty links only if title is blank).
 * @param {string} title
 * @param {string} [platform]  e.g. 'SNES', 'PS1', 'N64'
 */
export function collectorLinks(title, platform = '') {
  const phrase = searchPhrase(title, platform);
  if (!phrase) return { posture: 'aggregate', phrase: '', links: [] };
  const q = encodeURIComponent(phrase);
  const links = [
    {
      label: 'PriceCharting — loose / CIB / sealed prices',
      url: `https://www.pricecharting.com/search-products?q=${q}&type=prices`,
      source: 'PriceCharting',
      note: 'tracked loose / complete-in-box / sealed value history',
    },
    {
      label: 'eBay — sold & completed listings',
      // sold-listings deep link: LH_Sold + LH_Complete reveal realized prices.
      url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`,
      source: 'eBay (sold)',
      note: 'what copies ACTUALLY sold for, recently',
    },
    {
      label: 'eBay — active listings (buy now / auction)',
      url: `https://www.ebay.com/sch/i.html?_nkw=${q}`,
      source: 'eBay (active)',
      note: 'currently for sale',
    },
  ];
  return { posture: 'aggregate', phrase, links };
}

// Normalize one eBay item_summary → a clean { title, price, currency, condition, url }.
export function normalizeEbayItem(it) {
  if (!it || typeof it !== 'object') return null;
  const price = it.price && num(it.price.value);
  if (price == null) return null;
  return {
    title: it.title != null ? String(it.title) : null,
    price,
    currency: (it.price && it.price.currency) ? String(it.price.currency) : 'USD',
    condition: it.condition != null ? String(it.condition) : null,
    url: it.itemWebUrl != null ? String(it.itemWebUrl) : null,
  };
}

// ── live data (key-gated; soft-fails to null) ───────────────────────────────────────────────────────

/**
 * Live eBay Browse listings for a title (WINDOW result — display only, never stored).
 * Returns { posture:'window', phrase, items:[{title,price,currency,condition,url}] } when keyed and the
 * call succeeds; returns null when no key is present (soft-skip) or on any error.
 * @param {string} title
 * @param {string} [platform]
 * @param {{limit?:number}} [opts]
 */
export async function ebayBrowse(title, platform = '', { limit = 10 } = {}) {
  const key = resolveKey();
  if (!key) return null; // keyless: soft-skip — the link-out builders carry the page
  const phrase = searchPhrase(title, platform);
  if (!phrase) return null;
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  const url = `${EBAY_BROWSE}?q=${encodeURIComponent(phrase)}&limit=${n}&category_ids=139973`; // 139973 = Video Games
  try {
    const r = await _fetch(url, { headers: { ...UA, Authorization: `Bearer ${key}` } });
    if (!r || !r.ok) return null;
    const j = await r.json();
    const summaries = j && Array.isArray(j.itemSummaries) ? j.itemSummaries : [];
    const items = [];
    for (const it of summaries) { const x = normalizeEbayItem(it); if (x) items.push(x); }
    items.sort((a, b) => a.price - b.price);
    return { posture: 'window', phrase, items };
  } catch { return null; }
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────────

function money(v, currency = 'USD') {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const sym = currency === 'USD' ? '$' : '';
  return sym + Number(v).toFixed(2) + (sym ? '' : ` ${esc(currency)}`);
}

/**
 * Escaped HTML for the collector section: the link-out list always; if keyed eBay listings were fetched,
 * a small live-listings table above them. PURE; soft-handles missing fields.
 * @param {object} data  { collector: collectorLinks() result, ebay?: ebayBrowse() result }
 */
export function renderCollectibles({ collector = {}, ebay = null } = {}) {
  const phrase = esc(collector.phrase || 'game');
  const parts = [`<section class="game-collectibles"><h2>Used &amp; retro — ${phrase}</h2>`];

  // Live eBay (WINDOW) listings, only when keyed.
  if (ebay && Array.isArray(ebay.items) && ebay.items.length) {
    parts.push('<h3>Live listings</h3><table class="gc-ebay"><thead><tr><th>Item</th><th>Price</th><th>Condition</th><th></th></tr></thead><tbody>');
    for (const it of ebay.items) {
      const link = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener nofollow">view →</a>` : '';
      parts.push(`<tr><td>${esc(it.title)}</td><td>${esc(money(it.price, it.currency))}</td><td>${esc(it.condition || '—')}</td><td>${link}</td></tr>`);
    }
    parts.push('</tbody></table>');
  }

  // Link-outs (always present — the aggregate posture).
  const links = Array.isArray(collector.links) ? collector.links : [];
  parts.push('<h3>Collector price links</h3>');
  if (links.length) {
    parts.push('<ul class="gc-links">');
    for (const l of links) {
      parts.push(`<li><a href="${esc(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.label)}</a>`
        + (l.note ? ` <span class="muted">— ${esc(l.note)}</span>` : '') + '</li>');
    }
    parts.push('</ul>');
  } else {
    parts.push('<p class="gc-empty">Enter a game title to find collector pricing.</p>');
  }

  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the link-out sources + the aggregate posture (link out, never scrape). */
export function dataNote() {
  return 'source: PriceCharting + eBay sold-listings (link-out aggregate — we link to the source, never scrape or store their prices)';
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('game-collectibles.mjs')) {
  const argv = process.argv.slice(2);
  const title = argv[0] || 'Chrono Trigger';
  const platform = argv[1] || '';
  const collector = collectorLinks(title, platform);
  const ebay = await ebayBrowse(title, platform);
  console.log(`SoapBox Game Collectibles — used/retro for "${collector.phrase}"`);
  console.log('─'.repeat(50));
  console.log(`  eBay live listings: ${hasEbayKey() ? (ebay && ebay.items ? `${ebay.items.length} found` : 'keyed, none') : 'no key — link-out only'}`);
  for (const l of collector.links) console.log(`  • ${l.label}\n      ${l.url}`);
  console.log(`  ${dataNote()}`);
}
