// bot-data.test.mjs — OFFLINE. The log is append-only; emitting must never rewrite what is already there.
//
// This exists because emitBotData used to read the ENTIRE log and write it back to add one line. That is
// O(n^2) in the number of runs, and in production it meant reading and rewriting ~74MB across eight logs
// every twelve minutes to append eight lines, on a host with 5.8GB of disk free. The behavioural contract
// these tests pin is: bytes already in the log are never touched, and exactly one line is added per call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { emitBotData, recentBotData, reportingBots } = await import('./bot-data.mjs');

/** emitBotData writes to .local/* relative to cwd, so each test runs inside its own throwaway cwd. */
function inSandbox(fn) {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(cwd, '.tmp-botdata-'));
  try { process.chdir(dir); return fn(dir); } finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('one emit writes one JSONL line and a latest-run markdown', () => inSandbox(() => {
  const { logPath, mdPath } = emitBotData('wall-bot', { summary: 'placed a VKBT buy wall', data: { token: 'VKBT', n: 1 }, at: '2026-01-01T00:00:00.000Z' });
  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { at: '2026-01-01T00:00:00.000Z', summary: 'placed a VKBT buy wall', data: { token: 'VKBT', n: 1 } });
  assert.match(fs.readFileSync(mdPath, 'utf8'), /# wall-bot — latest run/);
}));

test('APPEND-ONLY: existing bytes are never rewritten, and each call adds exactly one line', () => inSandbox(() => {
  // A log with real history in it. If emit ever read-and-rewrote, a mismatch here would show it.
  const { logPath } = emitBotData('collector', { summary: 'run 0', data: { i: 0 }, at: '2026-01-01T00:00:00.000Z' });
  for (let i = 1; i < 50; i++) emitBotData('collector', { summary: `run ${i}`, data: { i }, at: `2026-01-01T00:00:0${i % 10}.000Z` });
  const before = fs.readFileSync(logPath, 'utf8');
  assert.equal(before.trim().split('\n').length, 50);

  emitBotData('collector', { summary: 'run 50', data: { i: 50 }, at: '2026-01-02T00:00:00.000Z' });
  const after = fs.readFileSync(logPath, 'utf8');

  assert.ok(after.startsWith(before), 'every pre-existing byte must still be there, unchanged, at the front');
  assert.equal(after.trim().split('\n').length, 51, 'exactly one line added');
  assert.equal(after.slice(before.length).trim().split('\n').length, 1, 'and the delta is that one line alone');
  assert.equal(JSON.parse(after.trim().split('\n').at(-1)).data.i, 50);
}));

test('a log that is not valid JSON throughout is still appended to, not clobbered', () => inSandbox(() => {
  // Real logs get truncated by full disks. A corrupt tail must not cost us the whole history.
  fs.mkdirSync('.local/bot-data', { recursive: true });
  const p = '.local/bot-data/scarred.jsonl';
  fs.writeFileSync(p, '{"at":"a","summary":"good","data":{}}\n{"at":"b","trunc\n');
  emitBotData('scarred', { summary: 'after the scar', data: { ok: true }, at: '2026-03-03T00:00:00.000Z' });
  const txt = fs.readFileSync(p, 'utf8');
  assert.ok(txt.includes('"summary":"good"'), 'the good line survives');
  assert.ok(txt.includes('"trunc'), 'the damaged line is left exactly as found, not silently dropped');
  assert.ok(txt.trimEnd().endsWith('}'), 'the new record is appended at the end');
  const read = recentBotData('scarred', 20);
  assert.equal(read.length, 2, 'the reader skips the unparseable line and returns the two good records');
  assert.equal(read.at(-1).summary, 'after the scar');
}));

test('the markdown holds only the latest run, while the log keeps all of them', () => inSandbox(() => {
  emitBotData('dca', { summary: 'first', data: { n: 1 }, at: '2026-01-01T00:00:00.000Z' });
  const { logPath, mdPath } = emitBotData('dca', { summary: 'second', data: { n: 2 }, at: '2026-01-01T00:10:00.000Z' });
  const md = fs.readFileSync(mdPath, 'utf8');
  assert.ok(md.includes('second') && !md.includes('first'), 'markdown is the latest run only');
  assert.equal(fs.readFileSync(logPath, 'utf8').trim().split('\n').length, 2, 'the log keeps both');
}));

test('recentBotData returns the last N in order, and reportingBots lists the logs', () => inSandbox(() => {
  for (let i = 0; i < 5; i++) emitBotData('grid', { summary: `s${i}`, data: { i }, at: `2026-01-0${i + 1}T00:00:00.000Z` });
  emitBotData('arb', { summary: 'x', data: {}, at: '2026-01-01T00:00:00.000Z' });
  const last3 = recentBotData('grid', 3);
  assert.deepEqual(last3.map((r) => r.data.i), [2, 3, 4], 'oldest-to-newest, last 3');
  assert.deepEqual(recentBotData('nobody-has-run-this'), []);
  assert.deepEqual(reportingBots().sort(), ['arb', 'grid']);
}));

test('a hostile bot name cannot escape the log directory', () => inSandbox(() => {
  const { logPath } = emitBotData('../../etc/passwd', { summary: 'nope', data: {} });
  assert.equal(logPath, path.join('.local/bot-data', 'etc-passwd.jsonl'), 'slashes and dots are sanitized away');
  assert.ok(fs.existsSync(logPath));
  assert.equal(emitBotData('', { data: {} }).logPath, path.join('.local/bot-data', 'bot.jsonl'), 'an empty name falls back');
}));
