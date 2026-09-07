// loanword-chains.mjs — WORDS THAT TRAVELLED, with their routes and their confidence.
//
// Fifth in the corpus series. pantheon-map asks who says these gods are one; time-cycles asks where
// a number came from; correspondences asks when a table was written down; divine-sets asks why the
// count is rigid. This one asks the hardest evidentiary question the corpus faces:
//
//   DID THIS WORD TRAVEL, WHICH WAY, AND HOW DO YOU KNOW?
//
// A borrowed word is the best contact evidence there is — better than a myth parallel, because a
// loanword carries its route in its phonology and its date in its attestation. A shared story can
// be independently invented. A shared irregular sound cannot.
//
// THE TRAP THIS FILE EXISTS TO AVOID — SUMEROGRAMS ARE NOT LOANWORDS.
// In an Akkadian text, LUGAL, É.GAL, URU and DINGIR are usually SUMERIAN SIGNS used to WRITE an
// Akkadian word that was read aloud as šarru, ekallu, ālu, ilu. That is a spelling convention, not
// a borrowing. Akkadian ālum "city" is inherited from Proto-Semitic *ʔahl- (cognate Hebrew ʾōhel
// "tent", Arabic ʾahl) even though it is written with the Sumerian sign URU; šarrum is from
// Proto-Semitic *śarār-, not from Sumerian lugal. Reference works — Wiktionary's Sumerian sign
// pages among them — routinely conflate the two. `SUMEROGRAM_TRAP` names the specific cases.
//
// CONFIDENCE IS THE POINT, again. 'secure' means the direction and the route are both established.
// 'probable' means the borrowing is agreed and the route is not. 'disputed' means scholars disagree
// on the donor. 'rejected' means a popular etymology that the standard lexica do not support — and
// those are kept, because a corpus that only records the wins will repeat the losses.
//
//   import { CHAINS, byConfidence, routesThrough, rejected, SUMEROGRAM_TRAP } from './loanword-chains.mjs'
//
// SECURITY / DISCIPLINE: pure data, no network, no clock, no keys.

export const CONFIDENCE = ['rejected', 'disputed', 'probable', 'secure'];
export const confidenceRank = (c) => CONFIDENCE.indexOf(c);

