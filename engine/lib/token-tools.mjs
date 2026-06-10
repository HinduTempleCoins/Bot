/**
 * token-tools.mjs — the user-facing TOKEN TOOLS surface for MELEK.
 *
 * One page that unifies the two MELEK token layers (see TOKEN_INFRA.md):
 *   (b) MELEK-Engine side-tokens — read from the engine State (live) and the
 *       create/issue/transfer/stake op BUILDERS (op-builder.mjs).
 *   (a) Native SMT / NAI        — read via integrations/smt-info.mjs and the
 *       smt_create / smt_setup op builders.
 *
 * Routes (handler(req,res) — exported for tests):
 *   GET  /                         the tools index: token list (engine + SMT) + builders
 *   GET  /token/:SYMBOL            engine token detail (supply, holders, metadata)
 *   GET  /api/tokens               combined JSON token list
 *   POST /api/build                build+validate an op { layer, action, params, account }
 *                                  → { ok, op, summary } | { ok:false, error }
 *
 * KEY-CUSTODY: this surface NEVER signs and NEVER broadcasts. /api/build only
 * assembles + validates the op shape; signing happens client-side (engine ops)
 * or off-repo (SMT ops). No WIF/seed is read, accepted, logged, or stored.
 * (BRIEF.md §7.)
 *
 * DATA INJECTION: the handler takes a `deps` object so tests run fully offline:
 *   deps.state         a live engine State (or a stub with collection()/find())
 *   deps.smtSummary()  async () => the smt-info summary (injected in tests)
 * Both are optional; each degrades to a shaped soft-empty when absent.
 */

import {
  buildEngineOp,
  buildSmtCreateOp,
  buildSmtSetupOp,
  isValidSymbol,
} from './op-builder.mjs';
import { fromBaseUnits } from './decimal.mjs';
import { config, genesis } from '../config.mjs';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Project an engine token row -> a plain view (base units -> decimal strings). */
export function engineTokenView(t) {
  return {
    layer: 'engine',
    symbol: t.symbol,
    name: t.name,
    issuer: t.issuer,
    precision: t.precision,
    supply: fromBaseUnits(BigInt(t.supply || '0'), t.precision),
    maxSupply: fromBaseUnits(BigInt(t.maxSupply || '0'), t.precision),
    immutable: t.supplyCapImmutable === true,
    url: t.url || '',
    createdBlock: t.createdBlock,
  };
}

