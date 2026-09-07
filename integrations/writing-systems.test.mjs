import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACROPHONY, LETTERS, CONFIDENCE_LEVELS, byConfidence, getLetter, firmAreEveryday,
  SERABIT, GREEK, ORDERS, DESCENDANTS, CHINESE, SINO_BABYLONIANISM,
} from './writing-systems.mjs';

test('all 22 letters are present, numbered in order, each graded', () => {
  assert.equal(LETTERS.length, 22);
  assert.deepEqual(LETTERS.map((l) => l.n), Array.from({ length: 22 }, (_, i) => i + 1));
  for (const l of LETTERS) {
    assert.ok(l.phoenician && l.meaning && l.glyph && l.greek, `letter ${l.n} malformed`);
    assert.ok(CONFIDENCE_LEVELS.includes(l.confidence), `letter ${l.n} bad confidence`);
  }
});

test('acrophony is proved by the same glyph giving different letters in different mouths', () => {
  assert.equal(ACROPHONY.divergences.length, 3);
  const house = ACROPHONY.divergences.find((d) => /house/.test(d.glyph));
  assert.match(house.semitic, /bayt/);
  assert.match(house.becomes, /beta/);
  const water = ACROPHONY.divergences.find((d) => /water/.test(d.glyph));
  assert.match(water.egyptian, /\/n\//);
  assert.match(water.semitic, /mayim/);
  assert.match(water.becomes, /mem/);
});

test('the asymmetry is recorded: Egypt did NOT do acrophony', () => {
  assert.match(ACROPHONY.theAsymmetry, /EGYPT DID NOT DO THIS/);
  assert.match(ACROPHONY.theAsymmetry, /non-literate borrower|NON-literate/i);
  assert.match(ACROPHONY.theAsymmetry, /mishearing is the alphabet/);
});

test('acrophony is held as inferential, not documented, with Gardiner’s own hedge', () => {
  assert.match(ACROPHONY.status, /INFERENTIAL/);
  assert.match(ACROPHONY.status, /never confirmed by a bilingual key/);
  assert.match(ACROPHONY.gardinerCaveat, /fortuitous/);
});

test('only seven letters are firm, and every one of them is an everyday concrete thing', () => {
  const firm = byConfidence('firm');
  assert.equal(firm.length, 7);
  const f = firmAreEveryday();
  assert.equal(f.allConcrete, true);
  assert.match(f.argument, /Labourers named what was in front of them/);
  // and the count of genuinely shaky ones must not be smaller than the firm ones
  assert.ok(byConfidence('disputed').length + byConfidence('unknown').length >= 7);
});

test('the three letters the literature itself calls unknown are flagged unknown', () => {
  const unknown = byConfidence('unknown').map((l) => l.phoenician);
  assert.deepEqual(unknown.sort(), ['qōp', 'sāmek', 'ṣādē']);
  assert.match(getLetter('ṣādē').note, /WEAKEST LETTER/);
  assert.match(getLetter('sāmek').note, /NO "fish" proposal/);
});

test('the camel story is refused by name', () => {
  const g = getLetter('gīml');
  assert.equal(g.confidence, 'disputed');
  assert.equal(g.meaning, 'throwstick');
  assert.match(g.note, /NOT "camel"/);
  assert.match(g.note, /Powell/);
  assert.match(g.note, /most-repeated wrong thing/);
});

test('the name-versus-shape splits are recorded rather than smoothed', () => {
  assert.match(getLetter('nūn').note, /name says fish and the glyph says snake/);
  assert.match(getLetter('ḥēt').note, /shape continues ḥaṣir.*name continues ḫayt/);
  assert.match(getLetter('hē').note, /citation-needed/);
  assert.match(getLetter('wāw').note, /no hieroglyphic prototype/);
});

test('SERABIT records the Hathor finding AND Gardiner’s retraction together', () => {
  assert.match(SERABIT.site, /TEMPLE OF HATHOR/);
  assert.match(SERABIT.theDecipherment, /bʿlt/);
  assert.match(SERABIT.theDecipherment, /Baʿalat/);
  assert.match(SERABIT.theDecipherment, /HATHOR/);
  assert.match(SERABIT.theFinding, /first readable word/);
  // the counterweight must be present in the same object
  assert.match(SERABIT.gardinersOwnVerdict, /unverifiable hypothesis/);
  assert.match(SERABIT.gardinersOwnVerdict, /no suggestions for the reading of any other word/);
});

test('the Serabit date is presented as a live 110-year argument, not a settled fact', () => {
  assert.match(SERABIT.stillDisputed, /Petrie/);
  assert.match(SERABIT.stillDisputed, /Gardiner/);
  assert.match(SERABIT.stillDisputed, /still running/);
  assert.match(SERABIT.doNotPublish, /Wadi el-Hol/);
});

test('the Greek names are the fossil that argues acrophony is real', () => {
  assert.match(GREEK.theFossil, /KEPT THE SEMITIC NAMES/);
  assert.match(GREEK.theFossil, /Alpha is not a Greek word/);
  assert.match(GREEK.theFossil, /STRONGEST SINGLE ARGUMENT/);
});

test('the Greek vowels were a mishearing, and the six cases are given', () => {
  assert.match(GREEK.vowels.why, /MISHEARING/);
  assert.equal(GREEK.vowels.cases.length, 6);
  const aleph = GREEK.vowels.cases.find((c) => /ʾāleph/.test(c.from));
  assert.match(aleph.to, /alpha/);
});

test('the red/blue split explains why Latin X is not chi', () => {
  assert.match(GREEK.theRedBlueSplit, /LATIN DESCENDS FROM THE RED BRANCH/);
  assert.match(GREEK.theRedBlueSplit, /403\/2 BCE/);
  assert.match(GREEK.theRedBlueSplit, /English X is \/ks\//);
});

test('Herodotus is right about the source and wrong about the date', () => {
  assert.match(GREEK.herodotus.cite, /V\.57–59/);
  assert.match(GREEK.herodotus.verdict, /RIGHT ABOUT THE SOURCE, WRONG ABOUT THE DATE/);
  assert.match(GREEK.herodotus.verdict, /true tradition about WHERE/);
  assert.match(GREEK.consensusDate, /8th century BCE/);
  assert.match(GREEK.consensusDate, /Dipylon/);
});

test('Ugarit proves the ORDER outlived the pictures', () => {
  assert.match(ORDERS.ugarit.what, /oldest attested alphabetic ordering/);
  assert.match(ORDERS.ugarit.theTwist, /NOT PICTURES OF ANYTHING/);
  assert.match(ORDERS.ugarit.theTwist, /finished doing it before Ugarit/);
  assert.match(ORDERS.ugarit.bothOrders, /abgad/);
  assert.match(ORDERS.ugarit.bothOrders, /halaham/);
});

test('the halaham order is a live 3,200-year transmission, checkable in Unicode', () => {
  assert.match(ORDERS.halaham.stillInUse, /U\+1200/);
  assert.match(ORDERS.halaham.stillInUse, /HA, LA, HHA, MA/);
  assert.match(ORDERS.halaham.theClaim, /3,200-YEAR/);
});

test('Brahmi took the model but not the mechanism, and Hangul is the counter-example', () => {
  const brahmi = DESCENDANTS.find((d) => d.id === 'brahmi');
  assert.equal(brahmi.acrophonic, 'NO');
  assert.match(brahmi.note, /ka, kha, ga/);
  assert.match(brahmi.note, /does not survive transplantation/);
  const hangul = DESCENDANTS.find((d) => d.id === 'hangul');
  assert.match(hangul.note, /ARTICULATORY DIAGRAMS/);
  assert.match(hangul.note, /named after oxen and houses/);
});

test('the Chinese table shows the arc 34% -> 82% -> 97%', () => {
  const sp = CHINESE.table.find((r) => r.principle === 'semantic-phonetic');
  assert.match(sp.shang, /34%/);
  assert.match(sp.xuShen, /82%/);
  assert.match(sp.kangxi, /97%/);
  const pic = CHINESE.table.find((r) => r.principle === 'pictographic');
  assert.match(pic.shang, /23%/);
  assert.match(pic.kangxi, /3%/);
  assert.match(CHINESE.source, /DeFrancis/);
});

test('the ideographic myth is refused in the sources’ own words', () => {
  assert.ok(CHINESE.deFrancis.some((q) => /never can be/.test(q)));
  assert.ok(CHINESE.deFrancis.some((q) => /100 percent syllabic/.test(q)));
  assert.match(CHINESE.boodberg, /sooner it is abandoned the better/);
});

test('the three Chinese numbers NOT to print are named', () => {
  assert.equal(CHINESE.doNotPrint.length, 3);
  assert.ok(CHINESE.doNotPrint.some((d) => /Wikipedia folklore/.test(d)));
  assert.ok(CHINESE.doNotPrint.some((d) => /66%/.test(d)));
  assert.ok(CHINESE.doNotPrint.some((d) => /Zhu Junsheng/.test(d)));
  assert.match(CHINESE.honestGap, /no attested antecedents/);
});

test('Sino-Babylonianism is kept as the control, and it fails on MECHANISM', () => {
  assert.match(SINO_BABYLONIANISM.who, /Terrien de Lacouperie/);
  assert.match(SINO_BABYLONIANISM.demolishedBy, /Legge/);
  assert.match(SINO_BABYLONIANISM.theKillingDetail, /INTERLOCKS a 12-cycle with a 10-cycle/);
  assert.match(SINO_BABYLONIANISM.theKillingDetail, /lcm\(10,12\)/, 'time-cycles.mjs computes this independently');
  assert.match(SINO_BABYLONIANISM.theAfterlife, /OMITTED THE EUROPEAN REFUTATIONS/);
  assert.match(SINO_BABYLONIANISM.whyItIsHere, /a number in common and no mechanism in common/);
  assert.match(SINO_BABYLONIANISM.doNotMisuse, /NOT a diffusionist/);
});

test('getLetter() resolves by Phoenician name or Latin reflex, and is soft on misses', () => {
  assert.equal(getLetter('ʾālep').latin, 'A');
  assert.equal(getLetter('M').meaning, 'water');
  assert.equal(getLetter('nope'), null);
  assert.deepEqual(byConfidence('nope'), []);
});
