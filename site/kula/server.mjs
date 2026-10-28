// site/kula/server.mjs — the KULA community fund at melek.salon/kula.
//
// @kula is a community-funded, Nutbox-style pool: members pay MELEK into it and delegate MELEK Power on top;
// the pooled power curates for the fund, and members are paid back in KULA-program tokens, airdrops and a
// small MELEK reward. This page shows the fund straight from the chain (every deposit and delegation is a
// public MELEK operation) and lets anyone join in one step.
//
// Joining never touches a key here. The member is sent to MELEK-Signer's own approval page with a scope for
// exactly one operation (delegate_vesting_shares, or transfer); the signer asks for their password, we get a
// one-time code back, sign that single operation through the signer, and revoke the token straight away.
//
// House style: ESM, esc() all interpolation, injectable fetch, soft-fail, handler(req,res) exported, CLI-guarded.
//   PORT=8250 PATH_PREFIX=/kula BASE_URL=https://melek.salon/kula node site/kula/server.mjs
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { finishPage } from '../../integrations/soapbox/page-meta.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const FUND = (process.env.KULA_ACCOUNT || 'kula').toLowerCase();
const RPC = process.env.MELEK_RPC_URL || 'https://melek.salon/rpc';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const CLIENT_ID = 'kula-fund';
const PATH_PREFIX = (process.env.PATH_PREFIX || '').replace(/\/+$/, '');
const BASE_URL = (process.env.BASE_URL || 'https://melek.salon/kula').replace(/\/+$/, '');
const WIKI = 'https://wiki.soapbox.community/wiki/';
const RC_GIFTERS = new Set((process.env.KULA_RC_GIFTERS || 'onboarder').split(',').map((x) => x.trim()).filter(Boolean));

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = (page, what) => `<a class=q href="${WIKI}${page}" target=_blank rel=noopener title="Help: ${esc(what)}" aria-label="Help: ${esc(what)}">?</a>`;

// ── chain reads ─────────────────────────────────────────────────────────────────────────────────────────
async function rpc(method, params) {
  try {
    const r = await _fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json();
    return j && j.result !== undefined ? j.result : null;
  } catch { return null; }
}
const num = (s) => { const n = parseFloat(String(s || '').split(' ')[0]); return Number.isFinite(n) ? n : 0; };

/** VESTS per MELEK, from the chain's vesting fund. */
export function vestsPerMelek(props) {
  const fund = num(props && props.total_vesting_fund_steem), shares = num(props && props.total_vesting_shares);
  return fund > 0 && shares > 0 ? shares / fund : 0;
}

/**
 * Walk @kula's whole account history, oldest-first, keeping only the ops that can make someone a member.
 *
 * WHY THIS PAGINATES. @kula is a registered witness, so its history is ~99.9% `producer_reward` — around
 * 1,000 of them every 7-8 hours. A single `get_account_history [FUND, -1, 1000]` therefore only reaches
 * back a few hours, and a member's `delegate_vesting_shares` silently falls out of the window and
 * disappears from the members table. That is not hypothetical: the fund's first member was ~6 hours from
 * vanishing when this was found. This chain's `account_history_api` ignores `operation_filter_low`, so the
 * only correct read is to page all the way back and filter client-side.
 *
 * Returns rows in CHRONOLOGICAL order, because membersFrom() is last-write-wins per delegator.
 */
export async function fetchMemberHistory(call, fund = FUND, { pageSize = 1000, maxPages = 80 } = {}) {
  const kept = [];
  let start = -1;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await call('condenser_api.get_account_history', [fund, start, pageSize]);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const op = r && r[1] && r[1].op;
      if (Array.isArray(op) && (op[0] === 'delegate_vesting_shares' || op[0] === 'transfer')) kept.push(r);
    }
    const oldest = rows[0] && rows[0][0];
    if (!Number.isFinite(oldest) || oldest <= 0) break;
    start = oldest - 1;
    if (start < 0) break;
  }
  return kept.sort((a, b) => (a[0] || 0) - (b[0] || 0));
}

