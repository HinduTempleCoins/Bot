// server.mjs — MELEKd: the chain explorer, at melekd.hathor.live.
//
// This is the served surface over integrations/chain-explorer.mjs, which has existed as a
// steemd-shaped reader (chain / account / witness / block / transfers) and was mounted on nothing.
//
//   MELEK_RPC_URL=http://127.0.0.1:18090 PORT=8261 BASE_URL=https://melekd.hathor.live node site/melekd/server.mjs
//
// ── What steemd got right, and what it did not ───────────────────────────────────────────────────
//   steemd.com won because it showed you the RAW TRUTH of an account: every field, no interpretation,
//   nothing hidden behind a product decision. That is the part to keep, and every view here offers
//   ?format=json so the raw record is always one click away.
//
//   What it got wrong is that it stopped there. A new user reading `vesting_shares: 1008.050421 VESTS`
//   learns nothing, and the numbers that actually decide whether a witness deserves your vote — missed
//   blocks, price-feed age, running version — were never put side by side. So each view here states the
//   raw field AND what it means, and the witness view leads with the three numbers that matter.
//
// READ-ONLY. No keys, no writes, no broadcast, no database. Every request is a live RPC read.
// handler(req,res) exported for tests; port bound only when run directly; esc() on all interpolation;
// soft-fail-never-throw — an RPC failure renders an honest error card, never a stack trace.

import { createServer } from 'node:http';
import * as x from '../../integrations/chain-explorer.mjs';

const PORT = +(process.env.PORT || 8261);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'MELEKd';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const ACCT_RE = /^[a-z][a-z0-9.-]{1,31}$/;

/** VESTS are meaningless to a reader on their own; say so rather than printing the raw number alone. */
function vestNote(v) {
  const n = parseFloat(String(v || '0'));
  if (!Number.isFinite(n) || n <= 0) return 'no stake vested';
  return 'staked — vested stake is what weights a vote and cannot be moved without unstaking';
}

const STYLE = `<style>
:root{--bg:#0d1117;--panel:#141b26;--line:#232c3d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d4a23c;--good:#3fb950;--bad:#f85149}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:60rem;margin:0 auto;padding:1.6rem 1rem 5rem}
a{color:var(--blue)}
h1{font-size:1.5rem;margin:.2rem 0}
h2{font-size:1.05rem;margin:1.8rem 0 .6rem;color:var(--gold);border-bottom:1px solid var(--line);padding-bottom:.3rem}
.badge{display:inline-block;font-size:.68rem;font-weight:700;color:#1a1304;background:var(--gold);border-radius:5px;padding:1px 6px}
.sub{color:var(--mut);margin:.2rem 0 1.2rem}
form{display:flex;gap:.5rem;margin:1rem 0}
input{flex:1;padding:.55rem .65rem;background:#0b0f16;border:1px solid var(--line);border-radius:6px;color:var(--fg);font:inherit}
button{padding:.55rem 1rem;background:var(--blue);color:#04101f;border:0;border-radius:6px;font:inherit;font-weight:700;cursor:pointer}
table{border-collapse:collapse;width:100%;margin:.4rem 0;font-size:.92rem;display:block;overflow-x:auto}
td,th{border-bottom:1px solid var(--line);padding:.42rem .55rem;text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:600;white-space:nowrap}
.k{color:var(--mut);white-space:nowrap}
.note{color:var(--mut);font-size:.85rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.9rem 1rem;margin:.6rem 0}
.err{border-color:#5c2626;background:#1d1113}
.good{color:var(--good)}.bad{color:var(--bad)}
.nav a{margin-right:.9rem}
code{background:#0b0f16;padding:.05rem .3rem;border-radius:4px}
</style>`;

function page(title, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(SITE_NAME)}</title>
<meta name="description" content="MELEKd — the read-only MELEK chain explorer: accounts, blocks, witnesses and transfers, with the raw record always one click away.">
${STYLE}</head><body><div class=wrap>
<span class=badge>Alpha</span>
<h1><a href="/" style="text-decoration:none;color:inherit">◈ ${esc(SITE_NAME)}</a></h1>
<div class="sub">The MELEK chain, read-only. Every view has <code>?format=json</code>.</div>
<div class=nav><a href="/">chain</a><a href="/witnesses">witnesses</a></div>
<form action="/go" method="get">
  <input name=q placeholder="account name, block number, or @account" aria-label="search">
  <button>look up</button>
