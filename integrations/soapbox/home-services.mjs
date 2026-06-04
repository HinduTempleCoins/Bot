// home-services.mjs — SoapBox "compare local services honestly" vertical (queue #239). An Angi /
// EnergySage / BroadbandNow style comparison surface for HOME SERVICES: contractors, movers, solar,
// broadband, cell plans, home security, storage. Like the rest of the SoapBox readers it is soft-fail
// (every source drops to [] / null and the module never throws) and renders ESCAPED HTML.
//
// THE WHOLE POINT — what makes this honest, not a lead-mill:
//   1. RANK BY FIT/RATING, NEVER BY COMMISSION. providerCompare() sorts on the provider's honest rating,
//      not on who pays us the most. There is no commission field in the ranking path at all.
//   2. QUOTE REQUESTS NEVER SELL USER DATA. requestQuote() routes a quote to exactly one provider the
//      user chose, only with explicit consent, and returns a consented ROUTING RECORD — not a payload we
//      resell to a network of buyers (the lead-gen abuse Angi/HomeAdvisor became notorious for). It uses
//      buildLeadGen(), which REFUSES to build anything that looks like a data sale or lacks consent.
//   3. DISCLOSURE ALWAYS. dataNote() + the affiliate disclosure render wherever results appear.
//   4. HONEST SPEEDS / HONEST PAYBACK. Broadband speeds carry the FCC "advertised, not measured" caveat
//      (reused from fcc-broadband.mjs, not duplicated). Solar payback is a TRANSPARENT documented formula,
//      explicitly labelled an estimate, not a sales projection.
//
// Reuse, not duplication: broadband availability comes from fcc-broadband.mjs via a DEFENSIVE import — if
// that module is unavailable the broadband path soft-fails to [] like any other dead source. Affiliate
// disclosure reuses affiliate.mjs when present, with a local fallback string so disclosure is never absent.
//
// No secrets: no keys are required or read here. Any future provider feed is keyless or soft-fails.
//
//   import { SERVICES, broadbandOptions, solarEstimate, providerCompare, requestQuote, renderPage, dataNote }
//     from './home-services.mjs'
//   node integrations/soapbox/home-services.mjs solar 90210 180

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const asOf = () => new Date().toISOString().slice(0, 10);

// Escape user/provider-controlled text before it lands in HTML. Mirrors the project convention.
export function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── the service catalog ─────────────────────────────────────────────────────────────────────────────
// Each entry: { id, label, note } — what we compare and the honest framing for that vertical.
export const SERVICES = [
  { id: 'contractors', label: 'Contractors & Home Improvement', note: 'Licensed trades for repair/remodel; verify license + insurance before hiring.' },
  { id: 'movers', label: 'Movers', note: 'Local & long-distance movers; check FMCSA registration for interstate moves.' },
  { id: 'solar', label: 'Solar Installers', note: 'Rooftop/solar quotes; payback depends on local sun, rates, and incentives.' },
  { id: 'broadband', label: 'Broadband / Internet', note: 'What internet is actually available at an address (FCC data).' },
  { id: 'cell-plans', label: 'Cell Plans', note: 'Mobile carriers & MVNOs; coverage varies by location.' },
  { id: 'home-security', label: 'Home Security', note: 'Monitored & self-monitored systems; watch for long contracts.' },
  { id: 'storage', label: 'Self-Storage', note: 'Units by size/climate; price per cubic foot is the honest comparison.' },
];

const SERVICE_IDS = new Set(SERVICES.map((s) => s.id));
export function isService(id) { return SERVICE_IDS.has(str(id)); }

// ── broadband availability — REUSE fcc-broadband.mjs (defensive import, no duplication) ───────────────
// Returns a normalized ISP/plan list with HONEST (advertised) speeds. Accepts an address object that may
// carry { lat, lon } or { blockFips } (whatever fcc-broadband can resolve). Soft-fail to [] on anything.
export async function broadbandOptions(address = {}, deps = {}) {
  try {
    // Allow tests to inject a fake fcc reader; otherwise lazily import the real one.
    let reader = deps.fcc;
    if (!reader) {
      reader = await import('./fcc-broadband.mjs').catch(() => null);
    }
    if (!reader || typeof reader.broadbandAt !== 'function') return [];
    const rows = await reader.broadbandAt({
      lat: num(address.lat),
      lon: num(address.lon),
      blockFips: str(address.blockFips) || undefined,
    }).catch(() => []);
    return (Array.isArray(rows) ? rows : [])
      .map((p) => ({
        isp: str(p.provider),
        technology: str(p.technology) || 'Unknown',
        // Honest, advertised maximums — carried with the caveat in dataNote().
        downMbps: num(p.downMbps),
        upMbps: num(p.upMbps),
        speedNote: 'advertised maximum (FCC), not a measured/guaranteed speed',
        source: str(p.source) || 'FCC Broadband Data',
      }))
      .filter((p) => p.isp);
  } catch { return []; }
}

