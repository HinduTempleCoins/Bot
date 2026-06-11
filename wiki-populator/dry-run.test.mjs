// dry-run.test.mjs — offline tests for the MediaWiki population dry-run planner.
// Run: cd /workspaces/Bot && node --test wiki-populator/dry-run.test.mjs
// Fully offline: no network, no creds. The existence reader is injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planPopulation,
  renderDoc,
  titleToSlug,
  esc,
  __setReader,
  __setFetch,
} from './dry-run.mjs';

// ── esc() ──────────────────────────────────────────────────────────────────────────────────────
test('esc() escapes all five HTML-significant chars and soft-handles non-strings', () => {
  assert.equal(esc(`<a href="x" onclick='y'>&z</a>`),
    '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;z&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

// ── titleToSlug() matches wikiGenerator.js ───────────────────────────────────────────────────────
test('titleToSlug() matches the generator slug rule (non-alnum -> _)', () => {
  assert.equal(titleToSlug('Delegated Proof of Stake (DPoS)'), 'Delegated_Proof_of_Stake__DPoS_');
  assert.equal(titleToSlug('Kyphi'), 'Kyphi');
  assert.equal(titleToSlug('Hive-Engine and Smart Media Tokens'), 'Hive_Engine_and_Smart_Media_Tokens');
  assert.equal(titleToSlug(null), '');
});

// ── renderDoc() ──────────────────────────────────────────────────────────────────────────────────
test('renderDoc() uses explicit title + wikitext', () => {
  const r = renderDoc({ title: 'Kyphi', wikitext: '== Kyphi ==\nSacred incense.' });
  assert.deepEqual(r, { title: 'Kyphi', wikitext: '== Kyphi ==\nSacred incense.' });
});

test('renderDoc() accepts content/body field names (generator + python shapes)', () => {
  assert.equal(renderDoc({ title: 'A', content: 'body A' }).wikitext, 'body A');
  assert.equal(renderDoc({ title: 'B', body: 'body B' }).wikitext, 'body B');
});

test('renderDoc() derives title from a JSON filename (Python json_to_title convention)', () => {
  const r = renderDoc({ filename: 'space_paste.json', content: 'x' });
  assert.equal(r.title, 'Space Paste');
});

test('renderDoc() honours a per-doc custom render(doc) function', () => {
  const r = renderDoc({ title: 'C', render: (d) => `== ${d.title} ==\nrendered` });
  assert.equal(r.wikitext, '== C ==\nrendered');
});

test('renderDoc() soft-fails to null on missing title or body, and on garbage input', () => {
  assert.equal(renderDoc({ wikitext: 'orphan body' }), null); // no title
  assert.equal(renderDoc({ title: 'No Body' }), null);        // no wikitext
  assert.equal(renderDoc(null), null);
  assert.equal(renderDoc('nope'), null);
  assert.equal(renderDoc(123), null);
});

test('renderDoc() ignores empty/whitespace bodies and titles', () => {
  assert.equal(renderDoc({ title: '   ', wikitext: 'x' }), null);
  assert.equal(renderDoc({ title: 'T', wikitext: '   ' }), null);
});

// ── planPopulation: no reader => everything is create ────────────────────────────────────────────
test('planPopulation() with no reader plans every doc as create', () => {
  __setReader(null);
  const docs = [
    { title: 'Kyphi', wikitext: '== Kyphi ==' },
    { title: 'Space Paste', content: '== Space Paste ==' },
  ];
  const { plan, skipped, summary } = planPopulation(docs);
  assert.equal(plan.length, 2);
  assert.ok(plan.every((p) => p.action === 'create'));
  assert.equal(skipped.length, 0);
  assert.deepEqual(summary, { total: 2, create: 2, update: 0, skipped: 0 });
});

// ── planPopulation: reader marks existing pages as update ────────────────────────────────────────
test('planPopulation() marks existing pages as update, missing as create', () => {
  const existing = new Set(['Kyphi']);
  const reader = (title) => existing.has(title); // boolean shorthand
  const docs = [
    { title: 'Kyphi', wikitext: 'new text' },
    { title: 'Oilahuasca', wikitext: 'new text' },
  ];
  const { plan, summary } = planPopulation(docs, { reader });
  const byTitle = Object.fromEntries(plan.map((p) => [p.title, p.action]));
  assert.equal(byTitle['Kyphi'], 'update');
  assert.equal(byTitle['Oilahuasca'], 'create');
  assert.deepEqual(summary, { total: 2, create: 1, update: 1, skipped: 0 });
});

// ── planPopulation: object reader with content => changed vs unchanged ───────────────────────────
test('planPopulation() detects unchanged vs differing content via object reader', () => {
  const current = { Kyphi: 'SAME', Oilahuasca: 'OLD' };
  const reader = (title) => ({ content: current[title] ?? null });
  const docs = [
    { title: 'Kyphi', wikitext: 'SAME' },      // exists, same -> update/unchanged
    { title: 'Oilahuasca', wikitext: 'NEW' },  // exists, differs -> update/differs
    { title: 'New One', wikitext: 'X' },       // missing -> create
  ];
  const { plan } = planPopulation(docs, { reader });
  const k = plan.find((p) => p.title === 'Kyphi');
  const o = plan.find((p) => p.title === 'Oilahuasca');
  const n = plan.find((p) => p.title === 'New One');
  assert.equal(k.action, 'update');
  assert.match(k.reason, /unchanged/);
  assert.equal(o.action, 'update');
  assert.match(o.reason, /differs/);
  assert.equal(n.action, 'create');
});

test('planPopulation() with skipUnchanged moves no-op updates to skipped', () => {
  const reader = (title) => ({ content: title === 'Kyphi' ? 'SAME' : null });
  const docs = [
    { title: 'Kyphi', wikitext: 'SAME' },
    { title: 'Brand New', wikitext: 'Y' },
  ];
  const { plan, skipped, summary } = planPopulation(docs, { reader, skipUnchanged: true });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].title, 'Brand New');
  assert.equal(plan[0].action, 'create');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /unchanged/);
  assert.equal(summary.skipped, 1);
});

