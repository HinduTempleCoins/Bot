import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAINS, CONFIDENCE, confidenceRank, getChain, byConfidence, rejected,
  routesThrough, threeStepChains, SUMEROGRAM_TRAP, LEXICAL_LISTS, LEXICAL_LISTS_NOTE,
  PRE_SUMERIAN_SUBSTRATE, PUNIC_IN_BERBER, DATED_ANCHORS, getAnchor, DIRECTION_TESTS,
  SILVER_PAIR, MYCENAEAN_LAYER, A_DIAGNOSTIC, CIRCULARITY_WARNINGS, IRON_ZERO,
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

test('the Indo-Iranian bracket is closed from both sides by independent evidence', () => {
  const a = getAnchor('indo-iranian-unity');
  assert.equal(a.confidence, 'secure');
  assert.match(a.floor.date, /2000 BCE/);
  assert.match(a.ceiling.date, /1761 BCE/);
  assert.match(a.floor.evidence, /Sintashta/);
  assert.match(a.ceiling.evidence, /Tell Leilān/);
  assert.match(a.ceiling.evidence, /Zimri-Lim/);
  // the two legs must be different KINDS of evidence, which is what makes the bracket work
  assert.match(a.floor.logic, /inherited|INHERITED/i);
  assert.match(a.ceiling.logic, /dated archive text/);
  assert.match(a.whyItMatters, /independent/);
});

test('Kikkuli is dated to its real two-stage chronology, not the popular midpoint', () => {
  const k = getAnchor('kikkuli');
  assert.match(k.dating, /15th century/);
  assert.match(k.dating, /13th century/);
  assert.match(k.dating, /Neu 1986/);
  assert.match(k.correction, /NOT "c\. 1400 BCE"/);
  assert.match(k.correction, /Šuppiluliuma/);
});

test('the Kikkuli numerals are the odd numbers only, and that is the evidence', () => {
  const k = getAnchor('kikkuli');
  assert.equal(k.theNumerals.length, 5);
  assert.deepEqual(k.theNumerals.map((n) => n.vedic), ['éka-', 'trī-', 'páñca-', 'saptá-', 'náva-']);
  assert.match(k.theRealPoint, /ONLY the odd numbers/);
  assert.match(k.theRealPoint, /Hurrian/);
  assert.match(k.theRealPoint, /jargon/);
});

test('the transliteration caveat and the source warning are both carried', () => {
  const k = getAnchor('kikkuli');
  assert.match(k.transliterationNote, /-artanna, not -wartanna/);
  assert.match(k.sourceWarning, /Raulwing 2009/);
  assert.match(k.sourceWarning, /copy-paste error/);
  assert.match(k.sourceWarning, /Do not quote/);
  // and the Indo-Aryan inference is held as probable, not airtight
  assert.match(k.contested, /Kammenhuber/);
  assert.match(k.contested, /probable rather than certain/);
});

test('ANSE.KUR.RA is the cleanest direction evidence there is', () => {
  const a = getAnchor('anse-kur-ra');
  assert.match(a.whyItMatters, /ass of the mountains/);
  assert.match(a.whyItMatters, /foreign donkey/);
  assert.match(a.whyItMatters, /better evidence for direction/);
  const t = DIRECTION_TESTS.find((x) => x.id === 'the-name-says-so');
  assert.match(t.example, /ANŠE\.KUR\.RA/);
});

test('Ebla re-scopes the wheel argument rather than refuting it', () => {
  const e = getAnchor('anatolian-at-ebla');
  assert.match(e.dating, /25th century/);
  assert.match(e.whyItMatters, /falsifies the Yamnaya/);
  assert.match(e.consequence, /RE-SCOPES/);
  assert.match(e.consequence, /CORE PIE/);
  assert.match(e.consequence, /still holds for the node it applies to/);
  assert.match(e.contested, /sister/i, 'the sister-vs-daughter framing is what is disputed');
});

test('the direction tests lead with morphological transparency', () => {
  assert.ok(DIRECTION_TESTS.length >= 5);
  assert.equal(DIRECTION_TESTS[0].id, 'transparency');
  assert.match(DIRECTION_TESTS[0].example, /mrkbt/);
  assert.match(DIRECTION_TESTS[0].example, /maqtal/);
  assert.match(DIRECTION_TESTS[0].example, /Semitic → Egyptian/);
  for (const t of DIRECTION_TESTS) assert.ok(t.id && t.test, `${t.id} malformed`);
});

