// product-prices.mjs — SoapBox general product price-comparison + price-history (task #236).
// The PriceGrabber × CamelCamelCamel move: a cross-retailer offer comparison PLUS our own
// derived price-history index — so a shopper sees (a) who has it cheapest / in stock right now,
// and (b) whether THIS price is actually a good deal versus where the price has been.
//
// Same SoapBox discipline as macro.mjs / vehicle-value.mjs:
//   - ESM .mjs, injectable fetch (passed in per call — no module-global key state),
//   - SOFT-FAIL everywhere (never throws; compareProduct/priceHistory degrade to empty/shaped),
//   - guarded CLI block, strict HTML escaping in every render path,
//   - NO secrets in the file: affiliate ids come from affiliate.mjs which reads env BY NAME only,
//   - every offer/listing carries an `asOf` provenance timestamp.
//
// HARD guardrails (mirroring affiliate.mjs §3-4 + vehicle-value's derive-your-own provenance):
//   - ranking is by PRICE / availability / Clarity — NEVER by commission. compareProduct sorts
//     in-stock-first, then cheapest. The affiliate tag is applied to the link AFTER ranking, so it
//     can never reorder results.
//   - disclosure is ALWAYS present on a rendered page (via affiliate.mjs disclose()).
//   - no data-selling: this module records a price-watch INTENT locally and makes zero external
//     calls to do so — it never ships a user list anywhere.
//
// affiliate.mjs is imported DEFENSIVELY (dynamic import, soft-fall-back) so this module still loads
// and renders even if the affiliate engine is absent — the disclosure + plain links degrade safely.

// --- defensive affiliate import --------------------------------------------------------------------
// We want affiliateLink/disclose/esc from the general engine, but never hard-crash if it's missing.
let _aff = null;
try {
  _aff = await import('../affiliate.mjs');
} catch {
  _aff = null;
}

// Local strict HTML escape — used directly so render NEVER depends on the affiliate module being
// present. (If affiliate.mjs is there we still use this; it matches its `esc`.)
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// disclosure line — prefer affiliate.mjs's FTC text; fall back to a local equivalent if absent.
function disclosureText() {
  if (_aff && typeof _aff.ftcDisclosure === 'function') {
    try { return _aff.ftcDisclosure(); } catch { /* fall through */ }
  }
  return 'Disclosure: some links are affiliate links — we may earn a commission at no extra cost to '
    + 'you. Commissions never affect our ranking, and we never sell your data.';
}

// append the escaped disclosure paragraph to a block of HTML (always-on).
function disclose(html) {
  if (_aff && typeof _aff.disclose === 'function') {
    try { return _aff.disclose(html); } catch { /* fall through */ }
  }
  return `${html ?? ''}<p class="ftc-disclosure">${esc(disclosureText())}</p>`;
}

// --- retailer registry -----------------------------------------------------------------------------
// retailer key -> { label, affiliate network (for affiliate.mjs id-by-env-name lookup) }. The network
// drives WHICH env-named id tags the outbound link; absent/unknown -> plain url + "not configured".
export const RETAILERS = {
  amazon:    { label: 'Amazon',       network: 'impact' },
  walmart:   { label: 'Walmart',      network: 'impact' },
  target:    { label: 'Target',       network: 'impact' },
  bestbuy:   { label: 'Best Buy',     network: 'cj' },
  ebay:      { label: 'eBay',         network: 'cj' },
  newegg:    { label: 'Newegg',       network: 'cj' },
  homedepot: { label: 'Home Depot',   network: 'cj' },
};

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// resolve a fetch: prefer the injected one, else the global. Never throws on a missing fetch.
function pickFetch(injected) {
  if (typeof injected === 'function') return injected;
  return (...a) => globalThis.fetch(...a);
}

