// dream-lore.mjs — DREAM INTERPRETATION AS A DOCUMENTED PRACTICE: the books, the traditions, and the
// classification argument the word "dream" smuggles in.
//
// Sibling of pantheon-map.mjs, divine-sets.mjs, correspondences.mjs, time-cycles.mjs,
// divine-attributes.mjs, day-signs.mjs and cosmologies.mjs. Same disciplines, same restricted-register
// rule, same refusal of the diffusion inference.
//
// THE GAP THIS FILLS. The corpus shipped a lucid-dream INDUCTION library (site/hathor-live/practices.mjs)
// and a numbers-game social history (knowledge/gambling-history/) and had nothing at all on dream
// INTERPRETATION — the older, larger and better-documented half of the subject. "Artemidorus" returned
// zero hits. So did "zaqiqu", the name of the dream god whose series came out of the library this
// institute is named after. That is the hole this file fills.
//
// ⭐ THE CLASSIFICATION ARGUMENT, and it is the reason this file exists rather than a wiki page.
//
// The English word "dream" is not neutral. It carries a position: NOT REAL, and ASSEMBLED FROM WAKING
// RESIDUE. That position has a real literature (Freud; Hobson & McCarley 1977; Domhoff 2003) and it is
// a good one. It is still a POSITION, and several traditions hold a different one — that the dream
// state is a LOCUS rather than a residue. POSITIONS below records the dispute instead of settling it.
//
// The trap this file was written to avoid: the standard scholarly correction to "Dreamtime" says the
// Australian Aboriginal Dreaming "is not really about dreams". That is right about the translation and
// wrong in its shape — it rescues the Dreaming by moving it OUT of the category, leaving the category's
// content (unreal, derivative) intact. We keep the translation correction and drop the concession.
//
// ⚠️ THE METHOD — United States v. Ballard, 322 U.S. 78 (1944), and it binds BOTH ways.
//
// Sincerity may be tested; truth may not. Read as method: we do not rule a tradition false, and we do
// not rule a tradition true. We report what a tradition HOLDS, with a source, and we report what an
// experiment MEASURED, with a source, and we keep the two registers visibly apart. Where a claim is
// testable we test it and say what happened (see REALITY_CHECKS in site/hathor-live/practices.mjs,
// where the light-switch claim gets a verdict). Where it is not, we say what is claimed and stop.
//
// ⚠️ RESTRICTED MATERIAL — read before extending this file.
//
// Same rule as cosmologies.mjs and it is not decoration. Several traditions here are living and hold
// registers that are not public — by initiation, by gender, by clan, by transmission. Published
// summaries exist and are cited; "an ethnographer printed it in 1899" is not "the community consented
// to its circulation". COPYRIGHT EXPIRY IS NOT CONSENT. Every entry carries `restricted`, validate()
// rejects a restricted entry whose note does not say WHAT is withheld, and publicSafe() filters.
//
// ⭐ THE FORM OBSERVATION, and the refusal that goes with it.
//
// The same two-column shape — "if you dream X, then Y" — recurs in 7th-c. BCE Nineveh, in Ramesside
// Egypt, in 2nd-c. CE Asia Minor, and in a 1889 Harlem paperback sold for a dime. sharedForm() returns
// a READING, not a bare list, for exactly the reason sharedCounts() does in cosmologies.mjs: a
// recurring FORM is a fact about how people organise omens. It is not evidence of transmission unless
// something else travels with it — a loanword, a technique, a name.
//
//   import { POSITIONS, DREAM_BOOKS, TRADITIONS, sharedForm, publicSafe, validate } from './dream-lore.mjs'
//   node integrations/dream-lore.mjs form

import { fileURLToPath } from 'node:url';

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * ⭐ POSITIONS — what the dream state IS, according to whom. This is the contested classification
 * stated as a dispute rather than as background. Nothing here is adjudicated; see the Ballard note.
 */
export const POSITIONS = Object.freeze([
  {
    id: 'residue',
    label: 'A residue — constructed from waking material, not a place',
    heldBy: 'the modern default; Freud (1900); Hobson & McCarley (1977); Domhoff (2003)',
    note:
      'The position the English word "dream" carries by default. It has real evidential support — the '
      + 'continuity hypothesis (dream content tracks waking concerns) is the best-supported general '
      + 'claim in dream research. It is still a position, and this file declines to treat it as the '
      + 'neutral ground the others are heard against.',
    source: 'Hobson & McCarley 1977, DOI 10.1176/ajp.134.12.1335; Domhoff, The Scientific Study of Dreams (APA, 2003)',
  },
  {
    id: 'training-ground',
    label: 'A training ground — and the point is that WAKING is equally constructed',
    heldBy: 'Tibetan dream yoga (milam), listed among the Six Yogas of Naropa in most enumerations',
    note:
      '⭐ The strongest of the alternatives, because it does not plead for dreams to be counted as real. '
      + 'It INVERTS the hierarchy: recognising the dream as a dream is step one, and the aim is to carry '
      + 'that recognition back into waking life. A documented training sequence with a stated goal, not '
      + 'a metaphor.',
    source: 'Tsongkhapa, A Book of Three Inspirations, trans. Glenn H. Mullin, Tsongkhapa\'s Six Yogas of Naropa (Snow Lion, 1996); Sumegi, Dreamworlds of Shamanism and Tibetan Buddhism (SUNY, 2008), DOI 10.1515/9780791478264',
  },
  {
    id: 'third-place',
    label: 'Neither merely imagined nor externally solid — a trained third position',
    heldBy: 'the yidam practices (generation and completion stages)',
    note:
      'A deity generated in visualisation, where the practitioner is trained to treat it as NEITHER '
      + 'private imagination NOR an external solid object. That is a genuine third option and it targets '
      + 'exactly the dichotomy the word "dream" enforces. Do not flatten it into "imagination"; the '
      + 'technical vocabulary is generation stage (Skt. utpattikrama) and completion stage '
      + '(sampannakrama), and the distinction between them is the whole content of the practice.',
    source: 'Sumegi 2008 (SUNY), DOI 10.1515/9780791478264; Young, Dreaming in the Lotus (Wisdom, 1999)',
  },
  {
    id: 'one-plane-of-many',
    label: 'One plane among coexisting planes, not a sequence',
    heldBy: 'loka cosmologies (Sanskrit); structurally the same as the Yaqui aniya framework',
    note:
      '⭐ Already in the code. cosmologies.mjs gives the Yaqui huya aniya / sea ania / yo ania entry '
      + 'count: null precisely because coexisting worlds are not a counted series, and a test asserts a '
      + 'null count never enters the shared-count comparison. Loka has that same FORM. The two are not '
      + 'in contact and the shared form is not evidence that they are.',
    source: 'integrations/cosmologies.mjs (yaqui-huya-ania); Sumegi 2008 for the Tibetan Buddhist frame',
  },
  {
    id: 'signal-channel',
    label: 'A signal channel whose output is decoded by rule',
    heldBy: 'the Assyrian and Egyptian dream books; Artemidorus; the American policy dream books',
    note:
      'The position implied by any book that maps images to outcomes. It requires the dream to be about '
      + 'something OTHER than the dreamer\'s day — otherwise there is nothing to decode. Note that this '
      + 'is a THIRD thing, distinct from both "residue" and "locus": the dream need not be a place for '
      + 'its content to be a message.',
    source: 'Artemidorus, Oneirocritica; see TRADITIONS below',
  },
]);

