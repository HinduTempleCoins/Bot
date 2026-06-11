// bridge-fee.mjs — cross-chain bridge fee & receive-amount calculator (backlog e0d0b547c7).
//
// PURE off-chain math for the "bridge to Ethereum / easy bridges / cross-chain bridges"
// items (359/363/368/381 — the burn-to-mint bridge). NOTHING is bridged here, no network,
// no secrets, no signing. This file only answers "if I send X across this bridge, what do
// I actually receive, and which route is cheapest?". Soft-fail everywhere — never throws.
//
//   import { bridgeQuote, roundTripCost, compareRoutes, breakEvenAmount } from './bridge-fee.mjs'
//   node integrations/bridge-fee.mjs 1000
//
// A bridge "leg" fee config:
//   { flatFee, pctFeeBps, minFee, maxFee }
//   - flatFee   : fixed fee subtracted regardless of amount (e.g. gas reimbursement). default 0
//   - pctFeeBps : proportional fee in basis points (1 bps = 0.01%). default 0
//   - minFee    : the computed fee is clamped UP to at least this. default 0
//   - maxFee    : the computed fee is clamped DOWN to at most this. default Infinity
//
// All amounts are plain numbers (the caller decides the unit/precision). We validate
// non-negative and finite, and a soft-failed call returns { ok:false, error }.

// --- HTML escape (strict; for any future render path / CLI safety) ----------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- validation helpers -----------------------------------------------------

