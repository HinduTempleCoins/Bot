// tip.mjs — PIZZA-pattern tipping for Hathor's helper bot ("PRANA PIZZA bot").
//
// THE PATTERN (as on Hive's PIZZA bot): tips are paid from the BOT'S TIP JAR (a treasury), never from the
// tipper's wallet — so the tipper never signs anything and never hands over a key. What the tipper's own
// wallet does is set their DAILY QUOTA: the more of the tip token their VERIFIED linked wallet holds, the
// more tips per UTC day they may hand out. Every tip gets a receipt.
//
//   !tip @user [n]      give n tips (default 1) of the configured amount to @user (a chat mention, a
//                        MELEK account, or a 0x address)
//   !tips               your tier, quota left today, recent receipts
//   !tipjar             the jar's live balance and today's global spend
//
// This REPLACES the three conflicting !tip meanings that existed (see helperbot/README.md):
//   • index.js → discord-tip-cli.mjs : Hathor tips any symbol from her stash, tipper-side caps only
//   • discord-chain-bridge.mjs       : tip FROM the tipper's own account (needs the tipper's key — retired)
//   • integrations/tipbot.mjs        : onboarding faucet grant (that is now `!faucet`, not `!tip`)
//
// TOKEN IS CONFIG. Default = native PRANA on PRANA mainnet (chainId 712217), per the operator's
// "PRANA PIZZA bot" framing. MELEK / TESTS / MELEK-Engine tokens are presets. Graphene transfers are
// built with integrations/tipbot.mjs execute() (same op builder, same dry-run guarantee).
//
// SAFETY: this module builds UNSIGNED intents. With no injected signer, or HELPERBOT_TIP_LIVE != '1', or
// no treasury configured, every tip is SIMULATED (receipt status 'simulated'). No key ever enters here.

import { randomBytes } from 'node:crypto';
import { execute as tipbotExecute, assertClarityFirewall } from '../integrations/tipbot.mjs';
import { prana, melek, melekEngine, units, fmt, CFG } from './live.mjs';
import { defaultStore, dayKey } from './store.mjs';
import { getLink, parseIdentity } from './links.mjs';
import { PRANA_CHAIN_ID } from './addresses.mjs';

export const TOKEN_PRESETS = Object.freeze({
  PRANA: { symbol: 'PRANA', kind: 'evm-native', identity: 'prana', net: 'mainnet', chainId: PRANA_CHAIN_ID, decimals: 18, explorer: 'https://pranascan.soapbox.community/tx/' },
  MELEK: { symbol: 'MELEK', kind: 'graphene', identity: 'melek', net: 'mainnet', explorer: 'https://melekd.hathor.live/tx/' },
  TESTS: { symbol: 'TESTS', kind: 'graphene', identity: 'melek', net: 'testnet', explorer: 'https://alpha.melek.salon/tx/' },
  WMELEK: { symbol: 'WMELEK', kind: 'melek-engine', identity: 'melek', net: 'mainnet', sidechain: 'mse-mainnet-melek', explorer: 'https://engine.melek.salon/' },
});

/** "1:1,10:3,100:10" → [{minHold:1, perDay:1}, …] sorted ascending. */
export function parseTiers(s) {
  const tiers = String(s || '').split(',').map((p) => p.split(':').map(Number))
    .filter(([h, n]) => Number.isFinite(h) && Number.isFinite(n) && n > 0)
    .map(([minHold, perDay]) => ({ minHold, perDay }));
  return tiers.sort((a, b) => a.minHold - b.minHold);
}

