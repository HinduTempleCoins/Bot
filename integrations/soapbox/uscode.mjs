// uscode.mjs — Law.SoapBox legal-vertical helper (v3 §10) for the United States Code, as published in
// USLM (United States Legislative Markup) XML by the Office of the Law Revision Counsel (OLRC) at
// uscode.house.gov. This module is a CITATION PARSER + LINK BUILDER, not a scraper: it turns a
// human U.S.C. citation ("18 U.S.C. § 2261A") into structured {title, section}, builds links to the
// official OLRC source and a Cornell LII display page, and documents the USLM bulk-XML shape so a
// later ingestion step knows what it's pulling. We WINDOW to the official source; we never scrape it.
//
// DISCIPLINE (v3 §10 — non-negotiable):
//   • THE U.S. CODE IS PUBLIC DOMAIN. Federal statute is U.S. Government work, no copyright. We mark
//     records license:'public-domain'; the OLRC USLM XML is host-forever material.
//   • STATE FACTS, LINK SOURCES. We parse the citation and point at the authoritative OLRC text and a
//     Cornell LII reader. NO statutory interpretation, NO "this section means X". Window, never gloss.
//   • OLRC is the official codifier; the positive-law vs. non-positive-law distinction lives there. We
//     surface the citation + links and let the official source speak.
//
// USLM BULK XML SHAPE (documented for a later ingestion job — NOT fetched here):
//   • Download root: https://uscode.house.gov/download/download.shtml — per-title USLM XML in zip,
//     e.g. usc18.xml inside title-18 zip. A "[Releasepoint]" stamps the currency date.
//   • Namespace: http://xml.house.gov/schemas/uslm/1.0  (root <uscDoc>).
//   • Hierarchy: <main> → <title> → (<subtitle>/<chapter>/<subchapter>/<part>) → <section>.
//   • A <section> carries: @identifier (e.g. "/us/usc/t18/s2261A"), <num value="2261A"> with the
//     "§ 2261A." display, <heading>, then <subsection>/<paragraph>/<subparagraph> nesting <content>.
//   • Cross-refs use <ref href="/us/usc/t18/s2261A">. Notes/source-credits ride in <note>/<sourceCredit>.
//   The @identifier path ("/us/usc/t<title>/s<section>") is the stable key an ingestion step indexes on.
//
// Pattern follows worldbank.mjs / courtlistener-opinions.mjs: ESM, zero deps, soft-fail (return
// null/[]/'' , NEVER throw), pure functions, guarded CLI demo, escaped HTML. (No network here — this is
// a parser/link builder — but a __setFetch seam is exported for symmetry with the sibling readers.)
//
//   import { parseCitation, olrcUrl, corneliiUrl, uslmIdentifier, citationCard,
//            renderPage, dataNote, USLM_SHAPE } from './uscode.mjs'
//   node integrations/soapbox/uscode.mjs "18 U.S.C. § 2261A"

let _fetch = (...a) => globalThis.fetch(...a);
/** Seam kept for symmetry with sibling readers; this module performs no network I/O. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const SRC = 'U.S. Code — Office of the Law Revision Counsel (OLRC), USLM XML';
const LICENSE = 'public-domain';

// A compact, machine-readable description of the USLM bulk-XML shape (for downstream ingestion code).
export const USLM_SHAPE = Object.freeze({
  downloadRoot: 'https://uscode.house.gov/download/download.shtml',
  namespace: 'http://xml.house.gov/schemas/uslm/1.0',
  root: 'uscDoc',
  hierarchy: ['main', 'title', 'subtitle|chapter|subchapter|part', 'section', 'subsection', 'paragraph'],
  sectionFields: ['@identifier', 'num@value', 'heading', 'content'],
  identifierPattern: '/us/usc/t<title>/s<section>',
  releasePointNote: '[Releasepoint] element stamps the currency date',
});

// ---- pure helpers ----
const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Parse a U.S.C. citation → { title, section, normalized } or null.
 * Accepts the common written forms:
 *   "18 U.S.C. § 2261A"   "18 USC 2261A"   "18 U.S.C. 2261A(b)(2)"   "§ 2261A of title 18"
 *   "42 U.S.C. §§ 1983"   (double section-sign tolerated)
 * Section ids may be alphanumeric with internal hyphens (e.g. "1395w-4") and may carry subsection
 * tails in parentheses, which we preserve on `normalized` but key on the bare section. PURE.
 */
export function parseCitation(cite) {
  const raw = str(cite).replace(/§{1,2}/g, '§').replace(/\s+/g, ' ');
  if (!raw) return null;
  // Form A: "<title> U.S.C./USC [§] <section>"
  let m = raw.match(/^(\d+)\s*U\.?\s*S\.?\s*C\.?\s*(?:§\s*)?([0-9][0-9A-Za-z\-]*)((?:\([0-9A-Za-z]+\))*)\.?$/i);
  if (m) return finishCitation(m[1], m[2], m[3]);
  // Form B: "[§] <section> of title <title>"
  m = raw.match(/^(?:§\s*)?([0-9][0-9A-Za-z\-]*)((?:\([0-9A-Za-z]+\))*)\s+of\s+title\s+(\d+)\.?$/i);
  if (m) return finishCitation(m[3], m[1], m[2]);
  return null;
}

