// build-options.mjs — the "Build Options" control/clarity surface for the Soapy.blog admin Features tab.
//
// Two things live here:
//
//   1. BUILD_OPTIONS — a curated catalog of the project's BUILD-DIRECTION choices (NOT live deploy
//      triggers). It renders FIRST, at the TOP of the Features tab, above the module catalog, so the
//      operator sees the decisions on the table before the inventory of what's already coded. The
//      blockchain options are grounded in the PRANA design docs materialized at /workspaces/PRANA
//      (design/compute/* + contracts/contracts/compute/*) and the in-repo summary
//      .local/PRANA_CHAIN_DESIGN.md. Each card is a clear, short, source-cited description.
//
//   2. The operator NOTE store — a persistent JSONL the operator writes to from the panel
//      (textarea + Submit) and that Claude can later `cat`. Path: data/admin-notes.jsonl
//      (mirrors the existing data/ stores: feature-flags.json, captcha-handoffs.json). One JSON
//      object per line: { at, note }. Append-only; the panel renders the last N back.
//
// No network, no secrets. Pure data + a tiny file appender. The fs layer is injectable (__setFs) so
// the admin tests run offline.

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const NOTES_PATH = process.env.ADMIN_NOTES_FILE || join(ROOT, 'data', 'admin-notes.jsonl');

// injectable fs (tests pass a fake; default is the real node:fs/promises) ───────────────────────────
let _fs = { appendFile, readFile };
export function __setFs(fake) { _fs = fake || { appendFile, readFile }; }
export function notesPath() { return NOTES_PATH; }

// ── 1. BUILD OPTIONS catalog ──────────────────────────────────────────────────────────────────────
// Each option: { id, title, desc, choice, source[] }.
//   group  — which section card it renders under
//   choice — the recommendation / direction-on-record (plain text), or '' if undecided
//   source — the doc(s) the gist was pulled from (shown so the operator can trace it)
// These are CONTROL/CLARITY cards. Selecting/seeing one records intent; nothing here deploys a chain.

export const BUILD_OPTION_GROUPS = [
  {
    id: 'chains',
    title: 'Blockchain build options',
    blurb: 'The two MELEK-ecosystem chains and the PRANA "chain IS the pool" compute design. '
      + 'These are build-direction choices, not live deploy triggers — they say what we are building toward.',
  },
  {
    id: 'platform',
    title: 'Platform build options',
    blurb: 'Cross-cutting build directions for the off-chain operator software.',
  },
];

