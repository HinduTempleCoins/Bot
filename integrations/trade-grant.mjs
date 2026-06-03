// trade-grant.mjs — the exchange-API trade-bot GRANT (queue #175). PURE logic, NO network.
//
// A trade-bot grant is a MARKET-SCOPED authorization with a daily cap and a per-order cap, and
// — critically — NO withdrawal permission. It lets an automated trader place orders inside one
// market up to a spend ceiling, but it can NEVER move funds out of the user's custody. Custody
// never leaves the user: a withdrawal/transfer-out or any owner/active-scope action is ALWAYS
// rejected, by assertion and by test.
//
// This maps onto PRANA ERC-4337 session keys at launch: a session key delegates a narrow,
// capped, revocable permission (this market, this much/day, no withdrawals) without ever handing
// over the master/owner key. The grant object here is the off-chain analogue of that session-key
// policy — same shape: scope + caps + a hard custody boundary.
//
// Export:
//   createTradeGrant({market, dailyCap, perOrderCap}) -> grant object
//   authorize(grant, order) -> {allowed, reason}   (PURE — does not mutate the grant)
//   recordFill(grant, fill)  -> grant              (accrues a fill against the daily cap)
//
//   node integrations/trade-grant.mjs   # prints a tiny demo of the policy decisions

// Actions that touch custody / move funds out / escalate scope. ALWAYS rejected. The list is
// matched case-insensitively and is the load-bearing invariant of this module.
const FORBIDDEN_ACTIONS = new Set([
  'withdraw', 'withdrawal', 'transfer', 'transfer_out', 'transferout', 'send', 'payout',
  'redeem', 'unstake', 'owner', 'active', 'account_update', 'key_rotation', 'set_withdraw_vesting_route',
]);

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const round = (n) => +(+n).toFixed(8);

// Is this order a custody-leaving / scope-escalating action? Checks an explicit `action`/`type`
// field AND a `side` field — a trade has side buy|sell; anything else is treated as forbidden.
export function isForbidden(order) {
  if (!order || typeof order !== 'object') return true; // unknown shape -> reject, fail-closed
  const action = norm(order.action ?? order.type ?? order.op);
  if (action && FORBIDDEN_ACTIONS.has(action)) return true;
  if (order.withdraw === true || order.transfer === true) return true;
  const side = norm(order.side);
  // A legitimate trade order is buy or sell. If a side is present it must be one of those;
  // if an action is present it must be a trade action. Anything else is forbidden.
  if (side && side !== 'buy' && side !== 'sell') return true;
  if (action && action !== 'buy' && action !== 'sell' && action !== 'trade' && action !== 'order') return true;
  return false;
}

// Create a market-scoped grant. dailyCap / perOrderCap are spend ceilings in the market's quote
// unit (e.g. SWAP.HIVE). spentToday accrues via recordFill. No withdrawal permission exists on
// the grant by construction — there is no field that could enable one.
export function createTradeGrant({ market, dailyCap, perOrderCap } = {}) {
  if (!market || typeof market !== 'string') throw new Error('createTradeGrant: market (string) required');
  const d = Number(dailyCap);
  const p = Number(perOrderCap);
  if (!Number.isFinite(d) || d <= 0) throw new Error('createTradeGrant: dailyCap must be a positive number');
  if (!Number.isFinite(p) || p <= 0) throw new Error('createTradeGrant: perOrderCap must be a positive number');
  return {
    kind: 'trade-grant',
    market,
    dailyCap: round(d),
    perOrderCap: round(p),
    canWithdraw: false, // invariant — never flips to true anywhere in this module
    spentToday: 0,
  };
}

// Spend (quote-unit cost) of an order. Prefers an explicit `cost`, else quantity * price.
function orderCost(order) {
  if (Number.isFinite(Number(order.cost))) return Number(order.cost);
  const q = Number(order.quantity ?? order.amount ?? order.qty);
  const px = Number(order.price);
  if (Number.isFinite(q) && Number.isFinite(px)) return q * px;
  return NaN;
}

// PURE policy decision. Does not mutate the grant. Returns {allowed, reason}.
export function authorize(grant, order) {
  if (!grant || grant.kind !== 'trade-grant') return { allowed: false, reason: 'invalid grant' };
  // HARD INVARIANT: custody never leaves the user. A withdrawal / transfer-out / scope-escalation
  // is ALWAYS rejected, regardless of caps. Assert the grant itself never carries withdraw power.
  if (grant.canWithdraw) throw new Error('INVARIANT VIOLATED: trade grant must never have withdrawal permission');
  if (isForbidden(order)) return { allowed: false, reason: 'forbidden action: withdrawals/transfers/scope-escalation never permitted' };

  if (norm(order.market ?? order.symbol) !== norm(grant.market)) {
    return { allowed: false, reason: `wrong market: grant scoped to ${grant.market}` };
  }

  const cost = orderCost(order);
  if (!Number.isFinite(cost) || cost <= 0) return { allowed: false, reason: 'order cost not determinable' };
  if (cost > grant.perOrderCap) return { allowed: false, reason: `per-order cap exceeded: ${round(cost)} > ${grant.perOrderCap}` };
  if (round(grant.spentToday + cost) > grant.dailyCap) {
    return { allowed: false, reason: `daily cap exceeded: ${round(grant.spentToday + cost)} > ${grant.dailyCap}` };
  }
  return { allowed: true, reason: 'within market scope and caps' };
}

// Accrue a fill against the daily cap. Returns the (mutated) grant. A fill must be inside the
// grant's market and must not itself be a forbidden action — guarded the same way as authorize.
export function recordFill(grant, fill) {
  if (!grant || grant.kind !== 'trade-grant') throw new Error('recordFill: invalid grant');
  if (isForbidden(fill)) throw new Error('recordFill: refusing to accrue a forbidden (non-trade) action');
  if (norm(fill.market ?? fill.symbol) !== norm(grant.market)) throw new Error('recordFill: fill market mismatch');
  const cost = orderCost(fill);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error('recordFill: fill cost not determinable');
  grant.spentToday = round(grant.spentToday + cost);
  return grant;
}

// Reset the daily accumulator (e.g. at UTC midnight). Returns the grant.
export function resetDaily(grant) {
  if (!grant || grant.kind !== 'trade-grant') throw new Error('resetDaily: invalid grant');
  grant.spentToday = 0;
  return grant;
}

if (process.argv[1] && process.argv[1].endsWith('trade-grant.mjs')) {
  const g = createTradeGrant({ market: 'SWAP.BTC:SWAP.HIVE', dailyCap: 100, perOrderCap: 25 });
  console.log('grant:', g);
  console.log('in-market order  ->', authorize(g, { market: 'SWAP.BTC:SWAP.HIVE', side: 'buy', cost: 20 }));
  console.log('over per-order   ->', authorize(g, { market: 'SWAP.BTC:SWAP.HIVE', side: 'buy', cost: 30 }));
  console.log('wrong market     ->', authorize(g, { market: 'SWAP.DOGE:SWAP.HIVE', side: 'buy', cost: 5 }));
  console.log('withdrawal       ->', authorize(g, { action: 'withdraw', amount: 1 }));
  recordFill(g, { market: 'SWAP.BTC:SWAP.HIVE', side: 'buy', cost: 90 });
  console.log('after 90 filled, +20 ->', authorize(g, { market: 'SWAP.BTC:SWAP.HIVE', side: 'buy', cost: 20 }));
}
