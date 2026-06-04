// aggregator-directory.mjs — the cross-industry AGGREGATOR DIRECTORY (queue #231, v3 master-synthesis §4).
//
// "One engine, one honest-comparison brand, many doorways" (v3 §4). The live Global Markets dashboard
// (data.soapbox.community) already IS a CoinGecko/CMC-class comparison aggregator with the Clarity
// rating + right-of-reply built in. The SAME engine copies sideways into ~60 comparison verticals.
// This file is the REGISTRY of those verticals — each with its honest monetization fit and the Clarity
// guardrail — so it doubles as a BUILD-TRACKER of which doorways we have already opened.
//
// Relationship to integrations/affiliate.mjs (#215): that module is the general monetization ENGINE
// (the six MECHANISMS, affiliate NETWORKS, per-vertical fit, the no-pay-to-rank / no-data-selling
// guardrails). This module is the DIRECTORY that drives it: it lists the verticals and, for each, asks
// affiliate.mjs how it earns honestly. We REUSE affiliate.mjs via a defensive import and NEVER
// duplicate MECHANISMS / NETWORKS / verticalAffiliateFit here.
//
// PURE / deterministic. No network, no secrets, soft-fail everywhere. CLI guarded. Every render path
// escapes HTML.
//
//   import { VERTICALS, listByGroup, vertical, groups, monetizationFor, coverageReport, renderDirectory }
//     from './aggregator-directory.mjs'
//   node integrations/aggregator-directory.mjs            # coverage report
//   node integrations/aggregator-directory.mjs travel     # one group
//   node integrations/aggregator-directory.mjs --html     # rendered directory

// --- defensive import of the affiliate engine (#215; never duplicate) ------

// We import the engine softly: if it is ever absent/broken, the directory still lists every vertical
// and renders — monetization just degrades to a safe "engine unavailable" shape. We never re-implement
// MECHANISMS, NETWORKS, or verticalAffiliateFit; we ask affiliate.mjs.
let _affiliate = null;
try {
  _affiliate = await import('./affiliate.mjs');
} catch {
  _affiliate = null; // soft-fail: directory works without the engine, monetization degrades gracefully.
}

// HTML escape — prefer the engine's strict esc() (single source of truth); fall back to a local copy
// with identical behavior if the engine is unavailable.
export const esc = (_affiliate && typeof _affiliate.esc === 'function')
  ? _affiliate.esc
  : function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

// A known mechanism key from affiliate.MECHANISMS, or 'affiliate' as the safe default if the engine is
// gone. Used so every vertical's mechanism resolves to something valid even offline.
function mechKeys() {
  return _affiliate && _affiliate.MECHANISMS ? Object.keys(_affiliate.MECHANISMS) : ['affiliate'];
}
function safeMech(key) {
  const valid = mechKeys();
  return valid.includes(key) ? key : 'affiliate';
}

// --- the brand guardrail line (the moat, v3 §4 / §3) -----------------------

// The differentiator stated everywhere: the Clarity rating + disclosed affiliate links + ranking that
// payment can't buy + no data-selling. The "Progressive lesson" applied across every vertical.
export const BRAND_GUARDRAIL =
  'One honest-comparison brand across every vertical: rankings are by the Clarity rating, never by '
  + 'commission — payment can never buy placement, and we never sell your data. Affiliate relationships '
  + 'are always disclosed.';

// --- the groups (v3 §4 ordering) -------------------------------------------

// Ordered group ids -> human labels. Order is the doc's presentation order.
export const GROUPS = {
  'consumer-goods':  'Consumer goods & prices',
  travel:            'Travel',
  financial:         'Financial',
  insurance:         'Insurance',
  'home-services':   'Home & services',
  auto:              'Auto',
  'real-estate':     'Real estate',
  'work-education':  'Work & education',
  software:          'Software / B2B',
  healthcare:        'Healthcare',
  'events-media':    'Events & media',
  'local-professional': 'Local & professional',
};

// Verticals we already SHIPPED in the repo (existsInRepo = true). These map onto built modules /
// Data.SoapBox tabs: crypto/forex/commodities/stocks (markets tabs), cannabis (Seeds/Hemp), lawyers
// (Law.SoapBox), where-to-watch (JustWatch media), charities (Charity Navigator → Clarity), benefits
// (honest benefits navigator, #214).
const BUILT = new Set([
  'crypto', 'forex', 'commodities', 'stocks',
  'cannabis', 'lawyers', 'where-to-watch', 'charities', 'benefits',
]);

