// monetization-readiness.mjs — the MONETIZATION GO-LIVE READINESS module (queue task #261 support).
//
// PURPOSE: a single, read-only aggregator that answers "which money-making verticals are actually ready
// to EARN, and what's still missing?" It READS (never edits) the monetization registries already in the
// repo — the affiliate engine, the aggregator directory, and each money-making vertical reader (coupons
// #234, financial-products #238, insurance, ...) — plus, IF they exist yet, the checkout / payment-APIs
// modules. For every vertical it emits a go-live readiness report:
//
//   { vertical, earnsVia: 'affiliate'|'checkout'|'both'|'none', ready: boolean, missing: [...], notes }
//
// "missing" is the punch-list a human works to flip a vertical live, e.g.:
//   - "affiliate network id (env CJ_PUBLISHER_ID) not set"
//   - "no payment provider configured (checkout.mjs absent or no provider key env)"
//   - "FTC disclosure not present in the vertical module"
//
// checkout.mjs / payment-apis.mjs may or may not be present (they were built under task #261). Both are
// imported DEFENSIVELY: when absent, the payment path is reported as "not built yet" rather than crashing;
// when present, configured providers are detected by env-var presence (a provider with no secretEnv, e.g.
// the MELEK chain memo flow, counts as ready since it needs no key).
//
// DESIGN (matches aggregator-directory.mjs): PURE aggregation over the registries, no network, no
// secrets, soft-fail everywhere. Every dependency is imported DEFENSIVELY via dynamic import — an absent
// or broken module degrades to a safe shape, it never crashes this report. CLI guarded; render escapes.
//
//   import { readiness, readinessFor, summary, renderReport } from './monetization-readiness.mjs'
//   node integrations/monetization-readiness.mjs            # full report
//   node integrations/monetization-readiness.mjs coupons    # one vertical
//   node integrations/monetization-readiness.mjs --html

// --- defensive dynamic imports (never fatal) -------------------------------

// Load a sibling module softly; returns the namespace or null. Used for every dependency so a missing
// file (checkout.mjs / payment-apis.mjs do not exist yet) degrades gracefully instead of throwing.
async function softImport(spec) {
  try { return await import(spec); } catch { return null; }
}

const _affiliate = await softImport('./affiliate.mjs');
const _directory = await softImport('./aggregator-directory.mjs');
const _checkout = await softImport('./checkout.mjs');         // may not exist yet
const _paymentApis = await softImport('./payment-apis.mjs');  // may not exist yet

// HTML escape — prefer the affiliate engine's strict esc(); fall back to a local copy.
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

// --- the money-making verticals we assess ----------------------------------

// Each money-making vertical we read: its directory id(s), the reader module to probe for a disclosure,
// and how it intends to earn. directoryIds maps to aggregator-directory.VERTICALS rows (the mechanism /
// network of record live THERE — single source of truth; we never duplicate them). `module` is loaded
// defensively to check for a present FTC disclosure (a go-live requirement). New verticals are added
// here as their readers ship.
const VERTICALS = [
  { vertical: 'coupons',            module: './soapbox/coupons.mjs',            directoryIds: ['coupons'] },
  { vertical: 'financial-products', module: './soapbox/financial-products.mjs', directoryIds: ['credit-cards', 'personal-loans', 'mortgages', 'auto-student-loans', 'savings-cds', 'business-loans', 'tax-software'] },
  { vertical: 'insurance',          module: './soapbox/insurance.mjs',          directoryIds: ['auto-insurance', 'home-insurance', 'life-insurance', 'health-insurance', 'pet-insurance', 'commercial-insurance'] },
  { vertical: 'groceries',          module: './soapbox/groceries.mjs',          directoryIds: ['groceries'] },
  { vertical: 'product-prices',     module: './soapbox/product-prices.mjs',     directoryIds: ['products', 'price-history'] },
  { vertical: 'rx-prices',          module: './soapbox/rx-prices.mjs',          directoryIds: ['rx'] },
  { vertical: 'home-services',      module: './soapbox/home-services.mjs',      directoryIds: ['contractors', 'movers', 'solar', 'broadband'] },
  { vertical: 'jobs-courses',       module: './soapbox/jobs-courses.mjs',       directoryIds: ['jobs', 'freelancers', 'courses'] },
  { vertical: 'real-estate',        module: './soapbox/real-estate.mjs',        directoryIds: ['home-buying', 'rentals', 'commercial-re', 'agent-match'] },
  { vertical: 'auto-marketplace',   module: './soapbox/auto-marketplace.mjs',   directoryIds: ['cars', 'auto-parts', 'auto-repair', 'tires'] },
  { vertical: 'software-reviews',   module: './soapbox/software-reviews.mjs',   directoryIds: ['software-reviews', 'hosting', 'vpns', 'domains'] },
  { vertical: 'local-pros',         module: './soapbox/local-pros.mjs',         directoryIds: ['accountants', 'wedding-vendors', 'childcare', 'gyms', 'salons', 'pet-supplies', 'books'] },
];

