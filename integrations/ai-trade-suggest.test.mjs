// ai-trade-suggest.test.mjs — OFFLINE tests for the AI trade-suggestion layer (queue #64).
// No network: scoreSuggestion is pure; suggest() runs with an INJECTED fake llm AND with no llm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, scoreSuggestion } from './ai-trade-suggest.mjs';

// ── scoreSuggestion: pure, deterministic, edge×liquidity×jurisdiction − risk ──────────────────
test('scoreSuggestion = edge × liquidity × jurisdiction − risk', () => {
  // clean jurisdiction = 1.0 multiplier
  const s = scoreSuggestion({ edge: 0.1, liquidity: 1, jurisdiction: 'clean', risk: 0.02 });
  assert.equal(s, +(0.1 * 1 * 1.0 - 0.02).toFixed(6)); // 0.08
});

test('scoreSuggestion orders better edge/liquidity ahead of worse', () => {
  const good = scoreSuggestion({ edge: 0.08, liquidity: 0.9, jurisdiction: 'clean', risk: 0.05 });
  const meh = scoreSuggestion({ edge: 0.02, liquidity: 0.4, jurisdiction: 'clean', risk: 0.05 });
  const bad = scoreSuggestion({ edge: 0.08, liquidity: 0.9, jurisdiction: 'restricted', risk: 0.05 });
  assert.ok(good > meh, 'higher edge/liquidity should score higher');
  assert.ok(good > bad, 'clean jurisdiction should beat restricted, all else equal');
});

test('scoreSuggestion clamps risk and tolerates missing fields', () => {
  // risk above 1 is clamped to 1; missing edge/liquidity default → negative-ish score
  const s = scoreSuggestion({ risk: 5 });
  assert.ok(s <= 0, 'a candidate with no edge and capped risk cannot score positive');
  assert.equal(typeof scoreSuggestion({}), 'number');
});

test('scoreSuggestion: high risk can make a positive-edge idea net-negative', () => {
  const s = scoreSuggestion({ edge: 0.05, liquidity: 1, jurisdiction: 'clean', risk: 0.9 });
  assert.ok(s < 0, 'risk is subtracted last and can dominate');
});

// ── suggest(): ranks + attaches rationale (injected fake llm) ─────────────────────────────────
const SNAP = {
  liquidityTargetHive: 100,
  opportunities: [
    { market: 'SWAP.BLURT', action: 'SELL', edge: 0.06, execHive: 90, jurisdiction: 'clean', paired: true, reason: 'HE bid over real' },
    { market: 'SWAP.DOGE', action: 'ARB', edge: 0.03, execHive: 40, jurisdiction: 'clean', reason: 'round-trip' },
    { market: 'SWAP.GREY', action: 'SELL', edge: 0.05, execHive: 50, jurisdiction: 'restricted', reason: 'thin grey venue' },
  ],
};

test('suggest() ranks by score and adds an LLM rationale when an llm is injected', async () => {
  const calls = [];
  const fakeLlm = {
    complete: async (prompt) => {
      calls.push(prompt);
      return { text: 'FAKE-LLM rationale text.' };
    },
  };
  const ranked = await suggest({ snapshot: SNAP, entries: [], holdings: {} }, { llm: fakeLlm });

  assert.ok(ranked.length >= 3);
  // best score first — BLURT (clean, fat edge, deep) should outrank the restricted/greyer ones
  assert.equal(ranked[0].market, 'SWAP.BLURT');
  // monotonically non-increasing score
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'scores must be sorted descending');
  }
  // every suggestion got the injected LLM rationale, and the llm was actually called per candidate
  assert.ok(ranked.every((s) => s.rationale === 'FAKE-LLM rationale text.'));
  assert.equal(calls.length, ranked.length);
  // shape
  for (const s of ranked) {
    assert.ok(['low', 'medium', 'high'].includes(s.risk));
    assert.ok(typeof s.sizeHint === 'string');
    assert.ok(typeof s.confidence === 'number');
  }
});

// ── suggest(): no llm → templated rationale (soft-fail) ───────────────────────────────────────
test('suggest() falls back to a templated rationale when no llm is given', async () => {
  const ranked = await suggest({ snapshot: SNAP, entries: [], holdings: {} });
  assert.ok(ranked.length >= 3);
  // templated rationale mentions the market and is non-empty; advisory disclaimer present
  for (const s of ranked) {
    assert.ok(s.rationale.includes(s.market), 'templated rationale names the market');
    assert.match(s.rationale, /Advisory only/);
  }
});

test('suggest() soft-fails to the template when the injected llm throws or returns empty', async () => {
  const throwing = { complete: async () => { throw new Error('boom'); } };
  const empty = { complete: async () => ({ text: '   ' }) };

  const a = await suggest({ snapshot: SNAP }, { llm: throwing });
  const b = await suggest({ snapshot: SNAP }, { llm: empty });
  for (const ranked of [a, b]) {
    assert.ok(ranked.length >= 1);
    assert.ok(ranked.every((s) => /Advisory only/.test(s.rationale)), 'fell back to template');
  }
});

// ── risk cap respected ────────────────────────────────────────────────────────────────────────
test('risk is always a valid band and never exceeds the cap', async () => {
  const snapshot = {
    opportunities: [
      { market: 'SWAP.WILD', action: 'SELL', edge: 0.9, execHive: 1, jurisdiction: 'restricted', risk: 9 },
    ],
  };
  const ranked = await suggest({ snapshot });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].risk, 'high'); // risk 9 clamped → high band, never throws/overflows
});

// ── bleed-guard: NEVER suggest one-way accumulation (SWAP.LTC lesson) ─────────────────────────
test('no actionable BUY suggested for one-way accumulation on a held token', async () => {
  const snapshot = {
    opportunities: [
      // a BUY with no selling leg, on a token we are already net-long → must be downgraded
      { market: 'SWAP.LTC', action: 'BUY', edge: 0.08, execHive: 90, jurisdiction: 'clean', reason: 'looks cheap' },
    ],
  };
  const holdings = { 'SWAP.LTC': 25 };
  const ranked = await suggest({ snapshot, holdings });

  const ltc = ranked.find((s) => s.market === 'SWAP.LTC');
  assert.ok(ltc, 'LTC suggestion exists');
  assert.notEqual(ltc.action, 'BUY', 'must NOT surface a one-way BUY');
  assert.equal(ltc.action, 'WATCH');
  assert.equal(ltc.risk, 'high', 'one-way accumulation is forced high risk');
  assert.match(ltc.sizeHint, /none|watch/i, 'no position size on a watch-only idea');
});

test('a PAIRED buy on a held token is allowed (it has a selling leg)', async () => {
  const snapshot = {
    opportunities: [
      { market: 'SWAP.LTC', action: 'BUY', edge: 0.08, execHive: 90, jurisdiction: 'clean', paired: true, exit: 'sell @ +3%' },
    ],
  };
  const holdings = { 'SWAP.LTC': 25 };
  const ranked = await suggest({ snapshot, holdings });
  const ltc = ranked.find((s) => s.market === 'SWAP.LTC');
  assert.equal(ltc.action, 'BUY', 'a buy with an exit/sell leg is not one-way accumulation');
});
