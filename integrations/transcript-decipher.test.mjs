import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctWithGlossary, decipher, SEED_GLOSSARY } from './transcript-decipher.mjs';

test('corrects the operator-named mishearings', () => {
  const { text, corrections } = correctWithGlossary('so terrence mckenna met sasha shogun in prog');
  assert.match(text, /Terence McKenna/);
  assert.match(text, /Sasha Shulgin/);
  assert.match(text, /Prague/);
  assert.ok(corrections.length >= 3);
});

test('corrects entheogen jargon', () => {
  const { text } = correctWithGlossary('they discussed silo sybin and the low gos and aya waska');
  assert.match(text, /psilocybin/);
  assert.match(text, /the Logos/);
  assert.match(text, /ayahuasca/);
});

test('is word-boundary safe (no mangling inside other words)', () => {
  const { text } = correctWithGlossary('the program is not prague'); // "prog" inside "program" must NOT match
  assert.match(text, /program/);
  assert.ok(!/Pragueram/.test(text));
});

test('counts corrections per term', () => {
  const { corrections } = correctWithGlossary('mckenna mckenna and shulgin');
  const mk = corrections.find((c) => c.to === 'Terence McKenna');
  assert.equal(mk.count, 2);
});

test('decipher (deterministic) returns the glossary pass when no model', async () => {
  const r = await decipher('terrence mckinna talked about d m t', { refine: false });
  assert.match(r.text, /Terence McKenna/);
  assert.match(r.text, /DMT/);
  assert.equal(r.refined, false);
});

test('decipher uses the ensemble refine when provided', async () => {
  const complete = async (prompt) => {
    assert.match(prompt, /Terence McKenna/); // glossary terms passed as context
    return 'Terence McKenna spoke about psilocybin in Prague.';
  };
  const r = await decipher('terence mckinna spoke about silo sybin in prog', { complete });
  assert.equal(r.refined, true);
  assert.match(r.text, /Prague/);
});

test('decipher soft-fails to the glossary pass if the model throws', async () => {
  const complete = async () => { throw new Error('down'); };
  const r = await decipher('sasha shogun', { complete });
  assert.equal(r.refined, false);
  assert.match(r.text, /Sasha Shulgin/);
});

test('SEED_GLOSSARY is well-formed', () => {
  for (const g of SEED_GLOSSARY) { assert.ok(g.canon && Array.isArray(g.variants) && g.variants.length); }
});
