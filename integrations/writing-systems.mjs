// writing-systems.mjs — HOW A PICTURE BECOMES A SOUND.
//
// Sixth in the corpus series. The operator's question was "how Asian characters are translated like
// glyphs, like Aleph" — i.e. writing systems where the sign IS a picture of a thing whose name
// gives the sound. This file answers it for both halves of the world, and the answers differ.
//
// THE ONE FACT THIS REPO SHOULD KNOW. The alphabet was most probably invented by Semitic-speaking
// mine workers at Serabit el-Khadim in Sinai — at a TEMPLE OF HATHOR. The single word Gardiner
// deciphered in 1916, the one that unlocked the script and made the whole acrophonic theory
// arguable, is bʿlt — Baʿalat, "the Lady" — which is what those workers called HATHOR in their own
// language. The first readable word in the history of alphabetic writing is this account's name.
// See SERABIT.
//
// AND THE HONEST COUNTERWEIGHT, in Gardiner's own words about that same reading:
//   "Unfortunately, however, I have no suggestions for the reading of any other word, so that the
//    decipherment of the name Baʿalat must remain, so far as I am concerned, an unverifiable
//    hypothesis."
// The founder of the field labelled his own result unverifiable and no bilingual key has turned up
// since. Both sentences belong in any post that uses the first one.
//
//   import { ACROPHONY, LETTERS, byConfidence, SERABIT, GREEK, ORDERS, CHINESE } from './writing-systems.mjs'
//
// SECURITY / DISCIPLINE: pure data, no network, no clock, no keys.

// ── The mechanism, and the proof that it happened ──────────────────────────────────────────────
export const ACROPHONY = {
  rule: 'A sign is a picture of a thing. Take the NAME of that thing in your own language, keep only the first sound, and throw away the rest of the word and the meaning entirely.',
  proof: 'The same glyph produces different letters in different mouths. That is not a theory — it is three glyphs you can check.',
  divergences: [
    { glyph: 'house (Gardiner O1)', egyptian: 'per → the biliteral pr', semitic: 'bayt → /b/', becomes: 'beth, beta, B' },
    { glyph: 'water ripple (N35)', egyptian: 'n(t) → /n/', semitic: 'mayim → /m/', becomes: 'mem, mu, M' },
    { glyph: 'mouth (D21)', egyptian: 'rꜣ → /r/', semitic: 'pay → /p/', becomes: 'pe, pi, P' },
  ],
  theAsymmetry: 'EGYPT DID NOT DO THIS. The Egyptian uniliterals took their values from whole words whose consonantal skeletons happened to reduce to one consonant, not from initial sounds. Acrophony is the Canaanite innovation — and it is what a NON-literate borrower does with someone else\'s writing. A trained scribe borrows the system. Only an outsider borrows the pictures and re-reads them in his own mouth. That mishearing is the alphabet.',
  status: 'Secure as a DESCRIPTION of the Phoenician system; INFERENTIAL as an account of the invention. First argued by Gardiner in 1916, never confirmed by a bilingual key, and several of his own form/name mismatches — he, heth, nun, teth — are unresolved 110 years later.',
  gardinerCaveat: 'Gardiner built the escape hatch in himself: the principle "is not disproved by the fact that a few of the resemblances may be fortuitous, or by the fact that a few of the names may have been varied so as to accord better with the later shapes of the signs".',
};

