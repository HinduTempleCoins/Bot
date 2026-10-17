// ai-route.mjs — the seam through which the helper bot's AI (free-chat) calls go to HATHOR'S FLEET QUEUE
// on PRANA (prana-lanes/lanes/fleetq.py on the lanes host), with the existing path kept as the fallback.
//
// OFF BY DEFAULT. Enable with HATHOR_FLEETQ=1 + HATHOR_FLEETQ_URL (+ HATHOR_FLEETQ_TOKEN, the producer
// bearer the queue checks). When on:
//   1. POST {FLEETQ}/jobs  { type:'llm.generate', model, params:{max_tokens, temperature:0}, input:{prompt},
//                            latency:'interactive', origin:'hathor-helper-bot', deadline_s }
//      — fleetq replicates the job to N independent workers and credits the K agreeing ones AI-work units
//        in the pool's PPLNS share log (so serving Hathor's chat pays PRANA miners).
//   2. Poll GET {FLEETQ}/jobs/<id> until status is 'served' (serve-then-verify: first output returned at
//      once, crediting still waits for K-of-N) or 'verified', or until the deadline.
//   3. Anything else — flag off, queue down, 401, timeout, empty output — falls through to `fallback()`,
//      the path the bot uses today (Hathor Brain /perceive → model). Nothing goes dark.
// The prompt has ALREADY passed the secret guard before it reaches here (brain.mjs runs the guard first).

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export function fleetqConfig(env = process.env) {
  return {
    enabled: env.HATHOR_FLEETQ === '1',
    url: String(env.HATHOR_FLEETQ_URL || 'http://127.0.0.1:8620').replace(/\/$/, ''),
    token: env.HATHOR_FLEETQ_TOKEN || '',
    model: env.HATHOR_FLEETQ_MODEL || '',
    deadlineMs: Number(env.HATHOR_FLEETQ_DEADLINE_MS || 8000),
    pollMs: Number(env.HATHOR_FLEETQ_POLL_MS || 400),
    maxTokens: Number(env.HATHOR_FLEETQ_MAX_TOKENS || 256),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Try the fleet queue once. Returns the text or null. Never throws. */
export async function viaFleetq(prompt, cfg = fleetqConfig(), { now = () => Date.now(), wait = sleep } = {}) {
  if (!cfg.enabled || !prompt) return null;
  try {
    const headers = { 'content-type': 'application/json' };
    if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
    const r = await _fetch(`${cfg.url}/jobs`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'llm.generate', model: cfg.model, params: { max_tokens: cfg.maxTokens, temperature: 0 }, input: { prompt: String(prompt) }, latency: 'interactive', origin: 'hathor-helper-bot', deadline_s: Math.ceil(cfg.deadlineMs / 1000) }),
    });
    if (!r || !r.ok) return null;
    const { id } = await r.json();
    if (!id) return null;
    const until = now() + cfg.deadlineMs;
    while (now() < until) {
      const g = await _fetch(`${cfg.url}/jobs/${encodeURIComponent(id)}`);
      if (g && g.ok) {
        const j = await g.json();
        if ((j.status === 'served' || j.status === 'verified') && j.output) {
          const text = typeof j.output === 'string' ? j.output : (j.output.text || j.output.completion || '');
          if (text && String(text).trim()) return String(text);
        }
        if (j.status === 'disputed' || j.status === 'expired') return null;
      }
      await wait(cfg.pollMs);
    }
  } catch { /* fall through */ }
  return null;
}

/** askAI(prompt, { fallback }) → { text, via:'fleetq'|'fallback'|'none' }. */
export async function askAI(prompt, { fallback, cfg = fleetqConfig(), now, wait } = {}) {
  const q = await viaFleetq(prompt, cfg, { now, wait });
  if (q) return { text: q, via: 'fleetq' };
  if (typeof fallback === 'function') {
    try {
      const t = await fallback(prompt);
      if (t) return { text: String(t), via: 'fallback' };
    } catch { /* soft-fail */ }
  }
  return { text: '', via: 'none' };
}