// pull a finite, positive price out of an offer regardless of the field the source used.
function priceOf(o) {
  if (o == null) return null;
  const raw = typeof o === 'number' ? o : (o.price ?? o.amount ?? o.list_price ?? o.current_price);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// --- compareProduct: normalized cross-retailer offers ----------------------------------------------

/**
 * compareProduct({ query }, { fetch }) → [{ retailer, title, price, url, inStock, asOf }]
 *
 * Queries an offers source (a price-comparison API such as the env-keyed providers) for live
 * cross-retailer offers, normalizes them to a uniform shape, and RANKS by honest signal only:
 * in-stock first, then cheapest price. Soft-fails to [] on any error / missing data — never throws.
 *
 * The source is injected via `fetch` (offline tests pass a stub). With no usable response the
 * function returns []. Ranking happens here on the honest fields; the affiliate tag is applied
 * later by affiliateOut() so commission can never reorder this list.
 */
export async function compareProduct({ query } = {}, { fetch } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return [];
  const _fetch = pickFetch(fetch);
  const asOf = new Date().toISOString();

  let raw;
  try {
    const r = await _fetch(`https://price-compare.local/api/search?q=${encodeURIComponent(q)}`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
    });
    if (!r || !r.ok) return [];
    raw = await r.json();
  } catch {
    return [];
  }

  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.offers) ? raw.offers
    : Array.isArray(raw?.results) ? raw.results : []);
  if (!rows.length) return [];

  const offers = rows.map((o) => {
    const key = String(o?.retailer ?? o?.merchant ?? o?.store ?? '').trim().toLowerCase();
    const known = RETAILERS[key];
    const price = priceOf(o);
    return {
      retailer: key || 'unknown',
      retailerLabel: known ? known.label : (o?.retailer ?? o?.merchant ?? o?.store ?? 'Unknown'),
      title: typeof o?.title === 'string' ? o.title : (typeof o?.name === 'string' ? o.name : q),
      price,
      url: typeof o?.url === 'string' ? o.url : (typeof o?.link === 'string' ? o.link : ''),
      // inStock: explicit boolean wins; otherwise infer from common availability strings; default true.
      inStock: o?.inStock === true ? true
        : o?.inStock === false ? false
        : o?.availability != null ? /in[\s_-]?stock|available|yes|true/i.test(String(o.availability))
        : true,
      asOf: typeof o?.asOf === 'string' ? o.asOf : asOf,
    };
  }).filter((o) => o.price != null && o.url);

  return rankOffers(offers);
}

/**
 * rankOffers(offers) → NEW sorted array. Honest ranking ONLY: in-stock offers before out-of-stock,
 * then ascending price, then stable (input order) tiebreak. Commission is deliberately absent from
 * the comparator. Pure; does not mutate input.
 */
export function rankOffers(offers = []) {
  const items = Array.isArray(offers) ? offers.slice() : [];
  return items
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const sa = a[0]?.inStock ? 0 : 1, sb = b[0]?.inStock ? 0 : 1;
      if (sa !== sb) return sa - sb;                    // in-stock first
      const pa = priceOf(a[0]) ?? Infinity, pb = priceOf(b[0]) ?? Infinity;
      if (pa !== pb) return pa - pb;                    // cheaper first
      return a[1] - b[1];                               // stable
    })
    .map(([v]) => v);
}

// --- priceHistory: derived time series + good-deal flag --------------------------------------------

/**
 * priceHistory({ productId }, { fetch }) → { productId, series:[{t,price}], low, high, current, isGoodDeal }
 *
 * Fetches a price time-series for a product (the CamelCamelCamel model) and computes:
 *   - low / high : the historic extremes across the series,
 *   - current    : the most-recent point's price,
 *   - isGoodDeal : true when the current price sits NEAR the historic low (within a small band of
 *                  the low→high range). A single-point series (low==high) is never a "deal".
 * Soft-fails to a shaped, null-y result on any error / empty series — never throws.
 */
export async function priceHistory({ productId } = {}, { fetch } = {}) {
  const id = typeof productId === 'string' ? productId.trim() : (productId != null ? String(productId) : '');
  const shaped = (extra) => ({ productId: id, series: [], low: null, high: null, current: null, isGoodDeal: false, ...extra });
  if (!id) return shaped();
  const _fetch = pickFetch(fetch);

  let raw;
  try {
    const r = await _fetch(`https://price-compare.local/api/history?id=${encodeURIComponent(id)}`, {
      headers: { 'user-agent': UA, accept: 'application/json' },
    });
    if (!r || !r.ok) return shaped();
    raw = await r.json();
  } catch {
    return shaped();
  }

  const points = Array.isArray(raw) ? raw : (Array.isArray(raw?.history) ? raw.history
    : Array.isArray(raw?.series) ? raw.series : []);
  const series = points.map((p) => {
    const price = priceOf(p);
    const t = p?.t ?? p?.date ?? p?.timestamp ?? null;
    return price != null ? { t: t != null ? String(t) : null, price: round2(price) } : null;
  }).filter(Boolean);

  return shaped({ series, ...computeDeal(series) });
}

