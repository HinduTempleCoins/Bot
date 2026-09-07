// divine-sets.mjs — THE COUNTED GROUPS: sevens, ogdoads, enneads, twelves.
//
// Fourth in the series with pantheon-map.mjs, time-cycles.mjs and correspondences.mjs.
//
// THE OBSERVATION THIS FILE ENCODES. The ancient world does not organise its gods into lists. It
// organises them into COUNTS — seven planets, seven archangels, eight of the Ogdoad, nine of the
// Ennead, twelve Olympians, twelve tribes, twelve Adityas. The number comes first and the roster is
// filled in locally.
//
// You can prove that rather than assert it, and `stability()` is how: for the sets where more than
// one ancient source gives a roster, compute the fraction of members present in EVERY version.
//
//   The twelve tribes are 12 in every source and the membership changes in every source. Numbers
//   drops Levi and splits Joseph into Ephraim and Manasseh to keep twelve. Revelation 7 drops Dan,
//   and keeps both Joseph AND Manasseh to keep twelve. Nobody ever lets the count move.
//
//   The twelve Olympians have the same problem: Hestia and Dionysus trade the twelfth seat, and
//   Hades is excluded despite being a brother, because he is not ON Olympus.
//
// When the count is rigid and the roster is negotiable, the NUMBER is the tradition and the members
// are the local implementation. That is a much stronger claim than "these pantheons resemble each
// other", and unlike that claim it is checkable.
//
// WHERE THE NUMBERS COME FROM. Mostly from the sky, and mostly derivable — see NUMBER_NOTES.
// Seven is the visible wanderers. Nine is frequently seven plus two (the Navagraha adds the lunar
// nodes Rahu and Ketu to the seven planets). Eight is frequently seven plus one (the Gnostic Ogdoad
// is the sphere ABOVE the seven planetary spheres). Twelve is the lunations in a year. The Egyptian
// Ennead is the exception and the best of them: nine is three times three, and Egyptian writes the
// plural with three strokes — so 3x3 is the plural of plurals, "all the gods". That number comes out
// of the GRAMMAR, not the sky.
//
//   import { SETS, byNumber, stability, unstable, NUMBER_NOTES } from './divine-sets.mjs'
//
// SECURITY / DISCIPLINE: pure data, no network, no clock, no keys.