/**
 * ⭐ DREAM_BOOKS — the American policy/numbers dream books, which converted a dream image into a
 * three-digit bet. This is the join between knowledge/gambling-history/ (which mentions dream books in
 * ONE sentence) and the interpretation traditions. Real social history with a real scholarship.
 *
 * `numbersShared` is the finding: the mappings were NOT a shared folk lexicon. They were invented per
 * publisher, contradicted themselves by city, and were litigated over as copyright. See sharedLexicon().
 */
export const DREAM_BOOKS = Object.freeze([
  {
    id: 'aunt-dinah',
    title: "Old Aunt Dinah's Policy Dream Book",
    imprint: '1830s; an 1850 edition survives',
    author: 'house persona ("Aunt Dinah" is a mammy-figure byline, not an author)',
    game: 'policy',
    digits: 2,
    note: 'The earliest of the American line. 32 pp.',
    source: 'Vandegrift, "Oneirocritica Afro-Americana", Cabinet 67 (2019/20); Weiss, Oneirocritica Americana (NYPL, 1944)',
  },
  {
    id: 'golden-wheel',
    title: 'The Golden Wheel Fortune Teller and Dream Book',
    imprint: 'New York: Dick & Fitzgerald, 1862',
    author: 'Felix Fontaine',
    game: 'policy',
    digits: 2,
    note:
      'The template the whole genre copies: alphabetised interpretations PLUS appended lucky numbers '
      + 'PLUS number-only supplemental indexes (names, months, weekdays, playing cards).',
    source: 'Vandegrift, Cabinet 67',
  },
  {
    id: 'three-witches',
    title: 'The Three Witches, or, The Combination Dream Dictionary',
    imprint: 'I. Wright; copyright entered 1881, re-entered 1887; editions into the 1890s',
    author: 'I. Wright (author of record); lore attributed in the preface to "Madam La Vanie"',
    game: 'policy',
    digits: 2,
    note:
      '⭐ Carries NO interpretations at all — only numbers, and the policy apparatus itself: '
      + 'cross-saddles, gigs and horses; combination tables on flat fours; ballots; price tables; '
      + '"Deduct 20 per cent. from all hits." It is the clearest proof that the genre is a betting aid '
      + 'wearing a hermeneutic costume. It is ALSO the primary evidence that the mappings were not '
      + 'shared: its entries carry competing number sets keyed to CITY (P. Philadelphia, N.Y. New York, '
      + 'B. Baltimore, N.J., W. Wilmington, G. German, N. Norfolk).',
    source: 'The book itself (Internet Archive, Harvard/Google copy, threewitchesorc00unkngoog); Vandegrift, Cabinet 67',
  },
  {
    id: 'aunt-sallys',
    title: "Aunt Sally's Policy Players Dream Book",
    imprint: 'New York: Henry J. Wehman, 1889; reprints by I. & M. Ottenheimer, The Lama Temple, Indio Products',
    author: 'house persona; copyright claimed by Henry J. Wehman',
    game: 'policy',
    digits: 2,
    note:
      'The century\'s best-seller. Nine alphabetical dream lists with interpretations and lucky numbers, '
      + 'an abridged "Napoleon\'s Oraculum", and a combination table for apportioning numbers into gigs. '
      + 'Cover art: a Black washerwoman holding 4-11-44, the washerwoman\'s gig. Sold through '
      + 'spiritual-supply houses alongside an "Aunt Sally\'s" incense line.',
    source: 'Vandegrift, Cabinet 67; Long, Spiritual Merchants (Univ. of Tennessee Press, 2001)',
  },
  {
    id: 'hp-dream-book',
    title: 'The H. P. Dream Book (also Lucky Star; The Combination Dream Book)',
    imprint: 'self-published, Harlem; H. P. Dream Book © 1 Dec 1926; Lucky Star © 1928; Combination © 1929',
    author: 'Herbert Gladstone Parris, writing as "Prof. Uriah Konje" and "Professor de Herbert"',
    game: 'numbers',
    digits: 3,
    note:
      '⭐ The book that proves the mappings were a product, not a lexicon. Parris hired a detective '
      + 'agency in 1929 and then litigated: Parris v. Seligman, Equity No. 5531 (E.D. Pa. 1929) and '
      + 'United States v. Seligman, Crim. No. 4644 (E.D. Pa. 1931). He lost both. Later printings carry '
      + '"Beware of Imitations". His number assignments encode his own life — "Hood", "Ghostly", "Ku '
      + 'Klux Klan" and "Professor of Nothing" all resolve to 000. ⛔ "H. P. Lloyd" is not a person; '
      + '"H. P." is Parris\'s initials, and the Lloyd attribution circulating online is unsourced.',
    source: 'Vandegrift, Cabinet 67 (court dockets + copyright registrations); Deslippe, Amerasia Journal 40(1) 2014, DOI 10.17953/amer.40.1.a21442914234450w',
  },
  {
    id: 'rajah-rabo',
    title: "Rajah Rabo's 5-Star Mutuel Dream Book (also Pick 'Em Dream Book; Rajah Rabo's H-Bomb)",
    imprint: 'Mount Vernon, NY: 1932; rev. ed. 1941; Pick \'Em 1953; H-Bomb 1973',
    author: 'pseudonymous; identification with Carl Z. Talbot rests on a SINGLE source and is not confirmed',
    game: 'numbers',
    digits: 3,
    note:
      'Number-indexes jockeys, racehorses and Harlem nightclubs alongside dreams. The entries are a '
      + 'personal inventory of one man\'s Harlem, which is the point: they could not be a shared lexicon '
      + 'because they are autobiography.',
    source: 'Vandegrift, Cabinet 67; Deslippe 2014 on the Orientalist byline',
  },
  {
    id: 'policy-pete',
    title: "Policy Pete's Dream Book",
    imprint: 'Lewis Hartmann, 217 W. 125th St., New York, 1933; reprinted into the 1940s',
    author: 'Lewis Hartmann (publisher of record)',
    game: 'numbers',
    digits: 3,
    note:
      '81 pp. of words-to-numbers, six pages of men\'s and women\'s names, plus numbers for states, '
      + 'sneezing, wedding anniversaries, "happenings", years, months, weekdays, cards and holidays — '
      + 'and a "Past Performances" list of winning numbers 1937-44, which is a back-test.',
    source: "Stephen Robertson's Digital Harlem project, which holds scans and notes",
  },
  {
    id: 'fu-futtam',
    title: 'Madame Fu Futtam\'s Magical-Spiritual Dream Book',
    imprint: '1935; rev. ed. New York: Empire Publishing, 1939',
    author: 'Madame Fu Futtam (b. Dorothy Matthews, Jamaican)',
    game: 'numbers',
    digits: 3,
    note:
      'She married Sufi Abdul Hamid, whose first wife was the numbers banker Stephanie St. Clair. The '
      + 'dream-book trade and the policy racket were one social world, not two.',
    source: 'Vandegrift, Cabinet 67; Harris, Sex Workers, Psychics, and Numbers Runners (Univ. of Illinois Press, 2016)',
  },
]);

