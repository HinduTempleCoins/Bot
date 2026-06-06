// minilm-embedder.mjs — the shared LOCAL MiniLM embedder for the repo's two semantic seams.
//
// Two modules in this repo want real sentence embeddings but were built injectable so they could run
// fully offline with a deterministic lexical fallback (hashed-TF):
//
//   integrations/cheetah-embeddings.mjs  — Cheetah's semantic source-matching (__setEmbedder seam)
//   integrations/brief-brain.mjs         — annal dedup via decades-brain's embedding layer
//                                          (createBriefBrain({ embedder }) seam)
//
// This module is the REAL embedder that slots into either seam: a single, lazily-loaded MiniLM
// feature-extraction pipeline (Xenova/all-MiniLM-L6-v2) running locally via @huggingface/transformers
// (transformers.js). The model (~23 MB) downloads + caches on first real use; tests NEVER touch it —
// they inject fakes into the seams instead. Importing this module does NO work and pulls NO model.
//
// Contract (matches the seams):
//   embed(texts)        → Promise<Float32Array[]>  batch; soft-fails to null if the model can't load
//   embedOne(text)      → Promise<number[] | null> single text as a plain Array (decades-brain &
//                         cheetah both check Array.isArray, so we hand back number[] not Float32Array)
//   makeEmbedder()      → (text) => Promise<number[] | null>  the function to pass to a seam
//
// Soft-fail rule (house style): never throw. If the pipeline can't load (offline box, no disk, no
// network for the one-time download), every call resolves to null and the caller keeps its word-bag
// fallback. The load is attempted once; a failure is cached so we don't retry-storm.
//
//   import { makeEmbedder } from './minilm-embedder.mjs';
//   import { __setEmbedder } from './cheetah-embeddings.mjs';
//   __setEmbedder(makeEmbedder());                       // Cheetah now prefers real, falls back to word-bag
//
//   import { createBriefBrain } from './brief-brain.mjs';
//   const brain = createBriefBrain({ embedder: makeEmbedder() });   // annal dedup prefers real
//
// Run the (opt-in, online) smoke:  node integrations/minilm-embedder.mjs --smoke

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

// Lazy singletons. _pipePromise dedupes concurrent first-callers; _loadFailed caches a hard failure so
// we degrade quietly to the caller's fallback instead of retrying the download on every call.
let _pipePromise = null;
let _loadFailed = false;

// Injectable pipeline factory — tests set a fake here so they exercise embed()/embedOne() with ZERO
// network and ZERO download. In production it's null and loadPipeline() imports transformers.js for real.
let _pipelineFactory = null;
/**
 * Inject a pipeline factory for tests: async () => (text, opts) => { data: Float32Array }. Pass
 * null to restore the real (transformers.js) loader. Resets the load cache so the next call re-loads.
 */
export function __setPipelineFactory(fn) {
  _pipelineFactory = typeof fn === 'function' ? fn : null;
  _pipePromise = null;
  _loadFailed = false;
}

/**
 * Lazily load + cache the MiniLM feature-extraction pipeline. Returns the pipeline, or null if it can
 * not be loaded (then every embed call soft-fails to null and the caller keeps its fallback). NEVER
 * throws. Importable without side effects — nothing loads until the first embed call.
 */
export async function loadPipeline() {
  if (_loadFailed) return null;
  if (_pipePromise) return _pipePromise;
  _pipePromise = (async () => {
    try {
      if (_pipelineFactory) return await _pipelineFactory();
      const { pipeline } = await import('@huggingface/transformers');
      // mean-pooled + L2-normalized sentence embeddings — the standard all-MiniLM-L6-v2 usage.
      return await pipeline('feature-extraction', MODEL_ID);
    } catch {
      _loadFailed = true;
      _pipePromise = null; // allow a future caller to retry only if they really want to
      return null;
    }
  })();
  return _pipePromise;
}

/**
 * Embed a batch of texts. Returns Float32Array[] (one 384-dim vector per input), or null if the model
 * can't load — callers treat null as "no real embedder, keep the word-bag fallback". NEVER throws.
 * @param {string[]|string} texts
 * @returns {Promise<Float32Array[] | null>}
 */
export async function embed(texts) {
  const list = Array.isArray(texts) ? texts : [texts];
  const pipe = await loadPipeline();
  if (!pipe) return null;
  try {
    const out = [];
    for (const t of list) {
      const res = await pipe(String(t == null ? '' : t), { pooling: 'mean', normalize: true });
      // transformers.js Tensor → flat Float32Array of the (single-row) embedding.
      out.push(res.data instanceof Float32Array ? res.data : Float32Array.from(res.data));
    }
    return out;
  } catch {
    return null; // soft-fail mid-batch → caller falls back
  }
}

/**
 * Embed a single text as a plain number[] (the shape both seams check via Array.isArray). Returns null
 * on load/embed failure so the seam falls back to its word-bag embedder. NEVER throws.
 * @param {string} text
 * @returns {Promise<number[] | null>}
 */
export async function embedOne(text) {
  const vecs = await embed([text]);
  if (!vecs || !vecs.length) return null;
  return Array.from(vecs[0]);
}

/**
 * Build the embedder function to inject into a seam: async (text) => number[] | null. Returns a plain
 * Array (not Float32Array) because decades-brain / cheetah-embeddings gate on Array.isArray. On any
 * failure it returns null and the seam keeps its deterministic word-bag fallback. NEVER throws.
 * @returns {(text: string) => Promise<number[] | null>}
 */
export function makeEmbedder() {
  return (text) => embedOne(text);
}

// ── opt-in online smoke ────────────────────────────────────────────────────────────────────────────
// Downloads the model (first run) and embeds two similar sentences + one dissimilar one, printing the
// cosine similarities. The similar pair must score higher than either similar-vs-dissimilar pair.
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

if (process.argv[1] && process.argv[1].endsWith('minilm-embedder.mjs') && process.argv.includes('--smoke')) {
  const A = 'the cat sat on the warm windowsill in the afternoon sun';
  const B = 'a kitten rested on the sunny ledge by the window';      // similar to A (paraphrase)
  const C = 'quarterly interest rates were raised by the central bank'; // dissimilar
  console.log(`\nMiniLM embedder smoke — model ${MODEL_ID} (downloads on first run)…\n`);
  const vecs = await embed([A, B, C]);
  if (!vecs) {
    console.error('  model could not load (offline / no disk?) — embed() returned null. Soft-fail OK.');
    process.exit(1);
  }
  const [a, b, c] = vecs;
  const simAB = cosine(a, b);
  const simAC = cosine(a, c);
  const simBC = cosine(b, c);
  console.log(`  A: "${A}"`);
  console.log(`  B: "${B}"  (similar)`);
  console.log(`  C: "${C}"  (dissimilar)\n`);
  console.log(`  cosine(A, B) similar    = ${simAB.toFixed(4)}`);
  console.log(`  cosine(A, C) dissimilar = ${simAC.toFixed(4)}`);
  console.log(`  cosine(B, C) dissimilar = ${simBC.toFixed(4)}\n`);
  const pass = simAB > simAC && simAB > simBC;
  console.log(`  similar pair scores higher than dissimilar: ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}