// ── planPopulation: opts.fetch alias and module-level __setFetch ─────────────────────────────────
test('planPopulation() accepts opts.fetch as a reader alias', () => {
  const fetchReader = () => true;
  const { plan } = planPopulation([{ title: 'X', wikitext: 'a' }], { fetch: fetchReader });
  assert.equal(plan[0].action, 'update');
});

test('__setFetch() aliases the module-level reader seam', () => {
  __setFetch(() => true);
  const { plan } = planPopulation([{ title: 'X', wikitext: 'a' }]);
  assert.equal(plan[0].action, 'update');
  __setFetch(null);
  const { plan: plan2 } = planPopulation([{ title: 'X', wikitext: 'a' }]);
  assert.equal(plan2[0].action, 'create');
});

// ── soft-fail: a throwing reader is treated as unknown => create, never throws ───────────────────
test('planPopulation() soft-fails a throwing reader to create (never throws)', () => {
  const reader = () => { throw new Error('boom'); };
  let result;
  assert.doesNotThrow(() => {
    result = planPopulation([{ title: 'X', wikitext: 'a' }], { reader });
  });
  assert.equal(result.plan[0].action, 'create');
});

test('planPopulation() reader returning undefined => create', () => {
  const { plan } = planPopulation([{ title: 'X', wikitext: 'a' }], { reader: () => undefined });
  assert.equal(plan[0].action, 'create');
});

// ── edge: bad docs are skipped, not fatal; good docs in the same batch still plan ─────────────────
test('planPopulation() skips unusable docs and keeps planning the rest', () => {
  __setReader(null);
  const docs = [
    { title: 'Good', wikitext: 'ok' },
    { title: 'NoBody' },          // skipped
    null,                          // skipped
    'garbage',                     // skipped
    { wikitext: 'orphan' },        // skipped (no title)
  ];
  const { plan, skipped, summary } = planPopulation(docs);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].title, 'Good');
  assert.equal(skipped.length, 4);
  assert.equal(summary.total, 5);
  assert.equal(summary.create, 1);
  assert.equal(summary.skipped, 4);
});

// ── edge: non-array input is tolerated ───────────────────────────────────────────────────────────
test('planPopulation() tolerates non-array input', () => {
  __setReader(null);
  assert.deepEqual(planPopulation(null).summary, { total: 0, create: 0, update: 0, skipped: 0 });
  assert.deepEqual(planPopulation(undefined).summary, { total: 0, create: 0, update: 0, skipped: 0 });
  // a single doc object is wrapped
  const { plan } = planPopulation({ title: 'Solo', wikitext: 's' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].title, 'Solo');
});

// ── purity: planning twice yields identical plans (no hidden state) ──────────────────────────────
test('planPopulation() is deterministic / pure for the same inputs', () => {
  __setReader(null);
  const docs = [{ title: 'A', wikitext: 'x' }, { title: 'B', wikitext: 'y' }];
  const a = planPopulation(docs);
  const b = planPopulation(docs);
  assert.deepEqual(a.plan, b.plan);
  assert.deepEqual(a.summary, b.summary);
});

// ── wikitext is carried through verbatim (this is what would be pushed) ───────────────────────────
test('planPopulation() carries the exact wikitext that would be pushed', () => {
  __setReader(null);
  const wt = '== Kyphi ==\nSacred incense.<ref>src.json</ref>\n\n== See Also ==\n* [[Oilahuasca]]';
  const { plan } = planPopulation([{ title: 'Kyphi', wikitext: wt }]);
  assert.equal(plan[0].wikitext, wt);
});
