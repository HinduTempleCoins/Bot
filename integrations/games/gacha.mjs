// gacha.mjs — gacha pulls that mint real NFTs (queue #191). PURE, seedable, with DISCLOSED ODDS
// and a PITY TIMER, so the loop is fair-by-construction and unit-testable offline.
//
// LEGAL FRAMING (load-bearing): a gacha is OK as long as it stays inside a CLOSED currency with
// DISCLOSED odds and a PITY guarantee — the player spends a non-cashable game token, sees the exact
// published probability table before pulling, and is guaranteed the top tier within a bounded number
// of pulls. The moment a prize is CASH-CONVERTIBLE (sellable back for real money / fiat), the same
// loot-box becomes regulated GAMBLING and is OUT OF SCOPE here. We disclose; we never cash out.
//
// PURE logic, no network. A pull returns a MINT INTENT (dry-run) for the won asset — it does NOT
// broadcast. A sub-game wires the intent to economy.mjs (rarity) and then to MELEK-Signer to mint.
//
//   import { POOLS, pull, disclosedOdds, newPullState } from './gacha.mjs'
//   node integrations/games/gacha.mjs            # print the disclosed odds tables

import { RARITY, rarityWeight } from './economy.mjs';

// ── POOLS: each pool publishes its odds (rarity → probability, summing to 1) and a pity rule
// (after N pulls without the named rarity-or-better, the next pull is GUARANTEED that rarity). ──
export const POOLS = Object.freeze({
  standard: Object.freeze({
    name: 'standard',
    odds: Object.freeze({
      [RARITY.COMMON]: 0.79,
      [RARITY.UNCOMMON]: 0.15,
      [RARITY.RARE]: 0.05,
      [RARITY.EPIC]: 0.009,
      [RARITY.LEGENDARY]: 0.001,
    }),
    // guaranteed Legendary by the 40th pull since the last Legendary.
    pity: Object.freeze({ rarity: RARITY.LEGENDARY, after: 40 }),
  }),
  premium: Object.freeze({
    name: 'premium',
    odds: Object.freeze({
      [RARITY.COMMON]: 0.60,
      [RARITY.UNCOMMON]: 0.25,
      [RARITY.RARE]: 0.10,
      [RARITY.EPIC]: 0.04,
      [RARITY.LEGENDARY]: 0.01,
    }),
    // shallower pity on the premium banner.
    pity: Object.freeze({ rarity: RARITY.LEGENDARY, after: 20 }),
  }),
});

// rarest-last order used to walk the cumulative distribution deterministically.
const LADDER = [RARITY.COMMON, RARITY.UNCOMMON, RARITY.RARE, RARITY.EPIC, RARITY.LEGENDARY];

const EPS = 1e-9;

// validate that a pool's published odds sum to 1 (within float tolerance) and name known rarities.
function validatePool(pool) {
  if (!pool || typeof pool !== 'object' || !pool.odds) {
    throw new Error('gacha: pool must have an odds table');
  }
  let sum = 0;
  for (const [rarity, p] of Object.entries(pool.odds)) {
    if (rarityWeight(rarity) === 0) throw new Error(`gacha: unknown rarity "${rarity}" in odds`);
    if (!(p >= 0)) throw new Error(`gacha: odds for "${rarity}" must be >= 0`);
    sum += p;
  }
  if (Math.abs(sum - 1) > EPS) {
    throw new Error(`gacha: odds must sum to 1, got ${sum} for pool "${pool.name || '?'}"`);
  }
  if (pool.pity) {
    if (rarityWeight(pool.pity.rarity) === 0) {
      throw new Error(`gacha: unknown pity rarity "${pool.pity.rarity}"`);
    }
    if (!(pool.pity.after >= 1)) throw new Error('gacha: pity.after must be >= 1');
  }
  return true;
}

// disclosedOdds(pool) — the published probability table, exactly as a player would see it before
// pulling. Returns a plain ordered object { rarity: probability } plus the pity rule. PURE.
export function disclosedOdds(pool) {
  validatePool(pool);
  const table = {};
  for (const r of LADDER) {
    if (r in pool.odds) table[r] = pool.odds[r];
  }
  return { odds: table, pity: pool.pity ? { ...pool.pity } : null };
}

// fresh per-player pity state for a pool: pulls since the last pity-tier (or better) drop.
export function newPullState() {
  return { sinceRare: 0 };
}

// is `got` at least as rare as the pity target? (further along the ladder = rarer)
function meetsPity(got, target) {
  return LADDER.indexOf(got) >= LADDER.indexOf(target);
}

// roll a rarity from the cumulative distribution using a uniform value u in [0,1). PURE.
function rollRarity(odds, u) {
  let acc = 0;
  for (const r of LADDER) {
    const p = odds[r] || 0;
    if (p <= 0) continue;
    acc += p;
    if (u < acc) return r;
  }
  // float drift fallback: hand back the last positive-probability tier.
  for (let i = LADDER.length - 1; i >= 0; i--) {
    if ((odds[LADDER[i]] || 0) > 0) return LADDER[i];
  }
  return RARITY.COMMON;
}

// pull(pool, state, { rng }) → { result, newState }
//   - state tracks pulls-since-last-rare for the pity guarantee (immutable: a new state is returned).
//   - rng is an injectable () => [0,1) for deterministic, seedable tests; defaults to Math.random.
//   - result = { rarity, pity (bool), mintIntent } where mintIntent is a DRY-RUN mint request that
//     plugs into economy.mjs rarity — a sub-game broadcasts it via MELEK-Signer; we never mint here.
export function pull(pool, state = newPullState(), { rng = Math.random } = {}) {
  validatePool(pool);
  const s = state && typeof state.sinceRare === 'number' ? state : newPullState();
  const pity = pool.pity || null;

  let rarity;
  let pityTriggered = false;
  // pity floor: if we've now reached the threshold pull without the pity tier, force it.
  if (pity && s.sinceRare + 1 >= pity.after) {
    rarity = pity.rarity;
    pityTriggered = true;
  } else {
    const u = rng();
    rarity = rollRarity(pool.odds, Number.isFinite(u) ? u : 0);
  }

  // reset the pity counter whenever the drop meets-or-beats the pity tier; otherwise increment.
  const reset = pity ? meetsPity(rarity, pity.rarity) : true;
  const newState = { sinceRare: reset ? 0 : s.sinceRare + 1 };

  const result = {
    rarity,
    pity: pityTriggered,
    // DRY-RUN mint intent — the won asset, ready to feed economy.createAsset + MELEK-Signer mint.
    mintIntent: Object.freeze({
      dryRun: true,
      action: 'mint',
      pool: pool.name || null,
      type: 'gacha-prize',
      rarity,
    }),
  };
  return { result, newState };
}

// ── CLI: print every pool's disclosed odds table ──
if (process.argv[1] && process.argv[1].endsWith('gacha.mjs')) {
  for (const [key, pool] of Object.entries(POOLS)) {
    const { odds, pity } = disclosedOdds(pool);
    console.log(`\nPool "${key}" — disclosed odds:`);
    for (const [r, p] of Object.entries(odds)) {
      console.log(`  ${r.padEnd(10)} ${(p * 100).toFixed(3)}%`);
    }
    if (pity) console.log(`  pity: guaranteed ${pity.rarity} by pull #${pity.after}`);
  }
  console.log('\nClosed currency + disclosed odds + pity = OK. Cash-convertible prizes = gambling (out of scope).');
}
