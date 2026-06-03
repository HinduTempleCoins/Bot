// staking-decision.mjs — staking-vs-trading decision engine for the full token portfolio (queue #47).
// PURE logic, NO network. All market/APR data is injected by the caller (the readers that talk to
// HIVE-Engine live elsewhere). For each held token it compares an estimated staking yield against an
// estimated trading return (volatility/spread driven) and recommends STAKE / TRADE / HOLD with reasons.
//
// Lessons honoured (forensics memory):
//   - illiquid / dead tokens → HOLD (sunk; you cannot trade out of nothing, "trade" is a trap)
//   - high-volume oscillators (volatile + liquid + tradeable spread) → TRADE
//   - steady stakers (real APR, calm price) → STAKE
//
//   node integrations/staking-decision.mjs        # demo against a tiny fixture portfolio
//
// Exports: decide(), portfolioPlan(), stakeScore(), tradeScore().

// ── tunables (kept here so the math is legible and testable) ──────────────────
const LIQUIDITY_FLOOR = 50;     // HIVE of book/volume below which a token is "dead" → HOLD
const TRADE_MARGIN = 1.15;      // tradeScore must beat stakeScore by this factor to pick TRADE
const STAKE_MARGIN = 1.15;      // stakeScore must beat tradeScore by this factor to pick STAKE

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);

// ── pure helpers ─────────────────────────────────────────────────────────────

// stakeScore: reward holding-and-earning. Driven mostly by APR; calm (low-volatility) tokens get a
// small bonus (you are comfortable leaving them staked), wild ones a small penalty (opportunity cost
// of being locked while the price swings). Illiquidity does NOT help staking — a dead token's "APR"
// is often unrealisable — so very illiquid tokens are damped.
export function stakeScore({ stakingApr = 0, volatility = 0, liquidity = 0 } = {}) {
  const apr = Math.max(0, num(stakingApr));            // e.g. 0.20 = 20% APR
  const vol = clamp01(num(volatility));                // 0..1
  const liq = Math.max(0, num(liquidity));
  const calmBonus = 1 + (0.5 - vol) * 0.4;             // calm → up to ~1.2x, wild → down to ~0.8x
  const liqDamp = liq < LIQUIDITY_FLOOR ? 0.4 : 1;     // can't really realise yield on a dead market
  return +(apr * 100 * calmBonus * liqDamp).toFixed(4);
}

// tradeScore: reward exploitable movement. You need both movement (volatility) AND the ability to get
// in/out cheaply (liquidity, tight spread). A volatile token you cannot exit is worthless to a trader,
// so liquidity gates the score hard and spread is subtracted as a friction cost.
export function tradeScore({ volatility = 0, spreadPct = 0, liquidity = 0 } = {}) {
  const vol = clamp01(num(volatility));                // 0..1
  const spread = Math.max(0, num(spreadPct));          // % per round-trip-ish
  const liq = Math.max(0, num(liquidity));             // HIVE
  // liquidity factor saturates: lots of liquidity is good, but past a point it doesn't add edge.
  const liqFactor = clamp01(liq / 500);               // 0 at dead, ~1 at 500+ HIVE depth
  const gross = vol * 100 * liqFactor;                 // raw oscillation opportunity
  const net = gross - spread * 2;                      // pay the spread to enter and exit
  return +Math.max(0, net).toFixed(4);
}

// ── core decision ────────────────────────────────────────────────────────────

