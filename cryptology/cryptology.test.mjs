// Offline test for cryptology.mjs — the per-person relationship map (BRIEF.md §6a).
// No network, no real clock (injected), no disk except a tmp store. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptology-'));
process.env.CRYPTOLOGY_STORE = path.join(tmpdir, 'cryptology.json');
const c = await import('./cryptology.mjs');

// Pin the clock so timestamps are deterministic.
let CLOCK = 1_700_000_000_000;
c.__setClock(() => CLOCK);

test('accountKey normalizes to a lowercase MELEK identity (strips @, trims)', () => {
  assert.equal(c.accountKey('@Hathor'), 'hathor');
  assert.equal(c.accountKey('  ALICE  '), 'alice');
  assert.equal(c.accountKey(undefined), '');
});

test('freshProfile seeds the §6a dimensions + interests + LSD path log', () => {
  const p = c.freshProfile('@NewPerson');
  assert.equal(p.account, 'newperson');
  assert.equal(p.trust, 0);
  assert.equal(p.warmth, 0);
  assert.equal(p.respect, 0);
  assert.equal(p.familiarity, 0);
  assert.deepEqual(Object.keys(p.interests).sort(), c.INTEREST_TOPICS.slice().sort());
  assert.deepEqual(p.conversationPaths, []);
  assert.equal(p.totalInteractions, 0);
  assert.equal(p.firstSeen, CLOCK);
  assert.equal(p.lastSeen, CLOCK);
});

test('drift moves coordinates and clamps to spec (bipolar vs unipolar)', () => {
  const p = c.freshProfile('x');
  c.drift(p, { trust: 200, familiarity: 200 });
  assert.equal(p.trust, 100, 'trust clamps at +100');
  assert.equal(p.familiarity, 100, 'familiarity clamps at +100');

  c.drift(p, { warmth: -250 });
  assert.equal(p.warmth, -100, 'warmth clamps at -100 (bipolar)');

  c.drift(p, { familiarity: -500 });
  assert.equal(p.familiarity, 0, 'familiarity floors at 0 (unipolar, never negative)');
});

test('drift updates interests and preferredDepth; ignores junk depth', () => {
  const p = c.freshProfile('x');
  c.drift(p, { interests: { mythology: 30, newtopic: 10 }, preferredDepth: 'academic' });
  assert.equal(p.interests.mythology, 30);
  assert.equal(p.interests.newtopic, 10, 'open interest map accepts new topics');
  assert.equal(p.preferredDepth, 'academic');

  c.drift(p, { preferredDepth: 'nonsense' });
  assert.equal(p.preferredDepth, 'academic', 'invalid depth ignored');
});

test('observe applies a named event, persists, and counts the interaction', () => {
  const p1 = c.observe('mahatma', 'warm_exchange');
  assert.equal(p1.account, 'mahatma');
  assert.equal(p1.warmth, 8);
  assert.equal(p1.trust, 3);
  assert.equal(p1.familiarity, 2);
  assert.equal(p1.totalInteractions, 1);

  // a second observe reads the persisted profile and stacks on top of it
  const p2 = c.observe('mahatma', 'taught');
  assert.equal(p2.respect, 8);
  assert.equal(p2.warmth, 8, 'prior warmth retained across reload');
  assert.equal(p2.totalInteractions, 2);

  // and it actually hit disk
  const fromDisk = c.recall('mahatma');
  assert.equal(fromDisk.totalInteractions, 2);
  assert.equal(fromDisk.respect, 8);
});

test('unknown event is a soft no-op interaction (never throws, no coordinate move)', () => {
  const p = c.observe('stranger', 'this_event_does_not_exist');
  assert.equal(p.trust, 0);
  assert.equal(p.warmth, 0);
  assert.equal(p.totalInteractions, 1, 'still counted as an interaction');
});

test('observe with path records an LSD-graph choice, capped at 50', () => {
  for (let i = 0; i < 60; i++) c.observe('walker', 'greeted', { path: `choice_${i}` });
  const p = c.recall('walker');
  assert.equal(p.conversationPaths.length, 50, 'path log capped at 50');
  assert.equal(p.conversationPaths.at(-1).choice, 'choice_59', 'keeps the most recent choices');
});

test('dispositionOf returns a STANCE label + raw coordinates (never a canned string) — BRIEF §3', () => {
  const guarded = c.dispositionOf({ trust: -60, warmth: 0, respect: 0, familiarity: 50 });
  assert.equal(guarded.stance, 'guarded');

  const newcomer = c.dispositionOf(c.freshProfile('n'));
  assert.equal(newcomer.stance, 'welcoming');

  const close = c.dispositionOf({ trust: 50, warmth: 70, respect: 40, familiarity: 60 });
  assert.equal(close.stance, 'familiar');

  // a high-alignment + warm person reads as 'kindred' (expanded dimensions)
  const kindred = c.dispositionOf({ trust: 30, warmth: 50, respect: 30, familiarity: 40, alignment: 70 });
  assert.equal(kindred.stance, 'kindred');

  // coordinates are echoed back so the prompt shades a disposition, not a fixed greeting line
  assert.deepEqual(Object.keys(guarded.coordinates).sort(), ['alignment', 'care', 'curiosity', 'familiarity', 'reciprocity', 'respect', 'trust', 'warmth']);
  assert.equal(typeof guarded.closeness, 'number');
  assert.equal(typeof guarded.standing, 'number');
});

test('suggestTopics ranks engaged interests, drops zeros', () => {
  const p = c.freshProfile('reader');
  c.drift(p, { interests: { mythology: 40, esoteric: 90, religion: 0 } });
  const top = c.suggestTopics(p, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].topic, 'esoteric', 'highest weight first');
  assert.equal(top[1].topic, 'mythology');
  assert.ok(!top.find((t) => t.topic === 'religion'), 'zero-weight topics excluded');
});

test('everyone() lists the map sorted by closeness', () => {
  // fresh store for an isolated sort assertion
  const file = path.join(tmpdir, 'map.json');
  c.observe('faraway', 'greeted', { file });
  c.observe('bestie', 'warm_exchange', { file });
  c.observe('bestie', 'shared_story', { file });
  const rows = c.everyone(c.loadStore(file));
  assert.equal(rows[0].account, 'bestie', 'closest first');
  assert.ok(rows[0].closeness >= rows[1].closeness);
});

test('loadStore on a missing/garbage file soft-fails to {} (never throws)', () => {
  assert.deepEqual(c.loadStore(path.join(tmpdir, 'nope.json')), {});
  const junk = path.join(tmpdir, 'junk.json');
  fs.writeFileSync(junk, '{not json');
  assert.deepEqual(c.loadStore(junk), {});
});

test('read-only re chain: no broadcast/vote/transfer/signing surface', () => {
  // accountKey() is identity normalization, not key material — exclude it explicitly. The point is
  // that this module never broadcasts, votes, transfers, or signs (zero-WIF; cf. CLAUDE.md).
  const exported = Object.keys(c).filter((k) => k !== 'accountKey');
  for (const forbidden of ['broadcast', 'vote', 'transfer', 'sign', 'wif', 'privatekey']) {
    assert.ok(!exported.some((k) => k.toLowerCase().includes(forbidden)), `no ${forbidden} export`);
  }
  // and the source must not reference a signer/key env or broadcast call
  const src = fs.readFileSync(new URL('./cryptology.mjs', import.meta.url), 'utf8');
  assert.ok(!/broadcast\(|\.sign\(|process\.env\.\w*WIF/.test(src), 'no broadcast/sign/WIF in source');
});
