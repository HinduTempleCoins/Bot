// trade-hud.test.mjs — offline tests for the admin trade-analytics board (task #205).
// Every source is INJECTED via __setSources so no network/module side-effects run. Covers:
//   • tradeBoard assembles from injected fakes
//   • per-section soft-fail: one throwing source → its section ok:false, others fine
//   • headline is plain English (no file paths / jargon)
//   • renderBoard escapes a malicious token name + has the display-only line + DRY-RUN label
//   • decisionQueue extracts plain-English action items

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradeBoard, headline, renderBoard, decisionQueue, __setSources } from './trade-hud.mjs';

// ── fakes matching each real module's interface ──────────────────────────────────────────────────
function goodSources(over = {}) {
  return {
    'profit-tracker': {
      summary: () => ({ trades: 4, markets: 2, volume: 320.5, fees: 0.6, netPnl: 12.5, best: { market: 'SWAP.DOGE', realized: 18 }, worst: { market: 'SWAP.LTC', realized: -5.5 } }),
    },
    'trade-analyzer': {
      analyze: async () => ({
        findingsStructured: [
          { text: 'SINK: SWAP.LTC lost 6424 HIVE', categories: ['bleed'], net: -6424 },
          { text: 'WORKS: SWAP.DOGE netted +200 HIVE', categories: ['win'], net: 200 },
        ],
        findingGroups: { byCategory: { bleed: [{}], win: [{}] }, summary: { bleed: 6424, win: 200, net: -6224 } },
      }),
    },
    'market-entry': {
      recommendEntries: async () => ([
        { market: 'SWAP.BLURT', venue: 'Hive-Engine', kind: 'swap-arb', edgePct: 0.06, confidence: 'high', usJurisdictionOK: true, reason: '6% executable edge', action: 'SELL SWAP.BLURT' },
        { market: 'SWAP.DOGE', venue: 'Hive-Engine', kind: 'swap-arb', edgePct: 0.04, confidence: 'medium', usJurisdictionOK: true, reason: 'round-trip arb', action: 'arb DOGE' },
      ]),
    },
    'ai-trade-suggest': {
      suggest: async () => ([
        { market: 'SWAP.BLURT', action: 'SELL', sizeHint: 'standard', risk: 'low', confidence: 0.7, rationale: 'clean two-sided edge' },
      ]),
    },
    'staking-decision': {
      portfolioPlan: () => ([{ symbol: 'VKBT', action: 'TRADE', reason: 'oscillates on a liquid book' }]),
    },
    'dry-run': {
      dryRunCycle: async () => ({
        dryRun: true,
        orders: [{ order: { side: 'sell', symbol: 'SWAP.BTC', quantity: 1, price: 0.5 } }],
        blocked: [{ sym: 'SWAP.LTC', blocked: 'no-selling-leg (SWAP.LTC bleed guard)' }],
        sweep: { to: 'kalivankush', asset: 'SWAP.HIVE', amount: 45, skim: true, reason: 'liquid 100 − principal 50 − buffer 5 = skim 45' },
      }),
      summary: () => 'angelicalist DRY-RUN cycle — DRY-RUN (no broadcasts)',
    },
    // extra inputs the HUD reads for staking/dry-run
    holdings: ['VKBT'],
    marketData: { VKBT: { stakingApr: 0.04, volatility: 0.7, spreadPct: 1.5, liquidity: 800 } },
    dryRunInput: { market: null, signals: [] },
    dryRunOpts: {},
    ...over,
  };
}

test('tradeBoard assembles from injected fakes', async () => {
  __setSources(goodSources());
  const board = await tradeBoard();
  __setSources(null);

  assert.equal(board.profit.netPnl, 12.5);
  assert.equal(board.profit.trades, 4);
  assert.equal(board.findings.warnings.length, 1); // the bleed finding
  assert.equal(board.findings.byCategory.bleed, 1);
  assert.equal(board.entries.length, 2);
  assert.equal(board.suggestions.length, 1);
  assert.equal(board.staking.rows[0].action, 'TRADE');
  assert.equal(board.dryRunPlan.dryRun, true);
  assert.equal(board.dryRunPlan.sweep.skim, true);

  for (const s of Object.values(board.sections)) assert.equal(s.ok, true);
  assert.ok(board.asOf);
});

