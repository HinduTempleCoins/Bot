// local-business-intel.mjs — Task #232 (v3 doc §6): the Local Business Intelligence page.
//
// A neighborhood-granular "Crunchbase" pointed at Main Street. It assembles ONE business page out of
//   • FACTS we can host (official gov records: FDA/CPSC recalls, CFPB complaints, SEC EDGAR filings),
//   • the OSM identity / location spine + Census neighborhood context, and
//   • USER content we do NOT author (the storable review layer + scam reports), aggregated under §230.
//
// THE LEGAL FRAME — encoded structurally, not as a comment we hope someone reads (v3 §6):
//   1. Official gov records are FACTS. Truth is an absolute defense. We host/state them flatly, each
//      tagged { source, sourceUrl, asOf, kind: 'fact' }. They are never the platform's "opinion."
//   2. User reviews / scam reports are §230-shielded USER content — we are not the publisher. Each is
//      tagged { authoredBy: 'user', kind: 'user-report' } and is NEVER presented as a platform claim.
//   3. The platform NEVER renders a verdict. There is NO function anywhere that labels a business
//      "scam" / "bad" / "fraud". A Clarity-style score may SUMMARIZE the facts, but it is rendered as
//      "based on official records" and the render ALWAYS carries a right-of-reply box.
//   4. Yelp / Google reviews are WINDOWED, never stored: link out + attribute. A windowed review
//      carries { stored: false } — it lives behind a link, not in our store.
//   assertNoVerdict(page) is the runnable safety check: it THROWS if any field has slipped a
//   conclusory verdict label in where only sourced facts belong.
//
// REUSE: the gov readers already in this repo are imported DEFENSIVELY (best-effort dynamic import,
// soft-fail to a no-op) so this file works standalone and never hard-depends on a sibling's location.
// __setSources({...}) overrides them with fakes for fully-offline tests. Every section soft-fails on
// its own: if one source throws, that section is empty and the rest of the page still renders.
//
//   import { businessPage, assertNoVerdict, addScamReport, renderPage,
//            esc, clarityFromRecords, __setSources } from './local-business-intel.mjs'
//   node integrations/local-business-intel.mjs "Acme Diner" "Austin, TX"

// ── HTML escape — every interpolated value passes through this before reaching markup ──────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const str = (v) => (v == null ? '' : String(v)).trim();
const now = () => new Date().toISOString();
const arr = (v) => (Array.isArray(v) ? v : []);

// Conclusory verdict words the PLATFORM must never assert about a business. These are the labels that
// turn a sourced fact into our speech (defamation / business-disparagement risk). They are allowed to
// appear inside USER content (authoredBy:'user', §230) — assertNoVerdict only polices platform fields.
export const VERDICT_LABELS = Object.freeze([
  'scam', 'fraud', 'fraudulent', 'scammer', 'crook', 'criminal', 'thief', 'liar',
  'bad', 'evil', 'dangerous', 'avoid', 'untrustworthy', 'dishonest', 'corrupt',
]);

// ── defensive reuse of the gov readers (best-effort; soft-fail to a no-op) ─────────────────────────
// Each source is a thin async fn returning an ARRAY of facts (or []). The real readers live in
// integrations/soapbox/*. We wrap each import in try/catch so a missing/moved module never breaks
// this file. __setSources() replaces these with injected fakes for offline tests.

const noop = async () => [];

async function tryImport(path) {
  try { return await import(path); } catch { return null; }
}

// Normalize a single reader hit into a hosted FACT record. Source + asOf + kind:'fact' are mandatory.
function factOf({ source, sourceUrl, asOf, title, detail } = {}) {
  const src = str(source);
  if (!src) return null; // a fact MUST be attributable to its official source
  return {
    kind: 'fact',
    source: src,
    sourceUrl: str(sourceUrl) || null,
    asOf: str(asOf) || null,
    title: str(title) || null,
    detail: str(detail) || null,
  };
}

