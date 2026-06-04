// jobs-courses.mjs — the SoapBox "find work + learn the skill" aggregator (queue #240). One page-ready
// surface over three labor/learning marketplaces, normalized so the site can render unified tables:
//   • Jobs      — Indeed / ZipRecruiter / LinkedIn model. The GOV slice reuses fed-opportunities.mjs
//                 (USAJOBS), which already speaks the key-by-env-NAME, soft-fail discipline. Private
//                 boards (Adzuna/USAJOBS-style windowed search) normalize into the same row.
//   • Freelance — Upwork / Fiverr / Freelancer model. Gig listings normalized.
//   • Courses   — Class Central model. Online courses normalized; FREE / open courses ranked FIRST.
//
// This is the OPEN side of the labor market — work you can take + skills you can learn — distinct from
// fed-opportunities.mjs's federal-money lens. It imports fed-opportunities ONLY for the gov-jobs slice.
//
// SECRETS: never a literal key in this file. Provider keys are referenced ONLY by env NAME (e.g.
// ADZUNA_APP_ID / ADZUNA_APP_KEY for jobs, USAJOBS_* via fed-opportunities). A reader missing its key
// soft-fails to [] WITHOUT a network call. Every list reader soft-fails to [] on any error.
//
// HONEST RANKING (the moat): rankResults() orders by RELEVANCE + RECENCY, never by commission. Outbound
// "apply"/"enroll" links carry an FTC disclosure where they're affiliate-tagged (applyOut, via the #215
// affiliate engine, defensively imported). FREE/open courses come first. We never sell user data.
//
//   import { searchJobs, searchFreelance, searchCourses, rankResults, applyOut, renderPage, dataNote }
//   node integrations/soapbox/jobs-courses.mjs jobs "nurse" "Austin, TX"

const str = (s) => String(s == null ? '' : s).trim();
const num = (n, d = null) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
const capLimit = (n) => Math.min(Math.max(num(n, 10), 1), 100);
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
const now = () => new Date().toISOString();

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// --- defensive import of the affiliate engine (#215; never duplicate) -------
// Import softly: if the engine is absent/broken, outbound links degrade to plain (untagged) URLs with
// the generic disclosure and the page still renders. We never inline an affiliate id or a disclosure
// string of our own — we ask affiliate.mjs.
let _affiliate = null;
try {
  _affiliate = await import('../affiliate.mjs');
} catch {
  _affiliate = null; // soft-fail: jobs/courses work without monetization; disclosure falls back below.
}

// Generic FTC line used when the engine is unavailable; otherwise we use the engine's.
function fallbackDisclosure() {
  return 'Disclosure: some links are affiliate links — we may earn a commission at no extra cost to '
    + 'you. Commissions never affect our ranking, and we never sell your data.';
}
function ftcDisclosure() {
  return _affiliate && typeof _affiliate.ftcDisclosure === 'function'
    ? _affiliate.ftcDisclosure() : fallbackDisclosure();
}

// Env var NAMES holding credentials — read by name only, never inlined. Adzuna is the windowed private
// jobs source (free dev tier: app id + key). Gov jobs go through fed-opportunities (USAJOBS_*).
export const API_KEY_ENV = {
  jobsAppId: 'ADZUNA_APP_ID',
  jobsAppKey: 'ADZUNA_APP_KEY',
};

// Source endpoints (private boards). Gov jobs come from fed-opportunities.mjs, not here.
export const ENDPOINTS = {
  jobs: 'https://api.adzuna.com/v1/api/jobs',
};

