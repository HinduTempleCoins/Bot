// genai-video-providers.mjs — video-generation provider registry + failover for the Hathor studio.
//
// HONEST REALITY (researched 2026-09): there is NO keyless free video endpoint the way Pollinations is for
// images — every "free" video tier is a one-time signup credit or an app-only free tier not on the API. So
// the model the operator asked for ("use ours until exhausted, then the user adds their own API to continue")
// is: a SHARED-FREE tier from OUR configured keys (server env — burns signup credits, may be unset), then a
// BYOK fallback where the USER supplies their own key (their key, their browser — we never see it). The real
// forever-free shared tier is self-hosting Wan2.2/LTX on our own GPU (PRANA), which the School teaches.
//
// House rules (same as genai-providers.mjs): FREE-FIRST order, keys ONLY from env (never logged/returned),
// circuit breaker + per-day cap on cost-bearing providers, ONE attempt per provider per call, offline-testable
// via injectable _fetch/_now.
//
//   generateVideo({ prompt, imageUrl, provider, size, seconds })   [server-side, our keys]
//     -> { ok:true, provider, url|base64, mime, note, prompt }
//     -> { ok:false, needsKey:true, tried, providers }    (no server key/capacity → the UI shows BYOK)
//
// The BYOK call itself runs CLIENT-SIDE in the browser (see site/hathor videoView) so the user's key never
// touches our server. This module owns the server chain, the provider catalog, and the BYOK instructions.

// ── injectable seams (tests only) ──────────────────────────────────────────────────────────────────
let _fetch = (...a) => fetch(...a);
export function __setFetch(f) { _fetch = f || ((...a) => fetch(...a)); }
let _now = () => Date.now();
export function __setNow(f) { _now = f || (() => Date.now()); }

const env = (k, d = '') => (process.env[k] != null && process.env[k] !== '' ? String(process.env[k]) : d);
const envInt = (k, d) => { const v = parseInt(env(k, ''), 10); return Number.isFinite(v) && v >= 0 ? v : d; };

const BREAKER_THRESHOLD = () => envInt('GENAI_VIDEO_BREAKER_THRESHOLD', 2);
const BREAKER_COOLDOWN_MS = () => envInt('GENAI_VIDEO_BREAKER_COOLDOWN_MS', 10 * 60 * 1000);
const DEFAULT_DAILY_CAP = () => envInt('GENAI_VIDEO_DAILY_CAP', 20); // video is expensive — small default

const state = {}; // id -> { fails, openUntil, day, count }
function st(id) { if (!state[id]) state[id] = { fails: 0, openUntil: 0, day: '', count: 0 }; return state[id]; }
export function __resetState() { for (const k of Object.keys(state)) delete state[k]; }
const dayKey = () => new Date(_now()).toISOString().slice(0, 10);
const breakerOpen = (id) => st(id).openUntil > _now();
function recordFail(id) { const s = st(id); s.fails += 1; if (s.fails >= BREAKER_THRESHOLD()) s.openUntil = _now() + BREAKER_COOLDOWN_MS(); }
function recordOk(id) { const s = st(id); s.fails = 0; s.openUntil = 0; }
function budgetLeft(id, cap) { const s = st(id); const d = dayKey(); if (s.day !== d) { s.day = d; s.count = 0; } return s.count < cap; }
function consume(id) { const s = st(id); const d = dayKey(); if (s.day !== d) { s.day = d; s.count = 0; } s.count += 1; }

// ── the provider catalog (what a user can bring a key for; verified shapes 2026-09) ─────────────────
export const VIDEO_PROVIDERS = [
  { id: 'fal', name: 'fal.ai', kinds: ['t2v', 'i2v'], keyEnv: 'FAL_KEY', byok: true, browser: true,
    free: 'One-time signup credit (no recurring free tier).',
    note: 'Best BYOK — one key unlocks LTX, Kling, Wan, MiniMax, Veo. Works from the browser.' },
  { id: 'veo', name: 'Google Veo (Gemini API)', kinds: ['t2v', 'i2v'], keyEnv: 'GEMINI_API_KEY', byok: true, browser: false,
    free: 'No free tier on the dev API (free Veo is app-only).',
    note: 'Highest quality (Veo 3.1, native audio, up to 4K). Runs server-side / in Colab.' },
  { id: 'replicate', name: 'Replicate', kinds: ['t2v', 'i2v'], keyEnv: 'REPLICATE_API_TOKEN', byok: true, browser: false,
    free: '$10 signup credit, then pay-as-you-go.',
    note: 'Hosts open models (LTX, Wan, CogVideoX, Hunyuan). Simple token auth.' },
  { id: 'pollinations', name: 'Pollinations (video)', kinds: ['t2v'], keyEnv: 'POLLINATIONS_TOKEN', byok: true, browser: true,
    free: 'Requires a (free) Pollinations key now — no longer keyless for video.',
    note: 'Wraps Veo-fast / Seedance / Wan behind one token.' },
  { id: 'selfhost', name: 'Your own GPU (PRANA)', kinds: ['t2v', 'i2v'], keyEnv: null, byok: false, browser: false,
    free: 'FREE forever once you have a GPU.',
    note: 'Self-host Wan2.2-TI2V-5B or LTX-Video (Apache / commercial-OK). The GenAI School teaches this.' },
];

