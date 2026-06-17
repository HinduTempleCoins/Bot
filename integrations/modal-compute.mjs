// modal-compute.mjs — the brain's on-demand GPU lane (Modal) as a Node-callable interface
// (operator 2026-06-17: "use Modal like RunPod"). Modal is SERVERLESS GPU: the function spins up only
// when called and scales to zero after idle — no always-on box.
//
// This adapter calls the deployed `melek-brain` embeddings endpoint (infra/modal/brain.py → Brain.embed).
// Config from the box server env (never the repo):
//   MODAL_EMBED_URL   — the https://…modal.run URL printed by `modal deploy`
//   MODAL_EMBED_TOKEN — the shared bearer (= the melek-brain secret's MELEK_BRAIN_TOKEN)
//
// SOFT-FAIL-NEVER-THROW: no URL/token, cold-start timeout, or error → { ok:false } so the RAG/brain
// pipeline degrades (falls back to another embedder) instead of crashing. Injectable fetch for tests.

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';
export const EMBED_DIM = 384; // all-MiniLM-L6-v2

/** configured() — is the Modal embeddings lane wired? */
export function configured() {
  return { url: !!env('MODAL_EMBED_URL'), token: !!env('MODAL_EMBED_TOKEN') };
}

/**
 * embed(texts, { timeoutMs }) — GPU embeddings for a batch of strings via the Modal endpoint.
 * Returns { ok, dim, count, embeddings:[[...]] } or { ok:false, reason }. Never throws.
 * Cold start can take ~10-30s (container spin-up), hence the generous default timeout.
 */
export async function embed(texts, { timeoutMs = 60000 } = {}) {
  const url = env('MODAL_EMBED_URL');
  if (!url) return { ok: false, reason: 'no-url', embeddings: [] };
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t == null ? '' : t)).filter((t) => t.trim().length);
  if (!list.length) return { ok: false, reason: 'no-texts', embeddings: [] };

  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: list, token: env('MODAL_EMBED_TOKEN') }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!r || !r.ok) return { ok: false, reason: 'http-' + (r ? r.status : 'err'), embeddings: [] };
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.embeddings)) return { ok: false, reason: (j && j.error) || 'bad-response', embeddings: [] };
    return { ok: true, dim: j.dim || EMBED_DIM, count: j.count || j.embeddings.length, embeddings: j.embeddings };
  } catch (e) {
    return { ok: false, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network', embeddings: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** embedOne(text) — convenience: a single vector (or null). Never throws. */
export async function embedOne(text, opts) {
  const r = await embed([text], opts);
  return r.ok && r.embeddings[0] ? r.embeddings[0] : null;
}

if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  embed(process.argv.slice(2).join(' ') || 'hello MELEK').then((r) =>
    console.log(JSON.stringify({ ...r, embeddings: r.embeddings.map((v) => v.slice(0, 4).concat(['…'])) }, null, 2)));
}
