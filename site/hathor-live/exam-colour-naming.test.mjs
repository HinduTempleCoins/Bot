import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SWATCHES, MAX_SWATCHES, BASIC_TERMS,
  maxChroma, buildSwatches, summariseNaming, resultCopy, colourNamingPageHTML,
} from './exam-colour-naming.mjs';
import { rgbToOklch, oklchToRgb, hexToRgb } from './colour-space.mjs';

test('the sampler never clips — chroma is a fraction of what the display can reach', () => {
  for (const seed of ['a', 'b', 'c']) {
    for (const s of buildSwatches({ seed })) {
      assert.equal(s.inGamut, true, `${s.hex} was out of gamut`);
      assert.ok(s.chromaFraction > 0 && s.chromaFraction <= 1);
    }
  }
});

test('maxChroma finds the gamut boundary and is monotone in the right direction', () => {
  const L = 0.6;
  const H = 250;
  const c = maxChroma(L, H);
  assert.ok(c > 0.05, `implausibly small max chroma ${c}`);
  assert.equal(oklchToRgb({ L, C: c * 0.98, H }).inGamut, true);
  assert.equal(oklchToRgb({ L, C: c * 1.15 + 0.02, H }).inGamut, false);
});

test('hue is stratified across the whole circle, not drawn uniformly and left with holes', () => {
  const hues = buildSwatches({ seed: 'hue' }).map((s) => s.oklch.H).sort((a, b) => a - b);
  assert.equal(hues.length, DEFAULT_SWATCHES);
  // Every 45-degree sextant is represented — an unstratified draw of 40 routinely misses one.
  for (let start = 0; start < 360; start += 45) {
    assert.ok(hues.some((h) => h >= start && h < start + 45), `no swatch in ${start}-${start + 45}°`);
  }
});

test('presentation order is shuffled, so one answer does not prime the next', () => {
  const sw = buildSwatches({ seed: 'order' });
  const marching = sw.every((s, i) => i === 0 || s.oklch.H >= sw[i - 1].oklch.H);
  assert.equal(marching, false, 'the swatches are presented as a march around the hue circle');
  assert.deepEqual(sw.map((s) => s.order), sw.map((_, i) => i));
});

test('the block size is bounded and the same seed reproduces it', () => {
  assert.equal(buildSwatches({ seed: 'n', count: 5 }).length, 5);
  assert.equal(buildSwatches({ seed: 'n', count: 9999 }).length, MAX_SWATCHES);
  assert.equal(buildSwatches({ seed: 'n', count: 0 }).length, DEFAULT_SWATCHES);
  assert.deepEqual(
    buildSwatches({ seed: 'same' }).map((s) => s.hex),
    buildSwatches({ seed: 'same' }).map((s) => s.hex),
  );
});

// ── the rule that matters most here ──────────────────────────────────────────────────────────────

test('answers are kept VERBATIM — case and spelling survive into the record', () => {
  const s = summariseNaming([
    { hex: '#3366cc', name: '  Cerulean  ', ms: 900 },
    { hex: '#3366cd', name: 'cerulean', ms: 800 },
    { hex: '#3366ce', name: 'CERULEAN', ms: 700 },
  ]);
  // Folded for the summary, so the three are one term...
  assert.equal(s.distinctTerms, 1);
  assert.equal(s.terms[0].n, 3);
  // ...but every spelling the person actually typed is still there.
  assert.deepEqual(s.terms[0].spellings.sort(), ['CERULEAN', 'Cerulean', 'cerulean']);
  assert.deepEqual(s.rows.map((r) => r.name).sort(), ['CERULEAN', 'Cerulean', 'cerulean']);
});

test('non-basic terms are identified without being corrected', () => {
  const s = summariseNaming([
    { hex: '#ff0000', name: 'red' },
    { hex: '#00ffff', name: 'teal' },
    { hex: '#888888', name: 'gray' },
    { hex: '#888889', name: 'grey' },
    { hex: '#7fff00', name: 'chartreuse' },
  ]);
  assert.deepEqual(s.nonBasicTerms.sort(), ['chartreuse', 'teal']);
  // gray/grey is an orthographic split, not a lexical one — both count as the basic term.
  assert.equal(s.terms.find((t) => t.term === 'gray').basic, true);
  assert.equal(s.terms.find((t) => t.term === 'grey').basic, true);
  assert.equal(s.nonBasicShare, 0.4);
});