</form>
${body}
</div></body></html>`;
}

const errCard = (what, e) => `<div class="card err"><b>Could not read ${esc(what)}.</b>
  <div class=note>${esc((e && e.message) || 'the node did not answer')} — this view is a live read, so a node
  hiccup shows up here rather than being hidden.</div></div>`;

const row = (k, v, note) => `<tr><th class=k>${esc(k)}</th><td>${v == null || v === '' ? '<span class=note>—</span>' : esc(v)}`
  + `${note ? ` <span class=note>${esc(note)}</span>` : ''}</td></tr>`;

// ── views ────────────────────────────────────────────────────────────────────────────────────────
function chainView(c) {
  const behind = Number(c.headBlock) - Number(c.irreversible);
  return `<h2>chain</h2><div class=card><table>
${row('label', c.label)}
${row('head block', c.headBlock)}
${row('irreversible', c.irreversible, `${Number.isFinite(behind) ? behind : '?'} blocks behind head — anything at or below this can never be reversed`)}
${row('current witness', c.currentWitness)}
${row('supply', c.supply)}
${row('time', c.time)}
</table></div>
<p class=note>A block is final once it is at or below the irreversible number. On a delegated-proof-of-stake
chain that lag is normal and is the honest measure of settlement, not the head block.</p>`;
}

function accountView(a, tx) {
  const rows = (tx || []).map((t) => `<tr><td>${esc(t.time)}</td><td><a href="/@${esc(t.from)}">${esc(t.from)}</a></td>`
    + `<td><a href="/@${esc(t.to)}">${esc(t.to)}</a></td><td>${esc(t.amount)}</td><td class=note>${esc(t.memo || '')}</td></tr>`).join('');
  return `<h2>@${esc(a.name)}</h2><div class=card><table>
${row('created', a.created)}
${row('liquid balance', a.balance, 'spendable now')}
${row('savings', a.savings)}
${row('backed token', a.hbd)}
${row('vested stake', a.vesting, vestNote(a.vesting))}
${row('posts', a.postCount)}
${row('recovery account', a.recoveryAccount, 'the account that can help recover this one if the owner key is lost')}
${row('proxy', a.proxy, a.proxy ? 'witness votes are cast by the proxy' : 'votes for itself')}
${row('witness votes', (a.witnessVotes || []).join(', '))}
${row('last vote', a.lastVoteTime)}
</table></div>
<h2>transfers</h2>${rows
    ? `<table><tr><th>time</th><th>from</th><th>to</th><th>amount</th><th>memo</th></tr>${rows}</table>`
    : '<div class=card><span class=note>No transfers in the recent history window.</span></div>'}`;
}

function witnessView(w) {
  const missed = Number(w.totalMissed);
  const feed = w.feed && (w.feed.base || w.feed.quote) ? `${w.feed.base} / ${w.feed.quote}` : null;
  return `<h2>witness ${esc(w.owner)}</h2>
<div class=card><table>
${row('missed blocks', w.totalMissed, missed > 0 ? 'blocks this witness was scheduled for and did not produce' : 'has never missed a scheduled block')}
${row('running version', w.runningVersion, 'a witness behind the network version can fork itself off')}
${row('price feed', feed, feed ? 'the rate this witness publishes' : 'no feed published')}
</table>
<p class=note>Those three are the ones that decide whether a witness deserves your vote, which is why they are
first. Missed blocks are reliability, the version is whether they will still be on the chain after a hardfork,
and a stale feed distorts what everyone is paid.</p></div>
<div class=card><table>
${row('url', w.url)}
${row('last confirmed block', w.lastBlock)}
${row('signing key', w.signingKey)}
${row('votes', w.votes)}
${row('account creation fee', w.props && w.props.accountCreationFee)}
${row('max block size', w.props && w.props.maxBlockSize)}
</table></div>`;
}

function blockView(b) {
  const ops = Object.entries(b.opCounts || {});
  return `<h2>block ${esc(b.num)}</h2><div class=card><table>
