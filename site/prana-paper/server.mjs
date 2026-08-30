// server.mjs — The PRANA Paper: the public technical & consensus spec for the PRANA compute chain.
//
// The standalone chain-side companion to the KULA Paper. Where the KULA Paper specifies the ECONOMY
// (KULA/MWALI/APIS/CDP/gauges), this page specifies the CHAIN: Etchash PoW consensus, chain params,
// the 2% consensus Hathor fee, and the load-bearing "chain IS the pool" see-saw (HASH lane + TASK
// lane + BURN lane → one fixed per-epoch pot via the UnifiedSharesLedger, paid pro-rata). It is the
// repo doc PRANA_PAPER.md rendered as a house-style site page.
//
// HONEST TONE (load-bearing): this is a description of MECHANISM, not a forecast. No price promises,
// no yield guarantees. Every figure is a protocol parameter; the page marks which are PINNED at
// genesis and which are stated DESIGN INTENT (block cadence, emission decay) rather than inventing.
//
//   PORT=8249 BASE_URL=https://prana.melek.salon node site/prana-paper/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the PRANA Paper (full technical spec)
//   /health      liveness probe → {"ok":true}
//   /robots.txt  crawler allow + sitemap pointer
//   /sitemap.xml the page's own sitemap
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value; safeHref() on any URL. ZERO request-time network — every figure
//   is a static constant grounded in the sealed genesis + the PRANA client/contracts. Soft-fail: every
//   route renders, unknown path → 404, never a 500. Small "Alpha" badge top-left. handler(req,res)
//   exported for offline tests.

import { createServer } from 'node:http';

const PORT = +(process.env.PORT || 8249);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'The PRANA Paper';
// Path-routing proxy awareness (mirrors site/kula-paper): routes stay on '/', we PREPEND BASE_PATH to
// every self-URL we emit. Default '' → standalone behaviour unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
// The PRANA block explorer (Blockscout) where the native coin + contracts are source-verified.
const EXPLORER = (process.env.PRANASCAN_URL || 'https://pranascan.soapbox.community').replace(/\/$/, '');
// The public JSON-RPC endpoint.
const RPC_URL = (process.env.PRANA_RPC_URL || 'https://rpc.prana.melek.salon').replace(/\/$/, '');
// The deployed-contracts + ABIs registry (Witness School dev track).
const CONTRACTS_URL = (process.env.PRANA_CONTRACTS_URL || 'https://witness.melek.salon/dev/contracts').replace(/\/$/, '');
// The repo doc this page mirrors, and the economic-layer companion.
const REPO_DOC = process.env.PRANA_PAPER_DOC || 'https://github.com/HinduTempleCoins/Bot/blob/main/PRANA_PAPER.md';
const KULA_PAPER = process.env.KULA_PAPER_URL || 'https://github.com/HinduTempleCoins/Bot/blob/main/KULA_PAPER.md';

// ── house-style helpers ──────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only real http(s) URLs pass; javascript:/data:/junk → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── canonical chain facts (PRANA mainnet, chainId 712217) ──────────────────────────────────────────
export const CHAIN_ID = 712217;
export const CHAIN_ID_HEX = '0xADE19';
// The native PRANA settlement token (public; same value published in KULA_PAPER.md).
export const PRANA_TOKEN = '0xE92E94C4929ea9D6EF7BFB8B3e192D66951Ab661';

// Pinned genesis / consensus parameters — [label, value, source/note]. Changing any is a hard fork.
export const PINNED = [
  ['Chain ID', '712217 (0xADE19)', 'genesis config.chainId'],
  ['PoW algorithm', 'Etchash (Ethash + ECIP-1099 "Thanos")', 'ecip1099FBlock:0 → Etchash from block 0; low-VRAM / laptop-friendly. No RandomX.'],
  ['EVM fork level', 'through London @ block 0', 'londonBlock:0 → EIP-1559 base-fee + tip from genesis'],
  ['Base block reward', '2 PRANA / block', 'ConstantinopleBlockReward = 2e18 wei (constantinopleBlock:0)'],
  ['Initial supply / premine', '0 (empty alloc)', 'fair launch — supply accrues only from block production'],
  ['Hathor protocol fee', '2.00% (feeBps 200, activationBlock 0)', 'consensus-level fee on issuance — see §4'],
];

