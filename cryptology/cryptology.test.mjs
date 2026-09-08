// Offline test for cryptology.mjs — the per-person relationship map (BRIEF.md §6a).
// No network, no real clock (injected), no disk except a tmp store. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

test('an unknown event RECORDS NOTHING — a caller typo is not a fact about a person', () => {
  // The two modules used to disagree here: cryptology.mjs documented "soft no-op" but created and
  // persisted the profile and incremented totalInteractions, while hathor-disposition.mjs wrote
  // nothing and returned {ok:false}. hathor-disposition.mjs was right — see observe() for why.
  const file = path.join(freshDir(), 'store.json');
  const p = c.observe('stranger', 'this_event_does_not_exist', { file });
  assert.equal(p.trust, 0);
  assert.equal(p.warmth, 0);
  assert.equal(p.totalInteractions, 0, 'a typo must not invent an interaction');
  assert.equal(c.writeResult(p).reason, 'unknown-event');
  assert.deepEqual(c.loadStore(file), {}, 'and it must not bring a permanent record into existence');
  assert.doesNotThrow(() => c.observe('stranger', undefined, { file }), 'soft means never throwing');
});

test('an unknown event does not disturb a person already on the map', () => {
  const file = path.join(freshDir(), 'store.json');
  c.observe('known-one', 'taught', { file });
  const p = c.observe('known-one', 'not_an_event', { file });
  assert.equal(p.respect, 8, 'their real history comes back');
  assert.equal(p.totalInteractions, 1, 'unchanged');
  const onDisk = c.loadStore(file)['known-one'];
  assert.equal(onDisk.totalInteractions, 1);
  assert.equal(onDisk.lastSeen, CLOCK);
});

