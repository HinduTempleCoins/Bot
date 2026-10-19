import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DIGEST_AT, planMessages, chunkLines, collectWiki, collectPosts, collectWebpages, postMessages, runFeed, __setFetch, __setSleep } from './discord-feed.mjs';

__setSleep(async () => {});
const items = (n, p = 'https://wiki.soapbox.community/wiki/A_') => Array.from({ length: n }, (_, i) => ({ url: `${p}${i}`, title: `A ${i}` }));
const res = (body, status = 200) => ({ ok: status < 400, status, text: async () => body, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) });

test('a few new items are posted one by one with a preview', () => {
  const { fresh, messages } = planMessages('hathor', items(3), new Set());
  assert.equal(fresh.length, 3);
  assert.equal(messages.length, 3);
  assert.match(messages[0].content, /New from @hathor/);
  assert.equal(messages[0].flags, undefined);
});

test('already-posted urls are skipped', () => {
  const all = items(3);
  const { fresh, messages } = planMessages('wiki', all, new Set([all[0].url, all[1].url]));
  assert.deepEqual(fresh.map((x) => x.url), [all[2].url]);
  assert.equal(messages.length, 1);
  assert.equal(planMessages('wiki', all, new Set(all.map((x) => x.url))).messages.length, 0);
});

test('a backfill becomes digests under the length limit with embeds suppressed', () => {
  const { messages } = planMessages('wiki', items(300), new Set());
  assert.ok(messages.length > 1);
  for (const m of messages) { assert.ok(m.content.length <= 2000); assert.equal(m.flags, 4); }
  assert.match(messages[0].content, /part 1 of/);
  const links = messages.map((m) => m.content).join('\n').match(/\]\(</g).length;
  assert.equal(links, 300);
});

test('webpage digests carry a header per site', () => {
  const list = collectWebpages({ sites: [{ host: 'a.example', pages: [{ url: 'https://a.example/', title: 'A' }, { url: 'https://a.example/x', title: '' }] }, { host: 'b.example', pages: items(DIGEST_AT, 'https://b.example/p') }] });
  const { messages } = planMessages('webpages', list, new Set());
  const all = messages.map((m) => m.content).join('\n');
  assert.match(all, /\*\*a\.example\*\*/);
  assert.match(all, /\*\*b\.example\*\*/);
  assert.match(all, /a\.example\/x/);
});

test('chunkLines never loses a line', () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(50)}`);
  const msgs = chunkLines(lines, () => 'H');
  assert.equal(msgs.join('\n').split('\n').filter((l) => l.startsWith('line')).length, 100);
});

test('wiki collector keeps only article urls and titles them from the slug', async () => {
  __setFetch(async () => res('<urlset><url><loc>https://wiki.soapbox.community/</loc></url><url><loc>https://wiki.soapbox.community/wiki/Dosing_in_Liquids</loc></url><url><loc>https://wiki.soapbox.community/category/x</loc></url></urlset>'));
  const w = await collectWiki();
  assert.deepEqual(w, [{ url: 'https://wiki.soapbox.community/wiki/Dosing_in_Liquids', title: 'Dosing in Liquids' }]);
});

test('post collector drops reblogs and sorts oldest first', async () => {
  __setFetch(async () => res({ result: [
    { author: 'hathor', permlink: 'b', title: 'B', created: '2026-10-02T00:00:00' },
    { author: 'someone', permlink: 'r', title: 'Reblog', created: '2026-10-03T00:00:00' },
    { author: 'hathor', permlink: 'a', title: 'A', created: '2026-10-01T00:00:00' },
  ] }));
  const p = await collectPosts('hathor');
  assert.deepEqual(p.map((x) => x.url), ['https://melek.salon/@hathor/a', 'https://melek.salon/@hathor/b']);
});

test('collectors soft-fail to empty when offline', async () => {
  __setFetch(async () => { throw new Error('offline'); });
  assert.deepEqual(await collectWiki(), []);
  assert.deepEqual(await collectPosts('hathor'), []);
});

test('postMessages waits out a 429 and then posts', async () => {
  const calls = [];
  let first = true;
  __setFetch(async (url, opt) => {
    calls.push(JSON.parse(opt.body));
    if (first) { first = false; return res({ retry_after: 0.01 }, 429); }
    return res({ id: '1' });
  });
  const n = await postMessages('123', [{ content: 'hi' }], 'tok');
  assert.equal(n, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].allowed_mentions, { parse: [] });
});

test('runFeed records what it posted and skips an empty source', async () => {
  const dir = mkdtempSync(join(process.cwd(), '.feedtest-'));
  const stateFile = join(dir, 'state.json');
  const posted = [];
  __setFetch(async (url, opt) => {
    if (String(url).includes('discord.com')) { posted.push(url); return res({ id: 'm' }); }
    if (String(url).endsWith('/sitemap.xml')) return res('<loc>https://wiki.soapbox.community/wiki/One</loc><loc>https://wiki.soapbox.community/wiki/Two</loc>');
    return res('', 500);
  });
  const env = { DISCORD_TOKEN: 't', DISCORD_CH_WIKI: '1', DISCORD_CH_HATHOR: '2' };
  const r = await runFeed({ apply: true, only: ['wiki', 'hathor'], env, stateFile });
  assert.equal(r.find((x) => x.source === 'wiki').posted, 2);
  assert.match(r.find((x) => x.source === 'hathor').skipped, /nothing/);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).wiki.length, 2);
  const again = await runFeed({ apply: true, only: ['wiki'], env, stateFile });
  assert.equal(again[0].messages, 0);
  assert.equal(posted.length, 2);
  rmSync(dir, { recursive: true, force: true });
});
