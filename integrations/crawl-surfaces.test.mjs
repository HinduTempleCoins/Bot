// crawl-surfaces.test.mjs — the hosts the live crawl audit graded DEGRADED, re-graded OFFLINE by the
// same auditor, driven against the REAL handlers of the servers that back them.
//
// WHY THIS SHAPE. It would be easy — and worthless — to assert that a server's /sitemap.xml route
// returns a string containing "<urlset". The thing that actually failed in production was a whole
// pipeline: robots.txt exists, robots.txt names a Sitemap:, that URL resolves, and what comes back
// parses as a urlset with URLs in it. crawl-audit.mjs is the module that checks exactly that chain,
// and it is the module that graded these hosts DEGRADED on 2026-09-08. So this test wires its
// injectable fetch to the servers' own handler(req,res) and runs auditHost() against them in-process.
// A pass here means: the code, as written, produces a host the auditor calls `ok`.
//
// WHAT THIS DOES NOT PROVE. The live hosts serve from deployed infrastructure, not this checkout.
// This proves the code is right; it does not prove the deploy has shipped. Re-run
// `node integrations/crawl-audit.mjs <host>` against the live host for that.
//
// Fully offline: the only fetch is the stub below, and an unmapped URL throws so a real network call
// would fail loudly instead of silently going out.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditHost, __setFetch } from './crawl-audit.mjs';

import { handler as hathorLive, SITEMAP_PATHS as HATHOR_PATHS } from '../site/hathor-live/server.mjs';
import { handler as farm, SITEMAP_PATHS as FARM_PATHS } from '../site/farm/server.mjs';
import { handler as seeds, SITEMAP_PATHS as SEEDS_PATHS } from '../site/seeds/server.mjs';
import { handler as tokens, SITEMAP_PATHS as TOKENS_PATHS } from '../site/tokens/server.mjs';
import { handler as poolSeo, PAGES as POOL_PAGES } from '../pool/www/seo.mjs';
import { __setIO as __setExamIO } from '../site/hathor-live/exams-store.mjs';

// hathor.live's exam store must never touch a real disk path in the offline suite.
__setExamIO({ read: () => [], append: () => {} });

