// lotto-keeper.test.mjs — OFFLINE. No chain, no keys, injected contract + fs.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  decide, tick, newSalt, loadState, saveState, clearState,
  REVEAL_AFTER_BLOCKS, SAFE_WINDOW_BLOCKS,
} from './lotto-keeper.mjs';

/** in-memory filesystem — PATH-AWARE, because the salt file and the cadence-marks file are
 *  different paths and a single-slot fake makes them collide. */
function memFs() {
  const files = {};
  return {
    files,
    fs: {
      read: (p) => (p in files ? files[p] : null),
      write: (p, s) => { files[p] = s; },
      remove: (p) => { delete files[p]; },
    },
  };
}
/** a fake NoLossLotto */
function fakeLotto({ commitBlock = 0, totalDeposits = 250n * 10n ** 18n, prizePool = 15680n * 10n ** 18n, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    drawCommit: async () => [BigInt(commitBlock), '0x' + '11'.repeat(32)],
    totalDeposits: async () => totalDeposits,
    prizePool: async () => prizePool,
    depositorCount: async () => 1n,
    saltHashOf: async (s) => '0x' + 'ab'.repeat(32),
    commitDraw: async (h) => { if (fail === 'commit') throw new Error('boom'); calls.push(['commitDraw', h]); return { hash: '0xcommit' }; },
    revealDraw: async (s) => { if (fail === 'reveal') throw new Error('TooEarly'); calls.push(['revealDraw', s]); return { hash: '0xreveal' }; },
    clearExpiredDraw: async () => { calls.push(['clearExpiredDraw']); return { hash: '0xclear' }; },
  };
}
const prov = (n) => ({ getBlockNumber: async () => n });

