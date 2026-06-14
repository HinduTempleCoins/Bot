// signal-orchestrator.test.mjs — OFFLINE tests for the fused trade-signal feed. Every input is passed
// directly to buildSignalFeed() (the pure core) or injected via __setLive() — NO network, ever.
// We assert the disciplined-not-broken rule: traps are REJECTED (never ACT), genuine multi-source arb
// is ACT, the same opportunity from two scanners dedupes, and garbage soft-fails to a valid empty feed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignalFeed, liveSignalFeed, handler, REJECT_FLAGS, __setLive,
} from './signal-orchestrator.mjs';

// find a signal by the symbol it normalized to (helper).
const bySym = (feed, sym) => feed.signals.find((s) => s.symbol === sym);

test('phantom wall (>1000× median) is REJECTED, never ACT (the SWAP.ETH "501% edge" trap)', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'BUY SWAP.ETH on HE', side: 'buy', netEdgePct: 501, execHive: 100, raw: { sym: 'SWAP.ETH', realUsd: 3000 } }] },
    // a wall 9.9M× the side median — fake liquidity manufacturing the headline edge.
    walls: { 'SWAP.ETH': { buyWalls: [], sellWalls: [{ price: 1, size: 9_900_000, x: 9_900_000, phantom: true }], hasPhantom: true } },
  });
  const sig = signals.find((s) => s.symbol === 'SWAP.ETH');
  assert.ok(sig, 'SWAP.ETH signal present (kept for transparency, not silently dropped)');
  assert.equal(sig.verdict, 'REJECT');
  assert.ok(sig.flags.includes('phantom-wall'), 'flagged phantom-wall');
});

test('a 501% edge is REJECTED as implausible even with no wall context (no corroborating confidence)', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'SWAP.ETH', side: 'buy', netEdgePct: 501, execHive: 100, raw: { sym: 'SWAP.ETH', realUsd: 3000 } }] },
    // no walls, no oracle confidence → an enormous edge is implausible on its face.
  });
  const sig = signals.find((s) => s.symbol === 'SWAP.ETH');
  assert.equal(sig.verdict, 'REJECT');
  assert.ok(sig.flags.includes('implausible-edge'), 'flagged implausible-edge');
});

test('an UNVERIFIED cross-chain spread is REJECTED, never ACT (the phantom 43% ETH spread)', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [
      { source: 'crosschain', market: 'ETH', side: 'buy', netEdgePct: 43.1, feesApplied: false, raw: { verified: false, buyOn: 'polkadot/hydration', sellOn: 'solana/raydium' } },
      { source: 'crosschain', market: 'XYZ', side: 'buy', netEdgePct: 4.0, feesApplied: false, raw: { verified: true } },
    ] },
  });
  const eth = signals.find((s) => s.symbol === 'ETH');
  assert.ok(eth.flags.includes('unverified-arb'), 'unverified crosschain flagged');
  assert.equal(eth.verdict, 'REJECT', 'unverified crosschain never ACT');
  const xyz = signals.find((s) => s.symbol === 'XYZ');
  assert.ok(!xyz.flags.includes('unverified-arb'), 'verified crosschain not flagged unverified');
});

test('issuer-concentrated / illiquid token (VKBT/CURE) is REJECTED', () => {
  const { signals } = buildSignalFeed({
    extra: [
      { source: 'x', market: 'VKBT', symbol: 'VKBT', side: 'buy', edgePct: 8 },
      { source: 'x', market: 'CURE', symbol: 'CURE', side: 'buy', edgePct: 6 },
    ],
    ownership: {
      VKBT: { issuerPct: 92, outsideHolders: 3 },   // 92% issuer-held — self-trading mirage
      CURE: { issuerPct: 10, outsideHolders: 2 },    // few outside holders — illiquid
    },
  });
  const vkbt = bySym({ signals }, 'VKBT');
  const cure = bySym({ signals }, 'CURE');
  assert.equal(vkbt.verdict, 'REJECT');
  assert.ok(vkbt.flags.includes('issuer-concentrated'));
  assert.equal(cure.verdict, 'REJECT', 'few outside holders → illiquid → reject');
  assert.ok(cure.flags.includes('issuer-concentrated'));
});

test('one-way-bleed pair (SWAP.LTC, the −6,424 drain) is REJECTED — never accumulate', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'BUY SWAP.LTC on HE', side: 'buy', netEdgePct: 7, execHive: 80, raw: { sym: 'SWAP.LTC', realUsd: 70 } }] },
    oneWayBleed: ['SWAP.LTC'],
  });
  const sig = bySym({ signals }, 'SWAP.LTC');
  assert.equal(sig.verdict, 'REJECT');
  assert.ok(sig.flags.includes('one-way-bleed'));
});

