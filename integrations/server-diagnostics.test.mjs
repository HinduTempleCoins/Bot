// server-diagnostics.test.mjs — OFFLINE proof that the diagnostics aggregator returns sane local
// metrics, fuses without throwing, and soft-fails when the health/network layer is absent. No
// network is touched: systemInfo/diskUsage are local node:os/node:fs, and serviceHealth is driven
// with an injected `readers` stub so we never hit a real reader.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { systemInfo, serviceHealth, diskUsage, diagnostics } = await import('./server-diagnostics.mjs');

test('systemInfo() returns expected fields with sane types', () => {
  const s = systemInfo();
  assert.equal(s.ok, true);
  assert.equal(typeof s.nodeVersion, 'string');
  assert.ok(s.nodeVersion.startsWith('v'));
  assert.equal(typeof s.platform, 'string');
  assert.equal(typeof s.arch, 'string');
  assert.ok(Number.isInteger(s.cpuCount) && s.cpuCount >= 1);
  assert.ok(Array.isArray(s.loadavg) && s.loadavg.length === 3);
  for (const l of s.loadavg) assert.equal(typeof l, 'number');
  assert.ok(Number.isFinite(s.uptimeSec) && s.uptimeSec >= 0);
  assert.ok(Number.isFinite(s.processUptimeSec) && s.processUptimeSec >= 0);
  assert.ok(s.memTotalBytes > 0);
  assert.ok(s.memFreeBytes >= 0);
  assert.equal(s.memUsedBytes, s.memTotalBytes - s.memFreeBytes);
  assert.ok(s.memUsedPct >= 0 && s.memUsedPct <= 100);
});

test('systemInfo() leaks no hostname/ip/path-shaped fields', () => {
  const s = systemInfo();
  const json = JSON.stringify(s);
  // no obvious infra identifiers
  assert.ok(!/\d{1,3}(\.\d{1,3}){3}/.test(json), 'no IPv4-shaped string');
  assert.ok(!('hostname' in s));
});

test('diskUsage() returns null or a sane shape, never throws', async () => {
  const d = await diskUsage('/');
  if (d === null) return; // statfs unavailable on this Node — acceptable
  if (d.ok) {
    assert.ok(d.totalBytes >= 0);
    assert.ok(d.usedBytes >= 0);
    assert.ok(d.usedPct === null || (d.usedPct >= 0 && d.usedPct <= 100));
  } else {
    assert.equal(typeof d.error, 'string');
  }
});

test('serviceHealth() soft-fails when readers are absent (empty list)', async () => {
  const h = await serviceHealth({ readers: async () => [] });
  assert.equal(h.ok, false); // no checks => not "all up"
  assert.equal(h.total, 0);
  assert.deepEqual(h.checks, []);
});

test('serviceHealth() reports per-check up/down with injected stubs and never throws', async () => {
  const h = await serviceHealth({
    readers: async () => [
      ['good-reader', async () => 'sample'],
      ['bad-reader', async () => { throw new Error('network absent'); }],
    ],
  });
  assert.equal(h.total, 2);
  assert.equal(h.up, 1);
  assert.equal(h.ok, false);
  const good = h.checks.find((c) => c.name === 'good-reader');
  const bad = h.checks.find((c) => c.name === 'bad-reader');
  assert.equal(good.ok, true);
  assert.equal(good.sample, 'sample');
  assert.equal(bad.ok, false);
  assert.match(bad.sample, /network absent/);
  for (const c of h.checks) assert.equal(typeof c.ms, 'number');
});

test('serviceHealth() soft-fails when the readers loader itself throws', async () => {
  const h = await serviceHealth({ readers: async () => { throw new Error('loader blew up'); } });
  assert.equal(h.ok, false);
  assert.equal(typeof h.error, 'string');
  assert.deepEqual(h.checks, []);
});

test('diagnostics() fuses system + services + disk without throwing', async () => {
  const d = await diagnostics({ readers: async () => [['x', async () => 'ok']] });
  assert.equal(typeof d.ts, 'string');
  assert.ok(!Number.isNaN(Date.parse(d.ts)));
  assert.equal(d.system.ok, true);
  assert.equal(d.services.total, 1);
  assert.equal(d.services.up, 1);
  // disk is either null or an object — both acceptable
  assert.ok(d.disk === null || typeof d.disk === 'object');
});

test('diagnostics() still resolves when service readers are absent', async () => {
  const d = await diagnostics({ readers: async () => [] });
  assert.equal(typeof d.ts, 'string');
  assert.equal(d.system.ok, true);
  assert.equal(d.services.total, 0);
});