// Design-intent-but-not-pinned items (honest flag) — [label, intent, status].
export const DESIGN_INTENT = [
  ['Block time', '~13–15 s target', 'EMERGENT — Ethash difficulty retarget converges here; not a hard header constant'],
  ['Emission decay', '~10% / yr geometric', 'NOT YET PINNED — live reward is a flat 2 PRANA/block; decay is a documented EthashBlockRewardSchedule extension (needs a hard fork)'],
  ['Lane weights', 'HASH:TASK = 1:1 default', 'GOVERNED — DAO timelock can retune via HashTaskWeightConfig'],
];

// Live compute-stack settlement parameters (mainnet, deployed 2026-08-29) — governance-tunable.
export const COMPUTE_PARAMS = [
  ['epochLength', '3600 s', 'one settlement epoch = 1 hour'],
  ['windowEpochs', '3', 'trailing epochs the PPLNS window averages over'],
  ['epochIssuance', '1000 · 10¹⁸', 'fixed pot minted per epoch, split pro-rata'],
  ['burnWeight', '1 · 10¹⁸', 'weight of burn-lane shares in the split'],
  ['coordinatorMinBond', '1000 · 10¹⁸', 'bond a TASK-lane coordinator posts (slashable)'],
  ['attestorMinStake', '100 · 10¹⁸', 'stake an attester posts (slashable)'],
];

// The three lanes of the unified pool — [lane, role, gated?, note].
export const LANES = [
  ['HASH', 'HashLaneCreditor', 'not verification-gated (PoW self-verifies)', 'thin security floor: anchors ordering + liveness'],
  ['TASK', 'TaskLaneCreditor', 'K-of-N staked-attestor verification gate', 'useful AI/compute work — the intended long-run majority'],
  ['BURN', 'BurnCreditor', 'perma-stake proof-of-burn', 'ties into the APIS forever-lock economy; DAO-governed weight'],
];

// Chain reference rows — [item, value, isUrl].
export const REF = [
  ['Chain ID', '712217 (0xADE19)', false],
  ['Public RPC', RPC_URL, true],
  ['Block explorer (Blockscout)', EXPLORER, true],
  ['Deployed contracts + ABIs', CONTRACTS_URL, true],
  ['Native PRANA token', PRANA_TOKEN, 'addr'],
];

const STYLE = `<style>
  :root{--bg:#0f1216;--panel:#161b22;--ink:#e8edf3;--mut:#9aa7b4;--line:#232c37;--accent:#5ecad6;--good:#57c98a;--warn:#e8b04b;--link:#7fb4ff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--link)}
  .topbar{display:flex;align-items:center;gap:14px;padding:12px 20px;background:#12161c;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
  .brand{font-weight:700;color:var(--ink);text-decoration:none;display:flex;align-items:center;gap:8px}
  .brand span.n{color:var(--accent)}
  .alpha{font-size:11px;font-weight:700;letter-spacing:.5px;background:var(--warn);color:#111;padding:2px 7px;border-radius:6px;text-transform:uppercase}
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
  .seesaw{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
  .lane{flex:1;min-width:170px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
  .lane .lh{font-weight:700;font-size:15px}
  .lane.hash .lh{color:var(--warn)} .lane.task .lh{color:var(--good)} .lane.burn .lh{color:#c98ad6}
  .lane .lr{font-size:12px;color:var(--mut);margin-top:4px}
  .arrow{text-align:center;color:var(--mut);font-size:13px;margin:6px 0}
  .pot{background:#0b2331;border:1px solid #1e4d5a;border-radius:8px;padding:12px 14px;text-align:center;font-size:14px}
  .pot b{color:var(--accent)}
  .toc{columns:2;column-gap:26px;font-size:13.5px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 18px;margin:18px 0}
  .toc a{display:block;color:var(--link);text-decoration:none;padding:2px 0}
  .foot{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:12.5px}
  .pill{display:inline-block;background:#0b2a1c;color:var(--good);border:1px solid #1e4d38;border-radius:20px;padding:2px 10px;font-size:12px;font-weight:600}
  .tag{display:inline-block;border-radius:4px;padding:0 6px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}
  .tag.pin{background:#123020;color:var(--good)} .tag.di{background:#332411;color:var(--warn)}
</style>`;

