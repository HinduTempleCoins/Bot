// ad-maker.test.mjs — OFFLINE, pure (buildAdSvg needs no sharp/network). Soft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdSvg, STYLES, STYLE_IDS, esc } from './ad-maker.mjs';

test('every style builds a valid SVG carrying the tagline + wordmark', () => {
  for (const id of STYLE_IDS) {
    const svg = buildAdSvg(id, {});
    assert.match(svg, /^<svg[^>]*width="1200"[^>]*height="630"/, `${id} is a 1200x630 svg`);
    assert.match(svg, /<\/svg>\s*$/, `${id} is closed`);
    assert.ok(svg.includes('Your Voice is') && svg.includes('Worth Something'), `${id} has the tagline`);
    assert.match(svg, /M\s*E\s*L\s*E\s*K/, `${id} has the wordmark (spaced or plain)`);
  }
});

test('custom lines + wordmark are honored and escaped', () => {
  const svg = buildAdSvg('kurdish', { line1: 'Speak & <Earn>', line2: 'Right Now', wordmark: 'MELEK.salon' });
  assert.ok(svg.includes('Speak &amp; &lt;Earn&gt;'));      // escaped
  assert.ok(svg.includes('Right Now'));
  assert.ok(!svg.includes('<Earn>'));                        // no raw injection
});

test('unknown style falls back to the MELEK homage', () => {
  const svg = buildAdSvg('nope', {});
  assert.ok(svg.includes('#d8a340'));                        // homage gold
  assert.match(svg, /^<svg/);
});

test('STYLES catalog is well-formed', () => {
  assert.ok(STYLES.length >= 4);
  for (const s of STYLES) { assert.ok(s.id && s.label); }
  assert.deepEqual(STYLE_IDS, STYLES.map((s) => s.id));
});

test('esc escapes html metacharacters', () => {
  assert.equal(esc(`<a>&"'`), '&lt;a&gt;&amp;&quot;&#39;');
});
