// execute.mjs — turns the preset BUY/SELL decisions into CONCRETE, SIZED HIVE-Engine orders and
// (only when LIVE) places them. This is the piece that was missing: trader.mjs decided, but never
// sized an order. Here we size from live depth + the account's real balances, cap every order, and
// honor the SWAP.LTC bleed guard.
//
// SAFETY:
//   • DRY-RUN IS THE DEFAULT. placeOrder() (trader.mjs) only broadcasts when ANGELICALIST_LIVE==='true'
//     AND a key is present. Without both, every order is simulated and printed.
//   • Hard per-order cap: MAX_ORDER_HIVE (default 10). No single order can spend/clear more than this.
//   • Dust floor: MIN_ORDER_HIVE (default 1). Skips trades too small to matter.
//   • Bleed guard: a BUY with no matching SELL leg in the same run is blocked (anti-SWAP.LTC).
//
//   node integrations/angelicalist/execute.mjs                                  # dry-run: size + simulate
//   ANGELICALIST_LIVE=true ANGELICALIST_WIF=<wif> node integrations/angelicalist/execute.mjs   # live

import { placeOrder, mode } from './trader.mjs';
import { simulate } from '../trade-presets.mjs';
import { market } from '../hive-engine-market.mjs';
import { tokenBalances } from './internal.mjs';

const MAX_ORDER_HIVE = +(process.env.MAX_ORDER_HIVE || 10); // hard per-order ceiling (in SWAP.HIVE)
const MIN_ORDER_HIVE = +(process.env.MIN_ORDER_HIVE || 1);  // dust floor — skip below this

const round = (n) => +(+n).toFixed(8);
const balOf = (tokens, symbol) => {
  const t = tokens.find((x) => x.symbol === symbol);
  return t ? t.balance : 0;
};

// size one BUY/SELL decision into a concrete order using live depth + the account's balances.
export async function sizeOrder(decision, tokens) {
  const { action, sym } = decision;
  const m = await market.metrics(sym).catch(() => null);
  if (!m) return { ...decision, skip: 'no market metrics' };

  if (action === 'SELL') {
    const have = balOf(tokens, sym);
    if (have <= 0) return { ...decision, skip: `no ${sym} balance to sell` };
    const price = +m.highestBid;
    if (!price) return { ...decision, skip: 'no bid to hit' };
    const qty = Math.min(have, MAX_ORDER_HIVE / price); // cap proceeds at MAX_ORDER_HIVE
    const proceeds = qty * price;
    if (proceeds < MIN_ORDER_HIVE) return { ...decision, skip: `proceeds ${proceeds.toFixed(3)} < min ${MIN_ORDER_HIVE} HIVE` };
    return { ...decision, order: { side: 'sell', symbol: sym, quantity: round(qty), price: round(price) }, proceedsHive: +proceeds.toFixed(4) };
  }

  if (action === 'BUY') {
    const swapHive = balOf(tokens, 'SWAP.HIVE');
    const price = +m.lowestAsk;
    if (!price) return { ...decision, skip: 'no ask to lift' };
    const spend = Math.min(MAX_ORDER_HIVE, swapHive);
    if (spend < MIN_ORDER_HIVE) return { ...decision, skip: `SWAP.HIVE balance ${swapHive.toFixed(3)} < min ${MIN_ORDER_HIVE}` };
    const qty = spend / price;
    return { ...decision, order: { side: 'buy', symbol: sym, quantity: round(qty), price: round(price) }, spendHive: +spend.toFixed(4) };
  }

  return { ...decision, skip: `action ${action} not executable` };
}

// full loop: decide → bleed-guard → size → place (gated). Returns a structured report.
export async function autoTrade() {
  const m = mode();
  const decisions = await simulate();
  const actionable = decisions.filter((d) => d.action === 'SELL' || d.action === 'BUY');

  // bleed guard: drop any BUY that has no matching SELL leg in this same run (anti-SWAP.LTC drain).
  const guarded = actionable.filter((d) => d.action !== 'BUY' || actionable.some((x) => x.sym === d.sym && x.action === 'SELL'));
  const blocked = actionable
    .filter((d) => !guarded.includes(d))
    .map((d) => ({ ...d, blocked: 'no-selling-leg (SWAP.LTC bleed guard)' }));

  const tokens = await tokenBalances();
  const placed = [];
  for (const d of guarded) {
    const sized = await sizeOrder(d, tokens);
    if (sized.skip) { placed.push(sized); continue; }
    const result = await placeOrder(sized.order); // gated: simulated unless LIVE + key present
    placed.push({ ...sized, result });
  }

  return { mode: m, capHive: MAX_ORDER_HIVE, minHive: MIN_ORDER_HIVE, placed, blocked };
}

function report(r) {
  if (r.error) { console.log('error:', r.error); return; }
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] angelicalist auto-trade — ${r.mode.live ? '🔴 LIVE' : '🟢 DRY-RUN (default)'}  cap=${r.capHive} HIVE/order  account=@${r.mode.account} sweep->@${r.mode.sweepTo}`);
  console.log(`  key present: ${r.mode.hasKey}   live flag: ${r.mode.flagLive}   -> broadcasting: ${r.mode.live}`);
  if (!r.placed.length && !r.blocked.length) console.log('  (all HOLD — nothing actionable right now)');
  for (const p of r.placed) {
    if (p.skip) { console.log(`  [SKIP] ${p.sym}: ${p.skip}`); continue; }
    const tag = p.result?.simulated ? 'SIMULATED' : `LIVE tx ${p.result?.txId}`;
    const econ = p.order.side === 'sell' ? `proceeds ~${p.proceedsHive} HIVE` : `spend ~${p.spendHive} HIVE`;
    console.log(`  [${p.order.side.toUpperCase()}] ${p.order.quantity} ${p.order.symbol} @ ${p.order.price}  (${econ})  ${tag}`);
  }
  for (const b of r.blocked) console.log(`  [BLOCKED] ${b.sym}: ${b.blocked}`);
}

if (process.argv[1] && process.argv[1].endsWith('execute.mjs')) {
  const loop = process.argv.includes('--loop') || process.argv.includes('--cron');
  const everyMin = +(process.env.TRADE_INTERVAL_MIN || 5);
  const once = async () => report(await autoTrade().catch((e) => ({ error: e.message })));
  await once();
  if (loop) {
    console.log(`\n  looping every ${everyMin} min — Ctrl-C to stop.`);
    setInterval(once, everyMin * 60 * 1000);
  }
}