test('a salt is 32 random bytes as 0x-hex, and differs each time', () => {
  const a = newSalt(), b = newSalt();
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test('no open commit, deposits and pot present -> commit', () => {
  const d = decide({ commitBlock: 0, blockNumber: 1000, totalDeposits: 1n, prizePool: 1n });
  assert.equal(d.action, 'commit');
});

test('nothing to draw when there are no deposits or no pot — a commit would revert', () => {
  assert.equal(decide({ commitBlock: 0, blockNumber: 10, totalDeposits: 0n, prizePool: 5n }).action, 'nothing-to-draw');
  assert.equal(decide({ commitBlock: 0, blockNumber: 10, totalDeposits: 5n, prizePool: 0n }).action, 'nothing-to-draw');
});

test('commit open but too fresh -> wait, not a failed reveal', () => {
  const d = decide({ commitBlock: 1000, blockNumber: 1001, haveSalt: true, totalDeposits: 1n, prizePool: 1n });
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /need 3/);
});

test('commit open and ripe -> reveal', () => {
  const d = decide({ commitBlock: 1000, blockNumber: 1000 + REVEAL_AFTER_BLOCKS, haveSalt: true, totalDeposits: 1n, prizePool: 1n });
  assert.equal(d.action, 'reveal');
});

test('commit past the safe window -> clear, never a doomed reveal', () => {
  const d = decide({ commitBlock: 1000, blockNumber: 1000 + SAFE_WINDOW_BLOCKS + 1, haveSalt: true, totalDeposits: 1n, prizePool: 1n });
  assert.equal(d.action, 'clear');
  assert.match(d.reason, /unrevealable/);
});

test('⚠ commit open but the salt is LOST -> clear and start over, not a stuck keeper', () => {
  const d = decide({ commitBlock: 1000, blockNumber: 1010, haveSalt: false, totalDeposits: 1n, prizePool: 1n });
  assert.equal(d.action, 'clear');
  assert.match(d.reason, /salt is lost/);
});

test('tick commits and persists the salt for the later reveal', async () => {
  const m = memFs();
  const c = fakeLotto({ commitBlock: 0 });
  const r = await tick({ contract: c, provider: prov(5000), fs: m.fs, file: 'x' });
  assert.equal(r.ok, true);
  assert.equal(r.action, 'commit');
  assert.equal(c.calls[0][0], 'commitDraw');
  const st = loadState({ fs: m.fs, file: 'x' });
  assert.match(st.salt, /^0x[0-9a-f]{64}$/, 'salt survives for the reveal');
});

test('tick reveals with the persisted salt and then forgets it', async () => {
  const m = memFs();
  saveState({ salt: '0x' + 'cd'.repeat(32), committedAt: 1000 }, { fs: m.fs, file: 'x' });
  const c = fakeLotto({ commitBlock: 1000 });
  const r = await tick({ contract: c, provider: prov(1000 + REVEAL_AFTER_BLOCKS), fs: m.fs, file: 'x' });
  assert.equal(r.action, 'reveal');
  assert.equal(c.calls[0][1], '0x' + 'cd'.repeat(32));
  assert.equal(loadState({ fs: m.fs, file: 'x' }), null, 'salt deleted after reveal');
});

test('a reveal that reverts leaves the salt in place so the next tick can retry', async () => {
  const m = memFs();
  saveState({ salt: '0x' + 'ef'.repeat(32), committedAt: 1000 }, { fs: m.fs, file: 'x' });
  const c = fakeLotto({ commitBlock: 1000, fail: 'reveal' });
  const r = await tick({ contract: c, provider: prov(1010), fs: m.fs, file: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /reveal failed/);
  assert.ok(loadState({ fs: m.fs, file: 'x' }), 'salt NOT discarded on a failed reveal');
});

test('an expired commit is cleared and the stale salt dropped', async () => {
  const m = memFs();
  saveState({ salt: '0x' + '01'.repeat(32), committedAt: 1000 }, { fs: m.fs, file: 'x' });
  const c = fakeLotto({ commitBlock: 1000 });
  const r = await tick({ contract: c, provider: prov(1000 + SAFE_WINDOW_BLOCKS + 5), fs: m.fs, file: 'x' });
  assert.equal(r.action, 'clear');
  assert.equal(loadState({ fs: m.fs, file: 'x' }), null);
});

test('an empty pot is reported, not committed against', async () => {
  const m = memFs();
  const c = fakeLotto({ commitBlock: 0, prizePool: 0n });
  const r = await tick({ contract: c, provider: prov(10), fs: m.fs, file: 'x' });
  assert.equal(r.action, 'nothing-to-draw');
  assert.equal(c.calls.length, 0, 'no transaction sent');
});

test('a dead RPC soft-fails rather than throwing', async () => {
  const bad = { drawCommit: async () => { throw new Error('ECONNREFUSED'); } };
  const r = await tick({ contract: bad, provider: prov(1) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /read failed/);
});

test('missing contract or provider is refused, not thrown', async () => {
  assert.equal((await tick({})).ok, false);
  assert.equal((await tick({ contract: fakeLotto() })).ok, false);
});

// ── cadence: twice a week ─────────────────────────────────────────────────────────────────────────
import { loadMarks, saveMarks, DRAW_INTERVAL_MS } from './lotto-keeper.mjs';

test('the interval is twice a week', () => {
  assert.equal(DRAW_INTERVAL_MS, 3.5 * 24 * 60 * 60 * 1000);
});

test('a draw that just happened is NOT due again — the timer can tick freely', () => {
  const d = decide({ commitBlock: 0, blockNumber: 10, totalDeposits: 1n, prizePool: 1n,
                     lastDrawAt: 1_000_000, now: 1_000_000 + 3600_000 });
  assert.equal(d.action, 'not-due');
  assert.match(d.reason, /next in ~/);
});

test('once the interval has passed it commits again', () => {
  const d = decide({ commitBlock: 0, blockNumber: 10, totalDeposits: 1n, prizePool: 1n,
                     lastDrawAt: 1_000_000, now: 1_000_000 + DRAW_INTERVAL_MS + 1 });
  assert.equal(d.action, 'commit');
});

test('the first ever draw is due immediately', () => {
  const d = decide({ commitBlock: 0, blockNumber: 10, totalDeposits: 1n, prizePool: 1n, lastDrawAt: 0 });
  assert.equal(d.action, 'commit');
});

test('⚠ clearing the secret salt must NOT wipe the cadence record', () => {
  const box = { files: {} };
  const fs = { read: (p) => box.files[p] ?? null, write: (p, s) => { box.files[p] = s; }, remove: (p) => { delete box.files[p]; } };
  const o = { fs, file: 'st' };
  saveState({ salt: '0x' + '22'.repeat(32) }, o);
  saveMarks({ lastDrawAt: 12345 }, o);
  clearState(o);
  assert.equal(loadState(o), null, 'salt gone');
  assert.equal(loadMarks(o).lastDrawAt, 12345, 'cadence survives — else it would redraw at once');
});

// ── the key source: the path the other tests never touch ──────────────────────────────────────────
import { keySourceCheck, KEY_CMD } from './lotto-keeper.mjs';

test('⚠ a key source that resolves nothing is reported, not assumed to work', () => {
  // the live failure: LOTTO_KEY_CMD defaulted to a vault entry that does not exist, and every other
  // test in this file injects a fake contract, so the suite was green over a keeper that could not sign
  const r = keySourceCheck({ exec: () => 'ERROR: no such item\n' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /produced no private key/);
});

test('a key source that throws is caught, and the key never appears in the verdict', () => {
  const r = keySourceCheck({ exec: () => { throw new Error('vault locked'); } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /vault locked/);
});

test('a working key source verifies WITHOUT echoing the key', () => {
  const secret = '0x' + 'ab'.repeat(32);
  const r = keySourceCheck({ exec: () => `privateKey ${secret}\n` });
  assert.equal(r.ok, true);
  const blob = JSON.stringify(r);
  assert.doesNotMatch(blob, /abababab/, 'the key must not leak into the verdict');
  assert.ok(!blob.includes(secret));
});

test('no executor is a refusal rather than a crash', () => {
  assert.equal(keySourceCheck({}).ok, false);
  assert.equal(keySourceCheck().ok, false);
});

test('the key command is one named thing, overridable by env', () => {
  assert.match(KEY_CMD(), /vault|LOTTO|key/i);
});
