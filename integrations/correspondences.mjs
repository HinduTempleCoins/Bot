// correspondences.mjs — THE CORRESPONDENCE TABLES, dated.
//
// Third in the series with pantheon-map.mjs (who says these gods are one?) and time-cycles.mjs
// (where does this number come from?). This one asks the question that decides whether a
// planet-metal-stone-plant-chakra table is a transmission record or a Victorian craft project:
//
//   WHEN WAS THIS CORRESPONDENCE FIRST WRITTEN DOWN?
//
// Every table below carries `firstAttested` — a year and a citation. Sort by it (`datedTo()`) and
// the genre sorts itself: the planet-metal set is late antique, the breastplate-zodiac equation is
// 1st century, the Hermetic seven-sphere ascent is 2nd century — and the rainbow chakras are 1927,
// the birthstone list is 1912, and the tarot-sephirah attributions are 1909.
//
// This is not debunking. Three of these are genuinely ancient and one of them survived into
// chemistry under its own name. The point is that a chart which prints all of them in one grid
// destroys exactly the information that makes the ancient ones worth having.
//
// MOTIVATED vs CHOSEN, again. gold=Sun and silver=Moon are motivated — yellow and shining, white
// and pale. Anyone could reinvent them, so they carry nothing. tin=Jupiter and lead=Saturn are
// unmotivated: nothing about tin suggests Jupiter. Those two are the tracers, and they are the
// reason the metal-planet table is real evidence while the birthstone table is not.
//
//   import { TABLES, provenance, datedTo, survivedIntoScience, checkChaldean } from './correspondences.mjs'
//
// SECURITY / DISCIPLINE: pure data, no network, no clock, no keys.

// The Chaldean order — planets by apparent orbital period, slowest first. The spine of the whole
// system: it generates the weekday sequence (see time-cycles.mjs) AND it is the order the soul
// climbs in the Hermetic ascent. Any seven-fold table can be measured against it.
export const CHALDEAN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];

export const ERAS = ['ancient', 'late-antique', 'medieval', 'early-modern', 'modern'];