// ── searchJobs({ query, location, limit, includeGov }, { fetch }) ─────────────────────────────────────
// Unified job search. Two slices, both normalized to:
//   { title, company, location, remote, postedAt, url, source }
//   1) GOV jobs — reuse fed-opportunities.mjs (USAJOBS). It soft-fails to [] when its key is absent, so
//      this stays additive. Mapped from the federal job shape into our normalized row.
//   2) PRIVATE jobs — Adzuna windowed search (app id + key by env NAME). Absent ⇒ skipped (no call).
// Soft-fails to [] on any error. `fetch` may be injected per-call (overrides __setFetch for this call).
export async function searchJobs({ query = '', location = '', limit = 10, includeGov = true } = {}, opts = {}) {
  const fetch = opts.fetch || _fetch;
  const out = [];
  // 1) Gov slice via fed-opportunities (best-effort; never throws past here).
  if (includeGov) {
    try {
      const fed = await import('./fed-opportunities.mjs');
      if (typeof fed.__setFetch === 'function') fed.__setFetch(fetch);
      const rows = await fed.jobs({ keyword: str(query), location: str(location), limit });
      for (const r of Array.isArray(rows) ? rows : []) {
        const loc = str(r.location);
        out.push({
          title: str(r.title) || null,
          company: str(r.agency) || null,
          location: loc || null,
          remote: /remote|telework|anywhere/i.test(loc),
          postedAt: str(r.closeDate) || null, // USAJOBS exposes close date, not posted; best available.
          url: str(r.url) || null,
          source: 'USAJOBS',
        });
      }
      if (typeof fed.__setFetch === 'function') fed.__setFetch(); // restore engine's global.
    } catch { /* gov slice is best-effort; ignore and continue with private boards */ }
  }
  // 2) Private slice via Adzuna (key by env NAME; absent ⇒ no call).
  const appId = process.env[API_KEY_ENV.jobsAppId];
  const appKey = process.env[API_KEY_ENV.jobsAppKey];
  if (appId && appKey) {
    try {
      const p = new URLSearchParams();
      p.set('app_id', appId);
      p.set('app_key', appKey);
      if (str(query)) p.set('what', str(query));
      if (str(location)) p.set('where', str(location));
      p.set('results_per_page', String(capLimit(limit)));
      const r = await fetch(`${ENDPOINTS.jobs}/us/search/1?${p.toString()}`, { headers: { Accept: 'application/json' } });
      if (r && r.ok) {
        const j = await r.json();
        const rows = j?.results;
        if (Array.isArray(rows)) {
          for (const it of rows) {
            const loc = str(it?.location?.display_name);
            out.push({
              title: str(it.title) || null,
              company: str(it?.company?.display_name) || null,
              location: loc || null,
              remote: truthy(it?.contract_time === 'remote') || /remote|anywhere|work from home/i.test(loc + ' ' + str(it.title)),
              postedAt: str(it.created) || null,
              url: str(it.redirect_url) || null,
              source: 'Adzuna',
            });
          }
        }
      }
    } catch { /* private slice best-effort */ }
  }
  return out;
}

