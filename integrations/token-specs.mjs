// integrations/token-specs.mjs — TOKEN "SPECS": the honest comparison set for a side token.
//
// A side token does not belong in a matrix beside Steem and Hive — those are chains, and the dimensions
// that describe a chain (consensus, VM, block time) say nothing about a token. The peer group for VKBT
// and CURE is OTHER HIVE-ENGINE TOKENS, and the dimensions are tokenomics. The operator's long-standing
// name for that set of numbers is the "SPECS":
//
//   supply · holders · concentration (what the team holds) · where it trades · market activity ·
//   what it costs to move the price · market cap at parity · emission
//
// WHY THESE AND NOT OTHERS. Supply alone is meaningless (anyone can mint a small number). Holders alone
// is meaningless (a token can have many holders and no float). The pair is what matters, and the third
// number — concentration — decides whether the first two can be trusted. The operator's framing of
// concentration is deliberate and worth stating as he does: a majority held by the project team is
// anti-dump protection rather than a red flag, because the largest holder is the party with the least
// incentive to break the market.
//
// SOURCING RULE, LOAD-BEARING: every number carries a `source`. A spec with no source renders as "—",
// never as a guess. Live figures belong to a Hive-Engine read, not to this file.
//
//   import { TOKEN_SPECS, SPEC_DIMENSIONS, specsTable, tokensOn } from './token-specs.mjs'

const VKFRI = 'VKFRI vkbt_cure_knowledge dataset (Jan 2026)';

export const SPEC_DIMENSIONS = [
  { key: 'supply', label: 'Total supply' },
  { key: 'holders', label: 'Holders' },
  { key: 'concentration', label: 'Team-held' },
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
    id: 'vkbt', name: 'VKBT', full: 'Van Kush Bot Token', layer: 'Hive-Engine side token',
    supply: '1,900,000', holders: '986', concentration: '~800,000 (42%)',
    emission: 'Fixed — no ongoing mint',
    venue: 'TribalDEX vs HIVE / SWAP.HIVE',
    activity: 'Active — ~21 trades/week',
    capAtParity: '$579,000',
    note: 'Wide distribution at small supply. The 42% team holding is the anti-dump floor.',
    source: VKFRI,
  },
  cure: {
    id: 'cure', name: 'CURE', full: 'CURE', layer: 'Hive-Engine side token',
    supply: '55,575', holders: '999', concentration: '~32,000 (58%)',
    emission: 'Fixed — no ongoing mint',
    venue: 'TribalDEX vs HIVE / SWAP.HIVE',
    activity: 'Sell orders present; thin buy side',
    capAtParity: '$16,700',
    note: 'Extreme scarcity with nearly a thousand holders — the whole supply is about 61x Bitcoin\'s DAILY mint of 900.',
    source: VKFRI,
  },
  blurt: {
    id: 'blurt', name: 'BLURT', full: 'BLURT (chain coin, traded as SWAP.BLURT)', layer: "Chain coin, wrapped onto Hive-Engine",
    supply: '—', holders: '—', concentration: 'VKF holds 300,000+',
    emission: 'Inflationary — chain reward pool',
    venue: 'TribalDEX as SWAP.BLURT',
    activity: 'Thin; sold gradually, top-order-only to preserve depth',
    capAtParity: '—',
    note: 'Held as operating fuel rather than as a premium position — a different tier entirely.',
    source: VKFRI,
  },
  pob: {
    id: 'pob', name: 'POB', full: 'Proof of Brain', layer: 'Hive-Engine side token',
    supply: '—', holders: '—', concentration: 'VKF holds ~940',
    emission: 'Inflationary — post/curation rewards',
    venue: 'TribalDEX', activity: '—', capAtParity: '—',
    note: 'Tradeable tier: sold freely when HIVE is needed.',
    source: VKFRI,
  },
  bbh: {
    id: 'bbh', name: 'BBH', full: 'BBH', layer: 'Hive-Engine side token',
    supply: '—', holders: '—', concentration: 'VKF holds ~929',
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
