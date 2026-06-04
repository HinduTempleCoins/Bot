// rx-prices.mjs — Prescription price aggregator for SoapBox (queue task #237, "GoodRx model").
// Compare cash/coupon prices for a drug across pharmacies, surface the cheapest + the savings, and point
// at the HONEST savings programs (manufacturer copay cards, patient-assistance, federal/state programs).
//
// HARD boundaries (this file is price-comparison + savings INFO, never clinical advice):
//   • Every render carries the NOT-MEDICAL-ADVICE banner — "consult a pharmacist/doctor" — by construction.
//   • Pharmacies are ranked by PRICE, lowest first. Never by commission, payout, or partner status.
//   • Affiliate/disclosure line is present on every render (we may earn nothing, but we disclose regardless).
//
// Same shape as macro.mjs / benefits-navigator.mjs: ESM, an injectable `fetch` seam for tests, soft-fail
// everywhere (every export returns a well-formed value and NEVER throws), HTML-escaped output, no secrets,
// and an "as-of" timestamp on every price row + render. Drug name/RxNorm normalization is REUSED from
// pharma.mjs via a defensive dynamic import — we do not duplicate the RxNorm/openFDA logic.
//
//   import { drugLookup, pharmacyPrices, bestPrice, couponInfo, renderPage, dataNote } from './rx-prices.mjs'
//   node integrations/soapbox/rx-prices.mjs "atorvastatin" 90210

// ── HTML escape — every interpolated value passes through this before reaching markup. ────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ── The standing disclaimers — present on EVERY rendered page, by construction. ───────────────────────
export const NOT_MEDICAL_ADVICE =
  'This is price-comparison and savings information, NOT medical advice. Prices change constantly and ' +
  'may differ at the counter. Never start, stop, switch, or skip a medication based on price — consult ' +
  'a licensed pharmacist or doctor first.';

export const DISCLOSURE =
  'Pharmacies are ranked by price, lowest first — never by any commission or partner relationship. ' +
  'Some savings-program links may be affiliate or referral links; we disclose this regardless of payout.';

const clean = (s) => String(s == null ? '' : s).trim();
const nowIso = () => new Date().toISOString();

// Injectable fetch seam (matches macro.mjs / pharma.mjs convention). Tests pass their own fetch.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── drugLookup({ name }) — normalize to RxNorm + forms/strengths, REUSING pharma.mjs. ────────────────
// Defensive dynamic import so a missing/broken pharma.mjs (or its network calls) soft-fails to null
// rather than throwing. We ask pharma for the RxNorm identity (via interactions→rxcui name resolution
// is internal; we use the openFDA label which carries openfda.rxcui + route/forms) and the compound id.
export async function drugLookup({ name } = {}, deps = {}) {
  const q = clean(name);
  if (!q) return null;
  try {
    const pharma = deps.pharma || await import('./pharma.mjs');
    const [label, comp] = await Promise.all([
      typeof pharma.drug === 'function' ? pharma.drug(q) : null,
      typeof pharma.compound === 'function' ? pharma.compound(q) : null,
    ]);
    const found = (label && label.found) || (comp && comp.found);
    if (!found) return null;
    const generic = (label?.genericNames || [])[0] || (comp?.found ? q : null) || q;
    const brand = (label?.brandNames || [])[0] || null;
    // RxCUI is the RxNorm identifier — the canonical normalization key for a drug.
    const rxcui = (label?.rxcui || [])[0] || null;
    // forms/strengths: openFDA label carries route; dosage section often lists strengths. We surface the
    // route as "forms" and parse common strength tokens (e.g. "10 mg", "500 mg") from the dosage text.
    const forms = (label?.route || []).map((r) => clean(r)).filter(Boolean);
    const strengths = parseStrengths(label?.sections?.dosage || '');
    return {
      query: q,
      name: brand || generic || q,
      generic,
      brand,
      rxcui,                                   // RxNorm normalization key (may be null)
      cid: comp?.cid ?? null,                  // PubChem compound id
      forms,                                   // routes/forms, e.g. ['ORAL']
      strengths,                               // e.g. ['10 mg', '20 mg']
      source: 'RxNorm / openFDA / PubChem via pharma.mjs',
      asOf: nowIso(),
    };
  } catch {
    return null; // soft-fail null on any import/network/parse error
  }
}

