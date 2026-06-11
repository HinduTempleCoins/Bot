// pob-emission.mjs — PURE Proof-of-Burn / burn-mining emission math.
//
// The safe, deterministic replacement for the broken time-based Polygon contract
// logic in the DFB/DFC burn-mining-token analysis. This module is MATH ONLY:
//   - NO contract code, NO deploy, NO chain calls, NO keys, NO wall-clock.
//
// "Burn X to mint Y": you destroy (burn) some base asset and receive freshly
// minted tokens. The mint rate DECAYS over discrete epochs so emission tapers
// instead of running forever.
//
// ★ WHY EPOCHS, NOT TIME (load-bearing — read before changing the model):
//   The original contract used block.timestamp / wall-clock math, which is why
//   it broke when you "ran it 24h to catch the time bugs": drift, re-entrancy on
//   the time window, and divide-by-zero on an empty window. Here, emission is a
//   PURE DETERMINISTIC FUNCTION OF AN INTEGER `epoch`. Same epoch in → same
//   tokens out, on any machine, forever. The caller decides what an epoch maps
//   to (a block, a day, a halving period); this module never reads the clock.
//
// Soft-fail contract (never throws):
//   - any non-finite / negative numeric input is clamped to 0
//   - totalBurn <= 0  =>  share is 0 (no divide-by-zero)
//   - decay is clamped to [0, ∞); a decay of 1 means "no decay"
//
//   import { minedAmount, emissionSchedule, shareOfEpoch, halvingRate } from './pob-emission.mjs'
//   node integrations/pob-emission.mjs            # print a worked example

// ---- numeric coercion: anything not a finite number becomes 0 ----
export function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// clamp helper: finite, >= lo
const clampLo = (v, lo) => {
  const n = num(v);
  return n < lo ? lo : n;
};

// ---------------------------------------------------------------------------
// minedAmount — tokens minted for a burn at a given epoch.
//   minted = burned * rate * decayPerEpoch^epoch , clamped >= 0
//
// `rate` is tokens-minted per unit burned at epoch 0.
// `decayPerEpoch` in [0,1] tapers emission; 1 = flat, 0 = nothing after epoch 0.
// (Values > 1 are allowed but mean GROWING emission — caller's choice; still pure.)
// `epoch` is coerced to a non-negative integer.
// ---------------------------------------------------------------------------
export function minedAmount({ burned, rate, decayPerEpoch = 0, epoch = 0 } = {}) {
  const b = clampLo(burned, 0);
  const r = clampLo(rate, 0);
  const d = clampLo(decayPerEpoch, 0);
  const e = Math.floor(clampLo(epoch, 0));

  const factor = Math.pow(d, e); // d^e; d=0,e=0 => 1 per IEEE-754, which is correct (epoch 0 = full rate only if d>0)
  const minted = b * r * factor;
  return Number.isFinite(minted) && minted > 0 ? minted : 0;
}

// ---------------------------------------------------------------------------
// emissionSchedule — the per-epoch rate curve + running cumulative emission.
//   returns [{ epoch, rate, cumulative }] for epoch = 0 .. epochs-1
//   rate(epoch) = initialRate * decayPerEpoch^epoch
//   cumulative  = sum of rate(0..epoch)
//
// Pure & deterministic: no wall-clock, so "run it for 24h" is meaningless here —
// the same `epochs` always yields the same array.
// ---------------------------------------------------------------------------
export function emissionSchedule({ initialRate, decayPerEpoch = 1, epochs = 0 } = {}) {
  const r0 = clampLo(initialRate, 0);
  const d = clampLo(decayPerEpoch, 0);
  const n = Math.floor(clampLo(epochs, 0));

  const out = [];
  let cumulative = 0;
  for (let e = 0; e < n; e++) {
    const factor = Math.pow(d, e);
    let rate = r0 * factor;
    if (!Number.isFinite(rate) || rate < 0) rate = 0;
    cumulative += rate;
    if (!Number.isFinite(cumulative)) cumulative = 0;
    out.push({ epoch: e, rate, cumulative });
  }
  return out;
}

// ---------------------------------------------------------------------------
// shareOfEpoch — pro-rata mint for one burner inside an epoch's reward pool.
//   share = (yourBurn / totalBurn) * epochReward
//   totalBurn <= 0  =>  0 (no divide-by-zero, no NaN)
//   yourBurn clamped to [0, totalBurn] so no one can mint more than 100%.
// ---------------------------------------------------------------------------
export function shareOfEpoch({ yourBurn, totalBurn, epochReward } = {}) {
  const total = clampLo(totalBurn, 0);
  if (total <= 0) return 0;
  let mine = clampLo(yourBurn, 0);
  if (mine > total) mine = total;
  const reward = clampLo(epochReward, 0);
  const share = (mine / total) * reward;
  return Number.isFinite(share) && share > 0 ? share : 0;
}

// ---------------------------------------------------------------------------
// halvingRate — convenience: Bitcoin-style halving instead of smooth decay.
//   rate = initialRate / 2^floor(epoch / halvingEvery)
//   halvingEvery <= 0  =>  no halving (returns initialRate)
// ---------------------------------------------------------------------------
export function halvingRate({ initialRate, halvingEvery, epoch = 0 } = {}) {
  const r0 = clampLo(initialRate, 0);
  const every = Math.floor(clampLo(halvingEvery, 0));
  const e = Math.floor(clampLo(epoch, 0));
  if (every <= 0) return r0;
  const halvings = Math.floor(e / every);
  const rate = r0 / Math.pow(2, halvings);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

// ---- guarded CLI: worked example only, no IO ----
if (process.argv[1] && process.argv[1].endsWith('pob-emission.mjs')) {
  const sched = emissionSchedule({ initialRate: 100, decayPerEpoch: 0.9, epochs: 5 });
  console.log('emissionSchedule(initialRate=100, decay=0.9, epochs=5):');
  for (const row of sched) {
    console.log(`  epoch ${row.epoch}: rate=${row.rate.toFixed(4)} cumulative=${row.cumulative.toFixed(4)}`);
  }
  console.log('minedAmount(burn=10, rate=2, decay=0.9, epoch=3) =',
    minedAmount({ burned: 10, rate: 2, decayPerEpoch: 0.9, epoch: 3 }));
  console.log('shareOfEpoch(yourBurn=25, totalBurn=100, epochReward=1000) =',
    shareOfEpoch({ yourBurn: 25, totalBurn: 100, epochReward: 1000 }));
  console.log('halvingRate(initialRate=50, halvingEvery=10, epoch=25) =',
    halvingRate({ initialRate: 50, halvingEvery: 10, epoch: 25 }));
}
