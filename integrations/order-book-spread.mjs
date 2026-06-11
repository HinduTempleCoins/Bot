// order-book-spread.mjs — PURE, READ-ONLY order-book bid/ask spread + paper-wall detector.
// No network, no keys, no IO. Mirrors the clean() pattern in wall-cost.mjs.
//
// Inputs are a raw HIVE-Engine-style order book:
//   { buyOrders: [{price, quantity}, ...], sellOrders: [{price, quantity}, ...] }
//
// Buy orders (bids) are best at the HIGHEST price; sell orders (asks) are best at the
// LOWEST price. Both sides are normalized ascending-by-price here, so the best bid is
// the LAST cleaned buy row and the best ask is the FIRST cleaned sell row.
//
// detectPaperWall flags the classic CURE "paper wall" (queue items 66/77): a tiny front
// order sitting at the best price that masks much larger real depth one tick behind it —
// the visible top-of-book is thin, the real liquidity is hidden one level back.
//
//   node integrations/order-book-spread.mjs   (runs a fixture book)

// HTML-escape for any string that lands in CLI/HTML output. Never throws.
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Normalize an arbitrary side into clean ascending-by-price {price, quantity} numbers.
// Drops rows that aren't finite positive numbers. Never throws. (mirrors wall-cost clean())
export function cleanSide(orders) {
  if (!Array.isArray(orders)) return [];
  const rows = [];
  for (const o of orders) {
    if (!o || typeof o !== 'object') continue;
    const price = +o.price;
    const quantity = +o.quantity;
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    if (price <= 0 || quantity <= 0) continue;
    rows.push({ price, quantity });
  }
  rows.sort((a, b) => a.price - b.price);
  return rows;
}

// spread: best bid / best ask and the gap between them.
// Returns { bestBid, bestAsk, absSpread, spreadPct, midPrice }.
// Any field that can't be computed (empty side) is null.
//   - bestBid: highest buy price (last cleaned buy row).
//   - bestAsk: lowest sell price (first cleaned sell row).
//   - absSpread: bestAsk - bestBid (can be negative on a crossed book).
//   - spreadPct: absSpread / midPrice (fractional, e.g. 0.02 = 2%).
//   - midPrice: (bestBid + bestAsk) / 2.
export function spread(book) {
  const b = book && typeof book === 'object' ? book : {};
  const buys = cleanSide(b.buyOrders);
  const sells = cleanSide(b.sellOrders);
  const bestBid = buys.length ? buys[buys.length - 1].price : null;
  const bestAsk = sells.length ? sells[0].price : null;
  if (bestBid === null || bestAsk === null) {
    return { bestBid, bestAsk, absSpread: null, spreadPct: null, midPrice: null };
  }
  const absSpread = bestAsk - bestBid;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPct = midPrice > 0 ? absSpread / midPrice : null;
  return { bestBid, bestAsk, absSpread, spreadPct, midPrice };
}

// depthWithin: total quantity on a side within pricePct (fractional) of that side's best.
//   side = 'buy'  -> sum quantity of bids with price >= bestBid * (1 - pricePct)
//   side = 'sell' -> sum quantity of asks with price <= bestAsk * (1 + pricePct)
// Returns 0 on empty side or garbage input.
export function depthWithin(book, side, pricePct) {
  const b = book && typeof book === 'object' ? book : {};
  const pct = +pricePct;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  if (side === 'buy') {
    const buys = cleanSide(b.buyOrders);
    if (!buys.length) return 0;
    const best = buys[buys.length - 1].price;
    const floor = best * (1 - pct);
    let total = 0;
    for (const o of buys) if (o.price >= floor) total += o.quantity;
    return total;
  }
  if (side === 'sell') {
    const sells = cleanSide(b.sellOrders);
    if (!sells.length) return 0;
    const best = sells[0].price;
    const ceil = best * (1 + pct);
    let total = 0;
    for (const o of sells) if (o.price <= ceil) total += o.quantity;
    return total;
  }
  return 0;
}