test('edge that vanishes at realistic fill size (thin executable depth) is REJECTED', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'SWAP.DOGE', side: 'buy', netEdgePct: 9, execHive: 1, raw: { sym: 'SWAP.DOGE', realUsd: 0.1 } }] },
  });
  const sig = bySym({ signals }, 'SWAP.DOGE');
  assert.equal(sig.verdict, 'REJECT');
  assert.ok(sig.flags.includes('edge-vanishes'));
});

test('genuine small multi-source arb = ACT (clean book, real depth, two scanners agree)', () => {
  const { signals, counts } = buildSignalFeed({
    // arb-facade and trade-analyzer BOTH surface the SAME SWAP.DOGE buy edge — the proven family.
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'BUY SWAP.DOGE on HE', side: 'buy', netEdgePct: 4.2, execHive: 120, raw: { sym: 'SWAP.DOGE', realUsd: 0.085 } }] },
    analyzer: { liveArb: [{ signal: 'BUY SWAP.DOGE on HE', sym: 'SWAP.DOGE', side: 'buy', edgePct: 4.0, realUsd: 0.085 }] },
    walls: { 'SWAP.DOGE': { buyWalls: [], sellWalls: [{ price: 0.012, size: 5000, x: 6 }], hasPhantom: false } }, // a real, non-phantom wall
    ownership: { 'SWAP.DOGE': { issuerPct: 1, outsideHolders: 5000 } },
    prices: { 'SWAP.DOGE': { confident: true, sources: 4 } },
  });
  const sig = bySym({ signals }, 'SWAP.DOGE');
  assert.ok(sig, 'SWAP.DOGE present');
  assert.equal(sig.verdict, 'ACT');
  assert.deepEqual(sig.flags, [], 'no trap flags on a genuine edge');
  assert.equal(counts.ACT, 1);
  assert.equal(counts.REJECT, 0);
});

test('dedup: the same opportunity from two scanners collapses to ONE signal', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'BUY SWAP.DOGE on HE', side: 'buy', netEdgePct: 4.2, execHive: 120, raw: { sym: 'SWAP.DOGE', realUsd: 0.085 } }] },
    analyzer: { liveArb: [{ signal: 'BUY SWAP.DOGE on HE', sym: 'SWAP.DOGE', side: 'buy', edgePct: 4.0, realUsd: 0.085 }] },
  });
  const doge = signals.filter((s) => s.symbol === 'SWAP.DOGE' && s.side === 'buy');
  assert.equal(doge.length, 1, 'one SWAP.DOGE buy signal, not two');
  assert.ok(Array.isArray(doge[0].alsoReportedBy) && doge[0].alsoReportedBy.length >= 1, 'dedup is auditable: alsoReportedBy lists the folded source');
});

test('ACT/WATCH ranked above REJECT, and by realistic edge × confidence within tier', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [
      { source: 'arb-scanner', market: 'SWAP.DOGE', side: 'buy', netEdgePct: 4, execHive: 120, raw: { sym: 'SWAP.DOGE', realUsd: 0.085 } },
      { source: 'arb-scanner', market: 'SWAP.BLURT', side: 'buy', netEdgePct: 9, execHive: 200, raw: { sym: 'SWAP.BLURT', realUsd: 0.01 } },
      { source: 'arb-scanner', market: 'SWAP.LTC', side: 'buy', netEdgePct: 12, execHive: 200, raw: { sym: 'SWAP.LTC', realUsd: 70 } },
    ] },
    oneWayBleed: ['SWAP.LTC'],
    prices: { 'SWAP.DOGE': { confident: true }, 'SWAP.BLURT': { confident: true } },
  });
  // SWAP.LTC (bigger edge) is a trap → must rank LAST despite the largest headline edge.
  assert.equal(signals[signals.length - 1].symbol, 'SWAP.LTC');
  assert.equal(signals[signals.length - 1].verdict, 'REJECT');
  // among survivors, the stronger realistic edge×confidence (BLURT 9%) ranks above DOGE 4%.
  const survivors = signals.filter((s) => s.verdict !== 'REJECT');
  assert.equal(survivors[0].symbol, 'SWAP.BLURT');
});

test('a low (<3%) clean edge is WATCH, not ACT', () => {
  const { signals } = buildSignalFeed({
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'SWAP.DOGE', side: 'buy', netEdgePct: 1.5, execHive: 120, raw: { sym: 'SWAP.DOGE', realUsd: 0.085 } }] },
    prices: { 'SWAP.DOGE': { confident: true } },
  });
  assert.equal(bySym({ signals }, 'SWAP.DOGE').verdict, 'WATCH');
});