// ── The tables ─────────────────────────────────────────────────────────────────────────────────
export const TABLES = [
  {
    id: 'planet-metal',
    label: 'The seven planets and the seven metals',
    firstAttested: 300, era: 'late-antique',
    source: 'Greek alchemical corpus (Zosimos of Panopolis, Olympiodorus); standard by the Islamic and Latin traditions; in English verse by Chaucer, Canon’s Yeoman’s Tale, c. 1390',
    entries: [
      { planet: 'Sun', metal: 'gold', motivated: true, why: 'yellow, does not tarnish' },
      { planet: 'Moon', metal: 'silver', motivated: true, why: 'white, pale lustre' },
      { planet: 'Mercury', metal: 'quicksilver', motivated: true, why: 'swift, mobile — and the metal keeps the god’s name to this day' },
      { planet: 'Mars', metal: 'iron', motivated: true, why: 'weapons; rust is red' },
      { planet: 'Venus', metal: 'copper', motivated: true, why: 'Cyprus — the island of Venus and the source of copper; the words share a root' },
      { planet: 'Jupiter', metal: 'tin', motivated: false, why: 'NOTHING connects tin to Jupiter. A tracer.' },
      { planet: 'Saturn', metal: 'lead', motivated: false, why: 'heaviness and dullness are a stretch; effectively arbitrary. A tracer.' },
    ],
    verdict: 'The strongest correspondence table in the whole genre, and the only one that reached science.',
  },
  {
    id: 'hermetic-ascent',
    label: 'The soul’s ascent through the seven planetary spheres',
    firstAttested: 150, era: 'ancient',
    source: 'Corpus Hermeticum I.25–26 (Poimandres); Macrobius, Commentary on the Dream of Scipio I.12',
    entries: CHALDEAN.map((planet, i) => ({ planet, sphere: 7 - i, shed: 'a vice surrendered at each gate' })),
    verdict: 'ATTESTED, and in Chaldean order. This is the real ancient doctrine that the modern chakra-planet charts are reaching for and missing.',
  },
  {
    id: 'breastplate-zodiac',
    label: 'The twelve stones of the High Priest’s breastplate as the twelve signs',
    firstAttested: 90, era: 'ancient',
    source: 'Josephus, Antiquities III.7.5 and Jewish War V.5.7; Philo, De Vita Mosis II.124–126',
    entries: [
      { row: 1, hebrew: 'odem', tribe: 'Reuben' },
      { row: 1, hebrew: 'pitdah', tribe: 'Simeon' },
      { row: 1, hebrew: 'bareqet', tribe: 'Levi' },
      { row: 2, hebrew: 'nophek', tribe: 'Judah' },
      { row: 2, hebrew: 'sappir', tribe: 'Dan' },
      { row: 2, hebrew: 'yahalom', tribe: 'Naphtali' },
      { row: 3, hebrew: 'leshem', tribe: 'Gad' },
      { row: 3, hebrew: 'shevo', tribe: 'Asher' },
      { row: 3, hebrew: 'ahlamah', tribe: 'Issachar' },
      { row: 4, hebrew: 'tarshish', tribe: 'Zebulun' },
      { row: 4, hebrew: 'shoham', tribe: 'Joseph' },
      { row: 4, hebrew: 'yashpheh', tribe: 'Benjamin' },
    ],
    verdict: 'The stones-as-zodiac equation IS ancient and explicit — two independent 1st-century Jewish authors state it.',
    caveat: 'But the identity of the STONES is unresolved. Exodus 28:17–20 names twelve minerals in Hebrew and the Septuagint, Vulgate and modern translations disagree on most of them: sappir is probably lapis lazuli rather than sapphire, yahalom may be jasper rather than diamond, and tarshish is simply unknown. Any chart that runs stone → tribe → sign → month is guessing at step one.',
  },
  {
    id: 'agrippa-scales',
    label: 'Agrippa’s scales — number → planet → metal → stone → plant → animal → body part → angel',
    firstAttested: 1533, era: 'early-modern',
    source: 'Heinrich Cornelius Agrippa, De Occulta Philosophia libri tres, Book II (manuscript 1510, printed Cologne 1533)',
    entries: [
      { scale: 'of Four', covers: 'elements, seasons, humours, evangelists, cardinal directions' },
      { scale: 'of Seven', covers: 'planets, metals, stones, plants, animals, birds, fish, body parts, angels' },
      { scale: 'of Twelve', covers: 'signs, tribes, apostles, months, body parts' },
    ],
    verdict: 'THE FORMAT ORIGIN. Agrippa did not invent the individual correspondences — he invented the GRID that prints them side by side. Every modern correspondence table is descended from Book II, and so is the habit of treating a 2nd-century equation and a 16th-century one as the same kind of fact.',
  },
  {
    id: 'golden-dawn-777',
    label: 'Tarot ↔ sephirah ↔ planet ↔ Hebrew letter ↔ scent ↔ drug',
    firstAttested: 1909, era: 'modern',
    source: 'Aleister Crowley, 777 (1909), systematising the Hermetic Order of the Golden Dawn attributions of the 1890s',
    verdict: 'A direct descendant of Agrippa’s Book II, 376 years later. Frequently cited as though it were the Kabbalah itself. It is not — the tarot-sephirah attributions are Victorian.',
    caveat: 'Counting Golden Dawn attributions as independent confirmation of an astrological claim is counting one tradition twice. This is the single most common error in the genre.',
  },
  {
    id: 'chakra-rainbow',
    label: 'Seven chakras with rainbow colours, and planets attached',
    firstAttested: 1927, era: 'modern',
    source: 'C.W. Leadbeater, The Chakras (1927); building on Arthur Avalon (John Woodroffe), The Serpent Power (1919), which translated the Ṣaṭcakranirūpaṇa of 1577',
    verdict: 'MODERN. The Sanskrit sources give varying numbers of cakras — four, five, six, nine, twelve depending on the text — and their colours are not the spectrum. Red-to-violet in seven steps is a 20th-century Theosophical scheme mapped onto Newton’s rainbow.',
    caveat: 'The planetary attachment is later still and is not stable: charts in circulation disagree on the Third Eye (Saturn / Jupiter / Neptune / Uranus) and the Root (Mars / Saturn / Earth). One chart in the corpus assigns Quaoar, discovered in 2002. A set still being written cannot be evidence of ancient transmission.',
  },
  {
    id: 'birthstones',
    label: 'Birthstones by month',
    firstAttested: 1912, era: 'modern',
    source: 'The National Association of Jewelers, Kansas City, 1912; revised 1952, tanzanite added 2002, spinel 2016',
    verdict: 'A TRADE LIST. The lineage runs Josephus → medieval lapidaries → a jewellers’ association standardising retail stock in 1912, and the 1912 step is where it becomes marketing.',
    caveat: 'The dates of the later additions are the tell: a tradition that acquires a new stone in 2002 because a mine opened in Tanzania in 1967 is a commercial catalogue wearing a robe.',
  },
  {
    id: 'doctrine-of-signatures',
    label: 'Plants resemble what they heal',
    firstAttested: 1588, era: 'early-modern',
    source: 'Giambattista della Porta, Phytognomonica (1588); Paracelsus; popularised by William Coles, Adam in Eden (1657)',
    verdict: 'A testable claim that failed. Lungwort’s spotted leaves do not make it a lung remedy; walnuts do not treat the brain.',
    caveat: 'Worth keeping because it is the cleanest case of the whole method being run as science and losing. The pharmacologically real plant knowledge of the same period came from ETHNOBOTANY — accumulated trial — not from resemblance. Willow bark for pain was known empirically for millennia before salicin was isolated in 1828, and no signature predicted it.',
  },
];