/** All engine tokens, sorted by symbol; [] when no state. */
export function listEngineTokens(state) {
  if (!state || typeof state.collection !== 'function') return [];
  return state
    .collection('tokens')
    .map(engineTokenView)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/** Holders of an engine token with a positive (liquid+stake) balance. */
export function engineHolders(state, symbol) {
  if (!state || typeof state.find !== 'function') return [];
  const t = state.findOne ? state.findOne('tokens', { symbol }) : null;
  const prec = t ? t.precision : 3;
  return state
    .find('balances', { symbol })
    .filter((b) => BigInt(b.balance || '0') > 0n || BigInt(b.stake || '0') > 0n)
    .map((b) => ({
      account: b.account,
      balance: fromBaseUnits(BigInt(b.balance || '0'), prec),
      stake: fromBaseUnits(BigInt(b.stake || '0'), prec),
    }))
    .sort((a, b) => Number(b.balance) - Number(a.balance));
}

/**
 * Build the combined token list (engine + SMT). Async because smtSummary is.
 * Always returns a shaped object; soft-fails to empties.
 */
export async function combinedTokenList(deps = {}) {
  const engine = listEngineTokens(deps.state);
  let smt = { configured: false, hardforkActive: null, naiPoolSize: 0, tokens: [], nais: [] };
  if (typeof deps.smtSummary === 'function') {
    try {
      smt = await deps.smtSummary();
    } catch {
      /* soft-fail: keep the empty default */
    }
  }
  const smtTokens = (smt.tokens || []).map((t) => ({
    layer: 'smt',
    nai: t.nai,
    decimals: t.decimals,
    controlAccount: t.controlAccount,
    phase: t.phase,
    maxSupply: t.maxSupply,
  }));
  return {
    engine,
    smt: {
      configured: !!smt.configured,
      hardforkActive: smt.hardforkActive ?? null,
      naiPoolSize: smt.naiPoolSize || 0,
      nais: (smt.nais || []).slice(0, 20),
      tokens: smtTokens,
      label: smt.label || '[TestNet not MELEK]',
    },
    counts: { engine: engine.length, smt: smtTokens.length },
  };
}

/**
 * Dispatch a build request from the /api/build route (also usable directly in
 * tests). `req = { layer, action, params, account }`.
 *   layer 'engine' → buildEngineOp(action, params, account)
 *   layer 'smt'    → action 'create' → buildSmtCreateOp(params)
 *                    action 'setup'  → buildSmtSetupOp(params)
 * Never throws for bad user input; throws only if `req` isn't an object.
 */
export function buildFromRequest(req) {
  if (typeof req !== 'object' || req === null) throw new TypeError('request must be an object');
  const layer = String(req.layer || 'engine');
  const action = String(req.action || '');
  const params = (typeof req.params === 'object' && req.params) || {};
  if (layer === 'engine') {
    return buildEngineOp(action, params, String(req.account || ''));
  }
  if (layer === 'smt') {
    if (action === 'create') return buildSmtCreateOp(params);
    if (action === 'setup') return buildSmtSetupOp(params);
    return { ok: false, error: `unknown smt action "${action}" (create|setup)` };
  }
  return { ok: false, error: `unknown layer "${layer}" (engine|smt)` };
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

const STYLE = `
:root{--bg:#0d0b14;--card:#16131f;--ink:#e9e4f5;--mut:#9a90b5;--gold:#d8b35a;--line:#2a2438;--sky:#7fb3ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{padding:28px 20px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#1a1626,#0d0b14)}
h1{margin:0;font-size:24px;letter-spacing:.5px}h1 span{color:var(--gold)}
.sub{color:var(--mut);margin-top:6px;font-size:13px}
main{max-width:1000px;margin:0 auto;padding:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin:16px 0}
h2{font-size:16px;margin:0 0 12px;color:var(--gold)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
.num{text-align:right;font-variant-numeric:tabular-nums}.sym{font-weight:700;color:var(--gold)}
.nai{font-weight:700;color:var(--sky);font-family:ui-monospace,monospace}
input,select{background:#0d0b14;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:9px 11px;font:inherit;width:100%}
label{display:block;color:var(--mut);font-size:12px;margin:10px 0 4px}
button{background:var(--gold);color:#1a1626;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer;margin-top:14px}
button.ghost{background:transparent;color:var(--gold);border:1px solid var(--gold)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
pre{background:#0d0b14;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all}
.pill{display:inline-block;background:#0d0b14;border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--mut);margin-right:6px}
.warn{color:#e0a;font-size:12px}a{color:var(--gold)}
@media(max-width:640px){.grid{grid-template-columns:1fr}}
`;

function pageShell(title, bodyHtml, scriptHtml = '') {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header><h1><span>MELEK</span> Token Tools</h1>
<div class="sub">List · inspect · build token ops for both layers — engine side-tokens &amp; native SMTs.
Keys never leave your browser; SMT ops are signed off-repo. <a href="/">tools</a></div></header>
<main>${bodyHtml}</main>${scriptHtml}</body></html>`;
}

/** Render the combined token list as two tables. */
export function renderTokenList(combined) {
  const eRows = combined.engine.map((t) => `<tr>
    <td class="sym"><a href="/token/${esc(t.symbol)}">${esc(t.symbol)}</a></td>
    <td>${esc(t.name)}</td><td>@${esc(t.issuer)}</td>
    <td class="num">${esc(t.supply)}</td>
    <td class="num">${esc(t.maxSupply)}${t.immutable ? ' 🔒' : ''}</td>
    <td class="num">${esc(t.precision)}</td></tr>`).join('\n');

  const sRows = combined.smt.tokens.map((t) => `<tr>
    <td class="nai">${esc(t.nai)}</td>
    <td>@${esc(t.controlAccount || '?')}</td>
    <td class="num">${esc(t.decimals == null ? '?' : t.decimals)}</td>
    <td class="num">${esc(t.maxSupply == null ? '—' : t.maxSupply)}</td>
    <td class="num">${esc(t.phase == null ? '—' : t.phase)}</td></tr>`).join('\n');

  const hf = combined.smt.hardforkActive === true ? 'SMT hardfork active'
    : combined.smt.hardforkActive === false ? 'SMT hardfork inactive'
    : 'SMT status unconfirmed';

  return `
  <div class="card">
    <h2>Engine side-tokens (layer b — MELEK-Engine)</h2>
    <table><thead><tr><th>Symbol</th><th>Name</th><th>Issuer</th>
      <th class="num">Supply</th><th class="num">Max</th><th class="num">Prec</th></tr></thead>
      <tbody>${eRows || '<tr><td colspan=6>no engine tokens yet</td></tr>'}</tbody></table>
    <p class="sub">Fee token <b>${esc(genesis.feeToken)}</b> · governance <b>${esc(genesis.minerToken)}</b> ·
      create burns <b>${esc(config.tokenCreationFee)} ${esc(genesis.feeToken)}</b> ·
      sidechain <code>${esc(config.sidechainId)}</code></p>
  </div>

  <div class="card">
    <h2>Native SMT / NAI (layer a — chain consensus) <span class="pill">${esc(combined.smt.label)}</span></h2>
    <p class="sub">${esc(hf)} · NAI pool size <b>${esc(combined.smt.naiPoolSize)}</b>
      ${combined.smt.configured ? '' : '· <span class="warn">MELEK_RPC_URL unset (read soft-empty)</span>'}</p>
    <table><thead><tr><th>NAI</th><th>Control</th><th class="num">Dec</th>
      <th class="num">Max supply</th><th class="num">Phase</th></tr></thead>
      <tbody>${sRows || '<tr><td colspan=5>no SMTs created yet</td></tr>'}</tbody></table>
  </div>`;
}

/** Render the create/issue/transfer builder card + the client script. */
function renderBuilder() {
  return `
  <div class="card">
    <h2>Build a token operation</h2>
    <p class="sub">Assembles + validates the exact operation. <b>Engine</b> ops are a
      <code>custom_json</code> you sign in your browser; <b>SMT</b> ops are standard Graphene ops
      signed off-repo (operator / MELEK-Signer). <span class="warn">No key is entered or sent here.</span></p>
    <div class="grid">
      <div><label>Layer</label>
        <select id="layer" onchange="renderForm()">
          <option value="engine">Engine side-token (custom_json)</option>
          <option value="smt">Native SMT (smt_create / smt_setup)</option>
        </select></div>
      <div><label>Action</label><select id="action" onchange="renderForm()"></select></div>
    </div>
    <div id="form"></div>
    <button class="ghost" onclick="buildOp()">Build &amp; validate op</button>
    <label>Result</label><pre id="out">—</pre>
  </div>`;
}

const BUILDER_SCRIPT = `<script>
const ACTIONS={engine:[['create','create'],['issue','issue'],['transfer','transfer'],['stake','stake'],['unstake','unstake']],
  smt:[['create','smt_create'],['setup','smt_setup']]};
const FORMS={
  'engine:create':'<label>Account (signer)</label><input id="account" placeholder="hathor">'+
    '<label>Symbol (1-10 A-Z)</label><input id="symbol" placeholder="MYTOK">'+
    '<label>Name</label><input id="name" placeholder="My Token">'+
    '<label>Precision (0-8)</label><input id="precision" value="3">'+
    '<label>Max supply</label><input id="maxSupply" placeholder="1000000">'+
    '<label><input type="checkbox" id="supplyCapImmutable" style="width:auto"> immutable cap</label>',
  'engine:issue':'<label>Account (issuer)</label><input id="account" placeholder="hathor">'+
    '<label>Symbol</label><input id="symbol" placeholder="MYTOK">'+
    '<label>To</label><input id="to" placeholder="alice">'+
    '<label>Quantity</label><input id="quantity" placeholder="100">',
  'engine:transfer':'<label>Account (sender)</label><input id="account" placeholder="hathor">'+
    '<label>Symbol</label><input id="symbol" placeholder="MYTOK">'+
    '<label>To</label><input id="to" placeholder="bob">'+
    '<label>Quantity</label><input id="quantity" placeholder="10">',
  'engine:stake':'<label>Account</label><input id="account" placeholder="hathor">'+
    '<label>Symbol</label><input id="symbol" placeholder="DRONE">'+
    '<label>Quantity</label><input id="quantity" placeholder="10">',
  'engine:unstake':'<label>Account</label><input id="account" placeholder="hathor">'+
    '<label>Symbol</label><input id="symbol" placeholder="DRONE">'+
    '<label>Quantity</label><input id="quantity" placeholder="10">',
  'smt:create':'<label>Control account</label><input id="controlAccount" placeholder="hathor">'+
    '<label>NAI (from the live pool)</label><input id="nai" placeholder="@@422838704">'+
    '<label>Precision (0-8)</label><input id="precision" value="3">',
  'smt:setup':'<label>Control account</label><input id="controlAccount" placeholder="hathor">'+
    '<label>NAI</label><input id="nai" placeholder="@@422838704">'+
    '<label>Max supply (base units, integer)</label><input id="maxSupply" placeholder="1000000000">'+
    '<label>Precision (optional)</label><input id="precision" value="3">',
};
function renderForm(){
  const layer=document.getElementById('layer').value;
  const sel=document.getElementById('action');
  const cur=sel.value;
  sel.innerHTML=ACTIONS[layer].map(a=>'<option value="'+a[0]+'">'+a[1]+'</option>').join('');
  if([...sel.options].some(o=>o.value===cur))sel.value=cur;
  document.getElementById('form').innerHTML=FORMS[layer+':'+sel.value]||'';
}
function gather(){
  const p={};['account','symbol','name','precision','maxSupply','to','quantity','controlAccount','nai'].forEach(k=>{
    const el=document.getElementById(k);if(el)p[k]=el.value.trim();});
  const imm=document.getElementById('supplyCapImmutable');
  if(imm&&imm.checked)p.supplyCapImmutable=true;
  if(p.precision!=null&&p.precision!=='')p.precision=Number(p.precision);
  return p;
}
async function buildOp(){
  const out=document.getElementById('out');
  const layer=document.getElementById('layer').value;
  const action=document.getElementById('action').value;
  const p=gather();
  const account=p.account||p.controlAccount||'';
  try{
    const r=await fetch('/api/build',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({layer,action,account,params:p})});
    out.textContent=JSON.stringify(await r.json(),null,2);
  }catch(e){out.textContent='request failed: '+(e&&e.message||e);}
}
renderForm();
</script>`;

/** Render an engine token detail page (supply, holders, metadata). */
export function renderTokenDetail(view, holders) {
  if (!view) {
    return pageShell('Token not found', `<div class="card"><h2>Not found</h2>
      <p class="sub">No engine token by that symbol. <a href="/">back to tools</a></p></div>`);
  }
  const hRows = holders.map((h) => `<tr><td>@${esc(h.account)}</td>
    <td class="num">${esc(h.balance)}</td><td class="num">${esc(h.stake)}</td></tr>`).join('\n');
  const body = `
  <div class="card">
    <h2>${esc(view.symbol)} — ${esc(view.name)}</h2>
    <p><span class="pill">layer: engine</span><span class="pill">issuer @${esc(view.issuer)}</span>
      <span class="pill">precision ${esc(view.precision)}</span>
      ${view.immutable ? '<span class="pill">🔒 immutable cap</span>' : ''}</p>
    <table>
      <tr><th>Supply</th><td class="num">${esc(view.supply)}</td></tr>
      <tr><th>Max supply</th><td class="num">${esc(view.maxSupply)}</td></tr>
      <tr><th>Created block</th><td class="num">${esc(view.createdBlock)}</td></tr>
      ${view.url ? `<tr><th>URL</th><td><a href="${esc(view.url)}" rel="noopener noreferrer">${esc(view.url)}</a></td></tr>` : ''}
    </table>
  </div>
  <div class="card"><h2>Holders (${holders.length})</h2>
    <table><thead><tr><th>Account</th><th class="num">Liquid</th><th class="num">Staked</th></tr></thead>
      <tbody>${hRows || '<tr><td colspan=3>no holders yet</td></tr>'}</tbody></table>
  </div>`;
  return pageShell(`${view.symbol} · MELEK Token Tools`, body);
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

function send(res, code, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

/**
 * makeHandler(deps) -> handler(req,res).
 * deps = { state?, smtSummary? } — both injectable for offline tests.
 */
export function makeHandler(deps = {}) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;

      if (path === '/' || path === '/index.html') {
        const combined = await combinedTokenList(deps);
        return send(
          res, 200,
          pageShell('MELEK Token Tools', renderTokenList(combined) + renderBuilder(), BUILDER_SCRIPT),
          'text/html; charset=utf-8',
        );
      }

      if (path === '/api/tokens') {
        return send(res, 200, await combinedTokenList(deps));
      }

      if (path.startsWith('/token/')) {
        const symbol = decodeURIComponent(path.slice('/token/'.length)).toUpperCase();
        if (!isValidSymbol(symbol)) return send(res, 404, renderTokenDetail(null), 'text/html; charset=utf-8');
        const t = deps.state && deps.state.findOne ? deps.state.findOne('tokens', { symbol }) : null;
        const view = t ? engineTokenView(t) : null;
        const holders = view ? engineHolders(deps.state, symbol) : [];
        return send(res, view ? 200 : 404, renderTokenDetail(view, holders), 'text/html; charset=utf-8');
      }

      if (path === '/api/build' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          return send(res, 400, { ok: false, error: 'invalid JSON body' });
        }
        const result = buildFromRequest(body);
        return send(res, result.ok ? 200 : 400, result);
      }

      return send(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      // soft-fail: never leak a stack, never crash the process
      return send(res, 500, { ok: false, error: String((e && e.message) || e) });
    }
  };
}

// ---- CLI -------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('token-tools.mjs')) {
  // Best-effort live serve: attach the real engine state + smt reader when
  // available. Falls back to empties so the page still renders.
  const { createServer } = await import('node:http');
  let state = null;
  try {
    const { State } = await import('./state.mjs');
    const { bootstrapGenesis } = await import('./genesis.mjs');
    state = new State(config.stateFile);
    if (typeof state.load === 'function') state.load();
    if (state.collection('tokens').length === 0) bootstrapGenesis(state);
  } catch { /* no state — page still renders */ }
  let smtSummary = null;
  try {
    ({ smtSummary } = await import('../../integrations/smt-info.mjs'));
  } catch { /* no smt reader */ }
  const port = Number(process.env.TOKEN_TOOLS_PORT || 8098);
  const host = process.env.TOKEN_TOOLS_HOST || '127.0.0.1';
  createServer(makeHandler({ state, smtSummary })).listen(port, host, () => {
    console.log(`[token-tools] listening http://${host}:${port}`);
  });
}