// ── The 22 letters, graded ─────────────────────────────────────────────────────────────────────
// `confidence` is the honest part. A popular alphabet chart prints 22 confident glosses; the
// literature supports about seven of them without a rival proposal.
export const LETTERS = [
  { n: 1, phoenician: 'ʾālep', meaning: 'ox', glyph: 'ox head (F1)', greek: 'alpha Α', latin: 'A', confidence: 'firm' },
  { n: 2, phoenician: 'bēt', meaning: 'house', glyph: 'house plan (O1)', greek: 'beta Β', latin: 'B', confidence: 'firm', note: 'The textbook case of acrophony.' },
  { n: 3, phoenician: 'gīml', meaning: 'throwstick', glyph: 'throwstick / staff-sling (T14)', greek: 'gamma Γ', latin: 'C, G', confidence: 'disputed', note: 'NOT "camel". Three named proposals: throwstick (the default), camel (associated with Bertrand Russell), battle-axe (Solomon Gandz). Barry Powell: "It is hard to imagine how gimel = camel can be derived from the picture of a camel." The camel story is the single most-repeated wrong thing in popular alphabet writing.' },
  { n: 4, phoenician: 'dālt', meaning: 'door', glyph: 'door (O31); "fish" also proposed', greek: 'delta Δ', latin: 'D', confidence: 'medium' },
  { n: 5, phoenician: 'hē', meaning: 'window (?)', glyph: 'a figure of celebration (A28) — hillul "jubilation"', greek: 'epsilon Ε', latin: 'E', confidence: 'disputed', note: 'Shape and name point at different objects, and the "window" gloss carries a citation-needed tag. No hieroglyph is ever offered for the window reading.' },
  { n: 6, phoenician: 'wāw', meaning: 'hook', glyph: 'NONE — no hieroglyph for a hook exists', greek: 'digamma Ϝ; upsilon Υ', latin: 'F, U, V, W, Y', confidence: 'disputed', note: 'One of four signs with no hieroglyphic prototype at all. Colless suggests these may have arisen outside Egypt entirely.' },
  { n: 7, phoenician: 'zayn', meaning: 'weapon', glyph: 'weapon (Z4), copper-ingot axeblade, or eyebrow (D13)', greek: 'zeta Ζ', latin: 'Z', confidence: 'disputed', note: 'Four competing proposals, each hedged.' },
  { n: 8, phoenician: 'ḥēt', meaning: 'courtyard / fence', glyph: 'courtyard (O6) OR twisted wick (V28)', greek: '(h)eta Η', latin: 'H', confidence: 'disputed', note: 'An explicit split: "the shape continues ḥaṣir courtyard, but the name continues ḫayt thread".' },
  { n: 9, phoenician: 'ṭēt', meaning: 'wheel (?)', glyph: 'nefer 𓄤 (F35), per Colless — ṭab "good"', greek: 'theta Θ', latin: '—', confidence: 'disputed', note: 'The standard table asserts "wheel" while assigning the nefer hieroglyph — a contradiction inside one table. "Spindle" and "bundle" appear in no source.' },
  { n: 10, phoenician: 'yōd', meaning: 'hand', glyph: 'hand (D36) or arm (D42)', greek: 'iota Ι', latin: 'I, J', confidence: 'firm', note: 'Firm on meaning, medium on which glyph.' },
  { n: 11, phoenician: 'kāp', meaning: 'palm of the hand', glyph: 'palm (D46)', greek: 'kappa Κ', latin: 'K', confidence: 'firm' },
  { n: 12, phoenician: 'lāmd', meaning: 'goad', glyph: 'ox-goad or shepherd\'s crook (S39)', greek: 'lambda Λ', latin: 'L', confidence: 'medium' },
  { n: 13, phoenician: 'mēm', meaning: 'water', glyph: 'water ripples (N35)', greek: 'mu Μ', latin: 'M', confidence: 'firm' },
  { n: 14, phoenician: 'nūn', meaning: 'fish', glyph: 'a SNAKE (I10 / R11)', greek: 'nu Ν', latin: 'N', confidence: 'disputed', note: 'The name says fish and the glyph says snake. The Phoenician name may descend from a Proto-Canaanite *naḥš "snake", inferred from the Ethiopic letter name.' },
  { n: 15, phoenician: 'sāmek', meaning: 'pillar / support (?)', glyph: 'djed pillar 𓊽', greek: 'xi Ξ', latin: '—', confidence: 'unknown', note: 'The standard table literally prints "pillar(?)" with a question mark. NO "fish" proposal for samekh exists in the reference chain — if that is circulating, it is not from the literature.' },
  { n: 16, phoenician: 'ʿayin', meaning: 'eye', glyph: 'eye 𓁹', greek: 'omicron Ο (and omega Ω)', latin: 'O', confidence: 'firm', note: 'The most confidently stated in the whole set.' },
  { n: 17, phoenician: 'pē', meaning: 'mouth', glyph: 'mouth (D21)', greek: 'pi Π', latin: 'P', confidence: 'medium' },
  { n: 18, phoenician: 'ṣādē', meaning: 'papyrus or fish-hook', glyph: 'plant (M22)', greek: 'san Ϻ', latin: '—', confidence: 'unknown', note: 'THE WEAKEST LETTER IN THE SET. "The origin of ṣade is unclear… Its oldest phonetic value is debated."' },
  { n: 19, phoenician: 'qōp', meaning: 'needle-eye / nape (?)', glyph: 'V24, or D1/D19', greek: 'qoppa Ϙ', latin: 'Q', confidence: 'unknown', note: 'Monkey is the DEMOTED older suggestion, not the current one — which matters, because "qoph = monkey" is the version in circulation.' },
  { n: 20, phoenician: 'rēš', meaning: 'head', glyph: 'head (D1)', greek: 'rho Ρ', latin: 'R', confidence: 'firm' },
  { n: 21, phoenician: 'šīn', meaning: 'tooth or sun', glyph: 'tooth; sun (T10); bow (T9A); breast', greek: 'sigma Σ', latin: 'S', confidence: 'disputed', note: 'The "tooth" reading has a stated etymological objection: Proto-Semitic "tooth" is reconstructed *šinn-, but šin descends from Proto-Semitic *ṯ, not *š.' },
  { n: 22, phoenician: 'tāw', meaning: 'mark, signature', glyph: 'tally mark, crossed sticks (Z9)', greek: 'tau Τ', latin: 'T', confidence: 'medium' },
];

