// server.mjs — Tutorial (read-only) — a self-contained page that renders the existing
// staged tutorial (the 19 lessons/stages from tutorial/stages.json, loaded via the
// tutorial/ composer's loadStagesDoc()). It is a READ-ONLY display surface: it lists each
// lesson stage with its title (label), tier, and summary (description) so a visitor can see
// the whole CryptoKannon-model onboarding arc (BRIEF.md §8) at a glance, before they ever
// touch the chain.
//
// This is a STANDALONE handler. It does NOT edit tutorial/ (it only reads its exports) and it
// does NOT wire itself into any shared site router — route-wiring into the live site server is
// a deliberate, separate follow-up (see the return note). The detector/composer/scheduler that
// actually run the tutorial against the chain live in tutorial/; this module only renders them.
//
//   PORT=8147 BASE_URL=https://tutorial.melek.salon node site/tutorial/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────
//   /            the read-only tutorial page — every lesson stage, in order, with tier + summary
//   /health      liveness probe
//
// ── DISCIPLINE ─────────────────────────────────────────────────────────────────────────────────
//   READ-ONLY. No chain reads, no LLM, no secrets, no writes. Pure render of tutorial data.
//   Injectable reader seam (__setReader) keeps tests offline. Soft-fail: every route renders even
//   if the tutorial data is unavailable — never throws. esc() on every interpolated value.

import { createServer } from 'node:http';

import { loadStagesDoc } from '../../tutorial/composers.mjs';

const PORT = +(process.env.PORT || 8147);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEK Tutorial';

// ── injectable reader seam (default = the tutorial/ composer's loader) ────────────────────────
// Tests inject a pure reader so they run offline and pin exact strings; production reads the
// committed tutorial/stages.json through tutorial/composers.mjs:loadStagesDoc().
let _reader = loadStagesDoc;
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : loadStagesDoc; }

// ── house-style helpers ───────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TIER_LABEL = {
  A: 'Works now',
  B: 'Placeholder — unlocks when the feature ships',
  C: 'Conversational arc — opens in Phase 3',
};

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .wrap{max-width:860px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} .muted{color:var(--mut)}
  ol.lessons{list-style:none;margin:18px 0 0;padding:0;counter-reset:lesson}
  li.lesson{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:14px 18px;margin:0 0 12px;display:flex;gap:14px;align-items:flex-start}
  li.lesson .num{flex:0 0 auto;width:34px;height:34px;border-radius:8px;background:#1f6feb22;color:var(--blue);font-weight:800;display:flex;align-items:center;justify-content:center}
  li.lesson .body{flex:1 1 auto;min-width:0}
  li.lesson .t{font-weight:700;font-size:16px;color:var(--fg)}
  li.lesson .d{color:var(--mut);font-size:13.5px;margin-top:3px}
  .tier{font-size:11px;border-radius:8px;padding:1px 8px;margin-left:8px;white-space:nowrap;border:1px solid var(--line2)}
  .tier.A{background:#3fb95022;color:var(--up);border-color:#3fb95055}
  .tier.B{background:#d2992222;color:var(--gold);border-color:#d2992255}
  .tier.C{background:#1f6feb22;color:var(--blue);border-color:#1f6feb55}
  .empty{color:var(--mut);padding:16px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
</style>`;

// ── pure renderer ─────────────────────────────────────────────────────────────────────────────
// renderTutorialHtml(lessons) — pure function of an array of lesson stage objects. Returns the
// inner HTML for the lessons list. Tolerant of missing fields and non-array input (soft-fail).
export function renderTutorialHtml(lessons) {
  const list = Array.isArray(lessons) ? lessons : [];
  if (!list.length) return '<p class=empty>The tutorial is temporarily unavailable — please try again shortly.</p>';

  const items = list.map((stage, i) => {
    const s = stage && typeof stage === 'object' ? stage : {};
    const num = s.id != null ? s.id : i + 1;
    const title = s.label || s.key || `Lesson ${num}`;
    const summary = s.description || '';
    const tier = String(s.tier || '').toUpperCase();
    const tierCls = (tier === 'A' || tier === 'B' || tier === 'C') ? tier : '';
    const tierBadge = tierCls
      ? `<span class="tier ${esc(tierCls)}">${esc(`Tier ${tierCls} · ${TIER_LABEL[tierCls]}`)}</span>`
      : '';
    return `<li class=lesson>
      <div class=num>${esc(num)}</div>
      <div class=body>
        <div class=t>${esc(title)}${tierBadge}</div>
        ${summary ? `<div class=d>${esc(summary)}</div>` : ''}
      </div>
    </li>`;
  }).join('');

  return `<ol class=lessons>${items}</ol>`;
}

// ── page shell ──────────────────────────────────────────────────────────────────────────────────
function page(lessons) {
  const count = Array.isArray(lessons) ? lessons.length : 0;
  const body = `<h1>${esc(SITE_NAME)} <span class=muted style="font-size:14px">· the staged onboarding path</span></h1>
    <p class=muted>A read-only map of the ${esc(count)}-stage path the Witness walks new members through — post,
      engage, claim a payout, set up a witness vote, and on. Each stage is a door, not a demand. This page only
      shows the path; the Witness reacts to your real on-chain steps.</p>
    ${renderTutorialHtml(lessons)}`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(SITE_NAME)} — the staged onboarding path</title>
${STYLE}</head><body>
<header class=topbar><a class=brand href="/">📖 MELEK <span>tutorial</span></a></header>
<main class=wrap>${body}</main>
<footer>The MELEK Witness · a read-only view of the staged tutorial. Stages render even when the chain is offline.</footer>
</body></html>`;
}

// ── load lessons through the injectable reader, soft-fail to [] ───────────────────────────────
export function loadLessons() {
  try {
    const doc = _reader();
    const stages = doc && Array.isArray(doc.stages) ? doc.stages : (Array.isArray(doc) ? doc : []);
    return stages;
  } catch {
    return [];
  }
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    if (path === '/') return sendHtml(res, page(loadLessons()));

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    // Soft-fail: never throw out of the handler.
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/tutorial\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