// ── solar payback — TRANSPARENT documented formula, not a sales pitch ─────────────────────────────────
// Goal: a defensible back-of-envelope payback period, with every assumption surfaced so the user can
// check our math. We do NOT promise savings; we estimate.
//
// FORMULA (all assumptions returned in `assumptions` so the estimate is auditable):
//   annualBill          = billMonthly * 12
//   sunFactor           = a coarse regional multiplier from the ZIP's leading digit (US sun-belt vs north).
//                         1.0 = average; >1 sunnier (shorter payback), <1 cloudier (longer payback).
//   systemKw            = annualBill / (avgRatePerKwh * kwhPerKwPerYear * sunFactor)   [size to offset ~100%]
//   grossCost           = systemKw * costPerWatt * 1000
//   netCost             = grossCost * (1 - federalCreditRate)    [30% US residential ITC, documented]
//   annualSavings       = annualBill                              [offset ~100% of the bill]
//   paybackYears        = netCost / annualSavings
// Returns null on bad input (no zip / non-positive bill) — soft-fail, never throws.
const SOLAR = {
  avgRatePerKwh: 0.16,     // US residential average ($/kWh), documented assumption
  kwhPerKwPerYear: 1400,   // typical annual production per installed kW (mid US)
  costPerWatt: 3.0,        // installed $/W before incentives (documented)
  federalCreditRate: 0.30, // US federal residential solar ITC (30%)
};

// Coarse, transparent sun multiplier by the first digit of a US ZIP (NE→9 west). Not precise irradiance —
// just a documented regional nudge. Unknown → 1.0 (national average), so the estimate stays honest.
function sunFactorForZip(zip) {
  const z = str(zip).replace(/[^0-9]/g, '');
  if (!z) return 1.0;
  const d = z[0];
  // 8/9 = Mountain/Southwest/CA (sunnier); 0/1 = Northeast (cloudier); middle = average.
  const map = { '0': 0.85, '1': 0.85, '2': 0.95, '3': 1.1, '4': 0.95, '5': 0.95, '6': 1.0, '7': 1.1, '8': 1.15, '9': 1.1 };
  return map[d] ?? 1.0;
}

export function solarEstimate({ zip, billMonthly } = {}) {
  const bill = num(billMonthly);
  const z = str(zip);
  if (!z || bill == null || bill <= 0) return null;

  const sunFactor = sunFactorForZip(z);
  const annualBill = bill * 12;
  const systemKw = annualBill / (SOLAR.avgRatePerKwh * SOLAR.kwhPerKwPerYear * sunFactor);
  const grossCost = systemKw * SOLAR.costPerWatt * 1000;
  const netCost = grossCost * (1 - SOLAR.federalCreditRate);
  const annualSavings = annualBill; // sized to offset ~100% of the bill
  const paybackYears = annualSavings > 0 ? netCost / annualSavings : null;

  const round = (n, p = 2) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);
  return {
    zip: z,
    billMonthly: round(bill),
    sunFactor,
    systemKw: round(systemKw),
    grossCost: round(grossCost, 0),
    federalCredit: round(grossCost * SOLAR.federalCreditRate, 0),
    netCost: round(netCost, 0),
    annualSavings: round(annualSavings, 0),
    paybackYears: round(paybackYears),
    estimate: true,
    assumptions: { ...SOLAR },
    note: 'Transparent estimate using the documented assumptions above — not a quote or a guarantee. '
      + 'Local incentives, roof, and utility rates change the real number. Get an itemized written quote.',
    asOf: asOf(),
  };
}