export const CHAINS = [
  // ── The three-step chains: Sumerian → Akkadian → West Semitic. The corpus's best material. ───
  {
    id: 'ekallum', gloss: 'palace, great house',
    route: ['Sumerian e₂-gal ("big house")', 'Akkadian ēkallum', 'Hebrew hēḵāl / Aramaic hēḵəlā / Arabic haykal'],
    confidence: 'secure',
    note: 'The Jerusalem Temple\'s Hebrew name is, etymologically, "the big house" — a Sumerian compound of e₂ "house" and gal "great", carried west through Akkadian. This is the single most quotable loanword in the corpus.',
  },
  {
    id: 'kussum', gloss: 'throne, seat',
    route: ['Sumerian ᵍᵉšgu-za', 'Akkadian kussûm', 'Ugaritic kussiʔu / Hebrew kissēʾ / Syriac kursəyā / Arabic kursiyy'],
    confidence: 'secure',
    note: 'The Throne Verse of the Qurʾān, āyat al-kursī, names its throne with a Sumerian word.',
  },
  {
    id: 'kitum-chiton', gloss: 'flax, linen, and the garment made of it',
    route: ['Sumerian gada', 'Akkadian kitûm', 'Central Semitic *kittān (Hebrew kuttṓneṯ, Aramaic kittōnā)', 'Greek khitṓn', 'probably Latin tunica'],
    confidence: 'probable',
    note: 'The Greek word for a shirt goes back at three removes to the Sumerian word for flax. The Latin step is the loose one.',
  },
  { id: 'malahum', gloss: 'sailor', route: ['Sumerian ma-laḫ₄ ("boat-mover")', 'Akkadian malāḫum', 'Aramaic mallāḥā / Hebrew mallāḥ / Arabic mallāḥ'], confidence: 'secure' },
  { id: 'ikkarum', gloss: 'farmer, ploughman', route: ['Sumerian engar', 'Akkadian ikkarum', 'Aramaic ʾikkārā / Syriac ʾakkārā'], confidence: 'secure' },
  { id: 'passurum', gloss: 'table', route: ['Sumerian banšur', 'Akkadian paššūrum', 'Aramaic pāṯūrā / Arabic fāṯūr'], confidence: 'secure' },
  { id: 'igarum', gloss: 'wall', route: ['Sumerian e₂-gar₈', 'Akkadian igārum', 'Aramaic ʾeggārā / Arabic ijjār'], confidence: 'secure' },
  {
    id: 'annakum', gloss: 'tin',
    route: ['Sumerian anna', 'Akkadian annakum', 'Hebrew ʾănāḵ / Aramaic ānḵā / Classical Armenian անագ / Sanskrit nāgá'],
    confidence: 'secure',
    note: 'A metal name reaching Sanskrit and Armenian from Sumerian — the trade-route shape of the evidence, visible in one word.',
  },
  { id: 'tarlugallum', gloss: 'rooster', route: ['Sumerian dar-lugalᵐᵘšᵉⁿ ("royal francolin")', 'Akkadian tarlugallum', 'Hebrew tarnəgōl / Syriac tarnāḡlā'], confidence: 'secure' },
  {
    id: 'nisannu', gloss: 'the first month',
    route: ['Sumerian nesag̃ ("first-fruit offering")', 'Akkadian nisannum', 'Aramaic / Hebrew nīsān'],
    confidence: 'secure',
    note: 'ALL TWELVE Hebrew month names are Babylonian, adopted during the sixth-century BCE exile. Tammuz is still, etymologically, the Sumerian dying god Dumuzi, DUMU.ZID, "the true son".',
  },

  // ── Akkadian → Greek ─────────────────────────────────────────────────────────────────────────
  {
    id: 'qanum-canon', gloss: 'reed — hence measuring rod, hence rule',
    route: ['Akkadian qanûm ("reed")', 'Greek kánna / kanṓn', 'Latin canna / canōn', 'English cane, canal, cannon, CANON'],
    confidence: 'secure',
    note: 'The canon of scripture, of law, and of literature all begin as a Mesopotamian reed used as a measuring rod — reed → measuring rod → standard → canon, with Ezekiel\u2019s measuring reed (Hebrew qaneh) as the hinge. Already in Mycenaean: the derivative ko-no-ni-pi dates it before c. 1200 BCE. TWO CAVEATS: Beekes notes it may have come through a Pre-Greek, perhaps Anatolian intermediary rather than directly; and Sumerian gin as the ULTIMATE source is probable at best, not secure.',
  },
  {
    id: 'kamunu-cumin', gloss: 'cumin',
    route: ['Akkadian kamūnu', 'Greek kýminon', 'Latin cuminum', 'English cumin'],
    confidence: 'secure',
    note: 'Attested in Mycenaean as ku-mi-no. The Linear B window is c. 1450–1200 BCE with the earliest inscription 1400–1350, so this tightens to "plausibly by 1400 BCE". REFINEMENT: Hebrew kammōn comes via ARAMAIC kammōnā, not directly from Akkadian. Cited to Rosół, Frühe semitische Lehnwörter im Griechischen (2013).',
  },
  {
    id: 'shamashshammu-sesame', gloss: 'sesame',
    route: ['Akkadian šamaššammū ("oil plant", šamnum "oil" + šammum "plant")', 'Aramaic šūššmā', 'Greek sḗsamon', 'English sesame'],
    confidence: 'secure',
  },
  {
    id: 'manu-mina', gloss: 'the mina, a unit of weight',
    route: ['Akkadian manû', 'Sumerian ma-na (borrowed FROM Akkadian)', 'Aramaic מנה', 'Greek mnâ', 'Latin mina'],
    confidence: 'secure',
    note: 'Note the direction inside Mesopotamia: this one went Akkadian → Sumerian, not the other way. Weights and measures travel with trade, and trade vocabulary is where Akkadian pushes back into Sumerian.',
  },
  {
    id: 'hurasum-chrysos', gloss: 'gold',
    route: ['Akkadian ḫurāṣum / Hebrew ḥārûṣ', 'a Phoenician or Punic intermediary', 'Proto-Greek *kʰrūsós', 'Greek khrysós'],
    confidence: 'probable',
    note: 'DIRECTION SECURE for the best possible reason (D6): Greek khrysós has NO PIE etymology and no cognate outside Greek — there is nothing to inherit it from — while the Semitic ḫ/ḥ-r-ṣ set (Akkadian ḫurāṣu, Ugaritic ḫrṣ, Hebrew ḥārūṣ, Phoenician 𐤇𐤓𐤑) is internally well-behaved. BUT carry the chronological problem: the word is Mycenaean (ku-ru-so), i.e. before c. 1200 BCE, and PHOENICIAN PROPER IS IRON AGE. The label "Phoenician" here must mean West Semitic generally, with a second-millennium Canaanite or Ugaritic-stage donor.',
  },
  { id: 'shipirtu-sapphire', gloss: 'lapis lazuli, later sapphire', route: ['Assyrian šipirtu', 'Hebrew sappîr', 'Greek sáppheiros', 'English sapphire'], confidence: 'probable' },

  // ── Wanderwörter: agreed to have travelled, direction unresolved ──────────────────────────────
  {
    id: 'barzel-iron', gloss: 'iron',
    route: ['probably Anatolian', 'Akkadian parzillum', 'Ugaritic brḏl / Phoenician brzl / Hebrew barzel / Syriac parzəlā'],
    confidence: 'probable',
    note: 'No Semitic root can be reconstructed for it, which is the diagnostic: the word arrived with the technology. But the Anatolian origin is ONE LEXICOGRAPHER\u2019S ASSUMPTION (Klein), not a consensus. And do NOT extend the chain to Latin ferrum: that over-reads de Vaan, whose headline judgment is "borrowed from substrate language, of an unknown source", with a Phoenician route only subordinate and an Etruscan intermediary invoked. Semitic b-r-z-l against Latin f-r-r is a four-consonant frame against three.',
  },
  {
    id: 'sakkos-sack', gloss: 'sack, sackcloth',
    route: ['a Semitic donor — Akkadian šaqqu, Hebrew śaq, Egyptian sꜣgꜣ all in play', 'Greek sákkos', 'Latin saccus', 'English SACK, French sac'],
    confidence: 'probable',
    note: 'CORRECTED. The Semitic → Greek step is NOT what is disputed — Beekes has it as "most likely borrowed from a Semitic language, possibly Phoenician". The dispute is over the PRE-Semitic stage: Černý and Forbes propose an ultimate Egyptian origin (sꜣq "to gather") transmitted via Semitic; Vycichl and Hoch reject it. And drop the "most-travelled word" framing — it traces to a folk explanation that the spread is "due to the incident in the Biblical story of Joseph in which a sack of corn figures". Roman commerce accounts for the distribution without Genesis 44. The Germanic loan is internally datable: Proto-Germanic *sakkuz keeps -kk-, so it POSTDATES Grimm\u2019s Law.',
  },
  {
    id: 'gypsos-gypsum', gloss: 'gypsum',
    route: ['Akkadian gaṣṣu (IM.BABBAR)', 'Classical Syriac ܓܨܐ', 'Greek gýpsos', 'English gypsum'],
    confidence: 'disputed',
    note: 'Labelled a Wanderwort rather than a clean loan — the route is plausible and unproven.',
  },
  {
    id: 'cannabis', gloss: 'hemp',
    route: ['Akkadian qunnabu (an aromatic; etymology unknown)', '? Scythian or Thracian', 'Greek kánnabis', 'English cannabis'],
    confidence: 'disputed',
    note: 'The Akkadian word is real and plausibly related. The DIRECTION is undetermined — Herodotus points to Scythian, and one reading assigns it to a pre-Indo-European agricultural layer. Do not write "cannabis comes from Akkadian" flatly.',
  },

  // ── Punic → Berber: only about a dozen words, and the semantic field is the finding ───────────
  {
    id: 'almed', gloss: 'to learn; to get used to',
    route: ['Punic 𐤋𐤌𐤃 lmd (cf. Hebrew lāmáḏ)', 'Proto-Berber *ălməd', 'Kabyle lmed / Tashelhit lmd / Tarifit řmed / Awjila əlméd / Ghadames ălmǝd / Tamasheq ǝlmǝd'],
    confidence: 'probable',
    note: 'Attested across Northern, Eastern AND Tuareg Berber, so it predates the modern dispersal.',
  },
  {
    id: 'aghre', gloss: 'to call, to shout — and to READ',
    route: ['Punic 𐤒𐤓𐤀 qrʾ (cf. Hebrew qārāʾ)', 'Proto-Berber *ăɣrəʔ', 'ɣer / ɣar / aʔri across Northern, Eastern, Tuareg and Western Berber'],
    confidence: 'disputed',
    note: 'The honest analysis is a SPLIT: the root may be inherited from Proto-Afroasiatic *ḳ-r-ʔ "to shout, to call" (compare Proto-Chadic *kVwVr) with only the READING sense borrowed from Semitic. Same word, two histories.',
  },
  {
    id: 'agadir', gloss: 'wall; fort, fortress; collective granary',
    route: ['Punic 𐤂𐤃𐤓 gdr "wall" — the same root as GADES/Cádiz and Hebrew gādēr', 'Proto-Berber *a-gadir', 'Ghadames, C. Atlas Tamazight, Tarifit, Sokna, Siwi, Tamasheq, Tamahaq, Tayert, Tawellemmet', 'Arabic ʔakādīr; the Moroccan city Agadir'],
    confidence: 'probable',
    note: 'The Phoenician word for a walled place gave its name to Cádiz at the western end of the Mediterranean AND to Agadir on the Atlantic coast of Morocco — the same root marking both ends of the Punic reach.',
  },

  // ── Rejected: popular etymologies the standard lexica do not support ──────────────────────────
  {
    id: 'sindon', gloss: 'fine linen — the word used of the burial cloth in the Gospels',
    route: ['NOT Akkadian saddinnu', 'Beekes: possibly Egyptian šnḏwt ("kilt")', 'compare Hebrew sadin'],
    confidence: 'rejected',
    note: 'The Akkadian derivation is repeated constantly in Shroud literature. Beekes\'s Etymological Dictionary of Greek does not mention Akkadian at all. The India/Sindh derivation has no support either.',
  },
  {
    id: 'naphtha', gloss: 'naphtha, petroleum',
    route: ['NOT directly Akkadian naptu', 'Old Persian *naftah ("petroleum")', 'Greek náphtha'],
    confidence: 'rejected',
    note: 'The Akkadian word exists; the immediate donor to Greek is Iranian.',
  },
  {
    id: 'nabla', gloss: 'a ten- to twelve-string harp — and the name of the ∇ operator',
    route: ['NOT Akkadian', 'Hebrew nēḇel', 'Greek nábla'],
    confidence: 'rejected',
    note: 'Straightforwardly Hebrew or Phoenician. No Akkadian link is stated in the lexica, and none is hedged for.',
  },
  {
    id: 'saros', gloss: 'the 18-year eclipse cycle',
    route: ['Babylonian šār is the NUMBER 3600, not an eclipse period', 'the Suda, an 11th-c. Byzantine lexicon', 'Edmond Halley, 1686, misapplying it'],
    confidence: 'rejected',
    note: 'THE MODEL CASE. Le Gentil objected in 1756 that the application was wrong. He was right, and the term is still in use three centuries later. A modern misreading of a Byzantine lexicon, fossilised as a technical term — exactly the failure mode this corpus is built to catch.',
  },
  {
    id: 'sar-sharru', gloss: 'Hebrew śar "prince" and Akkadian šarru "king"',
    route: ['NOT a loan in either direction', 'both from Proto-Semitic *śarār- "to rule over"'],
    confidence: 'rejected',
    note: 'Cognate, not borrowed. Kept here because the distinction between cognacy and borrowing is exactly what the corpus keeps needing to make.',
  },
];

