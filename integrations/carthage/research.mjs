// research.mjs — build a sourced dossier for ONE Type E bulletpoint of the Carthage Bible.
//
// THE ORDER IS THE METHOD. Part 1 of the operator's reading guide opens with him correcting the
// previous attempt — "I created an outline based on emails rather than reading this" — and states
// the purpose as "Document actual content before applying email expansions." So parse.mjs reads
// the SOURCE first and this module never runs before it. Within this module the order is again
// load-bearing, and the operator set it (2026-10-22):
//
//   "Not AI APIs that isn't what I meant. But we can use that also. I meant for Book Stuff and
//    like using the Resource Center Scraper Search Engine stuff, and then like Things use for
//    Reference Book Writing and Things, we aren't Selling the Book, so it's Fair Use."
//
//   tier 1  local growth/ corpora — EMAILS FIRST. The guides are explicit that the emails are the
//           primary expansion source: "Source material in emails - search email archive using
//           keywords." Excerpts are ordered CHRONOLOGICALLY, as § Expansion Protocol step 3 says
//           ("the author's understanding developed over time").
//   tier 2  the rest of the Carthage Bible itself — the author has usually already written on the
//           subject somewhere else in the 19 books.
//   tier 3  our-search.mjs — our own federated front door (library-index, library-rag,
//           cheetah-search, melek-chain-search, the SoapBox verticals).
//   tier 4  booklore — the Book Memory System. Search what is already ingested; where a needed
//           reference book is not ingested, ingest a FEW leaf pages from the sacred-texts.com /
//           theoi.com seeds (RATE-LIMITED — both are small non-profits) and search again.
//   tier 5  keyless book/scholarly APIs — gutendex, openlibrary, crossref, arxiv, semanticScholar.
//   tier 6  keyed research APIs (TAVILY/EXA/FIRECRAWL) — LAST RESORT, only when every tier above
//           came back empty. Keys are read JIT from the environment, never printed, never stored.
//
// EVERY entry carries provenance, and for external entries the QUOTED PASSAGE ITSELF: this is a
// reference-book writing pipeline, so the quotation is the deliverable, not the link. External
// entries are additionally tagged with public-domain status via integrations/public-domain.mjs.
// The operator's position is that the book is not being sold, so quoting reference works is fair
// use; we record the status anyway so a later reader can tell outright-PD from fair-use quotation.
//
// House style: injectable fetch (__setFetch) and injectable collaborators (__setDeps) so the test
// suite runs fully offline. Soft-fail everywhere — a dead tier contributes nothing and never throws.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_ROOT, loadSource, esc, SOURCE_REL } from './parse.mjs';

// ── injectable fetch ─────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : (...a) => globalThis.fetch(...a); }

// ── injectable collaborators (tests pass fakes; prod resolves the real modules) ──
let _deps = null;
export function __setDeps(obj) { _deps = obj && typeof obj === 'object' ? obj : null; }

async function dep(name, loader) {
  if (_deps && Object.prototype.hasOwnProperty.call(_deps, name)) return _deps[name];
  try { return await loader(); } catch { return null; }
}

// ── tiers ────────────────────────────────────────────────────────────────────
export const TIERS = Object.freeze({
  local: 1, book: 2, ourSearch: 3, booklore: 4, bookApis: 5, keyed: 6,
});

// Emails first — the guides name them as the expansion source. brujeria is LAST because it holds
// the book and its reading guides, which tier 2 covers properly.
export const LOCAL_ORDER = Object.freeze([
  'emails', 'mail', 'teaching', 'threadlist', 'marsresident', 'warchristmas', 'brujeria',
]);

const TEXT_EXT = new Set(['.md', '.txt', '.tsv', '.csv', '.json', '.jsonl', '.html', '.htm']);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

// ── keywords ─────────────────────────────────────────────────────────────────
const STOP = new Set(('the a an and or of in on to for with as at by from is are was were be this ' +
  'that these those our your their his her its it he she they we you i not but so then there ' +
  'about over under into also such which who whom when while if because quote quotes verse ' +
  'verses excerpt excerpts etc').split(' '));

