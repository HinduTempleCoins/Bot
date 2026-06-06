// genai-templates.test.mjs — offline tests for the template registry + slot filling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, CATEGORIES, getTemplate, fillTemplate, exampleFor, validateTemplates, templatesByCategory,
} from './genai-templates.mjs';

test('registry has at least 12 templates and is valid', () => {
  assert.ok(TEMPLATES.length >= 12, `expected >=12, got ${TEMPLATES.length}`);
  const v = validateTemplates();
  assert.equal(v.ok, true, 'integrity errors: ' + v.errors.join('; '));
});

test('every template: every {{slot}} is declared, every declared slot is used', () => {
  for (const t of TEMPLATES) {
    const declared = new Set(t.slots.map((s) => s.key));
    const used = new Set();
    let m; const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    while ((m = re.exec(t.promptPattern))) used.add(m[1]);
    for (const u of used) assert.ok(declared.has(u), `${t.id}: undeclared {{${u}}}`);
    for (const s of t.slots) assert.ok(used.has(s.key), `${t.id}: unused slot ${s.key}`);
    assert.ok(CATEGORIES.includes(t.category), `${t.id}: bad category`);
  }
});

test('fillTemplate substitutes provided slot values', () => {
  const out = fillTemplate('egyptian-temple-poster', { deity: 'Isis', time: 'midnight', style: 'oil painting' });
  assert.ok(out.includes('Isis'));
  assert.ok(out.includes('midnight'));
  assert.ok(out.includes('oil painting'));
  assert.ok(!out.includes('{{'), 'no placeholders should remain');
});

test('fillTemplate falls back to example for missing slots', () => {
  const out = fillTemplate('egyptian-temple-poster', { deity: 'Isis' });
  assert.ok(out.includes('Isis'));
  const t = getTemplate('egyptian-temple-poster');
  const timeSlot = t.slots.find((s) => s.key === 'time');
  assert.ok(out.includes(timeSlot.example), 'missing slot uses its example');
  assert.ok(!out.includes('{{'));
});

test('fillTemplate ignores unknown slot keys', () => {
  const out = fillTemplate('coin-token-logo', { name: 'MELEK', bogus: 'xxx' });
  assert.ok(out.includes('MELEK'));
  assert.ok(!out.includes('xxx'));
});

test('unknown template id returns empty string', () => {
  assert.equal(fillTemplate('does-not-exist', {}), '');
  assert.equal(getTemplate('nope'), null);
});

test('exampleFor produces a clean prompt for every template', () => {
  for (const t of TEMPLATES) {
    const ex = exampleFor(t.id);
    assert.ok(ex.length > 10, `${t.id}: example too short`);
    assert.ok(!ex.includes('{{'), `${t.id}: leftover placeholder`);
  }
});

test('templatesByCategory partitions the registry', () => {
  let total = 0;
  for (const c of CATEGORIES) total += templatesByCategory(c).length;
  assert.equal(total, TEMPLATES.length);
});

test('template ids are unique', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
