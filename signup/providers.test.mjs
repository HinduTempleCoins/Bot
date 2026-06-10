// providers.test.mjs — the signup vendor-picker registry. Pure/offline.

import test from 'node:test';
import assert from 'node:assert/strict';

import { listProviders, getProvider, validateProvider, PROVIDER_SCHEMA } from './providers.mjs';

test('listProviders defaults to active providers only', () => {
  const active = listProviders();
  assert.ok(active.length >= 3);
  assert.ok(active.every((p) => p.status === 'active'));
});

test('listProviders status:all includes planned vendors', () => {
  const all = listProviders({ status: 'all' });
  assert.ok(all.some((p) => p.status === 'planned'));
  assert.ok(all.length > listProviders().length);
});

test('listProviders filters by chain', () => {
  const melek = listProviders({ status: 'all', chain: 'MELEK' });
  assert.ok(melek.length >= 3);
  assert.ok(melek.every((p) => p.chain === 'MELEK'));
  const blurt = listProviders({ status: 'all', chain: 'blurt' }); // case-insensitive
  assert.ok(blurt.length >= 1 && blurt.every((p) => p.chain === 'BLURT'));
});

test('every active provider has an https url and a custody statement', () => {
  for (const p of listProviders()) {
    assert.match(p.url, /^https:\/\//, `${p.id} needs an https url`);
    assert.ok(p.custody && p.custody.length > 10, `${p.id} needs a custody statement`);
  }
});

test('getProvider returns a copy, or null', () => {
  const p = getProvider('melek-email');
  assert.equal(p.id, 'melek-email');
  p.name = 'mutated';
  assert.notEqual(getProvider('melek-email').name, 'mutated'); // registry not mutated
  assert.equal(getProvider('nope'), null);
});

test('validateProvider accepts a well-formed community entry', () => {
  const { ok, errors } = validateProvider({
    id: 'acme-onboard', name: 'ACME', chain: 'MELEK', url: 'https://onboard.acme.example/',
    status: 'community', maintainer: 'ACME Labs', summary: 'one tap',
    custody: 'Keys generated in the browser; no password transmitted.',
  });
  assert.equal(ok, true, JSON.stringify(errors));
});

test('validateProvider rejects bad id, missing custody, non-https url', () => {
  assert.equal(validateProvider({ id: 'Bad Id', name: 'x', chain: 'MELEK', status: 'community', url: 'https://x.example', maintainer: 'm', summary: 's', custody: 'c here ok' }).ok, false);
  assert.equal(validateProvider({ id: 'ok-id', name: 'x', chain: 'MELEK', status: 'community', url: 'https://x.example', maintainer: 'm', summary: 's' }).ok, false); // no custody
  assert.equal(validateProvider({ id: 'ok-id', name: 'x', chain: 'MELEK', status: 'community', url: 'http://x.example', maintainer: 'm', summary: 's', custody: 'c here ok' }).ok, false); // http
});

test('validateProvider allows planned entry without a url', () => {
  const { ok } = validateProvider({
    id: 'future-x', name: 'Future', chain: 'STEEM', status: 'planned',
    maintainer: 'MELEK', summary: 'later', custody: 'browser keys', url: '',
  });
  assert.equal(ok, true);
});

test('PROVIDER_SCHEMA documents the required fields', () => {
  for (const k of ['id', 'name', 'chain', 'url', 'status', 'maintainer', 'summary', 'custody']) {
    assert.ok(k in PROVIDER_SCHEMA, `schema missing ${k}`);
  }
});