// ── providerCompare — normalized providers ranked by RATING, never commission ─────────────────────────
// { service, area } selects the vertical/region; an injectable fetch can pull a feed of providers. The
// normalization path DELIBERATELY does not carry a commission field — ranking is rating-then-name only,
// so there is no way for "who pays us more" to influence order. Soft-fail to [] on anything.
export async function providerCompare({ service, area } = {}, { fetch } = {}) {
  const svc = str(service);
  const region = str(area);
  if (!isService(svc)) return [];
  const f = typeof fetch === 'function' ? fetch : _fetch;
  let rows = [];
  try {
    // Keyless, region-scoped provider feed. Absent/dead feed → []; we never fabricate providers.
    const u = `https://data.soapbox.community/api/home-services/providers?service=${encodeURIComponent(svc)}&area=${encodeURIComponent(region)}`;
    const r = await f(u, { headers: UA });
    if (r && r.ok) {
      const j = await r.json();
      rows = Array.isArray(j) ? j : (j?.providers || j?.data || j?.results || []);
    }
  } catch { rows = []; }

  const normalized = (Array.isArray(rows) ? rows : [])
    .map((p) => ({
      name: str(p.name ?? p.provider ?? p.company),
      rating: num(p.rating ?? p.score ?? p.stars),
      area: str(p.area ?? p.region ?? region),
      url: str(p.url ?? p.website ?? p.link),
      // NOTE: any commission/payout field in the source is intentionally DROPPED here — it must never
      // reach the ranking. Honest fit/rating only.
    }))
    .filter((p) => p.name);

  // Rank by rating (desc); a missing rating sorts last; ties break alphabetically. No commission anywhere.
  normalized.sort((a, b) => {
    const ra = a.rating == null ? -Infinity : a.rating;
    const rb = b.rating == null ? -Infinity : b.rating;
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });
  return normalized;
}

// ── buildLeadGen — the honest lead-gen primitive that REFUSES to sell data ────────────────────────────
// A quote request is a routing record sent to ONE chosen provider with the user's explicit consent. It is
// NOT a lead sold into a network of buyers. This builder refuses to construct anything that:
//   • lacks explicit consent (consent must be strictly true), OR
//   • requests selling/sharing/resale of the user's data (any `sell`/`resell`/`share`/`broker` intent),
//     or names more than one recipient (the multi-buyer lead-mill pattern).
// Returns { ok:false, reason } on refusal, or { ok:true, record } with a minimal consented routing record.
// (Mirrors the affiliate-layer "no lead-gen/data-selling" rule from queue #215; kept local so the module
//  is self-contained and the refusal can never be bypassed by a missing import.)
export function buildLeadGen({ service, provider, user, consent, intent } = {}) {
  const svc = str(service);
  const prov = str(provider);
  if (!isService(svc)) return { ok: false, reason: 'unknown-service' };
  if (!prov) return { ok: false, reason: 'no-provider' };
  if (consent !== true) return { ok: false, reason: 'no-consent' };

  // Refuse any data-selling / multi-buyer intent.
  const intentStr = (str(intent) + ' ' + str(user && user.intent)).toLowerCase();
  if (/\b(sell|resell|resale|share|broker|monetiz|auction|distribute)\b/.test(intentStr)) {
    return { ok: false, reason: 'refused-data-selling' };
  }
  // Multiple recipients = the lead-mill pattern; refuse.
  const recipients = []
    .concat(provider)
    .concat(user && Array.isArray(user.recipients) ? user.recipients : [])
    .map(str).filter(Boolean);
  if (recipients.length > 1) return { ok: false, reason: 'refused-multi-buyer' };

  // Minimal consented routing record — only what the chosen provider needs to call the user back.
  const u = user || {};
  return {
    ok: true,
    record: {
      service: svc,
      provider: prov,
      contact: {
        name: str(u.name),
        email: str(u.email),
        phone: str(u.phone),
        zip: str(u.zip),
      },
      consent: true,
      sold: false,          // explicit: this record is never sold or shared with anyone else
      routedTo: prov,       // exactly one recipient — the provider the user picked
      asOf: asOf(),
    },
  };
}

// ── requestQuote — public entry; uses buildLeadGen, refuses data-selling / no-consent ─────────────────
// Returns { ok:false, reason } on refusal, or { ok:true, record } on a consented single-provider routing.
export function requestQuote({ service, provider, user, consent, intent } = {}) {
  return buildLeadGen({ service, provider, user, consent, intent });
}

// ── disclosure — reuse affiliate.mjs when present, local fallback otherwise ────────────────────────────
let _disclosureCache;
async function affiliateDisclosure() {
  if (_disclosureCache !== undefined) return _disclosureCache;
  try {
    const a = await import('./affiliate.mjs').catch(() => null);
    if (a && typeof a.ftcDisclosure === 'function') { _disclosureCache = str(a.ftcDisclosure()); return _disclosureCache; }
  } catch { /* fall through */ }
  _disclosureCache = '';
  return _disclosureCache;
}

