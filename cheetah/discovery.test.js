// discovery.test.js — Cheetah Step 5 (librarian mode). Proves the relatedness
// BAND logic: copies belong to detection, unrelated posts get silence, only the
// in-between "see also" band produces a librarian note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relatedInCorpus, composeLibrarianNote, discover, RELATEDNESS_FLOOR } from './discovery.js';

const PRIOR = {
  author: 'alice',
  permlink: 'graphene-dpos-primer',
  body: 'Graphene-family chains rely on delegated proof-of-stake. Witnesses are elected by stake-weighted voting and produce blocks in a round-robin schedule. Block intervals are three seconds.',
};

test('a near-copy is NOT "related" — it is above the ceiling (detection territory)', () => {
  const nearCopy = { author: 'bob', permlink: 'x', body: PRIOR.body + ' I agree.' };
  const related = relatedInCorpus(nearCopy.body, [PRIOR]);
  assert.equal(related.length, 0); // belongs to text-detection, not the librarian band
});

test('a topically-overlapping but original post lands in the related band', () => {
  const overlapping = {
    author: 'carol', permlink: 'y',
    body: 'Delegated proof-of-stake elects witnesses by stake-weighted voting. I want to talk about why three second blocks feel fast to users and what that means for wallet UX and confirmation design.',
  };
  const related = relatedInCorpus(overlapping.body, [PRIOR]);
  assert.equal(related.length, 1);
  assert.equal(related[0].author, 'alice');
  assert.ok(related[0].score >= RELATEDNESS_FLOOR);
});

test('an unrelated post produces no related entries and an empty note', () => {
  const unrelated = { author: 'dave', permlink: 'z', body: 'I bought bananas at the store and the cashier was kind. Bananas are a good fruit.' };
  const { related, note } = discover(unrelated, { corpus: [PRIOR] });
  assert.equal(related.length, 0);
  assert.equal(note, '');
});

test('the librarian note links the source and frames it as a connection, not a claim', () => {
  const note = composeLibrarianNote([{ author: 'alice', permlink: 'graphene-dpos-primer', score: 0.3, why: 'shared-material' }]);
  assert.match(note, /@alice\/graphene-dpos-primer/);
  assert.match(note, /connection, not a claim/i);
  assert.match(note, /30% shared material/);
});

test('MAX_RELATED caps the see-also list', () => {
  const corpus = Array.from({ length: 6 }, (_, i) => ({
    author: `a${i}`, permlink: `p${i}`,
    body: 'Delegated proof of stake witnesses stake weighted voting round robin blocks three seconds confirmation wallet ' + 'x'.repeat(i),
  }));
  const related = relatedInCorpus(PRIOR.body, corpus, { max: 3 });
  assert.ok(related.length <= 3);
});
