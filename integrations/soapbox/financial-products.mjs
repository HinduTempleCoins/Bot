// financial-products.mjs — the SoapBox financial-products comparison reader (queue #238, the
// NerdWallet / Bankrate model): credit cards, personal/auto/business loans, mortgages, savings & CDs,
// tax software — compared HONESTLY by true cost (APR + fees), never by commission.
//
// THE MOAT (mirrors integrations/affiliate.mjs §3-4): the comparison stays honest no matter how it is
// monetized. Three hard guardrails, all encoded here:
//   (a) ranking is BY TRUE COST (APR + amortized fees / honest yield), NEVER by commission. Sponsored
//       rows are SEGREGATED to the end and clearly labeled — they can never outrank an organic row.
//   (b) NO data-selling / NO lead-gen-by-default. The "apply / get connected" path routes through
//       affiliate.buildLeadGen, which THROWS on any data-selling request. We earn via disclosed
//       affiliate referral, not by selling a list of users.
//   (c) every outbound link carries a disclosure, and every rendered page carries a NOT-financial-advice
//       banner.
//
// Affiliate ids come from the environment BY NAME ONLY (via affiliate.mjs) — this file never contains an
// id and never fabricates one; an unset env returns the plain, untagged URL + "not configured".
//
// READER discipline (like fred.mjs / macro.mjs): injectable fetch, every getter soft-fails (returns []
// / null, never throws), a dead source just drops out, every value is escaped before it touches HTML.
//
//   import { CATEGORIES, compareProducts, rankProducts, rateContext, applyOut, renderPage, dataNote }
//     from './financial-products.mjs'
//   node integrations/soapbox/financial-products.mjs credit-cards
//
// The affiliate engine is imported DEFENSIVELY: if it can't be loaded we fall back to safe local
// shims (plain url + a no-op data-selling refusal) so the module still soft-fails rather than crashing.

let _affiliate = null;
try {
  _affiliate = await import('../affiliate.mjs');
} catch {
  _affiliate = null;
}

// Defensive accessors over the affiliate engine. Each falls back to a safe local behavior when the
// engine (or a specific export) is unavailable — the no-data-selling guard is still enforced locally.
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
// Build a consented, non-data-selling lead handoff. THROWS on any data-selling request (the central
// guard). Uses affiliate.buildLeadGen when present; otherwise enforces the same refusal locally.
export function buildLeadGen(lead = {}) {
  if (_affiliate && typeof _affiliate.buildLeadGen === 'function') return _affiliate.buildLeadGen(lead);
  const sellsData = lead.sellsData === true
    || String(process.env.LEAD_GEN_SELLS_DATA || 'false').toLowerCase() === 'true';
  if (sellsData) throw new Error('refused: data-selling lead-gen is not permitted (no-data-selling guardrail)');
  if (lead.userConsented !== true) return { ok: false, reason: 'lead-gen requires explicit user consent (no lead-gen by default)' };
  return { ok: true, mechanism: 'leadgen', vertical: lead.vertical || null, providerUrl: typeof lead.providerUrl === 'string' ? lead.providerUrl : '', note: 'consented connection only — no user data is sold' };
}

// ── injectable fetch ────────────────────────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const asOfDate = () => new Date().toISOString().slice(0, 10);

