// kbFlags.test.js — tests for the fact-checker's advisory KB-flag store with a lifecycle (#104, #123).
//
// Run: node test/kbFlags.test.js   (node:test + node:assert/strict, no new deps, no network, no real fs)
//
// HARD invariant under test (load-bearing project rule): the fact-checker FLAGS ONLY and NEVER edits
// knowledge/**. We prove it BY CONSTRUCTION here: the store is driven by an INJECTED fs spy, and we
// assert that across raiseFlag / resolveFlag the spy's ONLY write/append target was the flag store —
// never a kbPath, never anything under knowledge/. Verdicts are fallible; flags are advisory.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createKbFlagStore } from '../src/factChecker/kbFlags.js';

// ── an in-memory fs spy: records every path it is ever asked to write/append to ───────────────────
function makeFsSpy() {
  const files = new Map();          // path → contents
  const writeTargets = [];          // every path passed to appendFileSync/writeFileSync
  const mkdirs = [];
  return {
    spy: {
      mkdirSync(dir) { mkdirs.push(String(dir)); },
      appendFileSync(p, data) {
        writeTargets.push(String(p));
        files.set(String(p), (files.get(String(p)) || '') + String(data));
      },
      writeFileSync(p, data) {       // present for completeness; module should never call it
        writeTargets.push(String(p));
        files.set(String(p), String(data));
      },
      readFileSync(p) {
        const v = files.get(String(p));
        if (v == null) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
        return v;
      },
    },
    files,
    writeTargets,
    mkdirs,
  };
}

// A deterministic clock + id generator so assertions are stable offline.
function makeClock() {
  let t = 0;
  return () => `2026-06-03T00:00:${String(t++).padStart(2, '0')}.000Z`;
}
function makeIdGen() {
  let n = 0;
  return () => `flag_${n++}`;
}

const STORE = '/tmp/fc-kbflags-test/kb-flags.jsonl';   // NOT under knowledge/

function freshStore() {
  const harness = makeFsSpy();
  const store = createKbFlagStore({
    fs: harness.spy,
    storePath: STORE,
    clock: makeClock(),
    idGen: makeIdGen(),
  });
  return { store, ...harness };
}

// ── raiseFlag: stores an OPEN advisory flag and does NOT write to the kbPath ──────────────────────
test('raiseFlag records an open advisory flag and writes ONLY to the flag store (never the kbPath)', () => {
  const { store, writeTargets } = freshStore();
  const kbPath = 'knowledge/cryptocurrency/disputed.json';
  const flag = store.raiseFlag({
    kbPath,
    statement: 'The compound has a magnetic charge.',
    reason: 'not a real chemical property',
    confidence: 0.8,
    suggestedSource: 'https://en.wikipedia.org/wiki/Electric_charge',
  });

  assert.equal(flag.status, 'open');
  assert.equal(flag.advisory, true);
  assert.equal(flag.kbPath, kbPath);
  assert.equal(flag.id, 'flag_0');
  assert.equal(flag.raisedAt, '2026-06-03T00:00:00.000Z');

  // BY CONSTRUCTION: every write target was the store; NONE was the kbPath or anything in knowledge/.
  assert.ok(writeTargets.length >= 1, 'a flag was persisted');
  assert.ok(writeTargets.every((p) => p === STORE), 'only the flag store was written');
  assert.ok(!writeTargets.includes(kbPath), 'the KB source file was never written');
  assert.ok(!writeTargets.some((p) => /knowledge[\\/]/.test(p)), 'nothing under knowledge/ was written');
});

// ── listFlags: filters by status / kbPath / minConfidence ─────────────────────────────────────────
test('listFlags filters by status, kbPath, and minConfidence', () => {
  const { store } = freshStore();
  store.raiseFlag({ kbPath: 'knowledge/a.json', statement: 's-a', confidence: 0.9 });
  store.raiseFlag({ kbPath: 'knowledge/b.json', statement: 's-b', confidence: 0.2 });
  const c = store.raiseFlag({ kbPath: 'knowledge/a.json', statement: 's-c', confidence: 0.5 });
  store.resolveFlag(c.id, { status: 'dismissed' });

  assert.equal(store.listFlags().length, 3, 'all three flags exist in current state');
  assert.equal(store.listFlags({ status: 'open' }).length, 2, 'two still open');
  assert.equal(store.listFlags({ status: 'dismissed' }).length, 1, 'one dismissed');
  assert.equal(store.listFlags({ kbPath: 'knowledge/a.json' }).length, 2, 'two from a.json');
  assert.equal(store.listFlags({ minConfidence: 0.5 }).length, 2, 'confidence >= 0.5');
  assert.equal(store.listFlags({ status: 'open', minConfidence: 0.5 }).length, 1, 'open AND >=0.5');
});

