// wikitext-render.mjs — a PURE, deterministic renderer that turns a knowledge JSON
// record (or a markdown blob) into MediaWiki wikitext (backlog item 973bd0c707).
//
// WHY THIS EXISTS
//   The ITINERARY's Phase-1 wiki bullets ("Install MediaWiki", "Generate initial 100+
//   articles") assume a Pywikibot feed of MediaWiki wikitext. Our corpus lives as
//   markdown and as structured JSON records; nothing converts either into the wikitext
//   that Pywikibot's page.text expects. This module is that bridge.
//
//   It is regex-based and deterministic: identical input → identical output. It NEVER
//   fetches, NEVER calls an LLM, and never touches any other file.
//
// EXPORTS
//   mdToWikitext(md)            — markdown → wikitext. Converts:
//                                   headings  #..######  → ==..======
//                                   bold/italic  **x** __x__ → '''x''' ; *x* _x_ → ''x''
//                                   bullet lists  - / * / +   → *
//                                   numbered lists  1. 2.     → #
//                                   links  [text](url)        → [url text]
//                                   code fences ```lang ...```→ <syntaxhighlight lang>…</…>
//   recordToArticle(record)    — {title, summary, sections:[{heading,body}], sources:[]}
//                                   → full article string, with a == References == section
//                                   built from sources as <ref> tags.
//   buildInfobox(fields)       — {{Infobox ... | k = v ... }} block from a flat object.
//   escapeWikitext(s)          — escape wiki-significant chars ([ ] { } | = * # ' < >).
//   esc(s)                     — HTML-safe escaping for any HTML interpolation.
//
//   import { mdToWikitext, recordToArticle, buildInfobox } from './wikitext-render.mjs';
//
// SOFT-FAIL CONTRACT (never throws):
//   - Non-string / null / undefined text is coerced to '' and handled.
//   - Missing record fields are skipped (no title → no heading; no sources → no
//     References section; empty sections array → just the summary).
//   - buildInfobox with no usable fields → '' (no empty box emitted).

// esc() — escape any value we interpolate into rendered HTML (kept per house style; the
// CLI prints plain wikitext, but downstream callers may embed output in HTML previews).
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// _str() — coerce anything to a string, soft-fail style. null/undefined → ''.
function _str(t) {
  return t == null ? '' : String(t);
}

// escapeWikitext(s) — escape the characters MediaWiki treats as markup so that a piece
// of plain data (a title, an infobox value) renders literally instead of being parsed.
// We escape the structural set and use HTML entities / nowiki-safe forms. Deterministic.
const _WIKI_ESC = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '{': '&#123;',
  '}': '&#125;',
  '[': '&#91;',
  ']': '&#93;',
  '|': '&#124;',
  '=': '&#61;',
  "'": '&#39;',
  '*': '&#42;',
  '#': '&#35;',
};
export function escapeWikitext(s) {
  const str = _str(s);
  if (str === '') return '';
  // Single pass over the source so emitted entity text (which itself contains '&' and
  // '#') is never re-processed and double-escaped.
  return str.replace(/[&<>{}[\]|='*#]/g, (c) => _WIKI_ESC[c]);
}

// _inline(line) — apply inline transforms (links, bold, italic) to a single line of
// already-block-classified text. Order matters: links first (so their text can then be
// emphasised), then bold (double markers) before italic (single markers).
function _inline(line) {
  let s = line;

  // [text](url) → [url text]. URL must be non-space; text is taken verbatim.
  s = s.replace(/\[([^\]]*?)\]\((\S+?)\)/g, (_m, text, url) => {
    const t = String(text).trim();
    return t === '' ? `[${url}]` : `[${url} ${t}]`;
  });

  // Bold: **x** or __x__ → '''x'''  (non-greedy, must have content)
  s = s.replace(/\*\*([^\n]+?)\*\*/g, "'''$1'''");
  s = s.replace(/__([^\n]+?)__/g, "'''$1'''");

  // Italic: *x* or _x_ → ''x''  (avoid eating the bold markers we just produced by
  // requiring the single marker not to be adjacent to another of its own kind)
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*([^*]|$)/g, "$1''$2''$3");
  s = s.replace(/(^|[^_])_([^_\n]+?)_([^_]|$)/g, "$1''$2''$3");

  return s;
}