function shell(title, inner, opts = {}) {
  const desc = opts.description
    || 'The public technical & consensus spec for PRANA: Etchash PoW, chainId 712217, EIP-1559, the 2% consensus Hathor fee, and the "chain IS the pool" see-saw (HASH + TASK + BURN lanes → one per-epoch pot). Mechanism, not a forecast.';
  const canonical = opts.canonical || `${BASE_URL}${opts.path || '/'}`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
${opts.robots ? `<meta name=robots content="${esc(opts.robots)}">` : ''}
<link rel=canonical href="${esc(canonical)}">
${STYLE}</head><body>
<header class=topbar>
  <a class=brand href="${bp('/')}">🕉 <span class=n>PRANA</span> Paper <span class=alpha>Alpha</span></a>
  <nav class=topnav>
    <a href="${esc(safeHref(EXPLORER) || '#')}">Explorer</a>
    <a href="${esc(safeHref(CONTRACTS_URL) || '#')}">Contracts</a>
    <a href="${esc(safeHref(REPO_DOC) || '#')}">Repo doc</a>
  </nav>
</header>
<main class=wrap>${inner}</main>
</body></html>`;
}

// explorer link for the native token address
function exAddr(addr) {
  const base = safeHref(EXPLORER);
  return base ? `${base.replace(/\/$/, '')}/address/${esc(addr)}` : '';
}

function paramTable(rows, headers) {
  const body = rows.map((r) =>
    `<tr><td>${esc(r[0])}</td><td class=n>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('');
  return `<div class=tblwrap><table>
    <thead><tr><th>${esc(headers[0])}</th><th>${esc(headers[1])}</th><th>${esc(headers[2])}</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function seesawHtml() {
  const lanes = LANES.map(([lane, role, gate, note]) => {
    const cls = lane.toLowerCase();
    return `<div class="lane ${esc(cls)}"><div class=lh>${esc(lane)} lane</div>
      <div class=lr><code>${esc(role)}</code></div>
      <div class=lr>${esc(gate)}</div>
      <div class=lr>${esc(note)}</div></div>`;
  }).join('');
  return `<div class=seesaw>${lanes}</div>
    <div class=arrow>▼ &nbsp; all lanes credit shares into &nbsp; ▼</div>
    <div class=pot><b>UnifiedSharesLedger</b> — one fixed per-epoch PRANA pot, paid <b>pro-rata</b>
      over a rolling PPLNS window. Early: hashing dominates. Later: verified work <b>catches up</b>.</div>`;
}

function refTable() {
  const rows = REF.map(([item, val, kind]) => {
    let cell;
    if (kind === true) { const h = safeHref(val); cell = h ? `<a href="${esc(h)}">${esc(val)}</a>` : `<code>${esc(val)}</code>`; }
    else if (kind === 'addr') { const h = exAddr(val); cell = h ? `<a href="${esc(h)}"><code>${esc(val)}</code></a>` : `<code>${esc(val)}</code>`; }
    else cell = `<code>${esc(val)}</code>`;
    return `<tr><td>${esc(item)}</td><td>${cell}</td></tr>`;
  }).join('');
  return `<div class=tblwrap><table>
    <thead><tr><th>Item</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ── the paper ──────────────────────────────────────────────────────────────────────────────────────
function paperHtml() {
  return `
<h1>The PRANA Paper</h1>
<p class=sub>The technical &amp; consensus specification for PRANA — the community-owned AI-compute chain.</p>
<div class=meta>
  <span class=pill>Live on PRANA mainnet</span>
  <span><b>Chain:</b> EVM chainId <code>712217</code> (<code>0xADE19</code>)</span>
  <span><b>Consensus:</b> Etchash PoW</span>
  <span><b>Version:</b> 1.0 — 2026-08-30</span>
</div>
<div class=note><b>Tone:</b> this is a description of mechanism, not a forecast. Nothing here is a
  price promise, a yield guarantee, or investment advice. Every figure is a protocol parameter a
  hard fork or governance can change. Parameters are tagged
  <span class="tag pin">Pinned</span> (sealed at genesis) or
  <span class="tag di">Design intent</span> (a stated direction, not yet a live guarantee) so no
  reader mistakes one for the other. The economic layer (KULA/MWALI/APIS) is a separate spec — the
  <a href="${esc(safeHref(KULA_PAPER) || '#')}">KULA Paper</a>.</div>

<div class=toc>
  <a href="#thesis">1 · Thesis &amp; motivation</a>
  <a href="#consensus">2 · Consensus &amp; chain parameters</a>
  <a href="#seesaw">3 · The see-saw — "the chain IS the pool"</a>
  <a href="#fee">4 · The Hathor fee — un-bypassable</a>
  <a href="#ecosystem">5 · Connection to the ecosystem</a>
  <a href="#limits">6 · Roadmap &amp; honest limitations</a>
  <a href="#ref">7 · Contract &amp; chain reference</a>
</div>

<h2 id=thesis>1 · Thesis &amp; motivation</h2>
<p>A community that wants an always-on AI can rent compute from a metered cloud — pay-per-token,
  revocable, owned by someone else — or own it outright. PRANA is the second choice, built as a
  blockchain so that ownership, payment, and verification of compute all live on one permissionless
  ledger. It is the <b>engine room</b> beneath the wider ecosystem: <b>MELEK</b> is the social layer
  (a Graphene chain), <b>KULA</b> is the DeFi economy, and <b>PRANA</b> is the compute-and-security
  base the other two settle against.</p>
<p>The goal is explicitly <i>not</i> to be a "mine-anywhere Etchash coin." Proof-of-work here is a
  <b>thin security floor</b> — enough to anchor ordering and liveness — while reward is meant to flow,
  over time, to <b>useful work</b>. Relative to honest peers: <b>Bittensor</b> scores intelligence via
  a subnet emission market; <b>Akash / io.net</b> are DePIN marketplaces renting GPU for fiat-priced
  leases; <b>classic PoW</b> pays purely for hashing. PRANA's contribution is to put <b>HASH and TASK
  into one shared reward pot</b> on a full EVM L1 — so a hashed share and a verified-work share
  compete for the same pot, and an ordinary Solidity economy is built on top. One chain that is at
  once a mining pool, a compute market, and a DeFi settlement layer.</p>

<h2 id=consensus>2 · Consensus &amp; chain parameters</h2>
<p>PRANA is a <a href="https://github.com/etclabscore/core-geth">core-geth</a> fork — the maintained
  <code>go-ethereum</code> fork that <b>kept Ethash proof-of-work</b> after Ethereum's move to
  proof-of-stake removed mining from upstream Geth. PRANA runs its own genesis, so it is a fully
  independent chain that still keeps the entire Ethereum developer ecosystem (Solidity, OpenZeppelin,
  MetaMask, Hardhat/Foundry, Blockscout).</p>
<h3>2.1 Pinned genesis parameters <span class="tag pin">Pinned</span></h3>
<p>Read directly from the sealed mainnet genesis and the forked client. Changing any of these is a
  hard fork.</p>
${paramTable(PINNED, ['Parameter', 'Value', 'Source / note'])}
<h3>2.2 Block time &amp; emission <span class="tag di">Design intent</span></h3>
<p>PRANA uses Ethash-style <b>variable difficulty</b>, so block cadence is <b>emergent</b>: the
  retarget converges toward the Ethash <b>~13–15 s</b> band, but that is a target the algorithm aims
  at, not a header constant. Likewise, the <b>live, pinned</b> issuance is a flat <b>2 PRANA/block</b>;
  a <b>~10%/yr geometric decay</b> is the stated design direction but is <b>not pinned</b> — the client
  leaves a height-gated <code>EthashBlockRewardSchedule</code> as a documented extension that a hard
  fork would activate. Until then, block reward is constant.</p>
${paramTable(DESIGN_INTENT, ['Item', 'Intent', 'Status'])}
<h3>2.3 Finality &amp; reorg posture</h3>
<p>As a Nakamoto/PoW EVM chain, PRANA has <b>probabilistic finality</b>: a block's safety grows with
  confirmations, and deep reorgs are possible but exponentially unlikely as work accumulates. There is
  no BFT instant-finality gadget. Value settlement — the bridge especially (§5) — should require a
  confirmation depth matched to the value at risk; thin early hashrate means shallower practical
  finality early on (§6).</p>

<h2 id=seesaw>3 · The see-saw — "the chain IS the pool"</h2>
<p>This is PRANA's load-bearing mechanism. Instead of a block reward that pays only whoever sealed the
  block, PRANA runs <b>one canonical mining pool pinned to the chain itself</b> — the
  <code>UnifiedSharesLedger</code> — and pays a <b>fixed per-epoch PRANA issuance</b> pro-rata to
  everyone who credited shares into it during a rolling window. Three lanes credit into the same pot,
  each behind its own role-gated creditor:</p>
${seesawHtml()}
<p style="margin-top:14px">Because all lanes draw from <b>one</b> pot, they <b>see-saw</b>: early on,
  with little AI demand, hash-shares dominate; as real AI-work arrives, task-shares grow and
  <b>catch up</b> — pulling reward toward useful work with no re-minting and no schedule change. Lane
  shares are pooled at a governed weight (<code>HashTaskWeightConfig</code>); the <b>default HASH:TASK
  weight is 1:1</b>, so a hashed share and a verified-task share earn identically — the "switching
  engine." Epoch boundaries are shared across every compute-stack contract via the
  <code>EpochManager</code> library so they never drift, and payout is <b>PPLNS</b> (pay-per-last-N-
  shares) over the trailing window, which smooths luck and discourages pool-hopping.</p>
<h3>3.1 How TASK work is measured &amp; attested</h3>
<p>A forged TASK share would be worth a real HASH share, so verification is the make-or-break trust
  boundary, built from composable modules:</p>
<ul>
  <li><b><code>TaskVerificationGate</code></b> — a claim is "verified" only once <b>K distinct
    staked-active attestors</b> (a K-of-N quorum) attest it. Verdicts are <b>one-shot consumed</b>
    (credited exactly once) and credit is bound to the gate-recorded worker — a coordinator cannot
    redirect it.</li>
  <li><b><code>AttestationStakeSlash</code></b> — attestors stake to be "active"; a
    <code>SLASHER_ROLE</code> slashes an attestor who signs off on bad work. Security is stake-at-risk,
    not trust.</li>
  <li><b><code>CoordinatorRegistry</code></b> — "the chain IS the pool, but <b>anyone</b> may run a
    coordinator." Any operator can stand up a TASK-lane coordinator by posting a <b>slashable bond</b>;
    HASH-lane coordinators need no bond because a PoW share self-verifies.</li>
</ul>
<p>Redundant recompute plus stake-slash is the anti-fabrication design: the cheapest way to earn the
  pot is to actually do the work.</p>
<h3>3.2 Live compute-stack parameters</h3>
<p>Live on mainnet (deployed 2026-08-29); governance-tunable, not consensus constants.</p>
${paramTable(COMPUTE_PARAMS, ['Parameter', 'Value', 'Meaning'])}

<h2 id=fee>4 · The Hathor fee — consensus-level, un-bypassable <span class="tag pin">Pinned</span></h2>
<p>A fixed <b>2.00% (200 bps)</b> of every block's gross issuance is routed, <b>by consensus rule</b>,
  to the <code>HathorFeeTreasury</code> rather than to whoever sealed the block — funding the community
  AI's upkeep. It is modeled on the Devcoin "receiver" pattern, made un-bypassable.</p>
<p><b>Why the consensus layer.</b> An application-layer skim (there is also one — the
  <code>SettlementFeeHook</code>, taken inline at ledger payout) only bites when value is paid out of
  the on-chain ledger; a party running their own pool and settling off-chain could route around it. The
  consensus fee cannot be: it is applied inside <code>AccumulateRewards</code>, part of the canonical
  state transition. A miner who omits or short-pays it produces a <b>different state root</b> than
  honest nodes, so every validator's re-execution rejects the block as invalid. The fee is not
  "requested" — it is a <b>block-validity rule</b>. There is no PRANA in existence that did not already
  pay the fee at the moment it was minted.</p>
<ul>
  <li><b>Launch-pinned.</b> <code>feeBps = 200</code> is a protocol constant; changing it is a hard
    fork. A future <code>RateTransitions</code> schedule is left as a documented extension.</li>
  <li><b>Governed sink, never a trader.</b> The fee address is the <code>HathorFeeTreasury</code>
    contract, which never trades and only disburses under a DAO timelock. Its live address is on the
    <a href="${esc(safeHref(CONTRACTS_URL) || '#')}">deployed-contracts page</a> so this paper cannot
    drift from the wiring.</li>
  <li><b>Two layers, not double-charged.</b> The consensus fee is taken once, at issuance; the
    app-layer hook expresses the same idea inside the ledger payout path (rules-based, countercyclical
    rate) so the skim holds whether PRANA flows through our ledger or a pool we never wrote.</li>
</ul>

<h2 id=ecosystem>5 · Connection to the ecosystem</h2>
<p>PRANA is the base coin; the economy on top is specified fully in the
  <a href="${esc(safeHref(KULA_PAPER) || '#')}">KULA Paper</a>. In brief:</p>
<ul>
  <li><b>The bridge (MELEK ↔ PRANA).</b> MELEK (Graphene L1) locks value to mint <b>wMELEK</b> on PRANA
    via the <code>GrapheneDepositBridge</code>; burning wMELEK releases MELEK. A federated validator set
    (5 validators, <b>3-of-5</b>) authorizes mints; the invariant is <b>wMELEK supply == MELEK locked</b>.
    The same wrapper pattern extends to wVKBT and wCURE.</li>
  <li><b>KULA / MWALI / APIS on top.</b> KULA is the emission-only reward/DeFi token (cap 11M); MWALI is
    the proof-of-liquidity token; APIS is the MELEK-Engine fee token. The <b>miner slice (45%)</b> of
    KULA emission pays exactly the useful-work providers of §3 — the biggest reward slice points at the
    see-saw on purpose.</li>
  <li><b>Yield Farm &amp; gauges.</b> veKULA (lock KULA up to 4 years) boosts farm yield and directs,
    via the <code>GaugeController</code>, where new KULA emission flows.</li>
  <li><b>Forever-lock → APIS-Hash compute-mining tie-in.</b> Wrapped MELEK bridged to PRANA can be
    <b>forever-locked</b> to mint soulbound <b>APIS-Hash</b>, a non-transferable mining-power unit that
    drips APIS forever — the BURN lane's economic hook into the pool. No debt, no liquidation.</li>
</ul>

<h2 id=limits>6 · Roadmap, open questions &amp; honest limitations</h2>
<ul>
  <li><b>Thin early liquidity &amp; hashrate.</b> A fair-launch chain starts with little market depth
    and low hashrate; low hashrate means cheaper theoretical reorgs and shallower practical finality
    early. Value settlement (bridge withdrawals especially) should use conservative confirmation
    depths until hashrate matures. The standard small-PoW-chain tradeoff, stated plainly.</li>
  <li><b>PoW security tradeoff by design.</b> Keeping HASH "thin" is deliberate, but thin security
    still must be paid for; if TASK reward grows while hashing thins too far, the governed lane
    weights are the lever to rebalance.</li>
  <li><b>TASK-lane attestation maturity.</b> The K-of-N staked-attestor gate is the trust boundary for
    useful work; its security depends on honest, well-staked attestor sets and on redundant recompute
    actually catching fabrication. This is the youngest, highest-risk part of the stack — the one most
    in need of adversarial testing and audit.</li>
  <li><b>Emission decay &amp; fee-transition schedules</b> are documented extensions, not shipped
    parameters (§2.2, §4) — each needs a hard fork to activate.</li>
  <li><b>Governance decentralization.</b> Admin over the compute stack and fee treasury sits behind a
    DAO timelock; how distributed the keys and votes actually are is an ongoing process, not a finished
    state.</li>
</ul>
<p>Open questions the design leaves to governance: the final HASH:TASK weight ratio, the emission-decay
  curve, per-task-type share weights, and the countercyclical fee schedule.</p>

<h2 id=ref>7 · Contract &amp; chain reference</h2>
${refTable()}
<p style="font-size:13px;color:var(--mut)">The deployed <b>compute-stack</b> addresses
  (<code>UnifiedSharesLedger</code>, <code>HashLaneCreditor</code>, <code>TaskLaneCreditor</code>,
  <code>TaskVerificationGate</code>, <code>AttestationStakeSlash</code>, <code>CoordinatorRegistry</code>,
  <code>HashTaskWeightConfig</code>, <code>HathorFeeTreasury</code>, <code>SettlementFeeHook</code>, and
  the bridge/KULA set) live on the
  <a href="${esc(safeHref(CONTRACTS_URL) || '#')}">deployed-contracts page</a> and on
  <a href="${esc(safeHref(EXPLORER) || '#')}">Blockscout</a>, so this paper points to the live registry
  rather than restating addresses that could drift.</p>

<div class=foot>
  Grounded in the sealed genesis (chainId 712217, <code>feeBps</code> 200, <code>ecip1099FBlock</code> 0,
  <code>londonBlock</code> 0, empty <code>alloc</code>), the PRANA client's consensus fee module, the
  2 PRANA/block Ethash reward constant, and the three-lane <code>UnifiedSharesLedger</code> compute stack.
  <b>Grounded &amp; pinned:</b> Etchash PoW, chainId, EIP-1559, block reward, no premine, the 2% Hathor
  fee, the see-saw. <b>Design intent (not yet pinned):</b> the ~13–15s cadence, the ~10%/yr decay, and
  the final governed lane weights. Full markdown:
  <a href="${esc(safeHref(REPO_DOC) || '#')}">PRANA_PAPER.md</a>. Governance and hard forks can change
  any parameter; read the current on-chain values before acting.
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
      return res.end(shell('The PRANA Paper — technical & consensus spec', paperHtml(), { path: '/' }));
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(shell('Not found — The PRANA Paper', '<h1>404</h1><p>No such page. <a href="' + bp('/') + '">The PRANA Paper &rarr;</a></p>', { path, robots: 'noindex' }));
  } catch {
    // soft-fail: never throw a 500 out of the handler
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch { /* ignore */ }
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/prana-paper\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`${SITE_NAME} on http://${HOST}:${PORT}  (BASE_URL=${BASE_URL})`);
  });
}