test("'constructor' and 'toString' are not events — EVENTS is a plain object", () => {
  const file = path.join(freshDir(), 'store.json');
  assert.equal(c.isKnownEvent('constructor'), false);
  assert.equal(c.isKnownEvent('toString'), false);
  assert.equal(c.isKnownEvent('warm_exchange'), true);
  assert.equal(c.writeResult(c.observe('someone-else', 'constructor', { file })).reason, 'unknown-event');
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

// ── store integrity ───────────────────────────────────────────────────────────────────────────────
// Three defects the map could not survive: a preview that met a stranger, a write that could truncate
// the whole map, and a failed write reported as a success.

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cryptology-store-'));

test('observe({persist:false}) previews against the REAL history — a preview must not meet a stranger', () => {
  const file = path.join(freshDir(), 'store.json');
  c.observe('regular', 'warm_exchange', { file });
  c.observe('regular', 'warm_exchange', { file });

  const preview = c.observe('regular', 'warm_exchange', { file, persist: false });
  assert.equal(preview.warmth, 24, 'a preview must build on the two exchanges already on record (8+8+8)');
  assert.equal(preview.totalInteractions, 3);
  assert.equal(c.writeResult(preview).ok, false, 'and it must not claim to have been written');

  // persist:false means "do not WRITE" — the stored map is untouched by the preview.
  const onDisk = c.loadStore(file);
  assert.equal(onDisk.regular.warmth, 16);
  assert.equal(onDisk.regular.totalInteractions, 2);
});

test('a preview does not mutate the loaded map in place either', () => {
  const file = path.join(freshDir(), 'store.json');
  c.observe('subject', 'warm_exchange', { file });
  const preview = c.observe('subject', 'hostile', { file, persist: false });
  assert.ok(preview.trust < 0);
  assert.equal(c.recall('subject', c.loadStore(file)).trust, 3, 'the persisted profile is unchanged');
});

test('saveStore replaces the map by rename — it never opens the destination for truncation', () => {
  const dir = freshDir();
  const file = path.join(dir, 'store.json');
  fs.writeFileSync(file, JSON.stringify({ alice: c.freshProfile('alice') }, null, 2) + '\n');
  fs.chmodSync(file, 0o444); // a destination that CANNOT be written into, only replaced

  assert.equal(c.saveStore({ bob: c.freshProfile('bob') }, file), true);
  assert.deepEqual(Object.keys(c.loadStore(file)), ['bob']);
  assert.ok(!fs.existsSync(`${file}.tmp`), 'no .tmp litter left behind after a successful write');
});

test('a failed write leaves the previous map completely intact (never a truncated one)', () => {
  const dir = freshDir();
  const file = path.join(dir, 'store.json');
  c.observe('kept', 'taught', { file });
  const before = fs.readFileSync(file, 'utf8');

  const circular = { self: null }; circular.self = circular;   // JSON.stringify throws
  assert.equal(c.saveStore(circular, file), false);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the old map is byte-for-byte still there');
  assert.ok(!fs.existsSync(`${file}.tmp`), 'and the temp file is cleaned up');
});

test('a store that exists but does not parse is kept aside, not silently discarded', () => {
  const dir = freshDir();
  const file = path.join(dir, 'store.json');
  // exactly what a crash mid-write used to leave behind: valid JSON prefix, truncated
  fs.writeFileSync(file, '{\n  "alice": {\n    "account": "alice",\n    "warmth": 4');

  assert.deepEqual(c.loadStore(file), {}, 'unparseable → soft-fail to empty, never throw');
  const aside = fs.readdirSync(dir).find((f) => f.startsWith('store.json.corrupt-'));
  assert.ok(aside, 'the unreadable map is copied aside so the relationships are recoverable');
  assert.match(fs.readFileSync(path.join(dir, aside), 'utf8'), /alice/);
});

test('a write that never landed is reported as a failure, not as a success', () => {
  const dir = freshDir();
  const blocker = path.join(dir, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');
  const file = path.join(blocker, 'nested', 'store.json'); // mkdir under a FILE → ENOTDIR

  const p = c.observe('nobody-home', 'greeted', { file });
  assert.equal(p.totalInteractions, 1, 'the in-memory profile is still returned (soft-fail)');
  assert.equal(c.writeResult(p).ok, false, 'but it is NOT reported as persisted');
  assert.equal(c.writeResult(p).reason, 'write-failed');
  assert.equal(c.writeResult(c.remember(c.freshProfile('ghost'), file)).ok, false);
});

test('the persistence flag never leaks into the stored map', () => {
  const file = path.join(freshDir(), 'store.json');
  c.observe('clean', 'greeted', { file });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('_persisted'), '_persisted is non-enumerable — it must not be serialized');
  assert.ok(!raw.includes('_reason'));
});

// ── identity ──────────────────────────────────────────────────────────────────────────────────────
// A record is held under a real MELEK identity or it is not held at all.

test('observe refuses a handle that is not a MELEK account name', () => {
  const file = path.join(freshDir(), 'store.json');
  for (const junk of ['', '  ', 'bob smith', 'Not An Account', 'ab', 'a--b', '-leading', 'x'.repeat(20)]) {
    const p = c.observe(junk, 'warm_exchange', { file });
    assert.equal(c.writeResult(p).reason, 'invalid-account', `"${junk}" must not become a profile`);
  }
  assert.deepEqual(c.loadStore(file), {}, 'nothing was written for any of them');

  // and a real one still works, @ and case included
  assert.equal(c.writeResult(c.observe('@Hathor', 'warm_exchange', { file })).ok, true);
  assert.deepEqual(Object.keys(c.loadStore(file)), ['hathor']);
});

test('__proto__ cannot be an account — the entry would vanish into the prototype setter', () => {
  const file = path.join(freshDir(), 'store.json');
  const p = c.observe('__proto__', 'warm_exchange', { file });
  assert.equal(c.writeResult(p).reason, 'invalid-account');
  assert.deepEqual(c.loadStore(file), {});
  assert.equal({}.polluted, undefined, 'Object.prototype is untouched');
  assert.equal(c.writeResult(c.remember({ account: '__proto__', warmth: 99 }, file)).ok, false);
});

test("'constructor' is a legal account name and must not read back as Object's constructor", () => {
  // store['constructor'] on a plain object is truthy for someone who has never been seen, so recall()
  // handed the caller a FUNCTION as that person's profile.
  const p = c.recall('constructor', {});
  assert.equal(typeof p, 'object');
  assert.equal(p.account, 'constructor');
  assert.equal(p.totalInteractions, 0);
  const file = path.join(freshDir(), 'store.json');
  assert.equal(c.observe('constructor', 'greeted', { file }).familiarity, 1, 'and it is an ordinary person');
});

test('isValidAccount is the canonical Graphene rule, applied to the normalized key', () => {
  assert.equal(c.isValidAccount('@Hathor'), true);
  assert.equal(c.isValidAccount('foo.cool'), true);
  assert.equal(c.isValidAccount('a.b'), false);
  assert.equal(c.isValidAccount(undefined), false);
});

// ── forget ────────────────────────────────────────────────────────────────────────────────────────

test('forget deletes the record, unconditionally, leaving nothing behind', () => {
  const file = path.join(freshDir(), 'store.json');
  c.observe('subject-one', 'taught', { file });
  c.observe('subject-two', 'warm_exchange', { file });

  const r = c.forget('@Subject-One', file);   // @ and case normalize, same as every other verb
  assert.deepEqual(r, { ok: true, existed: true, reason: null });

  const store = c.loadStore(file);
  assert.deepEqual(Object.keys(store), ['subject-two'], 'only that person is gone');
  assert.equal(JSON.stringify(store).includes('subject-one'), false, 'no tombstone, no archive copy');

  // and they come back a stranger
  assert.equal(c.recall('subject-one', store).totalInteractions, 0);
  assert.equal(c.dispositionOf(c.recall('subject-one', store)).stance, 'welcoming');
});

test('forgetting someone the map never held is not an error', () => {
  const file = path.join(freshDir(), 'store.json');
  assert.deepEqual(c.forget('never-here', file), { ok: true, existed: false, reason: null });
});

test('a record whose key predates validation is still deletable — nothing may refuse a delete', () => {
  const file = path.join(freshDir(), 'store.json');
  fs.writeFileSync(file, JSON.stringify({ 'bob smith': { account: 'bob smith', warmth: 40 } }, null, 2));
  assert.equal(c.isValidAccount('bob smith'), false, 'observe() would refuse to create this today');
  assert.deepEqual(c.forget('bob smith', file), { ok: true, existed: true, reason: null });
  assert.deepEqual(c.loadStore(file), {});
});

test('forget reports a delete that did not reach disk', () => {
  const dir = freshDir();
  const file = path.join(dir, 'store.json');
  c.observe('doomed-one', 'greeted', { file });
  fs.chmodSync(dir, 0o555); // the rename cannot land: no write permission on the directory
  const r = c.forget('doomed-one', file);
  fs.chmodSync(dir, 0o755);
  assert.equal(r.existed, true);
  assert.equal(r.ok, false, 'a delete that did not persist is not a delete');
  assert.equal(r.reason, 'write-failed');
  assert.ok(c.loadStore(file)['doomed-one'], 'and the record is still there, honestly reported');
});

// ── lineage ───────────────────────────────────────────────────────────────────────────────────────

test('every file the header cites as ANCESTRY exists and actually parses', () => {
  // The header named `relationship-tracker.js` as a port source for months. That file has never
  // parsed (node --check stops at `increaseT trust(...)`), is CommonJS in a "type":"module" package,
  // and has never been imported — so the module's own account of where it came from was wrong, and
  // nothing checked. A citation that cannot be executed is not a citation.
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const src = fs.readFileSync(new URL('./cryptology.mjs', import.meta.url), 'utf8');
  const cited = [...src.matchAll(/^\/\/ ANCESTRY:\s+(\S+)/gm)].map((m) => m[1]);
  assert.ok(cited.includes('index.js'), 'index.js is the code that actually ran');
  for (const rel of cited) {
    const abs = path.join(repo, rel);
    assert.ok(fs.existsSync(abs), `${rel} is cited as ancestry but does not exist`);
    execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' }); // throws if it does not parse
  }
});

test('the corrupted draft is not sitting in the repo root pretending to be code', () => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  assert.equal(fs.existsSync(path.join(repo, 'relationship-tracker.js')), false);
  const draft = path.join(repo, 'archive', 'relationship-tracker.js.corrupt-draft');
  assert.ok(fs.existsSync(draft), 'kept for lineage, out of the way, with a non-code extension');
  assert.match(fs.readFileSync(draft, 'utf8').slice(0, 600), /CORRUPTED DRAFT — THIS FILE HAS NEVER RUN/);
});

// ── the practice plane, which now has a writer ────────────────────────────────────────────────────

test('recordPractice accumulates tallies and shows up on the practice plane', () => {
  const file = path.join(freshDir(), 'store.json');
  c.recordPractice('practitioner', { sessions: 1, crossings: 1 }, { file });
  const p = c.recordPractice('practitioner', { sessions: 1, lucidity: 2, recall: 62 }, { file });

  const coords = c.position(p, 'practice').coordinates;
  assert.equal(coords.sessions, 2, 'a tally accumulates');
  assert.equal(coords.crossings, 1);
  assert.equal(coords.lucidity, 2);
  assert.equal(coords.recall, 62, 'recall is a frequency — SET, not accumulated');

  c.recordPractice('practitioner', { recall: 40 }, { file });
  assert.equal(c.loadStore(file).practitioner.recall, 40, 'a rate that accumulated would be meaningless');
  assert.equal(c.loadStore(file).practitioner.sessions, 2, 'and it hit disk');
});

test('practice is a record, not a ladder — it moves nothing else', () => {
  const file = path.join(freshDir(), 'store.json');
  c.observe('busy-one', 'warm_exchange', { file });
  const before = c.dispositionOf(c.recall('busy-one', c.loadStore(file)));
  const p = c.recordPractice('busy-one', { sessions: 500, crossings: 400, lucidity: 300 }, { file });
  const after = c.dispositionOf(p);

  assert.deepEqual(after.coordinates, before.coordinates, 'five hundred sessions buy no closeness');
  assert.equal(after.stance, before.stance);
  assert.equal(p.totalInteractions, 1, 'a session is not a conversation');
  for (const f of ['tier', 'level', 'unlocks', 'requires', 'grade', 'rank']) {
    assert.ok(!(f in p), `a profile must not grow a "${f}" field`);
  }
});

test('only practice dimensions are writable through that door', () => {
  const file = path.join(freshDir(), 'store.json');
  const p = c.recordPractice('careful-one', { trust: 90, imagery: 90, rest: 90, sessions: 1, nonsense: 5 }, { file });
  assert.equal(p.trust, 0, 'a relation dimension cannot be moved by naming it here');
  assert.equal(p.imagery, undefined, 'nor a constitution trait');
  assert.equal(p.rest, undefined, 'nor a state axis');
  assert.equal(p.nonsense, undefined);
  assert.equal(p.sessions, 1);
});

test('recordPractice refuses a handle that is not a MELEK account, and previews without writing', () => {
  const file = path.join(freshDir(), 'store.json');
  assert.equal(c.writeResult(c.recordPractice('bob smith', { sessions: 1 }, { file })).reason, 'invalid-account');
  c.recordPractice('preview-one', { sessions: 3 }, { file });
  const preview = c.recordPractice('preview-one', { sessions: 1 }, { file, persist: false });
  assert.equal(preview.sessions, 4, 'a preview still reads the real record');
  assert.equal(c.loadStore(file)['preview-one'].sessions, 3, 'and does not write');
});

test('the header describes the module that exists — no swallowed writes', () => {
  // The module and its own documentation disagreeing is the same class of defect as the two halves
  // of Crypt-ology disagreeing about unknown events. Cheap to assert, so assert it.
  const src = fs.readFileSync(new URL('./cryptology.mjs', import.meta.url), 'utf8');
  const header = src.slice(0, src.indexOf("import fs from 'node:fs';"));
  assert.ok(/writeResult\(\)/.test(header), 'the header names how a write outcome is read');
  assert.ok(/forget\(account\)/.test(header), 'and that a record is deletable');
  assert.ok(!/a bad write is swallowed/.test(header), 'a write failure is reported, not swallowed');
});
