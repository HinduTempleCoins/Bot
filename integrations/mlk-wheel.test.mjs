import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mlkWheelSvg, READINGS } from './mlk-wheel.mjs';
import { septuagintChainSvg, CARRIED, TRANSLATED, CIPPUS, LETTER_MAP } from './septuagint-chain.mjs';
import { hebrewGreekAlphabetSvg, LETTERS } from './hebrew-greek-alphabet.mjs';

const isSvg = (s) => /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s) && s.trim().endsWith('</svg>');

test('all three figures render valid standalone SVG', () => {
  for (const [name, fn] of Object.entries({ mlkWheelSvg, septuagintChainSvg, hebrewGreekAlphabetSvg })) {
    const s = fn();
    assert.ok(isSvg(s), `${name} is not valid standalone SVG`);
    assert.ok(s.length > 4000, `${name} looks empty`);
  }
});

test('no figure disclaims the comparison — operator 2026-10-20: show the similarity, not "not the same"', () => {
  for (const [name, fn] of Object.entries({ mlkWheelSvg, septuagintChainSvg, hebrewGreekAlphabetSvg })) {
    const s = fn();
    for (const bad of ['not the same', 'notice, not identity', 'is not accepted', 'nothing here depends']) {
      assert.ok(!s.toLowerCase().includes(bad.toLowerCase()), `${name} still says "${bad}"`);
    }
  }
});

test('the wheel keeps the bare consonants at its centre and the Masoretic note at its foot', () => {
  const s = mlkWheelSvg();
  assert.match(s, /m · l · k/);
  assert.match(s, /three letters, no vowels/);
  assert.match(s, /The Masoretes chose from this field/);
  assert.equal(READINGS.filter((r) => r.kind === 'punic').length, 2, 'Melqart and molk are the unpointed Punic pair');
  // the aleph words are still drawn as their own group, named rather than ruled out
  assert.match(s, /the messenger words/);
});

test('the chain shows the letters carrying, and the aleph dropping out in Greek', () => {
  const s = septuagintChainSvg();
  assert.deepEqual(LETTER_MAP.map((m) => m.gkName), ['mu', 'lambda', 'chi']);
  const malachi = CARRIED.find((r) => r.en === 'Malachi');
  assert.match(malachi.note, /aleph is simply gone/);
  assert.match(s, /Μαλαχίας/);
  assert.match(s, /Μελχισέδεκ/);
  for (const r of [...CARRIED, ...TRANSLATED]) assert.ok(r.note && r.gk && r.he, `${r.en} is incomplete`);
});

test('the chain carries the bilingual stone, which is the hardest artefact in it', () => {
  const s = septuagintChainSvg();
  assert.match(s, /ΗΡΑΚΛΕΙ ΑΡΧΗΓΕΤΕΙ/);
  assert.match(s, /Melqart, Baal of Tyre/);
  assert.ok(CIPPUS.lines.some((l) => /Barthélemy/.test(l) && /18 of the 22/.test(l)));
});

test('the alphabet is all twenty-two, in order, with the numerals and the three retired signs', () => {
  assert.equal(LETTERS.length, 22);
  assert.deepEqual(LETTERS.map((L) => L.n), Array.from({ length: 22 }, (_, i) => i + 1));
  assert.equal(LETTERS[0].heName, 'ʾālep');
  assert.equal(LETTERS[21].heName, 'tāw');
  assert.deepEqual(LETTERS.filter((L) => L.retired).map((L) => L.heName), ['wāw', 'ṣādē', 'qōp']);
  assert.deepEqual(LETTERS.filter((L) => L.root).map((L) => L.heName), ['kap', 'lāmed', 'mēm']);
  // the three whose meaning is not securely known are marked, not asserted
  assert.deepEqual(LETTERS.filter((L) => L.unsure).map((L) => L.heName), ['hē', 'ṭēt', 'ṣādē', 'qōp']);
});

test('the alphabet states the asymmetry that is the whole point, and names its own caveats', () => {
  const s = hebrewGreekAlphabetSvg();
  assert.match(s, /In Greek the same names mean nothing but the letters themselves/);
  assert.match(s, /MEANING ON ONE SIDE ONLY/);
  assert.match(s, /reciting Semitic nouns/);
  assert.match(s, /Herodotus, Histories 5.58/);
  assert.match(s, /Willemijn Waal/);          // the challenge is on the face of the figure
  assert.match(s, /digamma is still 6, koppa 90, sampi 900/);
});

test('every figure escapes the text it is given, attributes included', () => {
  for (const fn of [mlkWheelSvg, septuagintChainSvg, hebrewGreekAlphabetSvg]) {
    const s = fn();
    assert.ok(!s.includes('<script'), 'raw script tag');
    // the font stacks quote their family names, and an unescaped quote there ends the attribute and
    // makes the whole document unparseable — which is exactly what it did before 2026-10-20.
    assert.ok(!/=""\S/.test(s), 'an attribute value was terminated early by a quote');
    assert.ok(!/>[^<]*&(?!amp;|lt;|gt;|quot;|#39;)/.test(s), 'an unescaped ampersand reached the output');
  }
});