// detectPaperWall: flag a thin top order shadowed by a much larger order one tick behind it.
//
// `side` is a raw array of {price, quantity} (one side of the book — buy OR sell). It is
// cleaned and read from the TOP of book outward: for sells the top is the lowest ask
// (front), for buys the top is the highest bid (front). Because cleanSide sorts ascending,
// we evaluate sells front->back and buys back->front.
//
// opts:
//   - minSpacingPct: the price of the second order must be within this fraction of the
//     front order's price to count as "one tick behind" (default 0.001 = 0.1%).
//   - minOrders: require at least this many orders to even consider a paper wall (default 3).
//   - sizeRatio: the second order must be at least this many times larger than the thin
//     front order to be flagged (default 10).
//   - side direction: pass dir:'buy' to read highest-price-first; default reads
//     lowest-price-first (sell side). Garbage dir falls back to sell-side reading.
//
// Returns { isPaper, suspectOrders, reason }.
//   - isPaper: boolean.
//   - suspectOrders: [frontOrder, shadowOrder] when flagged, else [].
//   - reason: short human string (never null).
export function detectPaperWall(side, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const minSpacingPct = Number.isFinite(+o.minSpacingPct) && +o.minSpacingPct >= 0 ? +o.minSpacingPct : 0.001;
  const minOrders = Number.isFinite(+o.minOrders) && +o.minOrders >= 0 ? Math.floor(+o.minOrders) : 3;
  const sizeRatio = Number.isFinite(+o.sizeRatio) && +o.sizeRatio > 0 ? +o.sizeRatio : 10;
  const dir = o.dir === 'buy' ? 'buy' : 'sell';

  const rows = cleanSide(side);
  if (rows.length < minOrders) {
    return { isPaper: false, suspectOrders: [], reason: 'too few orders to assess' };
  }

  // Order from top-of-book outward.
  const ordered = dir === 'buy' ? rows.slice().reverse() : rows;
  const front = ordered[0];
  const shadow = ordered[1];
  if (!front || !shadow) {
    return { isPaper: false, suspectOrders: [], reason: 'no second level behind the top' };
  }

  // Spacing: shadow must sit within minSpacingPct of the front price (one tick behind).
  const gapPct = front.price > 0 ? Math.abs(shadow.price - front.price) / front.price : Infinity;
  if (gapPct > minSpacingPct) {
    return { isPaper: false, suspectOrders: [], reason: 'second level is not one tick behind the top' };
  }

  // Size: shadow must dwarf the thin front order.
  if (shadow.quantity < front.quantity * sizeRatio) {
    return { isPaper: false, suspectOrders: [], reason: 'top order is not thin relative to the order behind it' };
  }

  return {
    isPaper: true,
    suspectOrders: [front, shadow],
    reason: `thin top (${front.quantity}) shadowing larger order (${shadow.quantity}) one tick behind`,
  };
}

if (process.argv[1] && process.argv[1].endsWith('order-book-spread.mjs')) {
  // fixture book: a tiny 5-unit ask at the front masking a 5000-unit wall one tick behind.
  const book = {
    buyOrders: [
      { price: 0.0090, quantity: 800 },
      { price: 0.0095, quantity: 300 },
      { price: 0.0098, quantity: 120 },
    ],
    sellOrders: [
      { price: 0.0100, quantity: 5 },     // thin front
      { price: 0.01001, quantity: 5000 }, // real wall, one tick behind
      { price: 0.0120, quantity: 400 },
      { price: 0.0200, quantity: 1000 },
    ],
  };
  const s = spread(book);
  const paper = detectPaperWall(book.sellOrders);
  console.log('Order-book spread + paper-wall detector (pure, no network)');
  console.log(`  best bid: ${s.bestBid}  best ask: ${s.bestAsk}`);
  console.log(`  abs spread: ${s.absSpread}  spread %: ${s.spreadPct === null ? 'n/a' : (s.spreadPct * 100).toFixed(3) + '%'}`);
  console.log(`  mid price: ${s.midPrice}`);
  console.log(`  sell depth within 5%: ${depthWithin(book, 'sell', 0.05)}`);
  console.log(`  buy depth within 5%:  ${depthWithin(book, 'buy', 0.05)}`);
  console.log(`  paper wall? ${paper.isPaper} — ${esc(paper.reason)}`);
}
