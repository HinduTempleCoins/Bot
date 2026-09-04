// library-index.mjs — SEMANTIC index over the repo's LIBRARIES, so the brief/annal writers and
// Hathor actually DRAW ON the corpus instead of it sitting as files on disk.
//
// Operator, repeatedly (2026-06-09): "the Brief Writers and Annal Writers should be Wired into the
// Libraries of like Training Data or whatever, to be Better Coders and Things" — and the healer
// corpus "needs to be in our AI so they can be like Awesome Doctors … Alkaloids and Terpenes and
// Ayurveda." Until now the only index over knowledge/ + datasets/ was the Qdrant stack on Server A
// (down), so on the live box the writers had ZERO library retrieval. This is the repo-native fix.
//
// DESIGN (house style):
//   • Walks knowledge/ (healer, scripture, knowledge) + datasets/ (chain, coding), DOMAIN-TAGGED, in
//     priority order so a slow first pass is useful before it reaches the giant general corpora.
//   • Embedder is INJECTABLE (__setEmbedder). Default = MiniLM (integrations/minilm-embedder.mjs,
//     local, in-process). The box can inject an Ollama embedder (ollamaEmbedder()) since it already
//     runs nomic-embed. If no real embedder loads, it SOFT-FALLS to a deterministic hashed-TF word-bag
//     so recall still works offline / in CI — never throws.
//   • RESUMABLE: chunks are keyed by content hash and the vector store is checkpointed every N embeds.
//     A kill mid-run (e.g. the 5-min systemd timeout that was killing memindex) keeps every embedded
//     chunk; the next run skips those and continues. The index fills in across runs.
//   • recall(query, {domain, k}) → ranked passages. Hathor's doctor path calls {domain:'healer'}.
//
// CLI:  node integrations/library-index.mjs index [--limit=N] [--full] [--ollama]
//       node integrations/library-index.mjs recall [--domain=healer] [--k=6] "<query>"
//       node integrations/library-index.mjs catalog        (write the committed lightweight catalog)
//       node integrations/library-index.mjs stats

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeEmbedder } from './minilm-embedder.mjs';
import { createVectorIndex, faissAvailable } from './faiss-index.mjs';
import { gateItems } from './scope-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.MELEK_REPO || path.resolve(__dirname, '..');
const CACHE_DIR = process.env.LIB_IDX_DIR || path.join(REPO_ROOT, '.library-index');
const VEC_PATH = path.join(CACHE_DIR, 'vectors.json');
const CATALOG_PATH = path.join(REPO_ROOT, 'knowledge', '_library_catalog.json');

const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 150;
const CHECKPOINT_EVERY = 20;
const INDEX_EXTS = new Set(['.md', '.mdx', '.rst', '.txt', '.json', '.jsonl']);

// Domain → directories (relative to repo root), in PRIORITY ORDER.
export const DOMAINS = [
  ['healer', ['knowledge/oilahuasca', 'knowledge/ayahuasca', 'knowledge/psychedelics',
    'knowledge/herbs', 'knowledge/shulgin-pihkal-tihkal', 'knowledge/synthesis',
    'knowledge/consciousness', 'knowledge/spirituality']],
  ['scripture', ['knowledge/scripture', 'knowledge/teaching']],   // teaching = scraped primary texts (Ptahhotep, Emerald Tablet, Hercules, Yaksha Prashna)
  ['languages', ['knowledge/languages']],  // Language Center datasets (ingested grammars/corpora/dicts)
  ['knowledge', ['knowledge/ai_technology', 'knowledge/ancient_egypt', 'knowledge/history',
    'knowledge/linguistics', 'knowledge/media', 'knowledge/mystery_schools',
    'knowledge/phoenician', 'knowledge/revolution', 'knowledge/soapmaking',
    'knowledge/space', 'knowledge/vankush', 'knowledge/cryptocurrency']],
  ['chain', ['datasets/hive-devportal', 'datasets/chain-libs', 'datasets/crypto-protocols',
    'datasets/trading-knowledge', 'knowledge/ecosystem']],
  ['coding', ['datasets/cookbooks', 'datasets/ml-libs', 'datasets/ml-courses',
    'datasets/devops', 'datasets/crypto-books', 'datasets/process',
    'datasets/security-corpus']],
];

// ── embedder seam ──────────────────────────────────────────────────────────────
// Default lazily builds the MiniLM embedder; tests / the box inject their own.
let _embedder = null;
export function __setEmbedder(fn) { _embedder = typeof fn === 'function' ? fn : null; }

