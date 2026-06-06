// decades-pipeline.mjs — the glue the Server A brief/annal timers call.
//
// Old-queue #306: wire the decades-brain (integrations/decades-brain.mjs — the layered
// 1960s→2020s router) into the brief/annal pipeline. This module takes ONE new brief or
// annal's text and answers the three operator questions from
// .local/ML_FREE_REPOS_CATALOG_2026-06-06.md §"Wiring into briefs/annals":
//
//   1. ROUTE     — which topic/AI should this brief go to?  (decades-brain layers: the
//                  1960s pattern / 1990s Naive Bayes / 2000s TF-IDF route most briefs at
//                  ~zero CPU — the "classical-first" rule for the 1-core Server A.)
//   2. DEDUP     — "have we written this annal already?" Nearest-neighbour against the
//                  existing store. Dense MiniLM→cosine when an embedder is wired in
//                  (the parallel integrations/minilm-embedder.mjs), else a TF-IDF/word-bag
//                  fallback so the 1-core box never needs the embedder to function.
//   3. NEAREST   — the closest existing brief, with its similarity score, so the timer can
//                  link related work (feeds the brief scorecard #225).
//
// Pure & injectable by construction — store reader, embedder, and clock are all passed in,
// so `node --test` runs fully OFFLINE with no network, no GPU, no filesystem. House rules:
// ESM, soft-fail (a broken layer is skipped, never throws), classical fallback always works.
//
//   import { createPipeline } from './decades-pipeline.mjs';
//   const pipe = createPipeline({ store, embedder });   // embedder optional
//   const out = await pipe.process({ id, text, kind: 'brief' });
//   // → { route, isDuplicate, nearestBrief, score, layer, dedupMethod, at }
//
// The store reader is a tiny async interface — adapt it to JSON files / Qdrant / SQLite on
// the server side without touching this module:
//   store.list()            → [{ id, text, route?, vec? }]   (the existing corpus of briefs/annals)
//   store.routes?()         → [{ label, examples:[text...], answer? }]  (optional: known topics)
//
// If store.routes() is absent, routing falls back to the decades-brain's own taught examples,
// or — failing that — a single 'unrouted' bucket. Never throws either way.

import { createBrain, tfidfIndex } from './decades-brain.mjs';

const DEFAULTS = {
  dupThreshold: 0.92,   // cosine/TF-IDF similarity at/above which two texts are "the same annal"
  routeThreshold: 0.45, // below this the route is reported but flagged low-confidence
};

