// coupons.mjs — Coupons & cashback aggregator vertical for SoapBox (queue task #234, v3 §3-4).
//
// THE MODEL (the Honey/Rakuten/RetailMeNot space, done HONESTLY): surface coupon CODES and cashback
// rates for a store, and let people compare cashback portals — but every guardrail that makes the
// general affiliate engine "the moat" applies here too. This module is a thin vertical on top of
// integrations/affiliate.mjs; it does NOT re-implement the affiliate networks, the FTC disclosure, or
// the honest-ranking assert — it REUSES them via a defensive import (never fatal if that file moves).
//
// HARD GUARDRAILS (mirrors affiliate.mjs, restated for this vertical):
//   * Ranking is by HONEST SIGNAL ONLY — best real value to the shopper (validity + savings +, when
//     available, the store's Clarity rating). Commission/payout can NEVER reorder the list. We prove
//     it with affiliate.assertRankingUnbiased() in code (and in the tests).
//   * Sponsored coupons are clearly LABELED and SEGREGATED to the end — they can never outrank an
//     organic, better-value coupon.
//   * Every outbound link carries the FTC disclosure (affiliate.disclose / ftcDisclosure).
//   * NO data-selling, ever. Affiliate ids come from the environment BY NAME via affiliate.mjs — this
//     file contains no id and never fabricates one (unset env → plain url + "not configured").
//
// STYLE matches macro.mjs / clarity.mjs / lawyer-directory.mjs: ESM .mjs, injectable fetch, soft-fail
// (a dead coupon source returns [] / null, never throws), CLI guarded, all rendered text HTML-escaped,
// as-of timestamps on everything.
//
//   import { findCoupons, rankCoupons, cashbackCompare, renderPage } from './coupons.mjs'
//   node integrations/soapbox/coupons.mjs nike

// ---------------------------------------------------------------------------
// injectable fetch (same convention as the sibling modules)
// ---------------------------------------------------------------------------
const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---------------------------------------------------------------------------
// Defensively reuse the GENERAL affiliate engine. Never fatal if it doesn't load — we fall back to
// local equivalents so a coupon page still renders (soft-fail everywhere). The fallbacks intentionally
// preserve the same guardrails (escape, disclosure, ranking-not-by-commission).
// ---------------------------------------------------------------------------
let _aff = null;
try { _aff = await import('../affiliate.mjs'); } catch { _aff = null; }
export const affiliate = _aff; // exposed so consumers/tests can see which engine is in use

// HTML escape — prefer the engine's, fall back to a local copy with identical behavior.
const esc = _aff?.esc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
)));

// FTC disclosure line — prefer the engine's canonical one.
const ftcDisclosure = _aff?.ftcDisclosure || (() =>
  'Disclosure: some links are affiliate links — we may earn a commission at no extra cost to you. '
  + 'Commissions never affect our ranking, and we never sell your data.');

// Append the disclosure to a block of HTML (escaped inside). Always-on guarantee.
const disclose = _aff?.disclose || ((html) =>
  `${html ?? ''}<p class="ftc-disclosure">${esc(ftcDisclosure())}</p>`);

// ---------------------------------------------------------------------------
// Cashback PORTALS — where a shopper actually earns cashback. These are WINDOWED links (the rate
// changes constantly and is set by the portal, never by us), each carrying the affiliate NETWORK key
// (by env NAME via affiliate.mjs) and a disclosure. Rakuten/Honey/etc. are the canonical set.
// `rate` is INDICATIVE only — confirmed at the portal at click time (we never quote it as fact).
// ---------------------------------------------------------------------------
export const CASHBACK_PORTALS = [
  { portal: 'Rakuten',        url: 'https://www.rakuten.com/',          network: 'rakuten',    note: 'Cashback portal — rate set & paid by Rakuten' },
  { portal: 'Honey (Gold)',   url: 'https://www.joinhoney.com/',        network: null,         note: 'Honey Gold points — rate set & paid by Honey' },
  { portal: 'TopCashback',    url: 'https://www.topcashback.com/',      network: null,         note: 'Cashback portal — rate set & paid by TopCashback' },
  { portal: 'Capital One Shopping', url: 'https://capitaloneshopping.com/', network: null,     note: 'Rewards/cashback — rate set & paid by the portal' },
  { portal: 'Ibotta',         url: 'https://ibotta.com/',               network: null,         note: 'Receipt-based cashback — rate set & paid by Ibotta' },
];

