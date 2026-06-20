// lora-brain.mjs — the Node client for Hathor's served LoRA (infra/modal/serve_lora.py), and the
// BATCH RUNNER the gpu-scheduler drains its queue through.
//
// Operator (2026-06-20): the GPU/LoRA goes into the game AND the repo brain, but called a few times a
// day. So this is the bridge: the game's deep/persona jobs and the repo brain's heavy reasoning are
// SUBMITTED to gpu-scheduler.mjs; when a batch window fires, the scheduler hands the batch to
// makeLoraRunner() here, which calls the Modal LoRA endpoint once for the whole batch and returns
// [{id,text}]. Between windows the endpoint is scaled to zero — ~free.
//
// SOFT-FAIL-NEVER-THROW: no URL/token or any error → results carry { ok:false }, so callers degrade to
// the free API ensemble / the Decades-Smol layers instead of crashing. Injectable fetch for tests.
// Config from the box env (never the repo): MODAL_LORA_URL, MELEK_BRAIN_TOKEN.

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }
const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';

export function configured() { return !!env('MODAL_LORA_URL'); }

/**
 * Generate from the served LoRA for a single prompt. Soft-fails to { ok:false }.
 * @param {string} prompt
 * @param {{ maxTokens?, temperature?, timeoutMs?, url?, token? }} [opts]
 */
export async function generate(prompt, opts = {}) {
  const url = opts.url || env('MODAL_LORA_URL');
  const token = opts.token || env('MELEK_BRAIN_TOKEN');
  if (!url || !String(prompt || '').trim()) return { ok: false, reason: 'no-url-or-prompt' };
  try {
    const res = await withTimeout(_fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, prompt, max_tokens: opts.maxTokens || 160, temperature: opts.temperature ?? 0.8 }),
    }), opts.timeoutMs || 60000);
    if (!res || !res.ok) return { ok: false, reason: `http-${res && res.status}` };
    const data = await res.json();
    const text = (data && (data.text || (data.results && data.results[0] && data.results[0].text))) || '';
    return text ? { ok: true, text } : { ok: false, reason: 'empty' };
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

/**
 * Make the batch runner that gpu-scheduler.runWindow(runner) calls: takes the scheduler's batch
 * [{id, payload}], sends it to the LoRA endpoint in ONE call, returns [{id, text}]. On failure returns
 * the batch with ok:false per item so the scheduler can requeue or the caller can fall back.
 */
export function makeLoraRunner(opts = {}) {
  return async function runner(batch) {
    const url = opts.url || env('MODAL_LORA_URL');
    const token = opts.token || env('MELEK_BRAIN_TOKEN');
    if (!url) return batch.map((j) => ({ id: j.id, ok: false, reason: 'no-url' }));
    try {
      const res = await withTimeout(_fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, batch }),
      }), opts.timeoutMs || 120000);
      if (!res || !res.ok) return batch.map((j) => ({ id: j.id, ok: false, reason: `http-${res && res.status}` }));
      const data = await res.json();
      const byId = new Map((data.results || []).map((r) => [r.id, r.text]));
      return batch.map((j) => (byId.has(j.id) ? { id: j.id, ok: true, text: byId.get(j.id) } : { id: j.id, ok: false, reason: 'missing' }));
    } catch (e) {
      return batch.map((j) => ({ id: j.id, ok: false, reason: String(e && e.message || e) }));
    }
  };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('lora-brain configured:', configured(), '(MODAL_LORA_URL set on the box after `modal deploy infra/modal/serve_lora.py`)');
}
