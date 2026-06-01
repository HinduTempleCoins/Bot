// bot-data.test.js — the universal bot data-collection method.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { emitBotData, recentBotData, reportingBots } from './bot-data.mjs';

// these write under .local/ — clean the specific test bot before/after.
function clean() { try { rmSync('.local/bot-data/test-bot.jsonl', { force: true }); rmSync('.local/shared/bot-test-bot.md', { force: true }); } catch {} }

test('emitBotData writes a jsonl log line and a shared markdown', () => {
  clean();
  const { logPath, mdPath } = emitBotData('test-bot', { summary: 'ran ok', data: { x: 1 }, at: '2026-06-01T00:00:00Z' });
  assert.ok(existsSync(logPath));
  assert.ok(existsSync(mdPath));
  assert.match(readFileSync(mdPath, 'utf8'), /ran ok/);
  assert.match(readFileSync(logPath, 'utf8'), /"x":1/);
  clean();
});

test('appends across runs and recentBotData reads them back', () => {
  clean();
  emitBotData('test-bot', { summary: 'run1', data: { n: 1 }, at: '2026-06-01T00:00:01Z' });
  emitBotData('test-bot', { summary: 'run2', data: { n: 2 }, at: '2026-06-01T00:00:02Z' });
  const recent = recentBotData('test-bot', 10);
  assert.equal(recent.length, 2);
  assert.equal(recent[1].data.n, 2);
  clean();
});

test('sanitizes a messy bot name (no path traversal)', () => {
  clean();
  const { logPath } = emitBotData('../evil bot!!', { summary: 's' });
  assert.ok(!logPath.includes('..'));
  assert.match(logPath, /evil-bot/);
});

test('reportingBots lists bots that have emitted', () => {
  emitBotData('test-bot', { summary: 's', at: '2026-06-01T00:00:03Z' });
  assert.ok(reportingBots().includes('test-bot'));
  clean();
});
