// vankush-tokenomics.mjs — Van Kush ecosystem tokenomics fact sheet.
//
// Pure ESM data + query module. Static facts only, sourced from the
// MASTER_ITINERARY "Van Kush Token Ecosystem" section. No network, no clock,
// no disk. Soft-fail: queries never throw, they return null / [] / "".
//
// Records cover the six Van Kush tokens: PUCO, PUTI, DFB, DFC, VKBT, CURE.

/** Escape a value for safe HTML interpolation. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Frozen token records. Each: { symbol, name, chain, mechanism, supplyNote,
 * plain, source }. Static facts only — no live prices, no balances.
 */
export const TOKENS = Object.freeze([
  Object.freeze({
    symbol: 'PUCO',
    name: 'Punic Copper',
    chain: 'TRON',
    mechanism: 'TRC20 token with DAO-managed long-term lock-up',
    supplyNote: '700,000,000 total; 50% (350M) frozen for 900 days under DAO management',
    plain: 'Copper-themed token on TRON. Half the supply is locked up for about two and a half years so it cannot all hit the market at once; a community DAO manages the locked portion. Intended for real-world trades (seeds, herbs, books).',
    source: 'MASTER_ITINERARY.md §"Van Kush Token Ecosystem" #3 PUCO',
  }),
  Object.freeze({
    symbol: 'PUTI',
    name: 'Punic Tin',
    chain: 'Steem-Engine',
    mechanism: 'SCOT tag-based distribution; 65% author / 35% curator split',
    supplyNote: 'Emits 1 token per minute for 64 years',
    plain: 'Tin-themed token on Steem-Engine. New tokens drip out steadily — one per minute for 64 years — and are split 65% to authors and 35% to curators, earned by posting under set tags.',
    source: 'MASTER_ITINERARY.md §"Van Kush Token Ecosystem" #4 PUTI',
  }),
  Object.freeze({
    symbol: 'DFB',
    name: 'Van Kush Burn-Mining Token (DFB)',
    chain: 'Polygon',
    mechanism: 'Burn mining — burn tokens to mine new tokens; Peggy bridge to HIVE-Engine',
    supplyNote: 'Issued via fixed burn-mining contracts; emission gated by burns',
    plain: 'A Polygon burn-mining token: you destroy tokens to mint new ones, so supply growth is tied to how much gets burned. Bridges across to HIVE-Engine via a Peggy bridge.',
    source: 'MASTER_ITINERARY.md §"Van Kush Token Ecosystem" #5 DFB/DFC',
  }),
  Object.freeze({
    symbol: 'DFC',
    name: 'Van Kush Burn-Mining Token (DFC)',
    chain: 'Polygon',
    mechanism: 'Burn mining — burn tokens to mine new tokens; multi-stake (QUICK/MATIC)',
    supplyNote: 'Issued via fixed burn-mining contracts; emission gated by burns',
    plain: 'The sibling Polygon burn-mining token to DFB. Same burn-to-mint idea, plus multi-stake contracts let you stake QUICK or MATIC to earn Van Kush tokens.',
    source: 'MASTER_ITINERARY.md §"Van Kush Token Ecosystem" #5 DFB/DFC',
  }),
  Object.freeze({
    symbol: 'VKBT',
    name: 'Van Kush Beauty Token',
    chain: 'HIVE-Engine',
    mechanism: 'Community curation token (already launched)',
    supplyNote: 'Live HIVE-Engine side-token; price tracked by the bot',
    plain: 'The flagship Van Kush community token on HIVE-Engine, already live. Used for curation campaigns and community rewards; the bot tracks its price.',
    source: 'MASTER_ITINERARY.md §"Van Kush Token Ecosystem" #1 VKBT',
  }),
  Object.freeze({
    symbol: 'CURE',
    name: 'CURE',
    chain: 'HIVE-Engine',
    mechanism: 'Community health/growth curation token (already launched)',
    supplyNote: 'Live HIVE-Engine side-token; price tracked by the bot',
    plain: 'A live HIVE-Engine token promoted as a community health and growth token, with curation tied to the Karma Merit system and Discord rewards.',
    source: 'MASTER_ITINERARY.md §"Van Kush Token Ecosystem" #2 CURE',
  }),
]);

/** Look up a token by symbol (case-insensitive). Returns record or null. */
export function bySymbol(sym) {
  if (sym == null) return null;
  const want = String(sym).trim().toUpperCase();
  if (!want) return null;
  return TOKENS.find((t) => t.symbol.toUpperCase() === want) || null;
}

/** All tokens on a given chain (case-insensitive, trimmed). Returns array. */
export function byChain(chain) {
  if (chain == null) return [];
  const want = String(chain).trim().toLowerCase();
  if (!want) return [];
  return TOKENS.filter((t) => t.chain.toLowerCase() === want);
}

/** All token symbols, in record order. */
export function list() {
  return TOKENS.map((t) => t.symbol);
}

/**
 * Free-text search across symbol, name, chain, mechanism, supplyNote, plain.
 * Case-insensitive substring match. Returns matching records (possibly empty).
 */
export function search(term) {
  if (term == null) return [];
  const q = String(term).trim().toLowerCase();
  if (!q) return [];
  return TOKENS.filter((t) =>
    [t.symbol, t.name, t.chain, t.mechanism, t.supplyNote, t.plain]
      .some((f) => String(f).toLowerCase().includes(q)),
  );
}

const COLS = [
  ['symbol', 'Symbol'],
  ['name', 'Name'],
  ['chain', 'Chain'],
  ['mechanism', 'Mechanism'],
  ['supplyNote', 'Supply'],
];

/**
 * Deterministic table of all tokens. Markdown by default; HTML when
 * { html: true } — HTML branch esc()s every interpolated cell.
 */
export function renderTable({ html = false } = {}) {
  if (html) {
    const head = COLS.map(([, label]) => `<th>${esc(label)}</th>`).join('');
    const rows = TOKENS.map((t) => {
      const cells = COLS.map(([key]) => `<td>${esc(t[key])}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  const header = `| ${COLS.map(([, l]) => l).join(' | ')} |`;
  const sep = `| ${COLS.map(() => '---').join(' | ')} |`;
  const lines = TOKENS.map(
    (t) => `| ${COLS.map(([key]) => String(t[key]).replace(/\|/g, '\\|')).join(' | ')} |`,
  );
  return [header, sep, ...lines].join('\n');
}
