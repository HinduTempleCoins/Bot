// indexnow.test.mjs — OFFLINE. Every network call is injected; nothing is ever submitted.
//
// The tests that matter are the ones that stop a FALSE CLAIM. Submitting a URL on a host you do not own
// gets your key distrusted, and telling an operator that a POST here reached Google is simply untrue.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENDPOINTS, SHARED_WITH, NOT_REACHED, MAX_URLS_PER_REQUEST,
  generateKey, isValidKey, keyFile, partition, submit, submitAll, handler, __setFetch,
} from './indexnow.mjs';

const KEY = 'abcdef0123456789abcdef0123456789';
const ok = (status = 200) => __setFetch(async () => ({ status, json: async () => ({}) }));

// --- the honesty tests -------------------------------------------------------

test('Google and Baidu are named as NOT reached, with the reason', () => {
  assert.ok(NOT_REACHED.Google, 'Google must be listed as unreachable by IndexNow');
  assert.match(NOT_REACHED.Google, /retired|Search Console/i);
  assert.ok(NOT_REACHED.Baidu);
  assert.ok(!SHARED_WITH.includes('Google'), 'claiming Google is in IndexNow is false');
  assert.ok(!SHARED_WITH.includes('Baidu'));
});

test('the engines that DO share a submission are the worldwide ones', () => {
  for (const e of ['Bing', 'Yandex', 'Seznam.cz', 'Naver']) assert.ok(SHARED_WITH.includes(e), `${e} missing`);
});

// --- ownership ---------------------------------------------------------------

test('the key file is the authorization model: path and exact body', () => {
  const f = keyFile(KEY);
  assert.equal(f.ok, true);
  assert.equal(f.path, `/${KEY}.txt`);
  assert.equal(f.body, KEY, 'the file must contain exactly the key and nothing else');
});

test('a malformed key is refused before anything is hosted or sent', () => {
  for (const bad of ['', 'short', 'has space', 'has_underscore', 'a'.repeat(129), null]) {
    assert.equal(keyFile(bad).ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.equal(isValidKey(bad), false);
  }
});

test('a generated key is valid and not reused', () => {
  const a = generateKey(); const b = generateKey();
  assert.ok(isValidKey(a));
  assert.notEqual(a, b);
});

test('submit REFUSES without a valid key rather than posting', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { status: 200 }; });
  const r = await submit({ host: 'melek.salon', urls: ['https://melek.salon/'], key: '', dryRun: false });
  assert.equal(r.ok, false);
  assert.equal(called, false);
  assert.match(r.reason, /key/i);
});

// --- the host rule -----------------------------------------------------------

test('a URL on a DIFFERENT host is never submitted under this host', async () => {
  let body = null;
  __setFetch(async (u, init) => { body = JSON.parse(init.body); return { status: 200 }; });
  const r = await submit({
    host: 'melek.salon', key: KEY, dryRun: false,
    urls: ['https://melek.salon/a', 'https://soapbox.community/b', 'https://melek.salon/c'],
  });
  assert.equal(r.ok, true);
  assert.equal(r.submitted, 2);
  assert.equal(r.skipped, 1);
  assert.ok(body.urlList.every((u) => u.includes('melek.salon')), 'a foreign host leaked into the batch');
});

test('a batch with no URLs on the host does not post at all', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { status: 200 }; });
  const r = await submit({ host: 'melek.salon', key: KEY, dryRun: false, urls: ['https://elsewhere.com/a'] });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test('partition groups by host, drops duplicates and uncrawlable schemes', () => {
  const { byHost, rejected } = partition([
    'https://a.com/1', 'https://a.com/1', 'https://b.com/1',
    'mailto:x@y.com', 'not a url', '',
  ]);
  assert.equal(byHost.get('a.com').length, 1, 'duplicate survived');
  assert.equal(byHost.get('b.com').length, 1);
  assert.ok(rejected.some((r) => /scheme/.test(r.why)), 'mailto: was not rejected');
  assert.ok(rejected.some((r) => /duplicate/.test(r.why)));
  assert.ok(rejected.some((r) => /not a URL/.test(r.why)));
});

