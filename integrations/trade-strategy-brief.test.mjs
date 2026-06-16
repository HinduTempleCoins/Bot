// trade-strategy-brief.test.mjs — FULLY OFFLINE. buildStrategyBrief is pure; we inject mocked
// reader outputs (the same shapes the real collectors emit) and assert the three sections, the
// US-accessibility filter, the trap exclusion, the winners/losers in next-steps, and garbage soft-fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyBrief, renderStrategyBriefMd, appendToTradeFeed, analyzerFromSanitizedFeed } from './trade-strategy-brief.mjs';

// ── mocked inputs: realistic shapes from each collector ───────────────────────────────────────────
function mockInputs() {
  return {
    usCex: {
      venues: [
        // US-full, public API, lists DOGE + LTC + BTC → strong recommend
        { name: 'Coinbase', publicApi: true, usAvailability: 'US-full (Coinbase Exchange).',
          markets: [
            { symbol: 'DOGE-USD', bid: 0.099, ask: 0.101, last: 0.10, vol24h: 5_000_000 },
            { symbol: 'LTC-USD', bid: 79.9, ask: 80.1, last: 80, vol24h: 2_000_000 },
            { symbol: 'BTC-USD', bid: 99950, ask: 100050, last: 100000, vol24h: 1000 },
          ] },
        // US-full, lists BLURT? no — but BTC; recommend
        { name: 'Kraken', publicApi: true, usAvailability: 'US-full (most states).',
          markets: [{ symbol: 'XBTUSD', bid: 99900, ask: 100100, last: 100000, vol24h: 800 }] },
        // state-limited → recommend but flagged
        { name: 'Binance.US', publicApi: true, usAvailability: 'Separate US entity; not all states; rails restricted at times.',
          markets: [{ symbol: 'DOGEUSD', bid: 0.0995, ask: 0.1005, last: 0.10, vol24h: 3_000_000 }] },
        // retail-only consumer rail, no API → NOT recommended
        { name: 'Robinhood Crypto', publicApi: false, usAvailability: 'US broker; crypto withdrawals limited historically; not all states.',
          markets: [] },
        // explicitly US-blocked → NOT recommended
        { name: 'BlockedEx', publicApi: true, usAvailability: 'Not available in the US — blocked for US persons.',
          markets: [{ symbol: 'DOGEUSDT', bid: 0.10, ask: 0.10, last: 0.10, vol24h: 9_000_000 }] },
      ],
    },
    solana: { venues: [
      { venue: 'Orca', kind: 'dex', chain: 'solana', alive: true, data: { volume24hUsd: 50_000_000, tvlUsd: 200_000_000, topPairs: [{ a: 'SOL', b: 'USDC' }] } },
      { venue: 'DeadDex', kind: 'dex', chain: 'solana', alive: false, data: null },
    ] },
    evmDex: { venues: [
      { venue: 'Uniswap v3 (Polygon)', kind: 'dex', chain: 'polygon', topPairs: [{ a: 'MATIC', b: 'USDC' }] },
    ] },
    perps: { venues: [
      { ok: true, venue: 'Hyperliquid', chain: 'hyperliquid', volume24hUsd: 1_000_000_000, openInterestUsd: 500_000_000 },
      { ok: false, venue: 'DeadPerp', chain: 'x' },
    ] },
    aggXchain: { venues: [{ venue: 'Jumper', kind: 'aggregator', chain: 'multi', volume24hUsd: 10_000_000, tvlUsd: null }] },
    analyzer: {
      tokens: [
        { symbol: 'SWAP.DOGE', netHive: 320, held: 0, heldHive: 0, lastPrice: 0.0001, issued: false }, // winner
        { symbol: 'SWAP.BLURT', netHive: 110, held: 100, heldHive: 5, lastPrice: 0.05, issued: false }, // winner
        { symbol: 'SWAP.LTC', netHive: -180, held: 0, heldHive: 0, lastPrice: 0.0002, issued: false },  // loser / one-way
        { symbol: 'VKBT', netHive: -5, held: 1e6, heldHive: 0.2, lastPrice: 1e-7, issued: true },
      ],
      findings: ['WORKS: SWAP.DOGE netted +320 HIVE.', 'SINK: SWAP.LTC lost 180 HIVE.'],
      suggestions: ['SCALE SWAP.DOGE.', 'STOP trading SWAP.LTC.'],
      liveArb: [
        { signal: 'BUY SWAP.DOGE on HE', sym: 'SWAP.DOGE', side: 'BUY', edgePct: 6.2, realUsd: 0.10, walls: null },
      ],
      totals: { realizedHive: 245, unrealizedHive: 5.2, netHive: 250.2 },
    },
    signalFeed: {
      signals: [
        // a clean, executable SWAP.DOGE arb — ACT
        { source: 'trade-analyzer', market: 'BUY SWAP.DOGE on HE', symbol: 'SWAP.DOGE', side: 'BUY', edgePct: 6.2, realUsd: 0.10, confidence: 0.7, flags: [], verdict: 'ACT' },
        // a one-way-bleed SWAP.LTC — must be EXCLUDED from cross-venue even if it slipped in as WATCH
        { source: 'trade-analyzer', market: 'SWAP.LTC', symbol: 'SWAP.LTC', side: 'BUY', edgePct: 4.0, realUsd: 80, confidence: 0.5, flags: [], verdict: 'WATCH' },
        // a phantom-wall SWAP.ETH — REJECT, must be excluded
        { source: 'arb-facade', market: 'SWAP.ETH', symbol: 'SWAP.ETH', side: 'BUY', edgePct: 141, realUsd: 3000, confidence: 0.45, flags: ['phantom-wall'], verdict: 'REJECT' },
      ],
      counts: { ACT: 1, WATCH: 1, REJECT: 1 },
    },
  };
}

