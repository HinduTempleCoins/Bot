// coder-brief.mjs — the CODER AIs' contribution to the Briefs + 12&12 meetings (operator 2026-06-17:
// "get them [the coder AIs] doing their Part in the Briefs and 12 and 12 Meetings"). This is the
// "Code-drafting layer still to follow" the brief-builder always left as a TODO.
//
// The coder model (Codestral / Qwen-Coder / etc.) runs via the Cheetah guest gate — NEVER Claude: the
// 12&12 output is private-models-only (operator 2026-05-31) and these are OUR models, the always-on
// runtime tier (Claude is the build/dispatch tier). Given the brief's open/in-progress engineering items
// + a little repo context, it returns a brief-ready "ENGINEERING — coder AI" section with ONE concrete,
// buildable next step per task.
//
// Soft-fail-never-throw: gate down / no key → returns '' so the brief still assembles (raw bullets kept).
// Injectable gate caller (deps.ask) for offline tests; default posts to the guest gate.

const GATE = () => (typeof process !== 'undefined' && process.env.GUEST_GATE_URL) || 'http://127.0.0.1:8780/guest/compose';
const SECRET = () => (typeof process !== 'undefined' && (process.env.GUEST_GATE_SECRET || process.env.GUEST_PROXY_SECRET)) || '';
const CODER_MODEL = () => (typeof process !== 'undefined' && process.env.CODER_MODEL) || 'codestral';

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

/** Default gate caller: POST the question to the guest gate as `model`. Returns text or null (soft-fail). */
async function defaultAsk(model, question) {
  try {
    const r = await _fetch(GATE(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guest-auth': SECRET() },
      body: JSON.stringify({ guestModel: model, guestQuestion: question, briefContent: '', contextChunks: [] }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return (j && j.ok && j.contribution && String(j.contribution).trim()) ? String(j.contribution).trim() : null;
  } catch { return null; }
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * coderBrief({ items, context, heading }, deps) — ask the coder model for a brief-ready engineering section.
 *   items   : array of open/in-progress engineering task strings (the brief's eng backlog)
 *   context : optional short repo context (recent commits / changed files)
 *   heading : section heading (default "ENGINEERING — coder AI")
 *   deps    : { ask(model,q)->text|null, model } for tests
 * Returns a markdown string ('' when there's nothing to say or the gate is down). Never throws.
 */
export async function coderBrief({ items = [], context = '', heading = 'ENGINEERING — coder AI' } = {}, deps = {}) {
  const ask = deps.ask || defaultAsk;
  const model = deps.model || CODER_MODEL();
  const top = (Array.isArray(items) ? items : []).map(clean).filter(Boolean).slice(0, 8);
  if (!top.length) return '';
  const q = [
    'You are the engineering / coder AI for the MELEK project (an off-chain operator + on-chain witness stack).',
    'For EACH numbered open task below, give ONE concrete, buildable next technical step — the module/file to touch',
    'and the approach — in a single sentence. Be specific; no preamble, no restating the task. Output a markdown list.',
    '',
    'Open engineering tasks:',
    ...top.map((t, i) => `${i + 1}. ${t}`),
    context ? `\nRecent repo context:\n${clean(context).slice(0, 800)}` : '',
  ].join('\n');
  const out = await ask(model, q).catch(() => null);
  if (!out) return '';
  return `## ${heading} (${model})\n_The coder AI's take on the open engineering work — private model, not Claude._\n\n${out.trim()}\n`;
}

/** providersHint() — what the section would use, for diagnostics. */
export function providersHint() { return { model: CODER_MODEL(), gate: GATE(), authed: !!SECRET() }; }

if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  coderBrief({ items: process.argv.slice(2).length ? process.argv.slice(2) : ['Wire chain-data into the trade monitor', 'Deploy the Modal embeddings lane'] })
    .then((s) => console.log(s || '(no coder section — gate down or no items)'));
}