// The guides work one example end to end — "Book of Tobit Jesus Fish" → IXOYE, Tobit, Fish,
// Ichthys, Pisces, Sibylline — so the expansions nobody can derive from the label are written down
// here rather than guessed at. Extend deliberately; `extraTerms` covers one-off cases.
export const ALIASES = Object.freeze({
  'jesus fish': ['IXOYE', 'Ichthys', 'Age of Pisces', 'Sibylline'],
  tobit: ['Raphael', 'Ichthys', 'Sibylline'],
  baphomet: ['Eliphas Levi', 'Dogma et Rituel', 'Templar', 'Pan'],
  pythia: ['Delphi', 'Oracle', 'Apollo', 'tripod'],
  'potnia theron': ['Mistress of the Animals', 'Linear B', 'Artemis'],
  pashupati: ['Lord of the Animals', 'Indus Valley', 'Mohenjo-daro', 'Shiva'],
  ogdoad: ['Hermopolis', 'Nun', 'Amun', 'Kek'],
  'nabta playa': ['calendar circle', 'Nubia', 'star map', 'scarab'],
  'splendor solis': ['Salomon Trismosin', 'alchemy', 'illumination'],
  'king scorpion': ['Scorpion II', 'Narmer', 'Upper and Lower Egypt'],
  thoth: ['Djehuti', 'Hermes', 'Mercury', 'Trismegistus'],
  'plato on atlantis': ['Timaeus', 'Critias', 'Atlantis'],
  myrmidon: ['Achilles', 'Aegina', 'ant-people'],
  'nut and geb': ['Shu', 'Tefnut', 'sky goddess', 'earth god'],
  blavatsky: ['Theosophy', 'Isis Unveiled', 'Secret Doctrine', 'pentagram'],
});

/**
 * Search terms for one bulletpoint: the whole label as a phrase, its content words, its note's
 * content words, and any alias set the guides worked out for it.
 * @returns {{phrase:string, terms:string[]}}
 */
