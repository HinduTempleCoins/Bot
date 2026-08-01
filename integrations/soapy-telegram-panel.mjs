// soapy-telegram-panel.mjs — the WEB replacement for the Telegram "Soapy" remote-work surface.
//
// The Telegram bot (./telegram-bot.mjs) let the operator (and the public) drive Hathor's deterministic
// bot-local commands from a phone: the public set (/start, /help, /about) and the elevated operator set
// (/status, /diagnostics, /whoami). This module migrates THOSE SAME capabilities onto Soapy.Blog: a
// small auth-gated web panel that lists each command as a button and runs the *identical* underlying
// handler. Same capabilities, on the web instead of Telegram — no Telegram transport, no polling.
//
// The command list is NOT invented here. It is DERIVED from the real handler tables exported by
// ./telegram-bot.mjs (publicCommands + operatorCommands), and runCommand() calls those very handlers,
// so the bridge and the Telegram bot can never drift apart.
//
//   import { COMMANDS, runCommand, handler } from './integrations/soapy-telegram-panel.mjs';
//   const cmds = COMMANDS;                          // [{ id, label, describe }]
//   const r = await runCommand('/status', {}, {});  // { ok, text }
//
// CLI:  node integrations/soapy-telegram-panel.mjs           (prints COMMANDS — labels only)
//       node integrations/soapy-telegram-panel.mjs --serve   (serves GET /soapy; auth-gated)
//
// SECURITY: the whole surface is auth-gated (fail-closed) — the operator commands are elevated, and the
// panel 401s unless the injected predicate approves. The underlying handlers never print secrets (token
// status is a boolean-ish word). soft-fail-never-throw throughout; esc() on ALL interpolation.

import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { publicCommands, operatorCommands } from './telegram-bot.mjs';

const PORT = Number(process.env.PORT || 8151);
const HOST = process.env.HOST || '127.0.0.1';

// ── injected auth predicate (default: deny) ────────────────────────────────────────────────────
// handler() is auth-gated: the panel exposes the elevated operator surface, so it 401s unless the
// injected predicate approves. Default denies (fail-closed); a deployment wires __setAuth to its real
// check (bearer token / session). The predicate receives (req) and returns boolean.
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

// ── one-line human descriptions for each migrated command ──────────────────────────────────────
// Descriptions only; the command SET and its handlers come from telegram-bot.mjs (single source).
const DESCRIBE = {
  '/start': 'Hathor’s welcome / intro message.',
  '/help': 'What you can ask, and the available commands.',
  '/about': 'About MELEK and Hathor the witness.',
  '/status': 'Operator: bot status + token presence (no secrets).',
  '/diagnostics': 'Operator: platform / lock / transport / token state.',
  '/whoami': 'Operator: confirm the elevated surface.',
};

/** Title-case-ish label from a command id, e.g. "/status" → "Status". */
function labelFor(id) {
  const base = String(id || '').replace(/^\//, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : id;
}

// ── COMMANDS — derived from the REAL Telegram handler tables ────────────────────────────────────
// Public first, then the elevated operator set. `tier` is retained so the panel can mark the elevated
// ones; `describe` is a one-liner. This array is the single list rendered as buttons on Soapy.Blog.
function buildCommands() {
  const rows = [];
  try {
    for (const id of Object.keys(publicCommands || {})) {
      rows.push({ id, label: labelFor(id), describe: DESCRIBE[id] || '', tier: 'public' });
    }
    for (const id of Object.keys(operatorCommands || {})) {
      rows.push({ id, label: labelFor(id), describe: DESCRIBE[id] || '', tier: 'operator' });
    }
  } catch { /* soft-fail to whatever we gathered */ }
  return rows;
}

/** The migrated commands, as `{ id, label, describe }` (plus a `tier` marker). */
export const COMMANDS = buildCommands();

/**
 * Run a migrated command by id. Executes the SAME handler the Telegram bot runs (publicCommands or
 * operatorCommands), so the capability is identical. NEVER throws.
 *
 * @param {string} id        the command id, e.g. '/status'
 * @param {object} [args]    reserved for parity with the Telegram surface (current handlers take none)
 * @param {object} [opts]
 * @param {() => number} [opts.now]  clock forwarded to the handler (operator commands stamp a time)
 * @returns {Promise<{ ok:true, text:string } | { ok:false, reason:string }>}
 */
export async function runCommand(id, args = {}, opts = {}) {
  try {
    const handlerFn =
      (operatorCommands && Object.prototype.hasOwnProperty.call(operatorCommands, id) && operatorCommands[id]) ||
      (publicCommands && Object.prototype.hasOwnProperty.call(publicCommands, id) && publicCommands[id]) ||
      null;
    if (typeof handlerFn !== 'function') return { ok: false, reason: 'unknown command' };

    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const text = String(handlerFn({ now, args }) || '');
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'command failed' };
  }
}