test('produces the three sections', () => {
  const b = buildStrategyBrief(mockInputs());
  assert.ok(Array.isArray(b.exchangesToJoin));
  assert.ok(Array.isArray(b.crossVenueArb));
  assert.ok(b.nextSteps && typeof b.nextSteps === 'object');
  const md = renderStrategyBriefMd(b);
  assert.match(md, /1\. Exchanges to join/);
  assert.match(md, /2\. Cross-venue arbitrage/);
  assert.match(md, /3\. Best next steps/);
});

test('a US-blocked exchange is flagged, not recommended', () => {
  const b = buildStrategyBrief(mockInputs());
  const blocked = b.exchangesToJoin.find((e) => e.name === 'BlockedEx');
  assert.ok(blocked, 'blocked venue present in the list');
  assert.equal(blocked.recommend, false, 'US-blocked venue is NOT recommended');
  assert.equal(blocked.usAccessible, false);
  // and a US-accessible venue with our assets IS recommended
  const cb = b.exchangesToJoin.find((e) => e.name === 'Coinbase');
  assert.equal(cb.recommend, true);
  assert.ok(cb.quotesOurAssets.includes('DOGE'));
});

test('retail-only venue (no maker API) is not recommended', () => {
  const b = buildStrategyBrief(mockInputs());
  const rh = b.exchangesToJoin.find((e) => e.name === 'Robinhood Crypto');
  assert.equal(rh.recommend, false);
  assert.equal(rh.retailOnly, true);
});

test('state-limited venue is recommended but carries the state-block catch', () => {
  const b = buildStrategyBrief(mockInputs());
  const bus = b.exchangesToJoin.find((e) => e.name === 'Binance.US');
  assert.equal(bus.stateLimited, true);
  assert.ok(bus.catches.some((c) => /state/i.test(c)));
});

test('a "not in NY" state carve-out is state-limited (US-accessible), NOT country-blocked', () => {
  // regression: a US venue phrased "US, not in NY/HI/TX/VT" must read as state-limited + accessible,
  // while a true country exclusion ("not available to US persons") must read as blocked. The live
  // render caught the old classifier wrongly blocking the former.
  const inp = {
    usCex: { venues: [
      { name: 'StateCarveOut', publicApi: true, usAvailability: 'US, not in NY/HI/TX/VT.',
        markets: [{ symbol: 'DOGEUSD', bid: 0.099, ask: 0.101, last: 0.10, vol24h: 4_000_000 }] },
      { name: 'GlobalOnly', publicApi: true, usAvailability: 'Not available to US persons.',
        markets: [{ symbol: 'DOGEUSDT', bid: 0.10, ask: 0.10, last: 0.10, vol24h: 9_000_000 }] },
    ] },
  };
  const b = buildStrategyBrief(inp);
  const carve = b.exchangesToJoin.find((e) => e.name === 'StateCarveOut');
  const global = b.exchangesToJoin.find((e) => e.name === 'GlobalOnly');
  assert.equal(carve.usAccessible, true, 'state carve-out is still US-accessible');
  assert.equal(carve.stateLimited, true, 'flagged state-limited');
  assert.equal(carve.recommend, true, 'recommended (with the state catch)');
  assert.equal(global.usAccessible, false, 'country exclusion is blocked');
  assert.equal(global.recommend, false, 'never recommended');
});

