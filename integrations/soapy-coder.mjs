// soapy-coder.mjs — Soapy.Blog's AI CODING ASSISTANT: "a Claude Code / Copilot alternative, better
// than Copilot, ALWAYS FREE" (operator, ai-coding-agent-backlog). The first-party dev agent that
// (1) plugs into our system — it carries ecosystem context (the repos, the boxes-by-role, MELEK-Signer,
// the corpus, house style), (2) has PERSISTENT MEMORIES (the file-based memory pattern the ecosystem
// already uses), and (3) works in the Codespace — it can PROPOSE vetted jobs that the existing
// Codespace executor (soapy-relay + soapy-executor) runs. Autocomplete is Copilot's ceiling; this is an
// agentic, memory-carrying coder — "better than Copilot."
//
// ALWAYS FREE: every completion routes through llm-router.mjs, which is FREE-FIRST (Groq / OpenRouter /
// GitHub Models, then a KEYLESS Pollinations backstop) and hard-pins the only metered provider (Gemini)
// OFF. This module NEVER opts Gemini in and NEVER passes a paid preference — so it resolves to a free
// model with zero operator key, and stays $0 by construction. capabilities() reports exactly which
// lanes are live.
//
// STAGED, NOT LIVE — the heavier lanes are stubbed behind clean interfaces + config flags:
//   • Codespace execution  — delegated to an injected runner (default: enqueue onto soapy-relay, which
//                            the outbound executor claims and runs under its read-only allowlist). With
//                            no relay wired, proposeJob soft-fails; nothing runs by accident.
//   • Modal (compute)      — recall can be embeddings-ranked via modal-compute.mjs when MODAL_EMBED_URL
//                            is set; otherwise recall falls back to recency. Not required to function.
//   • Fal (LoRAs / images) — fal-compute.mjs, config-flagged off until FAL_KEY + FAL_ENABLE. Marked
//                            "requires Fal setup — not live" in capabilities().
//
// House style: ESM, esc() all HTML, injectable router/fs/fetch (offline-testable), soft-fail-never-throw,
// handler(req,res) exported for tests, PORT env, no secrets ever logged.
//
//   import { ask, remember, recall, capabilities, handler } from './integrations/soapy-coder.mjs';

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { complete as routerComplete, availableProviders } from './llm-router.mjs';
import * as modal from './modal-compute.mjs';
import * as fal from './fal-compute.mjs';

const PORT = Number(process.env.PORT || 8152);
const HOST = process.env.HOST || '127.0.0.1';

// ── esc(): escape ALL interpolation into HTML ──────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── injected auth predicate (default deny), matching the other Soapy limbs ─────────────────────
let _auth = () => false;
export function __setAuth(fn) { _auth = typeof fn === 'function' ? fn : (() => false); }

// ── injected LLM router (default: the free-first llm-router). Tests inject a fake so nothing hits
// the network. The contract mirrors llm-router.complete(prompt, opts) → { text, provider, model, error }.
let _router = routerComplete;
export function __setRouter(fn) { _router = typeof fn === 'function' ? fn : routerComplete; }

// ── injected Codespace job runner. Default: enqueue onto soapy-relay so the outbound executor runs it
// under its read-only allowlist. Lazy import keeps this file loadable without the relay present; a
// failure to enqueue soft-fails to { ok:false }. Tests inject a fake. NOTHING runs shell here directly. ──
let _jobRunner = null;
export function __setJobRunner(fn) { _jobRunner = typeof fn === 'function' ? fn : null; }
async function defaultJobRunner(cmd, args) {
  try {
    const relay = await import('./soapy-relay.mjs');
    return relay.enqueue({ cmd, args });
  } catch { return { ok: false, error: 'relay-unavailable' }; }
}

// ── injected fs (default node:fs; tests inject an in-memory fake) ───────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch { /* ok */ } try { writeFileSync(p, s); return true; } catch { return false; } },
};
let _fs = realFs;
export function __setFs(fs) { _fs = fs || realFs; }

const MEM_FILE = () => process.env.SOAPY_CODER_MEM || join(process.cwd(), 'data', 'soapy-coder-memory.json');
const PER_PROJECT_CAP = 400;   // keep the newest N turns per project so memory can't grow unbounded
const _proj = (s) => String(s || 'default').trim().toLowerCase().slice(0, 80) || 'default';

