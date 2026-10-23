// autovote/tradebots.mjs — USER-RUN, NON-CUSTODIAL trade bots for the automation portal.
//
// What this is: the LIVE, run-on-your-own-account layer behind the existing "Pick a Bot" page
// (integrations/bot-picker.mjs + .html, mounted at /bots in the auto portal). The picker already
// dry-runs every strategy against a sample snapshot; what was MISSING — and is all this file adds —
// is (1) live market readers for Hive-Engine and KulaSwap, (2) policy guards, (3) the UNSIGNED
// operations for the user's own wallet, and (4) the fee. A USER picks a venue (Hive-Engine or
// KulaSwap on PRANA), a token, and one of the existing strategy brains from
// integrations/trade-strategies.mjs (peg-arb with its inventory-cap bleed guard, buy-wall, DCA).
// Each tick the server READS the market, runs the pure decide(), applies the policy guards, and
// returns the UNSIGNED operation(s). The user's OWN wallet signs them in the browser:
//   • Hive-Engine → Hive Keychain requestCustomJson (Active) or a HiveSigner sign link
//   • KulaSwap    → the user's injected EVM wallet (MetaMask or compatible) eth_sendTransaction
// We never receive, request, or store a user key. Nothing in this module signs or broadcasts.
//
// Fee model (disclosed on the page, shown on every order before signing):
//   • Hive-Engine: a flat TRADEBOTS_FEE_BPS (default 25 = 0.25%) of each bot order's notional, paid
//     in SWAP.HIVE as a tokens.transfer bundled into the SAME custom_json the user signs. If
//     TRADEBOTS_FEE_ACCOUNT is unset the fee is 0 and the page says so. Simulate mode never charges.
//   • KulaSwap: no bot fee. The pool's own 0.30% swap fee goes to liquidity providers.
//
// House style: ESM, esc() all interpolation, soft-fail never throw, injectable fetch (__setFetch),
// handler(req,res) exported for tests. Tests: autovote/tradebots.test.mjs (offline).

import { Interface, parseUnits } from 'ethers';
import { decide } from '../integrations/trade-strategies.mjs';

// ── fetch seam ─────────────────────────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── config ─────────────────────────────────────────────────────────────────────────────────────
export function loadConfig(env = process.env) {
  const bps = Number.parseInt(env.TRADEBOTS_FEE_BPS ?? '25', 10);
  const acct = String(env.TRADEBOTS_FEE_ACCOUNT || '').toLowerCase().trim();
  return {
    heRpc: env.TRADEBOTS_HE_RPC || 'https://api.hive-engine.com/rpc/contracts',
    heRpcFallback: env.TRADEBOTS_HE_RPC_FALLBACK || 'https://engine.rishipanthee.com/contracts',
    pranaRpc: env.TRADEBOTS_PRANA_RPC || 'https://rpc.prana.melek.salon',
    cgUrl: env.TRADEBOTS_CG_URL || 'https://api.coingecko.com/api/v3/simple/price',
    feeBps: Number.isFinite(bps) && bps >= 0 && bps <= 200 ? bps : 25,
    feeAccount: /^[a-z][a-z0-9.-]{2,15}$/.test(acct) ? acct : '',
    maxOrderHive: Number(env.TRADEBOTS_MAX_ORDER_HIVE || 500),
  };
}

// ── venues + tokens ────────────────────────────────────────────────────────────────────────────
// KulaSwap mainnet (PRANA 712217) — PUBLIC contract addresses (mirrors kulaswap/kula-config.mjs).
export const KULA = Object.freeze({
  chainId: 712217, chainIdHex: '0xADE19', name: 'PRANA', explorer: 'https://pranascan.soapbox.community',
  router: '0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5',
  factory: '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6',
  tokens: Object.freeze({
    KULA: { address: '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631', decimals: 18 },
    WPRANA: { address: '0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34', decimals: 18 },
    wVKBT: { address: '0xD915E757662c4234137aff167Bf93d588145f75e', decimals: 8 },
    wCURE: { address: '0x03d613BDaAd82ecd6cf36B0fEf88Fb6AF9d977Ff', decimals: 8 },
  }),
});

