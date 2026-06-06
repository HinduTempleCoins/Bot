// cheetah/watch.test.js — offline tests for the read-only watch loop.
//
// No network: the chain readers are injected via __setReaders. The store writes
// go to a temp root. Asserts: findings are recorded for MATCH verdicts, the
// cursor suppresses re-recording, the report artifacts are written, and an RPC
// error soft-fails (no throw, page still written).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pollOnce, __setReaders, __resetReaders } from './watch.mjs';
import { listFindings } from './store.js';

function fakeResults() {
  return [
    { author: 'alice', permlink: 'orig', title: 'Original', verdict: 'clear', confidence: 0, top: null, note: '' },
    {
      author: 'bob',
      permlink: 'copy',
      title: 'Copy',
      verdict: 'match',
      confidence: 0.91,
      top: { kind: 'onchain', url: '@alice/orig', author: 'alice' },
      note: 'this also appears here: @alice/orig',
    },
    {
      author: 'carol',
      permlink: 'similar',
      title: 'Similar',
      verdict: 'related',
      confidence: 0.4,
      top: { author: 'alice', permlink: 'orig', score: 0.4 },
      note: 'see also: @alice/orig',
    },
  ];
}

test('pollOnce records a finding for a MATCH and writes the report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cheetah-watch-'));
  const storeRoot = join(dir, 'store');
  const reportDir = join(dir, 'report');
  try {
    __setReaders({
      fetchPosts: async () => [
        { author: 'alice', permlink: 'orig', body: 'x' },
        { author: 'bob', permlink: 'copy', body: 'x' },
        { author: 'carol', permlink: 'similar', body: 'y' },
      ],
      runEngines: async () => fakeResults(),
    });

    const seen = new Set();
    const r = await pollOnce({ seen, reportDir, storeRoot });

    assert.equal(r.scanned, 3);
    assert.equal(r.fresh, 3);
    assert.equal(r.findingsRecorded, 1, 'only the MATCH verdict is recorded');
    assert.equal(r.rpcError, null);

    // findings store has exactly the one match
    const findings = await listFindings({}, storeRoot);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].post.author, 'bob');
    assert.equal(findings[0].status, 'open');

    // report artifacts written
    const html = await readFile(join(reportDir, 'index.html'), 'utf8');
    assert.match(html, /Cheetah/);
    assert.match(html, /MATCH/);
    const reportJson = JSON.parse(await readFile(join(reportDir, 'report.json'), 'utf8'));
    assert.equal(reportJson.results.length, 3);
  } finally {
    __resetReaders();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the cursor suppresses re-recording an already-seen post', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cheetah-watch-'));
  const storeRoot = join(dir, 'store');
  const reportDir = join(dir, 'report');
  try {
    __setReaders({
      fetchPosts: async () => [{ author: 'bob', permlink: 'copy', body: 'x' }],
      runEngines: async () => fakeResults(),
    });
    const seen = new Set();
    const first = await pollOnce({ seen, reportDir, storeRoot });
    assert.equal(first.findingsRecorded, 1);
    const second = await pollOnce({ seen, reportDir, storeRoot });
    assert.equal(second.fresh, 0, 'no fresh posts on the second tick');
    assert.equal(second.findingsRecorded, 0, 'nothing re-recorded');

    const findings = await listFindings({}, storeRoot);
    assert.equal(findings.length, 1, 'still exactly one finding');
  } finally {
    __resetReaders();
    await rm(dir, { recursive: true, force: true });
  }
});

test('RPC error soft-fails: no throw, report still written, no findings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cheetah-watch-'));
  const storeRoot = join(dir, 'store');
  const reportDir = join(dir, 'report');
  try {
    __setReaders({
      fetchPosts: async () => Object.assign([], { error: 'ECONNREFUSED 127.0.0.1:8090' }),
      runEngines: async () => [],
    });
    const r = await pollOnce({ seen: new Set(), reportDir, storeRoot });
    assert.equal(r.scanned, 0);
    assert.equal(r.findingsRecorded, 0);
    assert.equal(r.rpcError, 'ECONNREFUSED 127.0.0.1:8090');

    const html = await readFile(join(reportDir, 'index.html'), 'utf8');
    assert.match(html, /unreachable/i, 'page reports the RPC is unreachable');

    const findings = await listFindings({}, storeRoot);
    assert.equal(findings.length, 0);
  } finally {
    __resetReaders();
    await rm(dir, { recursive: true, force: true });
  }
});
