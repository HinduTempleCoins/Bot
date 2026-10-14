// pentecaust/bounties/pool-server.mjs — the Bounty Pools surface on Pentecaust.
//
// A self-contained handler: pages (browse / post / do-a-task) + JSON actions (create pool, submit,
// verify). Mounted by pentecaust/server.mjs under /earn with the logged-in account injected as `who`
// (null when signed out). No keys, no chain calls here — funding the escrow and releasing payouts are
// separate steps (escrow.mjs / the attestor service). Pure render + the model; soft-fail; esc() everything.

import { TASK_TYPES, createPool, listPools, getPool, submit, listSubmissions, reviewSubmission, poolStats, defaultStore } from './pool-model.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = () => (process.env.EARN_BASE || '/earn');

const STYLE = `<style>
:root{--bg:#0e1016;--fg:#e7e9ee;--mut:#9aa3b2;--line:#232838;--acc:#36d399;--card:#161a26}
@media(prefers-color-scheme:light){:root{--bg:#f7f8fb;--fg:#15181f;--mut:#5a6372;--line:#e2e6ef;--acc:#0a7d53;--card:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
header{border-bottom:1px solid var(--line);padding:12px 16px;background:var(--bg)}.wrap{max-width:820px;margin:0 auto;padding:0 16px}
.brand{font-weight:800;font-size:20px}.brand b{color:var(--acc)}main{max-width:820px;margin:0 auto;padding:18px 16px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:0 0 12px}
.card .t{font-weight:700;font-size:18px}.card .m{color:var(--mut);font-size:13px;margin-top:4px}.card .d{color:var(--mut);font-size:14px;margin-top:6px}
.pot{color:var(--acc);font-weight:800}.tag{display:inline-block;background:var(--line);border-radius:7px;padding:1px 8px;font-size:12px;color:var(--mut);margin-right:5px}
form{display:grid;gap:10px;max-width:560px}input,select,textarea{background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:10px 12px;font:inherit;width:100%}
button{cursor:pointer;background:var(--acc);border:0;border-radius:8px;color:#04121f;font-weight:700;padding:11px 20px;font-size:15px;justify-self:start}
h1{font-size:26px;margin:6px 0}.sec{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--line);padding-bottom:6px;margin:22px 0 10px}
.note{color:var(--mut);font-size:13px}.ok{background:rgba(54,211,153,.13);border:1px solid var(--acc);border-radius:8px;padding:10px 12px;margin:10px 0}
.warn{background:rgba(217,164,65,.12);border:1px solid #d9a441;border-radius:8px;padding:10px 12px;margin:10px 0}
</style>`;

