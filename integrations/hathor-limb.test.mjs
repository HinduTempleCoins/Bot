// hathor-limb.test.mjs — OFFLINE. The shared limb client: passes the surface (compartmentalization) + person,
// soft-fails when the brain is unreachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askHathor, __setFetch, brainUrl } from './hathor-limb.mjs';

test('askHathor forwards surface + person to /perceive and returns her reply', async () => {
  let seen = null;
  __setFetch(async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ ok: true, reply: 'I hear you.', person: 'web:1', surface: 'game' }) }; });
  const out = await askHathor('I built a tower', { surface: 'game', from: 'VanKushFam' });
  assert.match(seen.url, /\/perceive$/);
  assert.equal(seen.body.surface, 'game');            // the limb's compartment is passed → walls preserved
  assert.equal(seen.body.from, 'VanKushFam');
  assert.equal(out.reply, 'I hear you.');
  __setFetch(null);
});

test('soft-fails to null when the brain is unreachable (caller falls back, never crashes)', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(await askHathor('hello', { surface: 'discord', from: 'x' }), null);
  __setFetch(async () => ({ ok: false }));
  assert.equal(await askHathor('hello', { surface: 'discord', from: 'x' }), null);
  __setFetch(null);
});

test('empty text → null without calling the brain; brainUrl exposed', async () => {
  let called = false; __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  assert.equal(await askHathor('   ', { surface: 'melek' }), null);
  assert.equal(called, false);
  assert.match(brainUrl(), /^https?:\/\//);
  __setFetch(null);
});
