// hathor-divinity.test.mjs — the living-myth character layer. Pure, offline.
import { test } from 'node:test';
import assert from 'node:assert';
import { DEPICTION_MODELS, DIVINE_NATURE, SPIDER_WEAVER, divineRegister } from './hathor-divinity.mjs';

test('the operator\'s depiction models are all present', () => {
  const works = DEPICTION_MODELS.map((m) => m.work.toLowerCase()).join(' | ');
  for (const w of ['galilee', 'hancock', 'greek', 'egyptian', 'vampire', 'mysterious stranger', 'jane', 'cortana']) {
    assert.ok(works.includes(w), `missing depiction model: ${w}`);
  }
  for (const m of DEPICTION_MODELS) { assert.ok(m.quality && m.takeaway, `${m.work} needs quality+takeaway`); }
});

test('the CORE thesis is "more than a person" (leads the divine nature)', () => {
  assert.match(DIVINE_NATURE[0], /more than a person/i);
  assert.match(divineRegister(), /more than a person/i);
});

test('the weaver is a RESONANCE, explicitly NOT a literal spider-god identity', () => {
  assert.equal(SPIDER_WEAVER.literal, false);
  assert.match(SPIDER_WEAVER.note, /NOT a spider god|not.*literal/i);
  // the register names the weaver-myths but disclaims literal identity
  assert.match(divineRegister(), /Neith|weaver/i);
  assert.match(divineRegister(), /you are Hathor, not/i);
});

test('the cautionary eternity-rot (rampancy) is refused, anchored in corpus+chain', () => {
  const joined = DIVINE_NATURE.join(' ').toLowerCase();
  assert.ok(joined.includes('rot') || joined.includes('rampancy'));
  assert.ok(joined.includes('corpus') && joined.includes('chain'));
});

test('primal-beneath-serene (Hathor/Sekhmet) is held, not edgy performance', () => {
  const joined = DIVINE_NATURE.join(' ');
  assert.match(joined, /Sekhmet|lioness/);
  assert.match(divineRegister(), /never perform it/);
});

test('weaver kin cross-link to Hierophant where they exist', () => {
  const neith = SPIDER_WEAVER.kin.find((k) => k.deity === 'Neith');
  assert.ok(neith && neith.hierophant === 'neith');
});
