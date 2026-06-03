// library-buckets.mjs — the three-bucket COPYRIGHT model for the Library (queue #84). PURE
// classification, no network. Given a work's metadata, decide how the Library may handle it. The
// load-bearing rule is one line: WE NEVER HOST OTHER PEOPLE'S COPYRIGHTED FILES. Everything else
// here is the machinery that makes "are we allowed to host the actual file?" a deterministic,
// explainable answer.
//
// Three buckets:
//   HOST_FULL      public-domain / open-access / Creative-Commons / OUR OWN corpus
//                  → we may host the full text + a reader. canHostFile: true.
//   METADATA_ONLY  in-copyright, someone else's → we host a CATALOG RECORD only: title, author,
//                  cover image, and borrow/buy links (Open Library, IA lending, bookstores). We
//                  NEVER host the file. canHostFile: false. This is the SAFE DEFAULT — anything we
//                  can't positively clear as hostable lands here.
//   USER_NFT       a work the USER owns (they uploaded it / minted it / it's their rights) → it can
//                  live as a user NFT that carries its own license. The chain/NFT hosts it, not us
//                  as a publisher of someone else's copyright. canHostFile: true (user-borne rights).
//
//   import { classify, isPublicDomain, isOpenAccess, CC_LICENSES } from './integrations/soapbox/library-buckets.mjs'
//   classify(work) → { bucket, reason, canHostFile }
//   node integrations/soapbox/library-buckets.mjs   # demo with offline fixtures

// ── buckets ─────────────────────────────────────────────────────────────────────────────────────
export const BUCKETS = Object.freeze({
  HOST_FULL: 'HOST_FULL',
  METADATA_ONLY: 'METADATA_ONLY',
  USER_NFT: 'USER_NFT',
});

// ── Creative Commons licenses we treat as host-able ───────────────────────────────────────────────
// All CC licenses permit redistribution (that's the whole point), so any CC* license is host-able as
// long as we preserve attribution downstream (handled by the catalog record, not this classifier).
// CC0 / public-domain mark are effectively public domain. We keep the canonical short codes; the
// matcher below is tolerant of "CC BY 4.0", "cc-by-sa", "CC_BY_NC_ND", etc.
export const CC_LICENSES = new Set([
  'cc0',
  'cc-pdm', // public domain mark
  'cc-by',
  'cc-by-sa',
  'cc-by-nd',
  'cc-by-nc',
  'cc-by-nc-sa',
  'cc-by-nc-nd',
]);

// Free / libre software-style + dedicated-PD licenses that also permit hosting the full work.
const FREE_LICENSES = new Set([
  'publicdomain',
  'public-domain',
  'pd',
  'unlicense',
  'wtfpl',
  'mit',
  'apache-2.0',
  'gpl',
  'gpl-2.0',
  'gpl-3.0',
  'lgpl',
  'mpl-2.0',
  'bsd',
  'gfdl',
  'ogl', // UK Open Government Licence
]);

// Source/provider hosts whose default offering is public-domain or open-access scholarship.
const OPEN_ACCESS_SOURCES = new Set([
  'gutenberg',
  'project gutenberg',
  'standard ebooks',
  'standardebooks',
  'wikisource',
  'wikimedia',
  'wikipedia',
  'openalex',
  'arxiv',
  'doaj',
  'pubmed central',
  'pmc',
  'plos',
  'biorxiv',
  'medrxiv',
  'core.ac.uk',
  'core',
  'hathitrust-pd', // only the PD portion
]);

// Markers in a rights/access string that explicitly assert open access.
const OPEN_ACCESS_RIGHTS = /\b(open[\s_-]?access|gold[\s_-]?oa|green[\s_-]?oa|freely available|free to read)\b/i;

// Markers that explicitly assert public domain.
const PUBLIC_DOMAIN_RIGHTS = /\b(public[\s_-]?domain|no known copyright|pd[\s_-]?us|no rights reserved)\b/i;

// Current-ish cutoff for the US-style "published before N years ago" rough PD heuristic. This is a
// COARSE signal and only used as a positive when nothing contradicts it — never to override an
// explicit in-copyright assertion. (Real PD determination is jurisdiction- and death-date-dependent;
// we deliberately stay conservative and let the SAFE DEFAULT catch ambiguous cases.)
const PD_YEAR_CUTOFF = new Date().getUTCFullYear() - 96; // ~US 95-year term, +1 margin

