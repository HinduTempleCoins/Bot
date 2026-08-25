// site/gauge/server.mjs — the KULA Gauge & veKULA vertical: the LIVE governance surface that wires the
// farm MODEL (kula-farm.mjs) to the deployed VoteEscrow + GaugeController via kula-gauge.mjs. It shows:
//   - current gauge weights (where KULA emissions flow, per gauge)                [read: gaugeWeights]
//   - the connected wallet's veKULA voting power + lock                          [read: veBalanceOf]
//   - a "Lock KULA for veKULA" form → an UNSIGNED create_lock/increase tx        [build: buildLockTx]
//   - a "Vote your gauge weights" form → an UNSIGNED vote_for_gauge_weights tx   [build: buildVoteTx]
// Every tx is client-signed in the user's own wallet (Akasha / MELEK-Signer) — this server NEVER holds
// keys and never signs. Reads are soft-fail: the page renders even when the RPC returns nothing.
//
//   PORT=8191 BASE_URL=https://gauge.alpha.melek.salon node site/gauge/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /              gauge weights + veKULA power + lock form + vote form
//   /api/gauge     JSON: resolved addresses + live gauge weights (soft-fail)
//   /api/lock-tx   JSON: an unsigned buildLockTx descriptor (?amount=&unlockTime=)
//   /api/vote-tx   JSON: an unsigned buildVoteTx descriptor (?gauge=&weightBps=)
//   /api/ve        JSON: veBalanceOf for ?account=0x… (soft-fail)
//   /health /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// House style: ESM, esc() every interpolation, handler(req,res) exported for tests, CLI guard scoped to
// site/gauge/, reuses the shared crawlers/seo/impact-utt helpers. Alpha badge on the live surface.

import { createServer } from 'node:http';

import {
  veBalanceOf, gaugeWeights, buildLockTx, buildVoteTx, projectLock,
  voteEscrowAddr, gaugeControllerAddr, gaugeLive, manifest, esc,
} from '../../kulaswap/kula-gauge.mjs';
import { DEFAULT_SPLIT, veBoost } from '../../kulaswap/kula-farm.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8191);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const RPC_URL = process.env.PRANA_RPC_URL || 'https://rpc.prana.alpha.melek.salon';
const FARM_SITE = process.env.FARM_SITE || 'https://farm.soapbox.community';
const SITE_NAME = 'KULA Gauge';

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const sendHtml = (res, html, code = 200) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
};

const STYLE = `<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff;--purple:#9a7bff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 a{color:var(--gold);text-decoration:none}a:hover{text-decoration:underline}
 .wrap{max-width:920px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;margin:6px 0 4px}.brand{font-size:24px;font-weight:800}.brand b{color:var(--gold)}
 .alpha{position:relative;font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
 .lead{color:var(--mut);font-size:14px;margin:2px 0 16px}
 h2{font-size:15px;margin:20px 0 10px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
 .panel{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px 16px;margin-bottom:14px}
 table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--bd)}
 th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
 .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
 .track{height:8px;background:#0e131b;border:1px solid var(--bd);border-radius:6px;overflow:hidden;margin-top:4px}
 .fill{height:100%;background:linear-gradient(90deg,var(--green),var(--gold))}
 .mut{color:var(--mut)}.warn{color:var(--gold);font-weight:700}.ok{color:var(--green);font-weight:700}
 .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
 input,select{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:8px 12px}
 button{font:inherit;font-weight:700;border:1px solid var(--bd);border-radius:10px;padding:8px 14px;cursor:pointer;background:#0e131b;color:var(--fg)}
 button.gold{background:var(--gold);color:#1a1306;border-color:var(--gold)}
 .who{font-size:12px;color:var(--green)}.big{font-size:22px;font-weight:800;color:var(--gold)}
 .note{font-size:12px;color:var(--mut);margin-top:8px;word-break:break-word}
 pre{white-space:pre-wrap;word-break:break-all;background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:9px 11px;font-size:11px;margin-top:8px}
 .statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:12px}
 .statgrid>div{background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:2px}
 .statgrid .mut{font-size:11px}.statgrid b{font-size:16px;font-variant-numeric:tabular-nums}
 .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:640px){.cols{grid-template-columns:1fr}}
 footer{color:var(--mut);font-size:12px;text-align:center;margin:22px 0 8px}
</style>`;

