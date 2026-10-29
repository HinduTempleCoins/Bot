// lotto-keeper.mjs — the schedule the NoLossLotto never had.
//
// The contract has no timer. A prize is paid ONLY when a DRAW_ROLE holder runs two transactions:
//
//   commitDraw(keccak256(salt))   — opens a draw, binds it to the current block
//   revealDraw(salt)              — ≥2 and ≤256 blocks later; picks a winner weighted by deposit
//                                   size and pays the WHOLE prizePool, then zeroes it
//
// Without something calling those, the pot sits and nobody can win it — which is what was
// happening. This keeper is that something. Twice a week (operator, 2026-10-28).
//
// WHY THE SALT IS PERSISTED: the two calls are separate transactions minutes apart, and the salt
// must stay secret in between (that is what stops the drawer grinding the winner) but must survive
// to the reveal. So it is written to a local state file, 0600, and deleted the moment the reveal
// lands. If the process dies between commit and reveal, the next run reads the state and reveals;
// if the 256-block window has passed it clears the stale commit and starts over, and no prize is
// lost — prizePool is only zeroed inside a successful reveal.
//
// Holds no key of its own: an injected signer does the signing (on the box, the DRAW_ROLE key is
// fetched JIT from the vault and never written to disk).
//
// House style: ESM, injectable everything, soft-fail-never-throw, CLI guarded by argv[1].

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const LOTTO_ADDRESS = () => env('KULA_LOTTO_ADDRESS', '0xfE5CC3c2919c893a33690bf6b36d58Ae5A989dB3');
export const STATE_FILE = () => env('LOTTO_KEEPER_STATE', join(process.cwd(), 'data', 'lotto-keeper.json'));
/** Reveal is legal from commitBlock+2; we wait a little past that for reorg comfort. */
export const REVEAL_AFTER_BLOCKS = 3;
/** blockhash() only reaches back 256 blocks — past that the commit is dead. Leave margin. */
export const WINDOW_BLOCKS = 256;
export const SAFE_WINDOW_BLOCKS = 200;
/** Twice a week (operator, 2026-10-28). The timer ticks often to carry commit->reveal; a NEW draw
 *  only opens once this much time has passed since the last one landed. */
export const DRAW_INTERVAL_MS = Number(env('LOTTO_DRAW_INTERVAL_MS', String(3.5 * 24 * 60 * 60 * 1000)));

/** The command that yields the DRAW_ROLE key. NOT a default that is assumed to work: `--check` below
 *  verifies it actually resolves, because the keeper's tests inject a fake contract and never touch
 *  this path — so a green suite says nothing about whether the live run can sign. */
export const KEY_CMD = () => env('LOTTO_KEY_CMD', 'node /opt/melek-bot/vault.mjs get prana-mainnet-deployer');

/**
 * Does the configured key source actually produce a key? Returns a verdict ONLY — never the key,
 * never a fragment of it, never its length beyond a boolean.
 */
export function keySourceCheck({ exec } = {}) {
  const cmd = KEY_CMD();
  if (!exec) return { ok: false, cmd, reason: 'no executor supplied' };
  let raw = '';
  try { raw = String(exec(cmd) || ''); }
  catch (e) { return { ok: false, cmd, reason: `key source failed: ${String(e.message || e).slice(0, 120)}` }; }
  const found = /0x[0-9a-fA-F]{64}/.test(raw) || /"privateKey"\s*:\s*"/.test(raw);
  return found
    ? { ok: true, cmd, reason: 'key source resolved' }
    : { ok: false, cmd, reason: 'key source ran but produced no private key — check the entry name exists' };
}

export const ABI = [
  'function commitDraw(bytes32 saltHash)',
  'function revealDraw(bytes32 salt) returns (address)',
  'function clearExpiredDraw()',
  'function saltHashOf(bytes32 salt) view returns (bytes32)',
  'function drawCommit() view returns (uint256 commitBlock, bytes32 saltHash)',
  'function totalDeposits() view returns (uint256)',
  'function prizePool() view returns (uint256)',
  'function depositorCount() view returns (uint256)',
];

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s, { mode: 0o600 }); },
  remove: (p) => { try { unlinkSync(p); } catch {} },
};

const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || STATE_FILE() });

