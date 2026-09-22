// server.test.mjs — OFFLINE tests for the Faux Law Files encounter portal (site/encounters/server.mjs).
// Fully offline: the handler is driven through a mock req/res, and the video data is injected via the
// __setData() seam so no file read or network is needed. Proves routing, the youtube-nocookie embed +
// lazy-load, esc() escaping, the per-clip education link into /doctrines, SEO/JSON-LD, robots/sitemap/
// llms.txt, and soft-fail on empty/broken data.
//
//   node --test site/encounters/server.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { handler, __setData, galleryBody, encountersLlmsTxt, esc, _internal, loadEncounters } from './server.mjs';

// ── mock req/res (same shape as the Law surface) ──────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath) => ({ url: urlPath, method: 'GET', on() {} });
async function drive(urlPath) {
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

function jsonLdNodes(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(JSON.parse(m[1]));
  return out;
}
function allTypes(nodes) {
  const types = [];
  for (const n of nodes) {
    const graph = Array.isArray(n['@graph']) ? n['@graph'] : [n];
    for (const g of graph) if (g && g['@type']) types.push(g['@type']);
  }
  return types;
}

// a small, self-contained fixture (never touches the real JSON file)
const FIXTURE = [
  {
    title: 'Test clip <script>alert(1)</script> & "quotes"',
    url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK',
    source: 'Test Channel & Co',
    category: 'traveling-not-driving',
    kind: 'youtube', youtube_id: 'ABCDEFGHIJK',
    blurb: 'A driver claims to be traveling not driving.',
    real_law: 'States may require a driver licence under their police power.',
    doctrine_link: 'https://law.soapbox.community/doctrines#commerce-power',
  },
  {
    title: 'A news write-up',
    url: 'https://example.com/news/story',
    source: 'Example News',
    category: 'window-breaking',
    kind: 'article', youtube_id: null,
    blurb: 'Police broke a window after the driver refused to exit.',
    real_law: 'A lawful stop needs no consent.',
    doctrine_link: 'https://law.soapbox.community/rights',
  },
];

function withFixture(fn) {
  __setData(FIXTURE);
  try { return fn(); } finally { __setData(null); }
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
test('health returns ok', async () => {
  const res = await drive('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('home returns 200 HTML', async () => {
  __setData(FIXTURE);
  const res = await drive('/');
  __setData(null);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Faux Law Files/);
});

test('unknown path 302s to home', async () => {
  const res = await drive('/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('robots.txt, sitemap.xml, llms.txt serve', async () => {
  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /User-agent/i);
  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/);
  const l = await drive('/llms.txt');
  assert.equal(l.statusCode, 200);
  assert.match(l.body, /Faux Law Files/);
});

// ── embeds + education layer ───────────────────────────────────────────────────────────────────────
test('youtube clips embed via youtube-nocookie, lazy-loaded', () => {
  withFixture(() => {
    const html = galleryBody();
    assert.match(html, /https:\/\/www\.youtube-nocookie\.com\/embed\/ABCDEFGHIJK/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /allowfullscreen/);
  });
});

test('article records render a captioned link card, not an iframe', () => {
  withFixture(() => {
    const html = galleryBody();
    assert.match(html, /Article &amp; clip/);
    assert.match(html, /href="https:\/\/example\.com\/news\/story"/);
    assert.match(html, /class="badge article"/);
  });
});

test('every clip links the real doctrine into the Law surface', () => {
  withFixture(() => {
    const html = galleryBody();
    assert.match(html, /law\.soapbox\.community\/doctrines#commerce-power/);
    assert.match(html, /law\.soapbox\.community\/rights/);
    assert.match(html, /Read the real doctrine/);
    assert.match(html, /Misreads:/);
  });
});

test('the source channel is credited', () => {
  withFixture(() => {
    const html = galleryBody();
    assert.match(html, /Source: Test Channel &amp; Co/);
    assert.match(html, /Source: Example News/);
  });
});

// ── escaping (house rule: esc() all interpolation) ─────────────────────────────────────────────────
test('titles/sources are escaped — no raw script injection', () => {
  withFixture(() => {
    const html = galleryBody();
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('a bad youtube_id is not embedded (soft-fail, keeps the link)', () => {
  __setData([{ title: 'bad id', url: 'https://www.youtube.com/watch?v=x', source: 'S',
    category: 'courtroom-antics', kind: 'youtube', youtube_id: 'not-valid-id!!' , blurb: 'b' }]);
  try {
    const html = galleryBody();
    assert.ok(!html.includes('youtube-nocookie.com/embed/not-valid-id'), 'invalid id must not embed');
  } finally { __setData(null); }
});

// ── SEO / JSON-LD ──────────────────────────────────────────────────────────────────────────────────
test('home emits OpenGraph, Twitter, canonical and valid JSON-LD', async () => {
  __setData(FIXTURE);
  const res = await drive('/');
  __setData(null);
  const b = res.body;
  assert.match(b, /<meta property="og:title"/);
  assert.match(b, /<meta name="twitter:card"/);
  assert.match(b, /<link rel="canonical"/);
  const nodes = jsonLdNodes(b); // throws if any block is invalid JSON
  const types = allTypes(nodes);
  assert.ok(types.includes('Organization'));
  assert.ok(types.includes('WebSite'));
  assert.ok(types.includes('BreadcrumbList'));
  assert.ok(types.includes('FAQPage'));
});

// ── soft-fail ──────────────────────────────────────────────────────────────────────────────────────
test('empty data renders an empty-state page, never throws', () => {
  __setData([]);
  try {
    const html = galleryBody();
    assert.match(html, /being assembled/);
  } finally { __setData(null); }
});

test('categories metadata is well-formed and links the Law surface', () => {
  for (const c of _internal.CATEGORIES) {
    assert.ok(c.id && c.name && c.hook && c.real_law && c.doctrine_link);
    assert.match(c.doctrine_link, /^https:\/\/law\.soapbox\.community\//);
  }
});

// ── the SHIPPED data file: every record is well-formed and internally consistent ───────────────────
test('encounters.json is valid, non-empty, and every record is well-formed', () => {
  const p = fileURLToPath(new URL('../../knowledge/civic/encounters.json', import.meta.url));
  const data = JSON.parse(readFileSync(p, 'utf8'));
  assert.ok(Array.isArray(data) && data.length >= 25, 'expect >=25 curated records');
  const catIds = new Set(_internal.CATEGORIES.map((c) => c.id));
  for (const r of data) {
    assert.ok(r.title && r.url && r.source, 'title/url/source required');
    assert.ok(catIds.has(r.category), `known category: ${r.category}`);
    assert.match(r.url, /^https:\/\//, 'url is absolute https');
    if (r.kind === 'youtube') {
      assert.match(String(r.youtube_id), /^[\w-]{11}$/, `11-char id: ${r.title}`);
      assert.match(r.url, /youtube\.com\/watch\?v=/, 'youtube url shape');
    }
    assert.ok(r.doctrine_link && /^https:\/\/law\.soapbox\.community\//.test(r.doctrine_link));
  }
});

test('loadEncounters reads the real file with no override', () => {
  __setData(null);
  const data = loadEncounters();
  assert.ok(Array.isArray(data) && data.length > 0);
});
