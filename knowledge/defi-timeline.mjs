// defi-timeline.mjs — a small, sourced, READ-ONLY dataset of the DeFi-era timeline
// (ICO → IEO → DeFi) plus pure formatters, feeding the knowledge corpus.
//
// WHY THIS EXISTS
//   The knowledge corpus wants a compact, deterministic account of how on-chain
//   fundraising and trading evolved — the 2017 ICO boom, the 2019 exchange-vetted
//   IEO interlude, and the 2020+ DeFi / AMM era — with the defining events, example
//   platforms (Uniswap, PancakeSwap, SunSwap), and the TRON-vs-Ethereum contrast that
//   recurs in MELEK's chain-legibility material. This module holds that as static data
//   and exposes pure transforms over it. It NEVER fetches, NEVER calls an LLM, and does
//   NOT edit knowledge-base.json — it is a self-contained knowledge-transform.
//
// EXPORTS
//   ERAS                     — frozen, sourced data (the array)
//   timeline()               — eras in chronological order (by startYear, then endYear)
//   eventsByYear(year)       — eras whose [startYear, endYear] span includes `year`
//   renderMarkdown()         — deterministic Markdown timeline (esc()'d interpolation)
//   esc(s)                   — HTML/Markdown-safe escaping for interpolation
//
//   import { ERAS, timeline, eventsByYear, renderMarkdown } from './defi-timeline.mjs';

// esc() — escape any value we interpolate into rendered text (HTML-context-safe).
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── THE DATA ───────────────────────────────────────────────────────────────────────
// Each era: a stable id, a human label, an inclusive [startYear, endYear] span, a short
// summary, the defining events, example platforms, and source pointers. Years are the
// widely-documented public record of these eras (kept intentionally coarse).
export const ERAS = Object.freeze([
  Object.freeze({
    id: 'ico',
    label: 'ICO era',
    startYear: 2014,
    endYear: 2018,
    summary:
      'Initial Coin Offerings: projects raised funds by selling tokens directly to the public, ' +
      'usually as ERC-20 tokens on Ethereum, with no exchange gatekeeping. Peaked in 2017.',
    definingEvents: Object.freeze([
      'Ethereum mainnet launch (2015) makes ERC-20 token issuance trivial',
      'The DAO token sale (2016) and subsequent hard fork',
      '2017 ICO boom — thousands of token sales',
      'Regulatory scrutiny rises (2017–2018); many sales reclassified as securities offerings',
    ]),
    examplePlatforms: Object.freeze(['Ethereum (ERC-20)', 'The DAO']),
    sources: Object.freeze([
      'Ethereum ERC-20 token standard (EIP-20)',
      'Public record of the 2017 ICO boom and 2018 contraction',
    ]),
  }),
  Object.freeze({
    id: 'ieo',
    label: 'IEO era',
    startYear: 2019,
    endYear: 2019,
    summary:
      'Initial Exchange Offerings: token sales conducted through a centralized exchange that ' +
      'vetted the project and sold to its own users — an exchange-gatekept answer to ICO fraud.',
    definingEvents: Object.freeze([
      'Binance Launchpad popularizes the IEO model (early 2019)',
      'Exchanges (Binance, Huobi, OKEx, others) run launchpad token sales',
      'Short-lived: trust shifted to exchanges, then to permissionless DeFi',
    ]),
    examplePlatforms: Object.freeze(['Binance Launchpad', 'Huobi Prime', 'OKEx Jumpstart']),
    sources: Object.freeze([
      'Public record of Binance Launchpad and the 2019 IEO wave',
    ]),
  }),
  Object.freeze({
    id: 'defi',
    label: 'DeFi era',
    startYear: 2020,
    endYear: 2021,
    summary:
      'Decentralized Finance: permissionless on-chain trading and lending via automated market ' +
      'makers (AMMs) and liquidity pools, with no central gatekeeper. "DeFi Summer" (2020) and the ' +
      'spread of AMM clones across chains.',
    definingEvents: Object.freeze([
      'Uniswap v2 and the AMM/liquidity-pool model go mainstream (2020)',
      '"DeFi Summer" 2020 — yield farming and liquidity mining',
      'AMM forks proliferate across chains: PancakeSwap on BNB Chain, SunSwap on TRON',
      'TVL (total value locked) becomes the headline metric',
    ]),
    examplePlatforms: Object.freeze(['Uniswap', 'PancakeSwap', 'SunSwap']),
    sources: Object.freeze([
      'Uniswap protocol documentation (AMM/constant-product model)',
      'Public record of DeFi Summer 2020 and cross-chain AMM forks',
    ]),
  }),
]);

