// site-field-autofill.test.mjs — offline tests for the site-vertical field filler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  isBlank,
  autofill,
  reportBlanks,
} from './site-field-autofill.mjs';

// --- esc -------------------------------------------------------------------

test('esc neutralizes HTML metacharacters and nullish', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// --- isBlank ---------------------------------------------------------------

test('isBlank: nullish, empty, and whitespace are blank', () => {
  assert.equal(isBlank(null), true);
  assert.equal(isBlank(undefined), true);
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('   '), true);
  assert.equal(isBlank('\n\t '), true);
});

test('isBlank: placeholder tokens are blank (case-insensitive)', () => {
  for (const p of ['lorem', 'Lorem Ipsum', 'TBD', 'todo', 'N/A', 'coming soon', '...', '—', '???']) {
    assert.equal(isBlank(p), true, `expected blank: ${p}`);
  }
  assert.equal(isBlank('lorem ipsum dolor sit amet consectetur'), true);
});

test('isBlank: empty containers are blank', () => {
  assert.equal(isBlank([]), true);
  assert.equal(isBlank({}), true);
});

test('isBlank: real values are NOT blank (incl. 0, false, real text)', () => {
  assert.equal(isBlank(0), false);
  assert.equal(isBlank(false), false);
  assert.equal(isBlank('A real tagline about MELEK'), false);
  assert.equal(isBlank('this sentence merely contains tbd somewhere'), false);
  assert.equal(isBlank([1]), false);
  assert.equal(isBlank({ a: 1 }), false);
  assert.equal(isBlank(42), false);
});

// --- autofill: happy path --------------------------------------------------

test('autofill fills blank/placeholder fields by name, keeps real values', () => {
  const record = {
    title: 'MELEK Witness School',
    tagline: 'lorem ipsum',
    description: '',
    priceFeed: 'TBD',
    keepThis: 'real value',
  };
  const sources = {
    tagline: 'Learn to run a MELEK witness.',
    description: 'A founding-witness blockchain.',
    priceFeed: '0.42 MBD',
  };
  const out = autofill(record, sources);

  assert.equal(out.tagline, 'Learn to run a MELEK witness.');
  assert.equal(out.description, 'A founding-witness blockchain.');
  assert.equal(out.priceFeed, '0.42 MBD');
  assert.equal(out.keepThis, 'real value');     // never overwritten
  assert.equal(out.title, 'MELEK Witness School'); // never overwritten
});

test('autofill does not mutate the input record', () => {
  const record = { tagline: '', keep: 'x' };
  const out = autofill(record, { tagline: 'filled' });
  assert.equal(record.tagline, ''); // original untouched
  assert.equal(out.tagline, 'filled');
  assert.notEqual(out, record);
});

test('autofill matches field names separator/case-insensitively', () => {
  const record = { priceFeed: '', headBlock: 'TODO' };
  const sources = { price_feed: '1.00', 'Head Block': 12345 };
  const out = autofill(record, sources);
  assert.equal(out.priceFeed, '1.00');
  assert.equal(out.headBlock, 12345);
});

test('autofill reaches one level into nested source namespaces', () => {
  const record = { hashrate: '', peers: 'TBD' };
  const sources = { pool: { hashrate: '12 kH/s', peers: 8 } };
  const out = autofill(record, sources);
  assert.equal(out.hashrate, '12 kH/s');
  assert.equal(out.peers, 8);
});

test('autofill recurses into nested record objects', () => {
  const record = { stats: { hashrate: '...', peers: 7 } };
  const sources = { hashrate: '12.3 kH/s' };
  const out = autofill(record, sources);
  assert.equal(out.stats.hashrate, '12.3 kH/s');
  assert.equal(out.stats.peers, 7); // real value kept
});

test('autofill fills an empty array/object field wholesale by name', () => {
  const record = { links: [], meta: {} };
  const sources = { links: ['a', 'b'], meta: { k: 'v' } };
  const out = autofill(record, sources);
  assert.deepEqual(out.links, ['a', 'b']);
  assert.deepEqual(out.meta, { k: 'v' });
  // cloned, not shared
  assert.notEqual(out.links, sources.links);
});

