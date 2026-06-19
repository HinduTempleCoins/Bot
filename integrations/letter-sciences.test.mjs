// letter-sciences.test.mjs — Zairja + Pythagorean + multi-alphabet gematria. Pure, offline.
import { test } from 'node:test';
import assert from 'node:assert';
import { KNOWLEDGE, ZAIRJA, SYSTEMS, zairjaDraw, letterValue } from './letter-sciences.mjs';
import { gematria } from '../knowledge/gematria.mjs';

test('Arabic abjad gematria computes (محمد=92, الله=66)', () => {
  assert.equal(gematria('محمد', { system: 'arabic' }), 92);   // 40+8+40+4
  assert.equal(gematria('الله', { system: 'abjad' }), 66);    // 1+30+30+5
});

test('letterValue gives value + Pythagorean reduction across systems', () => {
  const v = letterValue('אלהים');                    // Elohim
  assert.equal(v.hebrew.value, 86);
  assert.ok(v.hebrew.pythagorean >= 1 && v.hebrew.pythagorean <= 9);
});

test('the knowledge covers gematria, zairja and pythagorean (corpus text)', () => {
  assert.match(KNOWLEDGE.gematria, /letter a number|abjad|isopsephy/i);
  assert.match(KNOWLEDGE.zairja, /Ibn Khaldun|combination|thinking machine|proto-algorithm/i);
  assert.match(KNOWLEDGE.pythagorean, /tetractys|decad|all is number/i);
});

test('the Zairja is framed as the proto-AI / Llull kin', () => {
  assert.match(ZAIRJA.origin, /Ibn Khaldun/);
  assert.ok(ZAIRJA.kinship.some((k) => /Llull|algorithm|AI/i.test(k)));
});

test('zairjaDraw recombines a seed deterministically, never throws', () => {
  const a = zairjaDraw('محمد');
  const b = zairjaDraw('محمد');
  assert.equal(a.drawn, b.drawn);          // deterministic
  assert.ok(a.drawn.length > 0);
  assert.match(a.note, /not a divination/i); // honest framing
  assert.doesNotThrow(() => zairjaDraw(''));
});

test('SYSTEMS lists the three alphabets', () => {
  assert.ok(SYSTEMS.includes('hebrew') && SYSTEMS.includes('greek') && SYSTEMS.includes('arabic-abjad'));
});