function isNonNegNum(x) {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

// maxFee is allowed to be Infinity; everything else must be a finite non-negative number.
function validateLeg({ flatFee = 0, pctFeeBps = 0, minFee = 0, maxFee = Infinity } = {}) {
  if (!isNonNegNum(flatFee)) return 'flatFee must be a non-negative finite number';
  if (!isNonNegNum(pctFeeBps)) return 'pctFeeBps must be a non-negative finite number';
  if (!isNonNegNum(minFee)) return 'minFee must be a non-negative finite number';
  if (typeof maxFee !== 'number' || Number.isNaN(maxFee) || maxFee < 0) {
    return 'maxFee must be a non-negative number (Infinity allowed)';
  }
  if (Number.isFinite(maxFee) && maxFee < minFee) return 'maxFee must be >= minFee';
  return null;
}

// --- bridgeQuote: one leg --------------------------------------------------
//
// fee = clamp( flatFee + amount * pctFeeBps/10000, minFee, maxFee )
// received = max(0, amount - fee)
// effectiveBps = fee / amount * 10000 (0 when amount is 0)

export function bridgeQuote({ amount, flatFee = 0, pctFeeBps = 0, minFee = 0, maxFee = Infinity } = {}) {
  if (!isNonNegNum(amount)) {
    return { ok: false, error: 'amount must be a non-negative finite number' };
  }
  const legErr = validateLeg({ flatFee, pctFeeBps, minFee, maxFee });
  if (legErr) return { ok: false, error: legErr };

  const raw = flatFee + (amount * pctFeeBps) / 10000;
  // clamp up to minFee, then down to maxFee
  let fee = Math.max(raw, minFee);
  fee = Math.min(fee, maxFee);
  // fee can never exceed the amount (you can't receive negative)
  fee = Math.min(fee, amount);

  const received = amount - fee;
  const effectiveBps = amount > 0 ? (fee / amount) * 10000 : 0;

  return { ok: true, sent: amount, fee, received, effectiveBps };
}

// --- roundTripCost: compose two legs (out then back) -----------------------
//
// outbound leg charges on `amount`; the inbound leg charges on what arrived.
// returns the two leg quotes, total fee, the final received amount, and the
// round-trip effective bps against the original amount.

export function roundTripCost({ amount, outbound, inbound } = {}) {
  if (!isNonNegNum(amount)) {
    return { ok: false, error: 'amount must be a non-negative finite number' };
  }
  if (!outbound || typeof outbound !== 'object') {
    return { ok: false, error: 'outbound leg config required' };
  }
  if (!inbound || typeof inbound !== 'object') {
    return { ok: false, error: 'inbound leg config required' };
  }

  const out = bridgeQuote({ ...outbound, amount });
  if (!out.ok) return { ok: false, error: `outbound: ${out.error}` };

  const back = bridgeQuote({ ...inbound, amount: out.received });
  if (!back.ok) return { ok: false, error: `inbound: ${back.error}` };

  const totalFee = out.fee + back.fee;
  const received = back.received;
  const effectiveBps = amount > 0 ? (totalFee / amount) * 10000 : 0;

  return { ok: true, sent: amount, outbound: out, inbound: back, totalFee, received, effectiveBps };
}

// --- compareRoutes: rank routes by received amount -------------------------
//
// routes: [{ name?, flatFee?, pctFeeBps?, minFee?, maxFee? }, ...]
// returns ranked list (most received first); each entry carries its quote and
// a `best` flag on the winner. Ties keep input order (stable). Invalid routes
// are excluded into `skipped` rather than throwing.

export function compareRoutes(amount, routes) {
  if (!isNonNegNum(amount)) {
    return { ok: false, error: 'amount must be a non-negative finite number' };
  }
  if (!Array.isArray(routes) || routes.length === 0) {
    return { ok: false, error: 'routes must be a non-empty array' };
  }

  const ranked = [];
  const skipped = [];
  routes.forEach((route, idx) => {
    const r = route && typeof route === 'object' ? route : {};
    const q = bridgeQuote({ ...r, amount });
    if (!q.ok) {
      skipped.push({ index: idx, name: r.name, error: q.error });
      return;
    }
    ranked.push({
      name: typeof r.name === 'string' ? r.name : `route-${idx}`,
      index: idx,
      fee: q.fee,
      received: q.received,
      effectiveBps: q.effectiveBps,
      best: false,
    });
  });

  if (ranked.length === 0) {
    return { ok: false, error: 'no valid routes', skipped };
  }

  // stable sort: most received first; tie-break by original input index
  ranked.sort((a, b) => (b.received - a.received) || (a.index - b.index));
  ranked[0].best = true;

  return { ok: true, amount, ranked, best: ranked[0], skipped };
}

// --- breakEvenAmount: where one route overtakes another --------------------
//
// Given routeA (typically higher flat fee, lower pct) and routeB, find the
// amount at which their RECEIVED amounts are equal — above which the
// lower-pct route wins. Pure algebra on the un-clamped fee lines:
//
//   feeA(x) = flatA + x*pA      (pA = pctFeeBps/10000)
//   feeB(x) = flatB + x*pB
//   break-even where feeA == feeB  ->  x = (flatA - flatB) / (pB - pA)
//
// Returns { ok, amount, crossover } where crossover names which route is
// cheaper below vs at/above the break-even. If the fee lines are parallel
// (pA == pB) there is no crossover: one route dominates everywhere (or they
// are identical). min/max clamps are NOT modeled here (they bend the lines);
// callers wanting clamp-aware comparison use compareRoutes at a given amount.

export function breakEvenAmount(routeA, routeB) {
  const ea = validateLeg(routeA || {});
  if (ea) return { ok: false, error: `routeA: ${ea}` };
  const eb = validateLeg(routeB || {});
  if (eb) return { ok: false, error: `routeB: ${eb}` };

  const flatA = routeA.flatFee || 0;
  const flatB = routeB.flatFee || 0;
  const pA = (routeA.pctFeeBps || 0) / 10000;
  const pB = (routeB.pctFeeBps || 0) / 10000;

  const denom = pB - pA;

  if (denom === 0) {
    // parallel lines: whichever has the lower flat fee wins everywhere
    if (flatA === flatB) {
      return { ok: true, amount: null, crossover: 'identical', note: 'routes have equal fees at every amount' };
    }
    const cheaper = flatA < flatB ? 'A' : 'B';
    return { ok: true, amount: null, crossover: 'none', note: `route ${cheaper} is cheaper at every amount (parallel fees)` };
  }

  const x = (flatA - flatB) / denom;

  if (x < 0) {
    // crossover is at a negative (impossible) amount -> one route dominates for all valid amounts
    const q = 1; // probe a positive amount to see who wins
    const feeA = flatA + q * pA;
    const feeB = flatB + q * pB;
    const cheaper = feeA < feeB ? 'A' : 'B';
    return { ok: true, amount: x, crossover: 'none', note: `no crossover for positive amounts; route ${cheaper} is cheaper` };
  }

  // below x, the lower-flat route is cheaper; above x, the lower-pct route is cheaper
  const lowerPct = pA < pB ? 'A' : (pB < pA ? 'B' : null);
  const lowerFlat = flatA < flatB ? 'A' : (flatB < flatA ? 'B' : null);

  return {
    ok: true,
    amount: x,
    crossover: 'positive',
    cheaperBelow: lowerFlat,
    cheaperAbove: lowerPct,
    note: `routes break even at amount ${x}; below it route ${lowerFlat} wins, above it route ${lowerPct} wins`,
  };
}

// --- CLI (guarded) ----------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const amount = Number(process.argv[2] ?? 1000);
  const demo = compareRoutes(amount, [
    { name: 'flat-heavy', flatFee: 5, pctFeeBps: 5 },
    { name: 'pct-heavy', flatFee: 0, pctFeeBps: 30 },
    { name: 'capped', flatFee: 1, pctFeeBps: 20, maxFee: 4 },
  ]);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(demo, null, 2));
}
