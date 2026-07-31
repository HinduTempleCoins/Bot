// pentecaust/herald/verifier.test.mjs — offline tests for the Herald backlink verifier.
// Fully offline: injected __setFetch returns fake HTML, injected __setSleep is a no-op, time via opts.now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLink, verifyAll, __setFetch, __setSleep } from './verifier.mjs';

const OPTS = { now: 1_700_000_000_000 };

// Build a fake Response-like object from HTML + status.
const fakeResp = (html, status = 200) => ({ status, text: async () => html });

// Record calls so tests can assert on them.
function recordingFetch(htmlFor) {
  const calls = [];
  __setFetch(async (url, init) => { calls.push({ url, init }); return htmlFor(url); });
  return calls;
}

test('anchor with no rel → verified_dofollow, present, status 200', async () => {
  const html = '<html><body><p>See <a href="https://target.example/x">here</a></p></body></html>';
  const calls = recordingFetch(() => fakeResp(html, 200));
  const res = await checkLink({ liveLinkUrl: 'https://blog.example/post', targetUrl: 'https://target.example/x' }, OPTS);
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.present, true);
  assert.deepEqual(res.rel, []);
  assert.equal(res.verdict, 'verified_dofollow');
  assert.equal(res.checkedAt, OPTS.now);
  // honest UA sent
  assert.match(String(calls[0].init.headers['user-agent']), /HeraldBacklinkVerifier/);
});

test('anchor with rel="nofollow ugc" → link_live, rel includes both', async () => {
  const html = '<a rel="nofollow ugc" href="https://target.example/x">t</a>';
  recordingFetch(() => fakeResp(html, 200));
  const res = await checkLink({ liveLinkUrl: 'https://blog.example/p', targetUrl: 'https://target.example/x' }, OPTS);
  assert.equal(res.present, true);
  assert.equal(res.verdict, 'link_live');
  assert.ok(res.rel.includes('nofollow'));
  assert.ok(res.rel.includes('ugc'));
});

test('HTML without the target link → link_down, present false', async () => {
  const html = '<a href="https://other.example/y">not it</a>';
  recordingFetch(() => fakeResp(html, 200));
  const res = await checkLink({ liveLinkUrl: 'https://blog.example/p', targetUrl: 'https://target.example/x' }, OPTS);
  assert.equal(res.present, false);
  assert.equal(res.verdict, 'link_down');
});

test('status >= 400 → link_down even if content present', async () => {
  const html = '<a href="https://target.example/x">t</a>';
  recordingFetch(() => fakeResp(html, 404));
  const res = await checkLink({ liveLinkUrl: 'https://blog.example/p', targetUrl: 'https://target.example/x' }, OPTS);
  assert.equal(res.verdict, 'link_down');
});

test('trailing-slash tolerance: href with slash matches target without', async () => {
  const html = '<a href="https://target.example/x/">t</a>';
  recordingFetch(() => fakeResp(html, 200));
  const res = await checkLink({ liveLinkUrl: 'https://blog.example/p', targetUrl: 'https://target.example/x' }, OPTS);
  assert.equal(res.present, true);
  assert.equal(res.verdict, 'verified_dofollow');
});

test('fetch throwing → { ok:false, verdict:link_down } and does NOT throw', async () => {
  __setFetch(async () => { throw new Error('network boom'); });
  let res;
  await assert.doesNotReject(async () => { res = await checkLink({ liveLinkUrl: 'https://x/', targetUrl: 'https://target.example/x' }, OPTS); });
  assert.equal(res.ok, false);
  assert.equal(res.verdict, 'link_down');
  assert.match(res.reason, /boom/);
});

test('verifyAll over 3 rows → 3 verdicts, 3 fetch calls, sleeper used (no real time)', async () => {
  const html = '<a href="https://target.example/x">t</a>';
  const calls = recordingFetch(() => fakeResp(html, 200));
  let sleeps = 0;
  __setSleep(async () => { sleeps++; });  // no-op, records usage
  const rows = [
    { id: 'a', liveLinkUrl: 'https://s1/', targetUrl: 'https://target.example/x' },
    { id: 'b', liveLinkUrl: 'https://s2/', targetUrl: 'https://target.example/x' },
    { id: 'c', liveLinkUrl: 'https://s3/', targetUrl: 'https://target.example/x' },
  ];
  const t0 = Date.now();
  const out = await verifyAll(rows, OPTS);
  const elapsed = Date.now() - t0;
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.id), ['a', 'b', 'c']);
  assert.ok(out.every((r) => r.verdict === 'verified_dofollow'));
  assert.equal(calls.length, 3);
  assert.equal(sleeps, 2);          // paced between the 3 rows
  assert.ok(elapsed < 1000, 'no real throttle time spent');
});

test('verifyAll with a bad row soft-fails to link_down', async () => {
  recordingFetch(() => fakeResp('<a href="https://target.example/x">t</a>', 200));
  __setSleep(async () => {});
  const out = await verifyAll([{ id: 'bad' /* missing urls */ }], OPTS);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'bad');
  assert.equal(out[0].verdict, 'link_down');
});
