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
import { hubTiles, tileState, progressSummary, ABIS, hasAddr } from './hub-model.mjs';
import { CHAINS } from '../../kulaswap/kula-config.mjs';

const PORT = +(process.env.PORT || 8161);
const HOST = process.env.HOST || '127.0.0.1';
// Engine reads point at the MAINNET engine when configured, else the live testnet engine (as now).
const ENGINE_API = process.env.ENGINE_API || 'https://engine.alpha.melek.salon';
const STAKE_TOKEN = (process.env.STAKE_TOKEN || 'WMELEK').toUpperCase();

// ── PRANA (EVM) config for the burn-mine + MWALI-gauge tiles. Single source of truth = kula-config's
//    prana-mainnet entry (KULA + MWALI + Router/Factory), plus the bridge-backed LP pair addresses and
//    the two contracts that go live later (BurnMine + the MWALI LiquidityGauge) via env overrides. Keys
//    NEVER touch the server — the client signs every EVM tx in its own wallet. ────────────────────────
function pranaConfig() {
  const c = (CHAINS && (CHAINS['prana-mainnet'] || CHAINS.prana)) || {};
  return {
    name: c.name || 'PRANA',
    chainId: c.chainId || 712217,
    chainIdHex: c.chainIdHex || '0xADE19',
    rpcUrl: c.rpcUrl || 'https://rpc.prana.melek.salon',
    explorer: c.explorer || 'https://pranascan.soapbox.community',
    router: c.router || '',
    kula: c.kula || '',
    mwali: c.pol || '',                                   // MWALI = the PoL / liquidity reward token
    burnMine: process.env.PRANA_BURNMINE || '',           // BurnMine — set once deployed on mainnet
    gauge: process.env.PRANA_GAUGE_MWALI || '',           // MWALI LiquidityGauge — set once deployed (staged)
    lp: {
      wvkbtKula: process.env.PRANA_LP_WVKBT_KULA || '0xE3e01d327bC2bee7a5754c1E7Ff23158E017688E',
      wcureKula: process.env.PRANA_LP_WCURE_KULA || '0x521786d5ede921c7E8f248796acA10e5370149a3',
    },
  };
}

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

// The guided-hub tiles (server-rendered grey; the client lights them as it detects on-chain state /
// local completion marks). Mirrors the Mining Pool's "direction + grey tiles that light up" UX.
function hubTilesForRender() {
  return hubTiles({ engine: { stakeToken: STAKE_TOKEN }, prana: pranaConfig() });
}

function renderTile(t) {
  const state = tileState(t, {});   // server render = baseline (grey/gated); client re-paints on load.
  const badge = t.gated
    ? '<span class=tstatus data-status=gated>Coming soon</span>'
    : '<span class=tstatus data-status=grey>To do</span>';
  const stepDots = t.steps.map((_, i) => `<span class=dot data-i="${esc(i)}"></span>`).join('');
  return `<button class="tile ${esc(state)}" data-tile="${esc(t.id)}" data-gated="${t.gated ? '1' : '0'}" type=button>
    <div class=tnum>${esc(t.num)}</div>
    <div class=temoji>${esc(t.emoji)}</div>
    <div class=tbody>
      <div class=ttitle>${esc(t.title)}</div>
      <div class=ttag>${esc(t.tagline)}</div>
      <div class=tdots>${stepDots}</div>
    </div>
    ${badge}
  </button>`;
}

function stepList(t) {
  return `<ol class=steps>${t.steps.map((s) => `<li><b>${esc(s.label)}</b><span class=mut> — ${esc(s.detail)}</span></li>`).join('')}</ol>`;
}

