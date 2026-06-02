// booklore.mjs — the Book Memory System (RAG), v1. Ingests the public esoteric / mythology corpora
// (sacred-texts.com, theoi.com — see sources.mjs) into a retrievable keyword index the AIs and the
// wiki can query. This is the dependency-free v1: no embeddings, no vector DB, no API keys. A book
// is fetched as clean text, split into ~1k-char passages, and stored as JSONL; search() is a BM25-ish
// keyword ranker over those passages. The BOOK_MEMORY_SYSTEM.md spec describes a ChromaDB+Gemini
// version as the eventual upgrade — the surface here (ingest / search / passage records with source
// citations) is the same shape, so a later embedding backend can slot in behind search().
//
//   import { ingest, search, fetchBook, chunkBook } from './booklore.mjs'
//   await ingest('https://www.theoi.com/Olympios/Hestia.html')
//   const hits = await search('virgin goddess of the hearth', { limit: 5 })
//
// CLI:
//   node integrations/booklore/booklore.mjs ingest <url>
//   node integrations/booklore/booklore.mjs search "<query>"
//   node integrations/booklore/booklore.mjs sources        # list seed index URLs
//   node integrations/booklore/booklore.mjs stats

import { fetchClean } from '../scraper.mjs';
import { allSeedUrls } from './sources.mjs';
import { mkdirSync, existsSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// data/booklore/<host>.jsonl lives at the repo root, alongside other integration stores.
const DATA_DIR = process.env.BOOKLORE_DIR || join(__dirname, '../../data/booklore');

// Chunk sizing (chars, not words — fetchClean gives us text). The spec asks ~500-1000 words; at
// ~5 chars/word that's ~2.5k-5k chars, but for a keyword index tighter passages retrieve more
// precisely, so we target ~1k with a sentence-respecting split and a small overlap for context.
const TARGET = +(process.env.BOOKLORE_CHUNK || 1000);
const MIN_CHUNK = 300;
const MAX_CHUNK = 1400;
const OVERLAP = 120;

// Politeness: space out leaf-page fetches so we never hammer the small non-profit hosts.
const POLITE_DELAY_MS = +(process.env.BOOKLORE_DELAY_MS || 1200);
// Books are big; raise the scraper's default 12k truncation so we don't lose the back half.
const MAX_CHARS = +(process.env.BOOKLORE_MAXCHARS || 60000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _lastFetch = 0;

// ── host / path helpers ────────────────────────────────────────────────────
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'unknown'; }
}
function storeFor(host) { return join(DATA_DIR, `${host}.jsonl`); }

// ── fetch ──────────────────────────────────────────────────────────────────
/**
 * Fetch one book/page as clean text via the scraper. Returns { url, title, text, source }.
 * Polite: enforces POLITE_DELAY_MS between successive live fetches. Never throws (fetchClean
 * returns markdown:'' on failure; we surface that as an empty text).
 */
export async function fetchBook(url, { polite = true } = {}) {
  if (polite) {
    const wait = POLITE_DELAY_MS - (Date.now() - _lastFetch);
    if (wait > 0) await sleep(wait);
  }
  const r = await fetchClean(url, { maxChars: MAX_CHARS });
  _lastFetch = Date.now();
  const text = stripJinaPreamble(r.markdown || '');
  const rawTitle = (r.markdown.match(/^Title:\s*(.+)$/m) || [])[1] || r.title || '';
  const title = (deriveTitle(r.markdown) || r.title || url).trim();
  const isError = looksLikeErrorPage(rawTitle, text);
  return { url, title, text, source: r.source || '', isError };
}

// Jina Reader prepends a metadata block ("Title: …\nURL Source: …\nMarkdown Content:\n…") and can
// emit a "Warning: …" line for error pages. Strip that preamble so the stored chunk is just content.
function stripJinaPreamble(md = '') {
  const marker = md.indexOf('Markdown Content:');
  let body = marker >= 0 ? md.slice(marker + 'Markdown Content:'.length) : md;
  // drop a leading run of header-ish lines (Title:/URL Source:/Warning:/Published Time:)
  body = body.replace(/^(?:\s*(?:Title|URL Source|Warning|Published Time|Language):.*\n?)+/i, '');
  return body.trim();
}

