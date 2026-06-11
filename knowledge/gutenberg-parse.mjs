// gutenberg-parse.mjs — a PURE text transform for the web-scraper corpus pipeline
// (backlog items 183–187). It parses a Project Gutenberg plain-text .txt body into
// structured, corpus-ready pieces.
//
// WHY THIS EXISTS
//   scraper.mjs fetches HTML and turns it into markdown, but nothing in the pipeline
//   parses a Project Gutenberg plain-text book body. Gutenberg .txt files wrap the
//   actual work in a standard boilerplate header and a license tail, and surround the
//   body with two marker lines:
//
//     *** START OF THE PROJECT GUTENBERG EBOOK <TITLE> ***
//     ... the work ...
//     *** END OF THE PROJECT GUTENBERG EBOOK <TITLE> ***
//     ... license tail ...
//
//   This module strips that wrapper, extracts the standard header metadata, and splits
//   the body into chapters on CHAPTER / BOOK / PART / Roman-numeral headings. Everything
//   is regex-based and deterministic: identical input → identical output. It NEVER
//   fetches, NEVER calls an LLM, and never touches any other file.
//
// EXPORTS
//   stripBoilerplate(text)        — remove the START/END wrapper + license tail; return
//                                   the work body. No markers → returns text unchanged.
//   extractMeta(text)             — {title, author, language, releaseDate}; best-effort,
//                                   each field null when absent.
//   splitChapters(body)           — [{heading, text}] split on CHAPTER/BOOK/PART/Roman
//                                   headings. No headings → one chapter (heading null).
//   toDocument(rawText, opts)     — {meta, chapters, wordCount, source}; opts.source
//                                   defaults to 'gutenberg'.
//   countWords(text)              — deterministic whitespace word count.
//   esc(s)                        — HTML-safe escaping for any interpolation.
//
//   import { stripBoilerplate, extractMeta, splitChapters, toDocument } from './gutenberg-parse.mjs';
//
// SOFT-FAIL CONTRACT (never throws):
//   - Non-string / null / undefined input is coerced to '' and handled.
//   - Text lacking the START/END markers: stripBoilerplate returns it unchanged;
//     splitChapters returns the whole text as one chapter.
//   - Empty input: toDocument → {meta:{...all null}, chapters:[], wordCount:0, source}.

// esc() — escape any value we interpolate into rendered/HTML text.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// _str() — coerce anything to a string, soft-fail style. null/undefined → ''.
function _str(t) {
  return t == null ? '' : String(t);
}

// The standard Gutenberg body markers. Title text after EBOOK is optional and ignored.
// Tolerant of the older "PROJECT GUTENBERG'S" phrasing and extra asterisks/spacing.
const START_RE = /^\s*\*\*\*\s*START OF (?:THE |THIS )?PROJECT GUTENBERG.*?\*\*\*\s*$/im;
const END_RE = /^\s*\*\*\*\s*END OF (?:THE |THIS )?PROJECT GUTENBERG.*?\*\*\*\s*$/im;

// stripBoilerplate(text) — return only the work body between the START and END markers.
// Soft-fail: if a marker is missing we keep whatever side we can. No markers at all →
// the input is returned trimmed-but-otherwise-unchanged.
export function stripBoilerplate(text) {
  const s = _str(text);
  if (s === '') return '';

  let body = s;

  const startMatch = body.match(START_RE);
  if (startMatch) {
    body = body.slice(startMatch.index + startMatch[0].length);
  }

  // END is matched against the (possibly already-trimmed) remainder so we cut the
  // license tail that follows the work.
  const endMatch = body.match(END_RE);
  if (endMatch) {
    body = body.slice(0, endMatch.index);
  }

  return body.trim();
}

// _headerField — pull a single "Label: value" line from the Gutenberg header.
// Returns the trimmed value or null. Matching is case-insensitive and anchored to
// the start of a line so body text never spoofs a header field.
function _headerField(text, label) {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, 'im');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// extractMeta(text) — best-effort parse of the standard header lines. Each field is
// null when the line is absent. Reads from the FULL raw text (the header lives above
// the START marker), so callers pass the raw book, not the stripped body.
export function extractMeta(text) {
  const s = _str(text);
  const empty = { title: null, author: null, language: null, releaseDate: null };
  if (s === '') return empty;

  // Only scan the header region (everything up to the START marker, or the whole
  // string if there is none) so a chapter that happens to contain "Author:" can't win.
  const startMatch = s.match(START_RE);
  const header = startMatch ? s.slice(0, startMatch.index) : s;

  // Title may run onto a continuation line in some headers, but we keep it to the
  // single labelled line for determinism.
  const title = _headerField(header, 'Title');
  const author =
    _headerField(header, 'Author') || _headerField(header, 'Authors');
  const language = _headerField(header, 'Language');
  // "Release Date" is the canonical label; "Release date" / "Posting Date" appear too.
  const releaseDate =
    _headerField(header, 'Release Date') ||
    _headerField(header, 'Posting Date') ||
    _headerField(header, 'Release');

  return { title, author, language, releaseDate };
}

