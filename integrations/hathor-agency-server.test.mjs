// hathor-agency-server.test.mjs — OFFLINE. The ONE Hathor brain as a service: one self across surfaces,
// shared compartmentalized memory, command-aware, soft-fail. Everything injected (no LLM, no disk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgency, CAPABILITIES } from './hathor-agency-server.mjs';
import { makeKeywordStore } from '../memory/compartments.mjs';

function cap() {
  const o = { code: 0, body: '' };
  return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o };
}
const post = (path, body) => ({ url: path, method: 'POST', on: (ev, fn) => { if (ev === 'data') fn(JSON.stringify(body)); if (ev === 'end') fn(); } });
const get = (path) => ({ url: path, method: 'GET', on: (ev, fn) => { if (ev === 'end') fn(); } });
const j = (o) => JSON.parse(o.body);

// an injected agency: in-memory store (shared across surfaces) + a deterministic "voice" so we assert flow.
function agency() {
  return createAgency({
    makeStore: () => makeKeywordStore(),                         // ONE shared store across all surfaces
    retrieve: async () => [{ text: 'A gateway is a threshold.', source: 'knowledge' }],
    complete: async (prompt) => `…I hear you. (${prompt.length} chars considered)`,
  });
}

test('/health reports the one self: surfaces + the capabilities she can offer', async () => {
  const { handler } = agency();
  const { res, o } = cap(); await handler(get('/health'), res);
  assert.equal(o.code, 200);
  const d = j(o);
  assert.equal(d.ok, true);
  assert.ok(d.surfaces.includes('discord') && d.surfaces.includes('game'));
  assert.deepEqual(d.capabilities, CAPABILITIES.map((c) => c.id));   // signup, tutorial, balance, price, witness
});

test('/perceive: she replies on a surface and tags the person', async () => {
  const { handler } = agency();
  const { res, o } = cap(); await handler(post('/perceive', { surface: 'discord', from: 'VanKushFam', text: 'Hathor, what is the gateway?' }), res);
  const d = j(o);
  assert.equal(d.ok, true);
  assert.equal(d.surface, 'discord');
  assert.equal(d.person, 'VanKushFam');
  assert.ok(typeof d.reply === 'string');
});

test('ONE Hathor: a person met in the game is remembered when they reach her on Discord (compartments, one mind)', async () => {
  const { handler, hathor } = agency();
  // she meets VanKushFam in the GAME
  let c = cap(); await handler(post('/perceive', { surface: 'game', from: 'VanKushFam', text: 'I built a cobblestone tower by the river' }), c.res);
  // later, on DISCORD, the same person — her shared memory recalls the game thread (cross-compartment)
  c = cap(); await handler(post('/perceive', { surface: 'discord', from: 'VanKushFam', text: 'remember my river tower?' }), c.res);
  const recalled = await hathor.memory.recallForPerson('VanKushFam', 'river tower', { k: 5 });
  assert.ok(recalled.some((r) => /river tower/i.test(r.text)), 'the person follows across surfaces in one mind');
});

test('/recall surfaces what she remembers about a person across compartments', async () => {
  const { handler } = agency();
  let c = cap(); await handler(post('/perceive', { surface: 'melek', from: 'Ann', text: 'asked about the welcome grant' }), c.res);
  c = cap(); await handler(get('/recall?person=Ann&about=welcome%20grant'), c.res);
  const d = j(c.o);
  assert.equal(d.ok, true);
  assert.ok(d.memories.some((m) => /welcome grant/i.test(m.text)));
});

test('unknown route + bad body soft-fail (never throw)', async () => {
  const { handler } = agency();
  let c = cap(); await handler(get('/nope'), c.res); assert.equal(c.o.code, 404);
  c = cap(); await handler(post('/perceive', {}), c.res); assert.equal(j(c.o).ok, true); // empty text → empty reply, still ok
});
