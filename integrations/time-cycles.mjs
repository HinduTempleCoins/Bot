// time-cycles.mjs — CALENDAR AND COUNTED-SET STRUCTURES, sorted by where their numbers come from.
//
// The companion to pantheon-map.mjs. That file asks "who says these two gods are one?"; this one
// asks the question that decides whether a correspondence chart is evidence or decoration:
//
//   IS THIS NUMBER DERIVED, OBSERVED, OR CHOSEN?
//
//   derived  — falls out of arithmetic once you state the rule. Anyone with the rule gets it.
//              Shared derived numbers prove nothing on their own; shared derived ORDER can.
//   observed — read off the sky. Two cultures watching the same sky get the same number with no
//              contact at all. These are the CONTROLS, and a chart built on them is worthless.
//   chosen   — nothing forced it. A different culture would have picked differently.
//              These are the TRACERS. A shared chosen number is the only kind that carries contact.
//
// This is the operator's own D0 principle stated as a data structure: shared input produces
// convergence; the arbitrary specifics are what actually travel.
//
// THE ONE RESULT THAT MATTERS. Run `sharedArbitrary()`. Almost everything drops out. What survives
// is 432,000 — Berossus gives 432,000 years to the ten kings before the Flood, and the Kali Yuga is
// 432,000 years. Nothing in astronomy forces that number, two traditions have it, and it is the
// strongest single tracer in the whole corpus. The card deck does NOT survive, and the reason it
// does not is written into its record rather than quietly dropped.
//
//   import { CYCLES, derive, classify, sharedArbitrary, DECK } from './time-cycles.mjs';
//
// SECURITY / DISCIPLINE: pure arithmetic, no network, no clock, no keys. Every `derive` is a real
// function whose output is asserted in the test — nothing here is asserted only in prose.

export const KINDS = ['derived', 'observed', 'chosen'];

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const lcm = (a, b) => (a / gcd(a, b)) * b;

// ── Derivations. Each returns the number, so a reader can check it instead of trusting it. ─────
export const derive = {
  /**
   * The planetary week. Rule the 24 hours of each day in Chaldean order (planets by apparent
   * orbital period); the ruler of hour 1 names the day. 24 mod 7 = 3, so each day steps three
   * positions along and you get an order DIFFERENT from the list you started with.
   * That difference is the proof: you cannot arrive at this sequence by copying the Chaldean list.
   */
  chaldeanWeek() {
    const CHALDEAN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];
    const days = [];
    for (let d = 0, i = 0; d < 7; d += 1, i += 24) days.push(CHALDEAN[i % 7]);
    return days; // Saturn, Sun, Moon, Mars, Mercury, Jupiter, Venus
  },

  /** Aztec Calendar Round: the 260-day tonalpohualli against the 365-day xiuhpohualli. */
  calendarRound() {
    const tonalpohualli = 20 * 13;      // 260 — twenty signs against thirteen numbers
    const xiuhpohualli = 18 * 20 + 5;   // 365 — eighteen twenty-day months plus five nemontemi
    const days = lcm(tonalpohualli, xiuhpohualli);
    return { tonalpohualli, xiuhpohualli, days, years: days / xiuhpohualli }; // 18980 days = 52 years
  },

  /** Chinese sexagenary cycle: ten heavenly stems against twelve earthly branches. */
  sexagenary() { return lcm(10, 12); }, // 60

  /** The Metonic cycle: 19 tropical years is 235 synodic months to within about two hours. */
  metonic() {
    const YEAR = 365.2422, LUNATION = 29.530588;
    const months = Math.round((19 * YEAR) / LUNATION);
    const errorHours = Math.abs(19 * YEAR - months * LUNATION) * 24;
    return { years: 19, months, errorHours: Number(errorHours.toFixed(2)) }; // 235, ~2h
  },

  /** The four yugas stand in a 4:3:2:1 ratio on a base of 432,000 years. */
  yugas() {
    const KALI = 432000;
    const y = { kali: KALI, dvapara: 2 * KALI, treta: 3 * KALI, satya: 4 * KALI };
    return { ...y, mahayuga: y.kali + y.dvapara + y.treta + y.satya }; // 4,320,000
  },

  /** Berossus: ten kings before the Flood, 120 sars, a sar being 3,600 years. */
  berossus() { return { kings: 10, sars: 120, sarYears: 3600, total: 120 * 3600 }; }, // 432,000

  /** Egyptian decans: 36 ten-day weeks give 360 days; twelve decans rise per night. */
  decans() {
    const decans = 36, decanDays = 10;
    return { decans, civilYear: decans * decanDays + 5, nightHours: decans / 3 }; // 365, 12
  },

  /** The standard calendar gloss on a 52-card deck. The arithmetic is real; see DECK for the catch. */
  deck() {
    const suits = 4, ranks = 13;
    let pips = 0;
    for (let r = 1; r <= ranks; r += 1) pips += r;
    return { cards: suits * ranks, courts: suits * 3, pipSum: pips * suits }; // 52, 12, 364
  },
};

