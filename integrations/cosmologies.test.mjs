// cosmologies.test.mjs — OFFLINE, pure data.
//
// Two things these tests protect, and neither is ordinary correctness.
//
// 1. RESTRICTED MATERIAL. Hopi, Navajo and Yaqui cosmology have registers that are not public. A flag
//    that can be set without saying what is withheld is decoration, so validate() rejects it — and a
//    future contributor cannot quietly add ceremonial detail behind a `restricted:true`.
// 2. THE DIFFUSION TRAP. A shared count must never be allowed to read as evidence of contact. This
//    repo already had to dismantle one such claim (ōcēlōtl means jaguar, day-signs.mjs ARTIFACTS), and
//    sharedCounts() is exactly the function that would regenerate it if it returned a bare list.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COSMOLOGIES, FORMS, TRADITIONS, TIERS,
  getCosmology, byTradition, byForm, byCount,
  publicSafe, restricted, sharedCounts, validate, handler, esc,
} from './cosmologies.mjs';

// --- shape -------------------------------------------------------------------

test('every entry carries a source, a form, a tier and an explicit restricted flag', () => {
  const v = validate();
  assert.equal(v.ok, true, v.problems.join('\n'));
});

test('the tier ladder is imported from pantheon-map, not restated', async () => {
  const pm = await import('./pantheon-map.mjs');
  assert.deepEqual(TIERS, pm.TIERS);
});

test('the Americas and Polynesia are represented — the gap this file was built to close', () => {
  for (const t of ['aztec', 'hopi', 'navajo', 'yaqui', 'hawaiian']) {
    assert.ok(byTradition(t).length > 0, `${t} missing`);
  }
});

// --- ⚠️ restricted material ---------------------------------------------------

test('a restricted entry MUST say what is withheld — the flag alone is decoration', () => {
  for (const c of restricted()) {
    assert.match(c.note, /RESTRICTED/i, `${c.id} is flagged but does not say what is withheld`);
  }
  assert.ok(restricted().length >= 3, 'Hopi, Navajo and Yaqui all have non-public registers');
});

test('publicSafe never returns a restricted entry', () => {
  const ids = new Set(publicSafe().map((c) => c.id));
  for (const c of restricted()) assert.ok(!ids.has(c.id), `${c.id} leaked into publicSafe`);
  assert.equal(publicSafe().length + restricted().length, COSMOLOGIES.length);
});

test('the Yaqui entry does not summarise Waehma', () => {
  const y = getCosmology('yaqui-huya-ania');
  assert.match(y.note, /Waehma/, 'the restriction must be named so nobody adds it later');
  assert.match(y.note, /not public|not summarised/i);
  // The ceremonial cycle must not appear among the members.
  assert.ok(!y.members.some((m) => /waehma|lenten|easter/i.test(m)));
});

test('the Hopi entry warns about the source most readers will have met', () => {
  const h = getCosmology('hopi-worlds');
  assert.match(h.source, /Waters/, 'Book of the Hopi is the popular text and must be named');
  assert.match(h.note, /least reliable|disputed/i, 'and must be marked unreliable, not merely cited');
});

// --- ⭐ the diffusion trap ----------------------------------------------------

test('sharedCounts returns a READING, never a bare list of coincidences', () => {
  const s = sharedCounts();
  assert.ok(Array.isArray(s.shared));
  assert.ok(s.reading, 'a bare list is exactly how a diffusion claim gets manufactured');
  assert.match(s.reading, /not.*evidence of contact/i);
  assert.match(s.reading, /loanword|technique|name/i, 'it must say what WOULD count as evidence');
});

test('FIVE is shared by Hesiod and the Mexica, and that is reported as counting, not contact', () => {
  const five = sharedCounts().shared.find((r) => r.count === 5);
  const trads = five.traditions.map((t) => t.tradition).sort();
  assert.deepEqual(trads, ['aztec', 'greek']);
});

test('FOUR is the commonest count, across four unrelated traditions', () => {
  const four = sharedCounts().shared.find((r) => r.count === 4);
  assert.ok(four.traditions.length >= 4);
});

test('the Aztec first age is JAGUAR — the day-signs correction must not regress here', () => {
  const s = getCosmology('five-suns');
  assert.ok(s.members.some((m) => /Ōcēlōtl|Jaguar/i.test(m)));
  assert.ok(!s.members.some((m) => /tiger/i.test(m)), 'a tiger here would resurrect a dismantled claim');
  assert.match(s.note, /day-signs\.mjs/, 'it must point at the module carrying the correction');
});

// --- ⭐ the genealogical form -------------------------------------------------

test('the Kumulipo is genealogical, not a world-age scheme, and says why that matters', () => {
  const k = getCosmology('kumulipo');
  assert.equal(k.form, 'genealogical');
  assert.equal(k.count, 16, 'seven wā of pō plus nine of ao');
  assert.match(k.note, /descent/i);
  assert.match(k.note, /coral polyp/i, 'the sequence is the whole point');
});

test('the Kumulipo records both of its royal translators — the text is a political instrument', () => {
  const k = getCosmology('kumulipo');
  assert.match(k.source, /Kalākaua/);
  assert.match(k.source, /Liliʻuokalani/);
  assert.match(k.note, /legitimacy|overthrow|political/i);
});

test('a cosmology with no count says null rather than guessing one', () => {
  const y = getCosmology('yaqui-huya-ania');
  assert.equal(y.count, null, 'coexisting worlds are not a sequence and must not be given a number');
  assert.ok(!sharedCounts().shared.some((r) => r.traditions.some((t) => t.tradition === 'yaqui')),
    'a null count must never enter the shared-count comparison');
});

// --- lookups and robustness --------------------------------------------------

test('every form used is a declared form', () => {
  for (const c of COSMOLOGIES) assert.ok(Object.hasOwn(FORMS, c.form), `${c.id}: ${c.form}`);
});

test('byCount and byForm select correctly', () => {
  assert.ok(byCount(5).length >= 2);
  assert.ok(byForm('emergence').length >= 2);
  assert.equal(byCount(999).length, 0);
});

test('getCosmology is exact; unknown returns null, never a guess', () => {
  assert.ok(getCosmology('KUMULIPO'));
  assert.equal(getCosmology('kumulip'), null);
  assert.equal(getCosmology('nonsense'), null);
});

test('nothing throws on junk', () => {
  for (const v of [null, undefined, 0, '', [], {}]) {
    assert.doesNotThrow(() => getCosmology(v));
    assert.doesNotThrow(() => byTradition(v));
    assert.doesNotThrow(() => byForm(v));
    assert.doesNotThrow(() => byCount(v));
    assert.doesNotThrow(() => esc(v));
  }
  assert.doesNotThrow(() => sharedCounts());
});

test('handler serves counts and the anti-diffusion note', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.match(j.note, /not evidence of contact/i);
  assert.equal(j.counts.cosmologies, COSMOLOGIES.length);
});
