// claim-extract.test.mjs — offline tests for the factual-claim extractor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, splitSentences, hasFactualMarkers, claimScore, extractClaims, isOpinion,
} from './claim-extract.mjs';

test('esc escapes HTML metacharacters and nullish input', () => {
  assert.equal(esc('<b>"x"&\'y\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('splitSentences handles . ! ? and trims', () => {
  const out = splitSentences('First sentence. Second one! Third?');
  assert.deepEqual(out, ['First sentence.', 'Second one!', 'Third?']);
});

test('splitSentences guards abbreviations and decimals', () => {
  const out = splitSentences('Dr. Hathor met Mrs. Smith in 2026. The fee was 3.14 dollars.');
  assert.equal(out.length, 2, JSON.stringify(out));
  assert.match(out[0], /Dr\. Hathor met Mrs\. Smith in 2026\./);
  assert.match(out[1], /3\.14 dollars/);
});

test('splitSentences soft-fails on garbage / non-string', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   '), []);
  assert.deepEqual(splitSentences(null), []);
  assert.deepEqual(splitSentences(42), []);
});

test('hasFactualMarkers detects numbers, dates, entities, copulas', () => {
  assert.equal(hasFactualMarkers('It was founded in 1999.'), true);
  assert.equal(hasFactualMarkers('The Eiffel Tower is in Paris.'), true);
  assert.equal(hasFactualMarkers('wow ok cool'), false);
  assert.equal(hasFactualMarkers(null), false);
});

test('factual sentence scores higher than opinion', () => {
  const fact = claimScore('The MELEK chain launched in June 2026.');
  const op = claimScore('I think this chain is amazing.');
  assert.ok(fact > op, `fact ${fact} should beat opinion ${op}`);
  assert.ok(fact > 0.3);
});

test('hedged claims are demoted below their unhedged form', () => {
  const firm = claimScore('Hathor produced 5000 blocks on the testnet.');
  const hedged = claimScore('Hathor maybe produced 5000 blocks on the testnet, I think.');
  assert.ok(hedged < firm, `hedged ${hedged} should be < firm ${firm}`);
});

test('isOpinion flags first-person and evaluative, not bare facts', () => {
  assert.equal(isOpinion('I love this design.'), true);
  assert.equal(isOpinion('This is the best chain ever.'), true);
  assert.equal(isOpinion('The chain launched in 2026.'), false);
  assert.equal(isOpinion(''), false);
  assert.equal(isOpinion(null), false);
});

test('extractClaims returns sorted records with text/score/markers', () => {
  const text =
    'The MELEK testnet launched in June 2026. I think it is beautiful. ' +
    'Hathor is a witness account located on the chain.';
  const claims = extractClaims(text);
  assert.ok(claims.length >= 2);
  // sorted descending by score
  for (let i = 1; i < claims.length; i++) {
    assert.ok(claims[i - 1].score >= claims[i].score);
  }
  // shape
  assert.ok('text' in claims[0] && 'score' in claims[0] && Array.isArray(claims[0].markers));
  // the opinion sentence should not be the top claim
  assert.doesNotMatch(claims[0].text, /I think it is beautiful/);
});

test('minScore filter drops weak claims', () => {
  const text = 'The chain launched in 2026. wow ok.';
  const loose = extractClaims(text, { minScore: 0 });
  const strict = extractClaims(text, { minScore: 0.9 });
  assert.ok(loose.length >= strict.length);
  assert.ok(strict.length <= loose.length);
});

test('extracted claim text is safe to esc() for HTML output', () => {
  const text = 'The site <melek.salon> launched in 2026 and is live.';
  const claims = extractClaims(text);
  assert.ok(claims.length >= 1);
  const html = esc(claims[0].text);
  assert.doesNotMatch(html, /<melek/);
  assert.match(html, /&lt;melek\.salon&gt;/);
});

test('extractClaims soft-fails on non-string / empty', () => {
  assert.deepEqual(extractClaims(''), []);
  assert.deepEqual(extractClaims(null), []);
  assert.deepEqual(extractClaims(undefined), []);
  assert.deepEqual(extractClaims(12345), []);
});