/** Bet vocabulary, borrowed wholesale from horse racing. The grammar WAS shared even though the numbers were not. */
export const POLICY_BETS = Object.freeze({
  saddle: '2 numbers',
  gig: '3 numbers in any order — the standard play',
  horse: '4 numbers',
  jack: '5 numbers',
  note:
    'Policy drew twelve slips from a wheel of 1-78, so pre-1920s dream books gave TWO-digit sets. The '
    + 'Harlem numbers game of the 1920s was three digits, taken from the New York Clearing House daily '
    + 'publication — second and third digits of the bank-clearings total plus the third digit of the '
    + 'Federal Reserve credit balance, at 600:1. When the Clearing House stopped publishing on 1 January '
    + '1931 operators switched to NYSE listings and pari-mutuel racetrack handles. ⭐ Anchoring the draw '
    + 'to a public feed the house could not touch is the same trust design a blockchain uses, and '
    + 'knowledge/gambling-history/01 already says so in its own words.',
});

/**
 * ⭐ sharedLexicon() — the honest answer to "were the dream-number mappings consistent across books?"
 * Returns a verdict with its evidence, because a bare boolean would lose the interesting half.
 */
export function sharedLexicon() {
  return {
    verdict: 'no — invented per publisher',
    evidence: [
      'The Three Witches prints competing number sets keyed to city within a single volume: '
        + '"Accuse — 3.10.39 P / 2.19.46 N.Y. / 4.19.66 G." An ant meant 7, 20 or 49 in New York and 1, '
        + '2, 3 or 4 in Philadelphia.',
      "Aunt Sally's gives 2-11-22 for \"drinking out of pump\" and 2-12-22 for \"drinking out of hydrant\".",
      'Parris litigated twice over his tables — a civil equity action and a federal criminal copyright '
        + 'indictment. You do not copyright-litigate over a folk lexicon; you litigate over a product.',
      "Authors' number sets encode their own biographies, which by definition cannot be shared.",
    ],
    counterweight:
      'A shared layer DID exist, but it lived in oral folklore rather than in the books: the '
      + 'washerwoman\'s gig 4-11-44 (printed on the Aunt Sally\'s cover and used as metonym for policy '
      + 'itself) and the "dirty gig" 3-6-9. And the structural grammar — saddle/gig/horse/jack, the 1-78 '
      + 'wheel, the obligatory index categories — was completely stable across every publisher.',
    reading:
      '⭐ Shared genre conventions and a handful of shared folk-canonical combinations, sitting on top of '
      + 'number assignments essentially invented per house. The players knew it and treated the books as '
      + 'raw material rather than authority, mixing across volumes to taste. THE HERMENEUTIC AGENCY WAS '
      + 'IN THE DREAMER, NOT IN THE TABLE — which is Artemidorus\'s own principle, arrived at '
      + 'independently seventeen centuries later in Harlem.',
  };
}

