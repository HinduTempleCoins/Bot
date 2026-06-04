// insurance.mjs — the SoapBox INSURANCE comparison aggregator (the Policygenius / NerdWallet / The Zebra
// model, done HONESTLY). Compares carriers across LINES — auto, home/renters, health, life, pet, travel —
// by observable facts (financial-strength rating, coverage type, official links), never by commission.
//
// We are NOT a licensed broker and we do NOT sell user data. Real bindable quotes need a licensed
// partner / affiliate quote API per state and line; this module is STRUCTURED for those (injectable
// partner-quote functions, env-named affiliate ids) but SOFT-FAILS to "compare official sources" when no
// partner is configured — it never invents a premium and never collects PII to broker. Earnings are
// disclosed AFFILIATE / REFERRAL only (reuse integrations/affiliate.mjs); the consented, non-data-selling
// lead handoff is the ONLY lead path, and it THROWS on any data-selling request.
//
// THE MOAT (mirrors financial-products.mjs / affiliate.mjs §3-4), three hard guardrails:
//   (a) ranking is by HONEST SIGNAL (financial-strength rating + coverage breadth + a Clarity-style
//       transparency score), NEVER by commission. Sponsored rows are segregated to the end and labeled.
//   (b) NO data-selling / NO unlicensed lead-broking. The "get a quote" path routes through
//       affiliate.buildLeadGen, which REFUSES any data-selling request and requires explicit consent.
//   (c) every outbound link carries an FTC disclosure, and every page carries a "not insurance advice /
//       not a licensed broker" banner.
//
// READER discipline (like financial-products.mjs / fred.mjs): injectable fetch, every getter soft-fails
// (returns [] / null, never throws), a dead source just drops out, every value is escaped before HTML.
//
//   import { LINES, CARRIERS, classifyLine, listCarriers, compareCarriers, getQuotes, rankCarriers,
//            clarityForCarrier, applyOut, buildLeadGen, renderPage, dataNote } from './insurance.mjs'
//   node integrations/soapbox/insurance.mjs auto
//
// The affiliate engine is imported DEFENSIVELY: if it can't load we fall back to safe local shims (plain
// url + a no-op data-selling refusal) so the module still soft-fails rather than crashing.

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
// guard) — we are not an unlicensed lead-broker. Uses affiliate.buildLeadGen when present; otherwise
// enforces the same refusal locally.
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
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const asOfDate = () => new Date().toISOString().slice(0, 10);