// Default source adapters. Each takes the business descriptor and returns Promise<fact[]>. They map a
// reader's native shape into our flat FACT record. Built lazily so the dynamic import only happens once.
function defaultSources() {
  return {
    // openFDA food/device/cosmetic recalls + enforcement.
    fdaRecalls: async ({ name }) => {
      const m = await tryImport('./soapbox/fda-recalls.mjs');
      if (!m || typeof m.summary !== 'function') return [];
      const data = await m.summary({ limit: 10 }).catch(() => null);
      const rows = [...arr(data?.food), ...arr(data?.device), ...arr(data?.recalls)];
      return rows
        .filter((r) => !name || JSON.stringify(r).toLowerCase().includes(str(name).toLowerCase()))
        .map((r) => factOf({
          source: 'openFDA', sourceUrl: r.url || 'https://www.fda.gov/safety/recalls',
          asOf: r.recall_initiation_date || r.report_date || r.asOf,
          title: r.product_description || r.reason_for_recall || 'FDA recall',
          detail: r.reason_for_recall || r.status,
        }))
        .filter(Boolean);
    },
    // CPSC SaferProducts recalls + penalties.
    cpscRecalls: async ({ name }) => {
      const m = await tryImport('./soapbox/cpsc-recalls.mjs');
      if (!m || typeof m.recalls !== 'function') return [];
      const rows = await m.recalls({ query: str(name), limit: 10 }).catch(() => []);
      return arr(rows).map((r) => factOf({
        source: 'CPSC SaferProducts', sourceUrl: r.url || 'https://www.saferproducts.gov',
        asOf: r.recallDate || r.date || r.asOf,
        title: r.title || r.name || 'CPSC recall',
        detail: r.hazard || r.description,
      })).filter(Boolean);
    },
    // CFPB consumer-finance complaints (about the business as a company).
    cfpbComplaints: async ({ name }) => {
      const m = await tryImport('./soapbox/cfpb.mjs');
      if (!m || typeof m.complaints !== 'function') return [];
      const rows = await m.complaints({ company: str(name), size: 10 }).catch(() => []);
      return arr(rows).map((r) => factOf({
        source: 'CFPB', sourceUrl: r.url || 'https://www.consumerfinance.gov/complaint',
        asOf: r.date_received || r.date || r.asOf,
        title: r.product || r.issue || 'CFPB complaint',
        detail: r.issue || r.company_response,
      })).filter(Boolean);
    },
    // SEC EDGAR filings (if the business is a registered company).
    secFilings: async ({ name, registrationId }) => {
      const m = await tryImport('./soapbox/sec-edgar.mjs');
      if (!m) return [];
      let rows = [];
      try {
        if (registrationId && typeof m.recentFilings === 'function') {
          rows = await m.recentFilings({ cik: registrationId, limit: 10 });
        } else if (typeof m.fullTextSearch === 'function') {
          rows = await m.fullTextSearch({ q: str(name), limit: 10 });
        }
      } catch { rows = []; }
      return arr(rows).map((r) => factOf({
        source: 'SEC EDGAR', sourceUrl: r.url || 'https://www.sec.gov/cgi-bin/browse-edgar',
        asOf: r.filingDate || r.date || r.asOf,
        title: r.form || r.type || 'SEC filing',
        detail: r.primaryDocDescription || r.description,
      })).filter(Boolean);
    },
    // OSM identity / location spine.
    identity: async ({ name, location }) => {
      const m = await tryImport('./soapbox/osm-poi.mjs');
      if (!m || typeof m.geocode !== 'function') return null;
      const hit = await m.geocode(str(location) || str(name)).catch(() => null);
      if (!hit) return null;
      return {
        name: str(name) || hit.name || null,
        displayName: hit.display_name || hit.displayName || null,
        lat: hit.lat ?? null,
        lon: hit.lon ?? null,
        source: 'OpenStreetMap',
        sourceUrl: hit.url || 'https://www.openstreetmap.org',
      };
    },
    // Census ACS neighborhood context.
    neighborhood: async ({ census } = {}) => {
      const m = await tryImport('./soapbox/census-acs.mjs');
      if (!m || typeof m.profile !== 'function' || !census) return null;
      const p = await m.profile(census).catch(() => null);
      if (!p) return null;
      return { ...p, source: 'US Census ACS', sourceUrl: 'https://www.census.gov/programs-surveys/acs' };
    },
    // The platform's OWN storable user reviews (users review ON SoapBox). Injected in production from
    // the review store; default returns none so the module is inert without a store.
    ownReviews: async () => [],
    // Windowed reviews (Yelp/Google) — link out only, NEVER stored. Injected in production.
    windowedReviews: async () => [],
    // User-contributed scam reports (§230). Injected in production from the scam-report store.
    scamReports: async () => [],
  };
}

