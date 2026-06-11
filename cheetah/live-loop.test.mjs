// cheetah/live-loop.test.mjs — OFFLINE tests for the generic Cheetah scan loop.
// node --test; no network, no keys, no timers fired for real (timer injected).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeScanLoop,
  esc,
  __setReader,
  __setStore,
  __resetSeams,
} from './live-loop.mjs';

// ── fakes ──────────────────────────────────────────────────────────────────

// a capturing sink (function form)
function capturingSink() {
  const flags = [];
  const fn = (f) => { flags.push(f); };
  fn.flags = flags;
  return fn;
}

// a fake reader returning a fixed set
const fakeReader = (posts) => () => posts.map((p) => ({ ...p }));

// detectors: one that flags posts containing "scam", one that always returns null
const scamDetector = {
  kind: 'scam',
  detect: (t) => /scam/i.test(t) ? { severity: 5, reason: 'mentions scam' } : null,
};
const nullDetector = { kind: 'noop', detect: () => null };

const POSTS = [
  { author: 'alice', permlink: 'p1', body: 'this is a scam, send seed phrase' },
  { author: 'bob', permlink: 'p2', body: 'a wholesome gardening post' },
  { author: 'carol', permlink: 'p3', body: 'another scam here' },
];

// ── happy path ───────────────────────────────────────────────────────────────

test('tick scans posts, runs detectors, routes flags to sink', async () => {
  const sink = capturingSink();
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [scamDetector, nullDetector], sink });
  const r = await loop.tick();

  assert.equal(r.scanned, 3);
  assert.equal(r.fresh, 3);
  assert.equal(r.flags, 2);   // alice + carol
  assert.equal(r.routed, 2);
  assert.equal(r.errors, 0);
  assert.equal(r.readError, null);
  assert.equal(sink.flags.length, 2);
});

test('flags are self-describing: target + reporter + kind attached', async () => {
  const sink = capturingSink();
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [scamDetector], sink });
  await loop.tick();
  const f = sink.flags[0];
  assert.equal(f.kind, 'scam');
  assert.equal(f.target, 'alice/p1');
  assert.equal(f.reporter, 'cheetah:scam');
  assert.equal(f.severity, 5);
  assert.equal(f.reason, 'mentions scam');
});

// ── idempotency (seen-set) ─────────────────────────────────────────────────────

test('idempotent across ticks: same posts are not re-flagged', async () => {
  const sink = capturingSink();
  const reader = fakeReader(POSTS);
  const loop = makeScanLoop({ reader, detectors: [scamDetector], sink });

  const r1 = await loop.tick();
  assert.equal(r1.fresh, 3);
  assert.equal(r1.flags, 2);

  const r2 = await loop.tick(); // identical posts again
  assert.equal(r2.scanned, 3);
  assert.equal(r2.fresh, 0);    // all seen
  assert.equal(r2.flags, 0);
  assert.equal(sink.flags.length, 2); // no new flags
});

test('new posts on a later tick are picked up', async () => {
  const sink = capturingSink();
  let batch = POSTS.slice(0, 2);
  const loop = makeScanLoop({ reader: () => batch.map((p) => ({ ...p })), detectors: [scamDetector], sink });

  await loop.tick();               // alice(scam) + bob → 1 flag
  assert.equal(sink.flags.length, 1);
  batch = POSTS;                   // carol appears
  const r = await loop.tick();
  assert.equal(r.fresh, 1);        // only carol is new
  assert.equal(sink.flags.length, 2);
});

// ── soft-fail edges ────────────────────────────────────────────────────────────

test('reader that throws: tick soft-fails, records readError, does not throw', async () => {
  const sink = capturingSink();
  const loop = makeScanLoop({
    reader: () => { throw new Error('rpc down'); },
    detectors: [scamDetector],
    sink,
  });
  const r = await loop.tick();
  assert.equal(r.readError, 'rpc down');
  assert.equal(r.scanned, 0);
  assert.equal(r.flags, 0);
  assert.equal(sink.flags.length, 0);
});

test('reader returning {error}: surfaced as readError', async () => {
  const sink = capturingSink();
  const loop = makeScanLoop({
    reader: () => Object.assign([], { error: 'empty chain' }),
    detectors: [scamDetector],
    sink,
  });
  const r = await loop.tick();
  assert.equal(r.readError, 'empty chain');
});

test('detector that throws is skipped; other detectors still run', async () => {
  const sink = capturingSink();
  const boom = { kind: 'boom', detect: () => { throw new Error('detector bug'); } };
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [boom, scamDetector], sink });
  const r = await loop.tick();
  assert.equal(r.flags, 2);       // scamDetector still produced its 2
  assert.equal(r.errors, 0);      // a throwing detector is not an error, just skipped
});

test('sink that throws: routing failure counted, loop survives', async () => {
  const badSink = () => { throw new Error('sink full'); };
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [scamDetector], sink: badSink });
  const r = await loop.tick();
  assert.equal(r.flags, 2);
  assert.equal(r.routed, 0);
  assert.equal(r.errors, 2);      // both flags failed to route
});

test('malformed posts (no id) are skipped, counted as errors, not crashed on', async () => {
  const sink = capturingSink();
  const loop = makeScanLoop({
    reader: () => [null, 42, {}, { author: 'd', permlink: 'p4', body: 'scam!' }],
    detectors: [scamDetector],
    sink,
  });
  const r = await loop.tick();
  assert.equal(r.flags, 1);       // only the well-formed post
  assert.ok(r.errors >= 2);       // null + 42 + {} unidentifiable
  assert.equal(sink.flags.length, 1);
});

// ── detector shapes ────────────────────────────────────────────────────────────

