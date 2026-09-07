import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAINS, CONFIDENCE, confidenceRank, getChain, byConfidence, rejected,
  routesThrough, threeStepChains, SUMEROGRAM_TRAP, LEXICAL_LISTS, LEXICAL_LISTS_NOTE,
  PRE_SUMERIAN_SUBSTRATE, PUNIC_IN_BERBER,
} from './loanword-chains.mjs';

test('every chain declares a route, a gloss and a legal confidence', () => {
  const seen = new Set();
  for (const c of CHAINS) {
    assert.ok(c.id && c.gloss, `${c.id} malformed`);
    assert.ok(!seen.has(c.id), `duplicate id ${c.id}`);
    seen.add(c.id);
    assert.ok(CONFIDENCE.includes(c.confidence), `${c.id} bad confidence`);
    assert.ok(Array.isArray(c.route) && c.route.length >= 2, `${c.id} needs a route with steps`);
  }
  assert.ok(CHAINS.length >= 25);
});

test('the Jerusalem Temple is etymologically "the big house"', () => {
  const e = getChain('ekallum');
  assert.equal(e.confidence, 'secure');
  assert.match(e.route[0], /e₂-gal/);
  assert.match(e.route[0], /big house/);
  assert.match(e.route[2], /hēḵāl/);
});

test('the three-step Sumerian chains are the strongest set and there are many of them', () => {
  const three = threeStepChains();
  assert.ok(three.length >= 8, `only ${three.length}`);
  for (const c of three) {
    assert.match(c.route[0], /Sumerian/i);
    assert.ok(confidenceRank(c.confidence) >= confidenceRank('probable'));
  }
  assert.ok(three.some((c) => c.id === 'ekallum'));
  assert.ok(three.some((c) => c.id === 'kussum'));
});

test('canon begins as a Mesopotamian reed', () => {
  const c = getChain('qanum-canon');
  assert.equal(c.confidence, 'secure');
  assert.match(c.route[0], /qanûm/);
  assert.match(c.route[0], /reed/);
  assert.match(c.route[c.route.length - 1], /CANON/);
});

test('cumin is datable — Mycenaean attestation puts it before 1200 BCE', () => {
  const c = getChain('kamunu-cumin');
  assert.match(c.note, /Mycenaean/);
  assert.match(c.note, /1200/);
});

test('the mina ran Akkadian INTO Sumerian, against the usual direction', () => {
  const m = getChain('manu-mina');
  assert.ok(m.route.some((s) => /borrowed FROM Akkadian/.test(s)));
  assert.match(m.note, /trade/);
});

test('rejected etymologies are kept, not quietly dropped', () => {
  const r = rejected();
  assert.ok(r.length >= 5);
  const ids = r.map((c) => c.id);
  for (const id of ['sindon', 'naphtha', 'nabla', 'saros', 'sar-sharru']) {
    assert.ok(ids.includes(id), `${id} should be recorded as rejected`);
  }
  // each rejected route must say what it is NOT
  for (const c of r) assert.ok(c.route.some((s) => /^NOT |NOT a loan/.test(s)) || c.id === 'saros');
});

test('saros is the model case: a Byzantine lexicon misapplied in 1686 and never corrected', () => {
  const s = getChain('saros');
  assert.equal(s.confidence, 'rejected');
  assert.ok(s.route.some((x) => /3600/.test(x)));
  assert.ok(s.route.some((x) => /Halley|1686/.test(x)));
  assert.match(s.note, /Le Gentil/);
  assert.match(s.note, /1756/);
});

test('cognate is distinguished from borrowed', () => {
  const c = getChain('sar-sharru');
  assert.equal(c.confidence, 'rejected');
  assert.ok(c.route.some((s) => /Proto-Semitic \*śarār-/.test(s)));
  assert.match(c.note, /Cognate, not borrowed/);
});

