// llm-wiring.test.mjs — the wire between Herald's drafting seams and the LLM ensemble.
//
// Offline. No provider is ever contacted: every test either supplies its own seam list or its own
// asker. The point of this module is that four seams exposed __setLLM and nothing ever called it,
// so the tests assert the wiring CONTRACT — a seam is either wired or reported as skipped, never
// silently missed — and that a dead ensemble leaves every module on its deterministic fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeAsker, SEAMS, wireHerald, unwireHerald } from './llm-wiring.mjs';

// A fake seam module, served through a data: URL so nothing touches the real ensemble.
const stubSeam = (body) => `data:text/javascript,${encodeURIComponent(body)}`;
const WITH_SETLLM = stubSeam('export let seen=null; export function __setLLM(f){ seen=f; }');
const NO_SETLLM = stubSeam('export const nothing = 1;');

// --- the asker --------------------------------------------------------------

test('makeAsker returns a callable adapter of the shape every seam expects', () => {
  const ask = makeAsker();
  assert.equal(typeof ask, 'function');
  assert.equal(ask.length, 1, 'seams call ask(prompt)');
});

test('makeAsker accepts a task and a log without throwing', () => {
  assert.doesNotThrow(() => makeAsker({ task: 'fast' }));
  assert.doesNotThrow(() => makeAsker({ task: 'quality', log: () => {} }));
  assert.doesNotThrow(() => makeAsker(undefined));
});

// --- the seam table ---------------------------------------------------------

test('SEAMS names the four drafting seams, each with an id, a path and a reason', () => {
  assert.equal(SEAMS.length, 4);
  for (const s of SEAMS) {
    assert.ok(s.id && typeof s.id === 'string');
    assert.ok(s.path && typeof s.path === 'string');
    assert.ok(s.why && typeof s.why === 'string', `${s.id} should say why it matters`);
  }
  assert.deepEqual(
    SEAMS.map((s) => s.id).sort(),
    ['crm-builder', 'factory', 'haro-monitor', 'pr-pipeline'],
  );
});

// --- wiring -----------------------------------------------------------------

test('a seam exposing __setLLM is wired, and receives the asker', async () => {
  const ask = async () => 'drafted';
  const r = await wireHerald({ asker: ask, seams: [{ id: 'stub', path: WITH_SETLLM, why: 'test' }] });
  assert.equal(r.wired.length, 1);
  assert.equal(r.wired[0].id, 'stub');
  assert.equal(r.skipped.length, 0);
  assert.equal(r.provider, 'live');

  const mod = await import(WITH_SETLLM);
  assert.equal(mod.seen, ask, 'the seam must hold the asker we passed, not a copy');
});

test('a module without __setLLM is REPORTED as skipped, never silently missed', async () => {
  const r = await wireHerald({ asker: async () => '', seams: [{ id: 'plain', path: NO_SETLLM, why: 'test' }] });
  assert.equal(r.wired.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].why, /no __setLLM/);
  assert.equal(r.provider, 'none', 'nothing wired means the ensemble is not actually connected');
});

test('an unimportable seam is reported, not thrown — one bad path never breaks the rest', async () => {
  const r = await wireHerald({
    asker: async () => '',
    seams: [
      { id: 'gone', path: './definitely-not-a-module-xyz.mjs', why: 'test' },
      { id: 'stub', path: WITH_SETLLM, why: 'test' },
    ],
  });
  assert.equal(r.wired.length, 1, 'the good seam still wires');
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].id, 'gone');
  assert.equal(r.provider, 'live');
});

test('every seam is accounted for — wired + skipped always covers the whole list', async () => {
  const seams = [
    { id: 'a', path: WITH_SETLLM, why: 'x' },
    { id: 'b', path: NO_SETLLM, why: 'x' },
    { id: 'c', path: './nope-xyz.mjs', why: 'x' },
  ];
  const r = await wireHerald({ asker: async () => '', seams });
  assert.equal(r.wired.length + r.skipped.length, seams.length);
  assert.deepEqual([...r.wired, ...r.skipped].map((s) => s.id).sort(), ['a', 'b', 'c']);
});

test('wireHerald never throws on junk', async () => {
  for (const junk of [{ seams: [] }, { seams: [null] }, { seams: [{}] }, { asker: null, seams: [] }]) {
    await assert.doesNotReject(() => wireHerald(junk));
  }
  const r = await wireHerald({ seams: [] });
  assert.equal(r.provider, 'none');
});

// --- unwiring ---------------------------------------------------------------

test('unwireHerald restores a seam to its deterministic fallback', async () => {
  const seams = [{ id: 'stub', path: WITH_SETLLM, why: 'test' }];
  await wireHerald({ asker: async () => 'x', seams });
  const mod = await import(WITH_SETLLM);
  assert.notEqual(mod.seen, null);

  await unwireHerald({ seams });
  assert.equal(mod.seen, null, 'the seam must be back on its fallback, not holding a stale asker');
});

test('unwireHerald never throws, including on seams that cannot be imported', async () => {
  await assert.doesNotReject(() => unwireHerald({ seams: [{ id: 'gone', path: './nope-xyz.mjs' }] }));
  await assert.doesNotReject(() => unwireHerald({ seams: [] }));
});
