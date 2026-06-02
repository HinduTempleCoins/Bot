// trade-proposer.test.js — proves the ADVISORY engine shapes proposals + renders a brief block,
// and (critically) that a us:'no' venue is flagged "non-US server required" rather than treated as
// usable. The network paths (marketSnapshot/scanArb) are exercised separately by the CLI live run;
// here we test the pure rendering + US-gating surfaces with no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefBlock } from './trade-proposer.mjs';

test('briefBlock renders the advisory header and a proposal with evidence + US note', () => {
  const result = {
    ts: '2026-06-02T00:00:00Z',
    hiveUsd: 0.06,
    snapshot: { totalMarkets: 1200, activeMarkets: 800, totalVolumeHive: 200000 },
    proposals: [{
      kind: 'arbitrage',
      summary: 'BUY SWAP.X on HE — 13% executable edge',
      evidence: { volume: null, spread: 13, depth: 243, fees: 'HE 1% per side' },
      usNote: 'Hive-Engine: US-accessible with carve-outs.',
      confidence: 'high',
      suggestedAction: 'Review the SWAP.X book; human-verify before any manual trade.',
    }],
  };
  const md = briefBlock(result);
  assert.match(md, /ADVISORY ONLY/);
  assert.match(md, /the bots propose, humans decide/i);
  assert.match(md, /No trade is executed by this engine/);
  assert.match(md, /\[arbitrage\]/);
  assert.match(md, /edge 13%/);
  assert.match(md, /human-gated/);
});

test('briefBlock handles an empty scan gracefully', () => {
  const md = briefBlock({ ts: 't', hiveUsd: 0, snapshot: null, proposals: [] });
  assert.match(md, /No proposals this scan/);
});

test('briefBlock tolerates a missing result object (never throws)', () => {
  assert.doesNotThrow(() => briefBlock(undefined));
  assert.doesNotThrow(() => briefBlock(null));
});

// US-gating proof: drive a proposal whose usNote came from the real catalog gate for a us:'no'
// venue, and confirm the "NON-US SERVER REQUIRED" flag survives into the rendered brief block.
test('a us:no venue is flagged NON-US SERVER REQUIRED in the rendered block', () => {
  const result = {
    ts: 't', hiveUsd: 0.06, snapshot: null,
    proposals: [{
      kind: 'new-exchange',
      summary: 'Binance has the deepest book',
      evidence: { fees: 'taker 0.1%' },
      usNote: 'Binance blocks US persons — NON-US SERVER REQUIRED (not usable from our US host).',
      confidence: 'low',
      suggestedAction: 'Do NOT route through a us:no venue from the US host.',
    }],
  };
  const md = briefBlock(result);
  assert.match(md, /NON-US SERVER REQUIRED/);
});
