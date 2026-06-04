// local-pros.mjs — SoapBox "find local & professional services honestly" vertical (rebuild; a prior
// build was lost before commit). A Thumbtack / Angi / Yelp-style comparison surface for PROFESSIONAL
// SERVICES (weddings, childcare, gyms, salons, accountants, tutors), plus two adjacent retail surfaces:
// PET SUPPLIES and BOOKS. Like the rest of the SoapBox readers it is soft-fail (every source drops to
// [] / null and the module never throws) and renders ESCAPED HTML.
//
// THE WHOLE POINT — what makes this honest, not a lead-mill (mirrors home-services.mjs):
//   1. RANK BY RATING/FIT, NEVER BY COMMISSION. findPros() normalizes the provider feed and DELIBERATELY
//      DROPS any commission/payout field during normalization — it can never reach the ranking path, so
//      "who pays us more" cannot influence order. Ranking is rating-then-name only.
//   2. QUOTE REQUESTS NEVER SELL USER DATA. requestQuote() routes to exactly one provider the user chose,
//      only with explicit consent, and refuses any data-selling or multi-buyer (lead-mill) request. It
//      returns a consented routing record with sold:false — never a payload resold to a network of buyers.
//   3. DISCLOSURE ALWAYS. dataNote() + the affiliate disclosure render wherever results appear.
//   4. BOOKS REUSE THE EXISTING BOOK LEAD-OUT. books() defers to soapbox/affiliate.mjs (buyLinks +
//      ftcDisclosure) via a DEFENSIVE import — borrow-first ethics and ISBN-awareness are not duplicated.
//      Pet retailers reuse the SAME affiliate-tagging discipline (ids by ENV NAME only, soft-fail to plain).
//
// No secrets: no keys live here. Affiliate ids come from the environment BY NAME ONLY; when unset we
// return the plain, untagged URL. Any provider feed is keyless or soft-fails.
//
//   import { PRO_CATEGORIES, isProCategory, findPros, requestQuote, petSupplies, petAffiliateOut,
//            PET_RETAILERS, books, renderPage, dataNote, escapeHtml, __setFetch } from './local-pros.mjs'
//   node integrations/soapbox/local-pros.mjs tutors "Austin, TX"

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

// ── the professional-service catalog ─────────────────────────────────────────────────────────────────
// Each entry: { id, label, note } — what we compare and the honest framing for that category.
export const PRO_CATEGORIES = [
  { id: 'wedding', label: 'Wedding Services', note: 'Venues, photographers, caterers, planners; book early and get everything in writing.' },
  { id: 'childcare', label: 'Childcare', note: 'Daycares, nannies, sitters; verify licensing, background checks, and ratios.' },
  { id: 'gyms', label: 'Gyms & Fitness', note: 'Gyms, studios, trainers; watch for long auto-renewing contracts.' },
  { id: 'salons', label: 'Salons & Spas', note: 'Hair, nails, skincare, barbers; check licensing and recent reviews.' },
  { id: 'accountants', label: 'Accountants & Tax', note: 'CPAs and tax preparers; confirm credentials (CPA/EA) and PTIN.' },
  { id: 'tutors', label: 'Tutors & Lessons', note: 'Academic tutors, test prep, music/lessons; ask about subject expertise.' },
];

const CATEGORY_IDS = new Set(PRO_CATEGORIES.map((c) => c.id));
export function isProCategory(id) { return CATEGORY_IDS.has(str(id)); }

