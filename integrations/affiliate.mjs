// affiliate.mjs — the GENERAL cross-vertical affiliate / aggregator-monetization engine
// (queue #215, v3 master-synthesis §3-4). PURE. No network, no secrets, soft-fail everywhere.
//
// Relationship to integrations/soapbox/affiliate.mjs:
//   That sibling is the Library-specific book lead-out (Bookshop/Amazon/AbeBooks + free-borrow links,
//   ISBN-aware). This module is the GENERAL engine that copies sideways into EVERY aggregator vertical
//   (Exchanges, Forex, Travel, Insurance, ...). They are intentionally distinct: the book one knows
//   about ISBNs and borrow-first ethics; this one knows about affiliate NETWORKS, the six monetization
//   MECHANISMS, per-vertical fit, and — load-bearing — the honest-ranking + no-data-selling guardrails
//   that are "the moat" (v3 §4, §3). Both share the same FTC-disclosure discipline.
//
// THE MODEL (v3 §3-4): the live comparison dashboard IS an aggregator; monetization bolts on without
// corrupting the comparison. Six universal mechanisms; hard guardrails encoded as throwing asserts:
//   (a) ranking is NEVER affected by commission  -> assertRankingUnbiased() throws if a paid flag
//       reordered the honest list;
//   (b) NO data-selling / NO lead-gen-by-default -> a CPL path that sells user data is REFUSED;
//   (c) every outbound link carries a disclosure.
//
// Affiliate IDs come from the environment BY NAME ONLY — this file never contains an id, and never
// fabricates one: when the env var is unset we return the plain, untagged URL + "not configured".
//
//   import { affiliateLink, disclose, rankListings, verticalAffiliateFit } from './affiliate.mjs'
//   node integrations/affiliate.mjs travel

// --- HTML escape (strict; used by every render path) -----------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- the six monetization MECHANISMS (v3 §4) -------------------------------

export const MECHANISMS = {
  affiliate:  { code: 'CPA', label: 'Affiliate / referral commission', desc: 'We earn a commission when you buy or sign up through a disclosed link. Ranking is never affected.' },
  leadgen:    { code: 'CPL', label: 'Lead generation', desc: 'A connection fee paid by a provider — ONLY the consented, non-data-selling kind; we never sell your data.' },
  cpc:        { code: 'CPC', label: 'Cost per click (metasearch)', desc: 'A small fee when you click out to a provider, like a flight/hotel metasearch. Does not change ranking.' },
  sponsored:  { code: 'SPONSOR', label: 'Sponsored placement / ads', desc: 'Clearly labeled paid placements, segregated from organic results — they can never outrank honest results.' },
  premiumData:{ code: 'DATA', label: 'Premium data / API', desc: 'Paid access to the data/API for power users — the real earner (the CoinGecko/CMC model).' },
  proMembership:{ code: 'PRO', label: 'Pro membership', desc: 'A subscription for advanced tools, alerts, and ad-free use. The data itself stays honest for everyone.' },
};

// --- affiliate NETWORKS (id-by-env-name; v3 §3 "CJ/Impact/Rakuten/ShareASale/Awin/Travelpayouts...") -

// Each network: the human label, the ENV VAR NAME holding our publisher/affiliate id (never the id
// itself), how the id is applied to a URL ('query' param name, or 'subid' for path-style), and the
// FTC disclosure line shown wherever its links render.
export const NETWORKS = {
  cj:            { label: 'CJ Affiliate (Commission Junction)', env: 'CJ_PUBLISHER_ID',      param: 'pid',      disclosure: 'Affiliate link (CJ Affiliate) — we may earn a commission. Ranking is unaffected.' },
  impact:        { label: 'Impact.com',                          env: 'IMPACT_PARTNER_ID',    param: 'irpid',    disclosure: 'Affiliate link (Impact) — we may earn a commission. Ranking is unaffected.' },
  rakuten:       { label: 'Rakuten Advertising',                 env: 'RAKUTEN_AFFILIATE_ID', param: 'ranMID',   disclosure: 'Affiliate link (Rakuten) — we may earn a commission. Ranking is unaffected.' },
  shareasale:    { label: 'ShareASale',                          env: 'SHAREASALE_AFFID',     param: 'afftrack', disclosure: 'Affiliate link (ShareASale) — we may earn a commission. Ranking is unaffected.' },
  awin:          { label: 'Awin',                                env: 'AWIN_PUBLISHER_ID',    param: 'awinaffid',disclosure: 'Affiliate link (Awin) — we may earn a commission. Ranking is unaffected.' },
  travelpayouts: { label: 'Travelpayouts',                       env: 'TRAVELPAYOUTS_MARKER', param: 'marker',   disclosure: 'Affiliate link (Travelpayouts) — we may earn a commission. Ranking is unaffected.' },
  booking:       { label: 'Booking.com',                         env: 'BOOKING_AID',          param: 'aid',      disclosure: 'Affiliate link (Booking.com) — we may earn a commission. Ranking is unaffected.' },
  expedia:       { label: 'Expedia (EAN)',                       env: 'EXPEDIA_EAN_TPID',     param: 'tpid',     disclosure: 'Affiliate link (Expedia) — we may earn a commission. Ranking is unaffected.' },
};

