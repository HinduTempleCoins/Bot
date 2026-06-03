// economy-balance.mjs — the faucet/drain balance model (queue #194, the TerraCore lesson).
//
// TerraCore lesson: a game token inflates to zero when it has more emission (faucets) than it has
// sinks (drains). Every faucet that mints token MUST have a matching drain that burns it back out,
// OR be backed by real outside income — otherwise supply only ever grows and the unit price bleeds.
//
// Rule 0 (the health rule): total emission must be ≤ real-income + total sinks. Emission that is
// backed by advertiser fiat (arcade / offerwall) is REAL INCOME, not pure mint — it does not need a
// matching token drain because the value entering the economy came from outside, not from thin air.
//
// PURE accounting. No network, no chain, no payment settlement — that lives elsewhere. Here we only
// model emission vs. sink per period so the rules can be unit-tested offline.
//
//   import { registerFaucet, registerDrain, project, assertBalanced, createLedger } from './economy-balance.mjs'
//   node integrations/games/economy-balance.mjs            # print a sample projection

// ---- injectable in-memory ledger ----
// shape: { faucets: Map<id, faucet>, drains: Map<id, drain> }. Pass your own for isolation.
export function createLedger() {
  return { faucets: new Map(), drains: new Map() };
}
const _default = createLedger();

// ---- faucets (emission sources): crops, arcade, gacha, offerwall, ... ----
// A faucet emits `rate` token per period. `realIncome:true` means the emission is backed by
// outside fiat (advertiser-paid arcade/offerwall) — it counts as real income under rule 0 and does
// NOT require a matching drain. `drainCategory` names the sink that absorbs this faucet's emission
// (used by assertBalanced); omit it only when realIncome is true.
export function registerFaucet(id, { rate = 0, realIncome = false, drainCategory = null, label = '' } = {}, ledger = _default) {
  if (!id) throw new Error('registerFaucet: id is required');
  if (!(rate >= 0)) throw new Error(`registerFaucet(${id}): rate must be >= 0`);
  const faucet = { id, rate: Number(rate), realIncome: !!realIncome, drainCategory, label };
  ledger.faucets.set(id, faucet);
  return faucet;
}

// ---- drains (sinks): consumables, recipe burns, fees, upgrades, marketplace royalties, ... ----
// A drain burns `rate` token per period. `category` matches a faucet's `drainCategory`.
export function registerDrain(id, { rate = 0, category = null, label = '' } = {}, ledger = _default) {
  if (!id) throw new Error('registerDrain: id is required');
  if (!(rate >= 0)) throw new Error(`registerDrain(${id}): rate must be >= 0`);
  const drain = { id, rate: Number(rate), category, label };
  ledger.drains.set(id, drain);
  return drain;
}

// project the economy over a `period` multiplier (1 = one base period, 30 = a month, etc.).
// Returns { totalEmission, totalSink, realIncome, net, healthy }.
//   totalEmission = all faucet emission (incl. real-income-backed)
//   realIncome    = the slice of emission backed by outside fiat (arcade/offerwall)
//   totalSink     = all drain burns
//   net           = mint that is NOT covered by sinks or real income (what actually inflates supply)
// healthy (rule 0): pure emission ≤ real-income + sinks  ⇔  net ≤ 0.
export function project({ period = 1 } = {}, ledger = _default) {
  const p = Number(period) || 0;
  let totalEmission = 0;
  let realIncome = 0;
  for (const f of ledger.faucets.values()) {
    const emitted = f.rate * p;
    totalEmission += emitted;
    if (f.realIncome) realIncome += emitted;
  }
  let totalSink = 0;
  for (const d of ledger.drains.values()) totalSink += d.rate * p;

  const pureEmission = totalEmission - realIncome;        // mint from thin air
  const net = pureEmission - totalSink;                   // >0 inflates the token
  const healthy = net <= 0;
  return { totalEmission, realIncome, totalSink, net, healthy };
}

// assertBalanced(config) — flags if any faucet lacks a matching drain (or real-income backing).
// Every faucet needs a matching drain or the token inflates; the arcade/offerwall faucet is backed
// by advertiser fiat (real income), so it is exempt. Returns { ok, unmatched } and, when
// `throwOnFail` is set, throws on the first unmatched faucet.
export function assertBalanced({ throwOnFail = true } = {}, ledger = _default) {
  const drainCategories = new Set();
  for (const d of ledger.drains.values()) if (d.category != null) drainCategories.add(d.category);

  const unmatched = [];
  for (const f of ledger.faucets.values()) {
    if (f.realIncome) continue;                           // advertiser-backed: exempt
    if (f.drainCategory == null || !drainCategories.has(f.drainCategory)) {
      unmatched.push(f.id);
    }
  }
  const ok = unmatched.length === 0;
  if (!ok && throwOnFail) {
    throw new Error(`assertBalanced: faucet(s) with no matching drain (token will inflate): ${unmatched.join(', ')}`);
  }
  return { ok, unmatched };
}

// CLI: print a small worked projection.
if (process.argv[1] && process.argv[1].endsWith('economy-balance.mjs')) {
  const l = createLedger();
  registerFaucet('crops', { rate: 100, drainCategory: 'recipe', label: 'harvest yield' }, l);
  registerFaucet('gacha', { rate: 30, drainCategory: 'consumable', label: 'gacha pulls' }, l);
  registerFaucet('arcade', { rate: 50, realIncome: true, label: 'advertiser-backed arcade' }, l);
  registerDrain('recipe-burn', { rate: 90, category: 'recipe', label: 'crafting burns' }, l);
  registerDrain('consumables', { rate: 40, category: 'consumable', label: 'item use' }, l);

  const balance = assertBalanced({ throwOnFail: false }, l);
  const month = project({ period: 30 }, l);
  console.log('economy-balance — sample projection (period = 30)');
  console.log('─'.repeat(60));
  console.log('  balanced (every faucet matched/exempt):', balance.ok, balance.ok ? '' : `unmatched=${balance.unmatched.join(', ')}`);
  console.log('  total emission :', month.totalEmission);
  console.log('  real income    :', month.realIncome, '(advertiser fiat — not mint)');
  console.log('  total sink     :', month.totalSink);
  console.log('  net (inflation):', month.net, month.net <= 0 ? '(healthy)' : '(INFLATING)');
  console.log('  healthy (rule 0):', month.healthy);
}
