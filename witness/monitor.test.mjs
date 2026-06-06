/**
 * monitor.test.mjs — offline tests for the witness-monitor (task #38).
 *
 * Fully offline: every test injects a fake chain client via __setClient(), so no
 * network call is ever made and no env/keys are required. Run:
 *
 *   node --test witness/monitor.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWitness,
  detectIssues,
  monitorOnce,
  __setClient,
  DEFAULT_THRESHOLDS,
} from './monitor.mjs';

// A fake client factory: returns canned witness + dynamic-global props.
function fakeClient({ witness = {}, gprops = {} } = {}) {
  return async () => ({ witness, gprops });
}

const HEALTHY_KEY = 'MELEK6yourSomeRealLookingPublicKeyMaterialHere1234567';
const NULL_KEY = 'MELEK1111111111111111111111111111111114T1Anm';

test.afterEach(() => __setClient(null));

// ── checkWitness ───────────────────────────────────────────────────────────────
test('checkWitness maps witness + gprops fields into the snapshot', async () => {
  __setClient(fakeClient({
    witness: {
      total_missed: 7,
      last_confirmed_block_num: 1000,
      signing_key: HEALTHY_KEY,
      running_version: '0.1.0',
    },
    gprops: { head_block_number: 1005 },
  }));

  const snap = await checkWitness('hathor');
  assert.equal(snap.account, 'hathor');
  assert.equal(snap.ok, true);
  assert.equal(snap.totalMissed, 7);
  assert.equal(snap.lastConfirmedBlock, 1000);
  assert.equal(snap.headBlock, 1005);
  assert.equal(snap.blocksBehind, 5);
  assert.equal(snap.signingKeyDisabled, false);
  assert.equal(snap.version, '0.1.0');
  assert.equal(typeof snap.ts, 'number');
});

test('checkWitness soft-fails to a safe shape on client error', async () => {
  __setClient(async () => { throw new Error('rpc down'); });
  const snap = await checkWitness('hathor');
  assert.equal(snap.ok, false);
  assert.equal(snap.error, 'rpc down');
  assert.equal(snap.totalMissed, 0);
  assert.equal(snap.blocksBehind, 0);
  assert.equal(snap.signingKeyDisabled, false);
});

test('checkWitness detects a null/empty signing key', async () => {
  __setClient(fakeClient({
    witness: { total_missed: 0, last_confirmed_block_num: 10, signing_key: NULL_KEY },
    gprops: { head_block_number: 10 },
  }));
  const snap = await checkWitness('hathor');
  assert.equal(snap.signingKeyDisabled, true);
});

// ── detectIssues (pure) ─────────────────────────────────────────────────────────
const healthy = (over = {}) => ({
  account: 'hathor', ok: true, totalMissed: 0, lastConfirmedBlock: 1000,
  headBlock: 1002, blocksBehind: 2, signingKeyDisabled: false, version: '0.1.0',
  ts: 1000, ...over,
});

test('detectIssues returns [] on a healthy steady state', () => {
  const prev = healthy({ ts: 0 });
  const cur = healthy();
  assert.deepEqual(detectIssues(cur, prev), []);
});

test('detectIssues flags missed-block when total_missed rises', () => {
  const prev = healthy({ totalMissed: 3, ts: 0 });
  const cur = healthy({ totalMissed: 5 });
  const issues = detectIssues(cur, prev);
  const m = issues.find((i) => i.kind === 'missed-block');
  assert.ok(m, 'expected a missed-block issue');
  assert.equal(m.delta, 2);
  assert.equal(m.totalMissed, 5);
});

test('detectIssues does NOT flag missed-block when total_missed is unchanged', () => {
  const prev = healthy({ totalMissed: 5, ts: 0 });
  const cur = healthy({ totalMissed: 5 });
  assert.equal(detectIssues(cur, prev).some((i) => i.kind === 'missed-block'), false);
});

test('detectIssues flags signing-disabled on a null key', () => {
  const cur = healthy({ signingKeyDisabled: true });
  const issues = detectIssues(cur, healthy({ ts: 0 }));
  assert.ok(issues.some((i) => i.kind === 'signing-disabled'));
});

test('detectIssues flags stalled when blocksBehind exceeds threshold and head moves but confirmed sticks', () => {
  const prev = healthy({ headBlock: 1000, lastConfirmedBlock: 1000, blocksBehind: 0, ts: 0 });
  const cur = healthy({ headBlock: 1100, lastConfirmedBlock: 1000, blocksBehind: 100 });
  const issues = detectIssues(cur, prev);
  const s = issues.find((i) => i.kind === 'stalled');
  assert.ok(s, 'expected a stalled issue');
  assert.equal(s.blocksBehind, 100);
  assert.equal(s.threshold, DEFAULT_THRESHOLDS.blocksBehind);
});

test('detectIssues does NOT flag stalled when blocksBehind is under threshold', () => {
  const prev = healthy({ headBlock: 1000, lastConfirmedBlock: 1000, blocksBehind: 0, ts: 0 });
  const cur = healthy({ headBlock: 1005, lastConfirmedBlock: 1000, blocksBehind: 5 });
  assert.equal(detectIssues(cur, prev).some((i) => i.kind === 'stalled'), false);
});

test('detectIssues flags version-drift when running_version changes', () => {
  const prev = healthy({ version: '0.1.0', ts: 0 });
  const cur = healthy({ version: '0.2.0' });
  assert.ok(detectIssues(cur, prev).some((i) => i.kind === 'version-drift'));
});

test('detectIssues returns [] when current read failed', () => {
  const cur = { account: 'hathor', ok: false, totalMissed: 0, lastConfirmedBlock: 0, headBlock: 0, blocksBehind: 0, signingKeyDisabled: false, version: null, ts: 1 };
  assert.deepEqual(detectIssues(cur, healthy({ ts: 0 })), []);
});

test('detectIssues works with no previous snapshot (first run)', () => {
  const cur = healthy({ signingKeyDisabled: true });
  // first run: no missed-block (no baseline), but signing-disabled still fires
  const issues = detectIssues(cur, null);
  assert.equal(issues.some((i) => i.kind === 'missed-block'), false);
  assert.ok(issues.some((i) => i.kind === 'signing-disabled'));
});

// ── monitorOnce ──────────────────────────────────────────────────────────────────
test('monitorOnce calls the alert hook once per new issue', async () => {
  __setClient(fakeClient({
    witness: { total_missed: 9, last_confirmed_block_num: 1000, signing_key: NULL_KEY, running_version: '0.1.0' },
    gprops: { head_block_number: 1300 },
  }));
  const previous = healthy({ totalMissed: 5, headBlock: 1000, lastConfirmedBlock: 1000, blocksBehind: 0, ts: 0 });

  const fired = [];
  const alert = (issue) => { fired.push(issue.kind); };

  const { snapshot, issues } = await monitorOnce({ account: 'hathor', previous, alert });

  assert.equal(snapshot.ok, true);
  // expect: missed-block (5->9), signing-disabled (null key), stalled (300 behind)
  assert.equal(fired.length, issues.length);
  assert.ok(fired.includes('missed-block'));
  assert.ok(fired.includes('signing-disabled'));
  assert.ok(fired.includes('stalled'));
});

test('monitorOnce fires no alerts on a healthy steady state', async () => {
  __setClient(fakeClient({
    witness: { total_missed: 5, last_confirmed_block_num: 1000, signing_key: HEALTHY_KEY, running_version: '0.1.0' },
    gprops: { head_block_number: 1002 },
  }));
  const previous = healthy({ totalMissed: 5, headBlock: 1000, lastConfirmedBlock: 998, blocksBehind: 2, ts: 0 });

  const fired = [];
  const { issues } = await monitorOnce({ account: 'hathor', previous, alert: (i) => fired.push(i.kind) });
  assert.deepEqual(issues, []);
  assert.equal(fired.length, 0);
});

test('monitorOnce survives a throwing alert hook (soft-fail)', async () => {
  __setClient(fakeClient({
    witness: { total_missed: 9, last_confirmed_block_num: 1000, signing_key: HEALTHY_KEY, running_version: '0.1.0' },
    gprops: { head_block_number: 1002 },
  }));
  const previous = healthy({ totalMissed: 5, ts: 0 });
  const { issues } = await monitorOnce({
    account: 'hathor', previous,
    alert: () => { throw new Error('sink boom'); },
  });
  assert.ok(issues.some((i) => i.kind === 'missed-block'));
});

// ---------------------------------------------------------------------------
// state file persistence (--state, for timer runs) — #289
// ---------------------------------------------------------------------------
import { loadState, saveState } from './monitor.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('saveState/loadState round-trip, atomic, soft-fail', async () => {
  const p = join(tmpdir(), `wm-test-${process.pid}`, 'state.json');
  const snap = { account: 'hathor', ok: true, totalMissed: 52, headBlock: 21734 };
  assert.equal(await saveState(p, snap), true);
  const back = await loadState(p);
  assert.equal(back.totalMissed, 52);
  // soft-fail paths
  assert.equal(await loadState('/nonexistent/nope.json'), null);
  assert.equal(await loadState(null), null);
  assert.equal(await saveState(null, snap), false);
  assert.equal(await saveState(p, null), false);
});
