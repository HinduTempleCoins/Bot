// tokenomics.mjs — !tokenomics / !prana / !kula / !melek / !vkbt / !cure / !wvkbt / !wcure / !wmelek /
// !apis. LIVE data only: every supply, balance, price and holder count is read from the chain or API at
// call time (short TTL cache in live.mjs). The only fixed figures are PROTOCOL PARAMETERS quoted from the
// published papers, and they are labelled as such. A figure that cannot be fetched says so — never a
// guess. Read-only; no keys.

import { prana, melek, hiveEngine, melekEngine, units, show, fmt, NA, __setFetch as _setFetch } from './live.mjs';
import { PRANA, DECIMALS, LINKS } from './addresses.mjs';

export const __setFetch = _setFetch;

const ENGINE_MAX = 9e15;

/** price of `a` denominated in `b` from the live UniswapV2 pair (null when no pair / unreadable). */
export async function pairPrice(a, decA, b, decB) {
  const pair = await prana.getPair(PRANA.factory, a, b);
  if (!pair || /^0x0{40}$/i.test(pair)) return null;
  const [res, t0] = await Promise.all([prana.reserves(pair), prana.token0(pair)]);
  if (!res || !t0) return null;
  const aIs0 = t0.toLowerCase() === a.toLowerCase();
  const ra = units(aIs0 ? res[0] : res[1], decA);
  const rb = units(aIs0 ? res[1] : res[0], decB);
  if (!ra || !rb) return null;
  return { price: rb / ra, reserveA: ra, reserveB: rb, pair };
}

// ── PRANA ─────────────────────────────────────────────────────────────────────────────────────────
export async function pranaFacts() {
  const [chainId, head, stats, treasury, kp] = await Promise.all([
    prana.chainId(), prana.blockNumber(), prana.scanStats(),
    prana.nativeBalance(PRANA.hathorFeeTreasury), pairPrice(PRANA.KULA, 18, PRANA.WPRANA, 18),
  ]);
  return { chainId, head, stats, treasury: units(treasury, 18), kulaInPrana: kp ? kp.price : null };
}

export async function pranaReply() {
  const f = await pranaFacts();
  const avg = f.stats && Number(f.stats.average_block_time) ? Number(f.stats.average_block_time) / 1000 : null;
  const est = f.head !== null ? f.head * 2 : null;
  const pranaInKula = f.kulaInPrana ? 1 / f.kulaInPrana : null;
  return [
    '**PRANA** — proof-of-useful-work EVM chain (native coin, fair launch, no premine)',
    `• Chain ${f.chainId ?? NA} · height ${show(f.head)} · avg block ${avg ? fmt(avg) + 's' : NA} · addresses ${show(f.stats ? Number(f.stats.total_addresses) : null)}`,
    `• Block reward: 2 PRANA/block — 2% (200 bps) Hathor fee by consensus → 1.96 to the miner, 0.04 to the HathorFeeTreasury  _(protocol parameters, PRANA paper §2.1/§4)_`,
    `• Issued so far ≈ ${est !== null ? fmt(est) + ' PRANA' : NA}  _(height × 2; estimate — excludes uncle rewards)_`,
    `• HathorFeeTreasury balance (live): ${show(f.treasury, 'PRANA')} — \`${PRANA.hathorFeeTreasury}\``,
    `• Emission decay ~10%/yr is design intent, NOT pinned on-chain yet — the live reward is flat  _(paper §2.3)_`,
    `• Price (KulaSwap KULA/WPRANA pool, live): ${pranaInKula ? `1 PRANA = ${fmt(pranaInKula)} KULA` : NA} · no USD market yet`,
    `• Faucet: testnet only (\`!faucet prana\`) — mainnet PRANA is mined. Add network: ${LINKS.pranaDev}`,
  ].join('\n');
}