// ── normalization helpers ─────────────────────────────────────────────────────────────────────────
function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// canonicalize a license string to a comparable token: "CC BY-SA 4.0" → "cc-by-sa"
function canonLicense(license) {
  let s = norm(license);
  if (!s) return '';
  s = s.replace(/\s+/g, '-').replace(/_/g, '-');
  // strip a trailing version number (4.0, 3.0, 2.5, …) and any url cruft
  s = s.replace(/-?\d+(\.\d+)?$/, '').replace(/-?(int(ernational)?|deed)$/, '');
  s = s.replace(/-+$/, '').replace(/^-+/, '');
  return s;
}

function truthy(v) {
  if (v === true) return true;
  const s = norm(v);
  return s === 'true' || s === 'yes' || s === '1';
}

// A clear in-copyright assertion (rights field) that must NOT be overridden by weak PD heuristics.
const IN_COPYRIGHT_RIGHTS = /\b(in[\s_-]?copyright|all rights reserved|copyrighted|©|\(c\)\s*\d{4}|protected by copyright)\b/i;

// ── predicates (exported) ───────────────────────────────────────────────────────────────────────
/**
 * True if the work is public domain by any available signal: explicit PD rights/license, a CC0 /
 * public-domain-mark license, or a publication year safely past the term cutoff (only when nothing
 * asserts it's still in copyright). Pure.
 */
export function isPublicDomain(work = {}) {
  const license = canonLicense(work.license);
  const rights = String(work.rights || '');

  if (license === 'cc0' || license === 'cc-pdm' || FREE_LICENSES.has(license)) {
    // FREE_LICENSES includes explicit PD tokens; cc0 / pdm are PD-equivalent.
    if (license === 'cc0' || license === 'cc-pdm' || /^(public-?domain|pd|publicdomain)$/.test(license)) return true;
  }
  if (PUBLIC_DOMAIN_RIGHTS.test(rights)) return true;

  // Year heuristic — positive only, and only when no in-copyright assertion contradicts it.
  const year = Number(work.year);
  if (Number.isFinite(year) && year > 0 && year <= PD_YEAR_CUTOFF && !IN_COPYRIGHT_RIGHTS.test(rights)) {
    return true;
  }
  return false;
}

/**
 * True if the work is open access / Creative Commons / a known open-access source. These permit
 * hosting the full text (with attribution). Pure.
 */
export function isOpenAccess(work = {}) {
  const license = canonLicense(work.license);
  const rights = String(work.rights || '');
  const source = norm(work.source);

  if (CC_LICENSES.has(license)) return true;
  if (FREE_LICENSES.has(license)) return true;
  if (OPEN_ACCESS_RIGHTS.test(rights)) return true;
  if (truthy(work.openAccess) || truthy(work.oa)) return true;
  if (source && OPEN_ACCESS_SOURCES.has(source)) return true;
  return false;
}

// True if this work is owned by the requesting user (their upload / their rights / their mint).
function isUserOwned(work = {}) {
  if (truthy(work.userOwned) || truthy(work.ownedByUser) || truthy(work.isOwn)) return true;
  const owner = norm(work.owner);
  return owner === 'user' || owner === 'self' || owner === 'uploader' || owner === 'mine';
}

// True if this work is OUR OWN corpus (the operator's writing / MELEK Library originals).
function isOurCorpus(work = {}) {
  if (truthy(work.ownCorpus) || truthy(work.isCorpus)) return true;
  const owner = norm(work.owner);
  const source = norm(work.source);
  return owner === 'melek' || owner === 'soapbox' || owner === 'corpus' || owner === 'operator' ||
    source === 'corpus' || source === 'melek' || source === 'soapbox';
}

