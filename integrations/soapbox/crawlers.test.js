// crawlers.test.js — robots.txt + IndexNow + sitemap-ping, all with injected fetch (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync, rmSync } from 'node:fs';

// Point the key file at a throwaway path BEFORE importing the module.
const KEY_FILE = join(tmpdir(), `indexnow-key-${process.pid}.txt`);
process.env.INDEXNOW_KEY_FILE = KEY_FILE;
delete process.env.INDEXNOW_KEY;

const {
  robotsTxt, CRAWLERS, getIndexNowKey, submitIndexNow, submitToIndexNow, pingSitemaps, pingSitemap, __setFetch,
} = await import('./crawlers.mjs');

test.after(() => { try { if (existsSync(KEY_FILE)) rmSync(KEY_FILE); } catch { /* ignore */ } });

const BASE = 'https://data.soapbox.community';

test('robotsTxt welcomes every required crawler with Allow, plus wildcard + sitemap', () => {
  const txt = robotsTxt(BASE);
  const required = ['Googlebot', 'Bingbot', 'DuckDuckBot', 'YandexBot', 'Baiduspider',
    'GPTBot', 'ClaudeBot', 'CCBot', 'PerplexityBot', 'Google-Extended', 'Applebot'];
  for (const ua of required) assert.ok(txt.includes(`User-agent: ${ua}`), `missing ${ua}`);
  assert.ok(txt.includes('User-agent: *'), 'missing wildcard');
  assert.ok(/Allow: \//.test(txt), 'missing Allow');
  assert.ok(txt.includes(`Sitemap: ${BASE}/sitemap.xml`), 'missing sitemap line');
  assert.ok(!/Disallow:/.test(txt), 'should not disallow anything');
});

test('robotsTxt strips trailing slash from base', () => {
  assert.ok(robotsTxt('https://x.com/').includes('Sitemap: https://x.com/sitemap.xml'));
});

test('getIndexNowKey generates a 32-char hex key and persists it (stable across calls)', () => {
  const k1 = getIndexNowKey();
  assert.match(k1, /^[a-f0-9]{32}$/);
  assert.ok(existsSync(KEY_FILE), 'key file written');
  assert.equal(readFileSync(KEY_FILE, 'utf8').trim(), k1, 'persisted value matches');
  assert.equal(getIndexNowKey(), k1, 'second call returns the same key');
});

test('submitIndexNow builds the correct payload (dry run, no network)', async () => {
  const out = await submitIndexNow(BASE, ['/coins/btc', '/coins/eth', '/coins/btc'], { dryRun: true });
  assert.ok(out.ok && out.dryRun);
  assert.equal(out.endpoint, 'https://api.indexnow.org/indexnow');
  assert.equal(out.body.host, 'data.soapbox.community');
  assert.equal(out.body.key, getIndexNowKey());
  assert.equal(out.body.keyLocation, `${BASE}/${getIndexNowKey()}.txt`);
  assert.deepEqual(out.body.urlList, [`${BASE}/coins/btc`, `${BASE}/coins/eth`]); // dedup + resolved
  assert.equal(out.count, 2);
});

test('submitIndexNow accepts a bare host and absolute URLs', async () => {
  const out = await submitIndexNow('data.soapbox.community', ['https://data.soapbox.community/x'], { dryRun: true });
  assert.equal(out.body.host, 'data.soapbox.community');
  assert.deepEqual(out.body.urlList, ['https://data.soapbox.community/x']);
});

test('submitIndexNow returns no-urls without sending', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, status: 200 }; });
  const out = await submitIndexNow(BASE, []);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no urls');
  assert.equal(called, false);
  __setFetch(null);
});

test('submitIndexNow POSTs to the endpoint and treats 202 as ok', async () => {
  let captured;
  __setFetch(async (url, init) => { captured = { url, init }; return { ok: false, status: 202 }; });
  const out = await submitIndexNow(BASE, ['/a']);
  assert.equal(captured.url, 'https://api.indexnow.org/indexnow');
  assert.equal(captured.init.method, 'POST');
  assert.equal(out.ok, true);
  assert.equal(out.status, 202);
  __setFetch(null);
});

test('submitIndexNow never throws on fetch failure', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  const out = await submitIndexNow(BASE, ['/a']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'boom');
  __setFetch(null);
});

test('submitToIndexNow back-compat alias works', async () => {
  const out = await submitToIndexNow(BASE, ['/a'], { dryRun: true });
  assert.ok(out.dryRun && out.count === 1);
});

test('pingSitemaps hits both Google and Bing, best-effort', async () => {
  const hits = [];
  __setFetch(async (url) => { hits.push(url); return { ok: url.includes('bing'), status: 200 }; });
  const out = await pingSitemaps(`${BASE}/sitemap.xml`);
  assert.equal(hits.length, 2);
  assert.ok(hits.some((u) => u.includes('google.com/ping')));
  assert.ok(hits.some((u) => u.includes('bing.com/ping')));
  assert.ok(out.ok, 'ok if any endpoint ok');
  __setFetch(null);
});

test('pingSitemaps dry run lists targets without sending', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, status: 200 }; });
  const out = await pingSitemaps(`${BASE}/sitemap.xml`, { dryRun: true });
  assert.ok(out.dryRun && out.targets.length === 2 && !called);
  __setFetch(null);
});

test('pingSitemaps never throws', async () => {
  __setFetch(async () => { throw new Error('net down'); });
  const out = await pingSitemaps(`${BASE}/sitemap.xml`);
  assert.equal(out.ok, false);
  __setFetch(null);
});

test('pingSitemap back-compat appends /sitemap.xml to base', async () => {
  let captured = [];
  __setFetch(async (url) => { captured.push(url); return { ok: true, status: 200 }; });
  await pingSitemap(BASE);
  assert.ok(captured.every((u) => u.includes(encodeURIComponent(`${BASE}/sitemap.xml`))));
  __setFetch(null);
});

test('CRAWLERS includes the AI crawlers we explicitly want', () => {
  for (const ua of ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot']) {
    assert.ok(CRAWLERS.includes(ua), `CRAWLERS missing ${ua}`);
  }
});
