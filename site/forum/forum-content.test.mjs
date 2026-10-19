// forum-content.test.mjs — offline tests for the forum's content layers: the Hathor seed set (integrity,
// links, ecosystem facts), the JSONL store at FORUM_DATA (persistence, idempotent seeding, stale demo lines
// ignored), the chain mirror wired into the site (mirrored posts render as threads), legacy redirects, body
// rendering, and the post-intent category fix. node --test, no network: the mirror uses an injected fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { handler, forum, mirror, threadPage, renderBody, postIntentPage, templateFor, TEMPLATES } from './server.mjs';
import { SEED_THREADS, LEGACY_IDS, seedEntries } from './seed-threads.mjs';
import { createForumStore, keepPersisted } from './store.mjs';
import { createForum } from '../../integrations/forum/forum-core.mjs';
import { resolveBoard, forumRegistry } from '../../integrations/forum/boards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const WIKI_DIRS = [path.join(here, '..', 'wiki', 'articles'), path.join(here, '..', 'wiki', 'seed-articles')];
const wikiSlugs = new Set(WIKI_DIRS.flatMap((d) => (existsSync(d) ? readdirSync(d) : [])).filter((f) => f.endsWith('.wiki')).map((f) => f.slice(0, -5)));

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function req(p) { const res = mockRes(); await handler({ url: p, method: 'GET', headers: {} }, res); return res; }

// ── the seed set ──────────────────────────────────────────────────────────────────────────────────
test('seed set: large, unique slugs, every board resolves, everything by hathor', () => {
  assert.ok(SEED_THREADS.length >= 80, `seed has ${SEED_THREADS.length} threads`);
  const slugs = SEED_THREADS.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'slugs are unique');
  for (const t of SEED_THREADS) {
    assert.match(t.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `slug ${t.slug}`);
    assert.ok(resolveBoard(t.board), `board ${t.board} resolves (${t.slug})`);
    assert.ok(t.title && t.title.length <= 160, `title ${t.slug}`);
    assert.ok(String(t.body).trim().length >= 200, `body ${t.slug} is substantive`);
  }
  for (const e of seedEntries()) assert.equal(e.author, 'hathor');
});

test('seed set: weighted Make first, then Place, then Medicine, and spread across every pillar', () => {
  const cat = (t) => resolveBoard(t.board).categoryId;
  const n = (ids) => SEED_THREADS.filter((t) => ids.includes(cat(t))).length;
  const make = SEED_THREADS.filter((t) => cat(t) === 'make' || t.board === 'studio').length;
  const place = n(['local', 'travel']);
  const medicine = n(['mind']) + SEED_THREADS.filter((t) => t.board === 'library').length;
  assert.ok(make > place && place > 0, `make ${make} > place ${place}`);
  assert.ok(place >= medicine * 0.8 && medicine >= 15, `place ${place}, medicine ${medicine}`);
  for (const c of ['make', 'melek', 'crypto', 'local', 'travel', 'mind', 'net', 'history', 'gaming', 'style']) {
    assert.ok(SEED_THREADS.some((t) => cat(t) === c), `category ${c} has seed threads`);
  }
  for (const b of ['make/images', 'make/character', 'make/engines', 'make/type', 'pharmacology', 'case-reports', 'local-history']) {
    assert.ok(SEED_THREADS.some((t) => t.board === b), `new board ${b} is seeded`);
  }
});