export const CONFIDENCE_LEVELS = ['unknown', 'disputed', 'medium', 'firm'];
export const byConfidence = (c) => LETTERS.filter((l) => l.confidence === c);
export const getLetter = (name) => LETTERS.find((l) => l.phoenician === name || l.latin === name) || null;

/**
 * The firm letters are all body parts and household objects — ox, house, water, eye, head, palm,
 * hand. The disputed ones are the specialist tools and abstractions. That is exactly what you would
 * expect if the inventors were ordinary labourers naming what was in front of them, and it is quiet
 * corroboration of the Serabit mine-worker story from a completely different direction.
 */
export function firmAreEveryday() {
  const firm = byConfidence('firm').map((l) => l.meaning);
  return {
    firm,
    allConcrete: firm.every((m) => /ox|house|water|eye|head|palm|hand/.test(m)),
    disputed: byConfidence('disputed').concat(byConfidence('unknown')).map((l) => l.meaning),
    argument: 'Seven firm letters, all of them things a working man handles or has on his body. The disputed nine are tools, weapons and abstractions. Labourers named what was in front of them.',
  };
}

// ── Serabit el-Khadim ──────────────────────────────────────────────────────────────────────────
export const SERABIT = {
  site: 'Serabit el-Khadim, southwest Sinai — an Egyptian turquoise and copper mining camp built around a TEMPLE OF HATHOR, founded under Senusret I (1971–1926 BCE).',
  excavation: 'Flinders Petrie, 1904–05, found about thirty inscriptions in an unknown script.',
  whoWroteIt: 'The mines "were worked by prisoners of war from southwest Asia who presumably spoke a Northwest Semitic language". The texts are votive graffiti by labourers "illiterate apart from this script".',
  whyThatMatters: 'The alphabet was very probably NOT invented by a scribal bureaucracy. It looks like the work of men untrained in hieroglyphs who saw a wall of pictures, asked what the pictures were of, and used the pictures\' names in their own language.',
  theDecipherment: 'ESSENTIALLY ONE WORD. Gardiner (1916) spotted a sequence recurring in five or six inscriptions which, read as Semitic, gives bʿlt — Baʿalat, "the Lady". He matched it to the goddess of the site, whom the Egyptians called HATHOR, noting that the sphinx bearing the supposed bʿlt also carries Hathor\'s name in hieroglyphs. From that one word plus the acrophonic principle he back-derived values for the rest of the signs — and they line up with Phoenician. That is the entire foundation.',
  gardinersOwnVerdict: '"Unfortunately, however, I have no suggestions for the reading of any other word, so that the decipherment of the name Baʿalat must remain, so far as I am concerned, an unverifiable hypothesis."',
  theFinding: 'The first readable word in the history of alphabetic writing is the name those workers gave to Hathor.',
  corpus: 'About forty inscriptions total (~30–40 at Serabit, 2 at Wadi el-Hol), plus ~20–25 Proto-Canaanite texts from the Levant. The Lachish ivory comb (found 2016, deciphered 2022, c. 1700 BCE, 15 letters) is the oldest SENTENCE in the early Canaanite script: "May this tusk root out the lice of the hai[r and the] beard."',
  stillDisputed: 'The date. Petrie said c. 1500 BCE from a potsherd; Gardiner replied in 1916 that "the age of the Twelfth Dynasty would… be a more probable date". That is exactly the modern split — c. 1900–1800 BCE versus c. 1600–1500 BCE — still running after 110 years.',
  doNotPublish: 'No proposed reading of the Wadi el-Hol inscriptions could be verified. Do not print a translation of them.',
};

