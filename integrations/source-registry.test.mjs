// source-registry.test.mjs — the unified source registry. Pure declarations + injected resolve; offline.
import { test } from 'node:test';
import assert from 'node:assert';
import { SOURCES, all, get, byMode, byDomain, scheduled, onDemand, domains, resolve, query, validate, __setResolver } from './source-registry.mjs';

test('registry validates: unique ids, valid modes/kinds, module+fn declared', () => {
  const v = validate();
  assert.ok(v.ok, 'invalid: ' + v.errors.join('; '));
  assert.ok(v.sources >= 8);
  assert.ok(v.scheduled >= 5 && v.onDemand >= 2);
});

test('today\'s work is all registered, with the right modes', () => {
  for (const id of ['credentials', 'grants', 'languages', 'hierophant', 'markets', 'library']) {
    assert.ok(get(id), `missing source: ${id}`);
    assert.equal(get(id).mode, 'scheduled', `${id} should be scheduled (finite/stable)`);
  }
  // big live readers are on-demand, not pre-scraped
  assert.equal(get('law').mode, 'on-demand');
  assert.equal(get('politics').mode, 'on-demand');
});

test('listing does NO import/network (pure declarations)', () => {
  // these never touch the modules — just the declared rows
  assert.equal(all().length, SOURCES.length);
  assert.ok(byDomain('languages').length >= 2);   // catalog + scraped corpus
  assert.ok(scheduled().every((s) => s.mode === 'scheduled'));
  assert.ok(onDemand().every((s) => s.mode === 'on-demand'));
  assert.ok(domains().includes('credentials'));
});

test('resolve + query go through the injected resolver (offline)', async () => {
  let asked = null;
  __setResolver((src) => async (q) => { asked = { id: src.id, q }; return { hits: [src.id + ':' + q] }; });
  const fn = await resolve('credentials');
  assert.equal(typeof fn, 'function');
  const r = await query('credentials', 'tefl');
  assert.deepEqual(r, { hits: ['credentials:tefl'] });
  assert.equal(asked.id, 'credentials');
  __setResolver(null);
});

test('query an unknown source → null, never throws', async () => {
  assert.equal(await query('nope', 'x'), null);
  assert.equal(await resolve('nope'), null);
});

test('a resolver/fetcher that throws is swallowed (query → null)', async () => {
  __setResolver(() => async () => { throw new Error('boom'); });
  assert.equal(await query('markets'), null);
  __setResolver(null);
});

test('every source declares a canonical page or a module path', () => {
  for (const x of SOURCES) assert.ok(x.page || x.module, `${x.id} needs a page or module`);
});
