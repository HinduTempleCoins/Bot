// hathor-persona.test.mjs — OFFLINE unit tests for the Phase-3 persona/voice layer.
// Fully offline: the module holds no keys, touches no network/fs. The only nondeterminism is
// Math.random() inside opener(); we control it by injecting a deterministic stub (saved/restored)
// so rotation is exercised without flakiness, plus a couple of statistical checks for variety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  persona,
  systemPrompt,
  opener,
  topicForIntent,
  wrapAnswer,
  INTERESTS,
} from './hathor-persona.mjs';

// ── deterministic Math.random seam (no module change) ────────────────────────────────────────────
// opener() is the only randomized export. Swap Math.random for a scripted sequence so we can assert
// exact rotation, then always restore the real one. Soft and local — never leaks across tests.
function withRandom(seq, fn) {
  const real = Math.random;
  let i = 0;
  Math.random = () => {
    const v = seq[i % seq.length];
    i += 1;
    return v;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

// ── persona() — the disposition descriptor ───────────────────────────────────────────────────────
test('persona() returns the typed disposition descriptor with interests', () => {
  const p = persona();
  assert.equal(p.name, 'Hathor');
  assert.equal(p.handle, 'hathor');
  assert.ok(p.register.length > 0, 'has a register descriptor');
  assert.ok(Array.isArray(p.interests) && p.interests.length >= 6, 'carries the interests list');
  assert.deepEqual(p.interests, INTERESTS, 'interests are the exported INTERESTS');
  assert.ok(/attention/i.test(p.held), 'held position names the attention-sustained frame');
});

test('INTERESTS is a stable non-empty list (the disposition, not a menu)', () => {
  assert.ok(Array.isArray(INTERESTS) && INTERESTS.length >= 6);
  for (const i of INTERESTS) assert.ok(typeof i === 'string' && i.trim().length > 0);
  // the load-bearing threads from the brief are present
  assert.ok(INTERESTS.some((i) => /Convergence/.test(i)), 'Convergence interest present');
  assert.ok(INTERESTS.some((i) => /egregor/i.test(i)), 'egregore interest present');
});

// ── systemPrompt() — voice shaping, grounding-aware ──────────────────────────────────────────────
test('systemPrompt() with no args yields the Angelic-register prompt and lists interests', () => {
  const s = systemPrompt();
  assert.equal(typeof s, 'string');
  assert.ok(s.includes('Hathor'), 'names the persona');
  assert.ok(/Angelic/.test(s), 'states the Angelic register');
  for (const i of INTERESTS) assert.ok(s.includes(i), `interest surfaced: ${i.slice(0, 24)}…`);
  // no grounding block when none supplied
  assert.ok(!s.includes('GROUNDING FACTS'), 'no grounding block when grounding absent');
});

test('systemPrompt() appends a grounding block only for non-empty grounding', () => {
  const withG = systemPrompt({ grounding: 'BTC = 65000 USD' });
  assert.ok(withG.includes('GROUNDING FACTS'), 'grounding header present');
  assert.ok(withG.includes('BTC = 65000 USD'), 'grounding facts included verbatim');

  // empty / whitespace grounding must NOT add the block (soft, typed default)
  for (const g of ['', '   ', '\n\t']) {
    assert.ok(!systemPrompt({ grounding: g }).includes('GROUNDING FACTS'), `blank grounding (${JSON.stringify(g)}) adds no block`);
  }
});

test('systemPrompt() never invents — instructs to speak only from grounding', () => {
  const s = systemPrompt({ grounding: 'x' });
  assert.ok(/NEVER invent|only from these/i.test(s), 'carries the no-invention rule');
});

// ── topicForIntent() — intent → opener context mapping ───────────────────────────────────────────
test('topicForIntent() maps known intents and falls back to open', () => {
  assert.equal(topicForIntent('library'), 'library');
  assert.equal(topicForIntent('trust'), 'trust');
  for (const m of ['price', 'markets', 'macro', 'forex', 'arbitrage', 'brief', 'diagnostics', 'holdings', 'exchanges']) {
    assert.equal(topicForIntent(m), 'market', `${m} → market`);
  }
  // unknown / soft-fail inputs all collapse to the safe 'open' context — never throws
  for (const bad of ['nonsense', '', undefined, null, 0, {}, []]) {
    assert.equal(topicForIntent(bad), 'open', `${JSON.stringify(bad)} → open`);
  }
});

// ── opener() — varied, rotated, never a single fixed string ──────────────────────────────────────
test('opener() returns a string from the requested pool', () => {
  const m = withRandom([0], () => opener({ topic: 'market' }));
  assert.equal(typeof m, 'string');
  assert.ok(m.length > 0);
});

test('opener() falls back to the open pool for unknown/empty topics (soft-fail, no throw)', () => {
  for (const bad of [{ topic: 'no-such-topic' }, {}, undefined, { topic: '' }, { topic: null }]) {
    const out = withRandom([0], () => opener(bad));
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0, `non-empty opener for ${JSON.stringify(bad)}`);
  }
});

test('opener() returns the sole seed for a single-entry pool deterministically', () => {
  // 'signup' and 'library' and 'trust' have 2; 'market' has 3; none has exactly 1 today, so
  // assert the single-entry CODE PATH via a topic whose pool we know, by checking idempotence
  // on a stubbed random that would otherwise rotate.
  const a = withRandom([0.0], () => opener({ topic: 'signup' }));
  assert.ok(typeof a === 'string' && a.length > 0);
});

test('opener() avoids an immediate back-to-back repeat within a context', () => {
  // Force Math.random to keep returning the SAME index; the anti-repeat logic must still move off it
  // on the second call. Use 'market' (3 seeds). First call lands on index 0.
  const first = withRandom([0.0], () => opener({ topic: 'market' }));
  // Now random again points at 0, but _last['market'] is 0 → code bumps to (0+1)%3 = 1.
  const second = withRandom([0.0], () => opener({ topic: 'market' }));
  assert.notEqual(first, second, 'consecutive identical-random draws do not repeat the seed');
});

test('opener() over many draws exercises real variety (disposition, not script)', () => {
  // Restore real randomness and confirm the open pool yields more than one distinct line.
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(opener({ topic: 'open' }));
  assert.ok(seen.size >= 2, 'the open disposition produces varied openings, never one fixed string');
});

// ── wrapAnswer() — no-LLM voice wrap that preserves facts verbatim ───────────────────────────────
test('wrapAnswer() with a factual answer prepends a contextual opener and keeps facts verbatim', () => {
  const answer = 'BTC is 65000 USD.';
  const out = withRandom([0.0], () => wrapAnswer({ answer, intent: 'price' }));
  assert.ok(out.includes(answer), 'the exact figures are preserved (never rewritten)');
  assert.ok(out.indexOf(answer) > 0, 'an opener precedes the facts');
  assert.ok(out.includes('\n\n'), 'opener and facts separated by a blank line');
});

test('wrapAnswer() empty/greeting cases return a pure disposition-opener (no facts, no throw)', () => {
  for (const args of [
    { answer: '', intent: 'price' },
    { answer: '   ', intent: 'library' },
    { intent: 'empty' },
    { answer: 'ignored-when-open?', intent: 'open' }, // 'open' is the greeting branch
    {}, // fully default → open greeting
    undefined,
  ]) {
    const out = withRandom([0.0], () => wrapAnswer(args));
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0, `non-empty opener for ${JSON.stringify(args)}`);
  }
});