/** Cached wrapper — the full walk is ~26 RPC calls on this account, so don't do it per request. */
let _histCache = { at: 0, rows: null };
export function __clearHistoryCache() { _histCache = { at: 0, rows: null }; }
export async function memberHistory(call, fund = FUND, ttlMs = 120000) {
  const now = Date.now();
  if (_histCache.rows && now - _histCache.at < ttlMs) return _histCache.rows;
  const rows = await fetchMemberHistory(call, fund);
  if (rows && rows.length >= 0) _histCache = { at: now, rows };
  return rows;
}

/**
 * Members from @kula's account history: the latest delegation per delegator (a delegation op sets the total,
 * so the last one wins; 0 means withdrawn) and the sum of MELEK deposited per account. Pure.
 */
export function membersFrom(history, fund = FUND) {
  const delegations = new Map(), deposits = new Map();
  for (const row of history || []) {
    const op = row && row[1] && row[1].op;
    if (!Array.isArray(op)) continue;
    const [kind, b] = op;
    // the signup service lends every new account a sliver of power for Resource Credits: not a member
    if (kind === 'delegate_vesting_shares' && b && b.delegatee === fund && !RC_GIFTERS.has(b.delegator)) delegations.set(b.delegator, num(b.vesting_shares));
    if (kind === 'transfer' && b && b.to === fund && /\sMELEK$/.test(String(b.amount))) deposits.set(b.from, (deposits.get(b.from) || 0) + num(b.amount));
  }
  const names = new Set([...delegations.keys(), ...deposits.keys()]);
  return [...names].map((account) => ({ account, vests: delegations.get(account) || 0, deposited: deposits.get(account) || 0 }))
    .filter((m) => m.vests > 0 || m.deposited > 0)
    .sort((a, b) => (b.deposited + b.vests / 2000) - (a.deposited + a.vests / 2000));
}

// ── joining: one operation, one-time approval ───────────────────────────────────────────────────────────
const pending = new Map();   // state -> { kind, amount, at }
const TTL = 15 * 60 * 1000;
export function __pending() { return pending; }

/** Validate a join request; returns { ok, kind, amount } with the amount normalised to 3 decimals. */
export function parseJoin({ kind, amount }) {
  if (kind !== 'delegate' && kind !== 'deposit') return { ok: false, reason: 'choose delegate or deposit' };
  const n = Number(String(amount || '').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) return { ok: false, reason: 'enter an amount above 0' };
  return { ok: true, kind, amount: n.toFixed(3) };
}

export function authorizeUrl(state, kind) {
  const u = new URL(`${SIGNER}/oauth2/authorize`);
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('scope', kind === 'delegate' ? 'delegate_vesting_shares' : 'transfer');
  u.searchParams.set('redirect_uri', `${BASE_URL}/callback`);
  u.searchParams.set('state', state);
  return u.toString();
}

/** The single operation a join performs. `vpm` = VESTS per MELEK. A delegation sets the member's total to `amount` MP. */
export function joinOp({ kind, amount, account, vpm }) {
  if (kind === 'delegate') return ['delegate_vesting_shares', { delegator: account, delegatee: FUND, vesting_shares: `${(Number(amount) * vpm).toFixed(6)} VESTS` }];
  return ['transfer', { from: account, to: FUND, amount: `${Number(amount).toFixed(3)} MELEK`, memo: 'KULA community fund deposit' }];
}