export function listVerticals() { return VERTICALS.map((v) => v.vertical); }

// --- earn-mechanism resolution (delegates to the directory; never duplicated) ----

// The set of affiliate-network ENV VAR NAMES needed by a vertical's directory rows. Reads
// aggregator-directory + affiliate.NETWORKS (single source of truth) to learn each row's network, then
// affiliate.NETWORKS[net].env for the env var name. Soft-fails to []. Mechanism 'leadgen'/'sponsored'
// rows may have no network env (consented connection / flat-fee ads), which is fine.
function networkEnvsFor(directoryIds) {
  const out = new Set();
  if (!_directory || typeof _directory.vertical !== 'function') return [];
  const nets = (_affiliate && _affiliate.NETWORKS) || {};
  for (const id of directoryIds) {
    let row = null;
    try { row = _directory.vertical(id); } catch { row = null; }
    if (!row) continue;
    const netKey = row.exampleNetwork;
    if (netKey && nets[netKey] && nets[netKey].env) out.add(nets[netKey].env);
  }
  return [...out];
}

// The distinct earn mechanisms across a vertical's directory rows (affiliate/leadgen/cpc/sponsored/...).
function mechanismsFor(directoryIds) {
  const out = new Set();
  if (!_directory || typeof _directory.vertical !== 'function') return [];
  for (const id of directoryIds) {
    let row = null;
    try { row = _directory.vertical(id); } catch { row = null; }
    if (row && row.mechanism) out.add(row.mechanism);
  }
  return [...out];
}

// --- checkout / payment readiness (defensive; modules may not exist) -------

// Probe the (optional) checkout + payment-APIs layer. Returns:
//   { present, providers: [...configured provider names], missing: [...] }
// When neither module exists yet (the current state), present=false and the single "missing" line names
// the gap. When checkout.mjs exposes a readiness/providers helper we use it; otherwise we look for a
// conventional configured-providers list. Pure / soft-fail — never throws.
export function checkoutReadiness() {
  const mod = _checkout || _paymentApis;
  if (!mod) {
    return { present: false, providers: [], missing: ['checkout/payment module not built yet (checkout.mjs / payment-apis.mjs absent)'] };
  }
  // A provider is "configured" when the env var holding its secret is present. We support several
  // shapes so this keeps working as the checkout module evolves:
  //   - configuredProviders()/readyProviders() helper (preferred, if the module exposes one)
  //   - PROVIDERS as an OBJECT keyed by name, each { secretEnv, ... } (the current checkout.mjs shape)
  //   - PROVIDERS as an ARRAY of { name/id, env/secretEnv }
  let providers = [];
  try {
    if (typeof mod.configuredProviders === 'function') providers = mod.configuredProviders() || [];
    else if (typeof mod.readyProviders === 'function') providers = mod.readyProviders() || [];
    else if (mod.PROVIDERS && !Array.isArray(mod.PROVIDERS) && typeof mod.PROVIDERS === 'object') {
      providers = Object.entries(mod.PROVIDERS)
        // A provider with no secretEnv (e.g. our own chain memo flow) needs no key → counts as ready.
        .filter(([, p]) => p && (p.secretEnv == null || process.env[p.secretEnv]))
        .map(([name]) => name);
    } else if (Array.isArray(mod.PROVIDERS)) {
      providers = mod.PROVIDERS
        .filter((p) => p && (((p.env || p.secretEnv) && process.env[p.env || p.secretEnv]) || (p.secretEnv === null)))
        .map((p) => p.name || p.id || p.env || p.secretEnv);
    }
  } catch { providers = []; }
  providers = Array.isArray(providers) ? providers.map((p) => (typeof p === 'string' ? p : (p?.name || p?.id || String(p)))) : [];
  const missing = providers.length === 0
    ? ['payment module present but no payment provider key configured (set a provider env, e.g. STRIPE_SECRET_KEY / PAYPAL_CLIENT_ID)']
    : [];
  return { present: true, providers, missing };
}