// --- the ~60 verticals (v3 §4, verbatim list) ------------------------------

// Each entry: { id, name, group, mechanism (a key of affiliate.MECHANISMS), exampleIncumbent,
// exampleNetwork (a key of affiliate.NETWORKS or null/direct), existsInRepo }.
// mechanism is the honest earner for that doorway (CPA/CPL/CPC/sponsored/data/pro), drawn from §4.
// existsInRepo is derived from BUILT so the two never drift.
function v(id, name, group, mechanism, exampleIncumbent, exampleNetwork) {
  return {
    id,
    name,
    group,
    mechanism: safeMech(mechanism),
    exampleIncumbent,
    exampleNetwork: exampleNetwork || null,
    existsInRepo: BUILT.has(id),
  };
}

export const VERTICALS = [
  // --- existing markets tabs (direct fits, §4) ---
  v('crypto',        'Crypto exchanges',        'financial',     'affiliate', 'CoinMarketCap / CoinGecko', 'impact'),
  v('forex',         'Forex brokers',           'financial',     'affiliate', 'forex-broker affiliate / IB', 'cj'),
  v('commodities',   'Commodities & bullion',   'financial',     'affiliate', 'broker / bullion dealer', 'cj'),
  v('stocks',        'Stocks & ETFs',           'financial',     'affiliate', 'brokerage "open an account"', 'impact'),

  // --- Consumer goods / prices ---
  v('groceries',     'Groceries',               'consumer-goods', 'cpc',       'Instacart / grocery price compare', 'cj'),
  v('fuel',          'Fuel prices',             'consumer-goods', 'sponsored', 'GasBuddy', null),
  v('products',      'General products',        'consumer-goods', 'cpc',       'Google Shopping / PriceGrabber', 'cj'),
  v('price-history', 'Amazon price history',    'consumer-goods', 'affiliate', 'CamelCamelCamel', 'rakuten'),
  v('coupons',       'Coupons & cashback',      'consumer-goods', 'affiliate', 'Honey / Rakuten', 'rakuten'),
  v('alcohol',       'Alcohol & wine',          'consumer-goods', 'affiliate', 'Wine-Searcher', 'cj'),
  v('cannabis',      'Cannabis',                'consumer-goods', 'sponsored', 'Leafly / Weedmaps', null),
  v('pet-supplies',  'Pet supplies',            'consumer-goods', 'affiliate', 'pet-supply price compare', 'cj'),
  v('books',         'Books',                   'consumer-goods', 'affiliate', 'BookFinder (see soapbox/affiliate)', 'cj'),
  v('rx',            'Prescription prices',     'consumer-goods', 'affiliate', 'GoodRx', 'cj'),

  // --- Travel ---
  v('flights',       'Flights',                 'travel',        'cpc',       'Skyscanner / Kayak', 'travelpayouts'),
  v('hotels',        'Hotels',                  'travel',        'affiliate', 'Trivago / Booking', 'booking'),
  v('car-rentals',   'Car rentals',            'travel',        'affiliate', 'rental aggregator', 'travelpayouts'),
  v('cruises',       'Cruises',                 'travel',        'affiliate', 'cruise comparison', 'cj'),
  v('vacation-rentals', 'Vacation rentals',     'travel',        'affiliate', 'HomeToGo', 'cj'),
  v('parking',       'Parking',                 'travel',        'affiliate', 'SpotHero', 'cj'),
  v('tours',         'Tours & activities',      'travel',        'affiliate', 'Viator', 'travelpayouts'),
  v('travel-insurance', 'Travel insurance',     'travel',        'affiliate', 'travel-insurance compare', 'cj'),

  // --- Financial ---
  v('credit-cards',  'Credit cards',            'financial',     'affiliate', 'NerdWallet', 'impact'),
  v('personal-loans','Personal loans',          'financial',     'leadgen',   'Credible', 'impact'),
  v('mortgages',     'Mortgages',               'financial',     'affiliate', 'Bankrate', 'impact'),
  v('auto-student-loans', 'Auto & student loans','financial',    'leadgen',   'loan comparison', 'impact'),
  v('savings-cds',   'Savings & CDs',           'financial',     'affiliate', 'DepositAccounts', 'impact'),
  v('business-loans','Business loans / SBA',    'financial',     'leadgen',   'SBA lender match', 'impact'),
  v('tax-software',  'Tax software',            'financial',     'affiliate', 'tax-software compare', 'cj'),

  // --- Insurance ---
  v('auto-insurance','Auto insurance',          'insurance',     'affiliate', 'The Zebra', 'cj'),
  v('home-insurance','Home & renters insurance','insurance',     'affiliate', 'home-insurance compare', 'cj'),
  v('life-insurance','Life insurance',          'insurance',     'affiliate', 'Policygenius', 'cj'),
  v('health-insurance','Health insurance',      'insurance',     'leadgen',   'eHealth', 'cj'),
  v('pet-insurance', 'Pet insurance',           'insurance',     'affiliate', 'pet-insurance compare', 'cj'),
  v('commercial-insurance','Commercial insurance','insurance',   'leadgen',   'commercial-insurance compare', 'cj'),

  // --- Home / services ---
  v('contractors',   'Contractors',             'home-services', 'leadgen',   'Angi / Thumbtack', 'impact'),
  v('movers',        'Movers',                  'home-services', 'leadgen',   'moving-quote compare', 'impact'),
  v('solar',         'Solar',                   'home-services', 'leadgen',   'EnergySage', 'impact'),
  v('broadband',     'Broadband',               'home-services', 'affiliate', 'BroadbandNow', 'cj'),
  v('cell-plans',    'Cell plans',              'home-services', 'affiliate', 'WhistleOut', 'cj'),
  v('electricity',   'Electricity switching',   'home-services', 'leadgen',   'energy-switch compare', 'cj'),
  v('home-security', 'Home security',           'home-services', 'affiliate', 'home-security compare', 'impact'),
  v('storage',       'Self-storage',            'home-services', 'leadgen',   'SpareFoot', 'impact'),

  // --- Auto ---
  v('cars',          'New & used cars',         'auto',          'leadgen',   'CarGurus / TrueCar', 'impact'),
  v('auto-parts',    'Auto parts',              'auto',          'affiliate', 'RockAuto', 'cj'),
  v('auto-repair',   'Auto repair',             'auto',          'leadgen',   'RepairPal', 'impact'),
  v('tires',         'Tires',                   'auto',          'affiliate', 'TireRack', 'cj'),

  // --- Real estate ---
  v('home-buying',   'Buying a home',           'real-estate',   'leadgen',   'Zillow', 'impact'),
  v('rentals',       'Rentals',                 'real-estate',   'leadgen',   'Apartments.com / Zumper', 'impact'),
  v('commercial-re', 'Commercial real estate',  'real-estate',   'leadgen',   'LoopNet', 'impact'),
  v('agent-match',   'Agent match',             'real-estate',   'leadgen',   'HomeLight', 'impact'),

  // --- Work / education ---
  v('jobs',          'Jobs',                    'work-education','cpc',       'Indeed / ZipRecruiter', 'cj'),
  v('freelancers',   'Freelancers',             'work-education','affiliate', 'Upwork / Fiverr', 'impact'),
  v('courses',       'Courses',                 'work-education','affiliate', 'Class Central', 'impact'),
  v('colleges',      'Colleges',                'work-education','leadgen',   'Niche / College Scorecard', 'impact'),
  v('tutoring',      'Tutoring',                'work-education','leadgen',   'tutoring marketplace', 'impact'),

  // --- Software / B2B ---
  v('software-reviews','Software reviews',       'software',      'affiliate', 'G2 / Capterra', 'impact'),
  v('hosting',       'Web hosting',             'software',      'affiliate', 'hosting affiliate', 'impact'),
  v('vpns',          'VPNs',                    'software',      'affiliate', 'VPN affiliate', 'impact'),
  v('domains',       'Domains',                 'software',      'affiliate', 'registrar affiliate', 'impact'),

  // --- Healthcare ---
  v('doctors',       'Doctors',                 'healthcare',    'leadgen',   'Zocdoc', 'impact'),
  v('dentists',      'Dentists',                'healthcare',    'leadgen',   'dentist directory', 'impact'),
  v('hospitals',     'Hospitals',               'healthcare',    'sponsored', 'Medicare Care Compare', null),
  v('senior-care',   'Senior care',             'healthcare',    'leadgen',   'A Place for Mom', 'impact'),
  v('therapy',       'Therapy',                 'healthcare',    'leadgen',   'Psychology Today', 'impact'),

  // --- Events / media ---
  v('tickets',       'Event tickets',           'events-media',  'affiliate', 'SeatGeek', 'impact'),
  v('showtimes',     'Movie showtimes',         'events-media',  'affiliate', 'Fandango', 'cj'),
  v('where-to-watch','Where to watch',          'events-media',  'affiliate', 'JustWatch', 'impact'),

  // --- Local / professional ---
  v('lawyers',       'Lawyers',                 'local-professional', 'sponsored', 'Avvo / FindLaw (→ Law vertical)', null),
  v('accountants',   'Accountants',             'local-professional', 'leadgen',   'accountant directory', 'impact'),
  v('wedding-vendors','Wedding vendors',        'local-professional', 'leadgen',   'The Knot', 'impact'),
  v('childcare',     'Childcare',               'local-professional', 'leadgen',   'Care.com', 'impact'),
  v('gyms',          'Gyms',                    'local-professional', 'affiliate', 'ClassPass', 'impact'),
  v('salons',        'Salons',                  'local-professional', 'leadgen',   'salon booking', 'impact'),
  v('charities',     'Charities',               'local-professional', 'sponsored', 'Charity Navigator (→ Clarity)', null),
  v('benefits',      'Benefits navigator',      'local-professional', 'sponsored', 'Benefits.gov (→ honest §3)', null),
];