let _sources = defaultSources();
/** Override the data sources with injected fakes (offline tests) or production stores. */
export function __setSources(s) {
  _sources = s && typeof s === 'object' ? { ...defaultSources(), ...s } : defaultSources();
}
/** Restore the default (defensively-imported) sources. */
export function __resetSources() { _sources = defaultSources(); }

// Run one source fn with per-section soft-fail: any throw / rejection resolves to the fallback.
async function soft(fn, args, fallback) {
  try {
    const v = await fn(args);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

// ── user-content tagging (§230) ───────────────────────────────────────────────────────────────────
// A stored own-review is user content: authoredBy:'user', kind:'user-report'. Text is escaped at render
// time (we keep raw here so the store stays faithful), and it is NEVER the platform's claim.
function tagUserReview(r) {
  return {
    kind: 'user-report',
    authoredBy: 'user',
    user: str(r.user) || 'anonymous',
    text: str(r.text),
    rating: Number.isFinite(Number(r.rating)) ? Number(r.rating) : null,
    asOf: str(r.asOf) || str(r.date) || now(),
    stored: true, // it lives in OUR store (the storable own-review layer)
  };
}

// A windowed review is attributed + linked but NEVER stored: stored:false is the structural guarantee.
function tagWindowedReview(r) {
  return {
    kind: 'windowed-review',
    authoredBy: 'user',
    platform: str(r.platform) || 'external',
    url: str(r.url) || null,
    snippet: str(r.snippet) || null, // a short attributed excerpt shown behind the link
    asOf: str(r.asOf) || str(r.date) || null,
    stored: false, // WINDOWED, not hosted — we link out, we do not cache it
  };
}

// A scam report is §230 user content. Same tagging as a user review, distinct kind.
function tagScamReport(r) {
  return {
    kind: 'user-report',
    reportType: 'scam-report',
    authoredBy: 'user',
    user: str(r.user) || 'anonymous',
    text: str(r.text),
    asOf: str(r.asOf) || str(r.date) || now(),
    stored: true,
  };
}

// ── Clarity score — SUMMARIZES FACTS ONLY, renders its basis, never a verdict ──────────────────────
/**
 * Derive a Clarity-style score from OFFICIAL RECORDS ONLY. It is a transparency summary of how many
 * adverse official facts exist, NOT a judgement. basis is always 'official-records-only'. The score
 * never reads user reviews or scam reports (those are §230 content, not our speech). There is NO label
 * field — only a number + the count + the basis. The render must show "based on official records".
 */
export function clarityFromRecords(officialRecords = []) {
  const facts = arr(officialRecords).filter((r) => r && r.kind === 'fact');
  const adverse = facts.length;
  // Simple, transparent: start at 100, subtract for each adverse official record, floor at 0.
  const score = Math.max(0, 100 - adverse * 10);
  return {
    score,
    basis: 'official-records-only',
    officialRecordCount: adverse,
    note: 'Based on official government records only. Not a verdict. See right-of-reply.',
  };
}

// ── the assembler ──────────────────────────────────────────────────────────────────────────────────
/**
 * Assemble ONE business page. Every section soft-fails independently: a source that throws yields an
 * empty section while the rest of the page still renders. Returns:
 *   { identity, officialRecords:[fact], reviews:{ own:[user], windowed:[stored:false] },
 *     scamReports:[user, §230], neighborhood:{census}, clarity:{score, basis}, rightOfReply:{open,howTo} }
 */
export async function businessPage(business = {}, opts = {}) {
  const name = str(business.name);
  const location = str(business.location);
  const registrationId = str(business.registrationId);
  const census = business.census || opts.census || null;
  const args = { name, location, registrationId, census };
  const S = _sources;

  // Identity (OSM + the descriptor). Soft-fail → minimal identity from the descriptor.
  const identity = (await soft(S.identity, args, null)) || {
    name: name || null, displayName: null, lat: null, lon: null,
    source: null, sourceUrl: null,
  };
  if (!identity.name) identity.name = name || null;
  identity.registrationId = registrationId || null;

  // Official records — FACTS. Each source soft-fails to [] on its own.
  const recordGroups = await Promise.all([
    soft(S.fdaRecalls, args, []),
    soft(S.cpscRecalls, args, []),
    soft(S.cfpbComplaints, args, []),
    soft(S.secFilings, args, []),
  ]);
  const officialRecords = recordGroups
    .flat()
    .filter((r) => r && r.kind === 'fact' && r.source); // belt-and-suspenders: only real facts

  // Reviews: own (stored, §230 user content) + windowed (stored:false, link-out only).
  const own = arr(await soft(S.ownReviews, args, [])).map(tagUserReview);
  const windowed = arr(await soft(S.windowedReviews, args, [])).map(tagWindowedReview);

  // Scam reports — §230 user content, never our claim.
  const scamReports = arr(await soft(S.scamReports, args, [])).map(tagScamReport);

  // Neighborhood context (Census). Soft-fail → null.
  const neighborhood = (await soft(S.neighborhood, args, null)) || null;

  // Clarity — summarizes OFFICIAL RECORDS ONLY. Never user content.
  const clarity = clarityFromRecords(officialRecords);

  return {
    kind: 'business-page',
    identity,
    officialRecords,
    reviews: { own, windowed },
    scamReports,
    neighborhood: neighborhood ? { census: neighborhood } : { census: null },
    clarity,
    rightOfReply: {
      open: true, // ALWAYS open — the safety valve + on-brand fairness
      howTo: 'The subject of this page may submit a response or dispute any record. '
        + 'Contact: rightofreply@soapbox.community — we publish replies alongside the records.',
    },
  };
}

// ── the safety check: assertNoVerdict ──────────────────────────────────────────────────────────────
/**
 * Throw if any PLATFORM field carries a conclusory verdict label rather than a sourced fact. User
 * content (authoredBy:'user') is §230-shielded and is NOT policed — only the platform's own speech.
 * Policed surfaces: identity, officialRecords (must be kind:'fact'), clarity (no label field), and any
 * stray top-level field. This is the runnable guarantee behind "we never render the verdict."
 */
export function assertNoVerdict(page) {
  if (!page || typeof page !== 'object') throw new Error('assertNoVerdict: not a page');

  const hasVerdictWord = (s) => {
    const t = str(s).toLowerCase();
    if (!t) return null;
    for (const w of VERDICT_LABELS) {
      // word-boundary match so "scam" trips but "scampi" / a sourced detail string does not falsely.
      if (new RegExp(`\\b${w}\\b`).test(t)) return w;
    }
    return null;
  };

  // 1. Clarity must NOT carry a label/verdict field — only score + basis + count + note.
  const c = page.clarity || {};
  if ('label' in c || 'verdict' in c || 'rating' in c) {
    throw new Error('assertNoVerdict: clarity carries a verdict label — only score/basis allowed');
  }
  if (c.basis && c.basis !== 'official-records-only') {
    throw new Error(`assertNoVerdict: clarity.basis must be official-records-only, got "${c.basis}"`);
  }

  // 2. Identity is descriptive only — no verdict field, no verdict word in its platform-authored fields.
  const id = page.identity || {};
  if ('verdict' in id || 'label' in id) throw new Error('assertNoVerdict: identity carries a verdict label');
  for (const f of ['name', 'displayName']) {
    // name is operator/OSM-supplied descriptive text; a bare verdict word standing as a label is the risk.
    // We only trip if the field IS a verdict word (not merely contains one in a real business name).
    if (VERDICT_LABELS.includes(str(id[f]).toLowerCase())) {
      throw new Error(`assertNoVerdict: identity.${f} is a bare verdict label`);
    }
  }

  // 3. Official records must be FACTS with a source — never a platform verdict masquerading as a record.
  for (const r of arr(page.officialRecords)) {
    if (!r || r.kind !== 'fact') throw new Error('assertNoVerdict: an official record is not kind:fact');
    if (!r.source) throw new Error('assertNoVerdict: an official record has no source');
    if ('verdict' in r) throw new Error('assertNoVerdict: an official record carries a verdict field');
  }

  // 4. Any top-level field that injects a verdict the platform would be asserting.
  for (const key of ['verdict', 'label', 'judgement', 'judgment', 'rating']) {
    if (key in page) throw new Error(`assertNoVerdict: page carries a top-level platform verdict "${key}"`);
  }
  if (hasVerdictWord(page.summary)) {
    throw new Error('assertNoVerdict: page.summary asserts a verdict word as platform speech');
  }

  return true;
}

// ── addScamReport: append a §230-tagged user report ────────────────────────────────────────────────
/**
 * Append a user-authored scam report to a page. It is ALWAYS authoredBy:'user' (we never author it) and
 * kind:'user-report'. The raw text is kept faithful (escaped at render time). Returns the appended record.
 */
export function addScamReport(page, { user, text } = {}) {
  if (!page || typeof page !== 'object') throw new Error('addScamReport: not a page');
  if (!Array.isArray(page.scamReports)) page.scamReports = [];
  const rec = tagScamReport({ user, text });
  page.scamReports.push(rec);
  return rec;
}

// ── renderPage: escaped HTML business page ─────────────────────────────────────────────────────────
function factLine(r) {
  const link = r.sourceUrl
    ? `<a class="src" href="${esc(r.sourceUrl)}" rel="nofollow noopener">${esc(r.source)}</a>`
    : `<span class="src">${esc(r.source)}</span>`;
  const asOf = r.asOf ? ` <span class="asof">(as of ${esc(r.asOf)})</span>` : '';
  const detail = r.detail ? ` — ${esc(r.detail)}` : '';
  return `<li><span class="fact-title">${esc(r.title || 'record')}</span>${detail}${asOf} — ${link}</li>`;
}

function ownReviewLine(r) {
  const rating = r.rating != null ? ` <span class="rating">${esc(r.rating)}/5</span>` : '';
  return `<li class="user-review"><span class="byline">${esc(r.user)} (user)</span>${rating}: `
    + `<span class="text">${esc(r.text)}</span> <span class="asof">(${esc(r.asOf)})</span></li>`;
}

function windowedReviewLine(r) {
  const link = r.url
    ? `<a href="${esc(r.url)}" rel="nofollow noopener">read on ${esc(r.platform)}</a>`
    : `${esc(r.platform)}`;
  const snip = r.snippet ? ` <span class="snippet">"${esc(r.snippet)}"</span>` : '';
  return `<li class="windowed-review">${esc(r.platform)} review (linked, not stored):${snip} ${link}</li>`;
}

function scamReportLine(r) {
  return `<li class="scam-report"><span class="byline">${esc(r.user)} (user report)</span>: `
    + `<span class="text">${esc(r.text)}</span> <span class="asof">(${esc(r.asOf)})</span></li>`;
}

/**
 * Render a business page as escaped HTML. Facts section is sourced; reviews are clearly user-authored
 * (own + windowed-with-links); user reports are explicitly user content; neighborhood context; the
 * Clarity score shows its basis ("based on official records"); the right-of-reply box ALWAYS appears.
 */
export function renderPage(page) {
  if (!page || typeof page !== 'object') return '<article class="business-page"></article>';
  const id = page.identity || {};
  const c = page.clarity || {};
  const sec = (cls, title, items, lineFn, emptyMsg) => {
    const body = (items && items.length)
      ? `<ul>${items.map(lineFn).join('')}</ul>`
      : `<p class="empty">${esc(emptyMsg || 'No entries.')}</p>`;
    return `<section class="${cls}"><h3>${esc(title)}</h3>${body}</section>`;
  };

  const loc = id.displayName || (id.lat != null && id.lon != null ? `${id.lat}, ${id.lon}` : '');
  const idSrc = id.sourceUrl
    ? `<a class="src" href="${esc(id.sourceUrl)}" rel="nofollow noopener">${esc(id.source || 'source')}</a>`
    : (id.source ? `<span class="src">${esc(id.source)}</span>` : '');

  const census = page.neighborhood && page.neighborhood.census;
  const neighborhoodSec = census
    ? `<section class="neighborhood"><h3>Neighborhood context</h3>`
      + `<p>Census ACS demographic context for this location.</p>`
      + (census.sourceUrl ? `<p class="src"><a href="${esc(census.sourceUrl)}" rel="nofollow noopener">US Census ACS</a></p>` : '')
      + `</section>`
    : `<section class="neighborhood"><h3>Neighborhood context</h3><p class="empty">No neighborhood data.</p></section>`;

  const claritySec = `<section class="clarity"><h3>Clarity Score</h3>`
    + `<p class="clarity-score">${esc(c.score == null ? 'n/a' : c.score)}</p>`
    + `<p class="clarity-basis">Based on official government records only`
    + ` (${esc(c.officialRecordCount == null ? 0 : c.officialRecordCount)} official record(s)).`
    + ` This is not a verdict.</p></section>`;

  const ror = page.rightOfReply || { open: true, howTo: '' };
  const rightOfReplySec = `<section class="right-of-reply"><h3>Right of reply</h3>`
    + `<p>This page is open for response. The subject may reply to or dispute any record.</p>`
    + (ror.howTo ? `<p class="howto">${esc(ror.howTo)}</p>` : '')
    + `</section>`;

  return [
    `<article class="business-page">`,
    `<h2>${esc(id.name || 'Business')}</h2>`,
    loc ? `<p class="location">${esc(loc)} ${idSrc}</p>` : (idSrc ? `<p class="location">${idSrc}</p>` : ''),
    `<p class="disclaimer">Official records are stated as facts from their sources. `
      + `Reviews and reports below are user-contributed and are not the platform's claims.</p>`,
    sec('official-records', 'Official records (facts)', page.officialRecords, factLine,
      'No official records found.'),
    sec('own-reviews', 'Reviews on SoapBox (user-authored)', page.reviews && page.reviews.own, ownReviewLine,
      'No SoapBox reviews yet.'),
    sec('windowed-reviews', 'Reviews elsewhere (linked, not stored)', page.reviews && page.reviews.windowed,
      windowedReviewLine, 'No external reviews linked.'),
    sec('scam-reports', 'User reports', page.scamReports, scamReportLine,
      'No user reports.'),
    neighborhoodSec,
    claritySec,
    rightOfReplySec, // ALWAYS rendered
    `</article>`,
  ].filter(Boolean).join('\n');
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────────
const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();

if (isMain) {
  const [name, location, registrationId] = process.argv.slice(2);
  if (!name) {
    process.stdout.write('usage: node integrations/local-business-intel.mjs "<name>" ["<location>"] ["<registrationId>"]\n');
  } else {
    const page = await businessPage({ name, location, registrationId });
    assertNoVerdict(page); // prove the assembled page renders no verdict
    process.stdout.write(`official records: ${page.officialRecords.length}, `
      + `own reviews: ${page.reviews.own.length}, windowed: ${page.reviews.windowed.length}, `
      + `scam reports: ${page.scamReports.length}, clarity: ${page.clarity.score} (${page.clarity.basis})\n`);
    process.stdout.write(renderPage(page) + '\n');
  }
}