// --- disclosure presence check (read-only) ---------------------------------

// Does a vertical's reader module carry the FTC affiliate disclosure machinery? We treat the presence of
// a disclosure-producing export (renderPage that includes it, or a buildLeadGen / dataNote referencing
// it) as the signal. We DON'T execute network code — we check exported function NAMES, a cheap, safe
// proxy. Soft-fails to false. (`mod` is the defensively-imported namespace, or null.)
function hasDisclosure(mod) {
  if (!mod) return false;
  // Modules in this repo expose esc/escapeHtml + a renderPage that always appends the FTC line, and a
  // buildLeadGen that enforces no-data-selling. Treat any of these as evidence the disclosure discipline
  // is present in the module.
  const markers = ['renderPage', 'buildLeadGen', 'dataNote', 'notAdviceBanner'];
  return markers.some((m) => typeof mod[m] === 'function');
}

// Does the vertical enforce the no-data-selling guard (a buildLeadGen that refuses data-selling)?
function hasNoDataSellGuard(mod) {
  return !!(mod && typeof mod.buildLeadGen === 'function');
}

// --- the per-vertical readiness report -------------------------------------

/**
 * Build the go-live readiness report for ONE vertical entry (from VERTICALS). Reads the vertical's
 * reader module (defensively), the directory rows, the affiliate env requirements, and the checkout
 * layer. Pure / async-only-for-import / soft-fail. Returns:
 *   { vertical, earnsVia, ready, missing:[...], notes, mechanisms, needsNetworkEnvs, configuredNetworkEnvs }
 */
