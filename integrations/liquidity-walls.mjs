// liquidity-walls.mjs — detect buy/sell "walls" in an order book (queue: "Analyze buy/sell wall
// liquidity"). A wall = an order (or tight price cluster) whose size dwarfs the typical resting order,
// which acts as support (buy wall) or resistance (sell wall) the trading bots should respect.
//
// PURE: takes an order book in, returns analysis out. No IO, no network, soft-fail-never-throw.
//   import { detectWalls, wallSummary } from './liquidity-walls.mjs'
//   detectWalls({ bids:[[price,size],...], asks:[[price,size],...] }, { mult: 5 })
// Also accepts the repo's Hive-Engine book shape ({ buyOrders, sellOrders } with {price, quantity})
// so it composes with order-book-spread.mjs / market-depth.mjs. detectPaperWall (in
// order-book-spread.mjs) flags SPOOFS — a thin top hiding a big order; detectWalls here finds the
// genuinely large resting orders that act as real support/resistance. Different jobs, same book.

// median of a numeric array (0 on empty). Pure.
function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((m, n) => m - n);
  if (!a.length) return 0;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Normalize one side into [{price, size}], dropping junk. Accepts [[p,s],...] or [{price,size},...].
function normSide(side) {
  if (!Array.isArray(side)) return [];
  return side
    .map((row) => {
      if (Array.isArray(row)) return { price: Number(row[0]), size: Number(row[1]) };
      if (row && typeof row === 'object') return { price: Number(row.price), size: Number(row.size ?? row.amount ?? row.quantity) };
      return null;
    })
    .filter((o) => o && Number.isFinite(o.price) && Number.isFinite(o.size) && o.size > 0);
}

/**
 * detectWalls(book, opts) -> { buyWalls, sellWalls, refSize, mult }
 *   A level is a wall when its size >= mult × the median resting size on that side.
 *   opts: { mult=5 (wall threshold multiple), min=0 (ignore sizes below this) }
 * Walls are returned largest-first, each with how many × the median it is.
 */
export function detectWalls(book = {}, { mult = 5, min = 0 } = {}) {
  const b = book && typeof book === 'object' ? book : {};
  const bids = normSide(b.bids ?? b.buyOrders).filter((o) => o.size >= min);
  const asks = normSide(b.asks ?? b.sellOrders).filter((o) => o.size >= min);
  const refBid = median(bids.map((o) => o.size));
  const refAsk = median(asks.map((o) => o.size));
  const wallsOf = (side, ref) => (ref > 0
    ? side.filter((o) => o.size >= ref * mult).map((o) => ({ ...o, x: Math.round((o.size / ref) * 10) / 10 })).sort((a, b) => b.size - a.size)
    : []);
  return { buyWalls: wallsOf(bids, refBid), sellWalls: wallsOf(asks, refAsk), refBidSize: refBid, refAskSize: refAsk, mult };
}

/**
 * wallSummary(book, opts) -> a one-line, human-readable read of the nearest support/resistance.
 * Soft-fail: returns a plain string even on empty/garbage input.
 */
export function wallSummary(book = {}, opts = {}) {
  const { buyWalls, sellWalls } = detectWalls(book, opts);
  const top = (w) => (w.length ? `${w[0].size} @ ${w[0].price} (${w[0].x}× median)` : 'none');
  if (!buyWalls.length && !sellWalls.length) return 'No significant walls — order book is evenly distributed.';
  return `Support (buy wall): ${top(buyWalls)} · Resistance (sell wall): ${top(sellWalls)}`;
}