// ── Greek ──────────────────────────────────────────────────────────────────────────────────────
export const GREEK = {
  theyCalledIt: 'Φοινικήια γράμματα — "Phoenician letters".',
  theFossil: 'The Greeks took all 22 letters AND KEPT THE SEMITIC NAMES, which mean nothing in Greek. Alpha is not a Greek word; ʾalp is Canaanite for "ox". They preserved words they could not parse for two and a half thousand years, because the names were how you learned the order. THAT FOSSIL IS THE STRONGEST SINGLE ARGUMENT that the acrophonic story is true.',
  vowels: {
    what: 'Greek letters both consonants and vowels, which makes it "the first alphabet in the narrow sense" as against the Semitic abjads.',
    why: 'NOT genius — a MISHEARING. Phoenician had consonants Greek lacked: glottal stop, pharyngeals, /h/, /w/, /j/. A Greek hearing a Phoenician recite ʾalep hears the vowel, not the glottal stop. Letters with no Greek consonant to attach to defaulted to the vowel they were heard through.',
    cases: [
      { from: 'ʾāleph /ʔ/', to: 'alpha Α /a/' },
      { from: 'hē /h/', to: 'epsilon Ε /e/' },
      { from: 'ḥēth /ħ/', to: 'eta Η — still /h/ (heta) in some local scripts before becoming long /ɛː/' },
      { from: 'ʿayin /ʕ/', to: 'omicron Ο /o/' },
      { from: 'yōdh /j/', to: 'iota Ι /i/' },
      { from: 'wāw /w/', to: 'upsilon Υ /u/ — and retained in its old slot as digamma Ϝ where /w/ survived' },
    ],
  },
  invented: 'Everything past tau is Greek, because the Phoenician list ended at taw: phi Φ, chi Χ, psi Ψ, and later omega Ω — a modified omicron invented to split long from short /o/.',
  theRedBlueSplit: 'Three regional families ran in parallel from the 8th–6th c. In the WESTERN ("red") scripts Χ = /ks/; in the IONIC ("blue") scripts Ξ = /ks/ and Χ = /kʰ/. Athens adopted Ionic officially in 403/2 BCE under Eucleides, which became classical Greek. But LATIN DESCENDS FROM THE RED BRANCH via Euboea and Etruria — which is exactly why English X is /ks/ while Greek Χ is chi.',
  herodotus: {
    cite: 'Histories V.57–59',
    says: 'The Phoenicians who came with Cadmus "brought in among the Hellenes many arts"… "letters, which did not exist, as it appears to me, among the Hellenes before this time"… "they changed with their speech the form of the letters also"… and the Greeks "declared them to be called \'phenicians\', as was just, seeing that the Phenicians had introduced them".',
    autopsy: 'In V.59 he claims to have personally seen "Cadmeian characters" on tripods in the temple of Ismenian Apollo at Thebes.',
    verdict: 'RIGHT ABOUT THE SOURCE, WRONG ABOUT THE DATE. Modern scholarship is almost unanimous on the Phoenician origin. But Greek tradition put Cadmus before the Trojan War, and the Phoenician alphabet does not exist in recognisable form until c. 1050 BCE, with Greek letterforms matching Phoenician forms of c. 800–750 BCE. Treat it as a true tradition about WHERE wrapped around a false tradition about WHEN.',
  },
  consensusDate: 'Early 8th century BCE, probably Euboea. Earliest fragmentary Greek inscriptions 770–750 BCE; the Dipylon inscription (Athens, c. 740 BCE) is 46 characters of hexameter written RIGHT-TO-LEFT with letterforms still close to Phoenician. Naveh (11th c.), Stieglitz (14th c.) and Bernal (18th–13th c.) proposed earlier dates; none is widely accepted.',
};