export const BUILD_OPTIONS = [
  // ── chains: the two chains ──────────────────────────────────────────────────────────────────────
  {
    id: 'chain-melek-graphene',
    group: 'chains',
    title: 'MELEK chain — Graphene (BLURT/Steem family) social chain',
    desc: 'MELEK is a Graphene DPoS social blockchain (a BLURT/Steem fork) where Hathor is a founding '
      + 'witness account. Standard Graphene ops only (comment/vote/transfer/delegate); no custom AI ops. '
      + 'Single source of truth, many interchangeable front ends (the condenser).',
    choice: 'Build: Graphene fork, Hathor witness with a 1-year slot protection in the chain code.',
    source: ['BRIEF.md §1', 'CLAUDE.md core framing'],
  },
  {
    id: 'chain-prana-coregeth',
    group: 'chains',
    title: 'PRANA chain — core-geth fork, Etchash PoW (EVM family)',
    desc: 'PRANA is our own EVM-family PoW coin chain. Recommendation on record: clone core-geth '
      + '(Ethereum Classic’s actively-maintained geth lineage) with a fresh genesis and Etchash PoW '
      + '(ASIC-resistant Ethash variant) — the most battle-tested mineable PoW-EVM, and the path of least '
      + 'resistance because our Miningcore pool stack already speaks Etchash stratum. L1 node mines, '
      + 'chainId 108369.',
    choice: 'Build: core-geth fork + Etchash PoW genesis (chainId 108369).',
    source: ['.local/PRANA_CHAIN_DESIGN.md §1', 'PRANA design/LAUNCH-READINESS.md'],
  },
  // ── chains: the PRANA compute / pool design (the "chain IS the pool" engine) ─────────────────────
  {
    id: 'prana-gridcoin-redirect',
    group: 'chains',
    title: 'AI-work-as-mining (the GridCoin redirect)',
    desc: 'The thesis of the whole compute design: a GPU doing AI work (running Hathor / inference) IS '
      + 'the mining. The GPU is pointed at AI jobs, and that work — not a hash — is what earns shares in '
      + 'the pool (the TASK lane). Hashing stays only as a thin heartbeat that secures and orders blocks. '
      + 'GridCoin-style useful-work reward, implemented on-chain.',
    choice: 'Build direction: useful AI work earns; hashing is a thin security floor.',
    source: ['PRANA design/compute/gridcoin-redirect.md', 'design/ENGINE-DIAGRAM.md'],
  },
  {
    id: 'prana-microhash-burn',
    group: 'chains',
    title: 'Microhashing + burn-for-hashrate (the three lanes)',
    desc: 'One canonical pool (UnifiedSharesLedger) credits three lanes into the SAME per-epoch PPLNS '
      + 'pool: HASH (a microhash heartbeat — Etchash, self-verifying), TASK (verified AI/useful work), '
      + 'and BURN (proof-of-burn perma-stake via MultiCurrencyBurnRouter). BurnForHashrate is the '
      + '0xBTC/Bitcoineum "virtual mining" model: a fixed reward per epoch split pro-rata among everyone '
      + 'who burned that epoch (difficulty rises for free as total burn rises).',
    choice: 'Build: HASH + TASK + BURN lanes into one UnifiedSharesLedger (default weights 1:1:1, DAO-governed).',
    source: ['PRANA design/compute/decentralized-pool.md', 'contracts/.../UnifiedSharesLedger, BurnForHashrate, HashTaskWeightConfig'],
  },
  {
    id: 'prana-cpu-bootstrap',
    group: 'chains',
    title: 'CPU bootstrap — ordinary laptops mine from day one (RandomX)',
    desc: 'At launch the people who show up have laptops, not GPU farms. A GPU-only chain starts '
      + 'concentrated. RandomX light-mode lets a plain CPU secure and distribute the coin on day one; '
      + 'when a GPU arrives it is worth more on AI work (TASK lane) than on hashing, so it graduates. '
      + 'Breadth principle: many people contribute something.',
    choice: 'Build: add a CPU-native RandomX bootstrap lane alongside Etchash microhash.',
    source: ['PRANA design/compute/cpu-bootstrap.md', 'design/compute/hardware-tiers.md'],
  },
  {
    id: 'prana-hardware-tiers',
    group: 'chains',
    title: 'Hardware tiers — the honest map (who mines, on what)',
    desc: 'An honest tier map instead of overpromising: Tier-1 buyable consumer GPUs are the community '
      + 'substrate (real AI inference + microhashing; low-VRAM 3–6 GB cards stay in via Etchash '
      + 'ECIP-1099 "Thanos"); higher tiers (multi-GPU rigs, data-center) and an FPGA/open-silicon '
      + 'education track scale up. A laptop is a weak hasher and a task-small AI contributor — said plainly.',
    choice: 'Build: design pool so each hardware tier can contribute something, honestly scoped.',
    source: ['PRANA design/compute/hardware-tiers.md'],
  },
  {
    id: 'prana-pool-model',
    group: 'chains',
    title: 'Pool model — default single pool vs. registered pools (Devcoin-style)',
    desc: 'Devcoin-style: the chain routes block rewards to a protocol-default pool that splits to a list '
      + 'per the DAO’s division rules, while opt-in registered pools may also run — on the condition '
      + 'their miners consume our DAO’s AI workload. On-chain the pool is two parts: the canonical '
      + 'UnifiedSharesLedger (can’t be rugged) plus permissionless off-chain coordinators '
      + '(CoordinatorRegistry slashable bond + JobClaimLedger cross-coordinator dedup).',
    choice: 'Build: protocol-default pool + opt-in registered pools; DAO sets share division; AI-work required.',
    source: ['.local/PRANA_CHAIN_DESIGN.md §2', 'contracts/.../CoordinatorRegistry, JobClaimLedger, TaskDispatchPolicy'],
  },
  {
    id: 'prana-miningcore-fork',
    group: 'chains',
    title: 'Pool engine — fork Miningcore (one codebase, both algorithms)',
    desc: 'Rather than run two separate pool stacks, fork oliverw/miningcore — one multi-coin engine that '
      + 'already ships BOTH stratum families in one process: Ethash-family (our Etchash microhash lane) '
      + 'and CryptoNote/RandomX (our CPU bootstrap lane). One binary, one config, one payment core, two '
      + 'algo front-ends. It is the off-chain coordinator that posts verified work to the on-chain ledger '
      + 'while verification matures; the in-chain decentralized pool is the priority path.',
    choice: 'Build: fork Miningcore for the off-chain coordinator (Etchash + RandomX → one UnifiedSharesLedger).',
    source: ['PRANA design/compute/miningcore-fork.md', '.local/MINING_POOL_PLAN.md'],
  },
  // ── platform ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'platform-zero-wif',
    group: 'platform',
    title: 'Key custody — zero WIF on host, sign via MELEK-Signer',
    desc: 'No private key ever lives in this repo or its host. Broadcasts go through a separate '
      + 'MELEK-Signer service authenticated by a scoped, revocable bearer token. The Bot treats Hathor '
      + 'as a witness account and never signs locally.',
    choice: 'Build: all signing behind MELEK-Signer; this host stays zero-WIF by construction.',
    source: ['MELEK_SIGNER.md', 'BRIEF.md §7'],
  },
];

export function buildOptionsByGroup() {
  const out = {};
  for (const g of BUILD_OPTION_GROUPS) out[g.id] = { ...g, options: [] };
  for (const o of BUILD_OPTIONS) (out[o.group] ||= { id: o.group, title: o.group, blurb: '', options: [] }).options.push(o);
  return BUILD_OPTION_GROUPS.map((g) => out[g.id]);
}

// ── 2. operator NOTE store (persistent; Claude reads data/admin-notes.jsonl) ─────────────────────────
// Append one JSON line per submitted note. Trimmed + length-capped. Returns { ok, at } | { ok:false }.
export async function addNote(text) {
  const note = String(text == null ? '' : text).trim().slice(0, 4000);
  if (!note) return { ok: false, error: 'empty' };
  const rec = { at: new Date().toISOString(), note };
  try {
    if (!_fs.appendFile.__noMkdir && !existsSync(dirname(NOTES_PATH))) {
      await mkdir(dirname(NOTES_PATH), { recursive: true });
    }
  } catch { /* mkdir best-effort */ }
  try {
    await _fs.appendFile(NOTES_PATH, JSON.stringify(rec) + '\n');
    return { ok: true, at: rec.at };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Read the most-recent N notes (newest first). Soft-fail → [].
export async function recentNotes(n = 10) {
  let txt = '';
  try { txt = await _fs.readFile(NOTES_PATH, 'utf8'); } catch { return []; }
  const lines = txt.split('\n').filter((l) => l.trim());
  const out = [];
  for (const l of lines) {
    try { const o = JSON.parse(l); if (o && o.note) out.push({ at: o.at || null, note: String(o.note) }); }
    catch { /* skip malformed line */ }
  }
  return out.reverse().slice(0, Math.max(0, n));
}
