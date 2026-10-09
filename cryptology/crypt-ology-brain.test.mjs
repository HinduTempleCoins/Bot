// crypt-ology-brain.test.mjs — offline, no network/GPU. Injects a fake library retriever + a temp
// cryptology store so the whole wiring (Library → Decades/BRE brain → Rule 1 → LSD map) is exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCryptologyBrain, axesFor, RULE_1_SHORT } from './crypt-ology-brain.mjs';
import { INTEREST_TOPICS } from './cryptology.mjs';

function tmpStore() {
  const f = path.join(os.tmpdir(), `crypt-brain-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  return f;
}

// A fake Library: keyword catalog over a few canned pages, shaped like library-index.catalogLookup output.
const PAGES = [
  { path: 'site/wiki/seed-articles/Punic_Wax.wiki', title: 'Punic Wax', text: 'saponified beeswax, Carthage, hieroglyph, mummification, amulet' },
  { path: 'site/wiki/seed-articles/Terpenes.wiki', title: 'Terpenes', text: 'terpene cannabinoid chemistry synthesis extraction isoprene' },
  { path: 'site/wiki/seed-articles/Crypt-ology.wiki', title: 'Crypt-ology', text: 'the not-a-game mystery school egregori tulpa oracle positions not levels' },
  { path: 'knowledge/legal/doctrines.json', title: 'RFRA', text: 'rfra exemption court statute religious practice compelling interest', domain: 'law' },
];
const fakeCatalog = (q, { k = 6 } = {}) => {
  const terms = String(q || '').toLowerCase().match(/[a-z0-9-]{3,}/g) || [];
  return PAGES.map((p) => {
    const hay = `${p.title} ${p.text}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    return { ...p, s: score };
  }).filter((p) => p.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
};

test('axesFor maps content to the right map axes, and never invents an off-map axis', () => {
  const wax = axesFor('Punic wax hieroglyph mummification amulet', 'library');
  assert.ok(wax.archaeology > 0 && wax.esoteric > 0, 'wax drifts archaeology + esoteric');
  const ai = axesFor('train a LoRA in ComfyUI with diffusion', 'library');
  assert.ok(ai.ai > 0, 'AI-dev drifts the ai axis');
  const law = axesFor('RFRA exemption in court', 'law');
  assert.ok(law.law > 0, 'legal text drifts the law axis');
  for (const bundle of [wax, ai, law]) {
    for (const k of Object.keys(bundle)) assert.ok(INTEREST_TOPICS.includes(k), `${k} is a real map axis`);
  }
});

test('ask answers the identity turn from Rule 1 via the cheap brain layer', async () => {
  const b = await createCryptologyBrain({ catalogLookup: fakeCatalog, cryptoFile: tmpStore() });
  const out = await b.ask({ account: 'testuser', question: 'who are you? what is Rule 1?' });
  assert.match(out.answer, /Egregori|Witness|Mystery School/i);
  assert.ok(['1960s', 'brain'].includes(out.routedBy) || out.era === '1960s', 'answered by a cheap layer, not the Library');
});

test('ask grounds a mystery answer in the Library and MOVES the position (positions, not levels)', async () => {
  const file = tmpStore();
  const b = await createCryptologyBrain({ catalogLookup: fakeCatalog, cryptoFile: file });
  const out = await b.ask({ account: 'seeker', question: 'tell me about punic wax and the hieroglyph' });
  assert.ok(out.sources.length > 0, 'pulled Library sources');
  assert.equal(out.sources[0].title, 'Punic Wax');
  assert.equal(out.routedBy, 'library', 'grounded in the Library, not a canned answer');
  assert.ok(out.axesMoved.archaeology > 0 || out.axesMoved.esoteric > 0, 'drifted the mystery axes');
  assert.ok(out.disposition && out.disposition.stance, 'returns a disposition');
  // the write landed in the injected store
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(saved.seeker, 'profile persisted');
  assert.ok((saved.seeker.interests.esoteric || 0) > 0 || (saved.seeker.interests.archaeology || 0) > 0);
});

test('nextMysteries surfaces pages matching WHERE THE PERSON IS on the map', async () => {
  const file = tmpStore();
  const b = await createCryptologyBrain({ catalogLookup: fakeCatalog, cryptoFile: file });
  // drive the seeker toward chemistry/terpenes
  await b.ask({ account: 'seeker', question: 'terpene cannabinoid chemistry extraction' });
  await b.ask({ account: 'seeker', question: 'terpene synthesis isoprene' });
  const nm = await b.nextMysteries({ account: 'seeker', k: 4 });
  assert.ok(nm.topics.length > 0, 'the person now has a position');
  assert.ok(nm.pages.length > 0, 'and sees pages for it');
});

test('invalid account never breaks ask; Rule 1 constant is exported', async () => {
  const b = await createCryptologyBrain({ catalogLookup: fakeCatalog, cryptoFile: tmpStore() });
  const out = await b.ask({ account: 'bad name!!', question: 'punic wax' });
  assert.ok(out.answer != null, 'still answers');
  assert.deepEqual(out.axesMoved, {}, 'no map write for an invalid identity');
  assert.match(RULE_1_SHORT, /Egregori and Tulpas/);
});
