// site/soapy/server.mjs — Soapy.blog: the operator's chat with the ONE Hathor brain.
//
// TWO TABS (operator request 2026-09-22):
//   • "Soapy AI"  — the LOCAL/self-hosted brain (relayed to the Hathor agency /perceive; Modal on the
//                   private side). No external model API. This is the default and needs no login.
//   • "Claude"    — an OPT-IN tab that talks to Anthropic's API. It REQUIRES LOGIN, and it is OFF by
//                   construction unless a key is explicitly configured (CLAUDE_CHAT_API_KEY). This is the
//                   deliberate exception to the standing rule "no external API for private data such as a
//                   chat" — it only ever calls out when the operator has turned it on with a key, and the
//                   page says so in plain words. Soapy AI stays local always.
//
// LOGIN: an in-app password gate (SOAPY_PASSWORD) → a signed, HMAC session cookie (SOAPY_SESSION_SECRET).
// Fail-closed: with no SOAPY_PASSWORD set, the Claude tab stays locked. Soapy AI is open.
//
// House style: ESM .mjs, esc() all interpolation, injectable fetch/reader/clock, soft-fail-never-throw,
// handler(req,res) exported for tests, CLI guarded by process.argv[1], PORT env.
import http from 'node:http';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8179);
const HOST = process.env.HOST || '127.0.0.1';
const BRAIN_DIR = process.env.HATHOR_BRAIN_DIR || '/opt/melek-bot/data/hathor-brain';
const AGENCY_URL = (process.env.HATHOR_AGENCY_URL || 'http://127.0.0.1:8175').replace(/\/+$/, '');
const SURFACE = process.env.SOAPY_SURFACE || 'soapy';
const SESSION_TTL_MS = Number(process.env.SOAPY_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000); // 30 days

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

let _readFile = (p) => fsp.readFile(p, 'utf8');
export function __setReader(fn) { _readFile = typeof fn === 'function' ? fn : ((p) => fsp.readFile(p, 'utf8')); }

let _now = () => Date.now();
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : (() => Date.now()); }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── auth ──────────────────────────────────────────────────────────────────────────────────────────
// The session secret defaults to a value derived from the password so a deployment that sets only
// SOAPY_PASSWORD still gets stable, unforgeable cookies. Set SOAPY_SESSION_SECRET to rotate independently.
function sessionSecret() {
  return process.env.SOAPY_SESSION_SECRET
    || (process.env.SOAPY_PASSWORD ? `soapy:${process.env.SOAPY_PASSWORD}` : '');
}
/** Mint a signed session token: base64url(expiry).hmac. */
export function mintSession(now = _now(), ttl = SESSION_TTL_MS, secret = sessionSecret()) {
  if (!secret) return '';
  const exp = String(now + ttl);
  const payload = Buffer.from(exp).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
/** Verify a session token (constant-time sig check + not expired). */
export function verifySession(token, now = _now(), secret = sessionSecret()) {
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expect = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  let exp = 0;
  try { exp = Number(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return false; }
  return Number.isFinite(exp) && exp > now;
}
function cookies(req) {
  const out = {};
  const raw = (req && req.headers && req.headers.cookie) || '';
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
/** Logged in? Cookie session OR the test override. */
let _auth = null;
export function __setAuth(fn) { _auth = typeof fn === 'function' ? fn : null; }
function isAuthed(req) {
  if (_auth) return !!_auth(req);
  return verifySession(cookies(req).soapy_session || '');
}
/** Check a submitted password against SOAPY_PASSWORD, constant-time. */
export function passwordOk(pw) {
  const real = process.env.SOAPY_PASSWORD || '';
  if (!real || !pw) return false;
  const a = Buffer.from(String(pw)); const b = Buffer.from(real);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── transcript (local brain memory) ─────────────────────────────────────────────────────────────────
export async function loadTranscript(opts = {}) {
  const dir = opts.dir || BRAIN_DIR;
  const surface = String(opts.surface || SURFACE).replace(/[^a-z0-9_-]/gi, '_');
  const limit = opts.limit ?? 200;
  let raw = '';
  try { raw = await _readFile(join(dir, `${surface}.jsonl`)); } catch { return []; }
  const out = [];
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let r;
    try { r = JSON.parse(t); } catch { continue; }
    const text = String((r && r.text) || '').trim();
    if (!text) continue;
    const role = (r && r.meta && r.meta.role) || '';
    const self = role ? role === 'self' : /^hathor:/i.test(text);
    const body = text.replace(/^[^:]{1,40}:\s*/, '');
    out.push({ who: self ? 'Hathor' : String((r && r.person) || 'you'), text: body || text, at: Number((r && (r.at ?? r.ts)) || 0), self });
  }
  return out.slice(-limit);
}

/** Relay to the LOCAL Hathor brain (self-hosted). Soft-fails to an honest string. */
export async function send(text, opts = {}) {
  const body = { surface: opts.surface || SURFACE, from: opts.from || 'operator', text: String(text || '') };
  try {
    const res = await _fetch(`${opts.agencyUrl || AGENCY_URL}/perceive`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res || !res.ok) return { ok: false, reply: '', error: `http-${res && res.status}` };
    const j = await res.json();
    return { ok: true, reply: String((j && j.reply) || ''), drewFrom: (j && j.drewFrom) || [] };
  } catch (e) {
    return { ok: false, reply: '', error: String((e && e.message) || e) };
  }
}

/** The Claude tab. OPT-IN + login-gated: calls Anthropic ONLY if a key is configured. */
export function claudeConfigured() { return !!(process.env.CLAUDE_CHAT_API_KEY); }
export async function sendClaude(text, opts = {}) {
  const key = opts.apiKey || process.env.CLAUDE_CHAT_API_KEY || '';
  if (!key) return { ok: false, reply: '', error: 'claude-not-configured' };
  const model = opts.model || process.env.CLAUDE_CHAT_MODEL || 'claude-opus-4-8';
  try {
    const res = await _fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: Number(opts.maxTokens || 1024), messages: [{ role: 'user', content: String(text || '') }] }),
    });
    if (!res || !res.ok) return { ok: false, reply: '', error: `http-${res && res.status}` };
    const j = await res.json();
    const reply = Array.isArray(j && j.content) ? j.content.map((b) => (b && b.text) || '').join('') : '';
    return { ok: true, reply: String(reply || '') };
  } catch (e) {
    return { ok: false, reply: '', error: String((e && e.message) || e) };
  }
}

