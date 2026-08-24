// ambassadors/server.mjs — the OWNER-SCOPED Ambassador dashboard (Phase A, design (a)).
//
// One server-rendered page + a few JSON endpoints, each reading an existing rail. OWNER-SCOPED exactly
// like signup/invites.mjs and pentecaust/server.mjs: the acting account is resolved from a VERIFIED
// source (MELEK-Signer bearer / session via __setAuthVerifier), NEVER a spoofable query/body field —
// no cross-account read. Denies by default (401). AMBASSADORS_DEV_TRUST=1 (local/tests ONLY) trusts an
// asserted `x-melek-account` header so the gate is exercisable offline.
//
// Panels: enroll / my referral link + QR / my referrals (funnel) / my earnings ledger / standing+tier.
// Small "Alpha" badge top-left (alpha-badge-convention). esc() ALL interpolation. Reads only — no keys,
// no signing; payout is the daemon's job. handler(req,res) exported for tests; CLI guarded; PORT/BASE_URL.
//
//   GET  /health                 → { ok, service }
//   GET  /  |  /dashboard        → owner-scoped HTML dashboard
//   POST /enroll                 → enroll the verified caller (self-apply)
//   GET  /me/code                → { code, referralLink, qrSvg }
//   GET  /me/referrals           → { funnel, referrals }
//   GET  /me/earnings            → { totals, ledger }

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { qrSvgPlaceholder, qrTargetUrl } from '../pentecaust/herald/qr-tracker.mjs';
import { enroll, getAmbassador } from './registry.mjs';
import { referralsFor, funnelFor } from './attribution.mjs';
import { totalsFor, ledgerFor } from './earnings.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const PORT = +(env('PORT', '8168'));
const HOST = env('HOST', '127.0.0.1');
const BASE_URL = () => (env('BASE_URL', 'https://melek.salon') || 'https://melek.salon').replace(/\/$/, '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── identity (the trust boundary) — verified source only, deny by default ─────────────────────────────
let _verifyAuth = null;
export function __setAuthVerifier(fn) { _verifyAuth = typeof fn === 'function' ? fn : null; }
const DEV_TRUST = () => env('AMBASSADORS_DEV_TRUST', '') === '1';
function whoami(req) {
  if (_verifyAuth) { try { const a = _verifyAuth(req); return a ? String(a).toLowerCase() : null; } catch { return null; } }
  if (DEV_TRUST()) { const h = (req && req.headers) || {}; const a = h['x-melek-account']; return a ? String(a).toLowerCase() : null; }
  return null;
}

function send(res, code, headers, body) {
  try { res.writeHead(code, headers || {}); } catch {}
  try { res.end(body == null ? '' : body); } catch {}
}
const json = (res, code, obj) => send(res, code, { 'content-type': 'application/json; charset=utf-8' }, JSON.stringify(obj));
const unauth = (res) => json(res, 401, { ok: false, reason: 'authentication required (no verified MELEK identity)' });

async function readBody(req) {
  return new Promise((resolve) => {
    let data = ''; let over = false;
    try {
      req.on('data', (c) => { data += c; if (data.length > 1e6) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => resolve(over ? {} : parse(data)));
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
  function parse(s) { if (!s) return {}; try { return JSON.parse(s); } catch { return {}; } }
}

// ── HTTP handler ──────────────────────────────────────────────────────────────────────────────────────
export async function handler(req, res) {
  let path = String((req && req.url) || '/');
  const qi = path.indexOf('?'); if (qi >= 0) path = path.slice(0, qi);
  const method = ((req && req.method) || 'GET').toUpperCase();

  if (method === 'GET' && path === '/health') return json(res, 200, { ok: true, service: 'ambassadors' });

  // POST /enroll — self-apply as the verified caller.
  if (method === 'POST' && path === '/enroll') {
    const me = whoami(req); if (!me) return unauth(res);
    const body = await readBody(req);
    const r = await enroll(me, { karma: body.karma, tenureDays: body.tenureDays, vanity: body.vanity });
    return json(res, r.ok ? 200 : 400, r);
  }

  // Everything below is owner-scoped: the verified caller only.
  if (path === '/' || path === '/dashboard') {
    if (method !== 'GET') return json(res, 405, { ok: false, reason: 'use GET' });
    const me = whoami(req); if (!me) return send(res, 401, { 'content-type': 'text/html; charset=utf-8' }, loginHtml());
    return send(res, 200, { 'content-type': 'text/html; charset=utf-8' }, dashboardHtml(me));
  }
  if (method === 'GET' && path === '/me/code') {
    const me = whoami(req); if (!me) return unauth(res);
    const amb = getAmbassador(me); if (!amb) return json(res, 404, { ok: false, reason: 'not enrolled' });
    return json(res, 200, { ok: true, code: amb.code, referralLink: qrTargetUrl(amb.code), qrSvg: qrSvgPlaceholder(amb.code) });
  }
  if (method === 'GET' && path === '/me/referrals') {
    const me = whoami(req); if (!me) return unauth(res);
    const amb = getAmbassador(me);
    return json(res, 200, { ok: true, funnel: funnelFor(me, amb && amb.code), referrals: referralsFor(me) });
  }
  if (method === 'GET' && path === '/me/earnings') {
    const me = whoami(req); if (!me) return unauth(res);
    return json(res, 200, { ok: true, totals: totalsFor(me), ledger: ledgerFor(me) });
  }

  return json(res, 404, { ok: false, reason: 'not found' });
}

// ── views ─────────────────────────────────────────────────────────────────────────────────────────────
const ALPHA_BADGE = `<div style="position:fixed;top:8px;left:8px;background:#b5651d;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:4px 8px;border-radius:4px;z-index:9">Alpha</div>`;
const SHELL = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>`
  + `<style>body{font-family:system-ui,sans-serif;margin:0;color:#1a1a1a;background:#faf8f5}`
  + `.wrap{max-width:760px;margin:0 auto;padding:3rem 1.25rem 4rem}h1{font-size:1.5rem;margin:.2rem 0 1.2rem}`
  + `h2{font-size:1rem;margin:1.6rem 0 .5rem;color:#5a4a2a}.card{background:#fff;border:1px solid #e7e0d4;border-radius:10px;padding:1rem 1.15rem;margin:.6rem 0}`
  + `code{background:#f1ece3;padding:.12rem .35rem;border-radius:4px;font-size:.9em}a{color:#8a5a1a}`
  + `.muted{color:#8a8172;font-size:.85rem}table{border-collapse:collapse;width:100%;font-size:.9rem}`
  + `th,td{border:1px solid #e7e0d4;padding:.35rem .55rem;text-align:left}th{background:#f6f1e8}</style>`
  + ALPHA_BADGE + `<div class="wrap">${body}</div>`;

function loginHtml() {
  return SHELL('Ambassadors — sign in', `<h1>MELEK Ambassadors</h1>`
    + `<div class="card"><p>Sign in with your MELEK account (MELEK-Signer) to view your ambassador dashboard.</p>`
    + `<p class="muted">This surface is owner-scoped: you only ever see your own referrals and earnings.</p></div>`);
}

function dashboardHtml(me) {
  const amb = getAmbassador(me);
  const head = `<h1>Ambassador dashboard <span class="muted">@${esc(me)}</span></h1>`;

  if (!amb) {
    return SHELL('Ambassadors', head
      + `<div class="card"><h2>Become an ambassador</h2>`
      + `<p>You have a MELEK account. Self-apply to get a referral <code>/go</code> link and start earning on the people you bring in and the posts you curate well.</p>`
      + `<p class="muted">A small karma + tenure floor keeps day-one throwaways out. Approval is automatic once you clear it.</p>`
      + `<button onclick="fetch('/enroll',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(function(){location.reload()})">Apply</button>`
      + `</div>`);
  }

  const funnel = funnelFor(me, amb.code);
  const refs = referralsFor(me);
  const totals = totalsFor(me);
  const ledger = ledgerFor(me);

  const refRows = refs.length ? refs.map((r) => `<tr><td>@${esc(r.newAccount)}</td><td>${esc(r.via)}</td>`
    + `<td>${r.survived ? 'yes' : 'no'}</td><td>${r.payable ? 'payable' : (r.paidAt ? 'paid' : 'pending')}</td></tr>`).join('')
    : `<tr><td colspan="4" class="muted">no referrals yet — share your link</td></tr>`;

  const ledRows = ledger.length ? ledger.map((l) => `<tr><td>${esc(l.leg)}</td><td>${esc(String(l.amount))} ${esc(l.token)}</td>`
    + `<td>${esc(l.kind)}</td><td class="muted">${esc(l.source)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="muted">no earnings yet</td></tr>`;

  return SHELL('Ambassadors', head
    + `<div class="card"><h2>Standing</h2><p>Tier: <code>${esc(amb.tier)}</code> · status: <code>${esc(amb.status)}</code>`
    + ` · karma at enroll: <code>${esc(String(amb.karmaAtEnroll))}</code></p></div>`

    + `<div class="card"><h2>My referral link</h2>`
    + `<p><a href="${esc(qrTargetUrl(amb.code))}">${esc(qrTargetUrl(amb.code))}</a> <span class="muted">(code <code>${esc(amb.code)}</code>)</span></p>`
    + `<div style="max-width:200px">${qrSvgPlaceholder(amb.code)}</div></div>`

    + `<div class="card"><h2>Referrals</h2>`
    + `<p class="muted">clicks ${esc(String(funnel.clicks))} → signups ${esc(String(funnel.signups))} → survivors ${esc(String(funnel.survivors))} · payable ${esc(String(funnel.payable))} · paid ${esc(String(funnel.paid))}</p>`
    + `<table><thead><tr><th>account</th><th>via</th><th>survived</th><th>state</th></tr></thead><tbody>${refRows}</tbody></table></div>`

    + `<div class="card"><h2>Earnings ledger</h2>`
    + `<p class="muted">referral ${esc(String(totals.byLeg.referral))} · curation ${esc(String(totals.byLeg.curation))} · outreach ${esc(String(totals.byLeg.outreach))} · total ${esc(String(totals.total))} ${esc(totals.token)} (read-only; payout via MELEK-Signer)</p>`
    + `<table><thead><tr><th>leg</th><th>amount</th><th>kind</th><th>source</th></tr></thead><tbody>${ledRows}</tbody></table></div>`

    + `<p class="muted">Curation &amp; outreach legs land in later phases. Rewards pay on survival/merit, computed here and signed by MELEK-Signer — never on this host.</p>`);
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`ambassadors dashboard on http://${HOST}:${PORT}  (BASE_URL=${BASE_URL()}, dev-trust=${DEV_TRUST()})`);
  });
}
