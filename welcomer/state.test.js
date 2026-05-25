/**
 * Tests for welcomer/state.js.
 *
 *   node --test welcomer/state.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WelcomerState } from './state.js';

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'melek-welcomer-state-'));
  const path = join(dir, 'state.json');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('starts empty when file does not exist', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WelcomerState({ path });
    assert.deepEqual(s.accounts(), []);
    assert.deepEqual(s.pendingAccounts(), []);
    assert.equal(s.getLastProcessedBlock(), null);
    assert.equal(s.hasWelcomed('alice'), false);
    assert.equal(s.isKnown('alice'), false);
  } finally {
    cleanup();
  }
});

test('recordDiscovery marks an account as known but not welcomed', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WelcomerState({ path });
    s.recordDiscovery('alice', { block: 1000 });
    assert.equal(s.isKnown('alice'), true);
    assert.equal(s.hasWelcomed('alice'), false);
    assert.equal(s.data.accounts.alice.discoveredAtBlock, 1000);
    assert.deepEqual(s.pendingAccounts(), ['alice']);
  } finally {
    cleanup();
  }
});

test('recordDiscovery is idempotent', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WelcomerState({ path });
    s.recordDiscovery('alice', { block: 1000 });
    const firstDiscovered = s.data.accounts.alice.discoveredAt;
    s.recordDiscovery('alice', { block: 2000 });
    // discoveredAt and discoveredAtBlock should NOT change
    assert.equal(s.data.accounts.alice.discoveredAt, firstDiscovered);
    assert.equal(s.data.accounts.alice.discoveredAtBlock, 1000);
  } finally {
    cleanup();
  }
});

test('recordWelcome marks an account as welcomed with txId', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WelcomerState({ path });
    s.recordDiscovery('alice', { block: 1000 });
    s.recordWelcome('alice', { txId: '0xabc' });
    assert.equal(s.hasWelcomed('alice'), true);
    assert.equal(s.data.accounts.alice.txId, '0xabc');
    assert.deepEqual(s.pendingAccounts(), []);
  } finally {
    cleanup();
  }
});

test('recordWelcome works even without prior discovery', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WelcomerState({ path });
    s.recordWelcome('alice', { txId: 'tx1' });
    assert.equal(s.isKnown('alice'), true);
    assert.equal(s.hasWelcomed('alice'), true);
  } finally {
    cleanup();
  }
});

test('pendingAccounts excludes already-welcomed accounts', () => {
  const { path, cleanup } = makeStore();
  try {
    const s = new WelcomerState({ path });
    s.recordDiscovery('alice');
    s.recordDiscovery('bob');
    s.recordDiscovery('carol');
    s.recordWelcome('bob');
    assert.deepEqual(s.pendingAccounts().sort(), ['alice', 'carol']);
  } finally {
    cleanup();
  }
});

test('last_processed_block round-trips and survives reload', () => {
  const { path, cleanup } = makeStore();
  try {
    const s1 = new WelcomerState({ path });
    s1.setLastProcessedBlock(12345);
    const s2 = new WelcomerState({ path });
    assert.equal(s2.getLastProcessedBlock(), 12345);
  } finally {
    cleanup();
  }
});

test('persistence: discoveries + welcomes survive reload', () => {
  const { path, cleanup } = makeStore();
  try {
    const s1 = new WelcomerState({ path });
    s1.recordDiscovery('alice', { block: 100 });
    s1.recordWelcome('alice', { txId: '0xabc' });
    s1.recordDiscovery('bob', { block: 101 });

    const s2 = new WelcomerState({ path });
    assert.equal(s2.hasWelcomed('alice'), true);
    assert.equal(s2.isKnown('bob'), true);
    assert.equal(s2.hasWelcomed('bob'), false);
    assert.deepEqual(s2.pendingAccounts(), ['bob']);
  } finally {
    cleanup();
  }
});

test('malformed state file is treated as empty', () => {
  const { path, cleanup } = makeStore();
  try {
    writeFileSync(path, '{ not json');
    const s = new WelcomerState({ path });
    assert.deepEqual(s.accounts(), []);
    s.recordDiscovery('alice');
    const reloaded = new WelcomerState({ path });
    assert.equal(reloaded.isKnown('alice'), true);
  } finally {
    cleanup();
  }
});