// Hive-Engine SWAP.* pegged tokens whose peg we can price from a public USD source (peg-arb).
// SWAP.LTC is deliberately absent: it is the documented one-way-bleed pair (signal-orchestrator).
export const HE_PEGS = Object.freeze({
  'SWAP.BTC': 'bitcoin', 'SWAP.ETH': 'ethereum', 'SWAP.DOGE': 'dogecoin',
  'SWAP.BLURT': 'blurt', 'SWAP.BCH': 'bitcoin-cash', 'SWAP.STEEM': 'steem', 'SWAP.HBD': 'hive_dollar',
});

// Our issued tokens: policy floor for SELLS (operator rule: never sold by us below 1 HIVE; the bots
// we offer carry the same floor so a user bot cannot dump the peg either).
export const SELL_FLOOR_HIVE = Object.freeze({ VKBT: 1, CURE: 1 });
// On KulaSwap the wrapped twins are priced in wrapped units, not HIVE — the 1-HIVE floor cannot be
// checked there, so the bots offered on KulaSwap for wVKBT/wCURE are buy-side only.
const KULA_BUY_ONLY = new Set(['wVKBT', 'wCURE']);

export const BOTS = Object.freeze({
  'peg-arb': {
    label: 'Peg arbitrage (with inventory-cap bleed guard)',
    venues: ['hive-engine', 'kulaswap'],
    about: 'Hive-Engine: trades a SWAP.* token back toward its real-asset USD price when the gap exceeds the threshold. KulaSwap: trades the direct wVKBT/wCURE pool back toward the rate implied through KULA. Buys stop once your position hits the inventory cap (the bleed guard). It never shorts: it only sells what you hold.',
    params: { threshold: 0.03, tradeHive: 10, maxInventoryHive: 100 },
  },
  wall: {
    label: 'Buy wall (price floor support)',
    venues: ['hive-engine'],
    about: 'Keeps one resting buy order at your floor price, if no existing buy wall already defends it. Order-book venues only.',
    params: { floor: 0, wallSize: 1000 },
  },
  dca: {
    label: 'DCA (budget-capped)',
    venues: ['hive-engine', 'kulaswap'],
    about: 'Buys a fixed amount each interval, and stops permanently once the total budget is spent (that cap is the guard against runaway buying).',
    params: { buyHive: 5, totalBudgetHive: 50, intervalMs: 86400000 },
  },
});

// ── tiny helpers ───────────────────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const isPos = (n) => Number.isFinite(+n) && +n > 0;
const floorTo = (n, dp) => { const f = 10 ** dp; return Math.floor(num(n) * f + 1e-6) / f; }; // epsilon: 0.0003*1e8 must not floor to 29999
const fixed = (n, dp) => floorTo(n, dp).toFixed(dp).replace(/\.?0+$/, '') || '0';
export const isHiveAccount = (a) => /^[a-z][a-z0-9.-]{2,15}$/.test(String(a || ''));
export const isEvmAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ''));
const cleanSymbol = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 20);

// ── Hive-Engine readers (soft-fail) ────────────────────────────────────────────────────────────
async function heCall(cfg, method, params) {
  for (const url of [cfg.heRpc, cfg.heRpcFallback]) {
    try {
      const r = await _fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!r || !r.ok) continue;
      const j = await r.json();
      if (j && 'result' in j) return j.result;
    } catch { /* try next node */ }
  }
  return null;
}