// Per-tile detail panel: what/why/warning + the steps + the action area (the action wiring lives in the
// client script, keyed by data-panel). Engine tile reuses the existing forever-lock panel below.
function renderDetail(t, prana) {
  const head = `<div class=dhead><span class=demoji>${esc(t.emoji)}</span><div><h3>${esc(t.title)}</h3><div class=mut>${esc(t.tagline)}</div></div></div>`;
  const whatWhy = `<p class=what>${esc(t.what)}</p><p class=why><b>Why:</b> ${esc(t.why)}</p>` +
    (t.warn ? `<p class=warn>⚠ ${esc(t.warn)}</p>` : '');
  const gated = t.gated
    ? `<div class=gate>${esc(t.gateReason || 'Not live on this network yet.')}</div>` : '';

  let action = '';
  if (t.id === 'burnmine') {
    action = `<div class=act data-panel=burnmine ${t.gated ? 'data-gated=1' : ''}>
      <div class=arow><input id=bm-input placeholder="input token 0x… (the token to burn)" autocomplete=off spellcheck=false></div>
      <div class=arow><input id=bm-amt type=number min=0 step=any placeholder="amount to burn"><button class=gold id=bm-go>Approve &amp; Burn-Mine</button></div>
      <div id=bm-out class=note></div></div>`;
  } else if (t.id === 'liquidity') {
    const pairs = (t.action.pairs || []).map((p) => `<option value="${esc(p.address)}">${esc(p.name)}</option>`).join('');
    action = `<div class=act data-panel=liquidity ${t.gated ? 'data-gated=1' : ''}>
      <div class=note>Add liquidity on <a href="https://alpha.kula.money" target=_blank rel=noopener>KulaSwap</a> to get LP tokens, then stake them here to earn <b>MWALI</b>.</div>
      <div class=arow><select id=lp-pair>${pairs || '<option>LP pairs load once the gauge is live</option>'}</select></div>
      <div class=arow><input id=lp-amt type=number min=0 step=any placeholder="LP amount to stake"><button class=gold id=lp-stake>Approve &amp; Stake LP</button></div>
      <div class=arow><button id=lp-claim>Claim MWALI</button><span class=who id=lp-earned></span></div>
      <div id=lp-out class=note></div></div>`;
  } else if (t.id === 'apis') {
    action = `<div class=act data-panel=apis><div class=note>The forever-lock action is in the <a href="#apis-panel">Permanently stake ${esc(STAKE_TOKEN)}</a> panel below.</div></div>`;
  } else {
    action = `<div class=act data-panel=vekula><div class=note>The emission split, pool APRs and the veKULA lock-boost curve are in the sections below. Locking KULA → veKULA is done in the <a href="https://alpha.kula.money" target=_blank rel=noopener>KulaSwap</a> lock UI.</div>
      <div class=arow><button id=ve-mark>I've locked KULA → mark done</button></div></div>`;
  }
  return `<div class=detail id="detail-${esc(t.id)}" hidden>${head}${whatWhy}${gated}${stepList(t)}${action}</div>`;
}