// ── resolveFlag: updates status in the STORE only (append-only; KB untouched) ──────────────────────
test('resolveFlag updates status to reviewed/dismissed in the store only, never the KB', () => {
  const { store, writeTargets } = freshStore();
  const f = store.raiseFlag({ kbPath: 'knowledge/c.json', statement: 's', confidence: 0.6 });
  assert.equal(store.flagStats().open, 1);

  const reviewed = store.resolveFlag(f.id, { status: 'reviewed', note: 'operator checked, looks fine' });
  assert.equal(reviewed.status, 'reviewed');
  assert.equal(reviewed.note, 'operator checked, looks fine');
  assert.equal(store.listFlags({ status: 'open' }).length, 0, 'no longer open');
  assert.equal(store.listFlags({ status: 'reviewed' })[0].id, f.id);

  // invalid status / unknown id → null, no crash
  assert.equal(store.resolveFlag(f.id, { status: 'bogus' }), null);
  assert.equal(store.resolveFlag('does-not-exist', { status: 'reviewed' }), null);

  // append-only + store-only: every write still targeted the store, never knowledge/.
  assert.ok(writeTargets.every((p) => p === STORE));
  assert.ok(!writeTargets.some((p) => /knowledge[\\/]/.test(p)));
});

// ── briefWarnings: ONLY open flags, as warning strings, sorted by confidence DESC ─────────────────
test('briefWarnings returns only open flags, advisory-worded, sorted by confidence', () => {
  const { store } = freshStore();
  store.raiseFlag({ kbPath: 'knowledge/low.json', statement: 'low', reason: 'r-low', confidence: 0.3 });
  store.raiseFlag({ kbPath: 'knowledge/high.json', statement: 'high', reason: 'r-high', confidence: 0.95 });
  const mid = store.raiseFlag({ kbPath: 'knowledge/mid.json', statement: 'mid', reason: 'r-mid', confidence: 0.6 });
  store.resolveFlag(mid.id, { status: 'dismissed' });   // dismissed → must NOT appear

  const lines = store.briefWarnings();
  assert.equal(lines.length, 2, 'only the two OPEN flags');
  assert.ok(lines.every((l) => l.startsWith('⚠ KB statement in')), 'brief-ready warning lines');
  assert.ok(lines.every((l) => /may be inaccurate/.test(l)), 'advisory wording, not assertive');
  assert.ok(lines.every((l) => /advisory — fact-checker verdicts are fallible/.test(l)), 'fallibility disclaimer present');
  // sorted by confidence DESC: high (0.95) before low (0.3)
  assert.ok(lines[0].includes('knowledge/high.json'), 'highest confidence first');
  assert.ok(lines[1].includes('knowledge/low.json'), 'lowest confidence last');
  assert.ok(!lines.some((l) => l.includes('knowledge/mid.json')), 'dismissed flag excluded');
});

// ── flagStats: counts by status ───────────────────────────────────────────────────────────────────
test('flagStats counts flags by status', () => {
  const { store } = freshStore();
  const a = store.raiseFlag({ kbPath: 'knowledge/1.json', statement: '1', confidence: 0.5 });
  store.raiseFlag({ kbPath: 'knowledge/2.json', statement: '2', confidence: 0.5 });
  const c = store.raiseFlag({ kbPath: 'knowledge/3.json', statement: '3', confidence: 0.5 });
  store.resolveFlag(a.id, { status: 'reviewed' });
  store.resolveFlag(c.id, { status: 'dismissed' });

  assert.deepEqual(store.flagStats(), { open: 1, reviewed: 1, dismissed: 1, total: 3 });
});

// ── invariant, by construction: refuse a flag store located under knowledge/ ──────────────────────
test('createKbFlagStore refuses a store path under knowledge/ (never-writes-KB by construction)', () => {
  assert.throws(
    () => createKbFlagStore({ storePath: 'knowledge/factChecker/flags.jsonl' }),
    /never writes to the KB|refusing to use a flag store under knowledge/,
  );
  // a normal store path is accepted and self-asserts clean
  const { store } = freshStore();
  assert.equal(store.assertNeverWritesKb(), true);
});

// ── soft-fail: a failing fs write must not throw out of raiseFlag ─────────────────────────────────
test('raiseFlag soft-fails (returns the flag) when the store write throws', () => {
  const store = createKbFlagStore({
    storePath: '/tmp/fc-kbflags-test/sf.jsonl',
    clock: makeClock(),
    idGen: makeIdGen(),
    fs: {
      mkdirSync() {},
      appendFileSync() { throw new Error('disk full'); },
      readFileSync() { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    },
  });
  let flag;
  assert.doesNotThrow(() => { flag = store.raiseFlag({ kbPath: 'knowledge/x.json', statement: 's', confidence: 0.4 }); });
  assert.equal(flag.status, 'open');
});
