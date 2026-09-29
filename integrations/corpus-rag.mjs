// integrations/corpus-rag.mjs — retrieval over the Temple's OWN corpus, the knowledge/ tree on disk.
//
// ⛔ WHY THIS EXISTS. site/hierophant/server.mjs says, in its own header, that "Ask the Hierophant"
// answers over "the Temple's OWN corpus (the knowledge/ tree, via the existing library-rag retrieval
// seam)". That was not true. library-rag.mjs retrieves from the wiki.soapbox.community SEARCH API —
// a different corpus entirely — so asking the Hierophant about the Temple's own Phoenician research
// returned "The Library doesn't cover that" while 20 files and ~300KB of it sat on disk beside it.
//
// 299 files, 6.9MB. Small enough to read and rank in-process; no index to build, no service to run,
// nothing to keep in sync. The moment a file lands in knowledge/ it is retrievable.
//
// ⚠️ NOT an LLM seam. This RETRIEVES and ranks; whether an answer gets generated on top is the
// caller's business. Retrieval that works without a key is the part that must never break.
//
// House style: ESM, soft-fail-never-throw, injectable fs + root, offline.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const CORPUS_ROOT = () => process.env.CORPUS_ROOT || join(HERE, 'knowledge');

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'with',
  'as', 'at', 'by', 'from', 'that', 'this', 'was', 'are', 'be', 'what', 'how', 'why', 'who', 'does', 'do',
  // conversational filler — "tell me about Odin" must be a search for Odin, not for "tell"
  'tell', 'me', 'about', 'please', 'explain', 'describe', 'give', 'know', 'show', 'can', 'you', 'i', 'whats', 'which', 'were', 'did', 'much', 'more']);

// ⚠️ A possessive or a hyphen in the QUESTION must not produce a token that can never match the text.
// "Punt's Havilah-network" tokenised naively gives "punt's" and "havilah-network", neither of which
// appears anywhere, so the query silently retrieves nothing and looks like an empty corpus.
export const terms = (q) => String(q || '').toLowerCase()
  .replace(/['\u2019]s\b/g, '')          // possessive: punt's → punt
  .replace(/[^a-z0-9]+/g, ' ')            // hyphens and punctuation are separators, not characters
  .split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w));

/** Every readable corpus file. Skips code and the machine-written indexes. */
export function corpusFiles(root = CORPUS_ROOT()) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const ext = extname(e.name).toLowerCase();
      if (ext !== '.json' && ext !== '.md') continue;
      // .mjs is code; _keyword_index / _library_catalog are generated and would swamp every query
      // with filename noise rather than content.
      if (e.name.startsWith('_')) continue;
      out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

// A JSON corpus file is a tree of strings; flatten it to readable prose rather than stringifying it,
// so `{"overview":"..."}` scores on its VALUE and not on the word "overview".
function flatten(v, depth = 0) {
  if (depth > 12 || v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => flatten(x, depth + 1)).join('\n');
  if (typeof v === 'object') return Object.values(v).map((x) => flatten(x, depth + 1)).join('\n');
  return '';
}

export function readDoc(path) {
  let raw = '';
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  if (!raw.trim()) return null;
  let title = '';
  let text = raw;
  if (extname(path).toLowerCase() === '.json') {
    try {
      const j = JSON.parse(raw);
      title = String((j && (j.title || j.name)) || '');
      text = flatten(j);
    } catch { /* malformed JSON is still searchable as text */ }
  } else {
    const h = raw.match(/^#\s+(.+)$/m);
    if (h) title = h[1].trim();
  }
  return { path, title: title || path.split('/').pop().replace(/\.(json|md)$/, ''), text };
}

/**
 * Rank corpus documents against a question.
 * Scoring is deliberately plain: term frequency, a title bonus, and a bonus for matching MORE of the
 * distinct query terms. The last one matters most — a file that mentions "Punt" ninety times but never
 * "Havilah" should not beat the file about both.
 */
export function retrieve(question, { topK = 5, root = CORPUS_ROOT(), maxChars = 1200, exclude = [] } = {}) {
  const qs = terms(question);
  if (!qs.length) return [];
  const docs = [];
  // `exclude`: corpus-relative folders or files a surface should not answer from (e.g. operational notes)
  const skip = (path) => exclude.some((x) => { const r = relative(root, path); return r === x || r.startsWith(x.replace(/\/?$/, '/')); });
  for (const path of corpusFiles(root)) {
    if (skip(path)) continue;
    const doc = readDoc(path);
    if (doc) docs.push({ path, doc, hay: doc.text.toLowerCase(), title: doc.title.toLowerCase() });
  }
  // Rare words carry the meaning: a term found in most documents ("tell", "time") says little, a name found in
  // three says a lot. Weight every term by inverse document frequency.
  const N = docs.length || 1;
  const idf = {};
  for (const t of qs) { const df = docs.filter((d) => d.hay.includes(t)).length; idf[t] = Math.log((N + 1) / (df + 1)); }
  const maxIdf = Math.max(...qs.map((t) => idf[t]));
  const scored = [];
  for (const { path, doc, hay, title } of docs) {
    let score = 0; let matched = 0; let rare = false;
    for (const t of qs) {
      const n = hay.split(t).length - 1;
      if (n > 0) { matched++; score += Math.min(n, 25) * idf[t]; if (idf[t] >= maxIdf * 0.6) rare = true; }
      if (title.includes(t)) score += 12 * idf[t];
    }
    if (!matched || !rare) continue;   // must contain the question's most telling word(s)
    // Covering more of the question beats repeating one word of it.
    score *= (1 + matched / qs.length);
    scored.push({ path, title: doc.title, score, matched, of: qs.length, passage: passageFor(doc.text, qs, maxChars) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, topK))
    .map((s) => ({ ...s, source: relative(root, s.path) }));
}

/** The most relevant window of a document, not its first paragraph. */
function passageFor(text, qs, maxChars) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 40);
  let best = 0; let bestScore = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    let s = 0;
    for (const t of qs) if (l.includes(t)) s++;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  let out = '';
  for (let i = best; i < lines.length && out.length < maxChars; i++) out += (out ? '\n' : '') + lines[i];
  return out.slice(0, maxChars);
}

/**
 * ask() — grounded retrieval with an honest empty state.
 * ⚠️ It never generates. With no match it SAYS the corpus does not cover it, which is the behaviour
 * that makes the rest of the answers worth anything.
 */
export function ask(question, opts = {}) {
  const hits = retrieve(question, opts);
  if (!hits.length) {
    return { ok: true, grounded: false, answer: 'The Temple corpus does not cover that.', sources: [], passages: [] };
  }
  return {
    ok: true, grounded: true,
    answer: `From the Temple's own corpus — ${hits.length} document(s).`,
    sources: hits.map((h) => ({ title: h.title, source: h.source, matched: `${h.matched}/${h.of}` })),
    passages: hits.map((h) => ({ title: h.title, source: h.source, text: h.passage })),
  };
}

export function stats(root = CORPUS_ROOT()) {
  const files = corpusFiles(root);
  let bytes = 0;
  for (const f of files) { try { bytes += statSync(f).size; } catch {} }
  return { files: files.length, bytes };
}

export default { ask, retrieve, corpusFiles, readDoc, terms, stats, CORPUS_ROOT };
