import { test } from 'node:test';
import assert from 'node:assert';
import { setKey, getMasked, listKeys, removeKey, useKey, mask, PROVIDERS, __setIO } from './apikeys.mjs';
import { generateImage, __setFetch, sizeOf } from './byok-image.mjs';

// in-memory store, so nothing touches the disk
let FILE = {};
__setIO({ read: (p) => FILE[p] || null, write: (p, s) => { FILE[p] = s; } });
const opts = { file: 'test.json' };
const reset = () => { FILE = {}; };

test('a key is stored for one account and only ever comes back masked', () => {
  reset();
  const r = setKey('@Writer', 'openai', 'sk-abcdefghij1234', opts);
  assert.equal(r.ok, true);
  assert.equal(r.masked, '…1234');
  assert.equal(getMasked('writer', 'openai', opts).masked, '…1234');
  assert.equal(JSON.stringify(listKeys('writer', opts)).includes('abcdefghij'), false);
  assert.equal(mask('sk-abcdefghij1234'), '…1234');
});

test('one account never sees or spends another account\'s key', async () => {
  reset();
  setKey('writer', 'openai', 'sk-abcdefghij1234', opts);
  assert.equal(getMasked('someone-else', 'openai', opts), null);
  assert.equal(listKeys('someone-else', opts).every((p) => !p.connected), true);
  const r = await useKey('someone-else', 'openai', () => 'used', opts);
  assert.equal(r.ok, false);
});

test('junk is refused, and only known providers are stored', () => {
  reset();
  assert.equal(setKey('writer', 'openai', 'short', opts).ok, false);
  assert.equal(setKey('writer', 'openai', 'has spaces in it', opts).ok, false);
  assert.equal(setKey('writer', 'not-a-provider', 'sk-abcdefghij1234', opts).ok, false);
  assert.equal(setKey('', 'openai', 'sk-abcdefghij1234', opts).ok, false);
});

test('the secret reaches the caller only inside useKey, and the use is dated', async () => {
  reset();
  setKey('writer', 'stability', 'sk-zzzzzzzzyyyy', opts);
  let seen = '';
  const r = await useKey('writer', 'stability', (k, p) => { seen = k; return p.host; }, { ...opts, now: 4242 });
  assert.equal(r.ok, true);
  assert.equal(r.result, 'api.stability.ai');
  assert.equal(seen, 'sk-zzzzzzzzyyyy');
  assert.equal(getMasked('writer', 'stability', opts).lastUsed, 4242);
});

test('a provider error never leaks the key or the raw message', async () => {
  reset();
  setKey('writer', 'openai', 'sk-abcdefghij1234', opts);
  const r = await useKey('writer', 'openai', () => { throw new Error('bad key sk-abcdefghij1234'); }, opts);
  assert.equal(r.ok, false);
  assert.equal(r.reason.includes('sk-'), false);
});

test('a key can be disconnected', () => {
  reset();
  setKey('writer', 'openai', 'sk-abcdefghij1234', opts);
  assert.equal(removeKey('writer', 'openai', opts).removed, true);
  assert.equal(getMasked('writer', 'openai', opts), null);
  assert.equal(removeKey('writer', 'openai', opts).removed, false);
});

test('every provider names the one host its key may be sent to', () => {
  for (const p of PROVIDERS) {
    assert.match(p.host, /^[a-z0-9.-]+$/);
    assert.ok(['metatron', 'sandalphon', 'both'].includes(p.part), p.id);
  }
});

test('with a key, a graphic is made by the user\'s own provider and returned as a data URL', async () => {
  reset();
  setKey('writer', 'openai', 'sk-abcdefghij1234', opts);
  let sentTo = '', auth = '';
  __setFetch(async (url, init) => {
    sentTo = String(url); auth = (init.headers && init.headers.authorization) || '';
    return { ok: true, json: async () => ({ data: [{ b64_json: 'SU1H' }] }) };
  });
  const r = await generateImage('writer', { prompt: 'a gold banner of the Nile at dawn', size: 'wide' }, opts);
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'openai');
  assert.equal(r.image, 'data:image/png;base64,SU1H');
  assert.equal(sentTo.startsWith('https://api.openai.com/'), true);   // only the provider's own host
  assert.equal(auth, 'Bearer sk-abcdefghij1234');
});

test('with no key the caller is told to fall back to our own CPU pool', async () => {
  reset();
  __setFetch(async () => { throw new Error('must not be called'); });
  const r = await generateImage('writer', { prompt: 'anything' }, opts);
  assert.deepEqual(r, { ok: false, reason: 'no-key' });
  assert.equal((await generateImage('writer', { prompt: '' }, opts)).ok, false);
});

test('a provider that fails falls through to the next key, then to no-key', async () => {
  reset();
  setKey('writer', 'openai', 'sk-abcdefghij1234', opts);
  setKey('writer', 'fal', 'falkey:secret9999', opts);
  __setFetch(async (url) => (String(url).includes('openai') ? { ok: false } : { ok: true, json: async () => ({ images: [{ url: 'data:image/png;base64,RkFM' }] }) }));
  const r = await generateImage('writer', { prompt: 'a lyre' }, opts);
  assert.equal(r.provider, 'fal');
  assert.equal(r.image, 'data:image/png;base64,RkFM');
});

test('sizes map to real pixel sizes', () => {
  assert.equal(sizeOf('wide'), '1536x1024');
  assert.equal(sizeOf('1024x768'), '1024x768');
  assert.equal(sizeOf('nonsense'), '1024x1024');
});