// ── HTML rendering ─────────────────────────────────────────────────────────────────────────────
function renderButton(c) {
  const tier = c.tier === 'operator' ? '<span class="tier op">operator</span>' : '<span class="tier">public</span>';
  return `<li>
    <button class="cmd" data-id="${esc(c.id)}">${esc(c.label)} <code>${esc(c.id)}</code></button>
    ${tier}
    <span class="desc">${esc(c.describe)}</span>
  </li>`;
}

/** Render the full Soapy panel HTML. All interpolation is esc()'d. */
export function renderPanel(commands) {
  const items = (commands || []).map(renderButton).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Soapy.Blog — Soapy Remote (Telegram → Web)</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  ul { list-style: none; padding: 0; max-width: 760px; }
  li { padding: .5rem .2rem; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  button.cmd { font: inherit; cursor: pointer; padding: .35rem .7rem; border: 1px solid #ccc; border-radius: 6px; background: #fafafa; }
  code { background: #f2f2f2; padding: 0 .3em; border-radius: 3px; font-size: .85em; }
  .tier { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  .tier.op { color: #b06a00; }
  .desc { color: #555; font-size: .9em; flex: 1 1 100%; }
  #out { white-space: pre-wrap; background: #f7f7f7; border: 1px solid #e2e2e2; border-radius: 6px; padding: .8rem; margin-top: 1rem; max-width: 760px; min-height: 2rem; }
  .badge { position: absolute; top: 8px; left: 8px; font-size: .7rem; background: #eee; padding: 2px 6px; border-radius: 4px; }
</style></head>
<body>
<span class="badge">Alpha</span>
<h1>Soapy Remote</h1>
<p>The Telegram "Soapy" remote-work commands, now on Soapy.Blog. Same capabilities, on the web.</p>
<ul>
${items}
</ul>
<div id="out">Pick a command…</div>
<script>
  const out = document.getElementById('out');
  for (const b of document.querySelectorAll('button.cmd')) {
    b.addEventListener('click', async () => {
      out.textContent = 'Running ' + b.dataset.id + '…';
      try {
        const r = await fetch('/soapy/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: b.dataset.id, args: {} }),
        });
        const j = await r.json();
        out.textContent = j.ok ? j.text : ('unavailable: ' + (j.reason || 'error'));
      } catch (e) { out.textContent = 'request failed'; }
    });
  }
</script>
</body></html>`;
}

/**
 * Read the JSON body of a request. Accepts req.body already parsed (object) for tests; otherwise drains
 * the stream and JSON-parses. NEVER throws — soft-fails to {}.
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
 * HTTP handler (Node http style). Auth-gated via the injected predicate: 401 unless _auth(req) is true.
 *   GET  /soapy      → the command panel (HTML), each command a button.
 *   POST /soapy/run  → JSON { id, args } → runCommand → { ok, text } (or { ok:false, reason }).
 *
 * @param {object} req
 * @param {object} res
 * @param {object} [opts]  { now } forwarded to runCommand.
 */
export async function handler(req, res, opts = {}) {
  const sendText = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  try {
    if (!_auth(req)) return sendText(401, 'text/plain; charset=utf-8', 'unauthorized');

    const path = (req.url || '/').split('?')[0];
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'GET' && (path === '/soapy' || path === '/' || path === '/index.html')) {
      return sendText(200, 'text/html; charset=utf-8', renderPanel(COMMANDS));
    }
    if (method === 'POST' && path === '/soapy/run') {
      const b = await readJsonBody(req);
      const r = await runCommand(b.id, b.args || {}, { now: opts.now });
      return sendJson(200, r);
    }
    return sendText(404, 'text/plain; charset=utf-8', 'not found');
  } catch {
    try { return sendJson(200, { ok: false, reason: 'bridge unavailable' }); } catch { /* noop */ }
  }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return process.argv[1] === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--serve')) {
    // NOTE: default auth denies; a real deployment must __setAuth() before serving.
    http.createServer((req, res) => {
      handler(req, res).catch(() => { try { res.writeHead(500); res.end('bridge unavailable'); } catch { /* noop */ } });
    }).listen(PORT, HOST, () => console.log(`soapy-telegram-panel on http://${HOST}:${PORT}/soapy (auth-gated; __setAuth required)`));
  } else {
    console.log(COMMANDS.map((c) => `${c.id}  ${c.label} — ${c.describe}`).join('\n'));
  }
}