export const getTable = (id) => TABLES.find((t) => t.id === id) || null;

/** The tables sorted by when they were first written down. The sort IS the argument. */
export function datedTo() {
  return TABLES.slice().sort((a, b) => a.firstAttested - b.firstAttested)
    .map((t) => ({ id: t.id, year: t.firstAttested, era: t.era, label: t.label }));
}

/** Provenance for one table: when, who, and what that licenses. */
export function provenance(id) {
  const t = getTable(id);
  if (!t) return null;
  const licence = t.firstAttested <= 600
    ? 'Ancient. May be cited as evidence of what an ancient tradition actually held.'
    : t.firstAttested <= 1700
      ? 'Early modern. Cite as Renaissance natural philosophy, never as ancient doctrine.'
      : 'Modern. Cite as the work of its named author in its named year. It is not evidence about antiquity.';
  return { id: t.id, year: t.firstAttested, era: t.era, source: t.source, verdict: t.verdict, caveat: t.caveat || null, licence };
}

// ── The one correspondence that reached chemistry ──────────────────────────────────────────────
export const SURVIVALS = [
  { term: 'mercury', survives: 'The element is still named for the god. Hg is from hydrargyrum, but the English name never changed.' },
  { term: 'saturnism', survives: 'The clinical term for chronic lead poisoning, still in medical use. Saturn = lead, intact.' },
  { term: 'lunar caustic', survives: 'Silver nitrate. Moon = silver, intact into the pharmacopoeia.' },
  { term: 'martial', survives: 'Iron preparations were "martial" — tincture of mars, martial flowers — through 19th-century pharmacy.' },
  { term: 'venereal', survives: 'Copper vessels and the disease both take the name; Cyprus gives us both Venus and cuprum.' },
  { term: 'jovial / saturnine / mercurial / martial / lunatic', survives: 'The temperament adjectives are the planet-metal doctrine surviving in ordinary English.' },
];

export function survivedIntoScience() { return SURVIVALS.map((s) => s.term); }

/** The unmotivated planet-metal pairs — the only rows in that table doing evidentiary work. */
export function tracers() {
  return getTable('planet-metal').entries.filter((e) => !e.motivated);
}

