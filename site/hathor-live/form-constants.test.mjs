// form-constants.test.mjs — OFFLINE.
//
// The load-bearing test is the SPLIT: the light produces the geometry, the viewer supplies the figure.
// A version of this page that let the stimulus own the meaning would be the exact move /exams/who-says
// exists to catch — and it is the move the whole flicker-mysticism genre makes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORM_CONSTANTS, CAUSES, LEARY, getConstant, whoseMeaning, formConstantsHTML, handler, esc } from './form-constants.mjs';

test('Klüver\'s four types are all present', () => {
  assert.equal(FORM_CONSTANTS.length, 4);
  for (const id of ['tunnels', 'spirals', 'lattices', 'cobwebs']) assert.ok(getConstant(id), `${id} missing`);
});

test('⭐ the same four are attributed to MANY causes — that is what makes them interesting', () => {
  assert.ok(CAUSES.length >= 5);
  const j = CAUSES.join(' ').toLowerCase();
  assert.match(j, /flicker/);
  assert.match(j, /migraine/);
  assert.match(j, /phosphene/);
});

// --- ⭐ the split ---------------------------------------------------------------

test('geometry is attributed to the stimulus; a figure is attributed to the viewer', () => {
  const r = whoseMeaning('I saw a lattice and then an angel');
  assert.equal(r.geometryReported, true);
  assert.equal(r.figurativeReported, true);
  assert.match(r.stimulusProduces, /geometry/);
  assert.match(r.viewerSupplies, /theirs|recognis/i);
});

test('geometry alone attributes nothing figurative to anyone', () => {
  const r = whoseMeaning('spirals and a honeycomb');
  assert.equal(r.figurativeReported, false);
  assert.match(r.viewerSupplies, /no figurative content/i);
});

test('⭐ the rule never varies, whatever was reported', () => {
  const rule = whoseMeaning('').rule;
  for (const s of ['angels', 'a tunnel', '', 'nothing at all', 'God spoke to me']) {
    assert.equal(whoseMeaning(s).rule, rule, 'the rule must be identical every time — a varying rule is an interpretation');
  }
  assert.match(rule, /light produces the geometry/i);
  assert.match(rule, /person supplies the meaning/i);
  assert.match(rule, /who-says/);
});

test('the module never claims the stimulus produced a figure', () => {
  const all = JSON.stringify({ FORM_CONSTANTS, LEARY }) + formConstantsHTML();
  assert.ok(!/light (produces|creates|shows you) (an? )?(angel|entity|being|spirit)/i.test(all));
});

// --- Leary, both halves --------------------------------------------------------

test('⭐ Leary\'s claim is split into the true half and the overreach, and BOTH are stated', () => {
  assert.match(LEARY.trueHalf, /reliably produces/i);
  assert.match(LEARY.trueHalf, /Dreamachine/);
  assert.match(LEARY.trueHalf, /not a drug claim/i);
  assert.match(LEARY.overreachedHalf, /not produced by the lamp/i);
  assert.match(LEARY.overreachedHalf, /doing the\s+recognising/i);
});

test('⚠️ the safety note names the epilepsy gate and the strapped-viewer refusal', () => {
  assert.match(LEARY.safety, /photosensitive/i);
  assert.match(LEARY.safety, /TEMPLE_EXAMS_SAFETY_GATE|chamber\.mjs/);
  assert.match(LEARY.safety, /strapped/i);
  assert.match(LEARY.safety, /cannot be removed/i);
});

test('the page carries the safety section, not just the phenomenon', () => {
  const h = formConstantsHTML();
  assert.match(h, /Safety/i);
  assert.match(h, /photosensitive/i);
  assert.match(h, /who-says/);
});

test('the tunnel entry defuses the near-death reading rather than leaning on it', () => {
  assert.match(getConstant('tunnels').note, /near-death/i);
  assert.match(getConstant('tunnels').note, /visual system rather than about death/i);
});

test('nothing throws on junk and markup cannot break out', () => {
  for (const v of [null, undefined, 0, '', [], {}]) {
    assert.doesNotThrow(() => whoseMeaning(v));
    assert.doesNotThrow(() => getConstant(v));
    assert.doesNotThrow(() => esc(v));
  }
  assert.ok(!formConstantsHTML().includes('<script>'));
});

test('the module makes no efficacy claim in its own voice', async () => {
  const { claimsCheck } = await import('./the-line.mjs');
  for (const s of [LEARY.trueHalf, LEARY.overreachedHalf, whoseMeaning('').rule, ...FORM_CONSTANTS.map((f) => f.note)]) {
    assert.equal(claimsCheck(s).ok, true, `claim phrase: ${s.slice(0, 60)}`);
  }
});

test('handler serves the constants and the invariant rule', () => {
  let body = ''; handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.equal(j.constants.length, 4);
  assert.match(j.rule, /light produces the geometry/i);
});