// A held position in MELEK's chain-legibility material: the same AMM/DeFi pattern
// appears on multiple Graphene-/EVM-adjacent chains, with TRON and Ethereum the
// canonical contrast. Kept as static data, not an argument to defend at runtime.
export const TRON_VS_ETHEREUM = Object.freeze({
  topic: 'TRON vs Ethereum (DeFi-era contrast)',
  ethereum: Object.freeze({
    chain: 'Ethereum',
    flagshipDex: 'Uniswap',
    note:
      'Original AMM home; high security/liquidity but higher gas fees, which pushed ' +
      'AMM clones onto cheaper chains.',
  }),
  tron: Object.freeze({
    chain: 'TRON',
    flagshipDex: 'SunSwap',
    note:
      'Low fees and high throughput; SunSwap is the TRON-native AMM, with the TRC-20 ' +
      'token standard mirroring ERC-20. Heavy stablecoin (USDT) settlement volume.',
  }),
  takeaway:
    'The AMM model is chain-agnostic: the same constant-product DEX recurs as Uniswap ' +
    '(Ethereum), PancakeSwap (BNB Chain), and SunSwap (TRON). The contrast is fees, ' +
    'throughput, and liquidity depth — not the core mechanism.',
});

// ── PURE TRANSFORMS ──────────────────────────────────────────────────────────────────

// timeline() — eras in chronological order. Stable: sort by startYear, then endYear,
// then id, so output never depends on declaration order or sort instability.
export function timeline() {
  return ERAS.slice().sort((a, b) =>
    (a.startYear - b.startYear) ||
    (a.endYear - b.endYear) ||
    String(a.id).localeCompare(String(b.id)));
}

// eventsByYear(year) — eras whose inclusive [startYear, endYear] span contains `year`.
// Soft-fail: a non-numeric / NaN year yields [] rather than throwing.
export function eventsByYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return [];
  return timeline().filter((e) => y >= e.startYear && y <= e.endYear);
}

// spanLabel — "2017" for a single year, "2014–2018" for a range.
function spanLabel(e) {
  return e.startYear === e.endYear
    ? String(e.startYear)
    : `${e.startYear}–${e.endYear}`;
}

// renderMarkdown() — a deterministic Markdown rendering of the timeline. No clocks,
// no randomness, no I/O: identical input → byte-identical output. All interpolation
// is esc()'d so the string is safe to embed in HTML-rendered corpus surfaces.
export function renderMarkdown() {
  const lines = [];
  lines.push('# DeFi history timeline: ICO → IEO → DeFi');
  lines.push('');

  for (const e of timeline()) {
    lines.push(`## ${esc(e.label)} (${esc(spanLabel(e))})`);
    lines.push('');
    lines.push(esc(e.summary));
    lines.push('');
    lines.push('**Defining events:**');
    for (const ev of e.definingEvents) lines.push(`- ${esc(ev)}`);
    lines.push('');
    lines.push(`**Example platforms:** ${e.examplePlatforms.map(esc).join(', ')}`);
    lines.push('');
    lines.push(`**Sources:** ${e.sources.map(esc).join('; ')}`);
    lines.push('');
  }

  const t = TRON_VS_ETHEREUM;
  lines.push(`## ${esc(t.topic)}`);
  lines.push('');
  lines.push(`- **${esc(t.ethereum.chain)}** (${esc(t.ethereum.flagshipDex)}): ${esc(t.ethereum.note)}`);
  lines.push(`- **${esc(t.tron.chain)}** (${esc(t.tron.flagshipDex)}): ${esc(t.tron.note)}`);
  lines.push('');
  lines.push(esc(t.takeaway));
  lines.push('');

  return lines.join('\n');
}

// CLI: print the rendered timeline. Guarded so importing the module never runs it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(renderMarkdown() + '\n');
}