export const SETS = [
  // ── SEVENS ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'seven-planets', n: 7, tradition: 'babylonian/hellenistic', label: 'The seven classical planets',
    members: ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'],
    variants: [], derivation: 'observed', source: 'MUL.APIN; Ptolemy, Almagest',
    note: 'The source number. Everything else with a seven in it is downstream of this or of the week it generates.',
  },
  {
    id: 'amesha-spentas', n: 7, tradition: 'zoroastrian', label: 'The Amesha Spentas',
    members: ['Ahura Mazda', 'Vohu Manah', 'Asha Vahishta', 'Khshathra Vairya', 'Spenta Armaiti', 'Haurvatat', 'Ameretat'],
    variants: [
      ['Spenta Mainyu', 'Vohu Manah', 'Asha Vahishta', 'Khshathra Vairya', 'Spenta Armaiti', 'Haurvatat', 'Ameretat'],
    ],
    derivation: 'chosen', source: 'Younger Avesta; Yasna Haptanghaiti',
    note: 'Six entities plus either Ahura Mazda himself or his Bounteous Spirit as the seventh. The seat is contested; the seven is not.',
  },
  {
    id: 'seven-archangels', n: 7, tradition: 'hebrew/enochic', label: 'The seven archangels',
    members: ['Uriel', 'Raphael', 'Raguel', 'Michael', 'Sariel', 'Gabriel', 'Remiel'],
    variants: [
      ['Michael', 'Gabriel', 'Raphael', 'Uriel', 'Selaphiel', 'Jegudiel', 'Barachiel'],
      ['Michael', 'Gabriel', 'Raphael', 'Uriel', 'Raguel', 'Sariel', 'Remiel'],
    ],
    derivation: 'chosen', source: '1 Enoch 20; Tobit 12:15 ("one of the seven"); later Christian lists',
    note: 'Only Michael, Gabriel and Raphael survive every list. The other four seats rotate freely.',
  },
  {
    id: 'apkallu', n: 7, tradition: 'mesopotamian', label: 'The seven antediluvian sages',
    members: ['Uanna (Adapa)', 'Uannedugga', 'Enmedugga', 'Enmegalamma', 'Enmebulugga', 'Anenlilda', 'Utuabzu'],
    variants: [], derivation: 'chosen', source: 'The Uruk List of Kings and Sages (W 20030,7); Berossus',
    note: 'Fish-cloaked sages who brought the arts of civilisation before the Flood — the seven who match the seven pre-Flood cities.',
  },
  {
    id: 'seven-hathors', n: 7, tradition: 'egyptian', label: 'The seven Hathors',
    members: ['Hathor of Thebes', 'Hathor of Heliopolis', 'Hathor of Aphroditopolis', 'Hathor of Sinai', 'Hathor of Momemphis', 'Hathor of Herakleopolis', 'Hathor of Keset'],
    variants: [], derivation: 'chosen', source: 'The Tale of the Doomed Prince; Book of the Dead 148',
    note: 'They appear at a birth and pronounce the child\'s fate — the same function as the Moirai and the Norns, in sevens rather than threes.',
  },
  {
    id: 'saptarishi', n: 7, tradition: 'hindu', label: 'The seven sages',
    members: ['Vasishtha', 'Vishvamitra', 'Bharadvaja', 'Jamadagni', 'Gautama', 'Atri', 'Kashyapa'],
    variants: [
      ['Marichi', 'Atri', 'Angiras', 'Pulaha', 'Kratu', 'Pulastya', 'Vasishtha'],
    ],
    derivation: 'observed', source: 'Shatapatha Brahmana; Mahabharata; Puranas',
    note: 'Identified with the seven stars of Ursa Major, which is why the count is fixed while the names are not.',
  },

  // ── EIGHTS ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'hermopolitan-ogdoad', n: 8, tradition: 'egyptian', label: 'The Ogdoad of Hermopolis',
    members: ['Nun', 'Naunet', 'Heh', 'Hauhet', 'Kek', 'Kauket', 'Amun', 'Amaunet'],
    variants: [
      ['Nun', 'Naunet', 'Heh', 'Hauhet', 'Kek', 'Kauket', 'Tenem', 'Tenemet'],
      ['Nun', 'Naunet', 'Heh', 'Hauhet', 'Kek', 'Kauket', 'Nia', 'Niat'],
    ],
    derivation: 'structural', source: 'Coffin Texts; the Khemenu ("Eight-town") theology, Hermopolis Magna',
    note: 'FOUR PAIRS, not eight individuals: primordial water, boundlessness, darkness, and hiddenness, each as a male frog-headed god and a female snake-headed goddess. The eight is 4x2. The fourth pair is the unstable one — Amun and Amaunet displaced an earlier pair when Amun was promoted, and the older names survive in the variants.',
  },
  {
    id: 'gnostic-ogdoad', n: 8, tradition: 'gnostic', label: 'The Ogdoad above the spheres',
    members: ['the eighth sphere, above the seven planetary heavens'],
    variants: [], derivation: 'derived', source: 'Corpus Hermeticum I.26; Irenaeus, Against Heresies I; the Nag Hammadi Discourse on the Eighth and Ninth',
    note: 'THE CLEANEST DERIVATION IN THE FILE. Eight here is simply seven plus one: the soul climbs the seven planetary spheres, sheds a vice at each, and arrives at the eighth. The number is not chosen — it is forced by the planetary count.',
  },
  {
    id: 'bagua', n: 8, tradition: 'chinese', label: 'The eight trigrams',
    members: ['Qian', 'Dui', 'Li', 'Zhen', 'Xun', 'Kan', 'Gen', 'Kun'],
    variants: [], derivation: 'derived', source: 'I Ching; the Shuogua commentary',
    note: 'A CONTROL, and a decisive one. Eight here is 2^3 — every combination of three broken-or-solid lines. Chinese reaches eight by binary arithmetic and Egypt reaches it by pairing four principles. Same number, unrelated reasons, no contact. Any argument from a shared eight has to get past this.',
  },

  // ── NINES ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'heliopolitan-ennead', n: 9, tradition: 'egyptian', label: 'The Ennead of Heliopolis',
    members: ['Atum', 'Shu', 'Tefnut', 'Geb', 'Nut', 'Osiris', 'Isis', 'Set', 'Nephthys'],
    variants: [
      ['Atum', 'Shu', 'Tefnut', 'Geb', 'Nut', 'Osiris', 'Isis', 'Set', 'Horus'],
    ],
    derivation: 'linguistic', source: 'Pyramid Texts; the Heliopolitan cosmogony',
    note: 'THE BEST NUMBER IN THE FILE. Egyptian writes the plural with three strokes, so three-times-three is the plural of plurals — "all the gods". Psdt, the word for Ennead, is built on the numeral nine. The count comes out of the GRAMMAR rather than the sky, which is why it is nine and not seven, and why some temples had a "Great Ennead" of more than nine members without anyone minding.',
  },
  {
    id: 'navagraha', n: 9, tradition: 'hindu', label: 'The nine grahas',
    members: ['Surya', 'Chandra', 'Mangala', 'Budha', 'Brihaspati', 'Shukra', 'Shani', 'Rahu', 'Ketu'],
    variants: [], derivation: 'derived', source: 'Brihat Parashara Hora Shastra; Surya Siddhanta',
    note: 'Seven plus two. The first seven are exactly the classical planets in exactly the Chaldean set; Rahu and Ketu are the ascending and descending lunar nodes — the eclipse points, which are not bodies at all. India took the Hellenistic seven and added the two places where the shadow falls.',
  },
  {
    id: 'nine-muses', n: 9, tradition: 'greek', label: 'The nine Muses',
    members: ['Calliope', 'Clio', 'Erato', 'Euterpe', 'Melpomene', 'Polyhymnia', 'Terpsichore', 'Thalia', 'Urania'],
    variants: [],
    predecessor: { n: 3, members: ['Melete', 'Mneme', 'Aoide'], source: 'Pausanias IX.29.2' },
    derivation: 'chosen', source: 'Hesiod, Theogony 75–79; Pausanias IX.29 for the older three',
    note: 'Pausanias preserves an older tradition of THREE Muses at Helicon — Practice, Memory and Song — later expanded to nine. Three to nine is the same 3x3 move the Egyptians made, arrived at independently.',
  },
  {
    id: 'norse-nine-worlds', n: 9, tradition: 'norse', label: 'The nine worlds',
    members: ['Asgard', 'Midgard', 'Jotunheim', 'Niflheim', 'Muspelheim', 'Alfheim', 'Svartalfheim/Nidavellir', 'Vanaheim', 'Helheim'],
    variants: [], derivation: 'chosen', source: 'Völuspá 2; Vafthrudnismal 43 — "nine worlds I know"',
    note: 'HONEST CAVEAT: the sources say NINE and no surviving source ever lists all nine. The roster above is a modern reconstruction assembled from scattered mentions, and it varies between modern retellings. This is the counted-set pattern in its purest form — the number is canonical scripture and the membership was never written down.',
  },

  // ── TWELVES ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'twelve-olympians', n: 12, tradition: 'greek', label: 'The twelve Olympians',
    members: ['Zeus', 'Hera', 'Poseidon', 'Demeter', 'Athena', 'Apollo', 'Artemis', 'Ares', 'Aphrodite', 'Hephaestus', 'Hermes', 'Hestia'],
    variants: [
      ['Zeus', 'Hera', 'Poseidon', 'Demeter', 'Athena', 'Apollo', 'Artemis', 'Ares', 'Aphrodite', 'Hephaestus', 'Hermes', 'Dionysus'],
    ],
    derivation: 'chosen', source: 'The Altar of the Twelve Gods, Athens (522 BCE); the Parthenon east frieze',
    note: 'Hestia and Dionysus trade the twelfth seat, and Hades is excluded despite being Zeus\'s brother, because he does not live on the mountain. The seat moves; the twelve never does.',
  },
  {
    id: 'dii-consentes', n: 12, tradition: 'roman', label: 'The Dii Consentes',
    members: ['Jupiter', 'Juno', 'Neptune', 'Minerva', 'Mars', 'Venus', 'Apollo', 'Diana', 'Vulcan', 'Vesta', 'Mercury', 'Ceres'],
    variants: [], derivation: 'chosen', source: 'Ennius\'s hexameter couplet, quoted by Apuleius; the Porticus Deorum Consentium, Forum Romanum',
    note: 'Stable precisely because it is a calque: Rome took the Greek twelve wholesale and renamed them, which is why this is the only twelve here with no variant.',
  },
  {
    id: 'twelve-tribes', n: 12, tradition: 'hebrew', label: 'The twelve tribes of Israel',
    members: ['Reuben', 'Simeon', 'Levi', 'Judah', 'Dan', 'Naphtali', 'Gad', 'Asher', 'Issachar', 'Zebulun', 'Joseph', 'Benjamin'],
    variants: [
      ['Reuben', 'Simeon', 'Judah', 'Dan', 'Naphtali', 'Gad', 'Asher', 'Issachar', 'Zebulun', 'Ephraim', 'Manasseh', 'Benjamin'],
      ['Judah', 'Reuben', 'Gad', 'Asher', 'Naphtali', 'Manasseh', 'Simeon', 'Levi', 'Issachar', 'Zebulun', 'Joseph', 'Benjamin'],
    ],
    derivation: 'chosen', source: 'Genesis 49; Numbers 1 (Levi out, Joseph split); Revelation 7:5–8 (Dan out, Manasseh AND Joseph in)',
    note: 'THE DEMONSTRATION CASE. Three canonical lists, three different rosters, one unchanging count. Numbers drops Levi and splits Joseph in two to hold twelve; Revelation drops Dan and keeps both Joseph and Manasseh to hold twelve. The bookkeeping is visible in the text.',
  },
  {
    id: 'adityas', n: 12, tradition: 'hindu', label: 'The twelve Adityas',
    members: ['Dhatri', 'Mitra', 'Aryaman', 'Rudra', 'Varuna', 'Surya', 'Bhaga', 'Vivasvat', 'Pushan', 'Savitri', 'Tvashtri', 'Vishnu'],
    variants: [],
    predecessor: { n: 6, members: ['Mitra', 'Varuna', 'Aryaman', 'Bhaga', 'Daksha', 'Amsha'], source: 'Rigveda II.27.1' },
    derivation: 'derived', source: 'Rigveda (six to eight); the Puranas and Mahabharata (twelve)',
    note: 'The Rigveda gives six or eight Adityas. Twelve appears later, once they are identified with the twelve solar months — the roster grew to fit the calendar.',
  },
  {
    id: 'twelve-apostles', n: 12, tradition: 'christian', label: 'The twelve apostles',
    members: ['Peter', 'Andrew', 'James son of Zebedee', 'John', 'Philip', 'Bartholomew', 'Matthew', 'Thomas', 'James son of Alphaeus', 'Thaddaeus', 'Simon the Zealot', 'Judas Iscariot'],
    variants: [
      ['Peter', 'Andrew', 'James son of Zebedee', 'John', 'Philip', 'Bartholomew', 'Matthew', 'Thomas', 'James son of Alphaeus', 'Judas son of James', 'Simon the Zealot', 'Judas Iscariot'],
    ],
    derivation: 'chosen', source: 'Mark 3:16–19; Matthew 10:2–4; Luke 6:14–16; Acts 1:13',
    note: 'Luke has Judas son of James where Mark and Matthew have Thaddaeus, and Acts 1 immediately elects Matthias to restore the twelve after Iscariot. The count is explicitly restored — the text tells you the number is the thing.',
  },
];