// ---------------------------------------------------------------------------
// findCoupons — fetch + normalize coupons for a { store, category }. Injectable fetch; soft-fail [].
//
// We do NOT bake in any single proprietary API key. The fetch is injected (in production it would be
// pointed at whatever coupon source/feed is configured); offline + on any error we return []. The
// normalizer is the load-bearing part: it produces a uniform shape regardless of source.
//
//   -> [{ store, code, discount, type:'code'|'cashback', expires, verifiedAt, sourceUrl }]
// ---------------------------------------------------------------------------
export async function findCoupons({ store, category } = {}, { fetch } = {}) {
  const storeName = String(store || '').trim();
  if (!storeName) return [];
  const f = typeof fetch === 'function' ? fetch : _fetch;
  try {
    // A configured source URL is expected to return a JSON array (or {coupons:[...]}). We never embed a
    // key here; the source is whatever the injected fetch resolves. No source / non-ok → [].
    const r = await f(couponSourceUrl(storeName, category), { headers: { 'user-agent': UA } });
    if (!r || !r.ok) return [];
    const body = await r.json();
    const rows = Array.isArray(body) ? body : (Array.isArray(body?.coupons) ? body.coupons : []);
    return rows.map((row) => normalizeCoupon(row, storeName)).filter(Boolean);
  } catch {
    return []; // soft-fail: a dead source is empty, never throws
  }
}

// The (placeholder) source endpoint. Kept as a function so the production wiring can point it at a real
// feed without touching the normalizer. No secret here — the injected fetch supplies the real source.
function couponSourceUrl(store, category) {
  const q = new URLSearchParams({ store });
  if (category) q.set('category', String(category));
  return `https://coupons.invalid/api/coupons?${q.toString()}`;
}

// Normalize one raw coupon row into our canonical shape. Defensive about field names + types; anything
// that isn't a usable coupon (no code AND not cashback) is dropped. as-of timestamps preserved.
function normalizeCoupon(row, fallbackStore) {
  if (!row || typeof row !== 'object') return null;
  const type = (row.type === 'cashback' || row.kind === 'cashback') ? 'cashback' : 'code';
  const code = type === 'code' ? (firstStr(row.code, row.couponCode, row.promoCode) || '') : '';
  // a code coupon with no code is useless; a cashback row needs no code.
  if (type === 'code' && !code) return null;
  return {
    store: firstStr(row.store, row.merchant, row.retailer, fallbackStore) || fallbackStore || '',
    code,
    discount: firstStr(row.discount, row.savings, row.deal, row.title) || '',
    type,
    expires: firstStr(row.expires, row.expiry, row.expiresAt, row.endDate) || null,
    verifiedAt: firstStr(row.verifiedAt, row.lastVerified, row.checkedAt) || null,
    sourceUrl: firstStr(row.sourceUrl, row.url, row.link) || '',
  };
}

