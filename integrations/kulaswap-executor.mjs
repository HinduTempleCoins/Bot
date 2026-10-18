// kulaswap-executor.mjs — place KulaSwap trades for a bot account through MELEK-Signer.
//
// KulaSwap is a Uniswap-V2-style AMM on PRANA (chainId 712217). A bot never holds a key: every transaction
// goes to MELEK-Signer's POST /v1/evm with the bot account's token, which the signer limits to the router
// and the bot's own tokens (limits.evmTo) and to zero PRANA value. This module builds the calldata, reads
// quotes straight from the router (getAmountsOut, so the AMM's own fee math is used), and decides.
//
// Strategies here are the plain, explainable ones a person would choose for their own account:
//   arb   — a loop route that returns more of the start token than it spends (e.g. wVKBT→KULA→wCURE→wVKBT)
//   dca   — swap a fixed amount on a schedule (e.g. 10 KULA → WPRANA each run)
//   rebalance — keep two tokens at a target split by value (e.g. 50/50 KULA/WPRANA), swapping only past a band
//   grid  — buy after the price falls a step, sell after it rises a step (never selling below the last buy)
// Rule from the operator: money only comes out when it is profit — an arb trade is refused unless the
// quote clears the minimum profit, and amountOutMin pins that, so a moved price makes the swap revert
// instead of losing.
//
// House style: ESM, injectable fetch, soft-fail, pure builders tested offline, CLI-guarded.
//   node integrations/kulaswap-executor.mjs arb --amount 50 [--min-profit-bps 100] [--dry]
//   node integrations/kulaswap-executor.mjs dca --from KULA --to WPRANA --amount 10 [--dry]
//   env: KULABOT_TOKEN (MELEK-Signer token for the bot account), PRANA_RPC_URL, MELEK_SIGNER_URL
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export const ROUTER = '0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5';
export const TOKENS = {
  KULA: { address: '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631', decimals: 18 },
  WPRANA: { address: '0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34', decimals: 18 },
  wVKBT: { address: '0xD915E757662c4234137aff167Bf93d588145f75e', decimals: 8 },
  wCURE: { address: '0x03d613BDaAd82ecd6cf36B0fEf88Fb6AF9d977Ff', decimals: 8 },
};
export const ARB_ROUTES = [['wVKBT', 'KULA', 'wCURE', 'wVKBT'], ['wVKBT', 'wCURE', 'KULA', 'wVKBT']];