// ── searchFreelance({ skill, limit }, { fetch }) ──────────────────────────────────────────────────────
// Freelance gig listings (Upwork/Freelancer model). Normalized to the same job row shape with
// remote:true (freelance is remote by nature) and company = the client/marketplace. Soft-fails to [].
// Provider feeds vary; we read a generic JSON list shape and normalize. Key-by-env-NAME if a provider
// needs one (none required for the keyless feed default); absent provider ⇒ [] with no call.
export async function searchFreelance({ skill = '', limit = 10 } = {}, opts = {}) {
  const fetch = opts.fetch || _fetch;
  try {
    const p = new URLSearchParams();
    if (str(skill)) p.set('q', str(skill));
    p.set('limit', String(capLimit(limit)));
    // Freelancer.com active-projects search (keyless read). Normalized defensively from whatever shape
    // comes back; any miss collapses to [].
    const r = await fetch(`https://www.freelancer.com/api/projects/0.1/projects/active/?${p.toString()}`, { headers: { Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = j?.result?.projects || j?.projects;
    if (!Array.isArray(rows)) return [];
    return rows.map((g) => {
      const id = str(g.id || g.seo_url);
      const budget = g?.budget ? `${str(g.budget.minimum)}-${str(g.budget.maximum)} ${str(g.currency?.code)}`.trim() : null;
      return {
        title: str(g.title) || null,
        company: 'Freelancer.com (client)',
        location: 'Remote',
        remote: true,
        budget: budget || null,
        postedAt: g.time_submitted ? new Date(num(g.time_submitted, 0) * 1000).toISOString() : null,
        url: g.seo_url ? `https://www.freelancer.com/projects/${esc(g.seo_url)}` : (id ? `https://www.freelancer.com/projects/${encodeURIComponent(id)}` : null),
        source: 'Freelancer',
      };
    });
  } catch { return []; }
}

// ── searchCourses({ topic, limit }, { fetch }) ────────────────────────────────────────────────────────
// Online courses (Class Central model). Normalized to: { title, provider, free, url }. FREE / open
// courses are surfaced FIRST (prefer-free-first is an explicit policy here, not just a render choice):
// the returned array is sorted free-before-paid. Soft-fails to []. Keyless read; defensively normalized.
export async function searchCourses({ topic = '', limit = 10 } = {}, opts = {}) {
  const fetch = opts.fetch || _fetch;
  try {
    const p = new URLSearchParams();
    if (str(topic)) p.set('q', str(topic));
    p.set('limit', String(capLimit(limit)));
    const r = await fetch(`https://www.classcentral.com/api/courses?${p.toString()}`, { headers: { Accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = j?.courses || j?.results || (Array.isArray(j) ? j : null);
    if (!Array.isArray(rows)) return [];
    const items = rows.map((c) => {
      // "free" is true when explicitly flagged OR price is zero/absent OR price-text says free/audit.
      const priceText = str(c.price || c.cost);
      const free = truthy(c.free) || truthy(c.is_free)
        || num(c.price, null) === 0
        || /free|audit|open|no cost/i.test(priceText)
        || (priceText === '' && c.free == null && c.price == null && !truthy(c.paid));
      return {
        title: str(c.title || c.name) || null,
        provider: str(c.provider || c.institution || c.platform) || null,
        free: !!free,
        url: str(c.url || c.link) || null,
        source: 'Class Central',
      };
    });
    // free-first, then keep input order within each group (stable).
    return items
      .map((v, i) => [v, i])
      .sort((a, b) => (Number(b[0].free) - Number(a[0].free)) || (a[1] - b[1]))
      .map(([v]) => v)
      .slice(0, capLimit(limit));
  } catch { return []; }
}

// ── rankResults(items) — relevance + recency, NEVER commission ────────────────────────────────────────
// Honest ordering for jobs/freelance/course rows. Higher relevance first, then more-recent (postedAt)
// first; commission/payout is DELIBERATELY absent from the comparator. Returns a NEW array, input not
// mutated. Items may carry an optional numeric `relevance`; rows without a date sort after dated rows.
export function rankResults(items = []) {
  const arr = Array.isArray(items) ? items.slice() : [];
  const time = (x) => { const t = Date.parse(str(x?.postedAt)); return Number.isFinite(t) ? t : -Infinity; };
  const rel = (x) => num(x?.relevance, 0);
  return arr
    .map((v, i) => [v, i])
    .sort((a, b) => {
      const dr = rel(b[0]) - rel(a[0]);
      if (dr) return dr;                 // relevance, descending
      const dt = time(b[0]) - time(a[0]);
      if (dt) return dt;                 // recency, descending
      return a[1] - b[1];                // stable: keep input order
    })
    .map(([v]) => v);
}

// ── applyOut(item) — affiliate-tagged outbound where applicable ───────────────────────────────────────
// Build the "apply"/"enroll" link for a row. If the affiliate engine is present AND the row names a
// known affiliate `network` AND that network's id env is set, we return the TAGGED url. Otherwise we
// soft-fail to the PLAIN url with configured:false and a disclosure. NEVER fabricates an id; never
// throws. Returns { url, configured, disclosure, network, reason? }.
export function applyOut(item = {}) {
  const plain = str(item?.url);
  const disclosure = ftcDisclosure();
  if (!plain) return { url: '', configured: false, disclosure, network: item?.network || null, reason: 'no url' };
  if (_affiliate && typeof _affiliate.affiliateLink === 'function' && item?.network) {
    try {
      const link = _affiliate.affiliateLink({ network: item.network, url: plain, subId: item.subId });
      return {
        url: str(link?.url) || plain,
        configured: !!link?.configured,
        disclosure: str(link?.disclosure) || disclosure,
        network: link?.network || item.network || null,
        reason: link?.reason,
      };
    } catch { /* fall through to plain */ }
  }
  // No engine, no network, or no tag: plain url, not configured.
  return { url: plain, configured: false, disclosure, network: item?.network || null, reason: 'not configured' };
}

// ── dataNote() — provenance + as-of ───────────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Sources: USAJOBS (gov) / Adzuna (jobs) / Freelancer (gigs) / Class Central (courses), as of ${asOf}. `
    + 'Listings are as published and may close or change; rankings are by relevance and recency, never by '
    + 'commission. Confirm on the source site before applying or enrolling.';
}

// ── renderPage(data) — escaped HTML listings + disclosure ─────────────────────────────────────────────
// `data` may be a flat array of rows, or { jobs, freelance, courses }. EVERY field is escaped before it
// reaches markup — a hostile title/company/provider cannot inject HTML. Jobs/freelance render as a
// listings table; courses render with a FREE badge (free-first ordering preserved). The FTC disclosure
// is always present.
export function renderPage(data = {}) {
  const isArr = Array.isArray(data);
  const jobs = isArr ? data : [...(Array.isArray(data.jobs) ? data.jobs : []), ...(Array.isArray(data.freelance) ? data.freelance : [])];
  const courses = isArr ? [] : (Array.isArray(data.courses) ? data.courses : []);

  const jobRow = (r) => `      <tr>
        <td>${r.url ? `<a href="${esc(applyOut(r).url)}" rel="nofollow noopener" target="_blank">${esc(r.title)}</a>` : esc(r.title)}</td>
        <td>${esc(r.company)}</td>
        <td>${esc(r.location)}</td>
        <td>${r.remote ? 'Remote' : ''}</td>
        <td>${esc(r.postedAt)}</td>
        <td>${esc(r.source)}</td>
      </tr>`;
  const jobsBody = jobs.map(jobRow).join('\n')
    || '      <tr><td colspan="6">No jobs or gigs found.</td></tr>';

  const courseRow = (c) => `      <li>
        ${c.url ? `<a href="${esc(applyOut(c).url)}" rel="nofollow noopener" target="_blank">${esc(c.title)}</a>` : esc(c.title)}
        <span class="course-provider">${esc(c.provider)}</span>
        ${c.free ? '<span class="course-badge course-free">Free</span>' : '<span class="course-badge course-paid">Paid</span>'}
      </li>`;
  const coursesBlock = courses.length
    ? `  <h2>Courses — free & open first</h2>
  <ul class="course-list">
${courses.map(courseRow).join('\n')}
  </ul>`
    : '';

  const discloseHtml = _affiliate && typeof _affiliate.disclose === 'function'
    ? _affiliate.disclose('')
    : `<p class="ftc-disclosure">${esc(fallbackDisclosure())}</p>`;

  return `<section class="jobs-courses">
  <h2>Jobs & Freelance</h2>
  <table>
    <thead>
      <tr><th>Title</th><th>Company</th><th>Location</th><th>Remote</th><th>Posted</th><th>Source</th></tr>
    </thead>
    <tbody>
${jobsBody}
    </tbody>
  </table>
${coursesBlock}
  <p class="data-note">${esc(dataNote())}</p>
  ${discloseHtml}
</section>`;
}

// ── CLI: node integrations/soapbox/jobs-courses.mjs <jobs|freelance|courses> <query> [location] ─────────
if (process.argv[1] && process.argv[1].endsWith('jobs-courses.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  let rows = [];
  if (cmd === 'jobs') rows = rankResults(await searchJobs({ query: rest[0] || '', location: rest[1] || '' }));
  else if (cmd === 'freelance') rows = rankResults(await searchFreelance({ skill: rest.join(' ') }));
  else if (cmd === 'courses') rows = await searchCourses({ topic: rest.join(' ') });
  else { console.log('usage: jobs-courses.mjs <jobs|freelance|courses> <query> [location]'); process.exit(0); }
  console.log(`\n# ${cmd} (${rows.length})\n`);
  for (const r of rows.slice(0, 15)) {
    if (cmd === 'courses') console.log(`  - ${r.free ? '[FREE]' : '[paid]'} ${(r.title || '').slice(0, 56)} — ${r.provider || ''}`);
    else console.log(`  - ${(r.title || '').slice(0, 56)} — ${r.company || ''}${r.remote ? ' (remote)' : ''}`);
  }
  console.log('\n' + dataNote());
}