/**
 * TRADITIONS — interpretation and dream-world traditions, each with what it HOLDS and a source.
 * Never with a verdict on whether it is true (see the Ballard note at the top of this file).
 *
 * `form`  — 'two-column' (if-you-dream-X-then-Y lists), 'relative' (meaning indexed to the dreamer),
 *           'taxonomic' (a classification of dream KINDS), 'locus' (the dream state as a place),
 *           'technique' (a training sequence), 'incubation' (sleep somewhere on purpose).
 * `restricted` — MUST be explicit. If true, the note MUST say what is withheld, or validate() fails.
 */
export const TRADITIONS = Object.freeze([
  {
    id: 'assyrian-dream-book',
    label: 'The Assyrian Dream Book (Iškar Zaqīqu)',
    tradition: 'mesopotamian',
    form: 'two-column',
    attested: -650,
    restricted: false,
    holds:
      'That dreams carry omens which can be read off by rule. The compendium is a systematic list of '
      + 'dream contents with their consequences, in the same form as the other Mesopotamian omen series.',
    note:
      '⭐ THE CONNECTION THIS CORPUS SHOULD HAVE MADE YEARS AGO. The tablets come from ASHURBANIPAL\'S '
      + 'LIBRARY AT NINEVEH — the library this institute named its plant-medicine collection after '
      + '(BRIEF.md, MELEK.md, README.md, MASTER_ITINERARY.md). The oldest systematic dream-interpretation '
      + 'compendium we possess came out of the library we named ourselves for, and "zaqiqu" returned ZERO '
      + 'hits in this corpus before this file.',
    source: 'Oppenheim, A. L. (1956). The Interpretation of Dreams in the Ancient Near East, with a Translation of an Assyrian Dream-Book. Transactions of the American Philosophical Society n.s. 46(3), 179-373. DOI 10.2307/1005761 (Crossref-resolved). Butler, S. A. L. (1998), Mesopotamian Conceptions of Dreams and Dream Rituals, AOAT 258. Noegel, S. B. (2007), Nocturnal Ciphers, AOS 89.',
  },
  {
    id: 'egyptian-dream-book',
    label: 'Papyrus Chester Beatty III — the Ramesside Dream Manual',
    tradition: 'egyptian',
    form: 'two-column',
    attested: -1250,
    restricted: false,
    holds:
      'That a dream image is GOOD or BAD and predicts a stated outcome. The oldest surviving dream book: '
      + 'BM EA 10683, hieratic, 19th Dynasty, from Deir el-Medina, owned by the scribe Qenherkhepshef.',
    note:
      'The formula "if a man sees himself in a dream" is written ONCE, as a vertical column read before '
      + 'each horizontal line — not repeated per entry. ⚠️ CORRECTION the corpus needs: only the single '
      + 'word ḏw "bad" is written in red; nfr "good" is ordinary black, and good and bad dreams are sorted '
      + 'by POSITION rather than by colour (Gardiner 1935 p. 9). ⛔ And the widely circulated entry count '
      + '"139 positive, 83 negative" traces only to AI-generated sources — Gardiner\'s own arithmetic '
      + 'implies roughly 220-250 preserved entries. Do not print 139/83. ⭐ Technique: punning, including '
      + 'VISUAL puns on the hieratic signs — which implies the dream was written down BEFORE it was '
      + 'interpreted, making Egyptian oneirocriticism a scribal act and not only an oral one.',
    source: 'Gardiner, A. H. (1935). Hieratic Papyri in the British Museum, Third Series: Chester Beatty Gift, I, 9-23, pls. 5-12a. Szpakowska, K. (2003), Behind Closed Eyes, Classical Press of Wales. Noegel, S. B. & Szpakowska, K. (2006/2007), "Word Play in the Ramesside Dream Manual", Studien zur Altägyptischen Kultur 35, 193-212. Prada, L. (2019), "Dream books, ancient Egypt", Encyclopedia of Ancient History, DOI 10.1002/9781444338386.wbeah15116.pub2 (Crossref-resolved).',
  },
  {
    id: 'macrobius-taxonomy',
    label: 'Macrobius, the fivefold dream taxonomy (Commentary on the Dream of Scipio I.3)',
    tradition: 'roman',
    form: 'taxonomic',
    attested: 430,
    restricted: false,
    holds:
      'That there are five kinds of dream and only three of them are worth interpreting: oraculum '
      + '(ὅραμα... χρηματισμός — an authority states plainly what will happen), visio (a straightforward '
      + 'prophetic vision) and somnium (the enigmatic dream needing interpretation) are divinatory; '
      + 'insomnium (the anxiety or bodily dream) and visum (the hypnagogic apparition, including the '
      + 'incubus) "nihil divinationis adportant" — they bring nothing of divination (I.3.3).',
    note:
      '⭐ ALREADY IN THIS REPO UNDER ANOTHER HEADING: integrations/correspondences.mjs:56 cites Macrobius '
      + 'I.12 for the Hermetic seven-sphere descent, and that citation is CORRECT — tighten it to '
      + 'I.12.13-14, since the chapter also covers the crater of Bacchus and the ὕλη passage. The dream '
      + 'taxonomy, from the same book, was missing. ⭐ Note which two categories Macrobius discards: the '
      + 'anxiety dream and hypnagogia — precisely the two phenomena the modern sleep laboratory would go '
      + 'on to study hardest. ⛔ CORRECTIONS: the verb is adportant, not adferunt; and Chaucer names '
      + 'Macrobius in the Nun\'s Priest\'s Tale, the Book of the Duchess and the Parliament of Fowls but '
      + 'NOT in the House of Fame. Stahl\'s attribution of the fivefold scheme to Artemidorus is Stahl\'s, '
      + 'and is contestable — the modern tendency traces it to a Neoplatonic source.',
    source: 'Latin read this session from Eyssenhardt\'s Teubner (archive.org): I.3.2, I.3.3, I.3.7-12; I.12.13-14. Stahl, W. H., trans. (1952), Macrobius: Commentary on the Dream of Scipio, Columbia University Press — NB DOI 10.7312/stah90698 carries the 1990 reprint, not the 1952 original. Cameron, A. (1966), Journal of Roman Studies 56, 25-38, DOI 10.2307/300131 (Crossref-resolved), on the contested date. Kruger, S. F. (1992), Dreaming in the Middle Ages, DOI 10.1017/CBO9780511518737.',
  },
  {
    id: 'cicero-skeptic',
    label: 'Cicero, De Divinatione II — the serving augur\'s refutation',
    tradition: 'roman',
    form: 'taxonomic',
    attested: -44,
    restricted: false,
    holds:
      '⭐ That divination by dreams does NOT work — argued at book length by a man who had been co-opted '
      + 'into the college of augurs in 53 BCE. "Quis negat augurum disciplinam esse? Divinationem nego" '
      + '(II.74). The base-rate argument is at II.120-121: "Quis est enim, qui totum diem iaculans non '
      + 'aliquando conliniet?" — who, throwing all day, does not sometimes hit the mark?',
    note:
      '⭐ An ancient divinatory tradition containing, in its own literature, a serving augur\'s '
      + 'book-length argument that divination does not work is a more interesting object than one that '
      + 'never doubted itself. The treatise ENDS on dreams: attack opens at II.119, refutation runs to '
      + 'II.147, dismissal at II.148 ("Explodatur igitur haec quoque somniorum divinatio"), peroration on '
      + 'superstitio vs religio at II.148-150. ⛔ The "interpreters of a walk, a swim, a meal" line often '
      + 'attributed to this work DOES NOT EXIST — both books were searched. What is being half-remembered '
      + 'is the II.122-123 list (reading, writing, singing, lyre, geometry, physics, dialectic, '
      + 'navigation, medicine), which is a better quotation anyway.',
    source: 'Latin and Falconer\'s English read this session at LacusCurtius. Falconer, W. A., trans. (1923), Loeb Classical Library 154. Wardle, D. (2006), Cicero on Divination: De Divinatione Book 1, Clarendon, DOI 10.1093/actrade/9780199297917.book.1 (Crossref-resolved). Pease, A. S. (1920, 1923), M. Tulli Ciceronis De Divinatione.',
  },
  {
    id: 'artemidorus',
    label: 'Artemidorus of Daldis, Oneirocritica (2nd c. CE)',
    tradition: 'greek',
    form: 'relative',
    attested: 175,
    restricted: false,
    holds:
      '⭐ That the SAME IMAGE MEANS DIFFERENT THINGS TO DIFFERENT PEOPLE — meaning is indexed to the '
      + 'dreamer\'s occupation, status, health, wealth and custom. That is a real interpretive principle '
      + 'and it predates Freud\'s individualisation by about seventeen centuries; Freud\'s move was to '
      + 'push the index from CLASS down to PERSON.',
    note:
      'Also draws the distinction between oneiros (predictive) and enhypnion (non-predictive, caused by '
      + 'bodily or emotional state), and between theorematic and allegorical dreams. Freud cites him in '
      + 'Die Traumdeutung; Foucault opens The Care of the Self with him.',
    source: 'Harris-McCoy, D. E. (2012). Artemidorus\' Oneirocritica: Text, Translation, and Commentary. Oxford University Press, x+584 pp., ISBN 978-0-19-959347-7 (verified via four independent review records in Crossref). Greek text: Pack, R. (ed.), Teubner, 1963.',
  },
  {
    id: 'tibetan-milam',
    label: 'Dream yoga (milam)',
    tradition: 'tibetan',
    form: 'technique',
    attested: 1400,
    restricted: true,
    holds:
      '⭐ That lucidity is STEP ONE, not the goal — and that the point of recognising the dream as a '
      + 'dream is to carry that recognition back into WAKING life. The tradition inverts the modern '
      + 'hierarchy rather than pleading against it. Extended in the bardo literature to dying.',
    note:
      '⚠️ RESTRICTED. Completion-stage material is transmitted by empowerment, not published-and-read. '
      + 'WITHHELD here: practice instructions from any restricted transmission. What is given '
      + 'here is the published scholarly frame and the stated aim of the sequence. Copyright expiry is '
      + 'not consent. ⚠️ Also: do NOT write "one of the Six Yogas of Naropa" flatly — the enumeration is '
      + 'unstable, and dream yoga is subsumed under illusory body in some lists. And milam is NOT '
      + 'primarily contact with the dead; for that the relevant Tibetan genre is delok (\'das log).',
    source: 'Sumegi, A. (2008), Dreamworlds of Shamanism and Tibetan Buddhism: The Third Place, SUNY Press, DOI 10.1515/9780791478264 (Crossref-resolved). Young, S. (1999), Dreaming in the Lotus, Wisdom. Kragh, U. T. (2015), Tibetan Yoga and Mysticism, IIBS (open access). Practitioner sources cited as doctrine: Mullin trans., Tsongkhapa\'s Six Yogas of Naropa (Snow Lion, 1996); Tenzin Wangyal (1998) — Bön, not Buddhist.',
  },
  {
    id: 'yaqui-aniam',
    label: 'The aniam — tenku ania (dream world) among coexisting worlds',
    tradition: 'yaqui',
    form: 'locus',
    attested: 1645,
    restricted: true,
    holds:
      'That the dream world (tenku ania) is one of as many as NINE coexisting worlds — not a counted '
      + 'series and not a history. cosmologies.mjs already gives this framework count: null for exactly '
      + 'that reason, and loka has the same form.',
    note:
      '⚠️ RESTRICTED. Yaqui Waehma material is ceremonially restricted and is not reproduced here; this '
      + 'entry carries only the published framework. ⛔ Two claims are WITHHELD as unverified rather than '
      + 'printed: that deer, pascola or matachín dancers are called to their vocation IN DREAMS (that '
      + 'traces to an unsigned encyclopedia entry, and the Arizona State Museum gives a WAKING encounter '
      + 'as the origin), and the Evers & Molina quotation about worlds "visible only in the private eye '
      + 'of dream and vision", which reached us via a review essay rather than the book. ⛔ There is also '
      + 'no Kathleen M. Sands work on the deer dance — that attribution is wrong wherever it appears.',
    source: 'Shorter, D. (2005), "Yoeme (Yaqui) Ritual", in Taylor (ed.), Encyclopedia of Religion and Nature, pp. 1780-1782 (read in full). Shorter, D. D. (2009), We Will Dance Our Truth, Univ. of Nebraska Press, DOI 10.2307/j.ctt1dgn4rf. Hill, J. H. (1992), Journal of Anthropological Research 48(2), 117-144, DOI 10.1086/jar.48.2.3630407 (Crossref-resolved; text not read). Evers & Molina (1987), Yaqui Deer Songs / Maso Bwikam, Univ. of Arizona Press.',
  },
  {
    id: 'australian-dreaming',
    label: 'The Dreaming (Jukurrpa / Tjukurpa / Altyerre / Waŋarr)',
    tradition: 'aboriginal-australian',
    form: 'locus',
    attested: 1896,
    restricted: true,
    holds:
      '⭐ An ongoing ancestral, legal and geographic order — creation, Law, country, obligation; Stanner\'s '
      + '"everywhen". AND — this is the correction to the correction — dreaming IS a genuine channel of '
      + 'access to it. Goddard & Wierzbicka\'s semantic explication includes "people see some things when '
      + 'they are asleep [in a dream]" as one route by which people can know about the Jukurrpa, and Green '
      + '(2012) holds the gloss "does have a firm basis in the semantics of Aboriginal languages, at least '
      + 'in Central Australia". So: the referent is the ancestral order, not a nightly experience — and '
      + 'the flat "it has nothing to do with dreams" over-correction is not what the specialists defend.',
    note:
      '⚠️ RESTRICTED, and the restriction is graded by initiation, gender and community. WITHHELD here: '
      + 'anything from a secret-sacred register — men\'s and women\'s ceremonial knowledge is kept from the '
      + 'opposite gender; ameke-ameke names a Dreaming place certain people may not approach; the '
      + 'initiation-graded secret term tnankara appears TWICE in Carl Strehlow\'s entire corpus for that '
      + 'reason. ⭐ Consequence worth stating: the classic ethnographic record is systematically '
      + 'male-skewed, and much of what reads as "the source" is one gendered, partially-restricted '
      + 'register presented as the whole. ⚠️ "Dreamtime" is Gillen/Spencer\'s 1896 rendering of Arrernte '
      + 'alcheringa/altjira and Carl Strehlow objected in print in 1907: "The native knows nothing of a '
      + '\'dreamtime\'". Prefer the tradition\'s own term. Copyright expiry is not consent — see the NLA '
      + 'ICIP Protocol source below, which says ICIP rights continue in perpetuity regardless of prior '
      + 'publication.',
    source: 'Goddard, C. & Wierzbicka, A. (2015), Australian Aboriginal Studies 2015/1, 43-65 (open access, read in full). Kenny, A. (2013), The Aranda\'s Pepa, ANU E Press (open access, read in full). Green, J. (2012), The Australian Journal of Anthropology 23(2), 158-178, DOI 10.1111/j.1757-6547.2012.00179.x (Crossref-resolved). Wolfe, P. (1991), Comparative Studies in Society and History 33(2), 197-224, DOI 10.1017/S0010417500017011 (Crossref-resolved — Patrick Wolfe, NOT Sam Wolfe). Stanner, W. E. H., "The Dreaming", 1953 [first published 1956 in Hungerford (ed.), Australian Signpost, pp. 51-65]. AIATSIS Code of Ethics (2020); National Library of Australia ICIP Protocol (2023), written by Anika Valenti, Terri Janke and Company.',
  },
  {
    id: 'ojibwe-dream-persons',
    label: 'Dreams as encounter with other-than-human persons',
    tradition: 'anishinaabe',
    form: 'locus',
    attested: 1960,
    restricted: true,
    holds:
      'That manidoog / pawáganak met in dreams are PERSONS, and that a dream encounter is not a lesser '
      + 'order of experience than a waking one. Blessings received from them underwrite a good life; the '
      + 'end of received power is personal autonomy rather than self-interest (Black-Rogers).',
    note:
      '⚠️ RESTRICTED. WITHHELD: the content of any vision-fast instruction, society-held dream material, '
      + 'and the identity or attributes of an individual\'s pawáganak. This entry carries only the '
      + 'analytic frame its authors put into the public scholarly record deliberately. ⛔ Do not print the '
      + 'spelling "giigwishimowin" for the vision fast — it has no dictionary entry; giiʹigoshimowin is '
      + 'attested, and makadekewin (blackening/fasting) is the other common form.',
    source: 'Hallowell, A. I. (1960), "Ojibwa Ontology, Behavior, and World View", in Diamond (ed.), Culture in History, Columbia UP, 19-52 — NB the DOI 10.7312/diam92410-005 resolves to the 1964 abridged reprint in Primitive Views of the World, pp. 49-82. Hallowell (1966), "The Role of Dreams in Ojibwa Culture", DOI 10.1525/9780520339279-018 (Crossref-resolved). Black, M. B. (1977), Ethos 5(1), DOI 10.1525/eth.1977.5.1.02a00070.',
  },
  {
    id: 'islamic-ruya',
    label: 'Ru\'yā — the true dream, and istikhāra',
    tradition: 'islamic',
    form: 'taxonomic',
    attested: 850,
    restricted: false,
    holds:
      'That true good dreams (al-mubashshirāt) are what remains of prophethood — Sahih al-Bukhari 6990 '
      + '(Abū Hurayra) — and the good dream as one of forty-six parts of prophethood (Bukhari 6987).',
    note:
      '⚠️ TWO CORRECTIONS THE CORPUS NEEDS. (1) Istikhāra in the canonical hadith (Bukhari 1166, Jābir b. '
      + 'ʿAbdallāh) prescribes a two-rakʿa prayer and a duʿāʾ. It does NOT promise or mention a dream; '
      + 'the majority position (Ibn Ḥajar) is that the answer comes as ease or obstruction in '
      + 'circumstances, and the dream-expectation is a later popular development. Edgar & Henig document '
      + 'it as LIVED practice, which is a different and legitimate claim. (2) Ibn Sīrīn (d. 110/728) did '
      + 'NOT write a dream book — the vast Taʿbīr al-ruʾyā corpus under his name is pseudepigraphic.',
    source: 'Sahih al-Bukhari 6990, 6987, 1166. Edgar, I. R. & Henig, D. (2010), History and Anthropology 21(3), 251-262, DOI 10.1080/02757206.2010.496781 (Crossref-resolved). Lamoreaux, J. C. (2002), The Early Muslim Tradition of Dream Interpretation, SUNY Press. Mittermaier, A. (2011), Dreams That Matter, UC Press.',
  },
  {
    id: 'american-dream-books',
    label: 'The American policy and numbers dream books',
    tradition: 'african-american',
    form: 'two-column',
    attested: 1830,
    restricted: false,
    holds:
      'That a dream image maps to a number you can bet. ⭐ And uniquely among everything in this file, '
      + 'the mapping made a FALSIFIABLE prediction, settled daily against a public feed nobody controlled, '
      + 'at 600:1. See sharedLexicon() for what happened when the predictions were compared across books.',
    note:
      'Real African American folk-economic history with a real scholarship — Schlabach (2022), White et '
      + 'al. (2010), Harris (2016), Vaz (2020). The corpus already held the numbers-game history and the '
      + 'la-lotería file and had never joined them to the interpretation traditions.',
    source: 'Schlabach, E. S. (2022), Dream Books and Gamblers, Univ. of Illinois Press, DOI 10.5622/illinois/9780252044786.001.0001 (Crossref-resolved). White, S., et al. (2010), Playing the Numbers, Harvard UP, DOI 10.4159/9780674056961, ch. 3 "Dreams" DOI 10.4159/9780674056961-004 (both Crossref-resolved). Vandegrift, C. W. (2019/20), "Oneirocritica Afro-Americana", Cabinet 67 (not peer-reviewed; best-documented single account).',
  },
]);

