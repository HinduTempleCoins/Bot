// sacred-texts-parse.mjs — a PURE HTML transform for the web-scraper corpus pipeline
// (backlog item 184). It parses a sacred-texts.com page (fetched elsewhere) into
// structured, corpus-ready pieces.
//
// WHY THIS EXISTS
//   sacred-texts.com hosts a large public-domain corpus of scripture, mythology and
//   esoterica laid out with an old, consistent HTML idiom: a single <h1> page title,
//   <h3> section headings, <p> body paragraphs, and footnotes anchored by name
//   (e.g. <a name="fn_12">12</a> ... text). This module turns that HTML into a
//   document the corpus pipeline can store. It is DISTINCT from theoi-parse: a
//   different site, a different layout, its own regexes.
//
//   Everything here is regex-based and deterministic: identical input → identical
//   output. It NEVER fetches, NEVER calls an LLM, and never touches any other file.
//
// EXPORTS
//   parsePage(html)            — {title, tradition, sections:[{heading, paragraphs[]}],
//                                footnotes:[]}; tradition is null here (no URL to map).
//   extractCanonText(html)     — body text joined, footnote markers normalized to
//                                "[n]". Empty/garbled → ''.
//   toDocument(html, opts)     — {title, tradition, body, sections, source, wordCount};
//                                opts.url sets source + drives guessTradition, opts.tradition
//                                overrides the guess.
//   guessTradition(url)        — map a sacred-texts URL path segment (/egy/, /cla/, /pag/, …)
//                                to a tradition label. Unknown/garbled → null.
//   esc(s)                     — HTML-safe escaping for any interpolation.
//
//   import { parsePage, extractCanonText, toDocument, guessTradition } from './sacred-texts-parse.mjs';
//
// SOFT-FAIL CONTRACT (never throws):
//   - Non-string / null / undefined input is coerced to '' and handled.
//   - Empty or garbled HTML (no <h1>/<h3>/<p>): parsePage → {title:null, tradition:null,
//     sections:[], footnotes:[]}; extractCanonText → ''; toDocument → a doc with
//     title:null and sections:[].

// esc() — escape any value we interpolate into rendered/HTML text.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// _str() — coerce anything to a string, soft-fail style. null/undefined → ''.
function _str(t) {
  return t == null ? '' : String(t);
}

// Named HTML entities we commonly see in this corpus, plus the always-needed five.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', sect: '§', deg: '°',
  aelig: 'æ', oelig: 'œ', eacute: 'é', egrave: 'è',
};

// decodeEntities() — decode numeric (&#NN; / &#xNN;) and a curated set of named
// entities. Unknown named entities are left verbatim (deterministic, no throw).
function decodeEntities(s) {
  return _str(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const code = parseInt(d, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)
        ? NAMED_ENTITIES[key]
        : m;
    });
}

// stripTags() — remove all HTML tags, decode entities, collapse whitespace. Script
// and style blocks are dropped wholesale first. Deterministic.
function stripTags(html) {
  let s = _str(html);
  if (s === '') return '';
  // Drop script/style content entirely (case-insensitive, across newlines).
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Turn <br> and block-enders into spaces so words don't fuse.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

// _decodeInline — decode entities and collapse whitespace WITHOUT stripping further
// tags (callers have already isolated a tag-free run, or want inner text).
function _decodeInline(s) {
  return decodeEntities(_str(s)).replace(/\s+/g, ' ').trim();
}

// normalizeFootnoteMarkers() — sacred-texts marks footnote references inline in a few
// ways; normalize the common anchored reference forms to a bare "[n]" so canon text
// reads cleanly. Operates on already-tag-stripped text plus a light HTML pre-pass.
function normalizeFootnoteMarkers(text) {
  return _str(text)
    // "[paragraph continues] p. 12" page markers — drop the page-number noise.
    .replace(/\bp\.\s*\d+\b/g, '')
    // Already-bracketed numbers are kept as-is.
    .replace(/\s+/g, ' ')
    .trim();
}

// FIRST_TAG helpers — pull inner text of the first matching tag.
function _firstTagText(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i');
  const m = _str(html).match(re);
  return m ? stripTags(m[1]) : null;
}

// extractTitle() — prefer the first <h1>, then <title>, then the first <h2>/<h3>.
// Returns null when nothing usable is found.
function extractTitle(html) {
  const s = _str(html);
  if (s === '') return null;
  const h1 = _firstTagText(s, 'h1');
  if (h1) return h1;
  // <title> often carries a "Sacred Texts: ..." suffix/prefix; trim the site name.
  let t = _firstTagText(s, 'title');
  if (t) {
    t = t.replace(/^\s*sacred[\s-]*texts?\s*[:\-|]\s*/i, '')
      .replace(/\s*[:\-|]\s*sacred[\s-]*texts?\s*$/i, '')
      .trim();
    if (t) return t;
  }
  return _firstTagText(s, 'h2') || _firstTagText(s, 'h3');
}

// extractFootnotes() — collect footnotes anchored by name. The canonical idiom is
//   <a name="fn_12">12</a> ... footnote text ...
// We capture the anchor's number and the text that follows up to the next footnote
// anchor or end of block. Returns [{n, text}] in document order. None → [].
function extractFootnotes(html) {
  const s = _str(html);
  if (s === '') return [];

  // Find footnote anchors of the form name="fn_N" / name="fn12" / id="fn_N".
  const anchorRe = /<a\b[^>]*\b(?:name|id)\s*=\s*["']?fn[_]?(\d+)["']?[^>]*>([\s\S]*?)<\/a\s*>/gi;
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(s)) !== null) {
    anchors.push({ n: m[1], index: m.index, end: anchorRe.lastIndex });
  }
  if (anchors.length === 0) return [];

  const footnotes = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].end;
    const stop = i + 1 < anchors.length ? anchors[i + 1].index : s.length;
    const raw = s.slice(start, stop);
    const text = stripTags(raw);
    footnotes.push({ n: anchors[i].n, text });
  }
  return footnotes;
}