// Escape any text before it lands in HTML. Mirrors the project convention (financial-products.mjs).
export function esc(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export { esc as escapeHtml };

// ── LINES — the insurance lines we compare ────────────────────────────────────────────────────────────
// Each: a friendly label, the honest monetization mechanism, the regulator-of-record link for "compare
// official sources" when no partner quote API is configured, and a note. Affiliate-network ids are read
// from env by NAME inside affiliate.mjs; lines that legally route through a licensed agent connection use
// the consented (non-data-selling) lead-gen path.
export const LINES = {
  auto:    { label: 'Auto insurance',           mechanism: 'affiliate', official: 'https://content.naic.org/consumer.htm',                       note: 'Compare coverage (liability/collision/comp) + carrier financial strength. The Zebra model.' },
  home:    { label: 'Home & renters insurance', mechanism: 'affiliate', official: 'https://content.naic.org/consumer.htm',                       note: 'Compare dwelling/liability limits + deductibles + carrier strength.' },
  health:  { label: 'Health insurance',         mechanism: 'leadgen',   official: 'https://www.healthcare.gov/',                                  note: 'Marketplace plans — check HealthCare.gov / your state exchange first. Consented agent connection only.' },
  life:    { label: 'Life insurance',           mechanism: 'affiliate', official: 'https://content.naic.org/consumer.htm',                       note: 'Term vs whole; compare carrier strength + payout history. Policygenius model.' },
  pet:     { label: 'Pet insurance',            mechanism: 'affiliate', official: 'https://www.naphia.org/',                                      note: 'Compare reimbursement %, annual limit, waiting periods, exclusions.' },
  travel:  { label: 'Travel insurance',         mechanism: 'affiliate', official: 'https://www.travelinsurance.com/', note: 'Compare trip-cancellation + medical + evacuation coverage per trip.' },
};

export function isLine(line) { return Object.prototype.hasOwnProperty.call(LINES, str(line)); }
export function listLines() { return Object.keys(LINES); }

// Classify a free-text query / synonym into a known line key, or null. Keeps the surface forgiving
// ("car" → auto, "renters" → home, "medical" → health) without inventing lines.
export function classifyLine(input) {
  const q = str(input).toLowerCase();
  if (!q) return null;
  if (isLine(q)) return q;
  const map = [
    [/\b(auto|car|vehicle|motor|driver)\b/, 'auto'],
    [/\b(home|homeowner|renter|renters|property|dwelling|condo)\b/, 'home'],
    [/\b(health|medical|aca|marketplace|obamacare|dental|vision)\b/, 'health'],
    [/\b(life|term|whole life|funeral)\b/, 'life'],
    [/\b(pet|dog|cat|veterinary|vet)\b/, 'pet'],
    [/\b(travel|trip|cancellation|evacuation)\b/, 'travel'],
  ];
  for (const [re, key] of map) if (re.test(q)) return key;
  return null;
}

// ── CARRIER REGISTRY — facts + official links, never premiums ────────────────────────────────────────
// A curated, FACTS-ONLY registry: the carrier's name, the lines it writes, its official site, and its
// published financial-strength rating (AM Best, the industry standard). We carry the RATING (an
// observable, third-party fact) but NEVER a premium — premiums are state/profile-specific and come only
// from a configured, licensed partner quote API. `affiliateNetwork` names the network whose env-id
// affiliate.mjs would apply (the id itself is NEVER stored here).
//
// amBest grades map to a numeric strength used for honest ranking (A++ best). This is a transparency
// signal, not a recommendation — a low rating means "less financially proven", never "a scam".
export const CARRIERS = [
  { id: 'state-farm',  name: 'State Farm',          lines: ['auto', 'home', 'life'],            url: 'https://www.statefarm.com/',          amBest: 'A++', affiliateNetwork: null },
  { id: 'geico',       name: 'GEICO',               lines: ['auto'],                            url: 'https://www.geico.com/',              amBest: 'A++', affiliateNetwork: 'cj' },
  { id: 'progressive', name: 'Progressive',         lines: ['auto', 'home'],                    url: 'https://www.progressive.com/',        amBest: 'A+',  affiliateNetwork: 'cj' },
  { id: 'allstate',    name: 'Allstate',            lines: ['auto', 'home', 'life'],            url: 'https://www.allstate.com/',           amBest: 'A+',  affiliateNetwork: 'cj' },
  { id: 'usaa',        name: 'USAA',                lines: ['auto', 'home', 'life'],            url: 'https://www.usaa.com/',               amBest: 'A++', affiliateNetwork: null },
  { id: 'lemonade',    name: 'Lemonade',            lines: ['home', 'pet', 'life'],             url: 'https://www.lemonade.com/',           amBest: 'A',   affiliateNetwork: 'impact' },
  { id: 'nationwide',  name: 'Nationwide',          lines: ['auto', 'home', 'life', 'pet'],     url: 'https://www.nationwide.com/',         amBest: 'A+',  affiliateNetwork: null },
  { id: 'metlife',     name: 'MetLife',             lines: ['life', 'health'],                  url: 'https://www.metlife.com/',            amBest: 'A+',  affiliateNetwork: null },
  { id: 'cigna',       name: 'Cigna',               lines: ['health'],                          url: 'https://www.cigna.com/',              amBest: 'A',   affiliateNetwork: null },
  { id: 'aetna',       name: 'Aetna',               lines: ['health'],                          url: 'https://www.aetna.com/',              amBest: 'A',   affiliateNetwork: null },
  { id: 'healthypaws', name: 'Healthy Paws',        lines: ['pet'],                             url: 'https://www.healthypawspetinsurance.com/', amBest: 'A+', affiliateNetwork: 'impact' },
  { id: 'allianz',     name: 'Allianz Travel',      lines: ['travel'],                          url: 'https://www.allianztravelinsurance.com/', amBest: 'A+', affiliateNetwork: 'cj' },
  { id: 'worldnomads', name: 'World Nomads',        lines: ['travel'],                          url: 'https://www.worldnomads.com/',        amBest: 'A',   affiliateNetwork: 'cj' },
];

// AM Best grade → numeric strength (higher is stronger). Unknown/blank → null (ranks low, never as scam).
const AMBEST_RANK = { 'A++': 100, 'A+': 90, A: 80, 'A-': 75, 'B++': 65, 'B+': 60, B: 50, 'B-': 45, 'C++': 35, 'C+': 30, C: 25, 'C-': 20, D: 10 };
export function amBestStrength(grade) {
  const g = str(grade).toUpperCase();
  return Object.prototype.hasOwnProperty.call(AMBEST_RANK, g) ? AMBEST_RANK[g] : null;
}

// All carriers writing a given line (facts only — no premiums). Soft-fails to [] for an unknown line.
export function listCarriers(line) {
  const key = str(line).toLowerCase();
  if (!isLine(key)) return [];
  return CARRIERS.filter((c) => Array.isArray(c.lines) && c.lines.includes(key))
    .map((c) => ({ ...c, line: key, amBestStrength: amBestStrength(c.amBest), official: LINES[key].official }));
}

// ── quote aggregation via injectable partner APIs ─────────────────────────────────────────────────────
// There is NO free, keyless "all carriers, live bindable premium" feed — real quoting is licensed and
// per-state. So getQuotes is PARTNER-injectable: a deployment passes `partners` (an array of async
// functions, or { name, quote } objects) that each call a licensed partner/affiliate quote API and return
// rows. When none are configured, getQuotes SOFT-FAILS to [] and callers fall back to "compare official
// sources" (the carrier registry + regulator links). We never invent a premium and never collect PII to
// broker it ourselves.
//
//   partner(profile) -> [{ carrier, line, premium, term, url, ... }]  (premium is a number or null)
//
// `profile` is intentionally minimal (line + coarse, non-identifying fields the partner needs). This
// module does not persist it; the central no-data-selling guard is enforced at the lead-handoff (above).
function normalizeQuote(raw, line) {
  if (!raw || typeof raw !== 'object') return null;
  const carrier = str(raw.carrier || raw.name || raw.provider);
  if (!carrier) return null;
  return {
    carrier,
    carrierId: str(raw.carrierId || raw.id) || null,
    line: str(raw.line || line) || null,
    premium: num(raw.premium ?? raw.price ?? raw.monthly ?? raw.annual),
    period: str(raw.period || (raw.monthly != null ? 'month' : raw.annual != null ? 'year' : '')) || null,
    coverage: str(raw.coverage || raw.plan || ''),
    url: str(raw.url || raw.link || ''),
    network: str(raw.network || '') || null,
    sponsored: raw.sponsored === true,
    commission: num(raw.commission), // carried but NEVER ranked on
    asOf: str(raw.asOf) || asOfDate(),
  };
}

/**
 * Aggregate quotes for a line from injected licensed partner APIs. Each partner is either an async
 * function (profile) -> rows, or an object { name?, quote: async fn }. Every partner is wrapped so one
 * failing partner just drops out (soft-fail). Returns normalized [{ carrier, line, premium, ... }].
 * With NO partners configured, returns [] — the caller shows the carrier registry + official sources.
 * Never throws.
 */
export async function getQuotes({ line, profile = {} } = {}, { partners } = {}) {
  const key = str(line).toLowerCase();
  if (!isLine(key)) return [];
  const list = Array.isArray(partners) ? partners : [];
  if (list.length === 0) return []; // no licensed partner → soft-fail to "compare official sources"
  const calls = list.map(async (p) => {
    const fn = typeof p === 'function' ? p : (p && typeof p.quote === 'function' ? p.quote : null);
    if (!fn) return [];
    try {
      const rows = await fn({ ...profile, line: key });
      return Array.isArray(rows) ? rows : (rows && Array.isArray(rows.quotes) ? rows.quotes : []);
    } catch { return []; }
  });
  const settled = await Promise.all(calls);
  return settled.flat().map((r) => normalizeQuote(r, key)).filter(Boolean);
}

// ── Clarity-style transparency score ─────────────────────────────────────────────────────────────────
/**
 * A transparency score (0–100) for a carrier on a line, from OBSERVABLE FACTS only — financial strength
 * (AM Best), whether it publishes an official site, and how many lines it openly writes. Mirrors the
 * Clarity engine's discipline: a LOW score means "less transparent/proven", NEVER "a scam". Pure.
 *   -> { value, band, inputs:{ strength, disclosure, breadth }, notes:{...} }
 */
export function clarityForCarrier(carrier) {
  const strength = amBestStrength(carrier?.amBest);
  const inputs = { strength: 0, disclosure: 0, breadth: 0 };
  const notes = {};
  if (strength != null) { inputs.strength = strength; notes.strength = `AM Best ${str(carrier.amBest)}`; }
  else notes.strength = 'no published financial-strength rating';
  if (carrier?.url) { inputs.disclosure = 100; notes.disclosure = 'official site published'; }
  else notes.disclosure = 'no official site on file';
  const nLines = Array.isArray(carrier?.lines) ? carrier.lines.length : 0;
  inputs.breadth = Math.min(100, nLines * 25);
  notes.breadth = `${nLines} line(s) written`;
  const value = Math.round(inputs.strength * 0.6 + inputs.disclosure * 0.25 + inputs.breadth * 0.15);
  const band = value >= 80 ? 'high' : value >= 55 ? 'moderate' : value >= 30 ? 'limited' : 'opaque';
  return { value, band, inputs, notes, method: 'observable-facts-v1' };
}

// ── compare — carrier registry first, quotes layered on when partners exist ──────────────────────────
/**
 * Compare a line: returns the carrier registry rows (facts + Clarity + official link), each augmented
 * with the cheapest matching quote IF partner quotes were supplied. Soft-fails to [] on an unknown line.
 * Never throws. `quotes` is the (optional) output of getQuotes — facts-only when omitted.
 */
export async function compareCarriers({ line } = {}, { quotes } = {}) {
  const key = str(line).toLowerCase();
  if (!isLine(key)) return [];
  const carriers = listCarriers(key);
  const q = Array.isArray(quotes) ? quotes.filter((x) => str(x.line).toLowerCase() === key) : [];
  return carriers.map((c) => {
    const matches = q.filter((x) => str(x.carrier).toLowerCase() === c.name.toLowerCase()
      || (x.carrierId && x.carrierId === c.id));
    const cheapest = matches
      .filter((m) => num(m.premium) != null)
      .sort((a, b) => num(a.premium) - num(b.premium))[0] || null;
    return {
      ...c,
      clarity: clarityForCarrier(c),
      premium: cheapest ? cheapest.premium : null,
      period: cheapest ? cheapest.period : null,
      coverage: cheapest ? cheapest.coverage : null,
      sponsored: cheapest ? cheapest.sponsored === true : false,
      commission: cheapest ? cheapest.commission : null, // carried but NEVER ranked on
      quoteUrl: cheapest ? cheapest.url : null,
      asOf: asOfDate(),
    };
  });
}

// ── ranking — BY HONEST SIGNAL, never commission ─────────────────────────────────────────────────────
/**
 * Rank carriers honestly: organic rows by Clarity value DESC, then financial strength DESC, then (when a
 * quote exists) cheaper premium first; commission is DELIBERATELY IGNORED. Sponsored rows are SEGREGATED
 * to the END, labeled, ranked only among themselves. Returns a NEW array; input not mutated. Never throws.
 */
export function rankCarriers(rows = []) {
  const items = Array.isArray(rows) ? rows.slice() : [];
  const organic = items.filter((x) => !x?.sponsored);
  const sponsored = items.filter((x) => x?.sponsored);

  const honest = (arr) => arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const ca = a[0]?.clarity?.value ?? 0; const cb = b[0]?.clarity?.value ?? 0;
      if (cb !== ca) return cb - ca;                       // higher Clarity first
      const sa = a[0]?.amBestStrength ?? 0; const sb = b[0]?.amBestStrength ?? 0;
      if (sb !== sa) return sb - sa;                       // stronger carrier first
      const pa = num(a[0]?.premium); const pb = num(b[0]?.premium);
      if (pa != null && pb != null && pa !== pb) return pa - pb; // cheaper quote first
      if (pa != null && pb == null) return -1;
      if (pa == null && pb != null) return 1;
      return a[1] - b[1];                                  // stable on ties
    })
    .map(([v]) => v);

  return [
    ...honest(organic),
    ...honest(sponsored).map((s) => ({ ...s, sponsored: true, label: 'Sponsored' })),
  ];
}

