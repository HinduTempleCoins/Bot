// instructional.test.mjs — OFFLINE. The lesson registry: front-matter parsing, order, prerequisites,
// defaults for drafts that do not carry check/faq yet, and lesson lookup from free text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, splitFrontMatter, lessonFromSource, buildRegistry, loadRegistry, tryThisOf } from './instructional.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'instructional');

test('parseYaml: scalars, inline arrays/maps, nested maps, lists of maps, block scalars, comments', () => {
  const y = parseYaml([
    'lesson: 3',
    'title: "Part 03 — A: B"',
    "quoted: 'it''s'",
    'flag: true',
    'nothing: null',
    'tags: [a, "b c", 4]',
    'call_phrase: "Hathor, check my lesson 03"   # a hint only',
    'check:',
    '  kind: post_contains_link',
    '  params: {domain: hathor.soapbox.community, path_prefix_any_of: ["/img/", "/p/"], min_count: 1}',
    '  explain: "I look."',
    'faq:',
    '  - q: "One?"',
    '    a: "Yes."',
    '  - q: >',
    '      Folded',
    '      line',
    '    a: |',
    '      Kept',
    '      lines',
    'requires:',
    '  - how-to-post',
  ].join('\n'));
  assert.equal(y.lesson, 3);
  assert.equal(y.title, 'Part 03 — A: B');
  assert.equal(y.quoted, "it's");
  assert.equal(y.flag, true);
  assert.equal(y.nothing, null);
  assert.deepEqual(y.tags, ['a', 'b c', 4]);
  assert.equal(y.call_phrase, 'Hathor, check my lesson 03');
  assert.equal(y.check.kind, 'post_contains_link');
  assert.deepEqual(y.check.params.path_prefix_any_of, ['/img/', '/p/']);
  assert.equal(y.check.params.min_count, 1);
  assert.equal(y.faq.length, 2);
  assert.equal(y.faq[0].a, 'Yes.');
  assert.equal(y.faq[1].q, 'Folded line');
  assert.equal(y.faq[1].a, 'Kept\nlines');
  assert.deepEqual(y.requires, ['how-to-post']);
});

test('parseYaml never throws on junk', () => {
  assert.deepEqual(parseYaml(null), {});
  assert.equal(typeof parseYaml(':::\n  - [\n{'), 'object');
});

test('splitFrontMatter separates meta and body; a file without fences is all body', () => {
  const { meta, body } = splitFrontMatter('---\nlesson: 1\n---\n\nHello');
  assert.equal(meta.lesson, 1);
  assert.equal(body.trim(), 'Hello');
  assert.deepEqual(splitFrontMatter('Just text').meta, {});
});

test('a draft without check/faq/requires gets honest defaults (manual_review, never a fail)', () => {
  const l = lessonFromSource('---\npermlink: p-07\ntitle: "Hathor\'s Guide, Part 07 — Myth"\n---\nBody\n\n**Try this:** do it.\n', '07_myth.md');
  assert.equal(l.n, 7);
  assert.equal(l.id, 'myth');
  assert.equal(l.check.kind, 'manual_review');
  assert.equal(l.check.defaulted, true);
  assert.deepEqual(l.faq, []);
  assert.equal(l.requires, null);          // resolved by the registry
  assert.equal(l.shortTitle, 'Myth');
  assert.equal(l.tryThis, 'do it.');
});

test('loadRegistry: fixture series in order, INDEX skipped, requires, next, prerequisites', () => {
  const reg = loadRegistry({ dir: FIXTURES });
  assert.deepEqual(reg.errors, []);
  assert.deepEqual(reg.lessons.map((l) => l.n), [1, 2, 3, 4, 5]);
  assert.equal(reg.byPermlink('fixture-guide-02-how-to-post').id, 'how-to-post');
  assert.equal(reg.byId('how-to-post').callPhrase, 'Hathor, check my lesson 02');
  assert.equal(reg.next('how-to-post').id, 'first-image');
  assert.equal(reg.next('say-hello'), null);
  assert.deepEqual(reg.prerequisitesOf('first-image').map((l) => l.id), ['sign-up', 'how-to-post']);
  assert.equal(reg.firstUnfinished(['sign-up']).id, 'how-to-post');
  assert.equal(reg.byId('first-image').url, 'https://melek.salon/@hathor/fixture-guide-03-first-image');
  assert.equal(reg.byId('say-hello').faq[0].a, 'Open melek.salon/@melek\nand pick any post.');
  assert.equal(reg.byId('how-to-post').faq.length, 3);
});

test('requires defaults to the previous lesson when a draft omits it', () => {
  const reg = buildRegistry([
    { name: '01_a.md', src: '---\npermlink: pa\n---\nA' },
    { name: '02_b.md', src: '---\npermlink: pb\n---\nB' },
  ]);
  assert.deepEqual(reg.byId('a').requires, []);
  assert.deepEqual(reg.byId('b').requires, ['a']);
});

test('findInText: lesson numbers in several languages, and title words', () => {
  const reg = loadRegistry({ dir: FIXTURES });
  assert.equal(reg.findInText('@hathor I finished lesson 3')?.id, 'first-image');
  assert.equal(reg.findInText('@hathor part 02 done')?.id, 'how-to-post');
  assert.equal(reg.findInText('@hathor পাঠ 2 শেষ')?.id, 'how-to-post');
  assert.equal(reg.findInText('@hathor terminé la lección 3')?.id, 'first-image');
  assert.equal(reg.findInText('@hathor I did the first image lesson, your first image is posted')?.id, 'first-image');
  assert.equal(reg.findInText('@hathor hello'), null);
});

test('missing / unset directory is an empty registry with a reason, never a throw', () => {
  assert.equal(loadRegistry({ dir: '' }).size, 0);
  const r = loadRegistry({ dir: path.join(FIXTURES, 'nope') });
  assert.equal(r.size, 0);
  assert.equal(r.errors.length, 1);
});

test('tryThisOf pulls the task line', () => {
  assert.equal(tryThisOf('x\n\n**Try this:** post it.\n\nmore'), 'post it.');
  assert.equal(tryThisOf('no task'), '');
});
