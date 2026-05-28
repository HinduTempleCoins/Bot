/**
 * Tests for watcher/state.js.
 *
 *   node --test watcher/state.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WatcherState } from './state.js';

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'melek-watcher-state-'));
  const path = join(dir, 'state.json');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('starts empty when file does not exist', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WatcherState({ path });
    assert.equal(s.getLastHistoryIndex(), null);
    assert.equal(s.getAccount(), null);
    assert.equal(s.hasAlerted(42), false);
    assert.equal(s.alertedCount(), 0);
  } finally { cleanup(); }
});

test('setLastHistoryIndex round-trips and survives reload', () => {
  const { path, cleanup } = makeStore();
  try {
    const s1 = new WatcherState({ path });
    s1.setLastHistoryIndex(1234);
    const s2 = new WatcherState({ path });
    assert.equal(s2.getLastHistoryIndex(), 1234);
  } finally { cleanup(); }
});

test('setLastHistoryIndex never moves backwards', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WatcherState({ path });
    s.setLastHistoryIndex(100);
    s.setLastHistoryIndex(50); // ignored
    assert.equal(s.getLastHistoryIndex(), 100);
    s.setLastHistoryIndex(200); // accepted
    assert.equal(s.getLastHistoryIndex(), 200);
  } finally { cleanup(); }
});

test('setLastHistoryIndex rejects non-numbers', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WatcherState({ path });
    assert.throws(() => s.setLastHistoryIndex('123'), /number required/);
    assert.throws(() => s.setLastHistoryIndex(NaN), /number required/);
  } finally { cleanup(); }
});

test('recordAlerted + hasAlerted round-trip', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WatcherState({ path });
    s.recordAlerted(42, { trxId: '0xabc', kind: 'transfer' });
    assert.equal(s.hasAlerted(42), true);
    assert.equal(s.hasAlerted(43), false);
    assert.equal(s.alertedCount(), 1);
  } finally { cleanup(); }
});

test('alerted set survives reload', () => {
  const { path, cleanup } = makeStore();
  try {
    const s1 = new WatcherState({ path });
    s1.recordAlerted(7, { trxId: 't', kind: 'witness_update' });
    s1.recordAlerted(8, { trxId: 't2', kind: 'transfer' });
    const s2 = new WatcherState({ path });
    assert.equal(s2.hasAlerted(7), true);
    assert.equal(s2.hasAlerted(8), true);
    assert.equal(s2.alertedCount(), 2);
  } finally { cleanup(); }
});

test('setAccount claims the file and rejects switching accounts', () => {
  const { path, cleanup } = makeStore();
  try {
    const s1 = new WatcherState({ path });
    s1.setAccount('hathor');
    const s2 = new WatcherState({ path });
    assert.equal(s2.getAccount(), 'hathor');
    s2.setAccount('hathor'); // same account = no-op
    assert.throws(() => s2.setAccount('someoneelse'), /keyed to/);
  } finally { cleanup(); }
});

test('malformed file is treated as empty', () => {
  const { path, cleanup } = makeStore();
  try {
    writeFileSync(path, '{ not json');
    const s = new WatcherState({ path });
    assert.equal(s.getLastHistoryIndex(), null);
    assert.equal(s.alertedCount(), 0);
    s.recordAlerted(1, { trxId: 't', kind: 'transfer' });
    const reloaded = new WatcherState({ path });
    assert.equal(reloaded.hasAlerted(1), true);
  } finally { cleanup(); }
});
