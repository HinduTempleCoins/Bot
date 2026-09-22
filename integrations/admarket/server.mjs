// server.mjs — the MELEK ad market HTTP surface: self-serve advertiser API + operator approval + serving.
//
// Self-serve (open): create a campaign, fetch its unsigned funding intent, list your campaigns, get the
// honest inventory + rate card for a surface. Operator-only (AD_ADMIN_TOKEN-gated): review the creative,
// confirm a verified on-chain deposit → go live, pause/resume/end. Plus the runtime endpoints ad-slot
// uses: GET /serve (pick+meter+render an ad) and GET /click (meter a click, then 302 to the creative).
//
// SAFETY: an open create endpoint is safe because a new campaign starts in `pending_review` and CANNOT
// serve until the operator both approves the creative AND confirms a real deposit — no money and no
// serving happen without a human. Nothing here signs or broadcasts (zero-WIF): funding/refund are UNSIGNED
// intents (payments.mjs) the advertiser/operator signs elsewhere. esc() on every interpolation; soft-fail
// (a handler error is a 4xx/500 text, never a stack); handler(req,res) exported for offline tests.
//
//   node integrations/admarket/server.mjs        # bind PORT (default 8791)
//   import { handler, __setStore } from './server.mjs'

import { createServer } from 'node:http';
import * as nodeFs from 'node:fs';
import {
  createStore, loadStore, saveStore, createCampaign, reviewCampaign, confirmFunding,
  pauseCampaign, resumeCampaign, endCampaign, getCampaign, listCampaigns, remaining,
} from './model.mjs';
import { buildFundingIntent, buildRefundIntent } from './payments.mjs';
import { serveSlot, meterClick, soldStyles } from './serve.mjs';
import { estimateInventory, tokenSpec, fromBaseUnits, amountStr, TOKENS } from './pricing.mjs';
import { slotStyles } from '../soapbox/ad-slot.mjs';

const PORT = Number(process.env.AD_MARKET_PORT || process.env.PORT || 8791);
const HOST = process.env.AD_MARKET_HOST || '0.0.0.0';
const BASE_URL = process.env.AD_MARKET_BASE_URL || `http://localhost:${PORT}`;
const CLICK_BASE = process.env.AD_CLICK_BASE || `${BASE_URL}/click`;
const ADMIN_TOKEN = () => String(process.env.AD_ADMIN_TOKEN || '').trim();
const STORE_FILE = () => String(process.env.AD_STORE_FILE || '').trim();

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── module store (in-memory by default; JSON file when AD_STORE_FILE set) ────────────────────────────────
let _store = null;
export function getStore() {
  if (_store) return _store;
  const file = STORE_FILE();
  _store = file ? loadStore({ fs: nodeFsSafe(), file }) : createStore();
  return _store;
}
export function __setStore(s) { _store = s || null; }   // tests inject a fresh store
function persist() { const file = STORE_FILE(); if (file) { try { saveStore(getStore(), { fs: nodeFs, file }); } catch { /* soft */ } } }
function nodeFsSafe() { return nodeFs; }

// ── http helpers ────────────────────────────────────────────────────────────────────────────────────────
function sendJson(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
  return res.end(body);
}
function sendHtml(res, html, code = 200) {
  try { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); } catch {}
  return res.end(html);
}
async function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    try {
      req.on('data', (c) => { data += c; if (data.length > 1e6) { data = data.slice(0, 1e6); } });
      req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}
function operatorOk(req, url) {
  const tok = ADMIN_TOKEN();
  if (!tok) return false;                                        // unset → operator actions all closed
  const given = (url.searchParams.get('token') || (req.headers && req.headers['x-admin-token']) || '').toString();
  return given && given === tok;
}