test('seed set: every wiki link points at an article that exists', () => {
  assert.ok(wikiSlugs.size > 100, 'wiki articles found');
  const bad = [];
  for (const t of SEED_THREADS) {
    const text = [t.body, ...(t.replies || [])].join('\n');
    for (const m of text.matchAll(/wiki\.soapbox\.community\/wiki\/([A-Za-z0-9_().,'-]+)/g)) {
      let slug = m[1].replace(/[.,]+$/, ''); while (slug.endsWith(')') && (slug.match(/\(/g) || []).length < (slug.match(/\)/g) || []).length) slug = slug.slice(0, -1);
      if (!wikiSlugs.has(slug)) bad.push(`${t.slug} → ${slug}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('seed set: no dead hemp /science links, no demo accounts, no fiat values on ecosystem tokens', () => {
  for (const t of SEED_THREADS) {
    const text = [t.title, t.body, ...(t.replies || [])].join('\n');
    assert.doesNotMatch(text, /hemp\.soapbox\.community\/science/, `${t.slug} links a dead route`);
    assert.doesNotMatch(text, /@(satoshi|austin_local|crafter|wanderer)\b/, `${t.slug} names a demo account`);
    assert.doesNotMatch(text, /\$\s?\d[\d,.]*\s*(per\s+)?(MELEK|PRANA|KULA|APIS|WMELEK|MBD)\b/, `${t.slug} prices a token`);
    assert.doesNotMatch(text, /\b(MELEK|PRANA|KULA|APIS)\b[^.\n]{0,25}\b(worth|priced at|trades at)\s*\$\s?\d/i, `${t.slug} prices a token`);
  }
});

test('seed set: ecosystem facts agree with the wiki (PRANA chain id, KulaSwap, Engine, fund, Studio)', () => {
  const all = SEED_THREADS.map((t) => [t.body, ...(t.replies || [])].join('\n')).join('\n');
  for (const m of all.matchAll(/chain ?id[^0-9\n]{0,12}(\d{3,7})\b/gi)) assert.equal(m[1], '712217', 'PRANA chain id');
  assert.match(all, /https:\/\/kula\.money/);
  assert.match(all, /https:\/\/engine\.melek\.salon/);
  assert.match(all, /https:\/\/melek\.salon\/kula/);
  assert.match(all, /https:\/\/hathor\.soapbox\.community/);
  assert.match(all, /https:\/\/wiki\.soapbox\.community/);
  assert.doesNotMatch(all, /hathor\.soapbox\.community\/reels/);
  assert.doesNotMatch(all, /three chains/i);
});

test('the launch threads keep their original /t/t0…t7 addresses as permanent redirects', async () => {
  assert.equal(Object.keys(LEGACY_IDS).length, 8);
  const res = await req('/t/t0');
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location, '/t/welcome-to-the-melek-forum');
  const t7 = await req('/t/t7');
  assert.equal(t7.headers.location, '/t/melek-prana-and-kula-what-each-one-is');
  const page = await req('/t/welcome-to-the-melek-forum');
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /"DiscussionForumPosting"/);
});

test('every seed thread renders at /t/<slug> with its replies', async () => {
  for (const t of SEED_THREADS) {
    const th = await forum.thread(t.slug);
    assert.ok(th, `${t.slug} is a thread`);
    assert.equal(th.replyCount, (t.replies || []).filter((r) => String(r).trim()).length, `${t.slug} replies`);
  }
  const withReplies = SEED_THREADS.find((t) => (t.replies || []).length);
  assert.ok(withReplies, 'some seed threads have replies');
  const html = await threadPage(withReplies.slug);
  assert.match(html, /<\/html>/);
});

test('home shows the whole forum: thread counts per board and recent threads', async () => {
  const res = await req('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Make \/ AI &amp; Graphics/);
  assert.match(res.body, /Image Generation Craft/);
  assert.match(res.body, /\d+ threads/);
  const res2 = await req('/b/make/images');
  assert.match(res2.body, /Belongs here:/);
  assert.match(res2.body, /Goes elsewhere:/);
  assert.match(res2.body, /name="robots" content="index,follow/);
});

test('/sitemap.xml (the one the master index points at) lists every board and every thread', async () => {
  const res = await req('/sitemap.xml');
  assert.equal(res.statusCode, 200);
  const threads = (res.body.match(/<loc>[^<]*\/t\/[^<]+<\/loc>/g) || []).length;
  assert.equal(threads, (await forum.recentThreads(1e9)).length);
  assert.match(res.body, /\/b\/make\/images/);
  assert.match(res.body, /\/b\/local-history/);
});

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────
test('renderBody escapes, links bare URLs, renders ## subheadings, and refuses javascript: links', () => {
  const html = renderBody('## Head <b>\nSee https://kula.money/bridge.html.\n<script>alert(1)</script>\njavascript:alert(2)');
  assert.match(html, /<span class=ph>Head &lt;b&gt;<\/span>/);
  assert.match(html, /<a href="https:\/\/kula\.money\/bridge\.html" rel="nofollow noopener">https:\/\/kula\.money\/bridge\.html<\/a>\./);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /href="javascript/);
  const q = renderBody('"https://x.example/a"');
  assert.match(q, /href="https:\/\/x\.example\/a"/);
});

test('post intent uses a valid chain category for slashed boards, and prefills the board template', () => {
  const html = postIntentPage({ board: 'make/images' });
  assert.match(html, /melek-forum-make-images/);
  assert.doesNotMatch(html, /melek-forum-make\/images/);
  assert.match(html, /## The exact inputs/);
  assert.equal(templateFor(resolveBoard('case-reports')), TEMPLATES.case);
  assert.equal(templateFor(resolveBoard('city/dallas-tx')), TEMPLATES.local);
  assert.equal(templateFor(resolveBoard('economy')), '');
});

// ── persistence ───────────────────────────────────────────────────────────────────────────────────
function memFs(initial = '') {
  const files = new Map([['/data/forum.jsonl', initial]]);
  return {
    files,
    readFileSync(f) { if (!files.has(f)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(f); },
    appendFileSync(f, s) { files.set(f, (files.get(f) || '') + s); },
    mkdirSync() {},
  };
}
const STALE = [
  { kind: 'post', id: 't0', threadId: 't0', board: 'announcements', author: 'hathor', title: 'Welcome to the MELEK Forum', body: 'old', parentId: null, ts: 1, seq: 0 },
  { kind: 'post', id: 't3', threadId: 't3', board: 'crypto/bitcoin', author: 'satoshi', title: 'Self-custody basics', body: 'demo', parentId: null, ts: 2, seq: 3 },
  { kind: 'post', id: 't4', threadId: 't4', board: 'city/austin-tx', author: 'austin_local', title: 'Moving to Austin', body: 'demo', parentId: null, ts: 3, seq: 4, src: 'local' },
].map((e) => JSON.stringify(e)).join('\n') + '\n';

test('store: stale lines from older builds and demo accounts are ignored, never shown', () => {
  const fs = memFs(STALE);
  const store = createForumStore({ file: '/data/forum.jsonl', fs, seed: () => seedEntries() });
  const ids = store.all().map((e) => e.id);
  assert.ok(!ids.includes('t0') && !ids.includes('t3') && !ids.includes('t4'));
  assert.ok(ids.includes('welcome-to-the-melek-forum'));
  assert.equal(keepPersisted({ kind: 'post', id: 'x', board: 'general', author: 'satoshi', src: 'local' }), false);
  assert.equal(keepPersisted({ kind: 'post', id: 'x', board: 'general', author: 'alice', src: 'local' }), true);
});

test('store: posts survive a restart, and seeding never duplicates', async () => {
  const fs = memFs('');
  const mk = () => createForum({ store: createForumStore({ file: '/data/forum.jsonl', fs, seed: () => seedEntries() }), registry: forumRegistry() });
  const f1 = mk();
  await f1.grantAllotment('sponsor-x', { now: 1 });
  const t = await f1.createThread({ board: 'make/images', author: 'alice', title: 'My LCM settings', body: '6 steps, CFG 1.5', now: Date.parse('2026-10-19T12:00:00Z') });
  assert.equal(t.ok, true);
  const before = (await f1.recentThreads(1e9)).length;
  assert.match(fs.files.get('/data/forum.jsonl'), /My LCM settings/);
  // "restart": a fresh engine over the same file
  const f2 = mk();
  const after = await f2.recentThreads(1e9);
  assert.equal(after.length, before, 'same thread count after restart (no duplicate seed)');
  assert.ok(after.some((x) => x.id === t.thread.id && x.title === 'My LCM settings'), 'the post survived');
  const t2 = await f2.createThread({ board: 'general', author: 'bob', title: 'Second', body: 'b', now: Date.parse('2026-10-19T13:00:00Z') });
  assert.notEqual(t2.thread.id, t.thread.id, 'ids keep counting after a restart');
  assert.equal((fs.files.get('/data/forum.jsonl').match(/welcome-to-the-melek-forum/g) || []).length, 0, 'seed is never written');
});

test('store: chain-mirrored entries are persisted and recovered on boot', () => {
  const fs = memFs('');
  const s1 = createForumStore({ file: '/data/forum.jsonl', fs });
  s1.persistChain([{ kind: 'post', id: 'm-hathor-a', threadId: 'm-hathor-a', board: 'announcements', author: 'hathor', title: 'A', body: 'x', parentId: null, ts: 1, seq: 0, src: 'chain' }]);
  const s2 = createForumStore({ file: '/data/forum.jsonl', fs });
  assert.deepEqual(s2.persistedChain().map((e) => e.id), ['m-hathor-a']);
});

// ── the chain mirror, wired into the site ─────────────────────────────────────────────────────────
test('an on-chain @hathor post appears as a thread linking to melek.salon; a melek-forum reply attaches to a seed thread', async () => {
  const seedSlug = SEED_THREADS.find((t) => t.board === 'make/images').slug;
  mirror.__setFetch(async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    let result = [];
    if (method === 'condenser_api.get_discussions_by_blog' && params[0].tag === 'hathor') {
      result = [{ author: 'hathor', permlink: 'the-ai-club-is-open-how-ai-works', category: 'aiclub', title: 'The AI Club Is Open', body: 'MYCIN and me. '.repeat(20), created: '2026-10-18T01:32:04', children: 0, parent_author: '', json_metadata: '{}' }];
    }
    if (method === 'condenser_api.get_discussions_by_created' && params[0].tag === 'melek-forum-make-images') {
      result = [{ author: 'alice', permlink: 're-1', category: 'melek-forum-make-images', title: 'Re: x', body: 'CFG 1.5 fixed it for me.', created: '2026-10-19T02:00:00', children: 0, parent_author: '', json_metadata: JSON.stringify({ app: 'melek-forum', board: 'make/images', reply_to: seedSlug }) }];
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  await mirror.refresh();
  const res = await req('/t/m-hathor-the-ai-club-is-open-how-ai-works');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /The AI Club Is Open/);
  assert.match(res.body, /read it on melek\.salon/);
  assert.match(res.body, /https:\/\/melek\.salon\/aiclub\/@hathor\/the-ai-club-is-open-how-ai-works/);
  assert.match(res.body, /Early AI/);                          // aiclub → ai-history board
  const th = await forum.thread(seedSlug);
  assert.ok(th.posts.some((p) => p.author === 'alice' && /CFG 1\.5/.test(p.body)), 'reply attached to the seed thread');
  const sm = await req('/sitemap-threads-1.xml');
  assert.match(sm.body, /\/t\/m-hathor-the-ai-club-is-open-how-ai-works/);
  mirror.__setFetch(null);
});
