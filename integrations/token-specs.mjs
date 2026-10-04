// integrations/token-specs.mjs — TOKEN "SPECS": the honest comparison set for a side token.
//
// A side token does not belong in a matrix beside Steem and Hive — those are chains, and the dimensions
// that describe a chain (consensus, VM, block time) say nothing about a token. The peer group for VKBT
// and CURE is OTHER HIVE-ENGINE TOKENS, and the dimensions are tokenomics. The operator's long-standing
// name for that set of numbers is the "SPECS":
//
//   supply · holders · concentration (and HOW it was acquired) · where it trades · market activity ·
//   what it costs to move the price · market cap at parity · emission · what the token is FOR
//
// WHY THESE AND NOT OTHERS. Supply alone is meaningless (anyone can mint a small number). Holders alone
// is meaningless (a token can have many holders and no float). The pair is what matters, and the third
// number — concentration — decides whether the first two can be trusted.
//
// ⭐ BUT CONCENTRATION IS TWO FACTS, NOT ONE, AND THE SECOND IS THE ONE THAT MATTERS: how the holding was
// ACQUIRED. A founder allocation minted to itself and a position BOUGHT on the open market produce the
// same percentage and mean opposite things. The Van Kush holdings in VKBT and CURE were PURCHASED —
// bought at market like any other holder, not allocated. Any matrix that prints "42% team-held" without
// that distinction reports a number and loses the fact.
//
// ⭐ AND THE HOLDING IS NOT STATIC. These are not treasury tokens sitting still: they are DISTRIBUTED
// through curation programs — given away as the system is built. A percentage is a snapshot of a position
// that is deliberately being spread outward, which is the opposite of accumulation.
//
// The operator's framing of the remaining concentration is then straightforwardly true: a majority held
// by the project team is anti-dump protection rather than a red flag, because the largest holder is the
// party with the least incentive to break the market — and here that holder also bought in.
//
// ⭐ THE NAMES ARE NOT RANDOM, AND THE CHAIN IS THE AUTHORITY ON THEM. Both names are registered in the
// token's own Hive-Engine record, so there is nothing to guess: VKBT is the "Van Kush Beauty Token"
// ("A Token for Rewarding Beauty, and Providing Liquid to the Beauty Economy") and CURE is the "Curator
// Rewards Token" ("A Token to Reward Curators and Token Holders on HIVE Blog. The more You Hold, the
// more You get back for Your Curation."). An earlier revision of this file guessed "Van Kush Bot Token"
// for VKBT and left CURE's meaning blank. Read the record instead of guessing.
//
// SOURCING RULE, LOAD-BEARING: every number carries a `source`. A spec with no source renders as "—",
// never as a guess.
//
// ⚠️ AND THE SOURCING RULE IS NOT ENOUGH ON ITS OWN — THIS FILE HAS ALREADY BEEN WRONG TWICE.
// Two different holder counts for these tokens reached the public wiki, and NEITHER was real. Both were
// artefacts of how the chain was read:
//   • ~986 / ~999  — a single find() at Hive-Engine's 1,000-row page cap, counted after filtering.
//   • ~10,894 / ~10,526 — an offset-paged read that stopped where Hive-Engine refuses offsets above
//     10,000, inside a catch that swallowed the error and returned a short list.
// The true row counts are 26,066 and 15,692. The fix is in he-client.mjs (page by _id cursor, and FLAG
// an incomplete read instead of truncating silently). The lesson for this file: a sourced number can
// still be a measurement artefact, so a figure that looks suspiciously round or suspiciously close to a
// page size should be re-derived, not cited.
//
// ⭐ AND A HOLDER COUNT ALONE FLATTERS AN AIRDROPPED TOKEN. 19,663 of VKBT's 25,038 holders and 13,628
// of CURE's 14,965 hold LESS THAN ONE TOKEN. That is dust, and dust is not a community. Both the raw
// count and the ≥1-token count are published here, because publishing only the first would mislead.
//
//   import { TOKEN_SPECS, SPEC_DIMENSIONS, specsTable, tokensOn } from './token-specs.mjs'

const VKFRI = 'VKFRI vkbt_cure_knowledge dataset (Jan 2026)';

// ⭐ LIVE CAPTURE. Read from Hive-Engine on this date through integrations/he-client.mjs +
// integrations/holders.mjs. `npm run token-specs:refresh` (integrations/token-specs-refresh.mjs) reprints
// this block from the chain, so a stale number is a decision not to run it rather than an accident.
export const CAPTURE = { date: '2026-10-04', hivePriceUsd: 0.0560, source: 'Hive-Engine (api.hive-engine.com) + HIVE median feed', note: 'supply moves between reads — these tokens are still being issued' };
const HE = `Hive-Engine live read, ${CAPTURE.date}`;

export const SPEC_DIMENSIONS = [
  { key: 'supply', label: 'Total supply' },
  { key: 'holders', label: 'Holders' },
  { key: 'realHolders', label: 'Holders of ≥1 token' },
  { key: 'staked', label: 'Share staked' },
  { key: 'concentration', label: 'VKF position' },
  { key: 'acquired', label: 'How acquired' },
  { key: 'distribution', label: 'How it is distributed' },
  { key: 'emission', label: 'Emission' },
  { key: 'venue', label: 'Where it trades' },
  { key: 'activity', label: 'Market activity' },
  { key: 'capAtParity', label: 'Cap at 1:1 HIVE' },
];