export const getChain = (id) => CHAINS.find((c) => c.id === id) || null;
export const byConfidence = (c) => CHAINS.filter((x) => x.confidence === c);
export const rejected = () => byConfidence('rejected');

/** Chains whose route passes through a named language or stage. */
export function routesThrough(term) {
  const t = term.toLowerCase();
  return CHAINS.filter((c) => c.route.some((step) => step.toLowerCase().includes(t)));
}

/** The three-step Sumerian → Akkadian → West Semitic chains, which are the strongest set. */
export function threeStepChains() {
  return CHAINS.filter((c) => c.route.length >= 3
    && /sumerian/i.test(c.route[0])
    && confidenceRank(c.confidence) >= confidenceRank('probable'));
}

// ── The trap ───────────────────────────────────────────────────────────────────────────────────
export const SUMEROGRAM_TRAP = {
  what: 'A Sumerogram is a Sumerian sign used to WRITE an Akkadian word. The scribe wrote LUGAL and read šarru. It is a spelling convention, not a borrowing, and treating it as one manufactures loanwords that never existed.',
  cases: [
    { sign: '𒈗 LUGAL', writes: 'Akkadian šarrum "king"', actuallyFrom: 'Proto-Semitic *śarār- "to rule over"' },
    { sign: '𒌷 URU', writes: 'Akkadian ālum "city"', actuallyFrom: 'Proto-Semitic *ʔahl- "tent camp" — cognate Hebrew ʾōhel "tent", Arabic ʾahl "people"' },
    { sign: '𒀭 DINGIR', writes: 'Akkadian ilum "god"', actuallyFrom: 'Proto-Semitic *ʔil-' },
  ],
  contrast: 'The GENUINE loans look different: ēkallum, ṭuppum, kussûm, ikkarum are borrowed words with Akkadian case endings, and the lexica mark them as borrowings. The test is whether the Akkadian word has a Semitic etymology of its own — if it does, the Sumerian sign is only how it was spelled.',
  whoGetsItWrong: 'Wiktionary\'s Sumerian sign pages list šarrum under 𒈗 and ālum under 𒌷 as "descendants". Do not propagate that.',
};

