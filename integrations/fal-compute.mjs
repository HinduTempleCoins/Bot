// fal-compute.mjs — the brain's Fal.ai lane (image generation + LoRA inference) as a Node-callable
// interface. SIBLING of modal-compute.mjs (which is the Modal GPU lane for embeddings/serving); this
// one is Fal, chosen for the Hathor VISUAL character LoRA because Modal's FLUX path was gated/blocked
// (see memory hathor-character-lora: "VISUAL(FLUX) blocked Modal → use Fal").
//
// STATUS: STAGED, NOT LIVE. There is no Fal LoRA trained/deployed yet and no FAL_KEY on the boxes, so
// this adapter is CONFIG-FLAGGED off by default: configured() reports false, and every call soft-fails
// to { ok:false, reason:'not-configured' } WITHOUT touching the network. The moment the operator trains
// the LoRA on Fal and sets FAL_KEY (+ optionally FAL_LORA_URL / FAL_MODEL), this same code goes live —
// one env flip, no code change. That is the "one clear step from live" contract for the visual lane.
//
// Config from the box server env (never the repo, never committed):
//   FAL_KEY        — the Fal API key (read at call time; NEVER logged, printed, or returned)
//   FAL_MODEL      — the base model endpoint id (default the FLUX dev text-to-image route)
//   FAL_LORA_URL   — the trained Hathor LoRA weights URL, applied on top of the base (optional)
//   FAL_ENABLE     — hard on/off. Even with a key present, generation stays OFF unless FAL_ENABLE=1,
//                    so a stray key can't start billing a not-yet-blessed lane (mirrors the router's
//                    LLM_ALLOW_GEMINI $0 hard-pin).
//
// SOFT-FAIL-NEVER-THROW: not-configured, disabled, timeout, or error → { ok:false, reason } so any
// caller (the coding assistant's image tool, Hathor's avatar renderer) degrades gracefully instead of
// crashing. Injectable fetch for offline tests — the test suite NEVER hits Fal.

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';

// Default base model: the FLUX dev text-to-image route on Fal. Overridable via FAL_MODEL.
export const DEFAULT_MODEL = 'fal-ai/flux-lora';

/**
 * configured() — is the Fal lane wired AND enabled? Reports booleans ONLY (never the key value).
 *   key     — FAL_KEY present
 *   enabled — FAL_ENABLE=1 (the hard on/off; off ⇒ generation refuses even with a key)
 *   lora    — a trained LoRA URL is set (the Hathor visual character)
 *   ready   — key && enabled (the single "can we call Fal right now?" flag)
 */
export function configured() {
  const key = !!env('FAL_KEY');
  const enabled = env('FAL_ENABLE') === '1';
  return {
    key,
    enabled,
    lora: !!env('FAL_LORA_URL'),
    model: env('FAL_MODEL') || DEFAULT_MODEL,
    ready: key && enabled,
  };
}

/**
 * generateImage(prompt, opts) — text-to-image via Fal (FLUX + optional Hathor LoRA). NEVER throws.
 * While the lane is not configured/enabled (the current staged state) this returns
 * { ok:false, reason:'not-configured' } WITHOUT any network call — the "not live" contract.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.loraUrl]     override FAL_LORA_URL (apply a specific adapter)
 * @param {number} [opts.imageSize]   e.g. 1024 (square); provider clamps
 * @param {number} [opts.steps]       inference steps
 * @param {number} [opts.timeoutMs]   default 120000 (image gen is slow)
 * @returns {Promise<{ ok:true, images:string[], model:string } | { ok:false, reason:string }>}
 */
export async function generateImage(prompt, opts = {}) {
  const cfg = configured();
  if (!cfg.key) return { ok: false, reason: 'not-configured' };   // no key ⇒ staged/off, no network
  if (!cfg.enabled) return { ok: false, reason: 'disabled' };     // key present but FAL_ENABLE!=1
  const p = String(prompt == null ? '' : prompt).trim();
  if (!p) return { ok: false, reason: 'no-prompt' };

  const model = env('FAL_MODEL') || DEFAULT_MODEL;
  const loraUrl = opts.loraUrl || env('FAL_LORA_URL') || '';
  const body = { prompt: p };
  if (loraUrl) body.loras = [{ path: loraUrl, scale: 1 }];
  if (opts.imageSize) body.image_size = opts.imageSize;
  if (opts.steps) body.num_inference_steps = opts.steps;

  const timeoutMs = Number(opts.timeoutMs) || 120000;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await _fetch(`https://fal.run/${model}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Fal's auth scheme. The key is read from env at call time and never logged/returned.
        authorization: `Key ${env('FAL_KEY')}`,
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!r || !r.ok) return { ok: false, reason: 'http-' + (r ? r.status : 'err') };
    const j = await r.json();
    const images = Array.isArray(j?.images) ? j.images.map((im) => (im && im.url) || im).filter(Boolean) : [];
    if (!images.length) return { ok: false, reason: 'no-images' };
    return { ok: true, images, model };
  } catch (e) {
    return { ok: false, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// CLI (guarded): report configuration (booleans only) or attempt one generation.
if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--config')) {
    console.log(JSON.stringify(configured(), null, 2));
  } else {
    const prompt = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ') || 'h4thor, vaporwave angel';
    generateImage(prompt).then((r) => console.log(JSON.stringify(r, null, 2)));
  }
}