test('autofill skips a source value that is itself blank', () => {
  const record = { tagline: '' };
  const sources = { tagline: 'TBD' }; // source is a placeholder -> not fillable
  const out = autofill(record, sources);
  assert.equal(out.tagline, ''); // stays blank
});

test('autofill: earlier source wins on collision (array of sources)', () => {
  const record = { name: '' };
  const out = autofill(record, [{ name: 'first' }, { name: 'second' }]);
  assert.equal(out.name, 'first');
});

// --- autofill: edge cases --------------------------------------------------

test('autofill with no/empty sources leaves blanks blank', () => {
  const record = { a: '', b: 'TBD', c: 'real' };
  assert.deepEqual(autofill(record, null), { a: '', b: 'TBD', c: 'real' });
  assert.deepEqual(autofill(record, {}), { a: '', b: 'TBD', c: 'real' });
  assert.deepEqual(autofill(record, []), { a: '', b: 'TBD', c: 'real' });
});

test('autofill soft-fails on non-object record', () => {
  assert.equal(autofill(null, {}), null);
  assert.equal(autofill(undefined, {}), undefined);
  assert.equal(autofill('hello', {}), 'hello');
  assert.equal(autofill(42, {}), 42);
});

test('autofill survives a cyclic record without throwing', () => {
  const record = { a: '', self: null };
  record.self = record; // cycle
  let out;
  assert.doesNotThrow(() => { out = autofill(record, { a: 'filled' }); });
  assert.equal(out.a, 'filled');
});

test('autofill drops functions from the clone (safe value)', () => {
  const record = { fn: () => 1, a: '' };
  const out = autofill(record, { a: 'x' });
  assert.equal('fn' in out, false);
  assert.equal(out.a, 'x');
});

// --- reportBlanks ----------------------------------------------------------

test('reportBlanks lists still-empty dotted paths after a fill', () => {
  const record = {
    title: 'real',
    tagline: '',
    nested: { ok: 'yes', missing: 'TBD' },
  };
  const out = autofill(record, { tagline: 'filled' });
  const blanks = reportBlanks(out);
  assert.deepEqual(blanks.sort(), ['nested.missing']);
});

test('reportBlanks on a fully-filled record is empty', () => {
  assert.deepEqual(reportBlanks({ a: 1, b: 'x', c: { d: true } }), []);
});

test('reportBlanks soft-fails on non-object input', () => {
  assert.deepEqual(reportBlanks(null), []);
  assert.deepEqual(reportBlanks('x'), []);
  assert.deepEqual(reportBlanks(7), []);
});

test('reportBlanks walks objects inside arrays but not array slots', () => {
  const record = { items: [{ name: '' }, { name: 'ok' }], empties: ['', ''] };
  const blanks = reportBlanks(record);
  // The object element's blank field is reported; raw array string slots are not.
  assert.ok(blanks.includes('items[0].name'));
  assert.ok(!blanks.some((b) => b.startsWith('empties[')));
});

// --- end-to-end site-vertical shape ---------------------------------------

test('end-to-end: a site-vertical record fills from reader sources', () => {
  const vertical = {
    slug: 'witness-school',
    title: 'MELEK Witness School',
    hero: { headline: 'lorem ipsum', sub: '' },
    priceFeed: 'TBD',
    blockHeight: '...',
    cta: 'Sign up',          // real, keep
    todoOnly: 'coming soon', // no source -> stays blank-reported
  };
  const sources = [
    { chain: { blockHeight: 123456, priceFeed: '0.42 MBD' } },
    { headline: 'Become a witness on MELEK', sub: 'Hands-on staged onboarding.' },
  ];
  const out = autofill(vertical, sources);

  assert.equal(out.priceFeed, '0.42 MBD');
  assert.equal(out.blockHeight, 123456);
  assert.equal(out.hero.headline, 'Become a witness on MELEK');
  assert.equal(out.hero.sub, 'Hands-on staged onboarding.');
  assert.equal(out.cta, 'Sign up');
  assert.deepEqual(reportBlanks(out), ['todoOnly']);
});
