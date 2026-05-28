/**
 * Tests for watcher/sinks (file/telegram/email + dispatcher).
 *
 *   node --test watcher/sinks.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch, enabledSinks } from './sinks/index.js';
import * as fileSink from './sinks/file.js';
import * as telegramSink from './sinks/telegram.js';
import * as emailSink from './sinks/email.js';

const sampleEvent = () => ({
  kind: 'transfer',
  severity: 'high',
  account: 'hathor',
  op: 'transfer',
  opData: { from: 'hathor', to: 'someone', amount: '1.000 MELEK', memo: '' },
  block: 1,
  trxId: 'tx-1',
  historyIndex: 1,
  timestamp: '2026-05-27T00:00:00',
});

const sampleAlert = () => ({ subject: '[HIGH] test', body: 'body line\nbody line 2' });

function tempLogPath() {
  const dir = mkdtempSync(join(tmpdir(), 'melek-watcher-sink-'));
  return { path: join(dir, 'alerts.jsonl'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function fileOnlyConfig(path) {
  return {
    sinks: {
      file: { path },
      telegram: { botToken: null, chatId: null },
      email: { apiKey: null, from: null, to: null },
    },
  };
}

// ---- enabledSinks ----------------------------------------------------------

test('enabledSinks: file enabled when path set, others off when unset', () => {
  const enabled = enabledSinks(fileOnlyConfig('/tmp/x.jsonl')).map((s) => s.name);
  assert.deepEqual(enabled, ['file']);
});

test('enabledSinks: telegram enabled only with token AND chat id', () => {
  const cfg = (token, chat) => ({
    sinks: { file: { path: null }, telegram: { botToken: token, chatId: chat }, email: { apiKey: null, from: null, to: null } },
  });
  assert.deepEqual(enabledSinks(cfg(null, null)).map((s) => s.name), []);
  assert.deepEqual(enabledSinks(cfg('tok', null)).map((s) => s.name), []);
  assert.deepEqual(enabledSinks(cfg(null, 'chat')).map((s) => s.name), []);
  assert.deepEqual(enabledSinks(cfg('tok', 'chat')).map((s) => s.name), ['telegram']);
});

test('enabledSinks: email needs apiKey + from + to', () => {
  const cfg = (apiKey, from, to) => ({
    sinks: { file: { path: null }, telegram: { botToken: null, chatId: null }, email: { apiKey, from, to } },
  });
  assert.deepEqual(enabledSinks(cfg('k', 'f@x', ['t@x'])).map((s) => s.name), ['email']);
  assert.deepEqual(enabledSinks(cfg('k', 'f@x', null)).map((s) => s.name), []);
  assert.deepEqual(enabledSinks(cfg(null, 'f@x', ['t@x'])).map((s) => s.name), []);
});

// ---- file sink -------------------------------------------------------------

test('file sink: writes a JSONL line with subject/body/opData', async () => {
  const { path, cleanup } = tempLogPath();
  try {
    const res = await fileSink.send(sampleEvent(), sampleAlert(), fileOnlyConfig(path));
    assert.equal(res.ok, true);
    const content = readFileSync(path, 'utf8').trim();
    const parsed = JSON.parse(content);
    assert.equal(parsed.severity, 'high');
    assert.equal(parsed.kind, 'transfer');
    assert.equal(parsed.subject, '[HIGH] test');
    assert.equal(parsed.opData.to, 'someone');
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
  } finally { cleanup(); }
});

test('file sink: append, not overwrite — second send adds a second line', async () => {
  const { path, cleanup } = tempLogPath();
  try {
    await fileSink.send(sampleEvent(), sampleAlert(), fileOnlyConfig(path));
    await fileSink.send(sampleEvent(), sampleAlert(), fileOnlyConfig(path));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
  } finally { cleanup(); }
});

// ---- telegram sink ---------------------------------------------------------

test('telegram sink: POSTs subject+body to sendMessage with chat_id', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200 };
  };
  const config = {
    sinks: {
      file: { path: null },
      telegram: { botToken: 'TOK', chatId: '12345' },
      email: { apiKey: null, from: null, to: null },
    },
  };
  const res = await telegramSink.send(sampleEvent(), sampleAlert(), config, { fetchImpl: fakeFetch });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/botTOK\/sendMessage$/);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.chat_id, '12345');
  assert.match(body.text, /^\[HIGH\] test\n\nbody line/);
});

test('telegram sink: non-2xx returns ok:false with status', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429 });
  const config = {
    sinks: { file: { path: null }, telegram: { botToken: 'T', chatId: 'c' }, email: { apiKey: null, from: null, to: null } },
  };
  const res = await telegramSink.send(sampleEvent(), sampleAlert(), config, { fetchImpl: fakeFetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /429/);
});

test('telegram sink: fetch throw returns ok:false', async () => {
  const fakeFetch = async () => { throw new Error('network blew up'); };
  const config = {
    sinks: { file: { path: null }, telegram: { botToken: 'T', chatId: 'c' }, email: { apiKey: null, from: null, to: null } },
  };
  const res = await telegramSink.send(sampleEvent(), sampleAlert(), config, { fetchImpl: fakeFetch });
  assert.equal(res.ok, false);
  assert.match(res.error, /network blew up/);
});

// ---- email sink ------------------------------------------------------------

test('email sink: POSTs to resend with bearer auth and to as array', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const config = {
    sinks: {
      file: { path: null },
      telegram: { botToken: null, chatId: null },
      email: { apiKey: 'rsk_test', from: 'alert@x', to: ['ops@x', 'sec@x'] },
    },
  };
  const res = await emailSink.send(sampleEvent(), sampleAlert(), config, { fetchImpl: fakeFetch });
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer rsk_test');
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.to, ['ops@x', 'sec@x']);
  assert.equal(body.subject, '[HIGH] test');
  assert.match(body.text, /body line/);
});

test('email sink: wraps single-string to into an array', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
  const config = {
    sinks: {
      file: { path: null },
      telegram: { botToken: null, chatId: null },
      email: { apiKey: 'rsk', from: 'a@x', to: 'just-one@x' },
    },
  };
  await emailSink.send(sampleEvent(), sampleAlert(), config, { fetchImpl: fakeFetch });
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.to, ['just-one@x']);
});

// ---- dispatch --------------------------------------------------------------

test('dispatch: file-only fans out to one sink and returns one result', async () => {
  const { path, cleanup } = tempLogPath();
  try {
    const results = await dispatch(sampleEvent(), sampleAlert(), fileOnlyConfig(path));
    assert.equal(results.length, 1);
    assert.equal(results[0].sink, 'file');
    assert.equal(results[0].ok, true);
  } finally { cleanup(); }
});

test('dispatch: a throwing sink does NOT break sibling sinks', async () => {
  const { path, cleanup } = tempLogPath();
  try {
    const badSink = {
      name: 'bad',
      enabled: () => true,
      send: async () => { throw new Error('boom'); },
    };
    const config = fileOnlyConfig(path);
    const results = await dispatch(sampleEvent(), sampleAlert(), config, { pool: [fileSink, badSink] });
    const byName = Object.fromEntries(results.map((r) => [r.sink, r]));
    assert.equal(byName.file.ok, true);
    assert.equal(byName.bad.ok, false);
    assert.match(byName.bad.error, /boom/);
    // and the file still got written
    const line = readFileSync(path, 'utf8').trim();
    assert.ok(line.length > 0);
  } finally { cleanup(); }
});