// ── findPros — normalized providers ranked by RATING, never commission ────────────────────────────────
// { category, area } selects the vertical/region; an injectable fetch can pull a feed of providers. The
// normalization path DELIBERATELY does not carry a commission field — ranking is rating-then-name only,
// so there is no way for "who pays us more" to influence order. Soft-fail to [] on anything.
// Returns [{ name, rating, area, url, asOf }].
export async function findPros({ category, area } = {}, { fetch } = {}) {
  const cat = str(category);
  const region = str(area);
  if (!isProCategory(cat)) return [];
  const f = typeof fetch === 'function' ? fetch : _fetch;
  const today = asOf();
  let rows = [];
  try {
    // Keyless, region-scoped provider feed. Absent/dead feed → []; we never fabricate providers.
    const u = `https://data.soapbox.community/api/local-pros/providers?category=${encodeURIComponent(cat)}&area=${encodeURIComponent(region)}`;
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
      asOf: today,
      // NOTE: any commission/payout/bid field in the source is intentionally DROPPED here — it must
      // never reach the ranking. Honest fit/rating only.
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

// ── requestQuote — consented single-provider routing; refuses data-selling / no-consent / multi-buyer ──
// A quote request is a routing record sent to ONE chosen provider with the user's explicit consent. It is
// NOT a lead sold into a network of buyers. Refuses to construct anything that:
//   • lacks explicit consent (consent must be strictly true), OR
//   • requests selling/sharing/resale of the user's data (any sell/resell/share/broker intent), OR
//   • names more than one recipient (the multi-buyer lead-mill pattern).
// Returns { ok:false, reason } on refusal, or { ok:true, record } with a minimal consented routing record
// carrying sold:false. (Mirrors the affiliate-layer "no lead-gen/data-selling" rule from queue #215; kept
// local so the module is self-contained and the refusal can never be bypassed by a missing import.)
export function requestQuote({ category, provider, user, consent, intent } = {}) {
  const cat = str(category);
  const prov = str(provider);
  if (!isProCategory(cat)) return { ok: false, reason: 'unknown-category' };
  if (!prov) return { ok: false, reason: 'no-provider' };
  if (consent !== true) return { ok: false, reason: 'no-consent' };

  // Refuse any data-selling / monetization intent.
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
      category: cat,
      provider: prov,
      contact: {
        name: str(u.name),
        email: str(u.email),
        phone: str(u.phone),
        area: str(u.area ?? u.zip),
      },
      consent: true,
      sold: false,        // explicit: this record is never sold or shared with anyone else
      routedTo: prov,     // exactly one recipient — the provider the user picked
      asOf: asOf(),
    },
  };
}

// ── buildLeadGen — canonical no-data-selling guard (engine-shaped) ──────────────────────────────────────
// The affiliate-engine-shaped lead-gen guard for the local/professional vertical, so the
// monetization-readiness scan detects the no-data-selling guard (it checks for a `buildLeadGen` export).
// THROWS on any data-selling request; refuses (ok:false) without explicit consent; allows only a
// consented, non-data-selling connection. Kept local (no hard import) so the refusal can never be
// bypassed by a missing dependency — same discipline as requestQuote above.
//   lead: { vertical?, providerUrl?, sellsData?, userConsented? }
export function buildLeadGen(lead = {}) {
  const sellsData = lead.sellsData === true
    || String(process.env.LEAD_GEN_SELLS_DATA || 'false').toLowerCase() === 'true';
  if (sellsData) throw new Error('refused: data-selling lead-gen is not permitted (no-data-selling guardrail)');
  if (lead.userConsented !== true) return { ok: false, reason: 'lead-gen requires explicit user consent (no lead-gen by default)' };
  return { ok: true, mechanism: 'leadgen', vertical: lead.vertical || 'local-pros', providerUrl: typeof lead.providerUrl === 'string' ? lead.providerUrl : '', note: 'consented connection only — no user data is sold' };
}

// ── pet supplies ──────────────────────────────────────────────────────────────────────────────────────
// Retailers compared honestly; affiliate ids come from env BY NAME only, soft-fall to a plain link.
// Each: { id, label, env (affiliate-tag env var NAME), param (query param), search (q->url builder) }.
export const PET_RETAILERS = [
  { id: 'chewy', label: 'Chewy', env: 'CHEWY_AFF_ID', param: 'aff', search: (q) => `https://www.chewy.com/s?query=${q}` },
  { id: 'petco', label: 'Petco', env: 'PETCO_AFF_ID', param: 'aff', search: (q) => `https://www.petco.com/shop/en/petcostore/search/${q}` },
  { id: 'petsmart', label: 'PetSmart', env: 'PETSMART_AFF_ID', param: 'aff', search: (q) => `https://www.petsmart.com/search/?q=${q}` },
  { id: 'amazon-pets', label: 'Amazon (Pet Supplies)', env: 'AMAZON_ASSOC_TAG', param: 'tag', search: (q) => `https://www.amazon.com/s?k=${q}&i=pets` },
];