test('the mean hue of a term is circular — 350 and 10 average to 0, not to 180', () => {
  const a = oklchToRgb({ L: 0.6, C: 0.1, H: 350 });
  const b = oklchToRgb({ L: 0.6, C: 0.1, H: 10 });
  const hex = (rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  const s = summariseNaming([{ hex: hex(a.rgb), name: 'red' }, { hex: hex(b.rgb), name: 'red' }]);
  const H = s.terms[0].meanOklch.H;
  assert.ok(H > 340 || H < 20, `mean hue came out at ${H}° — a linear mean would give ~180`);
});

test('a blank answer or a malformed colour is skipped, not stored as an empty word', () => {
  const s = summariseNaming([
    { hex: '#ff0000', name: '' },
    { hex: '#ff0000', name: '   ' },
    { hex: 'periwinkle', name: 'blue' },
    { hex: '#00ff00', name: 'green' },
  ]);
  assert.equal(s.answered, 1);
  assert.equal(s.terms[0].term, 'green');
});

test('garbage in does not throw', () => {
  for (const junk of [null, undefined, 'nope', 42, [{}]]) {
    const s = summariseNaming(junk);
    assert.equal(s.answered, 0);
    assert.equal(s.distinctTerms, 0);
  }
});

test('a very long answer is truncated rather than rejected — it is still what they said', () => {
  const long = 'x'.repeat(200);
  const s = summariseNaming([{ hex: '#123456', name: long }]);
  assert.equal(s.answered, 1);
  assert.ok(s.terms[0].term.length <= 60);
});

// ── the wording rule ─────────────────────────────────────────────────────────────────────────────

test('the result says outright that this is not about the reader’s eyes', () => {
  const s = summariseNaming([{ hex: '#ff0000', name: 'red' }, { hex: '#00ffff', name: 'teal' }]);
  const copy = resultCopy(s, { n: 3 });
  const text = [copy.headline, ...copy.lines].join(' ');
  assert.match(text, /SAYS NOTHING ABOUT YOUR EYES/);
  assert.match(text, /cultural and linguistic one, not a retinal one/);
  assert.match(text, /communicative need/);
  assert.ok(!/\bdiagnos/i.test(text));
  assert.ok(!/colour ?blind|color ?blind|deficien/i.test(text));
  assert.equal(copy.neverSay, 'This tells you something about your eyes.');
});

test('an all-basic vocabulary is reported as a real result, not a poorer one', () => {
  const s = summariseNaming(BASIC_TERMS.map((t, i) => ({ hex: `#${(i * 0x111111 + 0x203040).toString(16).slice(0, 6).padStart(6, '0')}`, name: t })));
  const lines = resultCopy(s, { n: 3 }).lines.join(' ');
  assert.match(lines, /a real result and not a smaller one/);
  assert.ok(!/only|just|limited|poor/i.test(lines.split('That is a real result')[0].split('.').pop()));
});

test('a small sample gets no percentile', () => {
  const copy = resultCopy(summariseNaming([{ hex: '#ff0000', name: 'red' }]), { n: 9 });
  assert.ok(copy.lines.some((l) => /too few to place you/.test(l)));
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

test('the page says what it keeps, and what it is not', () => {
  const html = colourNamingPageHTML();
  assert.match(html, /We keep exactly what you\s+type/);
  assert.match(html, /nothing is snapped to a list of approved colour words/);
  assert.match(html, /It is not a vision test and cannot become one/);
  assert.match(html, /never be worded as/);
  assert.match(html, /xkcd/);
});

test('the page records the display gamut as a covariate and never as an identifier', () => {
  const html = colourNamingPageHTML();
  assert.match(html, /color-gamut: p3/);
  assert.match(html, /MEASUREMENT covariate/);
  assert.ok(!/type=email|name="email"|name="name"|password/i.test(html));
});

test('the swatch hexes the sampler emits are real colours', () => {
  for (const s of buildSwatches({ seed: 'z', count: 12 })) {
    assert.match(s.hex, /^#[0-9a-f]{6}$/);
    const back = rgbToOklch(hexToRgb(s.hex));
    assert.ok(Math.abs(back.L - s.oklch.L) < 0.02, `${s.hex} L drifted`);
  }
});