// ── the handler ─────────────────────────────────────────────────────────────────────────────────────────
export async function handler(req, res) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', BASE_URL);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const store = getStore();

    if (path === '/health') return sendJson(res, { ok: true, campaigns: store.campaigns.size });

    // ── honest inventory + rate card ────────────────────────────────────────────────
    if (path === '/api/inventory' && method === 'GET') {
      const placement = url.searchParams.get('placement') || url.searchParams.get('surface') || '';
      const inv = estimateInventory(placement);
      return sendJson(res, { ok: true, placement, inventory: inv, tokens: Object.keys(TOKENS), note: 'monthlyImpressions is the honest sell ceiling (measured traffic); we do not oversell.' });
    }

    // ── self-serve: create ──────────────────────────────────────────────────────────
    if (path === '/api/campaigns' && method === 'POST') {
      const body = await readBody(req);
      const r = createCampaign(store, body);
      if (!r.ok) return sendJson(res, r, 400);
      persist();
      // include the funding intent up front so the advertiser sees what they'll pay (still needs approval).
      const fund = buildFundingIntent(r.campaign);
      return sendJson(res, { ok: true, campaign: r.campaign, funding: fund.ok ? fund : { ok: false, error: fund.error, hint: 'operator must configure AD_ESCROW_* env' } }, 201);
    }

    // ── self-serve: list ────────────────────────────────────────────────────────────
    if (path === '/api/campaigns' && method === 'GET') {
      const filter = {};
      for (const k of ['status', 'advertiser', 'placement']) { const v = url.searchParams.get(k); if (v) filter[k] = v; }
      return sendJson(res, { ok: true, campaigns: listCampaigns(store, filter) });
    }

    // ── /api/campaigns/:id[/action] ─────────────────────────────────────────────────
    const m = path.match(/^\/api\/campaigns\/([^/]+)(?:\/(fund|refund|review|confirm|pause|resume|end))?$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const action = m[2];
      const c = getCampaign(store, id);
      if (!c) return sendJson(res, { ok: false, error: `unknown campaign "${id}"` }, 404);

      if (!action && method === 'GET') return sendJson(res, { ok: true, campaign: c });

      if (action === 'fund' && method === 'POST') {           // self-serve: get the unsigned deposit intent
        const body = await readBody(req);
        return sendJson(res, buildFundingIntent(c, { amount: body.amount }));
      }

      // operator-only from here down
      if (['refund', 'review', 'confirm', 'pause', 'resume', 'end'].includes(action)) {
        if (!operatorOk(req, url)) return sendJson(res, { ok: false, error: 'operator token required' }, 401);
        const body = method === 'POST' ? await readBody(req) : {};
        let r;
        if (action === 'review') r = reviewCampaign(store, id, body.decision, { note: body.note });
        else if (action === 'confirm') r = confirmFunding(store, id, { ref: body.ref, amount: body.amount });
        else if (action === 'pause') r = pauseCampaign(store, id, { note: body.note });
        else if (action === 'resume') r = resumeCampaign(store, id, { note: body.note });
        else if (action === 'end') r = endCampaign(store, id, { note: body.note });
        else if (action === 'refund') return sendJson(res, buildRefundIntent(c, { amount: body.amount }));
        if (r && r.ok) persist();
        return sendJson(res, r, r && r.ok ? 200 : 400);
      }
      return sendJson(res, { ok: false, error: 'bad action/method' }, 405);
    }

    // ── runtime: serve an ad into a slot (ad-slot / SSR calls this) ──────────────────
    if (path === '/serve' && method === 'GET') {
      const placement = url.searchParams.get('placement') || 'slot';
      const rotate = Number(url.searchParams.get('r') || Date.now());
      const out = serveSlot(store, placement, { rotate, clickBase: CLICK_BASE });
      persist();
      if (url.searchParams.get('format') === 'json') return sendJson(res, { ok: true, sold: out.sold, adId: out.ad && out.ad.id, charged: out.charged, html: out.html });
      return sendHtml(res, out.html || '');
    }

    // ── runtime: meter a click, then redirect to the creative ───────────────────────
    if (path === '/click' && method === 'GET') {
      const cid = url.searchParams.get('c') || '';
      const r = meterClick(store, cid);
      persist();
      const dest = r && r.url;
      if (!dest) return sendHtml(res, '<p>ad expired</p>', 404);
      try { res.writeHead(302, { location: dest, 'cache-control': 'no-store' }); } catch {}
      return res.end();
    }

    // ── advertiser dashboard sketch ─────────────────────────────────────────────────
    if (path === '/' && method === 'GET') return sendHtml(res, advertiserPage(url));

    // ── operator approval queue (gated) ─────────────────────────────────────────────
    if (path === '/admin' && method === 'GET') {
      if (!ADMIN_TOKEN()) return sendHtml(res, page('Operator', '<p>Set <code>AD_ADMIN_TOKEN</code> to enable the operator console.</p>'), 200);
      if (!operatorOk(req, url)) return sendHtml(res, page('Operator', '<p>401 — append <code>?token=…</code>.</p>'), 401);
      return sendHtml(res, adminPage(url));
    }

    return sendHtml(res, page('Not found', '<h1>404</h1>'), 404);
  } catch (e) {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); } catch {}
    try { res.end('error'); } catch {}
  }
}