test('garbage input soft-fails to a valid empty feed (never throws)', () => {
  for (const bad of [null, undefined, 42, 'nope', { arbFeed: 'not an object' }, { arbFeed: { rows: 'x' } }, { analyzer: { liveArb: 7 } }]) {
    const r = buildSignalFeed(bad);
    assert.ok(Array.isArray(r.signals), 'signals is always an array');
    assert.ok(r.counts && typeof r.counts === 'object', 'counts present');
    assert.equal(typeof r.generatedAt, 'string');
  }
});

test('REJECT_FLAGS lists the documented trap kinds', () => {
  for (const f of ['phantom-wall', 'issuer-concentrated', 'one-way-bleed', 'edge-vanishes', 'implausible-edge']) {
    assert.ok(REJECT_FLAGS.includes(f), `${f} is a documented reject flag`);
  }
});

test('handler GET /api/signals returns the feed JSON (read-only); other paths/methods rejected', async () => {
  // inject a fixed live input set so liveSignalFeed() is fully offline.
  __setLive({
    arbFeed: { rows: [{ source: 'arb-scanner', market: 'SWAP.DOGE', side: 'buy', netEdgePct: 4, execHive: 120, raw: { sym: 'SWAP.DOGE', realUsd: 0.085 } }] },
    prices: { 'SWAP.DOGE': { confident: true } },
  });
  try {
    const cap = () => { const r = { code: 0, body: null }; return { r, res: { writeHead(c) { r.code = c; }, end(b) { r.body = JSON.parse(b); } } }; };

    const ok = cap();
    await handler({ method: 'GET', url: '/api/signals' }, ok.res);
    assert.equal(ok.r.code, 200);
    assert.equal(ok.r.body.ok, true);
    assert.equal(ok.r.body.advisory, true);
    assert.equal(ok.r.body.readOnly, true);
    assert.ok(Array.isArray(ok.r.body.signals));
    assert.equal(ok.r.body.signals[0].symbol, 'SWAP.DOGE');

    const notFound = cap();
    await handler({ method: 'GET', url: '/api/other' }, notFound.res);
    assert.equal(notFound.r.code, 404);

    const wrongMethod = cap();
    await handler({ method: 'POST', url: '/api/signals' }, wrongMethod.res);
    assert.equal(wrongMethod.r.code, 405);
  } finally {
    __setLive(null);
  }
});

test('liveSignalFeed soft-fails to an empty feed when injected sources are empty', async () => {
  __setLive({});
  try {
    const feed = await liveSignalFeed();
    assert.ok(Array.isArray(feed.signals));
    assert.equal(feed.signals.length, 0);
  } finally {
    __setLive(null);
  }
});

// ── LIVE SMOKE — opt-in, pulls the REAL analytics modules (arb-facade / trade-analyzer / HE books)
//    read-only and fuses them. OFF by default so `npm test` stays offline. Run with:
//    SIG_LIVE_SMOKE=1 node --test integrations/signal-orchestrator.test.mjs
//    Documents the real fused feed; asserts a valid, never-throwing shape (the feed can legitimately
//    be empty if markets are aligned / sources quiet, so we assert structure, not a nonzero count).
test('LIVE SMOKE: liveSignalFeed fuses the real modules into a valid feed (never throws)', { skip: !process.env.SIG_LIVE_SMOKE }, async () => {
  __setLive(null); // use the real dynamic-imported modules
  const feed = await liveSignalFeed();
  assert.ok(Array.isArray(feed.signals), 'signals is an array');
  assert.ok(feed.counts && typeof feed.counts.ACT === 'number', 'counts present');
  assert.ok(typeof feed.generatedAt === 'string', 'timestamped');
  // every emitted signal carries the full shape and a real verdict
  for (const s of feed.signals) {
    assert.ok(['ACT', 'WATCH', 'REJECT'].includes(s.verdict), `valid verdict: ${s.verdict}`);
    assert.ok('symbol' in s && 'edgePct' in s && 'confidence' in s);
  }
  // eslint-disable-next-line no-console
  console.log(`  [live] fused feed: ACT ${feed.counts.ACT} · WATCH ${feed.counts.WATCH} · REJECT ${feed.counts.REJECT}` +
    (feed.signals[0] ? ` · top: ${feed.signals[0].symbol} ${feed.signals[0].verdict} ${feed.signals[0].edgePct}%` : ''));
});