// Escape any text before it lands in HTML. Mirrors the project convention (fred.mjs / epa-enviro.mjs).
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── CATEGORIES — the comparison verticals ────────────────────────────────────────────────────────────
// Each: a friendly label, the kind of "rate" the row carries, the FRED benchmark series id used to
// answer "is this competitive", and the honest monetization mechanism. Affiliate-network ids are read
// from env by name inside affiliate.mjs; loans use the consented (non-data-selling) lead-gen path.
export const CATEGORIES = {
  'credit-cards':   { label: 'Credit cards',        rateKind: 'apr',   benchmark: 'TERMCBCCALLNS', mechanism: 'affiliate', note: 'Compare ongoing purchase APR + annual fee (NerdWallet model).' },
  'personal-loans': { label: 'Personal loans',      rateKind: 'apr',   benchmark: 'TERMCBPER24NS', mechanism: 'leadgen',   note: 'Consented lender connection only — no data-selling (Credible model).' },
  'mortgages':      { label: 'Mortgages',           rateKind: 'apr',   benchmark: 'MORTGAGE30US',  mechanism: 'affiliate', note: 'Compare APR + lender fees / points (Bankrate model).' },
  'auto-loans':     { label: 'Auto loans',          rateKind: 'apr',   benchmark: 'TERMCBAUTO48NS',mechanism: 'affiliate', note: 'Compare APR + origination fees by term.' },
  'savings-cds':    { label: 'Savings & CDs',       rateKind: 'apy',   benchmark: 'DFF',           mechanism: 'affiliate', note: 'Higher APY is better; watch minimums + early-withdrawal penalties.' },
  'business-loans': { label: 'Business loans / SBA',rateKind: 'apr',   benchmark: 'DPRIME',        mechanism: 'leadgen',   note: 'SBA 7(a) is prime-anchored; consented connection only — no data-selling.' },
  'tax-software':   { label: 'Tax software',        rateKind: 'price', benchmark: null,            mechanism: 'affiliate', note: 'Compare filing price + free-tier eligibility (the IRS Free File alternative).' },
};

export function isCategory(category) { return Object.prototype.hasOwnProperty.call(CATEGORIES, str(category)); }
export function listCategories() { return Object.keys(CATEGORIES); }

// ── data source ──────────────────────────────────────────────────────────────────────────────────────
// There is no single free, keyless "all financial products with live APR" feed (NerdWallet/Bankrate are
// proprietary). The reader is therefore source-injectable: a deployment points FINPROD_SOURCE_URL at a
// curated JSON feed of the shape { products: [ { provider, product, apr|apy, fees, terms, url, ... } ] }.
// When unset (the default), compareProducts soft-fails to [] — the page shows "no data" rather than
// inventing rates. This keeps the module honest and testable offline.
function sourceUrl(category) {
  const base = process.env.FINPROD_SOURCE_URL;
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

// Normalize ONE raw product record → the canonical shape. PURE. Returns null on an unusable record.
//   { provider, product, apr, apy, fees, terms, url, asOf, sponsored, commission }
// `apr`/`apy` are numbers (percent) or null; `fees` is a number (annual/origination $) or null. The
// `commission` field (what a provider would pay us) is carried through ONLY so ranking can prove it is
// IGNORED — it is never used as a ranking signal.
export function normalizeProduct(raw, category) {
  if (!raw || typeof raw !== 'object') return null;
  const provider = str(raw.provider || raw.issuer || raw.bank || raw.lender);
  const product = str(raw.product || raw.name || raw.card || raw.plan);
  if (!provider && !product) return null;
  const apr = num(raw.apr ?? raw.rate ?? raw.interest);
  const apy = num(raw.apy ?? raw.yield);
  const fees = num(raw.fees ?? raw.annualFee ?? raw.fee ?? raw.originationFee);
  const price = num(raw.price ?? raw.cost);
  return {
    category: str(category) || null,
    provider: provider || null,
    product: product || null,
    apr,
    apy,
    fees,
    price,
    terms: str(raw.terms || raw.term || ''),
    url: str(raw.url || raw.link || ''),
    network: str(raw.network || '') || null,
    sponsored: raw.sponsored === true,
    commission: num(raw.commission), // carried but NEVER ranked on
    asOf: str(raw.asOf) || asOfDate(),
  };
}

/**
 * Compare products in a category → normalized [{ provider, product, apr, fees, terms, url, asOf, ... }].
 * Soft-fails to [] on an unknown category, an absent FINPROD_SOURCE_URL, a network failure, or an
 * unusable payload. Never throws.
 */
export async function compareProducts({ category } = {}, { fetch } = {}) {
  if (fetch) __setFetch(fetch);
  const cat = str(category);
  if (!isCategory(cat)) return [];
  const url = sourceUrl(cat);
  if (!url) return []; // no curated source configured → soft-fail, never invent rates
  const j = await getJson(url);
  const rows = j && Array.isArray(j.products) ? j.products : (Array.isArray(j) ? j : null);
  if (!rows) return [];
  return rows.map((r) => normalizeProduct(r, cat)).filter(Boolean);
}

// ── ranking — BY TRUE COST, never commission ─────────────────────────────────────────────────────────
// The honest cost signal for a product. LOWER is better for borrowing (credit cards, all loans, tax
// software price); for savings/CDs, HIGHER yield is better, so we negate APY into a cost so the same
// "ascending = best first" comparator holds. Fees are amortized in as a flat add to the rate-equivalent.
// Commission is DELIBERATELY ABSENT.
export function trueCost(product) {
  if (!product || typeof product !== 'object') return Infinity;
  const fee = num(product.fees) ?? 0;
  // savings / CDs: best = highest APY → cost = -(apy) + a small fee drag
  if (num(product.apy) != null && num(product.apr) == null) {
    return -(num(product.apy)) + fee / 1000;
  }
  // tax software with a price and no rate: cost = price + fee
  if (num(product.price) != null && num(product.apr) == null && num(product.apy) == null) {
    return (num(product.price) ?? 0) + fee;
  }
  // borrowing products: cost ≈ APR + amortized fee. A higher fee makes a same-APR card worse.
  const apr = num(product.apr);
  if (apr == null) return Infinity; // no usable cost signal → ranks last
  return apr + fee / 1000;
}

/**
 * Rank products honestly: organic rows ascending by trueCost (lower true cost first; for savings, higher
 * yield first), with commission IGNORED. Sponsored rows are SEGREGATED to the END, labeled, and ranked
 * only among themselves. Returns a NEW array; input is not mutated. Never throws.
 */
export function rankProducts(products = []) {
  const items = Array.isArray(products) ? products.slice() : [];
  const organic = items.filter((x) => !x?.sponsored);
  const sponsored = items.filter((x) => x?.sponsored);

  const byTrueCost = (arr) => arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const ca = trueCost(a[0]); const cb = trueCost(b[0]);
      if (ca !== cb) return ca - cb;        // honest signal only
      return a[1] - b[1];                   // stable on ties
    })
    .map(([v]) => v);

  return [
    ...byTrueCost(organic),
    ...byTrueCost(sponsored).map((s) => ({ ...s, sponsored: true, label: 'Sponsored' })),
  ];
}

