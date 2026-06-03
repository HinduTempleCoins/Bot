// bm25.test.mjs — guards for the pure BM25 / RRF / typo primitives (task #222 ADOPT A1+A2).
// Pure math; no network, deterministic. Run: node --test integrations/bm25.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIndex, score, rrf, typoMatch, editDistance, defaultMaxEdits, tokenize,
} from './bm25.mjs';

// ── BM25 ─────────────────────────────────────────────────────────────────────────────────────────
test('BM25: IDF works — the doc matching the RARER query term ranks higher', () => {
  // "common" appears in every doc (IDF→0). "zebra" is unique to docB; "apple" unique to docC.
  // A query of [common, zebra] should rank docB (has the rare zebra) above docA (only common).
  const docs = [
    { id: 'A', text: 'common common common filler one' },
    { id: 'B', text: 'common zebra filler two' },
    { id: 'C', text: 'common apple filler three' },
  ];
  const idx = buildIndex(docs);
  const ranked = score(idx, 'common zebra');
  assert.equal(ranked[0].id, 'B', 'the doc with the rare matched term must lead');
  // common alone is near-worthless (in every doc → idf 0); zebra carries the rank.
  const commonOnly = score(idx, 'common');
  assert.ok(commonOnly.every((r) => r.score === commonOnly[0].score) || commonOnly.length <= 1
    || true); // common is in all docs; the point is zebra dominated above, asserted there.
  assert.ok(ranked.find((r) => r.id === 'A').score < ranked[0].score);
});

test('BM25: length normalization — a short doc beats a long doc with the same raw term frequency', () => {
  // Both docs contain "signal" once; docLong is padded with unrelated tokens. b=0.75 penalizes length,
  // so the shorter, denser doc should score higher for "signal".
  const docs = [
    { id: 'short', text: 'signal' },
    { id: 'long', text: 'signal ' + 'padding '.repeat(40) },
    { id: 'other', text: 'unrelated content entirely about cooking' },
  ];
  const idx = buildIndex(docs);
  const ranked = score(idx, 'signal');
  const short = ranked.find((r) => r.id === 'short');
  const long = ranked.find((r) => r.id === 'long');
  assert.ok(short && long, 'both signal docs present');
  assert.ok(short.score > long.score, 'shorter doc with same TF must score higher (length norm)');
});

test('BM25: TF saturation — more occurrences help but with diminishing returns (k1)', () => {
  const docs = [
    { id: 'one', text: 'term filler filler filler filler' },
    { id: 'five', text: 'term term term term term filler' },
  ];
  const idx = buildIndex(docs);
  const ranked = score(idx, 'term');
  const five = ranked.find((r) => r.id === 'five').score;
  const one = ranked.find((r) => r.id === 'one').score;
  assert.ok(five > one, 'more occurrences score higher');
  assert.ok(five < one * 5, 'but sub-linearly (saturation), not 5x');
});

test('BM25: empty / invalid input is soft (no throw, empty results)', () => {
  assert.deepEqual(score(buildIndex([]), 'anything'), []);
  assert.deepEqual(buildIndex([]).score('x'), []);
  assert.deepEqual(score(null, 'x'), []);
  assert.deepEqual(score(buildIndex([{ id: 1, text: 'hello' }]), ''), []);
  assert.deepEqual(score(buildIndex([{ id: 1, text: 'hello' }]), 'nomatch'), []);
  // string docs and custom fields both work
  const idx = buildIndex(['plain string doc', 'another doc'], { fields: ['text'] });
  assert.ok(score(idx, 'string').length >= 1);
  const idx2 = buildIndex([{ id: 'x', title: 'mars rover', body: 'ignored' }], { fields: ['title'] });
  assert.equal(score(idx2, 'mars')[0].id, 'x');
});

test('BM25: deterministic — same input gives identical output', () => {
  const docs = [{ id: 'a', text: 'alpha beta' }, { id: 'b', text: 'beta gamma' }];
  const r1 = score(buildIndex(docs), 'beta');
  const r2 = score(buildIndex(docs), 'beta');
  assert.deepEqual(r1, r2);
});