export async function readinessFor(entry, { checkout } = {}) {
  const vertical = entry.vertical;
  const mod = await softImport(entry.module);
  const ck = checkout || checkoutReadiness();

  const mechanisms = mechanismsFor(entry.directoryIds);
  const needsNetworkEnvs = networkEnvsFor(entry.directoryIds);
  const configuredNetworkEnvs = needsNetworkEnvs.filter((e) => !!process.env[e]);

  // earnsVia: does this vertical earn by affiliate/referral, by checkout (we sell directly), or both?
  // Affiliate is the path when any directory row uses an affiliate-ish mechanism; checkout when the
  // payment layer is present (a vertical that also takes direct payment, e.g. pro membership / data sale).
  const affiliateLike = mechanisms.some((m) => ['affiliate', 'leadgen', 'cpc', 'sponsored'].includes(m));
  const checkoutLike = ck.present && (ck.providers.length > 0);
  let earnsVia = 'none';
  if (affiliateLike && checkoutLike) earnsVia = 'both';
  else if (affiliateLike) earnsVia = 'affiliate';
  else if (checkoutLike) earnsVia = 'checkout';

  const missing = [];

  // 1) the reader module itself must be loadable.
  if (!mod) missing.push(`vertical reader module not loadable (${entry.module})`);

  // 2) disclosure discipline must be present in the module (the always-on FTC line).
  if (mod && !hasDisclosure(mod)) missing.push('FTC affiliate disclosure not detected in the vertical module');

  // 3) the no-data-selling guard should be present where a lead path could exist.
  if (mod && mechanisms.includes('leadgen') && !hasNoDataSellGuard(mod)) {
    missing.push('lead-gen mechanism present but no no-data-selling guard (buildLeadGen) in the module');
  }

  // 4) affiliate path: every network env this vertical needs must be set, OR the checkout path covers it.
  if (affiliateLike) {
    const unsetEnvs = needsNetworkEnvs.filter((e) => !process.env[e]);
    if (needsNetworkEnvs.length === 0) {
      // affiliate-ish but no network env required (e.g. sponsored flat-fee / leadgen-only) — fine.
    } else if (unsetEnvs.length === needsNetworkEnvs.length && !checkoutLike) {
      missing.push(`no affiliate network id configured (set one of: ${unsetEnvs.join(', ')})`);
    } else if (unsetEnvs.length > 0) {
      missing.push(`some affiliate network ids unset: ${unsetEnvs.join(', ')}`);
    }
  }

  // 5) if the ONLY intended path is checkout (no affiliate), the payment layer must be ready.
  if (!affiliateLike) {
    for (const m of ck.missing) missing.push(m);
  }

  // A vertical is "ready" to earn when it has at least one working path, the module loads, disclosure is
  // present, and no hard blockers remain. "some affiliate ids unset" (partial) does NOT block ready as
  // long as at least one network is configured OR a non-network mechanism (leadgen/sponsored) earns.
  const hardBlockers = missing.filter((m) =>
    m.startsWith('vertical reader module not loadable')
    || m.startsWith('FTC affiliate disclosure not detected')
    || m.startsWith('lead-gen mechanism present but no no-data-selling')
    || m.startsWith('no affiliate network id configured')
    || (earnsVia === 'none'));
  const ready = earnsVia !== 'none' && hardBlockers.length === 0 && !!mod;

  const notes = ready
    ? `Ready to earn via ${earnsVia}.`
    : (earnsVia === 'none'
        ? 'No earning path active — configure an affiliate network id and/or a payment provider.'
        : `Earns via ${earnsVia}; resolve the missing items to go live.`);

  return {
    vertical,
    earnsVia,
    ready,
    missing,
    notes,
    mechanisms,
    needsNetworkEnvs,
    configuredNetworkEnvs,
  };
}

/**
 * Build the full readiness report across every money-making vertical. Pure aggregation; soft-fails per
 * vertical (a broken vertical yields a not-ready row rather than aborting). Returns an array of reports.
 */
export async function readiness() {
  const ck = checkoutReadiness();
  const out = [];
  for (const entry of VERTICALS) {
    try { out.push(await readinessFor(entry, { checkout: ck })); }
    catch (e) {
      out.push({ vertical: entry.vertical, earnsVia: 'none', ready: false, missing: [`error building report: ${String(e?.message || e)}`], notes: 'errored', mechanisms: [], needsNetworkEnvs: [], configuredNetworkEnvs: [] });
    }
  }
  return out;
}

/**
 * One vertical's report by name (case-insensitive). Returns null for an unknown vertical.
 */
export async function readinessForName(name) {
  const key = String(name || '').toLowerCase().trim();
  const entry = VERTICALS.find((v) => v.vertical === key);
  if (!entry) return null;
  return readinessFor(entry);
}

/**
 * Aggregate summary over the full report: { total, ready, notReady, checkout: {...}, byEarnsVia: {...} }.
 */
