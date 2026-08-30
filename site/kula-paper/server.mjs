// server.mjs — The KULA Paper: the public economic spec for the PRANA / KULA economy.
//
// A single canonical, public economic paper (the Berachain-Honeypaper analog) covering the whole
// PRANA/KULA economy: the see-saw compute model, KULA (reward/DeFi token), MWALI (proof-of-liquidity),
// APIS (MELEK-Engine fee token), the CDP, veKULA boost, BurnMine, gauges/GaugeController, the bridge,
// and the non-cashable arcade. It is the repo doc KULA_PAPER.md rendered as a house-style site page.
//
// HONEST TONE (load-bearing): this is a description of MECHANISM, not a forecast. No price promises,
// no yield guarantees, no investment advice. Every figure is a protocol parameter governance can change.
//
//   PORT=8248 BASE_URL=https://kula.money node site/kula-paper/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the KULA Paper (full economic spec)
//   /health      liveness probe → {"ok":true}
//   /robots.txt  crawler allow + sitemap pointer
//   /sitemap.xml the page's own sitemap
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value; safeHref() on any URL. ZERO request-time network — every figure
//   is a cited static constant from the mainnet deploy record. Soft-fail: every route renders, unknown
//   path → 404, never a 500. Small "Alpha" badge top-left. handler(req,res) exported for offline tests.

import { createServer } from 'node:http';

const PORT = +(process.env.PORT || 8248);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'The KULA Paper';
// Path-routing proxy awareness (mirrors site/gambling): routes stay on '/', we PREPEND BASE_PATH to
// every self-URL we emit. Default '' → standalone behaviour unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
// The PRANA block explorer (Blockscout) where the contracts below are/are being source-verified.
const EXPLORER = (process.env.PRANASCAN_URL || 'https://pranascan.soapbox.community').replace(/\/$/, '');
// The repo doc this page mirrors (for readers who want the raw markdown).
const REPO_DOC = process.env.KULA_PAPER_DOC || 'https://github.com/HinduTempleCoins/Bot/blob/main/KULA_PAPER.md';

// ── house-style helpers ──────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only real http(s) URLs pass; javascript:/data:/junk → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── canonical mainnet addresses (PRANA, chainId 712217) — from deployments.json kula{} ─────────────
export const CHAIN_ID = 712217;
export const ADDR = Object.freeze({
  KULA: '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631',
  MWALI: '0x36C6921e2CECe9DEc7a5AAC42bC6738011F2a1c9',
  WPRANA: '0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34',
  Router: '0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5',
  Factory: '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6',
  PairKulaWprana: '0x3fC307dEa06667f5a7a640Ec0aBb950EacC4B8C2',
  VoteEscrow: '0x2a9da080BB38C9cfc4B9c8D7cFd4699fF57a5438',
  GaugeController: '0x3858Bcd8CEE92FBDB0ECBC3946C67C112416A63C',
  LiquidityGauge_KULA_WPRANA: '0x46d92Ae6F5D55Eb5f12F222e44F0CDAC74E38e45',
  DividendDistributor_Stakers: '0xd9B52f758Aaab68BdEde7F84bE9bF6b2353E479A',
  DividendDistributor_Miners: '0x52a32920d4635AE0ab7F77b54679e9359D6Fa778',
  NoLossLotto: '0xfE5CC3c2919c893a33690bf6b36d58Ae5A989dB3',
  SimplePriceOracle: '0x905B3505037E49771B35F9f3944D8EC2B9eF3AFD',
  MelekBorrowNote: '0x8c4B882D7379D35413E2a9202f63B53f893D1A9D',
  CDPVault: '0x9cdAe72de19F93947cE3B4d5329FA81A5ef53ba2',
  Timelock: '0x574DeEaa82BcA4ACF6C5669D8dbe084C28EE0da4',
  GrapheneDepositBridge: '0xf8245a4c9A8af47760C45D8393A74Ea8EEF1E505',
  EmissionScheduler: '0x611Ad02Ebe7F3FfE2050449Def20d6775E875323',
  PRANA: '0xE92E94C4929ea9D6EF7BFB8B3e192D66951Ab661',
});