/**
 * ⭐ sharedForm() — the two-column "if you dream X, then Y" list recurs in 7th-c. BCE Nineveh, in
 * Ramesside Egypt, in 2nd-c. CE Asia Minor, and in a Harlem paperback of 1889. Returns a READING, not
 * a bare list, for exactly the reason cosmologies.mjs's sharedCounts() does.
 */
export function sharedForm() {
  const byForm = new Map();
  for (const t of TRADITIONS) {
    if (!byForm.has(t.form)) byForm.set(t.form, []);
    byForm.get(t.form).push({ id: t.id, tradition: t.tradition, attested: t.attested });
  }
  const shared = [...byForm.entries()]
    .filter(([, list]) => new Set(list.map((x) => x.tradition)).size > 1)
    .map(([form, list]) => ({ form, traditions: list.sort((a, b) => a.attested - b.attested) }));
  return {
    shared,
    reading:
      'The FORM recurs; nothing else does. A two-column omen list in Nineveh and a two-column omen list '
      + 'in Harlem share a shape and share no content, no vocabulary, no technique and no chain of '
      + 'transmission. A list of "if X then Y" is what you get whenever people try to make an '
      + 'unpredictable signal legible at scale — it is a fact about how omens get organised, not evidence '
      + 'of contact. Treat a shared form as a fact about forms unless something ELSE travels with it: a '
      + 'loanword, a technique, a name. ⭐ THE CLAIM WAS TESTED RATHER THAN ASSUMED, AND IT FAILED. Noegel '
      + '(Nocturnal Ciphers, 2007) is the one sustained diffusionist case, argued from the punning '
      + 'TECHNIQUE rather than the layout — the right instinct. It is contested on method by Bilbija (ZA '
      + '2008): the Egyptian side needed no source (Egypt already punned), the Mesopotamian supply side is '
      + 'four or five pre-Ramesside texts, the Greek argument is circular — and the K\'iche\' Maya '
      + 'divination calendar produces the same punning hermeneutic with no Near Eastern roots at all. '
      + 'Decisively, Prada (2015) compared Artemidorus with the Egyptian-language dream books actually '
      + 'circulating in his lifetime and found the Oneirocritica "largely extraneous" to them: two '
      + 'traditions, contemporaneous, in the same empire, no dependence. ⭐ WHAT REAL TRANSMISSION LOOKS '
      + 'LIKE, for contrast: Akkadian dream omens at Ḫattuša and Susa (actual tablets); liver divination '
      + 'east-to-west (shared technical vocabulary plus the Piacenza bronze liver); and Artemidorus → '
      + '9th-c. Arabic → the 10th-c. Byzantine Oneirocriticon of Achmet (Mavroudi 2002) — named languages, '
      + 'named centuries, named intermediaries, and it runs the OTHER way and is late. The ancient dream '
      + 'books have no loanword, no named intermediary and no translated omen text. Formally convergent '
      + 'and technically parallel; NOT descended.',
  };
}