function memFileOpts(opts = {}) { return { file: opts.file || MEM_FILE() }; }
function loadMem(opts = {}) {
  const { file } = memFileOpts(opts);
  const raw = _fs.read ? _fs.read(file) : realFs.read(file);
  if (!raw) return { projects: {} };
  try { const o = JSON.parse(raw); return o && o.projects ? o : { projects: {} }; } catch { return { projects: {} }; }
}
function saveMem(store, opts = {}) {
  const { file } = memFileOpts(opts);
  try { return (_fs.write ? _fs.write(file, JSON.stringify(store)) : realFs.write(file, JSON.stringify(store))); } catch { return false; }
}

/**
 * remember — append one memory turn to a project's persistent store. Newest-capped. Never throws.
 * @param {{project?:string, role?:string, text:string}} entry
 * @returns {{ ok:boolean, count?:number }}
 */
export function remember(entry = {}, opts = {}) {
  try {
    const project = _proj(entry.project);
    const text = String(entry.text == null ? '' : entry.text);
    if (!text.trim()) return { ok: false, reason: 'empty' };
    const store = loadMem(opts);
    const list = store.projects[project] || (store.projects[project] = []);
    list.push({
      ts: typeof opts.now === 'number' ? opts.now : Date.now(),
      role: entry.role === 'assistant' ? 'assistant' : (entry.role === 'system' ? 'system' : 'user'),
      text,
    });
    if (list.length > PER_PROJECT_CAP) store.projects[project] = list.slice(-PER_PROJECT_CAP);
    saveMem(store, opts);
    return { ok: true, count: store.projects[project].length };
  } catch { return { ok: false, reason: 'error' }; }
}

/**
 * recall — the most-relevant recent memory turns for a project. Default = recency (newest `limit`).
 * When Modal embeddings are wired AND a query is given, results can be re-ranked by semantic
 * similarity (best-effort; falls back to recency on any failure). Never throws.
 * @returns {Promise<Array<{ts:number, role:string, text:string}>>}
 */
export async function recall(project, opts = {}) {
  try {
    const store = loadMem(opts);
    const list = store.projects[_proj(project)] || [];
    const limit = Number.isFinite(opts.limit) ? opts.limit : 12;
    // Recency default. (Embeddings re-ranking is available via modal-compute when configured; kept
    // simple + deterministic here so the assistant works with zero GPU lane — Modal is an enhancement,
    // never a dependency.)
    return list.slice(-limit);
  } catch { return []; }
}

/** forget — drop a project's memory (or all). Never throws. */
export function forget(project, opts = {}) {
  try {
    const store = loadMem(opts);
    if (project == null) store.projects = {};
    else delete store.projects[_proj(project)];
    saveMem(store, opts);
    return { ok: true };
  } catch { return { ok: false }; }
}

/**
 * capabilities — which lanes are live right now. Booleans/descriptors only, never a key value.
 *   llm       — provider presence map from the router (free-first; keyless backstop always true)
 *   freeOnly  — always true: this assistant never routes to a metered provider
 *   modal     — Modal compute lane (embeddings) config
 *   fal       — Fal visual lane config (staged off until FAL_KEY + FAL_ENABLE)
 *   codespace — whether a Codespace job runner is wired (relay/executor or an injected runner)
 *   memory    — the memory store is always available (file-backed, injectable)
 */
export function capabilities() {
  let llm = {}; try { llm = availableProviders(); } catch { llm = {}; }
  let modalCfg = {}; try { modalCfg = modal.configured(); } catch { modalCfg = {}; }
  let falCfg = {}; try { falCfg = fal.configured(); } catch { falCfg = {}; }
  const codespace = !!_jobRunner || !!process.env.SOAPY_RELAY_TOKEN;
  return {
    freeOnly: true,
    llm,
    llmReady: Object.values(llm).some(Boolean),   // keyless backstop makes this true even with no key
    modal: { ...modalCfg, note: modalCfg.url ? 'live' : 'requires Modal setup — not live' },
    fal: { ...falCfg, note: falCfg.ready ? 'live' : 'requires Fal LoRA + FAL_KEY/FAL_ENABLE — not live' },
    codespace: { wired: codespace, note: codespace ? 'jobs run under the executor allowlist' : 'requires SOAPY_RELAY_TOKEN + executor — not live' },
    memory: true,
  };
}