// the address table rows (label, key, role) — order is the reading order
export const ADDR_ROWS = [
  ['KULA', 'KULA', 'reward / DeFi token — emission-only, cap 11M'],
  ['MWALI', 'MWALI', 'proof-of-liquidity token'],
  ['WPRANA', 'WPRANA', 'wrapped native PRANA'],
  ['Router', 'Router', 'KulaSwap (Uniswap-V2) router'],
  ['Factory', 'Factory', 'KulaSwap pair factory'],
  ['Pair KULA/WPRANA', 'PairKulaWprana', 'the Kula-Ring liquidity pair'],
  ['VoteEscrow (veKULA)', 'VoteEscrow', 'lock KULA → boost + votes'],
  ['GaugeController', 'GaugeController', 'directs KULA emission across pools'],
  ['LiquidityGauge (KULA/WPRANA)', 'LiquidityGauge_KULA_WPRANA', 'mints MWALI to LPs'],
  ['DividendDistributor (stakers)', 'DividendDistributor_Stakers', 'staker real-yield'],
  ['DividendDistributor (miners)', 'DividendDistributor_Miners', 'miner dividend'],
  ['NoLossLotto', 'NoLossLotto', 'no-loss prize pot'],
  ['SimplePriceOracle', 'SimplePriceOracle', 'CDP collateral price'],
  ['MelekBorrowNote (mMELEK)', 'MelekBorrowNote', 'CDP borrow synthetic'],
  ['CDPVault', 'CDPVault', 'lock KULA → borrow'],
  ['DAO Timelock', 'Timelock', '2-day admin timelock'],
  ['GrapheneDepositBridge', 'GrapheneDepositBridge', 'MELEK ↔ PRANA bridge'],
  ['EmissionScheduler', 'EmissionScheduler', 'sole KULA minter'],
  ['PRANA (compute)', 'PRANA', 'compute-stack settlement token'],
];

// the KULA emission split (bps→%): 45 miners / 35 LPs / 10 lotto / 10 stakers
export const SPLIT = [
  ['Miners', 45, 'useful-work providers (the see-saw of §1) — the biggest slice on purpose'],
  ['LPs', 35, 'streamed by the LiquidityGauge to KULA/WPRANA liquidity providers'],
  ['Lottery', 10, 'seeds the NoLossLotto prize pot'],
  ['Stakers', 10, 'real-yield to KULA stakers via DividendDistributor'],
];

// live compute-stack parameters (mainnet, deployed 2026-08-29)
export const COMPUTE_PARAMS = [
  ['epochLength', '3600 s', 'one settlement epoch = 1 hour'],
  ['windowEpochs', '3', 'rolling window the pot averages over'],
  ['epochIssuance', '1000 · 10¹⁸', 'fixed pot minted per epoch, split pro-rata'],
  ['burnWeight', '1 · 10¹⁸', 'weight of burn-credited shares in the split'],
  ['coordinatorMinBond', '1000 · 10¹⁸', 'bond a job coordinator must post'],
  ['attestorMinStake', '100 · 10¹⁸', 'stake an attester must post (slashable)'],
];

const STYLE = `<style>
  :root{--bg:#0f1216;--panel:#161b22;--ink:#e8edf3;--mut:#9aa7b4;--line:#232c37;--accent:#e8b04b;--good:#57c98a;--link:#7fb4ff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--link)}
  .topbar{display:flex;align-items:center;gap:14px;padding:12px 20px;background:#12161c;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
  .brand{font-weight:700;color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:8px}
  .brand span.n{color:var(--accent)}
  .alpha{font-size:11px;font-weight:700;letter-spacing:.5px;background:var(--accent);color:#111;padding:2px 7px;border-radius:6px;text-transform:uppercase}
  .topnav{margin-left:auto;display:flex;gap:16px;font-size:13.5px}
  .topnav a{color:var(--mut);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:28px 22px 80px}
  h1{font-size:30px;line-height:1.2;margin:.2em 0 .1em}
  h2{font-size:21px;margin:1.8em 0 .5em;padding-top:.4em;border-top:1px solid var(--line)}
  h3{font-size:16px;margin:1.2em 0 .3em}
  .sub{color:var(--mut);font-size:16px;margin:.2em 0 1.2em}
  .lead{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:14px 16px;margin:16px 0}
  .note{background:#1a1410;border:1px solid #3a2c17;border-radius:8px;padding:12px 15px;font-size:13.5px;color:#d9c7a6;margin:16px 0}
  .meta{display:flex;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--mut);margin:.4em 0 1.2em}
  .meta b{color:var(--ink)}
  code{background:#0b0e12;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12.5px;word-break:break-all}
  .tblwrap{overflow-x:auto;margin:14px 0}
  table{border-collapse:collapse;width:100%;font-size:13.5px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
  td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
  .split{display:flex;height:26px;border-radius:6px;overflow:hidden;margin:12px 0;border:1px solid var(--line)}
  .split div{display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;color:#0b0e12}
  .toc{columns:2;column-gap:26px;font-size:13.5px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 18px;margin:18px 0}
  .toc a{display:block;color:var(--link);text-decoration:none;padding:2px 0}
  .foot{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:12.5px}
  .pill{display:inline-block;background:#0b2a1c;color:var(--good);border:1px solid #1e4d38;border-radius:20px;padding:2px 10px;font-size:12px;font-weight:600}
</style>`;

