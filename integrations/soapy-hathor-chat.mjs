// soapy-hathor-chat.mjs — Soapy.Blog chat surface for Hathor. A THIN LIMB.
//
// There is ONE Hathor (integrations/hathor-agency-server.mjs). Every surface — Discord, the game
// servers, MELEK chat, and now Soapy.Blog — is a thin limb that POSTs what it hears to her /perceive
// endpoint and speaks back her reply. This module implements NO AI of its own: it only relays to
// /perceive and renders a minimal chat panel. That is the whole point — one brain, many surfaces.
//
// The /perceive contract (read from hathor-agency-server.mjs, NOT invented):
//   POST {HATHOR_AGENCY_URL}/perceive   body { surface, from, text, now? }
//        → 200 { ok, reply, surface, person, drewFrom, recalled }
//   Her text lives in `.reply`; `from` is the person id; `surface` names the limb.
//
// House style: ESM, injectable fetch (offline-testable), soft-fail-never-throw, esc() all HTML,
// handler(req,res) exported for tests, CLI guarded by process.argv[1], PORT env.
//
//   import { ask, handler, __setFetch, __setAuth } from './integrations/soapy-hathor-chat.mjs';
//   const r = await ask('hello Hathor', { user: 'alice', surface: 'soapy' }); // { ok, reply }

import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8176);
const HOST = process.env.HOST || '127.0.0.1';
// Base URL of THE one Hathor brain. She is reached over /perceive; this surface never runs a model.
const AGENCY_URL = (process.env.HATHOR_AGENCY_URL || 'http://127.0.0.1:8175').replace(/\/+$/, '');

// ── injected fetch (offline-testable; never touches the network in tests) ──────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// ── injected auth predicate (default: deny / fail-closed) ──────────────────────────────────────
// handler() is auth-gated: it 401s unless the injected predicate approves the request. A deployment
// wires __setAuth to its real check (session / bearer). Predicate receives (req) → boolean.
let _auth = () => false;
export function __setAuth(fn) { _auth = typeof fn === 'function' ? fn : (() => false); }

// ── esc(): escape ALL interpolation into HTML ──────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Relay one utterance to THE one Hathor and speak back her reply. NEVER throws.
 * POSTs to {HATHOR_AGENCY_URL}/perceive with the real /perceive field names {surface, from, text}.
 *
 * @param {string} text                  what the person said
 * @param {object} [opts]
 * @param {string} [opts.user]           the person id → sent as `from` (Crypt-ology thread key)
 * @param {string} [opts.surface='soapy'] which limb this is
 * @param {number} [opts.now]            optional clock override, passed through
 * @param {string} [opts.agencyUrl]      override the brain base URL (default env HATHOR_AGENCY_URL)
 * @param {number} [opts.timeout]        request timeout ms (default 15000)
 * @returns {Promise<{ ok:true, reply:string } | { ok:false, reason:string }>}
 */
