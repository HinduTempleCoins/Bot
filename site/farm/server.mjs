// site/farm/server.mjs — the KULA Token Farm page: where you FARM OUR TOKENS (DeFi yield-farming), as
// distinct from the SEED grow game (seeds.soapbox.community). Surfaces the real kulaswap/kula-farm.mjs model:
// the KULA emission split across surfaces (mine/provide LP/stake/lottery/dividend/contribute), illustrative
// pool APRs, the veKULA lock-boost curve, the no-loss lottery pot, and the SOMA→KULA burn. Pure server-render
// from the model (deterministic). Live TVL/price come from chain readers later — APR figures are labelled
// illustrative testnet parameters until then. House style: ESM, esc(), handler(req,res), Alpha badge.
//
//   PORT=8161 node site/farm/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SPLIT, emissionSplit, poolApr, veBoost, lotteryPot, burnSomaForTickets,
} from '../../kulaswap/kula-farm.mjs';
import { buildForeverLockOp } from '../../engine/lib/op-builder.mjs';

const PORT = +(process.env.PORT || 8161);
const HOST = process.env.HOST || '127.0.0.1';
const ENGINE_API = process.env.ENGINE_API || 'https://engine.alpha.melek.salon';
const STAKE_TOKEN = (process.env.STAKE_TOKEN || 'WMELEK').toUpperCase();

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
async function getJson(url) { try { const r = await _fetch(url); return r && r.ok ? r.json() : null; } catch { return null; } }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const num = (n) => Number(n).toLocaleString('en-US');

// ── illustrative testnet parameters (real values come from on-chain readers later) ──
const EPOCH_EMISSION = +(process.env.KULA_EPOCH_EMISSION || 1_000_000);   // KULA minted per epoch
const EPOCHS_PER_YEAR = 365;
const KULA_PRICE_USD = +(process.env.KULA_PRICE_USD || 0.10);

const SURFACES = {
  miners: { label: 'Mine', emoji: '⛏️', desc: 'PRANA useful-work miners (SBD-floored pay)' },
  lp: { label: 'Provide', emoji: '💧', desc: 'KulaSwap liquidity providers (LP gauge)' },
  stakers: { label: 'Stake', emoji: '🔒', desc: 'single-stake KULA / veKULA boost pool' },
  lottery: { label: 'Lottery', emoji: '🎟️', desc: 'no-loss lotto prize seed' },
  dividend: { label: 'Dividend', emoji: '💸', desc: 'real-yield buffer' },
  contributors: { label: 'Contribute', emoji: '🧠', desc: 'proof-of-brain / tasks / games' },
};

function farmModel() {
  const perEpoch = emissionSplit({ emission: EPOCH_EMISSION });
  const surfaces = Object.entries(DEFAULT_SPLIT).map(([k, bps]) => ({
    key: k, ...(SURFACES[k] || { label: k, emoji: '•', desc: '' }),
    bps, pct: +(bps / 100).toFixed(2), perEpoch: perEpoch[k] || 0,
    perYear: Math.round((perEpoch[k] || 0) * EPOCHS_PER_YEAR),
  }));
  // illustrative pools: yearly emission to the pool (from its surface) vs a sample TVL → APR
  const lpYear = (perEpoch.lp || 0) * EPOCHS_PER_YEAR;
  const stakeYear = (perEpoch.stakers || 0) * EPOCHS_PER_YEAR;
  const pools = [
    { name: 'KULA · MELEK LP', kind: 'Provide', tvlUsd: 250_000, yearly: lpYear,
      apr: poolApr({ yearlyEmissionToPool: lpYear, kulaPriceUsd: KULA_PRICE_USD, poolTvlUsd: 250_000 }) },
    { name: 'KULA · SOMA LP', kind: 'Provide', tvlUsd: 80_000, yearly: lpYear * 0.0,
      apr: poolApr({ yearlyEmissionToPool: lpYear * 0.4, kulaPriceUsd: KULA_PRICE_USD, poolTvlUsd: 80_000 }) },
    { name: 'KULA single-stake', kind: 'Stake', tvlUsd: 120_000, yearly: stakeYear,
      apr: poolApr({ yearlyEmissionToPool: stakeYear, kulaPriceUsd: KULA_PRICE_USD, poolTvlUsd: 120_000 }) },
  ];
  const boosts = [13, 26, 52, 104, 208].map((w) => ({ weeks: w, years: +(w / 52).toFixed(1), boost: veBoost({ lockWeeks: w }) }));
  const lotto = lotteryPot({ swapFeesUsd: 5000, emissionToLottery: perEpoch.lottery || 0, kulaPriceUsd: KULA_PRICE_USD });
  const ticketEx = burnSomaForTickets({ somaIn: 100, somaPerTicket: 1, veKula: 1000 });
  return {
    epochEmission: EPOCH_EMISSION, kulaPriceUsd: KULA_PRICE_USD,
    surfaces, pools, boosts, lotto, ticketEx,
  };
}

