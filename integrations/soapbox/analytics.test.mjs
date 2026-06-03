// analytics.test.mjs — offline tests for trafficSummary() (queue #61).
// Builds Caddy-style JSON access-log fixtures in a temp dir under the OS tmp dir,
// points trafficSummary({ dir }) at them, and asserts the privacy-friendly summary.
// No network, no fixed-path dependency, no edits to analytics.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { trafficSummary } from './analytics.mjs';

// --- fixture helpers -------------------------------------------------------

const line = (o) => JSON.stringify(o);

function caddyLine({ ts = 1717372800, status = 200, uri = '/', host = 'data.soapbox.community', ip = '10.0.0.1', ua = 'Mozilla/5.0', referer } = {}) {
  const headers = { 'User-Agent': [ua] };
  if (referer) headers.Referer = [referer];
  return line({ ts, status, duration: 0.01, size: 1234, request: { uri, host, method: 'GET', remote_ip: ip, headers } });
}

/** Write the given log-file map ({ name: linesArray }) into a fresh temp dir; returns the dir. */
function makeLogDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'soapbox-analytics-'));
  for (const [name, lines] of Object.entries(files)) {
    writeFileSync(join(dir, name), lines.join('\n') + '\n', 'utf8');
  }
  return dir;
}

// --- tests -----------------------------------------------------------------

