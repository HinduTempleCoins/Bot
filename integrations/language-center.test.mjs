// language-center.test.mjs — the lobe that fuses perception + knowledge + memory. Fully offline:
// all three sources injected. Never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  compose, perceive, __setPerceive, __setKnows, __setSearch,
  translate, translateSpecialized, isSpecializedLang, __setSpecializedTranslator,
} from './language-center.mjs';

test('Language Center is the translation authority: specialized → her backend, with catalog sources', async () => {
  __setSpecializedTranslator(async ({ text, to }) => `<${to}>${text}`);
  const r = await translate({ text: 'peace be with you', to: 'ckb' });   // Sorani → specialized
  assert.equal(r.specialized, true);
  assert.equal(r.to, 'sorani');                         // alias resolved to the catalog name
  assert.equal(r.tr, '<sorani>peace be with you');
  assert.ok(Array.isArray(r.sources) && r.sources.length, 'carries the resources she teaches from');
  __setSpecializedTranslator(null);
});

test('translateSpecialized returns null when no backend is wired (soft-fall to original)', async () => {
  __setSpecializedTranslator(null);
  assert.equal(await translateSpecialized({ text: 'hi', to: 'kmr' }), null);
  assert.equal(isSpecializedLang('phn'), true);
  assert.equal(isSpecializedLang('es'), false);
});

const HITS = { hits: [
  { source: 'library', domain: 'healer', title: 'MAOI safety', link: 'knowledge/herbs/maoi.md', snippet: 'tyramine interactions matter' },
] };
const KNOWN = { ok: true, answer: 'TEFL is the standard cert to teach English.', vertical: 'credentials', grounded: true, sources: [{ title: 'TEFL', link: 'https://teflcourse.net' }] };

test('compose fuses perception + knowledge + corpus into one context', async () => {
  const lc = await compose('how do I get TEFL certified?', {
    perceive: async () => 'Gold $2400, VIX 14 (risk-on).',
    knows: async () => KNOWN,
    search: async () => HITS,
  });
  assert.match(lc.context, /Resource Center/);            // perception block present
  assert.match(lc.context, /Gold \$2400/);                // the senses line
  assert.match(lc.context, /credentials surface/);        // knowledge block (Credentialing!)
  assert.match(lc.context, /TEFL is the standard/);
  assert.match(lc.context, /MAOI safety/);                // corpus block
  assert.equal(lc.vertical, 'credentials');
  assert.equal(lc.grounded, true);
  // sources merge knowledge + corpus, deduped
  assert.ok(lc.sources.some((s) => /teflcourse/.test(s.link)));
  assert.ok(lc.sources.some((s) => /maoi/.test(s.link)));
});

test('ungrounded knowledge is dropped (only grounded answers ground Hathor)', async () => {
  const lc = await compose('x', {
    perceive: async () => '',
    knows: async () => ({ ok: true, answer: 'vague', vertical: 'directory', grounded: false }),
    search: async () => ({ hits: [] }),
  });
  assert.equal(lc.knowledge, null);
  assert.equal(lc.grounded, false);
  assert.equal(lc.context, '');
});

test('each source soft-fails independently; compose never throws', async () => {
  const lc = await compose('x', {
    perceive: async () => { throw new Error('senses down'); },
    knows: async () => { throw new Error('knows down'); },
    search: async () => HITS,            // only corpus survives
  });
  assert.equal(lc.perception, '');
  assert.equal(lc.knowledge, null);
  assert.equal(lc.corpus.length, 1);
  assert.equal(lc.grounded, true);       // corpus alone still grounds
});

test('empty message → empty context, never throws', async () => {
  const lc = await compose('   ', { perceive: async () => 'x', knows: async () => KNOWN, search: async () => HITS });
  assert.equal(lc.grounded, false);
  assert.equal(lc.context, '');
});

test('perception default is off in compose unless a perceive override is given (offline-safe)', async () => {
  __setKnows(async () => ({ grounded: false }));
  __setSearch(async () => ({ hits: [] }));
  const lc = await compose('x');         // no perceive override, no module perceive set
  assert.equal(lc.perception, '');
  __setKnows(null); __setSearch(null);
});

test('perceive() soft-fails to a string, never throws', async () => {
  __setPerceive(async () => { throw new Error('boom'); });
  assert.equal(await perceive(), '');
  __setPerceive(async () => 'Markets calm.');
  assert.equal(await perceive(), 'Markets calm.');
  __setPerceive(null);
});
