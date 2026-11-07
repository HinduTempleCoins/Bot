// site/yoni/producers-store.test.mjs — OFFLINE, injected IO and clock. The security properties are the
// product: a code works once, expires, and a revocation takes every device with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approve, claim, revoke, isProducer, handleFor, listProducers, hashSubject, state,
  __setIO, CLAIM_TTL_MS, storePath,
} from './producers-store.mjs';

function memIO() {
  const files = new Map();
  __setIO({
    read: (p) => files.get(p) || '',
    append: (p, line) => { files.set(p, (files.get(p) || '') + line); return true; },
  });
  return files;
}
const P = { path: '/x/producers.jsonl', env: {} };

test('nobody can publish from an empty store', () => {
  memIO();
  for (const s of ['', 'anyone', 'abc123']) assert.equal(isProducer(s, P), false);
});

test('approve mints a code; the code binds one subject and then is spent', () => {
  memIO();
  const a = approve('ryan', P);
  assert.equal(a.ok, true, a.reason);
  assert.match(a.code, /^[0-9a-f]{32}$/);
  assert.equal(isProducer('browser-1', P), false, 'approval alone grants nothing');

  assert.equal(claim(a.code, 'browser-1', P).ok, true);
  assert.equal(isProducer('browser-1', P), true);
  assert.equal(handleFor('browser-1', P), 'ryan');

  // single use
  const again = claim(a.code, 'browser-2', P);
  assert.equal(again.ok, false);
  assert.match(again.reason, /already have been used/);
  assert.equal(isProducer('browser-2', P), false);
});

test('a code expires and the default window is a real one', () => {
  memIO();
  assert.ok(CLAIM_TTL_MS >= 24 * 3600 * 1000);
  let t = 1_000_000;
  const o = { ...P, now: () => t };
  const a = approve('late', o);
  t += CLAIM_TTL_MS + 1;
  const r = claim(a.code, 'browser-x', o);
  assert.equal(r.ok, false);
  assert.match(r.reason, /expired/);
  assert.equal(isProducer('browser-x', o), false);
});

test('a second approval lets a producer add a device without the operator learning anything', () => {
  memIO();
  const a1 = approve('ryan', P); claim(a1.code, 'laptop', P);
  const a2 = approve('ryan', P); claim(a2.code, 'phone', P);
  assert.equal(isProducer('laptop', P), true);
  assert.equal(isProducer('phone', P), true);
  assert.equal(listProducers(P)[0].devices, 2);
});

test('revoking a handle removes every device bound to it', () => {
  memIO();
  const a1 = approve('ryan', P); claim(a1.code, 'laptop', P);
  const a2 = approve('ryan', P); claim(a2.code, 'phone', P);
  assert.equal(revoke('ryan', P).ok, true);
  assert.equal(isProducer('laptop', P), false);
  assert.equal(isProducer('phone', P), false);
  assert.equal(listProducers(P)[0].revoked, true);
  // and an unused code from before the revocation is dead too
  const a3 = approve('zed', P);
  revoke('zed', P);
  assert.equal(claim(a3.code, 'another', P).ok, false);
});

test('a revoked handle can be approved again', () => {
  memIO();
  const a1 = approve('ryan', P); claim(a1.code, 'laptop', P);
  revoke('ryan', P);
  const a2 = approve('ryan', P);
  assert.equal(claim(a2.code, 'laptop', P).ok, true);
  assert.equal(isProducer('laptop', P), true);
});

test('the file stores a hashed subject, never the raw cookie id', () => {
  const files = memIO();
  const a = approve('ryan', P); claim(a.code, 'super-secret-cookie-value', P);
  const raw = files.get('/x/producers.jsonl');
  assert.equal(raw.includes('super-secret-cookie-value'), false, 'the raw subject leaked into the file');
  assert.ok(raw.includes(hashSubject('super-secret-cookie-value')));
});

test('no personal data is written — only a handle, a hash, a code and a time', () => {
  const files = memIO();
  const a = approve('ryan', P); claim(a.code, 'browser-1', P);
  for (const line of files.get('/x/producers.jsonl').trim().split('\n')) {
    for (const k of Object.keys(JSON.parse(line))) {
      assert.ok(['op', 'handle', 'code', 'exp', 'at', 'subject'].includes(k), `unexpected field: ${k}`);
    }
  }
});

test('handles are normalised, and an empty one is refused', () => {
  memIO();
  assert.equal(approve('', P).ok, false);
  assert.equal(approve('   ', P).ok, false);
  const a = approve('  RyAn Van/Kush!! ', P);
  assert.equal(a.handle, 'ryanvankush');
});

test('claim refuses missing inputs and an unknown code', () => {
  memIO();
  assert.equal(claim('', 'x', P).ok, false);
  assert.equal(claim('abc', '', P).ok, false);
  assert.equal(claim('not-a-real-code', 'x', P).ok, false);
});

test('the bootstrap env allowlist still works, for the first producer', () => {
  memIO();
  const o = { ...P, env: { YONI_PRODUCERS: 'founder' } };
  assert.equal(isProducer('founder', o), true);
  assert.equal(isProducer('FOUNDER', o), true);
  assert.equal(isProducer('someone-else', o), false);
});

test('a torn line shortens the log rather than throwing', () => {
  const files = memIO();
  const a = approve('ryan', P); claim(a.code, 'laptop', P);
  files.set('/x/producers.jsonl', `${files.get('/x/producers.jsonl')}{not json\n`);
  assert.equal(isProducer('laptop', P), true);
  assert.equal(state(P).handles.size, 1);
});

test('a failed write is reported', () => {
  __setIO({ read: () => '', append: () => false });
  assert.equal(approve('ryan', P).ok, false);
  assert.equal(revoke('ryan', P).ok, false);
});

test('the store path comes from the environment', () => {
  assert.match(storePath({}), /producers\.jsonl$/);
  assert.equal(storePath({ YONI_PRODUCERS_FILE: '/elsewhere/p.jsonl' }), '/elsewhere/p.jsonl');
});
