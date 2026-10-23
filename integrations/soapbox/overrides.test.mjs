// overrides.test.mjs — offline, node:test. Env-artifact import: point SOAPBOX_OVERRIDES at a temp
// file before importing the module, and rewrite + reload() between cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'soapbox-ov-'));
const FILE = path.join(DIR, 'overrides.json');
process.env.SOAPBOX_OVERRIDES = FILE;

const { overrideFor, featuredIds, reload } = await import('./overrides.mjs');

const write = (obj) => { fs.writeFileSync(FILE, JSON.stringify(obj, null, 2)); };

test('an unknown id gets the defaults and never throws', () => {
  write({ hither: { blurb: 'hi' } });
  reload();
  const d = overrideFor('nope');
  assert.deepEqual(d,
    { blurb: null, featured: false, featured_rank: null, layout_variant: null, badge: null });
  const o = overrideFor('hither');
  assert.equal(o.blurb, 'hi');
  assert.equal(o.featured, false);
});

test('featuredIds() orders by featured_rank with unranked last', () => {
  write({
    a: { blurb: 'x' },
    b: { blurb: 'x', featured: true, featured_rank: 2 },
    c: { blurb: 'lost', featured: true, featured_rank: 1 },
    d: { blurb: 'x' },
    e: { blurb: 'kept', featured: true },
  });
  reload();
  assert.deepEqual(featuredIds(), ['c', 'b', 'e']);
});

test('a missing override file gives an empty map and never throws', () => {
  fs.rmSync(FILE, { force: true });
  reload();
  assert.deepEqual(featuredIds(), []);
  assert.deepEqual(overrideFor('x'),
    { blurb: null, featured: false, featured_rank: null, layout_variant: null, badge: null });
});

test('a corrupt override file gives an empty map and never throws', () => {
  fs.writeFileSync(FILE, '{ not json at all ]');
  reload();
  assert.deepEqual(featuredIds(), []);
  assert.deepEqual(overrideFor('x'),
    { blurb: null, featured: false, featured_rank: null, layout_variant: null, badge: null });
});

test('reload() picks up an operator edit without restarting', () => {
  write({});
  reload();
  fs.writeFileSync(FILE, JSON.stringify({ z: { blurb: 'x', featured: true, featured_rank: 1 } }));
  assert.deepEqual(featuredIds(), [], 'stale cache still seen before reload()');
  reload();
  assert.deepEqual(featuredIds(), ['z']);
});