// ── The lexical lists: the oldest dictionaries, and the ancient comparative method ──────────────
export const LEXICAL_LISTS = [
  { id: 'urra', name: 'HAR(UR₅)-ra = ḫubullu', entries: 9700, tablets: 24, principle: 'thematic',
    note: 'Trees, vehicles, vessels, animals, stones, plants, textiles, places, provisions, personal names. The Ugarit recension is Sumerian/HURRIAN rather than Sumerian/Akkadian.' },
  { id: 'nabnitu', name: 'SIG₇+ALAN (ulutim) = nabnītu', entries: 10500, tablets: 54, principle: 'thematic and etymological',
    note: 'Body parts. Uniquely ordered in etymological sequence — and the columns run AKKADIAN first, Sumerian second.' },
  { id: 'diri', name: 'Diri', entries: 2100, tablets: 7, principle: 'compound signs' },
  { id: 'ea', name: 'Ea / Aa', entries: 2400, tablets: 8, principle: 'sign list with pronunciation glosses',
    note: 'Three columns: Sumerian gloss, Sumerian sign, Akkadian translation.' },
  { id: 'lu-a', name: 'LÚ A', entries: 140, tablets: null, principle: 'thematic — professions',
    note: 'THE STRIKING ONE. 185 exemplars from Uruk IV onward, copied "virtually unchanged" for a thousand years. One of the earliest written documents in existence, and a word list.' },
  { id: 'erimhus', name: 'Erim-ḫuš = anantu', entries: null, tablets: 7, principle: 'synonym — a thesaurus for rare literary words' },
  { id: 'antagal', name: 'An-ta-gál = šaqû', entries: null, tablets: 10, principle: 'synonym and antonym' },
  { id: 'malku', name: 'Malku = šarru', entries: null, tablets: 8, principle: 'synonym, MULTILINGUAL',
    note: 'About ten percent of its content is drawn from West Semitic, Kassite, Hurrian, Hittite and Elamite. This is comparative lexicography, tagging foreign vocabulary from five languages, in the second millennium BCE.' },
];

