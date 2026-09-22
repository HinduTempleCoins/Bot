// spirit-of-the-laws.mjs — loader/validator + lookups for the "Spirit of the Laws" teaching corpus
// (knowledge/legal/spirit-of-the-laws.json). Feeds the teaching surfaces (site/lexicon,
// site/philosophy, site/politics, site/law appeals) with the SAME sourced examples so each can
// embed identical, verified blurbs and study cards.
//
// WHAT THIS IS: a small, PURE module over a committed JSON corpus on Montesquieu's The Spirit of the
// Laws (1748), separation of powers, and judicial interpretation-by-purpose (purposivism / the
// mischief rule / letter-vs-spirit). It validates the corpus shape, exposes lookups
// (cases, casesFor(method), blurbsFor(theme), readingList, montesquieu, counterpoint), and renders
// escaped HTML study cards / blurbs.
//
// DISCIPLINE (Charter §3 — this is legal-education material people rely on):
//   • FACTS + SOURCES, never invented. Every case carries a source_url + pincite; quotes were verified
//     verbatim against reputable sources. A quote that could not be confirmed is null in the data with
//     a quote_note — this module surfaces that note and NEVER fabricates a quote/cite.
//   • PURE + soft-fail: offline, no network, never throws. Bad input → [] / null / '' .
//     An injectable fetch seam (__setFetch) exists ONLY for a possible future live-revalidation pass;
//     nothing here fetches at load or in the lookups.
//
//   import { load, cases, casesFor, blurbsFor, readingList, montesquieu, counterpoint,
//            methods, themes, renderCase, renderBlurb, __setFetch, __setData }
//     from './spirit-of-the-laws.mjs'
//   node integrations/soapbox/spirit-of-the-laws.mjs cases
//   node integrations/soapbox/spirit-of-the-laws.mjs method purposivist
//   node integrations/soapbox/spirit-of-the-laws.mjs blurb letter-vs-spirit
//   node integrations/soapbox/spirit-of-the-laws.mjs reading

import { readFileSync } from 'node:fs';

// ── injectable fetch seam (unused by current pure lookups; present for a future revalidation pass) ──
let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── html escape (same contract as the other soapbox readers) ──
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const esc = escapeHtml;

const DATA_URL = new URL('../../knowledge/legal/spirit-of-the-laws.json', import.meta.url);

let _data = null; // cached parsed corpus (soft: null on failure)

/**
 * Load + cache the committed corpus. Soft-fail: returns a well-formed empty corpus on any error,
 * never throws. `fresh` bypasses the cache (for tests).
 */
export function load({ fresh = false } = {}) {
  if (_data && !fresh) return _data;
  try {
    const raw = readFileSync(DATA_URL, 'utf8');
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.cases)) throw new Error('missing cases[]');
    _data = d;
  } catch {
    _data = { title: '', montesquieu: {}, cases: [], counterpoint: {}, reading_list: [], blurbs: {}, _error: true };
  }
  return _data;
}

/** Test hook: inject a corpus object directly (bypasses the file). Pass nothing to clear. */
export function __setData(d) { _data = d || null; }

const str = (v) => (v == null ? '' : String(v)).trim();
const lower = (v) => str(v).toLowerCase();

/** All case entries (as stored). */
export function cases() {
  const d = load();
  return Array.isArray(d.cases) ? d.cases.slice() : [];
}

/** The distinct interpretive methods present in the corpus (sorted). */
export function methods() {
  return [...new Set(cases().map((c) => str(c && c.method)).filter(Boolean))].sort();
}

/**
 * Case entries for an interpretive method (case-insensitive; matches the `method` field, e.g.
 * 'purposivist', 'mischief-rule', 'separation-of-powers-Montesquieu', 'plain-meaning-counterpoint').
 */
export function casesFor(method) {
  const m = lower(method);
  if (!m) return [];
  return cases().filter((c) => c && lower(c.method) === m);
}