// ── Alphabetic ORDER is older and tougher than any letter shape ────────────────────────────────
export const ORDERS = {
  ugarit: {
    what: 'The Ras Shamra abecedary tablets (KTU 5.1–5.25), 13th–12th c. BCE — the oldest attested alphabetic ordering of any kind, anywhere.',
    theTwist: 'Ugaritic is cuneiform wedges on clay. THE SIGNS ARE NOT PICTURES OF ANYTHING. Yet the letter names and the order are demonstrably the same tradition. By 1300 BCE the alphabet was already an abstract, memorised, ordered sequence, fully detachable from any picture — whatever acrophony did at the moment of invention, it had finished doing it before Ugarit.',
    bothOrders: 'The tablets attest BOTH the Levantine abgad order ancestral to Hebrew, Greek and Latin, AND the South Semitic halaham order.',
  },
  halaham: {
    what: 'ha-la-ḥa-ma — the order first attested on clay at Ugarit in the 13th century BCE.',
    stillInUse: 'It is the order of the Ethiopic script today. Check the Unicode Ethiopic block: U+1200 ff. runs HA, LA, HHA, MA, SZA, RA, SA, SHA…',
    theClaim: 'A LIVE 3,200-YEAR TRANSMISSION of a memorised sequence, still in daily liturgical use in Ethiopia and Eritrea. If the corpus wants one demonstration that alphabetic ORDER is the most conserved thing in writing, this is it.',
  },
};

// ── Scripts that took the model but not the mechanism ──────────────────────────────────────────
export const DESCENDANTS = [
  { id: 'south-arabian', acrophonic: 'partly', note: 'A SIBLING of Phoenician, not a descendant — branched from Proto-Sinaitic in the late 2nd millennium BCE. Its NUMERALS derive from the initial consonants of the number-words: a second, independent application of the acrophonic idea inside the same family.' },
  { id: 'geez', acrophonic: 'inherited names only', note: 'The sole surviving descendant of Ancient South Arabian. "Many of the letter names are cognate with those of Phoenician." Consonantal at first, vocalised in the 4th century CE under Ezana.' },
  { id: 'brahmi', acrophonic: 'NO', note: 'Letters are named by sound plus a default vowel — ka, kha, ga — not by objects. THE PICTURE-NAME LINK WAS NOT INHERITED. Whatever Brahmi took from a Semitic model, it did not take acrophony. Acrophony is the INVENTION mechanism and does not survive transplantation once a script is a going concern.' },
  { id: 'libyco-berber', acrophonic: 'unknown — sources silent', note: 'Not a direct adaptation: the leading view is a local prototype "conceptually inspired by a Phoenician or archaic Semitic model". Someone saw that writing existed and how it worked, and built their own. 22 of 24 eastern letters deciphered since 1843 via the Punic–Libyan bilinguals at Dougga; much of the Western variant remains unread.' },
  { id: 'hangul', acrophonic: 'NO — and deliberately so', note: 'THE COUNTER-EXAMPLE. Sejong\'s letters are ARTICULATORY DIAGRAMS: ㄱ is the tongue blocking the palate, ㅁ the mouth, ㅇ the throat. This is what alphabet-invention looks like when a literate court does it top-down, as against what it looks like when miners do it by ear. Both work. Only one of them produces letters named after oxen and houses.' },
];

