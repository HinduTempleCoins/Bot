// site/soapy/server.mjs — "Soapy": opening it is resuming the conversation, not starting one.
//
// The operator's shape (2026-09-18): "if I were to ever Talk to it, it would be like Opening a
// CodeSpace Called 'Soapy' on our own System, that is like Resuming a Claude Conversation."
//
// So this is a CONSOLE over an existing mind, not a chat app with history bolted on. The transcript
// it shows IS her memory — the `soapy` compartment that hathor-agency already writes on every turn
// (memory/file-store.mjs: one JSONL record per line under HATHOR_BRAIN_DIR). Nothing is duplicated
// here: open it and you see what she remembers; type and she remembers more. Close the tab, come back
// in a month, the thread is still there, because the thread was never in the tab.
//
// A THIN LIMB, like every other surface. It implements no AI: it POSTs to the ONE Hathor's /perceive
// (integrations/hathor-agency-server.mjs) and renders her reply. One brain, many windows.
//
// House style: ESM, injectable fetch + reader (offline-testable), soft-fail-never-throw, esc() ALL
// interpolation, handler(req,res) exported for tests, CLI guarded by process.argv[1], PORT env.
// Auth is fail-closed: the handler 401s until a deployment injects a real check.

import http from 'node:http';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8179);
const HOST = process.env.HOST || '127.0.0.1';
const BRAIN_DIR = process.env.HATHOR_BRAIN_DIR || '/opt/melek-bot/data/hathor-brain';
const AGENCY_URL = (process.env.HATHOR_AGENCY_URL || 'http://127.0.0.1:8175').replace(/\/+$/, '');
const SURFACE = process.env.SOAPY_SURFACE || 'soapy';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

let _readFile = (p) => fsp.readFile(p, 'utf8');
export function __setReader(fn) { _readFile = typeof fn === 'function' ? fn : ((p) => fsp.readFile(p, 'utf8')); }

// Fail-closed: a deployment wires its real session/bearer check. Default denies.
let _auth = () => false;
export function __setAuth(fn) { _auth = typeof fn === 'function' ? fn : (() => false); }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Read her memory of this surface back as an ordered conversation.
 *
 * The store writes `"<person>: <text>"` for inbound and `"Hathor: <reply>"` for her own, tagging
 * meta.role 'them'/'self' (integrations/hathor-agency.mjs). We prefer the tag and fall back to the
 * prefix, so an older or hand-written record still renders correctly.
 *
 * @param {object} opts { dir?, surface?, limit? }
 * @returns {Promise<Array<{who:string, text:string, at:number, self:boolean}>>}
 */
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
    try { r = JSON.parse(t); } catch { continue; }      // a torn final line must not break the view
    const text = String((r && r.text) || '').trim();
    if (!text) continue;
    const role = (r && r.meta && r.meta.role) || '';
    const self = role ? role === 'self' : /^hathor:/i.test(text);
    const body = text.replace(/^[^:]{1,40}:\s*/, '');
    out.push({
      who: self ? 'Hathor' : String((r && r.person) || 'you'),
      text: body || text,
      at: Number((r && (r.at ?? r.ts)) || 0),
      self,
    });
  }
  return out.slice(-limit);
}

/** Relay one message to the ONE Hathor. Soft-fails to a plain, honest string — never throws. */
export async function send(text, opts = {}) {
  const body = {
    surface: opts.surface || SURFACE,
    from: opts.from || 'operator',
    text: String(text || ''),
  };
  try {
    const res = await _fetch(`${opts.agencyUrl || AGENCY_URL}/perceive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res || !res.ok) return { ok: false, reply: '', error: `http-${res && res.status}` };
    const j = await res.json();
    return { ok: true, reply: String((j && j.reply) || ''), drewFrom: (j && j.drewFrom) || [] };
  } catch (e) {
    return { ok: false, reply: '', error: String((e && e.message) || e) };
  }
}

function page(turns) {
  const rows = turns.map((t) => `
    <div class="t ${t.self ? 'self' : 'them'}">
      <div class="who">${esc(t.who)}</div>
      <div class="body">${esc(t.text)}</div>
    </div>`).join('');
  const resumed = turns.length
    ? `Resumed — ${esc(String(turns.length))} turn(s) of memory.`
    : 'No memory on this surface yet. Say something and she will remember it.';
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Soapy</title>
<style>
 :root{color-scheme:dark;--bg:#0b0d10;--fg:#e8e6e1;--dim:#8b8f96;--self:#1b2430;--them:#15181d;--line:#232830}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-serif,Georgia,serif;
      padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
 header{max-width:760px;margin:0 auto 18px;border-bottom:1px solid var(--line);padding-bottom:12px}
 h1{font-size:19px;margin:0 0 4px;letter-spacing:.02em}
 .sub{color:var(--dim);font-size:13px}
 main{max-width:760px;margin:0 auto}
 .t{padding:12px 14px;border-radius:10px;margin:0 0 10px;background:var(--them);border:1px solid var(--line)}
 .t.self{background:var(--self)}
 .who{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin-bottom:5px}
 .body{white-space:pre-wrap;word-wrap:break-word}
 form{max-width:760px;margin:18px auto 0;display:flex;gap:8px;flex-wrap:wrap}
 textarea{flex:1 1 320px;min-height:74px;background:#11141a;color:var(--fg);border:1px solid var(--line);
          border-radius:10px;padding:11px;font:inherit;resize:vertical}
 button{background:#2a3546;color:var(--fg);border:1px solid var(--line);border-radius:10px;
        padding:11px 20px;font:inherit;cursor:pointer}
 button:hover{background:#34425a}
</style>
<header>
  <h1>Soapy</h1>
  <div class="sub">${resumed}</div>
</header>
<main>${rows || ''}</main>
<form method="POST" action="/send">
  <textarea name="text" placeholder="Say something to Hathor…" autofocus></textarea>
  <button type="submit">Send</button>
</form>`;
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) d = d.slice(0, 1e6); });
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
}

export function createServer(cfg = {}) {
  const html = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  async function handler(req, res) {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, surface: SURFACE });

      if (!_auth(req)) return json(res, 401, { ok: false, error: 'unauthorized' });

      if (url.pathname === '/' && (req.method || 'GET') === 'GET') {
        const turns = await loadTranscript(cfg);
        return html(res, 200, page(turns));
      }
      if (url.pathname === '/transcript.json') {
        return json(res, 200, { ok: true, turns: await loadTranscript(cfg) });
      }
      if (url.pathname === '/send' && req.method === 'POST') {
        const raw = await readBody(req);
        let text = '';
        try {
          text = raw.trim().startsWith('{')
            ? String(JSON.parse(raw).text || '')
            : String(new URLSearchParams(raw).get('text') || '');
        } catch { text = ''; }
        if (!text.trim()) {
          const turns = await loadTranscript(cfg);
          return html(res, 200, page(turns));
        }
        const r = await send(text, cfg);
        if (url.searchParams.get('format') === 'json' || /application\/json/.test(req.headers.accept || '')) {
          return json(res, 200, r);
        }
        const turns = await loadTranscript(cfg);          // re-read: her memory is the source of truth
        return html(res, 200, page(turns));
      }
      return json(res, 404, { ok: false, error: 'not found' });
    } catch {
      return json(res, 200, { ok: false, error: 'soft' });   // never throw at the surface
    }
  }
  return { handler };
}

export const handler = (req, res) => createServer().handler(req, res);

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  http.createServer(handler).listen(PORT, HOST, () => console.log(`[soapy] ${HOST}:${PORT}`));
}
