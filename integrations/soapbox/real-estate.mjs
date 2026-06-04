// real-estate.mjs — the SoapBox real-estate vertical (rebuild; prior build lost before commit).
// Answers "what's for sale/rent here, what's it actually worth, and can I afford it?" by normalizing
// listings from the big portals (Zillow / Apartments.com / LoopNet) into ONE comparable shape, then
// ranking them by VALUE (price-per-sqft) — NEVER by what a provider would pay us. Commercial uses
// LoopNet, rentals use Apartments.com, for-sale uses Zillow; each source soft-fails independently.
//
// Pattern matches macro.mjs / coliving.mjs / affiliate.mjs:
//   • ESM .mjs, injectable fetch (__setFetch + per-call deps.fetch), graceful soft-fail (→ []/benign,
//     NEVER throw), guarded CLI, PURE rank/render helpers unit-tested offline.
//   • Provider/affiliate IDs come from the environment BY NAME ONLY, via affiliate.mjs — this file
//     never contains an id and never fabricates one.
//   • Every rendered page carries the FTC disclosure (no opt-out).
//
// THE MOAT (mirrors affiliate.mjs §4): ranking is value-first and commission is ABSENT from the
// comparator. Sponsored listings are segregated to the end and labeled. agentMatch refuses any
// no-consent or data-selling handoff and allows only a consented, single-provider routing.
//
//   import { searchListings, rankListings, agentMatch, affordability, renderPage } from './real-estate.mjs'
//   node integrations/soapbox/real-estate.mjs rent "Austin"

import { affiliateLink, disclose, buildLeadGen as _engineBuildLeadGen, trackedLink } from '../affiliate.mjs';
import { byMetro, __setFetch as __setColivingFetch } from './coliving.mjs';