// ── applyOut — affiliate-tagged outbound (plain url + not-configured when unset) ──────────────────────
/**
 * Build the outbound "get a quote / visit carrier" link. Routes through affiliate.affiliateLink (id by
 * env NAME only). When the affiliate id is unset, returns the PLAIN url with configured:false and reason
 * 'not configured' — a missing tag never breaks the link, and we never fabricate an id.
 * Returns { carrier, url, network, configured, reason?, disclosure }.
 */
export function applyOut(carrier, url, { network, subId } = {}) {
  const plainUrl = typeof url === 'string' ? url : '';
  const link = _affiliateLink({ network, url: plainUrl, subId: subId || str(carrier) || undefined });
  return {
    carrier: str(carrier) || null,
    url: link.url || plainUrl,
    network: link.network ?? network ?? null,
    configured: link.configured === true,
    reason: link.configured ? undefined : (link.reason || 'not configured'),
    disclosure: link.disclosure || _ftcDisclosure(),
  };
}

// ── not-insurance-advice / not-a-broker banner ───────────────────────────────────────────────────────
export function notAdviceBanner() {
  return 'Not insurance advice, and we are not a licensed insurance broker. Coverage, premiums, and '
    + 'eligibility depend on your state and profile and are set by the carrier — always confirm the '
    + 'current policy on the carrier\'s site or with a licensed agent before buying. We compare carriers '
    + 'by financial strength and transparency, never by what they pay us, and we never sell your data.';
}