export function tipConfig(env = process.env) {
  const symbol = String(env.HELPERBOT_TIP_TOKEN || 'PRANA').toUpperCase();
  const preset = TOKEN_PRESETS[symbol] || TOKEN_PRESETS.PRANA;
  const cfg = {
    ...preset,
    amount: Number(env.HELPERBOT_TIP_AMOUNT || 0.1),
    tiers: parseTiers(env.HELPERBOT_TIP_TIERS || '1:1,10:3,100:10,1000:25'),
    globalDailyCap: Number(env.HELPERBOT_TIP_DAILY_CAP || 25),
    maxPerCommand: Number(env.HELPERBOT_TIP_MAX_PER_COMMAND || 5),
    treasury: String(env.HELPERBOT_TIP_TREASURY || '').trim(),
    live: env.HELPERBOT_TIP_LIVE === '1',
  };
  assertClarityFirewall(cfg); // tips never read Clarity (pinned by tipbot.mjs)
  return cfg;
}

export function tierFor(holdings, tiers) {
  let t = { minHold: 0, perDay: 0 };
  for (const x of tiers) if (holdings !== null && holdings >= x.minHold) t = x;
  return t;
}

/** Live holdings of the tip token for an identity value. null = could not read. */
export async function holdingsOf(cfg, who) {
  if (cfg.kind === 'evm-native') return units(await prana.nativeBalance(who, cfg.net), 18);
  if (cfg.kind === 'graphene') {
    const [acct, dgp] = await Promise.all([melek.account(who, cfg.net), melek.globals(cfg.net)]);
    if (acct === null || !dgp) return null;
    if (acct === false) return 0;
    const liquid = parseFloat(acct.balance);
    const vests = parseFloat(acct.vesting_shares) - parseFloat(acct.delegated_vesting_shares || '0');
    const perVest = parseFloat(dgp.total_vesting_fund_steem) / parseFloat(dgp.total_vesting_shares);
    return liquid + (Number.isFinite(vests * perVest) ? vests * perVest : 0);
  }
  if (cfg.kind === 'melek-engine') return melekEngine.balance(who, cfg.symbol);
  return null;
}

const idOf = (link, cfg) => (cfg.identity === 'prana' ? link.prana : link.melek);
const idValue = (rec, cfg) => (rec ? (cfg.identity === 'prana' ? rec.address : rec.account) : null);
const label = (v, cfg) => (cfg.identity === 'prana' ? v : '@' + v);

/** Build the unsigned op(s) for one tip intent. */
export async function buildOps(intent, cfg) {
  if (cfg.kind === 'evm-native') {
    const wei = BigInt(Math.round(intent.amount * 1e9)) * 10n ** 9n;
    return [{ type: 'evm_native_transfer', chainId: cfg.chainId, from: cfg.treasury || null, to: intent.to, value: '0x' + wei.toString(16), memo: `tip ${intent.id}` }];
  }
  if (cfg.kind === 'graphene') {
    const r = await tipbotExecute({ to: intent.to, tip: intent.amount, burn: 0, burnTo: 'null', symbol: cfg.symbol, total: intent.amount, skipped: false });
    return r.ops.map((o) => ({ ...o, from: cfg.treasury || null, memo: `tip ${intent.id}` }));
  }
  return [{ type: 'custom_json', id: cfg.sidechain, required_auths: [cfg.treasury || null], json: { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: cfg.symbol, to: intent.to, quantity: String(intent.amount), memo: `tip ${intent.id}` } } }];
}

/**
 * tip({ platform, userId, userName, target, count }, { store, cfg, now, signer })
 *   target: { userId } (a chat mention) | { raw } (an account name / 0x address typed by the tipper)
 * Returns { ok, reply, receipt? }. Never throws.
 */
export async function tip(req, ctx = {}) {
  try {
    return await _tip(req, ctx);
  } catch {
    return { ok: false, reply: 'Tipping hit an error — nothing was sent. Try again in a minute.' };
  }
}