${row('timestamp', b.timestamp)}
${row('witness', b.witness)}
${row('transactions', b.txCount)}
</table></div>
<h2>operations</h2>${ops.length
    ? `<table><tr><th>type</th><th>count</th></tr>${ops.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`
    : '<div class=card><span class=note>An empty block — scheduled, produced, no transactions in it.</span></div>'}`;
}

const send = (res, code, body, type = 'text/html; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'public, max-age=15' });
  res.end(body);
};
const json = (res, code, obj) => send(res, code, JSON.stringify(obj, null, 2), 'application/json; charset=utf-8');

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = decodeURIComponent(url.pathname);
    const wantJson = url.searchParams.get('format') === 'json';

    if (path === '/health') return send(res, 200, 'ok', 'text/plain');

    // /go?q= — one box for accounts and block numbers, like steemd's.
    if (path === '/go') {
      const q = String(url.searchParams.get('q') || '').trim().replace(/^@/, '').toLowerCase();
      if (/^\d+$/.test(q)) { res.writeHead(302, { location: `/b/${q}` }); return res.end(); }
      if (ACCT_RE.test(q)) { res.writeHead(302, { location: `/@${q}` }); return res.end(); }
      return send(res, 400, page('not found', `<div class="card err">Not an account name or a block number.</div>`));
    }

    if (path === '/') {
      try {
        const c = await x.chain();
        return wantJson ? json(res, 200, c) : send(res, 200, page('chain', chainView(c)));
      } catch (e) { return wantJson ? json(res, 502, { error: String(e && e.message) }) : send(res, 200, page('chain', errCard('the chain', e))); }
    }

    const acct = path.match(/^\/@([a-z0-9.-]{2,32})$/);
    if (acct) {
      const name = acct[1];
      try {
        const a = await x.account(name);
        if (!a) return wantJson ? json(res, 404, { error: 'no such account' })
          : send(res, 404, page(name, `<div class="card err">No account <b>@${esc(name)}</b> on this chain.</div>`));
        const tx = await x.transfers(name, 30).catch(() => []);
        return wantJson ? json(res, 200, { account: a, transfers: tx }) : send(res, 200, page(`@${name}`, accountView(a, tx)));
      } catch (e) { return wantJson ? json(res, 502, { error: String(e && e.message) }) : send(res, 200, page(name, errCard(`@${name}`, e))); }
    }

    const wit = path.match(/^\/w\/([a-z0-9.-]{2,32})$/);
    if (wit) {
      try {
        const w = await x.witness(wit[1]);
        if (!w) return wantJson ? json(res, 404, { error: 'not a witness' })
          : send(res, 404, page(wit[1], `<div class="card err"><b>@${esc(wit[1])}</b> is not a witness.</div>`));
        return wantJson ? json(res, 200, w) : send(res, 200, page(`witness ${wit[1]}`, witnessView(w)));
      } catch (e) { return wantJson ? json(res, 502, { error: String(e && e.message) }) : send(res, 200, page(wit[1], errCard('the witness', e))); }
    }

    const blk = path.match(/^\/b\/(\d{1,12})$/);
    if (blk) {
      try {
        const b = await x.block(blk[1]);
        if (!b) return wantJson ? json(res, 404, { error: 'no such block' })
          : send(res, 404, page(`block ${blk[1]}`, `<div class="card err">No block ${esc(blk[1])} yet.</div>`));
        return wantJson ? json(res, 200, b) : send(res, 200, page(`block ${blk[1]}`, blockView(b)));
      } catch (e) { return wantJson ? json(res, 502, { error: String(e && e.message) }) : send(res, 200, page('block', errCard('the block', e))); }
    }

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    return send(res, 500, 'error: ' + ((e && e.message) || 'unknown'), 'text/plain');
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/melekd\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