const qenc = (s) => encodeURIComponent(str(s)).replace(/%20/g, '+');

// Append an env-named affiliate tag to a retailer URL. Reads the env BY NAME; never fabricates an id.
// Soft-falls to the plain URL when the env is unset. Returns { url, configured }.
export function petAffiliateOut(retailer, url) {
  const r = typeof retailer === 'string'
    ? PET_RETAILERS.find((x) => x.id === retailer)
    : retailer;
  const plain = str(url);
  if (!r || !plain) return { url: plain, configured: false };
  const id = process.env[r.env];
  if (!id) return { url: plain, configured: false };
  const sep = plain.includes('?') ? '&' : '?';
  return { url: `${plain}${sep}${r.param}=${encodeURIComponent(id)}`, configured: true };
}

// Compare pet supplies across retailers for a query. Returns one row per retailer:
// [{ retailer, label, url, configured }]. Soft-fail to [] on bad input. `fetch` is injectable for parity
// with the rest of SoapBox (and to keep the source pluggable), but these are deterministic search URLs.
export async function petSupplies({ query } = {}, { fetch } = {}) {
  const q = str(query);
  if (!q) return [];
  void fetch; // search URLs are built locally; fetch kept for interface parity / future price feeds
  const eq = qenc(q);
  return PET_RETAILERS.map((r) => {
    const out = petAffiliateOut(r, r.search(eq));
    return { retailer: r.id, label: r.label, url: out.url, configured: out.configured, asOf: asOf() };
  });
}

// ── books — REUSE the existing book lead-out (soapbox/affiliate.mjs) ───────────────────────────────────
// Defers to buyLinks (Bookshop/Amazon/AbeBooks + borrow-first Open Library/WorldCat/Libby) and the book
// module's ftcDisclosure. Defensive import: a fake module can be injected via deps.bookModule for tests,
// and a missing/broken module soft-fails to { links: [], disclosure: '' }. Accepts { title } or { isbn }.
export async function books({ title, isbn } = {}, deps = {}) {
  const input = str(isbn) ? { isbn: str(isbn) } : (str(title) ? { title: str(title) } : null);
  if (!input) return { links: [], disclosure: '' };
  try {
    const mod = deps.bookModule || await import('./affiliate.mjs').catch(() => null);
    if (!mod || typeof mod.buyLinks !== 'function') return { links: [], disclosure: '' };
    const links = mod.buyLinks(input) || [];
    const disclosure = typeof mod.ftcDisclosure === 'function' ? str(mod.ftcDisclosure()) : '';
    return { links: Array.isArray(links) ? links : [], disclosure };
  } catch {
    return { links: [], disclosure: '' };
  }
}

// ── disclosure (general FTC) — reuse the book module when present, local fallback otherwise ────────────
let _disclosureCache;
async function affiliateDisclosure(deps = {}) {
  if (deps.bookModule && typeof deps.bookModule.ftcDisclosure === 'function') {
    return str(deps.bookModule.ftcDisclosure());
  }
  if (_disclosureCache !== undefined) return _disclosureCache;
  try {
    const a = await import('./affiliate.mjs').catch(() => null);
    if (a && typeof a.ftcDisclosure === 'function') { _disclosureCache = str(a.ftcDisclosure()); return _disclosureCache; }
  } catch { /* fall through */ }
  _disclosureCache = LOCAL_DISCLOSURE;
  return _disclosureCache;
}
const LOCAL_DISCLOSURE = 'Disclosure: some links are affiliate links — we may earn a commission at no '
  + 'extra cost to you. Commissions never affect our ranking, and we never sell your data.';

// ── provenance / data note ────────────────────────────────────────────────────────────────────────────
export function dataNote() {
  return `Local & professional services across ${PRO_CATEGORIES.length} categories, plus pet supplies and `
    + `books, as of ${asOf()}. `
    + 'Providers are ranked by honest rating/fit — never by what they pay us; any commission a source '
    + 'reports is dropped before ranking. '
    + 'Quote requests go to exactly one provider you choose, only with your consent, and your information '
    + 'is never sold or shared with a network of buyers. '
    + 'Pet-supply and book links may be affiliate links (disclosed); borrowing a book is always free.';
}

