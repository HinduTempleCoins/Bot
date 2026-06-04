// auto-marketplace.mjs — SoapBox "Auto" aggregator vertical (queue #243). A CarGurus / RockAuto /
// RepairPal / TireRack–style honest comparison surface across the four auto sub-markets:
//   • CARS    — used/new vehicle LISTINGS (CarGurus / Autotrader / Cars.com model)
//   • PARTS   — replacement-part price compare (RockAuto model)
//   • REPAIR  — fair-price repair estimates by job + ZIP (RepairPal model)
//   • TIRES   — tire price compare by size (TireRack / SimpleTire model)
//
// Like the rest of the SoapBox readers it is ESM, soft-fail (every source drops to [] / 'unknown' and
// the module NEVER throws), uses an INJECTABLE fetch, escapes ALL HTML, and guards its CLI block.
//
// THE WHOLE POINT — what makes this honest, not a lead-mill:
//   1. RANK BY VALUE, NEVER BY COMMISSION. rankByValue() sorts on the genuine deal signal (good-deal vs
//      overpriced relative to fair value, then lower price). There is NO commission/payout field anywhere
//      in the ranking path. valueCheck() grades a listing against the SoapBox-native fair-market value —
//      it does NOT duplicate that math, it DELEGATES to vehicle-value.mjs (fairMarketRange / valueByVin).
//   2. DISCLOSURE ALWAYS. Every outbound offer link renders through affiliate.mjs (disclose / affiliateLink)
//      with a local fallback, so an FTC disclosure is present wherever results appear.
//   3. REUSE THE VEHICLE READERS. Fair-value comes from vehicle-value.mjs via a DEFENSIVE import; if that
//      module is unavailable, valueCheck soft-fails to a shaped 'unknown' verdict instead of erroring.
//
// No secrets: API keys are referenced BY ENV NAME ONLY (never the value) and the module soft-fails to []
// when a key is absent:
//   MARKETCHECK_KEY      — car listings (MarketCheck), shared with vehicle-value.mjs
//   PARTS_API_KEY        — parts price feed
//   REPAIR_ESTIMATE_KEY  — repair fair-price estimates
//   TIRES_API_KEY        — tire price feed
//
//   import { searchCars, valueCheck, parts, repairEstimate, tires, rankByValue, renderPage, dataNote }
//     from './auto-marketplace.mjs'
//   node integrations/soapbox/auto-marketplace.mjs cars honda civic 20000 90210

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const posNum = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
const asOf = () => new Date().toISOString().slice(0, 10);

