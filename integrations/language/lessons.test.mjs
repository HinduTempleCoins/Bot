// lessons.test.mjs — offline tests for the Hathor Language Center curriculum + engine.
// node --test, fully offline, deterministic (now injected), soft-fail. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as L from './lessons.mjs';

test('COURSES seeds 3 languages, each with 3+ real lessons of real vocab', () => {
  const ids = L.listCourses();
  assert.ok(ids.includes('es') && ids.includes('ku') && ids.includes('fr'), 'es/ku/fr present');
  for (const id of ids) {
    const c = L.getCourse(id);
    assert.ok(c.lessons.length >= 3, `${id} has 3+ lessons`);
    for (const lesson of c.lessons) {
      assert.ok((lesson.vocab || []).length >= 3, `${id} L${lesson.n} has real vocab`);
      for (const v of lesson.vocab) {
        assert.ok(v.word && v.translation, 'vocab has word+translation');
      }
    }
  }
});

test('seeded content is REAL (known words present)', () => {
  const ku = L.getCourse('ku');
  const words = ku.lessons.flatMap((l) => l.vocab.map((v) => v.word));
  assert.ok(words.includes('silav'), 'Kurdish "silav" (hello) seeded');
  assert.ok(words.includes('spas'), 'Kurdish "spas" (thank you) seeded');
  const es = L.getCourse('es').lessons.flatMap((l) => l.vocab.map((v) => v.word));
  assert.ok(es.includes('gracias'), 'Spanish "gracias" seeded');
});

test('getLesson fetches a lesson and returns null for a missing one', () => {
  assert.equal(L.getLesson('fr', 2).title, 'Numbers 1–10');
  assert.equal(L.getLesson('fr', 99), null);
  assert.equal(L.getLesson('nope', 1), null);
});

test('scoreAnswer: exact normalized match is correct, score 1', () => {
  const r = L.scoreAnswer('  Gracias! ', 'gracias');
  assert.equal(r.correct, true);
  assert.equal(r.score, 1);
});

test('scoreAnswer: accents are folded (silav vs SÍLAV)', () => {
  assert.equal(L.scoreAnswer('sílav', 'silav').correct, true);
});

test('scoreAnswer: a single typo is forgiven (close match)', () => {
  const r = L.scoreAnswer('gracia', 'gracias'); // one missing letter → edit distance 1
  assert.equal(r.correct, true);
  assert.equal(r.close, true);
  assert.ok(r.score < 1 && r.score > 0.5);
});

test('scoreAnswer: a wrong answer is rejected', () => {
  const r = L.scoreAnswer('hola', 'gracias');
  assert.equal(r.correct, false);
});

test('scoreAnswer: empty/garbage input never throws and is not correct', () => {
  assert.equal(L.scoreAnswer(null, 'gracias').correct, false);
  assert.equal(L.scoreAnswer('gracias', '').correct, false);
  assert.equal(L.scoreAnswer(undefined, undefined).correct, false);
});

test('SRS schedules a WRONG answer sooner than a RIGHT one', () => {
  const item = L.freshItem(0);
  const wrong = L.srsSchedule({ item, grade: 1, now: 0 });
  const right = L.srsSchedule({ item, grade: 5, now: 0 });
  assert.ok(wrong.interval < right.interval, 'wrong interval < right interval');
  assert.ok(Date.parse(wrong.due) <= Date.parse(right.due), 'wrong is due no later than right');
  assert.equal(wrong.lapses, 1, 'a miss counts as a lapse');
});

test('SRS grows the interval across successive correct reps (1 → 6 → more)', () => {
  let item = L.freshItem(0);
  item = L.srsSchedule({ item, grade: 5, now: 0 });
  assert.equal(item.interval, 1);
  item = L.srsSchedule({ item, grade: 5, now: 0 });
  assert.equal(item.interval, 6);
  item = L.srsSchedule({ item, grade: 5, now: 0 });
  assert.ok(item.interval > 6, 'third rep multiplies by ease');
});

test('SRS is deterministic + pure (does not mutate input, no wall clock)', () => {
  const item = L.freshItem(0);
  const snap = JSON.stringify(item);
  const a = L.srsSchedule({ item, grade: 4, now: 1000 });
  const b = L.srsSchedule({ item, grade: 4, now: 1000 });
  assert.deepEqual(a, b, 'same inputs → same output');
  assert.equal(JSON.stringify(item), snap, 'input not mutated');
});