/** publicSafe() — everything with no restricted register. The exclusion is visible, per the file header. */
export const publicSafe = () => TRADITIONS.filter((t) => !t.restricted);
export const restrictedTraditions = () => TRADITIONS.filter((t) => t.restricted);
export const getTradition = (id) => TRADITIONS.find((t) => t.id === id) || null;

export const FORMS = Object.freeze({
  'two-column': 'an if-you-dream-X-then-Y list',
  relative: 'meaning indexed to who the dreamer is',
  taxonomic: 'a classification of kinds of dream',
  locus: 'the dream state as a place rather than a residue',
  technique: 'a training sequence with a stated aim',
  incubation: 'sleeping somewhere on purpose to receive something',
});

/** Shape check. Returns problems; never throws. */
export function validate() {
  const problems = [];
  const seen = new Set();
  for (const t of TRADITIONS) {
    if (seen.has(t.id)) problems.push(`${t.id}: duplicate id`);
    seen.add(t.id);
    if (!Object.hasOwn(FORMS, t.form)) problems.push(`${t.id}: unknown form ${t.form}`);
    if (!t.source) problems.push(`${t.id}: no source`);
    if (!t.holds) problems.push(`${t.id}: must say what the tradition HOLDS`);
    if (typeof t.restricted !== 'boolean') problems.push(`${t.id}: restricted must be explicit`);
    if (!Number.isInteger(t.attested)) problems.push(`${t.id}: attested must be an integer year`);
    // A restricted entry must say what is withheld, or the flag is decoration. Same rule as cosmologies.mjs.
    if (t.restricted && !/RESTRICTED/i.test(String(t.note))) {
      problems.push(`${t.id}: restricted but the note does not say what is withheld`);
    }
  }
  const bookIds = new Set();
  for (const b of DREAM_BOOKS) {
    if (bookIds.has(b.id)) problems.push(`${b.id}: duplicate book id`);
    bookIds.add(b.id);
    if (!b.source) problems.push(`${b.id}: no source`);
    if (![2, 3].includes(b.digits)) problems.push(`${b.id}: digits must be 2 (policy) or 3 (numbers)`);
  }
  const posIds = new Set();
  for (const p of POSITIONS) {
    if (posIds.has(p.id)) problems.push(`${p.id}: duplicate position id`);
    posIds.add(p.id);
    if (!p.heldBy) problems.push(`${p.id}: a position must say who holds it`);
    if (!p.source) problems.push(`${p.id}: no source`);
  }
  return { ok: problems.length === 0, problems };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    service: 'dream-lore',
    counts: {
      positions: POSITIONS.length,
      traditions: TRADITIONS.length,
      restricted: restrictedTraditions().length,
      dreamBooks: DREAM_BOOKS.length,
    },
    forms: FORMS,
    note:
      'Dream interpretation as a documented practice. What a tradition HOLDS is reported; whether it is '
      + 'true is not adjudicated in either direction (United States v. Ballard, 322 U.S. 78). A shared '
      + 'FORM is a fact about how omens get organised, not evidence of transmission. Restricted registers '
      + 'are flagged and not reproduced; copyright expiry is not consent.',
  }, null, 2));
}