export const LEXICAL_LISTS_NOTE =
  'The lexical lists are the oldest literary texts from Mesopotamia — the Fara and Abū Ṣalābīkh lists date to c. 2600 BCE — and the genre ran continuously into the Seleucid period, roughly 2,500 years. The bilingual format (Sumerian entry, Akkadian equivalent, sometimes a pronunciation gloss and a sign name) is a dictionary in the modern sense, and it is why Sumerian could be deciphered at all: the ancient scribes had already translated it.';

/**
 * The Punic layer in Berber is TINY — about a dozen words — and that is the finding, not a
 * disappointment. What Carthage gave the Berbers, lexically, was: how to learn, how to read, and
 * how to build a wall. Overall Punic influence on Berber is negligible; Latin/African Romance left
 * at least forty (afullus "chicken" < pullus, ɣasru "castle" < castrum, anǧelus "angel" < angelus),
 * and Arabic left between nothing and fifteen per cent depending on the dialect. A corpus arguing
 * for deep Punic-Berber fusion has to explain why the vocabulary does not show it.
 */
export const PUNIC_IN_BERBER = {
  count: 'about a dozen probable Phoenician-Punic loanwords',
  semanticField: ['to learn', 'to read', 'to fortify / to wall'],
  verdict: 'Punic gave Berber literacy and masonry vocabulary and almost nothing else.',
  contrast: 'Latin and African Romance left at least 40 words per Brugnatelli and Kossmann; Arabic ranges from 0-5% (Ghadames, Awjila) to over 15% (Ghomara, Siwi, Senhaja de Srair).',
  soWhat: 'Lexical borrowing tracks what one culture actually took from another. The Punic layer says school and fortification, which is precisely what a colonial trading power exports and precisely NOT what a shared religion would look like.',
};

// ── DATED ANCHORS ──────────────────────────────────────────────────────────────────────────────
// The rarest and most valuable thing in historical linguistics: a word that pins a DATE, because it
// sits in a dated document or because it names a technology whose first appearance is excavated.
// Most etymology gives you an order of events. These give you years.