test('SRS soft-fails on a malformed item (treated as fresh)', () => {
  const r = L.srsSchedule({ item: 'garbage', grade: 5, now: 0 });
  assert.equal(r.interval, 1);
  assert.equal(r.reps, 1);
});

test('deckFor flattens vocab + phrases into keyed cards; unknown → []', () => {
  const deck = L.deckFor('es');
  assert.ok(deck.length >= 15, 'es deck has many cards');
  assert.ok(deck.every((c) => c.key && c.prompt && c.answer), 'each card keyed with prompt+answer');
  assert.equal(L.deckFor('nope').length, 0);
});

test('nextDue picks the earliest-due card', () => {
  const deck = [
    { key: 'a', item: { due: new Date(5000).toISOString() } },
    { key: 'b', item: { due: new Date(1000).toISOString() } },
    { key: 'c', item: { due: new Date(9000).toISOString() } },
  ];
  const nd = L.nextDue(deck, 6000);
  assert.equal(nd.key, 'b', 'b is earliest due');
  assert.ok(nd.overdueMs > 0, 'b is overdue at now=6000');
  assert.equal(L.nextDue([], 0), null);
});

test('progress persists per learner (in-memory store, replayed)', () => {
  const store = L.memoryStore();
  L.__setStore(store);
  const key = L.deckFor('ku')[0].key;
  L.recordReview({ learner: 'alice', courseId: 'ku', key, grade: 5, now: 0 });
  L.recordReview({ learner: 'alice', courseId: 'ku', key, grade: 5, now: 86400000 });
  L.recordReview({ learner: 'bob', courseId: 'es', key: L.deckFor('es')[0].key, grade: 2, now: 0 });

  const pa = L.progress('alice');
  assert.equal(pa.totalReviews, 2);
  assert.equal(pa.totalCorrect, 2);
  assert.ok(pa.courses.ku, 'alice has ku progress');

  const pb = L.progress('bob');
  assert.equal(pb.totalReviews, 1);
  assert.equal(pb.totalCorrect, 0, 'bob missed');
  assert.notEqual(pa.totalReviews, pb.totalReviews, 'progress is per-learner');
});

test('recordReview builds on prior SRS state for the same key', () => {
  const store = L.memoryStore();
  L.__setStore(store);
  const key = L.deckFor('fr')[0].key;
  const i1 = L.recordReview({ learner: 'z', courseId: 'fr', key, grade: 5, now: 0 });
  assert.equal(i1.interval, 1, 'first correct → 1 day');
  const i2 = L.recordReview({ learner: 'z', courseId: 'fr', key, grade: 5, now: 0 });
  assert.equal(i2.interval, 6, 'second correct → 6 days (built on prior)');
});

test('jsonlStore persists + replays via injected fs (no real disk)', () => {
  const files = {};
  const fakeFs = {
    mkdirSync() {},
    appendFileSync(p, data) { files[p] = (files[p] || '') + data; },
    readFileSync(p) { if (files[p] == null) throw new Error('ENOENT'); return files[p]; },
  };
  const store = L.jsonlStore({ fs: fakeFs, path: '/virtual/progress.jsonl' });
  L.__setStore(store);
  const key = L.deckFor('es')[0].key;
  L.recordReview({ learner: 'carol', courseId: 'es', key, grade: 5, now: 0 });
  assert.ok(files['/virtual/progress.jsonl'].includes('carol'), 'wrote a JSONL line');
  // a fresh store over the same fs replays the same events
  const store2 = L.jsonlStore({ fs: fakeFs, path: '/virtual/progress.jsonl' });
  assert.equal(L.progress('carol', store2).totalReviews, 1);
});

test('esc() escapes XSS-y content', () => {
  assert.equal(L.esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('module-level API never throws on bad input', () => {
  assert.doesNotThrow(() => {
    L.getCourse(undefined); L.getLesson(null, null); L.deckFor(null);
    L.scoreAnswer({}, []); L.srsSchedule({}); L.nextDue(null, NaN);
    L.progress(undefined); L.learnerDeck(null, null);
  });
});