function shell(title, inner, opts = {}) {
  const desc = opts.description
    || 'The public economic spec for the PRANA / KULA economy: the see-saw compute model, KULA, MWALI, APIS, the CDP, veKULA, gauges, the bridge, and the non-cashable arcade. Mechanism, not a forecast.';
  const canonical = opts.canonical || `${BASE_URL}${opts.path || '/'}`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<link rel=canonical href="${esc(canonical)}">
${STYLE}</head><body>
<header class=topbar>
  <a class=brand href="${bp('/')}">🪷 <span class=n>KULA</span> Paper <span class=alpha>Alpha</span></a>
  <nav class=topnav>
    <a href="${esc(safeHref(EXPLORER) || '#')}">Explorer</a>
    <a href="${esc(safeHref(REPO_DOC) || '#')}">Repo doc</a>
  </nav>
</header>
<main class=wrap>${inner}</main>
</body></html>`;
}

// explorer link for an address (address page on Blockscout)
function ex(addr) {
  const base = safeHref(EXPLORER);
  return base ? `${base.replace(/\/$/, '')}/address/${esc(addr)}` : '';
}

function addrTableHtml() {
  const rows = ADDR_ROWS.map(([label, key, role]) => {
    const a = ADDR[key];
    const href = ex(a);
    const cell = href ? `<a href="${esc(href)}"><code>${esc(a)}</code></a>` : `<code>${esc(a)}</code>`;
    return `<tr><td>${esc(label)}</td><td>${cell}</td><td>${esc(role)}</td></tr>`;
  }).join('');
  return `<div class=tblwrap><table>
    <thead><tr><th>Contract</th><th>Address</th><th>Role</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function computeTableHtml() {
  const rows = COMPUTE_PARAMS.map(([k, v, m]) =>
    `<tr><td><code>${esc(k)}</code></td><td class=n>${esc(v)}</td><td>${esc(m)}</td></tr>`).join('');
  return `<div class=tblwrap><table>
    <thead><tr><th>Parameter</th><th>Value</th><th>Meaning</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function splitBarHtml() {
  const colors = ['#e8b04b', '#7fb4ff', '#c98ad6', '#57c98a'];
  const bar = SPLIT.map(([label, pct], i) =>
    `<div style="flex:${pct};background:${colors[i]}">${esc(label)} ${pct}%</div>`).join('');
  const rows = SPLIT.map(([label, pct, note]) =>
    `<tr><td>${esc(label)}</td><td class=n>${pct}%</td><td>${esc(note)}</td></tr>`).join('');
  return `<div class=split>${bar}</div>
    <div class=tblwrap><table><tbody>${rows}</tbody></table></div>`;
}

// ── the paper ──────────────────────────────────────────────────────────────────────────────────────
function paperHtml() {
  return `
<h1>The KULA Paper</h1>
<p class=sub>The public economic spec for the PRANA / KULA economy.</p>
<div class=meta>
  <span class=pill>Live on PRANA mainnet</span>
  <span><b>Chain:</b> EVM chainId <code>712217</code></span>
  <span><b>Version:</b> 1.0 — 2026-08-30</span>
</div>
<div class=note><b>Tone:</b> this is a description of mechanism, not a forecast. Nothing here is a price
  promise, a yield guarantee, or investment advice. Emissions decay, sinks compete for the same tokens,
  and every number below is a protocol parameter that governance can change. Always read the current
  on-chain values and the <a href="${esc(safeHref(EXPLORER) || '#')}">verified source</a> before acting.</div>

<div class=toc>
  <a href="#seesaw">1 · The see-saw compute model</a>
  <a href="#kula">2 · KULA — reward / DeFi token</a>
  <a href="#mwali">3 · MWALI — proof-of-liquidity</a>
  <a href="#apis">4 · APIS — MELEK-Engine fee token</a>
  <a href="#veKULA">5 · veKULA — boost + governance</a>
  <a href="#cdp">6 · CDP — lock KULA, borrow mMELEK</a>
  <a href="#sinks">7 · Sinks — lottery, burn-mine, dividends</a>
  <a href="#bridge">8 · The bridge</a>
  <a href="#arcade">9 · The arcade — non-cashable PLAY</a>
  <a href="#gov">10 · Governance &amp; custody</a>
  <a href="#addrs">11 · Canonical addresses</a>
</div>

<h2 id=seesaw>1 · The see-saw compute model</h2>
<p>PRANA is an Ethash/Etchash-style EVM chain (core-geth fork), fair-launch, <b>no premine</b>. Beyond
  block reward and a sealed-at-genesis 2.00% protocol fee, its security budget comes from a
  <b>useful-work settlement pot</b> split across two lanes that draw from <b>one fixed per-epoch pot</b>,
  pro-rata across all verified work-shares:</p>
<ul>
  <li><b>HASH lane</b> — ordinary proof-of-work hashing, deliberately <i>thin</i>: enough to anchor the
    chain's ordering and liveness, not the whole reward. Credited by <code>HashLaneCreditor</code>.</li>
  <li><b>TASK / AI-work lane</b> — verified, redundantly-recomputed AI and compute jobs, credited only
    after passing a verification gate (<code>TaskVerificationGate</code>) that guards against fabricated
    work. Credited by <code>TaskLaneCreditor</code>.</li>
</ul>
<p>Both lanes write shares into one ledger (<code>UnifiedSharesLedger</code>) that pays the pot pro-rata.
  Because they share <b>one</b> pot, they <b>see-saw</b>: early on, hash-shares dominate; as real AI-work
  arrives, task-shares grow and <b>catch up</b> — pulling reward toward useful work with no re-minting and
  no schedule change. Hashing is the thin security floor; useful work is the intended long-run majority.
  Attesters who sign off on bad work are slashed; the cheapest way to earn the pot is to do the work.</p>
${computeTableHtml()}

<h2 id=kula>2 · KULA — the reward / DeFi token</h2>
<p><b>KULA</b> (<a href="${esc(ex(ADDR.KULA) || '#')}"><code>${esc(ADDR.KULA)}</code></a>) is the token the
  DeFi economy revolves around — the MasterChef/ve pattern, honestly parameterised.</p>
<ul>
  <li><b>Emission-only.</b> No premine, no treasury allocation. KULA is minted <i>only</i> by the
    <code>EmissionScheduler</code> (sole <code>MINTER_ROLE</code>); the deployer holds no minter role.
    Admin is the DAO Timelock (2-day delay); the deployer <b>renounced</b> admin.</li>
  <li><b>Supply.</b> ~1,000,000 KULA in year one, decaying <b>−10% per year</b>. That geometric series
    sums to roughly <b>10M</b> lifetime; the contract enforces a <b>hard cap of 11M</b> the schedule never
    reaches. A faucet with a decay, not a tap a person can open wider.</li>
  <li><b>The split.</b> Each emission is divided <b>45% miners / 35% LPs / 10% lottery / 10% stakers</b>.
    An hourly keeper computes what is due, applies the decay, routes each slice to its sink, and
    <i>defers</i> rather than dumping when all sinks are empty.</li>
</ul>
${splitBarHtml()}
<p>KULA is also the CDP collateral (§6) and the asset locked for veKULA boost + votes (§5). The off-chain
  model that tunes these parameters before they are pinned on-chain lives in
  <code>kulaswap/kula-farm.mjs</code>.</p>

<h2 id=mwali>3 · MWALI — the proof-of-liquidity token</h2>
<p><b>MWALI</b> (<a href="${esc(ex(ADDR.MWALI) || '#')}"><code>${esc(ADDR.MWALI)}</code></a>) is the
  <b>liquidity</b> token — KULA is not. It rewards and measures the liquidity that backs KULA.</p>
<ul>
  <li><b>Minted only by the gauge.</b> MWALI's sole <code>MINTER_ROLE</code> holder is the
    <code>LiquidityGauge_KULA_WPRANA</code>, which mints MWALI to liquidity providers of the KULA/WPRANA
    pair — the <b>Kula-Ring</b> pairing that ties MWALI issuance to real, on-chain liquidity depth.</li>
  <li><b>Emission-only, no human minter.</b> The deployer holds no <code>MINTER_ROLE</code>; admin is the
    DAO Timelock; the deployer renounced admin. MWALI cannot be printed by a person.</li>
  <li><b>Why a separate token.</b> Proof-of-Liquidity (Berachain's idea, adapted) separates the reward for
    <i>providing liquidity</i> (MWALI) from the reward token itself (KULA), so liquidity is a first-class,
    measurable, governance-relevant position rather than a side effect.</li>
</ul>

<h2 id=apis>4 · APIS — the MELEK-Engine fee token</h2>
<p><b>APIS</b> is the fee/utility token of MELEK-Engine, the Hive-Engine-style side-token layer for the
  MELEK Graphene chain (the "BEE" analogue) — burned to create tokens and pay engine resource fees. You
  earn it by the WorkerBee mechanic, re-mapped:</p>
<ol>
  <li><b>Forever-lock wMELEK.</b> Wrapped MELEK, once bridged to PRANA, can be <b>forever-locked</b> (no
    unstake) into the mine.</li>
  <li><b>Soulbound APIS-Hash.</b> A forever-lock mints <b>APIS-Hash</b>, a non-transferable mining-power
    unit — the staked-WORKERBEE equivalent.</li>
  <li><b>Mine APIS.</b> APIS-Hash drips APIS forever at your stake-weighted share of emission. It is not a
    loan: no debt, no liquidation, no cycle risk.</li>
</ol>
<p>The canonical off-chain mechanics live in <code>kulaswap/apis-workerbee.mjs</code>; the engine layer in
  <code>engine/README.md</code>.</p>

<h2 id=veKULA>5 · veKULA — lock for boost + governance</h2>
<p>Locking KULA into the <code>VoteEscrow</code> (max lock <b>4 years</b>) mints <b>veKULA</b>, the
  Curve-style vote-escrow position, which grants a <b>yield boost</b> (up to ~2.5×), <b>vote weight</b> to
  steer gauge emissions via the <code>GaugeController</code>, and <b>dividend eligibility</b> for the
  staker slice. veKULA decays as the lock ages, so voting power reflects ongoing commitment.</p>

<h2 id=cdp>6 · CDP — lock KULA, borrow mMELEK</h2>
<p>The <code>CDPVault</code> lets a KULA holder lock KULA and <b>borrow</b> a synthetic
  <b>MelekBorrowNote</b> ("mMELEK") at <b>50% LTV</b>, priced by a <code>SimplePriceOracle</code>. Two
  safety choices: (1) <b>mMELEK is not the bridge wMELEK</b> — the CDP mints its own synthetic so the
  bridge invariant (wMELEK supply == MELEK locked) is never touched by borrowing; (2) MelekBorrowNote's
  sole minter is the vault, admin is the DAO Timelock, deployer renounced admin.</p>

<h2 id=sinks>7 · Sinks — lottery, burn-mine, dividends</h2>
<p>Every emission is paired with a sink so the faucet can run indefinitely:</p>
<ul>
  <li><b>No-loss lottery</b> (<code>NoLossLotto</code>) — PoolTogether model: principal stays safe, yield
    plus the 10% KULA slice and a cut of fees funds prizes. Upside without risking capital.</li>
  <li><b>BurnMine</b> — burn proof-of-liquidity into KULA at a fixed ratio, plus a burn-to-enter raffle
    variant; a curated <code>BurnMineHub</code> hosts many burn contracts, each minting a curated output;
    the hub itself never mints.</li>
  <li><b>Dividends</b> (<code>DividendDistributor</code>, stakers + miners) — stake KULA, receive a
    pro-rata share of real fee yield.</li>
</ul>
<p>The design rule is explicit (<code>MintSinkGuard</code> in the contract set): every emission has a
  paired sink. That is what keeps a reward token from becoming a pure inflation machine.</p>

<h2 id=bridge>8 · The bridge</h2>
<p>MELEK (Graphene L1) connects to PRANA (EVM) through the <code>GrapheneDepositBridge</code>. MELEK locked
  on the Graphene side mints wMELEK on PRANA; burning wMELEK releases MELEK. A federated validator set
  (5 validators, <b>3-of-5</b> threshold) authorises mints. The core invariant is <b>wMELEK supply ==
  MELEK locked</b> — exactly why the CDP mints a separate synthetic instead of more wMELEK. The same
  wrapper pattern extends to wVKBT and wCURE.</p>

<h2 id=arcade>9 · The arcade — non-cashable PLAY</h2>
<p>The KULA Arcade runs on a <b>non-cashable PLAY token</b>. This is a hard compliance line, not a
  marketing choice: arcade play is a free, provably-fair, non-cashable play-token surface — never a wager,
  never a cash-out, geofenced, behind an education layer. Real-money mechanics are out of scope and stay
  behind counsel. Gambling education (house edge, RTP, −EV, responsible-gambling help on every page) is a
  separate surface.</p>

<h2 id=gov>10 · Governance &amp; custody posture</h2>
<ul>
  <li><b>No human minter.</b> KULA, MWALI, and MelekBorrowNote are all emission-only; their minter roles
    belong to contracts (EmissionScheduler, the gauge, the CDP vault), never to a person.</li>
  <li><b>DAO Timelock.</b> Admin over the token set is the DAO Timelock with a <b>2-day delay</b>; the
    deployer <b>renounced</b> admin on each token.</li>
  <li><b>Keys.</b> The emission keeper fetches its signing key just-in-time and never writes it to disk.
    No key material appears in this repo or on any public surface.</li>
  <li><b>Source, verifiable.</b> The mainnet contracts are being verified on the PRANA block explorer
    (Blockscout) so any third party can read the exact source behind every address below.</li>
</ul>

<h2 id=addrs>11 · Canonical mainnet addresses (PRANA, chainId 712217)</h2>
${addrTableHtml()}

<div class=foot>
  Grounded in the working code: <code>kulaswap/kula-farm.mjs</code>, <code>kulaswap/apis-workerbee.mjs</code>,
  <code>kulaswap/kula-cdp.mjs</code>, <code>engine/README.md</code>, and the mainnet deploy record.
  The full markdown is <a href="${esc(safeHref(REPO_DOC) || '#')}">KULA_PAPER.md</a> in the repo.
  Parameters here are the ones live at publication; governance can change any of them.
</div>`;
}

// ── sitemap / robots ────────────────────────────────────────────────────────────────────────────────
export function sitemapXml() {
  const loc = `${BASE_URL}${bp('/')}`;
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + `  <url><loc>${esc(loc)}</loc><priority>0.9</priority></url>\n`
    + '</urlset>\n';
}
export function robotsTxt() {
  return `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}${bp('/sitemap.xml')}\n`;
}

// ── handler ───────────────────────────────────────────────────────────────────────────────────────
export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt());
    }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml());
    }
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(shell('The KULA Paper — PRANA / KULA economic spec', paperHtml(), { path: '/' }));
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(shell('Not found — The KULA Paper', '<h1>404</h1><p>No such page. <a href="' + bp('/') + '">The KULA Paper &rarr;</a></p>', { path, robots: 'noindex' }));
  } catch {
    // soft-fail: never throw a 500 out of the handler
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch { /* ignore */ }
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/kula-paper\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`KULA Paper on http://${HOST}:${PORT}  (BASE_URL=${BASE_URL})`);
  });
}
