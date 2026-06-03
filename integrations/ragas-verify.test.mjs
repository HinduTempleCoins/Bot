// ragas-verify.test.mjs — offline, deterministic (lexical fallback). Run:
//   node --test integrations/ragas-verify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atomizeClaims, claimSupport, faithfulness, verifyCitations, report, __setJudge,
} from './ragas-verify.mjs';

const CTX = [
  'Alexander Shulgin was an American medicinal chemist born in 1925 in Berkeley, California.',
  'He authored the books PiHKAL and TiHKAL with his wife Ann Shulgin.',
];

test('atomizeClaims splits a multi-claim answer into atomic claims', () => {
  const claims = atomizeClaims(
    'Shulgin was an American chemist. He wrote PiHKAL, and he wrote TiHKAL.',
  );
  assert.ok(claims.length >= 3, `expected >=3 claims, got ${claims.length}: ${JSON.stringify(claims)}`);
  assert.ok(claims.some((c) => /american chemist/i.test(c)));
  assert.ok(claims.some((c) => /PiHKAL/i.test(c)));
  assert.ok(claims.some((c) => /TiHKAL/i.test(c)));
  // no empties
  assert.ok(claims.every((c) => c.trim().length > 0));
});

test('atomizeClaims on empty / whitespace yields no claims', () => {
  assert.deepEqual(atomizeClaims(''), []);
  assert.deepEqual(atomizeClaims('   \n  '), []);
  assert.deepEqual(atomizeClaims(null), []);
});

test('claimSupport: grounded claim scores high, fabricated claim scores low (lexical)', () => {
  const grounded = claimSupport('Shulgin authored PiHKAL and TiHKAL', CTX);
  const fabricated = claimSupport('Shulgin piloted a rocket to the planet Jupiter', CTX);
  assert.ok(grounded >= 0.5, `grounded should be high, got ${grounded}`);
  assert.ok(fabricated < 0.5, `fabricated should be low, got ${fabricated}`);
  assert.ok(grounded > fabricated);
});

test('claimSupport accepts string, array, and {text}[] context', () => {
  const s = claimSupport('chemist Shulgin authored PiHKAL', CTX[1]);
  const a = claimSupport('chemist Shulgin authored PiHKAL', CTX);
  const o = claimSupport('chemist Shulgin authored PiHKAL', [{ text: CTX[1] }]);
  assert.ok(s > 0 && a > 0 && o > 0);
});

test('faithfulness edge cases: no claims → 1, claims + no context → 0', () => {
  assert.equal(faithfulness('', CTX), 1);
  assert.equal(faithfulness('   ', CTX), 1);
  assert.equal(faithfulness('Shulgin wrote PiHKAL.', []), 0);
  assert.equal(faithfulness('Shulgin wrote PiHKAL.', ''), 0);
});

test('faithfulness: grounded answer > hallucinated answer', () => {
  const grounded = faithfulness('Shulgin was an American chemist who authored PiHKAL and TiHKAL.', CTX);
  const hallucinated = faithfulness('Shulgin was a Russian astronaut who flew to Mars and won a Nobel Prize.', CTX);
  assert.ok(grounded > hallucinated, `grounded ${grounded} should beat hallucinated ${hallucinated}`);
  assert.ok(grounded >= 0.6);
});

test('verifyCitations attributes each claim to its best source and lists unsupported ones', () => {
  const citations = [
    { text: 'Alexander Shulgin was an American medicinal chemist born in 1925 in Berkeley.', source: 'src:bio' },
    { text: 'He authored the books PiHKAL and TiHKAL with his wife Ann Shulgin.', source: 'src:books' },
  ];
  const answer = 'Shulgin was an American chemist. He authored PiHKAL and TiHKAL. He won a Nobel Prize in 1990.';
  const r = verifyCitations(answer, citations);

  assert.equal(r.claims.length, 3);

  const bio = r.claims.find((c) => /american chemist/i.test(c.claim));
  const books = r.claims.find((c) => /PiHKAL/i.test(c.claim));
  const nobel = r.claims.find((c) => /nobel/i.test(c.claim));

  assert.ok(bio && bio.supported && bio.bestSource === 'src:bio', JSON.stringify(bio));
  assert.ok(books && books.supported && books.bestSource === 'src:books', JSON.stringify(books));
  assert.ok(nobel && !nobel.supported, JSON.stringify(nobel));

  assert.ok(r.unsupported.some((c) => /nobel/i.test(c)));
  assert.ok(!r.unsupported.some((c) => /PiHKAL/i.test(c)));
  assert.ok(r.faithfulness > 0 && r.faithfulness <= 1);
});

test('verifyCitations threshold is configurable', () => {
  const citations = [{ text: 'Shulgin authored PiHKAL', source: 'a' }];
  const lenient = verifyCitations('Shulgin authored PiHKAL and TiHKAL', citations, { threshold: 0.1 });
  const strict = verifyCitations('Shulgin authored PiHKAL and TiHKAL', citations, { threshold: 0.99 });
  assert.ok(lenient.claims[0].supported);
  assert.ok(!strict.claims[0].supported);
});

test('verifyCitations accepts bare string citations (source null)', () => {
  const r = verifyCitations('Shulgin authored PiHKAL', ['Shulgin authored PiHKAL and TiHKAL']);
  assert.equal(r.claims.length, 1);
  assert.ok(r.claims[0].supported);
  assert.equal(r.claims[0].bestSource, null);
});

test('report produces a short human summary string', () => {
  const s = report('Shulgin was an American chemist who authored PiHKAL.', CTX);
  assert.equal(typeof s, 'string');
  assert.match(s, /faithfulness/i);
  assert.match(s, /\d+%/);
});

test('injected judge overrides the lexical path (sync)', () => {
  // Judge that inverts intuition: everything mentioning "PiHKAL" is UNsupported, else fully supported.
  __setJudge((claim) => (/pihkal/i.test(claim) ? 0.0 : 1.0));
  try {
    assert.equal(claimSupport('this mentions PiHKAL', CTX), 0);
    assert.equal(claimSupport('this mentions nothing notable', CTX), 1);
    const r = verifyCitations('It is sunny today. The book PiHKAL exists.', [{ text: CTX[1], source: 's' }]);
    const sunny = r.claims.find((c) => /sunny/i.test(c.claim));
    const pihkal = r.claims.find((c) => /pihkal/i.test(c.claim));
    assert.ok(sunny.supported, 'judge marks non-PiHKAL claim supported');
    assert.ok(!pihkal.supported, 'judge marks PiHKAL claim unsupported');
  } finally {
    __setJudge(null);
  }
});

test('injected async judge is awaited', async () => {
  __setJudge(async (claim) => (/pihkal/i.test(claim) ? 0.9 : 0.1));
  try {
    const s = await claimSupport('mentions PiHKAL', CTX);
    assert.equal(round2(s), 0.9);
    const f = await faithfulness('mentions PiHKAL', CTX);
    assert.equal(round2(f), 0.9);
    const r = await verifyCitations('mentions PiHKAL', [{ text: CTX[1], source: 's' }]);
    assert.ok(r.claims[0].supported);
    assert.equal(r.claims[0].bestSource, 's');
  } finally {
    __setJudge(null);
  }
  function round2(x) { return Math.round(x * 100) / 100; }
});

test('a throwing judge soft-falls back to lexical', () => {
  __setJudge(() => { throw new Error('judge down'); });
  try {
    const s = claimSupport('Shulgin authored PiHKAL and TiHKAL', CTX);
    assert.ok(s >= 0.5, `expected lexical fallback to score high, got ${s}`);
  } finally {
    __setJudge(null);
  }
});