export const getBook = (id) => DREAM_BOOKS.find((b) => b.id === id) || null;
export const getPosition = (id) => POSITIONS.find((p) => p.id === id) || null;
export const byGame = (g) => DREAM_BOOKS.filter((b) => b.game === g);

export default {
  POSITIONS, DREAM_BOOKS, POLICY_BETS, TRADITIONS, FORMS,
  sharedLexicon, sharedForm, publicSafe, restrictedTraditions,
  getBook, getPosition, getTradition, byGame, validate, handler, esc,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === 'form') {
    const f = sharedForm();
    for (const r of f.shared) {
      console.log(`${r.form}: ${r.traditions.map((t) => `${t.tradition} (${t.attested})`).join(', ')}`);
    }
    console.log(`\n${f.reading}`);
  } else if (process.argv[2] === 'books') {
    const l = sharedLexicon();
    console.log(`shared lexicon: ${l.verdict}\n`);
    for (const e of l.evidence) console.log(`  - ${e}`);
    console.log(`\ncounterweight: ${l.counterweight}\n\n${l.reading}`);
  } else {
    const v = validate();
    console.log(`${POSITIONS.length} positions · ${TRADITIONS.length} traditions · ${restrictedTraditions().length} restricted · ${DREAM_BOOKS.length} dream books · valid: ${v.ok}`);
    for (const p of v.problems) console.log(`  ⛔ ${p}`);
    for (const t of TRADITIONS) {
      console.log(`  ${String(t.attested).padStart(5)}  ${t.label.padEnd(56)} ${t.form.padEnd(11)} ${t.restricted ? '⚠️ restricted' : ''}`);
    }
  }
}
