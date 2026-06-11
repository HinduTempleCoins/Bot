// theoi-parse.mjs — a PURE HTML→structured extractor for Theoi.com Greek-mythology
// god/goddess pages (backlog item 186). It complements knowledge/greek-pantheon.mjs,
// which is a hand-curated STATIC dataset — this module is the missing PARSER: it turns
// an already-fetched Theoi deity-page HTML string into a corpus-ready record.
//
// WHY THIS EXISTS
//   scraper.mjs fetches HTML; greek-pantheon.mjs holds frozen facts. Neither one reads
//   the structure of a live Theoi page. Theoi pages follow a stable shape: an <h1> name,
//   a one-line italic/heading "titles" line, and a small key→value table whose left cells
//   are labels (PARENTS, GOD OF, CONSORTS, CHILDREN, ...) and right cells the values.
//   This module strips tags and reads those labeled rows by regex. Identical input →
//   identical output. It NEVER fetches, NEVER calls an LLM, never touches any other file.
//
// EXPORTS
//   parseDeity(html)            — {name, titles[], domains[], parents[], consorts[],
//                                  children[], summary}. Unrecognized markup soft-fails to
//                                  {name:null, ..., domains:[]} and NEVER throws.
//   extractEpithets(html)       — [] transliterated epithets (Greek transliterations found
//                                  in parentheses / italic spans), de-duplicated, in order.
//   toKnowledgeRecord(html,opt) — {entity, kind:'deity', attributes, source} ready for the
//                                  JSONL corpus exporter. opt.url → source (default null).
//   stripTags(html)            — internal-grade tag stripper (exported for tests/reuse).
//   decodeEntities(s)          — decode the common named/numeric HTML entities.
//   esc(s)                     — HTML-safe escaping for any interpolation.
//
//   import { parseDeity, extractEpithets, toKnowledgeRecord } from './theoi-parse.mjs';
//   node knowledge/theoi-parse.mjs   # parse a built-in inline HTML snippet and print it
//
// SOFT-FAIL CONTRACT (never throws):
//   - Non-string / null / undefined input is coerced to '' and handled.
//   - HTML with no recognizable name/table → {name:null, titles:[], domains:[], ...}.
//   - Reuses NO external libraries: only the small internal stripTags/decodeEntities.

// esc() — escape any value we interpolate into rendered/HTML text.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// _str() — coerce anything to a string, soft-fail style. null/undefined → ''.
function _str(t) {
  return t == null ? '' : String(t);
}

