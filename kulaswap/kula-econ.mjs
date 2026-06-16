// kula-econ.mjs — KULA NET-SUPPLY + protocol-owned-liquidity (PoL) FLOOR model (pure math, no chain).
//
// THE PROBLEM this models: the bare loop is `provide liquidity → earn PoL (an emission token) →
// MultiBurnMine burns PoL and MINTS KULA`. That only ADDS KULA — there is no matching KULA sink, so
// KULA trends inflationary. Operator: "we don't want KULA to just be an inflation token."
//
// THE FIX this models: route every KULA *use* to real SINKS so emission is offset/exceeded —
//   (a) BURN KULA — swap fees via FeeCollectorBurner, app/usage via UsageBurn, ProofOfBurnRegistry; AND
//   (b) BUY BACK + LOCK — CommunityBuybackVault buys KULA on the AMM and LPs it into protocol-owned
//       liquidity, then LiquidityLocker locks it permanently → a growing, withdrawable-by-no-one FLOOR.
// Net KULA supply Δ = emission − burned − boughtBack(removed-from-float). The PoL floor = the quote
// (e.g. SBD / stable) the protocol's own locked liquidity could pay per circulating KULA — a hard-ish
// price floor that GROWS as buyback+lock compounds.
//
// PURE arithmetic, soft-fail to 0/safe, NEVER throws, no network. Mirrors kula-farm.mjs's tuner role:
// pick burn% / buyback% / lock params here, see whether KULA goes flat/deflationary and how fast the
// floor grows, BEFORE pinning the on-chain wiring (roles + ratios) in Solidity.

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };
const BPS = 10000;
const clampBps = (b) => Math.min(BPS, Math.max(0, Math.round(nn(b))));

/**
 * Net KULA supply change for one epoch.
 *   emitted    — KULA minted this epoch (MultiBurnMine PoL→KULA + any farm/gauge emission).
 *   burned     — KULA destroyed this epoch (FeeCollectorBurner + UsageBurn + ProofOfBurnRegistry +
 *                CommunityBuybackVault in BURN mode).
 *   boughtBack — KULA bought on the AMM and LOCKED into protocol-owned liquidity (LiquidityLocker).
 *                It is not destroyed, but it is removed from circulating float forever, so for
 *                *circulating* supply it acts like a sink. Tracked separately so we can also report
 *                gross (minted) supply.
 * Returns the per-epoch deltas and a `net` (Δ circulating) that can be negative (deflationary).
 */
export function netKulaFlow({ emitted = 0, burned = 0, boughtBack = 0 } = {}) {
  const e = nn(emitted), b = nn(burned), bb = nn(boughtBack);
  const sinks = round(b + bb, 8);          // total removed from circulating float
  return {
    emitted: round(e, 8),
    burned: round(b, 8),
    boughtBack: round(bb, 8),
    sinks,
    net: round(e - sinks, 8),              // Δ circulating supply (− = deflationary)
    netMinted: round(e - b, 8),            // Δ gross minted supply (burn only; lock doesn't reduce mint)
  };
}

/**
 * Given a KULA "use" volume for an epoch, split it into BURN and BUYBACK+LOCK per the policy bps, and
 * return the resulting flow vs the epoch emission. This is the off-chain mirror of the on-chain wiring:
 *   useVolumeKula  — KULA-denominated value flowing through uses this epoch (fees + usage burns, in KULA).
 *   burnBps        — share of useVolume routed straight to BURN (FeeCollectorBurner / UsageBurn).
 *   buybackBps     — share routed to CommunityBuybackVault → buy KULA on AMM → LP → lock (PoL floor).
 *   (remainder stays as protocol revenue / treasury — NOT a sink.)
 *   emitted        — KULA minted this epoch (the PoL→KULA mint etc.).
 */
export function applyUsePolicy({ useVolumeKula = 0, burnBps = 5000, buybackBps = 3000, emitted = 0 } = {}) {
  const use = nn(useVolumeKula);
  const burnB = clampBps(burnBps), buyB = clampBps(buybackBps);
  const total = burnB + buyB;
  // if the two shares exceed 100% (misconfig), scale them down proportionally rather than throw.
  const scale = total > BPS ? BPS / total : 1;
  const burned = round(use * burnB * scale / BPS, 8);
  const boughtBack = round(use * buyB * scale / BPS, 8);
  const flow = netKulaFlow({ emitted, burned, boughtBack });
  return { ...flow, useVolumeKula: round(use, 8), toTreasury: round(use - burned - boughtBack, 8) };
}

/**
 * PoL floor price. The protocol owns LOCKED liquidity in the KULA/quote AMM pool: `polReserveKula` KULA
 * paired with `polReserveQuote` of the quote asset (stable / SBD / native). If *every* circulating KULA
 * were redeemed against only the protocol's OWN quote reserves, each KULA could claim at most
 *   floor = polReserveQuote / circulatingKula.
 * That is a conservative hard floor: protocol-owned liquidity can't be rugged (it's locked), so the
 * market can't durably trade KULA below the value its own treasury liquidity backs. Also reports the
 * in-pool spot (reserveQuote/reserveKula) for reference. Soft-fails to 0.
 */