test('phantom/one-way arb is EXCLUDED from cross-venue, clean arb recommended', () => {
  const b = buildStrategyBrief(mockInputs());
  const doge = b.crossVenueArb.find((p) => p.heToken === 'SWAP.DOGE');
  const ltc = b.crossVenueArb.find((p) => p.heToken === 'SWAP.LTC');
  const eth = b.crossVenueArb.find((p) => p.heToken === 'SWAP.ETH');
  assert.ok(doge && doge.recommended, 'clean SWAP.DOGE arb is recommended');
  assert.ok(ltc && !ltc.recommended, 'one-way-bleed SWAP.LTC is excluded');
  assert.ok(ltc.flags.includes('one-way-bleed'), 'SWAP.LTC tagged one-way-bleed');
  assert.equal(ltc.verdict, 'REJECT');
  assert.ok(eth && !eth.recommended, 'phantom-wall SWAP.ETH is excluded');
  assert.equal(eth.verdict, 'REJECT');
  // none of the excluded pairs appears in the recommended set
  assert.ok(b.crossVenueArb.filter((p) => p.recommended).every((p) => p.asset !== 'LTC' && p.asset !== 'ETH'));
});

test('next-steps reflect the winners and losers', () => {
  const b = buildStrategyBrief(mockInputs());
  const scale = b.nextSteps.scaleWinners.join(' ');
  const avoid = b.nextSteps.avoid.join(' ');
  assert.match(scale, /SWAP\.DOGE/);
  assert.match(scale, /SWAP\.BLURT/);
  assert.match(avoid, /SWAP\.LTC/);
  // test-venue steps name a real US-accessible candidate
  assert.ok(b.nextSteps.testVenues.length > 0);
  assert.match(b.nextSteps.testVenues.join(' '), /Coinbase|Kraken|Binance\.US/);
  // chains direction picks up the live Solana venue
  assert.match(b.nextSteps.addChains.join(' '), /Solana/);
});

test('appendToTradeFeed appends the strategy block and is idempotent (no stacking)', () => {
  const b = buildStrategyBrief(mockInputs());
  const feed = '# Trade-bot brief feed (SANITIZED)\n\n## Findings\n- x\n';
  const once = appendToTradeFeed(feed, b);
  assert.match(once, /## Findings/);                       // original content preserved
  assert.match(once, /Trade-strategy brief/);             // strategy section appended
  assert.ok(once.includes('<!-- trade-strategy-brief -->'));
  const twice = appendToTradeFeed(once, b);
  // marker appears exactly once (re-append replaces, does not stack)
  assert.equal(twice.split('<!-- trade-strategy-brief -->').length - 1, 1);
});

test('analyzerFromSanitizedFeed maps the sanitized feed to the analyzer shape (banded, no raw)', () => {
  // the --append-feed path sources P&L from the sanitized feed JSON so only banded figures cross.
  const sanitized = {
    totals: { realizedHiveBand: 250, netHiveBand: 250 },
    tokens: [
      { symbol: 'SWAP.DOGE', role: 'traded', netHive: 320, activity: 'high', holdingValueBand: '~0' },
      { symbol: 'SWAP.LTC', role: 'traded', netHive: -180, activity: 'medium', holdingValueBand: '~0' },
    ],
    findings: ['WORKS: SWAP.DOGE.'], suggestions: ['SCALE SWAP.DOGE.'],
  };
  const a = analyzerFromSanitizedFeed(sanitized);
  assert.deepEqual(a.tokens.map((t) => t.symbol), ['SWAP.DOGE', 'SWAP.LTC']);
  assert.equal(a.tokens[0].netHive, 320);
  assert.deepEqual(a.liveArb, []);                 // arb never sourced from the ledger
  // and it composes into a valid brief whose next-steps still reflect winners/losers
  const b = buildStrategyBrief({ analyzer: a });
  assert.match(b.nextSteps.scaleWinners.join(' '), /SWAP\.DOGE/);
  assert.match(b.nextSteps.avoid.join(' '), /SWAP\.LTC/);
  // garbage soft-fails to a valid empty shape (no tokens), never throws
  assert.deepEqual(analyzerFromSanitizedFeed(null).tokens, []);
  assert.deepEqual(analyzerFromSanitizedFeed(undefined).liveArb, []);
});

test('garbage / empty inputs soft-fail to a valid empty brief (never throws)', () => {
  for (const bad of [undefined, null, {}, { usCex: 'nope', analyzer: 42, signalFeed: [] }, { usCex: { venues: 'x' } }]) {
    const b = buildStrategyBrief(bad);
    assert.ok(b && typeof b === 'object');
    assert.ok(Array.isArray(b.exchangesToJoin));
    assert.ok(Array.isArray(b.crossVenueArb));
    assert.ok(b.nextSteps && Array.isArray(b.nextSteps.dataGaps));
    // render must also not throw on the soft-failed brief
    assert.equal(typeof renderStrategyBriefMd(b), 'string');
  }
  // render on raw garbage too
  assert.equal(typeof renderStrategyBriefMd(null), 'string');
  assert.equal(typeof renderStrategyBriefMd(123), 'string');
});