function pageShell(title, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name=description content="Bounty Pools — sponsors fund a pot, contributors do tasks and earn from the pool.">${STYLE}</head><body>
<header><div class=wrap><div class=brand><a href="${esc(BASE())}">Bounty <b>Pools</b></a> &nbsp;<a class=note href="${esc(BASE())}/new">+ Post a pool</a></div></div></header>
<main>${body}</main></body></html>`;
}

const money = (p) => `${esc(p.perTaskReward)} ${esc(p.token)} / task · pot ${esc(p.pot)} ${esc(p.token)}`;

export function renderBoard(store) {
  const pools = listPools({ status: 'active' }, store);
  const draft = listPools({ status: 'draft' }, store).length;
  const cards = pools.map((p) => {
    const st = poolStats(p.id, store) || {};
    return `<a class=card href="${esc(BASE())}/${esc(p.id)}"><div class=t>${esc(p.title)}</div>
      <div class=m><span class=tag>${esc((TASK_TYPES.find((t) => t.slug === p.taskType) || {}).name || p.taskType)}</span><span class=tag>${esc(p.chain)}</span> <span class=pot>${money(p)}</span></div>
      <div class=d>${esc((p.desc || '').slice(0, 160))}</div>
      <div class=m>${esc(st.remaining ?? p.slots)} of ${esc(p.slots)} rewards left · by ${esc(p.sponsor)}</div></a>`;
  }).join('');
  const body = `<h1>Bounty Pools</h1>
    <p class=note>A sponsor puts up a pot of a token (PRANA, MELEK, …). You do a task — post, share, contribute — and earn from the pool. Powered by the PRANA ContributionBountyEscrow; a verifier confirms each task (automatically where an API allows it).</p>
    <p><a href="${esc(BASE())}/new">+ Post a bounty pool →</a></p>
    <h2 class=sec>Open pools (${pools.length})</h2>
    ${cards || '<p class=note>No active pools yet. Be the first to <a href="' + esc(BASE()) + '/new">post one</a>.</p>'}
    ${draft ? `<p class=note>${draft} pool(s) awaiting funding (not shown until the escrow is funded).</p>` : ''}`;
  return pageShell('Bounty Pools', body);
}

export function renderNew(who, msg = '') {
  if (!who) return pageShell('Post a pool', `<h1>Post a bounty pool</h1><div class=warn>Please <a href="/">sign in</a> first — a pool is funded from your account.</div>`);
  const opts = TASK_TYPES.map((t) => `<option value="${esc(t.slug)}">${esc(t.name)} — ${esc(t.lane)}</option>`).join('');
  const body = `<h1>Post a bounty pool</h1>${msg}
    <form method=post action="${esc(BASE())}/new">
      <label>Title<input name=title required maxlength=140 placeholder="Post about MELEK on X"></label>
      <label>What to do (shown to contributors)<textarea name=desc rows=3 maxlength=2000 placeholder="Post about MELEK and tag @MELEK; reply with your post URL."></textarea></label>
      <label>Task type<select name=taskType>${opts}</select></label>
      <label>Chain<select name=chain><option value=prana-testnet>PRANA testnet</option><option value=prana>PRANA (mainnet)</option><option value=melek>MELEK</option></select></label>
      <label>Token (symbol or contract)<input name=token value="PRANA" maxlength=80></label>
      <label>Total pot<input name=pot type=number min=1 step=any required placeholder="1000"></label>
      <label>Reward per task<input name=perTaskReward type=number min=1 step=any required placeholder="50"></label>
      <label>Extra criteria (optional)<input name=criteria maxlength=1000 placeholder="Must be a public post"></label>
      <button>Create pool</button>
    </form>
    <p class=note>Next step after creating: fund the escrow with your pot (the page will show the amount + the ContributionBountyEscrow address). The pool goes live once funded.</p>`;
  return pageShell('Post a pool', body);
}

export function renderPool(id, who, store, msg = '') {
  const p = getPool(id, store); if (!p) return null;
  const st = poolStats(id, store) || {};
  const tt = TASK_TYPES.find((t) => t.slug === p.taskType) || {};
  const mine = who ? listSubmissions(id, store).find((s) => s.worker === who) : null;
  const fundBlock = p.status !== 'active'
    ? `<div class=warn><b>Awaiting funding.</b> Sponsor: escrow <b>${esc(p.pot)} ${esc(p.token)}</b> into the ContributionBountyEscrow (${esc(p.escrow.contract || 'contract TBD')}) on <b>${esc(p.chain)}</b>, then it goes live. (Funding is a signed on-chain step — see escrow.mjs.)</div>`
    : '';
  const doBlock = p.status === 'active' ? (
    !who ? `<div class=warn><a href="/">Sign in</a> to do this task and earn.</div>`
      : mine ? `<div class=ok>Your submission is <b>${esc(mine.status)}</b>${mine.payoutTxid ? ` · paid (${esc(mine.payoutTxid)})` : ''}.</div>`
        : `<form method=post action="${esc(BASE())}/${esc(id)}/submit">
            <p class=note>Reward: <span class=pot>${esc(p.perTaskReward)} ${esc(p.token)}</span>. ${esc(tt.hint || '')}</p>
            <label>The account you did it on (OAuth-linked)<input name=connectedAccount placeholder="x:@you / facebook:you / email"></label>
            <label>Proof (link / details)<textarea name=proof rows=2 required placeholder="https://x.com/you/status/…"></textarea></label>
            <button>Submit for ${esc(p.perTaskReward)} ${esc(p.token)}</button>
          </form>`
  ) : '';
  const body = `<p class=note><a href="${esc(BASE())}">← all pools</a></p>
    <h1>${esc(p.title)}</h1>
    <div class=m><span class=tag>${esc(tt.name || p.taskType)}</span><span class=tag>${esc(p.chain)}</span> <span class=pot>${money(p)}</span></div>
    <p>${esc(p.desc)}</p>${p.criteria ? `<p class=note>Criteria: ${esc(p.criteria)}</p>` : ''}
    <p class=note>${esc(st.remaining ?? p.slots)} of ${esc(p.slots)} rewards left · verification: <b>${esc(p.lane)}</b> · sponsor ${esc(p.sponsor)}</p>
    ${msg}${fundBlock}${doBlock}`;
  return pageShell(p.title, body);
}

/** Handler. opts: { who:string|null, store } — mounted by pentecaust/server.mjs at /earn. */
export async function handler(req, res, opts = {}) {
  const store = opts.store || defaultStore();
  const who = opts.who || null;
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/^\/earn/, '').replace(/\/+$/, '') || '/';
  const html = (code, body) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); };
  const readBody = () => new Promise((resolve) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => resolve(new URLSearchParams(d))); req.on('error', () => resolve(new URLSearchParams())); });
  try {
    if (req.method === 'GET' && p === '/') return html(200, renderBoard(store));
    if (req.method === 'GET' && p === '/new') return html(200, renderNew(who));
    if (req.method === 'POST' && p === '/new') {
      if (!who) return html(403, renderNew(null));
      const f = await readBody();
      const r = createPool({ sponsor: who, title: f.get('title'), desc: f.get('desc'), taskType: f.get('taskType'), chain: f.get('chain'), token: f.get('token'), pot: f.get('pot'), perTaskReward: f.get('perTaskReward'), criteria: f.get('criteria') }, store);
      if (!r.ok) return html(400, renderNew(who, `<div class=warn>${esc(r.error)}</div>`));
      res.writeHead(302, { location: `${BASE()}/${r.pool.id}` }); return res.end();
    }
    let m;
    if (req.method === 'GET' && (m = p.match(/^\/(p_[a-z0-9]+)$/))) { const h = renderPool(m[1], who, store); return h ? html(200, h) : html(404, pageShell('Not found', '<p>No such pool.</p>')); }
    if (req.method === 'POST' && (m = p.match(/^\/(p_[a-z0-9]+)\/submit$/))) {
      if (!who) return html(403, pageShell('Sign in', '<p>Sign in first.</p>'));
      const f = await readBody();
      const r = submit({ poolId: m[1], worker: who, connectedAccount: f.get('connectedAccount'), proof: f.get('proof') }, store);
      const msg = r.ok ? '<div class=ok>Submitted — a verifier will confirm it, then you are paid from the pool.</div>' : `<div class=warn>${esc(r.error)}</div>`;
      const h = renderPool(m[1], who, store, msg); return h ? html(r.ok ? 200 : 400, h) : html(404, pageShell('Not found', '<p>No such pool.</p>'));
    }
    // JSON API (verifier/attestor service + integrations)
    if (req.method === 'GET' && p === '/api/pools') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, pools: listPools({}, store) })); }
    if (req.method === 'GET' && p === '/api/queue') { res.writeHead(200, { 'content-type': 'application/json' }); const { payoutQueue } = await import('./pool-model.mjs'); return res.end(JSON.stringify({ ok: true, queue: payoutQueue(store) })); }
    return html(404, pageShell('Not found', '<p>Not found.</p>'));
  } catch (e) { try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {} }
}
