// crawl-audit.test.mjs — OFFLINE. Every fetch is injected; no host is ever contacted.
//
// The grading distinctions are the point. A host that serves pages with a broken sitemap is NOT in the
// same state as a host with no DNS record, and collapsing them hides which one is urgent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditHost, auditAll, grade, robotsFacts, normalizeHost, handler, __setFetch } from './crawl-audit.mjs';

const SITEMAP = '<?xml version="1.0"?><urlset><url><loc>https://x.com/</loc></url><url><loc>https://x.com/a</loc></url></urlset>';
// A tiny router so each test declares only what it cares about.
const routes = (map) => __setFetch(async (url) => {
  const path = new URL(url).pathname;
  const hit = map[path];
  if (hit === undefined) return { status: 404, text: async () => '', headers: { get: () => '' } };
  if (typeof hit === 'number') return { status: hit, text: async () => '', headers: { get: () => '' } };
  return { status: hit.status ?? 200, text: async () => hit.body ?? '', headers: { get: () => hit.location || '' } };
});

// --- robots parsing ----------------------------------------------------------

test('Disallow: / is a full block; Disallow: /admin is not', () => {
  assert.equal(robotsFacts('User-agent: *\nDisallow: /').blocksAll, true);
  assert.equal(robotsFacts('User-agent: *\nDisallow: /admin').blocksAll, false);
  assert.equal(robotsFacts('User-agent: *\nAllow: /').blocksAll, false);
});

test('Sitemap: lines are collected, case-insensitively', () => {
  const f = robotsFacts('User-agent: *\nAllow: /\nsitemap: https://x.com/sitemap.xml\nSitemap: https://x.com/news.xml');
  assert.deepEqual(f.sitemaps, ['https://x.com/sitemap.xml', 'https://x.com/news.xml']);
});

test('robotsFacts never throws on junk', () => {
  for (const v of [null, undefined, 0, {}, []]) assert.doesNotThrow(() => robotsFacts(v));
});

// --- host normalization ------------------------------------------------------

test('normalizeHost strips scheme, path, port and case', () => {
  assert.equal(normalizeHost('https://Melek.Salon/a/b?x=1'), 'melek.salon');
  assert.equal(normalizeHost(' melek.salon:8443 '), 'melek.salon');
});

test('normalizeHost rejects anything that is not a hostname', () => {
  for (const bad of ['', 'localhost', 'no dots', 'a b.com', null, 42]) assert.equal(normalizeHost(bad), '', `accepted ${bad}`);
});

// --- the grading distinctions ------------------------------------------------

test('a healthy host grades ok with no problems', async () => {
  routes({ '/': 200, '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml' }, '/sitemap.xml': { body: SITEMAP } });
  const r = await auditHost('x.com');
  assert.equal(r.verdict, 'ok');
  assert.deepEqual(r.problems, []);
  assert.equal(r.urlCount, 2);
});

test('THE BROKEN PROMISE ranks first: robots advertises a sitemap that 404s', async () => {
  routes({ '/': 200, '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml' } });
  const r = await auditHost('x.com');
  assert.equal(r.verdict, 'degraded');
  assert.match(r.problems[0], /dead end/, 'the broken promise must be the first problem reported');
});

test('no robots.txt at all is reported, and is not the same as a block', async () => {
  routes({ '/': 200, '/sitemap.xml': { body: SITEMAP } });
  const r = await auditHost('x.com');
  assert.notEqual(r.verdict, 'blocked');
  assert.ok(r.problems.some((p) => /no robots\.txt/.test(p)));
});

test('a deliberate Disallow: / is BLOCKED, a distinct state — not a failure to fix blindly', async () => {
  routes({ '/': 200, '/robots.txt': { body: 'User-agent: *\nDisallow: /' } });
  const r = await auditHost('x.com');
  assert.equal(r.verdict, 'blocked');
  assert.ok(r.problems.some((p) => /deliberately not indexed/.test(p)));
});

test('no DNS is UNREACHABLE and says so, rather than being graded on robots it never got', async () => {
  __setFetch(async () => { const e = new Error('fail'); e.cause = { code: 'ENOTFOUND' }; throw e; });
  const r = await auditHost('nope.example');
  assert.equal(r.verdict, 'unreachable');
  assert.equal(r.reachable, false);
  assert.match(r.problems[0], /no DNS record/);
});

test('a serving host with a valid sitemap but a missing Sitemap: line is only a WARN', async () => {
  routes({ '/': 200, '/robots.txt': { body: 'User-agent: *\nAllow: /' }, '/sitemap.xml': { body: SITEMAP } });
  const r = await auditHost('x.com');
  assert.equal(r.verdict, 'warn', 'discoverable-but-unadvertised is not as bad as unserved');
  assert.ok(r.problems.some((p) => /names no Sitemap/.test(p)));
});

test('a redirecting root is reported so the destination gets indexed instead', async () => {
  routes({ '/': { status: 301, location: 'https://y.com/' }, '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml' }, '/sitemap.xml': { body: SITEMAP } });
  const r = await auditHost('x.com');
  assert.ok(r.problems.some((p) => /redirects to https:\/\/y\.com\//.test(p)));
});

test('a sitemap that is served but is not XML is caught', async () => {
  routes({ '/': 200, '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml' }, '/sitemap.xml': { body: '<!doctype html><h1>oops</h1>' } });
  const r = await auditHost('x.com');
  assert.ok(r.problems.some((p) => /dead end|not a valid urlset/.test(p)));
});

test('a valid but EMPTY sitemap is a problem — it looks fine and indexes nothing', async () => {
  routes({ '/': 200, '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml' }, '/sitemap.xml': { body: '<urlset></urlset>' } });
  const r = await auditHost('x.com');
  assert.ok(r.problems.some((p) => /lists no URLs/.test(p)));
});

// --- the roll-up -------------------------------------------------------------

test('auditAll dedupes hosts and counts verdicts', async () => {
  routes({ '/': 200, '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: https://x.com/sitemap.xml' }, '/sitemap.xml': { body: SITEMAP } });
  const out = await auditAll(['x.com', 'https://x.com/', 'y.com']);
  assert.equal(out.total, 2, 'the same host twice must collapse');
  assert.equal(out.counts.ok, 2);
  assert.equal(out.indexable, 2);
});

test('an invalid hostname is graded, not thrown on', async () => {
  const out = await auditAll(['', 'no dots', null]);
  assert.equal(out.total, 0);
});

test('grade is pure and never throws', () => {
  for (const o of [undefined, {}, { reachable: true }, { reachable: false }]) assert.doesNotThrow(() => grade(o));
});

test('auditHost never throws on junk', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  for (const h of [null, undefined, '', 'x.com', 42]) await assert.doesNotReject(() => auditHost(h));
});

test('handler serves what it checks', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  assert.equal(JSON.parse(body).ok, true);
});
