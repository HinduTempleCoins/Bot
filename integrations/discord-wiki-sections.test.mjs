// discord-wiki-sections.test.mjs — OFFLINE. Parsing the live wiki's HTML, Discord's size ceilings,
// the non-destructive planner, and the edit-in-place behaviour that makes the timer safe to re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseCategoriesIndex, parseCategoryPage, topicFor, buildEmbeds, chunkEmbeds,
  planWikiSections, renderPlan, chanName, categoryLabel, LIMITS, WIKI,
  applyPlan, __setFetch, loadState,
} from './discord-wiki-sections.mjs';

const INDEX_HTML = `
  <a href="/category/substances">Substances and pharmacology</a>
  <a href="/category/substances">125 articles &rsaquo;</a>
  <a href="/category/work-credentials">Work &amp; credentials</a>
  <a href="/category/work-credentials">34 articles &rsaquo;</a>
  <a href="/category/law">Law and your rights</a>
  <a href="/category/law">25 articles &rsaquo;</a>`;

test('parses the categories index, decoding entities and counts', () => {
  const cats = parseCategoriesIndex(INDEX_HTML);
  assert.equal(cats.length, 3);
  const byId = Object.fromEntries(cats.map((c) => [c.id, c]));
  assert.equal(byId.substances.name, 'Substances and pharmacology');
  assert.equal(byId.substances.count, 125);
  assert.equal(byId['work-credentials'].name, 'Work & credentials');
  assert.ok(!cats.some((c) => /articles/.test(c.name)), 'the count link must not be mistaken for a name');
});

test('parses a category page, de-duplicates and sorts by title', () => {
  const html = `
    <a href="/wiki/Nootropics">Nootropics</a>
    <a href="/wiki/Cannabis">Cannabis</a>
    <a href="/wiki/Nootropics">Nootropics</a>
    <a href="/wiki/B-Vitamins">B-Vitamins &amp; friends</a>`;
  const arts = parseCategoryPage(html);
  assert.deepEqual(arts.map((a) => a.slug), ['B-Vitamins', 'Cannabis', 'Nootropics']);
  assert.equal(arts[0].title, 'B-Vitamins & friends');
});

test('a channel topic links the category and never exceeds the cap', () => {
  const cat = { id: 'substances', name: 'Substances and pharmacology', articles: new Array(125).fill({ slug: 'x', title: 'x' }) };
  const t = topicFor(cat);
  assert.ok(t.includes(`${WIKI}/category/substances`), 'topic must link the category');
  assert.ok(t.includes('125 articles'));
  assert.ok(t.length <= LIMITS.topic);
  const huge = topicFor({ id: 'x', name: 'N'.repeat(4000), articles: [] });
  assert.ok(huge.length <= LIMITS.topic, 'a very long name is truncated, not rejected');
});

test('every article becomes a masked link, and no embed exceeds the description cap', () => {
  const articles = Array.from({ length: 300 }, (_, i) => ({ slug: `Article_${i}`, title: `Article number ${i}` }));
  const embeds = buildEmbeds({ id: 'substances', name: 'Substances', articles });
  const all = embeds.map((e) => e.description).join('\n');
  for (const a of articles) assert.ok(all.includes(`[${a.title}](${WIKI}/wiki/${a.slug})`), `${a.slug} missing`);
  for (const e of embeds) assert.ok((e.description || '').length <= LIMITS.embedDescription);
  assert.equal(embeds[0].url, `${WIKI}/category/substances`, 'the first embed links the category');
});

test('embeds are chunked so no message breaks Discord\'s per-message ceilings', () => {
  const articles = Array.from({ length: 600 }, (_, i) => ({ slug: `A_${i}`, title: `A rather long article title number ${i}` }));
  const msgs = chunkEmbeds(buildEmbeds({ id: 'c', name: 'C', articles }));
  assert.ok(msgs.length >= 1);
  for (const m of msgs) {
    assert.ok(m.length <= LIMITS.embedsPerMessage, 'too many embeds in one message');
    const total = m.reduce((n, e) => n + (e.description || '').length + (e.title || '').length, 0);
    assert.ok(total <= LIMITS.messageTotal, `message total ${total} over the ceiling`);
  }
});

test('an empty category still renders rather than throwing', () => {
  const embeds = buildEmbeds({ id: 'empty', name: 'Empty', articles: [] });
  assert.equal(embeds.length, 1);
  assert.match(embeds[0].description, /No articles/);
});