// ── renderPage — escaped HTML + disclosure (always) ───────────────────────────────────────────────────
// data: { category, pros, pets, books, disclosure } (any field optional). EVERY value is escaped.
export function renderPage(data = {}) {
  const category = str(data.category);
  const catMeta = PRO_CATEGORIES.find((c) => c.id === category) || null;
  const pros = Array.isArray(data.pros) ? data.pros : [];
  const pets = Array.isArray(data.pets) ? data.pets : [];
  const bookData = data.books && typeof data.books === 'object' ? data.books : null;
  const bookLinks = bookData && Array.isArray(bookData.links) ? bookData.links : [];
  // Disclosure ALWAYS present: explicit field, else book-data disclosure, else the local fallback.
  const disclosure = str(data.disclosure) || (bookData && str(bookData.disclosure)) || LOCAL_DISCLOSURE;

  const proRows = pros.map((p) => `<tr>`
    + `<td>${escapeHtml(p.name)}</td>`
    + `<td>${p.rating == null ? '—' : escapeHtml(p.rating)}</td>`
    + `<td>${escapeHtml(p.area)}</td>`
    + `<td>${p.url ? `<a href="${escapeHtml(p.url)}" rel="nofollow noopener">site</a>` : '—'}</td>`
    + `</tr>`).join('');

  const proSection = pros.length
    ? `<table class="pros">
    <thead><tr><th>Provider</th><th>Rating</th><th>Area</th><th>Link</th></tr></thead>
    <tbody>${proRows}</tbody>
  </table>
  <p class="rank-note">Ranked by honest rating/fit — never by commission.</p>`
    : '';

  const petRows = pets.map((p) => `<tr>`
    + `<td>${escapeHtml(p.label)}</td>`
    + `<td>${p.url ? `<a href="${escapeHtml(p.url)}" rel="sponsored nofollow noopener">shop</a>` : '—'}</td>`
    + `</tr>`).join('');
  const petSection = pets.length
    ? `<h3>Pet supplies</h3>
  <table class="pets"><thead><tr><th>Retailer</th><th>Link</th></tr></thead><tbody>${petRows}</tbody></table>`
    : '';

  const bookRows = bookLinks.map((l) => `<li>`
    + `<a href="${escapeHtml(l.url)}" rel="nofollow noopener">${escapeHtml(l.vendor)}</a>`
    + ` <span class="kind">(${escapeHtml(l.kind)})</span></li>`).join('');
  const bookSection = bookLinks.length
    ? `<h3>Books</h3><ul class="books">${bookRows}</ul>
  <p class="borrow-note">Borrowing is always free — borrow links are listed alongside buy links.</p>`
    : '';

  const heading = catMeta ? catMeta.label : 'Local & professional services';
  const catNote = catMeta ? `<p class="cat-note">${escapeHtml(catMeta.note)}</p>` : '';

  return `<section class="local-pros">
  <h2>${escapeHtml(heading)}</h2>
  ${catNote}
  ${proSection}
  ${petSection}
  ${bookSection}
  <p class="disclosure">${escapeHtml(disclosure)}</p>
  <p class="note">${escapeHtml(dataNote())}</p>
</section>`;
}

// Convenience: render with the affiliate disclosure resolved (async). Soft-fails to the local fallback.
export async function renderPageWithDisclosure(data = {}, deps = {}) {
  const disclosure = await affiliateDisclosure(deps).catch(() => LOCAL_DISCLOSURE);
  return renderPage({ ...data, disclosure });
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('local-pros.mjs')) {
  const [category = 'tutors', area = ''] = process.argv.slice(2);
  console.log(`\nLocal & professional services — ${category}`);
  console.log('Categories:', PRO_CATEGORIES.map((c) => c.id).join(', '));
  const pros = await findPros({ category, area }, {}).catch(() => []);
  console.log(`\nProviders (${pros.length}, ranked by rating):`);
  for (const p of pros) console.log(`  • ${p.name.padEnd(28)} ${p.rating ?? '—'}  ${p.url || ''}`);
  const pets = await petSupplies({ query: 'dog food' }, {}).catch(() => []);
  console.log(`\nPet supplies (dog food):`);
  for (const p of pets) console.log(`  • ${p.label.padEnd(24)} ${p.url}`);
  console.log(`\n${dataNote()}`);
}
