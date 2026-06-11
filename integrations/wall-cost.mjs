// wall-cost.mjs — PURE, READ-ONLY cost-to-push order-book calculator. No network, no keys.
//
// Given a raw sell-side order book (array of {price, quantity}) and a target price,
// computes exactly what it costs to BUY THROUGH THE WALL — i.e. consume every sell
// order at or below the target price — and where that lifts the floor (low ask) to.
//
// market-depth.mjs only slices the top 8 levels for *display*; the stored snapshots
// carry a precomputed wall.costToPush but nothing recomputes it from a raw book.
// This module is that calculation, deterministic and soft-failing on garbage input.
//
//   node integrations/wall-cost.mjs   (runs a fixture book)

// Normalize an arbitrary book into clean ascending-by-price {price, quantity} numbers.
// Drops rows that aren't finite positive numbers. Never throws.
function clean(sellOrders) {
  if (!Array.isArray(sellOrders)) return [];
  const rows = [];
  for (const o of sellOrders) {
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

// costToPush: sum cost (price*quantity) of every sell order with price <= targetPrice.
// Returns { hiveCost, ordersConsumed, newFloor }.
//   - hiveCost: total HIVE spent buying through the wall.
//   - ordersConsumed: how many sell levels were lifted.
//   - newFloor: the lowest remaining ask after consuming the wall (the new floor),
//               or null if the whole book was consumed.
export function costToPush(sellOrders, targetPrice) {
  const rows = clean(sellOrders);
  const target = +targetPrice;
  if (!rows.length || !Number.isFinite(target) || target <= 0) {
    return { hiveCost: 0, ordersConsumed: 0, newFloor: rows[0] ? rows[0].price : null };
  }
  let hiveCost = 0;
  let ordersConsumed = 0;
  let newFloor = null;
  for (const o of rows) {
    if (o.price <= target) {
      hiveCost += o.price * o.quantity;
      ordersConsumed++;
    } else if (newFloor === null) {
      newFloor = o.price; // first ask above the target = the new floor
    }
  }
  return { hiveCost, ordersConsumed, newFloor };
}

// affordable: can you push the floor to targetPrice with at most maxHive?
export function affordable(sellOrders, targetPrice, maxHive) {
  const budget = +maxHive;
  if (!Number.isFinite(budget) || budget <= 0) return false;
  const { hiveCost, ordersConsumed } = costToPush(sellOrders, targetPrice);
  if (ordersConsumed === 0) return false; // nothing to push / no wall at/below target
  return hiveCost <= budget;
}

// scoreOpportunity: a 0..1 score blending affordability and holder breadth.
//   { sellOrders, targetPrice, maxHive, holders }
//   - affordability term: how much budget headroom relative to the wall cost
//     (1 = free/already there, → 0 as cost approaches/exceeds budget).
//   - breadth term: more distinct outside holders = healthier, realer demand.
// Returns a number in [0,1]. Pure, deterministic, soft-fail to 0 on garbage.
export function scoreOpportunity({ sellOrders, targetPrice, maxHive, holders } = {}) {
  const budget = +maxHive;
  if (!Number.isFinite(budget) || budget <= 0) return 0;
  const { hiveCost, ordersConsumed } = costToPush(sellOrders, targetPrice);
  if (ordersConsumed === 0) return 0;
  if (hiveCost > budget) return 0; // unaffordable

  // Affordability: 1 when free, decaying to 0 as cost fills the budget.
  const afford = 1 - hiveCost / budget; // in (0,1]

  // Breadth: holders can be a count or an array. 0 holders → 0; saturates by ~10.
  const n = Array.isArray(holders) ? holders.length : (Number.isFinite(+holders) ? +holders : 0);
  const breadth = n <= 0 ? 0 : Math.min(1, n / 10);

  // Blend (equal weight), clamp to [0,1].
  const score = 0.5 * afford + 0.5 * breadth;
  return Math.max(0, Math.min(1, score));
}

if (process.argv[1] && process.argv[1].endsWith('wall-cost.mjs')) {
  // fixture sell book (ascending asks)
  const book = [
    { price: 0.0100, quantity: 100 },
    { price: 0.0120, quantity: 250 },
    { price: 0.0150, quantity: 400 },
    { price: 0.0200, quantity: 1000 },
    { price: 0.0300, quantity: 5000 },
  ];
  const target = 0.0150;
  const r = costToPush(book, target);
  console.log('Cost-to-push order-book calculator (pure, no network)');
  console.log(`  fixture: ${book.length} sell levels, target ${target} HIVE`);
  console.log(`  cost to lift floor to ${target}: ${r.hiveCost.toFixed(4)} HIVE`);
  console.log(`  orders consumed: ${r.ordersConsumed}  new floor: ${r.newFloor}`);
  console.log(`  affordable with 10 HIVE? ${affordable(book, target, 10)}`);
  console.log(`  affordable with 1 HIVE?  ${affordable(book, target, 1)}`);
  console.log(`  opportunity score (8 holders, 10 HIVE budget): ${scoreOpportunity({ sellOrders: book, targetPrice: target, maxHive: 10, holders: 8 }).toFixed(3)}`);
}