export async function summary() {
  const reports = await readiness();
  const ck = checkoutReadiness();
  const byEarnsVia = {};
  let ready = 0;
  for (const r of reports) {
    byEarnsVia[r.earnsVia] = (byEarnsVia[r.earnsVia] || 0) + 1;
    if (r.ready) ready += 1;
  }
  return {
    total: reports.length,
    ready,
    notReady: reports.length - ready,
    checkout: { present: ck.present, providers: ck.providers },
    byEarnsVia,
  };
}

// --- render (escaped HTML report) ------------------------------------------

/**
 * Render the readiness report as an escaped HTML table — green for ready, with the per-vertical missing
 * punch-list. Pure string; safe to embed. Pass an optional precomputed `reports` array.
 */
export function renderReport(reports = [], sum = null) {
  const rows = (Array.isArray(reports) ? reports : []).map((r) => {
    const missing = (r.missing || []).map((m) => `<li>${esc(m)}</li>`).join('');
    return `<tr class="mon-${r.ready ? 'ready' : 'blocked'}" data-vertical="${esc(r.vertical)}">`
      + `<td>${esc(r.vertical)}</td>`
      + `<td>${esc(r.earnsVia)}</td>`
      + `<td>${r.ready ? '✓ ready' : 'blocked'}</td>`
      + `<td>${missing ? `<ul class="mon-missing">${missing}</ul>` : '—'}</td>`
      + `<td>${esc(r.notes || '')}</td>`
      + `</tr>`;
  }).join('');
  const head = sum
    ? `<p class="mon-summary">${esc(`${sum.ready}/${sum.total} verticals ready to earn — payment layer ${sum.checkout.present ? 'present' : 'not built'} (${sum.checkout.providers.length} provider(s) configured).`)}</p>`
    : '';
  return `<section class="monetization-readiness">
  <h2>Monetization go-live readiness</h2>
  ${head}
  <table class="mon-table">
    <thead><tr><th>Vertical</th><th>Earns via</th><th>Status</th><th>Missing</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="note">Read-only aggregation over the affiliate engine, the aggregator directory, each money-making vertical reader, and the checkout/payment layer. Affiliate/referral only — no data-selling. No secrets are read here, only env-var presence.</p>
</section>`;
}

// --- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('monetization-readiness.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--html')) {
    const reports = await readiness();
    const sum = await summary();
    console.log(renderReport(reports, sum));
  } else if (args[0] && !args[0].startsWith('--')) {
    const r = await readinessForName(args[0]);
    if (!r) {
      console.log(`Unknown vertical "${args[0]}". Known: ${listVerticals().join(', ')}`);
    } else {
      console.log(`\nMonetization readiness — ${r.vertical}`);
      console.log('─'.repeat(60));
      console.log(`  earns via : ${r.earnsVia}`);
      console.log(`  ready     : ${r.ready ? 'YES' : 'no'}`);
      console.log(`  mechanisms: ${r.mechanisms.join(', ') || '(none)'}`);
      console.log(`  net envs  : ${r.configuredNetworkEnvs.length}/${r.needsNetworkEnvs.length} configured`);
      if (r.missing.length) { console.log('  missing   :'); for (const m of r.missing) console.log(`    - ${m}`); }
      console.log(`  notes     : ${r.notes}`);
    }
  } else {
    const reports = await readiness();
    const sum = await summary();
    console.log(`\nMonetization go-live readiness — ${sum.ready}/${sum.total} verticals ready`);
    console.log(`Payment layer: ${sum.checkout.present ? 'present' : 'NOT built yet'} (${sum.checkout.providers.length} provider(s))`);
    console.log('─'.repeat(72));
    for (const r of reports) {
      const flag = r.ready ? '[READY]   ' : '[blocked] ';
      console.log(`  ${flag}${r.vertical.padEnd(20)} via ${String(r.earnsVia).padEnd(10)} ${r.missing.length ? `(${r.missing.length} missing)` : ''}`);
    }
    console.log('\nUsage: node integrations/monetization-readiness.mjs [<vertical> | --html]');
    console.log(`Verticals: ${listVerticals().join(', ')}`);
  }
}
