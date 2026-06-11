// token-registry.mjs — a frozen, queryable registry of the Van Kush token set.
//
// WHY THIS EXISTS
//   The facts about the Van Kush Family tokens (VKBT, CURE, PUCO, PUTI, DFB, DFC,
//   and the broader set) are scattered across several public knowledge JSONs
//   (cure_token_documentation.json, van_kush_crypto_network.json,
//   where_defi_is_headed_bitcointalk.json, synthesis/knowledge-base.json) and the
//   token notes in MASTER_ITINERARY.md. This module normalizes those scattered
//   descriptive facts into ONE read-only, queryable registry so the corpus and the
//   command/tutorial surfaces can answer "what is PUCO?" deterministically.
//
//   This is DESCRIPTIVE METADATA ONLY. It is deliberately distinct from:
//     - engine/contracts/tokens.mjs   — builds chain ops (write side)
//     - engine/lib/smt-token-spec.mjs — validation
//   It NEVER fetches, NEVER touches disk/clock/chain/keys, NEVER calls an LLM, and
//   holds no prices, no secrets, no live state — just static, sourced facts.
//
// EXPORTS
//   esc(s)                       — HTML/Markdown-safe escaping for interpolation
//   TOKENS                       — Object.freeze'd array of token entries
//   getToken(symbol)             — entry | null (case-insensitive)
//   list()                       — all symbols (array of strings)
//   byChain(chain)               — entries on a chain ([] if none / bad input)
//   byKind(kind)                 — entries of a kind ([] if none / bad input)
//   search(term)                 — entries matching symbol/name/summary/tags
//   renderMarkdown({rows})       — a deterministic Markdown table
//
//   import { TOKENS, getToken, search, renderMarkdown } from './token-registry.mjs';

// esc() — escape any value we interpolate into rendered text (HTML-context-safe).
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── THE DATA ─────────────────────────────────────────────────────────────────────
// Each entry: symbol, name, chain, kind, a one-line summary, a mechanics string, tags.
// Facts drawn verbatim-in-spirit from the public knowledge JSONs and MASTER_ITINERARY
// token notes. No prices, no live status — descriptive metadata only.
export const TOKENS = Object.freeze([
  Object.freeze({
    symbol: 'VKBT',
    name: 'Van Kush Beauty Token',
    chain: 'HIVE-Engine',
    kind: 'utility',
    summary: 'Rewards token for Van Kush Beauty customers and community members; activated on the @kalivankush HIVE account.',
    mechanics: 'Smart Media Token on HIVE-Engine. Utility: product discounts, community voting, staking rewards. Cross-chain TRC20 bridge planned (VKBT-TRC20).',
    tags: Object.freeze(['hive-engine', 'beauty', 'rewards', 'smt', 'staking', 'vankush']),
  }),
  Object.freeze({
    symbol: 'CURE',
    name: 'CURE (Curation Rewards Token)',
    chain: 'HIVE-Engine',
    kind: 'curation',
    summary: 'Specialized Smart Media Token rewarding curation (voting on content) within the HIVE ecosystem, with extreme rarity as its core value proposition.',
    mechanics: 'Minting ~2.4 CURE/hour (~21,000/year, claimed rarer than Bitcoin). Reward split 51% curators / 49% authors. 75% of rewards auto-staked; 150-day unstake over 50 installments every 3 days. A 100% vote consumes 2% of vote power (24h full regen). Eligible tags: #vankushfamily #actifit #pepe #proofofbrain #curators. Listed on TribalDEX.',
    tags: Object.freeze(['hive-engine', 'tribaldex', 'curation', 'socialfi', 'smt', 'rarity', 'vankush']),
  }),
  Object.freeze({
    symbol: 'PUCO',
    name: 'Punic Copper',
    chain: 'TRON',
    kind: 'governance',
    summary: 'TRON (TRC20) token with a large fixed supply and a long DAO-managed lock-up, traded for real-world goods (seeds, herbs, books).',
    mechanics: 'Supply 700,000,000 tokens; 50% (350M) frozen for 900 days under DAO governance. Launched on SunSwap with a burn address. Real-world utility: trading for seeds, herbs, and books.',
    tags: Object.freeze(['tron', 'trc20', 'sunswap', 'dao', 'lockup', 'punic', 'vankush']),
  }),
  Object.freeze({
    symbol: 'PUTI',
    name: 'Punic Tin',
    chain: 'Steem-Engine',
    kind: 'curation',
    summary: 'Steem-Engine SCOT token with very slow, steady, tag-based distribution over decades.',
    mechanics: 'Distribution: 1 token/minute for 64 years. Reward algorithm 65% author / 35% curator. Eligible tags: #ulogs #dtube #punicwax #projecthope. SCOT-bot driven; Steem-Engine trading pair.',
    tags: Object.freeze(['steem-engine', 'scot', 'curation', 'slow-emission', 'punic', 'vankush']),
  }),
  Object.freeze({
    symbol: 'DFB',
    name: 'DFB Burn-Mining Token',
    chain: 'Polygon',
    kind: 'burn-mine',
    summary: 'Polygon burn-mining token: new tokens are minted only by burning large amounts of an existing token, managing supply via scarcity.',
    mechanics: 'Burn-mining: mint Coin B only by burning a massive amount of Coin A (e.g., 100M A = 1 B). Polygon (MATIC) liquidity pools; "Peggy" bridges to HIVE-Engine; multi-stake contracts (stake QUICK/MATIC to earn Van Kush tokens).',
    tags: Object.freeze(['polygon', 'matic', 'burn-mining', 'defi', 'bridge', 'vankush']),
  }),
  Object.freeze({
    symbol: 'DFC',
    name: 'DFC Burn-Mining Token',
    chain: 'Polygon',
    kind: 'burn-mine',
    summary: 'Polygon burn-mining companion token to DFB, minted via the same burn-to-mint scarcity mechanism.',
    mechanics: 'Burn-mining: mint by burning an existing token, with fixed burn-mining contracts on Polygon. Paired with DFB across the Polygon liquidity pools and HIVE-Engine "Peggy" bridges.',
    tags: Object.freeze(['polygon', 'matic', 'burn-mining', 'defi', 'bridge', 'vankush']),
  }),
]);