// Pull plausible strength tokens out of a free-text dosage section. Best-effort, de-duplicated, capped.
function parseStrengths(text) {
  const t = clean(text);
  if (!t) return [];
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s?(mg|mcg|g|ml|units?|%)\b/gi;
  let m;
  while ((m = re.exec(t)) && out.length < 12) {
    const tok = `${m[1]} ${m[2].toLowerCase()}`;
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

// ── pharmacyPrices({ drug, dosage, zip }, { fetch }) — normalized price rows; soft-fail []. ───────────
// There is no single keyless GoodRx-equivalent feed, so this is provider-agnostic: it calls whatever
// endpoint the injected fetch resolves (a real deployment wires a contracted price API here) and
// normalizes the response to a stable shape. With no network / a bad response it soft-fails to [].
export async function pharmacyPrices({ drug, dosage, zip } = {}, { fetch } = {}) {
  const d = clean(drug);
  if (!d) return [];
  const f = fetch || _fetch;
  const url = priceEndpoint({ drug: d, dosage: clean(dosage), zip: clean(zip) });
  try {
    const r = await f(url, { headers: { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (Array.isArray(j?.prices) ? j.prices : (Array.isArray(j?.results) ? j.results : null));
    if (!Array.isArray(rows)) return [];
    const asOf = nowIso();
    return rows
      .map((row) => normalizeRow(row, asOf))
      .filter((row) => row && row.pharmacy && Number.isFinite(row.price));
  } catch {
    return []; // soft-fail [] on any network/parse error
  }
}

// Build the (provider-agnostic) request URL. Kept in one place so a real price API is a one-line swap.
function priceEndpoint({ drug, dosage, zip }) {
  const qs = new URLSearchParams();
  qs.set('drug', drug);
  if (dosage) qs.set('dosage', dosage);
  if (zip) qs.set('zip', zip);
  return `https://prices.soapbox.community/v1/rx?${qs.toString()}`;
}

// Normalize one provider row into { pharmacy, price, withCoupon, asOf }. Tolerant of field-name variants.
function normalizeRow(row, asOf) {
  if (!row || typeof row !== 'object') return null;
  const pharmacy = clean(row.pharmacy ?? row.name ?? row.store ?? '');
  const rawPrice = row.price ?? row.cash_price ?? row.cost ?? row.amount;
  const price = typeof rawPrice === 'string' ? parseFloat(rawPrice.replace(/[^0-9.]/g, '')) : Number(rawPrice);
  const withCoupon = Boolean(row.withCoupon ?? row.with_coupon ?? row.coupon ?? false);
  if (!pharmacy || !Number.isFinite(price)) return null;
  return {
    pharmacy,
    price: Math.round(price * 100) / 100,
    withCoupon,
    asOf: clean(row.asOf) || asOf,
  };
}

// ── bestPrice(prices) — cheapest row + savings vs the highest. ────────────────────────────────────────
export function bestPrice(prices) {
  const rows = (Array.isArray(prices) ? prices : []).filter((r) => r && Number.isFinite(r.price));
  if (!rows.length) return null;
  // Rank by PRICE, lowest first — explicitly NOT by commission/partner status.
  const sorted = [...rows].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const savings = Math.round((highest.price - cheapest.price) * 100) / 100;
  const savingsPct = highest.price > 0 ? Math.round((savings / highest.price) * 100) : 0;
  return {
    cheapest,
    highest,
    savings,           // absolute dollars saved vs the most expensive option
    savingsPct,        // percent saved vs the most expensive option
    asOf: cheapest.asOf || nowIso(),
  };
}

// ── couponInfo(drug) — honest pointers to real savings programs (NO fabricated discounts). ───────────
// These are general, durable savings AVENUES, not drug-specific dollar claims. Disclosed on render.
export function couponInfo(drug) {
  const d = clean(drug);
  const programs = [
    {
      kind: 'manufacturer-copay',
      label: 'Manufacturer copay card / savings program',
      note: 'Many brand-name drugs have a manufacturer copay card (commercial insurance only, not Medicare/Medicaid). Search the official drug-brand website.',
      url: null,
    },
    {
      kind: 'patient-assistance',
      label: 'Patient Assistance Programs (PAPs)',
      note: 'Income-based free or low-cost medication from manufacturers.',
      url: 'https://www.needymeds.org/',
    },
    {
      kind: 'rx-assistance',
      label: 'RxAssist patient-assistance directory',
      note: 'Directory of manufacturer assistance programs.',
      url: 'https://www.rxassist.org/',
    },
    {
      kind: 'federal',
      label: 'Medicare Extra Help (Low-Income Subsidy)',
      note: 'Federal help with Part D prescription costs if you qualify.',
      url: 'https://www.ssa.gov/medicare/part-d-extra-help',
    },
    {
      kind: 'community',
      label: 'Community health centers (HRSA, sliding-scale)',
      note: 'Sliding-scale care and often 340B discount-program pricing.',
      url: 'https://findahealthcenter.hrsa.gov/',
    },
  ];
  return {
    drug: d || null,
    source: 'General patient savings programs (non-commercial, official directories)',
    disclosure: DISCLOSURE,
    programs,
    asOf: nowIso(),
  };
}

// ── dataNote() — provenance / as-of note shown alongside the data. ────────────────────────────────────
export function dataNote() {
  return 'Drug identity normalized via RxNorm / openFDA / PubChem (pharma.mjs). Pharmacy prices are ' +
    'estimates from the configured price source as of the time shown; the price at the counter may ' +
    'differ. Savings-program links are official directories. ' + DISCLOSURE;
}

// ── renderPage(data) — escaped HTML: price table + savings + NOT-MEDICAL-ADVICE banner + disclosure. ──
export function renderPage(data = {}) {
  const drug = data.drug || data.lookup || null;
  const drugName = clean(typeof drug === 'string' ? drug : (drug?.name || drug?.query || data.name)) || 'this medication';
  const prices = (Array.isArray(data.prices) ? data.prices : []).filter((r) => r && Number.isFinite(r.price));
  // Always render sorted by price (lowest first) — never by commission.
  const sorted = [...prices].sort((a, b) => a.price - b.price);
  const best = data.best || bestPrice(sorted);
  const coupons = data.coupons || couponInfo(drugName);
  const asOf = clean(data.asOf) || best?.asOf || nowIso();

  const rows = sorted.map((r) => `      <tr>
        <td class="pharmacy">${esc(r.pharmacy)}</td>
        <td class="price">$${esc((r.price).toFixed(2))}</td>
        <td class="coupon">${r.withCoupon ? 'with coupon' : 'cash'}</td>
        <td class="as-of">${esc(r.asOf || asOf)}</td>
      </tr>`).join('\n');

  const table = sorted.length
    ? `    <table class="rx-prices">
      <thead><tr><th>Pharmacy</th><th>Price</th><th>Type</th><th>As of</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>`
    : '    <p class="empty">No prices available right now. Ask your pharmacist for the cash price and any available coupon.</p>';

  const savings = best
    ? `    <p class="savings"><strong>Cheapest:</strong> ${esc(best.cheapest.pharmacy)} at $${esc(best.cheapest.price.toFixed(2))} ` +
      `&mdash; save up to $${esc(best.savings.toFixed(2))} (${esc(String(best.savingsPct))}%) vs. the most expensive option.</p>`
    : '';

  const couponItems = (coupons?.programs || []).map((p) => {
    const label = p.url
      ? `<a href="${esc(p.url)}" rel="nofollow noopener">${esc(p.label)}</a>`
      : esc(p.label);
    return `      <li><strong>${label}</strong> &mdash; ${esc(p.note)}</li>`;
  }).join('\n');
  const couponBlock = couponItems
    ? `    <h3>Savings programs</h3>
    <ul class="savings-programs">
${couponItems}
    </ul>`
    : '';

  return `<section class="rx-price-aggregator">
  <h2>Prescription price compare: ${esc(drugName)}</h2>
  <p class="as-of-line">Prices as of ${esc(asOf)}.</p>
${table}
${savings}
${couponBlock}
  <p class="data-note">${esc(dataNote())}</p>
  <p class="disclosure">${esc(DISCLOSURE)}</p>
  <p class="not-medical-advice"><strong>${esc(NOT_MEDICAL_ADVICE)}</strong></p>
</section>`;
}

// ── CLI: node integrations/soapbox/rx-prices.mjs <drug> [zip] [dosage] ────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('rx-prices.mjs')) {
  const [name, zip, dosage] = process.argv.slice(2);
  const drugQ = name || 'atorvastatin';
  const lookup = await drugLookup({ name: drugQ });
  const prices = await pharmacyPrices({ drug: drugQ, dosage, zip });
  const best = bestPrice(prices);
  console.log(`\n# Rx price compare: ${drugQ}\n`);
  console.log('Normalized:', lookup ? `${lookup.name} (RxCUI ${lookup.rxcui || 'n/a'}) forms=${lookup.forms.join('/') || 'n/a'}` : 'not found');
  if (!prices.length) console.log('Prices: none (no configured price source / offline)');
  for (const r of prices.slice().sort((a, b) => a.price - b.price)) {
    console.log(`  ${r.pharmacy.padEnd(20)} $${r.price.toFixed(2)} ${r.withCoupon ? '(coupon)' : '(cash)'}`);
  }
  if (best) console.log(`\nCheapest: ${best.cheapest.pharmacy} $${best.cheapest.price.toFixed(2)} — save up to $${best.savings.toFixed(2)} (${best.savingsPct}%)`);
  console.log(`\n${NOT_MEDICAL_ADVICE}`);
  console.log(DISCLOSURE);
}