// ── renderPage — escaped HTML comparison table + transparency + banner + disclosure ──────────────────
/**
 * Render an escaped HTML comparison page. `data` may be:
 *   { line, rows:[...] }  — rows (carrier registry, optionally with quotes) are ranked here before render.
 * EVERY interpolated value is escaped. Always includes the not-advice/not-a-broker banner and the FTC
 * disclosure. Sponsored rows are visibly labeled and appear after organic rows. Safe on empty input.
 */
export function renderPage(data = {}) {
  const line = str(data.line).toLowerCase();
  const meta = LINES[line];
  const label = meta ? meta.label : (line || 'Insurance');
  const ranked = rankCarriers(Array.isArray(data.rows) ? data.rows : []);
  const haveQuotes = ranked.some((r) => num(r.premium) != null);

  const premiumCell = (r) => {
    if (num(r.premium) == null) return '<span class="no-quote">Compare official source</span>';
    const per = r.period ? `/${esc(r.period)}` : '';
    return `$${esc(r.premium)}${per}`;
  };

  const rows = ranked.map((r) => {
    const out = applyOut(r.name, r.quoteUrl || r.url, { network: r.affiliateNetwork });
    const href = esc(out.url || '#');
    const sponsoredBadge = r.sponsored ? ' <span class="badge-sponsored" aria-label="sponsored">Sponsored</span>' : '';
    const cfg = out.configured ? '' : ' <span class="apply-unconfigured" title="affiliate id not configured"></span>';
    const clar = r.clarity ? `${esc(r.clarity.value)} <span class="clarity-band">${esc(r.clarity.band)}</span>` : '—';
    return `<tr${r.sponsored ? ' class="sponsored" data-sponsored="true"' : ''}>`
      + `<td>${esc(r.name || '')}${sponsoredBadge}</td>`
      + `<td>${esc(r.amBest || '—')}</td>`
      + `<td>${clar}</td>`
      + `<td>${premiumCell(r)}</td>`
      + `<td><a href="${esc(meta ? meta.official : (r.url || '#'))}" rel="noopener" target="_blank">Official</a></td>`
      + `<td><a href="${href}" rel="sponsored nofollow noopener" target="_blank">Get a quote</a>${cfg}</td>`
      + `<td>${esc(r.asOf || '')}</td>`
      + `</tr>`;
  }).join('');

  const quoteNote = haveQuotes
    ? ''
    : `<p class="rate-context">No live partner quotes configured — showing carriers + official sources. `
      + `Real quotes require a licensed partner per state and line.</p>`;

  return `<section class="insurance" data-line="${esc(line)}">
  <h2>${esc(label)} — honest comparison</h2>
  <p class="not-advice-banner" role="note">${esc(notAdviceBanner())}</p>
  ${quoteNote}
  <table class="insurance-table">
    <thead><tr><th>Carrier</th><th>AM Best</th><th>Clarity</th><th>Premium</th><th></th><th></th><th>As of</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="transparency">Ranked by Clarity (transparency + financial strength), not by commission. Sponsored rows are labeled and segregated.</p>
  <p class="ftc-disclosure">${esc(_ftcDisclosure())}</p>
  <p class="note">${esc(dataNote())}</p>
</section>`;
}

