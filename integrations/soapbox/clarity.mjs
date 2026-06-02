// clarity.mjs — the Clarity Score engine (brief §6, spec §2). Transparency/verifiability of a
// listing, computed ONLY from observable on-chain/public facts — never bought, never gifted between
// users (that's what rotted Bitcointalk Merit). A LOW score means "this is opaque," which is
// defensible; it must never read as "this is a scam," which is a liability. The score is
// "Hathor's steemd function made public" — legibility as a number.
//
// Four inputs (each 0–100, then weighted):
//   holder_dist        — is ownership spread, or does the issuer/whales hold ~everything?
//   supply_locks       — is supply capped & transparent (defined max, no silent minting headroom)?
//   contract_behavior  — what powers does the issuer retain (mint-at-will, stake gates)?
//   activity           — is there real, recent market activity (not a dead or wash-traded book)?
//
// Tier 2 (Hive-Engine) gets the full first-party computation. Tier 1 (external CoinGecko listings)
// gets a lighter "data-completeness" proxy + an explicit note that deep clarity needs node data —
// because the moat is the chains WE run, not coins we only mirror.
//
//   import { clarityForHive, clarityFromCoin } from './clarity.mjs'
//   node integrations/soapbox/clarity.mjs VKBT

import { find } from '../he-client.mjs';
import { holders } from '../holders.mjs';
import { cached, TTL } from './cache.mjs';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const r0 = (n) => Math.round(n);

// weights sum to 1. Distribution & supply transparency are the load-bearing signals; activity is
// real but noisier (and the easiest to fake), so it's weighted least.
const WEIGHTS = { holder_dist: 0.35, supply_locks: 0.30, contract_behavior: 0.20, activity: 0.15 };

function band(value) {
  if (value >= 80) return 'high';
  if (value >= 55) return 'moderate';
  if (value >= 30) return 'limited';
  return 'opaque';
}

// ── sub-scorers (each returns { score, note }) ──────────────────────────────
function scoreHolderDist(h) {
  if (!h) return { score: 0, note: 'holder data unavailable' };
  const realPct = h.realOutsidePct || 0;           // % held by genuine outside accounts
  const realCount = h.counts?.realOutside || 0;
  const issuerPct = h.issuerPct || 0;
  // reward real outside ownership and a real holder count; penalize issuer concentration.
  let s = 0;
  s += clamp(realPct * 1.4);                        // 70%+ outside → maxed
  s += clamp(realCount * 2.5, 0, 40);               // ~16 real holders → maxed at +40
  s -= clamp((issuerPct - 50) * 0.6, 0, 30);        // issuer over half supply → up to −30
  s = clamp(s);
  const note = realCount === 0
    ? `no outside holders ≥1 token — issuer holds ${r0(issuerPct)}%`
    : `${realCount} real outside holders, ${realPct.toFixed(1)}% of supply outside the issuer`;
  return { score: r0(s), note };
}

function scoreSupplyLocks(tok) {
  const max = +(tok?.maxSupply || 0);
  const supply = +(tok?.supply || 0);
  const circ = +(tok?.circulatingSupply || supply || 0);
  if (!supply && !max) return { score: 20, note: 'supply figures not published' };
  // a defined, finite max cap is the strongest transparency signal. Then: how much headroom is
  // left for the issuer to mint (circulating vs max). Fully-issued, capped supply = top score.
  let s = 0;
  const capped = max > 0 && max < 1e15;             // HE "unlimited" is a giant sentinel
  s += capped ? 60 : 15;
  if (capped) {
    const issuedFrac = max > 0 ? clamp(circ / max, 0, 1) : 0;
    s += issuedFrac * 40;                           // little un-minted headroom left → +up to 40
  }
  s = clamp(s);
  const note = capped
    ? `capped at ${max.toLocaleString()}, ${r0((circ / max) * 100)}% issued`
    : 'no finite max supply — issuer can mint without limit';
  return { score: r0(s), note };
}

