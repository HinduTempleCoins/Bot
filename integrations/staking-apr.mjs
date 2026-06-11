// staking-apr.mjs — staking-APR estimator from reward-pool inputs (queue item "Estimate staking APR for tokens").
// PURE arithmetic, NO network, NO keys. The live HIVE-Engine reads (reward-per-block, total-staked,
// emission schedules) happen in other modules and pass their numbers IN here — this module only
// DERIVES the APR from those injected figures.
//
// Distinct from staking-decision.mjs: that module CONSUMES an already-known `stakingApr` to compare
// staking vs trading; this module COMPUTES that APR in the first place.
//
//   node integrations/staking-apr.mjs        # tiny worked example
//
// Exports: estimateApr(), aprFromPool().

const DEFAULT_BLOCKS_PER_DAY = 28800;   // ~3s blocks → 28,800/day (Graphene-ish default; override as needed)
const DAYS_PER_YEAR = 365;

const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);

// ── core: per-block reward model ─────────────────────────────────────────────
// estimateApr({ rewardPerBlock, blocksPerDay, totalStaked, yourStake }) →
//   { dailyReward, annualReward, apr, yourAnnual }
//
//   dailyReward  : tokens emitted to the staking pool per day  (rewardPerBlock * blocksPerDay)
//   annualReward : tokens emitted to the staking pool per year (dailyReward * 365)
//   apr          : annualReward / totalStaked  (fraction; 0.20 = 20% APR). 0 if totalStaked<=0.
//   yourAnnual   : your share of annualReward, pro-rata to yourStake/totalStaked. 0 if no stake/pool.
//
// Soft-fail: missing/garbage fields default to 0; totalStaked<=0 yields apr:0 (never divides by zero,
// never throws).
export function estimateApr({ rewardPerBlock, blocksPerDay = DEFAULT_BLOCKS_PER_DAY, totalStaked, yourStake } = {}) {
  const perBlock = Math.max(0, num(rewardPerBlock));
  const bpd = Math.max(0, num(blocksPerDay, DEFAULT_BLOCKS_PER_DAY));
  const staked = Math.max(0, num(totalStaked));
  const mine = Math.max(0, num(yourStake));

  const dailyReward = +(perBlock * bpd).toFixed(8);
  const annualReward = +(dailyReward * DAYS_PER_YEAR).toFixed(8);

  if (staked <= 0) {
    return { dailyReward, annualReward, apr: 0, yourAnnual: 0 };
  }

  const apr = +(annualReward / staked).toFixed(8);
  const share = mine > 0 ? Math.min(1, mine / staked) : 0;
  const yourAnnual = +(annualReward * share).toFixed(8);

  return { dailyReward, annualReward, apr, yourAnnual };
}

// ── simpler case: a known annual emission into the pool ───────────────────────
// aprFromPool({ annualEmission, totalStaked }) → apr (fraction).
// For when the caller already knows the yearly emission and just needs APR = emission / staked.
// totalStaked<=0 (or missing) → 0 (soft-fail, no divide-by-zero, never throws).
export function aprFromPool({ annualEmission, totalStaked } = {}) {
  const emission = Math.max(0, num(annualEmission));
  const staked = Math.max(0, num(totalStaked));
  if (staked <= 0) return 0;
  return +(emission / staked).toFixed(8);
}

// ───────────────────────────── CLI ─────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('staking-apr.mjs')) {
  console.log('Staking-APR estimator (PURE — no network, no keys)');
  console.log('='.repeat(70));

  // Worked example: 1 token/block, default 28,800 blocks/day, 10,000,000 staked, you hold 50,000.
  const r = estimateApr({ rewardPerBlock: 1, totalStaked: 10_000_000, yourStake: 50_000 });
  console.log('\nper-block model: rewardPerBlock=1, blocksPerDay=28800, totalStaked=10,000,000, yourStake=50,000');
  console.log(`  dailyReward  = ${r.dailyReward} tokens/day`);
  console.log(`  annualReward = ${r.annualReward} tokens/year`);
  console.log(`  apr          = ${(r.apr * 100).toFixed(2)}%`);
  console.log(`  yourAnnual   = ${r.yourAnnual} tokens/year (your pro-rata share)`);

  // Simpler emission-pool case.
  const apr = aprFromPool({ annualEmission: 2_000_000, totalStaked: 10_000_000 });
  console.log('\nemission-pool model: annualEmission=2,000,000, totalStaked=10,000,000');
  console.log(`  apr = ${(apr * 100).toFixed(2)}%`);
}