test('getAnchor() is soft on misses', () => {
  assert.equal(getAnchor('nope'), null);
});

test('THE SILVER PAIR: the irregularity is the evidence, not a defect in it', () => {
  assert.match(SILVER_PAIR.inherited.form, /h₂erǵ-n̥t-om/);
  assert.match(SILVER_PAIR.inherited.behaviour, /Perfectly regular/);
  assert.match(SILVER_PAIR.inherited.absent, /Germanic and Balto-Slavic/);
  assert.ok(SILVER_PAIR.wanderwort.irregularities.length >= 4);
  assert.match(SILVER_PAIR.wanderwort.theKicker, /description of noise/);
  assert.match(SILVER_PAIR.wanderwort.distribution, /a MAP, not a tree/);
  assert.match(SILVER_PAIR.wanderwort.verdict, /genuinely unknown/);
  assert.ok(SILVER_PAIR.wanderwort.candidateSources.length >= 4, 'four candidates, none endorsed');
});

test('THE MYCENAEAN LAYER is all pre-1200 BCE and includes its own control', () => {
  const a = MYCENAEAN_LAYER.attestations;
  assert.ok(a.length >= 8);
  const silver = a.find((x) => x.gloss === 'silver');
  assert.match(silver.status, /INHERITED/, 'the control that shows the Wanderwort never reached Greek');
  const gold = a.find((x) => x.gloss === 'gold');
  assert.match(gold.status, /Semitic loan/);
  assert.match(MYCENAEAN_LAYER.window, /1450–1200 BCE/);
  assert.match(MYCENAEAN_LAYER.theArgument, /it is in the accounts/);
});

test('the khrysos chronology problem is carried with the chain', () => {
  const c = getChain('hurasum-chrysos');
  assert.match(c.note, /PHOENICIAN PROPER IS IRON AGE/);
  assert.match(c.note, /West Semitic generally/);
  assert.match(c.note, /NO PIE etymology/i, 'D6 is why the direction still holds');
});

test('the sack entry is corrected: the dispute is the PRE-Semitic stage', () => {
  const s = getChain('sakkos-sack');
  assert.equal(s.confidence, 'probable');
  assert.match(s.note, /NOT what is disputed/);
  assert.match(s.note, /Černý|Vycichl/);
  assert.match(s.note, /Genesis 44/, 'the folk framing is named and refused');
  assert.match(s.note, /Grimm/, 'and the loan is internally datable');
});

test('the iron chain no longer over-reads de Vaan on ferrum', () => {
  const i = getChain('barzel-iron');
  assert.match(i.note, /ONE LEXICOGRAPHER/);
  assert.match(i.note, /do NOT extend the chain to Latin ferrum/i);
  assert.match(i.note, /unknown source/);
});

test('the *a diagnostic is formal and falsifiable, and its dispute is recorded', () => {
  assert.match(A_DIAGNOSTIC.rule, /PIE had no phonemic \*a and Proto-Semitic did/);
  assert.match(A_DIAGNOSTIC.worked, /táwros/);
  assert.match(A_DIAGNOSTIC.contested, /Van Sluis/);
  assert.match(A_DIAGNOSTIC.contested, /Kroonen/);
  assert.match(A_DIAGNOSTIC.contested, /Avestan staora/, 'the pivot is stated');
  assert.match(A_DIAGNOSTIC.status, /Direction DISPUTED/);
});

test('there is no inherited PIE word for iron in any branch — a clean zero', () => {
  assert.match(IRON_ZERO.significance, /clean zero/);
  assert.match(IRON_ZERO.corroboration, /Rigveda/);
  assert.match(IRON_ZERO.corroboration, /different times, by different routes/);
});

test('the four circularity traps in metal dating are named', () => {
  assert.equal(CIRCULARITY_WARNINGS.length, 4);
  assert.ok(CIRCULARITY_WARNINGS.some((w) => /calibrated against each other/.test(w)));
  assert.ok(CIRCULARITY_WARNINGS.some((w) => /not a proof/.test(w)));
  assert.ok(CIRCULARITY_WARNINGS.some((w) => /closed loop/.test(w)));
  assert.ok(CIRCULARITY_WARNINGS.some((w) => /INDEPENDENTLY ATTESTED/.test(w)));
});
