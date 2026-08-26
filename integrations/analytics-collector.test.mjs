// analytics-collector.test.mjs — OFFLINE. Temp-dir file store, injected clock. No network, no PII.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  record, aggregate, readAllEvents,
  refHost, normPath, normHost, dayOf, deviceClass,
} from './analytics-collector.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'analytics-col-')); }
const DAY = Date.parse('2026-08-20T12:00:00Z');
const clock = (t) => () => t;

test('record() writes a cookieless, PII-free row to JSONL', () => {
  const dir = tmp();
  try {
    const row = record({
      path: '/markets?token=secret#frag', host: 'DATA.soapbox.community:8080',
      ref: 'https://news.ycombinator.com/item?id=42', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS)',
    }, { dir, now: clock(DAY) });

    assert.ok(row, 'row returned');
    // stored fields are exactly the safe, coarse set — and nothing else
    assert.deepEqual(Object.keys(row).sort(), ['day', 'device', 'host', 'path', 'ref', 'ts', 'type']);
    assert.equal(row.path, '/markets');                 // query + fragment stripped (PII removal)
    assert.equal(row.host, 'data.soapbox.community');   // lowercased, port dropped
    assert.equal(row.ref, 'news.ycombinator.com');      // referrer reduced to HOST only
    assert.equal(row.device, 'mobile');                 // coarse class from UA
    assert.equal(row.type, 'pageview');
    assert.equal(row.day, '2026-08-20');

    // on disk: one JSONL line, and it must NOT contain the raw UA, the full referrer, ip, or a cookie
    const raw = readFileSync(join(dir, 'events.jsonl'), 'utf8');
    assert.equal(raw.trim().split('\n').length, 1);
    assert.doesNotMatch(raw, /Mozilla|iPhone OS|item\?id|cookie|secret/i);
    assert.doesNotMatch(raw, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/); // no IPs
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('aggregate() rolls up pageviews per path/host/referrer/day + devices', () => {
  const dir = tmp();
  try {
    record({ path: '/a', host: 'x.com', ref: 'https://google.com/s', ua: 'Mozilla/5.0 (X11; Linux)' }, { dir, now: clock(DAY) });
    record({ path: '/a', host: 'x.com', ua: 'Mozilla/5.0 (X11; Linux)' }, { dir, now: clock(DAY) });
    record({ path: '/b', host: 'y.com', ref: 'https://google.com/x', ua: 'Mozilla/5.0 (iPhone) Mobile' }, { dir, now: clock(DAY + 86400000) });

    const a = aggregate({ dir });
    assert.equal(a.pageviews, 3);
    assert.deepEqual(a.topPaths[0], ['/a', 2]);
    assert.deepEqual(a.topHosts.sort(), [['x.com', 2], ['y.com', 1]]);
    // both google.com hits collapse to the host; one direct
    const refs = Object.fromEntries(a.topReferrers);
    assert.equal(refs['google.com'], 2);
    assert.equal(refs['(direct)'], 1);
    assert.equal(a.byDay.length, 2);
    assert.equal(a.byDevice.desktop, 2);
    assert.equal(a.byDevice.mobile, 1);
    assert.equal(a.span.from, '2026-08-20');
    assert.equal(a.span.to, '2026-08-21');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('aggregate({since}) filters by day bucket', () => {
  const dir = tmp();
  try {
    record({ path: '/old', host: 'x.com' }, { dir, now: clock(DAY) });
    record({ path: '/new', host: 'x.com' }, { dir, now: clock(DAY + 5 * 86400000) });
    const a = aggregate({ dir, since: '2026-08-23' });
    assert.equal(a.pageviews, 1);
    assert.deepEqual(a.topPaths[0], ['/new', 1]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation + cap: store never grows unbounded on disk', () => {
  const dir = tmp();
  const prevBytes = process.env.ANALYTICS_MAX_BYTES;
  const prevFiles = process.env.ANALYTICS_MAX_FILES;
  process.env.ANALYTICS_MAX_BYTES = '200';  // tiny → rotate almost every write
  process.env.ANALYTICS_MAX_FILES = '3';    // keep at most 3 rotations
  try {
    let t = DAY;
    for (let i = 0; i < 40; i++) {
      record({ path: '/p' + i, host: 'x.com', ua: 'Mozilla/5.0 (X11; Linux) padding padding padding' }, { dir, now: clock(t += 1000) });
    }
    const files = readdirSync(dir);
    const rotations = files.filter((f) => f.startsWith('events-'));
    assert.ok(rotations.length <= 3, `rotations capped at 3, got ${rotations.length}`);
    assert.ok(files.includes('events.jsonl'), 'active file present');
    // aggregate still reads whatever survived (the most recent events) without throwing
    const a = aggregate({ dir });
    assert.ok(a.pageviews > 0 && a.pageviews < 40, 'older events pruned, recent ones kept');
  } finally {
    if (prevBytes === undefined) delete process.env.ANALYTICS_MAX_BYTES; else process.env.ANALYTICS_MAX_BYTES = prevBytes;
    if (prevFiles === undefined) delete process.env.ANALYTICS_MAX_FILES; else process.env.ANALYTICS_MAX_FILES = prevFiles;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('soft-fail: garbage input never throws; corrupt lines are skipped', () => {
  const dir = tmp();
  try {
    // garbage / hostile input still yields a safe row or null, never an exception
    assert.doesNotThrow(() => record(null, { dir }));
    assert.doesNotThrow(() => record(undefined, { dir }));
    assert.doesNotThrow(() => record({ path: {}, host: [], ref: 12345, ua: null }, { dir, now: clock(DAY) }));

    // write a corrupt half-line into the store, then a good one → aggregate skips the junk
    writeFileSync(join(dir, 'events.jsonl'), '{not json\n', { flag: 'a' });
    record({ path: '/ok', host: 'x.com' }, { dir, now: clock(DAY) });
    const a = aggregate({ dir });
    assert.doesNotThrow(() => aggregate({ dir }));
    assert.ok(a.pageviews >= 1);
    assert.ok(a.topPaths.some(([p]) => p === '/ok'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('soft-fail: unwritable dir → record returns null, does not throw', () => {
  // point at a path whose parent is a FILE, so mkdir/append can't succeed
  const dir = tmp();
  try {
    const filePath = join(dir, 'blocker');
    writeFileSync(filePath, 'x');
    const badDir = join(filePath, 'sub'); // parent is a file → unwritable
    let out;
    assert.doesNotThrow(() => { out = record({ path: '/x', host: 'x.com' }, { dir: badDir, now: clock(DAY) }); });
    assert.equal(out, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('empty store → all-zero aggregate shape (never invented)', () => {
  const dir = tmp();
  try {
    const a = aggregate({ dir });
    assert.equal(a.pageviews, 0);
    assert.deepEqual(a.topPaths, []);
    assert.deepEqual(a.topHosts, []);
    assert.deepEqual(a.byDay, []);
    assert.deepEqual(a.span, { from: null, to: null });
    assert.deepEqual(readAllEvents({ dir }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('field helpers: privacy reductions are correct', () => {
  assert.equal(refHost('https://www.example.com/deep/path?q=secret'), 'www.example.com');
  assert.equal(refHost(''), '(direct)');
  assert.equal(refHost('garbage not a url'), '(direct)');
  assert.equal(refHost('bare.example.org'), 'bare.example.org');
  assert.equal(normPath('/a/b?c=1#d'), '/a/b');
  assert.equal(normPath(''), '/');
  assert.equal(normHost('HTTPS://Foo.com:443/x'), 'foo.com');
  assert.equal(dayOf(Date.parse('2026-01-02T03:04:05Z')), '2026-01-02');
  assert.equal(dayOf('nonsense'), 'unknown');
});

test('deviceClass is coarse and stores no version/model', () => {
  assert.equal(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile'), 'mobile');
  assert.equal(deviceClass('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'tablet');
  assert.equal(deviceClass('Mozilla/5.0 (X11; Linux x86_64) Chrome/120'), 'desktop');
  assert.equal(deviceClass('GPTBot/1.0 (+https://openai.com/gptbot)'), 'bot');
  assert.equal(deviceClass(''), 'unknown');
});