// --- the disclosure line (FTC) ---------------------------------------------

// The generic FTC affiliate disclosure. Mirrors the book module's discipline (§3 "Disclose every
// commission"): plain, present wherever a commissioned link appears.
export function ftcDisclosure() {
  return 'Disclosure: some links are affiliate links — we may earn a commission at no extra cost to '
    + 'you. Commissions never affect our ranking, and we never sell your data.';
}

// Append the FTC disclosure line to a block of HTML (escaped). Idempotent-friendly: pass the page/card
// HTML; you get it back with a <p class="ftc-disclosure"> appended.
export function disclose(html) {
  return `${html ?? ''}<p class="ftc-disclosure">${esc(ftcDisclosure())}</p>`;
}

// --- affiliateLink: tag a URL with an env-named affiliate id ---------------

// Append a query parameter to a URL without clobbering existing ones; soft-fails on a malformed URL by
// falling back to a manual separator join (still never throws).
function appendParam(url, key, val) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, val);
    return u.toString();
  } catch {
    const sep = String(url).includes('?') ? '&' : '?';
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
  }
}

// Build a tagged affiliate URL for { network, url, subId }.
//   - Looks up the network's ENV VAR NAME, reads it from process.env. NEVER fabricates an id.
//   - When the env is set: appends the id (and the optional subId for click attribution) and returns
//     { url: tagged, network, disclosure, configured: true }.
//   - When the env is unset: returns the PLAIN url, configured:false, reason 'not configured'.
//   - Unknown network or empty url: soft-fails to { url, configured:false, reason }.
export function affiliateLink({ network, url, subId } = {}) {
  const plainUrl = typeof url === 'string' ? url : '';
  const net = NETWORKS[String(network || '').toLowerCase()];

  if (!net) {
    return { url: plainUrl, network: network || null, disclosure: ftcDisclosure(), configured: false, reason: 'unknown network' };
  }
  if (!plainUrl) {
    return { url: '', network, disclosure: net.disclosure, configured: false, reason: 'no url' };
  }

  const id = process.env[net.env];
  if (!id) {
    // Soft-fail: a missing tag must never break a link, and we must never invent an id.
    return { url: plainUrl, network, disclosure: net.disclosure, configured: false, reason: 'not configured', env: net.env };
  }

  let tagged = appendParam(plainUrl, net.param, id);
  if (subId) tagged = appendParam(tagged, 'subid', String(subId));
  return { url: tagged, network, disclosure: net.disclosure, configured: true, env: net.env };
}

// --- guardrail (a): ranking is NEVER affected by commission ----------------

// The HONEST signal: rank organic listings by their genuine quality (Clarity rating, then relevance),
// NEVER by commission/payout. Sponsored items are SEGREGATED to the end and clearly labeled — never
// interleaved to outrank organic. Returns a NEW array; input is not mutated.
//
// A listing: { id?, name?, clarity?, relevance?, commission?, sponsored? }.
export function rankListings(listings = []) {
  const items = Array.isArray(listings) ? listings.slice() : [];
  const organic = items.filter((x) => !x?.sponsored);
  const sponsored = items.filter((x) => x?.sponsored);

  // Stable sort on the honest signal. Higher clarity first, then higher relevance, then keep input
  // order. Commission is deliberately ABSENT from the comparator.
  const honest = (a, b) => {
    const ca = num(a?.clarity), cb = num(b?.clarity);
    if (cb !== ca) return cb - ca;
    const ra = num(a?.relevance), rb = num(b?.relevance);
    if (rb !== ra) return rb - ra;
    return 0;
  };
  const stableSort = (arr) => arr
    .map((v, i) => [v, i])
    .sort((x, y) => honest(x[0], y[0]) || (x[1] - y[1]))
    .map(([v]) => v);

  return [
    ...stableSort(organic),
    // sponsored go AFTER all organic, labeled, ranked only among themselves by honest signal.
    ...stableSort(sponsored).map((s) => ({ ...s, sponsored: true, label: 'Sponsored' })),
  ];
}

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

// Identity key for a listing — prefer id, fall back to name, then a JSON shape.
function keyOf(x) {
  if (x == null) return '∅';
  if (x.id != null) return `id:${x.id}`;
  if (x.name != null) return `name:${x.name}`;
  return `o:${JSON.stringify(x)}`;
}

