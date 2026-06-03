// imagesearch.mjs — own-it image search for SoapBox (queue #131). Bing's image API is dead, so breadth
// comes from a fan-out of keyed providers (Brave Search, SerpAPI) plus the free stock APIs (Unsplash,
// Pexels, Pixabay). Every provider SOFT-FAILS: no key, no network, or a bad response yields [] and the
// rest still answer. On top of breadth sits the "own index" — a pluggable embedding store so that once a
// CLIP embedder is wired, text→image and image→image search run against OUR corpus by vector similarity.
// The PURE pieces (cosine kNN, pHash hamming/dup) have zero deps and are exercised offline by the tests.
//
// Follows macro.mjs conventions: ESM, __setFetch hook, soft-fail, CLI guarded by argv[1] endsWith check.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Normalize one result row across providers → { title, url, thumb, source, width, height, provider }.
function row(provider, { title, url, thumb, source, width, height }) {
  return {
    provider,
    title: title || '',
    url: url || '',
    thumb: thumb || url || '',
    source: source || '',
    width: width || null,
    height: height || null,
  };
}

async function safeJson(url, opts) {
  try {
    const r = await _fetch(url, opts);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Keyed breadth providers (soft-fail when the key is absent) ──────────────────────────────────────

// Brave Search image API. Needs BRAVE_SEARCH_KEY (a.k.a. the data-for-search token).
async function braveImages(q) {
  const key = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
  if (!key) return [];
  const j = await safeJson(
    `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(q)}&count=20`,
    { headers: { 'user-agent': UA, accept: 'application/json', 'X-Subscription-Token': key } },
  );
  const items = j?.results || [];
  return items.map((it) => row('brave', {
    title: it.title,
    url: it.properties?.url || it.url,
    thumb: it.thumbnail?.src,
    source: it.source || it.url,
    width: it.properties?.width,
    height: it.properties?.height,
  }));
}

// SerpAPI Google Images engine. Needs SERPAPI_KEY.
async function serpapiImages(q) {
  const key = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
  if (!key) return [];
  const j = await safeJson(
    `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`,
    { headers: { 'user-agent': UA } },
  );
  const items = j?.images_results || [];
  return items.map((it) => row('serpapi', {
    title: it.title,
    url: it.original || it.link,
    thumb: it.thumbnail,
    source: it.source || it.link,
    width: it.original_width,
    height: it.original_height,
  }));
}

// ── Free stock providers (soft-fail when the key is absent) ─────────────────────────────────────────

async function unsplashImages(q) {
  const key = process.env.UNSPLASH_ACCESS_KEY || process.env.UNSPLASH_KEY;
  if (!key) return [];
  const j = await safeJson(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=20`,
    { headers: { 'user-agent': UA, Authorization: `Client-ID ${key}` } },
  );
  const items = j?.results || [];
  return items.map((it) => row('unsplash', {
    title: it.description || it.alt_description,
    url: it.urls?.full || it.urls?.regular,
    thumb: it.urls?.thumb || it.urls?.small,
    source: it.links?.html,
    width: it.width,
    height: it.height,
  }));
}

async function pexelsImages(q) {
  const key = process.env.PEXELS_KEY || process.env.PEXELS_API_KEY;
  if (!key) return [];
  const j = await safeJson(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=20`,
    { headers: { 'user-agent': UA, Authorization: key } },
  );
  const items = j?.photos || [];
  return items.map((it) => row('pexels', {
    title: it.alt,
    url: it.src?.original || it.src?.large2x,
    thumb: it.src?.tiny || it.src?.small,
    source: it.url,
    width: it.width,
    height: it.height,
  }));
}

async function pixabayImages(q) {
  const key = process.env.PIXABAY_KEY || process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const j = await safeJson(
    `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=20&image_type=photo`,
    { headers: { 'user-agent': UA } },
  );
  const items = j?.hits || [];
  return items.map((it) => row('pixabay', {
    title: it.tags,
    url: it.largeImageURL || it.webformatURL,
    thumb: it.previewURL,
    source: it.pageURL,
    width: it.imageWidth,
    height: it.imageHeight,
  }));
}

export const PROVIDERS = [braveImages, serpapiImages, unsplashImages, pexelsImages, pixabayImages];

/**
 * Fan out a query across every provider and concatenate what survives. Each provider soft-fails to []
 * (missing key, network error, bad payload), so this resolves even with zero keys configured.
 * @param {string} q  free-text query
 * @returns {Promise<Array>} normalized result rows
 */
export async function searchImages(q) {
  if (!q || !String(q).trim()) return [];
  const settled = await Promise.allSettled(PROVIDERS.map((p) => p(q)));
  const out = [];
  for (const s of settled) if (s.status === 'fulfilled' && Array.isArray(s.value)) out.push(...s.value);
  return out;
}

// ── Own embedding index: pluggable store + PURE in-memory cosine kNN ─────────────────────────────────

/** Dot product of two equal-length numeric vectors. */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** L2 norm (magnitude) of a vector. */
function norm(a) {
  return Math.sqrt(dot(a, a));
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for a zero vector (no direction → no similarity) and for a
 * length mismatch (undefined comparison) rather than NaN, so ranking stays well-ordered.
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/**
 * Default store: a pure in-memory cosine-kNN index. No deps, no persistence. Swap in a real vector DB
 * by passing an object with the same { upsert, knn } shape to the index factory below.
 */
export function createMemoryStore() {
  const items = new Map(); // id → { id, vector, meta }
  return {
    upsert({ id, vector, meta }) {
      items.set(id, { id, vector: vector.slice(), meta: meta || {} });
    },
    /** Brute-force top-k by cosine similarity. Pure, deterministic (stable for distinct scores). */
    knn(vector, k = 10) {
      const scored = [];
      for (const it of items.values()) {
        scored.push({ id: it.id, score: cosineSimilarity(vector, it.vector), meta: it.meta });
      }
      scored.sort((x, y) => y.score - x.score);
      return scored.slice(0, Math.max(0, k));
    },
    get size() { return items.size; },
  };
}

// The module-level default index. Tests and callers use indexImage/searchByVector against this; a CLIP
// embedder wired later turns text or an uploaded image into the `vector` these take.
const _store = createMemoryStore();

/**
 * Add (or replace) one image embedding in the own-index.
 * @param {{id:string, vector:number[], meta?:object}} rec
 */
export function indexImage({ id, vector, meta } = {}) {
  if (id == null || !Array.isArray(vector) || vector.length === 0) {
    throw new Error('indexImage requires { id, vector:number[] }');
  }
  _store.upsert({ id, vector, meta });
  return { id, dims: vector.length };
}

/**
 * Nearest images to a query vector (text→image / image→image once an embedder is wired).
 * @param {number[]} vector
 * @param {number} [k=10]
 * @returns {Array<{id:string, score:number, meta:object}>}
 */
export function searchByVector(vector, k = 10) {
  if (!Array.isArray(vector) || vector.length === 0) return [];
  return _store.knn(vector, k);
}

// ── PURE perceptual-hash duplicate detection ────────────────────────────────────────────────────────

const HEX = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 1, 5: 2, 6: 2, 7: 3, 8: 1, 9: 2, a: 2, b: 3, c: 2, d: 3, e: 3, f: 4 };

/**
 * Hamming distance between two equal-length hex pHash strings = number of differing bits. Computed
 * nibble-by-nibble via a popcount lookup, so no BigInt or per-bit loop. Case-insensitive.
 * @returns {number} bit distance, or Infinity on length mismatch / bad input
 */
export function hammingDistance(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return Infinity;
  const a = aHex.toLowerCase();
  const b = bHex.toLowerCase();
  if (a.length !== b.length || a.length === 0) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16);
    const y = parseInt(b[i], 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return Infinity;
    d += HEX[(x ^ y).toString(16)];
  }
  return d;
}

/**
 * Two pHashes are duplicates when their hamming distance is within `threshold` bits. Default 10 is the
 * common pHash near-duplicate cutoff for 64-bit hashes (≈ identical-image, tolerant of recompression).
 */
export function isDuplicate(aHex, bHex, threshold = 10) {
  return hammingDistance(aHex, bHex) <= threshold;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('imagesearch.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'andromeda galaxy';
  const res = await searchImages(q);
  console.log(`\n"${q}" — ${res.length} image(s) across providers`);
  for (const r of res.slice(0, 20)) console.log(`  [${r.provider.padEnd(8)}] ${(r.title || '(untitled)').slice(0, 50).padEnd(50)} ${r.url}`);
  if (res.length === 0) console.log('  (no providers configured — set BRAVE_SEARCH_KEY / SERPAPI_KEY / UNSPLASH_ACCESS_KEY / PEXELS_KEY / PIXABAY_KEY)');
}