function scoreContractBehavior(tok) {
  // HE token flags that bear on issuer power. Fewer retained powers / more decentral config = clearer.
  if (!tok) return { score: 30, note: 'token contract data unavailable' };
  let s = 60;                                       // neutral baseline
  const notes = [];
  // stakingEnabled with a cooldown is a transparency POSITIVE (locks are visible & rule-bound).
  if (tok.stakingEnabled) { s += 12; notes.push('staking on-chain'); }
  if (tok.delegationEnabled) { s += 8; notes.push('delegation enabled'); }
  // a published metadata/url is a small transparency plus.
  if (tok.metadata && /https?:\/\//.test(tok.metadata)) { s += 10; notes.push('metadata/url published'); }
  // an issuer that can still mint (uncapped) is handled in supply_locks; here we just note authority.
  if (tok.issuer) notes.push(`issuer @${tok.issuer}`);
  s = clamp(s);
  return { score: r0(s), note: notes.join(', ') || 'standard token contract' };
}

function scoreActivity(metric) {
  if (!metric) return { score: 10, note: 'no market metrics — illiquid or unlisted' };
  const vol = +(metric.volume || 0);               // in HIVE
  const trades = +(metric.numberOfTrades || metric.volumeExpiration || 0);
  // log-scaled: a little real volume counts a lot; we deliberately don't reward raw volume linearly
  // (wash-trade resistance — spec §9). Depth-over-time would refine this once we record it.
  let s = vol > 0 ? clamp(20 + Math.log10(vol + 1) * 22) : 5;
  if (trades > 0) s = clamp(s + 8);
  return { score: r0(s), note: vol > 0 ? `${vol.toFixed(2)} HIVE 24h volume` : 'no recent volume' };
}

function combine(inputs) {
  const value = r0(Object.entries(WEIGHTS).reduce((a, [k, w]) => a + (inputs[k]?.score || 0) * w, 0));
  return {
    value,
    band: band(value),
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.score])),
    notes: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.note])),
    method: 'observable-facts-v1',
  };
}

/** Full first-party Clarity for a Hive-Engine token symbol. Cached (holder scan is heavy). */
export async function clarityForHive(symbol) {
  const sym = String(symbol).toUpperCase();
  return cached(`clarity:he:${sym}`, TTL.clarity, async () => {
    const [tok] = await find('tokens', 'tokens', { symbol: sym }, 1);
    const [metric] = await find('market', 'metrics', { symbol: sym }, 1).catch(() => []);
    const h = await holders(sym).catch(() => null);
    if (!tok && !h) return { value: null, band: 'unknown', inputs: {}, notes: { error: 'token not found' }, method: 'observable-facts-v1' };
    const out = combine({
      holder_dist: scoreHolderDist(h),
      supply_locks: scoreSupplyLocks(tok),
      contract_behavior: scoreContractBehavior(tok),
      activity: scoreActivity(metric),
    });
    return { ...out, computed_at: new Date().toISOString() };
  });
}

/**
 * Clarity for any normalized coin object. Tier-2 → full computation. Tier-1 (external) → a lighter
 * data-completeness proxy, with an explicit note that deep clarity needs first-party node data.
 */
export async function clarityFromCoin(coin) {
  if (!coin) return null;
  if (coin.source === 'hive-engine' || coin.source_tier === 2) {
    return clarityForHive(coin.symbol);
  }
  // Tier-1 proxy: reward the verifiable facts we DO have for an external listing.
  let s = 0; const notes = [];
  if (coin.links?.website) { s += 18; notes.push('website published'); }
  if (coin.links?.explorer) { s += 14; notes.push('block explorer linked'); }
  if (coin.contracts?.length) { s += 16; notes.push(`${coin.contracts.length} verifiable contract(s)`); }
  if (coin.supply?.max > 0) { s += 18; notes.push('finite max supply'); }
  else if (coin.supply?.total > 0) { s += 8; notes.push('total supply published'); }
  if (coin.supply?.circulating > 0) { s += 10; notes.push('circulating supply published'); }
  if (coin.market_cap_usd > 0) { s += 8; }
  s = clamp(s);
  return {
    value: s, band: band(s),
    inputs: { data_completeness: s },
    notes: { summary: notes.join(', ') || 'minimal public data', tier: 'external listing — deep clarity needs first-party node data' },
    method: 'data-completeness-v1', computed_at: new Date().toISOString(),
  };
}

if (process.argv[1] && process.argv[1].endsWith('clarity.mjs')) {
  const sym = process.argv[2] || 'VKBT';
  const c = await clarityForHive(sym);
  console.log(`Clarity Score for ${sym}: ${c.value ?? '—'} (${c.band})`);
  for (const [k, v] of Object.entries(c.inputs)) console.log(`  ${k.padEnd(18)} ${String(v).padStart(3)}   ${c.notes[k] || ''}`);
  console.log('\nLow = opaque, NOT "scam". Computed from observable facts only.');
}