// Deterministic hashed-TF word-bag fallback (256-dim) — used when no real embedder loads. Same idea
// as cheetah-embeddings' fallback: good enough for lexical-ish recall, fully offline, never throws.
const FALLBACK_DIM = 256;
function wordBag(text) {
  const v = new Array(FALLBACK_DIM).fill(0);
  const words = String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  for (const w of words) {
    const h = crypto.createHash('md5').update(w).digest();
    v[h[0] % FALLBACK_DIM] += 1;
  }
  return v;
}

async function embedText(text) {
  if (!_embedder) _embedder = makeEmbedder();
  try {
    const r = await _embedder(text);
    if (Array.isArray(r) && r.length) return r;
  } catch { /* fall through */ }
  return wordBag(text);
}

// Helper: an Ollama-backed embedder fn for the box (it already runs nomic-embed). Inject via
// __setEmbedder(ollamaEmbedder()). Soft-fails to null so embedText drops to the word-bag fallback.
export function ollamaEmbedder({ url = process.env.MEM_OLLAMA || 'http://127.0.0.1:11434',
  model = process.env.MEM_EMBED || 'nomic-embed-text' } = {}) {
  return async (text) => {
    try {
      const r = await fetch(`${url}/api/embeddings`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: String(text || '').slice(0, 2000) }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json();
      return Array.isArray(j.embedding) ? j.embedding : null;
    } catch { return null; }
  };
}

const cos = (a, b) => {
  const n = Math.min(a.length, b.length);
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
const hashOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function chunk(text) {
  const t = String(text || '').replace(/\r/g, '');
  if (t.length <= CHUNK_CHARS) return [t];
  const out = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + CHUNK_CHARS, t.length);
    out.push(t.slice(start, end));
    if (end >= t.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return out;
}

function* walkDir(absDir) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(absDir, e.name);
    if (e.isDirectory()) { yield* walkDir(p); continue; }
    if (!INDEX_EXTS.has(path.extname(e.name).toLowerCase())) continue;
    yield p;
  }
}

// All (domain, relPath, chunkIdx, text, id) the index SHOULD contain.
export function libraryItems({ repo = REPO_ROOT } = {}) {
  const items = [];
  for (const [domain, dirs] of DOMAINS) {
    for (const rel of dirs) {
      for (const file of walkDir(path.join(repo, rel))) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (!text || text.trim().length < 60) continue;
        const relPath = path.relative(repo, file);
        const chunks = chunk(text);
        chunks.forEach((c, i) => {
          if (c.trim().length < 60) return;
          items.push({ domain, src: `${relPath}#${i}`, relPath, chunkIdx: i,
            total: chunks.length, text: c, id: hashOf(`${relPath}#${i}:${c.length}`) });
        });
      }
    }
  }
  return items;
}

function loadVecs() {
  try { return JSON.parse(fs.readFileSync(VEC_PATH, 'utf8')); }
  catch { return { at: null, vecs: [] }; }
}
function saveVecs(idx) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  idx.at = new Date().toISOString();
  idx.n = idx.vecs.length;
  fs.writeFileSync(VEC_PATH, JSON.stringify(idx));
}

// ── index (resumable) ────────────────────────────────────────────────────────
export async function buildIndex({ limit = Infinity, full = false, log = () => {} } = {}) {
  const idx = full ? { at: null, vecs: [] } : loadVecs();
  const have = new Set(idx.vecs.map((v) => v.id));
  const want = libraryItems();
  const todo = want.filter((it) => !have.has(it.id));
  log(`[library] target ${want.length} chunks; have ${have.size}; to embed ${todo.length}`);

  let fresh = 0;
  for (const it of todo) {
    if (fresh >= limit) break;
    const vec = await embedText(it.text);
    idx.vecs.push({ id: it.id, domain: it.domain, src: it.src, relPath: it.relPath,
      text: it.text.slice(0, 500), vec });
    fresh++;
    if (fresh % CHECKPOINT_EVERY === 0) { saveVecs(idx); log(`[library] +${fresh} (checkpoint ${idx.vecs.length})`); }
  }
  if (!full) {
    const wantIds = new Set(want.map((it) => it.id));
    const before = idx.vecs.length;
    idx.vecs = idx.vecs.filter((v) => wantIds.has(v.id));
    if (idx.vecs.length !== before) log(`[library] pruned ${before - idx.vecs.length} stale chunks`);
  }
  saveVecs(idx);
  const remaining = want.length - idx.vecs.length;
  log(`[library] indexed ${idx.vecs.length}/${want.length} (${fresh} new; ${remaining} remaining)`);
  return { total: want.length, indexed: idx.vecs.length, fresh, remaining };
}