function firstStr(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Honest VALUE scoring — the signal we rank by. Higher = better for the shopper.
//   * validity: a coupon verified recently and not expired is worth more than a stale/expired one.
//   * savings : a bigger discount is worth more. We parse "%", "$"/"£"/"€" off, and "free shipping".
//   * clarity : when a per-store Clarity rating is supplied, it nudges value (transparency of the deal/
//     store). It is a TIE-NUDGE on the honest side — never a commission proxy.
// Commission is deliberately ABSENT from this function. That is the whole point.
// ---------------------------------------------------------------------------
export function couponValue(c, { now = Date.now(), clarity } = {}) {
  if (!c) return 0;
  let v = 0;

  // savings component
  v += parseSavings(c.discount);
  // cashback coupons get a modest base (rate confirmed at portal, so we don't over-credit here)
  if (c.type === 'cashback') v += 8;

  // validity component
  const exp = parseDate(c.expires);
  if (exp != null) {
    if (exp < now) v -= 100;            // expired → strongly demoted (still listed, clearly stale)
    else v += 10;                       // has a real future expiry → it's a live, bounded deal
  }
  const ver = parseDate(c.verifiedAt);
  if (ver != null) {
    const ageDays = (now - ver) / 86400000;
    if (ageDays <= 7) v += 15;          // verified within a week
    else if (ageDays <= 30) v += 6;     // verified within a month
  }

  // clarity nudge (optional, honest)
  const cl = Number(clarity);
  if (Number.isFinite(cl)) v += cl * 0.05; // 0..100 clarity → 0..5 nudge

  return v;
}

function parseSavings(discount) {
  const s = String(discount || '').toLowerCase();
  if (!s) return 0;
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return Math.min(60, Number(pct[1]));                 // % off, capped so 90%-off claims can't dominate
  const amt = s.match(/[$£€]\s*(\d+(?:\.\d+)?)/);
  if (amt) return Math.min(50, Number(amt[1]) * 0.5);           // $ off → half-weighted vs %
  if (/free\s*ship/.test(s)) return 6;                          // free shipping is a real but modest win
  if (/\bbogo\b|buy one/.test(s)) return 20;
  return 2;                                                     // some unparsed deal text → tiny credit
}

function parseDate(x) {
  if (x == null || x === '') return null;
  const t = Date.parse(x);
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// rankCoupons — order by best HONEST value, with sponsored segregated to the end and labeled. Then we
// VERIFY with affiliate.assertRankingUnbiased() that commission/sponsorship did not reorder the honest
// list. If the engine is present and the check would fail, we fall back to the honest baseline (we
// would rather under-monetize than ship a bought ranking). Input is not mutated.
//
//   coupons: [{ ...normalized, sponsored?, commission?, clarity? }]
//   opts:    { now?, clarityByStore? }  -- clarityByStore maps store -> 0..100 Clarity rating
// ---------------------------------------------------------------------------
export function rankCoupons(coupons = [], { now = Date.now(), clarityByStore = {} } = {}) {
  const items = (Array.isArray(coupons) ? coupons : []).slice();
  const clarityOf = (c) => clarityByStore[c?.store] ?? clarityByStore[String(c?.store || '').toLowerCase()];
  const valueOf = (c) => couponValue(c, { now, clarity: clarityOf(c) });

  // stable sort by honest value (higher first); commission is NOT consulted.
  const stableByValue = (arr) => arr
    .map((c, i) => [c, i, valueOf(c)])
    .sort((a, b) => (b[2] - a[2]) || (a[1] - b[1]))
    .map(([c]) => c);

  const organic = stableByValue(items.filter((c) => !c?.sponsored));
  const sponsored = stableByValue(items.filter((c) => c?.sponsored))
    .map((c) => ({ ...c, sponsored: true, label: 'Sponsored' }));
  const ranked = [...organic, ...sponsored];

  // Prove it wasn't bought, using the SAME semantics as the general engine. We map our coupons onto the
  // engine's listing shape (clarity = honest value, relevance as tiebreak) so its assert applies.
  if (_aff?.assertRankingUnbiased) {
    const toListing = (c) => ({ id: listingId(c), clarity: valueOf(c), relevance: 0, sponsored: !!c?.sponsored });
    const baseline = [...organic, ...sponsored].map(toListing);
    const baselineHonest = _aff.rankListings
      ? _aff.rankListings(baseline)
      : [...baseline.filter((x) => !x.sponsored), ...baseline.filter((x) => x.sponsored)];
    try {
      _aff.assertRankingUnbiased(baselineHonest, ranked.map(toListing));
    } catch {
      // a bias slipped in (e.g. caller pre-sorted by commission): return the honest baseline only.
      return [...organic, ...sponsored];
    }
  }
  return ranked;
}

function listingId(c) {
  return `${String(c?.store || '').toLowerCase()}|${c?.code || ''}|${c?.discount || ''}|${c?.type || ''}`;
}

// ---------------------------------------------------------------------------
// cashbackCompare — compare cashback rates across portals for a store, as DISCLOSED WINDOWED links.
// We do not quote a rate as fact (it's the portal's to set and it moves); each option carries the
// portal, the outbound (affiliate-tagged via affiliate.mjs when configured), the disclosure, and a
// `windowed:true` flag making explicit that the rate is read live at the portal. Soft-fail [] shape.
// ---------------------------------------------------------------------------
export function cashbackCompare(store) {
  const storeName = String(store || '').trim();
  const asOf = new Date().toISOString();
  return CASHBACK_PORTALS.map((p) => {
    const out = affiliateOut(storeName, p);
    return {
      store: storeName,
      portal: p.portal,
      url: out.url,
      configured: out.configured,
      windowed: true,                  // rate is read live at the portal, never asserted by us
      note: p.note,
      disclosure: out.disclosure,
      asOf,
    };
  });
}

// ---------------------------------------------------------------------------
// affiliateOut — build an affiliate.mjs-tagged outbound for a store via a portal/network. When the env
// id is unset (or the engine isn't loaded, or there's no network), returns the PLAIN url with
// configured:false + reason 'not configured'. Never throws, never invents an id.
//
//   affiliateOut('nike')                                  -> generic store-search portal outbound
//   affiliateOut('nike', { network:'rakuten', url:... })  -> a specific portal outbound
// ---------------------------------------------------------------------------
export function affiliateOut(store, portal = {}) {
  const url = portal.url || `https://www.rakuten.com/stores?q=${encodeURIComponent(String(store || ''))}`;
  const network = portal.network || null;
  const subId = String(store || '').toLowerCase() || undefined;

  if (_aff?.affiliateLink && network) {
    const link = _aff.affiliateLink({ network, url, subId });
    return {
      url: link.url || url,
      network: link.network ?? network,
      configured: !!link.configured,
      reason: link.configured ? null : (link.reason || 'not configured'),
      disclosure: link.disclosure || ftcDisclosure(),
    };
  }
  // no engine, or no network for this portal: plain url, explicitly not configured.
  return { url, network, configured: false, reason: 'not configured', disclosure: ftcDisclosure() };
}

// ---------------------------------------------------------------------------
// renderPage — escaped HTML coupon list + cashback compare + the always-on disclosure + the explicit
// "we don't take pay-to-rank" note. Everything user-facing is HTML-escaped. as-of timestamp shown.
//
//   data: { store, category?, coupons?, cashback?, clarityByStore?, now? }
// ---------------------------------------------------------------------------
export function renderPage(data = {}) {
  const store = esc(data.store || '');
  const category = data.category ? esc(data.category) : '';
  const asOf = esc(new Date(data.now || Date.now()).toISOString());

  const ranked = rankCoupons(data.coupons || [], { now: data.now, clarityByStore: data.clarityByStore || {} });
  const cashback = Array.isArray(data.cashback) ? data.cashback : cashbackCompare(data.store || '');

  const couponRows = ranked.length
    ? ranked.map(renderCouponRow).join('')
    : '<li class="coupon-empty">No coupons found right now.</li>';

  const cashbackRows = cashback.map((c) =>
    `<li class="cashback-row${c.configured ? '' : ' unconfigured'}">`
    + `<a href="${esc(c.url)}" rel="sponsored nofollow noopener" target="_blank">${esc(c.portal)}</a>`
    + `<span class="cashback-note">${esc(c.note || '')}</span>`
    + '<span class="cashback-windowed" title="rate read live at the portal">rate read live at portal</span>'
    + (c.configured ? '' : '<span class="cashback-unconfigured" title="affiliate id not configured"></span>')
    + '</li>',
  ).join('');

  // The explicit honesty note — restated on every page, not just the FTC line.
  const noPayToRank =
    '<p class="no-pay-to-rank">We do not take pay-to-rank. Coupons are ranked by real value to you '
    + '(validity and savings); sponsored items are clearly labeled and can never outrank a better deal. '
    + 'We never sell your data.</p>';

  const body =
    `<section class="coupons-vertical" data-store="${store}">`
    + `<h2>Coupons &amp; cashback${store ? ` — ${store}` : ''}${category ? ` <small>(${category})</small>` : ''}</h2>`
    + `<p class="as-of">As of ${asOf}</p>`
    + noPayToRank
    + `<h3>Coupon codes &amp; deals</h3><ul class="coupon-list">${couponRows}</ul>`
    + `<h3>Cashback portals</h3><ul class="cashback-list">${cashbackRows}</ul>`
    + '</section>';

  // disclose() appends the escaped FTC line — the always-on guarantee.
  return disclose(body);
}

function renderCouponRow(c) {
  const sponsored = c?.sponsored;
  const badge = sponsored ? '<span class="coupon-badge" aria-label="sponsored">Sponsored</span>' : '';
  const code = c?.type === 'code' && c?.code
    ? `<code class="coupon-code">${esc(c.code)}</code>`
    : '<span class="coupon-cashback">cashback</span>';
  const discount = esc(c?.discount || '');
  const expires = c?.expires ? `<span class="coupon-expires">expires ${esc(c.expires)}</span>` : '';
  const verified = c?.verifiedAt ? `<span class="coupon-verified">verified ${esc(c.verifiedAt)}</span>` : '';
  const src = c?.sourceUrl
    ? `<a class="coupon-src" href="${esc(c.sourceUrl)}" rel="nofollow noopener" target="_blank">source</a>`
    : '';
  return `<li class="coupon-row${sponsored ? ' sponsored' : ''}"${sponsored ? ' data-sponsored="true"' : ''}>`
    + badge + code + `<span class="coupon-discount">${discount}</span>` + expires + verified + src
    + '</li>';
}

// ---------------------------------------------------------------------------
// dataNote — provenance + as-of, so a consumer page can show where this came from and how honest it is.
// ---------------------------------------------------------------------------
export function dataNote() {
  return {
    source: 'Coupon feeds + cashback portals (Rakuten/Honey/TopCashback/…). Rates are set and paid by '
      + 'the portals and read live at click time — never asserted as fact here.',
    method: 'honest-value-ranking-v1 (validity + savings + Clarity; commission never reorders results)',
    guardrails: [
      'ranking is by honest signal only — commission can never reorder results',
      'sponsored coupons are labeled and segregated to the end',
      'every outbound link carries the FTC disclosure',
      'affiliate ids come from the environment by name only — none are stored here',
      'no data-selling, ever',
    ],
    affiliateEngine: _aff ? 'integrations/affiliate.mjs' : '(affiliate engine not loaded — local fallback)',
    asOf: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// verticalSummary — a PLAIN DATA object (no HTML) for the Data-site search vertical's generic walker.
// Offline-safe: it surfaces the cashback-portal compare (static) + the honest-ranking guardrails for a
// given store, and points at the full standalone surface (coupons.soapbox.community) for live coupon
// codes. Coupon CODES need an injected live source, so they are NOT fetched here (the generic Data page
// stays keyless/offline); the standalone server fetches + ranks them. Soft-fail: always returns a shape.
//   verticalSummary('nike') -> { store, cashbackPortals:[...], guardrails:[...], note, asOf }
// ---------------------------------------------------------------------------
export function verticalSummary(store) {
  const storeName = String(store || '').trim();
  const note = dataNote();
  return {
    store: storeName || null,
    fullSite: 'https://coupons.soapbox.community',
    cashbackPortals: cashbackCompare(storeName).map((c) => ({
      portal: c.portal, url: c.url, note: c.note, monetized: c.configured, rate: 'read live at portal',
    })),
    guardrails: note.guardrails,
    note: 'Ranking is by honest value (validity + savings) only — commission never reorders results. '
      + 'For live coupon CODES + deals for this store, see coupons.soapbox.community.',
    asOf: note.asOf,
  };
}

// ---------------------------------------------------------------------------
// CLI (guarded) — node integrations/soapbox/coupons.mjs <store>
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('coupons.mjs')) {
  const store = process.argv.slice(2).join(' ').trim() || 'example';
  const coupons = await findCoupons({ store });
  const ranked = rankCoupons(coupons);
  console.log(`Coupons for "${store}": ${ranked.length} found`);
  for (const c of ranked) console.log(`  [${c.type}] ${c.discount || c.code}${c.sponsored ? '  (Sponsored)' : ''}`);
  console.log('\nCashback portals:');
  for (const cb of cashbackCompare(store)) console.log(`  ${cb.portal.padEnd(22)} ${cb.configured ? '(tagged)' : '(not configured)'}  ${cb.url}`);
  const note = dataNote();
  console.log('\nGuardrails:'); for (const g of note.guardrails) console.log(`  - ${g}`);
  console.log(`\nRanking is by honest value, NEVER by commission. Engine: ${note.affiliateEngine}`);
}
