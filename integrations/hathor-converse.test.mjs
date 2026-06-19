// Offline test for hathor-converse.mjs — injected search + complete, no network/model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { converse, __setSearch, __setComplete, __setPerceive } from './hathor-converse.mjs';

// keep these tests fully offline: disable the live Resource-Center perception (it would hit network).
__setPerceive(async () => '');

const HITS = {
  hits: [
    { source: 'library', domain: 'healer', title: 'Pharmahuasca Guide', link: 'knowledge/ayahuasca/pharmahuasca.json', snippet: 'an MAOI lets oral DMT become active', score: 0.9 },
    { source: 'library', domain: 'healer', title: 'MAOI safety', link: 'knowledge/herbs/maoi.md', snippet: 'tyramine interactions matter', score: 0.6 },
  ],
};

test('LLM path: grounds in corpus, returns the model voice + sources', async () => {
  __setSearch(async () => HITS);
  __setComplete(async (msg, opts) => {
    // prove the grounding reached the system prompt
    assert.match(opts.system, /MAOI lets oral DMT/, 'corpus grounding injected into system prompt');
    return { text: 'Seeker, the corpus teaches that an MAOI opens the oral path...', provider: 'fake' };
  });
  const r = await converse('what is an MAOI in ayahuasca?');
  assert.equal(r.usedLLM, true);
  assert.equal(r.grounded, true);
  assert.match(r.reply, /Seeker/);
  assert.equal(r.sources[0].title, 'Pharmahuasca Guide');
});

test('no-LLM fallback: honest grounded answer in the disposition voice', async () => {
  __setSearch(async () => HITS);
  __setComplete(null); // force fallback... but null restores DEFAULT; use a failing complete instead
  __setComplete(async () => ({ text: '' })); // empty → fallback
  const r = await converse('tell me about MAOIs');
  assert.equal(r.usedLLM, false);
  assert.equal(r.grounded, true);
  assert.match(r.reply, /corpus holds/i, 'fallback surfaces the corpus content');
  assert.match(r.reply, /Pharmahuasca Guide/, 'cites the source title');
  assert.ok(r.sources.length > 0);
});

test('empty corpus → honest "not to hand" reply, not invention', async () => {
  __setSearch(async () => ({ hits: [] }));
  __setComplete(async () => ({ text: '' }));
  const r = await converse('something we have nothing on');
  assert.equal(r.grounded, false);
  assert.match(r.reply, /do not have that in the corpus/i);
});

test('empty message → a disposition opener, never throws', async () => {
  const r = await converse('   ');
  assert.equal(r.grounded, false);
  assert.ok(r.reply && r.reply.length > 0);
});

test('search failure is swallowed (never throws)', async () => {
  __setSearch(async () => { throw new Error('boom'); });
  __setComplete(async () => ({ text: 'still answers in voice' }));
  const r = await converse('anything');
  assert.equal(r.grounded, false, 'no hits when search throws');
  assert.match(r.reply, /still answers/);
});
