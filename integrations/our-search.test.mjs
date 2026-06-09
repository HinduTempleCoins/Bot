// Offline test for our-search.mjs — injected sources, no network, no modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, formatForPrompt, __setSources } from './our-search.mjs';

__setSources({
  library: async (q) => [{ source: 'library', domain: 'healer', title: 'Alkaloids', link: 'knowledge/oilahuasca/alkaloids.md', snippet: 'alkaloid, terpene', score: 0.9 }],
  wiki: async (q) => [{ source: 'wiki', title: 'The Convergence', link: 'https://wiki/convergence', snippet: 'temple tech', score: 0.7 }],
  cheetah: async (q) => [{ source: 'cheetah:web', title: 'Alkaloids', link: 'knowledge/oilahuasca/alkaloids.md', snippet: 'dup link', score: 0.5 }], // dup of library by link
  dead: async () => { throw new Error('boom'); }, // must be swallowed
});

test('federates sources, dedupes by link, sorts by score, soft-fails dead source', async () => {
  const res = await search('alkaloid terpene', { k: 8 });
  assert.equal(res.query, 'alkaloid terpene');
  // 3 raw hits, but cheetah dup of library link collapses → 2 merged.
  assert.equal(res.hits.length, 2, 'deduped by link');
  assert.equal(res.hits[0].source, 'library', 'highest score first');
  assert.equal(res.hits[1].source, 'wiki');
  // dead source contributed [] and did not throw.
  assert.deepEqual(res.bySource.dead, []);
});

test('empty query returns empty result without calling sources', async () => {
  const res = await search('   ');
  assert.deepEqual(res.hits, []);
  assert.deepEqual(res.bySource, {});
});

test('only=[] filter restricts which sources run', async () => {
  const res = await search('x', { only: ['wiki'] });
  assert.deepEqual(Object.keys(res.bySource), ['wiki']);
  assert.equal(res.hits[0].source, 'wiki');
});

test('formatForPrompt renders a clean research block', () => {
  const block = formatForPrompt({ hits: [{ source: 'library', title: 'T', link: 'p/x.md', snippet: 's' }] });
  assert.match(block, /\[library\] T <p\/x\.md> — s/);
});