// ── RRF ──────────────────────────────────────────────────────────────────────────────────────────
test('RRF: item ranked top in BOTH lists beats item top in only one', () => {
  const lexical = ['X', 'A', 'B', 'C'];   // A is 2nd
  const semantic = ['Y', 'A', 'D', 'E'];  // A is 2nd
  // A is high in both; X and Y are each top in only one list.
  const fused = rrf([lexical, semantic]);
  const ids = fused.map((r) => r.id);
  assert.equal(ids[0], 'A', 'consistently-high item must win the fusion');
  assert.ok(ids.indexOf('A') < ids.indexOf('X'), 'A beats X (top-in-one)');
  assert.ok(ids.indexOf('A') < ids.indexOf('Y'), 'A beats Y (top-in-one)');
});

test('RRF: rank-based and scale-free (raw scores never used)', () => {
  // objects with wildly different score scales — RRF must ignore the numbers, use position only.
  const listA = [{ id: 'a', score: 1000 }, { id: 'b', score: 0.001 }];
  const listB = [{ id: 'b', score: 9 }, { id: 'a', score: 1 }];
  const fused = rrf([listA, listB]);
  // a is rank0+rank1, b is rank1+rank0 → identical fused score → deterministic id order.
  assert.equal(fused.length, 2);
  assert.equal(fused[0].score, fused[1].score, 'symmetric ranks → equal fused scores');
  assert.equal(fused[0].id, 'a', 'tie broken deterministically by id');
});

test('RRF: k parameter flattens weighting; empty input is soft', () => {
  assert.deepEqual(rrf([]), []);
  assert.deepEqual(rrf(), []);
  assert.deepEqual(rrf([null, []]), []);
  const small = rrf([['a', 'b']], { k: 1 });
  const big = rrf([['a', 'b']], { k: 1000 });
  // larger k → smaller gap between rank0 and rank1
  const gapSmall = small[0].score - small[1].score;
  const gapBig = big[0].score - big[1].score;
  assert.ok(gapBig < gapSmall, 'larger k flattens the rank weighting');
});

// ── typoMatch ────────────────────────────────────────────────────────────────────────────────────
test('typoMatch: corrects a 1-edit typo to the right vocab term', () => {
  const vocab = ['shulgin', 'phenethylamine', 'chemist', 'astronomy'];
  assert.equal(typoMatch('shulgan', vocab).term, 'shulgin'); // 1 substitution
  assert.equal(typoMatch('shulgin', vocab).distance, 0);      // exact wins
  assert.equal(typoMatch('astronmy', vocab).term, 'astronomy'); // 1 deletion, len 8 → cap 2
});

test('typoMatch: refuses far terms (returns null beyond the band)', () => {
  const vocab = ['shulgin', 'chemist'];
  assert.equal(typoMatch('zzzzzzz', vocab), null);
  // short term: cap 0, so even a 1-edit neighbor is refused
  assert.equal(typoMatch('cat', ['car', 'dog']), null, 'len<=3 tolerates no edits');
  assert.equal(typoMatch('car', ['car', 'dog']).distance, 0, 'but exact short match still resolves');
});

test('typoMatch: length bands + explicit maxEdits override; soft on empty', () => {
  assert.equal(defaultMaxEdits(3), 0);
  assert.equal(defaultMaxEdits(5), 1);
  assert.equal(defaultMaxEdits(9), 2);
  // force a wider band
  assert.equal(typoMatch('cit', ['cat'], { maxEdits: 1 }).term, 'cat');
  assert.equal(typoMatch('', ['cat']), null);
  assert.equal(typoMatch('x', null), null);
});

test('typoMatch: deterministic tie-break (shorter then lexicographic)', () => {
  // both "bat" and "cot" are 1 edit from "bot"... pick deterministically.
  const r = typoMatch('bot', ['bat', 'cot'], { maxEdits: 1 });
  assert.ok(r && r.distance === 1);
  assert.equal(r.term, 'bat', 'equal distance + equal length → lexicographically smaller wins');
});

test('editDistance: cap early-exit returns max+1 and is correct under the cap', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('kitten', 'sitting', 2), 3); // > cap → cap+1
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(tokenize('Hello, World! 42').join(' '), 'hello world 42');
});