const tokenize = (t) => String(t == null ? '' : t).toLowerCase().match(/[a-z0-9']{2,}/g) || [];

/** Word-bag cosine — the zero-dependency fallback when no dense embedder is wired in. */
function bagCosine(a, b) {
  const ta = tokenize(a), tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const fa = new Map(), fb = new Map();
  for (const w of ta) fa.set(w, (fa.get(w) || 0) + 1);
  for (const w of tb) fb.set(w, (fb.get(w) || 0) + 1);
  let dot = 0, na = 0, nb = 0;
  for (const v of fa.values()) na += v * v;
  for (const v of fb.values()) nb += v * v;
  for (const [w, v] of fa) if (fb.has(w)) dot += v * fb.get(w);
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

/** Dense cosine over two equal-length numeric vectors. */
function vecCosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

/**
 * Build the pipeline.
 * @param {object} opts
 * @param {{list:Function, routes?:Function}} [opts.store]  existing-corpus reader (async ok)
 * @param {(text:string)=>Promise<number[]>|number[]} [opts.embedder]  MiniLM-style embedder; soft-fails to word-bag
 * @param {()=>number} [opts.clock]  Date.now-style clock (injectable for tests)
 * @param {number} [opts.dupThreshold]
 * @param {number} [opts.routeThreshold]
 */
export function createPipeline({ store, embedder, clock = Date.now, dupThreshold, routeThreshold } = {}) {
  const cfg = {
    dupThreshold: dupThreshold ?? DEFAULTS.dupThreshold,
    routeThreshold: routeThreshold ?? DEFAULTS.routeThreshold,
  };

  // soft-fail wrappers — a broken store or embedder degrades, never throws out of process()
  async function safeList() {
    try { return (await store?.list?.()) || []; } catch { return []; }
  }
  async function safeRoutes() {
    try { return (await store?.routes?.()) || null; } catch { return null; }
  }
  async function safeEmbed(text) {
    if (!embedder) return null;
    try {
      const v = await embedder(text);
      return Array.isArray(v) && v.length ? v : null;
    } catch { return null; }
  }

  // Build a decades-brain whose routing layers are taught from the store's known topics.
  // Classical-first: the 1990s Naive Bayes layer does the routing at ~zero CPU.
  async function buildRouter() {
    const brain = createBrain();
    let taught = 0;
    const routes = await safeRoutes();
    if (routes && routes.length) {
      for (const r of routes) {
        const label = r.label ?? r.route ?? r.id;
        if (label == null) continue;
        for (const ex of (r.examples || [])) brain.teachExample(String(ex), String(label), r.answer || String(label));
        if (!(r.examples || []).length && r.text) brain.teachExample(String(r.text), String(label), r.answer || String(label));
        taught++;
      }
    }
    return { brain, taught };
  }

  return {
    config: cfg,

    /**
     * Route + dedup one brief/annal.
     * @param {{id?:string, text:string, kind?:'brief'|'annal', facts?:object}} item
     * @returns {Promise<{route, routeConfidence, lowConfidenceRoute, isDuplicate, dedupMethod,
     *                     nearestBrief, score, layer, kind, at, candidates:number}>}
     */
    async process(item) {
      const at = clock();
      const text = item && item.text != null ? String(item.text) : '';
      const kind = (item && item.kind) || 'brief';
      const out = {
        route: 'unrouted', routeConfidence: 0, lowConfidenceRoute: true,
        isDuplicate: false, dedupMethod: 'none',
        nearestBrief: null, score: 0, layer: null,
        kind, at, candidates: 0,
      };
      if (!text.trim()) return out;

      // ── ROUTE (decades-brain, classical-first) ──────────────────────────────────────
      try {
        const { brain, taught } = await buildRouter();
        if (taught) {
          const r = await brain.think(text, { facts: item?.facts });
          if (r && r.answer != null && r.intent != null) {
            out.route = String(r.intent);
            out.routeConfidence = r.confidence || 0;
            out.layer = r.era || null;
            out.lowConfidenceRoute = out.routeConfidence < cfg.routeThreshold;
          }
        }
      } catch { /* routing soft-fails to 'unrouted' */ }

      // ── DEDUP + NEAREST (dense MiniLM if wired, else TF-IDF/word-bag) ────────────────
      const corpus = (await safeList()).filter((d) => d && d.text != null && d.id !== item?.id);
      out.candidates = corpus.length;
      if (corpus.length) {
        const qVec = await safeEmbed(text);
        let best = null;
        if (qVec) {
          out.dedupMethod = 'embedding';
          for (const d of corpus) {
            const dVec = Array.isArray(d.vec) && d.vec.length === qVec.length ? d.vec : await safeEmbed(d.text);
            const sim = vecCosine(qVec, dVec);
            if (!best || sim > best.score) best = { id: d.id, route: d.route ?? null, score: sim };
          }
        } else {
          // word-bag fallback (also exercises the same TF-IDF math the 2000s layer uses)
          out.dedupMethod = 'wordbag';
          for (const d of corpus) {
            const sim = bagCosine(text, d.text);
            if (!best || sim > best.score) best = { id: d.id, route: d.route ?? null, score: sim };
          }
        }
        if (best) {
          out.nearestBrief = { id: best.id, route: best.route };
          out.score = best.score;
          out.isDuplicate = best.score >= cfg.dupThreshold;
        }
      }
      return out;
    },
  };
}

// also expose the helpers for reuse/testing
export { bagCosine, vecCosine, tfidfIndex };

if (process.argv[1] && process.argv[1].endsWith('decades-pipeline.mjs')) {
  // Tiny self-demo with an in-memory store — no files, no network.
  const store = {
    list: () => ([
      { id: 'b1', text: 'how do I sign up and register a new account on the chain', route: 'signup' },
      { id: 'b2', text: 'what is a witness, block producer, dpos voting schedule', route: 'witness' },
    ]),
    routes: () => ([
      { label: 'signup', examples: ['register a new account signup faucet create account'] },
      { label: 'witness', examples: ['witness block producer dpos voting schedule'] },
      { label: 'pool', examples: ['mining pool stratum hashrate miners hashing'] },
    ]),
  };
  const pipe = createPipeline({ store });
  const text = process.argv.slice(2).join(' ') || 'how do I register a brand new account please';
  pipe.process({ id: 'new', text, kind: 'brief' }).then((r) => console.log(JSON.stringify(r, null, 2)));
}