export const getSet = (id) => SETS.find((s) => s.id === id) || null;
export const NUMBERS = [...new Set(SETS.map((s) => s.n))].sort((a, b) => a - b);
export const byNumber = (n) => SETS.filter((s) => s.n === n);
export const byTradition = (t) => SETS.filter((s) => s.tradition.includes(t));

/**
 * For a set with attested variant rosters, what fraction of members survive every version?
 * Returns { n, versions, core, rotating, score } — score 1 means the roster never changes.
 */
export function stability(id) {
  const s = getSet(id);
  if (!s) return null;
  const versions = [s.members, ...(s.variants || [])];
  const core = s.members.filter((m) => versions.every((v) => v.includes(m)));
  const rotating = [...new Set(versions.flat())].filter((m) => !core.includes(m)).sort();
  return {
    id, n: s.n, versions: versions.length,
    core, rotating,
    score: s.members.length ? +(core.length / s.members.length).toFixed(2) : 0,
    countHeld: versions.every((v) => v.length === s.n),
  };
}

/** The sets whose membership demonstrably moves — sorted least stable first. */
export function unstable() {
  return SETS.filter((s) => (s.variants || []).length > 0)
    .map((s) => stability(s.id))
    .sort((a, b) => a.score - b.score);
}

/**
 * The claim, computed: across every set with more than one attested roster, the COUNT is held
 * in every single version while the membership is not. Returns the evidence for that.
 */