test('unique-visitor counting hashes-then-discards IPs; no raw IPs retained', () => {
  const dir = makeLogDir({
    'access.log': [
      caddyLine({ ip: '203.0.113.7', uri: '/' }),
      caddyLine({ ip: '203.0.113.7', uri: '/data' }),   // same human IP twice -> still 1 unique
      caddyLine({ ip: '198.51.100.9', uri: '/' }),       // distinct human IP -> 2 unique
    ],
  });
  try {
    const s = trafficSummary({ dir });
    assert.equal(s.uniqueVisitors, 2, 'two distinct human IPs -> 2 unique visitors');

    // No raw IPs retained anywhere in the returned summary.
    assert.equal(s._ips, undefined, '_ips Set must be deleted before return');
    assert.equal(s._botIps, undefined, '_botIps Set must be deleted before return');
    const blob = JSON.stringify(s);
    assert.ok(!blob.includes('203.0.113.7'), 'raw IP must not appear in summary');
    assert.ok(!blob.includes('198.51.100.9'), 'raw IP must not appear in summary');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bot vs human vs asset split by User-Agent / path', () => {
  const dir = makeLogDir({
    'access.log': [
      caddyLine({ ua: 'Mozilla/5.0 (Windows)', uri: '/', ip: '10.0.0.1' }),     // human page
      caddyLine({ ua: 'Mozilla/5.0 (Macintosh)', uri: '/data', ip: '10.0.0.2' }),// human page
      caddyLine({ ua: 'Googlebot/2.1', uri: '/', ip: '66.0.0.1' }),               // bot
      caddyLine({ ua: 'python-requests/2.31', uri: '/', ip: '66.0.0.2' }),        // bot
      caddyLine({ ua: '', uri: '/', ip: '66.0.0.3' }),                            // empty UA -> bot
      caddyLine({ ua: 'Mozilla/5.0', uri: '/style.css', ip: '10.0.0.3' }),        // human but asset
      caddyLine({ ua: 'Mozilla/5.0', uri: '/app.js?v=2', ip: '10.0.0.4' }),       // asset w/ query
    ],
  });
  try {
    const s = trafficSummary({ dir });
    assert.equal(s.total, 7, 'all 7 lines counted');
    // human = 2 page humans + 2 asset humans = 4; bot = googlebot + python + empty-UA = 3
    assert.equal(s.human, 4, 'humans by UA');
    assert.equal(s.bot, 3, 'bots by UA (incl. empty UA)');
    assert.equal(s.assets, 2, 'asset requests by extension');
    assert.equal(s.uniqueBots, 3, 'three distinct bot IPs');

    // page tally only counts non-bot, non-asset, status<400 paths
    const pages = Object.fromEntries(s.topPages);
    assert.equal(pages['/'], 1, 'one human page view of /');
    assert.equal(pages['/data'], 1, 'one human page view of /data');
    assert.ok(!('/style.css' in pages), 'assets excluded from pages');
    assert.ok(!('/app.js' in pages), 'assets excluded from pages');

    // bots tallied by UA token
    const bots = Object.fromEntries(s.topBots);
    assert.ok(bots.Googlebot >= 1, 'Googlebot tallied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tallies by page, host, and status', () => {
  const dir = makeLogDir({
    'access.log': [
      caddyLine({ uri: '/', host: 'data.soapbox.community', status: 200, ip: '10.0.0.1' }),
      caddyLine({ uri: '/', host: 'data.soapbox.community', status: 200, ip: '10.0.0.2' }),
      caddyLine({ uri: '/missing', host: 'search.soapbox.community', status: 404, ip: '10.0.0.3' }),
      caddyLine({ uri: '/coins', host: 'data.soapbox.community', status: 301, ip: '10.0.0.4' }),
    ],
  });
  try {
    const s = trafficSummary({ dir });

    // by page: / seen twice, /coins once (301 < 400 so it counts), /missing is 404 (>=400, excluded)
    const pages = Object.fromEntries(s.topPages);
    assert.equal(pages['/'], 2, '/ counted twice');
    assert.equal(pages['/coins'], 1, '/coins (3xx) counted');
    assert.ok(!('/missing' in pages), '404 path excluded from pages');

    // by host
    const hosts = Object.fromEntries(s.byHost);
    assert.equal(hosts['data.soapbox.community'], 3, 'three on data host');
    assert.equal(hosts['search.soapbox.community'], 1, 'one on search host');

    // by status
    const status = Object.fromEntries(s.byStatus);
    assert.equal(status['200'], 2, 'two 200s');
    assert.equal(status['404'], 1, 'one 404');
    assert.equal(status['301'], 1, 'one 301');
    assert.equal(s.notFound, 1, 'notFound mirrors 404 count');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('referrers exclude own domain and parse hostname; multi-file aggregation', () => {
  const dir = makeLogDir({
    'data.log': [
      caddyLine({ ip: '10.0.0.1', referer: 'https://news.ycombinator.com/item?id=1' }),
    ],
    'search.log': [
      caddyLine({ ip: '10.0.0.2', referer: 'https://data.soapbox.community/' }), // own domain -> excluded
      caddyLine({ ip: '10.0.0.3', referer: 'https://www.google.com/search?q=x' }),
    ],
  });
  try {
    const s = trafficSummary({ dir });
    assert.equal(s.total, 3, 'lines from both files aggregated');
    assert.equal(s.files.length, 2, 'two log files listed');

    const refs = Object.fromEntries(s.topReferrers);
    assert.equal(refs['news.ycombinator.com'], 1, 'external referrer hostname tallied');
    assert.equal(refs['www.google.com'], 1, 'external referrer hostname tallied');
    assert.ok(!('data.soapbox.community' in refs), 'own-domain referrer excluded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed / empty lines are skipped, not fatal', () => {
  const dir = makeLogDir({
    'access.log': [
      '',                                    // blank
      'not json at all',                     // unparseable
      '{"partial":',                         // broken json
      caddyLine({ ip: '10.0.0.1', uri: '/' }),
    ],
  });
  try {
    const s = trafficSummary({ dir });
    assert.equal(s.total, 1, 'only the one valid line counted');
    assert.equal(s.uniqueVisitors, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing log dir yields an empty (non-throwing) summary', () => {
  const s = trafficSummary({ dir: join(tmpdir(), 'soapbox-analytics-does-not-exist-zzz') });
  assert.equal(s.total, 0);
  assert.equal(s.uniqueVisitors, 0);
  assert.deepEqual(s.files, []);
});
