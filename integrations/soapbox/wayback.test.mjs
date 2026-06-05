// wayback.test.mjs — OFFLINE tests. Injected fetch (no network). Covers availability snapshot
// normalization, CDX header/row parsing + newest-first order, salvageLink composition, soft-fail.
//   node --test integrations/soapbox/wayback.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { __setFetch, availability, captures, salvageLink } from './wayback.mjs';

function router(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, resp] of routes) {
      if (u.includes(needle)) {
        if (resp.fail) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => resp.json ?? {} };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const AVAIL = {
  archived_snapshots: {
    closest: { available: true, url: 'http://web.archive.org/web/20240101000000/https://dead.example/page', timestamp: '20240101000000', status: '200' },
  },
};
// CDX json output: header row then data rows (fl=timestamp,original,mimetype,statuscode)
const CDX = [
  ['timestamp', 'original', 'mimetype', 'statuscode'],
  ['20230101000000', 'https://dead.example/page', 'text/html', '200'],
  ['20240101000000', 'https://dead.example/page', 'text/html', '200'],
];

test('availability normalizes the closest snapshot (and upgrades http → https)', async () => {
  __setFetch(router([['archive.org/wayback/available', { json: AVAIL }]]));
  const snap = await availability('https://dead.example/page');
  assert.equal(snap.url, 'https://web.archive.org/web/20240101000000/https://dead.example/page');
  assert.equal(snap.timestamp, '20240101000000');
});

test('availability soft-fails to null when no capture / unreachable', async () => {
  __setFetch(router([['archive.org/wayback/available', { json: { archived_snapshots: {} } }]]));
  assert.equal(await availability('https://nothing.example'), null);
  __setFetch(router([['archive.org/wayback/available', { fail: true }]]));
  assert.equal(await availability('https://nothing.example'), null);
  assert.equal(await availability(''), null);
});

test('captures parses CDX header + rows, builds replay URLs, newest first', async () => {
  __setFetch(router([['web.archive.org/cdx/search', { json: CDX }]]));
  const rows = await captures('https://dead.example/page');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].timestamp, '20240101000000'); // newest first
  assert.equal(rows[0].url, 'https://web.archive.org/web/20240101000000/https://dead.example/page');
  assert.equal(rows[1].timestamp, '20230101000000');
});

test('captures soft-fails to [] on empty / header-only / unreachable', async () => {
  __setFetch(router([['web.archive.org/cdx/search', { json: [['timestamp', 'original', 'mimetype', 'statuscode']] }]]));
  assert.deepEqual(await captures('https://x.example'), []);
  __setFetch(router([['web.archive.org/cdx/search', { fail: true }]]));
  assert.deepEqual(await captures('https://x.example'), []);
  assert.deepEqual(await captures(''), []);
});

test('salvageLink combines availability + capture history', async () => {
  __setFetch(router([
    ['archive.org/wayback/available', { json: AVAIL }],
    ['web.archive.org/cdx/search', { json: CDX }],
  ]));
  const out = await salvageLink('https://dead.example/page');
  assert.equal(out.original, 'https://dead.example/page');
  assert.equal(out.archived.timestamp, '20240101000000');
  assert.equal(out.captureCount, 2);
});

test('salvageLink falls back to newest CDX capture when availability is empty', async () => {
  __setFetch(router([
    ['archive.org/wayback/available', { json: { archived_snapshots: {} } }],
    ['web.archive.org/cdx/search', { json: CDX }],
  ]));
  const out = await salvageLink('https://dead.example/page');
  assert.equal(out.archived.timestamp, '20240101000000');
});

test('salvageLink soft-fails whole: nothing anywhere → archived null, count 0', async () => {
  __setFetch(router([]));
  const out = await salvageLink('https://gone.example');
  assert.equal(out.archived, null);
  assert.equal(out.captureCount, 0);
});