export function keywordsFor(bp = {}, { extraTerms = [] } = {}) {
  const phrase = String(bp.text || '').replace(/[,;:]+$/, '').trim();
  const raw = `${phrase} ${bp.note || ''}`.toLowerCase();
  const words = (raw.match(/[a-zÀ-ɏ][a-zÀ-ɏ'’-]{2,}/g) || [])
    .filter((w) => !STOP.has(w.replace(/['’-]/g, '')));
  const terms = new Set();
  if (phrase) terms.add(phrase);
  for (const w of words) terms.add(w);
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (raw.includes(key)) for (const a of aliases) terms.add(a);
  }
  for (const t of extraTerms || []) if (t) terms.add(String(t));
  return { phrase, terms: [...terms].slice(0, 24) };
}

// ── tier 1: the local growth/ corpora ────────────────────────────────────────
function walk(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.isFile() && TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const _corpusCache = new Map();

/** Read every text file of the growth corpora once, emails-first. Cached per root. */
export function loadLocalCorpus(root = CORPUS_ROOT()) {
  if (_corpusCache.has(root)) return _corpusCache.get(root);
  const docs = [];
  for (const corpus of LOCAL_ORDER) {
    for (const file of walk(path.join(root, corpus))) {
      // the Carthage Bible itself is tier 2, never tier 1 — otherwise the same passage would be
      // served twice with two different provenances
      if (path.basename(file) === path.basename(SOURCE_REL)) continue;
      try {
        if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (!text) continue;
        docs.push({ corpus, file, lines: text.split('\n') });
      } catch { /* a file we cannot read simply is not in the corpus */ }
    }
  }
  _corpusCache.set(root, docs);
  return docs;
}

/** Drop the cache (tests, or after a re-sync of the corpus). */
export function __clearCorpusCache() { _corpusCache.clear(); }

const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;

// The date of an excerpt: the message/post date nearest ABOVE it, else the date in the filename.
function dateFor(doc, idx) {
  for (let i = idx; i >= 0 && i > idx - 400; i--) {
    const m = doc.lines[i].match(/^\s*(?:#{1,6}\s*)?(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2})?/);
    if (m) return m[1];
  }
  const fm = path.basename(doc.file).match(ISO_DATE);
  return fm ? fm[0] : null;
}

function windowAround(lines, i, span = 3) {
  return lines.slice(Math.max(0, i - span), Math.min(lines.length, i + span + 1))
    .join('\n').trim().slice(0, 1200);
}

function termRegex(term) {
  const t = String(term).trim();
  if (!t) return null;
  const body = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const wordish = /^[\wÀ-ɏ]/.test(t) && /[\wÀ-ɏ]$/.test(t);
  try { return new RegExp(wordish ? `\\b${body}\\b` : body, 'i'); } catch { return null; }
}

/**
 * Tier 1. Keyword hits across the growth corpora, emails first and CHRONOLOGICAL within the tier.
 * @returns {Array} dossier entries
 */
export function searchLocal(keywords, { root = CORPUS_ROOT(), max = 24, perFile = 3 } = {}) {
  const terms = (keywords?.terms || []).map((t) => ({ t, re: termRegex(t) })).filter((x) => x.re);
  if (!terms.length) return [];
  const phraseRe = termRegex(keywords?.phrase || '');
  const docs = loadLocalCorpus(root);
  const hits = [];
  for (const doc of docs) {
    let got = 0;
    for (let i = 0; i < doc.lines.length && got < perFile; i++) {
      const line = doc.lines[i];
      if (line.length < 3) continue;
      // A single common word ("fish", "tales") matches half the archive and is not evidence of
      // anything. A line counts when it carries the WHOLE placeholder phrase, or at least two of
      // its distinct terms.
      const matched = terms.filter((x) => x.re.test(line));
      const isPhrase = !!(phraseRe && phraseRe.test(line));
      if (!isPhrase && matched.length < 2) continue;
      const hit = matched[0] || { t: keywords.phrase };
      got++;
      hits.push({
        tier: TIERS.local,
        tierName: 'local',
        source: doc.corpus,
        term: hit.t,
        terms: matched.map((x) => x.t),
        phraseMatch: isPhrase,
        title: `${doc.corpus}/${path.basename(doc.file)}`,
        matchedLine: line.trim().slice(0, 400),
        quote: windowAround(doc.lines, i),
        date: dateFor(doc, i),
        provenance: { kind: 'local', corpus: doc.corpus, file: doc.file, line: i + 1 },
      });
    }
  }
  // corpus priority first (emails lead), then chronological inside each corpus — Expansion
  // Protocol step 3: "Compile excerpts chronologically (author's understanding developed over time)".
  const order = (c) => { const i = LOCAL_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  hits.sort((a, b) =>
    order(a.source) - order(b.source) ||
    String(a.date || '9999').localeCompare(String(b.date || '9999')) ||
    a.provenance.file.localeCompare(b.provenance.file));
  return hits.slice(0, max);
}

// ── tier 2: the rest of the Carthage Bible ───────────────────────────────────
/** Tier 2. Where else in the 19 books has the author already written on this? */
export function searchBook(keywords, { text, root = CORPUS_ROOT(), excludeLine = null, span = 6, max = 12 } = {}) {
  const src = text != null ? String(text) : loadSource(root).text;
  if (!src) return [];
  const terms = (keywords?.terms || []).map((t) => ({ t, re: termRegex(t) })).filter((x) => x.re);
  if (!terms.length) return [];
  const phraseRe = termRegex(keywords?.phrase || '');
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    if (excludeLine && Math.abs(i + 1 - excludeLine) <= span) continue;  // not its own placeholder
    const line = lines[i];
    if (line.trim().length < 40) continue;              // skip other bulletpoints and list rows
    const matched = terms.filter((x) => x.re.test(line));
    const isPhrase = !!(phraseRe && phraseRe.test(line));
    if (!isPhrase && matched.length < 2) continue;      // same evidence bar as tier 1
    const hit = matched[0] || { t: keywords.phrase };
    out.push({
      tier: TIERS.book,
      tierName: 'book',
      source: 'carthage-bible',
      term: hit.t,
      terms: matched.map((x) => x.t),
      phraseMatch: isPhrase,
      title: 'The Carthage Bible (Biblia El Kartago)',
      matchedLine: line.trim().slice(0, 400),
      quote: windowAround(lines, i, 3),
      provenance: { kind: 'local', corpus: 'brujeria', file: 'The_Book_of_Tanit19.txt', line: i + 1 },
    });
    i += span;                                           // one hit per neighbourhood
  }
  return out;
}

// ── public-domain tagging ────────────────────────────────────────────────────
const FAIR_USE_NOTE =
  'Quoted for reference-book writing; the work is not being sold (operator, 2026-10-22). ' +
  'Status recorded so a later reader can tell outright public domain from fair-use quotation.';

async function tagPd(entry, info) {
  const pd = await dep('publicDomain', () => import('../public-domain.mjs'));
  let status = { status: 'unknown', reason: 'no publication data available', entersPdYear: null };
  try { if (pd && pd.classify) status = pd.classify(info || {}); } catch { /* soft-fail */ }
  return { ...entry, publicDomain: { ...status, fairUse: FAIR_USE_NOTE } };
}

function yearIn(s) {
  const m = String(s || '').match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? Number(m[1]) : undefined;
}

function hostOf(url) { try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return null; } }

function today() { return new Date().toISOString().slice(0, 10); }

// ── tier 3: our own federated search ─────────────────────────────────────────
async function tierOurSearch(keywords, { k = 8 } = {}) {
  const mod = await dep('ourSearch', () => import('../our-search.mjs'));
  if (!mod || typeof mod.search !== 'function') return [];
  let res = null;
  try { res = await mod.search(keywords.phrase || (keywords.terms || [])[0] || '', { k }); } catch { return []; }
  const hits = (res && res.hits) || [];
  return Promise.all(hits.map((h) => tagPd({
    tier: TIERS.ourSearch,
    tierName: 'our-search',
    source: `our-search:${h.source || 'unknown'}`,
    title: h.title || '(untitled)',
    quote: h.snippet || '',
    sourceType: 'wiki',
    confidence: Number(h.score) || 0,
    provenance: {
      kind: /^https?:/i.test(String(h.link || '')) ? 'external' : 'ours',
      url: h.link || null, host: hostOf(h.link), retrieved: today(),
    },
  }, { pubYear: yearIn(h.title) })));
}

// ── tier 4: booklore (the Book Memory System) ────────────────────────────────
/** Pick a few seed leaf/index URLs plausibly about this bulletpoint. Politeness: few, not many. */
export async function seedUrlsFor(keywords, { max = 3 } = {}) {
  const seeds = await dep('seeds', () => import('../booklore/sources.mjs'));
  if (!seeds || typeof seeds.allSeedUrls !== 'function') return [];
  let all = [];
  try { all = seeds.allSeedUrls() || []; } catch { return []; }
  const terms = (keywords.terms || []).map((t) => String(t).toLowerCase());
  const scored = all.map((s) => {
    const hay = `${s.title} ${s.url}`.toLowerCase();
    return { s, n: terms.filter((t) => t.length > 3 && hay.includes(t)).length };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  return scored.slice(0, max).map((x) => x.s.url);
}

async function tierBooklore(keywords, { limit = 6, ingest = false, maxIngest = 3 } = {}) {
  const bl = await dep('booklore', () => import('../booklore/booklore.mjs'));
  if (!bl || typeof bl.search !== 'function') return [];
  const q = keywords.phrase || (keywords.terms || [])[0] || '';
  let hits = [];
  try { hits = (await bl.search(q, { limit })) || []; } catch { hits = []; }

  if (!hits.length && ingest && typeof bl.ingestMany === 'function') {
    const urls = (await seedUrlsFor(keywords, { max: maxIngest })) || [];
    // booklore.mjs spaces its own fetches (POLITE_DELAY_MS) and sacred-texts.mjs holds
    // RATE_LIMIT_MS between requests. We only ever hand it a handful of URLs at a time.
    if (urls.length) {
      try { await bl.ingestMany(urls, { polite: true }); } catch { /* soft-fail */ }
      try { hits = (await bl.search(q, { limit })) || []; } catch { hits = []; }
    }
  }

  return Promise.all(hits.map((h) => tagPd({
    tier: TIERS.booklore,
    tierName: 'booklore',
    source: `booklore:${h.host || 'corpus'}`,
    title: h.title || '(untitled)',
    quote: h.chunk || h.snippet || '',
    sourceType: 'wiki',
    confidence: Number(h.score) || 0,
    provenance: { kind: 'external', url: h.url || null, host: h.host || hostOf(h.url), retrieved: today() },
  }, { pubYear: yearIn(h.title) })));
}

// ── tier 5: keyless book / scholarly APIs ────────────────────────────────────
async function tierBookApis(keywords, { limit = 6 } = {}) {
  const api = await dep('bookApis', async () => {
    const m = await import('../free-apis.mjs');
    return { gutendex: m.news?.gutendex, ...m.knowledge };
  });
  if (!api) return [];
  const q = keywords.phrase || (keywords.terms || [])[0] || '';
  if (!q) return [];
  const out = [];

  const push = async (e, info) => { out.push(await tagPd(e, info)); };

  // Project Gutenberg — full public-domain texts, the best possible reference source here.
  try {
    const g = await api.gutendex?.(q);
    for (const b of (g?.results || []).slice(0, limit)) {
      const url = b.formats?.['text/plain; charset=utf-8'] || b.formats?.['text/html'] ||
        (b.id ? `https://www.gutenberg.org/ebooks/${b.id}` : null);
      await push({
        tier: TIERS.bookApis, tierName: 'book-apis', source: 'gutendex',
        title: b.title || '(untitled)',
        quote: `${(b.authors || []).map((a) => a.name).join('; ')}${b.subjects ? ` — ${(b.subjects || []).slice(0, 4).join('; ')}` : ''}`,
        sourceType: 'scholarly', confidence: 0.8,
        provenance: { kind: 'external', url, host: 'gutenberg.org', retrieved: today() },
      }, { authorDeathYear: (b.authors || [])[0]?.death_year, pubYear: (b.authors || [])[0]?.death_year });
    }
  } catch { /* soft-fail */ }

  try {
    const o = await api.openlibrary?.(q);
    for (const d of (o?.docs || []).slice(0, limit)) {
      await push({
        tier: TIERS.bookApis, tierName: 'book-apis', source: 'openlibrary',
        title: d.title || '(untitled)',
        quote: `${(d.author_name || []).join('; ')}${d.first_publish_year ? ` (${d.first_publish_year})` : ''}`,
        sourceType: 'scholarly', confidence: 0.7,
        provenance: { kind: 'external', url: d.key ? `https://openlibrary.org${d.key}` : null, host: 'openlibrary.org', retrieved: today() },
      }, { pubYear: d.first_publish_year });
    }
  } catch { /* soft-fail */ }

  try {
    const c = await api.crossref?.(q);
    for (const it of (c?.message?.items || []).slice(0, limit)) {
      await push({
        tier: TIERS.bookApis, tierName: 'book-apis', source: 'crossref',
        title: (it.title || [])[0] || '(untitled)',
        quote: `${(it.author || []).map((a) => `${a.family || ''}`.trim()).filter(Boolean).join('; ')}${it.abstract ? ` — ${String(it.abstract).replace(/<[^>]+>/g, '').slice(0, 400)}` : ''}`,
        sourceType: 'scholarly', confidence: 0.75,
        provenance: { kind: 'external', url: it.URL || (it.DOI ? `https://doi.org/${it.DOI}` : null), host: 'crossref.org', retrieved: today() },
      }, { pubYear: it.issued?.['date-parts']?.[0]?.[0] });
    }
  } catch { /* soft-fail */ }

  try {
    const s = await api.semanticScholar?.(q);
    for (const p of (s?.data || []).slice(0, limit)) {
      await push({
        tier: TIERS.bookApis, tierName: 'book-apis', source: 'semanticScholar',
        title: p.title || '(untitled)', quote: p.abstract || '',
        sourceType: 'scholarly', confidence: 0.75,
        provenance: { kind: 'external', url: p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : null, host: 'semanticscholar.org', retrieved: today() },
      }, { pubYear: p.year });
    }
  } catch { /* soft-fail */ }

  try {
    const a = await api.arxiv?.(q);
    for (const m of String(a || '').matchAll(/<entry>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<id>([\s\S]*?)<\/id>[\s\S]*?<summary>([\s\S]*?)<\/summary>/g)) {
      await push({
        tier: TIERS.bookApis, tierName: 'book-apis', source: 'arxiv',
        title: m[1].trim(), quote: m[3].trim().slice(0, 600),
        sourceType: 'scholarly', confidence: 0.6,
        provenance: { kind: 'external', url: m[2].trim(), host: 'arxiv.org', retrieved: today() },
      }, { pubYear: yearIn(m[2]) });
    }
  } catch { /* soft-fail */ }

  return out;
}

// ── tier 6: keyed research APIs (last resort) ────────────────────────────────
// Keys are read from the environment at call time only. They are never logged, never returned in a
// dossier, and never written to disk. Where the env file lives is recorded in .local/, not here.
function keyedProvider() {
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.EXA_API_KEY) return 'exa';
  if (process.env.FIRECRAWL_API_KEY) return 'firecrawl';
  return null;
}

async function tierKeyed(keywords, { limit = 5 } = {}) {
  const provider = keyedProvider();
  if (!provider) return [];
  const q = keywords.phrase || (keywords.terms || [])[0] || '';
  if (!q) return [];
  let rows = [];
  try {
    if (provider === 'tavily') {
      const r = await _fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: q, max_results: limit }),
      });
      const j = await r.json();
      rows = (j?.results || []).map((x) => ({ title: x.title, url: x.url, text: x.content }));
    } else if (provider === 'exa') {
      const r = await _fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.EXA_API_KEY },
        body: JSON.stringify({ query: q, numResults: limit, contents: { text: true } }),
      });
      const j = await r.json();
      rows = (j?.results || []).map((x) => ({ title: x.title, url: x.url, text: x.text }));
    } else {
      const r = await _fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
        body: JSON.stringify({ query: q, limit }),
      });
      const j = await r.json();
      rows = (j?.data || []).map((x) => ({ title: x.title, url: x.url, text: x.markdown || x.description }));
    }
  } catch { return []; }

  return Promise.all(rows.filter((x) => x && x.url).map((x) => tagPd({
    tier: TIERS.keyed,
    tierName: 'keyed',
    source: provider,
    title: x.title || '(untitled)',
    quote: String(x.text || '').slice(0, 1200),
    sourceType: 'web',
    confidence: 0.4,
    provenance: { kind: 'external', url: x.url, host: hostOf(x.url), retrieved: today() },
  }, { pubYear: yearIn(x.title) })));
}