// ── an in-process "host": run the server's handler and shape the result like a fetch Response ──────
function mockRes() {
  return {
    code: 0, hdrs: {}, body: '',
    writeHead(c, h) { this.code = c; this.hdrs = h || {}; return this; },
    setHeader(k, v) { this.hdrs[k] = v; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
}

async function callHandler(fn, path) {
  const res = mockRes();
  const req = { url: path, method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' }, on() { return req; } };
  await fn(req, res);
  return {
    status: res.code || 200,
    headers: { get: (k) => res.hdrs[String(k).toLowerCase()] || res.hdrs[k] || '' },
    async text() { return res.body; },
  };
}

/** Route https://<host>/<path> to the handler that really serves that host. */
function serveFrom(map) {
  return async (url) => {
    const u = new URL(String(url));
    const fn = map[u.host];
    if (!fn) throw new Error(`OFFLINE: no handler mapped for ${u.host}`);
    return callHandler(fn, u.pathname + u.search);
  };
}

const HOSTS = {
  'hathor.live': hathorLive,
  'farm.soapbox.community': farm,
  'seeds.soapbox.community': seeds,
  'tokens.alpha.melek.salon': tokens,
  'pool.soapbox.community': poolSeo,
};

// ── the audit, host by host ────────────────────────────────────────────────────────────────────────

for (const [host, fn] of Object.entries(HOSTS)) {
  test(`${host} grades ok: robots.txt names a Sitemap: that resolves to a real urlset`, async () => {
    __setFetch(serveFrom({ [host]: fn }));
    const r = await auditHost(host);
    assert.equal(r.verdict, 'ok', `${host}: ${r.problems.join('; ')}`);
    assert.equal(r.robotsStatus, 200);
    assert.equal(r.sitemapStatus, 200);
    assert.equal(r.sitemapReferenced, true, 'robots.txt must carry a Sitemap: line');
    assert.equal(r.sitemapOk, true, 'the sitemap must parse as a urlset');
    assert.ok(r.urlCount > 0, 'a valid but empty sitemap is not discovery');
    assert.equal(r.blocksAll, false);
    // The advertised Sitemap: must be the absolute URL on THIS host — a relative or wrong-host
    // pointer is the exact "broken promise" the audit ranks first.
    assert.deepEqual(r.sitemapsDeclared, [`https://${host}/sitemap.xml`]);
    __setFetch(null);
  });
}

// ── the sitemaps list the routes the servers actually answer ───────────────────────────────────────

const bodyOf = async (fn, path) => (await (await callHandler(fn, path)).text());

test('hathor.live lists its real pages — /chamber and the /exams routes included, /api/* excluded', async () => {
  const xml = await bodyOf(hathorLive, '/sitemap.xml');
  for (const p of ['/', '/40hz', '/studio', '/reports', '/chamber', '/exams', '/exams/grapheme', '/exams/vviq', '/exams/colour-naming']) {
    assert.ok(xml.includes(`<loc>https://hathor.live${p === '/' ? '/' : p}</loc>`), `missing ${p}`);
  }
  assert.ok(!/\/api\//.test(xml), 'API endpoints are not pages and must not be listed');
  assert.deepEqual(HATHOR_PATHS.filter((p) => p.startsWith('/api')), []);
});

test('every sitemapped path is a route the server answers with a 200 page', async () => {
  const cases = [
    [hathorLive, 'https://hathor.live', HATHOR_PATHS],
    [farm, 'https://farm.soapbox.community', FARM_PATHS],
    [seeds, 'https://seeds.soapbox.community', SEEDS_PATHS],
    [tokens, 'https://tokens.alpha.melek.salon', TOKENS_PATHS],
  ];
  for (const [fn, base, paths] of cases) {
    for (const p of paths) {
      const r = await callHandler(fn, p);
      assert.equal(r.status, 200, `${base}${p} is in the sitemap but answers ${r.status}`);
    }
  }
});

test('pool.soapbox.community lists only pages that exist as static files', async () => {
  const xml = await bodyOf(poolSeo, '/sitemap.xml');
  for (const p of POOL_PAGES) assert.ok(xml.includes(`<loc>https://pool.soapbox.community${p.path}</loc>`), `missing ${p.path}`);
  assert.equal((xml.match(/<loc>/g) || []).length, POOL_PAGES.length);
});

// ── the IndexNow ownership file ────────────────────────────────────────────────────────────────────

test('with no INDEXNOW_KEY set, /<key>.txt is not invented — the server still 404s', async () => {
  const prev = process.env.INDEXNOW_KEY;
  delete process.env.INDEXNOW_KEY;
  try {
    const r = await callHandler(hathorLive, '/abcdef0123456789abcdef0123456789.txt');
    assert.equal(r.status, 404);
  } finally { if (prev !== undefined) process.env.INDEXNOW_KEY = prev; }
});

test('with INDEXNOW_KEY set, /<key>.txt returns exactly the key as text/plain', async () => {
  const prev = process.env.INDEXNOW_KEY;
  process.env.INDEXNOW_KEY = 'testkey0123456789testkey0123456789';
  try {
    const r = await callHandler(hathorLive, '/testkey0123456789testkey0123456789.txt');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/plain/);
    assert.equal(await r.text(), 'testkey0123456789testkey0123456789');
    // a DIFFERENT .txt must not be answered — robots.txt/llms.txt keep their own routes
    const other = await callHandler(hathorLive, '/somethingelse.txt');
    assert.equal(other.status, 404);
  } finally {
    if (prev === undefined) delete process.env.INDEXNOW_KEY; else process.env.INDEXNOW_KEY = prev;
  }
});