// ── KULA ──────────────────────────────────────────────────────────────────────────────────────────
export async function kulaReply() {
  const [supply, cap, scan, locked, kp] = await Promise.all([
    prana.totalSupply(PRANA.KULA), prana.cap(PRANA.KULA), prana.scanToken(PRANA.KULA),
    prana.balanceOf(PRANA.KULA, PRANA.veKULA), pairPrice(PRANA.KULA, 18, PRANA.WPRANA, 18),
  ]);
  return [
    '**KULA** — emission-only reward/DeFi token on PRANA (KulaSwap)',
    `• Supply (live): ${show(units(supply, 18), 'KULA')} of cap ${show(units(cap, 18), 'KULA')} · holders ${show(scan ? Number(scan.holders_count) : null)}`,
    `• Locked in veKULA (live): ${show(units(locked, 18), 'KULA')}`,
    `• Price (live pool): ${kp ? `1 KULA = ${fmt(kp.price)} PRANA` : NA}`,
    '• Emission: ~1M KULA in year one, −10%/yr (≈10M lifetime, under the 11M hard cap); split 45% miners / 35% LPs / 10% lottery / 10% stakers; sole minter = EmissionScheduler, admin = DAO Timelock (2-day)  _(protocol parameters, KULA paper)_',
    `• Contract \`${PRANA.KULA}\` · trade/stake: ${LINKS.kulaswap}`,
  ].join('\n');
}

// ── MELEK (Graphene L1) ───────────────────────────────────────────────────────────────────────────
/** Steem-family inflation, derived from LIVE chain config + head block (no hard-coded numbers). */
export function melekInflation(dgp, cfg) {
  if (!dgp || !cfg) return null;
  const start = Number(cfg.STEEM_INFLATION_RATE_START_PERCENT);
  const stop = Number(cfg.STEEM_INFLATION_RATE_STOP_PERCENT);
  const narrow = Number(cfg.STEEM_INFLATION_NARROWING_PERIOD);
  const interval = Number(cfg.STEEM_BLOCK_INTERVAL);
  const head = Number(dgp.head_block_number);
  const supply = parseFloat(dgp.virtual_supply);
  if (![start, stop, narrow, interval, head, supply].every(Number.isFinite) || !narrow || !interval) return null;
  const rateBp = Math.max(start - Math.floor(head / narrow), stop); // units of 0.01%
  const blocksPerYear = (365 * 24 * 3600) / interval;
  const perBlock = (supply * rateBp) / 10000 / blocksPerYear;
  const content = Number(dgp.content_reward_percent) / 100;
  const vesting = Number(dgp.vesting_reward_percent) / 100;
  const sps = Number(dgp.sps_fund_percent) / 100;
  const producer = 100 - content - vesting - sps;
  return { ratePct: rateBp / 100, stopPct: stop / 100, perBlock, interval, split: { content, vesting, sps, producer } };
}

export async function melekReply() {
  const [dgp, cfg, accounts, wm, pw, custody] = await Promise.all([
    melek.globals(), melek.config(), melek.accountCount(), melekEngine.token('WMELEK'),
    prana.totalSupply(PRANA.wMELEK), melek.account('wmelek-bridge'),
  ]);
  const inf = melekInflation(dgp, cfg);
  return [
    '**MELEK** — the Graphene L1 (DPoS; Hathor is a founding witness)',
    `• Supply (live): ${dgp ? dgp.current_supply : NA} · MBD ${dgp ? dgp.current_sbd_supply : NA} · staked (POWER) ${dgp ? dgp.total_vesting_fund_steem : NA}`,
    `• Accounts ${show(accounts)} · head block ${show(dgp ? dgp.head_block_number : null)} · ${inf ? inf.interval + 's blocks' : NA}`,
    inf
      ? `• Inflation now ≈ ${fmt(inf.ratePct)}%/yr (narrows toward ${fmt(inf.stopPct)}%) ≈ ${fmt(inf.perBlock)} MELEK/block → ${fmt(inf.split.content)}% authors+curators · ${fmt(inf.split.vesting)}% stakers · ${fmt(inf.split.sps)}% DAO fund · ${fmt(inf.split.producer)}% witnesses  _(derived from live chain config)_`
      : `• Inflation: ${NA}`,
    `• Wrapped: WMELEK on MELEK-Engine ${wm ? wm.supply : NA} (custody @wmelek-bridge holds ${custody ? custody.balance : NA}) · wMELEK on PRANA ${show(units(pw, 18))}`,
    '• Price: no live MELEK market yet.',
    `• Wallet ${LINKS.melekWallet} · explorer ${LINKS.melekExplorer}`,
  ].join('\n');
}