export function polFloorPrice({ polReserveKula = 0, polReserveQuote = 0, circulatingKula = 0 } = {}) {
  const rk = nn(polReserveKula), rq = nn(polReserveQuote), circ = nn(circulatingKula);
  const spot = rk > 0 ? round(rq / rk, 8) : 0;                       // in-pool KULA price (quote/KULA)
  const floor = circ > 0 ? round(rq / circ, 8) : 0;                 // quote backing per circulating KULA
  const coverageBps = circ > 0 ? round(Math.min(BPS, rk / circ * BPS), 4) : 0; // % of supply pool owns
  return { floor, spot, polReserveKula: round(rk, 8), polReserveQuote: round(rq, 8), coverageBps };
}

/** Is the loop deflationary (or flat) this epoch? net circulating Δ <= 0. */
export function isDeflationary({ emitted = 0, burned = 0, boughtBack = 0 } = {}) {
  return netKulaFlow({ emitted, burned, boughtBack }).net <= 0;
}

/**
 * Multi-epoch simulation of supply + PoL floor.
 *   epochs            — how many epochs to run.
 *   initialSupply     — starting circulating KULA.
 *   emittedPerEpoch   — KULA minted each epoch (PoL→KULA mint; can be a number or fn(epoch)).
 *   useVolumePerEpoch — KULA-value of uses each epoch routed by the policy (number or fn(epoch)).
 *   burnBps/buybackBps— the use-policy split (see applyUsePolicy).
 *   initPolKula/initPolQuote — starting protocol-owned-liquidity reserves.
 *   quotePerKula      — price used to value bought-back KULA when LPing it into PoL (quote/KULA).
 *                       Each buyback adds `boughtBack` KULA + `boughtBack*quotePerKula` quote to the
 *                       locked pool (a balanced add at the current price), growing the floor.
 * Returns { rows[], summary }. Each row: epoch, emitted, burned, boughtBack, net, supply, floor, spot.
 */
export function simulate(epochs = 12, {
  initialSupply = 0,
  emittedPerEpoch = 0,
  useVolumePerEpoch = 0,
  burnBps = 5000,
  buybackBps = 3000,
  initPolKula = 0,
  initPolQuote = 0,
  quotePerKula = 0,
} = {}) {
  const n = Math.max(0, Math.floor(nn(epochs)));
  const asFn = (v) => (typeof v === 'function' ? v : () => nn(v));
  const emitFn = asFn(emittedPerEpoch);
  const useFn = asFn(useVolumePerEpoch);
  const price = nn(quotePerKula);

  let supply = nn(initialSupply);
  let polKula = nn(initPolKula);
  let polQuote = nn(initPolQuote);
  const rows = [];

  for (let i = 1; i <= n; i++) {
    const emitted = nn(emitFn(i));
    const useVolumeKula = nn(useFn(i));
    const f = applyUsePolicy({ useVolumeKula, burnBps, buybackBps, emitted });

    // circulating supply: + emitted, − burned, − boughtBack (locked away).
    supply = Math.max(0, round(supply + f.emitted - f.burned - f.boughtBack, 8));

    // protocol-owned liquidity grows: bought-back KULA is LP'd in (balanced add at `price`) and locked.
    polKula = round(polKula + f.boughtBack, 8);
    polQuote = round(polQuote + f.boughtBack * price, 8);

    const { floor, spot } = polFloorPrice({ polReserveKula: polKula, polReserveQuote: polQuote, circulatingKula: supply });
    rows.push({
      epoch: i,
      emitted: f.emitted, burned: f.burned, boughtBack: f.boughtBack,
      net: f.net, supply, polKula, polQuote, floor, spot,
    });
  }

  const first = rows[0], last = rows[rows.length - 1];
  const summary = {
    epochs: n,
    startSupply: round(nn(initialSupply), 8),
    endSupply: last ? last.supply : round(nn(initialSupply), 8),
    supplyDelta: last ? round(last.supply - nn(initialSupply), 8) : 0,
    deflationary: last ? last.supply <= nn(initialSupply) : true,
    startFloor: first ? first.floor : 0,
    endFloor: last ? last.floor : 0,
    floorGrew: !!(first && last && last.floor > first.floor),
    totalEmitted: round(rows.reduce((a, r) => a + r.emitted, 0), 8),
    totalBurned: round(rows.reduce((a, r) => a + r.burned, 0), 8),
    totalBoughtBack: round(rows.reduce((a, r) => a + r.boughtBack, 0), 8),
  };
  return { rows, summary };
}

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('kula-econ.mjs')) {
  // Sample: 12 epochs. Emit 100k KULA/epoch from PoL→KULA. Each epoch ~250k KULA of uses flow through,
  // policy = 50% burn / 30% buyback+lock. That's 125k burned + 75k locked = 200k sinks > 100k emission.
  const sim = simulate(12, {
    initialSupply: 2_000_000, emittedPerEpoch: 100_000, useVolumePerEpoch: 250_000,
    burnBps: 5000, buybackBps: 3000, initPolKula: 0, initPolQuote: 0, quotePerKula: 0.10,
  });
  console.log('per-epoch:', sim.rows.map((r) => ({ ep: r.epoch, supply: r.supply, floor: r.floor })));
  console.log('summary:', sim.summary);
  console.log('single epoch net (emit 100k, burn 125k, lock 75k):',
    netKulaFlow({ emitted: 100_000, burned: 125_000, boughtBack: 75_000 }));
  console.log('deflationary?', isDeflationary({ emitted: 100_000, burned: 125_000, boughtBack: 75_000 }));
  console.log('floor @ 1M KULA circ, PoL=100k KULA/$50k:',
    polFloorPrice({ polReserveKula: 100_000, polReserveQuote: 50_000, circulatingKula: 1_000_000 }));
}
