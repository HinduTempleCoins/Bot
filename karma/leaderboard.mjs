// leaderboard.mjs — the Karma leaderboard PAGE: the highest-standing accounts, linking to their profiles.
//
// Karma is a STANDING (a grade), not a coin (BRIEF §9) — this is the public scoreboard of it: who has lifted
// the most, ranked, each row linking to that account's profile. Display-only, read-only, no keys/votes/funds.
// It ranks from the off-chain karma store (karma/index.mjs rank()); until the compute job populates real
// scores it honestly shows an empty state rather than fabricating a board.
//
// House style: ESM, esc() all interpolation, handler(req,res,opts) export, injectable store, CLI guarded,
// soft-fail-never-throw. Profile link base is env-configurable (the condenser: melek.salon/@<account>).
//
//   import { leaderboardRows, leaderboardPage, handler } from './leaderboard.mjs'

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createKarma, makeJsonlStore } from './index.mjs';

const PORT = +(process.env.PORT || 8157);
const HOST = process.env.HOST || '127.0.0.1';
const PROFILE_BASE = (process.env.KARMA_PROFILE_BASE || 'https://melek.salon').replace(/\/+$/, '');
const KARMA_STORE = process.env.KARMA_STORE_FILE || 'karma/data/karma.jsonl';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const profileUrl = (account, base = PROFILE_BASE) => `${base}/@${encodeURIComponent(String(account || '').toLowerCase())}`;

/** The ranked rows: [{ rank, account, score }] from the karma store, top `limit` (default 100). */
export async function leaderboardRows(store, { limit = 100 } = {}) {
  try {
    const karma = createKarma({ store });
    const rows = await karma.rank(limit);
    return (rows || []).map((r, i) => ({ rank: i + 1, account: r.account, score: r.score }));
  } catch { return []; }
}

/** The leaderboard HTML page. rows from leaderboardRows(); honest empty state when none. */
export function leaderboardPage(rows = [], { profileBase = PROFILE_BASE, title = 'Karma — the highest standing' } = {}) {
  const body = rows.length
    ? `<ol class=board>${rows.map((r) => `<li><a class=acct href="${esc(profileUrl(r.account, profileBase))}">@${esc(r.account)}</a>`
        + `<span class=score>${esc(Math.round(Number(r.score) || 0))}</span></li>`).join('')}</ol>`
    : `<p class=empty>The board is empty for now — Karma is a standing you build by lifting others, and the
        first scores appear here as accounts start helping. No one has been graded yet.</p>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  :root{--bg:#0d1117;--panel:#131826;--line:#222a3a;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d4a23c}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
  .wrap{max-width:640px;margin:0 auto;padding:2rem 1rem}
  .badge{display:inline-block;font-size:.7rem;font-weight:700;color:#1a1304;background:var(--gold);border-radius:6px;padding:1px 6px}
  h1{font-size:1.8rem;margin:.3rem 0}.sub{color:var(--mut);margin:.2rem 0 1.4rem}
  ol.board{list-style:none;margin:0;padding:0;counter-reset:r}
  ol.board li{counter-increment:r;display:flex;align-items:center;gap:.6rem;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;margin:.4rem 0}
  ol.board li::before{content:counter(r);color:var(--gold);font-weight:800;min-width:2ch;text-align:right}
  .acct{color:var(--blue);text-decoration:none;font-weight:600;flex:1}.acct:hover{text-decoration:underline}
  .score{color:var(--mut);font-variant-numeric:tabular-nums}
  .empty{color:var(--mut);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1rem}
  a{color:var(--blue)}
</style></head><body><div class=wrap>
  <span class=badge>Alpha</span>
  <h1>◈ Karma — the highest standing</h1>
  <div class=sub>A standing you build by lifting others — not a coin. These are the accounts who've raised the
    most people the furthest. <a href="/api/leaderboard">JSON</a></div>
  ${body}
</div></body></html>`;
}

/** GET / (page) · GET /api/leaderboard (json) · GET /health. opts.store overrides the default JSONL store. */
export async function handler(req, res, opts = {}) {
  const store = opts.store || makeJsonlStore(KARMA_STORE);
  const html = (code, s) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' }); res.end(s); };
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=120' }); res.end(JSON.stringify(o)); };
  try {
    const url = new URL(req.url, 'http://karma.local');
    if (url.pathname === '/health') return json(200, { ok: true, service: 'karma-leaderboard' });
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const rows = await leaderboardRows(store, { limit });
    if (url.pathname === '/api/leaderboard') return json(200, { ok: true, count: rows.length, rows });
    if (url.pathname === '/' || url.pathname === '/index.html') return html(200, leaderboardPage(rows));
    return html(404, '<p>not found</p>');
  } catch { return html(500, '<p>error</p>'); }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => console.log(`karma leaderboard on http://${HOST}:${PORT}`));
}