/**
 * computeDeal(series) → { low, high, current, isGoodDeal } — PURE. Given an ordered series of
 * {t,price}, reports the historic low/high, the current (last) price, and whether the current price
 * is a good deal: within `bandPct` of the historic low, measured across the low→high range. When all
 * prices are equal (no range), it is NOT flagged as a deal. Empty → null-y, not a deal.
 */
export function computeDeal(series, { bandPct = 0.1 } = {}) {
  const prices = (Array.isArray(series) ? series : []).map(priceOf).filter((p) => p != null);
  if (!prices.length) return { low: null, high: null, current: null, isGoodDeal: false };
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const current = prices[prices.length - 1];
  const range = high - low;
  // near historic low: current within bandPct of the range above the low. No range → not a deal.
  const isGoodDeal = range > 0 && (current - low) <= range * bandPct;
  return { low: round2(low), high: round2(high), current: round2(current), isGoodDeal };
}

// --- trackPrice: record-only watch intent ----------------------------------------------------------

/**
 * trackPrice({ productId, targetPrice }) → a price-watch record. RECORD-ONLY: makes zero external
 * calls and ships nothing anywhere (no-data-selling). Returns the watch INTENT the caller can persist
 * however it likes. Soft-fails to a shaped { ok:false } on bad input — never throws.
 */
export function trackPrice({ productId, targetPrice } = {}) {
  const id = typeof productId === 'string' ? productId.trim() : (productId != null ? String(productId) : '');
  const target = Number(targetPrice);
  if (!id) return { ok: false, reason: 'productId required' };
  if (!Number.isFinite(target) || target <= 0) return { ok: false, reason: 'valid targetPrice required' };
  return {
    ok: true,
    kind: 'price-watch',
    productId: id,
    targetPrice: round2(target),
    createdAt: new Date().toISOString(),
    note: 'record-only watch intent — no external call, no data sold',
  };
}

// --- affiliateOut: id-by-env-name tagged link ------------------------------------------------------

/**
 * affiliateOut(retailer, url) → { url, retailer, network, configured, disclosure, reason? }
 *
 * Tags an outbound retailer link via affiliate.mjs (which reads the affiliate id from the env BY NAME
 * only — never stored here). When the env id is unset (or affiliate.mjs is absent, or the retailer is
 * unknown), returns the PLAIN url + configured:false + 'not configured'. NEVER fabricates an id.
 */
export function affiliateOut(retailer, url) {
  const plainUrl = typeof url === 'string' ? url : '';
  const key = String(retailer || '').trim().toLowerCase();
  const known = RETAILERS[key];
  const network = known ? known.network : null;

  if (!_aff || typeof _aff.affiliateLink !== 'function' || !network) {
    return { url: plainUrl, retailer: key || null, network, configured: false, disclosure: disclosureText(), reason: 'not configured' };
  }
  try {
    const res = _aff.affiliateLink({ network, url: plainUrl, subId: key });
    return {
      url: res?.url ?? plainUrl,
      retailer: key,
      network,
      configured: res?.configured === true,
      disclosure: res?.disclosure ?? disclosureText(),
      reason: res?.configured ? undefined : (res?.reason || 'not configured'),
    };
  } catch {
    return { url: plainUrl, retailer: key, network, configured: false, disclosure: disclosureText(), reason: 'not configured' };
  }
}

// --- renderPage: escaped HTML offer list + sparkline + good-deal badge + disclosure -----------------

/**
 * renderPage(data) → escaped HTML. data: { query?, offers?, history? }.
 *   - offers: rendered as a ranked list (cheapest-in-stock first), each with an affiliate-tagged
 *     (or plain, if unconfigured) outbound link. EVERY field is HTML-escaped.
 *   - history: rendered as a "good deal" badge + a sparkline data attribute (the price series the
 *     front-end charts). low/high/current shown.
 *   - the FTC disclosure is ALWAYS appended (disclose()).
 */