// mdToWikitext(md) — convert a markdown blob to MediaWiki wikitext. Line-oriented with a
// fenced-code state machine so inline rules never touch code. Soft-fail on bad input.
export function mdToWikitext(md) {
  const src = _str(md);
  if (src.trim() === '') return '';

  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];

  let inFence = false;
  let fenceLang = '';
  let fenceBuf = [];

  for (const raw of lines) {
    const line = raw;

    // Fenced code block toggling. ``` or ```lang opens; ``` closes.
    const fenceMatch = line.match(/^\s*```(.*)$/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceLang = fenceMatch[1].trim();
        fenceBuf = [];
      } else {
        // close: emit a <syntaxhighlight> block (with lang attr when known).
        const attr = fenceLang !== '' ? ` lang="${esc(fenceLang)}"` : '';
        out.push(`<syntaxhighlight${attr}>`);
        for (const b of fenceBuf) out.push(b);
        out.push('</syntaxhighlight>');
        inFence = false;
        fenceLang = '';
        fenceBuf = [];
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line); // verbatim, no inline transforms inside code
      continue;
    }

    // Headings: leading #..###### → ==..======. Count hashes, clamp 1..6.
    const h = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      // Markdown level N → wiki level N+1: MediaWiki reserves the single "=" level for
      // the page title, so an H1 "#" maps to "==", H2 to "===", … (clamped at 6).
      const level = Math.min(h[1].length + 1, 6);
      const eq = '='.repeat(level);
      out.push(`${eq} ${_inline(h[2].trim())} ${eq}`);
      continue;
    }

    // Numbered list item: "1. text" / "  2) text" → "# text"
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      out.push(`# ${_inline(ol[1])}`);
      continue;
    }

    // Bullet list item: "- text" / "* text" / "+ text" → "* text"
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      out.push(`* ${_inline(ul[1])}`);
      continue;
    }

    // Plain line (including blanks) — run inline transforms.
    out.push(_inline(line));
  }

  // Soft-fail on an unterminated fence: flush whatever we buffered as a code block.
  if (inFence) {
    const attr = fenceLang !== '' ? ` lang="${esc(fenceLang)}"` : '';
    out.push(`<syntaxhighlight${attr}>`);
    for (const b of fenceBuf) out.push(b);
    out.push('</syntaxhighlight>');
  }

  return out.join('\n');
}

// buildInfobox(fields) — render a flat {key: value} object as an {{Infobox …}} block.
// A "name" field (if present) becomes the infobox title line; everything else becomes a
// "| key = value" row. Values are wikitext-escaped so data can't break out of the box.
// Soft-fail: non-object / no usable fields → ''.
export function buildInfobox(fields) {
  if (fields == null || typeof fields !== 'object' || Array.isArray(fields)) return '';

  const entries = Object.entries(fields).filter(
    ([k, v]) => k != null && String(k).trim() !== '' && v != null && String(v) !== ''
  );
  if (entries.length === 0) return '';

  const rows = [];
  for (const [k, v] of entries) {
    // The key names a parameter; escape it lightly (spaces ok, but no pipes/equals).
    const key = String(k).trim().replace(/[|=]/g, '').replace(/\s+/g, ' ');
    rows.push(`| ${key} = ${escapeWikitext(v)}`);
  }

  return ['{{Infobox', ...rows, '}}'].join('\n');
}