function page() {
  const m = farmModel();
  const bar = (s) => `<div class=srow>
    <div class=sl><span class=emo>${esc(s.emoji)}</span> <b>${esc(s.label)}</b> <span class=mut>${esc(s.desc)}</span></div>
    <div class=track><div class=fill style="width:${esc(Math.min(100, s.pct))}%"></div></div>
    <div class=sv>${esc(s.pct)}% · ${esc(num(s.perYear))} KULA/yr</div>
  </div>`;
  const poolRow = (p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class=tag>${esc(p.kind)}</span></td>
    <td>$${esc(num(p.tvlUsd))}</td><td class=apr>${esc(p.apr)}%</td></tr>`;
  const boostRow = (b) => `<tr><td>${esc(b.years)} yr <span class=mut>(${esc(b.weeks)}w)</span></td><td class=apr>${esc(b.boost)}×</td></tr>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>KULA Farm — MELEK</title>
<meta name=description content="Farm the MELEK tokens — provide liquidity, stake & lock KULA, earn emissions. PRANA testnet.">
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff;--purple:#9a7bff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 .wrap{max-width:920px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;margin:6px 0 4px}.brand{font-size:24px;font-weight:800}.brand b{color:var(--gold)}
 .alpha{font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
 .lead{color:var(--mut);font-size:14px;margin:2px 0 16px}
 h2{font-size:15px;margin:20px 0 10px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
 .panel{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px 16px;margin-bottom:14px}
 .srow{display:grid;grid-template-columns:1fr;gap:4px;margin:10px 0}
 .sl{font-size:14px}.sl .emo{font-size:15px}.sl .mut{font-size:12px}
 .track{height:8px;background:#0e131b;border:1px solid var(--bd);border-radius:6px;overflow:hidden}
 .fill{height:100%;background:linear-gradient(90deg,var(--green),var(--gold))}
 .sv{font-size:12px;color:var(--mut)}
 table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--bd)}
 th{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
 .apr{color:var(--green);font-weight:700}.tag{font-size:10px;color:var(--blue);border:1px solid var(--blue);border-radius:6px;padding:2px 6px}
 .mut{color:var(--mut)}.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:640px){.cols{grid-template-columns:1fr}}
 .big{font-size:22px;font-weight:800;color:var(--gold)}.note{font-size:12px;color:var(--mut);margin-top:8px;word-break:break-word}
 .warn{color:var(--gold);font-weight:700}
 .stakerow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
 input{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:8px 12px}
 button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:8px 14px;cursor:pointer;background:#0e131b;color:var(--fg);border:1px solid var(--bd)}
 button.gold{background:var(--gold);color:#1a1306;border-color:var(--gold)}
 .who{font-size:12px;color:var(--green)}
 .statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:12px}
 .statgrid>div{background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:2px}
 .statgrid .mut{font-size:11px}.statgrid b{font-size:16px;font-variant-numeric:tabular-nums}
 pre{white-space:pre-wrap;word-break:break-all;background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:9px 11px;font-size:11px;margin-top:8px}
 footer{color:var(--mut);font-size:12px;text-align:center;margin:22px 0 8px}a{color:var(--gold)}
</style></head><body><div class=wrap>
<header><span class=brand>🌾 <b>KULA</b> Farm</span><span class=alpha>Alpha</span></header>
<p class=lead>Farm our tokens — <b>provide</b> liquidity, <b>stake</b> &amp; lock KULA, <b>mine</b> useful work, and earn KULA emissions. The grow game (planting seeds) is at <a href="https://seeds.soapbox.community">seeds.soapbox.community</a>; this is where you farm the <b>tokens</b>. PRANA testnet.</p>

<h2>Emission split — where KULA flows</h2>
<div class=panel>
 <div class=mut style="font-size:13px">Each epoch mints <b style="color:var(--fg)">${esc(num(m.epochEmission))} KULA</b>, split by governance across the reward surfaces:</div>
 ${m.surfaces.map(bar).join('')}
</div>

<div class=cols>
 <div>
  <h2>Pools &amp; APR</h2>
  <div class=panel style="padding:6px 12px">
   <table><thead><tr><th>Pool</th><th>Type</th><th>TVL</th><th>APR</th></tr></thead>
   <tbody>${m.pools.map(poolRow).join('')}</tbody></table>
   <div class=note>Illustrative at KULA $${esc(m.kulaPriceUsd)} / sample TVL — live figures wire from chain readers.</div>
  </div>
 </div>
 <div>
  <h2>Lock KULA → veKULA boost</h2>
  <div class=panel style="padding:6px 12px">
   <table><thead><tr><th>Lock</th><th>Reward boost</th></tr></thead>
   <tbody>${m.boosts.map(boostRow).join('')}</tbody></table>
   <div class=note>Longer lock → bigger share of the same rewards, plus gauge vote weight + the fee dividend.</div>
  </div>
 </div>
</div>

<h2>No-loss lottery</h2>
<div class=panel>
 <div class=big>$${esc(num(m.lotto.potUsd))} <span style="font-size:13px;color:var(--mut);font-weight:400">epoch pot</span></div>
 <div class=mut style="font-size:13px">Seeded by a cut of swap fees ($${esc(num(m.lotto.fromFeesUsd))}) + a slice of emissions ($${esc(num(m.lotto.fromEmissionUsd))}). Your deposit never burns — only the yield funds the prize. Burn <b>SOMA</b> for tickets; locked KULA boosts your tickets (e.g. 100 SOMA + 1,000 veKULA → <b style="color:var(--fg)">${esc(m.ticketEx.tickets)} tickets</b>).</div>
</div>

<h2>Permanently stake wMELEK → APIS-Hash</h2>
<div class=panel>
 <div class=mut style="font-size:13px">The KULA DeFi mining mint: <b>forever-lock</b> wMELEK and it mints <b>soulbound APIS-Hash</b> 1:1, which mines <b>APIS</b> on the fixed schedule. <span class=warn>Permanent — there is no unstake.</span> Non-custodial: you sign in your own wallet.</div>
 <div class=stakerow>
   <button id=connect>Connect Wallet</button>
   <input id=acct placeholder="…or MELEK account" autocomplete=off spellcheck=false>
   <button id=load>Load</button>
   <span class=who id=who></span>
 </div>
 <div class=statgrid id=stats style="display:none">
   <div><span class=mut>wMELEK liquid</span><b id=s-wmelek>—</b></div>
   <div><span class=mut>your APIS-Hash</span><b id=s-hash>—</b></div>
   <div><span class=mut>pending APIS</span><b id=s-pending>—</b></div>
   <div><span class=mut>network APIS/day</span><b id=s-emit>—</b></div>
 </div>
 <div class=stakerow>
   <input id=amt type=number min=0 step=any placeholder="wMELEK to forever-lock">
   <button class=gold id=lock>Forever-Lock</button>
 </div>
 <div id=stakeout class=note></div>
</div>
<footer>One MELEK account, one token economy. Seasons &amp; emissions are on-chain. <a href="/api/farm">api</a> · <a href="https://seeds.soapbox.community">🌱 Seeds (grow)</a> · <a href="https://arcade.soapbox.community">← GTArcade</a></footer>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id),who=$('who'),stats=$('stats'),out=$('stakeout');
async function load(){const a=$('acct').value.trim().replace(/^@/,'').toLowerCase();if(!a){out.textContent='Enter your MELEK account.';return;}
 who.textContent='@'+a;out.textContent='loading…';
 try{const d=await(await fetch('/api/apishash?account='+encodeURIComponent(a),{cache:'no-store'})).json();
  if(!d||!d.ok){out.textContent='Could not load.';return;}
  $('s-wmelek').textContent=d.wmelek;$('s-hash').textContent=d.apisHash;$('s-pending').textContent=d.pending;$('s-emit').textContent=d.emissionPerDay==null?'—':d.emissionPerDay;
  stats.style.display='grid';out.textContent='';}
 catch(e){out.textContent='Engine unreachable — try again.';}}
async function lock(){const a=$('acct').value.trim().replace(/^@/,'').toLowerCase();const amt=$('amt').value.trim();
 if(!a){out.textContent='Enter your MELEK account first.';return;}
 if(!(Number(amt)>0)){out.textContent='Enter an amount of wMELEK to forever-lock.';return;}
 out.innerHTML='<span class=warn>This is PERMANENT (no unstake).</span> building op…';
 try{const d=await(await fetch('/api/stake-op?account='+encodeURIComponent(a)+'&amount='+encodeURIComponent(amt))).json();
  if(!d||!d.ok){out.textContent='Cannot build: '+esc((d&&d.error)||'unknown');return;}
  out.innerHTML='<span class=warn>'+esc(d.summary)+'</span><br>Sign this custom_json in your wallet (Akasha / MELEK Signer) to confirm — it cannot be undone:<pre>'+esc(JSON.stringify(d.op,null,2))+'</pre>';}
 catch(e){out.textContent='Error building the op.';}}
$('load').onclick=load;$('lock').onclick=lock;
$('acct').addEventListener('keydown',e=>{if(e.key==='Enter')load();});
$('connect').onclick=async()=>{if(window.ethereum){try{const ac=await window.ethereum.request({method:'eth_requestAccounts'});if(ac&&ac[0]){who.textContent=ac[0].slice(0,6)+'…'+ac[0].slice(-4);if(!$('acct').value)out.textContent='Wallet connected. Enter your MELEK account to load engine-side balances.';else load();}}catch(e){out.textContent='Wallet connection cancelled.';}}else{out.textContent='No browser wallet — enter your MELEK account.';}};
const qa=new URLSearchParams(location.search).get('account');if(qa){$('acct').value=qa;load();}
</script>
</div></body></html>`;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://farm.local');
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname === '/api/farm') return json(res, 200, { ok: true, ...farmModel() });
    // your wMELEK liquid + APIS-Hash + pending APIS + network emission (proxied from the live engine API).
    if (url.pathname === '/api/apishash') {
      const account = (url.searchParams.get('account') || '').replace(/^@/, '').toLowerCase();
      if (!account) return json(res, 200, { ok: false, reason: 'no-account' });
      const a = encodeURIComponent(account);
      const [bal, hash, pend, emit] = await Promise.all([
        getJson(`${ENGINE_API}/contracts/balances?account=${a}&symbol=${STAKE_TOKEN}`),
        getJson(`${ENGINE_API}/contracts/workerbee/apishash?account=${a}`),
        getJson(`${ENGINE_API}/contracts/workerbee/pending?account=${a}`),
        getJson(`${ENGINE_API}/contracts/workerbee`),
      ]);
      const wmelek = (Array.isArray(bal) && bal[0] && bal[0].balance) || '0';
      const apisHash = (hash && (hash.apisHash ?? hash.hash)) || '0';
      const pending = (pend && (pend.pending ?? pend.pendingApis ?? pend.apis)) || '0';
      const emissionPerDay = (emit && (emit.emissionPerDay ?? emit.perDay ?? emit.emission)) ?? null;
      return json(res, 200, { ok: true, account, stakeToken: STAKE_TOKEN, wmelek, apisHash, pending, emissionPerDay });
    }
    // build the (unsigned) workerbee.foreverLock op — the user signs it in their own wallet (non-custodial).
    if (url.pathname === '/api/stake-op') {
      const account = (url.searchParams.get('account') || '').replace(/^@/, '').toLowerCase();
      const amount = url.searchParams.get('amount') || '';
      const built = buildForeverLockOp(account, { amount });
      return json(res, 200, built.ok ? { ok: true, op: built.op, summary: built.summary } : { ok: false, error: built.error });
    }
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`KULA Farm on http://${HOST}:${PORT}`));
}