function page() {
  const prana = pranaConfig();
  const tiles = hubTilesForRender();
  const prog = progressSummary(tiles, {});
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
 /* ── guided hub: progress meter + grey→lit tiles (Mining-Pool "direction + tiles that light up") ── */
 .progwrap{display:flex;align-items:center;gap:10px;margin:6px 0 14px}
 .progbar{flex:1;height:10px;background:#0e131b;border:1px solid var(--bd);border-radius:6px;overflow:hidden}
 .progbar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--green),var(--gold));transition:width .4s}
 .progtxt{font-size:12px;color:var(--mut);white-space:nowrap}
 .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:4px 0 6px}
 .tile{position:relative;display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:10px;text-align:left;
   background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:13px 14px;cursor:pointer;color:var(--fg);font:inherit;
   opacity:.62;transition:opacity .25s,border-color .2s,box-shadow .2s}
 .tile:hover{opacity:1;border-color:var(--blue)}
 .tile .tnum{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;
   background:#0e131b;border:1px solid var(--bd);color:var(--mut)}
 .tile .temoji{font-size:22px;filter:grayscale(.7)}
 .tile .ttitle{font-size:14px;font-weight:700;line-height:1.25}.tile .ttag{font-size:12px;color:var(--mut);margin-top:1px}
 .tile .tdots{display:flex;gap:4px;margin-top:6px}
 .tile .dot{width:7px;height:7px;border-radius:50%;background:#0e131b;border:1px solid var(--bd)}
 .tile .dot.on{background:var(--green);border-color:var(--green)}
 .tstatus{position:absolute;top:9px;right:10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;
   border-radius:999px;padding:2px 7px;border:1px solid var(--bd);color:var(--mut)}
 /* LIT tile: full colour, green ring, coloured emoji + number */
 .tile.lit{opacity:1;border-color:var(--green);box-shadow:inset 0 0 0 1px var(--green)}
 .tile.lit .temoji{filter:none}.tile.lit .tnum{background:var(--green);border-color:var(--green);color:#04160f}
 .tile.lit .tstatus{color:var(--green);border-color:var(--green)}
 /* GATED tile: dashed, dimmer, gold "coming soon" */
 .tile.gated{border-style:dashed;opacity:.5}.tile.gated .tstatus{color:var(--gold);border-color:var(--gold)}
 .tile.active{opacity:1;border-color:var(--gold);box-shadow:inset 0 0 0 1px var(--gold)}
 .detail{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px 16px;margin:0 0 14px}
 .dhead{display:flex;gap:12px;align-items:center;margin-bottom:6px}.dhead .demoji{font-size:26px}.dhead h3{margin:0;font-size:16px}
 .what{font-size:14px;margin:8px 0}.why{font-size:13px;color:var(--mut);margin:6px 0}
 .gate{font-size:12px;color:var(--gold);border:1px solid var(--gold);border-radius:10px;padding:8px 11px;margin:8px 0}
 ol.steps{margin:8px 0;padding-left:22px;font-size:13px;line-height:1.7}ol.steps b{color:var(--fg)}
 .act{margin-top:10px}.act[data-gated="1"]{opacity:.55;pointer-events:none}
 .arow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
 select{font:inherit;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:10px;padding:8px 12px}
</style></head><body><div class=wrap>
<header><span class=brand>🌾 <b>KULA</b> Farm</span><span class=alpha>Alpha</span></header>
<p class=lead>The Yield Farm is <b>Witness School for earning</b> — a guided hub that teaches <b>and</b> lets you do staking, burn-mining, hash-rate earning and regular yield farming, one step at a time. Grey tiles light up as you complete each one. The grow game (planting seeds) is at <a href="https://seeds.soapbox.community">seeds.soapbox.community</a>; this is where you farm the <b>tokens</b>.</p>

<h2>Your farm path</h2>
<div class=progwrap>
  <div class=progbar><i id=progfill style="width:${esc(prog.pct)}%"></i></div>
  <div class=progtxt id=progtxt>${esc(prog.done)} of ${esc(prog.total)} lit${prog.gated ? ` · ${esc(prog.gated)} coming soon` : ''}</div>
</div>
<div class=tiles id=tiles>${tiles.map(renderTile).join('')}</div>
<div id=details>${tiles.map((t) => renderDetail(t, prana)).join('')}</div>

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

<h2 id=apis-panel>Permanently stake wMELEK → APIS-Hash</h2>
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
<footer>One MELEK account, one token economy. Seasons &amp; emissions are on-chain. <a href="/api/farm">api</a> · <a href="https://seeds.soapbox.community">🌱 Seeds (grow)</a> · <a href="https://arcade.soapbox.community">← SoapBox Arcade</a></footer>
<script>
window.__FARM__=${JSON.stringify({
  prana, abis: ABIS,
  tiles: tiles.map((t) => ({ id: t.id, gated: t.gated, lit: t.lit })),
}).replace(/</g, '\\u003c')};
</script>
<script>
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id),who=$('who'),stats=$('stats'),out=$('stakeout');
async function load(){const a=$('acct').value.trim().replace(/^@/,'').toLowerCase();if(!a){out.textContent='Enter your MELEK account.';return;}
 who.textContent='@'+a;out.textContent='loading…';
 try{const d=await(await fetch('/api/apishash?account='+encodeURIComponent(a),{cache:'no-store'})).json();
  if(!d||!d.ok){out.textContent='Could not load.';return;}
  $('s-wmelek').textContent=d.wmelek;$('s-hash').textContent=d.apisHash;$('s-pending').textContent=d.pending;$('s-emit').textContent=d.emissionPerDay==null?'—':d.emissionPerDay;
  stats.style.display='grid';out.textContent='';if(window.__farmOnEngine)window.__farmOnEngine(d);}
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
<script>
// ── Guided-hub tiles: open detail on click, light tiles as the user participates. Keys never touch the
//    server — every EVM action is signed in the user's own wallet (ethers lazy-loaded, like KulaSwap). ──
(function(){
  const F=window.__FARM__||{prana:{},tiles:[],abis:{}};
  const P=F.prana||{};
  const MK='melek.farm.marks';
  const getMarks=()=>{try{return JSON.parse(localStorage.getItem(MK)||'{}')}catch(e){return{}}};
  const setMark=k=>{try{const m=getMarks();m[k]=true;localStorage.setItem(MK,JSON.stringify(m));}catch(e){}};
  const state={engine:{},onchain:{},marks:getMarks()};
  const tilesEl=document.getElementById('tiles');
  const q=s=>document.querySelector(s), qa2=s=>Array.from(document.querySelectorAll(s));

  function openTile(id){
    qa2('.detail').forEach(d=>{d.hidden=(d.id!=='detail-'+id);});
    qa2('.tile').forEach(t=>t.classList.toggle('active', t.dataset.tile===id && !t.classList.contains('lit')));
    const d=document.getElementById('detail-'+id); if(d) d.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  tilesEl&&qa2('.tile').forEach(t=>t.addEventListener('click',()=>openTile(t.dataset.tile)));

  function paint(){
    let done=0,gated=0;const total=F.tiles.length||1;
    F.tiles.forEach(spec=>{
      const el=tilesEl&&tilesEl.querySelector('.tile[data-tile="'+spec.id+'"]'); if(!el)return;
      if(spec.gated){gated++;return;}
      const L=spec.lit||{};let lit=false;
      if(L.source==='engine') lit=Number(state.engine[L.field]||0)>(L.gt||0);
      else if(L.source==='onchain') lit=Number(state.onchain[L.field]||0)>(L.gt||0);
      else if(L.source==='local') lit=!!(state.marks[L.mark]||state.marks[spec.id]);
      if(lit){done++;el.classList.add('lit');el.classList.remove('active');
        const st=el.querySelector('.tstatus');if(st){st.textContent='Done';st.dataset.status='lit';}
        el.querySelectorAll('.dot').forEach(dt=>dt.classList.add('on'));}
    });
    const pf=document.getElementById('progfill'),pt=document.getElementById('progtxt');
    if(pf)pf.style.width=Math.round(done/total*100)+'%';
    if(pt)pt.textContent=done+' of '+total+' lit'+(gated?' · '+gated+' coming soon':'');
  }
  window.__farmOnEngine=d=>{ if(d) state.engine.apisHash=Number(d.apisHash||0); paint(); };

  // ── EVM helpers (lazy ethers; PRANA mainnet) ──
  let _e=null,_signer=null;
  async function E(){ if(_e)return _e; _e=await import('https://esm.sh/ethers@6'); return _e; }
  async function signer(){
    if(!window.ethereum) throw new Error('No EVM wallet — install MetaMask/Akasha.');
    const e=await E();
    const want='0x'+Number(P.chainId).toString(16);
    try{ await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:want}]}); }
    catch(err){ if(err&&err.code===4902){ await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:want,chainName:P.name,rpcUrls:[P.rpcUrl],nativeCurrency:{name:P.name,symbol:P.name,decimals:18},blockExplorerUrls:[P.explorer]}]}); } }
    const prov=new e.BrowserProvider(window.ethereum);
    await prov.send('eth_requestAccounts',[]);
    _signer=await prov.getSigner();
    return _signer;
  }
  async function erc20(addr){ const e=await E(); return new e.Contract(addr,F.abis.ERC20,await signer()); }
  async function ensureAllowance(tokenAddr,spender,amtWei){
    const t=await erc20(tokenAddr); const s=await _signer.getAddress();
    const cur=await t.allowance(s,spender);
    if(cur<amtWei){ const tx=await t.approve(spender,amtWei); await tx.wait(); }
  }
  async function parseAmt(tokenAddr,amt){ const e=await E(); const t=await erc20(tokenAddr); let d=18; try{d=Number(await t.decimals());}catch(x){} return e.parseUnits(String(amt),d); }

  // Tile 2 — burn-mine (approve input, mine)
  const bmGo=document.getElementById('bm-go');
  bmGo&&bmGo.addEventListener('click',async()=>{
    const out=document.getElementById('bm-out'); out.textContent='';
    const input=(document.getElementById('bm-input').value||'').trim();
    const amt=(document.getElementById('bm-amt').value||'').trim();
    if(!/^0x[0-9a-fA-F]{40}$/.test(input)){out.textContent='Enter the input token address (0x…).';return;}
    if(!(Number(amt)>0)){out.textContent='Enter an amount to burn.';return;}
    if(!/^0x[0-9a-fA-F]{40}$/.test(P.burnMine||'')){out.textContent='Burn Mine not deployed on this network yet.';return;}
    try{ out.textContent='Approving…'; const e=await E(); const wei=await parseAmt(input,amt);
      await ensureAllowance(input,P.burnMine,wei);
      out.textContent='Burning + minting KULA…';
      const mine=new e.Contract(P.burnMine,F.abis.BurnMine,_signer);
      const tx=await mine.mine(wei); const rc=await tx.wait();
      out.innerHTML='Mined ✓ tx '+esc(rc.hash); setMark('burnmine'); state.marks=getMarks(); paint();
    }catch(err){ out.textContent='Failed: '+esc((err&&err.message)||'error'); }
  });

  // Tile 3 — liquidity gauge (stake LP, claim MWALI, read earned/balance)
  async function gaugeC(){ const e=await E(); return new e.Contract(P.gauge,F.abis.LiquidityGauge,await signer()); }
  const lpStake=document.getElementById('lp-stake'),lpClaim=document.getElementById('lp-claim');
  async function refreshEarned(){
    if(!/^0x[0-9a-fA-F]{40}$/.test(P.gauge||''))return;
    try{ const g=await gaugeC(); const s=await _signer.getAddress(); const e=await E();
      const [bal,earned]=await Promise.all([g.balanceOf(s),g.earned(s)]);
      state.onchain.gaugeStaked=Number(e.formatUnits(bal,18)); paint();
      const el=document.getElementById('lp-earned'); if(el) el.textContent='earned '+e.formatUnits(earned,18)+' MWALI';
    }catch(x){}
  }
  lpStake&&lpStake.addEventListener('click',async()=>{
    const out=document.getElementById('lp-out'); out.textContent='';
    const pair=(document.getElementById('lp-pair')||{}).value||'';
    const amt=(document.getElementById('lp-amt').value||'').trim();
    if(!/^0x[0-9a-fA-F]{40}$/.test(P.gauge||'')){out.textContent='The MWALI gauge is not deployed yet (staged).';return;}
    if(!/^0x[0-9a-fA-F]{40}$/.test(pair)){out.textContent='Pick an LP pair.';return;}
    if(!(Number(amt)>0)){out.textContent='Enter an LP amount to stake.';return;}
    try{ out.textContent='Approving LP…'; const wei=await parseAmt(pair,amt);
      await ensureAllowance(pair,P.gauge,wei);
      out.textContent='Staking LP in the gauge…'; const g=await gaugeC();
      const tx=await g.stake(wei); const rc=await tx.wait();
      out.innerHTML='Staked ✓ tx '+esc(rc.hash); refreshEarned();
    }catch(err){ out.textContent='Failed: '+esc((err&&err.message)||'error'); }
  });
  lpClaim&&lpClaim.addEventListener('click',async()=>{
    const out=document.getElementById('lp-out'); out.textContent='';
    if(!/^0x[0-9a-fA-F]{40}$/.test(P.gauge||'')){out.textContent='The MWALI gauge is not deployed yet (staged).';return;}
    try{ out.textContent='Claiming MWALI…'; const g=await gaugeC(); const tx=await g.getReward(); const rc=await tx.wait();
      out.innerHTML='Claimed MWALI ✓ tx '+esc(rc.hash); refreshEarned();
    }catch(err){ out.textContent='Failed: '+esc((err&&err.message)||'error'); }
  });

  // Tile 4 — veKULA: local "I locked" mark (the lock itself happens in the KulaSwap lock UI)
  const veMark=document.getElementById('ve-mark');
  veMark&&veMark.addEventListener('click',()=>{ setMark('vekula'); state.marks=getMarks(); paint(); veMark.textContent='Marked ✓'; });

  paint();
})();
</script>
</div></body></html>`;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://farm.local');
    if (url.pathname === '/health') return json(res, 200, { ok: true });
    if (url.pathname === '/api/farm') return json(res, 200, { ok: true, ...farmModel() });
    // the guided-hub tile model (what each mechanic is, its steps, whether it's live on this network).
    if (url.pathname === '/api/hub') {
      const tiles = hubTilesForRender();
      return json(res, 200, { ok: true, tiles, progress: progressSummary(tiles, {}) });
    }
    // PRANA (EVM) config the client needs to sign burn-mine / MWALI-gauge tx in its OWN wallet. Public
    // addresses only — no keys, ever. gauge/burnMine are '' until deployed (staged).
    if (url.pathname === '/api/prana') {
      const p = pranaConfig();
      return json(res, 200, { ok: true, ...p, gaugeLive: hasAddr(p.gauge), burnMineLive: hasAddr(p.burnMine) });
    }
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