// _sectionToWikitext({heading, body}) — render one article section. Heading → level-2
// "== … ==" when present; body is treated as markdown and converted. Missing body → ''.
function _sectionToWikitext(section) {
  if (section == null || typeof section !== 'object') return '';
  const parts = [];
  const heading = _str(section.heading).trim();
  if (heading !== '') parts.push(`== ${heading} ==`);
  const body = mdToWikitext(_str(section.body));
  if (body.trim() !== '') parts.push(body);
  return parts.join('\n');
}

// recordToArticle(record) — assemble a full MediaWiki article from a knowledge record.
//   { title, summary, sections:[{heading, body}], sources:[ ...strings ] }
// Layout:  <summary, markdown→wikitext>  then each section  then == References == with
// each source as a <ref>…</ref> on its own bullet. Missing pieces are skipped.
// Soft-fail: non-object → ''.
export function recordToArticle(record) {
  if (record == null || typeof record !== 'object' || Array.isArray(record)) return '';

  const blocks = [];

  // Summary / lead paragraph (markdown-aware). Title is intentionally NOT emitted as a
  // heading — MediaWiki derives the page title from the page name, not the body — but we
  // keep it available for callers via the returned text's first bolded lead when present.
  const title = _str(record.title).trim();
  const summary = mdToWikitext(_str(record.summary));
  if (summary.trim() !== '') {
    // Bold the title at the head of the lead, MediaWiki-style, when both exist.
    if (title !== '') blocks.push(`'''${title}''' ${summary}`.trim());
    else blocks.push(summary);
  } else if (title !== '') {
    blocks.push(`'''${title}'''`);
  }

  // Sections.
  const sections = Array.isArray(record.sections) ? record.sections : [];
  for (const sec of sections) {
    const w = _sectionToWikitext(sec);
    if (w.trim() !== '') blocks.push(w);
  }

  // References, built from sources. Each source becomes a bulleted <ref> tag.
  const sources = Array.isArray(record.sources) ? record.sources : [];
  const usable = sources
    .map((s) => _str(s).trim())
    .filter((s) => s !== '');
  if (usable.length > 0) {
    const refLines = ['== References =='];
    for (const s of usable) refLines.push(`* <ref>${escapeWikitext(s)}</ref>`);
    refLines.push('<references />');
    blocks.push(refLines.join('\n'));
  }

  return blocks.join('\n\n');
}

// __setReader — injectable IO seam for the CLI's file read (house style). Tests never
// use it (they call the pure exports directly), so IO stays fully out of the suite.
let _reader = null;
export function __setReader(fn) {
  _reader = fn;
}

// ── CLI DEMO ───────────────────────────────────────────────────────────────────────
// Renders a JSON file arg (a knowledge record) to wikitext on stdout. With no arg, an
// inline sample is rendered so the demo never needs I/O. Guarded so import never runs it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];

  const render = (record) => process.stdout.write(recordToArticle(record) + '\n');

  if (arg) {
    // Read + parse the JSON file via the injectable reader (defaults to fs).
    (async () => {
      try {
        let text;
        if (_reader) {
          text = await _reader(arg);
        } else {
          const { readFile } = await import('node:fs/promises');
          text = await readFile(arg, 'utf8');
        }
        let record;
        try {
          record = JSON.parse(text);
        } catch {
          process.stderr.write('wikitext-render: arg is not valid JSON\n');
          record = {};
        }
        render(record);
      } catch {
        process.stderr.write(`wikitext-render: could not read ${esc(arg)}\n`);
      }
    })();
  } else {
    const SAMPLE = {
      title: 'Phoenix Protocol',
      summary:
        'A **continuity** framework. See the [overview](https://example.org/p) for context.',
      sections: [
        {
          heading: 'Origins',
          body: '# Beginnings\n\nIt started with:\n\n- a list\n- of *ideas*\n\n```js\nconst x = 1;\n```',
        },
        { heading: 'Method', body: 'Steps:\n\n1. first\n2. second' },
      ],
      sources: ['Doe, J. (2017). On Continuity.', 'https://example.org/ref'],
    };
    render(SAMPLE);
  }
}
