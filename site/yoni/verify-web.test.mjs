// site/yoni/verify-web.test.mjs — OFFLINE, injected fs. The thing under test is the promise that the
// image does not survive the request: on success, on refusal, and on a model that throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniff, sweep, checkSelfie, readRawBody, __setIO, MAX_BYTES, SCRATCH_DIR } from './verify-web.mjs';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);

function memIO() {
  const files = new Map();
  const ages = new Map();
  __setIO({
    mkdir: () => true,
    write: (p, b) => { files.set(p, b); return true; },
    unlink: (p) => { files.delete(p); return true; },
    list: () => [...files.keys()].map((p) => p.split('/').pop()),
    age: (p) => ages.get(p.split('/').pop()) || 0,
  });
  return { files, ages };
}

test('magic bytes decide, not a declared type', () => {
  assert.equal(sniff(JPG), 'jpg');
  assert.equal(sniff(PNG), 'png');
  assert.equal(sniff(WEBP), 'webp');
  for (const bad of [null, Buffer.alloc(0), Buffer.from('hello'), Buffer.from('%PDF-1.7 and more bytes'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'), Buffer.from('#!/bin/sh\necho hi\n')]) {
    assert.equal(sniff(bad), null, `refused: ${String(bad).slice(0, 12)}`);
  }
});

test('a non-image is refused before anything is written', async () => {
  const { files } = memIO();
  const r = await checkSelfie(Buffer.from('%PDF-1.7 pretending'), { provider: { check: async () => ({ ok: true }) } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a JPEG/);
  assert.equal(files.size, 0, 'nothing was staged');
});

test('the staged file is gone after a PASS', async () => {
  const { files } = memIO();
  let sawPath = null;
  const r = await checkSelfie(JPG, { provider: { check: async ({ image }) => { sawPath = image; return { ok: true, level: 'verified' }; } } });
  assert.equal(r.ok, true);
  assert.ok(sawPath, 'the provider got a path');
  assert.equal(files.size, 0, 'the image did not survive the request');
});

test('the staged file is gone after a REFUSAL', async () => {
  const { files } = memIO();
  const r = await checkSelfie(PNG, { provider: { check: async () => ({ ok: false, reason: 'too young' }) } });
  assert.equal(r.ok, false);
  assert.equal(files.size, 0);
});

test('the staged file is gone even when the model THROWS', async () => {
  const { files } = memIO();
  const r = await checkSelfie(JPG, { provider: { check: async () => { throw new Error('onnx exploded'); } } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /check failed/);
  assert.equal(files.size, 0, 'a thrown model must not leave a face on disk');
});

test('each staged file gets an unguessable name in our own directory, never /tmp', async () => {
  memIO();
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    await checkSelfie(JPG, { provider: { check: async ({ image }) => { seen.push(image); return { ok: true }; } } });
  }
  assert.equal(new Set(seen).size, 6, 'names are unique');
  for (const p of seen) {
    assert.match(p, /\/[0-9a-f]{32}\.jpg$/, p);
    assert.doesNotMatch(p, /^\/tmp\//, 'never /tmp');
    assert.ok(p.startsWith(SCRATCH_DIR), p);
  }
});

test('an oversize image is refused and never staged', async () => {
  const { files } = memIO();
  const big = Buffer.concat([JPG, Buffer.alloc(MAX_BYTES + 1)]);
  const r = await checkSelfie(big, { provider: { check: async () => ({ ok: true }) } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /over 8MB/);
  assert.equal(files.size, 0);
});

test('an empty body and a missing provider are both refused', async () => {
  memIO();
  assert.match((await checkSelfie(Buffer.alloc(0), { provider: { check: async () => ({ ok: true }) } })).reason, /no image/);
  assert.match((await checkSelfie(JPG, {})).reason, /no provider/);
  assert.match((await checkSelfie(JPG, { provider: {} })).reason, /no provider/);
});

test('the sweep removes stale leftovers and spares fresh ones', () => {
  const { files, ages } = memIO();
  files.set(`${SCRATCH_DIR}/old.jpg`, JPG); ages.set('old.jpg', 10 * 60 * 1000);
  files.set(`${SCRATCH_DIR}/new.jpg`, JPG); ages.set('new.jpg', 500);
  assert.equal(sweep(), 1);
  assert.equal(files.has(`${SCRATCH_DIR}/old.jpg`), false);
  assert.equal(files.has(`${SCRATCH_DIR}/new.jpg`), true);
});

test('a body over the cap resolves null rather than buffering it', async () => {
  const h = {};
  const req = { on(ev, fn) { h[ev] = fn; return this; }, destroy() { this.destroyed = true; } };
  const p = readRawBody(req, 16);
  h.data(Buffer.alloc(32));
  assert.equal(await p, null);
  assert.equal(req.destroyed, true, 'the connection is dropped, not drained');
});

test('a normal body reads back intact', async () => {
  const h = {};
  const req = { on(ev, fn) { h[ev] = fn; return this; }, destroy() {} };
  const p = readRawBody(req, 1024);
  h.data(Buffer.from('ab')); h.data(Buffer.from('cd')); h.end();
  assert.equal((await p).toString(), 'abcd');
});
