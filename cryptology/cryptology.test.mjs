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

// ── planes — the expanded graph ───────────────────────────────────────────────────────────────────
import {
  PLANES, EXAM_DIMENSIONS, ALL_DIMENSIONS, SEANCE_PLANE, planeOf, position,
} from './cryptology.mjs';

test('four planes, four different clocks — that is the whole reason they are separate', () => {
  assert.deepEqual(Object.keys(PLANES), ['relation', 'constitution', 'state', 'practice']);
  const clocks = Object.values(PLANES).map((p) => p.clock);
  assert.equal(new Set(clocks).size, 4, 'if two planes shared a clock they would not need separating');
});

test('a tired night must not read as a change in constitution', () => {
  assert.equal(planeOf('rest'), 'state');
  assert.equal(planeOf('imagery'), 'constitution');
  assert.notEqual(planeOf('rest'), planeOf('imagery'));
});

test('the state plane IS the original LSD map — valence and arousal by another name', () => {
  const s = PLANES.state.dims;
  assert.ok(s.includes('valence') && s.includes('arousal'));
  assert.match(PLANES.state.desc, /Upper\/Downer|Static\/Dynamic/);
});

test('POSITIONS, NOT LEVELS — the STRUCTURE cannot express a level, whatever the prose says', () => {
  // Testing the prose was the weak version: "Nothing unlocks" contains the word "unlock". Test the
  // shape instead — there is no field on any dimension that could carry a tier, a gate or a
  // prerequisite, so a level cannot be represented even by a caller who wanted one.
  const forbidden = ['tier', 'level', 'unlocks', 'requires', 'grade', 'rank', 'threshold'];
  for (const [name, spec] of Object.entries(ALL_DIMENSIONS)) {
    for (const f of forbidden) {
      assert.ok(!(f in spec), `${name} must not carry a "${f}" field`);
    }
  }
  for (const [name, spec] of Object.entries(PLANES)) {
    for (const f of forbidden) assert.ok(!(f in spec), `plane ${name} must not carry a "${f}" field`);
  }
  assert.match(PLANES.practice.desc, /NOT because it is a ladder/);
});

test('practice accumulates but is explicitly a record rather than a ladder', () => {
  assert.equal(EXAM_DIMENSIONS.lucidity.min, 0);
  assert.match(EXAM_DIMENSIONS.lucidity.desc, /count, not a rank/i);
});

test('constitution values are NOT percentile-ranked against other people', () => {
  for (const d of PLANES.constitution.dims) {
    assert.ok(EXAM_DIMENSIONS[d], `${d} is defined`);
    assert.equal(EXAM_DIMENSIONS[d].plane, 'constitution');
  }
  assert.match(PLANES.constitution.desc, /Never a score/);
});

test('the state card records subjective effect, never dose', () => {
  assert.match(EXAM_DIMENSIONS.affected.desc, /NEVER dose, amount or route/);
});

test('the séance plane is declared, empty, and says what blocks it', () => {
  assert.equal(SEANCE_PLANE.dims.length, 0);
  assert.match(SEANCE_PLANE.blockedOn, /lineage.*own dead|own dead.*lineage/i);
  assert.match(SEANCE_PLANE.settled, /not depth-as-progression/);
});

test('position() reads a REAL freshProfile — the shape the module actually produces', () => {
  // This is the test that was missing. The original constructed { dimensions: {...} } by hand, which
  // is the shape position() wanted rather than the shape freshProfile() emits, so a genuine defect
  // passed: coordinates live on the top level and position() was reading a nested key that is never
  // written. A caller adopting position() as the read API got zeroes for a real person.
  const real = c.freshProfile('someone');
  real.trust = 80;
  real.valence = 40;
  assert.equal(c.position(real, 'relation').coordinates.trust, 80, 'a real profile must not read as zero');
  assert.equal(c.position(real, 'state').coordinates.valence, 40);
  assert.equal(c.position(real, 'state').coordinates.arousal, 0, 'unset dims still fall back to default');
});

test('position() returns coordinates with defaults, and null for a plane that does not exist', () => {
  const p = { dimensions: { valence: 40 } };
  const s = position(p, 'state');
  assert.equal(s.coordinates.valence, 40);
  assert.equal(s.coordinates.arousal, 0, 'unset dims fall back to their default');
  assert.equal(s.clock, 'hours');
  assert.equal(position(p, 'nope'), null);
  assert.equal(position(null, 'state'), null);
});

test('every plane dimension resolves in ALL_DIMENSIONS, and relation dims still work', () => {
  for (const spec of Object.values(PLANES)) {
    for (const d of spec.dims) assert.ok(ALL_DIMENSIONS[d], `${d} missing from ALL_DIMENSIONS`);
  }
  assert.equal(planeOf('trust'), 'relation');
  assert.equal(planeOf('not-a-dimension'), null);
});
