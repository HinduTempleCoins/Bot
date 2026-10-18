// build.test.mjs — OFFLINE tests for the Bridgy Fed site builder (fake RPC, fake fetch, temp dir under the repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAccounts, renderHome, renderPost, renderFeed, sendWebmentions, buildAccount, postUrl, tags, bodyText, BRIDGY, BRIDGY_WEBMENTION } from './build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const A = { account: 'hathor', domain: 'hathor.social.melek.salon', name: 'Hathor', bio: 'AI witness <b>', avatar: 'hathor.jpg', links: [{ href: 'https://hathor.live/', text: 'Talk' }] };
const post = (permlink, created, extra = {}) => ({ author: 'hathor', permlink, created, last_update: created, category: 'melek', title: `T ${permlink}`,
  body: 'Hello **world** ![x](https://img.example/a.png) more text', json_metadata: '{"tags":["melek","ai","BAD TAG"]}', parent_author: '', ...extra });

test('accounts.json ships hathor on her own domain, with an avatar file that exists', () => {
  const accts = loadAccounts();
  const h = accts.find((a) => a.account === 'hathor');
  assert.equal(h.domain, 'hathor.social.melek.salon');
  assert.ok(existsSync(join(HERE, h.avatar)));
  assert.deepEqual(loadAccounts('x', () => '{"BAD":{"domain":"x.y"},"ok1":{"domain":"nope"}}'), []);
  assert.deepEqual(loadAccounts('x', () => { throw new Error('missing'); }), []);
});

test('home page is an h-card profile with u-url/u-photo, a feed link, and the follow handles', () => {
  const html = renderHome(A, [post('p1', '2026-10-18T01:32:04', { title: '<script>x</script>' })]);
  assert.match(html, /class="card h-card who"/);
  assert.match(html, /class="p-name u-url u-uid" href="https:\/\/hathor\.social\.melek\.salon\/"/);
  assert.match(html, /class=u-photo src="https:\/\/hathor\.social\.melek\.salon\/hathor\.jpg"/);
  assert.match(html, /rel=alternate type="application\/atom\+xml"[^>]*href="https:\/\/hathor\.social\.melek\.salon\/feed\.xml"/);
  assert.match(html, /@hathor\.social\.melek\.salon@web\.brid\.gy/);
  assert.match(html, /hathor\.social\.melek\.salon\.web\.brid\.gy/);
  assert.ok(!html.includes('<script>x') && !html.includes('AI witness <b>'));
  assert.ok(!html.includes('p-summary'));   // a summary would become a Mastodon content warning
});

test('post page is a note-style h-entry: content, date, image, tags, author, Bridgy link, canonical to melek.salon', () => {
  const html = renderPost(A, post('p1', '2026-10-18T01:32:04'));
  assert.match(html, /class="card entry h-entry"/);
  assert.match(html, /class=e-content><p>T p1<\/p>/);
  assert.ok(!html.includes('<b>'));   // Bridgy turns <b> into literal **asterisks** on Bluesky
  assert.match(html, /class=dt-published datetime="2026-10-18T01:32:04Z"/);
  assert.match(html, /class=u-url href="https:\/\/hathor\.social\.melek\.salon\/posts\/p1\/"/);
  assert.match(html, /class=u-photo src="https:\/\/img\.example\/a\.png"/);
  assert.match(html, /<data class=p-category value="melek">/);
  assert.match(html, /class="small-author p-author h-card"/);
  assert.match(html, /class=u-bridgy-fed href="https:\/\/fed\.brid\.gy\/" hidden/);
  assert.match(html, /<link rel=canonical href="https:\/\/melek\.salon\/melek\/@hathor\/p1">/);
  assert.ok(!/class=p-name/.test(html.split('h-entry')[1].replace(/p-author h-card[\s\S]*?<\/p>/, '')));   // note, not article
  assert.ok(!html.includes('p-summary'));
});