async function _tip({ platform, userId, userName = 'you', target, count = 1 }, { store = defaultStore(), cfg = tipConfig(), now = Date.now(), signer = null } = {}) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return { ok: false, reply: `Usage: \`!tip @user [count]\` — each tip is ${cfg.amount} ${cfg.symbol}.` };
  if (n > cfg.maxPerCommand) return { ok: false, reply: `Max ${cfg.maxPerCommand} tips per command.` };

  // 1) tipper must have a VERIFIED wallet for the tip token (quota is gated on its holdings)
  const mine = idOf(getLink(store, platform, userId), cfg);
  if (!mine) return { ok: false, reply: `Link your ${cfg.identity === 'prana' ? 'PRANA 0x address' : 'MELEK account'} first: \`!link ${cfg.identity === 'prana' ? '0x…' : '@account'}\` (public address only — never a key).` };
  if (!mine.verified) return { ok: false, reply: 'Your wallet link is not verified yet — finish the proof and type `!verify`.' };
  const tipperId = idValue(mine, cfg);

  // 2) resolve the recipient to a public identity for the tip token
  let to = null;
  if (target && target.userId) {
    if (String(target.userId) === String(userId)) return { ok: false, reply: 'You can\'t tip yourself.' };
    to = idValue(idOf(getLink(store, platform, target.userId), cfg), cfg);
    if (!to) return { ok: false, reply: `That user hasn't linked a ${cfg.identity === 'prana' ? 'PRANA address' : 'MELEK account'} yet — they can type \`!link …\` and you can tip again.` };
  } else if (target && target.raw) {
    const idn = parseIdentity(target.raw);
    if (!idn || idn.kind !== cfg.identity) return { ok: false, reply: `Tips are in ${cfg.symbol}: give a ${cfg.identity === 'prana' ? '0x address' : 'MELEK @account'} or @mention a linked user.` };
    to = idn.value;
  } else return { ok: false, reply: `Usage: \`!tip @user [count]\` — each tip is ${cfg.amount} ${cfg.symbol}.` };
  if (to.toLowerCase() === String(tipperId).toLowerCase()) return { ok: false, reply: 'You can\'t tip yourself.' };
  if (cfg.kind === 'graphene') {
    const acct = await melek.account(to, cfg.net);
    if (acct === false) return { ok: false, reply: `@${to} doesn't exist on MELEK ${cfg.net}.` };
  }

  // 3) quota from LIVE holdings (PIZZA tiers)
  const held = await holdingsOf(cfg, tipperId);
  if (held === null) return { ok: false, reply: 'I couldn\'t read your wallet balance right now — try again shortly.' };
  const tier = tierFor(held, cfg.tiers);
  const day = dayKey(now);
  const ukey = `tipday:${day}:${platform}:${userId}`;
  const used = Number(store.get(ukey, 0));
  if (tier.perDay === 0) return { ok: false, reply: `Tipping unlocks at ${cfg.tiers[0] ? cfg.tiers[0].minHold : '?'} ${cfg.symbol} held — your linked wallet holds ${fmt(held)}.` };
  if (used + n > tier.perDay) return { ok: false, reply: `Daily quota: ${used}/${tier.perDay} used (holding ${fmt(held)} ${cfg.symbol}). Resets 00:00 UTC.` };

  // 4) global daily cap + jar balance
  const total = Math.round(cfg.amount * n * 1e9) / 1e9;
  const gkey = `tipglobal:${day}`;
  const spent = Number(store.get(gkey, 0));
  if (spent + total > cfg.globalDailyCap) return { ok: false, reply: 'The tip jar hit today\'s global cap — tips reopen at 00:00 UTC.' };
  if (cfg.treasury) {
    const jar = await holdingsOf(cfg, cfg.treasury);
    if (jar !== null && jar < total) return { ok: false, reply: 'The tip jar is empty right now — nothing was sent.' };
  }

  // 5) intent → ops → (simulated) execution → receipt
  const id = randomBytes(4).toString('hex');
  const intent = { id, from: cfg.treasury || null, to, amount: total, count: n, symbol: cfg.symbol };
  const ops = await buildOps(intent, cfg);
  let status = 'simulated';
  let txid = null;
  const why = !cfg.treasury ? 'tip jar not configured' : !cfg.live ? 'live tipping is off (staging)' : !signer ? 'no signer attached' : null;
  if (!why) {
    const r = await signer(ops).catch(() => null);
    if (!r || !r.txid) return { ok: false, reply: 'The tip jar signer did not confirm — nothing was recorded. Try again later.' };
    status = 'broadcast'; txid = r.txid;
  }
  store.set(ukey, used + n);
  store.set(gkey, spent + total);
  const receipt = { id, ts: new Date(now).toISOString(), platform, tipper: userId, to, amount: total, count: n, symbol: cfg.symbol, status, txid, ops };
  store.set(`receipt:${id}`, receipt);
  const rk = `receipts:${platform}:${userId}`;
  store.set(rk, [id, ...(store.get(rk, []) || [])].slice(0, 10));

  const tail = status === 'broadcast' ? `tx ${cfg.explorer}${txid}` : `SIMULATED — ${why}; nothing was sent`;
  return {
    ok: true,
    receipt,
    reply: `🌿 ${userName} tipped ${label(to, cfg)} ${fmt(total)} ${cfg.symbol} (${used + n}/${tier.perDay} today) · receipt \`${id}\` · ${tail}`,
  };
}

