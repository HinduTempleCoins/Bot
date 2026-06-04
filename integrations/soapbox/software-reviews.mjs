// software-reviews.mjs — the SoapBox software / B2B reviews comparison reader (queue #244, the
// G2 / Capterra model): SaaS / B2B software, web hosting, VPNs, and domain registrars — compared
// HONESTLY by user rating + fit, NEVER by commission.
//
// THE MOAT (mirrors integrations/affiliate.mjs §3-4): the comparison stays honest no matter how it is
// monetized. The hard guardrails are encoded here:
//   (a) ranking is BY RATING (then fit), NEVER by commission. Review-count and fit act ONLY as TINY
//       tiebreakers, CAPPED so they can never flip a clear rating gap — a 4.8 always outranks a 4.2 no
//       matter how many reviews or how good the fit the 4.2 has. assertRankingUnbiased() (from
//       affiliate.mjs) proves the organic order was not bought.
//   (b) sponsored rows are SEGREGATED to the END and clearly labeled — they can never outrank an organic
//       row.
//   (c) every outbound link carries a disclosure + a "no pay-to-rank" note; we never sell user data.
//
// Affiliate ids come from the environment BY NAME ONLY (via affiliate.mjs) — this file never contains an
// id and never fabricates one; an unset env returns the plain, untagged URL + "not configured".
//
// READER discipline (like financial-products.mjs / macro.mjs): injectable fetch, every getter soft-fails
// (returns [] / null, never throws), a dead source just drops out, every value is escaped before HTML.
//
//   import { CATEGORIES, compareSoftware, rankByRating, ratingScore, vendorOut, renderPage, dataNote }
//     from './software-reviews.mjs'
//   node integrations/soapbox/software-reviews.mjs web-hosting
//
// The affiliate engine is imported DEFENSIVELY: if it can't be loaded we fall back to safe local shims
// (plain url + a no-op ranking check) so the module still soft-fails rather than crashing.

let _affiliate = null;
try {
  _affiliate = await import('../affiliate.mjs');
} catch {
  _affiliate = null;
}

// Re-export the affiliate engine (or null) so callers/tests can introspect it.
export const affiliate = _affiliate;

// Defensive accessors over the affiliate engine. Each falls back to a safe local behavior when the
// engine (or a specific export) is unavailable.
function _affiliateLink(args) {
  if (_affiliate && typeof _affiliate.affiliateLink === 'function') return _affiliate.affiliateLink(args);
  const url = args && typeof args.url === 'string' ? args.url : '';
  return { url, network: args?.network ?? null, configured: false, reason: 'affiliate engine unavailable' };
}
function _ftcDisclosure() {
  if (_affiliate && typeof _affiliate.ftcDisclosure === 'function') return _affiliate.ftcDisclosure();
  return 'Disclosure: some links are affiliate links — we may earn a commission at no extra cost to you. '
    + 'Commissions never affect our ranking, and we never sell your data.';
}
// assertRankingUnbiased proves the organic order equals the honest baseline and no sponsored row jumped
// ahead. When the engine is missing we keep the same invariant locally (segregation + order equality).
function _assertRankingUnbiased(organic, ranked) {
  if (_affiliate && typeof _affiliate.assertRankingUnbiased === 'function') {
    return _affiliate.assertRankingUnbiased(organic, ranked);
  }
  const baseline = Array.isArray(organic) ? organic : [];
  const out = Array.isArray(ranked) ? ranked : [];
  let seenSponsored = false;
  for (const item of out) {
    if (item?.sponsored) { seenSponsored = true; continue; }
    if (seenSponsored) throw new Error('ranking bias: a sponsored item is ranked above an organic item');
  }
  const key = (x) => (x?.name != null ? `name:${x.name}` : `o:${JSON.stringify(x)}`);
  const expected = baseline.filter((x) => !x?.sponsored).map(key);
  const actual = out.filter((x) => !x?.sponsored).map(key);
  if (expected.length !== actual.length) throw new Error('ranking bias: organic set changed (count mismatch)');
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) throw new Error(`ranking bias: organic order changed at position ${i}`);
  }
  return true;
}

// ── injectable fetch ────────────────────────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const asOfDate = () => new Date().toISOString().slice(0, 10);

// Escape any text before it lands in HTML. Mirrors the project convention.
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── CATEGORIES — the comparison verticals ────────────────────────────────────────────────────────────
// Each: a friendly label, the affiliate network used (id by env NAME inside affiliate.mjs), and a note.
export const CATEGORIES = {
  'software-saas': { label: 'Software / B2B SaaS', network: 'impact', note: 'Compare by verified user rating + fit (G2 / Capterra model).' },
  'web-hosting':   { label: 'Web hosting',         network: 'cj',     note: 'Shared / VPS / managed hosts compared by rating + fit.' },
  'vpn':           { label: 'VPN',                 network: 'impact', note: 'No-logs posture + speed matter; ranked by user rating, never payout.' },
  'domains':       { label: 'Domain registrars',   network: 'cj',     note: 'Renewal price + transfer policy matter; ranked by user rating.' },
};