export function countBeatsRoster() {
  const withVariants = SETS.filter((s) => (s.variants || []).length > 0);
  const countAlwaysHeld = withVariants.every((s) => stability(s.id).countHeld);
  const rosterChanged = withVariants.filter((s) => stability(s.id).score < 1);
  return {
    setsWithVariants: withVariants.length,
    countAlwaysHeld,
    rosterChangedIn: rosterChanged.length,
    conclusion: countAlwaysHeld && rosterChanged.length === withVariants.length
      ? 'In every set with more than one attested roster at the same count, the number holds and the membership does not. The number is the tradition and the members are the local implementation.'
      : 'Mixed — check the exceptions.',
  };
}

/**
 * The other phenomenon, kept separate because conflating them would be cheating: sets where the
 * COUNT ITSELF grew. Three Muses became nine; six Adityas became twelve. In both cases the growth
 * is documented and the reason is known, which is exactly why they cannot be filed as roster churn.
 */
export function grewInCount() {
  return SETS.filter((s) => s.predecessor).map((s) => ({
    id: s.id, from: s.predecessor.n, to: s.n,
    earlierSource: s.predecessor.source,
    earlierMembers: s.predecessor.members,
    why: s.note,
  }));
}

// ── Where the numbers come from ────────────────────────────────────────────────────────────────
export const NUMBER_NOTES = {
  7: {
    origin: 'observed',
    why: 'The visible wanderers: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn. Every culture with a clear sky and patience gets seven.',
    licence: 'A shared seven proves NOTHING. It is the single most over-cited number in comparative religion and it is a control, not a tracer.',
  },
  8: {
    origin: 'derived, by two unrelated routes',
    why: 'Gnostic and Hermetic: the sphere above the seven, so 7+1. Egyptian: four principles in male-female pairs, so 4x2. Chinese: every combination of three lines, so 2^3.',
    licence: 'Three traditions, three different derivations, one number. The Bagua is the control that kills any argument from a shared eight.',
  },
  9: {
    origin: 'derived or grammatical',
    why: 'Hindu: the seven planets plus the two lunar nodes, so 7+2. Egyptian: three strokes mark the plural, so 3x3 is the plural of plurals. Greek: three Muses became nine by the same multiplication.',
    licence: 'The Egyptian nine is the only number in this file that comes out of a language rather than the sky, which makes it the most interesting and the least transferable.',
  },
  12: {
    origin: 'observed, then enforced',
    why: 'Twelve lunations fit a year to within eleven days. Once fixed as the frame, rosters are cut and padded to fit it — Levi dropped, Joseph split, Dan dropped, Matthias elected, Hestia unseated for Dionysus.',
    licence: 'The shared twelve is weak evidence; the shared SIGN NAMES of the zodiac travelling from Babylon to India are strong evidence. Argue from the names, never from the number.',
  },
};

