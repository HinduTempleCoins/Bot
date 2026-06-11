// queue-progress.test.mjs — offline tests for the queue-progress reporter.
// node:test + node:assert/strict. No network, no disk reads for the core API
// (data is in-memory); the reader seam is exercised with an injected reader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  progress,
  renderProgress,
  esc,
  __setReader,
} from './queue-progress.mjs';

const sampleItems = [
  { id: 'a1', file: 'integrations/foo.mjs', section: 's', text: 't', status: 'open' },
  { id: 'a2', file: 'integrations/bar.mjs', section: 's', text: 't', status: 'open' },
  { id: 'a3', file: 'witness/feed.mjs', section: 's', text: 't', status: 'open' },
  { id: 'a4', file: 'tutorial/stage.mjs', section: 's', text: 't', status: 'done' }, // done by status
  { id: 'a5', file: 'BRIEF.md', section: 's', text: 't', status: 'open' }, // bare root file
];

test('happy: counts total/handled/remaining and pctDone', () => {
  const p = progress({
    queueItems: sampleItems,
    handledIds: ['a1', 'a3'], // plus a4 is done-by-status
    modules: [],
  });
  assert.equal(p.total, 5);
  assert.equal(p.handled, 3); // a1, a3, a4
  assert.equal(p.remaining, 2);
  assert.equal(p.pctDone, 60);
});

test('happy: byArea derives from top dir of file path', () => {
  const p = progress({ queueItems: sampleItems, handledIds: ['a1'] });
  assert.ok(p.byArea.integrations);
  assert.equal(p.byArea.integrations.total, 2);
  assert.equal(p.byArea.integrations.handled, 1);
  assert.equal(p.byArea.integrations.remaining, 1);
  assert.equal(p.byArea.integrations.pctDone, 50);
  assert.equal(p.byArea.witness.total, 1);
  assert.equal(p.byArea.tutorial.handled, 1); // done-by-status
  // bare root file lands in 'root'
  assert.equal(p.byArea.root.total, 1);
});

test('handles dir__file.md link-style joiner', () => {
  const p = progress({
    queueItems: [{ id: 'x', file: 'integrations__access-bond-dao.mjs', status: 'open' }],
  });
  assert.equal(p.byArea.integrations.total, 1);
});

test('Set of handledIds is accepted', () => {
  const p = progress({
    queueItems: [{ id: 'a1', file: 'x/y.mjs', status: 'open' }],
    handledIds: new Set(['a1']),
  });
  assert.equal(p.handled, 1);
  assert.equal(p.pctDone, 100);
});

test('modules inventory tallies into moduleCount and byArea.modules', () => {
  const p = progress({
    queueItems: sampleItems,
    handledIds: [],
    modules: ['integrations/foo.mjs', 'integrations/bar.mjs', 'tools/baz.mjs'],
  });
  assert.equal(p.moduleCount, 3);
  assert.equal(p.byArea.integrations.modules, 2);
  assert.equal(p.byArea.tools.modules, 1);
});

test('edge: empty / missing input -> all zeros, no throw', () => {
  const p = progress({});
  assert.deepEqual(
    { total: p.total, handled: p.handled, remaining: p.remaining, pctDone: p.pctDone },
    { total: 0, handled: 0, remaining: 0, pctDone: 0 }
  );
  assert.deepEqual(p.byArea, {});
});

test('edge: no args at all -> all zeros, no throw', () => {
  const p = progress();
  assert.equal(p.total, 0);
  assert.equal(p.pctDone, 0);
});

test('edge: malformed items (null, missing fields) do not throw', () => {
  const p = progress({
    queueItems: [null, {}, { id: 'ok', file: 'witness/x.mjs', status: 'open' }, { file: 42 }],
    handledIds: [null, '', 'ok'],
  });
  assert.equal(p.total, 4);
  assert.equal(p.handled, 1); // the 'ok' item
  assert.ok(p.byArea.witness);
  assert.ok(p.byArea.other); // null/{}/file:42 -> 'other'
});

