import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSurroundings, deliberate } from './deliberation.mjs';

test('analyzeSurroundings turns a game snapshot into observations', () => {
  const obs = analyzeSurroundings({
    players: [{ name: 'VanKushFam', distance: 5 }],
    structures: [{ name: 'gateway', distance: 8 }],
    blocks: [{ name: 'smooth_sandstone', count: 9 }],
    time: 'night', biome: 'desert', self: { health: 6 },
  });
  assert.ok(obs.some((o) => /VanKushFam.*5 blocks/.test(o)));
  assert.ok(obs.some((o) => /gateway/.test(o)));
  assert.ok(obs.some((o) => /smooth sandstone/.test(o)));
  assert.ok(obs.some((o) => /night/.test(o)));
  assert.ok(obs.some((o) => /hurt/.test(o)));
});

test('deliberate weighs, recalls from datasets, reflects, intends', async () => {
  const retrieve = async (q, { k }) => {
    assert.ok(q && k);
    return [{ text: 'Pylons framed Egyptian temple gates; symmetry signified cosmic order.', source: 'knowledge/architecture' }];
  };
  const t = await deliberate({ snapshot: { structures: [{ name: 'gateway', distance: 8 }], time: 'night' } }, { retrieve });
  assert.ok(t.focus);
  assert.equal(t.recalls.length, 1);
  assert.ok(t.drewFrom.includes('knowledge/architecture'));
  assert.match(t.reflection, /architecture|recall|note/i);
  assert.ok(t.intent && t.intent.action);
});

test('the amygdala drives the focus — a threat outranks ambiance', async () => {
  const t = await deliberate({ observations: ['the biome is plains', 'a creeper is about to explode next to me'] }, {});
  assert.match(t.focus, /creeper|explode/);
});

test('intent reflects the salient observation', async () => {
  const near = await deliberate({ observations: ['VanKushFam is 3 blocks away'] }, {});
  assert.equal(near.intent.action, 'greet-or-approach');
  const hurt = await deliberate({ snapshot: { self: { health: 4 } } }, {});
  assert.equal(hurt.intent.action, 'tend-self');
  const built = await deliberate({ observations: ['a gateway stands 6 blocks off'] }, {});
  assert.equal(built.intent.action, 'regard-structure');
});

test('draws from datasets only when a retriever is wired (soft-fail otherwise)', async () => {
  const noret = await deliberate({ observations: ['it is day'] }, {});
  assert.deepEqual(noret.recalls, []);
  assert.deepEqual(noret.drewFrom, []);
  assert.ok(noret.reflection.length);
  // retriever that throws → still soft-fails
  const t = await deliberate({ observations: ['it is day'] }, { retrieve: async () => { throw new Error('rag down'); } });
  assert.deepEqual(t.recalls, []);
});

test('uses the LLM to voice the reflection when present, grounded in recalls', async () => {
  let sawGrounding = false;
  const retrieve = async () => [{ text: 'vaporwave palettes pair neon violet with gold', source: 'knowledge/architecture' }];
  const complete = async (prompt) => { sawGrounding = /vaporwave/.test(prompt); return 'Indeed — the violet and gold of it pleases me.'; };
  const t = await deliberate({ observations: ['a gateway stands 6 blocks off'] }, { retrieve, complete });
  assert.equal(sawGrounding, true);
  assert.match(t.reflection, /violet and gold/);
});

test('empty context still yields a thought', async () => {
  const t = await deliberate({}, {});
  assert.ok(t.focus && t.reflection);
  assert.equal(t.intent.action, 'observe');
});