// ── the classifier ──────────────────────────────────────────────────────────────────────────────
/**
 * Classify a work's metadata into one of the three copyright buckets. PURE — no network, no I/O.
 *
 * Precedence (so the SAFE DEFAULT can never be accidentally bypassed):
 *   1. OUR own corpus              → HOST_FULL
 *   2. public domain               → HOST_FULL
 *   3. open access / CC / free      → HOST_FULL
 *   4. user-owned                  → USER_NFT  (user-borne license, hosted as their NFT)
 *   5. everything else / unknown   → METADATA_ONLY  (in-copyright assumed; NEVER host the file)
 *
 * Note user-ownership is checked AFTER the host-full clearances: if a user uploads a PD or CC work
 * it is genuinely host-able as full text, no need to route it through an NFT. USER_NFT is for works
 * whose ONLY hosting basis is the user's own ownership of an otherwise-restricted file.
 *
 * @param {object} work  { license, source, rights, year, owner, openAccess?, userOwned?, ... }
 * @returns {{ bucket: string, reason: string, canHostFile: boolean }}
 */
export function classify(work = {}) {
  if (!work || typeof work !== 'object') {
    return { bucket: BUCKETS.METADATA_ONLY, reason: 'no metadata; safe default (assume in-copyright)', canHostFile: false };
  }

  // An explicit in-copyright assertion is decisive UNLESS an open license also clears it (a work can
  // be "© 2024, licensed CC BY" — the CC license is what permits hosting).
  const explicitlyInCopyright = IN_COPYRIGHT_RIGHTS.test(String(work.rights || ''));

  if (isOurCorpus(work)) {
    return { bucket: BUCKETS.HOST_FULL, reason: 'our own corpus / MELEK Library original', canHostFile: true };
  }

  const open = isOpenAccess(work);
  const pd = isPublicDomain(work);

  // explicit-in-copyright blocks the PD year-heuristic and any non-licensed open claim, but a real
  // open LICENSE (CC/free) still clears it.
  const licenseClears = open && (CC_LICENSES.has(canonLicense(work.license)) || FREE_LICENSES.has(canonLicense(work.license)));

  if (pd && !explicitlyInCopyright) {
    return { bucket: BUCKETS.HOST_FULL, reason: 'public domain', canHostFile: true };
  }
  if (open && (!explicitlyInCopyright || licenseClears)) {
    const why = CC_LICENSES.has(canonLicense(work.license)) ? `Creative Commons license (${canonLicense(work.license)})`
      : FREE_LICENSES.has(canonLicense(work.license)) ? `open license (${canonLicense(work.license)})`
      : 'open access';
    return { bucket: BUCKETS.HOST_FULL, reason: why, canHostFile: true };
  }

  if (isUserOwned(work)) {
    return { bucket: BUCKETS.USER_NFT, reason: 'user-owned work; hosted as a license-bearing user NFT', canHostFile: true };
  }

  // SAFE DEFAULT: assume in-copyright, someone else's. Record + cover + borrow/buy links only.
  const reason = explicitlyInCopyright
    ? 'in-copyright (rights reserved); catalog record + borrow/buy links only — never host the file'
    : 'no clearing signal; safe default — assume in-copyright, never host the file';
  return { bucket: BUCKETS.METADATA_ONLY, reason, canHostFile: false };
}

// ── CLI demo (offline) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('library-buckets.mjs')) {
  const fixtures = [
    { label: 'Gutenberg PD ebook', work: { title: 'Moby-Dick', source: 'gutenberg', year: 1851 } },
    { label: 'CC BY paper', work: { title: 'An OA study', license: 'CC BY 4.0', source: 'doaj' } },
    { label: 'Our corpus', work: { title: 'The Convergence', owner: 'melek' } },
    { label: 'In-copyright bestseller', work: { title: 'A 2023 novel', year: 2023, rights: 'All rights reserved' } },
    { label: 'User upload (their rights)', work: { title: 'My manuscript', userOwned: true, rights: 'in copyright' } },
    { label: 'Unknown / missing license', work: { title: 'Mystery scan' } },
    { label: '© but CC-licensed', work: { title: 'Open textbook', license: 'CC BY-SA 4.0', rights: '© 2024 Author' } },
  ];
  for (const { label, work } of fixtures) {
    const r = classify(work);
    console.log(`${label.padEnd(26)} → ${r.bucket.padEnd(14)} host=${r.canHostFile ? 'Y' : 'N'}  (${r.reason})`);
  }
}