test('THE SUMEROGRAM TRAP is named with its specific cases', () => {
  assert.match(SUMEROGRAM_TRAP.what, /spelling convention, not a borrowing/);
  assert.equal(SUMEROGRAM_TRAP.cases.length, 3);
  const lugal = SUMEROGRAM_TRAP.cases.find((c) => /LUGAL/.test(c.sign));
  assert.match(lugal.actuallyFrom, /Proto-Semitic/);
  const uru = SUMEROGRAM_TRAP.cases.find((c) => /URU/.test(c.sign));
  assert.match(uru.actuallyFrom, /ʔahl-/);
  assert.match(SUMEROGRAM_TRAP.contrast, /Semitic etymology of its own/);
  assert.match(SUMEROGRAM_TRAP.whoGetsItWrong, /Wiktionary/);
});

test('the lexical lists carry their scale, and Malku is the comparative one', () => {
  assert.ok(LEXICAL_LISTS.length >= 8);
  const urra = LEXICAL_LISTS.find((l) => l.id === 'urra');
  assert.equal(urra.entries, 9700);
  assert.equal(urra.tablets, 24);
  const luA = LEXICAL_LISTS.find((l) => l.id === 'lu-a');
  assert.equal(luA.entries, 140);
  assert.match(luA.note, /thousand years/);
  const malku = LEXICAL_LISTS.find((l) => l.id === 'malku');
  assert.match(malku.principle, /MULTILINGUAL/);
  assert.match(malku.note, /Hurrian|Elamite/);
  assert.match(LEXICAL_LISTS_NOTE, /2,?600 BCE|c\. 2600/);
});

test('the pre-Sumerian substrate is recorded as refuted, with the flagship word that killed it', () => {
  assert.equal(PRE_SUMERIAN_SUBSTRATE.verdict, 'REFUTED');
  assert.match(PRE_SUMERIAN_SUBSTRATE.by, /Rubio/);
  assert.match(PRE_SUMERIAN_SUBSTRATE.by, /Journal of Cuneiform Studies/);
  assert.match(PRE_SUMERIAN_SUBSTRATE.theKicker, /damgar/);
  assert.match(PRE_SUMERIAN_SUBSTRATE.theKicker, /tamkārum/);
  assert.match(PRE_SUMERIAN_SUBSTRATE.lesson, /known ones/);
  // and the module's own data agrees: engar went the OTHER way
  assert.match(getChain('ikkarum').route[0], /engar/);
});

test('the Punic layer in Berber is tiny, and that is the finding', () => {
  assert.deepEqual(PUNIC_IN_BERBER.semanticField, ['to learn', 'to read', 'to fortify / to wall']);
  assert.match(PUNIC_IN_BERBER.verdict, /almost nothing else/);
  assert.match(PUNIC_IN_BERBER.contrast, /40|Arabic/);
  assert.match(PUNIC_IN_BERBER.soWhat, /NOT what a shared religion would look like/);
  for (const id of ['almed', 'aghre', 'agadir']) assert.ok(getChain(id), `${id} missing`);
});

test('agadir and Gades share a root, marking both ends of the Punic reach', () => {
  const a = getChain('agadir');
  assert.match(a.route[0], /gdr/);
  assert.match(a.route[0], /GADES|Cádiz/);
  assert.match(a.note, /Agadir/);
});

test('the split analysis is preserved where a root may be inherited AND borrowed', () => {
  const g = getChain('aghre');
  assert.equal(g.confidence, 'disputed');
  assert.match(g.note, /SPLIT/);
  assert.match(g.note, /Proto-Afroasiatic/);
});

test('routesThrough() and getChain() are soft on misses', () => {
  assert.ok(routesThrough('Akkadian').length >= 10);
  assert.ok(routesThrough('Sumerian').length >= 10);
  assert.deepEqual(routesThrough('Klingon'), []);
  assert.equal(getChain('nope'), null);
  assert.deepEqual(byConfidence('nope'), []);
});
