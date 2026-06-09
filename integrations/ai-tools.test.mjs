// integrations/ai-tools.test.mjs — offline, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTools, dispatch, __setDeps } from './ai-tools.mjs';

test('listTools returns the registry shape (name/description/params, no run fn)', () => {
  const tools = listTools();
  assert.ok(Array.isArray(tools));
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'ask_library', 'chain_account', 'library_lookup', 'library_recall', 'our_search',
  ]);
  for (const t of tools) {
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.equal(typeof t.params, 'object');
    assert.ok(t.params !== null);
    assert.equal(t.run, undefined, 'run fn must not leak into the serializable catalog');
  }
});

test('dispatch routes our_search to the injected fake module and passes args through', async () => {
  let gotQuery = null;
  let gotOpts = null;
  __setDeps({
    ourSearch: {
      search(query, opts) {
        gotQuery = query;
        gotOpts = opts;
        return { query, hits: [{ title: 'Hit', score: 1 }], bySource: {} };
      },
    },
  });
  const r = await dispatch('our_search', { query: 'melek witness', k: 3, domain: 'chain' });
  assert.equal(gotQuery, 'melek witness');
  assert.deepEqual(gotOpts, { k: 3, domain: 'chain' });
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].title, 'Hit');
  __setDeps(null);
});

test('dispatch runs library_lookup via an injected dep (sync result)', async () => {
  __setDeps({
    libraryIndex: {
      catalogLookup(query, opts) {
        return [{ domain: opts.domain || 'knowledge', path: 'a.md', title: query, score: 9 }];
      },
    },
  });
  const r = await dispatch('library_lookup', { query: 'zar', domain: 'healer', k: 2 });
  assert.ok(Array.isArray(r));
  assert.equal(r[0].title, 'zar');
  assert.equal(r[0].domain, 'healer');
  __setDeps(null);
});

test('dispatch runs chain_account; null account soft-fails to an error object', async () => {
  __setDeps({
    chainExplorer: {
      account(name) { return name === 'hathor' ? { name, balance: '1.000 TESTS' } : null; },
    },
  });
  const ok = await dispatch('chain_account', { name: 'hathor' });
  assert.equal(ok.name, 'hathor');
  assert.equal(ok.balance, '1.000 TESTS');

  const missing = await dispatch('chain_account', { name: 'nobody' });
  assert.ok(missing.error);
  assert.match(missing.error, /not found/);
  __setDeps(null);
});

test('unknown tool name soft-fails to { error } and lists available tools', async () => {
  const r = await dispatch('does_not_exist', { x: 1 });
  assert.ok(r.error);
  assert.match(r.error, /unknown tool/);
  assert.ok(Array.isArray(r.available));
  assert.ok(r.available.includes('our_search'));
});

test('a throwing dep is caught — dispatch never throws, returns { error }', async () => {
  __setDeps({
    libraryRag: {
      askLibrary() { throw new Error('boom'); },
    },
  });
  const r = await dispatch('ask_library', { question: 'what is rule 1?' });
  assert.ok(r.error);
  assert.match(r.error, /ask_library failed/);
  __setDeps(null);
});

test('an unavailable module (dep returns nothing usable) soft-fails to { error }', async () => {
  __setDeps({ libraryIndex: { /* no recall fn */ } });
  const r = await dispatch('library_recall', { query: 'x' });
  assert.ok(r.error);
  assert.match(r.error, /unavailable/);
  __setDeps(null);
});

test('dispatch tolerates missing args object', async () => {
  __setDeps({ ourSearch: { search() { return { hits: [] }; } } });
  const r = await dispatch('our_search');
  assert.deepEqual(r.hits, []);
  __setDeps(null);
});