// ── rate context — "is this competitive?" vs the FRED benchmark ──────────────────────────────────────
/**
 * Compare a category's products against its FRED benchmark rate. `fred` is an injected module/object
 * exposing latest(seriesId) → { value, date, ... } (e.g. import * as fred from './fred.mjs'); injecting
 * keeps this offline-testable. Returns:
 *   { category, benchmarkSeries, benchmark, asOf, verdict, note }
 * where verdict is 'competitive' | 'above-market' | 'below-market' | 'unknown'. Never throws.
 * Convention: for borrowing, a product APR at/under benchmark is good; for savings, an APY at/over the
 * benchmark is good.
 */
export async function rateContext(category, { fred, sampleRate } = {}) {
  const cat = str(category);
  const meta = CATEGORIES[cat];
  if (!meta) return { category: cat || null, benchmarkSeries: null, benchmark: null, asOf: asOfDate(), verdict: 'unknown', note: 'unknown category' };
  if (!meta.benchmark) return { category: cat, benchmarkSeries: null, benchmark: null, asOf: asOfDate(), verdict: 'unknown', note: 'no benchmark for this category' };

  let benchmark = null;
  let benchAsOf = null;
  try {
    if (fred && typeof fred.latest === 'function') {
      const rec = await fred.latest(meta.benchmark);
      if (rec && rec.value != null) { benchmark = num(rec.value); benchAsOf = str(rec.date) || null; }
    }
  } catch { benchmark = null; }

  const out = {
    category: cat,
    benchmarkSeries: meta.benchmark,
    benchmark,
    benchmarkAsOf: benchAsOf,
    asOf: asOfDate(),
    rateKind: meta.rateKind,
    verdict: 'unknown',
    note: '',
  };

  const sample = num(sampleRate);
  if (benchmark == null || sample == null) {
    out.note = benchmark == null ? 'benchmark unavailable' : 'no sample product rate to compare';
    return out;
  }

  // savings/CDs: higher than benchmark is GOOD; everything else (borrowing): lower is GOOD.
  const savings = meta.rateKind === 'apy';
  const better = savings ? sample > benchmark : sample < benchmark;
  const worse = savings ? sample < benchmark : sample > benchmark;
  const margin = Math.abs(sample - benchmark);
  if (margin <= 0.25) { out.verdict = 'competitive'; out.note = `within 0.25 pts of the ${meta.benchmark} benchmark (${benchmark}%)`; }
  else if (better) { out.verdict = savings ? 'above-market' : 'below-market'; out.note = `better than the ${meta.benchmark} benchmark (${benchmark}%) by ${margin.toFixed(2)} pts`; }
  else if (worse) { out.verdict = savings ? 'below-market' : 'above-market'; out.note = `worse than the ${meta.benchmark} benchmark (${benchmark}%) by ${margin.toFixed(2)} pts`; }
  return out;
}