// ── provenance note ──────────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Source: curated carrier registry (facts + official links + AM Best financial-strength ratings) `
    + `with quotes from configured licensed partner APIs only, as of ${asOfDate()}. We are not a licensed `
    + `broker and never sell your data; premiums depend on your state and profile — confirm on the carrier's `
    + `site or with a licensed agent. Ranked by Clarity (transparency + strength), never by commission. `
    + `This is public reference, not insurance advice.`;
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('insurance.mjs')) {
  const arg = process.argv.slice(2).join(' ').trim();
  if (!arg) {
    console.log('\nSoapBox — Insurance comparison');
    console.log('─'.repeat(60));
    console.log('Lines:');
    for (const [k, m] of Object.entries(LINES)) {
      console.log(`  ${k.padEnd(8)} ${m.label.padEnd(26)} via ${m.mechanism}`);
    }
    console.log('\nGuardrails: rank-by-Clarity (never commission) | no data-selling / not a licensed broker | disclosure + not-advice banner always');
    console.log(`\n${dataNote()}`);
    console.log('\nUsage: node integrations/soapbox/insurance.mjs <line>   (e.g. auto, home, health, life, pet, travel)');
    console.log('  Configure licensed partner quote APIs to layer in live premiums; otherwise we compare official sources.');
  } else {
    const key = classifyLine(arg);
    if (!key) {
      console.log(`Unknown line "${arg}". Known: ${listLines().join(', ')}`);
    } else {
      const rows = await compareCarriers({ line: key }).catch(() => []);
      const ranked = rankCarriers(rows);
      console.log(`\n${LINES[key].label} (${ranked.length} carriers, ranked by Clarity)`);
      console.log('─'.repeat(60));
      if (ranked.length === 0) console.log('  No carriers on file for this line.');
      for (const r of ranked) {
        const prem = num(r.premium) != null ? `$${r.premium}${r.period ? '/' + r.period : ''}` : 'compare-official';
        console.log(`  ${String(r.name).padEnd(20)} AMBest:${String(r.amBest).padEnd(4)} Clarity:${String(r.clarity?.value ?? '—').padEnd(4)} ${prem}${r.sponsored ? '  [Sponsored]' : ''}`);
      }
      console.log(`\n${dataNote()}`);
    }
  }
}