export const DATED_ANCHORS = [
  {
    id: 'indo-iranian-unity',
    what: 'The end of Proto-Indo-Iranian linguistic unity, bracketed to roughly 2000 – 1761 BCE.',
    floor: {
      date: 'c. 2000 BCE',
      evidence: 'The earliest spoke-wheeled chariots, at Sintashta — Krivoe Ozero kurgan 9 grave 1, Sintashta SM graves 5, 19, 28, Kamenny Ambar 5 kurgan 2 grave 8 (¹⁴C 3760±120, 3740±50, 3700±60 BP).',
      logic: 'The Indo-Aryan and Iranian chariot vocabularies are INHERITED from a common ancestor, not independently borrowed. So the split has to postdate the technology the shared words name.',
    },
    ceiling: {
      date: 'c. 1761 BCE',
      evidence: 'The word mariannu in a letter from Tell Leilān in northern Syria, dated shortly before the end of Zimri-Lim\u2019s reign (Eidem 2014: 142).',
      logic: 'Hurrianised Indo-Aryan *marya- "man, youth" plus the Hurrian ending -nnu. A dated archive text, not a linguistic inference — and it puts Indo-Aryan in Syria two centuries BEFORE the Mitanni state existed.',
    },
    confidence: 'secure',
    source: 'Kroonen, Barjamovic & Peyrot, "Linguistic supplement to Damgaard et al. 2018", Zenodo 10.5281/zenodo.1240524',
    whyItMatters: 'A ~240-year window, closed from opposite sides by two completely independent kinds of evidence: a wheel in a grave and a word in a dated letter. This is what a real chronological argument looks like, and it is the standard the rest of the corpus should be measured against.',
  },
  {
    id: 'kikkuli',
    what: 'The oldest substantial Indo-Aryan text we possess — the Kikkuli horse-training manual (CTH 284).',
    dating: 'Lost Middle-Hittite original, 15th century BCE; the surviving tablets are a Neo-Hittite copy written in the 13th century BCE (Neu 1986: 161).',
    confidence: 'secure',
    correction: 'NOT "c. 1400 BCE" — that is a midpoint of an unexplained range. And Šuppiluliuma I has no connection to Kikkuli; he belongs to the treaty evidence.',
    theNumerals: [
      { translit: 'a-i-ka-a-ar-ta-an-na', gloss: 'one round', vedic: 'éka-' },
      { translit: 'ti-e-ra-a-ar-ta-an-na', gloss: 'three rounds', vedic: 'trī-' },
      { translit: 'pa-an-za-a-ar-ta-an-na', gloss: 'five rounds', vedic: 'páñca-' },
      { translit: 'ša-at<-ta>-a-ar-ta-an-na', gloss: 'seven rounds', vedic: 'saptá-' },
      { translit: 'na-a-[w]a-ar-ta-an-na', gloss: 'nine rounds', vedic: 'náva-' },
    ],
    transliterationNote: 'It is -artanna, not -wartanna. The w belongs to the reconstructed etymon (Vedic vartaní- "course, felloe") and surfaces only in the "nine" form. Printing aika-wartanna prints a normalised etymological form, not the transliteration — say which you are giving.',
    theRealPoint: 'Nobody at Ḫattuša spoke Indo-Aryan. Kikkuli\u2019s mother tongue was almost certainly Hurrian, each of the four tablets was written by a different Hurrian-speaking scribe, and the court language was Hurrian. The Indo-Aryan terms were "piously handed down as fossils" (Kammenhuber) — frozen into distance measurements, which is exactly why ONLY the odd numbers 1/3/5/7/9 occur. The oldest Indo-Aryan we have survived because it was technical jargon: a horse trainer needs a fixed word for a lap and does not translate it.',
    theDiagnostic: 'PIE had two derivatives of *h₁oi- "one": a -ko- form and a -wo- form. Indo-Aryan generalised -ko- (Vedic éka-), Iranian generalised -wo- (Avestan aēva-). Mitanni a-i-ka- is the -ko- form with the diphthong still uncontracted — older than Vedic. A second, independent narrow-Indo-Aryan diagnostic: the royal name bi-ir-ya-ma-aš-da = Priyamedha, where /azdʰ/ → [eːdʰ] is regular in Vedic specifically.',
    contested: 'The form is secure; the INDO-ARYAN-SPECIFIC inference is probable rather than certain. Mayrhofer and Lubotsky read Indo-Aryan; Kammenhuber reads a still-undivided Indo-Iranian; Kroonen et al. deliberately hedge to "Indo-Iranian, or possibly Indo-Aryan".',
    sourceWarning: 'Raulwing 2009 has a copy-paste error in its §5 — it glosses the 5-, 7- and 9- compounds all as "three rounds" while giving the correct Vedic comparanda. §8 of the same paper is correct. Do not quote §5 verbatim.',
  },
  {
    id: 'anse-kur-ra',
    what: 'The horse arrives in Mesopotamia as a named import.',
    dating: 'The logogram ANŠE.KUR.RA first appears in Sumerian documents in the Third Dynasty of Ur, c. 2100–2000 BCE; horses are imported in bulk after 2000 BCE with chariot warfare, displacing the kunga.',
    confidence: 'secure',
    whyItMatters: 'ANŠE.KUR.RA means "ass of the mountains" — the donkey of the foreign land. A culture that names an animal "the foreign donkey" is telling you, in the name itself, that the animal is an import. That is better evidence for direction of travel than any contested etymology, and it also explains why the Hittite phonetic horse-word is invisible in the tablets: the scribes had a serviceable Sumerogram and used it.',
  },
  {
    id: 'anatolian-at-ebla',
    what: 'Anatolian Indo-European personal names at Ebla in the 25th century BCE.',
    dating: '25th century BCE — names with the elements -(w)anda/u, -(w)aššu, -tala, -ili/u: A-la-lu-wa-du, Ar-zi-tá-la, Mu-lu-wa-du, Ù-la-ma-du (Archi).',
    confidence: 'probable',
    whyItMatters: 'Kroonen et al.: this "decisively falsifies the Yamnaya culture as a possible archaeological horizon for PIE-speakers prior to the Anatolian Indo-European split", and places Proto-Anatolian unity in the 4th millennium BCE.',
    consequence: 'RE-SCOPES the famous wheel argument rather than refuting it. Anthony\u2019s ~3500 BCE floor, derived from the shared *kʷekʷlos vocabulary, dates CORE PIE — the post-Anatolian node — not Proto-Indo-Anatolian. Anatolian conspicuously does NOT share *kʷekʷlos (the only candidate is a hedged Hittite "lard biscuit") while it DOES share *yugóm and the horse word. The floor still holds for the node it applies to; that node is simply shallower than the popular version implies.',
    contested: 'The Indo-Anatolian hypothesis — Anatolian as a SISTER rather than a daughter of PIE — is the contested part. That Anatolian split off first is not: "the vast majority of Indo-Europeanists would still agree that Anatolian is the most likely branch to have split off first."',
  },
];

export const getAnchor = (id) => DATED_ANCHORS.find((a) => a.id === id) || null;

/**
 * The direction-of-borrowing diagnostics, as used above. Morphological transparency is the
 * strongest of them: a word built by a LIVING rule in language A and unanalysable in language B
 * went from A to B, and no amount of cultural argument overturns that.
 */
export const DIRECTION_TESTS = [
  { id: 'transparency', test: 'Is the word morphologically transparent in one language and opaque in the other?',
    example: 'Egyptian mrkbt "chariot" is opaque in Egyptian — no root r-k-b, no pattern that generates it. In Northwest Semitic *markabt- it is a productive maqtal-t noun-of-instrument from the living root r-k-b "to ride". Semitic → Egyptian, decisively.' },
  { id: 'irregular-correspondence', test: 'Does the word violate the regular sound laws of the language it appears in?',
    example: 'A word that should have shifted and did not was borrowed after the shift finished — which also dates the borrowing.' },
  { id: 'restricted-distribution', test: 'Is it confined to one branch or one semantic field rather than spread across the family?' },
  { id: 'cultural-semantics', test: 'Does it name a trade good, a technology or an institution? Those travel; body parts and kin terms mostly do not.' },
  { id: 'the-name-says-so', test: 'Does the word itself describe the thing as foreign?',
    example: 'ANŠE.KUR.RA, "ass of the mountains". The clearest possible statement of import, made by the borrowers.' },
];