// _paragraphsBetween — pull <p>…</p> inner texts from an HTML slice, tag-stripped.
function _paragraphsBetween(slice) {
  const out = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let m;
  while ((m = pRe.exec(slice)) !== null) {
    const txt = stripTags(m[1]);
    if (txt) out.push(txt);
  }
  return out;
}

// splitSections() — split the body into sections on <h2>/<h3>/<h4> headings, each
// carrying the <p> paragraphs that follow it (up to the next heading). Paragraphs
// before the first heading form a section with heading:null (if any exist).
function splitSections(html) {
  const s = _str(html);
  if (s === '') return [];

  // Locate all heading tags (h2–h4) with positions.
  const headRe = /<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  const heads = [];
  let m;
  while ((m = headRe.exec(s)) !== null) {
    heads.push({ heading: stripTags(m[2]) || null, start: m.index, end: headRe.lastIndex });
  }

  const sections = [];

  if (heads.length === 0) {
    const paragraphs = _paragraphsBetween(s);
    return paragraphs.length ? [{ heading: null, paragraphs }] : [];
  }

  // Preamble paragraphs before the first heading.
  const preamble = _paragraphsBetween(s.slice(0, heads[0].start));
  if (preamble.length) sections.push({ heading: null, paragraphs: preamble });

  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].end;
    const stop = i + 1 < heads.length ? heads[i + 1].start : s.length;
    const paragraphs = _paragraphsBetween(s.slice(start, stop));
    sections.push({ heading: heads[i].heading, paragraphs });
  }

  return sections;
}

// TRADITION_MAP — sacred-texts path segment → tradition label. The site groups texts
// under short directory codes; these are the stable, well-known ones.
const TRADITION_MAP = {
  egy: 'Egyptian',
  cla: 'Classical',
  pag: 'Paganism & Wicca',
  chr: 'Christianity',
  bib: 'Bible',
  jud: 'Judaism',
  isl: 'Islam',
  hin: 'Hinduism',
  bud: 'Buddhism',
  tao: 'Taoism',
  cfu: 'Confucianism',
  zor: 'Zoroastrianism',
  shi: 'Shinto',
  nam: 'Native American',
  afr: 'African',
  asia: 'Asia',
  eso: 'Esoteric & Occult',
  alc: 'Alchemy',
  astro: 'Astrology',
  tarot: 'Tarot',
  gno: 'Gnosticism & Hermetica',
  cel: 'Celtic',
  neu: 'Northern European',
  oto: 'Sacred Sexuality',
  htm: 'Western Esoterica',
  sym: 'Symbolism',
  myth: 'Mythology',
  earth: 'Earth Mysteries',
  ufo: 'UFOs',
  atl: 'Atlantis',
  comp: 'Comparative',
  time: 'Sacred Time',
  wmn: 'Women',
  fort: 'Fortean',
  age: 'Age of Reason',
  ame: 'America',
  aus: 'Australia',
  pac: 'Pacific',
  ich: 'I Ching',
  cmt: 'Christianity',
  goth: 'Gothic',
};

