// server.mjs — site/moderation: the admin FLAG REVIEW page over integrations/flag-pipe.mjs.
//
// WHY THIS EXISTS
//   flag-pipe.mjs is the ONE append-only moderation spine: every traditional social-media harm
//   (plagiarism, spam, scam, harassment, impersonation, misinformation, doxxing, csam, sybil, image-theft)
//   lands in ONE queue with ONE review path. This page is the human/Hathor face of that queue: it lists
//   pending flags ranked most-severe-first and offers a resolve form per flag (action select → POST /resolve).
//
//   POLICY (flag-pipe header / cheetah/policing.md — load-bearing):
//     • A flag is NOT a delete/ban button — it's "this may need attention". Resolution records a reason + by.
//     • CSAM is GATED: this page NEVER renders imagery or evidence for a gated flag — only the gated MARKER
//       and the "escalate to counsel/NCMEC off-pipe" note. flag-pipe already redacts gated evidence; we
//       additionally suppress the evidence cell entirely for gated rows so no bytes can ever surface here.
//
// SEAMS / SAFETY (house style)
//   • Detection-agnostic + read-mostly: the page reads reviewQueue()/summary() through the INJECTED
//     flag-pipe module (__setFlagPipe(mod)) so tests run fully OFFLINE with a fake queue + fake resolve.
//   • Soft-fail-never-throw: any read/parse/resolve failure renders a graceful state, never crashes.
//   • esc() ALL HTML interpolation. renderReview({queue, summary}) is a PURE view.
//   • handler(req,res) exported for tests; CLI guarded by process.argv[1]. Zero keys, zero chain, zero network.
//
//   PORT=8131 BASE_URL=https://admin.melek.salon node site/moderation/server.mjs
//
// Shapes (from flag-pipe.mjs):
//   queue row  = { id, target, kind, severity, reason, reporter, evidence, gated, status, filedAt }
//   summary    = { byKind:{kind:n}, byStatus:{status:n}, total, gatedPending }

import { createServer } from 'node:http';

const PORT = +(process.env.PORT || 8131);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// ── esc(): HTML-escape EVERY interpolation (house rule) ──────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── injectable flag-pipe seam (the ONLY data source; page does no detection) ─────
// Default reaches for the real module lazily; tests inject a fake with the same surface.
let _flagPipe = null;
async function flagPipe() {
  if (_flagPipe) return _flagPipe;
  try { _flagPipe = await import('../../integrations/flag-pipe.mjs'); } catch { _flagPipe = null; }
  return _flagPipe;
}
/** Inject the flag-pipe module (must expose reviewQueue, summary, resolve, optionally RESOLVE_ACTIONS). */
export function __setFlagPipe(mod) { _flagPipe = mod || null; return _flagPipe; }
export function __resetFlagPipe() { _flagPipe = null; }

