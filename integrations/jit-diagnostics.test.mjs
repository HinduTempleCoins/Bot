// Tests for jit-diagnostics.mjs — the per-file just-in-time diagnostics (task #224).
// Fully offline: injected readers + injected clock (fixed `now`). No network, no secrets.
//
//   node --test integrations/jit-diagnostics.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JIT_MIN_INTERVAL_MS, BATCH_FRESH_WINDOW_MS, READERS,
  selectReaders, runForFile, shouldFireJIT, annalContext, redactForAi,
} from './jit-diagnostics.mjs';

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-06-04T18:00:00Z');   // fixed clock for every test

// ── selectReaders: per-file relevance ──────────────────────────────────────────────────────────
test('selectReaders: a chain path picks chain readers', () => {
  const ids = selectReaders('witness/hathor.js');
  assert.ok(ids.includes('chain'), 'chain reader selected for a witness/chain file');
  assert.ok(ids.includes('churn'), 'universal churn reader always included');
  assert.ok(!ids.includes('soapbox'), 'soapbox reader NOT selected for a chain file');
});

test('selectReaders: chain readers for src/chain + hathor persona', () => {
  assert.ok(selectReaders('src/chain/graphene.js').includes('chain'));
  assert.ok(selectReaders('integrations/hathor-persona.mjs').includes('chain'));
});

test('selectReaders: a soapbox vertical picks soapbox readers (not chain)', () => {
  const ids = selectReaders('integrations/soapbox/macro.mjs');
  assert.ok(ids.includes('soapbox'), 'soapbox reader selected for a vertical file');
  assert.ok(!ids.includes('chain'), 'chain reader NOT selected for a soapbox file');
});

test('selectReaders: a trade path picks hive-engine + forensics + batch readers', () => {
  const ids = selectReaders('integrations/tradebot-forensics.mjs');
  assert.ok(ids.includes('hiveEngine'), 'HE reader for a trade file');
  assert.ok(ids.includes('forensics'), 'forensics reader for a trade-bot file');
});

test('selectReaders: empty / unknown path still yields the universal churn reader', () => {
  assert.deepEqual(selectReaders(''), ['churn']);
  assert.ok(selectReaders('README.md').includes('churn'));
});

test('selectReaders: corpus path picks the corpus reader', () => {
  assert.ok(selectReaders('knowledge/scripture/the-convergence.md').includes('corpus'));
});

// ── runForFile: fires injected readers + per-reader soft-fail ────────────────────────────────────
test('runForFile fires injected readers and returns one result per selected reader', async () => {
  const calls = [];
  const readers = {
    chain: async (f) => { calls.push(['chain', f]); return { summary: 'account ok', data: { rc: 90 } }; },
    churn: async (f) => { calls.push(['churn', f]); return 'changed 2m ago'; },
  };
  const out = await runForFile('witness/hathor.js', { readers, ids: ['chain', 'churn'], now: NOW });
  assert.equal(out.file, 'witness/hathor.js');
  assert.equal(out.ranAt, new Date(NOW).toISOString());
  assert.equal(out.results.length, 2);
  assert.ok(out.results.every((r) => r.ok), 'both injected readers succeeded');
  assert.equal(out.results.find((r) => r.reader === 'chain').summary, 'account ok');
  assert.equal(out.results.find((r) => r.reader === 'churn').summary, 'changed 2m ago');
  assert.equal(calls.length, 2, 'both readers actually fired');
});

test('runForFile SOFT-FAILS one throwing reader — the others still return', async () => {
  const readers = {
    chain: async () => { throw new Error('rpc down'); },           // throws
    churn: async () => ({ summary: 'changed 5m ago' }),            // fine
    hiveEngine: async () => ({ summary: 'depth ok', data: {} }),   // fine
  };
  const out = await runForFile('integrations/trade-analyzer.mjs', { readers, ids: ['chain', 'churn', 'hiveEngine'], now: NOW });
  const chain = out.results.find((r) => r.reader === 'chain');
  const churn = out.results.find((r) => r.reader === 'churn');
  const he = out.results.find((r) => r.reader === 'hiveEngine');
  assert.equal(chain.ok, false, 'throwing reader marked ok:false');
  assert.match(chain.summary, /rpc down/, 'error message captured in the result');
  assert.equal(churn.ok, true, 'a healthy reader still returned despite the sibling failure');
  assert.equal(he.ok, true, 'second healthy reader still returned');
});

test('runForFile reports a selected-but-not-injected reader as ok:false (no silent drop)', async () => {
  const out = await runForFile('witness/hathor.js', { readers: {}, ids: ['chain'], now: NOW });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].summary, /no reader wired/);
});

test('runForFile: freshVsBatch true when a non-batch reader returns ok', async () => {
  const out = await runForFile('witness/hathor.js', { readers: { chain: async () => 'ok' }, ids: ['chain'], now: NOW });
  assert.equal(out.freshVsBatch, true);
});

// ── shouldFireJIT: per-file rate floor + freshness vs batch ──────────────────────────────────────
test('shouldFireJIT: refuses a refire within the per-file rate floor', () => {
  const d = shouldFireJIT('witness/hathor.js', {
    lastJitAt: NOW - (JIT_MIN_INTERVAL_MS - 5 * 1000),   // 5s short of the floor
    lastBatchAt: null,
    now: NOW,
  });
  assert.equal(d.fire, false, 'too soon since the last JIT → do not refire');
  assert.match(d.reason, /rate-floor/);
});

