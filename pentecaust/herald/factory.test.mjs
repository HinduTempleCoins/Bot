// pentecaust/herald/factory.test.mjs — offline tests for the Herald content factory (drafts only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, draftFor, draftAll, __setLLM } from './factory.mjs';

const SOURCE = {
  title: 'MELEK SoapBox',
  body: 'a place to publish what you know',
  valueProp: 'publish and participate to earn your first coin',
  url: 'https://melek.salon/@hathor/intro',
};

test('draftFor (no LLM) → first-person draft with the source URL and no "invest"', async () => {
  __setLLM(null);
  const r = await draftFor('permies', SOURCE);
  assert.equal(r.ok, true);
  assert.equal(r.voice, 'personal');
  assert.equal(r.source, 'template');
  assert.ok(r.draft.length > 0);
  assert.ok(r.draft.includes(SOURCE.url), 'draft references the source URL');
  assert.ok(!/\binvest\b/i.test(r.draft), 'no "invest"');
});

test('church_bulletin → institutional "royal we" voice, no banned words', async () => {
  __setLLM(null);
  const r = await draftFor('church_bulletin', SOURCE);
  assert.equal(r.ok, true);
  assert.equal(r.voice, 'royal_we');
  assert.ok(/\bwe\b/i.test(r.draft), 'uses we/our');
  assert.ok(!/\bfree\b/i.test(r.draft) && !/\bguarantee/i.test(r.draft), 'no spam words');
});

test('injected LLM text is scrubbed (banned jargon + spam removed)', async () => {
  __setLLM(async () => 'You should invest now — it is FREE and guaranteed! Reference: https://melek.salon/@hathor/intro');
  const r = await draftFor('historum', SOURCE);
  __setLLM(null);
  assert.equal(r.ok, true);
  assert.equal(r.source, 'llm');
  assert.ok(!/\binvest\b/i.test(r.draft), '"invest" scrubbed');
  assert.ok(!/\bFREE\b/i.test(r.draft), '"free" scrubbed');
  assert.ok(!/\bguaranteed\b/i.test(r.draft), '"guaranteed" scrubbed');
});

test('draftAll → a draft for every platform', async () => {
  __setLLM(null);
  const all = await draftAll(SOURCE);
  for (const p of PLATFORMS) {
    assert.ok(typeof all[p] === 'string' && all[p].length > 0, `draft for ${p}`);
  }
});

test('unknown platform → soft-fail, never throws', async () => {
  const r = await draftFor('myspace', SOURCE);
  assert.equal(r.ok, false);
});