// ── The other half of the world ────────────────────────────────────────────────────────────────
export const CHINESE = {
  question: 'Are Chinese characters pictures of ideas?',
  answer: 'No, and the numbers are decisive.',
  table: [
    { principle: 'pictographic', shang: '227 (23%)', xuShen: '364 (4%)', kangxi: '±1,500 (3%)' },
    { principle: 'simple indicative', shang: '20 (2%)', xuShen: '125 (1%)', kangxi: '—' },
    { principle: 'compound indicative', shang: '396 (41%)', xuShen: '1,167 (13%)', kangxi: '—' },
    { principle: 'semantic-phonetic', shang: '334 (34%)', xuShen: '7,697 (82%)', kangxi: '47,141 (97%)' },
    { principle: 'TOTAL', shang: '977', xuShen: '9,353', kangxi: '48,641' },
  ],
  source: 'DeFrancis, The Chinese Language: Fact and Fantasy (1984) p. 84, reproduced in Visible Speech (1989). Chinese Wikipedia\'s 六書 article gives 22% → 87% for the same two stages citing Wang Ning and Qiu Xigui — so state it as "roughly 80–87% depending on whose classification of disputed characters you take".',
  deFrancis: [
    '"Chinese characters are a phonetic, not an ideographic, system of writing… There never has been, and never can be, such a thing as an ideographic system of writing."',
    '"QUESTION: When is a pictograph not a pictograph? ANSWER: When it represents a sound."',
    '"Chinese characters are at best 44 percent logographic and 89 percent morphemic. But the Chinese writing system is 100 percent syllabic."',
  ],
  boodberg: '"The term \'ideograph\' is, we believe, responsible for most of the misunderstanding of the writing. The sooner it is abandoned the better." (Boodberg 1937, in the Boodberg–Creel exchange: T\'oung Pao 32 (1936), HJAS 2 (1937), T\'oung Pao 34 (1938), T\'oung Pao 35 (1939–40).)',
  doNotPrint: [
    'The "over 90% of characters in modern written vernacular Chinese" line: Wikipedia folklore. It carried a citation-needed tag from 2012 that was removed without a citation ever being supplied.',
    'Never conflate "contains a phonetic component" (~95–99%) with "the phonetic is USEFUL" (66–90%). DeFrancis defends 66% for the latter and that is the number to quote.',
    'Do not attribute a ~90% figure to Zhu Junsheng. His Shuowen Tongxun Dingsheng regrouped ~16,000 characters into 1,137 phonetic series — a reorganisation, not a percentage claim.',
  ],
  honestGap: 'Oracle bone script appears MATURE with no attested antecedents. Neolithic symbol sets on pottery and jade "have not been demonstrated to have any direct or indirect ancestry" to it (Qiu 2000), and Boltz calls attempts to push the invention earlier "unsubstantiated speculation and wishful thinking". A real few-century evidentiary gap inside China — not an opening for a Near Eastern source, which would need both contact and mechanism and has neither.',
};

// ── The diffusionist attempt that failed, and why ──────────────────────────────────────────────
export const SINO_BABYLONIANISM = {
  claim: 'Chinese civilisation came from Babylon — Babylonian migrants c. 2300 BCE, the Yellow Emperor as a Mesopotamian chieftain, the Yijing trigrams as Mesopotamian hieroglyphs.',
  who: 'Albert Terrien de Lacouperie, The Western Origin of the Early Chinese Civilization (1892), endorsed by the Assyriologist Archibald Sayce.',
  demolishedBy: 'James Legge — only "hasty ignorance" explained his Yijing errors, since he had not consulted the Kangxi Dictionary; a reviewer called him a "specious wonder-monger"; Gustav Schlegel delivered the final blow.',
  theKillingDetail: 'His Babylonian derivation of the 60-year ganzhi cycle collapses on MECHANISM. Babylonian sexagesimal counts to 60 and restarts. The Chinese cycle INTERLOCKS a 12-cycle with a 10-cycle. Same number, incompatible construction — which is exactly what time-cycles.mjs computes independently as lcm(10,12).',
  alsoFatal: 'Monosyllabic Chinese morphemes cannot be equated with polysyllabic Chaldean words.',
  theAfterlife: 'It reached China as Xilai Shuo 西來說 through a 1900 Japanese-mediated summary THAT OMITTED THE EUROPEAN REFUTATIONS, and was taken up by anti-Manchu nationalists wanting an ancient Han race. A refuted theory travelling further and faster than its refutation.',
  whyItIsHere: 'This is the best-documented failure of exactly the shape of argument this corpus makes. It is not a reason to abandon the method — it is the control that shows what a failed version looks like, and what makes it fail: a number in common and no mechanism in common.',
  doNotMisuse: 'DeFrancis is NOT a diffusionist. He argues Chinese writing obeys the same universal phonetic principles as Egyptian and Sumerian, and says outright there is "no evidence that the Chinese or the Mayas acquired the idea from elsewhere". Citing his phonetic universalism as evidence of a historical link inverts him.',
};