// Assert the ranking was NOT bought: the ORGANIC subsequence of `ranked` must be in honest order, and
// no sponsored item may appear before an organic one. THROWS if commission/sponsorship changed the
// honest order. `organic` is the honestly-ranked organic baseline (e.g. rankListings of organic-only).
export function assertRankingUnbiased(organic, ranked) {
  const baseline = Array.isArray(organic) ? organic : [];
  const out = Array.isArray(ranked) ? ranked : [];

  // 1) No sponsored item may precede an organic item (segregation invariant).
  let seenSponsored = false;
  for (const item of out) {
    if (item?.sponsored) { seenSponsored = true; continue; }
    if (seenSponsored) {
      throw new Error('ranking bias: a sponsored item is ranked above an organic item');
    }
  }

  // 2) The organic items, in their `ranked` order, must equal the honest baseline order.
  const expectedOrganic = baseline.filter((x) => !x?.sponsored).map(keyOf);
  const actualOrganic = out.filter((x) => !x?.sponsored).map(keyOf);

  if (expectedOrganic.length !== actualOrganic.length) {
    throw new Error('ranking bias: organic set changed (count mismatch) — listings added/dropped by payment?');
  }
  for (let i = 0; i < expectedOrganic.length; i++) {
    if (expectedOrganic[i] !== actualOrganic[i]) {
      throw new Error(`ranking bias: organic order changed at position ${i} — commission/sponsorship reordered honest results`);
    }
  }
  return true;
}

// --- guardrail (b): NO data-selling / NO lead-gen-by-default ---------------

// Policy flag — read from env BY NAME but defaults to FALSE (off by default, the safe default). We do
// NOT run a data-selling lead-gen program. This is the codified "do #1 and #2, never #3" (v3 §3).
export const LEAD_GEN_SELLS_DATA = String(process.env.LEAD_GEN_SELLS_DATA || 'false').toLowerCase() === 'true';

// Build a lead-gen (CPL) handoff — but REFUSE any path that sells user data. The only allowed CPL is
// the consented, non-data-selling kind (user explicitly asked to be connected; we forward, we don't
// sell a list). Throws on a data-selling request; returns a benign refusal-shaped result otherwise.
//   lead: { vertical, providerUrl, sellsData?, userConsented? }
export function buildLeadGen(lead = {}) {
  const sellsData = lead.sellsData === true || LEAD_GEN_SELLS_DATA === true;
  if (sellsData) {
    throw new Error('refused: data-selling lead-gen is not permitted (no-data-selling guardrail, v3 §3)');
  }
  if (lead.userConsented !== true) {
    return { ok: false, reason: 'lead-gen requires explicit user consent (no lead-gen by default)' };
  }
  return {
    ok: true,
    mechanism: 'leadgen',
    code: MECHANISMS.leadgen.code,
    vertical: lead.vertical || null,
    providerUrl: typeof lead.providerUrl === 'string' ? lead.providerUrl : '',
    note: 'consented connection only — no user data is sold',
  };
}

// --- per-vertical affiliate fit (v3 §4 "Direct fits" + the ~60 verticals) --

// vertical name -> { mechanism, network, example } : how each aggregator vertical earns honestly.
// Drawn directly from v3 §4. Used to drive the cross-industry directory's monetization column.
const VERTICAL_FIT = {
  exchanges:   { mechanism: 'affiliate', network: 'impact',        example: 'crypto-exchange referral (the biggest one)' },
  forex:       { mechanism: 'affiliate', network: 'cj',            example: 'forex-broker affiliate / IB' },
  commodities: { mechanism: 'affiliate', network: 'cj',            example: 'broker / bullion-dealer affiliate' },
  stocks:      { mechanism: 'affiliate', network: 'impact',        example: 'brokerage "open an account" referral' },
  etfs:        { mechanism: 'affiliate', network: 'impact',        example: 'brokerage "open an account" referral' },
  travel:      { mechanism: 'cpc',       network: 'travelpayouts', example: 'flight/hotel metasearch (Booking/Travelpayouts)' },
  hotels:      { mechanism: 'affiliate', network: 'booking',       example: 'hotel booking commission (Booking/Expedia)' },
  flights:     { mechanism: 'cpc',       network: 'travelpayouts', example: 'flight metasearch click-out' },
  insurance:   { mechanism: 'affiliate', network: 'cj',            example: 'comparison commission (The Zebra model) — no data-selling' },
  creditcards: { mechanism: 'affiliate', network: 'impact',        example: 'card "apply now" referral (NerdWallet model)' },
  loans:       { mechanism: 'leadgen',   network: 'impact',        example: 'consented lender connection (Credible model) — no data-selling' },
  mortgages:   { mechanism: 'affiliate', network: 'impact',        example: 'lender referral (Bankrate model)' },
  contractors: { mechanism: 'leadgen',   network: 'impact',        example: 'consented pro connection (Angi/Thumbtack)' },
  solar:       { mechanism: 'leadgen',   network: 'impact',        example: 'consented installer quote (EnergySage)' },
  broadband:   { mechanism: 'affiliate', network: 'cj',            example: 'ISP/plan referral (BroadbandNow)' },
  software:    { mechanism: 'affiliate', network: 'impact',        example: 'SaaS / hosting / VPN referral (G2/Capterra)' },
  vpns:        { mechanism: 'affiliate', network: 'impact',        example: 'VPN referral' },
  books:       { mechanism: 'affiliate', network: 'cj',            example: 'see soapbox/affiliate.mjs (Bookshop/Amazon book lead-out)' },
  jobs:        { mechanism: 'cpc',       network: 'cj',            example: 'job-board click-out (Indeed/ZipRecruiter)' },
  courses:     { mechanism: 'affiliate', network: 'impact',        example: 'course referral (Class Central)' },
  lawyers:     { mechanism: 'sponsored', network: null,            example: 'flat-fee ads / premium profile ONLY — never a cut of legal fees (ABA 5.4)' },
};