test('submitAll sends ONE request per host — the protocol requires it', async () => {
  const posts = [];
  __setFetch(async (u, init) => { posts.push(JSON.parse(init.body)); return { status: 200 }; });
  const out = await submitAll(['https://a.com/1', 'https://b.com/1', 'https://a.com/2'], { key: KEY, dryRun: false });
  assert.equal(out.hosts, 2);
  assert.equal(posts.length, 2, 'hosts were mixed into one request');
  assert.equal(out.submitted, 3);
  const a = posts.find((p) => p.host === 'a.com');
  assert.equal(a.urlList.length, 2);
});

// --- the default -------------------------------------------------------------

test('DRY RUN IS THE DEFAULT — a bare call submits nothing', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { status: 200 }; });
  const r = await submit({ host: 'melek.salon', key: KEY, urls: ['https://melek.salon/'] });
  assert.equal(r.dryRun, true);
  assert.equal(r.submitted, 0);
  assert.equal(r.wouldSubmit, 1);
  assert.equal(called, false, 'a dry run hit the network');
});

// --- the wire ----------------------------------------------------------------

test('a real submission carries host, key, keyLocation and the list', async () => {
  let body = null; let url = '';
  __setFetch(async (u, init) => { url = u; body = JSON.parse(init.body); return { status: 200 }; });
  await submit({ host: 'melek.salon', key: KEY, urls: ['https://melek.salon/'], dryRun: false });
  assert.equal(url, ENDPOINTS.indexnow);
  assert.equal(body.host, 'melek.salon');
  assert.equal(body.key, KEY);
  assert.equal(body.keyLocation, `https://melek.salon/${KEY}.txt`);
  assert.deepEqual(body.urlList, ['https://melek.salon/']);
});

test('202 is a success — the key just has not been fetched yet', async () => {
  ok(202);
  const r = await submit({ host: 'melek.salon', key: KEY, urls: ['https://melek.salon/'], dryRun: false });
  assert.equal(r.ok, true);
  assert.match(r.reason, /key not validated/i);
});

test('403 explains the key file, which is the actual fix', async () => {
  ok(403);
  const r = await submit({ host: 'melek.salon', key: KEY, urls: ['https://melek.salon/'], dryRun: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, new RegExp(`${KEY}\\.txt`));
});

test('422 explains the host mismatch', async () => {
  ok(422);
  const r = await submit({ host: 'melek.salon', key: KEY, urls: ['https://melek.salon/'], dryRun: false });
  assert.match(r.reason, /belong to this host/i);
});

test('over the protocol limit is refused rather than silently truncated', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { status: 200 }; });
  const many = Array.from({ length: MAX_URLS_PER_REQUEST + 1 }, (_, i) => `https://melek.salon/${i}`);
  const r = await submit({ host: 'melek.salon', key: KEY, urls: many, dryRun: false });
  assert.equal(r.ok, false);
  assert.equal(called, false);
  assert.match(r.reason, /exceeds the protocol limit/);
});

test('submitAll CHUNKS a very large list instead of refusing it', async () => {
  let posts = 0;
  __setFetch(async () => { posts += 1; return { status: 200 }; });
  const many = Array.from({ length: MAX_URLS_PER_REQUEST + 5 }, (_, i) => `https://melek.salon/${i}`);
  const out = await submitAll(many, { key: KEY, dryRun: false });
  assert.equal(posts, 2, 'a list over the ceiling must be split, not dropped');
  assert.equal(out.submitted, MAX_URLS_PER_REQUEST + 5);
});

test('a network throw is a reason, never an exception', async () => {
  __setFetch(async () => { throw new Error('socket hang up'); });
  const r = await submit({ host: 'melek.salon', key: KEY, urls: ['https://melek.salon/'], dryRun: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /socket/);
});

test('nothing throws on junk', async () => {
  for (const u of [null, undefined, 'x', [], [null], [{}]]) {
    await assert.doesNotReject(() => submitAll(u, { key: KEY }));
    assert.doesNotThrow(() => partition(u));
  }
  await assert.doesNotReject(() => submit({}));
});

test('handler serves the posture, including who is not reached', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.ok(j.notReached.Google);
});