export async function readHiveEngine(symbol, account, cfg = loadConfig()) {
  const sym = cleanSymbol(symbol);
  if (!sym) return { ok: false, error: 'symbol required' };
  // Sequential on purpose: the public node rate-limits bursts of parallel calls and answers null.
  const token = await heCall(cfg, 'findOne', { contract: 'tokens', table: 'tokens', query: { symbol: sym } });
  if (!token) return { ok: false, error: `unknown Hive-Engine token ${sym} (or the node is unreachable)` };
  const buy = await heCall(cfg, 'find', { contract: 'market', table: 'buyBook', query: { symbol: sym }, limit: 50, indexes: [{ index: 'priceDec', descending: true }] });
  const sell = await heCall(cfg, 'find', { contract: 'market', table: 'sellBook', query: { symbol: sym }, limit: 50, indexes: [{ index: 'priceDec', descending: false }] });
  const metrics = await heCall(cfg, 'findOne', { contract: 'market', table: 'metrics', query: { symbol: sym } });
  const bals = isHiveAccount(account)
    ? await heCall(cfg, 'find', { contract: 'tokens', table: 'balances', query: { account, symbol: { $in: [sym, 'SWAP.HIVE'] } }, limit: 5 })
    : [];
  const mapBook = (rows) => (Array.isArray(rows) ? rows : []).map((o) => ({ price: num(o.price), quantity: num(o.quantity), account: o.account }));
  const buyBook = mapBook(buy);
  const sellBook = mapBook(sell);
  const bid = buyBook[0]?.price || 0;
  const ask = sellBook[0]?.price || 0;
  const last = num(metrics?.lastPrice);
  const mid = bid && ask ? (bid + ask) / 2 : last || bid || ask;
  // Working price for orders: the last trade clamped into the live spread. On a thin book the raw mid
  // can sit far from where anything trades (e.g. bid 0.00002 / ask 0.04), so it is not used to price.
  const work = last ? Math.min(Math.max(last, bid || last), ask || last) : mid;
  const bal = (s) => num((Array.isArray(bals) ? bals : []).find((b) => b.symbol === s)?.balance);
  return {
    ok: true, venue: 'hive-engine', symbol: sym, precision: num(token.precision, 8),
    bid, ask, last, hePrice: work, mid, buyBook, sellBook,
    balances: { token: bal(sym), hive: bal('SWAP.HIVE') },
  };
}

export async function readUsd(ids, cfg = loadConfig()) {
  try {
    const r = await _fetch(`${cfg.cgUrl}?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`);
    if (!r || !r.ok) return {};
    const j = await r.json();
    const out = {};
    for (const id of ids) if (isPos(j?.[id]?.usd)) out[id] = +j[id].usd;
    return out;
  } catch { return {}; }
}

// ── KulaSwap (PRANA EVM) readers ───────────────────────────────────────────────────────────────
const ERC20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
const PAIR = new Interface(['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)']);
const FACTORY = new Interface(['function getPair(address,address) view returns (address)']);
const ROUTER = new Interface(['function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])']);