// ── HTML sketches (esc() everywhere; illustrative, not the final UI) ────────────────────────────────────
function page(title, body) {
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">`
    + `<title>${esc(title)} · MELEK Ads</title><style>${slotStyles()}${soldStyles()}`
    + `body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px;background:#0b0f14;color:#e6edf3}`
    + `code{background:#161b22;border:1px solid #21262d;border-radius:4px;padding:0 5px}table{width:100%;border-collapse:collapse}`
    + `th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #21262d;font-size:14px}a{color:#58a6ff}.muted{color:#8b949e}`
    + `input,select{background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:6px 8px;margin:3px 0}`
    + `</style></head><body>${body}</body></html>`;
}

function advertiserPage(url) {
  const inv = Object.keys(TOKENS);
  const surfaces = ['law', 'wiki', 'stocks', 'credentials', 'directory', 'data', 'hemp']
    .map((s) => { const i = estimateInventory(s + '-top'); return `<tr><td>${esc(s)}</td><td>${i.monthlyImpressions.toLocaleString()}</td><td class=muted>${esc(i.source)}</td></tr>`; }).join('');
  return page('Advertise on MELEK', `
    <h1>Advertise on MELEK surfaces</h1>
    <p class=muted>Buy ad inventory across the MELEK network and pay in <b>${inv.join(' · ')}</b> — our own tokens, no third party.</p>
    <h2>Honest inventory (measured traffic)</h2>
    <table><thead><tr><th>Surface</th><th>~impressions / month</th><th>source</th></tr></thead><tbody>${surfaces}</tbody></table>
    <p class=muted>We sell against real, measured pageviews and never oversell.</p>
    <h2>Create a campaign (sketch)</h2>
    <p class=muted>POST <code>/api/campaigns</code> with { advertiser, token, model:cpm|cpc, rate, budget, placement, creative:{headline,body,url} }.
    You'll get back an unsigned funding intent to sign in your own wallet. Your campaign serves after operator review + deposit confirmation.</p>
    <form onsubmit="return false">
      <div><label>Advertiser <input name=advertiser placeholder="acmecorp or 0x…"></label></div>
      <div><label>Token <select>${inv.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label>Model <select><option>cpm</option><option>cpc</option></select></label></div>
      <div><label>Rate <input placeholder="2.000"></label> <label>Budget <input placeholder="50.000"></label></div>
      <div><label>Placement <input placeholder="law-top"></label></div>
      <div><label>Headline <input placeholder="Acme Legal Research"></label></div>
      <div><label>URL <input placeholder="https://example.com"></label></div>
      <button>Get funding intent →</button>
    </form>`);
}

function adminPage(url) {
  const store = getStore();
  const rows = (status) => listCampaigns(store, { status }).map((c) => {
    const spec = tokenSpec(c.token);
    return `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.advertiser)}</td><td>${esc(c.placement)}</td>`
      + `<td>${esc(c.model.toUpperCase())} ${esc(fromBaseUnits(c.rate, spec.precision))} ${esc(c.token)}</td>`
      + `<td>${esc(fromBaseUnits(c.spent, spec.precision))} / ${esc(fromBaseUnits(c.budget, spec.precision))}</td>`
      + `<td>${c.impressions}i / ${c.clicks}c</td><td>${esc(c.creative.headline)}</td></tr>`;
  }).join('') || '<tr><td colspan=7 class=muted>none</td></tr>';
  const sect = (t, s) => `<h2>${esc(t)}</h2><table><thead><tr><th>id</th><th>advertiser</th><th>slot</th><th>rate</th><th>spent/budget</th><th>served</th><th>creative</th></tr></thead><tbody>${rows(s)}</tbody></table>`;
  return page('Operator console', `<h1>Operator console</h1>
    <p class=muted>Approve creatives, confirm deposits, manage live campaigns. Operator actions:
    <code>POST /api/campaigns/:id/review {decision}</code>, <code>/confirm {ref,amount}</code>, <code>/pause</code>, <code>/resume</code>, <code>/end</code>, <code>/refund</code>.</p>
    ${sect('Awaiting review', 'pending_review')}
    ${sect('Approved — awaiting deposit', 'approved')}
    ${sect('Active', 'active')}
    ${sect('Exhausted', 'exhausted')}`);
}

// ── bind (only when run directly) ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && /admarket\/server\.mjs$/.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`MELEK ad market on ${BASE_URL} (bound ${HOST}:${PORT})  operator=${ADMIN_TOKEN() ? 'set' : 'UNSET'}  store=${STORE_FILE() || 'memory'}`);
  });
}
