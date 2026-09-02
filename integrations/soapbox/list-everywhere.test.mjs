// list-everywhere.test.mjs — offline. `node --test`. Injectable fetch; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_SITES, DIRECTORY_TARGETS, byHost, listEverywhere } from './list-everywhere.mjs';

test('LIVE_SITES + DIRECTORY_TARGETS are populated and well-formed', () => {
  assert.ok(LIVE_SITES.length >= 20);
  for (const u of LIVE_SITES) assert.match(u, /^https:\/\//);
  assert.ok(DIRECTORY_TARGETS.some((d) => d.kind === 'crypto'));   // currency draw is priority
  assert.ok(DIRECTORY_TARGETS.some((d) => d.name === 'Bitcointalk'));
});

test('byHost groups URLs by hostname', () => {
  const m = byHost(['https://a.example.com/x', 'https://a.example.com/y', 'https://b.example.com']);
  assert.equal(m.get('a.example.com').length, 2);
  assert.equal(m.get('b.example.com').length, 1);
});

test('listEverywhere dry-run builds batches without sending', async () => {
  const s = await listEverywhere({ dryRun: true });
  assert.equal(s.dryRun, true);
  assert.equal(s.submitted, LIVE_SITES.length);
  assert.ok(s.results.every((r) => r.indexnow.dryRun === true));
});

test('listEverywhere fires per-host submissions with an injected fetch', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, method: opts?.method || 'GET' });
    return { ok: true, status: 200 };
  };
  const s = await listEverywhere({ urls: ['https://x.test', 'https://y.test'], fetch: fakeFetch });
  assert.equal(s.hosts, 2);
  // each host → one IndexNow POST + sitemap pings
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('indexnow')));
  assert.ok(calls.length >= 2);
});
