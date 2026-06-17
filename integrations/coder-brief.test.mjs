// coder-brief.test.mjs — offline, injected gate. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coderBrief, providersHint } from './coder-brief.mjs';

test('coderBrief renders a section from the coder model', async () => {
  let askedModel = null, askedQ = null;
  const ask = async (model, q) => { askedModel = model; askedQ = q; return '- Task 1: touch integrations/x.mjs, add a soft-fail reader.\n- Task 2: extend monitor.collect().'; };
  const md = await coderBrief({ items: ['Build the X reader', 'Wire chain-data into the monitor'] }, { ask, model: 'codestral' });
  assert.match(md, /## ENGINEERING — coder AI \(codestral\)/);
  assert.match(md, /not Claude/);
  assert.match(md, /touch integrations\/x\.mjs/);
  assert.equal(askedModel, 'codestral');
  assert.match(askedQ, /Build the X reader/);     // tasks included in the prompt
  assert.match(askedQ, /coder AI/);
});

test('empty items → empty string (no section)', async () => {
  const md = await coderBrief({ items: [] }, { ask: async () => 'should not be called' });
  assert.equal(md, '');
});

test('gate down (ask returns null) → empty string, never throws', async () => {
  const md = await coderBrief({ items: ['something'] }, { ask: async () => null });
  assert.equal(md, '');
});

test('ask throwing is swallowed → empty string', async () => {
  const md = await coderBrief({ items: ['x'] }, { ask: async () => { throw new Error('gate 500'); } });
  assert.equal(md, '');
});

test('caps at 8 items + cleans whitespace', async () => {
  let q = '';
  const items = Array.from({ length: 20 }, (_, i) => `  task   ${i}  `);
  await coderBrief({ items }, { ask: async (_m, qq) => { q = qq; return 'ok'; } });
  assert.match(q, /1\. task 0/);                 // whitespace collapsed
  assert.match(q, /8\. task 7/);
  assert.ok(!/9\. task 8/.test(q));               // capped at 8
});

test('context is included when given', async () => {
  let q = '';
  await coderBrief({ items: ['t'], context: 'recent: PR #451 wired web-search' }, { ask: async (_m, qq) => { q = qq; return 'ok'; } });
  assert.match(q, /Recent repo context/);
  assert.match(q, /PR #451/);
});

test('custom heading honored', async () => {
  const md = await coderBrief({ items: ['t'], heading: '12&12 — coder AI' }, { ask: async () => 'x' });
  assert.match(md, /## 12&12 — coder AI/);
});

test('providersHint reflects env defaults', () => {
  const h = providersHint();
  assert.equal(typeof h.model, 'string');
  assert.equal(typeof h.gate, 'string');
});
