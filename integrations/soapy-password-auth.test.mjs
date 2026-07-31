// integrations/soapy-password-auth.test.mjs — offline tests for the Soapy.Blog single-shared-password
// login. Fully offline: an in-memory `opts.fs` ({read, write}) + `opts.file` replace the real
// transcript-store file, so no disk, no network, no environment is touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  provisionPassword, verifyPassword, isProvisioned, CRED_FILE,
} from './soapy-password-auth.mjs';

// A fresh in-memory fs per test: `mem` holds the single credential file's contents (or null).
function memFs(initial = null) {
  let mem = initial;
  return {
    fs: { read: () => mem, write: (_p, s) => { mem = s; } },
    file: '/in-memory/soapy-cred.json',
    peek: () => mem,
    set: (s) => { mem = s; },
  };
}

test('provisionPassword then verifyPassword succeeds', () => {
  const m = memFs();
  const p = provisionPassword('correct horse battery', { fs: m.fs, file: m.file });
  assert.equal(p.ok, true);
  const v = verifyPassword('correct horse battery', { fs: m.fs, file: m.file });
  assert.equal(v.ok, true);
});

test('wrong password → { ok: false }', () => {
  const m = memFs();
  provisionPassword('correct horse battery', { fs: m.fs, file: m.file });
  const v = verifyPassword('wrong password here', { fs: m.fs, file: m.file });
  assert.equal(v.ok, false);
});

test('not-provisioned (no file) → { ok:false, reason:\'not-provisioned\' }', () => {
  const m = memFs(null); // nothing ever written
  const v = verifyPassword('anything at all', { fs: m.fs, file: m.file });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'not-provisioned');
});

test('corrupt file → { ok: false }', () => {
  const m = memFs('this is not json{{');
  const v = verifyPassword('anything at all', { fs: m.fs, file: m.file });
  assert.equal(v.ok, false);
});

test('password < 8 chars → provision { ok: false }', () => {
  const m = memFs();
  const p = provisionPassword('short', { fs: m.fs, file: m.file });
  assert.equal(p.ok, false);
  // nothing was written, so verify still reports not-provisioned
  assert.equal(m.peek(), null);
});

test('isProvisioned true after provisioning, false before / on corrupt', () => {
  const m = memFs();
  assert.equal(isProvisioned({ fs: m.fs, file: m.file }), false);
  provisionPassword('correct horse battery', { fs: m.fs, file: m.file });
  assert.equal(isProvisioned({ fs: m.fs, file: m.file }), true);
  m.set('not json at all');
  assert.equal(isProvisioned({ fs: m.fs, file: m.file }), false);
});

test('CRED_FILE() returns a non-empty transcript-store path (never the repo)', () => {
  const f = CRED_FILE();
  assert.equal(typeof f, 'string');
  assert.ok(f.length > 0);
});

test('soft-fail: exports never throw on bad input', () => {
  const m = memFs();
  assert.doesNotThrow(() => provisionPassword(null, { fs: m.fs, file: m.file }));
  assert.doesNotThrow(() => verifyPassword(null, { fs: m.fs, file: m.file }));
  assert.doesNotThrow(() => isProvisioned({ fs: m.fs, file: m.file }));
});