export async function ask(text, opts = {}) {
  const { user, surface = 'soapy', now, agencyUrl, timeout } = opts;
  const base = (agencyUrl || AGENCY_URL).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Number(timeout) || 15000);
  try {
    const body = { surface, from: user, text: String(text == null ? '' : text) };
    if (now != null) body.now = now;
    let r;
    try {
      r = await _fetch(`${base}/perceive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!r || !r.ok) return { ok: false, reason: `perceive ${r ? r.status : 'no-response'}` };
    const data = await r.json();
    if (!data || data.ok === false) return { ok: false, reason: 'brain soft-fail' };
    return { ok: true, reply: String(data.reply == null ? '' : data.reply) };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, reason: (e && e.message) ? e.message : 'ask failed' };
  }
}

// ── HTML: a minimal chat panel (input + message list; posts to /chat/send via fetch) ───────────
export function renderChat() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc('Hathor — Soapy.Blog')}</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; color: #1a1a1a; background: #faf9f7; }
  .badge { position: fixed; top: 8px; left: 8px; font-size: .7rem; background: #eee; padding: 2px 6px; border-radius: 4px; }
  .wrap { max-width: 640px; margin: 2.4rem auto; padding: 0 1rem; }
  h1 { font-size: 1.15rem; }
  #log { list-style: none; padding: 0; margin: 0 0 1rem; min-height: 40vh; }
  #log li { padding: .5rem .7rem; margin: .35rem 0; border-radius: 8px; max-width: 85%; }
  #log li.me { background: #dfeafe; margin-left: auto; }
  #log li.hathor { background: #fff; border: 1px solid #e6e2da; }
  #log li.err { background: #fde8e8; color: #7a1a1a; }
  form { display: flex; gap: .5rem; }
  input { flex: 1; padding: .6rem .8rem; border: 1px solid #cbc7bf; border-radius: 8px; font: inherit; }
  button { padding: .6rem 1rem; border: 0; border-radius: 8px; background: #1a1a1a; color: #fff; font: inherit; cursor: pointer; }
</style></head>
<body>
<span class="badge">Alpha</span>
<div class="wrap">
  <h1>Hathor</h1>
  <ul id="log"></ul>
  <form id="f">
    <input id="t" autocomplete="off" placeholder="Speak with Hathor…" aria-label="message">
    <button type="submit">Send</button>
  </form>
</div>
<script>
(function () {
  var log = document.getElementById('log'), f = document.getElementById('f'), t = document.getElementById('t');
  function add(cls, text) {
    var li = document.createElement('li');
    li.className = cls; li.textContent = text; log.appendChild(li);
    li.scrollIntoView({ block: 'end' });
  }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = t.value.trim(); if (!text) return;
    add('me', text); t.value = '';
    fetch('/chat/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) add('hathor', d.reply || '…');
      else add('err', 'Hathor is quiet just now.');
    }).catch(function () { add('err', 'Hathor is quiet just now.'); });
  });
})();
</script>
</body></html>`;
}

/**
 * Read the JSON body of a request. Accepts req.body already parsed (object) for tests; otherwise
 * drains the stream and JSON-parses. NEVER throws — soft-fails to {}.
 */
function readJsonBody(req) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = '';
    try {
      req.on('data', (c) => (d += c));
      req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}

/**
 * HTTP handler (Node http style). Auth-gated via injected predicate: 401 unless _auth(req) is true.
 *   GET  /chat       → the minimal chat panel (HTML).
 *   POST /chat/send  → JSON { text, user } → relays via ask() → { ok, reply } JSON.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} [opts]  { surface, agencyUrl, timeout } passed through to ask().
 */
export async function handler(req, res, opts = {}) {
  const sendText = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    if (!_auth(req)) return sendText(401, 'text/plain; charset=utf-8', 'unauthorized');

    const path = (req.url || '/').split('?')[0];
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET' && (path === '/chat' || path === '/' || path === '/index.html')) {
      return sendText(200, 'text/html; charset=utf-8', renderChat());
    }
    if (method === 'POST' && path === '/chat/send') {
      const b = await readJsonBody(req);
      const r = await ask(b.text, {
        user: b.user,
        surface: opts.surface || 'soapy',
        agencyUrl: opts.agencyUrl,
        timeout: opts.timeout,
      });
      return sendJson(200, r.ok ? { ok: true, reply: r.reply } : { ok: false, reply: '' });
    }
    return sendText(404, 'text/plain; charset=utf-8', 'not found');
  } catch {
    try { return sendJson(200, { ok: false, reply: '' }); } catch { /* noop */ }
  }
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return process.argv[1] === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) {
  // NOTE: default auth denies; a real deployment must __setAuth() before serving.
  http.createServer((req, res) => {
    handler(req, res).catch(() => { try { res.writeHead(500); res.end('chat unavailable'); } catch { /* noop */ } });
  }).listen(PORT, HOST, () => console.log(`soapy-hathor-chat on http://${HOST}:${PORT}/chat → Hathor at ${AGENCY_URL}/perceive (auth-gated; __setAuth required)`));
}