// ── views ─────────────────────────────────────────────────────────────────────────────────────────
const STYLE = `
 :root{color-scheme:dark;--bg:#0b0d10;--fg:#e8e6e1;--dim:#8b8f96;--self:#1b2430;--them:#15181d;--line:#232830;--accent:#2a3546}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-serif,Georgia,serif;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
 header,main,form,.tabs,.note{max-width:760px;margin-left:auto;margin-right:auto}
 header{margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:12px}
 h1{font-size:19px;margin:0 0 4px;letter-spacing:.02em}
 .sub{color:var(--dim);font-size:13px}
 .tabs{display:flex;gap:8px;margin:0 auto 14px}
 .tab{flex:0 0 auto;padding:9px 18px;border:1px solid var(--line);border-radius:10px 10px 0 0;color:var(--dim);text-decoration:none;background:var(--them)}
 .tab.on{color:var(--fg);background:var(--self);border-bottom-color:var(--self)}
 .note{color:var(--dim);font-size:12px;margin:0 auto 12px;padding:9px 12px;border:1px dashed var(--line);border-radius:8px}
 .t{padding:12px 14px;border-radius:10px;margin:0 0 10px;background:var(--them);border:1px solid var(--line)}
 .t.self{background:var(--self)}
 .who{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin-bottom:5px}
 .body{white-space:pre-wrap;word-wrap:break-word}
 form.chat{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
 textarea{flex:1 1 320px;min-height:74px;background:#11141a;color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:11px;font:inherit;resize:vertical}
 button{background:var(--accent);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:11px 20px;font:inherit;cursor:pointer}
 button:hover{background:#34425a}
 .login{max-width:360px;margin:8vh auto 0}
 input[type=password]{width:100%;background:#11141a;color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit;margin:10px 0}
 a{color:#9fb6d8}`;

