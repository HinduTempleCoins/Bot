// crypto-protocol-catalog.mjs — a small, curated, READ-ONLY index of well-known
// crypto-protocol specification documents (EIP / BIP / Lightning BOLT / Monero
// research / CryptoNote / devp2p), plus pure query transforms over it.
//
// WHY THIS EXISTS
//   The dataset-ingest pipeline (datasets/crypto-protocols/ — EIPs, BIPs, Lightning
//   BOLT, Monero research, CryptoNote, devp2p) wants a compact, deterministic,
//   source-of-truth table of the protocol specs the corpus cares about: a stable
//   number, a human title, the spec family, its status, the canonical URL, and the
//   document license. This module holds that as static data and exposes pure,
//   deterministic queries over it. It NEVER fetches, NEVER calls an LLM, and does NOT
//   touch any other file — it is a self-contained, public-safe knowledge dataset.
//
//   The seed set is intentionally small but representative (the operator can extend
//   CATALOG in place): canonical EIPs (20/721/1559), foundational BIPs (32/39/141),
//   the Lightning BOLT series (1..11), Monero/CryptoNote research, and devp2p.
//
// EXPORTS
//   CATALOG          — frozen array of frozen { family, number, title, status,
//                      canonicalUrl, license } records (the source of truth).
//   byFamily(family) — records in a single family ('EIP'|'BIP'|'BOLT'|'Monero'|
//                      'CryptoNote'|'devp2p'), case-insensitive; [] on no/blank match.
//   find(query)      — case-insensitive substring match over number AND title.
//   byStatus(status) — records with a matching status, case-insensitive.
//   families()       — distinct families, each with a count, sorted by family name.
//   manifest()       — { total, byFamily, licenses } summary for the ingest pipeline.
//
//   import { CATALOG, byFamily, find, byStatus, families, manifest }
//     from './crypto-protocol-catalog.mjs';
//
// All functions are pure and deterministic: no I/O, no clock, no randomness. Lookups
// soft-fail (return [] / a stable shape) rather than throwing on bad input.

// ── THE DATA ───────────────────────────────────────────────────────────────────────
// Each record:
//   family       — one of the six known spec families (see KNOWN_FAMILIES).
//   number       — the spec's canonical identifier as a string ('20', '32', '1',
//                  'CryptoNote', 'devp2p'); kept as a string so non-numeric ids fit.
//   title        — the spec's human title.
//   status       — the spec's published status (Final / Draft / Active / etc.).
//   canonicalUrl — the public canonical document URL.
//   license      — the document's stated license (public record).
//
// Sources: the public spec repositories (ethereum/EIPs, bitcoin/bips,
// lightning/bolts, monero-project research, the CryptoNote whitepaper, and the
// Ethereum devp2p spec). URLs and licenses are the documented public record.
export const CATALOG = Object.freeze([
  // ── EIP (Ethereum Improvement Proposals) ──
  Object.freeze({
    family: 'EIP',
    number: '20',
    title: 'ERC-20 Token Standard',
    status: 'Final',
    canonicalUrl: 'https://eips.ethereum.org/EIPS/eip-20',
    license: 'CC0-1.0',
  }),
  Object.freeze({
    family: 'EIP',
    number: '721',
    title: 'ERC-721 Non-Fungible Token Standard',
    status: 'Final',
    canonicalUrl: 'https://eips.ethereum.org/EIPS/eip-721',
    license: 'CC0-1.0',
  }),
  Object.freeze({
    family: 'EIP',
    number: '1559',
    title: 'Fee market change for ETH 1.0 chain',
    status: 'Final',
    canonicalUrl: 'https://eips.ethereum.org/EIPS/eip-1559',
    license: 'CC0-1.0',
  }),
  // ── BIP (Bitcoin Improvement Proposals) ──
  Object.freeze({
    family: 'BIP',
    number: '32',
    title: 'Hierarchical Deterministic Wallets',
    status: 'Final',
    canonicalUrl: 'https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki',
    license: 'BSD-2-Clause',
  }),
  Object.freeze({
    family: 'BIP',
    number: '39',
    title: 'Mnemonic code for generating deterministic keys',
    status: 'Proposed',
    canonicalUrl: 'https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki',
    license: 'BSD-2-Clause',
  }),
  Object.freeze({
    family: 'BIP',
    number: '141',
    title: 'Segregated Witness (Consensus layer)',
    status: 'Final',
    canonicalUrl: 'https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki',
    license: 'BSD-2-Clause',
  }),
  // ── BOLT (Lightning Network Basis of Lightning Technology) ──
  Object.freeze({
    family: 'BOLT',
    number: '1',
    title: 'Base Protocol',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/01-messaging.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '2',
    title: 'Peer Protocol for Channel Management',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/02-peer-protocol.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '3',
    title: 'Bitcoin Transaction and Script Formats',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/03-transactions.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '4',
    title: 'Onion Routing Protocol',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/04-onion-routing.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '5',
    title: 'Recommendations for On-chain Transaction Handling',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/05-onchain.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '7',
    title: 'P2P Node and Channel Discovery',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/07-routing-gossip.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '8',
    title: 'Encrypted and Authenticated Transport',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/08-transport.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '9',
    title: 'Assigned Feature Flags',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/09-features.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '10',
    title: 'DNS Bootstrap and Assisted Node Location',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/10-dns-bootstrap.md',
    license: 'CC-BY-4.0',
  }),
  Object.freeze({
    family: 'BOLT',
    number: '11',
    title: 'Invoice Protocol for Lightning Payments',
    status: 'Active',
    canonicalUrl: 'https://github.com/lightning/bolts/blob/master/11-payment-encoding.md',
    license: 'CC-BY-4.0',
  }),
  // ── Monero research ──
  Object.freeze({
    family: 'Monero',
    number: 'MRL-0001',
    title: 'A Note on Chain Reactions in Traceability in CryptoNote 2.0',
    status: 'Published',
    canonicalUrl: 'https://www.getmonero.org/resources/research-lab/pubs/MRL-0001.pdf',
    license: 'Research-publication',
  }),
  Object.freeze({
    family: 'Monero',
    number: 'MRL-0005',
    title: 'Ring Confidential Transactions',
    status: 'Published',
    canonicalUrl: 'https://www.getmonero.org/resources/research-lab/pubs/MRL-0005.pdf',
    license: 'Research-publication',
  }),
  // ── CryptoNote ──
  Object.freeze({
    family: 'CryptoNote',
    number: 'CryptoNote',
    title: 'CryptoNote v2.0 Whitepaper',
    status: 'Published',
    canonicalUrl: 'https://web.archive.org/web/cryptonote/whitepaper.pdf',
    license: 'Whitepaper',
  }),
  // ── devp2p ──
  Object.freeze({
    family: 'devp2p',
    number: 'devp2p',
    title: 'Ethereum devp2p Wire Protocol',
    status: 'Active',
    canonicalUrl: 'https://github.com/ethereum/devp2p/blob/master/rlpx.md',
    license: 'CC0-1.0',
  }),
]);