// guessTradition(url) — map the first meaningful path segment of a sacred-texts URL
// to a tradition label. Unknown segment or unparseable URL → null.
export function guessTradition(url) {
  const s = _str(url).trim();
  if (s === '') return null;

  // Pull the path portion whether or not a scheme/host is present.
  let path = s.replace(/^[a-z]+:\/\//i, '');
  const slash = path.indexOf('/');
  path = slash >= 0 ? path.slice(slash + 1) : '';
  // Drop query/hash.
  path = path.split(/[?#]/)[0];

  const segments = path.split('/').filter((seg) => seg && seg !== '.');
  for (const seg of segments) {
    const key = seg.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(TRADITION_MAP, key)) {
      return TRADITION_MAP[key];
    }
  }
  return null;
}

// parsePage(html) — the structural parse: title, sections, footnotes. tradition is
// null here because no URL is supplied (use toDocument for the URL-aware version).
// Soft-fail: empty/garbled → {title:null, tradition:null, sections:[], footnotes:[]}.
export function parsePage(html) {
  const s = _str(html);
  const empty = { title: null, tradition: null, sections: [], footnotes: [] };
  if (s.trim() === '') return empty;

  const title = extractTitle(s);
  const sections = splitSections(s);
  const footnotes = extractFootnotes(s);

  return { title, tradition: null, sections, footnotes };
}

// extractCanonText(html) — the body text as a single string, paragraphs joined with
// blank lines, footnote markers/page noise normalized. Empty/garbled → ''.
export function extractCanonText(html) {
  const s = _str(html);
  if (s.trim() === '') return '';

  const sections = splitSections(s);
  const blocks = [];
  for (const sec of sections) {
    if (sec.heading) blocks.push(sec.heading);
    for (const p of sec.paragraphs) blocks.push(p);
  }
  // Fall back to a flat tag-strip if no <p> structure was found.
  if (blocks.length === 0) {
    const flat = stripTags(s);
    return normalizeFootnoteMarkers(flat);
  }
  return normalizeFootnoteMarkers(blocks.join('\n\n'));
}

// countWords() — deterministic whitespace word count. Empty → 0.
function countWords(text) {
  const t = _str(text).trim();
  if (t === '') return 0;
  return t.split(/\s+/).length;
}

// toDocument(html, {url, tradition}) — the corpus-ready document. tradition is taken
// from opts.tradition if given, else guessed from opts.url. source = opts.url || ''.
// Soft-fail: empty input → {title:null, tradition, body:'', sections:[], source, wordCount:0}.
export function toDocument(html, opts = {}) {
  const o = opts || {};
  const url = o.url != null ? String(o.url) : '';
  const tradition =
    o.tradition != null ? String(o.tradition) : guessTradition(url);

  const parsed = parsePage(html);
  const body = extractCanonText(html);

  return {
    title: parsed.title,
    tradition,
    body,
    sections: parsed.sections,
    source: url,
    wordCount: countWords(body),
  };
}

// ── CLI DEMO ───────────────────────────────────────────────────────────────────────
// An inline sample string (no I/O). Guarded so importing never runs it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const SAMPLE = [
    '<html><head><title>Sacred Texts: The Pyramid Texts</title></head><body>',
    '<h1>The Pyramid Texts</h1>',
    '<p>An introductory paragraph about the utterances of the king.</p>',
    '<h3>Utterance 1</h3>',
    '<p>Recitation by Nut, the great one&mdash;she spreads herself over her son.<a name="fnr1" href="#fn_1">1</a></p>',
    '<p>The second paragraph of the first utterance. p. 12</p>',
    '<h3>Utterance 2</h3>',
    '<p>O King, take to yourself this your bread.</p>',
    '<hr>',
    '<a name="fn_1">1</a> Nut is the sky-goddess; the gesture is protective.',
    '</body></html>',
  ].join('\n');

  const doc = toDocument(SAMPLE, { url: 'https://sacred-texts.com/egy/pyt/pyt03.htm' });
  const out = [];
  out.push('# sacred-texts-parse demo');
  out.push('');
  out.push(`source: ${esc(doc.source)}`);
  out.push(`title: ${esc(doc.title)}`);
  out.push(`tradition: ${esc(doc.tradition)}`);
  out.push(`wordCount: ${doc.wordCount}`);
  out.push(`sections: ${doc.sections.length}`);
  for (const sec of doc.sections) {
    out.push(`  - ${esc(sec.heading)} (${sec.paragraphs.length} para)`);
  }
  const fns = parsePage(SAMPLE).footnotes;
  out.push(`footnotes: ${fns.length}`);
  for (const fn of fns) {
    out.push(`  [${esc(fn.n)}] ${esc(fn.text.slice(0, 48))}`);
  }
  process.stdout.write(out.join('\n') + '\n');
}