// --- accessors -------------------------------------------------------------

// All group ids, in canonical order.
export function groups() {
  return Object.keys(GROUPS);
}

// One vertical by id (case-insensitive). Returns undefined if unknown.
export function vertical(id) {
  const key = String(id || '').toLowerCase().trim();
  return VERTICALS.find((x) => x.id === key);
}

// Verticals grouped: { groupId: { label, items: [...] }, ... } in canonical group order.
// Pass a group id to get just that group's items (array, possibly empty).
export function listByGroup(groupId) {
  if (groupId != null) {
    const g = String(groupId).toLowerCase().trim();
    return VERTICALS.filter((x) => x.group === g);
  }
  const out = {};
  for (const g of groups()) {
    out[g] = { label: GROUPS[g], items: VERTICALS.filter((x) => x.group === g) };
  }
  return out;
}

// --- monetization (delegates to affiliate.mjs; never duplicated) -----------

// How a vertical earns honestly: its mechanism (from affiliate.MECHANISMS), the network label, and the
// FTC disclosure — sourced from affiliate.mjs verticalAffiliateFit + the mechanism table. Soft-fails to
// a safe shape if the vertical is unknown or the engine is unavailable.
export function monetizationFor(id) {
  const vt = vertical(id);
  if (!vt) return { id: String(id || '') || null, ok: false, reason: 'unknown vertical' };

  // Mechanism description from the engine's table (single source of truth), else a minimal fallback.
  const mechTable = (_affiliate && _affiliate.MECHANISMS) || null;
  const mech = mechTable && mechTable[vt.mechanism] ? mechTable[vt.mechanism] : { code: vt.mechanism, label: vt.mechanism, desc: '' };

  // Network label from the engine's NETWORKS table.
  const netTable = (_affiliate && _affiliate.NETWORKS) || null;
  const networkLabel = vt.exampleNetwork && netTable && netTable[vt.exampleNetwork]
    ? netTable[vt.exampleNetwork].label
    : null;

  // The disclosure line: prefer the engine's FTC disclosure; fall back to a plain one.
  const disclosure = (_affiliate && typeof _affiliate.ftcDisclosure === 'function')
    ? _affiliate.ftcDisclosure()
    : 'Disclosure: some links are affiliate links — we may earn a commission. Ranking is unaffected, and we never sell your data.';

  // Also surface the engine's per-vertical fit when it has an opinion (richer than our row).
  let engineFit = null;
  if (_affiliate && typeof _affiliate.verticalAffiliateFit === 'function') {
    try { engineFit = _affiliate.verticalAffiliateFit(vt.id); } catch { engineFit = null; }
  }

  return {
    id: vt.id,
    ok: true,
    mechanism: vt.mechanism,
    mechanismCode: mech.code,
    mechanismLabel: mech.label,
    mechanismDesc: mech.desc,
    network: vt.exampleNetwork,
    networkLabel,
    disclosure,
    guardrail: BRAND_GUARDRAIL,
    engineFit,
  };
}