export function loadState(opts = {}) {
  const { fs, file } = ctx(opts);
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return null;
  try { const o = JSON.parse(raw); return o && o.salt ? o : null; } catch { return null; }
}
export function saveState(state, opts = {}) {
  const { fs, file } = ctx(opts);
  try { (fs.write || realFs.write)(file, JSON.stringify(state)); return true; } catch { return false; }
}
/** Draw history lives in a SEPARATE file: clearState() deletes the secret salt, and must not
 *  also wipe the cadence record, or the keeper would draw again immediately. */
const marksFile = (opts = {}) => (opts.marksFile || (ctx(opts).file + '.marks'));
export function loadMarks(opts = {}) {
  const { fs } = ctx(opts);
  const raw = (fs.read || realFs.read)(marksFile(opts));
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}
export function saveMarks(m, opts = {}) {
  const { fs } = ctx(opts);
  try { (fs.write || realFs.write)(marksFile(opts), JSON.stringify(m)); return true; } catch { return false; }
}

export function clearState(opts = {}) {
  const { fs, file } = ctx(opts);
  (fs.remove || realFs.remove)(file);
}

/** A fresh 32-byte salt as 0x-hex. Secret until reveal. */
export function newSalt(rand = randomBytes) {
  return '0x' + Buffer.from(rand(32)).toString('hex');
}

/**
 * Decide what this run should do. PURE — no chain, no disk.
 * @returns {{action:'commit'|'reveal'|'wait'|'clear'|'nothing-to-draw'|'not-due', reason:string}}
 */
export function decide({ commitBlock = 0, blockNumber = 0, totalDeposits = 0n, prizePool = 0n, haveSalt = false,
                         lastDrawAt = 0, now = Date.now(), intervalMs = DRAW_INTERVAL_MS } = {}) {
  const cb = Number(commitBlock); const bn = Number(blockNumber);
  const dep = BigInt(totalDeposits || 0); const pot = BigInt(prizePool || 0);

  if (cb === 0) {
    if (dep === 0n) return { action: 'nothing-to-draw', reason: 'no deposits — a draw would revert' };
    if (pot === 0n) return { action: 'nothing-to-draw', reason: 'prize pool is empty' };
    const since = Number(now) - Number(lastDrawAt || 0);
    if (lastDrawAt && since < intervalMs) {
      const hrs = Math.round((intervalMs - since) / 3600000);
      return { action: 'not-due', reason: `last draw was ${Math.round(since / 3600000)}h ago; next in ~${hrs}h` };
    }
    return { action: 'commit', reason: 'draw is due; deposits and pot both present' };
  }
  // a commit is open
  const age = bn - cb;
  if (age > SAFE_WINDOW_BLOCKS) {
    return { action: 'clear', reason: `commit is ${age} blocks old (window ${WINDOW_BLOCKS}) — unrevealable` };
  }
  if (!haveSalt) {
    return { action: 'clear', reason: 'commit open but the salt is lost — cannot reveal, clear and retry' };
  }
  if (age < REVEAL_AFTER_BLOCKS) {
    return { action: 'wait', reason: `only ${age} block(s) since commit; need ${REVEAL_AFTER_BLOCKS}` };
  }
  return { action: 'reveal', reason: `commit is ${age} blocks old — inside the window` };
}

/**
 * Run one keeper tick against an injected contract.
 * `contract` needs the ABI methods above; `provider.getBlockNumber()` supplies the height.
 * Never throws — returns what happened.
 */