// ── The catalogue ──────────────────────────────────────────────────────────────────────────────
export const CYCLES = [
  { id: 'planetary-week', name: 'The seven-day planetary week', count: 7, kind: 'derived',
    traditions: ['babylonian', 'hellenistic', 'roman', 'germanic'],
    source: 'Chaldean order + the planetary-hours rule; Dio Cassius, Roman History XXXVII.18-19',
    note: 'Derived — but the ORDER is not the order of the list it derives from, and the Germanic languages kept Saturn instead of substituting a god. That irregularity is what proves borrowing over parallel invention.' },
  { id: 'lunation', name: 'The synodic month', count: 29.53, kind: 'observed',
    traditions: ['universal'], source: 'The Moon',
    note: 'A control. Every calendar-building culture has this and none of them got it from each other.' },
  { id: 'solar-year', name: 'The solar year', count: 365.24, kind: 'observed',
    traditions: ['universal'], source: 'The Sun' },
  { id: 'metonic', name: 'The 19-year Metonic cycle', count: 19, kind: 'derived',
    traditions: ['babylonian', 'greek', 'hebrew', 'chinese'],
    source: 'Meton of Athens, 432 BCE; Babylonian intercalation from the 5th c. BCE',
    note: 'Anyone tracking Moon against Sun long enough finds it. Independent discovery in China is well documented, which makes it a control rather than a tracer.' },
  { id: 'decan-hours', name: 'Twelve night hours from thirty-six decans', count: 12, kind: 'derived',
    traditions: ['egyptian'], source: 'Decan star-clocks, Middle Kingdom coffin lids',
    note: 'The origin of the 24-hour day: twelve decans rise per night, so night gets twelve hours and day is given twelve to match.' },
  { id: 'sexagenary', name: 'The 60-year stem-branch cycle', count: 60, kind: 'derived',
    traditions: ['chinese'], source: 'Shang oracle bones; ten stems against twelve branches',
    note: 'lcm(10,12). The twelve branches track Jupiter, whose period is 11.86 years — so twelve is observed and sixty is derived from it.' },
  { id: 'calendar-round', name: 'The 52-year Aztec Calendar Round', count: 52, kind: 'derived',
    traditions: ['aztec', 'maya'], source: 'lcm(260, 365) = 18,980 days',
    note: 'THE CONTROL FOR THE CARD DECK. Mesoamerica produced a 52-cycle in total isolation from the Old World. A shared 52 therefore proves nothing at all.' },
  { id: 'tonalpohualli', name: 'The 260-day count', count: 260, kind: 'chosen',
    traditions: ['aztec', 'maya'], source: '20 day-signs x 13 numbers',
    note: 'Genuinely arbitrary — 260 matches no astronomical period. It is a real tracer, and it traces only inside Mesoamerica, which is exactly what an honest tracer looks like.' },
  { id: 'yuga-base', name: 'The 432,000-year Kali Yuga', count: 432000, kind: 'chosen',
    traditions: ['hindu'], source: 'Manusmriti I.68-71; Surya Siddhanta',
    note: 'Nothing in the sky forces 432,000. See sharedArbitrary().' },
  { id: 'berossus-kings', name: '432,000 years of antediluvian kings', count: 432000, kind: 'chosen',
    traditions: ['babylonian'], source: 'Berossus, Babyloniaca (via Syncellus and Eusebius), c. 290 BCE',
    note: 'Ten kings, 120 sars of 3,600 years. The Sumerian King List gives the same ten-kings-before-the-Flood frame with different totals.' },
  { id: 'zodiac', name: 'The twelve-sign zodiac', count: 12, kind: 'derived',
    traditions: ['babylonian', 'greek', 'hindu', 'roman'],
    source: 'MUL.APIN and the Babylonian 12-sign scheme, c. 5th c. BCE',
    note: 'Twelve lunations fit a year to within eleven days, so twelve is close to forced. The SIGN NAMES are the chosen part, and those did travel to India — that is where the real transmission argument lives.' },
  { id: 'lunar-mansions', name: 'The lunar mansions', count: 27, kind: 'derived',
    traditions: ['hindu', 'arabic', 'chinese'],
    source: 'Vedic nakshatras (27); Arabic manazil (28); Chinese xiu (28)',
    note: 'The Moon moves about 13 degrees a day, so 27-28 stations is near-forced. The counts differ between traditions, which is what independent derivation looks like.' },
  { id: 'eleven-rudras', name: 'The eleven Rudras', count: 11, kind: 'chosen',
    traditions: ['hindu'], source: 'Rigveda-adjacent enumerations; Brihadaranyaka Upanishad III.9',
    note: 'Eleven is not forced by anything, and the NAMES differ between the Puranic lists — an unstable chosen set. Unstable sets cannot carry transmission, because there is nothing fixed to travel.' },
  { id: 'fourteen-lokas', name: 'The fourteen lokas', count: 14, kind: 'chosen',
    traditions: ['hindu'], source: 'Puranic cosmology: seven upper vyahrtis and seven lower talas',
    note: 'Seven-above-and-seven-below is the shape worth comparing, not the fourteen. Compare the seven heavens of Mesopotamian and later Islamic cosmology.' },
  { id: 'seven-heavens', name: 'The seven heavens', count: 7, kind: 'derived',
    traditions: ['babylonian', 'hebrew', 'islamic', 'hermetic'],
    source: 'Seven planetary spheres; Quran 2:29, 65:12; the Hermetic ascent',
    note: 'Derived from the same seven visible wanderers that gave the week. Same input, so convergence proves nothing — but the ORDER of the ascent is chosen, and the Hermetic order is the Chaldean order.' },
];

