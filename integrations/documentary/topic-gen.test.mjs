import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, prioritise, validateTopic, defineTopic, MUST_HAVE } from './topic-gen.mjs';

test('the month queue: must-haves first, hundreds of 10-min films, 30s and 60s, groups and maps', () => {
  const q = buildQueue({ remakeGroups: ['Greece & Scheria', 'Nubia'], maps: [{ id: 'rome', title: 'Rome' }] });
  const by = (m) => q.filter((e) => e.minutes === m).length;
  assert.ok(by(10) >= 150, `10-min ${by(10)}`);
  assert.ok(by(30) >= 30, `30-min ${by(30)}`);
  assert.ok(by(60) >= 15, `60-min ${by(60)}`);
  assert.equal(new Set(q.map((e) => e.docId)).size, q.length);
  for (const id of ['scheria-30', 'nausicaa', 'atlantis-30', 'atlantis-ring-city', 'sais-neith', 'watchers-30', 'hermon-watchers', 'giants-of-enoch', 'enoch-journeys', 'left-habitation-30', 'petition-watchers', 'demons-origin', 'scenes-greece-scheria', 'map-rome']) assert.ok(q.some((e) => e.docId === id), id);
  const order = prioritise(q, { rng: () => 0.5 });
  assert.deepEqual(order.slice(0, 12).map((e) => e.docId).sort(), ['atlantis-30', 'atlantis-ring-city', 'nausicaa', 'sais-neith', 'scheria-30', 'watchers-30', 'hermon-watchers', 'giants-of-enoch', 'enoch-journeys', 'left-habitation-30', 'petition-watchers', 'demons-origin'].sort());
  assert.ok(!order.some((e) => e.minutes === 60), '60-min waits for a published 30-min film');
  assert.ok(prioritise(q, { published: new Set(['scheria-30']), rng: () => 0.5 }).some((e) => e.minutes === 60));
});

test('feedback: a thumbs-down pattern drops an arm; published films leave the queue', () => {
  const q = buildQueue();
  const docArms = { 'egypt-daily': 'egypt' };
  const order = prioritise(q, { feedback: { films: { 'egypt-daily': { up: 0, down: 4 } } }, docArms, published: new Set(['nausicaa']), rng: () => 0.5 });
  assert.ok(!order.some((e) => e.arm === 'egypt'));
  assert.ok(!order.some((e) => e.docId === 'nausicaa'));
});

test('topic definitions are validated into the topics.mjs shape (tags, sources, outline minutes)', async () => {
  const entry = MUST_HAVE.find((m) => m.id === 'nausicaa');
  const e = { docId: 'nausicaa', name: entry.name, hint: entry.hint, minutes: 10, region: 'aegean', peoples: 'greek', arm: 'nausicaa' };
  const facts = Array.from({ length: 8 }, (_, i) => ({ id: `F ${i}`, tag: i % 2 ? 'record' : 'tradition', source: 'Homer, Odyssey 6', text: `fact ${i}`, card: 'c', visual: 'v' }));
  const good = { title: 'Nausicaa', summary: 's', facts: [...facts, { id: 'bad', tag: 'rumour', source: 'x', text: 'y' }], outline: [{ title: 'A', minutes: 4, facts: ['f-0', 'f-1'] }, { title: 'B', minutes: 6, facts: ['f-2', 'nope'] }] };
  const t = validateTopic(good, e);
  assert.equal(t.facts.length, 8);
  assert.deepEqual(t.outline.map((o) => o.minutes), [4, 6]);
  assert.deepEqual(t.outline[1].facts, ['f-2']);
  assert.equal(validateTopic({ facts: [], outline: [] }, e), null);
  let calls = 0;
  const got = await defineTopic(e, async () => { calls++; return { text: calls === 1 ? 'not json' : JSON.stringify(good) }; });
  assert.equal(calls, 2);
  assert.equal(got.id, 'nausicaa');
});
