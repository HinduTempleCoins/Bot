// site/yoni/applications-store.test.mjs — OFFLINE, injected IO. That an application is validated,
// that it refuses identity-document fields the way the gate does, and that it grants nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApplication, appendApplication, listApplications, __setIO, ACKS, FIELDS, storePath }
  from './applications-store.mjs';
import { producerAllowed } from './surfaces.mjs';

const okInput = (extra = {}) => ({
  contact: 'someone@example.com', what: 'studio stills, my own work', ...Object.fromEntries(Object.keys(ACKS).map((k) => [k, true])), ...extra,
});

function memIO() {
  const files = new Map();
  __setIO({
    read: (p) => files.get(p) || '',
    append: (p, line) => { files.set(p, (files.get(p) || '') + line); return true; },
  });
  return files;
}

test('a complete application validates and is shaped', () => {
  const r = buildApplication(okInput(), { now: () => 1000 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.record.at, 1000);
  assert.equal(r.record.status, 'applied');
  assert.equal(r.record.contact, 'someone@example.com');
  assert.deepEqual(r.record.acks, Object.keys(ACKS));
});

test('contact and a description of the work are both required', () => {
  assert.match(buildApplication(okInput({ contact: '' })).reason, /contact/);
  assert.match(buildApplication(okInput({ contact: 'ab' })).reason, /too short/);
  assert.match(buildApplication(okInput({ what: '' })).reason, /what you would produce/);
});

test('every acknowledgement must be made explicitly', () => {
  for (const k of Object.keys(ACKS)) {
    const input = okInput(); delete input[k];
    const r = buildApplication(input);
    assert.equal(r.ok, false, `${k} was not required`);
    assert.match(r.reason, /acknowledge/);
  }
  // a falsy value is not an acknowledgement
  assert.equal(buildApplication(okInput({ over18: false })).ok, false);
  assert.equal(buildApplication(okInput({ over18: 'no' })).ok, false);
  // the form posts 'on'
  assert.equal(buildApplication(okInput({ over18: 'on' })).ok, true);
});

test('an application carrying identity-document fields is refused outright', () => {
  for (const bad of ['dob', 'date_of_birth', 'ssn', 'passport', 'drivers_license', 'selfie', 'id_image', 'biometric']) {
    const r = buildApplication(okInput({ [bad]: 'anything' }));
    assert.equal(r.ok, false, `${bad} was accepted`);
    assert.match(r.reason, /refusing to store/);
  }
});

test('only the declared fields are kept', () => {
  const r = buildApplication(okInput({ sneaky: 'x', what: 'work' }));
  assert.equal(r.ok, true, r.reason);
  for (const k of Object.keys(r.record)) {
    assert.ok([...FIELDS, 'at', 'status', 'acks'].includes(k), `unexpected field kept: ${k}`);
  }
});

test('append then list round-trips, newest first', () => {
  memIO();
  const path = '/x/apps.jsonl';
  assert.equal(appendApplication(okInput({ contact: 'first@example.com' }), { path, now: () => 1 }).ok, true);
  assert.equal(appendApplication(okInput({ contact: 'second@example.com' }), { path, now: () => 2 }).ok, true);
  const all = listApplications({ path });
  assert.equal(all.length, 2);
  assert.equal(all[0].contact, 'second@example.com', 'newest first');
});

test('a torn line shortens the list instead of throwing', () => {
  const files = memIO();
  files.set('/x/t.jsonl', '{"contact":"a"}\n{not json\n{"contact":"b"}\n');
  const all = listApplications({ path: '/x/t.jsonl' });
  assert.equal(all.length, 2);
});

test('a failed write is reported, not swallowed', () => {
  __setIO({ read: () => '', append: () => false });
  const r = appendApplication(okInput(), { path: '/x/full.jsonl' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /could not write/);
});

test('an application grants no publishing rights', () => {
  memIO();
  const path = '/x/apps.jsonl';
  appendApplication(okInput({ contact: 'applicant@example.com' }), { path });
  // applying does not put anyone on the producer list
  assert.equal(producerAllowed('applicant@example.com', { producers: [] }), false);
});

test('the store path comes from the environment with a sane default', () => {
  assert.match(storePath({}), /applications\.jsonl$/);
  assert.equal(storePath({ YONI_APPLICATIONS: '/tmp-free/elsewhere.jsonl' }), '/tmp-free/elsewhere.jsonl');
});
