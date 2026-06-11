// embed.mjs — the MELEK Memory embedder, behind ONE seam.
//
// Per .local/BRAIN_STACK_PLAN.md the Memory store (vector-store.mjs) takes an injected
// `embed(texts) -> vectors`. This module is that embedder: a thin façade over whichever local
// backend is available, so the rest of the brain calls one stable function and never cares which
// model is behind it. Backends, in order of preference (all free / self-hosted / CPU-OK):
//
//   1. an HTTP endpoint (Ollama /api/embeddings, or a granite-embedding-97m server) — injected fetch
//   2. a local in-process embedder function (e.g. transformers.js MiniLM) — injected callable
//   3. a deterministic HASH fallback — no model at all; stable pseudo-embeddings so the pipeline
//      and tests work fully offline with nothing installed. NOT semantically meaningful — it exists
//      so Memory upsert/search is exercisable and never hard-blocks on a missing model.
//
//   import { createEmbedder, hashEmbed } from './embed.mjs'
//   const embed = createEmbedder({ backend:'ollama', url, model, fetch });  // -> embed(texts)->vectors
//   const embed = createEmbedder({ backend:'fn', fn });                     // wrap a local model fn
//   const embed = createEmbedder();                                        // hash fallback (offline)
//
// Zero-WIF / scope: pure transport + math. No keys, no signing, no chain. The HTTP backend only
// ever calls the configured embeddings URL. Soft-fail: a backend error falls back to hashEmbed so
// Memory keeps working (degraded, not broken) — and logs nothing sensitive.

const DIM_DEFAULT = 384;

/**
 * Deterministic, dependency-free pseudo-embedding. Hashes token n-grams into a fixed-dim bag, then
 * L2-normalizes. Same text → same vector; similar texts share tokens → non-zero cosine. NOT a real
 * semantic model — a stable stand-in so the Memory pipeline runs offline with nothing installed.
 */
export function hashEmbed(text, dim = DIM_DEFAULT) {
  const d = Number.isInteger(dim) && dim > 0 ? dim : DIM_DEFAULT;
  const v = new Array(d).fill(0);
  const toks = String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (const tok of toks) {
    v[fnv1a(tok) % d] += 1;
    // a light bigram signal so word order/co-occurrence nudges the vector
    v[fnv1a('#' + tok) % d] += 0.5;
  }
  return l2normalize(v);
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // unsigned
}

function l2normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  if (n === 0) return v;
  const inv = 1 / Math.sqrt(n);
  return v.map((x) => x * inv);
}

/**
 * Build an `embed(texts: string[]) -> Promise<number[][]>` over the chosen backend.
 * Always returns one vector per input (never throws): on any backend failure it falls back to
 * hashEmbed so the Memory pipeline degrades gracefully instead of breaking.
 *
 * @param {object} [cfg]
 * @param {'ollama'|'http'|'fn'|'hash'} [cfg.backend='hash']
 * @param {string} [cfg.url]   for ollama/http
 * @param {string} [cfg.model] for ollama (e.g. 'granite-embedding:97m')
 * @param {(input:string)=>Promise<any>|any} [cfg.fetch] injected fetch (ollama/http)
 * @param {(texts:string[])=>Promise<number[][]>|number[][]} [cfg.fn] a local model fn (backend 'fn')
 * @param {number} [cfg.dim=384] dimension for the hash fallback
 */
export function createEmbedder(cfg = {}) {
  const backend = cfg.backend || 'hash';
  const dim = Number.isInteger(cfg.dim) && cfg.dim > 0 ? cfg.dim : DIM_DEFAULT;
  const _fetch = cfg.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);

  async function embed(texts) {
    const arr = Array.isArray(texts) ? texts.map((t) => String(t == null ? '' : t)) : [];
    if (!arr.length) return [];

    if (backend === 'hash') return arr.map((t) => hashEmbed(t, dim));

    if (backend === 'fn') {
      try {
        const out = await cfg.fn(arr);
        if (Array.isArray(out) && out.length === arr.length) return out.map((v) => (Array.isArray(v) ? v : hashEmbed('', dim)));
      } catch {
        /* fall through to hash */
      }
      return arr.map((t) => hashEmbed(t, dim));
    }

    // ollama / http: one request per text (Ollama's /api/embeddings is single-input)
    if ((backend === 'ollama' || backend === 'http') && _fetch && cfg.url) {
      const out = [];
      let anyFail = false;
      for (const t of arr) {
        try {
          const body = backend === 'ollama' ? { model: cfg.model || 'granite-embedding', prompt: t } : { input: t };
          const res = await _fetch(cfg.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          const j = res && typeof res.json === 'function' ? await res.json() : res;
          const vec = pickVector(j);
          out.push(Array.isArray(vec) && vec.length ? vec : hashEmbed(t, dim));
          if (!Array.isArray(vec) || !vec.length) anyFail = true;
        } catch {
          out.push(hashEmbed(t, dim));
          anyFail = true;
        }
      }
      void anyFail;
      return out;
    }

    // unknown/misconfigured backend → safe fallback
    return arr.map((t) => hashEmbed(t, dim));
  }

  embed.backend = backend;
  embed.dim = dim;
  return embed;
}

// Extract an embedding array from common response shapes (Ollama, OpenAI-style, raw).
export function pickVector(j) {
  if (!j) return null;
  if (Array.isArray(j) && typeof j[0] === 'number') return j;
  if (Array.isArray(j.embedding)) return j.embedding;
  if (Array.isArray(j.data) && j.data[0] && Array.isArray(j.data[0].embedding)) return j.data[0].embedding;
  if (Array.isArray(j.embeddings) && Array.isArray(j.embeddings[0])) return j.embeddings[0];
  return null;
}
