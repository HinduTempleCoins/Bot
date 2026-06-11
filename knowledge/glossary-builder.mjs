// glossary-builder.mjs — a pure transform that turns the repo's structured
// knowledge JSON corpus into a citable, deduped, alphabetized glossary.
//
// WHY THIS EXISTS
//   The knowledge/ corpus holds many records shaped roughly like
//   { term|title, definition|summary, source }. Maps queue ids 427 ("your
//   definitions become THE definitions") and 390 (17+ topic folders) want
//   those scattered records collapsed into ONE glossary: each term appears
//   once, its multiple definitions and sources merged, sorted, and renderable
//   to citable Markdown. This module is a self-contained, deterministic
//   transform — it NEVER fetches, NEVER calls an LLM, NEVER edits the corpus.
//
// EXPORTS
//   esc(s)                          — HTML/Markdown-safe escaping for interpolation
//   buildGlossary(records, opts)    — [{term,definition,sources:[]}] sorted, deduped
//     opts.minLen (default 2)       — drop terms shorter than this (after normalize)
//   lookup(glossary, term)          — entry or null (case-insensitive)
//   renderGlossaryMarkdown(glossary)— alphabetized '### Term\ndefinition\n_sources_' md
//   firstLetterIndex(glossary)      — { A:[...], B:[...] } by first letter (uppercased)
//
//   import { buildGlossary, lookup, renderGlossaryMarkdown, firstLetterIndex }
//     from './glossary-builder.mjs';

// esc() — escape any value we interpolate into rendered text (HTML-context-safe).
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// normalize a term: coerce to string, trim, collapse internal whitespace runs.
function normTerm(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

// normalize a definition: coerce to string, trim. Missing -> '' (kept, not dropped).
function normDef(v) {
  return String(v == null ? '' : v).trim();
}

// pull the source pointer(s) off a record; accepts string or array, drops blanks.
function normSources(rec) {
  const out = [];
  const push = (s) => { const t = String(s == null ? '' : s).trim(); if (t) out.push(t); };
  if (Array.isArray(rec.sources)) rec.sources.forEach(push);
  push(rec.source);
  return out;
}

// buildGlossary — collapse corpus records into a sorted, deduped glossary.
//   records: [{ term|title, definition|summary, source|sources }]
//   Soft-fail: non-array/garbage -> []; entries missing a term are dropped;
//   missing definition is kept as ''. Dedupe is case-insensitive on the
//   normalized term; the first-seen normalized casing wins for display.
//   Multiple definitions and sources are merged (deduped, order-preserving).
export function buildGlossary(records, { minLen = 2 } = {}) {
  if (!Array.isArray(records)) return [];
  const min = Number.isFinite(minLen) ? minLen : 2;
  const byKey = new Map(); // lowercased term -> entry

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const term = normTerm(rec.term != null ? rec.term : rec.title);
    if (!term || term.length < min) continue;
    const def = normDef(rec.definition != null ? rec.definition : rec.summary);
    const sources = normSources(rec);
    const key = term.toLowerCase();

    let entry = byKey.get(key);
    if (!entry) {
      entry = { term, definition: '', _defs: [], sources: [] };
      byKey.set(key, entry);
    }
    if (def && !entry._defs.includes(def)) entry._defs.push(def);
    for (const s of sources) if (!entry.sources.includes(s)) entry.sources.push(s);
  }

  const out = [];
  for (const entry of byKey.values()) {
    out.push({
      term: entry.term,
      definition: entry._defs.join(' '),
      sources: entry.sources,
    });
  }
  // sort case-insensitively by term, then by exact term for stability.
  out.sort((a, b) => {
    const al = a.term.toLowerCase(), bl = b.term.toLowerCase();
    if (al < bl) return -1;
    if (al > bl) return 1;
    return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
  });
  return out;
}

// lookup — find an entry by term, case-insensitively. Returns the entry or null.
export function lookup(glossary, term) {
  if (!Array.isArray(glossary)) return null;
  const key = normTerm(term).toLowerCase();
  if (!key) return null;
  for (const e of glossary) {
    if (e && typeof e === 'object' && normTerm(e.term).toLowerCase() === key) return e;
  }
  return null;
}

// renderGlossaryMarkdown — alphabetized Markdown. Each entry:
//   ### Term
//   definition
//   _sources: a, b_
// All interpolated values are esc()'d. Soft-fail: non-array -> ''.
export function renderGlossaryMarkdown(glossary) {
  if (!Array.isArray(glossary)) return '';
  const blocks = [];
  for (const e of glossary) {
    if (!e || typeof e !== 'object') continue;
    const term = normTerm(e.term);
    if (!term) continue;
    const def = normDef(e.definition);
    const sources = Array.isArray(e.sources) ? e.sources.filter((s) => String(s || '').trim()) : [];
    const lines = [`### ${esc(term)}`];
    lines.push(def ? esc(def) : '');
    if (sources.length) lines.push(`_sources: ${sources.map((s) => esc(s)).join(', ')}_`);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

// firstLetterIndex — group entries by uppercased first letter of the term.
//   Returns { A:[entry,...], B:[...] }. Non-alpha first chars go under '#'.
//   Soft-fail: non-array -> {}.
export function firstLetterIndex(glossary) {
  const index = {};
  if (!Array.isArray(glossary)) return index;
  for (const e of glossary) {
    if (!e || typeof e !== 'object') continue;
    const term = normTerm(e.term);
    if (!term) continue;
    const ch = term[0].toUpperCase();
    const bucket = /[A-Z]/.test(ch) ? ch : '#';
    (index[bucket] || (index[bucket] = [])).push(e);
  }
  return index;
}
