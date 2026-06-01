// resolution.test.js — Cheetah Step 4. Proves the resolution transitions + guards
// against a temp store: whitelist needs evidence, pass-off never auto-blacklists,
// blacklist eligibility requires a PATTERN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { recordFinding, isWhitelisted, _internal } from './store.js';
import { applyResolution, blacklistEligibility } from './resolution.js';

function tmpStore(tag) { return join(tmpdir(), `cheetah-res-${tag}-${process.pid}.json`); }

test('self-quote with evidence resolves + whitelists the author', async () => {
  const path = tmpStore('selfquote');
  await rm(path, { force: true });
  const { id } = await recordFinding({ post: { author: 'alice', permlink: 'p1' }, source: { kind: 'web', url: 'http://alice.blog/x' }, confidence: 0.8 }, path);
  const r = await applyResolution(id, 'self-quote', { by: 'hathor', evidence: 'http://alice.blog/x (dated earlier)' }, path);
  assert.equal(r.finding.status, 'resolved-self-quote');
  assert.equal(r.whitelisted, true);
  assert.equal(await isWhitelisted('alice', null, path), true);
  await rm(path, { force: true });
});

test('self-quote WITHOUT evidence is refused (no unproven whitelisting)', async () => {
  const path = tmpStore('noevidence');
  await rm(path, { force: true });
  const { id } = await recordFinding({ post: { author: 'bob', permlink: 'p2' }, source: { kind: 'web', url: 'http://x' }, confidence: 0.7 }, path);
  await assert.rejects(() => applyResolution(id, 'self-quote', { by: 'hathor' }, path), /requires evidence/);
  await rm(path, { force: true });
});

test('coincidence resolves without touching the whitelist', async () => {
  const path = tmpStore('coinc');
  await rm(path, { force: true });
  const { id } = await recordFinding({ post: { author: 'carol', permlink: 'p3' }, source: { kind: 'web', url: 'http://y' }, confidence: 0.6 }, path);
  const r = await applyResolution(id, 'coincidence', { by: 'hathor' }, path);
  assert.equal(r.finding.status, 'resolved-coincidence');
  assert.equal(r.whitelisted, false);
  assert.equal(await isWhitelisted('carol', null, path), false);
  await rm(path, { force: true });
});

test('pass-off resolves but returns an escalation recommendation — NEVER auto-blacklists', async () => {
  const path = tmpStore('passoff');
  await rm(path, { force: true });
  const { id } = await recordFinding({ post: { author: 'dave', permlink: 'p4' }, source: { kind: 'web', url: 'http://z' }, confidence: 0.9 }, path);
  const r = await applyResolution(id, 'pass-off', { by: 'hathor' }, path);
  assert.equal(r.finding.status, 'resolved-passoff');
  assert.equal(r.escalation.auto, false);
  // store must NOT contain a blacklist entry from this
  const state = await _internal.loadStore(path);
  assert.equal(state.blacklist.length, 0);
  await rm(path, { force: true });
});

test('blacklist eligibility needs a PATTERN (>= 2 confirmed pass-offs)', async () => {
  const path = tmpStore('pattern');
  await rm(path, { force: true });
  const a = await recordFinding({ post: { author: 'eve', permlink: 'q1' }, source: { kind: 'web', url: 'http://1' }, confidence: 0.9 }, path);
  await applyResolution(a.id, 'pass-off', { by: 'hathor' }, path);
  let elig = await blacklistEligibility('eve', path);
  assert.equal(elig.eligible, false); // one is a conversation
  const b = await recordFinding({ post: { author: 'eve', permlink: 'q2' }, source: { kind: 'web', url: 'http://2' }, confidence: 0.9 }, path);
  await applyResolution(b.id, 'pass-off', { by: 'hathor' }, path);
  elig = await blacklistEligibility('eve', path);
  assert.equal(elig.eligible, true); // two is a pattern
  assert.equal(elig.priorPassoffs, 2);
  await rm(path, { force: true });
});