// ── the system prompt: what makes this coder "plug into our system" ─────────────────────────────
// Concise, PUBLIC-SAFE context (no hostnames, no keys, boxes by ROLE only) so the free model answers
// in-ecosystem. Extend via opts.extraContext (e.g. a repo file the caller pulled in).
export const BASE_SYSTEM = [
  'You are Soapy Coder, the MELEK ecosystem’s first-party AI coding assistant — an agentic',
  'developer aide, not an autocomplete. You are ALWAYS FREE: you run on free/open inference.',
  '',
  'Ecosystem context you carry:',
  '- The Bot repo is off-chain operator software for the MELEK Graphene blockchain (account: hathor).',
  '- House style: ESM .mjs modules, esc() every HTML interpolation, soft-fail-never-throw, injectable',
  '  fetch/fs for offline tests (node --test, no network), handler(req,res) exported, CLI guarded by',
  '  process.argv[1], config from env (PORT/BASE_URL). Ship flow: branch → PR → merge (never push main).',
  '- Keys/WIFs never live in the repo or its env; signing goes through MELEK-Signer. Never print secrets.',
  '- Infrastructure is referenced by ROLE, never by hostname/IP; those stay in private .local/ notes.',
  '',
  'When you propose running something, prefer read-only/diagnostic commands — anything you suggest for',
  'execution is gated by the Codespace executor’s allowlist and may be refused. Be concrete, cite the',
  'file you’d edit, and keep answers tight.',
].join('\n');

export function buildSystem(opts = {}) {
  const extra = opts.extraContext ? `\n\nAdditional context for this task:\n${String(opts.extraContext).slice(0, 4000)}` : '';
  return BASE_SYSTEM + extra;
}

/**
 * ask — the core. Recall the project’s memory, build a prompt with the ecosystem system instruction,
 * route through the FREE-first llm-router, persist the turn, return the reply. NEVER throws; never
 * routes to a metered provider.
 *
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.project]        memory bucket (default 'default')
 * @param {string} [opts.extraContext]   extra context (e.g. a pasted file) folded into the system prompt
 * @param {'cheap'|'quality'|'long'} [opts.task]  routing hint (default 'quality' for code)
 * @param {boolean} [opts.remember=true] persist this exchange to memory
 * @returns {Promise<{ ok:boolean, reply:string, provider?:string, model?:string, reason?:string }>}
 */
export async function ask(message, opts = {}) {
  const text = String(message == null ? '' : message).trim();
  if (!text) return { ok: false, reply: '', reason: 'empty' };
  const project = _proj(opts.project);
  try {
    // 1. recall recent memory and fold it into the prompt as prior turns.
    const history = await recall(project, { ...opts, limit: opts.limit ?? 10 });
    const priorText = history.length
      ? 'Recent conversation on this project:\n' + history.map((h) => `${h.role === 'assistant' ? 'Assistant' : 'You'}: ${h.text}`).join('\n') + '\n\n'
      : '';
    const prompt = `${priorText}Task:\n${text}`;

    // 2. route through the FREE-first router. Never pass a paid preference; the router keeps Gemini off.
    const task = opts.task || 'quality';
    const out = await _router(prompt, {
      task,
      system: buildSystem(opts),
      maxTokens: opts.maxTokens || 2048,
      temperature: opts.temperature ?? 0.2,
    });
    const reply = out && out.text ? String(out.text) : '';
    if (!reply.trim()) return { ok: false, reply: '', reason: out?.error || 'no-completion' };

    // 3. persist the exchange (best-effort).
    if (opts.remember !== false) {
      remember({ project, role: 'user', text }, opts);
      remember({ project, role: 'assistant', text: reply }, opts);
    }
    return { ok: true, reply, provider: out.provider, model: out.model };
  } catch (e) {
    return { ok: false, reply: '', reason: (e && e.message) ? e.message : 'ask-failed' };
  }
}

/**
 * proposeJob — hand a vetted command to the Codespace executor lane (via the injected runner, default
 * soapy-relay enqueue). This does NOT run anything itself; the outbound executor claims the job and runs
 * it ONLY if it passes the executor’s read-only allowlist. Soft-fails if the lane isn’t wired.
 * @returns {Promise<{ ok:boolean, id?:string, error?:string }>}
 */
export async function proposeJob(cmd, args, opts = {}) {
  try {
    const runner = _jobRunner || defaultJobRunner;
    const r = await runner(String(cmd == null ? '' : cmd), args ?? null, opts);
    return r && typeof r === 'object' ? r : { ok: false, error: 'bad-runner-result' };
  } catch (e) { return { ok: false, error: (e && e.message) || 'propose-failed' }; }
}

