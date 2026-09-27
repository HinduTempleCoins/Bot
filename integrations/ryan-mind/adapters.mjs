// ryan-mind/adapters.mjs — the model seam. Everything that "thinks" goes through two injectable
// functions:  llm(prompt) -> string   and   embed(text) -> number[] | null.
// Default adapters talk to a LOCAL Ollama HTTP API (RYAN_MIND_OLLAMA_URL, default 127.0.0.1:11434).
// LOCAL ONLY: an Ollama URL that is not loopback / private-network is refused (the operator's private
// material must never reach an external API). Every adapter soft-fails to '' / null, never throws —
// callers fall back to the deterministic path.

let _fetch = null;
/** Inject fetch for the default Ollama adapters (tests pass a fake). null restores globalThis.fetch. */
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : null; }
function getFetch() { return _fetch || (typeof globalThis.fetch === 'function' ? globalThis.fetch : null); }

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_MODEL = 'llama3.2:1b';
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

/** true for loopback, RFC1918, link-local, and .local/.internal names. */
export function isLocalUrl(u) {
  let host;
  try { host = new URL(u).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function baseUrl(opts) {
  return String(opts.url || process.env.RYAN_MIND_OLLAMA_URL || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
}

/**
 * Build an llm(prompt) that calls Ollama /api/generate. Returns '' on any failure.
 * @param {{url?:string, model?:string, timeoutMs?:number, json?:boolean}} opts
 */
export function ollamaLlm(opts = {}) {
  const url = baseUrl(opts);
  const model = opts.model || process.env.RYAN_MIND_MODEL || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 120000;
  const fn = async (prompt) => {
    if (!isLocalUrl(url)) return '';
    const f = getFetch(); if (!f) return '';
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    timer?.unref?.();
    try {
      const r = await f(`${url}/api/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl?.signal,
        body: JSON.stringify({ model, prompt: String(prompt ?? ''), stream: false, ...(opts.json === false ? {} : { format: 'json' }), options: { temperature: 0 } }),
      });
      if (!r || !r.ok) return '';
      const j = await r.json();
      return typeof j?.response === 'string' ? j.response : '';
    } catch { return ''; } finally { if (timer) clearTimeout(timer); }
  };
  fn.modelName = `ollama:${model}`;
  fn.local = isLocalUrl(url);
  return fn;
}

/** Build an embed(text) over Ollama /api/embed (falls back to legacy /api/embeddings). null on failure. */
export function ollamaEmbed(opts = {}) {
  const url = baseUrl(opts);
  const model = opts.model || process.env.RYAN_MIND_EMBED_MODEL || DEFAULT_EMBED_MODEL;
  const fn = async (text) => {
    if (!isLocalUrl(url)) return null;
    const f = getFetch(); if (!f) return null;
    try {
      let r = await f(`${url}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: String(text ?? '') }) });
      if (r && r.ok) {
        const j = await r.json();
        const v = Array.isArray(j?.embeddings) ? j.embeddings[0] : j?.embedding;
        if (Array.isArray(v) && v.length) return v;
      }
      r = await f(`${url}/api/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt: String(text ?? '') }) });
      if (!r || !r.ok) return null;
      const j = await r.json();
      return Array.isArray(j?.embedding) && j.embedding.length ? j.embedding : null;
    } catch { return null; }
  };
  fn.modelName = `ollama:${model}`;
  return fn;
}

/** Probe: is a local Ollama answering and does it carry `model`? Soft-fails to {ok:false}. */
export async function probeOllama(opts = {}) {
  const url = baseUrl(opts);
  if (!isLocalUrl(url)) return { ok: false, reason: 'refused: non-local ollama url' };
  const f = getFetch(); if (!f) return { ok: false, reason: 'no fetch' };
  try {
    const r = await f(`${url}/api/tags`);
    if (!r || !r.ok) return { ok: false, reason: `http ${r?.status}` };
    const j = await r.json();
    const models = (j?.models || []).map((m) => m.name);
    return { ok: true, models };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}