// ── model → HTML (pure, esc()'d) ────────────────────────────────────────────────────────────────
function gaugeRows(weights) {
  if (!Array.isArray(weights) || weights.length === 0) {
    return `<tr><td colspan=3 class=mut>Gauge data unavailable — the GaugeController may be undeployed on this net, or the RPC is unreachable. Weights load live once wired.</td></tr>`;
  }
  return weights.map((w) => `<tr>
    <td class=mono>${esc(w.gauge)}</td>
    <td>${esc(w.pct)}%<div class=track><div class=fill style="width:${esc(Math.min(100, w.pct))}%"></div></div></td>
    <td>${esc(w.bps)} bps</td></tr>`).join('');
}

function boostTable() {
  return [13, 26, 52, 104, 208].map((w) => {
    const b = veBoost({ lockWeeks: w });
    return `<tr><td>${esc((w / 52).toFixed(1))} yr <span class=mut>(${esc(w)}w)</span></td><td class=ok>${esc(b)}×</td></tr>`;
  }).join('');
}

export function page({ weights = [], live = false } = {}) {
  const ve = esc(voteEscrowAddr());
  const gc = esc(gaugeControllerAddr());
  const status = live
    ? '<span class=ok>live</span>'
    : '<span class=warn>not yet wired</span> — VoteEscrow/GaugeController resolve to the current testnet stake-lock contract; reads/votes activate once the ve+gauge deploys are wired in config';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>KULA Gauge &amp; veKULA — vote emissions, lock for power</title>
${headTags({
  title: `${SITE_NAME} — vote KULA emissions with veKULA`,
  description: 'Lock KULA for veKULA voting power and vote your gauge weights to steer KULA emissions. Unsigned txs, client-signed in your own wallet. PRANA testnet.',
  canonical: `${BASE_URL}/`, siteName: SITE_NAME, robots: 'index,follow,max-image-preview:large',
  site: { url: BASE_URL, name: SITE_NAME },
})}${STYLE}${impactUtt()}</head><body><div class=wrap>
<header><span class=brand>⚖️ <b>KULA</b> Gauge</span><span class=alpha>Alpha</span></header>
<p class=lead>Lock <b>KULA</b> → <b>veKULA</b> voting power, then vote your weight across the gauges to steer where KULA emissions flow. Every transaction is <b>unsigned</b> here and <b>signed in your own wallet</b> (Akasha / MELEK-Signer) — this page never holds your keys. PRANA testnet.</p>

<div class=panel>
 <div class=mut style="font-size:13px">Governance status: ${status}.</div>
 <div class=statgrid>
  <div><span class=mut>VoteEscrow (veKULA)</span><b class=mono>${ve}</b></div>
  <div><span class=mut>GaugeController</span><b class=mono>${gc}</b></div>
 </div>
</div>

<h2>Gauge weights — where KULA emissions flow</h2>
<div class=panel style="padding:6px 12px">
 <table><thead><tr><th>Gauge</th><th>Relative weight</th><th>bps</th></tr></thead>
 <tbody>${gaugeRows(weights)}</tbody></table>
 <div class=note>Weights are the on-chain GaugeController relative weights (1e18-scaled fractions). Emissions are split across gauges in proportion to these each epoch.</div>
</div>

<div class=cols>
 <div>
  <h2>Your veKULA power</h2>
  <div class=panel>
   <div class=row>
    <button id=connect>Connect Wallet</button>
    <input id=acct placeholder="…or 0x address" autocomplete=off spellcheck=false>
    <button id=load>Load</button>
    <span class=who id=who></span>
   </div>
   <div class=statgrid id=vestats style="display:none">
    <div><span class=mut>veKULA power</span><b id=v-power>—</b></div>
    <div><span class=mut>locked KULA</span><b id=v-locked>—</b></div>
    <div><span class=mut>unlock</span><b id=v-unlock>—</b></div>
   </div>
   <div id=veout class=note></div>
  </div>
 </div>
 <div>
  <h2>Lock boost curve</h2>
  <div class=panel style="padding:6px 12px">
   <table><thead><tr><th>Lock</th><th>Reward boost</th></tr></thead><tbody>${boostTable()}</tbody></table>
   <div class=note>Longer lock → bigger veKULA power, a bigger boost on farm rewards, and more gauge vote weight.</div>
  </div>
 </div>
</div>

<h2>Lock KULA for veKULA</h2>
<div class=panel>
 <div class=mut style="font-size:13px">Lock KULA to mint <b>veKULA</b> — non-transferable voting power that decays to zero at unlock. Approve KULA to the VoteEscrow first, then sign the lock in your wallet.</div>
 <div class=row>
  <input id=lockAmt type=number min=0 step=any placeholder="KULA to lock">
  <select id=lockWeeks>
   <option value=13>3 months</option><option value=26>6 months</option>
   <option value=52 selected>1 year</option><option value=104>2 years</option><option value=208>4 years (max)</option>
  </select>
  <button class=gold id=lock>Build Lock Tx</button>
 </div>
 <div id=lockproj class=note></div>
 <div id=lockout class=note></div>
</div>

<h2>Vote your gauge weights</h2>
<div class=panel>
 <div class=mut style="font-size:13px">Point your veKULA weight (in basis points, up to 10000 = 100% of your power) at a gauge. Sign the vote in your wallet.</div>
 <div class=row>
  <input id=voteGauge placeholder="gauge address 0x…" autocomplete=off spellcheck=false class=mono style="flex:1;min-width:220px">
  <input id=voteBps type=number min=0 max=10000 step=1 placeholder="weight (bps)">
  <button class=gold id=vote>Build Vote Tx</button>
 </div>
 <div id=voteout class=note></div>
</div>

<footer>Emissions are governed on-chain. <a href="/api/gauge">api</a> · <a href="${esc(FARM_SITE)}">🌾 KULA Farm</a></footer>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id),who=$('who'),veout=$('veout'),vestats=$('vestats');
async function loadVe(){const a=$('acct').value.trim();if(!/^0x[0-9a-fA-F]{40}$/.test(a)){veout.textContent='Enter a 0x address (or connect a wallet).';return;}
 who.textContent=a.slice(0,6)+'…'+a.slice(-4);veout.textContent='loading…';
 try{const d=await(await fetch('/api/ve?account='+encodeURIComponent(a),{cache:'no-store'})).json();
  if(!d||!d.ok||!d.ve){veout.textContent='No veKULA data (contract may be undeployed or RPC unreachable).';vestats.style.display='none';return;}
  $('v-power').textContent=d.ve.veKula;$('v-locked').textContent=d.ve.lockedAmount==null?'—':d.ve.lockedAmount;
  $('v-unlock').textContent=d.ve.unlockTime?new Date(d.ve.unlockTime*1000).toISOString().slice(0,10):'—';
  vestats.style.display='grid';veout.textContent='';}
 catch(e){veout.textContent='Could not reach the RPC.';}}