// --- coverage report (doubles as build-tracker) ----------------------------

// What we already have vs the doorways still open.
//   { total, built, unbuilt, byGroup: { groupId: { label, total, built, unbuilt }, ... } }
export function coverageReport() {
  const byGroup = {};
  let built = 0;
  for (const g of groups()) {
    const items = VERTICALS.filter((x) => x.group === g);
    const b = items.filter((x) => x.existsInRepo).length;
    built += b;
    byGroup[g] = { label: GROUPS[g], total: items.length, built: b, unbuilt: items.length - b };
  }
  return {
    total: VERTICALS.length,
    built,
    unbuilt: VERTICALS.length - built,
    byGroup,
  };
}

// --- render (escaped HTML directory) ---------------------------------------

// An escaped HTML directory grouped by section, each vertical marked BUILT (live) or PLANNED, with the
// no-pay-to-rank / no-data-selling brand line at the top. Pure string; safe to embed.
export function renderDirectory() {
  const cov = coverageReport();
  const parts = [];

  parts.push('<section class="aggregator-directory">');
  parts.push('<h1>Comparison directory</h1>');
  // The brand guardrail line — always shown (the moat).
  parts.push(`<p class="brand-guardrail">${esc(BRAND_GUARDRAIL)}</p>`);
  parts.push(`<p class="coverage-summary">${esc(`${cov.built} of ${cov.total} verticals live — ${cov.unbuilt} doorways still to open.`)}</p>`);

  for (const g of groups()) {
    const items = VERTICALS.filter((x) => x.group === g);
    if (!items.length) continue;
    const stat = cov.byGroup[g];
    parts.push(`<div class="agg-group" data-group="${esc(g)}">`);
    parts.push(`<h2>${esc(GROUPS[g])} <span class="agg-group-count">(${esc(`${stat.built}/${stat.total}`)})</span></h2>`);
    parts.push('<ul class="agg-verticals">');
    for (const vt of items) {
      const mon = monetizationFor(vt.id);
      const state = vt.existsInRepo ? 'built' : 'planned';
      const stateLabel = vt.existsInRepo ? 'LIVE' : 'Planned';
      parts.push(
        `<li class="agg-vertical agg-${esc(state)}" data-vertical="${esc(vt.id)}">`
        + `<span class="agg-name">${esc(vt.name)}</span>`
        + `<span class="agg-state agg-state-${esc(state)}">${esc(stateLabel)}</span>`
        + `<span class="agg-mechanism">${esc(mon.mechanismLabel || vt.mechanism)}</span>`
        + `<span class="agg-incumbent">${esc(vt.exampleIncumbent || '')}</span>`
        + '</li>',
      );
    }
    parts.push('</ul>');
    parts.push('</div>');
  }

  parts.push('</section>');
  return parts.join('');
}

// --- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('aggregator-directory.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--html')) {
    console.log(renderDirectory());
  } else if (args[0] && GROUPS[args[0].toLowerCase()]) {
    const g = args[0].toLowerCase();
    console.log(`${GROUPS[g]}:`);
    for (const vt of listByGroup(g)) {
      const mon = monetizationFor(vt.id);
      console.log(`  ${vt.existsInRepo ? '[LIVE]   ' : '[planned]'} ${vt.name.padEnd(26)} ${String(mon.mechanismCode || vt.mechanism).padEnd(8)} ${vt.exampleIncumbent || ''}`);
    }
  } else {
    const cov = coverageReport();
    console.log(`Aggregator directory — ${cov.total} verticals, ${cov.built} live, ${cov.unbuilt} planned`);
    console.log(BRAND_GUARDRAIL);
    console.log('');
    for (const g of groups()) {
      const s = cov.byGroup[g];
      console.log(`  ${s.label.padEnd(26)} ${s.built}/${s.total} live`);
    }
    console.log('\nUsage: node integrations/aggregator-directory.mjs [<group> | --html]');
    console.log(`Groups: ${groups().join(', ')}`);
  }
}