// ── applyOut — affiliate-tagged outbound (plain url + not-configured when unset) ──────────────────────
/**
 * Build the outbound "apply / open account" link for a provider. Routes through affiliate.affiliateLink
 * (id by env NAME only). When the affiliate id is unset, returns the PLAIN url with configured:false and
 * reason 'not configured' — a missing tag never breaks the link, and we never fabricate an id. The
 * network can be passed explicitly; otherwise it is left to the affiliate engine to resolve.
 * Returns { url, network, configured, reason?, disclosure }.
 */
export function applyOut(provider, url, { network, subId } = {}) {
  const plainUrl = typeof url === 'string' ? url : '';
  const link = _affiliateLink({ network, url: plainUrl, subId: subId || str(provider) || undefined });
  return {
    provider: str(provider) || null,
    url: link.url || plainUrl,
    network: link.network ?? network ?? null,
    configured: link.configured === true,
    reason: link.configured ? undefined : (link.reason || 'not configured'),
    disclosure: link.disclosure || _ftcDisclosure(),
  };
}

// ── not-financial-advice banner ──────────────────────────────────────────────────────────────────────
export function notAdviceBanner() {
  return 'Not financial advice. Rates, fees, and terms change and depend on your credit and eligibility — '
    + 'always confirm the current offer on the provider\'s site before applying. We compare honestly by true '
    + 'cost (APR + fees / yield), never by what a provider pays us, and we never sell your data.';
}

// ── renderPage — escaped HTML comparison table + transparency + banner + disclosure ──────────────────
/**
 * Render an escaped HTML comparison page. `data` may be:
 *   { category, products:[...], context? }  — products are ranked here (honest order) before rendering.
 * EVERY interpolated value is escaped. Always includes the not-financial-advice banner and the FTC
 * disclosure. Sponsored rows are visibly labeled and appear after organic rows. Safe on empty input.
 */