// ── recall ────────────────────────────────────────────────────────────────────
// FAISS-backed recall, cached per (index-version, domain). Real FAISS nearest-neighbour on the
// node-20 boxes; cosine fallback elsewhere (same result). Rebuilt only when the vectors file changes.
const _annCache = new Map(); // key: `${at}::${domain}` -> { ann, meta: [{domain,src,relPath,text}] }
function annFor(idx, domain) {
  const key = `${idx.at}::${domain || '*'}`;
  const hit = _annCache.get(key);
  if (hit) return hit;
  const pool = domain ? idx.vecs.filter((v) => v.domain === domain) : idx.vecs;
  const dim = pool[0]?.vec?.length || 0;
  const ann = createVectorIndex(dim);
  const meta = [];
  pool.forEach((v, i) => { ann.add(i, v.vec); meta.push({ domain: v.domain, src: v.src, relPath: v.relPath, text: v.text }); });
  const built = { ann, meta };
  _annCache.clear(); // small cache; one live index version at a time
  _annCache.set(key, built);
  return built;
}

export async function recall(query, { domain = null, k = 6, internal = false } = {}) {
  const idx = loadVecs();
  if (!idx.vecs.length) return [];
  const qv = await embedText(query);
  const { ann, meta } = annFor(idx, domain);
  // SCOPE GATE: public surfaces never receive manufacture/synthesis/extraction-route passages
  // (CLAUDE.md scope; shelf audit 2026-08-25). Over-fetch so gating still returns k results.
  // Internal/operator callers pass { internal: true } and are unfiltered.
  const want = internal ? k : Math.min(k * 4, Math.max(k, meta.length));
  const hits = ann.search(qv, want).map((h) => ({ ...meta[h.id], score: h.score }));
  return gateItems(hits, { internal }).slice(0, k);
}

/** Which nearest-neighbour backend recall is using ('faiss' on the boxes, 'cosine' fallback). */
export function recallBackend() { return faissAvailable() ? 'faiss' : 'cosine'; }

export function stats() {
  const idx = loadVecs();
  const by = {};
  for (const v of idx.vecs) by[v.domain] = (by[v.domain] || 0) + 1;
  return { at: idx.at, total: idx.vecs.length, byDomain: by };
}

// ── committed lightweight catalog (the "Index … in the Repo") ──────────────────
// A deterministic, embedding-free manifest of what the libraries contain: domain → files with title
// + top keywords. Committed to knowledge/_library_catalog.json so the corpus is queryable (and the
// coverage is visible/reviewable) even with no model and no vector store. Doubles as a fast keyword
// pre-filter for the semantic recall.
const STOP = new Set(['the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'has', 'not',
  'can', 'all', 'but', 'you', 'your', 'our', 'its', 'his', 'her', 'they', 'them', 'have', 'will',
  'which', 'when', 'what', 'who', 'how', 'into', 'than', 'then', 'also', 'such', 'these', 'those']);