async function ethCall(cfg, to, data) {
  try {
    const r = await _fetch(cfg.pranaRpc, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return typeof j?.result === 'string' && j.result !== '0x' ? j.result : null;
  } catch { return null; }
}

/** Reserves of the pool (a,b) as human numbers, oriented to (a,b). null on any failure. */
export async function readPool(a, b, cfg = loadConfig()) {
  const A = KULA.tokens[a], B = KULA.tokens[b];
  if (!A || !B) return null;
  const pr = await ethCall(cfg, KULA.factory, FACTORY.encodeFunctionData('getPair', [A.address, B.address]));
  if (!pr) return null;
  const pair = FACTORY.decodeFunctionResult('getPair', pr)[0];
  if (/^0x0{40}$/i.test(pair)) return null;
  const [rr, t0] = await Promise.all([
    ethCall(cfg, pair, PAIR.encodeFunctionData('getReserves', [])),
    ethCall(cfg, pair, PAIR.encodeFunctionData('token0', [])),
  ]);
  if (!rr || !t0) return null;
  const [r0, r1] = PAIR.decodeFunctionResult('getReserves', rr);
  const token0 = PAIR.decodeFunctionResult('token0', t0)[0];
  const aIs0 = token0.toLowerCase() === A.address.toLowerCase();
  const rawA = aIs0 ? r0 : r1, rawB = aIs0 ? r1 : r0;
  const ra = Number(rawA) / 10 ** A.decimals, rb = Number(rawB) / 10 ** B.decimals;
  if (!isPos(ra) || !isPos(rb)) return null;
  return { pair, a, b, ra, rb, rawA, rawB, priceAinB: rb / ra };
}

async function readErc20(cfg, sym, fn, args) {
  const t = KULA.tokens[sym];
  const r = await ethCall(cfg, t.address, ERC20.encodeFunctionData(fn, args));
  return r ? ERC20.decodeFunctionResult(fn, r)[0] : null;
}

// Market choices on KulaSwap: the bot trades `symbol` against `quote`.
export const KULA_MARKETS = Object.freeze({
  'wVKBT/wCURE': { symbol: 'wVKBT', quote: 'wCURE', via: 'KULA' },
  'wVKBT/KULA': { symbol: 'wVKBT', quote: 'KULA' },
  'wCURE/KULA': { symbol: 'wCURE', quote: 'KULA' },
  'KULA/WPRANA': { symbol: 'KULA', quote: 'WPRANA' },
});

export async function readKulaSwap(market, address, cfg = loadConfig()) {
  const m = KULA_MARKETS[market];
  if (!m) return { ok: false, error: `unknown KulaSwap market ${market}` };
  const pool = await readPool(m.symbol, m.quote, cfg);
  if (!pool) return { ok: false, error: `could not read the ${market} pool` };
  let implied = null;
  if (m.via) {
    const [p1, p2] = await Promise.all([readPool(m.symbol, m.via, cfg), readPool(m.quote, m.via, cfg)]);
    if (p1 && p2) implied = p1.priceAinB / p2.priceAinB; // symbol per via ÷ quote per via = symbol in quote
  }
  const balances = { token: 0, hive: 0 };
  let allowance = null;
  if (isEvmAddress(address)) {
    const [bt, bq, al] = await Promise.all([
      readErc20(cfg, m.symbol, 'balanceOf', [address]),
      readErc20(cfg, m.quote, 'balanceOf', [address]),
      readErc20(cfg, m.quote, 'allowance', [address, KULA.router]),
    ]);
    balances.token = bt == null ? 0 : Number(bt) / 10 ** KULA.tokens[m.symbol].decimals;
    balances.hive = bq == null ? 0 : Number(bq) / 10 ** KULA.tokens[m.quote].decimals;
    allowance = al;
  }
  return {
    ok: true, venue: 'kulaswap', market, symbol: m.symbol, quote: m.quote, pool,
    hePrice: pool.priceAinB, mid: pool.priceAinB, implied, balances, allowance,
  };
}

// Uniswap-V2 getAmountOut (0.30% fee), BigInt.
export function amountOut(amountIn, reserveIn, reserveOut) {
  const ai = BigInt(amountIn) * 997n;
  return (ai * BigInt(reserveOut)) / (BigInt(reserveIn) * 1000n + ai);
}

// ── snapshot → strategy inputs ─────────────────────────────────────────────────────────────────
function strategyInputs(bot, snap, usd, heId, now) {
  const s = { symbol: snap.symbol, hePrice: snap.hePrice, mid: snap.mid, bid: snap.bid, ask: snap.ask, ts: now,
    buyBook: snap.buyBook || [], sellBook: snap.sellBook || [] };
  if (bot === 'peg-arb') {
    if (snap.venue === 'hive-engine') { s.hiveUsd = usd.hive; s.realUsd = usd[heId]; }
    else { s.hiveUsd = 1; s.realUsd = snap.implied; } // units: quote token; reference = implied cross rate
  }
  return s;
}

/**
 * Policy guards over the strategy's orders. Returns { keep, blocked }.
 * - VKBT/CURE sells below 1 HIVE are blocked (never dump the peg).
 * - wVKBT/wCURE sells on KulaSwap are blocked (the 1-HIVE floor can't be checked in wrapped units).
 * - per-order notional capped at cfg.maxOrderHive.
 * - sells capped to the balance the user actually holds; buys to the quote balance they hold
 *   (in live mode only; simulate shows the intent even with an empty wallet).
 */
export function applyGuards(orders, snap, cfg, { live = false } = {}) {
  const keep = [], blocked = [];
  for (const o of orders || []) {
    const floor = SELL_FLOOR_HIVE[o.symbol];
    if (o.side === 'sell' && snap.venue === 'hive-engine' && floor && o.price < floor) {
      blocked.push({ ...o, why: `${o.symbol} is never sold below ${floor} HIVE` }); continue;
    }
    if (o.side === 'sell' && snap.venue === 'kulaswap' && KULA_BUY_ONLY.has(o.symbol)) {
      blocked.push({ ...o, why: `${o.symbol} bots are buy-side only on KulaSwap` }); continue;
    }
    if (o.qtyHive > cfg.maxOrderHive) {
      blocked.push({ ...o, why: `order ${o.qtyHive} exceeds the ${cfg.maxOrderHive} per-order cap` }); continue;
    }
    if (live) {
      if (o.side === 'sell' && o.qtyToken > num(snap.balances?.token)) { blocked.push({ ...o, why: 'not enough of the token in your wallet' }); continue; }
      if (o.side === 'buy' && o.qtyHive > num(snap.balances?.hive)) { blocked.push({ ...o, why: 'not enough balance to pay for this buy' }); continue; }
    }
    keep.push(o);
  }
  return { keep, blocked };
}

export function feeFor(order, cfg) {
  if (!cfg.feeAccount || !cfg.feeBps) return 0;
  return floorTo(num(order.qtyHive) * cfg.feeBps / 10000, 8);
}

/** Hive-Engine custom_json payload (array of actions) for one order + its bundled fee. Unsigned. */
export function heCustomJson(order, snap, cfg) {
  const qty = fixed(order.qtyToken, snap.precision ?? 8);
  const actions = [{
    contractName: 'market', contractAction: order.side === 'buy' ? 'buy' : 'sell',
    contractPayload: { symbol: order.symbol, quantity: qty, price: fixed(order.price, 8) },
  }];
  const fee = feeFor(order, cfg);
  if (fee > 0) {
    actions.push({ contractName: 'tokens', contractAction: 'transfer',
      contractPayload: { symbol: 'SWAP.HIVE', to: cfg.feeAccount, quantity: fixed(fee, 8), memo: 'auto.melek.salon trade-bot fee' } });
  }
  return { id: 'ssc-mainnet-hive', json: actions, fee };
}

export function hivesignerLink(account, customJson) {
  const q = new URLSearchParams({
    authority: 'active', required_auths: JSON.stringify([account]), required_posting_auths: '[]',
    id: customJson.id, json: JSON.stringify(customJson.json),
  });
  return `https://hivesigner.com/sign/custom-json?${q.toString()}`;
}

/** Unsigned EVM txs (approve if needed, then swap) for one KulaSwap order. */
export function kulaTxs(order, snap, address, { slippageBps = 100, deadlineSec = 1200, nowSec = 0 } = {}) {
  const m = KULA_MARKETS[snap.market];
  const inSym = order.side === 'buy' ? m.quote : m.symbol;
  const outSym = order.side === 'buy' ? m.symbol : m.quote;
  const inTok = KULA.tokens[inSym], outTok = KULA.tokens[outSym];
  const amtHuman = order.side === 'buy' ? order.qtyHive : order.qtyToken;
  const amountIn = parseUnits(fixed(amtHuman, Math.min(inTok.decimals, 8)), inTok.decimals);
  if (amountIn <= 0n) return [];
  const pool = snap.pool; // oriented (symbol, quote)
  const [rIn, rOut] = order.side === 'buy' ? [pool.rawB, pool.rawA] : [pool.rawA, pool.rawB];
  const out = amountOut(amountIn, rIn, rOut);
  const minOut = (out * BigInt(10000 - slippageBps)) / 10000n;
  const deadline = BigInt((nowSec || Math.floor(Date.now() / 1000)) + deadlineSec);
  const txs = [];
  if (snap.allowance == null || BigInt(snap.allowance) < amountIn) {
    txs.push({ label: `approve ${inSym} for the KulaSwap router`, from: address, to: inTok.address,
      data: ERC20.encodeFunctionData('approve', [KULA.router, amountIn]), value: '0x0' });
  }
  txs.push({ label: `swap ${fixed(amtHuman, 8)} ${inSym} → ≥ ${fixed(Number(minOut) / 10 ** outTok.decimals, 8)} ${outSym}`,
    from: address, to: KULA.router, value: '0x0',
    data: ROUTER.encodeFunctionData('swapExactTokensForTokens', [amountIn, minOut, [inTok.address, outTok.address], address, deadline]) });
  return txs;
}

// ── the one entry point: plan a tick ───────────────────────────────────────────────────────────
/**
 * @param {object} req  { bot, venue, symbol|market, params, state, account|address, mode:'simulate'|'live' }
 * @returns {Promise<object>} { ok, snapshot, reason, orders, blocked, ops, fee } — never throws
 */
export async function planTick(input = {}, cfg = loadConfig()) {
  try {
    const bot = String(input.bot || '');
    const venue = String(input.venue || '');
    const live = input.mode === 'live';
    if (!BOTS[bot]) return { ok: false, error: `unknown bot ${bot}` };
    if (!BOTS[bot].venues.includes(venue)) return { ok: false, error: `${bot} is not offered on ${venue}` };
    const params = { ...BOTS[bot].params, ...sanitizeParams(input.params) };
    const state = sanitizeParams(input.state);
    let snap, usd = {}, heId = null;
    if (venue === 'hive-engine') {
      const account = String(input.account || '').toLowerCase().trim();
      if (live && !isHiveAccount(account)) return { ok: false, error: 'enter your Hive account name to run live' };
      snap = await readHiveEngine(input.symbol, account, cfg);
      if (!snap.ok) return snap;
      if (bot === 'peg-arb') {
        heId = HE_PEGS[snap.symbol];
        if (!heId) return { ok: false, error: `peg-arb on Hive-Engine needs a pegged SWAP token (${Object.keys(HE_PEGS).join(', ')})` };
        usd = await readUsd(['hive', heId], cfg);
      }
    } else {
      const address = String(input.address || '');
      if (live && !isEvmAddress(address)) return { ok: false, error: 'connect your EVM wallet to run live' };
      snap = await readKulaSwap(String(input.market || 'wVKBT/wCURE'), address, cfg);
      if (!snap.ok) return snap;
      if (bot === 'peg-arb' && !isPos(snap.implied)) return { ok: false, error: 'peg-arb on KulaSwap runs on the wVKBT/wCURE market (priced against the KULA cross rate)' };
    }
    // The inventory cap must see the real position: value of the token held, in quote units.
    if (live || isPos(snap.balances?.token)) {
      state.inventoryToken = num(state.inventoryToken, 0) || num(snap.balances?.token);
      state.inventoryHive = num(state.inventoryHive, 0) || num(snap.balances?.token) * num(snap.hePrice);
    }
    const s = strategyInputs(bot, snap, usd, heId, num(input.now, 0) || Date.now());
    const d = decide(bot, s, params, state);
    const { keep, blocked } = applyGuards(d.orders, snap, cfg, { live });
    const ops = [];
    let fee = 0;
    for (const o of keep) {
      if (venue === 'hive-engine') {
        const cj = heCustomJson(o, snap, cfg);
        fee += cj.fee;
        ops.push({ kind: 'hive-custom-json', order: o, customJson: cj,
          hivesigner: isHiveAccount(input.account) ? hivesignerLink(String(input.account).toLowerCase(), cj) : null });
      } else {
        ops.push({ kind: 'evm-txs', order: o, chainId: KULA.chainId, chainIdHex: KULA.chainIdHex,
          txs: isEvmAddress(input.address) ? kulaTxs(o, snap, input.address, { slippageBps: num(params.slippageBps, 100) }) : [] });
      }
    }
    const { buyBook, sellBook, pool, ...lean } = snap; // keep responses small
    return {
      ok: true, mode: live ? 'live' : 'simulate', bot, venue,
      snapshot: { ...lean, depth: { bids: (buyBook || []).length, asks: (sellBook || []).length },
        pool: pool ? { pair: pool.pair, reserves: [pool.ra, pool.rb] } : undefined,
        realUsd: s.realUsd, hiveUsd: s.hiveUsd },
      reason: d.reason, orders: keep, blocked, ops, fee: floorTo(fee, 8),
      feeTerms: feeTerms(cfg, venue),
    };
  } catch (e) {
    return { ok: false, error: `plan failed: ${e && e.message ? e.message : e}` };
  }
}

export function feeTerms(cfg, venue) {
  if (venue === 'kulaswap') return 'No bot fee on KulaSwap. The pool charges its standard 0.30% swap fee, which goes to liquidity providers.';
  if (!cfg.feeAccount || !cfg.feeBps) return 'No bot fee is currently charged on Hive-Engine.';
  return `${(cfg.feeBps / 100).toFixed(2)}% of each order placed by the bot, paid in SWAP.HIVE to @${cfg.feeAccount} in the same signed operation. Shown before you sign. Simulate mode is free.`;
}

// Only finite numbers pass (and a whitelisted key set); anything else is dropped.
const PARAM_KEYS = new Set(['threshold', 'tradeHive', 'maxInventoryHive', 'floor', 'ceiling', 'wallSize', 'minMultiple',
  'buyHive', 'totalBudgetHive', 'intervalMs', 'slippageBps', 'inventoryToken', 'inventoryHive', 'spentHive', 'lastBuyTs']);
export function sanitizeParams(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const [k, v] of Object.entries(p)) {
    if (!PARAM_KEYS.has(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  // bots never quote a sell wall (ceiling) — the user bots are buy-wall only
  delete out.ceiling;
  return out;
}

export function publicConfig(cfg = loadConfig()) {
  return {
    bots: Object.fromEntries(Object.entries(BOTS).map(([k, v]) => [k, { label: v.label, venues: v.venues, about: v.about, params: v.params }])),
    heMarkets: { pegged: Object.keys(HE_PEGS), ours: ['VKBT', 'CURE'] },
    kulaMarkets: Object.keys(KULA_MARKETS),
    kula: { chainId: KULA.chainId, chainIdHex: KULA.chainIdHex, rpc: cfg.pranaRpc, explorer: KULA.explorer, name: KULA.name },
    fee: { bps: cfg.feeAccount ? cfg.feeBps : 0, account: cfg.feeAccount || null,
      hiveEngine: feeTerms(cfg, 'hive-engine'), kulaswap: feeTerms(cfg, 'kulaswap') },
    sellFloorHive: SELL_FLOOR_HIVE,
  };
}

// ── HTTP ───────────────────────────────────────────────────────────────────────────────────────
function readJson(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy?.(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/**
 * Handles /api/trade/config and /api/trade/plan (the live "run it on your account" layer the existing
 * bot-picker page calls), and redirects /trade → /bots (the picker). Returns true if it answered.
 */
export async function handler(req, res) {
  const path = String(req.url || '/').split('?')[0];
  const out = (code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
  try {
    if (path === '/trade' || path === '/trade/') { out(302, 'text/plain', '', { Location: '/bots' }); return true; }
    if (path === '/api/trade/config') { out(200, 'application/json', JSON.stringify(publicConfig())); return true; }
    if (path === '/api/trade/plan' && req.method === 'POST') {
      const body = await readJson(req);
      const r = await planTick(body);
      out(r.ok ? 200 : 400, 'application/json', JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      return true;
    }
    return false;
  } catch (e) {
    try { out(500, 'application/json', JSON.stringify({ ok: false, error: String(e?.message || e) })); } catch { /* sent */ }
    return true;
  }
}
