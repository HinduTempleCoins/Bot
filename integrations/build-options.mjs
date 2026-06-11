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
    title: 'Our blockchains — in plain terms',
    blurb: 'We have two blockchains, plus the big idea that "doing AI work IS how you mine." '
      + 'These cards say what we are building toward and why — they are explanations, not buttons that launch anything.',
  },
  {
    id: 'platform',
    title: 'How the software is run safely',
    blurb: 'Big-picture choices for the software that runs around the chains.',
  },
];

// Each card explains a real build decision in plain language (no command-line / programmer jargon).
// `desc` = what the feature IS and why it matters; `choice` = what we're building, in one sentence;
// `source` = the doc it traces back to (shown small, for the record — safe to ignore).
export const BUILD_OPTIONS = [
  // ── chains: the two chains ──────────────────────────────────────────────────────────────────────
  {
    id: 'chain-melek-graphene',
    group: 'chains',
    title: 'MELEK — our social blockchain (the Steem / BLURT family)',
    desc: 'MELEK is our social blockchain — the same proven kind that Steem and BLURT use, where posts, '
      + 'votes, and tips are saved permanently and any website can display them. Hathor is one of the '
      + 'founding "witnesses" — the trusted accounts that keep the network running and write new entries. '
      + 'It only uses the standard, well-understood actions (post, vote, send, give) — nothing custom or '
      + 'risky bolted on.',
    choice: 'We are building: our own copy of that battle-tested social-chain software, with Hathor’s '
      + 'witness seat protected for the first year so it can get established.',
    source: ['BRIEF.md §1', 'CLAUDE.md core framing'],
  },
  {
    id: 'chain-prana-coregeth',
    group: 'chains',
    title: 'PRANA — our minable coin (the Ethereum family)',
    desc: 'PRANA is our own coin that people can mine. It is built from the same software family as '
      + 'Ethereum, but uses a mining method that ordinary graphics cards can do — so it is not taken over '
      + 'by giant, specialized mining machines the way some coins are. We start from the most trusted, '
      + 'still-actively-maintained version of that software instead of writing a blockchain from scratch, '
      + 'and our mining pool already understands it.',
    choice: 'We are building: PRANA on the proven, graphics-card-friendly Ethereum-family software, so '
      + 'everyday miners can take part and our pool works with it out of the box.',
    source: ['.local/PRANA_EVM_OPTIONS_2026-06-10.md', '.local/PRANA_CHAIN_DESIGN.md §1'],
  },
  // ── chains: the PRANA compute / pool design (the "chain IS the pool" engine) ─────────────────────
  {
    id: 'prana-gridcoin-redirect',
    group: 'chains',
    title: 'You mine by doing AI work, not by wasting electricity',
    desc: 'The heart of PRANA: a computer earns the coin by doing useful AI work for us (like helping run '
      + 'Hathor), instead of just burning power on meaningless number-crunching the way most mining does. '
      + 'A tiny bit of ordinary mining stays in the background to keep the network secure and in order — '
      + 'but the real reward comes from doing real work.',
    choice: 'We are building: useful AI work is what earns the coin; ordinary mining is just a thin '
      + 'security layer underneath.',
    source: ['PRANA design/compute/gridcoin-redirect.md'],
  },
  {
    id: 'prana-microhash-burn',
    group: 'chains',
    title: 'Three ways to earn from one shared reward pool',
    desc: 'Everyone earns from a single shared reward pool, and there are three ways to add to it: '
      + '(1) a small, steady amount of ordinary mining; (2) doing the AI / useful work we hand out; and '
      + '(3) "burning" some coin — permanently giving up coins now in exchange for a steady share of '
      + 'future rewards. The community can dial how much each of the three counts.',
    choice: 'We are building: one shared reward pool fed by mining + AI work + burning, balanced however '
      + 'the community decides.',
    source: ['PRANA design/compute/decentralized-pool.md'],
  },
  {
    id: 'prana-cpu-bootstrap',
    group: 'chains',
    title: 'Day one, an ordinary laptop can take part',
    desc: 'When we launch, most people will have a normal laptop, not an expensive mining rig. If the coin '
      + 'demanded fancy hardware from the start, only a few people could get in and they would own '
      + 'everything. So at launch a plain laptop can help run and spread the coin. Later, when someone '
      + 'gets a graphics card, it earns more by doing AI work than by plain mining — so it naturally moves '
      + 'over to the useful work.',
    choice: 'We are building: a launch path where ordinary laptops can join right away.',
    source: ['PRANA design/compute/cpu-bootstrap.md'],
  },
  {
    id: 'prana-hardware-tiers',
    group: 'chains',
    title: 'An honest map of who can mine, on what',
    desc: 'Instead of overpromising, an honest picture of what each kind of computer can actually do: an '
      + 'ordinary buyable graphics card is the heart of the community (it can do real AI work plus a little '
      + 'mining, and even older cards still fit); bigger multi-card rigs and data-center machines do more; '
      + 'and there is a learning track for hobbyist and experimental hardware. A laptop is described '
      + 'plainly as a light helper, not a powerhouse — no false promises.',
    choice: 'We are building: the pool so every kind of computer can contribute something, honestly '
      + 'described.',
    source: ['PRANA design/compute/hardware-tiers.md'],
  },
  {
    id: 'prana-pool-model',
    group: 'chains',
    title: 'One main pool — but others may run their own',
    desc: 'The coin sends its rewards to one main, can’t-be-cheated community pool that shares them out by '
      + 'rules the community sets. Other people are also allowed to run their own mining pools — on one '
      + 'condition: to collect the AI-work portion, their miners have to actually do our AI work. So the '
      + 'system stays open to anyone, while everyone is still pulling toward the project’s real work.',
    choice: 'We are building: a main shared pool plus optional independent pools; the community sets the '
      + 'split; doing our AI work is required to earn the AI-work share.',
    source: ['.local/PRANA_CHAIN_DESIGN.md §2'],
  },
  {
    id: 'prana-miningcore-fork',
    group: 'chains',
    title: 'One pool program that handles both mining styles',
    desc: 'Rather than running two separate pieces of pool software, we adapt one well-known, free pool '
      + 'program that already understands BOTH mining styles in a single setup: the graphics-card style '
      + 'and the laptop-processor style. It is the helper that gathers everyone’s work and reports it to '
      + 'the blockchain while the system matures.',
    choice: 'We are building: one adapted pool program that handles graphics-card and laptop mining '
      + 'together.',
    source: ['PRANA design/compute/miningcore-fork.md', '.local/MINING_POOL_PLAN.md'],
  },
  // ── platform ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'platform-zero-wif',
    group: 'platform',
    title: 'The keys that move money never live on this computer',
    desc: 'A core safety rule: the secret "password" that can move funds or post as Hathor is never kept '
      + 'on this server or in the code. When something genuinely needs to be signed, the request is sent '
      + 'to a separate, locked-down signing service that holds the key by itself — so even if this machine '
      + 'were broken into, there is no key here to steal.',
    choice: 'We are building: all signing through a separate locked-down signer; this machine never holds '
      + 'a key.',
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
