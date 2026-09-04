// pentecaust/herald/social-adapters.test.mjs — offline (mocked fetch, no live network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postToSocial, postToNetworks, NETWORKS, __setFetch } from './social-adapters.mjs';

// A mock fetch that records the last request and returns a canned success body per network shape.
function mockFetch(body, { status = 200, ok = true } = {}) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return { ok, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test('happy path — X posts and returns id', async () => {
  const m = mockFetch({ data: { id: '1799' } });
  __setFetch(m);
  const r = await postToSocial({ network: 'x', text: 'gm', link: 'https://melek.salon', token: 'tok-x' });
  assert.equal(r.ok, true);
  assert.equal(r.network, 'x');
  assert.equal(r.id, '1799');
  // token went out as a Bearer header, and is NOT in the returned result.
  assert.equal(m.calls[0].options.headers.authorization, 'Bearer tok-x');
  assert.ok(!JSON.stringify(r).includes('tok-x'));
  const sent = JSON.parse(m.calls[0].options.body);
  assert.ok(sent.text.includes('gm'));
  assert.ok(sent.text.includes('https://melek.salon'));
  __setFetch(null);
});

test('happy path — LinkedIn posts with ARTICLE media when link present', async () => {
  const m = mockFetch({ id: 'urn:li:share:99' });
  __setFetch(m);
  const r = await postToSocial({ network: 'linkedin', text: 'hi', link: 'https://x.io', token: 'li-tok', meta: { author: 'urn:li:person:AB' } });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'urn:li:share:99');
  const sent = JSON.parse(m.calls[0].options.body);
  assert.equal(sent.author, 'urn:li:person:AB');
  assert.equal(sent.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory, 'ARTICLE');
  assert.equal(m.calls[0].options.headers.authorization, 'Bearer li-tok');
  __setFetch(null);
});

test('happy path — Facebook posts to /<page>/feed with link', async () => {
  const m = mockFetch({ id: '123_456' });
  __setFetch(m);
  const r = await postToSocial({ network: 'facebook', text: 'post', link: 'https://a.b', token: 'fb-tok', meta: { pageId: '777' } });
  assert.equal(r.ok, true);
  assert.equal(r.id, '123_456');
  assert.match(m.calls[0].url, /\/777\/feed$/);
  const sent = JSON.parse(m.calls[0].options.body);
  assert.equal(sent.link, 'https://a.b');
  __setFetch(null);
});

test('unconfigured — missing token soft-fails, makes NO network call', async () => {
  const m = mockFetch({ id: 'nope' });
  __setFetch(m);
  for (const n of NETWORKS) {
    const r = await postToSocial({ network: n, text: 'hey', link: 'https://z.z' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unconfigured');
  }
  assert.equal(m.calls.length, 0, 'no fetch should happen without a token');
  __setFetch(null);
});

test('unknown network and empty text soft-fail', async () => {
  const a = await postToSocial({ network: 'mastodon', text: 'x', token: 't' });
  assert.equal(a.ok, false);
  assert.equal(a.reason, 'unknown_network');
  const b = await postToSocial({ network: 'x', text: '   ', link: '  ', token: 't' });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'empty');
});

test('http error soft-fails with status', async () => {
  const m = mockFetch({ error: 'bad' }, { ok: false, status: 401 });
  __setFetch(m);
  const r = await postToSocial({ network: 'x', text: 'hi', token: 'bad-tok' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http_error');
  assert.equal(r.status, 401);
  __setFetch(null);
});

test('esc — HTML-special chars in text are escaped in the outbound payload', async () => {
  const m = mockFetch({ data: { id: '1' } });
  __setFetch(m);
  await postToSocial({ network: 'x', text: '<script>&"\'', link: '', token: 't' });
  const sent = JSON.parse(m.calls[0].options.body);
  assert.ok(!sent.text.includes('<script>'));
  assert.ok(sent.text.includes('&lt;script&gt;'));
  assert.ok(sent.text.includes('&amp;'));
  assert.ok(sent.text.includes('&quot;'));
  assert.ok(sent.text.includes('&#39;'));
  __setFetch(null);
});

test('postToNetworks — fans out; missing token per network is unconfigured, others ok', async () => {
  const m = mockFetch({ data: { id: '7' } });
  __setFetch(m);
  const r = await postToNetworks({ text: 'hi', link: 'https://q.q', tokens: { x: 'xt' } });
  assert.equal(r.ok, true);
  assert.equal(r.results.x.ok, true);
  assert.equal(r.results.linkedin.reason, 'unconfigured');
  assert.equal(r.results.facebook.reason, 'unconfigured');
  __setFetch(null);
});

test('never throws on garbage input', async () => {
  const r = await postToSocial(undefined);
  assert.equal(r.ok, false);
  const r2 = await postToSocial({ network: 'x', text: 42, token: 5 });
  assert.equal(typeof r2.ok, 'boolean');
});