async function buildLock(){const amt=$('lockAmt').value.trim(),weeks=+$('lockWeeks').value;
 if(!(Number(amt)>0)){$('lockout').textContent='Enter a KULA amount to lock.';return;}
 const unlock=Math.floor(Date.now()/1000)+weeks*7*86400;
 // base units: KULA is 18-decimals; scale here for the descriptor (string math to avoid float loss).
 const base=(BigInt(Math.floor(Number(amt)*1e6))*(10n**12n)).toString();
 try{const d=await(await fetch('/api/lock-tx?amount='+base+'&unlockTime='+unlock)).json();
  if(!d||!d.ok){$('lockout').textContent='Cannot build: '+esc((d&&d.error)||'ve not deployed');return;}
  if(d.projection)$('lockproj').innerHTML='Projected: <b class=warn>'+esc(d.projection.boost)+'×</b> reward boost · vote weight <b>'+esc(d.projection.voteWeight)+'</b>';
  $('lockout').innerHTML='Sign this in your wallet (approve KULA to the VoteEscrow first):<pre>'+esc(JSON.stringify(d.tx,null,2))+'</pre>';}
 catch(e){$('lockout').textContent='Error building the lock tx.';}}
async function buildVote(){const g=$('voteGauge').value.trim(),bps=$('voteBps').value.trim();
 if(!/^0x[0-9a-fA-F]{40}$/.test(g)){$('voteout').textContent='Enter a valid gauge address.';return;}
 if(!(Number(bps)>=0)){$('voteout').textContent='Enter a weight in bps (0–10000).';return;}
 try{const d=await(await fetch('/api/vote-tx?gauge='+encodeURIComponent(g)+'&weightBps='+encodeURIComponent(bps))).json();
  if(!d||!d.ok){$('voteout').textContent='Cannot build: '+esc((d&&d.error)||'gauge controller not deployed');return;}
  $('voteout').innerHTML='Sign this in your wallet:<pre>'+esc(JSON.stringify(d.tx,null,2))+'</pre>';}
 catch(e){$('voteout').textContent='Error building the vote tx.';}}