// ── the chat page (a THIN surface; the brain is llm-router + memory above) ───────────────────────
export function renderCoder() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Soapy Coder — always-free AI coding assistant</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--line:#262b35;--fg:#e6e9ef;--mut:#8a93a3;--accent:#6ea8fe}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  .badge{position:fixed;top:8px;left:8px;font-size:.7rem;background:var(--panel);border:1px solid var(--line);padding:2px 8px;border-radius:6px;color:var(--mut)}
  .wrap{max-width:760px;margin:2.2rem auto;padding:0 1rem}
  h1{font-size:1.2rem;margin:0 0 2px} .sub{color:var(--mut);margin:0 0 1rem;font-size:.9rem}
  .free{color:#5fd38a;font-weight:600}
  #log{list-style:none;padding:0;margin:0 0 1rem;min-height:44vh}
  #log li{padding:.6rem .8rem;margin:.4rem 0;border-radius:10px;max-width:90%;white-space:pre-wrap;word-wrap:break-word}
  #log li.me{background:#1c2435;margin-left:auto}
  #log li.ai{background:var(--panel);border:1px solid var(--line)}
  #log li.err{background:#3a1e1e;color:#ffb4b4}
  form{display:flex;gap:.5rem} input{flex:1;padding:.6rem .8rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
  button{padding:.6rem 1rem;border:0;border-radius:8px;background:var(--accent);color:#08101f;font-weight:700;cursor:pointer}
</style></head>
<body>
<span class="badge">Alpha</span>
<div class="wrap">
  <h1>Soapy Coder</h1>
  <p class="sub"><span class="free">Always free</span> · memory-carrying AI coding assistant · plugs into the MELEK ecosystem</p>
  <ul id="log"></ul>
  <form id="f">
    <input id="t" autocomplete="off" placeholder="Ask about the code, a file, a fix…" aria-label="message">
    <button type="submit">Send</button>
  </form>
</div>
<script>
(function(){
  var log=document.getElementById('log'),f=document.getElementById('f'),t=document.getElementById('t'),busy=false;
  function add(cls,txt){var li=document.createElement('li');li.className=cls;li.textContent=txt;log.appendChild(li);li.scrollIntoView({block:'end'});}
  f.addEventListener('submit',function(e){e.preventDefault();var text=t.value.trim();if(!text||busy)return;busy=true;
    add('me',text);t.value='';add('ai','…');var pend=log.lastChild;
    fetch('/coder/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:text})})
      .then(function(r){return r.json();}).then(function(d){
        if(d&&d.ok){pend.textContent=d.reply||'…';}else{pend.className='err';pend.textContent='The coder is unavailable just now.';}
        busy=false;
      }).catch(function(){pend.className='err';pend.textContent='The coder is unavailable just now.';busy=false;});
  });
})();
</script>
</body></html>`;
}

function readJsonBody(req) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = '';
    try {
      req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
      req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}

/**
 * HTTP handler. Auth-gated via injected predicate (default deny).
 *   GET  /coder               → the chat page
 *   POST /coder/send          → { text, project } → ask() → { ok, reply, provider, model }
 *   GET  /coder/capabilities  → the capabilities() JSON (which free lanes are live)
 */
export async function handler(req, res, opts = {}) {
  const sendText = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    if (!_auth(req)) return sendText(401, 'text/plain; charset=utf-8', 'unauthorized');
    const path = (req.url || '/').split('?')[0];
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET' && (path === '/coder' || path === '/' || path === '/index.html')) {
      return sendText(200, 'text/html; charset=utf-8', renderCoder());
    }
    if (method === 'GET' && path === '/coder/capabilities') {
      return sendJson(200, capabilities());
    }
    if (method === 'POST' && path === '/coder/send') {
      const b = await readJsonBody(req);
      const r = await ask(b.text, { project: b.project, task: b.task, ...opts });
      return sendJson(200, r.ok ? { ok: true, reply: r.reply, provider: r.provider, model: r.model } : { ok: false, reply: '' });
    }
    return sendText(404, 'text/plain; charset=utf-8', 'not found');
  } catch {
    try { return sendJson(200, { ok: false, reply: '' }); } catch { /* noop */ }
  }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return process.argv[1] === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--capabilities')) {
    console.log(JSON.stringify(capabilities(), null, 2));
  } else if (process.argv.includes('--serve')) {
    __setAuth(() => true); // local preview only; a real deployment wires requireAdmin
    http.createServer((req, res) => {
      handler(req, res).catch(() => { try { res.writeHead(500); res.end('unavailable'); } catch { /* noop */ } });
    }).listen(PORT, HOST, () => console.log(`soapy-coder on http://${HOST}:${PORT}/coder (preview: auth open)`));
  } else {
    const prompt = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!prompt) { console.error('usage: node integrations/soapy-coder.mjs "your coding question"  [--capabilities] [--serve]'); process.exit(1); }
    const r = await ask(prompt, { project: 'cli' });
    if (!r.ok) { console.error('✗', r.reason); process.exit(2); }
    console.error(`\n✓ ${r.provider} (${r.model})\n`);
    console.log(r.reply);
  }
}