// ── HELPERS ──────────────────────────────────────────────────────────────────────
const _norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

// getToken(symbol) — case-insensitive lookup by symbol; null on miss or bad input.
export function getToken(symbol) {
  const q = _norm(symbol);
  if (!q) return null;
  return TOKENS.find((t) => t.symbol.toLowerCase() === q) || null;
}

// list() — all symbols in registry order.
export function list() {
  return TOKENS.map((t) => t.symbol);
}

// byChain(chain) — entries on a chain (case-insensitive); [] if none / bad input.
export function byChain(chain) {
  const q = _norm(chain);
  if (!q) return [];
  return TOKENS.filter((t) => t.chain.toLowerCase() === q);
}

// byKind(kind) — entries of a kind (case-insensitive); [] if none / bad input.
export function byKind(kind) {
  const q = _norm(kind);
  if (!q) return [];
  return TOKENS.filter((t) => t.kind.toLowerCase() === q);
}

// search(term) — substring match across symbol/name/summary/tags; '' / bad input -> [].
export function search(term) {
  const q = _norm(term);
  if (!q) return [];
  return TOKENS.filter((t) => {
    const hay = [t.symbol, t.name, t.summary, ...(t.tags || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

// renderMarkdown({rows}) — deterministic Markdown table over the given rows.
export function renderMarkdown(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const rows = ('rows' in o) ? o.rows : TOKENS;
  const list = Array.isArray(rows) ? rows : [];
  const header =
    '| Symbol | Name | Chain | Kind | Summary |\n' +
    '| --- | --- | --- | --- | --- |';
  if (list.length === 0) return header + '\n| _(none)_ |  |  |  |  |';
  const body = list
    .map((t) => {
      const cell = (v) => esc(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      return `| ${cell(t.symbol)} | ${cell(t.name)} | ${cell(t.chain)} | ${cell(t.kind)} | ${cell(t.summary)} |`;
    })
    .join('\n');
  return header + '\n' + body;
}