/** The zodiac frame: twelve is astronomical, the names are the part that actually travelled. */
export const ZODIAC = {
  n: 12,
  babylonian: ['Hired Man', 'Bull of Heaven', 'Great Twins', 'Crayfish', 'Lion', 'Furrow', 'Scales', 'Scorpion', 'Pabilsag', 'Goat-Fish', 'Great One', 'Tails'],
  greek: ['Krios', 'Tauros', 'Didymoi', 'Karkinos', 'Leon', 'Parthenos', 'Zygos', 'Skorpios', 'Toxotes', 'Aigokeros', 'Hydrochoos', 'Ichthyes'],
  sanskrit: ['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrishchika', 'Dhanus', 'Makara', 'Kumbha', 'Mina'],
  source: 'MUL.APIN and the Babylonian 12-sign scheme (5th c. BCE); the Yavanajataka (c. 2nd–3rd c. CE) transmitting Hellenistic astrology into Sanskrit',
  verdict: 'The Sanskrit names are TRANSLATIONS of the Greek, which are translations of the Babylonian — ram, bull, twins, crab, lion, maiden, scales, scorpion, archer, goat-fish, water-pourer, fish, in that order, three times over.',
  why: 'Mesha is "ram" and Krios is "ram". Makara is a sea-monster and Aigokeros is "goat-horned" — both preserve the Babylonian GOAT-FISH, a composite creature no one would independently invent twice. THAT is the transmission proof, and it lives in the names, not in the twelve.',
};