/**
 * One entry per token. `layer` separates an engine side token from a chain's own coin, because
 * comparing those two as if they were alike is the error this module exists to prevent.
 */
export const TOKEN_SPECS = {
  vkbt: {
    id: 'vkbt', name: 'VKBT', full: 'Van Kush Beauty Token', layer: 'Hive-Engine side token',
    supply: '2,315,564', holders: '25,038', realHolders: '5,375', staked: '42% (973,568)',
    concentration: '970,224 (41.9%)',
    acquired: 'Purchased at market',
    distribution: 'Given away through curation programs',
    emission: 'Mintable to 500,000,000 cap; supply has grown',
    venue: 'TribalDEX vs HIVE / SWAP.HIVE',
    activity: 'Near-zero — 0.018 HIVE traded in 24h; ask is 5x the bid',
    capAtParity: '$129,672',
    note: 'Very widely held — 25,272 accounts hold something — but 19,663 of those hold LESS THAN ONE token, so the honest headline is 5,375 holders of a whole token or more. The VKF position was bought at market and is being distributed through curation, not accumulated.',
    source: HE,
  },
  cure: {
    id: 'cure', name: 'CURE', full: 'Curator Rewards Token', layer: 'Hive-Engine side token',
    supply: '70,974', holders: '14,965', realHolders: '1,337', staked: '71% (50,245)',
    concentration: '37,477 (52.8%)',
    acquired: 'Purchased at market',
    distribution: 'Given away through curation programs',
    emission: 'Mintable to 20,000,000 cap; supply has grown',
    venue: 'TribalDEX vs HIVE / SWAP.HIVE',
    activity: 'Effectively none — 0.000003 HIVE in 24h; ask is 2,203x the bid',
    capAtParity: '$3,975',
    note: 'Genuinely scarce at 70,974 units, and 71% of it is STAKED, so the liquid float is small. 14,965 accounts hold something but 13,628 hold less than one token; 1,337 hold a whole token or more and only 430 hold 10+ and 62 hold 100+.',
    source: HE,
  },
  blurt: {
    id: 'blurt', name: 'BLURT', full: 'BLURT (chain coin, traded as SWAP.BLURT)', layer: "Chain coin, wrapped onto Hive-Engine",
    supply: '—', holders: '—', realHolders: '—', staked: '—',
    concentration: 'VKF holds 300,000+',
    acquired: 'Purchased / earned',
    distribution: 'Sold gradually as operating fuel',
    emission: 'Inflationary — chain reward pool',
    venue: 'TribalDEX as SWAP.BLURT',
    activity: 'Thin; sold gradually, top-order-only to preserve depth',
    capAtParity: '—',
    note: 'Held as operating fuel rather than as a premium position — a different tier entirely.',
    source: VKFRI,
  },
  pob: {
    id: 'pob', name: 'POB', full: 'Proof of Brain', layer: 'Hive-Engine side token',
    supply: '—', holders: '—', realHolders: '—', staked: '—',
    concentration: 'VKF holds ~940',
    acquired: 'Earned through posting/curation',
    distribution: 'Sold when HIVE is needed',
    emission: 'Inflationary — post/curation rewards',
    venue: 'TribalDEX', activity: '—', capAtParity: '—',
    note: 'Tradeable tier: sold freely when HIVE is needed.',
    source: VKFRI,
  },
  bbh: {
    id: 'bbh', name: 'BBH', full: 'BBH', layer: 'Hive-Engine side token',
    supply: '—', holders: '—', realHolders: '—', staked: '—',
    concentration: 'VKF holds ~929',
    acquired: 'Earned through posting/curation',
    distribution: 'Sold when HIVE is needed',
    emission: 'Inflationary — tribe rewards',
    venue: 'TribalDEX', activity: '—', capAtParity: '—',
    note: 'Tradeable tier.',
    source: VKFRI,
  },
};

export const tokensOn = (layer) => Object.values(TOKEN_SPECS).filter((t) => !layer || t.layer === layer);

const NOT_RECORDED = '—';
const cell = (t, key) => {
  const v = t && t[key];
  return v == null || v === '' ? NOT_RECORDED : String(v);
};

/** the specs matrix; ids default to every recorded token */
export function specsTable(ids) {
  const list = (Array.isArray(ids) && ids.length ? ids : Object.keys(TOKEN_SPECS))
    .map((id) => TOKEN_SPECS[String(id).toLowerCase()])
    .filter(Boolean);
  return {
    tokens: list.map((t) => ({ id: t.id, name: t.name, layer: t.layer, note: t.note, source: t.source })),
    rows: SPEC_DIMENSIONS.map((d) => ({
      dimension: d.key,
      label: d.label,
      values: list.map((t) => cell(t, d.key)),
    })),
  };
}

/** every distinct source cited by the recorded tokens — so a reader can check the numbers */
export const sources = () => [...new Set(Object.values(TOKEN_SPECS).map((t) => t.source).filter(Boolean))];