async function signerPost(path, body, token) {
  const r = await _fetch(`${SIGNER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

/** Finish a join: code → token → one broadcast → revoke. Never throws; returns { ok, account, trx?, error? }. */
export async function completeJoin({ code, state }) {
  const p = pending.get(state);
  if (!p || Date.now() - p.at > TTL) return { ok: false, error: 'This request expired. Please start again.' };
  pending.delete(state);
  let token = null;
  try {
    const t = await signerPost('/oauth2/token', { code, client_id: CLIENT_ID });
    token = t && t.access_token;
    if (!token || !t.account) return { ok: false, error: 'MELEK-Signer did not approve the request.' };
    const props = p.kind === 'delegate' ? await rpc('condenser_api.get_dynamic_global_properties', []) : null;
    const vpm = vestsPerMelek(props);
    if (p.kind === 'delegate' && !vpm) return { ok: false, account: t.account, error: 'Could not read the chain right now. Nothing was sent.' };
    const b = await signerPost('/v1/broadcast', { ops: [joinOp({ kind: p.kind, amount: p.amount, account: t.account, vpm })], client_ref: CLIENT_ID, role: 'active' }, token);
    if (!b || !b.ok) return { ok: false, account: t.account, error: (b && b.error) || 'The chain did not accept it.' };
    return { ok: true, account: t.account, kind: p.kind, amount: p.amount, trx: b.result && b.result.id };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 160) };
  } finally {
    if (token) signerPost('/oauth2/token/revoke', { token }, token).catch(() => {});
  }
}

// ── pages ───────────────────────────────────────────────────────────────────────────────────────────────
function layout(title, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel=canonical href="${esc(BASE_URL)}">
<meta name=description content="A community-funded pool on MELEK, run by the account @${esc(FUND)}. Members pay MELEK in and delegate MELEK Power on top. The pooled power curates for the fund, and members are paid back mostly in KULA-program tokens and airdrops, plus a small MELEK reward.">
<style>
:root{--bg:#f7f8fa;--fg:#1a1d24;--mut:#6b7280;--card:#fff;--line:#e5e7eb;--gold:#eab308}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1218;--fg:#e5e7eb;--mut:#9ca3af;--card:#161a22;--line:#2a2f3a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}
header a{color:inherit;text-decoration:none}.brand{font-weight:800;color:#f39c12!important;font-size:20px}
main{max-width:980px;margin:0 auto;padding:18px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
h1{margin:4px 0 6px}h2{margin:0 0 8px;font-size:19px}.mut{color:var(--mut)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.stat b{display:block;font-size:22px}
form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
input{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:inherit;width:150px}
button{font:inherit;font-weight:700;padding:9px 16px;border-radius:8px;border:0;background:var(--gold);color:#171f24;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:6px 4px;border-bottom:1px solid var(--line);text-align:left}td.n,th.n{text-align:right}
.q{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#1a1d24;color:#fff!important;font:700 12px/1 system-ui,sans-serif;text-decoration:none;vertical-align:middle;margin-left:4px}
.ok{color:#15803d}.bad{color:#b42318}
@media(max-width:600px){table{display:block;overflow-x:auto}}
</style></head><body>
<header><a class=brand href="https://melek.salon/explore">MELEK</a><a href="https://melek.salon/trending">All Posts</a><a href="https://engine.melek.salon/">Trade</a><a href="https://wallet.melek.salon/~witnesses">Vote</a><a href="https://kula.money/">KulaSwap</a></header>
<main>${body}</main><script src="https://pentecaust.com/translate.js" defer></script></body></html>`;
}

export async function renderFund() {
  const [accts, props, hist] = await Promise.all([
    rpc('condenser_api.get_accounts', [[FUND]]), rpc('condenser_api.get_dynamic_global_properties', []),
    memberHistory(rpc, FUND),
  ]);
  const a = accts && accts[0];
  const vpm = vestsPerMelek(props);
  const mp = (v) => (vpm ? (v / vpm) : 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const members = membersFrom(hist || []);
  const ownMp = a ? mp(num(a.vesting_shares)) : '—', recvMp = a ? mp(num(a.received_vesting_shares)) : '—';
  const rows = members.map((m) => `<tr><td><a href="https://melek.salon/@${esc(m.account)}">@${esc(m.account)}</a></td><td class=n>${esc(m.deposited.toFixed(3))}</td><td class=n>${esc(mp(m.vests))}</td></tr>`).join('');
  return layout('KULA Community Fund — MELEK', `
<h1>KULA Community Fund ${q('KULA_Community_Fund', 'the KULA fund')}</h1>
<p class=mut>A community-funded pool on MELEK, run by the account <a href="https://melek.salon/@${esc(FUND)}">@${esc(FUND)}</a>. Members pay MELEK in and delegate MELEK Power on top. The pooled power curates for the fund, and members are paid back mostly in KULA-program tokens and airdrops, plus a small MELEK reward. Every deposit and delegation below is read straight from the MELEK chain.</p>
<div class="card stats">
  <div class=stat><span class=mut>MELEK in the fund</span><b>${a ? esc(num(a.balance).toFixed(3)) : '—'}</b></div>
  <div class=stat><span class=mut>Fund's own MELEK Power</span><b>${esc(ownMp)}</b></div>
  <div class=stat><span class=mut>Delegated by members</span><b>${esc(recvMp)} MP</b></div>
  <div class=stat><span class=mut>Members</span><b>${members.length}</b></div>
</div>
<div class=card id=join>
  <h2>Join the fund</h2>
  <p class=mut>Each button sends you to MELEK-Signer, which asks for your password and approves just that one action. This page never sees your password or keys. ${q('KULA_Community_Fund#joining', 'joining')}</p>
  <form method=post action="/join"><input type=hidden name=kind value=delegate><input name=amount inputmode=decimal placeholder="MELEK Power" aria-label="MELEK Power to delegate"><button>Delegate</button>
    <span class=mut>Lends your MELEK Power to @${esc(FUND)}. You keep it and can take it back. Delegating again sets a new total. ${q('KULA_Community_Fund#delegating', 'delegating')}</span></form>
  <form method=post action="/join"><input type=hidden name=kind value=deposit><input name=amount inputmode=decimal placeholder="MELEK" aria-label="MELEK to deposit"><button>Deposit</button>
    <span class=mut>Sends MELEK into the fund's balance. ${q('KULA_Community_Fund#depositing', 'depositing')}</span></form>
</div>
<div class=card>
  <h2>Members ${q('KULA_Community_Fund#members', 'members')}</h2>
  ${members.length ? `<table><thead><tr><th>Member</th><th class=n>MELEK deposited</th><th class=n>MELEK Power delegated</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class=mut>No members yet. Be the first.</p>'}
</div>
<div class=card>
  <h2>Learn</h2>
  <p><a href="${WIKI}KULA_Community_Fund">How the KULA fund works</a> · <a href="${WIKI}Voting_and_Curation_on_MELEK">Voting and curation</a> · <a href="https://witness.melek.salon/">Witness School</a> · <a href="https://kula.money/">KulaSwap</a> · <a href="https://engine.melek.salon/">MELEK-Engine</a></p>
</div>`);
}

function sendHtml(res, code, html) {
  const out = PATH_PREFIX ? String(html).replace(/(href|action)="\/(?!\/)/g, `$1="${PATH_PREFIX}/`) : html;
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(finishPage(out, { host: 'melek.salon', siteName: 'MELEK' }));
}
const readForm = (req) => new Promise((resolve) => {
  let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
  req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(raw)))); req.on('error', () => resolve({}));
});

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    let path = url.pathname;
    if (PATH_PREFIX && path.startsWith(PATH_PREFIX)) path = path.slice(PATH_PREFIX.length) || '/';
    if (req.method === 'GET' && path === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
    if (req.method === 'GET' && (path === '/' || path === '')) return sendHtml(res, 200, await renderFund());
    if (req.method === 'POST' && path === '/join') {
      const j = parseJoin(await readForm(req));
      if (!j.ok) return sendHtml(res, 400, layout('KULA Community Fund', `<p class=bad>${esc(j.reason)}</p><p><a href="/">Back</a></p>`));
      const state = randomBytes(16).toString('hex');
      for (const [k, v] of pending) if (Date.now() - v.at > TTL) pending.delete(k);
      pending.set(state, { kind: j.kind, amount: j.amount, at: Date.now() });
      res.writeHead(302, { location: authorizeUrl(state, j.kind) });
      return res.end();
    }
    if (req.method === 'GET' && path === '/callback') {
      const r = await completeJoin({ code: url.searchParams.get('code') || '', state: url.searchParams.get('state') || '' });
      const what = r.kind === 'delegate' ? `delegated ${esc(r.amount)} MELEK Power` : `deposited ${esc(r.amount)} MELEK`;
      return sendHtml(res, r.ok ? 200 : 400, layout('KULA Community Fund', r.ok
        ? `<h1 class=ok>Welcome to the fund, @${esc(r.account)}</h1><p>You ${what} to @${esc(FUND)}. Transaction <code>${esc(r.trx || '')}</code>.</p><p><a href="/">See the fund</a></p>`
        : `<h1 class=bad>Not done</h1><p>${esc(r.error)}</p><p><a href="/">Back to the fund</a></p>`));
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch { /* */ }
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +(process.env.PORT || 8250);
  createServer(handler).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`KULA fund on ${BASE_URL} (:${port})`));
}