// ── Hive-Engine VKBT / CURE ───────────────────────────────────────────────────────────────────────
const WRAPPED = { VKBT: 'wVKBT', CURE: 'wCURE' };

export async function hiveEngineReply(sym) {
  const S = String(sym).toUpperCase();
  const w = WRAPPED[S];
  const [tok, met, hold, wsup, custody] = await Promise.all([
    hiveEngine.token(S), hiveEngine.metrics(S), hiveEngine.holders(S),
    w ? prana.totalSupply(PRANA[w]) : null,
    hiveEngine.find('tokens', 'balances', { account: 'kula-bridge', symbol: S }, 1),
  ]);
  const name = tok ? tok.name : S;
  const lines = [`**${S}** — ${name} (Hive-Engine)`];
  if (tok) {
    lines.push(`• Supply (live): ${fmt(Number(tok.supply))} / max ${fmt(Number(tok.maxSupply))} · circulating ${fmt(Number(tok.circulatingSupply))} · staked ${fmt(Number(tok.totalStaked))}`);
  } else lines.push(`• Supply: ${NA}`);
  lines.push(`• Holders (live): ${hold ? (hold.capped ? '1000+' : String(hold.count)) : NA}`);
  if (met) {
    lines.push(`• Price (live): last ${met.lastPrice} HIVE · bid ${met.highestBid} / ask ${met.lowestAsk} · 24h vol ${met.volume} HIVE`);
  } else lines.push(`• Price: ${NA}`);
  if (w) {
    const held = Array.isArray(custody) ? (custody[0] ? Number(custody[0].balance) : 0) : null;
    lines.push(`• ${w} on PRANA (live): ${show(units(wsup, DECIMALS[w]))} minted · @kula-bridge custody holds ${show(held, S)} · bridge: ${LINKS.bridge}`);
  }
  lines.push(`• Trade: ${LINKS.hiveEngine(S)}`);
  return lines.join('\n');
}

// ── Wrapped tokens on PRANA (wVKBT / wCURE / wMELEK) ─────────────────────────────────────────────
export async function wrappedReply(wsym) {
  const key = { WVKBT: 'wVKBT', WCURE: 'wCURE', WMELEK_PRANA: 'wMELEK' }[String(wsym).toUpperCase()] || wsym;
  const addr = PRANA[key];
  if (!addr) return `Unknown wrapped token ${wsym}.`;
  const dec = DECIMALS[key];
  const [sup, scan, kp] = await Promise.all([
    prana.totalSupply(addr), prana.scanToken(addr), pairPrice(addr, dec, PRANA.KULA, 18),
  ]);
  return [
    `**${key}** — bridged 1:1 onto PRANA by the 3-of-5 federated GrapheneDepositBridge`,
    `• Supply (live): ${show(units(sup, dec))} · holders ${show(scan ? Number(scan.holders_count) : null)}`,
    `• Price (live KulaSwap pool): ${kp ? `1 ${key} = ${fmt(kp.price)} KULA` : 'no pool / ' + NA}`,
    `• Contract \`${addr}\` · bridge ${LINKS.bridge} · swap ${LINKS.kulaswap}`,
  ].join('\n');
}