// Chapter-heading detector. Matches a whole line that is one of:
//   CHAPTER I / Chapter 12 / CHAPTER X4 (Roman or Arabic, optional trailing title)
//   BOOK / PART / VOLUME headings
//   a bare Roman-numeral line (I, II, ... ) used as a section divider
// Anchored per-line; case-insensitive on the keyword.
const HEADING_RE = new RegExp(
  '^\\s*(' +
    '(?:CHAPTER|BOOK|PART|VOLUME|SECTION)\\b[^\\n]*' + // keyword headings
    '|' +
    '[IVXLCDM]{1,7}\\.?' + // bare Roman-numeral divider (e.g. "IV." / "XII")
  ')\\s*$',
  'im'
);

// _isHeadingLine — does a single trimmed line look like a chapter heading?
function _isHeadingLine(line) {
  const t = line.trim();
  if (t === '') return false;
  // Re-anchor against the single line to avoid the multiline flag spanning text.
  return /^(?:CHAPTER|BOOK|PART|VOLUME|SECTION)\b.*$/i.test(t) ||
    /^[IVXLCDM]{1,7}\.?$/.test(t);
}

// splitChapters(body) — split the work body into [{heading, text}] on chapter headings.
// Soft-fail: a body with no recognizable heading returns a single chapter with
// heading:null holding the whole text. Empty/whitespace body → [].
export function splitChapters(body) {
  const s = _str(body).trim();
  if (s === '') return [];

  const lines = s.split(/\r?\n/);
  const chapters = [];
  let current = { heading: null, lines: [] };
  let sawHeading = false;

  for (const line of lines) {
    if (_isHeadingLine(line)) {
      // Push the in-progress chapter if it has any content or an explicit heading.
      if (sawHeading || current.lines.some((l) => l.trim() !== '')) {
        chapters.push(current);
      }
      current = { heading: line.trim(), lines: [] };
      sawHeading = true;
    } else {
      current.lines.push(line);
    }
  }
  // Final chapter.
  if (sawHeading || current.lines.some((l) => l.trim() !== '')) {
    chapters.push(current);
  }

  // If nothing looked like a heading, return the whole body as one untitled chapter.
  if (!sawHeading) {
    return [{ heading: null, text: s }];
  }

  return chapters.map((c) => ({
    heading: c.heading,
    text: c.lines.join('\n').trim(),
  }));
}

// countWords(text) — deterministic whitespace-delimited word count. Empty → 0.
export function countWords(text) {
  const s = _str(text).trim();
  if (s === '') return 0;
  return s.split(/\s+/).length;
}

// toDocument(rawText, {source}) — the corpus-ready document. Reads meta from the raw
// header, strips boilerplate, splits chapters, counts words over the stripped body.
// Soft-fail: empty input → {meta:{all null}, chapters:[], wordCount:0, source}.
export function toDocument(rawText, opts = {}) {
  const source = opts && opts.source != null ? String(opts.source) : 'gutenberg';
  const s = _str(rawText);

  const meta = extractMeta(s);

  if (s.trim() === '') {
    return { meta, chapters: [], wordCount: 0, source };
  }

  const body = stripBoilerplate(s);
  const chapters = splitChapters(body);
  const wordCount = countWords(body);

  return { meta, chapters, wordCount, source };
}

// ── CLI DEMO ───────────────────────────────────────────────────────────────────────
// An inline sample string (no I/O). Guarded so importing never runs it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const SAMPLE = [
    'The Project Gutenberg eBook of A Small Sample',
    '',
    'Title: A Small Sample',
    'Author: Jane Example',
    'Release Date: January 1, 2000',
    'Language: English',
    '',
    '*** START OF THE PROJECT GUTENBERG EBOOK A SMALL SAMPLE ***',
    '',
    'CHAPTER I',
    '',
    'It was the first chapter, and the words were few but earnest.',
    '',
    'CHAPTER II',
    '',
    'The second chapter followed, as second chapters tend to do.',
    '',
    '*** END OF THE PROJECT GUTENBERG EBOOK A SMALL SAMPLE ***',
    '',
    'This eBook is for the use of anyone anywhere ... (license tail).',
  ].join('\n');

  const doc = toDocument(SAMPLE);
  const out = [];
  out.push('# gutenberg-parse demo');
  out.push('');
  out.push(`source: ${esc(doc.source)}`);
  out.push(`title: ${esc(doc.meta.title)}`);
  out.push(`author: ${esc(doc.meta.author)}`);
  out.push(`language: ${esc(doc.meta.language)}`);
  out.push(`releaseDate: ${esc(doc.meta.releaseDate)}`);
  out.push(`wordCount: ${doc.wordCount}`);
  out.push(`chapters: ${doc.chapters.length}`);
  for (const c of doc.chapters) {
    out.push(`  - ${esc(c.heading)}: ${esc(c.text.slice(0, 48))}`);
  }
  process.stdout.write(out.join('\n') + '\n');
}