function deriveTitle(md = '') {
  // Jina's explicit "Title:" line wins; else the first markdown H1; ignore error-page placeholders.
  const m = md.match(/^Title:\s*(.+)$/m) || md.match(/^#\s+(.+)$/m);
  const t = m ? m[1].trim() : '';
  if (!t || ERROR_TITLE.test(t)) return '';
  return t;
}

// Static archives serve a 200-styled "file not found" HTML for dead links; both Jina and the
// fallback see it as real content. Detect it so ingest() refuses to store a junk page.
const ERROR_TITLE = /\b(40\d|file not found|not found|page not found|error)\b/i;
function looksLikeErrorPage(title = '', text = '') {
  if (ERROR_TITLE.test(title)) return true;
  const head = text.slice(0, 200).toLowerCase();
  return /\b(file not found|404|page not found|page you requested)\b/.test(head);
}

// ── chunking ─────────────────────────────────────────────────────────────────
/**
 * Split clean text into ~TARGET-char passages, breaking on sentence/paragraph boundaries where
 * possible, with a small overlap so a passage carries a little of its predecessor's context.
 * Returns [{ chunk, idx, offset }]. Pure / deterministic — easy to unit-test.
 */
export function chunkBook(text = '') {
  const clean = String(text).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  // Prefer paragraph boundaries; fall back to sentence boundaries inside long paragraphs.
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  for (const p of paras) {
    if (p.length <= MAX_CHUNK) { pieces.push(p); continue; }
    // long paragraph → split on sentence ends, then re-pack
    const sentences = p.split(/(?<=[.!?])\s+/);
    let buf = '';
    for (const s of sentences) {
      if (buf && (buf.length + s.length + 1) > TARGET) { pieces.push(buf.trim()); buf = ''; }
      buf += (buf ? ' ' : '') + s;
    }
    if (buf.trim()) pieces.push(buf.trim());
  }

  // Re-pack small pieces up toward TARGET so we don't store one chunk per tiny paragraph.
  const packed = [];
  let buf = '';
  for (const piece of pieces) {
    if (buf && (buf.length + piece.length + 2) > TARGET && buf.length >= MIN_CHUNK) {
      packed.push(buf.trim());
      // carry a small overlap tail for context continuity
      const tail = buf.slice(-OVERLAP);
      buf = tail + '\n' + piece;
    } else {
      buf += (buf ? '\n' : '') + piece;
    }
  }
  if (buf.trim()) packed.push(buf.trim());

  // assign idx + offset (offset = running char position in the joined cleaned text)
  let offset = 0;
  return packed.map((chunk, idx) => {
    const rec = { chunk, idx, offset };
    offset += chunk.length;
    return rec;
  });
}

// ── persistence (JSONL) ──────────────────────────────────────────────────────
function ensureDir() { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); }

/** Read all stored passage records, optionally for a single host. */
export function loadAll({ host } = {}) {
  ensureDir();
  const files = host
    ? [storeFor(host)].filter(existsSync)
    : readdirSync(DATA_DIR).filter((f) => f.endsWith('.jsonl')).map((f) => join(DATA_DIR, f));
  const out = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { out.push(JSON.parse(t)); } catch { /* skip corrupt line */ }
    }
  }
  return out;
}

/** Has this URL already been ingested into its host store? (incremental ingest guard) */
export function isIngested(url) {
  const host = hostOf(url);
  const file = storeFor(host);
  if (!existsSync(file)) return false;
  // cheap substring scan — JSONL stores the URL JSON-escaped; the raw URL appears verbatim
  return readFileSync(file, 'utf8').includes(JSON.stringify(url));
}

// ── ingest ───────────────────────────────────────────────────────────────────
/**
 * Fetch a URL, chunk it, append its passages to data/booklore/<host>.jsonl.
 * Incremental: skips a URL already present unless { force:true }. Each record is
 * { url, title, host, chunk, idx, offset, ingestedAt }. Returns a summary.
 */
export async function ingest(url, { force = false, polite = true } = {}) {
  ensureDir();
  const host = hostOf(url);
  if (!force && isIngested(url)) {
    return { url, host, skipped: true, reason: 'already-ingested', chunks: 0 };
  }
  const { title, text, source, isError } = await fetchBook(url, { polite });
  if (!text) return { url, host, skipped: true, reason: 'empty-fetch:' + source, chunks: 0 };
  if (isError) return { url, host, skipped: true, reason: 'error-page (dead link?)', chunks: 0 };

  const chunks = chunkBook(text);
  const ingestedAt = new Date().toISOString();
  const lines = chunks.map((c) =>
    JSON.stringify({ url, title, host, chunk: c.chunk, idx: c.idx, offset: c.offset, ingestedAt }),
  );
  if (lines.length) appendFileSync(storeFor(host), lines.join('\n') + '\n');
  return { url, host, title, source, chunks: chunks.length, skipped: false };
}

/** Ingest several URLs in sequence (polite delay between each). */
export async function ingestMany(urls = [], opts = {}) {
  const results = [];
  for (const u of urls) results.push(await ingest(u, opts));
  return results;
}