/** The distinct blurb themes available (sorted). */
export function themes() {
  const d = load();
  return Object.keys((d && d.blurbs) || {}).sort();
}

/**
 * The drop-in teaching blurb for a theme (verbatim string, already ends with a real case cite), or
 * '' if unknown. Themes: separation-of-powers, letter-vs-spirit, mischief-rule, purposivism,
 * original-intent, textualist-counterpoint, montesquieu-alive.
 */
export function blurbsFor(theme) {
  const d = load();
  const b = (d && d.blurbs) || {};
  const key = str(theme);
  return str(b[key]);
}

/** The reading list (verified real editions), as stored. */
export function readingList() {
  const d = load();
  return Array.isArray(d.reading_list) ? d.reading_list.slice() : [];
}

/** The montesquieu overview block, or {}. */
export function montesquieu() {
  const d = load();
  return (d && d.montesquieu) || {};
}

/** The textualist counterpoint block, or {}. */
export function counterpoint() {
  const d = load();
  return (d && d.counterpoint) || {};
}

// ── render helpers (escaped) ──

/** Render one case entry as an escaped HTML study card. */
export function renderCase(entry) {
  const c = entry;
  if (!c || typeof c !== 'object') return '';
  const cite = [str(c.case), str(c.citation)].filter(Boolean).join(', ');
  const q = str(c.quote);
  const note = str(c.quote_note);
  const src = str(c.source_url);
  return [
    `<article class="sol-case" data-method="${esc(str(c.method))}">`,
    cite ? `<h3>${esc(cite)}</h3>` : '',
    c.court ? `<div class="sol-court">${esc(str(c.court))}</div>` : '',
    c.holding ? `<p class="sol-holding">${esc(str(c.holding))}</p>` : '',
    q ? `<blockquote class="sol-quote">${esc(q)}</blockquote>`
      : (note ? `<p class="sol-quote-missing">Quote not yet verified verbatim — ${esc(note)}</p>` : ''),
    (q && note) ? `<p class="sol-quote-note">${esc(note)}</p>` : '',
    c.pincite ? `<div class="sol-pincite">${esc(str(c.pincite))}</div>` : '',
    src ? `<div class="sol-source"><a href="${esc(src)}">Source</a></div>` : '',
    c.teaching_blurb ? `<p class="sol-blurb">${esc(str(c.teaching_blurb))}</p>` : '',
    `</article>`,
  ].filter(Boolean).join('\n');
}

/** Render a theme's drop-in blurb as an escaped HTML paragraph (or '' if unknown). */
export function renderBlurb(theme) {
  const t = blurbsFor(theme);
  if (!t) return '';
  return `<p class="sol-teach" data-theme="${esc(str(theme))}">${esc(t)}</p>`;
}

// ── guarded CLI demo (never runs under import / tests) ──
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, a] = process.argv.slice(2);
  if (cmd === 'cases') {
    console.log(cases().map((c) => `${c.case}, ${c.citation} [${c.method}]`).join('\n'));
  } else if (cmd === 'method' && a) {
    console.log(casesFor(a).map((c) => `${c.case}, ${c.citation}`).join('\n') || `(no cases for method ${a})`);
    console.log(`\nmethods: ${methods().join(', ')}`);
  } else if (cmd === 'blurb' && a) {
    console.log(blurbsFor(a) || `(no blurb for theme ${a}); themes: ${themes().join(', ')}`);
  } else if (cmd === 'reading') {
    console.log(readingList().map((r) => `${r.author} — ${r.title}`).join('\n'));
  } else if (cmd === 'themes') {
    console.log(themes().join('\n'));
  } else {
    console.log('usage: spirit-of-the-laws.mjs cases | method <method> | blurb <theme> | reading | themes');
    console.log(`\ncases: ${cases().length} | methods: ${methods().join(', ')} | themes: ${themes().join(', ')}`);
  }
}