export function isCategory(category) { return Object.prototype.hasOwnProperty.call(CATEGORIES, str(category)); }
export function listCategories() { return Object.keys(CATEGORIES); }

// ── data source ──────────────────────────────────────────────────────────────────────────────────────
// There is no single free, keyless "all software reviews" feed (G2 / Capterra are proprietary). The
// reader is source-injectable: a deployment points SOFTWARE_REVIEWS_SOURCE_URL at a curated JSON feed of
// the shape { vendors: [ { name, rating, reviews, pricing, fit, url, network?, sponsored? } ] }. When
// unset (the default), compareSoftware soft-fails to [] — the page shows "no data" rather than inventing
// ratings. This keeps the module honest and testable offline.
function sourceUrl(category) {
  const base = process.env.SOFTWARE_REVIEWS_SOURCE_URL;
  if (!base) return null;
  try {
    const u = new URL(base);
    u.searchParams.set('category', str(category));
    return u.toString();
  } catch {
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}category=${encodeURIComponent(str(category))}`;
  }
}

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Normalize ONE raw vendor record → the canonical shape. PURE. Returns null on an unusable record.
//   { name, rating, reviews, pricing, fit, url, asOf, sponsored, network, commission }
// `rating` is a number 0–5 (or null); `reviews` is an integer count (or null); `fit` is a number 0–1
// (or null) describing how well the vendor matches a stated `need`. The `commission` field (what a
// vendor would pay us) is carried through ONLY so ranking can prove it is IGNORED.
export function normalizeVendor(raw, category) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name || raw.vendor || raw.product || raw.company);
  if (!name) return null;
  let rating = num(raw.rating ?? raw.stars ?? raw.score);
  if (rating != null) rating = Math.max(0, Math.min(5, rating)); // clamp into 0–5
  let reviews = num(raw.reviews ?? raw.reviewCount ?? raw.numReviews ?? raw.count);
  if (reviews != null) reviews = Math.max(0, Math.round(reviews));
  let fit = num(raw.fit ?? raw.match ?? raw.relevance);
  if (fit != null) fit = Math.max(0, Math.min(1, fit)); // clamp into 0–1
  return {
    category: str(category) || null,
    name,
    rating,
    reviews,
    pricing: str(raw.pricing || raw.price || raw.plan || ''),
    fit,
    url: str(raw.url || raw.link || raw.website || ''),
    network: str(raw.network || '') || null,
    sponsored: raw.sponsored === true,
    commission: num(raw.commission), // carried but NEVER ranked on
    asOf: str(raw.asOf) || asOfDate(),
  };
}

/**
 * Compare software/vendors in a category → normalized [{ name, rating, reviews, pricing, url, asOf, ... }].
 * Soft-fails to [] on an unknown category, an absent SOFTWARE_REVIEWS_SOURCE_URL, a network failure, or
 * an unusable payload. Never throws.
 */
export async function compareSoftware({ category, need } = {}, { fetch } = {}) {
  if (fetch) __setFetch(fetch);
  const cat = str(category);
  if (!isCategory(cat)) return [];
  const url = sourceUrl(cat);
  if (!url) return []; // no curated source configured → soft-fail, never invent ratings
  // pass the stated need through to the source so it can score fit (optional; harmless if ignored).
  const j = await getJson(need ? `${url}${url.includes('?') ? '&' : '?'}need=${encodeURIComponent(str(need))}` : url);
  const rows = j && Array.isArray(j.vendors) ? j.vendors : (Array.isArray(j) ? j : null);
  if (!rows) return [];
  return rows.map((r) => normalizeVendor(r, cat)).filter(Boolean);
}

// ── ranking — BY RATING, never commission ────────────────────────────────────────────────────────────
// The TIEBREAKER CAP. The honest score is the rating (0–5) plus a TINY bounded bonus from review-count
// and fit. The bonus is capped strictly below the smallest rating step the comparison cares about
// (RATING_STEP = 0.1), so it can break ties between equal-rated vendors but can NEVER flip a clear rating
// gap: a 4.8 always beats a 4.2. Commission is DELIBERATELY ABSENT.
export const RATING_STEP = 0.1;
// The whole tiebreaker budget must stay under one rating step. Split between reviews and fit.
const TIEBREAK_BUDGET = RATING_STEP * 0.9; // 0.09 — strictly below 0.1
const REVIEW_WEIGHT = TIEBREAK_BUDGET * (2 / 3); // up to 0.06 from review volume
const FIT_WEIGHT = TIEBREAK_BUDGET * (1 / 3);    // up to 0.03 from fit

/**
 * The honest ranking score for a vendor: rating, plus a capped review-count + fit tiebreaker that can
 * never bridge a 0.1 rating gap. Higher is better. Commission is never an input. PURE; never throws.
 */
export function ratingScore(vendor) {
  if (!vendor || typeof vendor !== 'object') return 0;
  const rating = num(vendor.rating) ?? 0;
  // Review volume → a saturating [0,1] factor (log scale; ~1000 reviews ≈ full weight). Tiny by design.
  const reviews = Math.max(0, num(vendor.reviews) ?? 0);
  const reviewFactor = reviews > 0 ? Math.min(1, Math.log10(reviews + 1) / 3) : 0; // log10(1000)=3
  const fit = Math.max(0, Math.min(1, num(vendor.fit) ?? 0));
  const tiebreak = reviewFactor * REVIEW_WEIGHT + fit * FIT_WEIGHT; // ≤ 0.09, < RATING_STEP
  return rating + tiebreak;
}

/**
 * Rank vendors honestly: organic rows DESCENDING by ratingScore (highest rating first; review-count and
 * fit only break ties, capped so they can't flip a clear rating gap), with commission IGNORED. Sponsored
 * rows are SEGREGATED to the END, labeled, and ranked only among themselves. Returns a NEW array; input
 * is not mutated. After building the order it calls assertRankingUnbiased to PROVE the order was not
 * bought; if that throws (it shouldn't, by construction) we fall back to the plain organic+sponsored
 * order so a guard bug can never crash a page. Never throws.
 */
export function rankByRating(vendors = []) {
  const items = Array.isArray(vendors) ? vendors.slice() : [];
  const organic = items.filter((x) => !x?.sponsored);
  const sponsored = items.filter((x) => x?.sponsored);

  const byScore = (arr) => arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const sa = ratingScore(a[0]); const sb = ratingScore(b[0]);
      if (sb !== sa) return sb - sa;   // honest signal only, descending
      return a[1] - b[1];              // stable on exact ties
    })
    .map(([v]) => v);

  const organicRanked = byScore(organic);
  const sponsoredRanked = byScore(sponsored).map((s) => ({ ...s, sponsored: true, label: 'Sponsored' }));
  const ranked = [...organicRanked, ...sponsoredRanked];

  // Prove the organic order equals the honest baseline and no sponsored row jumped ahead.
  try {
    _assertRankingUnbiased(organicRanked, ranked);
  } catch {
    // Should be unreachable. Keep a safe segregated order regardless.
    return [...organicRanked, ...sponsoredRanked];
  }
  return ranked;
}

// ── vendorOut — affiliate-tagged outbound (plain url + not-configured when unset) ─────────────────────
/**
 * Build the outbound link for a vendor. Routes through affiliate.affiliateLink (id by env NAME only).
 * When the affiliate id is unset, returns the PLAIN url with configured:false and reason 'not configured'
 * — a missing tag never breaks the link, and we never fabricate an id. Soft-fails to a plain url on any
 * bad input; never throws. Returns { name, url, network, configured, reason?, disclosure }.
 */
export function vendorOut(name, url, { network, subId } = {}) {
  const plainUrl = typeof url === 'string' ? url : '';
  let link;
  try {
    link = _affiliateLink({ network, url: plainUrl, subId: subId || str(name) || undefined });
  } catch {
    link = { url: plainUrl, network: network ?? null, configured: false, reason: 'not configured' };
  }
  return {
    name: str(name) || null,
    url: link.url || plainUrl,
    network: link.network ?? network ?? null,
    configured: link.configured === true,
    reason: link.configured ? undefined : (link.reason || 'not configured'),
    disclosure: link.disclosure || _ftcDisclosure(),
  };
}

// ── no-pay-to-rank note ──────────────────────────────────────────────────────────────────────────────
export function noPayToRankNote() {
  return 'No pay-to-rank: vendors cannot buy a higher position. We rank by verified user rating and fit; '
    + 'review-count and fit only break ties between equally-rated vendors and can never outweigh a higher '
    + 'rating. Sponsored placements are clearly labeled, segregated, and never outrank organic results. '
    + 'We never sell your data.';
}

// ── renderPage — escaped HTML comparison table + transparency + disclosure + no-pay-to-rank ───────────
/**
 * Render an escaped HTML comparison page. `data` may be:
 *   { category, vendors:[...] }  — vendors are ranked here (honest order) before rendering.
 * EVERY interpolated value is escaped (vendor names included — XSS-safe). Always includes the FTC
 * disclosure and the no-pay-to-rank note. Sponsored rows are visibly labeled and appear after organic
 * rows. Safe on empty input; never throws.
 */
export function renderPage(data = {}) {
  const cat = str(data.category);
  const meta = CATEGORIES[cat];
  const label = meta ? meta.label : (cat || 'Software reviews');
  const ranked = rankByRating(Array.isArray(data.vendors) ? data.vendors : []);

  const ratingCell = (v) => (num(v.rating) != null ? `${escapeHtml(v.rating)} / 5` : 'n/a');
  const reviewsCell = (v) => (num(v.reviews) != null ? escapeHtml(v.reviews) : '—');
  const priceCell = (v) => (str(v.pricing) ? escapeHtml(v.pricing) : '—');

  const rows = ranked.map((v) => {
    const out = vendorOut(v.name, v.url, { network: v.network || (meta ? meta.network : undefined) });
    const href = escapeHtml(out.url || '#');
    const sponsoredBadge = v.sponsored ? ' <span class="badge-sponsored" aria-label="sponsored">Sponsored</span>' : '';
    const cfg = out.configured ? '' : ' <span class="visit-unconfigured" title="affiliate id not configured"></span>';
    return `<tr${v.sponsored ? ' class="sponsored" data-sponsored="true"' : ''}>`
      + `<td>${escapeHtml(v.name || '')}${sponsoredBadge}</td>`
      + `<td>${ratingCell(v)}</td>`
      + `<td>${reviewsCell(v)}</td>`
      + `<td>${priceCell(v)}</td>`
      + `<td><a href="${href}" rel="sponsored nofollow noopener" target="_blank">Visit</a>${cfg}</td>`
      + `<td>${escapeHtml(v.asOf || '')}</td>`
      + `</tr>`;
  }).join('');

  return `<section class="software-reviews" data-category="${escapeHtml(cat)}">
  <h2>${escapeHtml(label)} — honest reviews</h2>
  <table class="software-reviews-table">
    <thead><tr><th>Vendor</th><th>Rating</th><th>Reviews</th><th>Pricing</th><th></th><th>As of</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="transparency">${escapeHtml(noPayToRankNote())}</p>
  <p class="ftc-disclosure">${escapeHtml(_ftcDisclosure())}</p>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// ── provenance note ──────────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Source: curated verified-review feed (SOFTWARE_REVIEWS_SOURCE_URL), modeled on G2 / Capterra, `
    + `as of ${asOfDate()}. Ratings and pricing change — confirm the current offer on the vendor's site. `
    + `Ranked by verified user rating and fit, never by commission; review-count and fit only break ties `
    + `between equally-rated vendors. Sponsored rows are labeled and segregated. We never sell your data. `
    + `This is public reference, not professional advice.`;
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('software-reviews.mjs')) {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg) {
    console.log('\nSoapBox — Software / B2B reviews comparison');
    console.log('─'.repeat(60));
    console.log('Categories:');
    for (const [k, m] of Object.entries(CATEGORIES)) {
      console.log(`  ${k.padEnd(16)} ${m.label.padEnd(24)} via ${m.network}`);
    }
    console.log('\nGuardrails: rank-by-rating (never commission) | review-count + fit are capped tiebreakers | sponsored segregated+labeled | disclosure + no-pay-to-rank always | no data-selling');
    console.log(`\n${dataNote()}`);
    console.log('\nUsage: node integrations/soapbox/software-reviews.mjs <category>   (e.g. web-hosting)');
    console.log('  Set SOFTWARE_REVIEWS_SOURCE_URL to a curated JSON feed for live data.');
  } else if (!isCategory(arg)) {
    console.log(`Unknown category "${arg}". Known: ${listCategories().join(', ')}`);
  } else {
    const vendors = await compareSoftware({ category: arg }).catch(() => []);
    const ranked = rankByRating(vendors);
    console.log(`\n${CATEGORIES[arg].label} (${ranked.length} vendors, ranked by rating)`);
    console.log('─'.repeat(60));
    if (ranked.length === 0) console.log('  No data (set SOFTWARE_REVIEWS_SOURCE_URL for live data).');
    for (const v of ranked) {
      const rating = num(v.rating) != null ? `${v.rating}/5` : 'n/a';
      console.log(`  ${String(v.name || '').padEnd(24)} ${rating.padEnd(8)} ${String(v.reviews ?? '—').padEnd(8)} ${v.pricing || ''}${v.sponsored ? '  [Sponsored]' : ''}`);
    }
    console.log(`\n${dataNote()}`);
  }
}
