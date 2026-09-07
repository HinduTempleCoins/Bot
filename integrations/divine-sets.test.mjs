import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETS, NUMBERS, getSet, byNumber, byTradition,
  stability, unstable, countBeatsRoster, grewInCount, NUMBER_NOTES, ZODIAC,
} from './divine-sets.mjs';

test('every set declares a count that matches its roster, a tradition and a source', () => {
  for (const s of SETS) {
    assert.ok(s.id && s.label && s.tradition, `${s.id} malformed`);
    assert.ok(Number.isInteger(s.n) && s.n > 0, `${s.id} bad count`);
    assert.ok(s.source && s.source.length > 10, `${s.id} needs a source`);
    assert.ok(Array.isArray(s.members) && s.members.length, `${s.id} needs members`);
    if (s.id !== 'gnostic-ogdoad') {
      assert.equal(s.members.length, s.n, `${s.id} roster does not match its own count`);
    }
  }
});

test('the numbers present are the ones the corpus argues about', () => {
  assert.deepEqual(NUMBERS, [7, 8, 9, 12]);
  for (const n of NUMBERS) assert.ok(byNumber(n).length >= 3, `only ${byNumber(n).length} sets of ${n}`);
});

test('THE CLAIM, COMPUTED: the count holds and the roster does not', () => {
  const r = countBeatsRoster();
  assert.equal(r.countAlwaysHeld, true);
  assert.equal(r.rosterChangedIn, r.setsWithVariants);
  assert.ok(r.setsWithVariants >= 8);
  assert.match(r.conclusion, /the number holds and the membership does not/);
});

test('count-growth is kept SEPARATE from roster churn — conflating them would be cheating', () => {
  const grew = grewInCount();
  assert.equal(grew.length, 2);
  const byId = Object.fromEntries(grew.map((g) => [g.id, g]));
  assert.deepEqual([byId['nine-muses'].from, byId['nine-muses'].to], [3, 9]);
  assert.deepEqual([byId.adityas.from, byId.adityas.to], [6, 12]);
  // and neither may be counted as a roster variant
  assert.deepEqual(getSet('nine-muses').variants, []);
  assert.deepEqual(getSet('adityas').variants, []);
});

test('the twelve tribes are the demonstration case: three lists, three rosters, one count', () => {
  const t = stability('twelve-tribes');
  assert.equal(t.n, 12);
  assert.equal(t.versions, 3);
  assert.equal(t.countHeld, true, 'every list has exactly twelve');
  assert.ok(t.score < 1);
  for (const name of ['Levi', 'Dan', 'Joseph', 'Ephraim', 'Manasseh']) {
    assert.ok(t.rotating.includes(name), `${name} should be a rotating seat`);
  }
  assert.match(getSet('twelve-tribes').source, /Revelation 7/);
});

test('the twelfth Olympian seat rotates between Hestia and Dionysus, and Hades is simply out', () => {
  const o = stability('twelve-olympians');
  assert.deepEqual(o.rotating.sort(), ['Dionysus', 'Hestia']);
  assert.equal(o.core.length, 11);
  assert.equal(o.countHeld, true);
  assert.ok(!getSet('twelve-olympians').members.includes('Hades'));
  assert.match(getSet('twelve-olympians').note, /Hades/);
});

test('the Saptarishi are the least stable set: seven fixed stars, negotiable sages', () => {
  const s = stability('saptarishi');
  assert.equal(s.countHeld, true);
  assert.ok(s.score < 0.5, `expected heavy churn, got ${s.score}`);
  assert.deepEqual(s.core.sort(), ['Atri', 'Vasishtha']);
  assert.match(getSet('saptarishi').note, /Ursa Major/);
  assert.equal(getSet('saptarishi').derivation, 'observed');
});

test('unstable() sorts least-stable first and every entry holds its count', () => {
  const u = unstable();
  assert.ok(u.length >= 8);
  for (let i = 1; i < u.length; i += 1) assert.ok(u[i].score >= u[i - 1].score, 'not sorted');
  for (const s of u) assert.equal(s.countHeld, true, `${s.id} broke its count`);
  assert.equal(u[0].id, 'saptarishi');
});

test('the Ogdoad is four pairs, and the unstable pair is the one Amun displaced', () => {
  const o = getSet('hermopolitan-ogdoad');
  assert.equal(o.n, 8);
  assert.match(o.note, /FOUR PAIRS/);
  const s = stability('hermopolitan-ogdoad');
  assert.ok(s.rotating.includes('Amun'));
  assert.ok(s.rotating.includes('Tenem') || s.rotating.includes('Nia'));
  assert.equal(s.core.length, 6, 'the first three pairs are stable');
});

test('the Ennead number comes out of Egyptian grammar, not the sky', () => {
  const e = getSet('heliopolitan-ennead');
  assert.equal(e.n, 9);
  assert.equal(e.derivation, 'linguistic');
  assert.match(e.note, /plural of plurals/);
  assert.match(e.note, /three strokes/);
});

test('the Navagraha and the Gnostic Ogdoad are both derived FROM the seven', () => {
  assert.equal(getSet('navagraha').derivation, 'derived');
  assert.match(getSet('navagraha').note, /Seven plus two/);
  assert.match(getSet('navagraha').note, /nodes/);
  assert.equal(getSet('gnostic-ogdoad').derivation, 'derived');
  assert.match(getSet('gnostic-ogdoad').note, /seven plus one/);
});

test('the Bagua is the control that kills any argument from a shared eight', () => {
  const b = getSet('bagua');
  assert.equal(b.n, 8);
  assert.match(b.note, /CONTROL/);
  assert.match(b.note, /2\^3/);
  assert.match(NUMBER_NOTES[8].licence, /control/i);
});

test('the nine Norse worlds are flagged as a number without a surviving roster', () => {
  const n = getSet('norse-nine-worlds');
  assert.match(n.note, /HONEST CAVEAT/);
  assert.match(n.note, /no surviving source ever lists all nine/);
  assert.match(n.source, /Völuspá|Vafthrudnismal/);
});

test('NUMBER_NOTES states what each number licenses, and refuses the sevens', () => {
  for (const n of NUMBERS) {
    assert.ok(NUMBER_NOTES[n], `no note for ${n}`);
    assert.ok(NUMBER_NOTES[n].origin && NUMBER_NOTES[n].why && NUMBER_NOTES[n].licence);
  }
  assert.match(NUMBER_NOTES[7].licence, /proves NOTHING/);
  assert.match(NUMBER_NOTES[12].licence, /Argue from the names, never from the number/);
});

test('the zodiac argument is the NAMES, not the twelve', () => {
  for (const k of ['babylonian', 'greek', 'sanskrit']) assert.equal(ZODIAC[k].length, 12, `${k} not twelve`);
  assert.match(ZODIAC.verdict, /TRANSLATIONS/);
  assert.match(ZODIAC.why, /GOAT-FISH/);
  // the goat-fish is the tell: it survives all three lists as a composite creature
  assert.ok(ZODIAC.babylonian.includes('Goat-Fish'));
  assert.ok(ZODIAC.greek.includes('Aigokeros'));
  assert.ok(ZODIAC.sanskrit.includes('Makara'));
});

test('stability() and getSet() are soft on unknown ids', () => {
  assert.equal(stability('nope'), null);
  assert.equal(getSet('nope'), null);
  assert.deepEqual(byNumber(99), []);
  assert.ok(byTradition('egyptian').length >= 3);
});
