// memory-recall.test.mjs — the floor→Memory bridge: attachRecall + renderWithContext, offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachRecall, renderWithContext, esc } from './memory-recall.mjs';
import { buildFloor } from './rules-floor.mjs';

// A fake Memory index: records its queries, returns canned hits. No db/embed/network.
function fakeIndex(hitsFor = (q) => [{ id: `h:${q}`, text: `recalled ${q}`, meta: {}, score: 0.5 }]) {
  const calls = [];
  return {
    calls,
    async recall(query, opts = {}) {
      calls.push({ query, k: opts.k });
      return hitsFor(query, opts);
    },
  };
}

const sampleFloor = () =>
  buildFloor([
    { id: 'ip1', file: 'witness/m.mjs', text: 'finish the witness monitor', status: 'in_progress' },
    { id: 'op1', file: 'signup/help.mjs', text: 'wire signup help', status: 'open' },
    { id: 'bl1', file: 'x.md', text: 'blocked thing', status: 'blocked' },
  ]);

test('attachRecall: enriches top items, preserves floor order (readFirst before doNext)', async () => {
  const floor = sampleFloor();
  const idx = fakeIndex();
  const recalls = await attachRecall(floor, idx, { k: 3 });
  // readFirst (ip1) comes before doNext (op1); blocked is not pulled by default
  assert.deepEqual(recalls.map((r) => r.item.id), ['ip1', 'op1']);
  assert.equal(recalls[0].related.length, 1);
  assert.equal(recalls[0].related[0].id, 'h:finish the witness monitor');
});

test('attachRecall: passes k through to the index recall', async () => {
  const idx = fakeIndex();
  await attachRecall(sampleFloor(), idx, { k: 7 });
  assert.ok(idx.calls.length >= 1);
  for (const c of idx.calls) assert.equal(c.k, 7);
});

test('attachRecall: default k is 3 when not given / invalid', async () => {
  const idx = fakeIndex();
  await attachRecall(sampleFloor(), idx, { k: 0 });
  assert.equal(idx.calls[0].k, 3);
  const idx2 = fakeIndex();
  await attachRecall(sampleFloor(), idx2);
  assert.equal(idx2.calls[0].k, 3);
});

test('attachRecall: top caps the number of enriched items', async () => {
  const floor = buildFloor([
    { id: 'o1', text: 'one', status: 'open' },
    { id: 'o2', text: 'two', status: 'open' },
    { id: 'o3', text: 'three', status: 'open' },
  ]);
  const idx = fakeIndex();
  const recalls = await attachRecall(floor, idx, { top: 2 });
  assert.equal(recalls.length, 2);
});

test('attachRecall: custom sections selects which buckets to enrich', async () => {
  const floor = sampleFloor();
  const idx = fakeIndex();
  const recalls = await attachRecall(floor, idx, { sections: ['blocked'] });
  assert.deepEqual(recalls.map((r) => r.item.id), ['bl1']);
});

test('attachRecall: a throwing recall soft-fails to related=[] (never throws)', async () => {
  const idx = { recall: async () => { throw new Error('boom'); } };
  const recalls = await attachRecall(sampleFloor(), idx, { k: 2 });
  assert.equal(recalls.length, 2);
  for (const r of recalls) assert.deepEqual(r.related, []);
});

test('attachRecall: missing / non-recall index → all related empty, no throw', async () => {
  for (const bad of [null, undefined, {}, { recall: 42 }]) {
    const recalls = await attachRecall(sampleFloor(), bad, { k: 2 });
    assert.equal(recalls.length, 2);
    for (const r of recalls) assert.deepEqual(r.related, []);
  }
});

test('attachRecall: item with empty text is not queried but still returned', async () => {
  const floor = buildFloor([{ id: 'blank', text: '', status: 'in_progress' }]);
  const idx = fakeIndex();
  const recalls = await attachRecall(floor, idx, { k: 2 });
  assert.equal(recalls.length, 1);
  assert.equal(recalls[0].item.id, 'blank');
  assert.deepEqual(recalls[0].related, []);
  assert.equal(idx.calls.length, 0); // never queried with a blank string
});

test('attachRecall: garbage floor → [] , never throws', async () => {
  for (const bad of [null, undefined, 42, 'x', {}]) {
    const recalls = await attachRecall(bad, fakeIndex(), { k: 2 });
    assert.deepEqual(recalls, []);
  }
});

test('renderWithContext: includes the floor skeleton and a related-context section', async () => {
  const floor = sampleFloor();
  const recalls = await attachRecall(floor, fakeIndex(), { k: 1 });
  const md = renderWithContext(floor, recalls);
  assert.match(md, /## Brief skeleton \(deterministic floor\)/);
  assert.match(md, /## Related past context/);
  assert.match(md, /`ip1`/);
  assert.match(md, /recalled finish the witness monitor/);
});

test('renderWithContext: shows the recall score when present', async () => {
  const floor = buildFloor([{ id: 'o1', text: 'do a thing', status: 'open' }]);
  const idx = fakeIndex(() => [{ id: 'a', text: 'past', meta: {}, score: 0.876 }]);
  const recalls = await attachRecall(floor, idx, { k: 1 });
  const md = renderWithContext(floor, recalls);
  assert.match(md, /_\(0\.88\)_/); // toFixed(2)
});

test('renderWithContext: empty / no-hit recalls → placeholder, never throws', () => {
  const floor = sampleFloor();
  assert.match(renderWithContext(floor, []), /_\(no related past context recalled\)_/);
  assert.match(renderWithContext(floor, null), /_\(no related past context recalled\)_/);
  // items present but every related is empty
  const empties = [{ item: { id: 'x', text: 't' }, related: [] }];
  assert.match(renderWithContext(floor, empties), /_\(no related past context recalled\)_/);
});

test('renderWithContext: garbage floor still renders a valid section, never throws', () => {
  const md = renderWithContext(null, [{ item: { id: 'x', text: 't' }, related: [{ id: 'h', text: 'hit' }] }]);
  assert.match(md, /## Related past context/);
  assert.match(md, /`x`/);
  assert.ok(md.endsWith('\n'));
});

test('renderWithContext: byte-stable for identical input', async () => {
  const floor = sampleFloor();
  const recalls = await attachRecall(floor, fakeIndex(), { k: 1 });
  assert.equal(renderWithContext(floor, recalls), renderWithContext(floor, recalls));
});

test('renderWithContext: esc() escapes HTML in item text and recall hits', () => {
  const floor = buildFloor([{ id: 'o1', text: '<b>danger</b>', status: 'open' }]);
  const recalls = [{ item: { id: 'o1', text: '<b>danger</b>' }, related: [{ id: '<i>', text: '<script>x</script>' }] }];
  const md = renderWithContext(floor, recalls);
  assert.ok(!md.includes('<script>'));
  assert.match(md, /&lt;script&gt;/);
  assert.match(md, /&lt;i&gt;/);
});

test('esc: re-exported and escapes the five entities', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});