/**
 * THE SILVER PAIR — the best teaching object in the subject, because both halves sit in the same
 * semantic slot in the same region and one of them is perfectly behaved.
 *
 * The irregularity IS the evidence, not a defect in it. An irregular correspondence is not a gap
 * awaiting better reconstruction; it is a positive signal saying THIS WORD TRAVELLED SIDEWAYS
 * between speech communities rather than downward through one.
 */
export const SILVER_PAIR = {
  inherited: {
    form: 'PIE *h₂erǵ-n̥t-om',
    reflexes: ['Latin argentum', 'Greek árgyros (Mycenaean a-ku-ro)', 'Sanskrit', 'Armenian arcatʿ'],
    behaviour: 'Perfectly regular across every branch it reaches. Related to Hittite ḫarki- "white".',
    absent: 'Missing precisely in Germanic and Balto-Slavic — the branches the Wanderwort covers.',
  },
  wanderwort: {
    forms: ['Proto-Germanic *silubrą', 'Balto-Slavic *sirabras ~ *sudrab- ~ *sudabr-', 'Lithuanian sidãbras', 'Latvian sidrabs AND sudrabs', 'Old Prussian siraplis', 'Proto-Slavic *sьrebrò', 'Basque zilar', 'Celtiberian silabur', 'Proto-Berber *a-ẓrəf'],
    irregularities: [
      'second consonant: l : r',
      'third consonant: d : p : ∅',
      'vowel: i : u — unresolved even WITHIN Latvian',
      'the reconstruction itself must be written with unresolved metathesis',
    ],
    theKicker: 'When a reconstruction requires an "or" between metathesised variants, it is not a reconstruction — it is a description of noise. Noise of exactly the kind that repeated re-borrowing produces.',
    distribution: 'Germanic + Baltic + Slavic + Basque + Celtiberian + Berber. That is a MAP, not a tree.',
    candidateSources: [
      'an unidentified European substrate',
      'Akkadian ṣarpu(m) "to smelt, refine" — rejected by some as phonologically and geographically implausible',
      'a Paleo-Hispanic / Basque-area source — called "speculative"',
      'a Berber connection',
    ],
    verdict: 'DIRECTION UNKNOWN — not "disputed between two candidates", genuinely unknown.',
  },
  whyItTeaches: 'Two words for one metal in one region: one regular across the family, one so irregular its reconstruction needs an "or". Print them side by side and the entire method is visible in a single table.',
};

/**
 * THE MYCENAEAN LAYER — the pattern carries more than any single etymology in it.
 *
 * A Semitic gold-word, an Anatolian lead-word, a Mesopotamian reed-word, a Mediterranean flax-word
 * and a Near Eastern spice-word, ALL IN GREEK PALACE ACCOUNTING DOCUMENTS BEFORE 1200 BCE — four
 * centuries before the alphabet. The contact mechanism is attested, dated, and administrative.
 */
export const MYCENAEAN_LAYER = {
  window: 'Linear B spans c. 1450–1200 BCE. Knossos Room of the Chariot Tablets 1425–1390; earliest inscription (Iklaina) 1400–1350; Pylos, Mycenae and Thebes tablets from the terminal destructions c. 1200.',
  attestations: [
    { linearB: 'wo-no', greek: 'oînos', gloss: 'wine', status: 'direction unknown, but IN GREEK by the Bronze Age' },
    { linearB: 'ku-ru-so', greek: 'khrysós', gloss: 'gold', status: 'Semitic loan — and its pre-1200 date is what forces "Phoenician" to mean West Semitic generally' },
    { linearB: 'a-ku-ro', greek: 'árgyros', gloss: 'silver', status: 'INHERITED — the control, showing the Wanderwort never reached Greek' },
    { linearB: 'ka-ko', greek: 'khalkós', gloss: 'copper', status: 'eastern-substrate loan; Beekes calls the etymology "Unknown"' },
    { linearB: 'mo-ri-wo-do', greek: 'mólybdos', gloss: 'lead', status: 'Lydian mariwda- "dark" — and the Mycenaean form preserves the -r- and -w- later Greek loses' },
    { linearB: 'ri-no', greek: 'línon', gloss: 'linen', status: 'Mediterranean Wanderwort, donor unknown' },
    { linearB: 'ko-no-ni-pi', greek: 'kanṓn (derivative)', gloss: 'reed / rod', status: 'the canon word, pre-1200 BCE' },
    { linearB: 'ku-mi-no', greek: 'kýminon', gloss: 'cumin', status: 'Akkadian kamūnu, plausibly by 1400 BCE' },
  ],
  theArgument: 'No single etymology here carries as much as the pattern does. Bronze Age Greek palace scribes were already writing down borrowed words for gold, lead, linen, reeds and cumin from four different directions. Whatever one thinks of any individual derivation, the contact is not in question — it is in the accounts.',
};

