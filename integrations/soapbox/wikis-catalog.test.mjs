// integrations/soapbox/wikis-catalog.test.mjs
// Lightweight assertions for the WIKIS catalog (task #185). Run: node wikis-catalog.test.mjs
import assert from 'node:assert/strict';
import {
  WIKIS,
  byCategory,
  byEngine,
  mediawikiApis,
  categories,
  summary,
} from './wikis-catalog.mjs';

const EXPECTED_CATEGORIES = [
  'General encyclopedias',
  'Fandom / entertainment',
  'Science / math / tech',
  'Nature / herbal / medical',
  'History / humanities / religion',
  'Foreign-language',
];

let pass = 0;
const ok = (label, fn) => {
  fn();
  pass += 1;
  console.log(`ok - ${label}`);
};

ok('catalog has a healthy number of entries (>= 60)', () => {
  assert.ok(WIKIS.length >= 60, `expected >= 60, got ${WIKIS.length}`);
});

ok('every entry has required fields and valid enum values', () => {
  for (const w of WIKIS) {
    assert.ok(w.name && typeof w.name === 'string', `name missing: ${JSON.stringify(w)}`);
    assert.ok(/^https?:\/\//.test(w.url), `bad url: ${w.url}`);
    assert.ok(w.category && typeof w.category === 'string', `category missing: ${w.name}`);
    assert.ok(['mediawiki', 'fandom', 'other'].includes(w.engine), `bad engine: ${w.name}`);
    assert.ok(w.notes && typeof w.notes === 'string', `notes missing: ${w.name}`);
    if (w.api !== undefined) assert.ok(/^https?:\/\//.test(w.api), `bad api: ${w.name}`);
  }
});

ok('all six target categories are represented', () => {
  const present = new Set(categories());
  for (const c of EXPECTED_CATEGORIES) {
    assert.ok(present.has(c), `missing category: ${c}`);
  }
});

ok('byCategory / byEngine filter correctly', () => {
  assert.ok(byCategory('Foreign-language').length > 0);
  assert.ok(byCategory('nonexistent').length === 0);
  assert.ok(byEngine('mediawiki').length > 0);
  assert.ok(byEngine('fandom').length > 0);
  assert.ok(byEngine('other').length > 0);
});

ok('mediawikiApis() returns only mediawiki/fandom entries with an api base', () => {
  const apis = mediawikiApis();
  assert.ok(apis.length >= 40, `expected many parseable wikis, got ${apis.length}`);
  for (const w of apis) {
    assert.ok(['mediawiki', 'fandom'].includes(w.engine));
    assert.ok(/^https?:\/\//.test(w.api));
  }
});

ok('the Wikimedia core family is present', () => {
  const names = WIKIS.map((w) => w.name);
  for (const needle of ['Wikipedia (English)', 'Wiktionary', 'Wikidata', 'Wikimedia Commons']) {
    assert.ok(names.some((n) => n.includes(needle)), `missing ${needle}`);
  }
});

ok('the Egyptian head-cone anchor entry is the correct Wikipedia URL', () => {
  const e = WIKIS.find((w) => w.url === 'https://en.wikipedia.org/wiki/Head_cone');
  assert.ok(e, 'Head_cone anchor entry missing');
  assert.ok(/headcone|head cone|head_cone/i.test(e.name + e.notes));
});

ok('summary() totals are internally consistent', () => {
  const s = summary();
  assert.equal(s.total, WIKIS.length);
  assert.equal(
    Object.values(s.categories).reduce((a, b) => a + b, 0),
    WIKIS.length,
  );
  assert.equal(s.withMediawikiApi, mediawikiApis().length);
});

console.log(`\n${pass} checks passed.`);