function finishCitation(titleStr, sectionStr, subTail) {
  const title = num(titleStr);
  const section = str(sectionStr);
  if (title == null || title < 1 || title > 54 || !section) return null;
  const tail = str(subTail);
  return { title, section, subsections: tail, normalized: `${title} U.S.C. § ${section}${tail}` };
}

/** USLM stable @identifier path for a parsed citation. PURE. */
export function uslmIdentifier(parsed) {
  if (!parsed || parsed.title == null || !parsed.section) return '';
  return `/us/usc/t${parsed.title}/s${parsed.section}`;
}

/** Link to the OFFICIAL OLRC source (uscode.house.gov view-by-citation). PURE. */
export function olrcUrl(parsed) {
  if (!parsed || parsed.title == null || !parsed.section) return '';
  const p = new URLSearchParams({ req: `granuleid:USC-prelim-title${parsed.title}-section${parsed.section}`, f: 'treesort', edition: 'prelim' });
  return `https://uscode.house.gov/view.xhtml?${p.toString()}`;
}

/** Link to the Cornell LII DISPLAY page for the section (window, never scrape). PURE. */
export function corneliiUrl(parsed) {
  if (!parsed || parsed.title == null || !parsed.section) return '';
  return `https://www.law.cornell.edu/uscode/text/${parsed.title}/${encodeURIComponent(parsed.section)}`;
}

/**
 * One call: parse a citation and build the full link card. Returns
 *   { title, section, normalized, identifier, olrcUrl, corneliiUrl, source, license } or null.
 */
export function citationCard(cite) {
  const parsed = parseCitation(cite);
  if (!parsed) return null;
  return {
    source: SRC,
    license: LICENSE,
    title: parsed.title,
    section: parsed.section,
    subsections: parsed.subsections,
    normalized: parsed.normalized,
    identifier: uslmIdentifier(parsed),
    olrcUrl: olrcUrl(parsed),
    corneliiUrl: corneliiUrl(parsed),
  };
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a citation card (parsed citation + official + LII links) OR a "could not parse"
 * notice. PURE. Facts only — the parsed citation and where the official text lives. Never a gloss.
 * @param {{card?:object, input?:string}} data
 */
export function renderPage(data = {}) {
  const c = data.card || null;
  if (!c) {
    return `<section class="usc-cite"><h2>U.S. Code citation</h2><p class="usc-empty">Could not parse a U.S.C. citation${data.input ? ` from “${esc(data.input)}”` : ''}.</p><p class="data-note">${esc(dataNote())}</p></section>`;
  }
  const parts = ['<section class="usc-cite"><h2>U.S. Code citation</h2>'];
  parts.push(`<p class="usc-norm"><strong>${esc(c.normalized)}</strong></p>`);
  parts.push('<ul class="usc-meta">');
  parts.push(`<li>Title: ${esc(c.title)}</li>`);
  parts.push(`<li>Section: ${esc(c.section)}${c.subsections ? esc(c.subsections) : ''}</li>`);
  parts.push(`<li>USLM identifier: <code>${esc(c.identifier)}</code></li>`);
  parts.push('</ul>');
  parts.push('<p class="usc-links">');
  parts.push(`<a href="${esc(c.olrcUrl)}">Official text (OLRC, uscode.house.gov)</a> · `);
  parts.push(`<a href="${esc(c.corneliiUrl)}">Cornell LII display</a>`);
  parts.push('</p>');
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names OLRC / USLM + public-domain + the window-don't-scrape posture. */
export function dataNote() {
  return `source: ${SRC}; the U.S. Code is public domain (host-forever); links window to the official OLRC source and Cornell LII — we never scrape them`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('uscode.mjs')) {
  const input = process.argv.slice(2).join(' ');
  if (!input) {
    console.log('usage: uscode.mjs "<citation>"   e.g.  uscode.mjs "18 U.S.C. § 2261A"');
    console.log(`  USLM bulk XML download root: ${USLM_SHAPE.downloadRoot}`);
    console.log(`  ${dataNote()}`);
  } else {
    const card = citationCard(input);
    console.log(`SoapBox U.S. Code — "${input}"`);
    if (card) {
      console.log(`  parsed: ${card.normalized}`);
      console.log(`  USLM id: ${card.identifier}`);
      console.log(`  official: ${card.olrcUrl}`);
      console.log(`  Cornell LII: ${card.corneliiUrl}`);
    } else {
      console.log('  could not parse a U.S.C. citation');
    }
    console.log(`  ${dataNote()}`);
  }
}
