// self-fix-loop.test.mjs — offline tests for the annals→briefs→itinerary reconciler.
// node --test tools/self-fix-loop.test.mjs   (fully offline, no network)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextCorrection, renderReport, esc, __setReader } from './self-fix-loop.mjs';

test('stale: itinerary still lists a subject an annal records done', () => {
  const r = nextCorrection({
    annals: ['Price feed shipped'],
    briefs: [],
    itinerary: ['Price feed'],
  });
  const stale = r.corrections.filter(c => c.kind === 'stale');
  assert.equal(stale.length, 1);
  assert.equal(stale[0].subject, 'Price feed');
  assert.match(stale[0].suggestion, /done/);
  assert.deepEqual(stale[0].sources, ['itinerary']);
  assert.equal(r.counts.stale, 1);
});

test('stale NOT emitted when the claim itself is marked done', () => {
  const r = nextCorrection({
    annals: ['Block production'],
    itinerary: [{ subject: 'Block production', status: 'done' }],
  });
  assert.equal(r.corrections.length, 0);
  assert.match(r.note, /reconciled/);
});

test('missing: a tracked subject with no annal evidence is still owed', () => {
  const r = nextCorrection({
    annals: [],
    briefs: ['Karma database'],
    itinerary: [],
  });
  const missing = r.corrections.filter(c => c.kind === 'missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].subject, 'Karma database');
  assert.deepEqual(missing[0].sources, ['brief']);
});

test('untracked: an annal subject no brief/itinerary covers gets flagged', () => {
  const r = nextCorrection({
    annals: ['Discord testnet bridge'],
    briefs: [],
    itinerary: [],
  });
  const untracked = r.corrections.filter(c => c.kind === 'untracked');
  assert.equal(untracked.length, 1);
  assert.equal(untracked[0].subject, 'Discord testnet bridge');
  assert.deepEqual(untracked[0].sources, ['annal']);
});

test('matching is fuzzy across punctuation/case/whitespace', () => {
  const r = nextCorrection({
    annals: ['The   PRICE-FEED!'],
    itinerary: ['price feed'],
  });
  // should reconcile as stale (same normalized key), not split into missing+untracked.
  assert.equal(r.counts.stale, 1);
  assert.equal(r.counts.missing, 0);
  assert.equal(r.counts.untracked, 0);
});

test('ranking: stale before untracked before missing', () => {
  const r = nextCorrection({
    annals: ['Alpha done', 'Gamma untracked'],
    itinerary: ['Alpha done', 'Beta missing'],
  });
  const kinds = r.corrections.map(c => c.kind);
  assert.deepEqual(kinds, ['stale', 'untracked', 'missing']);
});

test('briefs + itinerary provenance merges into one claim', () => {
  const r = nextCorrection({
    annals: [],
    briefs: ['Witness monitor'],
    itinerary: ['witness monitor'],
  });
  const missing = r.corrections.filter(c => c.kind === 'missing');
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].sources, ['brief', 'itinerary']);
});

test('empty input soft-fails to no corrections, never throws', () => {
  const r = nextCorrection({});
  assert.deepEqual(r.corrections, []);
  assert.match(r.note, /reconciled/);
  assert.deepEqual(r.totals, { annals: 0, briefs: 0, itinerary: 0 });
});

test('garbage / non-array / null input soft-fails', () => {
  assert.doesNotThrow(() => nextCorrection({ annals: 'nope', briefs: 42, itinerary: null }));
  const r = nextCorrection({ annals: [null, '', {}, 7, { subject: '' }] });
  assert.deepEqual(r.corrections, []);
});

test('object items with name/title fields are read', () => {
  const r = nextCorrection({
    annals: [{ name: 'Tutorial stages' }],
    itinerary: [{ title: 'tutorial stages' }],
  });
  assert.equal(r.counts.stale, 1);
});

test('falls back to injected reader when called with no args', () => {
  __setReader(() => ({ annals: ['Z'], briefs: [], itinerary: ['Z'] }));
  const r = nextCorrection();
  assert.equal(r.counts.stale, 1);
  __setReader(null); // reset to default
  const r2 = nextCorrection();
  assert.deepEqual(r2.corrections, []);
});

test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

test('renderReport escapes subjects and is well-formed', () => {
  const r = nextCorrection({ annals: [], itinerary: ['<script>evil</script>'] });
  const html = renderReport(r);
  assert.match(html, /self-fix-loop/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('renderReport soft-fails on garbage', () => {
  assert.doesNotThrow(() => renderReport(null));
  assert.doesNotThrow(() => renderReport({}));
});