/**
 * THE *a DIAGNOSTIC — the sharpest single tool, and it is FORMAL rather than a plausibility judgment.
 *
 * After laryngeal theory, almost every instance of reconstructed *a reduces to *e beside *h₂. The
 * scholarly conclusion is blunt: "There are thus no grounds for PIE phoneme *a." The residue — words
 * with an *a no laryngeal explains — does not participate in ablaut, appears only in limited
 * positions, and usually has reflexes in only a few branches. Those words "may have been borrowed
 * from some other language which had phonemic *a (like Proto-Semitic)".
 *
 * Proto-Semitic HAD phonemic /a/. PIE, on the majority reconstruction, did not. So an unexplained
 * *a in a PIE etymon is a live, falsifiable borrowing signal — and it is exactly the argument that
 * flags *táwros "bull": "the unconditioned /a/ suggests a non-Indo-European source."
 */
export const A_DIAGNOSTIC = {
  rule: 'An unconditioned *a in a reconstructed PIE etymon is a borrowing signal, because PIE had no phonemic *a and Proto-Semitic did.',
  worked: '*táwros "wild bull" — PIE-shaped, but with an /a/ no laryngeal explains, beside Proto-Semitic *ṯawr-.',
  contested: 'Van Sluis reads the regular inter-branch correspondences as an EARLY borrowing, before the branches split; Kroonen reads the Celtic and Germanic irregularity as proving it spread AFTER the family broke up. And de Vaan says flatly there is no Indo-Iranian cognate, while others list PIIr. *stáwras with Davies flagging it irregular. Whether Avestan staora belongs is the pivot: if it does not, the word is confined to WESTERN Indo-European and the loan reading strengthens sharply.',
  status: 'Wanderwort status SECURE. Direction DISPUTED. Date of borrowing actively contested.',
};

/** Four ways the metal-dating argument goes circular. Named so the corpus does not walk into them. */
export const CIRCULARITY_WARNINGS = [
  'The PIE date and the PIE lexicon are calibrated against each other. The iron argument is CONSISTENT with the standard chronology; it is not independent evidence for it.',
  'Absence of a reconstruction is not absence from the protolanguage. "Not reconstructible therefore not present" is a default, not a proof.',
  'A closed loop in the tin case: the substrate hypothesis is offered BECAUSE of the tin-bronze technology of the region, then cited as evidence about that technology\u2019s linguistic footprint.',
  '"Named for redness or darkness" is a repeating just-so pattern — Celtic *īsarnom from "blood", Greek sídēros from *sida "red", Lydian mariwda- "dark". Where the colour word is INDEPENDENTLY ATTESTED in the donor (Lydian mariwda-, Sumerian sig₁₇) the argument has content; where it is reconstructed to serve the etymology (Greek *sida) it does not. Keep those apart.',
];

/** There is no inherited PIE word for iron in ANY branch. A clean zero, not a partial set. */
export const IRON_ZERO = {
  finding: 'Germanic borrowed from Celtic. Celtic\u2019s own source is unexplained. Greek is Pre-Greek or Caucasian. Latin is substrate. Semitic is itself possibly Anatolian. Akkadian writes it with a Sumerian logogram.',
  significance: 'A clean zero across every branch — not a partial or irregular set. That total absence is the single most consequential fact in metal etymology, because it dates the whole family relative to a technology.',
  corroboration: 'Far stronger than the bare absence: Sanskrit áyas means COPPER/BRONZE in the Rigveda and iron only in later texts, while Germanic *aiz never means iron at all and Latin aes keeps "bronze". The inherited metal-word demonstrably shifts toward iron INSIDE the separately attested history of each branch, at different times, by different routes.',
};

// ── The substrate that dissolved ───────────────────────────────────────────────────────────────
export const PRE_SUMERIAN_SUBSTRATE = {
  claim: 'A pre-Sumerian "Proto-Euphratean" substrate language survives in Sumerian occupational terms and place names — Landsberger and Kramer\'s hypothesis, with the "banana languages" label from Dyakonov and Ardzinba.',
  evidenceOffered: 'Hydronyms Idiglat (Tigris) and Buranun (Euphrates); city names Eridu, Ur, Larsa, Isin, Kish, Nippur, Lagash; and the craft nouns engar "farmer", simug "smith", nangar "carpenter", damgar "merchant".',
  verdict: 'REFUTED',
  by: 'Gonzalo Rubio, "On the Alleged \'Pre-Sumerian Substratum\'", Journal of Cuneiform Studies 51/1 (1999), 1–16 — arguing the evidence points to ordinary borrowing from several known languages. Now the predominant view, supported by Michalowski and Steiner.',
  theKicker: 'The flagship word collapses on its own. damgar "merchant" is not substrate at all — Sumerian dam-gar₃ is a borrowing FROM Akkadian tamkārum. Meanwhile engar went the other way, INTO Akkadian as ikkarum. The "substrate vocabulary" dissolves into ordinary two-way Sumerian-Akkadian contact.',
  lesson: 'An unknown source language is what you reach for when you have not yet checked the known ones.',
};