// Escape user/source-controlled text before it lands in HTML. Mirrors the project convention.
export function esc(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// best-effort JSON GET via the injected (or default) fetch. Returns null on ANY failure — never throws.
async function getJson(f, url) {
  try {
    const r = await f(url, { headers: { ...UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// pull an array of rows out of whatever envelope a source returns.
function rowsOf(j) {
  if (Array.isArray(j)) return j;
  return j?.listings || j?.results || j?.data || j?.items || j?.products || [];
}

// ── CARS — vehicle listings (CarGurus / Autotrader model) ─────────────────────────────────────────────
// searchCars({ make, model, maxPrice, zip }, { fetch }) → normalized listings (soft-fail []).
// Key-gated on MARKETCHECK_KEY (shared with vehicle-value.mjs). With no key, or any failure, returns [].
// Each listing is normalized to a stable shape; the maxPrice filter is applied AFTER normalization so a
// source that ignores the price param still yields a correctly-bounded result.
export async function searchCars({ make, model, maxPrice, zip } = {}, { fetch } = {}) {
  const mk = str(make);
  const md = str(model);
  if (!mk && !md) return [];
  const cap = posNum(maxPrice);
  const f = typeof fetch === 'function' ? fetch : _fetch;

  const key = process.env.MARKETCHECK_KEY;
  if (!key) return []; // no key → soft-fail; never fabricate listings

  const params = new URLSearchParams({ api_key: key, rows: '50' });
  if (mk) params.set('make', mk);
  if (md) params.set('model', md);
  if (str(zip)) params.set('zip', str(zip));
  if (cap != null) params.set('price_range', `0-${Math.round(cap)}`);

  const j = await getJson(f, `https://mc-api.marketcheck.com/v2/search/car/active?${params.toString()}`);
  const rows = rowsOf(j);

  const normalized = (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const build = r?.build || {};
      return {
        title: str(r.heading ?? r.title ?? [build.year, build.make, build.model, build.trim].filter(Boolean).join(' ')),
        price: posNum(r.price ?? r.list_price ?? r.listing_price),
        miles: num(r.miles ?? r.mileage),
        year: num(build.year ?? r.year),
        make: str(build.make ?? r.make ?? mk),
        model: str(build.model ?? r.model ?? md),
        trim: str(build.trim ?? r.trim) || null,
        vin: str(r.vin) || null,
        dealer: str(r?.dealer?.name ?? r.seller ?? r.source) || null,
        zip: str(r?.dealer?.zip ?? r.zip ?? zip) || null,
        url: str(r.vdp_url ?? r.url ?? r.link) || null,
        source: 'MarketCheck',
      };
    })
    .filter((l) => l.title && l.price != null)
    // Apply maxPrice ourselves so we never trust the source to have honored it.
    .filter((l) => cap == null || l.price <= cap);

  return normalized;
}

// ── valueCheck — grade a listing vs fair market value, DELEGATING to vehicle-value.mjs ────────────────
// valueCheck(listing, deps) → { verdict, fair, delta, deltaPct, price, source } (soft-fail → 'unknown').
// deps may inject { fairValue, vehicleValue } for offline tests:
//   • deps.fairValue: a number OR a { low, median, high } object → used directly (no import, no network).
//   • deps.vehicleValue: a module-shaped object exposing valueByVin / fairMarketRange → delegated to.
// With neither, it DEFENSIVELY imports ./vehicle-value.mjs and delegates to valueByVin(listing.vin).
// verdict thresholds vs the fair median: <= -5% good-deal, within ±5% fair, >= +5% overpriced.
export async function valueCheck(listing = {}, deps = {}) {
  const price = posNum(listing?.price);
  const unknown = (extra) => ({ verdict: 'unknown', fair: null, delta: null, deltaPct: null, price, source: null, ...extra });
  if (price == null) return unknown();

  // 1) Resolve a fair-value range. Prefer an injected value (pure/offline), else delegate to the module.
  let range = null;
  let source = null;

  const fromObj = (o) => {
    if (o == null) return null;
    if (typeof o === 'number' && Number.isFinite(o)) return { low: null, median: o, high: null };
    if (typeof o === 'object') {
      const median = num(o.median ?? o.fair ?? o.value);
      if (median != null || num(o.low) != null || num(o.high) != null) {
        return { low: num(o.low), median, high: num(o.high) };
      }
    }
    return null;
  };

  if (deps.fairValue !== undefined) {
    range = fromObj(deps.fairValue);
    source = 'injected';
  } else {
    // DELEGATE to vehicle-value.mjs — never recompute the valuation math here.
    let mod = deps.vehicleValue;
    if (!mod) mod = await import('./vehicle-value.mjs').catch(() => null);
    if (mod) {
      try {
        // VIN path is the precise one (real listings carry a VIN); valueByVin returns a fairMarketRange shape.
        if (str(listing.vin) && typeof mod.valueByVin === 'function') {
          const v = await mod.valueByVin(str(listing.vin)).catch(() => null);
          range = fromObj(v);
          source = v?.source && v.source !== 'none' ? `vehicle-value:${v.source}` : null;
        }
        // Fallback: if caller handed us comparable listings, derive a range with the module's PURE math.
        if (range?.median == null && Array.isArray(listing.comps) && typeof mod.fairMarketRange === 'function') {
          range = fromObj(mod.fairMarketRange(listing.comps));
          source = 'vehicle-value:comps';
        }
      } catch { range = null; }
    }
  }

  if (!range || range.median == null) return unknown({ source });

  const fairMedian = range.median;
  const delta = Math.round((price - fairMedian) * 100) / 100;
  const deltaPct = Math.round((delta / fairMedian) * 1000) / 10; // one decimal place, percent
  const verdict = deltaPct <= -5 ? 'good-deal' : deltaPct >= 5 ? 'overpriced' : 'fair';

  return { verdict, fair: range, delta, deltaPct, price, source };
}

// ── PARTS — replacement-part price compare (RockAuto model) ───────────────────────────────────────────
// parts({ partQuery }, { fetch }) → normalized parts (soft-fail []). Key-gated on PARTS_API_KEY.
export async function parts({ partQuery } = {}, { fetch } = {}) {
  const q = str(partQuery);
  if (!q) return [];
  const f = typeof fetch === 'function' ? fetch : _fetch;
  const key = process.env.PARTS_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({ api_key: key, q });
  const j = await getJson(f, `https://api.soapbox.community/auto/parts?${params.toString()}`);
  const rows = rowsOf(j);

  return (Array.isArray(rows) ? rows : [])
    .map((p) => ({
      name: str(p.name ?? p.title ?? p.part_name ?? p.description),
      brand: str(p.brand ?? p.manufacturer) || null,
      partNumber: str(p.partNumber ?? p.part_number ?? p.sku ?? p.mpn) || null,
      price: posNum(p.price ?? p.list_price),
      vendor: str(p.vendor ?? p.seller ?? p.store ?? p.source) || null,
      url: str(p.url ?? p.link) || null,
      source: 'parts',
    }))
    .filter((p) => p.name && p.price != null);
}

// ── REPAIR — fair-price repair estimates by job + ZIP (RepairPal model) ───────────────────────────────
// repairEstimate({ job, zip }, { fetch }) → normalized estimate (soft-fail null). Key-gated on
// REPAIR_ESTIMATE_KEY. Returns a low/avg/high fair-price band, NOT a quote.
export async function repairEstimate({ job, zip } = {}, { fetch } = {}) {
  const j0 = str(job);
  const z = str(zip);
  if (!j0) return null;
  const f = typeof fetch === 'function' ? fetch : _fetch;
  const key = process.env.REPAIR_ESTIMATE_KEY;
  if (!key) return null;

  const params = new URLSearchParams({ api_key: key, job: j0 });
  if (z) params.set('zip', z);
  const j = await getJson(f, `https://api.soapbox.community/auto/repair?${params.toString()}`);
  if (!j || typeof j !== 'object') return null;

  const est = j.estimate || j.result || j;
  const low = posNum(est.low ?? est.min ?? est.parts_low ?? est.totalLow);
  const high = posNum(est.high ?? est.max ?? est.totalHigh);
  const avg = posNum(est.avg ?? est.average ?? est.mid ?? (low != null && high != null ? (low + high) / 2 : null));
  if (low == null && avg == null && high == null) return null;

  return {
    job: j0,
    zip: z || null,
    low, avg, high,
    currency: str(est.currency) || 'USD',
    note: 'Fair-price range estimate by job and area — not a quote. Get an itemized written estimate.',
    estimate: true,
    source: 'repair-estimate',
    asOf: asOf(),
  };
}

// ── TIRES — tire price compare by size (TireRack model) ───────────────────────────────────────────────
// tires({ size }, { fetch }) → normalized tires (soft-fail []). Key-gated on TIRES_API_KEY.
export async function tires({ size } = {}, { fetch } = {}) {
  const sz = str(size);
  if (!sz) return [];
  const f = typeof fetch === 'function' ? fetch : _fetch;
  const key = process.env.TIRES_API_KEY;
  if (!key) return [];

  const params = new URLSearchParams({ api_key: key, size: sz });
  const j = await getJson(f, `https://api.soapbox.community/auto/tires?${params.toString()}`);
  const rows = rowsOf(j);

  return (Array.isArray(rows) ? rows : [])
    .map((t) => ({
      model: str(t.model ?? t.name ?? t.title),
      brand: str(t.brand ?? t.manufacturer) || null,
      size: str(t.size ?? sz),
      price: posNum(t.price ?? t.list_price),
      vendor: str(t.vendor ?? t.seller ?? t.store ?? t.source) || null,
      url: str(t.url ?? t.link) || null,
      source: 'tires',
    }))
    .filter((t) => t.model && t.price != null);
}

// ── rankByValue — rank by the GENUINE deal signal, NEVER by commission ────────────────────────────────
// Sorts a list of priced items (cars/parts/tires) by value: items carrying a value verdict rank by
// good-deal > fair > overpriced > unknown; within a tier the lower price wins; final tiebreak by title.
// NO commission/payout field is read here — there is no path for "who pays us more" to change the order.
// Returns a NEW array; the input is never mutated.
const VERDICT_RANK = { 'good-deal': 0, fair: 1, overpriced: 2, unknown: 3 };
export function rankByValue(items = []) {
  const arr = Array.isArray(items) ? items.slice() : [];
  const titleOf = (x) => str(x?.title ?? x?.name ?? x?.model);
  const verdictOf = (x) => (x?.verdict ?? x?.value?.verdict ?? 'unknown');
  return arr.sort((a, b) => {
    const va = VERDICT_RANK[verdictOf(a)] ?? 3;
    const vb = VERDICT_RANK[verdictOf(b)] ?? 3;
    if (va !== vb) return va - vb;
    const pa = posNum(a?.price);
    const pb = posNum(b?.price);
    const na = pa == null ? Infinity : pa;
    const nb = pb == null ? Infinity : pb;
    if (na !== nb) return na - nb;
    return titleOf(a).localeCompare(titleOf(b));
  });
  // NOTE: commission is deliberately absent from this comparator — ranking can never be bought.
}

// ── disclosure — reuse affiliate.mjs (disclose / affiliateLink) with a local fallback ─────────────────
// Eagerly load the affiliate engine at module init (top-level await, like insurance.mjs) so the
// SYNCHRONOUS render path can affiliate-tag outbound links via trackOutSync. Soft-fails to null — the
// module still works (links render plain, tracked:false) if the engine is unavailable.
let _affCache = await import('../affiliate.mjs').catch(() => null);
async function affiliateMod() {
  if (_affCache !== undefined && _affCache !== null) return _affCache;
  _affCache = await import('../affiliate.mjs').catch(() => null);
  return _affCache;
}
// Synchronous best-effort tag for the (sync) render path: uses the affiliate engine ONLY if it is
// already cached (call await affiliateMod() once before rendering to warm it). Soft-fails to the plain
// url + tracked:false when the engine isn't loaded or the publisher id is unset — links always work.
function trackOutSync(url, { network = 'cj', subId } = {}) {
  const plain = str(url);
  const mod = _affCache;
  if (!mod || typeof mod.trackedLink !== 'function' || !plain) return { url: plain, tracked: false };
  const link = mod.trackedLink(network, plain, { subId });
  return { url: link.url || plain, tracked: link.tracked === true };
}
const FALLBACK_DISCLOSURE = 'Disclosure: some links are affiliate links — we may earn a commission at no '
  + 'extra cost to you. Commissions never affect our ranking, and we never sell your data.';

// ── no-data-selling guard — REPAIR / CAR lead rows (RepairPal/dealer-quote model) ─────────────────────
// The Auto vertical has lead-gen rows (cars + auto-repair use the leadgen mechanism in the directory):
// a "request a dealer quote" / "book a repair" handoff. This is the canonical no-data-selling guard for
// those rows so the monetization-readiness scan detects it (it checks for a `buildLeadGen` export).
// THROWS on any data-selling request; refuses (ok:false) without explicit consent; allows only a
// consented, single-provider connection. Kept local so the refusal can never be bypassed by a missing
// import (mirrors local-pros.requestQuote / insurance.buildLeadGen discipline).
//   lead: { vertical?, providerUrl?, sellsData?, userConsented? }
export function buildLeadGen(lead = {}) {
  const sellsData = lead.sellsData === true
    || String(process.env.LEAD_GEN_SELLS_DATA || 'false').toLowerCase() === 'true';
  if (sellsData) throw new Error('refused: data-selling lead-gen is not permitted (no-data-selling guardrail)');
  if (lead.userConsented !== true) return { ok: false, reason: 'lead-gen requires explicit user consent (no lead-gen by default)' };
  return { ok: true, mechanism: 'leadgen', vertical: lead.vertical || 'auto-marketplace', providerUrl: typeof lead.providerUrl === 'string' ? lead.providerUrl : '', note: 'consented single-provider connection only — no user data is sold' };
}

// ── affiliateOut — tag an outbound auto listing/vendor link via the shared trackedLink ────────────────
// Routes a plain outbound URL through affiliate.trackedLink (id by env NAME only). Soft-fails to the
// PLAIN url with tracked:false when the engine or the publisher id is unavailable, so links always work
// pre-go-live. `network` defaults to CJ (the auto directory rows' example network). Never throws.
//   -> { url, tracked, configured, disclosure }
export async function affiliateOut(url, { network = 'cj', subId } = {}) {
  const plain = str(url);
  const mod = await affiliateMod();
  if (!mod || typeof mod.trackedLink !== 'function' || !plain) {
    return { url: plain, tracked: false, configured: false, disclosure: FALLBACK_DISCLOSURE };
  }
  const link = mod.trackedLink(network, plain, { subId });
  return { url: link.url || plain, tracked: link.tracked === true, configured: link.configured === true, disclosure: link.disclosure || FALLBACK_DISCLOSURE };
}

// ── provenance / data note ────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Auto comparison across cars, parts, repair, and tires, as of ${asOf()}. `
    + 'Car listings are graded against the SoapBox-derived fair-market value (reusing the vehicle value '
    + 'reader) — good-deal / fair / overpriced is computed from the price, not from who pays us. '
    + 'Repair figures are a fair-price range estimate, not a quote. '
    + 'Everything is ranked by value, never by commission, and every outbound link carries a disclosure.';
}

// ── renderPage — escaped HTML + value verdicts + always-on disclosure ─────────────────────────────────
// data: { kind, cars, parts, repair, tires, query, disclosure } (any field optional). EVERY value escaped.
export function renderPage(data = {}) {
  const cars = Array.isArray(data.cars) ? data.cars : [];
  const partsList = Array.isArray(data.parts) ? data.parts : [];
  const tiresList = Array.isArray(data.tires) ? data.tires : [];
  const repair = data.repair && typeof data.repair === 'object' ? data.repair : null;
  const disclosure = str(data.disclosure) || FALLBACK_DISCLOSURE;

  const verdictCell = (l) => {
    const v = l?.verdict ?? l?.value?.verdict;
    if (!v || v === 'unknown') return '—';
    return esc(v);
  };

  const carRows = cars.map((l) => {
    // affiliate-tag the outbound listing link via the shared trackedLink (id by env NAME only; soft-fail
    // to the plain url when unconfigured, so links work pre-go-live).
    const out = l.url ? trackOutSync(l.url, { network: l.network || 'cj', subId: l.source || l.dealer || undefined }) : null;
    return `<tr>`
      + `<td>${esc(l.title)}</td>`
      + `<td>${l.price == null ? '—' : '$' + esc(l.price)}</td>`
      + `<td>${l.miles == null ? '—' : esc(l.miles)}</td>`
      + `<td>${verdictCell(l)}</td>`
      + `<td>${esc(l.dealer ?? '')}</td>`
      + `<td>${out ? `<a href="${esc(out.url)}" rel="sponsored nofollow noopener" target="_blank">listing</a>` : '—'}</td>`
      + `</tr>`;
  }).join('');

  const partRows = partsList.map((p) => `<tr>`
    + `<td>${esc(p.name)}</td>`
    + `<td>${esc(p.brand ?? '')}</td>`
    + `<td>${esc(p.partNumber ?? '')}</td>`
    + `<td>${p.price == null ? '—' : '$' + esc(p.price)}</td>`
    + `<td>${esc(p.vendor ?? '')}</td>`
    + `</tr>`).join('');

  const tireRows = tiresList.map((t) => `<tr>`
    + `<td>${esc(t.model)}</td>`
    + `<td>${esc(t.brand ?? '')}</td>`
    + `<td>${esc(t.size ?? '')}</td>`
    + `<td>${t.price == null ? '—' : '$' + esc(t.price)}</td>`
    + `<td>${esc(t.vendor ?? '')}</td>`
    + `</tr>`).join('');

  const carSection = cars.length
    ? `<h3>Cars</h3>
  <table class="cars">
    <thead><tr><th>Listing</th><th>Price</th><th>Miles</th><th>Value</th><th>Dealer</th><th>Link</th></tr></thead>
    <tbody>${carRows}</tbody>
  </table>
  <p class="rank-note">Ranked by value vs fair market price — never by commission.</p>`
    : '';

  const partSection = partsList.length
    ? `<h3>Parts</h3>
  <table class="parts">
    <thead><tr><th>Part</th><th>Brand</th><th>Part #</th><th>Price</th><th>Vendor</th></tr></thead>
    <tbody>${partRows}</tbody>
  </table>`
    : '';

  const tireSection = tiresList.length
    ? `<h3>Tires</h3>
  <table class="tires">
    <thead><tr><th>Tire</th><th>Brand</th><th>Size</th><th>Price</th><th>Vendor</th></tr></thead>
    <tbody>${tireRows}</tbody>
  </table>`
    : '';

  const repairSection = repair
    ? `<h3>Repair estimate${repair.job ? ` — ${esc(repair.job)}` : ''}</h3>
  <p class="repair">Fair-price range: `
      + `${repair.low == null ? '—' : '$' + esc(repair.low)}`
      + ` to ${repair.high == null ? '—' : '$' + esc(repair.high)}`
      + `${repair.avg == null ? '' : ` (avg ~$${esc(repair.avg)})`}.</p>
  <p class="repair-note">${esc(repair.note || 'Fair-price range estimate, not a quote.')}</p>`
    : '';

  return `<section class="auto-marketplace">
  <h2>Auto comparison</h2>
  ${carSection}
  ${partSection}
  ${tireSection}
  ${repairSection}
  <p class="disclosure">${esc(disclosure)}</p>
  <p class="note">${esc(dataNote())}</p>
</section>`;
}

// Convenience: render with the affiliate disclosure resolved (async). Soft-fails to the local fallback.
export async function renderPageWithDisclosure(data = {}) {
  let disclosure = FALLBACK_DISCLOSURE;
  try {
    const a = await affiliateMod();
    if (a && typeof a.ftcDisclosure === 'function') disclosure = str(a.ftcDisclosure()) || FALLBACK_DISCLOSURE;
  } catch { /* keep fallback */ }
  return renderPage({ ...data, disclosure });
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('auto-marketplace.mjs')) {
  const [kind = 'cars', a = '', b = '', c = '', zip = ''] = process.argv.slice(2);
  if (kind === 'cars') {
    const cars = await searchCars({ make: a, model: b, maxPrice: c, zip }, {}).catch(() => []);
    const graded = [];
    for (const l of cars) graded.push({ ...l, ...(await valueCheck(l, {}).catch(() => ({}))) });
    const ranked = rankByValue(graded);
    console.log(`\nCars (${ranked.length}, ranked by value):`);
    for (const l of ranked.slice(0, 20)) console.log(`  • ${l.title.padEnd(40)} $${l.price ?? '—'}  [${l.verdict ?? 'unknown'}]`);
  } else if (kind === 'parts') {
    const p = await parts({ partQuery: [a, b, c].filter(Boolean).join(' ') }, {}).catch(() => []);
    console.log(`\nParts (${p.length}):`); for (const x of p) console.log(`  • ${x.name} — $${x.price} (${x.vendor || '?'})`);
  } else if (kind === 'repair') {
    console.log('\nRepair:', JSON.stringify(await repairEstimate({ job: [a, b].filter(Boolean).join(' '), zip: c || zip }, {}).catch(() => null), null, 2));
  } else if (kind === 'tires') {
    const t = await tires({ size: a }, {}).catch(() => []);
    console.log(`\nTires (${t.length}):`); for (const x of t) console.log(`  • ${x.model} ${x.size} — $${x.price} (${x.vendor || '?'})`);
  }
  console.log(`\n${dataNote()}`);
}