test('bodyText drops a leading copy of the title', () => {
  assert.equal(bodyText({ title: 'Big News', body: '# Big News\n\nThe chain is live.' }), 'The chain is live.');
  assert.equal(bodyText({ title: 'Other', body: 'Plain body' }), 'Plain body');
  assert.ok(bodyText({ title: 'x', body: 'word '.repeat(200) }, 50).length <= 51);
});

test('tags: from json_metadata, valid only, max five', () => {
  assert.deepEqual(tags(post('x', '2026-10-01T00:00:00')), ['melek', 'ai']);
  assert.deepEqual(tags({ json_metadata: 'not json' }), []);
});

test('Atom feed: valid entries as notes, escaped, linking the h-entry pages', () => {
  const xml = renderFeed(A, [post('p1', '2026-10-18T01:32:04'), post('p0', '2026-10-17T00:00:00', { title: 'a & b' })]);
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<id>https:\/\/hathor\.social\.melek\.salon\/posts\/p1\/<\/id>/);
  assert.match(xml, /<activity:object-type>http:\/\/activitystrea\.ms\/schema\/1\.0\/note<\/activity:object-type>/);
  assert.match(xml, /<title>a &amp; b<\/title>/);
  assert.match(xml, /<updated>2026-10-18T01:32:04Z<\/updated>/);
});

test('webmentions: oldest first, once per version, too-old skipped, failures retried, never throws', async () => {
  const now = Date.parse('2026-10-18T06:00:00Z');
  const posts = [post('new', '2026-10-18T01:00:00'), post('mid', '2026-10-10T00:00:00'), post('old', '2026-09-01T00:00:00')];
  const calls = [];
  const ok = async (u, o) => { calls.push([u, new URLSearchParams(o.body)]); return { status: 202 }; };
  const r = await sendWebmentions(A, posts, {}, { fetch: ok, now });
  assert.deepEqual(r.sent, ['mid', 'new']);
  assert.deepEqual(r.skipped, ['old']);
  assert.equal(calls[0][0], BRIDGY_WEBMENTION);
  assert.equal(calls[0][1].get('source'), postUrl(A, posts[1]));
  assert.equal(calls[0][1].get('target'), BRIDGY);
  // second run: nothing new
  const r2 = await sendWebmentions(A, posts, r.state, { fetch: ok, now });
  assert.equal(r2.sent.length + r2.skipped.length, 0);
  // an edit resends; a failing endpoint does not mark sent
  const edited = [post('new', '2026-10-18T01:00:00', { last_update: '2026-10-18T05:00:00' }), ...posts.slice(1)];
  const r3 = await sendWebmentions(A, edited, r.state, { fetch: async () => ({ status: 500 }), now });
  assert.deepEqual(r3.failed, ['new']);
  assert.equal(r3.state.new, r.state.new);
  const r4 = await sendWebmentions(A, edited, r.state, { fetch: async () => { throw new Error('down'); }, now });
  assert.deepEqual(r4.failed, ['new']);
});

test('buildAccount writes home, posts, feed and avatar; an empty chain read writes nothing', async () => {
  const base = join(HERE, '.test-out');
  rmSync(base, { recursive: true, force: true });
  const out = mkdtempSync(base);
  try {
    const f = async () => ({ json: async () => ({ result: [post('p1', '2026-10-18T01:32:04')] }) });
    const posts = await buildAccount(A, { outRoot: out, rpcUrl: 'http://rpc', fetch: f });
    assert.equal(posts.length, 1);
    const dir = join(out, A.domain);
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /h-card/);
    assert.match(readFileSync(join(dir, 'posts', 'p1', 'index.html'), 'utf8'), /h-entry/);
    assert.match(readFileSync(join(dir, 'feed.xml'), 'utf8'), /<feed/);
    assert.ok(existsSync(join(dir, 'hathor.jpg')));
    const none = await buildAccount({ ...A, domain: 'empty.example' }, { outRoot: out, rpcUrl: 'http://rpc', fetch: async () => { throw new Error('down'); } });
    assert.equal(none.length, 0);
    assert.ok(!existsSync(join(out, 'empty.example')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});