// ── Agrippa to Mendeleev: the documented chain ─────────────────────────────────────────────────
// The honest answer to "Agrippa leading up to science" is not that the occultists were secretly
// right. It is sharper than that: the IMPULSE was right and every SPECIFIC was wrong. Matter really
// does fall into repeating groups. It just does not fall into seven groups ruled by planets.
export const TO_SCIENCE = [
  { year: 1533, who: 'Agrippa', what: 'De Occulta Philosophia Book II — the correspondence grid as a total classification of matter.', kept: 'The premise that matter is ordered into recurring families.' },
  { year: 1530, who: 'Paracelsus', what: 'The tria prima — salt, sulphur, mercury — replacing the four elements as the constituents of bodies.', kept: 'That substances decompose into a small set of principles; the first move toward "element" as a working idea.' },
  { year: 1661, who: 'Robert Boyle', what: 'The Sceptical Chymist dismantles both the four elements and the tria prima, and defines an element as what cannot be further decomposed.', kept: 'The definition chemistry still uses. The correspondence content is dropped here.' },
  { year: 1680, who: 'Isaac Newton', what: 'Roughly a million words of alchemical manuscript, more than he wrote on physics.', kept: 'A reminder that the split is retrospective. The man who gave us the spectrum was also chasing the philosophers’ stone.' },
  { year: 1789, who: 'Antoine Lavoisier', what: 'Traité élémentaire de chimie tabulates 33 substances as elements — the first real element table.', kept: 'A LIST, but still no principle of order.' },
  { year: 1829, who: 'J.W. Döbereiner', what: 'Triads — the middle element’s atomic weight is near the mean of the outer two.', kept: 'The first hint that the ordering variable is a MEASURED NUMBER.' },
  { year: 1865, who: 'John Newlands', what: 'The Law of Octaves — every eighth element repeats, explicitly by analogy to the musical scale.', kept: 'THE HINGE. This is correspondence thinking arriving inside chemistry and being 60% right. He was mocked at the Chemical Society — asked whether he had tried arranging them alphabetically — and awarded the Davy Medal 22 years later.' },
  { year: 1869, who: 'Dmitri Mendeleev', what: 'The periodic table, ordered by atomic weight, with gaps left for undiscovered elements whose properties he predicted.', kept: 'Periodicity, proven by successful PREDICTION — gallium 1875, scandium 1879, germanium 1886.' },
  { year: 1913, who: 'Henry Moseley', what: 'X-ray spectra show the real ordering variable is atomic NUMBER, not weight.', kept: 'The correspondence is finally grounded in a physical cause: nuclear charge and electron shells.' },
];

export const THESIS = {
  claim: 'The correspondence impulse was right about the world and wrong about every detail.',
  argument: 'Agrippa and Mendeleev are asking the same question — does matter fall into recurring families? — and the answer is yes. Agrippa failed because his ordering variable was CHOSEN (which planet a thing resembles) and Mendeleev succeeded because his was MEASURED (atomic weight, then atomic number). Newlands is the hinge: he had the right shape, reached for a musical analogy to explain it, and was laughed at for the analogy rather than tested on the shape.',
  soWhat: 'The lesson transfers directly to the rest of the corpus. A correspondence system is worth taking seriously exactly when it is anchored to something measurable and independently checkable — a sound law, an orbital period, an atomic number, a haplogroup frequency — and worth nothing when the anchor is resemblance.',
};

// ── Measuring a seven-fold table against the Chaldean order ────────────────────────────────────
/**
 * Given an ordered list of seven planets (crown-to-root, or sphere 7 down to 1), report how far it
 * sits from the Chaldean order and name the transpositions. A table that IS Chaldean order can claim
 * descent from the Hermetic ascent; one that is not has been arranged for meaning, which is the
 * arbitrary-assignment failure mode.
 */
export function checkChaldean(order = []) {
  const clean = order.filter(Boolean);
  const valid = clean.length === 7 && new Set(clean).size === 7
    && clean.every((p) => CHALDEAN.includes(p));
  if (!valid) return { valid: false, matches: 0, distance: null, displaced: [], isChaldean: false };
  const matches = clean.filter((p, i) => p === CHALDEAN[i]).length;
  const displaced = clean
    .map((p, i) => ({ planet: p, at: i, shouldBe: CHALDEAN.indexOf(p) }))
    .filter((d) => d.at !== d.shouldBe);
  return {
    valid: true,
    matches,
    distance: 7 - matches,
    displaced,
    isChaldean: matches === 7,
    swapOnly: displaced.length === 2 && displaced[0].shouldBe === displaced[1].at && displaced[1].shouldBe === displaced[0].at,
  };
}

/** The chakra-planet order asserted in AS_ABOVE_SO_BELOW, crown to root, for checking. */
export const AS_ABOVE_TABLE = ['Saturn', 'Jupiter', 'Mercury', 'Sun', 'Mars', 'Venus', 'Moon'];