test('shouldFireJIT: allows a refire once the rate floor has elapsed', () => {
  const d = shouldFireJIT('witness/hathor.js', {
    lastJitAt: NOW - (JIT_MIN_INTERVAL_MS + 5 * 1000),   // just past the floor
    lastBatchAt: null,
    now: NOW,
  });
  assert.equal(d.fire, true, 'past the floor → may fire');
});

test('shouldFireJIT: skips when the 12-and-12 batch is still fresh (JIT redundant)', () => {
  const d = shouldFireJIT('integrations/trade-analyzer.mjs', {
    lastJitAt: null,
    lastBatchAt: NOW - (BATCH_FRESH_WINDOW_MS - 60 * 1000),   // batch was recent
    now: NOW,
  });
  assert.equal(d.fire, false, 'recent batch already covers it → no JIT');
  assert.match(d.reason, /batch is fresh/);
});

test('shouldFireJIT: fires when the batch is stale (JIT is the fresher read)', () => {
  const d = shouldFireJIT('integrations/trade-analyzer.mjs', {
    lastJitAt: null,
    lastBatchAt: NOW - (BATCH_FRESH_WINDOW_MS + 60 * 1000),   // batch is old
    now: NOW,
  });
  assert.equal(d.fire, true);
  assert.match(d.reason, /stale/);
});

test('shouldFireJIT: rate floor takes precedence over batch freshness', () => {
  // Even with a stale batch (which would otherwise fire), a too-recent JIT blocks the refire.
  const d = shouldFireJIT('witness/hathor.js', {
    lastJitAt: NOW - 10 * 1000,                              // 10s ago — inside the floor
    lastBatchAt: NOW - (BATCH_FRESH_WINDOW_MS + 60 * 1000),  // stale batch
    now: NOW,
  });
  assert.equal(d.fire, false);
  assert.match(d.reason, /rate-floor/);
});

// ── annalContext: markdown block combining results ──────────────────────────────────────────────
test('annalContext produces a markdown block combining reader results', async () => {
  const run = {
    file: 'witness/hathor.js',
    ranAt: new Date(NOW).toISOString(),
    ids: ['chain', 'churn'],
    results: [
      { reader: 'chain', ok: true, summary: 'account ok, RC 90%', data: null },
      { reader: 'churn', ok: true, summary: 'changed 2m ago', data: null },
    ],
    freshVsBatch: true,
  };
  const md = await annalContext('witness/hathor.js', { run });
  assert.match(md, /### JIT diagnostics — `witness\/hathor\.js`/);
  assert.match(md, /account ok, RC 90%/);
  assert.match(md, /changed 2m ago/);
  assert.match(md, /Fresher than last batch:\*\* yes/);
  assert.match(md, /jit-diagnostics\.mjs/, 'engine attribution present');
});

test('annalContext runs the file itself when no precomputed run is given', async () => {
  const md = await annalContext('witness/hathor.js', { readers: { chain: async () => 'live read', churn: async () => 'changed now' }, now: NOW });
  assert.match(md, /live read/);
  assert.match(md, /changed now/);
});

// ── redactForAi: strips operator-private fields ─────────────────────────────────────────────────
test('redactForAi strips an operator-private-tagged field by key name', () => {
  const results = [
    { reader: 'chain', ok: true, summary: 'ok', data: { rc: 90, active_key: 'WIF5xxxxx', publicProps: { headBlock: 123 } } },
  ];
  const safe = redactForAi(results);
  assert.equal(safe[0].data.active_key, '[redacted:operator-tier]', 'WIF/active-key redacted');
  assert.equal(safe[0].data.rc, 90, 'non-private field preserved');
  assert.equal(safe[0].data.publicProps.headBlock, 123, 'nested non-private field preserved');
});

test('redactForAi strips a nested object tagged __tier=operator', () => {
  const results = [
    { reader: 'soapbox', ok: true, summary: 'ok', data: { clarity: 71, opDiag: { __tier: 'operator', appPassword: 'abcd efgh ijkl mnop' } } },
  ];
  const safe = redactForAi(results);
  assert.equal(safe[0].data.opDiag, '[redacted:operator-tier]', 'operator-tier object redacted whole');
  assert.equal(safe[0].data.clarity, 71, 'AI-tier field preserved');
});

test('redactForAi is pure — does not mutate the input', () => {
  const results = [{ reader: 'chain', ok: true, summary: 'ok', data: { secret: 'shh', rc: 90 } }];
  const safe = redactForAi(results);
  assert.equal(results[0].data.secret, 'shh', 'original left untouched');
  assert.equal(safe[0].data.secret, '[redacted:operator-tier]', 'copy redacted');
});

test('annalContext never leaks a private field into the rendered block (end-to-end)', async () => {
  const run = {
    file: 'integrations/soapbox/macro.mjs',
    ranAt: new Date(NOW).toISOString(),
    ids: ['soapbox'],
    // a reader carelessly attached an operator-tier token in data — it must not survive to the block.
    results: [{ reader: 'soapbox', ok: true, summary: 'clarity computed', data: { token: 'op-secret-123', clarity: 80 } }],
    freshVsBatch: true,
  };
  const md = await annalContext('integrations/soapbox/macro.mjs', { run });
  assert.ok(!md.includes('op-secret-123'), 'private token must not appear in the AI-tier block');
});

// ── registry sanity ─────────────────────────────────────────────────────────────────────────────
test('READERS registry: every reader has a label + a match fn', () => {
  for (const [id, r] of Object.entries(READERS)) {
    assert.equal(typeof r.label, 'string', `${id} has a label`);
    assert.equal(typeof r.match, 'function', `${id} has a match fn`);
  }
  assert.equal(JIT_MIN_INTERVAL_MS, MINUTE, 'per-file floor is ~1/min');
});