/** !tips — tier, quota left, recent receipts. */
export async function myTips({ platform, userId }, { store = defaultStore(), cfg = tipConfig(), now = Date.now() } = {}) {
  try {
    const mine = idOf(getLink(store, platform, userId), cfg);
    const used = Number(store.get(`tipday:${dayKey(now)}:${platform}:${userId}`, 0));
    const lines = [`**Tipping** — ${cfg.amount} ${cfg.symbol} per tip, paid from Hathor's tip jar. Tiers: ${cfg.tiers.map((t) => `${t.minHold}+ ${cfg.symbol} → ${t.perDay}/day`).join(' · ')}`];
    if (!mine) lines.push(`You haven't linked a wallet: \`!link ${cfg.identity === 'prana' ? '0x…' : '@account'}\``);
    else {
      const held = mine.verified ? await holdingsOf(cfg, idValue(mine, cfg)) : null;
      const tier = tierFor(held, cfg.tiers);
      lines.push(`Linked ${label(idValue(mine, cfg), cfg)} (${mine.verified ? 'verified' : 'UNVERIFIED — `!verify`'}) · holding ${held === null ? 'n/a' : fmt(held)} ${cfg.symbol} · used ${used}/${tier.perDay} today`);
    }
    const ids = store.get(`receipts:${platform}:${userId}`, []) || [];
    for (const id of ids.slice(0, 5)) {
      const r = store.get(`receipt:${id}`, null);
      if (r) lines.push(`• \`${r.id}\` ${r.ts.slice(0, 16)}Z → ${label(r.to, cfg)} ${fmt(r.amount)} ${r.symbol} [${r.status}${r.txid ? ' ' + r.txid : ''}]`);
    }
    return lines.join('\n');
  } catch {
    return 'Tip info is unavailable right now.';
  }
}

/** !tipjar — live jar balance + global spend today. */
export async function tipJar({ store = defaultStore(), cfg = tipConfig(), now = Date.now() } = {}) {
  const spent = Number(store.get(`tipglobal:${dayKey(now)}`, 0));
  if (!cfg.treasury) return `Tip jar: not configured yet (staging) · token ${cfg.symbol} · today ${fmt(spent)}/${cfg.globalDailyCap} ${cfg.symbol} simulated.`;
  const bal = await holdingsOf(cfg, cfg.treasury);
  return `Tip jar ${label(cfg.treasury, cfg)}: ${bal === null ? 'balance unavailable' : fmt(bal) + ' ' + cfg.symbol} · today ${fmt(spent)}/${cfg.globalDailyCap} ${cfg.symbol} · live=${cfg.live ? 'on' : 'off'}`;
}

export { CFG };