test('channel names are Discord-legal and namespaced under wiki-', () => {
  assert.equal(chanName('work-credentials'), 'wiki-work-credentials');
  assert.equal(chanName('history'), 'wiki-history');
  assert.ok(chanName('x'.repeat(200)).length <= 100);
});

test('NAMESPACING: a wiki channel can never collide with the operator\'s hand-authored layout', async () => {
  // discord-organize.mjs owns #law (in SOAPBOX), #tools, #games and others. If this module
  // generated a bare #law it would find that channel by name and overwrite its topic.
  const { LAYOUT } = await import('./discord-organize.mjs');
  const owned = new Set(LAYOUT.flatMap((s) => [...(s.create || []), ...(s.match || [])]).map((n) => n.toLowerCase()));
  const wikiIds = ['start', 'work-credentials', 'posting-help', 'chains', 'entrainment', 'substances',
    'chemistry', 'plants', 'religion', 'history', 'people', 'tools', 'law', 'philosophy', 'verticals'];
  for (const id of wikiIds) {
    assert.ok(!owned.has(chanName(id)), `wiki channel ${chanName(id)} collides with the organizer's layout`);
  }
  // and the bare, un-namespaced names genuinely would have collided — this is not a theoretical guard
  assert.ok(wikiIds.some((id) => owned.has(id)), 'expected at least one bare name to collide');
});

test('the planner creates and never deletes or renames', () => {
  const cats = parseCategoriesIndex(INDEX_HTML).map((c) => ({ ...c, articles: [] }));
  const plan = planWikiSections(cats, []);
  assert.equal(plan.summary.createCategories, 3);
  assert.equal(plan.summary.createChannels, 3);
  for (const o of plan.ops) assert.ok(['create-category', 'create-channel', 'set-topic'].includes(o.kind), `unexpected ${o.kind}`);
  assert.match(renderPlan(plan), /nothing deleted/);
});

test('re-planning an already-correct guild is a no-op — the timer must not churn', () => {
  const cat = { id: 'law', name: 'Law and your rights', count: 25, articles: [] };
  const existing = [
    { id: 'cat1', name: categoryLabel(cat), type: 4 },
    { id: 'ch1', name: chanName(cat.id), type: 0, parent_id: 'cat1', topic: topicFor(cat) },
  ];
  const plan = planWikiSections([cat], existing);
  assert.equal(plan.ops.length, 0, 'nothing to do when the guild already matches');
});

test('a new article changes only the topic op, not the structure', () => {
  const before = { id: 'law', name: 'Law', articles: [{ slug: 'A', title: 'A' }] };
  const after = { id: 'law', name: 'Law', articles: [{ slug: 'A', title: 'A' }, { slug: 'B', title: 'B' }] };
  const existing = [
    { id: 'cat1', name: categoryLabel(before), type: 4 },
    { id: 'ch1', name: chanName('law'), type: 0, parent_id: 'cat1', topic: topicFor(before) },
  ];
  const plan = planWikiSections([after], existing);
  assert.equal(plan.summary.createCategories, 0);
  assert.equal(plan.summary.createChannels, 0);
  assert.equal(plan.summary.setTopics, 1, 'only the topic needs updating');
});

test('indexes are EDITED on a second run, not posted twice', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'dws-')), 'state.json');
  const calls = [];
  __setFetch(async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${String(url).replace('https://discord.com/api/v10', '')}`);
    const body = { id: 'm1', name: 'x' };
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  });
  process.env.DISCORD_TOKEN = 'test-token';
  const cat = { id: 'law', name: 'Law', articles: [{ slug: 'A', title: 'A' }] };
  const existing = [
    { id: 'cat1', name: categoryLabel(cat), type: 4 },
    { id: 'ch1', name: chanName('law'), type: 0, parent_id: 'cat1', topic: topicFor(cat) },
  ];
  await applyPlan('g1', planWikiSections([cat], existing), [cat], existing, statePath);
  const firstPosts = calls.filter((c) => c.startsWith('POST /channels/ch1/messages')).length;
  assert.equal(firstPosts, 1, 'first run posts the index');
  assert.deepEqual(loadState(statePath).messages.law, ['m1']);

  calls.length = 0;
  await applyPlan('g1', planWikiSections([cat], existing), [cat], existing, statePath);
  assert.equal(calls.filter((c) => c.startsWith('POST /channels/ch1/messages')).length, 0, 'second run must not post again');
  assert.equal(calls.filter((c) => c.startsWith('PATCH /channels/ch1/messages/m1')).length, 1, 'it edits the message it posted');
  __setFetch(null);
});
