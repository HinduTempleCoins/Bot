// modal-compute.test.mjs — offline, injected fetch. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, embedOne, configured, EMBED_DIM, __setFetch } from './modal-compute.mjs';

test('embed soft-fails with no URL configured', async () => {
  delete process.env.MODAL_EMBED_URL;
  const r = await embed(['hi']);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-url');
  assert.deepEqual(r.embeddings, []);
});

test('embed posts to the endpoint + returns vectors', async () => {
  process.env.MODAL_EMBED_URL = 'https://x--melek-brain.modal.run';
  process.env.MODAL_EMBED_TOKEN = 'tok';
  let sentBody = null;
  __setFetch(async (url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true, dim: EMBED_DIM, count: 2, embeddings: [[0.1, 0.2], [0.3, 0.4]] }) }; });
  const r = await embed(['a', 'b']);
  __setFetch(); delete process.env.MODAL_EMBED_URL; delete process.env.MODAL_EMBED_TOKEN;
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.equal(r.embeddings.length, 2);
  assert.equal(sentBody.token, 'tok');       // bearer forwarded
  assert.deepEqual(sentBody.texts, ['a', 'b']);
});

test('embed filters empties + soft-fails on no-texts', async () => {
  process.env.MODAL_EMBED_URL = 'https://x.modal.run';
  const r = await embed(['', null, '   ']);
  __setFetch(); delete process.env.MODAL_EMBED_URL;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-texts');
});

test('embed soft-fails on http error + on bad response', async () => {
  process.env.MODAL_EMBED_URL = 'https://x.modal.run';
  __setFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.equal((await embed(['x'])).reason, 'http-401');
  __setFetch(async () => ({ ok: true, json: async () => ({ ok: false, error: 'unauthorized' }) }));
  assert.equal((await embed(['x'])).reason, 'unauthorized');
  __setFetch(); delete process.env.MODAL_EMBED_URL;
});

test('embed never throws on network error', async () => {
  process.env.MODAL_EMBED_URL = 'https://x.modal.run';
  __setFetch(async () => { throw new Error('down'); });
  const r = await embed(['x']);
  __setFetch(); delete process.env.MODAL_EMBED_URL;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'network');
});

test('embedOne returns a single vector or null', async () => {
  process.env.MODAL_EMBED_URL = 'https://x.modal.run';
  __setFetch(async () => ({ ok: true, json: async () => ({ ok: true, embeddings: [[1, 2, 3]] }) }));
  assert.deepEqual(await embedOne('hi'), [1, 2, 3]);
  __setFetch(); delete process.env.MODAL_EMBED_URL;
  assert.equal(await embedOne('hi'), null); // no url now
});

test('configured reflects env', () => {
  process.env.MODAL_EMBED_URL = 'u';
  const c = configured();
  delete process.env.MODAL_EMBED_URL;
  assert.equal(c.url, true);
  assert.equal(typeof c.token, 'boolean');
});