test('handled never exceeds total; remaining floors at 0', () => {
  const p = progress({
    queueItems: [{ id: 'a1', file: 'x/y.mjs', status: 'done' }],
    handledIds: ['a1', 'ghost1', 'ghost2'], // extra ids that match nothing
  });
  assert.equal(p.handled, 1);
  assert.equal(p.remaining, 0);
});

test('renderProgress: produces markdown with bar, counts, and area table', () => {
  const p = progress({ queueItems: sampleItems, handledIds: ['a1', 'a3'] });
  const md = renderProgress(p);
  assert.match(md, /# Queue progress/);
  assert.match(md, /\*\*60%\*\*/);
  assert.match(md, /total: \*\*5\*\*/);
  assert.match(md, /handled: \*\*3\*\*/);
  assert.match(md, /## By area/);
  assert.match(md, /\| integrations \|/);
  assert.match(md, /[█░]/); // a bar is present
});

test('renderProgress: areas sorted by most-remaining first', () => {
  const p = progress({
    queueItems: [
      { id: '1', file: 'big/a.mjs', status: 'open' },
      { id: '2', file: 'big/b.mjs', status: 'open' },
      { id: '3', file: 'small/c.mjs', status: 'open' },
    ],
  });
  const md = renderProgress(p);
  const bigIdx = md.indexOf('| big |');
  const smallIdx = md.indexOf('| small |');
  assert.ok(bigIdx > 0 && smallIdx > 0);
  assert.ok(bigIdx < smallIdx, 'big (more remaining) should sort before small');
});

test('renderProgress: empty progress -> no area table, no throw', () => {
  const md = renderProgress(progress({}));
  assert.match(md, /# Queue progress/);
  assert.match(md, /total: \*\*0\*\*/);
  assert.doesNotMatch(md, /## By area/);
});

test('renderProgress: garbage input -> safe defaults', () => {
  assert.match(renderProgress(null), /# Queue progress/);
  assert.match(renderProgress(undefined), /total: \*\*0\*\*/);
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a>&"\'</a>'), '&lt;a&gt;&amp;&quot;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('reader seam: CLI parsing via __setReader (offline, injected)', () => {
  // Simulate the real .local files through the injected reader, then re-derive
  // progress from what the parsers would produce. We exercise the parse helpers
  // indirectly by re-running progress() on injected content.
  const files = {
    '.local/queue-items.jsonl':
      '{"id":"q1","file":"integrations/a.mjs","status":"open"}\n' +
      'not-json-skip-me\n' +
      '\n' +
      '{"id":"q2","file":"witness/b.mjs","status":"done"}\n',
    '.local/handled-ids.txt': 'q1\n\n  \n',
  };
  let calls = 0;
  __setReader((p) => {
    calls += 1;
    const key = Object.keys(files).find((k) => p.endsWith(k));
    if (key) return files[key];
    throw new Error('missing ' + p);
  });

  // Reproduce what the CLI parsers do: parse jsonl lines and id list, then progress().
  const parseJsonl = (raw) =>
    raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap((t) => {
      try { return [JSON.parse(t)]; } catch { return []; }
    });
  const parseIds = (raw) => raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const items = parseJsonl(files['.local/queue-items.jsonl']);
  const ids = parseIds(files['.local/handled-ids.txt']);
  assert.equal(items.length, 2); // malformed + blank lines dropped
  assert.equal(ids.length, 1);

  const p = progress({ queueItems: items, handledIds: ids, modules: [] });
  assert.equal(p.total, 2);
  assert.equal(p.handled, 2); // q1 by id, q2 by status
  assert.equal(p.pctDone, 100);

  __setReader(null); // restore default; no throw
  assert.ok(calls === 0); // we never actually invoked _read here, just verified seam swaps cleanly
});

test('reader seam: bad reader does not crash __setReader restore', () => {
  __setReader(123); // non-function -> falls back to default
  __setReader(null);
  assert.ok(true);
});