// soft-fail wrappers around the injected module — never throw out of a handler.
async function safeQueue() {
  try { const m = await flagPipe(); const q = m && m.reviewQueue ? m.reviewQueue({ status: 'pending' }) : []; return Array.isArray(q) ? q : []; }
  catch { return []; }
}
async function safeSummary() {
  try { const m = await flagPipe(); const s = m && m.summary ? m.summary() : null; return s && typeof s === 'object' ? s : { byKind: {}, byStatus: {}, total: 0, gatedPending: 0 }; }
  catch { return { byKind: {}, byStatus: {}, total: 0, gatedPending: 0 }; }
}
async function safeResolve(id, fields) {
  try { const m = await flagPipe(); if (!m || !m.resolve) return null; return m.resolve(id, fields) || null; }
  catch { return null; }
}
async function resolveActions() {
  try { const m = await flagPipe(); const a = m && m.RESOLVE_ACTIONS; return Array.isArray(a) && a.length ? a : DEFAULT_ACTIONS; }
  catch { return DEFAULT_ACTIONS; }
}
// Fallback when the module doesn't export RESOLVE_ACTIONS (keeps the form usable offline).
const DEFAULT_ACTIONS = ['reviewed', 'dismissed', 'actioned', 'escalated'];

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--red:#f85149;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .wrap{max-width:980px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:24px} h2{font-size:17px;margin:18px 0 8px} .muted{color:var(--mut)}
  .stats{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 4px}
  .stat{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;padding:9px 13px;min-width:78px}
  .stat .v{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums} .stat .k{color:var(--mut);font-size:12px}
  .stat.alert .v{color:var(--red)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:14px 16px;margin:14px 0}
  .card.gated{border-color:#f8514955}
  .flag-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px}
  .flag-h .kind{font-weight:800;text-transform:uppercase;letter-spacing:.03em}
  .sev{font-size:12px;font-weight:700;padding:2px 9px;border-radius:20px;border:1px solid var(--line2);color:var(--mut);font-variant-numeric:tabular-nums}
  .sev.s5{color:var(--red);border-color:#f8514966} .sev.s4{color:var(--gold);border-color:#d2992266}
  .sev.s3{color:var(--blue);border-color:#58a6ff44}
  .gatedmark{font-size:12px;font-weight:700;padding:2px 9px;border-radius:6px;background:#2d1416;border:1px solid #f8514966;color:var(--red)}
  .meta{color:var(--mut);font-size:13px;display:flex;gap:14px;flex-wrap:wrap;margin:2px 0 8px}
  .meta code{color:var(--fg)}
  .reason{margin:4px 0 10px} .reason .lbl{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .ev{background:#0b0f14;border:1px solid var(--line);border-radius:6px;padding:8px 10px;font-size:13px;color:var(--mut);white-space:pre-wrap;word-break:break-word}
  form.resolve{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px;border-top:1px solid var(--line);padding-top:10px}
  select,input[type=text]{background:#0b0f14;color:var(--fg);border:1px solid var(--line2);border-radius:7px;padding:7px 9px;font:inherit}
  input[type=text]{min-width:200px;flex:1}
  button{background:var(--blue);color:#06101f;font-weight:700;border:0;border-radius:7px;padding:8px 16px;font:inherit;cursor:pointer}
  button:hover{opacity:.92}
  .empty{color:var(--mut);font-size:14px;padding:14px 0}
  .banner{border-radius:8px;padding:10px 14px;margin:12px 0;font-size:14px}
  .banner.ok{background:#0d2417;border:1px solid #3fb95055;color:var(--up)}
  .banner.bad{background:#2d1416;border:1px solid #f8514955;color:var(--red)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px;margin-top:20px}
</style>`;

const pageShell = (title, body) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=robots content="noindex,nofollow">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">◈ MELEK <span>moderation · flag review</span></a></header>
<main class=wrap>${body}</main>
<footer>MELEK moderation — flags are "this may need attention", not auto-actions. CSAM is gated: flag-only, escalated to counsel/NCMEC off-pipe.</footer></body></html>`;

const sevClass = (n) => { const x = Math.round(Number(n)); return `s${Number.isFinite(x) ? Math.min(5, Math.max(1, x)) : 3}`; };

// ── one flag card (with its resolve form) ────────────────────────────────────────
function flagCard(f, actions) {
  const gated = !!f.gated;
  const id = f.id || '';
  const kind = f.kind || 'unknown';
  const metas = [];
  if (f.target) metas.push(`<span>target <code>${esc(f.target)}</code></span>`);
  if (f.reporter) metas.push(`<span>reporter <code>${esc(f.reporter)}</code></span>`);
  if (f.filedAt) metas.push(`<span>filed ${esc(String(f.filedAt).slice(0, 19).replace('T', ' '))}</span>`);
  if (id) metas.push(`<span>id <code>${esc(id)}</code></span>`);

  // GATED (csam): never render imagery/evidence — only the gated marker + escalate note.
  const evidenceBlock = gated
    ? `<div class=ev>GATED — no imagery shown here. Flag-only marker. Escalate to counsel / NCMEC CyberTipline off-pipe.</div>`
    : (f.evidence ? `<div class=ev>${esc(f.evidence)}</div>` : '');

  const opts = (Array.isArray(actions) ? actions : DEFAULT_ACTIONS)
    .map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

  return `<div class="card${gated ? ' gated' : ''}" data-id="${esc(id)}">
    <div class=flag-h>
      <span class=kind>${esc(kind)}</span>
      <span class="sev ${sevClass(f.severity)}">severity ${esc(f.severity)}</span>
      ${gated ? '<span class=gatedmark>GATED · CSAM</span>' : ''}
    </div>
    ${metas.length ? `<div class=meta>${metas.join('')}</div>` : ''}
    ${f.reason ? `<div class=reason><span class=lbl>reason</span><div>${esc(f.reason)}</div></div>` : ''}
    ${evidenceBlock}
    <form class=resolve method=post action="/resolve">
      <input type=hidden name=id value="${esc(id)}">
      <label class=muted>action
        <select name=action>${opts}</select>
      </label>
      <input type=text name=note placeholder="resolution note (recorded with your decision)">
      <button type=submit>Resolve</button>
    </form>
  </div>`;
}

// ── stat tiles ───────────────────────────────────────────────────────────────────
function statsBlock(summary) {
  const s = summary || {};
  const tile = (v, k, alert) => `<div class="stat${alert ? ' alert' : ''}"><div class=v>${esc(v)}</div><div class=k>${esc(k)}</div></div>`;
  const pending = (s.byStatus && s.byStatus.pending) || 0;
  return `<div class=stats>
    ${tile(s.total ?? 0, 'total flags')}
    ${tile(pending, 'pending')}
    ${tile(s.gatedPending ?? 0, 'gated pending', (s.gatedPending ?? 0) > 0)}
  </div>`;
}

// ── pure view: renderReview({queue, summary}) → full HTML page ──────────────────
export function renderReview({ queue = [], summary = null, actions = DEFAULT_ACTIONS, banner = null } = {}) {
  const rows = Array.isArray(queue) ? queue.slice() : [];
  // Defensive: rank most-severe first, then oldest-first (flag-pipe already does this, but the view is pure).
  rows.sort((a, b) => (Number(b.severity) - Number(a.severity)) || String(a.filedAt).localeCompare(String(b.filedAt)));
  const bannerHtml = banner
    ? `<div class="banner ${banner.ok ? 'ok' : 'bad'}">${esc(banner.msg || '')}</div>` : '';
  const list = rows.length
    ? rows.map((f) => flagCard(f, actions)).join('')
    : `<p class=empty>No pending flags. The queue is clear.</p>`;
  const body = `<h1>Flag review</h1>
    <p class=muted>Pending flags from the unified moderation pipe, ranked most-severe first. Resolving records your decision + a note — it does not delete or ban. CSAM is gated: marker only, escalated off-pipe.</p>
    ${bannerHtml}
    ${statsBlock(summary)}
    <h2>Pending queue (${rows.length})</h2>
    ${list}`;
  return pageShell('MELEK moderation — flag review', body);
}

// ── tiny urlencoded body reader (soft-fail; capped) ──────────────────────────────
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      req.on('data', (c) => { buf += c; if (buf.length > max) { buf = buf.slice(0, max); finish(buf); } });
      req.on('end', () => finish(buf));
      req.on('error', () => finish(buf));
    } catch { finish(''); }
  });
}
function parseForm(raw) {
  const out = {};
  try {
    for (const pair of String(raw || '').split('&')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      const k = decodeURIComponent((i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, ' '));
      const v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      if (k) out[k] = v;
    }
  } catch { /* soft-fail: return whatever parsed */ }
  return out;
}

function send(res, html, code = 200, extra = {}) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...extra });
  res.end(html);
}

export const handler = async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nDisallow: /\n');
    }

    // POST /resolve — apply a resolution, then redirect (PRG) back to the queue with a banner.
    if (url.pathname === '/resolve' && (req.method || 'GET').toUpperCase() === 'POST') {
      const form = parseForm(await readBody(req));
      const id = String(form.id || '').trim();
      const action = String(form.action || '').trim();
      let banner;
      if (!id) {
        banner = { ok: false, msg: 'No flag id supplied — nothing resolved.' };
      } else {
        const updated = await safeResolve(id, { action, by: 'admin', note: form.note || '' });
        banner = updated
          ? { ok: true, msg: `Flag ${id} resolved as "${updated.action || action}".` }
          : { ok: false, msg: `Could not resolve flag ${id} (unknown id or invalid action "${action}").` };
      }
      // Redirect-after-POST so a refresh doesn't re-submit; encode the banner in the query.
      const q = new URLSearchParams({ b: banner.ok ? '1' : '0', m: banner.msg }).toString();
      res.writeHead(303, { location: `/?${q}` });
      return res.end();
    }

    if (url.pathname !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }

    // GET / — render the queue. Pick up any banner from a prior PRG redirect.
    let banner = null;
    const bm = url.searchParams.get('m');
    if (bm != null) banner = { ok: url.searchParams.get('b') === '1', msg: bm };
    const [queue, summary, actions] = await Promise.all([safeQueue(), safeSummary(), resolveActions()]);
    return send(res, renderReview({ queue, summary, actions, banner }), 200, { 'cache-control': 'no-store' });
  } catch (e) {
    // soft-fail-never-throw: still serve a usable (empty) page
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(renderReview({}));
  }
};

// CLI guard: bind a socket only when run directly, not when imported by a unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK moderation review on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