// ── ranking ──────────────────────────────────────────────────────────────────
// Tier order is absolute — it IS the method — so we only ever rank WITHIN a tier, using the shared
// authority ranking from integrations/grounding-sources.mjs rather than a scheme of our own.
async function rankWithinTiers(entries) {
  const g = await dep('grounding', () => import('../grounding-sources.mjs'));
  const byTier = new Map();
  for (const e of entries) {
    if (!byTier.has(e.tier)) byTier.set(e.tier, []);
    byTier.get(e.tier).push(e);
  }
  const out = [];
  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const group = byTier.get(tier);
    if (tier >= TIERS.ourSearch && g && typeof g.rankSources === 'function') {
      try {
        const ranked = g.rankSources(group.map((e) => ({ ...e, url: e.provenance?.url || e.title })));
        out.push(...ranked);
        continue;
      } catch { /* fall through to insertion order */ }
    }
    out.push(...group);     // tiers 1-2 keep their corpus-priority + chronological order
  }
  return out.map((e, i) => ({ ...e, rank: i + 1 }));
}

// ── the dossier ──────────────────────────────────────────────────────────────
/**
 * Gather everything we can source for one Type E bulletpoint.
 *
 * @param {object} bulletpoint  a card from parse.extractTypeE
 * @param {object} [opts]
 *   root        corpus root (default CARTHAGE_CORPUS)
 *   sourceText  the Carthage Bible text, if already in memory (avoids a re-read per bulletpoint)
 *   enough      stop calling further tiers once this many entries are in hand (default 12).
 *               Tier 1 and tier 2 ALWAYS run — the method requires it.
 *   tiers       subset of tier names to run
 *   ingest      allow booklore to ingest missing reference pages (default false; rate-limited)
 *   extraTerms  extra search terms
 * @returns {Promise<{ok,id,bulletpoint,keywords,entries,byTier,counts,generatedAt,notes}>}
 *   Never throws. A dossier with zero entries is a valid, honest result.
 */