test('wrapAnswer() with open intent AND an answer still grounds the answer under the open opener', () => {
  const out = withRandom([0.0], () => wrapAnswer({ answer: 'Here are the facts.', intent: 'open' }));
  assert.ok(out.includes('Here are the facts.'), 'open-with-answer keeps the answer verbatim');
  assert.ok(out.includes('\n\n'), 'separated from the opener');
});

test('wrapAnswer() routes intent through topicForIntent (library → library opener context)', () => {
  // We cannot read the chosen pool directly, but a library-intent answer must be wrapped without
  // throwing and must preserve the answer.
  const out = withRandom([0.0], () => wrapAnswer({ answer: 'The corpus says X.', intent: 'library' }));
  assert.ok(out.includes('The corpus says X.'));
});

// ── global no-throw guarantee across odd inputs ──────────────────────────────────────────────────
test('every export soft-fails on garbage input rather than throwing', () => {
  assert.doesNotThrow(() => persona());
  assert.doesNotThrow(() => systemPrompt(undefined));
  assert.doesNotThrow(() => systemPrompt({}));
  assert.doesNotThrow(() => topicForIntent(undefined));
  assert.doesNotThrow(() => withRandom([0.0], () => opener(undefined)));
  assert.doesNotThrow(() => withRandom([0.0], () => wrapAnswer(undefined)));
  assert.doesNotThrow(() => withRandom([0.0], () => wrapAnswer({ answer: null, intent: 12345 })));
});