function shell(activeTab, inner, extraNote) {
  const tab = (id, label, locked) =>
    `<a class="tab ${activeTab === id ? 'on' : ''}" href="/?tab=${id}">${esc(label)}${locked ? ' 🔒' : ''}</a>`;
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Soapy</title>
<style>${STYLE}</style>
<header><h1>Soapy</h1><div class="sub">Chat with the one Hathor.</div></header>
<div class="tabs">${tab('soapy', 'Soapy AI', false)}${tab('claude', 'Claude', true)}</div>
${extraNote ? `<div class="note">${extraNote}</div>` : ''}
<main>${inner}</main>`;
}

function transcriptRows(turns) {
  return turns.map((t) => `<div class="t ${t.self ? 'self' : 'them'}"><div class="who">${esc(t.who)}</div><div class="body">${esc(t.text)}</div></div>`).join('');
}

function soapyView(turns) {
  const resumed = turns.length ? `Resumed — ${esc(String(turns.length))} turn(s) of memory.` : 'No memory yet. Say something and she will remember it.';
  return shell('soapy',
    `${transcriptRows(turns)}
     <form class="chat" method="POST" action="/send"><textarea name="text" placeholder="Say something to Hathor…" autofocus></textarea><button type="submit">Send</button></form>`,
    `Soapy AI runs on the local, self-hosted brain — nothing leaves our servers. ${resumed}`);
}

function loginView(err) {
  return shell('claude',
    `<form class="login" method="POST" action="/login">
       <p>The Claude tab requires login.</p>
       ${err ? `<p style="color:#e0916f">${esc(err)}</p>` : ''}
       <input type="password" name="password" placeholder="Soapy password" autofocus autocomplete="current-password">
       <input type="hidden" name="next" value="claude">
       <button type="submit">Log in</button>
     </form>`,
    'Logging in unlocks the Claude tab. Soapy AI (local) needs no login.');
}

function claudeView(turns) {
  const on = claudeConfigured();
  const note = on
    ? '⚠️ The Claude tab sends your messages to Anthropic\'s API (an external service) — this is the deliberate opt-in exception; Soapy AI stays local.'
    : 'Claude chat is OFF — no API key is configured on this server. Set CLAUDE_CHAT_API_KEY to enable it. Soapy AI (local) works regardless.';
  const form = on
    ? `<form class="chat" method="POST" action="/claude/send"><textarea name="text" placeholder="Ask Claude…" autofocus></textarea><button type="submit">Send</button></form>`
    : '';
  return shell('claude', `${transcriptRows(turns)}${form}`, note);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) d = d.slice(0, 1e6); });
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
}
function parseForm(raw) {
  try { return raw.trim().startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); }
  catch { return {}; }
}

export function createServer(cfg = {}) {
  const html = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(body); };
  const json = (res, code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
  const redirect = (res, to, headers = {}) => { res.writeHead(302, { location: to, 'cache-control': 'no-store', ...headers }); res.end(); };

  async function handler(req, res) {
    try {
      if (typeof req?.url !== 'string' || !req.url) return json(res, 200, { ok: false, error: 'soft' });
      const url = new URL(req.url, `http://${(req.headers && req.headers.host) || 'localhost'}`);
      const method = req.method || 'GET';
      const p = url.pathname;

      if (p === '/healthz') return json(res, 200, { ok: true, surface: SURFACE, claude: claudeConfigured() });

      // Login (for the Claude tab).
      if (p === '/login' && method === 'GET') return html(res, 200, loginView(''));
      if (p === '/login' && method === 'POST') {
        const f = parseForm(await readBody(req));
        if (passwordOk(f.password)) {
          const cookie = `soapy_session=${mintSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
          return redirect(res, `/?tab=${f.next === 'claude' ? 'claude' : 'soapy'}`, { 'set-cookie': cookie });
        }
        return html(res, 401, loginView('Wrong password.'));
      }
      if (p === '/logout') return redirect(res, '/', { 'set-cookie': 'soapy_session=; HttpOnly; Path=/; Max-Age=0' });

      // Home — two tabs. Soapy AI is open; Claude requires login.
      if (p === '/' && method === 'GET') {
        const tab = url.searchParams.get('tab') === 'claude' ? 'claude' : 'soapy';
        if (tab === 'claude') {
          if (!isAuthed(req)) return html(res, 200, loginView(''));
          return html(res, 200, claudeView(await loadTranscript({ ...cfg, surface: 'soapy-claude' })));
        }
        return html(res, 200, soapyView(await loadTranscript(cfg)));
      }

      if (p === '/transcript.json') return json(res, 200, { ok: true, turns: await loadTranscript(cfg) });

      // Soapy AI send — local brain, open.
      if (p === '/send' && method === 'POST') {
        const text = String(parseForm(await readBody(req)).text || '');
        if (!text.trim()) return html(res, 200, soapyView(await loadTranscript(cfg)));
        const r = await send(text, cfg);
        if (url.searchParams.get('format') === 'json' || /application\/json/.test(req.headers.accept || '')) return json(res, 200, r);
        return html(res, 200, soapyView(await loadTranscript(cfg)));
      }

      // Claude send — login-gated + opt-in.
      if (p === '/claude/send' && method === 'POST') {
        if (!isAuthed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
        const text = String(parseForm(await readBody(req)).text || '');
        if (!text.trim()) return html(res, 200, claudeView(await loadTranscript({ ...cfg, surface: 'soapy-claude' })));
        const r = await sendClaude(text, cfg);
        if (url.searchParams.get('format') === 'json' || /application\/json/.test(req.headers.accept || '')) return json(res, 200, r);
        return html(res, 200, claudeView(await loadTranscript({ ...cfg, surface: 'soapy-claude' })));
      }

      return json(res, 404, { ok: false, error: 'not found' });
    } catch {
      return json(res, 200, { ok: false, error: 'soft' });
    }
  }
  return { handler };
}

// A default top-level handler (module-level __setAuth/__setReader/__setFetch still apply).
export const { handler } = createServer();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { handler } = createServer();
  http.createServer(handler).listen(PORT, HOST, () => console.log(`[soapy] http://${HOST}:${PORT} (claude tab: ${claudeConfigured() ? 'on' : 'off'})`));
}