export async function buildDossier(bulletpoint = {}, opts = {}) {
  const {
    root = CORPUS_ROOT(), sourceText = null, enough = 12, ingest = false,
    tiers = ['local', 'book', 'ourSearch', 'booklore', 'bookApis', 'keyed'], extraTerms = [],
  } = opts || {};

  const keywords = keywordsFor(bulletpoint, { extraTerms });
  const notes = [];
  let entries = [];

  const want = (name) => tiers.includes(name);

  // tier 1 — emails and the other growth corpora. Always runs.
  if (want('local')) {
    try { entries = entries.concat(searchLocal(keywords, { root })); }
    catch (e) { notes.push(`local tier failed: ${e && e.message ? e.message : String(e)}`); }
  }
  // tier 2 — the rest of the Carthage Bible. Always runs.
  if (want('book')) {
    try {
      entries = entries.concat(searchBook(keywords, {
        text: sourceText, root, excludeLine: bulletpoint.line || null,
      }));
    } catch (e) { notes.push(`book tier failed: ${e && e.message ? e.message : String(e)}`); }
  }

  const satisfied = () => entries.length >= enough;

  if (want('ourSearch') && !satisfied()) entries = entries.concat(await tierOurSearch(keywords));
  if (want('booklore') && !satisfied()) entries = entries.concat(await tierBooklore(keywords, { ingest }));
  if (want('bookApis') && !satisfied()) entries = entries.concat(await tierBookApis(keywords));
  // tier 6 only when EVERYTHING above came back empty.
  if (want('keyed') && entries.length === 0) {
    const got = await tierKeyed(keywords);
    if (got.length) notes.push('keyed research API used as last resort — every other tier was empty');
    entries = entries.concat(got);
  }

  entries = await rankWithinTiers(entries);

  const counts = {};
  for (const e of entries) counts[e.tierName] = (counts[e.tierName] || 0) + 1;
  const byTier = {};
  for (const e of entries) (byTier[e.tierName] = byTier[e.tierName] || []).push(e);

  return {
    ok: true,
    id: bulletpoint.id || null,
    bulletpoint: {
      id: bulletpoint.id || null,
      text: bulletpoint.text || '',
      note: bulletpoint.note || null,
      book: bulletpoint.bookNumber ?? bulletpoint.book ?? null,
      bookTitle: bulletpoint.bookTitle || null,
      line: bulletpoint.line ?? null,
      kind: bulletpoint.kind || 'candidate',
      confidence: bulletpoint.confidence || 'strong',
      inventoryN: bulletpoint.inventoryN ?? null,
      contextBefore: bulletpoint.contextBefore || [],
      contextAfter: bulletpoint.contextAfter || [],
    },
    keywords,
    entries,
    byTier,
    counts,
    total: entries.length,
    generatedAt: new Date().toISOString(),
    notes,
  };
}