// step-by-step "add your own key" instructions the UI renders when our shared tier is exhausted/unset.
export const BYOK_INSTRUCTIONS = {
  fal: ['Sign up at fal.ai (no card to start — you get a signup credit).', 'Open Dashboard → Keys → create an API key.',
    'Paste it below. It stays in YOUR browser and calls fal directly — we never see or store it.'],
  veo: ['Get a Gemini API key at aistudio.google.com/apikey.', 'Veo video needs a paid/billing-enabled key (there is no free API tier).',
    'Use it in Google AI Studio or a Colab notebook (the School has a ready one) — Veo is not browser-CORS friendly.'],
  replicate: ['Sign up at replicate.com (you get ~$10 in credit).', 'Account → API tokens → copy your token.',
    'Use it from the School Colab, or the Replicate playground — token auth, pay-as-you-go after the credit.'],
  pollinations: ['Get a free key at auth.pollinations.ai.', 'Paste it below — it stays in your browser.'],
};

// which providers are configured on OUR server right now (have an env key). Empty today = BYOK-only.
export function serverConfigured() {
  return VIDEO_PROVIDERS.filter((p) => p.keyEnv && env(p.keyEnv)).map((p) => p.id);
}

// ── server-side generation: try our configured providers in order; else signal needsKey (→ BYOK) ────
async function callFal({ prompt, imageUrl, seconds }) {
  const key = env('FAL_KEY'); if (!key) return null;
  const model = imageUrl ? 'fal-ai/ltx-video/image-to-video' : 'fal-ai/ltx-video';
  const r = await _fetch(`https://fal.run/${model}`, {
    method: 'POST', headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, ...(imageUrl ? { image_url: imageUrl } : {}), num_frames: Math.min(257, (seconds || 5) * 24) }),
  });
  if (!r || !r.ok) return { ok: false };
  const j = await r.json().catch(() => null);
  const url = j && (j.video?.url || (j.videos && j.videos[0] && j.videos[0].url));
  return url ? { ok: true, url } : { ok: false };
}
async function callReplicate({ prompt }) {
  const key = env('REPLICATE_API_TOKEN'); if (!key) return null;
  const r = await _fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'wait' },
    body: JSON.stringify({ version: env('REPLICATE_VIDEO_VERSION', 'lightricks/ltx-video'), input: { prompt } }),
  });
  if (!r || !r.ok) return { ok: false };
  const j = await r.json().catch(() => null);
  const out = j && (Array.isArray(j.output) ? j.output[0] : j.output);
  return out ? { ok: true, url: out } : { ok: false };
}
const SERVER_CALLS = { fal: callFal, replicate: callReplicate };

/**
 * Generate a video from OUR configured providers. Returns needsKey when nothing is configured/available,
 * so the caller shows the BYOK panel (the operator's "too many users — add your own API to continue").
 */
export async function generateVideo({ prompt, imageUrl = '', seconds = 5 } = {}) {
  const p = String(prompt || '').trim();
  if (!p) return { ok: false, error: 'empty-prompt', tried: [] };
  const tried = [];
  for (const prov of VIDEO_PROVIDERS) {
    const call = SERVER_CALLS[prov.id];
    if (!call || !prov.keyEnv || !env(prov.keyEnv)) continue;   // not configured on our server
    if (breakerOpen(prov.id)) { tried.push(`${prov.id}:cooldown`); continue; }
    const cap = envInt(`GENAI_VIDEO_${prov.id.toUpperCase()}_DAILY_CAP`, DEFAULT_DAILY_CAP());
    if (!budgetLeft(prov.id, cap)) { tried.push(`${prov.id}:daily-cap`); continue; }
    try {
      const r = await call({ prompt: p, imageUrl, seconds });
      if (r && r.ok && r.url) { recordOk(prov.id); consume(prov.id); return { ok: true, provider: prov.id, url: r.url, note: prov.note, prompt: p }; }
      recordFail(prov.id); tried.push(`${prov.id}:fail`);
    } catch { recordFail(prov.id); tried.push(`${prov.id}:error`); }
  }
  // nothing configured/left → hand off to BYOK
  return { ok: false, needsKey: true, tried, providers: VIDEO_PROVIDERS.filter((x) => x.byok).map((x) => x.id) };
}

export default { generateVideo, VIDEO_PROVIDERS, BYOK_INSTRUCTIONS, serverConfigured };
