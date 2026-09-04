// server.mjs — Private Mail mailbox PAGE. A read-only inbox/outbox view over the pure envelope
// layer in integrations/private-mail-envelope.mjs (inbox()/outbox()/threadOf() shapes). It renders
// ONE account's mailbox as HTML in the SoapBox house style.
//
//   PORT=8302 BASE_URL=https://mail.melek.salon ACCOUNT=hathor node site/mail/server.mjs
//
// ── Routes ────────────────────────────────────────────────────────────────────────────────────
//   /        the mailbox (inbox + outbox), for the configured/queried account
//   /health  liveness probe
//
// ── KEY CUSTODY (BRIEF.md §7, ZERO-WIF — HARD RULE) ─────────────────────────────────────────────
//   This page holds NO keys and does NO crypto. Subjects/bodies are shown ONLY as already-decrypted
//   by an INJECTED reader (__setReader): the reader is expected to run where the memo key actually
//   lives (the user's own browser/condenser side) and hand this page plaintext it may render. The
//   reader returns the routing messages and their (already-opened) subject/body; this server never
//   sees a sealed envelope's key, never decrypts, never broadcasts, never touches the network.
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value (subjects, bodies, account names, ids, timestamps).
//   Soft-fail-never-throw: a missing/throwing reader renders an empty mailbox, never a 500 stack.
//   renderMailbox() is PURE — same inputs, same HTML; no I/O, no globals.

import { createServer } from 'node:http';

import { inbox as envInbox, outbox as envOutbox } from '../../integrations/private-mail-envelope.mjs';

const PORT = +(process.env.PORT || 8302);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DEFAULT_ACCOUNT = process.env.ACCOUNT || 'hathor';
const SITE_NAME = 'MELEK Private Mail';

// ── esc(): escape ALL HTML interpolation. Never throws. ─────────────────────────────────────────
export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );

// ── injected reader seam ────────────────────────────────────────────────────────────────────────
// A reader returns { inbox:[...], outbox:[...] } for an account, where each message already carries
// a (decrypted) subject/body — decryption happened wherever the key lives, NOT here. The default
// reader is empty (no network, no keys), so the page renders an empty mailbox out of the box.
let _reader = async (_account) => ({ inbox: [], outbox: [] });

/** Inject the message reader. Pass a function (account) -> { inbox, outbox } | Promise<...>. */
export function __setReader(fn) {
  _reader = typeof fn === 'function' ? fn : async () => ({ inbox: [], outbox: [] });
}

// fetch seam kept for parity with the house style (this page makes no network calls itself).
let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) {
  _fetch = typeof fn === 'function' ? fn : _fetch;
}

// ── reader call (soft) ──────────────────────────────────────────────────────────────────────────
// Returns normalised { inbox, outbox } arrays. Re-runs the pure envelope filters so the view is
// correct even if a reader hands back an unsorted/over-broad flat list. Never throws.
async function loadMailbox(account) {
  const acct = String(account ?? '').trim().toLowerCase();
  let raw;
  try {
    raw = await _reader(acct);
  } catch {
    raw = null;
  }
  raw = raw && typeof raw === 'object' ? raw : {};

  const inList = Array.isArray(raw.inbox) ? raw.inbox : [];
  const outList = Array.isArray(raw.outbox) ? raw.outbox : [];

  // If the reader handed a single flat `messages` list, split it deterministically.
  const flat = Array.isArray(raw.messages) ? raw.messages : null;
  const inbox = flat ? envInbox(acct, flat) : envInbox(acct, inList).length ? envInbox(acct, inList) : inList;
  const outbox = flat ? envOutbox(acct, flat) : envOutbox(acct, outList).length ? envOutbox(acct, outList) : outList;

  return {
    account: acct,
    inbox: Array.isArray(inbox) ? inbox.filter((m) => m && typeof m === 'object') : [],
    outbox: Array.isArray(outbox) ? outbox.filter((m) => m && typeof m === 'object') : [],
  };
}

// ── view helpers ──────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .wrap{max-width:860px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:24px} h2{font-size:16px;margin:18px 0 8px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin:10px 0}
  .msg{border-bottom:1px solid var(--line);padding:10px 0} .msg:last-child{border-bottom:0}
  .msg .meta{color:var(--mut);font-size:13px} .msg .subj{font-weight:700} .msg .body{white-space:pre-wrap;margin-top:4px}
  .empty{color:var(--mut);font-style:italic;padding:8px 0}
</style>`;

function renderMsg(m) {
  const o = m && typeof m === 'object' ? m : {};
  const subject = String(o.subject ?? '').length ? esc(o.subject) : '<span class="muted">(no subject)</span>';
  const body = String(o.body ?? '').length ? esc(o.body) : '<span class="muted">(empty)</span>';
  return (
    `<div class="msg">` +
    `<div class="meta">from <b>${esc(o.from)}</b> to <b>${esc(o.to)}</b> · ${esc(o.ts)} · ` +
    `<span class="muted">${esc(o.id)}</span></div>` +
    `<div class="subj">${subject}</div>` +
    `<div class="body">${body}</div>` +
    `</div>`
  );
}

function renderBox(title, msgs) {
  const list = Array.isArray(msgs) ? msgs : [];
  const inner = list.length ? list.map(renderMsg).join('') : `<div class="empty">No messages.</div>`;
  return `<h2>${esc(title)} <span class="muted">(${list.length})</span></h2><div class="card">${inner}</div>`;
}

/**
 * PURE renderer. Builds the full mailbox HTML from already-decrypted data. No I/O, no globals,
 * never throws. Subjects/bodies are esc()'d — the page never holds keys or decrypts.
 * @param {object} m { account, inbox:[...], outbox:[...] }
 */
export function renderMailbox({ account, inbox, outbox } = {}) {
  const acct = esc(account);
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${esc(SITE_NAME)} — ${acct || 'mailbox'}</title>${STYLE}</head><body>` +
    `<header class="topbar"><span class="brand">${esc(SITE_NAME)} <span>private, off-chain-testable</span></span></header>` +
    `<div class="wrap">` +
    `<h1>Mailbox: ${acct || '<span class="muted">(no account)</span>'}</h1>` +
    `<p class="muted">Subjects and bodies are shown as already decrypted by your own reader. ` +
    `This page holds no keys and decrypts nothing.</p>` +
    renderBox('Inbox', inbox) +
    renderBox('Outbox', outbox) +
    `</div></body></html>`
  );
}

// ── HTTP handler (exported for tests) ───────────────────────────────────────────────────────────
export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', BASE_URL);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'mail', ts: new Date().toISOString() }));
      return;
    }
    if (url.pathname === '/' || url.pathname === '') {
      const account = (url.searchParams.get('account') || DEFAULT_ACCOUNT || '').trim();
      const box = await loadMailbox(account);
      const html = renderMailbox(box);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderMailbox({ account: '', inbox: [], outbox: [] }));
  } catch (e) {
    // soft-fail-never-throw: still emit a valid, empty page.
    try {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderMailbox({ account: '', inbox: [], outbox: [] }));
    } catch {
      /* response already gone — swallow */
    }
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on http://${HOST}:${PORT} (account=${DEFAULT_ACCOUNT})`);
  });
}