/** Plain-text dossier, provenance on every line. Everything interpolated is esc()'d. */
export function renderDossier(d) {
  if (!d || !d.entries) return '';
  const lines = [
    `Type E ${esc(d.bulletpoint?.id || '')} — ${esc(d.bulletpoint?.text || '')}`,
    d.bulletpoint?.note ? `  author's note: ${esc(d.bulletpoint.note)}` : '',
    `  Book ${esc(String(d.bulletpoint?.book ?? '?'))} line ${esc(String(d.bulletpoint?.line ?? '?'))} · ${esc(String(d.total))} sourced passages`,
    `  keywords: ${esc((d.keywords?.terms || []).join(', '))}`,
    '',
  ].filter(Boolean);
  for (const e of d.entries) {
    const p = e.provenance || {};
    const where = p.kind === 'local' || p.kind === 'ours'
      ? `${esc(p.file || p.url || '')}${p.line ? `:${esc(String(p.line))}` : ''}`
      : `${esc(p.url || '')} (retrieved ${esc(p.retrieved || '')}${e.publicDomain ? `, ${esc(e.publicDomain.status)}` : ''})`;
    lines.push(`[${esc(String(e.tier))}·${esc(e.tierName)}] ${esc(e.title || '')}`);
    lines.push(`   ${where}`);
    if (e.date) lines.push(`   dated ${esc(e.date)}`);
    if (e.matchedLine) lines.push(`   matched: ${esc(String(e.matchedLine).replace(/\s+/g, ' ').slice(0, 200))}`);
    if (e.quote) lines.push(`   “${esc(String(e.quote).replace(/\s+/g, ' ').slice(0, 400))}”`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { parseAll } = await import('./parse.mjs');
  const want = process.argv[2];
  const r = parseAll();
  const bp = want
    ? r.bulletpoints.find((b) => b.id === want || b.text.toLowerCase().includes(want.toLowerCase()))
    : r.bulletpoints.find((b) => b.kind === 'inventoried');
  if (!bp) { console.error('carthage/research: no matching bulletpoint'); process.exit(1); }
  const d = await buildDossier(bp, { sourceText: loadSource(r.root).text, root: r.root });
  console.log(renderDossier(d));
}
