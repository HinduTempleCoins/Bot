// chain-compare.mjs — TRON vs Ethereum (and any registered chain) honest comparison.
//
// A PURE comparison surface in the integrations/ honest-comparison style: state the
// public, static facts about each chain side-by-side, with no editorializing and no
// "which is better" verdict. The same engine that drives the markets aggregator's
// right-of-reply Clarity rating applies here — we list verifiable facts, aligned by
// dimension, and let the reader compare.
//
// Built ONLY from static, public facts (consensus model, throughput class, typical
// fee tier, token standards, smart-contract VM, governance). No live chain reads, no
// price data, no network. The CHAINS map is extensible: add a chain object with the
// same dimension keys and it joins every table/compare path automatically.
//
//   import { CHAINS, DIMENSIONS, compare, table, renderCompare, esc }
//     from './chain-compare.mjs'
//   compare('tron', 'ethereum')   -> [{ dimension, label, a, b }, ...]
//   table()                       -> { dimensions, chains, rows }
//   renderCompare({ html: true }) -> esc()'d HTML table (default text)
//   node integrations/chain-compare.mjs            # prints the TRON-vs-Ethereum table
//   node integrations/chain-compare.mjs --html     # HTML table
//   node integrations/chain-compare.mjs tron solana # compare two named chains
//
// PURE / deterministic. Soft-fail everywhere: an unknown chain resolves to safe 'n/a'
// rows rather than throwing. Every render path escapes HTML.

// HTML escape — single local copy, identical behavior to the rest of integrations/.
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── DIMENSIONS — the comparison axes, in display order ──────────────────────────────
// key: stable field name on each chain object.  label: human-readable axis name.
export const DIMENSIONS = [
  { key: 'consensus', label: 'Consensus' },
  { key: 'throughput', label: 'Throughput class' },
  { key: 'feeTier', label: 'Typical fee tier' },
  { key: 'tokenStandards', label: 'Token standards' },
  { key: 'vm', label: 'Smart-contract VM' },
  { key: 'governance', label: 'Governance' },
];

// ── CHAINS — static, public facts. Extensible: add same-keyed objects to compare. ───
// Each value is a short factual string. No verdicts, no "better/worse" framing.
export const CHAINS = {
  tron: {
    id: 'tron',
    name: 'TRON',
    consensus: 'Delegated Proof-of-Stake (27 Super Representatives)',
    throughput: 'High (thousands of TPS class)',
    feeTier: 'Very low (Energy/Bandwidth model; often near-zero)',
    tokenStandards: 'TRC-20, TRC-10, TRC-721',
    vm: 'TVM (TRON Virtual Machine, EVM-compatible)',
    governance: 'SR vote-based on-chain governance',
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    consensus: 'Proof-of-Stake (Gasper: Casper FFG + LMD-GHOST)',
    throughput: 'Moderate base layer (low tens of TPS class; scaled via L2)',
    feeTier: 'Variable (EIP-1559 gas; can be high under load)',
    tokenStandards: 'ERC-20, ERC-721, ERC-1155',
    vm: 'EVM (Ethereum Virtual Machine)',
    governance: 'Off-chain (EIPs + client/social consensus)',
  },
};

// A safe placeholder used for any unknown chain so compare/table never throw.
const NA = 'n/a';

// Resolve a chain by id/name, case-insensitively. Returns null if unknown.
export function getChain(id) {
  if (id == null) return null;
  const key = String(id).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CHAINS, key)) return CHAINS[key];
  // also allow lookup by display name (e.g. "Ethereum")
  for (const c of Object.values(CHAINS)) {
    if (String(c.name).toLowerCase() === key) return c;
  }
  return null;
}

// Read one dimension off a chain object, soft-failing to 'n/a'.
function cell(chain, key) {
  if (!chain) return NA;
  const v = chain[key];
  return (v == null || v === '') ? NA : String(v);
}

// ── compare(a, b) — aligned per-dimension rows for two chains ────────────────────────
// Unknown chains degrade to 'n/a' cells; the row shape is always stable. The header
// fields aName/bName fall back to the raw identifier so callers can still label columns.
export function compare(a, b) {
  const ca = getChain(a);
  const cb = getChain(b);
  const aName = ca ? ca.name : (a == null ? NA : String(a));
  const bName = cb ? cb.name : (b == null ? NA : String(b));
  const rows = DIMENSIONS.map((d) => ({
    dimension: d.key,
    label: d.label,
    a: cell(ca, d.key),
    b: cell(cb, d.key),
  }));
  return { a: aName, b: bName, knownA: !!ca, knownB: !!cb, rows };
}

// ── table() — full matrix over every registered chain ───────────────────────────────
// rows: one per dimension, each with a values[] aligned to chains[].
export function table(ids) {
  const list = Array.isArray(ids) && ids.length
    ? ids.map(getChain).filter(Boolean)
    : Object.values(CHAINS);
  const chains = list.map((c) => ({ id: c.id, name: c.name }));
  const rows = DIMENSIONS.map((d) => ({
    dimension: d.key,
    label: d.label,
    values: list.map((c) => cell(c, d.key)),
  }));
  return { dimensions: DIMENSIONS.map((d) => d.label), chains, rows };
}

// ── renderCompare({ html, a, b }) — text (default) or esc()'d HTML table ─────────────
// Defaults to the canonical TRON-vs-Ethereum comparison. a/b override the two chains.
export function renderCompare({ html = false, a = 'tron', b = 'ethereum' } = {}) {
  const cmp = compare(a, b);
  if (html) {
    const head =
      `<tr><th>Dimension</th><th>${esc(cmp.a)}</th><th>${esc(cmp.b)}</th></tr>`;
    const body = cmp.rows
      .map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.a)}</td><td>${esc(r.b)}</td></tr>`)
      .join('');
    return `<table class="chain-compare"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }
  // plain text: aligned-ish columns, no HTML
  const lines = [`${cmp.a} vs ${cmp.b}`, ''];
  for (const r of cmp.rows) {
    lines.push(`${r.label}:`);
    lines.push(`  ${cmp.a}: ${r.a}`);
    lines.push(`  ${cmp.b}: ${r.b}`);
  }
  return lines.join('\n');
}

// ── CLI (guarded) — prints TRON-vs-Ethereum by default ──────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const html = args.includes('--html');
  const named = args.filter((x) => !x.startsWith('-'));
  const a = named[0] || 'tron';
  const b = named[1] || 'ethereum';
  process.stdout.write(renderCompare({ html, a, b }) + '\n');
}