// --- injectable fetch ------------------------------------------------------
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxRealEstate/1.0 (+https://data.soapbox.community)' };

// --- HTML escape (strict; used by every render path) -----------------------
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

// --- as-of stamp -----------------------------------------------------------
function nowStamp(nowMs = Date.now()) { return new Date(nowMs).toISOString(); }

// --- the three portals -----------------------------------------------------
// search type → portal metadata. `network` is the affiliate.mjs network NAME (id resolved by env only).
export const PORTALS = {
  buy:        { source: 'Zillow',          host: 'https://www.zillow.com',          network: 'cj',     kind: 'buy' },
  rent:       { source: 'Apartments.com',  host: 'https://www.apartments.com',      network: 'cj',     kind: 'rent' },
  commercial: { source: 'LoopNet',         host: 'https://www.loopnet.com',         network: 'cj',     kind: 'commercial' },
};

// ---------------------------------------------------------------------------
// PURE normalization (unit-tested offline)
// ---------------------------------------------------------------------------

/**
 * Normalize ONE raw provider listing into the comparable shape:
 *   { kind, address, price, beds, baths, sqft, url, source, asOf, pricePerSqft?, sponsored?, commission? }
 * Soft-fails per-field: missing/non-numeric numbers become null; a blank address/url is tolerated.
 * Returns null only when there's nothing usable (no price AND no address). Never throws.
 * NOTE: `commission` is carried through if present (sponsored handling) but is NEVER used by the
 * value comparator — it is segregated to keep ranking honest.
 */
export function normalizeListing(raw = {}, { kind, source, nowMs = Date.now() } = {}) {
  if (raw == null || typeof raw !== 'object') return null;
  const price = num(raw.price);
  const sqft = num(raw.sqft);
  const address = typeof raw.address === 'string' ? raw.address : (raw.address != null ? String(raw.address) : '');
  if (price == null && !address) return null; // nothing to show

  const pricePerSqft = (price != null && sqft != null && sqft > 0) ? round2(price / sqft) : null;
  return {
    kind: kind || raw.kind || null,
    address,
    price,
    beds: num(raw.beds),
    baths: num(raw.baths),
    sqft,
    url: typeof raw.url === 'string' ? raw.url : '',
    source: source || raw.source || null,
    asOf: nowStamp(nowMs),
    pricePerSqft,
    sponsored: raw.sponsored === true,
    // carried through but NEVER fed to the value comparator (honest-ranking guardrail):
    commission: num(raw.commission),
  };
}

/**
 * Rank listings by VALUE (price-per-sqft, ascending — cheaper per sqft is better value), NEVER by
 * commission. Commission is deliberately ABSENT from the comparator. Sponsored listings are
 * SEGREGATED to the end and labeled — they can never outrank an organic listing. Listings with no
 * computable price/sqft fall to the bottom of their group (ties keep input order, stable).
 * Returns a NEW array; input is not mutated.
 */
export function rankListings(listings = []) {
  const items = (Array.isArray(listings) ? listings : []).filter((x) => x && typeof x === 'object');
  const organic = items.filter((x) => !x.sponsored);
  const sponsored = items.filter((x) => x.sponsored);

  // value signal: price-per-sqft ascending; a missing pps sorts LAST. Commission is not consulted.
  const ppsOf = (x) => {
    if (x.pricePerSqft != null && Number.isFinite(Number(x.pricePerSqft)) && x.pricePerSqft > 0) return Number(x.pricePerSqft);
    if (x.price != null && x.sqft != null && x.sqft > 0) return x.price / x.sqft;
    return Infinity; // unknown value → bottom
  };
  const byValue = (a, b) => ppsOf(a) - ppsOf(b);
  const stableSort = (arr) => arr
    .map((v, i) => [v, i])
    .sort((x, y) => byValue(x[0], y[0]) || (x[1] - y[1]))
    .map(([v]) => v);

  return [
    ...stableSort(organic),
    ...stableSort(sponsored).map((s) => ({ ...s, sponsored: true, label: 'Sponsored' })),
  ];
}

// ---------------------------------------------------------------------------
// agentMatch — consented, single-provider routing ONLY (hard guardrail)
// ---------------------------------------------------------------------------

/**
 * Build an agent / provider connection. REFUSES any path that lacks explicit consent OR that sells
 * user data. The only allowed handoff is a consented, single-provider routing (we forward the user's
 * stated request to ONE provider; we never sell a lead list). Returns a benign refusal-shaped result
 * (sold:false) on refusal; never throws.
 *   match: { area, consent, sellsData?, provider? }
 *   - consent !== true                  → refuse (no consent), sold:false
 *   - sellsData === true                → refuse (data-selling), sold:false
 *   - ok: single consented routing, sold:false (we NEVER sell user data)
 */
export function agentMatch({ area, consent, sellsData, provider } = {}) {
  // data-selling is refused even WITH consent — the no-data-selling guardrail is absolute.
  if (sellsData === true) {
    return { ok: false, sold: false, reason: 'refused: agent-matching that sells user data is not permitted (no-data-selling guardrail)' };
  }
  if (consent !== true) {
    return { ok: false, sold: false, reason: 'refused: agent-matching requires explicit user consent (no routing by default)' };
  }
  return {
    ok: true,
    sold: false, // user data is NEVER sold — only a single consented routing
    area: typeof area === 'string' ? area : (area != null ? String(area) : null),
    provider: provider != null ? String(provider) : null,
    routing: 'single-provider',
    note: 'consented single-provider routing only — no user data is sold, no lead list shared',
  };
}

/**
 * The canonical no-data-selling lead-gen guard for the real-estate vertical (mortgage/agent/rental
 * lead rows). Mirrors the insurance / affiliate-engine shape so the monetization-readiness scan detects
 * it (hasNoDataSellGuard checks for `buildLeadGen`). Delegates to affiliate.buildLeadGen when present;
 * enforces the SAME refusal locally otherwise. THROWS on any data-selling request; refuses (ok:false)
 * without explicit consent; allows only a consented, non-data-selling connection.
 *   lead: { vertical, providerUrl, sellsData?, userConsented? }
 */
export function buildLeadGen(lead = {}) {
  if (typeof _engineBuildLeadGen === 'function') return _engineBuildLeadGen(lead);
  const sellsData = lead.sellsData === true
    || String(process.env.LEAD_GEN_SELLS_DATA || 'false').toLowerCase() === 'true';
  if (sellsData) throw new Error('refused: data-selling lead-gen is not permitted (no-data-selling guardrail)');
  if (lead.userConsented !== true) return { ok: false, reason: 'lead-gen requires explicit user consent (no lead-gen by default)' };
  return { ok: true, mechanism: 'leadgen', vertical: lead.vertical || 'real-estate', providerUrl: typeof lead.providerUrl === 'string' ? lead.providerUrl : '', note: 'consented connection only — no user data is sold' };
}

// ---------------------------------------------------------------------------
// affordability — coliving median income + 28% front-end DTI rule
// ---------------------------------------------------------------------------

// The classic mortgage affordability rule of thumb: housing cost should not exceed 28% of gross
// monthly income (the "front-end" debt-to-income ratio).
export const DTI_FRONT_END = 0.28;

/**
 * Estimate whether a price/rent is affordable in `area`, using the metro median household income from
 * coliving.byMetro (ACS) and the 28% front-end DTI rule. PURE-ish: the income lookup is injected via
 * deps (deps.byMetro / deps.fetch), so tests run fully offline.
 *   { price, area } , deps={ byMetro?, fetch?, nowMs? }
 * Returns { affordable, price, area, medianIncome, monthlyIncome, maxMonthly, monthlyHousing, asOf, source }
 * or a benign { affordable: null, ... } when income is unknown. Never throws.
 *
 * `price` is interpreted as a MONTHLY housing cost when it looks like a rent (< 25,000) and as a
 * SALE price otherwise (converted to an indicative monthly payment via a simple annualization). The
 * comparison is monthlyHousing ≤ 28% of monthly income.
 */
export async function affordability({ price, area, monthly } = {}, deps = {}) {
  const lookup = deps.byMetro || byMetro;
  const nowMs = deps.nowMs || Date.now();
  const p = num(price);

  let medianIncome = null;
  try {
    // byMetro uses coliving's module-level fetch; inject the test fetch into THAT module so the
    // default lookup path is fully offline-testable.
    if (deps.fetch && lookup === byMetro) __setColivingFetch(deps.fetch);
    const rec = area ? await lookup(area, { nowMs }) : null;
    medianIncome = (rec != null && rec.value != null) ? num(rec.value) : null;
  } catch { medianIncome = null; }

  const asOf = nowStamp(nowMs);
  if (medianIncome == null || p == null) {
    return {
      affordable: null, price: p, area: area || null,
      medianIncome, monthlyIncome: null, maxMonthly: null, monthlyHousing: null,
      asOf, source: 'census',
      note: medianIncome == null ? 'median income unavailable' : 'price unavailable',
    };
  }

  const monthlyIncome = round2(medianIncome / 12);
  const maxMonthly = round2(monthlyIncome * DTI_FRONT_END);

  // determine the monthly housing cost being tested
  let monthlyHousing;
  if (monthly === true || p < 25000) {
    monthlyHousing = round2(p); // already a monthly rent
  } else {
    // indicative monthly cost for a sale price: rough all-in (P&I + tax/ins) ≈ 0.6% of price / month.
    // This is a deliberately simple, transparent heuristic — not a quote.
    monthlyHousing = round2(p * 0.006);
  }

  return {
    affordable: monthlyHousing <= maxMonthly,
    price: p,
    area: area || null,
    medianIncome,
    monthlyIncome,
    maxMonthly,
    monthlyHousing,
    asOf,
    source: 'census',
  };
}

// ---------------------------------------------------------------------------
// live search (each source soft-fails to [] — never throws)
// ---------------------------------------------------------------------------

async function getJson(url, deps = {}) {
  const f = deps.fetch || _fetch;
  try {
    const r = await f(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Search listings for { type:'buy'|'rent'|'commercial', area, beds?, maxPrice? }. Picks the portal by
 * type, fetches (injected fetch), and normalizes each raw row. Soft-fails to [] on any error, bad
 * type, or missing area. Never throws. The provider response is expected to expose an array under
 * `.listings` / `.results` / `.props` / or be a bare array; we tolerate all of these.
 *   returns normalized [{ kind, address, price, beds, baths, sqft, url, source, asOf, ... }]
 */
export async function searchListings({ type, area, beds, maxPrice } = {}, deps = {}) {
  const portal = PORTALS[String(type || '').toLowerCase()];
  if (!portal || !area) return [];

  const nowMs = deps.nowMs || Date.now();
  const params = new URLSearchParams({ area: String(area) });
  if (beds != null) params.set('beds', String(beds));
  if (maxPrice != null) params.set('maxPrice', String(maxPrice));
  const url = `${portal.host}/api/search?${params.toString()}`;

  const j = await getJson(url, deps);
  if (!j) return [];
  const rows = Array.isArray(j) ? j
    : Array.isArray(j.listings) ? j.listings
    : Array.isArray(j.results) ? j.results
    : Array.isArray(j.props) ? j.props
    : [];

  const out = [];
  for (const raw of rows) {
    const n = normalizeListing(raw, { kind: portal.kind, source: portal.source, nowMs });
    if (!n) continue;
    if (maxPrice != null && n.price != null && n.price > Number(maxPrice)) continue;
    if (beds != null && n.beds != null && n.beds < Number(beds)) continue;
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// dataNote — the as-of / provenance line
// ---------------------------------------------------------------------------

/** A short provenance / as-of note for the page footer. PURE, escaped-safe text (no HTML). */
export function dataNote({ source, asOf, nowMs = Date.now() } = {}) {
  const when = asOf || nowStamp(nowMs);
  const src = source ? `${source}` : 'Zillow / Apartments.com / LoopNet';
  return `Listings via ${src}. Data as of ${when}. Prices and availability change frequently — `
    + 'verify with the provider. Ranking is by value (price/sqft), never by commission.';
}

// ---------------------------------------------------------------------------
// renderPage — escaped HTML, disclosure on EVERY page
// ---------------------------------------------------------------------------

function renderRow(x) {
  const addr = esc(x.address || 'Address unavailable');
  const price = x.price != null ? `$${esc(x.price.toLocaleString ? x.price.toLocaleString() : x.price)}` : 'n/a';
  const pps = x.pricePerSqft != null ? ` ($${esc(x.pricePerSqft)}/sqft)` : '';
  const bb = [];
  if (x.beds != null) bb.push(`${esc(x.beds)} bd`);
  if (x.baths != null) bb.push(`${esc(x.baths)} ba`);
  if (x.sqft != null) bb.push(`${esc(x.sqft)} sqft`);
  const meta = bb.length ? ` — ${esc(bb.join(' · '))}` : '';
  const src = x.source ? `<span class="re-source">${esc(x.source)}</span>` : '';
  const badge = x.sponsored ? '<span class="re-badge" aria-label="sponsored">Sponsored</span>' : '';

  // affiliate-tag the outbound link via the shared trackedLink (id by env NAME only; soft-fail to plain
  // url + tracked:false when unconfigured, so links work pre-go-live).
  const portal = Object.values(PORTALS).find((p) => p.source === x.source);
  const link = trackedLink(portal ? portal.network : null, x.url || '#', { subId: x.source || undefined });
  const href = esc(link.url || '#');

  return `<li class="re-listing"${x.sponsored ? ' data-sponsored="true"' : ''}>`
    + `<a class="re-addr" href="${href}" rel="sponsored nofollow noopener" target="_blank">${addr}</a>`
    + badge
    + `<span class="re-price">${price}${pps}</span>`
    + meta
    + src
    + '</li>';
}

/**
 * Render an escaped HTML page for a ranked listing set. EVERY page carries the FTC disclosure (via
 * affiliate.disclose — no opt-out). All user/provider-derived text is escaped. A malicious address is
 * neutralized. Sponsored items are labeled. Never throws.
 *   { title?, area?, type?, listings, affordability?, source?, asOf? }
 */
export function renderPage({ title, area, type, listings = [], affordability: aff, source, asOf, nowMs = Date.now() } = {}) {
  const ranked = rankListings(listings);
  const head = esc(title || `Real estate${area ? ` — ${area}` : ''}${type ? ` (${type})` : ''}`);

  const affLine = aff && aff.affordable != null
    ? `<p class="re-afford">Affordability: ${aff.affordable ? 'within' : 'above'} the 28% rule for the area `
      + `(median income $${esc(aff.medianIncome)}; max ~$${esc(aff.maxMonthly)}/mo; this ~$${esc(aff.monthlyHousing)}/mo).</p>`
    : '';

  const rows = ranked.length
    ? `<ul class="re-list">${ranked.map(renderRow).join('')}</ul>`
    : '<p class="re-empty">No listings found.</p>';

  const note = `<p class="re-datanote">${esc(dataNote({ source, asOf, nowMs }))}</p>`;

  const body = `<section class="real-estate"><h1>${head}</h1>${affLine}${rows}${note}</section>`;
  // disclose() appends the escaped FTC disclosure — the always-on guarantee on every page.
  return disclose(body);
}

// ---------------------------------------------------------------------------
// CLI (guarded)
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('real-estate.mjs')) {
  const type = (process.argv[2] || 'buy').toLowerCase();
  const area = process.argv.slice(3).join(' ') || 'Austin';
  const listings = await searchListings({ type, area }).catch(() => []);
  const ranked = rankListings(listings);
  console.log(`SoapBox Real Estate — ${area} (${type})`);
  console.log('─'.repeat(56));
  if (!ranked.length) console.log('No listings (live providers need adapters / keys).');
  for (const x of ranked) {
    const pps = x.pricePerSqft != null ? ` $${x.pricePerSqft}/sqft` : '';
    const sp = x.sponsored ? ' [Sponsored]' : '';
    console.log(`  ${String(x.address || 'n/a').slice(0, 40).padEnd(40)} ${x.price != null ? '$' + x.price : 'n/a'}${pps} [${x.source}]${sp}`);
  }
  console.log('\n' + dataNote({ source: PORTALS[type] ? PORTALS[type].source : undefined }));
}
