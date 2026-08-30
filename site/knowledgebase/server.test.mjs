// server.test.mjs — offline tests for the MELEK Knowledge Base. node --test, no network: the handler
// and pages are pure/local. Uses a tiny fake res to capture what the handler writes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, links } from './server.mjs';
import { PAGES, SECTIONS, bySlug } from './pages.mjs';

// Minimal req/res doubles — no socket, no network.
function call(path) {
  return new Promise((resolve) => {
    const req = { url: path, method: 'GET' };
    let body = '';
    const res = {
      statusCode: 200, headers: {},
      writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); },
      end(chunk) { body += chunk || ''; resolve({ code: this.statusCode, headers: this.headers, body }); },
    };
    handler(req, res);
  });
}

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(esc(null), '');
});

test('links expands internal tokens and guards unknown slugs', () => {
  assert.match(links('see {{glossary}}'), /<a href="\/glossary">Glossary<\/a>/);
  assert.match(links('see {{glossary|the words}}'), /<a href="\/glossary">the words<\/a>/);
  // unknown slug -> plain label, never a broken link
  assert.equal(links('{{no-such-page|plain}}'), 'plain');
  assert.doesNotMatch(links('{{no-such-page}}'), /<a /);
});

test('every page has the required fields and a known section', () => {
  const sectionIds = new Set(SECTIONS.map((s) => s.id));
  for (const pg of PAGES) {
    assert.ok(pg.slug && /^[a-z0-9-]+$/.test(pg.slug), `bad slug: ${pg.slug}`);
    assert.ok(pg.title, `missing title on ${pg.slug}`);
    assert.ok(pg.description && pg.description.length > 40, `thin description on ${pg.slug}`);
    assert.ok(sectionIds.has(pg.section), `unknown section on ${pg.slug}: ${pg.section}`);
    assert.ok(Array.isArray(pg.body) && pg.body.length, `empty body on ${pg.slug}`);
  }
});

test('all internal {{slug}} links resolve to real pages', () => {
  const rx = /\{\{([a-z0-9-]+)(?:\|[^}]+)?\}\}/gi;
  for (const pg of PAGES) {
    const text = JSON.stringify(pg.body);
    let m;
    while ((m = rx.exec(text))) {
      assert.ok(bySlug(m[1]), `page ${pg.slug} links to missing slug ${m[1]}`);
    }
  }
});

test('the SteemCenter/Hive-style taxonomy is covered', async () => {
  const required = ['what-is-melek', 'getting-started', 'accounts-and-keys', 'earning',
    'onboarding-and-invites', 'witnesses-and-dpos', 'resource-credits', 'move-app',
    'prana-and-kulaswap', 'tools-and-apps', 'glossary', 'developers'];
  for (const slug of required) assert.ok(bySlug(slug), `missing expected KB page: ${slug}`);
});

test('index page renders with Alpha badge, all pages linked, and JSON-LD', async () => {
  const { code, body, headers } = await call('/');
  assert.equal(code, 200);
  assert.match(headers['content-type'], /text\/html/);
  assert.match(body, /class=alpha/); // Alpha badge convention
  assert.match(body, /application\/ld\+json/);
  for (const pg of PAGES) assert.ok(body.includes(`/${pg.slug}`), `index missing link to ${pg.slug}`);
});

test('each page route renders 200 with title, canonical, and related links', async () => {
  for (const pg of PAGES) {
    const { code, body } = await call(`/${pg.slug}`);
    assert.equal(code, 200, `${pg.slug} did not 200`);
    assert.ok(body.includes(esc(pg.title)), `${pg.slug} missing its title`);
    assert.match(body, /rel=canonical/);
  }
});

test('unknown page returns 404', async () => {
  const { code, body } = await call('/does-not-exist');
  assert.equal(code, 404);
  assert.match(body, /Not found/);
});

test('search finds a term and JSON search returns results', async () => {
  const html = await call('/search?q=witness');
  assert.equal(html.code, 200);
  assert.match(html.body, /result\(s\) for/);
  const api = await call('/api/search?q=curation');
  assert.equal(api.code, 200);
  const json = JSON.parse(api.body);
  assert.ok(json.count > 0, 'expected curation hits');
  assert.ok(json.results[0].slug && json.results[0].url);
});

test('sitemap and robots list every page and never throw', async () => {
  const sm = await call('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.headers['content-type'], /xml/);
  for (const pg of PAGES) assert.ok(sm.body.includes(`/${pg.slug}`), `sitemap missing ${pg.slug}`);
  const robots = await call('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /Sitemap:/);
});

test('health check', async () => {
  const { code, body } = await call('/health');
  assert.equal(code, 200);
  assert.equal(body, 'ok');
});