export function renderPage(data = {}) {
  const cat = str(data.category);
  const meta = CATEGORIES[cat];
  const label = meta ? meta.label : (cat || 'Financial products');
  const ranked = rankProducts(Array.isArray(data.products) ? data.products : []);
  const ctx = data.context && typeof data.context === 'object' ? data.context : null;

  const rateCell = (p) => {
    if (num(p.apr) != null) return `${escapeHtml(p.apr)}% APR`;
    if (num(p.apy) != null) return `${escapeHtml(p.apy)}% APY`;
    if (num(p.price) != null) return `$${escapeHtml(p.price)}`;
    return 'n/a';
  };
  const feeCell = (p) => (num(p.fees) != null ? `$${escapeHtml(p.fees)}` : '—');

  const rows = ranked.map((p) => {
    const out = applyOut(p.provider, p.url, { network: p.network });
    const href = escapeHtml(out.url || '#');
    const sponsoredBadge = p.sponsored ? ' <span class="badge-sponsored" aria-label="sponsored">Sponsored</span>' : '';
    const cfg = out.configured ? '' : ' <span class="apply-unconfigured" title="affiliate id not configured"></span>';
    return `<tr${p.sponsored ? ' class="sponsored" data-sponsored="true"' : ''}>`
      + `<td>${escapeHtml(p.provider || '')}${sponsoredBadge}</td>`
      + `<td>${escapeHtml(p.product || '')}</td>`
      + `<td>${rateCell(p)}</td>`
      + `<td>${feeCell(p)}</td>`
      + `<td>${escapeHtml(p.terms || '')}</td>`
      + `<td><a href="${href}" rel="sponsored nofollow noopener" target="_blank">Apply</a>${cfg}</td>`
      + `<td>${escapeHtml(p.asOf || '')}</td>`
      + `</tr>`;
  }).join('');

  const ctxLine = ctx && ctx.benchmark != null
    ? `<p class="rate-context">Benchmark (${escapeHtml(ctx.benchmarkSeries)}): <strong>${escapeHtml(ctx.benchmark)}%</strong> — ${escapeHtml(ctx.note || '')}</p>`
    : '';

  return `<section class="finprod" data-category="${escapeHtml(cat)}">
  <h2>${escapeHtml(label)} — honest comparison</h2>
  <p class="not-advice-banner" role="note">${escapeHtml(notAdviceBanner())}</p>
  ${ctxLine}
  <table class="finprod-table">
    <thead><tr><th>Provider</th><th>Product</th><th>Rate</th><th>Fees</th><th>Terms</th><th></th><th>As of</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="transparency">Ranked by true cost (APR + fees${meta && meta.rateKind === 'apy' ? ' / yield' : ''}), not by commission. Sponsored rows are labeled and segregated.</p>
  <p class="ftc-disclosure">${escapeHtml(_ftcDisclosure())}</p>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// ── provenance note ──────────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Source: curated provider feed (FINPROD_SOURCE_URL) with rate context anchored to FRED `
    + `(Federal Reserve Bank of St. Louis), as of ${asOfDate()}. Rates, fees, and terms change frequently `
    + `and depend on eligibility — confirm the current offer on the provider's site. Ranked by true cost `
    + `(APR + fees / yield), never by commission. This is public reference, not financial advice.`;
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('financial-products.mjs')) {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg) {
    console.log('\nSoapBox — Financial products comparison');
    console.log('─'.repeat(60));
    console.log('Categories:');
    for (const [k, m] of Object.entries(CATEGORIES)) {
      console.log(`  ${k.padEnd(16)} ${m.label.padEnd(22)} [${m.rateKind}]  benchmark=${m.benchmark || '(none)'}  via ${m.mechanism}`);
    }
    console.log('\nGuardrails: rank-by-true-cost (never commission) | no data-selling | disclosure + not-advice banner always');
    console.log(`\n${dataNote()}`);
    console.log('\nUsage: node integrations/soapbox/financial-products.mjs <category>   (e.g. credit-cards)');
    console.log('  Set FINPROD_SOURCE_URL to a curated JSON feed for live data.');
  } else if (!isCategory(arg)) {
    console.log(`Unknown category "${arg}". Known: ${listCategories().join(', ')}`);
  } else {
    const products = await compareProducts({ category: arg }).catch(() => []);
    const ranked = rankProducts(products);
    console.log(`\n${CATEGORIES[arg].label} (${ranked.length} products, ranked by true cost)`);
    console.log('─'.repeat(60));
    if (ranked.length === 0) console.log('  No data (set FINPROD_SOURCE_URL for live data).');
    for (const p of ranked) {
      const rate = num(p.apr) != null ? `${p.apr}% APR` : num(p.apy) != null ? `${p.apy}% APY` : num(p.price) != null ? `$${p.price}` : 'n/a';
      console.log(`  ${String(p.provider || '').padEnd(20)} ${String(p.product || '').padEnd(24)} ${rate.padEnd(12)} fees:${p.fees ?? '—'}${p.sponsored ? '  [Sponsored]' : ''}`);
    }
    console.log(`\n${dataNote()}`);
  }
}
