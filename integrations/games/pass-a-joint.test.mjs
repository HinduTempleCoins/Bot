// pass-a-joint.test.mjs — offline, deterministic. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rollJoint, rollBlunt, gift, openCircle, puff, bogart, pass, tally, canPuff, holderId,
  HITS_PER_GRAM, PUFF_LIMIT, BOGART_PENALTY, GREENOUT_HITS, KINDS,
} from './pass-a-joint.mjs';

test('rollJoint sets hits from grams and clamps potency/aroma', () => {
  const j = rollJoint({ potency: 120, aroma: -5, grams: 2, id: 'x' });
  assert.equal(j.hits, 2 * HITS_PER_GRAM);
  assert.equal(j.hitsTotal, 2 * HITS_PER_GRAM);
  assert.equal(j.potency, 100);
  assert.equal(j.aroma, 0);
  assert.equal(j.roach, false);
});

test('rollJoint always yields at least one hit', () => {
  assert.ok(rollJoint({ grams: 0 }).hits >= 1);
});

test('openCircle validates players and joint', () => {
  assert.throws(() => openCircle({ players: ['solo'], joint: rollJoint({}) }), />= 2 players/);
  assert.throws(() => openCircle({ players: ['a', 'b'] }), /rolled joint/);
  const s = openCircle({ players: ['a', 'b', 'c'], joint: rollJoint({ grams: 1 }) });
  assert.equal(s.holder, 0);
  assert.equal(holderId(s), 'a');
  assert.deepEqual(s.vibes, { a: 0, b: 0, c: 0 });
});

test('a legal puff takes a hit and earns potency-scaled vibes', () => {
  const s0 = openCircle({ players: ['a', 'b'], joint: rollJoint({ potency: 50, aroma: 50, grams: 1 }) });
  const { session: s, event } = puff(s0);
  assert.equal(event, 'puff');
  assert.equal(s.joint.hits, HITS_PER_GRAM - 1);
  assert.equal(s.vibes.a, 5);        // round(50/10), aroma 50 < 60 so no room bonus
  assert.equal(s.consecutive, 1);
  assert.equal(s.hitsTaken.a, 1);
});

test('aroma >= 60 adds a room bonus', () => {
  const s0 = openCircle({ players: ['a', 'b'], joint: rollJoint({ potency: 50, aroma: 66, grams: 1 }) });
  const { session: s } = puff(s0);
  assert.equal(s.vibes.a, 6);        // 5 + 1 room bonus
});

test('puff, puff, PASS — a third puff is refused as must-pass', () => {
  let s = openCircle({ players: ['a', 'b'], joint: rollJoint({ grams: 1 }) });
  s = puff(s).session;
  s = puff(s).session;
  assert.equal(canPuff(s), false);
  const r = puff(s);
  assert.equal(r.event, 'must-pass');
  assert.equal(r.session.joint.hits, s.joint.hits); // no hit taken
  const passed = pass(s).session;
  assert.equal(passed.consecutive, 0);
  assert.equal(holderId(passed), 'b');
});

test('bogart takes the hogged hit but applies the penalty', () => {
  let s = openCircle({ players: ['a', 'b'], joint: rollJoint({ potency: 50, aroma: 50, grams: 1 }) });
  s = puff(s).session;               // vibes a = 5
  s = puff(s).session;               // vibes a = 10, consecutive = 2 (limit)
  const r = bogart(s);               // hog a 3rd
  assert.equal(r.event, 'bogart');
  // gain would be 5, minus BOGART_PENALTY -> 0
  assert.equal(r.session.vibes.a, 10 + (5 - BOGART_PENALTY));
  assert.equal(r.session.joint.hits, s.joint.hits - 1);
});

test('bogart before the limit is just a normal puff', () => {
  const s = openCircle({ players: ['a', 'b'], joint: rollJoint({ grams: 1 }) });
  const r = bogart(s);
  assert.equal(r.event, 'puff');
});

test('greenout — hits beyond the threshold give negative vibes (couch-lock)', () => {
  const s = openCircle({ players: ['a', 'b'], joint: rollJoint({ potency: 60, aroma: 50, grams: 5 }) });
  s.hitsTaken.a = GREENOUT_HITS;     // already couch-locked
  const before = s.vibes.a;
  const r = puff(s);
  assert.ok(r.session.vibes.a < before, 'greenout should reduce vibes');
});

test('smoking to the roach ends the session', () => {
  let s = openCircle({ players: ['a', 'b'], joint: rollJoint({ grams: 1 }) }); // 6 hits
  let guard = 0;
  while (!s.over && guard++ < 100) {
    const r = puff(s);
    s = r.session;
    if (r.event === 'must-pass' || r.event === 'roach') s = pass(s).session;
  }
  assert.equal(s.over, true);
  assert.equal(s.joint.roach, true);
  const t = tally(s);
  assert.equal(t.hitsSmoked, HITS_PER_GRAM);
  assert.equal(t.standings.length, 2);
});

test('tally ranks players by vibes descending', () => {
  let s = openCircle({ players: ['a', 'b'], joint: rollJoint({ potency: 50, grams: 1 }) });
  s = puff(s).session;   // a +5
  s = puff(s).session;   // a +5  (a=10)
  s = pass(s).session;
  s = puff(s).session;   // b +5
  const t = tally(s);
  assert.equal(t.standings[0].player, 'a');
  assert.ok(t.standings[0].vibes >= t.standings[1].vibes);
});

test('a blunt holds more hits than a joint of the same grams', () => {
  const j = rollJoint({ grams: 1 });
  const b = rollBlunt({ grams: 1 });
  assert.equal(j.kind, 'joint');
  assert.equal(b.kind, 'blunt');
  assert.ok(b.hits > j.hits);
  assert.equal(b.hits, Math.round(1 * HITS_PER_GRAM * KINDS.blunt.hitsMult));
});

test('gift transfers a live joint/blunt between players (the social-gifting loop)', () => {
  const j = rollJoint({ potency: 60, grams: 1 });
  const g = gift(j, 'ravi', 'maya');
  assert.equal(g.ok, true);
  assert.equal(g.from, 'ravi');
  assert.equal(g.to, 'maya');
  assert.equal(g.joint.hits, j.hits);
});

test('gift rejects self-gifts, missing args, and spent roaches', () => {
  const j = rollJoint({ grams: 1 });
  assert.throws(() => gift(j, 'a', 'a'), /yourself/);
  assert.throws(() => gift(j, 'a'), /from and a to/);
  assert.throws(() => gift(null, 'a', 'b'), /rolled joint/);
  const spent = { ...j, hits: 0, roach: true };
  assert.deepEqual(gift(spent, 'a', 'b'), { ok: false, reason: 'spent-roach' });
});

test('functions are pure — the input session is not mutated', () => {
  const s = openCircle({ players: ['a', 'b'], joint: rollJoint({ grams: 1 }) });
  const snapshot = JSON.stringify(s);
  puff(s); pass(s); bogart(s);
  assert.equal(JSON.stringify(s), snapshot);
});