export const byKind = (k) => CYCLES.filter((c) => c.kind === k);

/** Cycles sharing a count across traditions that do not overlap. Grouped, strongest kind first. */
export function sharedArbitrary() {
  const groups = new Map();
  for (const c of CYCLES) {
    if (c.kind !== 'chosen') continue;
    const g = groups.get(c.count) || [];
    g.push(c); groups.set(c.count, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => new Set(g.flatMap((c) => c.traditions)).size > 1 && g.length > 1)
    .map(([count, g]) => ({
      count,
      cycles: g.map((c) => c.id),
      traditions: [...new Set(g.flatMap((c) => c.traditions))].sort(),
    }));
}

/** What kind of number is this, and what does sharing it license you to claim? */
export function classify(id) {
  const c = CYCLES.find((x) => x.id === id);
  if (!c) return null;
  const licence = {
    derived: 'Sharing this licenses nothing. State the rule and anyone reproduces it. Argue from the ORDER or the NAMES instead.',
    observed: 'Sharing this licenses nothing whatsoever. It is a control — the sky is the shared input.',
    chosen: 'Sharing this is real evidence of contact, provided the set is stable and the traditions are otherwise unconnected.',
  }[c.kind];
  return { ...c, licence };
}

// ── The card deck ──────────────────────────────────────────────────────────────────────────────
// Kept as its own record because it is the case people most want to be true, and it is not.
export const DECK = {
  arithmetic: derive.deck(),          // { cards: 52, courts: 12, pipSum: 364 }
  gloss: [
    '52 cards ~ 52 weeks',
    '4 suits ~ 4 seasons',
    '13 ranks ~ 13 lunations, and 13 weeks per quarter',
    '12 court cards ~ 12 months',
    'pip values summed = 364; add the joker for 365, the second joker for a leap year',
  ],
  verdict: 'The arithmetic is exact and the intent is unattested.',
  why: [
    'The 4x13 structure arrives in Europe already complete in the Mamluk deck (c. 1370), which has four suits of thirteen with three court cards each. Europe inherited the shape; it did not design it to a calendar.',
    'The calendar reading is not recorded before the 18th century, where it appears as a soldier\'s pious anecdote (the "Card Player\'s Prayer"), i.e. a devotional gloss on an existing object.',
    'The Aztec Calendar Round independently produces 52 from lcm(260,365). A number two isolated hemispheres both reach is not a fingerprint.',
    'The two jokers that complete 365 and 366 are a 19th-century American addition for euchre. The prettiest step in the gloss is the most recent.',
  ],
  useIt: 'As a mnemonic and as a game object it is excellent. As evidence of ancient calendrical design it fails, and the tarot-to-Kabbalah attributions fail the same way and for the same reason: Court de Gebelin invented the Egyptian origin in 1781, and the Golden Dawn fixed the correspondences in the 1890s.',
};

// ── One structural note that keeps getting mistaken for a tracer ────────────────────────────────
export const AXIS_MUNDI = {
  claim: 'The world-tree with a bird at the crown and a serpent at the root, and a messenger running between them.',
  instances: [
    { tradition: 'norse', detail: 'Yggdrasil: an unnamed eagle in the branches, Nidhoggr gnawing the root, and Ratatoskr the squirrel carrying their insults up and down.', source: 'Grimnismal 32; Snorri, Gylfaginning 16' },
    { tradition: 'mesopotamian', detail: 'The eagle nesting in the crown of the tree and the serpent at its base, who become enemies.', source: 'The Myth of Etana, Old Babylonian recension' },
    { tradition: 'hindu', detail: 'The asvattha rooted above and branching below; and separately the serpent coiled at the base of the spine with the crown above it.', source: 'Bhagavad Gita 15.1; Katha Upanishad VI.1' },
  ],
  verdict: 'structural, not a tracer',
  why: 'Bird-above / serpent-below on a vertical axis is close to universal, and the three instances differ in every specific: Ratatoskr has no counterpart anywhere else, Etana\'s pair are former friends, and the Indian versions are two separate images that later readers merged. The messenger squirrel is the one genuinely arbitrary detail in the set, and it is unique to Norse — which is precisely why it cannot be evidence of contact, only of invention.',
};
