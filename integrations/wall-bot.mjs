// wall-bot.mjs — buy-wall / sell-wall logic for the HIVE-Engine market (VKBT/CURE price support).
// Operator 2026-06-01: "is there buy wall / sell wall bot logic, get it up and working." A BUY
// WALL is a large resting bid that defends a price floor (support); a SELL WALL is a large resting
// ask that caps the price (resistance). This module: (1) DETECTS existing walls in the book
// (read-only), and (2) decides what wall the bot SHOULD maintain to defend a floor — dry-run by
// default; it only places orders when the operator wires the angelicalist key + LIVE=true.
// Every run reports via the universal bot-data collector -> annals/briefs.
//
//   node integrations/wall-bot.mjs VKBT            # detect walls + what it would maintain
//   import { detectWalls, wallStrategy } from './wall-bot.mjs'

import { market } from './hive-engine-market.mjs';
import { emitBotData } from '../tools/bot-data.mjs';

// PURE: find "walls" in one side of the book — orders whose size is >= minMultiple x the median
// order size (a wall is an order conspicuously larger than the crowd). Returns them biggest-first
// with the cumulative size resting at/through that price.
export function detectWalls(orders, { minMultiple = 3 } = {}) {
  const sized = orders.map((o) => ({ price: +o.price, quantity: +o.quantity, account: o.account })).filter((o) => o.quantity > 0);
  if (sized.length < 2) return [];
  const qtys = [...sized].map((o) => o.quantity).sort((a, b) => a - b);
  const median = qtys[qtys.length >> 1] || 0;
  return sized
    .filter((o) => median > 0 && o.quantity >= minMultiple * median)
    .map((o) => ({ ...o, multipleOfMedian: +(o.quantity / median).toFixed(1) }))
    .sort((a, b) => b.quantity - a.quantity);
}

/**
 * Decide the wall to maintain. Given the book + a target floor (and optional ceiling) + the size
 * we want the wall to be, return the intended action. If a strong-enough buy wall already defends
 * the floor, HOLD; else intend to PLACE one at the floor. Symmetric for the sell-side ceiling.
 * PURE — returns intents; the runner executes them (dry-run unless live).
 */
export function wallStrategy({ buyBook = [], sellBook = [], floor, ceiling, wallSize, minMultiple = 3 }) {
  const intents = [];
  const buyWalls = detectWalls(buyBook, { minMultiple });
  const sellWalls = detectWalls(sellBook, { minMultiple });

  if (floor && wallSize) {
    // is there a buy wall at or above the floor, big enough?
    const defending = buyWalls.find((w) => w.price >= floor && w.quantity >= wallSize * 0.8);
    if (!defending) intents.push({ action: 'PLACE_BUY_WALL', price: floor, quantity: wallSize, reason: `no buy wall defending the $${floor} floor` });
    else intents.push({ action: 'HOLD_BUY', reason: `buy wall already defends floor: ${defending.quantity} @ ${defending.price}` });
  }
  if (ceiling && wallSize) {
    const capping = sellWalls.find((w) => w.price <= ceiling && w.quantity >= wallSize * 0.8);
    if (!capping) intents.push({ action: 'PLACE_SELL_WALL', price: ceiling, quantity: wallSize, reason: `no sell wall capping the $${ceiling} ceiling` });
    else intents.push({ action: 'HOLD_SELL', reason: `sell wall already caps ceiling: ${capping.quantity} @ ${capping.price}` });
  }
  return { buyWalls, sellWalls, intents };
}

// runner: read VKBT (or given) book, analyse, EMIT DATA (annals feed), print. Dry-run; execution
// is wired through angelicalist/trader.placeOrder when the operator turns it live.
export async function run(symbol = 'VKBT', opts = {}) {
  const [buyBook, sellBook] = await Promise.all([market.buyBook(symbol, 50), market.sellBook(symbol, 50)]);
  const floor = opts.floor ?? parseFloat(process.env.WALL_FLOOR || '0.01');
  const ceiling = opts.ceiling ?? parseFloat(process.env.WALL_CEILING || '0');
  const wallSize = opts.wallSize ?? parseFloat(process.env.WALL_SIZE || '1000');
  const result = wallStrategy({ buyBook, sellBook, floor, ceiling: ceiling || undefined, wallSize });
  const summary = `${symbol}: ${result.buyWalls.length} buy wall(s), ${result.sellWalls.length} sell wall(s); ` +
    result.intents.map((i) => i.action).join(', ');
  emitBotData('wall-bot', { summary, data: { symbol, floor, ceiling, wallSize, ...result } });
  return { symbol, ...result, summary };
}

if (process.argv[1] && process.argv[1].endsWith('wall-bot.mjs')) {
  const symbol = process.argv[2] || 'VKBT';
  const r = await run(symbol);
  console.log(`Wall bot — ${symbol} (read-only / dry-run)\n${'─'.repeat(60)}`);
  console.log(`Buy walls (support): ${r.buyWalls.length}`);
  for (const w of r.buyWalls.slice(0, 5)) console.log(`  ${w.quantity} @ ${w.price}  (${w.multipleOfMedian}x median) — @${w.account}`);
  console.log(`Sell walls (resistance): ${r.sellWalls.length}`);
  for (const w of r.sellWalls.slice(0, 5)) console.log(`  ${w.quantity} @ ${w.price}  (${w.multipleOfMedian}x median) — @${w.account}`);
  console.log('Intended actions:');
  for (const i of r.intents) console.log(`  [${i.action}] ${i.reason}`);
  console.log('\n→ data emitted to .local/shared/bot-wall-bot.md (annals feed). Execution gated on the key + LIVE.');
}