test('per-section soft-fail: one throwing source → its section ok:false, others fine', async () => {
  __setSources(goodSources({
    'trade-analyzer': { analyze: async () => { throw new Error('boom'); } },
  }));
  const board = await tradeBoard();
  __setSources(null);

  assert.equal(board.sections.findings.ok, false); // the throwing one
  assert.equal(board.findings, null);
  // every other section still produced data
  assert.equal(board.sections.profit.ok, true);
  assert.equal(board.sections.entries.ok, true);
  assert.equal(board.sections.suggestions.ok, true);
  assert.equal(board.sections.staking.ok, true);
  assert.equal(board.sections.dryRunPlan.ok, true);
  assert.equal(board.profit.netPnl, 12.5);
});

test('soft-fail when a source is entirely missing (null override)', async () => {
  __setSources(goodSources({ 'profit-tracker': null }));
  const board = await tradeBoard();
  __setSources(null);
  assert.equal(board.sections.profit.ok, false);
  assert.equal(board.profit, null);
  assert.equal(board.sections.entries.ok, true);
});

test('headline is plain English (no file paths / jargon)', async () => {
  __setSources(goodSources());
  const board = await tradeBoard();
  __setSources(null);

  const h = headline(board);
  assert.equal(typeof h, 'string');
  assert.ok(h.endsWith('.'));
  assert.match(h, /Up 12\.5 HIVE/);
  assert.match(h, /bleed warning/);
  assert.match(h, /enterable/);
  // no jargon / file paths / extensions
  assert.doesNotMatch(h, /\.mjs|\/|netPnl|findingsStructured|dryRun|edgePct/);
});

test('headline soft-handles an empty board', () => {
  const empty = {
    asOf: 'now', account: 'x', profit: null, findings: null, entries: [], suggestions: [], staking: null, dryRunPlan: null,
    sections: { profit: { ok: false }, findings: { ok: false }, entries: { ok: false }, suggestions: { ok: false }, staking: { ok: false }, dryRunPlan: { ok: false } },
  };
  const h = headline(empty);
  assert.match(h, /No trade data available/);
});

test('renderBoard escapes a malicious token name + has display-only line + DRY-RUN label', async () => {
  const evil = '<script>alert(1)</script>';
  __setSources(goodSources({
    'market-entry': {
      recommendEntries: async () => ([
        { market: evil, venue: 'X', kind: 'swap-arb', edgePct: 0.05, confidence: 'high', usJurisdictionOK: true, reason: `bad "${evil}"`, action: 'SELL' },
      ]),
    },
  }));
  const board = await tradeBoard();
  __setSources(null);

  const html = renderBoard(board);

  // the raw script tag must NOT survive; it must be escaped
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /"<script/); // no unescaped attr injection either

  // required visible lines
  assert.match(html, /Display-only — nothing here executes trades\./);
  assert.match(html, /DRY-RUN/);
  // headline is rendered in
  assert.match(html, /Up 12\.5 HIVE/);
});

test('renderBoard marks offline sections and never throws on a degraded board', async () => {
  __setSources(goodSources({ 'dry-run': { dryRunCycle: async () => { throw new Error('x'); } } }));
  const board = await tradeBoard();
  __setSources(null);
  const html = renderBoard(board);
  assert.match(html, /source offline/);   // the failed dry-run card flagged
  assert.match(html, /Trade Analytics/);
});

test('decisionQueue extracts plain-English action items', async () => {
  __setSources(goodSources());
  const board = await tradeBoard();
  __setSources(null);

  const q = decisionQueue(board);
  assert.ok(Array.isArray(q));
  assert.ok(q.length >= 3);
  // approve first trade (sweep is live in the dry-run)
  assert.ok(q.some((x) => /Approve the first real trade/i.test(x)));
  // angelicalist key disposition
  assert.ok(q.some((x) => /angelicalist/i.test(x) && /rotate or abandon/i.test(x)));
  // bleed stop
  assert.ok(q.some((x) => /bleed/i.test(x)));
  // every item is a plain string, no jargon/paths
  for (const x of q) {
    assert.equal(typeof x, 'string');
    assert.doesNotMatch(x, /\.mjs|netPnl|findingsStructured|edgePct/);
  }
});

test('decisionQueue is empty/minimal when nothing is actionable', () => {
  const board = {
    asOf: 'now', account: 'kalivankush', profit: null, findings: null, entries: [], suggestions: [], staking: null, dryRunPlan: null,
    sections: { profit: { ok: false }, findings: { ok: false }, entries: { ok: false }, suggestions: { ok: false }, staking: { ok: false }, dryRunPlan: { ok: false } },
  };
  assert.deepEqual(decisionQueue(board), []);
});