// ── search (BM25-ish keyword ranker) ─────────────────────────────────────────
const STOP = new Set('a an and the of to in is it for on with as by at or be this that from are was were has have had not but i you he she they we their his her its our your'.split(' '));

function tokenize(s = '') {
  return String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 1 && !STOP.has(t)) || [];
}

// Okapi BM25 over the stored passages. Each passage is a "document". We build the corpus stats on
// every call (v1: simple + always-fresh; the corpus is small, file-backed). Title terms get a small
// boost so a query that names a figure (e.g. "Hestia") surfaces that figure's page.
const K1 = 1.5, B = 0.75, TITLE_BOOST = 2;

/**
 * Rank stored passages against a free-text query. Returns up to `limit` hits:
 * { url, title, host, idx, score, snippet, chunk }. `host` narrows to one corpus.
 */
export async function search(query, { limit = 5, host } = {}) {
  const qTerms = tokenize(query);
  if (!qTerms.length) return [];
  const docs = loadAll({ host });
  if (!docs.length) return [];

  // term frequencies + doc lengths + document frequency
  const N = docs.length;
  const docTokens = docs.map((d) => {
    const body = tokenize(d.chunk);
    const titleToks = tokenize(d.title);
    return { body, titleToks, len: body.length };
  });
  const avgLen = docTokens.reduce((s, d) => s + d.len, 0) / N || 1;

  const df = new Map();
  for (const dt of docTokens) {
    const seen = new Set(dt.body);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = (t) => {
    const n = df.get(t) || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  const scored = docs.map((d, i) => {
    const { body, titleToks, len } = docTokens[i];
    const tf = new Map();
    for (const t of body) tf.set(t, (tf.get(t) || 0) + 1);
    const titleSet = new Set(titleToks);
    let score = 0;
    for (const qt of qTerms) {
      const f = tf.get(qt) || 0;
      if (f) {
        const num = f * (K1 + 1);
        const den = f + K1 * (1 - B + B * (len / avgLen));
        score += idf(qt) * (num / den);
      }
      if (titleSet.has(qt)) score += TITLE_BOOST; // query term names the page's subject
    }
    return { d, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ d, score }) => ({
    url: d.url,
    title: d.title,
    host: d.host,
    idx: d.idx,
    score: +score.toFixed(4),
    snippet: snippetFor(d.chunk, qTerms),
    chunk: d.chunk,
  }));
}

// Pull a ~240-char window around the first matched query term for display.
function snippetFor(chunk = '', qTerms = []) {
  const lc = chunk.toLowerCase();
  let pos = -1;
  for (const qt of qTerms) { const p = lc.indexOf(qt); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
  if (pos < 0) return chunk.slice(0, 240).trim() + (chunk.length > 240 ? '…' : '');
  const start = Math.max(0, pos - 80);
  const end = Math.min(chunk.length, pos + 160);
  return (start > 0 ? '…' : '') + chunk.slice(start, end).trim() + (end < chunk.length ? '…' : '');
}

// ── stats ────────────────────────────────────────────────────────────────────
export function stats() {
  ensureDir();
  const docs = loadAll();
  const byHost = {}; const urls = new Set();
  for (const d of docs) {
    byHost[d.host] = (byHost[d.host] || 0) + 1;
    urls.add(d.url);
  }
  return { passages: docs.length, pages: urls.size, byHost };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'ingest') {
    const url = rest[0];
    if (!url) { console.error('usage: booklore.mjs ingest <url>'); process.exit(1); }
    const force = rest.includes('--force');
    const r = await ingest(url, { force });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'search') {
    const query = rest.filter((a) => !a.startsWith('--')).join(' ');
    const hostArg = (rest.find((a) => a.startsWith('--host=')) || '').split('=')[1];
    const hits = await search(query, { limit: 5, host: hostArg });
    if (!hits.length) { console.log('(no matches — ingest some pages first?)'); return; }
    for (const h of hits) {
      console.log(`\n[${h.score}] ${h.title}  <${h.url}>  (chunk ${h.idx})`);
      console.log('   ' + h.snippet);
    }
  } else if (cmd === 'sources') {
    for (const s of allSeedUrls()) console.log(`${s.host.padEnd(18)} ${s.title.padEnd(34)} ${s.url}`);
  } else if (cmd === 'stats') {
    console.log(JSON.stringify(stats(), null, 2));
  } else {
    console.log('usage: booklore.mjs <ingest|search|sources|stats> [args]');
    console.log('  ingest <url> [--force]');
    console.log('  search "<query>" [--host=theoi.com]');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