// ── ABI encoding (only what we need) ────────────────────────────────────────────────────────────────────
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const addr = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');
export function units(amount, decimals) {
  const [i, f = ''] = String(amount).split('.');
  return BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
export function fromUnits(raw, decimals) {
  const s = BigInt(raw).toString().padStart(decimals + 1, '0');
  return Number(`${s.slice(0, -decimals)}.${s.slice(-decimals)}`);
}
export const encodeApprove = (spender, amount) => `0x095ea7b3${addr(spender)}${word(amount)}`;
export const encodeAllowance = (owner, spender) => `0xdd62ed3e${addr(owner)}${addr(spender)}`;
export const encodeBalanceOf = (owner) => `0x70a08231${addr(owner)}`;
export function encodeGetAmountsOut(amountIn, path) {
  return `0xd06ca61f${word(amountIn)}${word(0x40)}${word(path.length)}${path.map(addr).join('')}`;
}
export function encodeSwap(amountIn, amountOutMin, path, to, deadline) {
  return `0x38ed1739${word(amountIn)}${word(amountOutMin)}${word(0xa0)}${addr(to)}${word(deadline)}${word(path.length)}${path.map(addr).join('')}`;
}
/** Decode a uint256[] return value. */
export function decodeUintArray(hex) {
  const h = String(hex || '').replace(/^0x/, '');
  if (h.length < 128) return [];
  const n = Number(BigInt('0x' + h.slice(64, 128)));
  return Array.from({ length: n }, (_, i) => BigInt('0x' + h.slice(128 + i * 64, 192 + i * 64)));
}

/**
 * Decide an arb trade from a router quote. Pure.
 * @returns {{trade:boolean, amountIn:bigint, amountOutMin?:bigint, profit:bigint, profitBps:number, reason:string}}
 */
export function planArb({ amountIn, quotedOut, minProfitBps = 100, slippageBps = 30 }) {
  const a = BigInt(amountIn), out = BigInt(quotedOut || 0);
  const profit = out - a;
  const profitBps = a > 0n ? Number((profit * 10000n) / a) : 0;
  if (profitBps < minProfitBps) return { trade: false, amountIn: a, profit, profitBps, reason: `profit ${profitBps} bps under the ${minProfitBps} bps minimum` };
  // never accept less than break-even plus the minimum profit, even after slippage
  const floor = a + (a * BigInt(minProfitBps)) / 10000n;
  const withSlip = out - (out * BigInt(slippageBps)) / 10000n;
  return { trade: true, amountIn: a, amountOutMin: withSlip > floor ? withSlip : floor, profit, profitBps, reason: 'ok' };
}

// ── chain + signer ──────────────────────────────────────────────────────────────────────────────────────
const RPC = () => process.env.PRANA_RPC_URL || 'https://rpc.prana.melek.salon';
const SIGNER = () => (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
async function ethCall(to, data) {
  const r = await _fetch(RPC(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'eth_call failed');
  return j.result;
}
async function receipt(hash) {
  for (let i = 0; i < 40; i++) {
    const r = await _fetch(RPC(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }) });
    const j = await r.json();
    if (j.result) return j.result;
    await new Promise((x) => setTimeout(x, 3000));
  }
  return null;
}
async function signer(path, body, token) {
  const r = await _fetch(SIGNER() + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.error || `signer ${path} failed`);
  return j;
}
const sendTx = async (token, tx) => { const j = await signer('/v1/evm', { tx: { value: '0x0', ...tx } }, token); return j.result && j.result.hash; };

export async function quote(amountIn, symbols) {
  const path = symbols.map((s) => TOKENS[s].address);
  return decodeUintArray(await ethCall(ROUTER, encodeGetAmountsOut(amountIn, path)));
}

async function ensureAllowance(token, owner, sym, amount) {
  const have = BigInt(await ethCall(TOKENS[sym].address, encodeAllowance(owner, ROUTER)));
  if (have >= amount) return null;
  const hash = await sendTx(token, { to: TOKENS[sym].address, data: encodeApprove(ROUTER, amount * 10n) });
  const rc = await receipt(hash);
  if (!rc || rc.status !== '0x1') throw new Error(`approve ${sym} failed (${hash})`);
  return hash;
}

async function swap(token, owner, symbols, amountIn, amountOutMin) {
  const path = symbols.map((s) => TOKENS[s].address);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const hash = await sendTx(token, { to: ROUTER, data: encodeSwap(amountIn, amountOutMin, path, owner, deadline) });
  const rc = await receipt(hash);
  return { hash, ok: !!rc && rc.status === '0x1', gasUsed: rc && parseInt(rc.gasUsed, 16) };
}

/** One arb pass: quote both loop routes for `amount` of the start token; trade the better one if it clears. */
export async function runArb({ token, amount, minProfitBps = 100, dry = false }) {
  const owner = (await signer('/v1/evm/address', {}, token)).address;
  const start = ARB_ROUTES[0][0], dec = TOKENS[start].decimals, amountIn = units(amount, dec);
  const quotes = [];
  for (const r of ARB_ROUTES) { try { const q = await quote(amountIn, r); quotes.push({ route: r, out: q[q.length - 1] }); } catch (e) { quotes.push({ route: r, error: e.message }); } }
  const best = quotes.filter((q) => q.out).sort((a, b) => (b.out > a.out ? 1 : -1))[0];
  if (!best) return { ok: false, owner, quotes, reason: 'no quote' };
  const plan = planArb({ amountIn, quotedOut: best.out, minProfitBps });
  const view = { owner, route: best.route.join('→'), spend: amount, quotedBack: fromUnits(best.out, dec), profitBps: plan.profitBps, reason: plan.reason };
  if (!plan.trade || dry) return { ok: true, traded: false, ...view };
  const before = BigInt(await ethCall(TOKENS[start].address, encodeBalanceOf(owner)));
  const approve = await ensureAllowance(token, owner, start, amountIn);
  const s = await swap(token, owner, best.route, amountIn, plan.amountOutMin);
  const after = BigInt(await ethCall(TOKENS[start].address, encodeBalanceOf(owner)));
  return { ok: s.ok, traded: s.ok, ...view, approveTx: approve, swapTx: s.hash, realised: fromUnits(after - before, dec) };
}

/** One DCA step: swap a fixed amount from → to at the router's price (with 1% slippage protection). */
export async function runDca({ token, from, to, amount, dry = false }) {
  const owner = (await signer('/v1/evm/address', {}, token)).address;
  const amountIn = units(amount, TOKENS[from].decimals);
  const q = await quote(amountIn, [from, to]);
  const out = q[q.length - 1];
  const view = { owner, route: `${from}→${to}`, spend: amount, quotedOut: fromUnits(out, TOKENS[to].decimals) };
  if (dry) return { ok: true, traded: false, ...view };
  const approve = await ensureAllowance(token, owner, from, amountIn);
  const s = await swap(token, owner, [from, to], amountIn, out - out / 100n);
  return { ok: s.ok, traded: s.ok, ...view, approveTx: approve, swapTx: s.hash };
}

// ── rebalance: keep two tokens at a target split by value ───────────────────────────────────────────────
/**
 * Decide a rebalance. Pure. `price` = value of 1 A in B. Returns the swap that brings A's share of total
 * value back to `target` when it has drifted more than `band` (both fractions).
 */
export function planRebalance({ balA, balB, price, target = 0.5, band = 0.05 }) {
  const valA = balA * price, total = valA + balB;
  if (!(total > 0) || !(price > 0)) return { trade: false, share: 0, reason: 'nothing to rebalance' };
  const share = valA / total;
  if (Math.abs(share - target) <= band) return { trade: false, share, reason: `A is ${(share * 100).toFixed(1)}% of value, inside the band` };
  const wantA = (total * target) / price;
  return share > target
    ? { trade: true, share, side: 'sellA', amount: balA - wantA, reason: 'A above target' }
    : { trade: true, share, side: 'sellB', amount: (wantA - balA) * price, reason: 'A below target' };
}

export async function runRebalance({ token, a, b, target = 0.5, band = 0.05, dry = false }) {
  const owner = (await signer('/v1/evm/address', {}, token)).address;
  const [da, db] = [TOKENS[a].decimals, TOKENS[b].decimals];
  const balA = fromUnits(BigInt(await ethCall(TOKENS[a].address, encodeBalanceOf(owner))), da);
  const balB = fromUnits(BigInt(await ethCall(TOKENS[b].address, encodeBalanceOf(owner))), db);
  const one = await quote(units('1', da), [a, b]);
  const price = fromUnits(one[one.length - 1], db);
  const plan = planRebalance({ balA, balB, price, target, band });
  const view = { owner, pair: `${a}/${b}`, balA, balB, price, shareA: Number(plan.share.toFixed(4)), reason: plan.reason };
  if (!plan.trade || dry) return { ok: true, traded: false, ...view, plan: plan.trade ? `${plan.side} ${plan.amount}` : undefined };
  const [from, to, dec] = plan.side === 'sellA' ? [a, b, da] : [b, a, db];
  const amountIn = units(plan.amount.toFixed(Math.min(dec, 6)), dec);
  const q = await quote(amountIn, [from, to]);
  const out = q[q.length - 1];
  const approve = await ensureAllowance(token, owner, from, amountIn);
  const sw = await swap(token, owner, [from, to], amountIn, out - out / 100n);
  return { ok: sw.ok, traded: sw.ok, ...view, swapped: `${plan.amount.toFixed(4)} ${from} -> ${to}`, approveTx: approve, swapTx: sw.hash };
}

// ── grid: buy after the price falls a step, sell after it rises a step, never below the last buy ─────────
/**
 * Decide a grid step. Pure. `price` = value of 1 base in quote now; `last` = price of the last grid trade
 * (null on the first run, which only records the level). Sells only at a profit over the last buy.
 */
export function planGrid({ price, last, lastSide = null, stepBps = 300 }) {
  if (!(price > 0)) return { trade: false, reason: 'no price' };
  if (!(last > 0)) return { trade: false, record: price, reason: 'first run: grid level set' };
  const move = (price - last) / last, step = stepBps / 10000;
  if (move >= step) {
    if (lastSide === 'buy' || lastSide === null) return { trade: true, side: 'sell', reason: `price up ${(move * 100).toFixed(2)}% from the last level` };
    return { trade: false, record: price, reason: 'up a step after a sell: level moved up, nothing to sell at a profit' };
  }
  if (move <= -step) return { trade: true, side: 'buy', reason: `price down ${(-move * 100).toFixed(2)}% from the last level` };
  return { trade: false, reason: `price ${(move * 100).toFixed(2)}% from the last level, inside the step` };
}

export async function runGrid({ token, base, quoteSym, chunk, stepBps = 300, stateFile, dry = false }) {
  const fs = await import('node:fs');
  const owner = (await signer('/v1/evm/address', {}, token)).address;
  const [dbs, dq] = [TOKENS[base].decimals, TOKENS[quoteSym].decimals];
  const one = await quote(units('1', dbs), [base, quoteSym]);
  const price = fromUnits(one[one.length - 1], dq);
  let st = {}; try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first run */ }
  const plan = planGrid({ price, last: st.last, lastSide: st.lastSide || null, stepBps });
  const view = { owner, pair: `${base}/${quoteSym}`, price, last: st.last || null, reason: plan.reason };
  const save = (o) => { if (!dry) fs.writeFileSync(stateFile, JSON.stringify({ ...st, ...o, at: new Date().toISOString() })); };
  if (!plan.trade) { if (plan.record) save({ last: plan.record }); return { ok: true, traded: false, ...view }; }
  if (dry) return { ok: true, traded: false, ...view, would: plan.side };
  // sell = base -> quote ; buy = spend `chunk` base-worth of quote -> base
  const [from, to, dec, amt] = plan.side === 'sell' ? [base, quoteSym, dbs, Number(chunk)] : [quoteSym, base, dq, Number(chunk) * price];
  const amountIn = units(amt.toFixed(Math.min(dec, 6)), dec);
  const q = await quote(amountIn, [from, to]);
  const out = q[q.length - 1];
  const approve = await ensureAllowance(token, owner, from, amountIn);
  const sw = await swap(token, owner, [from, to], amountIn, out - out / 100n);
  if (sw.ok) save({ last: price, lastSide: plan.side });
  return { ok: sw.ok, traded: sw.ok, ...view, side: plan.side, spent: `${amt.toFixed(4)} ${from}`, approveTx: approve, swapTx: sw.hash };
}

if (process.argv[1] && process.argv[1].endsWith('kulaswap-executor.mjs')) {
  const a = process.argv.slice(2), get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const token = process.env.KULABOT_TOKEN, dry = a.includes('--dry');
  try {
    if (!token) throw new Error('KULABOT_TOKEN not set');
    const r = a[0] === 'dca'
      ? await runDca({ token, from: get('--from', 'KULA'), to: get('--to', 'WPRANA'), amount: get('--amount', '10'), dry })
      : a[0] === 'rebalance'
        ? await runRebalance({ token, a: get('--a', 'KULA'), b: get('--b', 'WPRANA'), target: +get('--target', 0.5), band: +get('--band', 0.05), dry })
        : a[0] === 'grid'
          ? await runGrid({ token, base: get('--base', 'KULA'), quoteSym: get('--quote', 'wVKBT'), chunk: get('--chunk', '20'), stepBps: +get('--step-bps', 300), stateFile: get('--state', 'data/kulabot-grid.json'), dry })
          : await runArb({ token, amount: get('--amount', '50'), minProfitBps: +get('--min-profit-bps', 100), dry });
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.error(`[kulaswap] ${String(e.message || e).slice(0, 200)}`); process.exit(1); }
}
