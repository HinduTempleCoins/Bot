// hathor-disposition.test.mjs — offline. Uses a temp Crypt-ology store file. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dispositionFor, dispositionGreeting, faucetClaim, recordInteraction, makeBrainDep, FAUCET_DEFAULTS,
} from './hathor-disposition.mjs';

const tmpStore = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crypt-')), 'store.json');
const DAY = 24 * 60 * 60 * 1000;

test('dispositionFor a brand-new account is welcoming, no history', () => {
  const file = tmpStore();
  const d = dispositionFor('alice', { file });
  assert.equal(d.stance, 'welcoming');
  assert.equal(d.totalInteractions, 0);
  assert.deepEqual(d.topics, []);
});

test('faucet: first claim allowed; amount ≈ base; sets next claim a cooldown out', () => {
  const file = tmpStore();
  const r = faucetClaim({ account: 'bob', now: 1_000_000, lastClaimAt: 0, reservoir: 100, file });
  assert.equal(r.ok, true);
  assert.ok(r.amount >= FAUCET_DEFAULTS.baseDrip);
  assert.equal(r.nextClaimAt, 1_000_000 + DAY);
});

test('faucet: RATE-LIMITED — a second claim within cooldown is refused', () => {
  const file = tmpStore();
  const last = 1_000_000;
  const r = faucetClaim({ account: 'bob', now: last + DAY / 2, lastClaimAt: last, reservoir: 100, file });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'cooldown');
  assert.equal(r.nextClaimAt, last + DAY);
  // after the cooldown elapses, allowed again
  const r2 = faucetClaim({ account: 'bob', now: last + DAY + 1, lastClaimAt: last, reservoir: 100, file });
  assert.equal(r2.ok, true);
});

test('faucet: FINITE — empty reservoir gives nothing (never infinite)', () => {
  const file = tmpStore();
  const r = faucetClaim({ account: 'bob', now: 2_000_000, lastClaimAt: 0, reservoir: 0, file });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'reservoir-empty');
});

test('faucet: BOUNDED — relationship+karma lift the drip but cap at maxMultiplier, then reservoir', () => {
  const file = tmpStore();
  // warm up the relationship so closeness/standing are high
  for (let i = 0; i < 12; i++) recordInteraction('carol', 'warm_exchange', { file });
  for (let i = 0; i < 12; i++) recordInteraction('carol', 'taught', { file });
  const r = faucetClaim({ account: 'carol', now: 3_000_000, lastClaimAt: 0, reservoir: 1000, karma: 100, file });
  assert.equal(r.ok, true);
  // capped at maxMultiplier × base — never unbounded
  assert.ok(r.amount <= FAUCET_DEFAULTS.baseDrip * FAUCET_DEFAULTS.maxMultiplier + 1e-9);
  assert.ok(r.multiplier > 1 && r.multiplier <= FAUCET_DEFAULTS.maxMultiplier);
  // reservoir caps it: tiny reservoir → amount == reservoir
  const tiny = faucetClaim({ account: 'carol', now: 3_000_000, lastClaimAt: 0, reservoir: 0.5, karma: 100, file });
  assert.equal(tiny.amount, 0.5);
});

test('faucet: GATED — a hostile standing below the floor cannot claim', () => {
  const file = tmpStore();
  for (let i = 0; i < 5; i++) recordInteraction('mallory', 'hostile', { file }); // drives standing < -20
  const r = faucetClaim({ account: 'mallory', now: 4_000_000, lastClaimAt: 0, reservoir: 100, file });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'standing-too-low');
});

test('faucet: GATED — a pure taker (negative reciprocity, neutral standing) cannot keep draining the tap', () => {
  const file = tmpStore();
  for (let i = 0; i < 16; i++) recordInteraction('taker', 'ghosted', { file }); // reciprocity↓, standing stays ~0
  const r = faucetClaim({ account: 'taker', now: 5_000_000, lastClaimAt: 0, reservoir: 100, file });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'taker-no-reciprocity');
});

test('recordInteraction moves the map; unknown event is a soft no-op', () => {
  const file = tmpStore();
  const ok = recordInteraction('dave', 'warm_exchange', { file });
  assert.equal(ok.ok, true);
  assert.ok(dispositionFor('dave', { file }).totalInteractions >= 1);
  assert.equal(recordInteraction('dave', 'not_an_event', { file }).reason, 'unknown-event');
});

test('dispositionGreeting maps a stance to a register hint (never a fixed line)', () => {
  assert.equal(dispositionGreeting({ stance: 'welcoming' }).stance, 'welcoming');
  assert.match(dispositionGreeting({ stance: 'guarded' }).register, /measured/);
  assert.equal(dispositionGreeting({}).stance, 'welcoming'); // default
});

test('makeBrainDep exposes dispositionFor/greeting/record for handleMessage injection', () => {
  const file = tmpStore();
  const dep = makeBrainDep({ file });
  assert.equal(typeof dep.dispositionFor, 'function');
  assert.equal(dep.greeting('eve').stance, 'welcoming');
  assert.equal(dep.record('eve', 'greeted').ok, true);
});

test('recordInteraction reports a write that never landed as a failure, not as ok:true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypt-fail-'));
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');
  const file = path.join(blocker, 'nested', 'store.json'); // mkdir under a FILE → ENOTDIR

  const r = recordInteraction('dave', 'warm_exchange', { file });
  assert.equal(r.ok, false, 'a write that did not happen is not a recorded interaction');
  assert.equal(r.reason, 'write-failed');
});

test('recordInteraction refuses a handle that is not a MELEK account name', () => {
  const file = tmpStore();
  const r = recordInteraction('Not An Account', 'warm_exchange', { file });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-account');
  assert.ok(!fs.existsSync(file), 'nothing was written at all');
});

test('every stance dispositionOf can return has its own register — kindred included', () => {
  // 'kindred' was reachable from dispositionOf() but missing from the register map, so the closest
  // person the map can describe fell through to the same neutral hint as a stranger.
  const k = dispositionGreeting({ stance: 'kindred', preferredDepth: 'deep' });
  assert.equal(k.stance, 'kindred');
  assert.equal(k.depth, 'deep');
  assert.notEqual(k.register, dispositionGreeting({ stance: 'nobody-home' }).register);

  // Derived from the source rather than a hand-kept list, so a stance added to dispositionOf() in
  // future cannot quietly arrive without a register of its own.
  const src = fs.readFileSync(new URL('./cryptology.mjs', import.meta.url), 'utf8');
  const stances = [...src.matchAll(/stance = '([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(stances.includes('kindred') && stances.length >= 7, 'found the stances in the source');
  const fallthrough = dispositionGreeting({ stance: 'stance-that-does-not-exist' }).register;
  for (const stance of stances) {
    assert.notEqual(dispositionGreeting({ stance }).register, fallthrough, `${stance} needs its own register`);
  }
});

test('recordInteraction rejects prototype keys as event names', () => {
  const file = tmpStore();
  assert.equal(recordInteraction('dave', 'constructor', { file }).reason, 'unknown-event');
  assert.equal(recordInteraction('dave', 'toString', { file }).reason, 'unknown-event');
});