function topKeywords(text, n = 12) {
  const freq = {};
  for (const w of String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []) {
    if (STOP.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}
function firstHeading(text, relPath) {
  const m = String(text || '').match(/^#\s+(.+)$/m) || String(text || '').match(/"title"\s*:\s*"([^"]+)"/);
  return (m && m[1]) ? m[1].trim().slice(0, 120) : path.basename(relPath);
}
// The committed catalog covers the MELEK corpus by default. The `coding` domain is thousands of
// generic third-party docs (ml-libs, security-corpus, cookbooks) — useful for the RUNTIME vector
// index but noise to commit, so it's excluded from the committed artifact (pass {domains:['coding']}
// or all to include). The semantic buildIndex() still covers every domain.
export const CATALOG_DOMAINS = ['healer', 'scripture', 'knowledge', 'chain'];
export function buildCatalog({ repo = REPO_ROOT, domains = CATALOG_DOMAINS } = {}) {
  const byDomain = {};
  let files = 0;
  for (const [domain, dirs] of DOMAINS) {
    if (domains && !domains.includes(domain)) continue;
    byDomain[domain] = [];
    for (const rel of dirs) {
      for (const file of walkDir(path.join(repo, rel))) {
        let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (!text || text.trim().length < 60) continue;
        const relPath = path.relative(repo, file);
        byDomain[domain].push({ path: relPath, title: firstHeading(text, relPath),
          bytes: Buffer.byteLength(text), keywords: topKeywords(text) });
        files++;
      }
    }
    byDomain[domain].sort((a, b) => a.path.localeCompare(b.path));
  }
  return { generatedFrom: 'integrations/library-index.mjs', domains: Object.keys(byDomain),
    fileCount: files, byDomain };
}
export function writeCatalog({ repo = REPO_ROOT } = {}) {
  const cat = buildCatalog({ repo });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(cat, null, 2) + '\n');
  return { path: CATALOG_PATH, fileCount: cat.fileCount };
}

// ── catalogLookup — INSTANT keyword recall over the committed catalog (no embeddings) ──────────
// The semantic vector index is the richer path but expensive to build on a loaded box. The committed
// _library_catalog.json gives the writers a zero-cost, always-available library lookup TODAY: score
// each file by query-term overlap with its title + keywords. Returns top files per domain filter.
// This is what the brief/annal writers call first; semantic recall augments it once the index exists.
let _catalogCache = null;
function loadCatalog() {
  if (_catalogCache) return _catalogCache;
  try { _catalogCache = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')); }
  catch { _catalogCache = { byDomain: {} }; }
  return _catalogCache;
}
export function catalogLookup(query, { domain = null, k = 6 } = {}) {
  const terms = [...new Set(String(query || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])]
    .filter((t) => !STOP.has(t));
  if (!terms.length) return [];
  const cat = loadCatalog();
  const out = [];
  for (const [dom, files] of Object.entries(cat.byDomain || {})) {
    if (domain && dom !== domain) continue;
    for (const f of files) {
      const hay = `${f.title} ${(f.keywords || []).join(' ')} ${f.path}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if ((f.keywords || []).includes(t)) score += 3;      // keyword hit = strong
        else if (hay.includes(t)) score += 1;                // title/path mention
      }
      if (score > 0) out.push({ domain: dom, path: f.path, title: f.title, keywords: f.keywords, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('library-index.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flag = (name, def) => {
    const f = argv.find((a) => a.startsWith(`--${name}=`));
    return f ? f.split('=')[1] : def;
  };
  const rest = argv.slice(1).filter((a) => !a.startsWith('--'));
  if (argv.includes('--ollama')) __setEmbedder(ollamaEmbedder());

  if (cmd === 'index') {
    const r = await buildIndex({ limit: Number(flag('limit', Infinity)), full: argv.includes('--full'),
      log: (m) => console.log(m) });
    console.log(`[library] done: ${r.indexed}/${r.total} indexed, ${r.remaining} remaining`);
  } else if (cmd === 'recall') {
    const hits = await recall(rest.join(' '), { domain: flag('domain', null), k: Number(flag('k', 6)) });
    if (!hits.length) { console.error('no hits (index empty? run `index` first)'); process.exit(1); }
    console.log(`recall "${rest.join(' ')}"${flag('domain', null) ? ` [${flag('domain', null)}]` : ''}:`);
    for (const h of hits) console.log(`  [${h.score.toFixed(3)}] (lib/${h.domain}:${h.relPath}) ${h.text.replace(/\n+/g, ' ').slice(0, 160)}`);
  } else if (cmd === 'lookup') {
    const hits = catalogLookup(rest.join(' '), { domain: flag('domain', null), k: Number(flag('k', 6)) });
    if (!hits.length) { console.error('no catalog hits'); process.exit(1); }
    console.log(`lookup "${rest.join(' ')}"${flag('domain', null) ? ` [${flag('domain', null)}]` : ''}:`);
    for (const h of hits) console.log(`  [${h.score}] (lib/${h.domain}:${h.path}) ${h.title} — ${(h.keywords || []).slice(0, 6).join(', ')}`);
  } else if (cmd === 'catalog') {
    const r = writeCatalog();
    console.log(`[library] catalog written: ${r.path} (${r.fileCount} files)`);
  } else if (cmd === 'stats') {
    console.log(JSON.stringify(stats(), null, 2));
  } else {
    console.error('usage: index [--limit=N] [--full] [--ollama] | recall [--domain=X] [--k=N] "<q>" | catalog | stats');
    process.exit(1);
  }
}
