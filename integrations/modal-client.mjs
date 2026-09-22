// modal-client.mjs — the PRIVATE-DATA inference client. Our Modal.com serverless GPU ONLY.
//
// PRIVACY BOUNDARY (operator 2026-09-22, overrides "use the gate for all three"):
//   "We do NOT use APIs for any private data such as a chat like this."
// Anything that reads PRIVATE data — the Soapy admin chat, the operator's transcripts, and the
// conference/briefs derived from those transcripts — must NEVER go to an external API (not even the
// Cheetah guest gate, which fans out to external SaaS). Those flows route HERE: to a model WE run on
// Modal.com serverless GPU. Modal is OUR compute — the data stays on infrastructure we control, so
// the no-external-API-for-private-data rule holds. There is NO external-API fallback by design: if
// Modal is unreachable the call returns null and the caller records the flow as COMPUTE-GATED
// (waiting on our own inference), never leaking private data to a third-party API to "keep working."
//
// CONTRACT (aligned with the Modal build agent): POST MODAL_INFERENCE_URL
//   { messages: [{ role, content }], system, max_tokens }  ->  { text }
// A convenience form (prompt + context) is also accepted and folded into a single user message.
//
// COLD START: Modal scales from zero, so the FIRST on-demand call (Soapy chat) may spin up for a few
// seconds and 503/timeout meanwhile. askModal retries with backoff; pass { coldStart:true } for the
// on-demand path to get more, spaced retries. The batch consumers (conference + grader run ~2×/day
// when Modal is warm) use the default single retry.
//
// CONVENTIONS (house style): ESM · soft-fail-never-throw (null on any failure) · injectable fetch via
// __setFetch (offline tests) · NO SECRETS in the repo (URL + token read from env by NAME) · zero-WIF.
//
//   import { askModal, askModalJson, modalReady, modalInfo, __setFetch } from './modal-client.mjs';

const URL_ = () => (typeof process !== 'undefined' && process.env.MODAL_INFERENCE_URL) || '';
const TOKEN = () => (typeof process !== 'undefined' && (process.env.MODAL_INFERENCE_TOKEN || process.env.MODAL_TOKEN)) || '';
const MODEL = () => (typeof process !== 'undefined' && process.env.MODAL_MODEL) || '';
const TIMEOUT = () => +((typeof process !== 'undefined' && process.env.MODAL_TIMEOUT_MS) || 120000);
const BACKOFF = () => +((typeof process !== 'undefined' && process.env.MODAL_BACKOFF_MS) || 2000);

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => fetch(...a)); }
// injectable sleep so cold-start backoff never slows the offline test suite.
let _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function __setSleep(fn) { _sleep = typeof fn === 'function' ? fn : ((ms) => new Promise((r) => setTimeout(r, ms))); }

/** Is a Modal endpoint configured at all? (false → the private flow is COMPUTE-GATED, not broken.) */
export function modalReady() { return !!URL_(); }

// Build the {messages, system} pair from either explicit messages or a prompt+context convenience.
function toMessages({ messages, prompt = '', context = [] }) {
  if (Array.isArray(messages) && messages.length) {
    return messages
      .filter((m) => m && (m.role || m.content))
      .map((m) => ({ role: String(m.role || 'user'), content: String(m.content == null ? '' : m.content) }));
  }
  const chunks = Array.isArray(context)
    ? context.map((c) => (c && typeof c === 'object') ? `## ${c.path || 'context'}\n${c.text == null ? '' : c.text}` : String(c == null ? '' : c))
    : (context ? [String(context)] : []);
  const content = [...chunks, String(prompt == null ? '' : prompt)].filter((s) => s && String(s).trim()).join('\n\n');
  return content.trim() ? [{ role: 'user', content }] : [];
}

function headers() {
  const h = { 'content-type': 'application/json' };
  const t = TOKEN();
  if (t) h.authorization = `Bearer ${t}`; // shared auth for OUR endpoint; read by name, never logged
  return h;
}

/**
 * Ask our Modal model. Returns the text answer, or null on any failure/empty (soft-fail). NEVER
 * reaches an external API. Retries with backoff (more, spaced, when coldStart). Times out per attempt.
 *
 * @param {{messages?:Array, prompt?:string, context?:string|Array, system?:string,
 *          maxTokens?:number, retries?:number, coldStart?:boolean}} opts
 * @returns {Promise<string|null>}
 */
export async function askModal({ messages, prompt = '', context = [], system = '', maxTokens = 1400, retries, coldStart = false } = {}) {
  if (!modalReady()) return null; // not configured → compute-gated; caller decides how to surface it
  const msgs = toMessages({ messages, prompt, context });
  if (!msgs.length && !String(system).trim()) return null;
  const body = JSON.stringify({ messages: msgs, system: String(system || ''), max_tokens: maxTokens, ...(MODEL() ? { model: MODEL() } : {}) });

  // cold-start (on-demand Soapy): more, spaced attempts to ride out the spin-up from zero.
  const attempts = Math.max(1, (Number(retries != null ? retries : (coldStart ? 4 : 1)) || 0) + 1);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && coldStart) await _sleep(BACKOFF() * attempt); // linear backoff while warming
    const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ac ? setTimeout(() => { try { ac.abort(); } catch { /* noop */ } }, TIMEOUT()) : null;
    try {
      const res = await _fetch(URL_(), { method: 'POST', headers: headers(), body, signal: ac ? ac.signal : undefined });
      if (!res || !res.ok) continue; // 503 while scaling from zero → retry
      const j = await res.json();
      const out = j && (j.text != null ? j.text : j.output); // contract: {text}; tolerate {output}
      if (out && String(out).trim()) return String(out).trim();
    } catch { /* timeout / network — retry */ }
    finally { if (timer) clearTimeout(timer); }
  }
  return null;
}

// Pull the first well-formed JSON object out of a model reply (tolerates ```json fences + prose).
export function extractJson(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : s;
  const candidates = [];
  const trimmed = src.trim();
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  const span = src.match(/\{[\s\S]*\}/);
  if (span) candidates.push(span[0]);
  for (const c of candidates) {
    try { const o = JSON.parse(c); if (o && typeof o === 'object') return o; } catch { /* next */ }
  }
  return null;
}

/** Ask Modal for JSON and parse it. Returns the object, or null (soft-fail). */
export async function askModalJson(opts = {}) {
  const raw = await askModal(opts);
  return raw == null ? null : extractJson(raw);
}

/** What the client would use, for diagnostics (never exposes the token value). */
export function modalInfo() {
  return { url: URL_(), configured: modalReady(), model: MODEL() || null, authed: !!TOKEN() };
}

export default { askModal, askModalJson, extractJson, modalReady, modalInfo, __setFetch, __setSleep };

// ── CLI (guarded, offline-safe demo) ────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv.slice(2).join(' ') || 'In one sentence, what is the MELEK project?';
  if (!modalReady()) console.log('(MODAL_INFERENCE_URL unset — private inference is COMPUTE-GATED; not falling back to any external API)');
  else askModal({ prompt: q, coldStart: true }).then((a) => console.log(a || '(Modal down/warming — soft-fail null)'));
}
