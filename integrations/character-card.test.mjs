// character-card.test.mjs — offline tests for character-card.mjs. node:test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  REQUIRED_FIELDS,
  buildCharacterCard,
  validateCard,
  renderCardMarkdown,
  mergeCards,
} from './character-card.mjs';

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('REQUIRED_FIELDS is the expected frozen list', () => {
  assert.deepEqual([...REQUIRED_FIELDS], ['name', 'role', 'voice']);
  assert.ok(Object.isFrozen(REQUIRED_FIELDS));
});

test('buildCharacterCard normalizes, trims, defaults', () => {
  const c = buildCharacterCard({
    name: '  Angel  ',
    role: ' guide ',
    voice: ' calm ',
    aliases: [' A ', 'a', 'B'],        // trimmed + case-insensitive dedupe
    traits: 'kind, kind, wise',         // CSV → array, deduped
    backstory: '  born of light  ',
  });
  assert.equal(c.name, 'Angel');
  assert.equal(c.role, 'guide');
  assert.equal(c.voice, 'calm');
  assert.deepEqual(c.aliases, ['A', 'B']);
  assert.deepEqual(c.traits, ['kind', 'wise']);
  assert.equal(c.backstory, 'born of light');
  assert.deepEqual(c.taboos, []);
  assert.equal(c.greetingDisposition, '');
});

test('buildCharacterCard soft-fails on non-object / weird types', () => {
  const empty = buildCharacterCard(null);
  assert.deepEqual(empty, {
    name: '', aliases: [], role: '', voice: '', traits: [],
    backstory: '', taboos: [], greetingDisposition: '',
  });
  // arrays are not valid object input → all defaults
  assert.deepEqual(buildCharacterCard([1, 2]), empty);
  // object-typed scalar fields collapse to empty string, not [object Object]
  const c = buildCharacterCard({ name: { x: 1 }, traits: [{}, 'ok', null] });
  assert.equal(c.name, '');
  assert.deepEqual(c.traits, ['ok']);
});

test('validateCard ok=true on complete card', () => {
  const card = buildCharacterCard({
    name: 'Angel', role: 'guide', voice: 'calm',
    traits: ['a', 'b', 'c'], backstory: 'x',
  });
  const r = validateCard(card);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.warnings, []);
});

test('validateCard reports missing required fields', () => {
  const r = validateCard(buildCharacterCard({ name: 'Angel' }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['role', 'voice']);
});

test('validateCard warns on empty backstory and <3 traits', () => {
  const r = validateCard(buildCharacterCard({
    name: 'Angel', role: 'guide', voice: 'calm', traits: ['only'],
  }));
  assert.equal(r.ok, true); // required all present
  assert.ok(r.warnings.some((w) => /backstory/.test(w)));
  assert.ok(r.warnings.some((w) => /trait/.test(w)));
});

test('validateCard soft-fails on non-object', () => {
  const r = validateCard(null);
  assert.deepEqual(r, { ok: false, missing: ['name', 'role', 'voice'], warnings: [] });
  assert.equal(validateCard(42).ok, false);
  assert.equal(validateCard([]).ok, false);
});

test('renderCardMarkdown produces escaped profile', () => {
  const md = renderCardMarkdown({
    name: 'A<b>',
    aliases: ['x"y'],
    role: 'r&r',
    voice: 'v',
    traits: ['t1', 't2'],
    backstory: 'once <upon>',
    taboos: ['no & keys'],
    greetingDisposition: 'host',
  });
  assert.ok(md.includes('# A&lt;b&gt;'));
  assert.ok(md.includes('x&quot;y'));
  assert.ok(md.includes('r&amp;r'));
  assert.ok(md.includes('once &lt;upon&gt;'));
  assert.ok(md.includes('no &amp; keys'));
  assert.ok(md.includes('host'));
  // no raw unescaped angle brackets from the input leaked through
  assert.ok(!md.includes('A<b>'));
});

test('renderCardMarkdown is stable on empty/partial input', () => {
  const md = renderCardMarkdown(null);
  assert.ok(md.includes('(unnamed)'));
  assert.ok(md.includes('(none declared)'));
  assert.ok(md.includes('(none)'));
});

test('mergeCards: overlay wins on scalars, arrays unioned + deduped', () => {
  const base = buildCharacterCard({
    name: 'Base', role: 'baseRole', voice: 'baseVoice',
    aliases: ['x'], traits: ['t1', 't2'], taboos: ['no keys'],
    backstory: 'base story', greetingDisposition: 'base disp',
  });
  const overlay = buildCharacterCard({
    name: 'Over', voice: 'overVoice',
    aliases: ['X', 'y'], traits: ['t2', 't3'], taboos: [],
  });
  const m = mergeCards(base, overlay);
  assert.equal(m.name, 'Over');            // overlay scalar wins
  assert.equal(m.voice, 'overVoice');
  assert.equal(m.role, 'baseRole');        // overlay empty → base kept
  assert.equal(m.backstory, 'base story');
  assert.equal(m.greetingDisposition, 'base disp');
  assert.deepEqual(m.aliases, ['x', 'y']); // union, case-insensitive dedupe (X==x)
  assert.deepEqual(m.traits, ['t1', 't2', 't3']);
  assert.deepEqual(m.taboos, ['no keys']);
});

test('mergeCards soft-fails on bad inputs', () => {
  const m = mergeCards(null, undefined);
  assert.equal(m.name, '');
  assert.deepEqual(m.traits, []);
  assert.equal(validateCard(m).ok, false);
});