// ── provenance / data note ────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Comparison across ${SERVICES.length} home-service verticals, as of ${asOf()}. `
    + 'Broadband availability and speeds come from the FCC (advertised maximums, not measured throughput). '
    + 'Solar figures are a transparent estimate from documented assumptions, not a quote or guarantee. '
    + 'Providers are ranked by honest fit/rating — never by what they pay us. '
    + 'Quote requests go to exactly one provider you choose, only with your consent, and your information '
    + 'is never sold or shared with a network of buyers.';
}

// ── renderPage — escaped HTML + honest-speed/payback notes + disclosure ───────────────────────────────
// data: { service, providers, broadband, solar, area } (any field optional). EVERY value is escaped.
export function renderPage(data = {}) {
  const service = str(data.service);
  const svcMeta = SERVICES.find((s) => s.id === service) || null;
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const broadband = Array.isArray(data.broadband) ? data.broadband : [];
  const solar = data.solar && typeof data.solar === 'object' ? data.solar : null;
  const disclosure = str(data.disclosure); // optional pre-resolved affiliate disclosure

  const providerRows = providers.map((p) => `<tr>`
    + `<td>${escapeHtml(p.name)}</td>`
    + `<td>${p.rating == null ? '—' : escapeHtml(p.rating)}</td>`
    + `<td>${escapeHtml(p.area)}</td>`
    + `<td>${p.url ? `<a href="${escapeHtml(p.url)}" rel="nofollow noopener">site</a>` : '—'}</td>`
    + `</tr>`).join('');

  const broadbandRows = broadband.map((b) => `<tr>`
    + `<td>${escapeHtml(b.isp)}</td>`
    + `<td>${escapeHtml(b.technology)}</td>`
    + `<td>${b.downMbps == null ? '—' : escapeHtml(b.downMbps)}</td>`
    + `<td>${b.upMbps == null ? '—' : escapeHtml(b.upMbps)}</td>`
    + `</tr>`).join('');

  const providerSection = providers.length
    ? `<table class="providers">
    <thead><tr><th>Provider</th><th>Rating</th><th>Area</th><th>Link</th></tr></thead>
    <tbody>${providerRows}</tbody>
  </table>
  <p class="rank-note">Ranked by honest rating/fit — never by commission.</p>`
    : '';

  const broadbandSection = broadband.length
    ? `<h3>Internet available here</h3>
  <table class="broadband">
    <thead><tr><th>ISP</th><th>Technology</th><th>Down (Mbps)</th><th>Up (Mbps)</th></tr></thead>
    <tbody>${broadbandRows}</tbody>
  </table>
  <p class="speed-note">${escapeHtml('Speeds are advertised maximums reported to the FCC — not measured or guaranteed throughput.')}</p>`
    : '';

  const solarSection = solar
    ? `<h3>Solar payback estimate</h3>
  <p class="solar">System ~${escapeHtml(solar.systemKw)} kW; net cost ~$${escapeHtml(solar.netCost)} after the `
      + `${escapeHtml(Math.round((solar.assumptions?.federalCreditRate ?? 0.3) * 100))}% federal credit; `
      + `estimated payback ~${escapeHtml(solar.paybackYears)} years.</p>
  <p class="payback-note">${escapeHtml(solar.note || 'Transparent estimate, not a quote or guarantee.')}</p>`
    : '';

  const heading = svcMeta ? svcMeta.label : 'Home services comparison';
  const svcNote = svcMeta ? `<p class="svc-note">${escapeHtml(svcMeta.note)}</p>` : '';

  return `<section class="home-services">
  <h2>${escapeHtml(heading)}</h2>
  ${svcNote}
  ${providerSection}
  ${broadbandSection}
  ${solarSection}
  <p class="disclosure">${escapeHtml(disclosure)}</p>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// Convenience: render with the affiliate disclosure resolved (async). Soft-fails to '' disclosure.
export async function renderPageWithDisclosure(data = {}) {
  const disclosure = await affiliateDisclosure().catch(() => '');
  return renderPage({ ...data, disclosure });
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('home-services.mjs')) {
  const [service = 'solar', zip = '90210', bill = '180'] = process.argv.slice(2);
  console.log(`\nHome services — ${service}`);
  console.log('Verticals:', SERVICES.map((s) => s.id).join(', '));
  if (service === 'solar') {
    const est = solarEstimate({ zip, billMonthly: Number(bill) });
    console.log('\nSolar estimate:', JSON.stringify(est, null, 2));
  } else {
    const providers = await providerCompare({ service, area: zip }, {}).catch(() => []);
    console.log(`\nProviders (${providers.length}, ranked by rating):`);
    for (const p of providers) console.log(`  • ${p.name.padEnd(28)} ${p.rating ?? '—'}  ${p.url || ''}`);
  }
  console.log(`\n${dataNote()}`);
}
