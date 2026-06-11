// pin-gate.test.mjs — offline tests for the salted-hash PIN gate (backlog 01de0a5ec0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPin, verifyPin, makeSalt, createPinGate, validatePinFormat,
} from './pin-gate.mjs';

test('makeSalt returns hex of the requested byte length', () => {
  const s = makeSalt();
  assert.match(s, /^[0-9a-f]+$/);
  assert.equal(s.length, 32); // 16 bytes default = 32 hex chars
  assert.equal(makeSalt(8).length, 16);
  // bad input falls back to default
  assert.equal(makeSalt(-1).length, 32);
  assert.equal(makeSalt('x').length, 32);
});

test('hashPin produces a {salt,hash} record; deterministic for same salt', () => {
  const salt = makeSalt();
  const a = hashPin('1234', salt);
  assert.ok(a && typeof a.salt === 'string' && typeof a.hash === 'string');
  assert.match(a.hash, /^[0-9a-f]+$/);
  assert.equal(a.salt, salt.toLowerCase());
  const b = hashPin('1234', salt);
  assert.equal(a.hash, b.hash); // deterministic
});

test('hashPin generates a salt when none/malformed is supplied', () => {
  const r1 = hashPin('1234');
  assert.ok(r1 && r1.salt.length === 32);
  const r2 = hashPin('1234', 'not-hex!!');
  assert.ok(r2 && r2.salt.length === 32);
});

test('hashPin soft-fails (null) on bad pin', () => {
  assert.equal(hashPin('', makeSalt()), null);
  assert.equal(hashPin(1234, makeSalt()), null);
  assert.equal(hashPin(null), null);
});

test('verifyPin: true for the right pin, false for the wrong one', () => {
  const rec = hashPin('4242', makeSalt());
  assert.equal(verifyPin('4242', rec), true);
  assert.equal(verifyPin('4243', rec), false);
  assert.equal(verifyPin('424', rec), false);
});

test('verifyPin soft-fails on malformed records / inputs', () => {
  assert.equal(verifyPin('1234', null), false);
  assert.equal(verifyPin('1234', {}), false);
  assert.equal(verifyPin('1234', { salt: 'zz', hash: 'zz' }), false);
  assert.equal(verifyPin('1234', { salt: 'abc', hash: 'abcd' }), false); // odd-length salt
  assert.equal(verifyPin('1234', { salt: 'ab', hash: 'abc' }), false);   // odd-length hash
  assert.equal(verifyPin('', hashPin('1234', makeSalt())), false);
  assert.equal(verifyPin(1234, hashPin('1234', makeSalt())), false);
});

test('different salts give different hashes for the same pin', () => {
  const a = hashPin('1234', makeSalt());
  const b = hashPin('1234', makeSalt());
  assert.notEqual(a.hash, b.hash);
  assert.equal(verifyPin('1234', a), true);
  assert.equal(verifyPin('1234', b), true);
});

test('validatePinFormat: digits within bounds', () => {
  assert.equal(validatePinFormat('1234'), true);
  assert.equal(validatePinFormat('12345678'), true);
  assert.equal(validatePinFormat('123'), false);        // too short
  assert.equal(validatePinFormat('123456789'), false);  // too long
  assert.equal(validatePinFormat('12a4'), false);       // non-digit
  assert.equal(validatePinFormat(' 1234'), false);
  assert.equal(validatePinFormat(1234), false);         // not a string
  assert.equal(validatePinFormat(''), false);
  assert.equal(validatePinFormat('12', { minLen: 2, maxLen: 6 }), true);
  // minLen 0 is invalid -> falls back to default 4, so '12' is too short
  assert.equal(validatePinFormat('12', { minLen: 0 }), false);
});

test('validatePinFormat respects custom bounds and bad opts', () => {
  assert.equal(validatePinFormat('123456', { minLen: 6, maxLen: 6 }), true);
  // maxLen below minLen is invalid -> falls back to default maxLen 8
  assert.equal(validatePinFormat('1234567', { minLen: 4, maxLen: 2 }), true);
});

test('createPinGate: correct pin returns ok and resets the counter', () => {
  const rec = hashPin('1234', makeSalt());
  const gate = createPinGate({ record: rec, maxAttempts: 3 });
  let r = gate.check('0000');
  assert.deepEqual(r, { ok: false, remaining: 2, lockedOut: false });
  r = gate.check('1234');
  assert.deepEqual(r, { ok: true, remaining: 3, lockedOut: false }); // reset
  r = gate.check('0000');
  assert.deepEqual(r, { ok: false, remaining: 2, lockedOut: false }); // counter was reset
});

test('createPinGate: locks out after maxAttempts and stays locked even for the right pin', () => {
  const rec = hashPin('1234', makeSalt());
  const gate = createPinGate({ record: rec, maxAttempts: 3 });
  assert.equal(gate.check('0000').lockedOut, false);
  assert.equal(gate.check('0000').lockedOut, false);
  const third = gate.check('0000');
  assert.deepEqual(third, { ok: false, remaining: 0, lockedOut: true });
  // now even the correct pin is rejected
  const r = gate.check('1234');
  assert.deepEqual(r, { ok: false, remaining: 0, lockedOut: true });
});

test('createPinGate: reset() unlocks', () => {
  const rec = hashPin('1234', makeSalt());
  const gate = createPinGate({ record: rec, maxAttempts: 2 });
  gate.check('0000');
  gate.check('0000');
  assert.equal(gate.check('1234').lockedOut, true);
  gate.reset();
  const r = gate.check('1234');
  assert.deepEqual(r, { ok: true, remaining: 2, lockedOut: false });
});

test('createPinGate: defaults and bad config soft-fail to maxAttempts 5', () => {
  const rec = hashPin('1234', makeSalt());
  const gate = createPinGate({ record: rec, maxAttempts: -1 });
  assert.equal(gate.check('x').remaining, 4); // 5 - 1
  const gate2 = createPinGate(); // no record at all
  const r = gate2.check('1234');
  assert.equal(r.ok, false); // verifyPin(undefined record) -> false, soft-fail
  assert.equal(r.lockedOut, false);
});