// ── MELEK-Engine WMELEK / APIS ────────────────────────────────────────────────────────────────────
export async function engineReply(sym) {
  const S = String(sym).toUpperCase();
  const [tok, custody] = await Promise.all([melekEngine.token(S), S === 'WMELEK' ? melek.account('wmelek-bridge') : null]);
  if (tok === null) return `**${S}** (MELEK-Engine): ${NA}`;
  if (tok === false) return `**${S}** is not listed on MELEK-Engine.`;
  const max = Number(tok.maxSupply) >= ENGINE_MAX ? 'no fixed cap set' : fmt(Number(tok.maxSupply));
  const lines = [
    `**${S}** — ${tok.name} on MELEK-Engine (issuer @${tok.issuer})`,
    `• Supply (live): ${tok.supply} · circulating ${tok.circulatingSupply} · max: ${max}`,
  ];
  if (S === 'WMELEK') {
    lines.push(`• Backing: deposit MELEK to @wmelek-bridge → WMELEK minted 1:1. Custody balance (live): ${custody ? custody.balance : NA}`);
    lines.push('• Not the same token as wMELEK on PRANA (`!wmelek prana`).');
  }
  if (S === 'APIS') {
    lines.push('• Role: MELEK-Engine fee token; minted by APIS-Hash compute-mining (forever-locked wrapped MELEK)  _(KULA/PRANA papers)_');
    if (Number(tok.supply) === 0) lines.push('• Live supply is 0 — no APIS has been minted yet.');
  }
  lines.push(`• Explorer: ${LINKS.engine}`);
  return lines.join('\n');
}

// ── overview ──────────────────────────────────────────────────────────────────────────────────────
export async function overviewReply() {
  const [head, kulaSup, kulaCap, dgp, vkbt, cure, wm, apis, wv, wc, wpm] = await Promise.all([
    prana.blockNumber(), prana.totalSupply(PRANA.KULA), prana.cap(PRANA.KULA), melek.globals(),
    hiveEngine.token('VKBT'), hiveEngine.token('CURE'), melekEngine.token('WMELEK'), melekEngine.token('APIS'),
    prana.totalSupply(PRANA.wVKBT), prana.totalSupply(PRANA.wCURE), prana.totalSupply(PRANA.wMELEK),
  ]);
  return [
    '**Tokenomics — live**',
    `• PRANA: height ${show(head)} · ≈${head !== null ? fmt(head * 2) : NA} issued (2/block, 2% Hathor fee) → \`!prana\``,
    `• KULA: ${show(units(kulaSup, 18))} / cap ${show(units(kulaCap, 18))} → \`!kula\``,
    `• MELEK: ${dgp ? dgp.current_supply : NA} → \`!melek\``,
    `• VKBT: ${vkbt ? fmt(Number(vkbt.supply)) : NA} · CURE: ${cure ? fmt(Number(cure.supply)) : NA} (Hive-Engine) → \`!vkbt\` \`!cure\``,
    `• Wrapped on PRANA: wVKBT ${show(units(wv, 8))} · wCURE ${show(units(wc, 8))} · wMELEK ${show(units(wpm, 18))} → \`!wvkbt\` \`!wcure\``,
    `• MELEK-Engine: WMELEK ${wm ? wm.supply : NA} · APIS ${apis ? apis.supply : NA} → \`!wmelek\` \`!apis\``,
    `Map of everything: ${LINKS.map}`,
  ].join('\n');
}

/** Route a tokenomics command name → reply text. Returns null when `cmd` is not a tokenomics verb. */
export async function tokenomicsCommand(cmd, args = []) {
  const a0 = String(args[0] || '').toLowerCase();
  switch (cmd) {
    case 'tokenomics': case 'tokens':
      if (a0) return tokenomicsCommand(a0.replace(/^!/, ''), args.slice(1));
      return overviewReply();
    case 'prana': return pranaReply();
    case 'kula': return kulaReply();
    case 'melek': return melekReply();
    case 'vkbt': return hiveEngineReply('VKBT');
    case 'cure': return hiveEngineReply('CURE');
    case 'wvkbt': return wrappedReply('wVKBT');
    case 'wcure': return wrappedReply('wCURE');
    case 'wmelek': return a0 === 'prana' ? wrappedReply('wMELEK') : engineReply('WMELEK');
    case 'apis': return engineReply('APIS');
    default: return null;
  }
}

export const TOKENOMICS_COMMANDS = ['tokenomics', 'tokens', 'prana', 'kula', 'melek', 'vkbt', 'cure', 'wvkbt', 'wcure', 'wmelek', 'apis'];