// decodeEntities() — decode the handful of HTML entities that show up in scraped prose.
// Numeric (decimal + hex) plus the common named ones. Unknown entities pass through.
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};
export function decodeEntities(s) {
  return _str(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => _cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => _cp(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) =>
      Object.prototype.hasOwnProperty.call(NAMED, n) ? NAMED[n] : m);
}
function _cp(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

// stripTags() — remove script/style blocks, then all tags, collapse whitespace, decode
// entities. Block-level tags become spaces so adjacent text does not glue together.
export function stripTags(html) {
  let s = _str(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Turn structural breaks into spaces before deleting the rest of the tags.
  s = s.replace(/<\/?(p|div|br|li|tr|td|th|h[1-6]|table)\b[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

// _splitList() — Theoi value cells separate multiple entities with commas, semicolons,
// "&", "and", or line breaks. Split, trim, drop empties, de-dupe (order-preserving).
function _splitList(v) {
  const out = [];
  const seen = new Set();
  for (let part of _str(v).split(/\s*(?:,|;|·|\band\b|&amp;|&)\s*/i)) {
    part = decodeEntities(part).replace(/\s+/g, ' ').trim();
    // Drop trailing source/citation cruft in parentheses-only fragments.
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

// _firstH1() — pull the deity name from the first <h1>, else <title>, else null.
function _firstH1(html) {
  const s = _str(html);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(s);
  if (h1) {
    const t = stripTags(h1[1]);
    if (t) return t;
  }
  const ttl = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  if (ttl) {
    // Theoi titles look like "HERA - Greek Goddess ...": keep the leading name token(s).
    const t = stripTags(ttl[1]).split(/\s*[-|:]\s*/)[0].trim();
    if (t) return t;
  }
  return null;
}

// _labeledRows() — collect Theoi's key→value table rows as a {LABEL: rawValue} map.
// Matches <tr><td>LABEL</td><td>VALUE</td></tr> (any cell tags), label upper-cased.
function _labeledRows(html) {
  const s = _str(html);
  const rows = {};
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(s))) {
    const cells = [];
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c;
    while ((c = cellRe.exec(m[1]))) cells.push(stripTags(c[1]));
    if (cells.length >= 2 && cells[0]) {
      const label = cells[0].toUpperCase().replace(/[:\s]+$/, '').trim();
      const value = cells.slice(1).filter(Boolean).join(' ').trim();
      if (label && !(label in rows)) rows[label] = value;
    }
  }
  return rows;
}

// _matchLabel() — find the first row whose label matches any of the alternatives.
function _matchLabel(rows, alts) {
  for (const a of alts) {
    for (const k of Object.keys(rows)) {
      if (k === a || k.startsWith(a + ' ') || k === a + 'S') return rows[k];
    }
  }
  return '';
}

const EMPTY = () => ({
  name: null, titles: [], domains: [], parents: [], consorts: [], children: [], summary: '',
});

// parseDeity() — the main extractor. Soft-fails to the empty shape, never throws.
export function parseDeity(html) {
  try {
    const s = _str(html);
    if (!s.trim()) return EMPTY();
    const rows = _labeledRows(s);
    const out = EMPTY();
    out.name = _firstH1(s);

    // Domains: "GOD OF" / "GODDESS OF" / "DOMAIN" rows.
    out.domains = _splitList(_matchLabel(rows, ['GOD OF', 'GODDESS OF', 'DOMAIN', 'DOMAINS']));
    out.parents = _splitList(_matchLabel(rows, ['PARENTS', 'PARENT', 'FATHER', 'MOTHER']));
    out.consorts = _splitList(_matchLabel(rows, ['CONSORTS', 'CONSORT', 'SPOUSE', 'PARTNER']));
    out.children = _splitList(_matchLabel(rows, ['CHILDREN', 'CHILD', 'OFFSPRING']));

    // Titles: a "TITLES" / "ALSO KNOWN AS" row, else the first italic heading line.
    let titlesRaw = _matchLabel(rows, ['TITLES', 'TITLE', 'ALSO KNOWN AS', 'NAMES']);
    if (!titlesRaw) {
      const sub = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(s);
      if (sub) titlesRaw = stripTags(sub[1]);
    }
    out.titles = _splitList(titlesRaw);

    // Summary: the first reasonable paragraph of body prose.
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let pm;
    while ((pm = pRe.exec(s))) {
      const t = stripTags(pm[1]);
      if (t && t.length >= 20) { out.summary = t; break; }
    }
    return out;
  } catch {
    return EMPTY();
  }
}

// extractEpithets() — gather transliterated Greek epithets. Theoi gives transliterations
// in italic spans and in parentheses, e.g. "<i>Boôpis</i>" or "(Glaukopis)". We collect
// parenthetical and italic tokens that look like a single transliterated word/phrase.
export function extractEpithets(html) {
  try {
    const s = _str(html);
    if (!s.trim()) return [];
    const out = [];
    const seen = new Set();
    const add = (raw) => {
      const t = decodeEntities(raw).replace(/\s+/g, ' ').trim();
      // A transliterated epithet: capitalised, letters/diacritics/space/hyphen only,
      // 1–3 words, not an ordinary all-caps label.
      if (!/^[A-ZÀ-ɏ][A-Za-zÀ-ɏĀ-ſ'’\-]*(?:\s[A-ZÀ-ɏ][A-Za-zÀ-ɏĀ-ſ'’\-]*){0,2}$/.test(t)) return;
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    // Italic transliterations.
    let m;
    const iRe = /<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi;
    while ((m = iRe.exec(s))) add(stripTags(m[1]));
    // Parenthetical transliterations in the stripped text.
    const text = stripTags(s);
    const pRe = /\(([^()]{2,40})\)/g;
    while ((m = pRe.exec(text))) add(m[1]);
    return out;
  } catch {
    return [];
  }
}

// toKnowledgeRecord() — assemble a record for the JSONL corpus exporter.
export function toKnowledgeRecord(html, opts = {}) {
  const d = parseDeity(html);
  const epithets = extractEpithets(html);
  const url = opts && opts.url != null ? String(opts.url) : null;
  return {
    entity: d.name,
    kind: 'deity',
    attributes: {
      titles: d.titles,
      domains: d.domains,
      parents: d.parents,
      consorts: d.consorts,
      children: d.children,
      epithets,
      summary: d.summary,
    },
    source: url,
  };
}

// --- CLI (guarded; pure stdout) -------------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const SAMPLE = `
<html><head><title>HERA - Greek Goddess of Marriage &amp; Queen of Heaven</title></head>
<body>
  <h1>HERA</h1>
  <h2>Queen of the Gods, the Lady of Argos</h2>
  <table>
    <tr><td>GODDESS OF</td><td>Marriage, Women &amp; the Sky</td></tr>
    <tr><td>PARENTS</td><td>Kronos and Rhea</td></tr>
    <tr><td>CONSORTS</td><td>Zeus</td></tr>
    <tr><td>CHILDREN</td><td>Ares, Hebe, Hephaistos &amp; Eileithyia</td></tr>
  </table>
  <p>Hera (<i>Boôpis</i>, the ox-eyed) was the Olympian queen of the gods and the
     goddess of women and marriage. She was a daughter of the Titanes Kronos and Rheia.</p>
</body></html>`;
  const arg = process.argv[2];
  const rec = toKnowledgeRecord(SAMPLE, { url: arg || 'https://www.theoi.com/Olympios/Hera.html' });
  console.log(JSON.stringify(rec, null, 2));
}