export function renderPage(data = {}) {
  const query = esc(data?.query || '');
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  const history = data?.history && typeof data.history === 'object' ? data.history : null;

  const head = query ? `<h2 class="pp-title">Price comparison: ${query}</h2>` : '<h2 class="pp-title">Price comparison</h2>';

  const offerHtml = offers.length
    ? '<ul class="pp-offers">' + offers.map((o) => {
        const link = affiliateOut(o?.retailer, o?.url);
        const title = esc(o?.title || 'Untitled');
        const label = esc(o?.retailerLabel || o?.retailer || 'Unknown');
        const price = o?.price != null ? esc(`$${round2(o.price)}`) : esc('—');
        const href = esc(link.url || '#');
        const stock = o?.inStock ? '<span class="pp-instock">In stock</span>' : '<span class="pp-oos">Out of stock</span>';
        const asOf = o?.asOf ? `<span class="pp-asof" title="as of">as of ${esc(o.asOf)}</span>` : '';
        const cfg = link.configured ? '' : '<span class="pp-unconfigured" title="affiliate id not configured"></span>';
        return `<li class="pp-offer"><span class="pp-retailer">${label}</span>`
          + `<a class="pp-link" href="${href}" rel="sponsored nofollow noopener" target="_blank">${title}</a>`
          + `<span class="pp-price">${price}</span>${stock}${asOf}${cfg}</li>`;
      }).join('') + '</ul>'
    : '<p class="pp-empty">No offers found.</p>';

  let histHtml = '';
  if (history) {
    const badge = history.isGoodDeal
      ? '<span class="pp-deal-badge pp-deal-good">Good deal — near historic low</span>'
      : '<span class="pp-deal-badge">Not a standout deal right now</span>';
    const spark = (Array.isArray(history.series) ? history.series : [])
      .map((p) => round2(priceOf(p))).filter((n) => n != null).join(',');
    const stats = `<span class="pp-stat">Low: ${esc(history.low != null ? '$' + history.low : '—')}</span>`
      + `<span class="pp-stat">High: ${esc(history.high != null ? '$' + history.high : '—')}</span>`
      + `<span class="pp-stat">Current: ${esc(history.current != null ? '$' + history.current : '—')}</span>`;
    histHtml = `<div class="pp-history" data-sparkline="${esc(spark)}">${badge}${stats}</div>`;
  }

  return disclose(`<section class="pp-page">${head}${histHtml}${offerHtml}</section>`);
}

// --- dataNote: provenance / how the numbers are made ----------------------------------------------

/**
 * dataNote() → a plain-English provenance note: where offers come from, how the price-history index
 * + good-deal flag are derived, and the honest-ranking / no-data-selling guarantees. Mirrors
 * vehicle-value's "show how the number was made" stance.
 */
export function dataNote() {
  return {
    what: 'General product price comparison + derived price-history index (PriceGrabber × CamelCamelCamel model).',
    offers: 'Live cross-retailer offers are read from a price-comparison source per request; normalized to '
      + '{ retailer, title, price, url, inStock, asOf }. Each carries an as-of timestamp.',
    history: 'Price history is our own derived series; the "good deal" flag is true when the current price '
      + 'sits within 10% of the low→high range above the historic low. A flat series is never flagged a deal.',
    ranking: 'Ranking is by availability then PRICE — never by commission. Affiliate tags are applied after '
      + 'ranking, so they cannot reorder results.',
    disclosure: 'Every rendered page carries an FTC affiliate disclosure. Affiliate ids are read from the '
      + 'environment by NAME only and are never stored here.',
    privacy: 'Price watches are recorded locally as intents only — no external call, and we never sell user data.',
  };
}

// --- CLI (guarded) ---------------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('product-prices.mjs')) {
  const cmd = process.argv[2];
  const arg = process.argv.slice(3).join(' ').trim();
  if (cmd === 'compare' && arg) {
    const offers = await compareProduct({ query: arg }, {}).catch(() => []);
    console.log(JSON.stringify(offers, null, 2));
  } else if (cmd === 'history' && arg) {
    const h = await priceHistory({ productId: arg }, {}).catch(() => null);
    console.log(JSON.stringify(h, null, 2));
  } else {
    console.log(JSON.stringify(dataNote(), null, 2));
    console.log('\nRetailers:', Object.keys(RETAILERS).join(', '));
    console.log('Usage: node integrations/soapbox/product-prices.mjs compare "<query>" | history "<productId>"');
  }
}
