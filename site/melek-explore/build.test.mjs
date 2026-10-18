// build.test.mjs — offline tests for the Explore MELEK page builder. No network: checkLinks gets a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, checkLinks, liveCatalog, renderExplorePage, isBlocked } from './build.mjs';

const fakeFetch = (table) => async (url) => {
  const v = table[url];
  if (v === 'throw') throw Object.assign(new Error('boom'), { cause: { code: 'ECONNREFUSED' } });
  const status = typeof v === 'number' ? v : 200;
  return { status, text: async () => (typeof v === 'string' ? v : '<title>Fine</title>') };
};

test('catalog: every entry is https, has icon/name/desc, and no private or admin host', () => {
  const urls = CATALOG.flatMap((s) => s.items.map((i) => i[3]));
  assert.ok(urls.length > 80);
  for (const s of CATALOG) for (const [icon, name, desc, url] of s.items) {
    assert.ok(icon && name && desc, name);
    assert.match(url, /^https:\/\//, url);
    assert.equal(isBlocked(url), false, url);
    assert.doesNotMatch(url, /soapy|127\.0\.0\.1|localhost/i);
  }
  assert.equal(isBlocked('https://soapy.blog/'), true);
  assert.equal(isBlocked('https://code.soapy.blog/x'), true);
  assert.equal(isBlocked('https://analytics.soapbox.community/'), true);
});

test('checkLinks keeps 2xx/3xx, drops 4xx/5xx/errors/blocked, never throws', async () => {
  const r = await checkLinks(['https://a.test/', 'https://b.test/', 'https://c.test/', 'https://d.test/', 'https://soapy.blog/'],
    { fetch: fakeFetch({ 'https://a.test/': '<title>A — alpha testnet</title>', 'https://b.test/': 404, 'https://c.test/': 'throw', 'https://d.test/': 302 }) });
  assert.equal(r.get('https://a.test/').ok, true);
  assert.equal(r.get('https://a.test/').title, 'A — alpha testnet');
  assert.equal(r.get('https://b.test/').ok, false);
  assert.equal(r.get('https://c.test/').ok, false);
  assert.match(r.get('https://c.test/').why, /ECONNREFUSED/);
  assert.equal(r.get('https://d.test/').ok, true);
  assert.equal(r.get('https://soapy.blog/').ok, false);
});

test('liveCatalog drops dead links, labels from the title, removes empty sections', () => {
  const cat = [
    { id: 's1', title: 'One', icon: '1', lead: 'x', items: [['🅰️', 'Alive', 'ok', 'https://a.test/'], ['🅱️', 'Dead', 'no', 'https://b.test/']] },
    { id: 's2', title: 'Two', icon: '2', lead: 'y', items: [['🅲', 'Gone', 'no', 'https://c.test/']] },
  ];
  const checks = new Map([['https://a.test/', { ok: true, title: 'Thing (Demo)' }], ['https://b.test/', { ok: false, why: 'HTTP 404' }]]);
  const { sections, dropped } = liveCatalog(checks, cat);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].items.length, 1);
  assert.equal(sections[0].items[0].label, 'demo');
  assert.deepEqual(dropped.map((d) => d.why), ['HTTP 404', 'not checked']);
});

test('page: tab bar, logo to /explore, search box, escaped content, no dollar values', () => {
  const checks = new Map(CATALOG.flatMap((s) => s.items.map((i) => [i[3], { ok: true, title: '' }])));
  const { sections } = liveCatalog(checks);
  const html = renderExplorePage(sections, { builtAt: new Date('2026-10-18T00:00:00Z') });
  assert.match(html, /<title>Explore MELEK<\/title>/);
  assert.match(html, /class=brand href="https:\/\/melek\.salon\/explore"/);
  for (const t of ['All Posts', 'Admin Updates', 'Witness Updates', 'Members', 'Groups', 'MELEK Move']) assert.ok(html.includes(`>${t}</a>`), t);
  assert.match(html, /id=q type=search/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.doesNotMatch(html, /\$\s?\d|USD|soapy\.blog/);
  const evil = renderExplorePage([{ id: 'x', title: '<b>', icon: '!', lead: '"', items: [{ icon: 'i', name: '<script>', desc: 'd', url: 'https://e.test/', label: '' }] }]);
  assert.doesNotMatch(evil, /<script>alert|<b> /);
  assert.ok(evil.includes('&lt;script&gt;'));
});

test('llms.txt lists the live sections as markdown links', async () => {
  const { renderLlmsTxt } = await import('./build.mjs');
  const txt = renderLlmsTxt([{ id: 'm', title: 'Wallet & tokens', icon: 'x', items: [{ icon: 'i', name: 'KULA Community Fund', desc: 'A pool.', url: 'https://melek.salon/kula', label: '' }] }], { builtAt: new Date('2026-10-18T00:00:00Z') });
  assert.match(txt, /^# MELEK/);
  assert.match(txt, /## Wallet & tokens/);
  assert.match(txt, /- \[KULA Community Fund\]\(https:\/\/melek.salon\/kula\): A pool\./);
});