// Look up the honest monetization fit for a vertical. Returns the fit augmented with the mechanism's
// plain description and the network label. Unknown vertical -> a safe default (affiliate, undisclosed
// network) so callers always get a shape.
export function verticalAffiliateFit(vertical) {
  const key = String(vertical || '').toLowerCase().replace(/[^a-z]/g, '');
  const fit = VERTICAL_FIT[key] || { mechanism: 'affiliate', network: null, example: 'general affiliate referral (disclose every commission)' };
  const mech = MECHANISMS[fit.mechanism] || MECHANISMS.affiliate;
  const net = fit.network ? NETWORKS[fit.network] : null;
  return {
    vertical: key || null,
    mechanism: fit.mechanism,
    mechanismCode: mech.code,
    mechanismDesc: mech.desc,
    network: fit.network || null,
    networkLabel: net ? net.label : null,
    example: fit.example,
  };
}

// --- guardrail (c) in render form: renderOffer ALWAYS includes a disclosure -

// Render an escaped HTML offer card. Every card carries the disclosure (no opt-out). Sponsored offers
// are visibly labeled. offer: { title, network, url, subId, price?, vertical?, sponsored? }
export function renderOffer(offer = {}) {
  const link = affiliateLink({ network: offer.network, url: offer.url, subId: offer.subId });
  const title = esc(offer.title || 'Untitled offer');
  const href = esc(link.url || '#');
  const price = offer.price != null ? `<span class="offer-price">${esc(offer.price)}</span>` : '';
  const sponsoredBadge = offer.sponsored ? '<span class="offer-badge" aria-label="sponsored">Sponsored</span>' : '';
  const vertical = offer.vertical ? `<span class="offer-vertical">${esc(offer.vertical)}</span>` : '';
  const cfg = link.configured ? '' : '<span class="offer-unconfigured" title="affiliate id not configured"></span>';

  const card =
    `<div class="offer-card"${offer.sponsored ? ' data-sponsored="true"' : ''}>`
    + `<a class="offer-title" href="${href}" rel="sponsored nofollow noopener" target="_blank">${title}</a>`
    + sponsoredBadge + vertical + price + cfg
    + '</div>';

  // disclose() appends the escaped FTC line — this is the always-on guarantee.
  return disclose(card);
}

// --- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('affiliate.mjs') && !process.argv[1].includes('soapbox')) {
  const arg = process.argv.slice(2).join(' ').trim();
  if (arg) {
    const fit = verticalAffiliateFit(arg);
    console.log(`Affiliate fit for "${arg}":`);
    console.log(`  mechanism : ${fit.mechanism} (${fit.mechanismCode}) — ${fit.mechanismDesc}`);
    console.log(`  network   : ${fit.networkLabel || fit.network || '(none / direct)'}`);
    console.log(`  example   : ${fit.example}`);
  } else {
    console.log('Monetization mechanisms (the six):');
    for (const [k, m] of Object.entries(MECHANISMS)) console.log(`  ${k.padEnd(14)} ${m.code.padEnd(8)} ${m.desc}`);
    console.log('\nNetworks (affiliate ids by ENV NAME only):');
    for (const [k, n] of Object.entries(NETWORKS)) console.log(`  ${k.padEnd(14)} env=${n.env}`);
    console.log(`\nGuardrails: ranking-can't-be-bought | no data-selling (LEAD_GEN_SELLS_DATA=${LEAD_GEN_SELLS_DATA}) | disclosure always`);
    console.log('\nUsage: node integrations/affiliate.mjs <vertical>   (e.g. exchanges, forex, travel, insurance)');
  }
}
