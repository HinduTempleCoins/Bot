// geo.test.mjs — SEO / GEO / WikiEO presentation layer. Offline: handler driven directly over a temp ARTICLES_DIR,
// the Wikidata matcher driven by an injected fetch. Run: node --test site/wiki/geo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wikiToMarkdown, llmsIndex, atomFeed, aboutNode, collectionLd, websiteLd } from './geo.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-'));
fs.writeFileSync(path.join(tmp, 'Kava.wiki'), "== Overview ==\n'''Kava''' is a plant from the western Pacific islands used as a ceremonial drink.<ref>kava-sources.md</ref>\n* one\n** two\n");
fs.writeFileSync(path.join(tmp, 'Test_<Thing>.wiki'), 'A deliberately awkward title used to check escaping everywhere it appears.\n');
const map = path.join(tmp, 'wd.json');
fs.writeFileSync(map, JSON.stringify({ bySlug: { Kava: { qid: 'Q161067', wikipedia: 'Kava' } } }));
process.env.ARTICLES_DIR = tmp;
process.env.WIKI_WIKIDATA_MAP = map;
const { handler } = await import('./server.mjs');

function call(url) {
  return new Promise((resolve) => {
    const res = { code: 0, headers: {}, writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { resolve({ code: this.code, headers: this.headers, body: String(b || '') }); } };
    handler({ url, headers: {} }, res);
  });
}

test('wikiToMarkdown keeps the words, turns markup into Markdown, citations into [n] + Sources', () => {
  const md = wikiToMarkdown("== Uses ==\n'''Bold''' and ''it'' with [[Kava|a link]].<ref>a.md</ref>\n* x\n** y\n# n");
  assert.match(md, /^## Uses/m);
  assert.match(md, /\*\*Bold\*\* and \*it\* with a link\.\[1\]/);
  assert.match(md, /^- x$/m);
  assert.match(md, /^  - y$/m);
  assert.match(md, /## Sources\n\n1\. a\.md/);
});

test('article page: WikiEO about/sameAs + breadcrumbs + markdown alternate', async () => {
  const r = await call('/wiki/Kava');
  assert.equal(r.code, 200);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(r.body)[1]);
  const art = ld['@graph'].find((n) => n['@type'] === 'Article');
  assert.deepEqual(art.about.sameAs, ['https://www.wikidata.org/wiki/Q161067', 'https://en.wikipedia.org/wiki/Kava']);
  assert.equal(art.inLanguage, 'en');
  assert.ok(ld['@graph'].some((n) => n['@type'] === 'BreadcrumbList'));
  assert.match(r.body, /rel="alternate" type="text\/markdown"[^>]*href="[^"]*\/wiki\/Kava\.md"/);
  assert.match(r.body, /Elsewhere: <a href="https:\/\/www\.wikidata\.org\/wiki\/Q161067"/);
  assert.match(r.body, /application\/atom\+xml/);
});

test('/wiki/<slug>.md, /llms.txt, /llms-full.txt and /feed.xml serve the article without changing it', async () => {
  const md = await call('/wiki/Kava.md');
  assert.equal(md.code, 200);
  assert.match(md.headers['content-type'], /text\/markdown/);
  assert.match(md.body, /^# Kava/);
  assert.match(md.body, /\*\*Kava\*\* is a plant from the western Pacific islands used as a ceremonial drink\.\[1\]/);
  assert.equal((await call('/wiki/Nope.md')).code, 404);
  const llms = await call('/llms.txt');
  assert.match(llms.body, /^# Library of Ashurbanipal/);
  assert.match(llms.body, /\[Kava\]\(http[^)]*\/wiki\/Kava\.md\): Kava is a plant/);
  assert.match(llms.body, /## Navigate the ecosystem/);
  const full = await call('/llms-full.txt');
  assert.match(full.body, /# Kava[\s\S]*---[\s\S]*# Test/);
  const feed = await call('/feed.xml');
  assert.match(feed.headers['content-type'], /atom/);
  assert.match(feed.body, /<title>Test_&lt;Thing&gt;|<title>Test &lt;Thing&gt;/);
  assert.doesNotMatch(feed.body, /<Thing>/);
  assert.equal(fs.readFileSync(path.join(tmp, 'Kava.wiki'), 'utf8').startsWith('== Overview =='), true); // untouched
});

test('category page carries a description + CollectionPage/ItemList; home carries WebSite + SearchAction', async () => {
  const ld = collectionLd({ base: 'https://w', id: 'plants', name: 'Plants', blurb: '', items: [{ slug: 'Kava', title: 'Kava' }] });
  assert.equal(ld['@graph'][0].mainEntity.itemListElement[0].url, 'https://w/wiki/Kava');
  const ws = websiteLd('https://w');
  assert.equal(ws['@graph'][0].potentialAction.target.urlTemplate, 'https://w/search?q={search_term_string}');
  const home = await call('/');
  assert.match(home.body, /SearchAction/);
});

test('aboutNode refuses anything that is not a clean Q-id', () => {
  assert.equal(aboutNode('X', 'X', { X: { qid: 'javascript:1' } }), null);
  assert.equal(aboutNode('Y', 'Y', {}), null);
});

test('llmsIndex / atomFeed escape and skip empty sections', () => {
  const t = llmsIndex({ base: 'https://w', groups: [{ name: 'Empty', items: [] }, { name: 'Plants', items: [{ slug: 'Kava', title: 'Kava', description: 'd' }] }] });
  assert.doesNotMatch(t, /## Empty/);
  assert.match(t, /## Plants/);
  assert.match(atomFeed({ base: 'https://w', entries: [{ title: 'a&b', url: 'https://w/x', updated: '2026-01-01T00:00:00Z' }], updated: '2026-01-01T00:00:00Z' }), /a&amp;b/);
});

test('Wikidata matcher: exact/sentence-case titles via Wikipedia, skips disambiguation, own names and hand-excluded slugs', async () => {
  const m = await import('../../integrations/wiki_wikidata_map.mjs');
  m.__setFetch(async (u) => {
    const titles = decodeURIComponent(/titles=([^&]*)/.exec(u)[1]).split('|');
    const pages = [];
    if (titles.includes('Benefit societies')) pages.push({ title: 'Benefit society', pageprops: { wikibase_item: 'Q1445536' }, description: 'Organization' });
    if (titles.includes('Mercury')) pages.push({ title: 'Mercury', pageprops: { wikibase_item: 'Q1', disambiguation: '' } });
    return { ok: true, json: async () => ({ query: { redirects: [{ from: 'Benefit societies', to: 'Benefit society' }], pages } }) };
  });
  const out = await m.build([
    { slug: 'Benefit_Societies', title: 'Benefit Societies' },
    { slug: 'Mercury', title: 'Mercury' },
    { slug: 'MELEK', title: 'MELEK' },
    { slug: 'Remakes', title: 'Remakes' },
  ]);
  assert.deepEqual(Object.keys(out.bySlug), ['Benefit_Societies']);
  assert.equal(out.bySlug.Benefit_Societies.qid, 'Q1445536');
  assert.equal(out.bySlug.Benefit_Societies.via, 'sentence-case');
  m.__setFetch(async () => { throw new Error('offline'); });
  assert.equal((await m.build([{ slug: 'Kava', title: 'Kava' }])).count, 0); // soft-fail
});
