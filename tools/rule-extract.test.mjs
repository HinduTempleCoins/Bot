import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, compileRule, applyRule, extract, firstMatch, allMatches,
  BUILTIN_RULES, TRANSFORMS,
} from './rule-extract.mjs';

test('builtin rules extract email/url/date', () => {
  const text = 'Reach me at Jane@Example.COM or https://melek.salon/x on 2026-06-11.';
  const out = extract(text, [BUILTIN_RULES.email, BUILTIN_RULES.url, BUILTIN_RULES.date]);
  assert.equal(out.fields.email, 'jane@example.com'); // lower transform applied
  assert.equal(out.fields.url, 'https://melek.salon/x');
  assert.equal(out.fields.date, '2026-06-11');
  assert.deepEqual(out.matched.sort(), ['date', 'email', 'url']);
  assert.deepEqual(out.misses, []);
});

test('custom rule with group capture', () => {
  const rule = { name: 'ticket', pattern: 'TICKET-(\\d+)', group: 1 };
  const res = applyRule(rule, 'see TICKET-4521 for details');
  assert.equal(res.matched, true);
  assert.equal(res.value, '4521');
  assert.equal(res.name, 'ticket');
});

test('transform application: number and trim', () => {
  assert.equal(TRANSFORMS.number('$1,234.50'), 1234.5);
  assert.equal(TRANSFORMS.trim('  hi  '), 'hi');
  const priced = extract('Total: $42.99 due', [BUILTIN_RULES.price]);
  assert.equal(priced.fields.price, 42.99);
  assert.equal(typeof priced.fields.price, 'number');
});

test('invalid regex soft-skips (no throw)', () => {
  const bad = compileRule({ name: 'broken', pattern: '([unclosed' });
  assert.equal(bad, null);
  const res = applyRule({ name: 'broken', pattern: '([unclosed' }, 'anything');
  assert.deepEqual(res, { name: 'broken', value: null, matched: false });
  // extract collects a warning rather than throwing
  const out = extract('text', [{ name: 'broken', pattern: '([unclosed' }]);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /skipped invalid rule: broken/);
  assert.deepEqual(out.matched, []);
});

test('over-long dynamic pattern is capped (returns null, no compile)', () => {
  const huge = 'a'.repeat(5000);
  assert.equal(compileRule({ name: 'big', pattern: huge }), null);
});

test('junk flags are rejected, not thrown', () => {
  const r = compileRule({ name: 'f', pattern: 'x', flags: 'zzz' });
  assert.ok(r); // compiled with flags dropped
  assert.equal(r.re.flags, '');
});

test('esc() on rendered output', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  // a value pulled out then rendered into HTML stays safe
  const out = extract('hi <script>@bob', [BUILTIN_RULES.mentions]);
  assert.equal(out.fields.mentions, 'bob');
  assert.equal(esc(`<i>${out.fields.mentions}</i>`), '&lt;i&gt;bob&lt;/i&gt;');
});

test('miss list is populated for non-matching rules', () => {
  const out = extract('plain text with nothing useful', [
    BUILTIN_RULES.email,
    BUILTIN_RULES.url,
    { name: 'date', pattern: '\\d{4}-\\d{2}-\\d{2}' },
  ]);
  assert.deepEqual(out.matched, []);
  assert.deepEqual(out.misses.sort(), ['date', 'email', 'url']);
  assert.deepEqual(out.fields, {});
});

test('firstMatch and allMatches helpers', () => {
  const text = '#one #two #three';
  assert.equal(firstMatch(BUILTIN_RULES.hashtags, text), 'one');
  assert.deepEqual(allMatches(BUILTIN_RULES.hashtags, text), ['one', 'two', 'three']);
  assert.deepEqual(allMatches({ name: 'bad', pattern: '([' }, text), []);
});

test('soft-fail on garbage inputs', () => {
  assert.deepEqual(extract(null, null), { fields: {}, matched: [], misses: [], warnings: [] });
  assert.deepEqual(applyRule(null, 'x'), { name: '', value: null, matched: false });
  assert.equal(compileRule({ pattern: 'x' }), null); // no name
  assert.equal(esc(undefined), '');
});

test('RegExp pattern accepted directly', () => {
  const res = applyRule({ name: 'word', pattern: /([a-z]+)/, group: 1 }, '  Hello World');
  assert.equal(res.value, 'ello'); // first lowercase run
});