// The six known families. Used to normalize/validate case-insensitive family queries.
export const KNOWN_FAMILIES = Object.freeze([
  'EIP', 'BIP', 'BOLT', 'Monero', 'CryptoNote', 'devp2p',
]);

// ── PURE TRANSFORMS ──────────────────────────────────────────────────────────────────

// norm — lower-cased, trimmed string for case-insensitive comparison. Non-strings and
// null/undefined collapse to '' so callers never throw on bad input.
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// byFamily(family) — records in a single family, matched case-insensitively against the
// record's `family`. Soft-fail: a blank/unknown family yields [].
export function byFamily(family) {
  const f = norm(family);
  if (!f) return [];
  return CATALOG.filter((r) => norm(r.family) === f);
}

// find(query) — case-insensitive substring match over BOTH number and title. A blank
// query yields [] (rather than the whole catalog) so it never accidentally matches all.
export function find(query) {
  const q = norm(query);
  if (!q) return [];
  return CATALOG.filter(
    (r) => norm(r.number).includes(q) || norm(r.title).includes(q));
}

// byStatus(status) — records whose status matches case-insensitively. Blank → [].
export function byStatus(status) {
  const s = norm(status);
  if (!s) return [];
  return CATALOG.filter((r) => norm(r.status) === s);
}

// families() — distinct families present in CATALOG, each with its record count, sorted
// by family name for deterministic output.
export function families() {
  const counts = new Map();
  for (const r of CATALOG) counts.set(r.family, (counts.get(r.family) || 0) + 1);
  return Array.from(counts.entries())
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => String(a.family).localeCompare(String(b.family)));
}

// manifest() — a deterministic summary for the dataset-ingest pipeline:
//   total     — record count.
//   byFamily  — { [family]: count } for every family present (sorted keys).
//   licenses  — distinct licenses present, sorted.
export function manifest() {
  const byFam = {};
  for (const { family, count } of families()) byFam[family] = count;
  const licenses = Array.from(new Set(CATALOG.map((r) => r.license)))
    .sort((a, b) => String(a).localeCompare(String(b)));
  return { total: CATALOG.length, byFamily: byFam, licenses };
}

// CLI: print the manifest as pretty JSON. Guarded so importing never runs it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(manifest(), null, 2) + '\n');
}