// decide(token, marketRow) → { action, reason, scoreStake, scoreTrade }
// action ∈ STAKE | TRADE | HOLD
export function decide(token, { stakingApr = 0, volatility = 0, spreadPct = 0, liquidity = 0 } = {}) {
  const sym = token || 'UNKNOWN';
  const liq = Math.max(0, num(liquidity));
  const apr = Math.max(0, num(stakingApr));

  const scoreStake = stakeScore({ stakingApr, volatility, liquidity });
  const scoreTrade = tradeScore({ volatility, spreadPct, liquidity });

  // 1) Dead / illiquid → HOLD (sunk). You can't trade out of nothing; calling this "trade" is the trap.
  if (liq < LIQUIDITY_FLOOR) {
    const reason = apr > 0
      ? `${sym} is illiquid (${liq.toFixed(0)} HIVE depth < ${LIQUIDITY_FLOOR} floor): can't realise gains by trading — HOLD; stake only if the ${(apr * 100).toFixed(1)}% APR is genuinely paid out.`
      : `${sym} is illiquid (${liq.toFixed(0)} HIVE depth < ${LIQUIDITY_FLOOR} floor) with no staking yield: position is effectively sunk — HOLD, do not chase trades into a dead book.`;
    return { action: 'HOLD', reason, scoreStake, scoreTrade };
  }

  // 2) Both signals empty → HOLD (nothing to act on).
  if (scoreStake <= 0 && scoreTrade <= 0) {
    return {
      action: 'HOLD',
      reason: `${sym} shows neither staking yield nor tradeable movement — nothing actionable, HOLD.`,
      scoreStake, scoreTrade,
    };
  }

  // 3) Clear trade edge → TRADE (high-volume oscillator).
  if (scoreTrade > scoreStake * TRADE_MARGIN) {
    return {
      action: 'TRADE',
      reason: `${sym} oscillates (vol ${(clamp01(num(volatility)) * 100).toFixed(0)}%) on a liquid book (${liq.toFixed(0)} HIVE, spread ${num(spreadPct).toFixed(2)}%): trading edge ${scoreTrade} beats staking ${scoreStake} — TRADE the swings.`,
      scoreStake, scoreTrade,
    };
  }

  // 4) Clear staking edge → STAKE (steady staker).
  if (scoreStake > scoreTrade * STAKE_MARGIN) {
    return {
      action: 'STAKE',
      reason: `${sym} pays ${(apr * 100).toFixed(1)}% APR with calm price action (vol ${(clamp01(num(volatility)) * 100).toFixed(0)}%): staking ${scoreStake} beats trading ${scoreTrade} — STAKE and earn.`,
      scoreStake, scoreTrade,
    };
  }

  // 5) Too close to call → HOLD and watch.
  return {
    action: 'HOLD',
    reason: `${sym} is a toss-up (stake ${scoreStake} vs trade ${scoreTrade}, neither clears the ${STAKE_MARGIN}x margin): HOLD and watch before committing.`,
    scoreStake, scoreTrade,
  };
}

// ── portfolio ────────────────────────────────────────────────────────────────

// portfolioPlan(holdings, marketData) → ranked per-token decisions.
//   holdings    : [{ symbol, balance?, stake? }, ...]  (or ['SYM', ...])
//   marketData  : { SYM: { stakingApr, volatility, spreadPct, liquidity }, ... }
// Returns decisions sorted by the strength of the recommended action (the winning score),
// so the operator sees the most actionable tokens first.
export function portfolioPlan(holdings = [], marketData = {}) {
  const rows = holdings.map((h) => {
    const symbol = typeof h === 'string' ? h : h.symbol;
    const balance = typeof h === 'string' ? undefined : (h.balance ?? h.stake);
    const d = decide(symbol, marketData[symbol] || {});
    const winning = d.action === 'TRADE' ? d.scoreTrade
      : d.action === 'STAKE' ? d.scoreStake
        : Math.max(d.scoreStake, d.scoreTrade);
    return { symbol, balance, ...d, score: +winning.toFixed(4) };
  });
  // rank: actionable (STAKE/TRADE) above HOLD, then by winning score descending.
  const rank = (a) => (a.action === 'HOLD' ? 0 : 1);
  rows.sort((a, b) => rank(b) - rank(a) || b.score - a.score);
  return rows;
}

// ───────────────────────────── CLI ─────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('staking-decision.mjs')) {
  const holdings = ['VKBT', 'SWAP.HIVE', 'DEADTOKEN', 'STEADY'];
  const marketData = {
    VKBT: { stakingApr: 0.04, volatility: 0.7, spreadPct: 1.5, liquidity: 800 },
    'SWAP.HIVE': { stakingApr: 0.0, volatility: 0.4, spreadPct: 0.2, liquidity: 5000 },
    DEADTOKEN: { stakingApr: 0.5, volatility: 0.9, spreadPct: 40, liquidity: 5 },
    STEADY: { stakingApr: 0.25, volatility: 0.05, spreadPct: 0.5, liquidity: 600 },
  };
  console.log('Staking-vs-Trading decision engine (PURE — no network, no orders)');
  console.log('='.repeat(80));
  for (const row of portfolioPlan(holdings, marketData)) {
    console.log(`\n[${row.action}] ${row.symbol}  (stake ${row.scoreStake} / trade ${row.scoreTrade})`);
    console.log(`  ${row.reason}`);
  }
}