$('load').onclick=loadVe;$('lock').onclick=buildLock;$('vote').onclick=buildVote;
$('acct').addEventListener('keydown',e=>{if(e.key==='Enter')loadVe();});
$('connect').onclick=async()=>{if(window.ethereum){try{const ac=await window.ethereum.request({method:'eth_requestAccounts'});if(ac&&ac[0]){$('acct').value=ac[0];loadVe();}}catch(e){veout.textContent='Wallet connection cancelled.';}}else{veout.textContent='No browser wallet — paste a 0x address.';}};
</script>
</div></body></html>`;
}

// ── routing ────────────────────────────────────────────────────────────────────────────────────
export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'daily', priority: '1.0' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Lock KULA for veKULA voting power and vote gauge weights to steer KULA emissions. Reads VoteEscrow + GaugeController; builds unsigned txs signed client-side in the user\'s own wallet. Never holds keys.',
        links: [{ label: 'Gauge & veKULA', path: '/' }, { label: 'API', path: '/api/gauge' }],
      }));
    }

    // JSON: resolved addresses + live gauge weights (soft-fail to []).
    if (path === '/api/gauge') {
      const weights = await gaugeWeights({ rpcUrl: RPC_URL });
      return json(res, 200, { ok: true, ...manifest(), weights });
    }

    // JSON: veKULA position for an account (soft-fail).
    if (path === '/api/ve') {
      const account = (url.searchParams.get('account') || '').trim();
      const ve = await veBalanceOf({ account, rpcUrl: RPC_URL });
      return json(res, 200, { ok: true, account, ve });
    }

    // JSON: an unsigned lock descriptor (+ a projection from the model). amount is base units.
    if (path === '/api/lock-tx') {
      const amount = url.searchParams.get('amount') || '';
      const unlockTime = url.searchParams.get('unlockTime') || '';
      const tx = buildLockTx({ amount, unlockTime });
      if (!tx) return json(res, 200, { ok: false, error: 'bad amount or VoteEscrow not deployed' });
      // Projection: derive lockWeeks from unlockTime for the boost/vote-weight preview (illustrative).
      const now = Math.floor(Date.now() / 1000);
      const weeks = unlockTime ? Math.max(0, Math.round((Number(unlockTime) - now) / (7 * 86400))) : 0;
      const projection = projectLock({ amount: Number(amount) / 1e18, lockWeeks: weeks });
      return json(res, 200, { ok: true, tx, projection });
    }

    // JSON: an unsigned gauge-vote descriptor.
    if (path === '/api/vote-tx') {
      const gauge = url.searchParams.get('gauge') || '';
      const weightBps = url.searchParams.get('weightBps') || '';
      const tx = buildVoteTx({ gauge, weightBps });
      if (!tx) return json(res, 200, { ok: false, error: 'bad gauge/bps or GaugeController not deployed' });
      return json(res, 200, { ok: true, tx });
    }

    if (path === '/') {
      // Soft-fail: render even when the RPC returns nothing.
      const weights = await gaugeWeights({ rpcUrl: RPC_URL });
      return sendHtml(res, page({ weights, live: gaugeLive() }));
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests
export { DEFAULT_SPLIT };

// Only bind the port when run directly (scoped to site/gauge/), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/gauge\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`KULA Gauge on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