test('bare function detector works', async () => {
  const sink = capturingSink();
  const fnDet = (t) => /scam/i.test(t) ? { kind: 'x', reason: 'r' } : null;
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [fnDet], sink });
  const r = await loop.tick();
  assert.equal(r.flags, 2);
});

test('detector returning the {score,signals,flag} envelope is unwrapped', async () => {
  const sink = capturingSink();
  const envDet = {
    kind: 'env',
    detect: (t) => /scam/i.test(t)
      ? { score: 0.7, signals: ['x'], flag: { severity: 3, reason: 'envelope' } }
      : { score: 0, signals: [], flag: null },
  };
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [envDet], sink });
  await loop.tick();
  assert.equal(sink.flags.length, 2);
  assert.equal(sink.flags[0].reason, 'envelope');
  assert.equal(sink.flags[0].severity, 3);
});

test('post text read from body/text/content/message or bare string', async () => {
  const sink = capturingSink();
  const posts = [
    { author: 'a', permlink: '1', text: 'scam via text field' },
    { author: 'b', permlink: '2', content: 'scam via content field' },
    { author: 'c', permlink: '3', message: 'scam via message field' },
  ];
  const loop = makeScanLoop({ reader: () => posts, detectors: [scamDetector], sink });
  const r = await loop.tick();
  assert.equal(r.flags, 3);
});

// ── sink shapes ────────────────────────────────────────────────────────────────

test('sink object with fileFlag() is used', async () => {
  const got = [];
  const sink = { fileFlag: (f) => got.push(f) };
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [scamDetector], sink });
  await loop.tick();
  assert.equal(got.length, 2);
});

test('sink object with push() is used', async () => {
  const arr = [];
  const loop = makeScanLoop({ reader: fakeReader(POSTS), detectors: [scamDetector], sink: arr });
  await loop.tick();
  assert.equal(arr.length, 2);
});

// ── bounding ───────────────────────────────────────────────────────────────────

test('maxPerTick bounds the work per tick', async () => {
  const sink = capturingSink();
  const many = Array.from({ length: 100 }, (_, i) => ({ author: 'a', permlink: `p${i}`, body: 'scam' }));
  const loop = makeScanLoop({ reader: () => many, detectors: [scamDetector], sink, maxPerTick: 10 });
  const r = await loop.tick();
  assert.equal(r.scanned, 10);
  assert.equal(r.flags, 10);
});

test('maxSeen trims the seen-set so it cannot grow unbounded', async () => {
  const sink = capturingSink();
  let i = 0;
  // each tick supplies fresh unique posts
  const reader = () => Array.from({ length: 5 }, () => ({ author: 'a', permlink: `p${i++}`, body: 'ok' }));
  const loop = makeScanLoop({ reader, detectors: [nullDetector], sink, maxSeen: 7 });
  await loop.tick();   // 5 seen
  await loop.tick();   // 10 → trimmed to <= 7
  assert.ok(loop.seenSize() <= 7, `seen=${loop.seenSize()}`);
});

// ── start/stop with injected timers ──────────────────────────────────────────────

test('start/stop are idempotent and use injected timers (no real interval)', async () => {
  const sink = capturingSink();
  let scheduled = null;
  const setTimer = (fn) => { scheduled = fn; return 'handle'; };
  let cleared = null;
  const clearTimer = (h) => { cleared = h; };

  const loop = makeScanLoop({
    reader: fakeReader(POSTS),
    detectors: [scamDetector],
    sink,
    setTimer,
    clearTimer,
  });

  assert.equal(loop.running(), false);
  assert.equal(loop.start(), true);
  assert.equal(loop.running(), true);
  assert.equal(loop.start(), false); // already running — idempotent

  // manually fire the scheduled tick (proves start wired the guarded tick)
  assert.equal(typeof scheduled, 'function');
  await scheduled();
  assert.equal(sink.flags.length, 2);

  assert.equal(loop.stop(), true);
  assert.equal(cleared, 'handle');
  assert.equal(loop.running(), false);
  assert.equal(loop.stop(), false); // already stopped — idempotent
});

// ── onTick callback ──────────────────────────────────────────────────────────────

test('onTick callback receives the summary; a throwing onTick does not break the tick', async () => {
  const seen = [];
  const loop = makeScanLoop({
    reader: fakeReader(POSTS),
    detectors: [scamDetector],
    sink: capturingSink(),
    onTick: (s) => { seen.push(s); throw new Error('callback bug'); },
  });
  const r = await loop.tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].flags, 2);
  assert.equal(r.flags, 2); // tick still returned cleanly
});

// ── empty / no-config ──────────────────────────────────────────────────────────

test('no reader: tick soft-fails with readError, no throw', async () => {
  const loop = makeScanLoop({ detectors: [scamDetector], sink: capturingSink() });
  const r = await loop.tick();
  assert.equal(r.scanned, 0);
  assert.ok(r.readError);
});

test('no detectors: scans but produces no flags', async () => {
  const sink = capturingSink();
  const loop = makeScanLoop({ reader: fakeReader(POSTS), sink });
  const r = await loop.tick();
  assert.equal(r.scanned, 3);
  assert.equal(r.flags, 0);
});

// ── module seams ─────────────────────────────────────────────────────────────────

test('__setReader / __setStore module fallbacks are used when options omitted', async () => {
  const arr = [];
  __setReader(fakeReader(POSTS));
  __setStore(arr);
  try {
    const loop = makeScanLoop({ detectors: [scamDetector] });
    const r = await loop.tick();
    assert.equal(r.flags, 2);
    assert.equal(arr.length, 2);
  } finally {
    __resetSeams();
  }
});

// ── esc() ──────────────────────────────────────────────────────────────────────

test('esc() escapes HTML metacharacters and handles null', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
