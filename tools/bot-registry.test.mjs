// bot-registry.test.mjs — OFFLINE unit tests for the BOTS manifest + status().
// status() cross-checks the manifest against bot-data.mjs's cwd-relative .local/bot-data logs.
// We drive it fully offline: each test chdir's into a fresh tmp dir, seeds real reporting
// state with emitBotData (no network, no repo pollution), then asserts the cross-check.
//
//   node --test tools/bot-registry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOTS, status } from './bot-registry.mjs';
import { emitBotData } from './bot-data.mjs';

// Run `fn` with cwd set to a throwaway tmp dir, then restore + clean up.
function inTmp(fn) {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'bot-registry-'));
  try {
    process.chdir(dir);
    return fn(dir);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

const AT = '2026-06-11T00:00:00.000Z';

test('BOTS is a non-empty manifest of well-shaped entries', () => {
  assert.ok(Array.isArray(BOTS));
  assert.ok(BOTS.length > 0);
  for (const b of BOTS) {
    assert.equal(typeof b.name, 'string');
    assert.ok(b.name.length > 0);
    assert.equal(typeof b.what, 'string');
    assert.equal(typeof b.schedule, 'string');
    assert.equal(typeof b.module, 'string');
    // emits is the bot-data name it reports under, or null if not yet wired
    assert.ok(b.emits === null || typeof b.emits === 'string');
  }
  // names are unique
  const names = BOTS.map((b) => b.name);
  assert.equal(new Set(names).size, names.length);
});

test('status() with no data: nothing reporting, wired entries have null last fields', () => {
  inTmp(() => {
    const rows = status();
    assert.equal(rows.length, BOTS.length);
    for (const r of rows) {
      assert.equal(r.reporting, false);
      assert.equal(r.lastAt, null);
      assert.equal(r.lastSummary, null);
      // status() carries through the manifest fields
      assert.equal(typeof r.name, 'string');
      assert.equal(typeof r.what, 'string');
    }
  });
});

test('status() marks a wired bot as reporting once it has emitted data', () => {
  inTmp(() => {
    // wall-bot is a wired entry (emits: 'wall-bot') — give it a real run
    emitBotData('wall-bot', { summary: 'placed VKBT buy wall', data: { side: 'buy' }, at: AT });
    const rows = status();
    const wall = rows.find((r) => r.name === 'wall-bot');
    assert.ok(wall);
    assert.equal(wall.reporting, true);
    assert.equal(wall.lastAt, AT);
    assert.equal(wall.lastSummary, 'placed VKBT buy wall');
  });
});

test('status() never marks an unwired bot (emits:null) as reporting', () => {
  inTmp(() => {
    const unwired = BOTS.find((b) => b.emits === null);
    assert.ok(unwired, 'expected at least one unwired bot in the manifest');
    // even if a log happened to exist under its name, emits:null => never reporting
    emitBotData(unwired.name, { summary: 'noise', data: {}, at: AT });
    const row = status().find((r) => r.name === unwired.name);
    assert.equal(row.reporting, false);
    assert.equal(row.lastAt, null);
    assert.equal(row.lastSummary, null);
  });
});

test('status() reflects the latest run for a wired bot that ran twice', () => {
  inTmp(() => {
    emitBotData('wall-bot', { summary: 'first', data: { n: 1 }, at: '2026-06-10T00:00:00.000Z' });
    emitBotData('wall-bot', { summary: 'second', data: { n: 2 }, at: AT });
    const wall = status().find((r) => r.name === 'wall-bot');
    assert.equal(wall.lastAt, AT);
    assert.equal(wall.lastSummary, 'second');
  });
});