export async function tick({ contract, provider, rand, ...opts } = {}) {
  if (!contract || !provider) return { ok: false, reason: 'contract and provider required' };
  let commitBlock = 0; let totalDeposits = 0n; let prizePool = 0n; let blockNumber = 0;
  try {
    const dc = await contract.drawCommit();
    commitBlock = Number(dc[0] ?? dc.commitBlock ?? 0);
    totalDeposits = BigInt(await contract.totalDeposits());
    prizePool = BigInt(await contract.prizePool());
    blockNumber = Number(await provider.getBlockNumber());
  } catch (e) {
    return { ok: false, reason: `read failed: ${String(e.message || e).slice(0, 120)}` };
  }

  const st = loadState(opts);
  const marks = loadMarks(opts);
  const d = decide({
    commitBlock, blockNumber, totalDeposits, prizePool,
    haveSalt: !!(st && st.salt),
    lastDrawAt: marks.lastDrawAt || 0,
    now: opts.now || Date.now(),
    intervalMs: opts.intervalMs || DRAW_INTERVAL_MS,
  });

  try {
    if (d.action === 'commit') {
      const salt = newSalt(rand);
      const saltHash = await contract.saltHashOf(salt);
      saveState({ salt, saltHash, committedAt: blockNumber, at: new Date().toISOString() }, opts);
      const tx = await contract.commitDraw(saltHash);
      return { ok: true, action: 'commit', tx: tx.hash || String(tx), prizePool: prizePool.toString(), ...d };
    }
    if (d.action === 'reveal') {
      const tx = await contract.revealDraw(st.salt);
      clearState(opts);
      saveMarks({ ...marks, lastDrawAt: opts.now || Date.now() }, opts);
      return { ok: true, action: 'reveal', tx: tx.hash || String(tx), prizePool: prizePool.toString(), ...d };
    }
    if (d.action === 'clear') {
      const tx = await contract.clearExpiredDraw();
      clearState(opts);
      return { ok: true, action: 'clear', tx: tx.hash || String(tx), ...d };
    }
    return { ok: true, action: d.action, reason: d.reason, prizePool: prizePool.toString(), depositors: Number(await contract.depositorCount().catch(() => 0)) };
  } catch (e) {
    return { ok: false, action: d.action, reason: `${d.action} failed: ${String(e.message || e).slice(0, 140)}` };
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && /lotto-keeper\.mjs$/.test(process.argv[1])) {
  const DRY = process.argv.includes('--dry');
  const { ethers } = await import('ethers');
  const rpc = env('PRANA_RPC_URL_MAINNET', 'https://rpc.prana.melek.salon');
  const provider = new ethers.JsonRpcProvider(rpc);
  const addr = LOTTO_ADDRESS();

  if (process.argv.includes('--check')) {
    const { execSync } = await import('node:child_process');
    const r = keySourceCheck({ exec: (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) });
    console.log(`key source : ${r.cmd}`);
    console.log(`resolves   : ${r.ok ? 'YES' : 'NO'} — ${r.reason}`);
    if (!r.ok) console.log('\nThe keeper will exit 1 on every live run until this resolves.\n'
      + 'Set LOTTO_KEY_CMD to a command that prints the DRAW_ROLE key.');
    process.exit(r.ok ? 0 : 1);
  }

  if (DRY) {
    const ro = new ethers.Contract(addr, ABI, provider);
    const [dc, dep, pot, n, bn] = await Promise.all([
      ro.drawCommit(), ro.totalDeposits(), ro.prizePool(), ro.depositorCount(), provider.getBlockNumber(),
    ]);
    const mk = loadMarks();
    const d = decide({ commitBlock: Number(dc[0]), blockNumber: bn, totalDeposits: dep, prizePool: pot,
                       haveSalt: !!loadState(), lastDrawAt: mk.lastDrawAt || 0 });
    console.log(`lotto        : ${addr}`);
    console.log(`block        : ${bn}`);
    console.log(`depositors   : ${n}`);
    console.log(`totalDeposits: ${ethers.formatUnits(dep, 18)} KULA`);
    console.log(`prizePool    : ${ethers.formatUnits(pot, 18)} KULA`);
    console.log(`open commit  : ${Number(dc[0]) === 0 ? 'none' : `block ${dc[0]}`}`);
    console.log(`salt on disk : ${loadState() ? 'yes' : 'no'}`);
    console.log(`last draw    : ${loadMarks().lastDrawAt ? new Date(loadMarks().lastDrawAt).toISOString() : 'never'}`);
    console.log(`cadence      : every ${(DRAW_INTERVAL_MS / 3600000).toFixed(0)}h (2x per week)`);
    console.log(`\nwould: ${d.action.toUpperCase()} — ${d.reason}`);
    process.exit(0);
  }

  // live: DRAW_ROLE key JIT from the vault, never written to disk, never printed
  const { execSync } = await import('node:child_process');
  let pk = null;
  try {
    const raw = execSync(KEY_CMD(), { encoding: 'utf8' });
    const m = raw.match(/0x[0-9a-fA-F]{64}/) || raw.match(/"privateKey"\s*:\s*"([^"]+)"/);
    pk = m ? (m[1] || m[0]) : null;
  } catch (e) { console.log(`key source failed (${KEY_CMD()}):`, String(e.message).slice(0, 100)); process.exit(1); }
  if (!pk) { console.log(`no DRAW_ROLE private key from: ${KEY_CMD()}\nRun with --check to verify the key source before installing a timer.`); process.exit(1); }

  const contract = new ethers.Contract(addr, ABI, new ethers.Wallet(pk, provider));
  const r = await tick({ contract, provider });
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
