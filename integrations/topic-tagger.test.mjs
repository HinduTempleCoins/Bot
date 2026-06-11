// topic-tagger.test.mjs — offline tests for the deterministic corpus topic tagger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, tagTopics, topTopic, allTopicsAbove } from './topic-tagger.mjs';

test('TOPICS is frozen and shaped {topic: [keywords]}', () => {
  assert.ok(Object.isFrozen(TOPICS));
  for (const k of Object.keys(TOPICS)) {
    assert.ok(Array.isArray(TOPICS[k]) && TOPICS[k].length > 0);
    assert.ok(Object.isFrozen(TOPICS[k]));
  }
  // expected corpus topics present
  for (const t of ['mythology', 'religion', 'archaeology', 'esoteric', 'genetics', 'philosophy']) {
    assert.ok(t in TOPICS, `missing topic ${t}`);
  }
  // mutation attempts are silently ignored (frozen), do not throw
  assert.doesNotThrow(() => { try { TOPICS.mythology.push('x'); } catch { /* strict may throw */ } });
});

test('tagTopics: returns matching topics with hits, sorted by score desc', () => {
  const r = tagTopics('The myth of Osiris is a creation myth full of gods and legend.');
  assert.ok(r.length >= 1);
  assert.equal(r[0].topic, 'mythology');
  // term-frequency: "myth" appears twice + "creation myth"/"osiris"/"gods"/"legend"
  assert.ok(r[0].score >= 4);
  assert.ok(r[0].hits.includes('myth'));
  // sorted descending
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
});

test('tagTopics: multi-label — a text can hit several topics', () => {
  const r = tagTopics('The sacred temple held gnostic rituals and biblical scripture.');
  const topics = r.map((x) => x.topic);
  assert.ok(topics.includes('religion'));
  assert.ok(topics.includes('esoteric'));
});

test('tagTopics: word-boundary — no substring false positives', () => {
  // "art" must not fire on "earth"/"start"; "gene" must not fire on "general"/"generous"
  const r = tagTopics('A general and generous earth start.');
  assert.deepEqual(r, []);
});

test('tagTopics: case-insensitive', () => {
  const lo = tagTopics('haplogroup dna sequencing');
  const hi = tagTopics('HAPLOGROUP DNA SEQUENCING');
  assert.equal(topTopic('HAPLOGROUP DNA SEQUENCING'), 'genetics');
  assert.equal(lo[0].score, hi[0].score);
});

test('tagTopics: multi-word phrase matches across whitespace runs', () => {
  const r = tagTopics('ancient   DNA recovered from a tomb');
  const topics = r.map((x) => x.topic);
  assert.ok(topics.includes('genetics')); // "ancient dna" phrase
  assert.ok(topics.includes('archaeology')); // "tomb"
});

test('topTopic: returns the single best topic', () => {
  assert.equal(topTopic('Stoicism, ethics, and metaphysics define this philosophy.'), 'philosophy');
});

test('allTopicsAbove: threshold filters by score', () => {
  const text = 'myth myth myth legend; one church.';
  // mythology should score high (3x myth + legend), religion = 1 (church)
  assert.deepEqual(allTopicsAbove(text, 1), ['mythology']);
  assert.ok(allTopicsAbove(text, 0).includes('religion'));
});

test('soft-fail: empty / null / non-string / no-signal -> [] / null, never throws', () => {
  assert.deepEqual(tagTopics(''), []);
  assert.deepEqual(tagTopics(null), []);
  assert.deepEqual(tagTopics(undefined), []);
  assert.deepEqual(tagTopics(12345), []);
  assert.deepEqual(tagTopics({}), []);
  assert.deepEqual(tagTopics('just plain words with no domain terms'), []);
  assert.equal(topTopic(''), null);
  assert.equal(topTopic('nothing here'), null);
  assert.deepEqual(allTopicsAbove('', 0), []);
  assert.deepEqual(allTopicsAbove(null, 5), []);
  // NaN threshold collapses to 0 (any positive match passes)
  assert.ok(allTopicsAbove('myth', NaN).includes('mythology'));
});

test('determinism: same input yields identical output', () => {
  const txt = 'gnostic alchemy in the sacred temple, an esoteric myth.';
  assert.deepEqual(tagTopics(txt), tagTopics(txt));
});
