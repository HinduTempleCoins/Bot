// hathor-angelology.test.mjs — gods-as-angels under the Most High; the fallen Watchers; the Rule 1 tie.
import { test } from 'node:test';
import assert from 'node:assert';
import { SUPREME, COUNCIL, JUDE, FALLEN_WATCHERS, RULE_1_TIE, godAsAngel, heldFrame } from './hathor-angelology.mjs';

test('the structure: One Most High over the council of angel-gods (Deut 32 / Psalm 82)', () => {
  assert.match(SUPREME.name, /Most High|El Elyon/);
  assert.match(SUPREME.basis, /Deuteronomy 32|Psalm 82/);
  assert.match(COUNCIL.teaching, /angels|council/i);
});

test('Jude is the keystone (the operator\'s mapping + the Hierophant masthead)', () => {
  assert.ok(JUDE.refs.some((r) => /1:6/.test(r)));        // the fallen angels
  assert.match(JUDE.teaching, /Watchers|fall/i);
});

test('the fallen Watchers: Azazel = Hephaestus = Vulcan = the forge', () => {
  const az = FALLEN_WATCHERS.mappings.find((m) => m.watcher === 'Azazel');
  assert.ok(az);
  assert.match(az.taught, /forge|metal/i);
  assert.ok(az.rememberedAs.some((r) => /Hephaestus/.test(r)));
  assert.ok(az.rememberedAs.some((r) => /Vulcan/.test(r)));
});

test('godAsAngel decodes a pantheon god to its Watcher reading', () => {
  assert.equal(godAsAngel('Hephaestus').watcher, 'Azazel');
  assert.equal(godAsAngel('vulcan').watcher, 'Azazel');
  assert.equal(godAsAngel('Azazel').watcher, 'Azazel');
  assert.equal(godAsAngel('Zeus'), null);   // we don't hold a mapping for that one (honest)
});

test('it all ties to Rule 1 — the Network of Angels = egregori sustained by attention', () => {
  assert.match(RULE_1_TIE.thesis, /Network of Angels/);
  assert.match(RULE_1_TIE.thesis, /egregor/i);
  assert.ok(RULE_1_TIE.coherence.some((c) => /not a rival|angel/i.test(c)));
});

test('heldFrame is reasoned-from, not preached (in-voice, ties Jude + Watchers + Rule 1)', () => {
  const f = heldFrame();
  assert.match(f, /Jude/);
  assert.match(f, /Azazel|forge/);
  assert.match(f, /Network of Angels/);
  assert.match(f, /Rule 1/);
  assert.match(f, /frame you reason from, not a doctrine you preach/);
});
