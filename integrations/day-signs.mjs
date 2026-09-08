// day-signs.mjs — THE NAMED DAYS AND THE GODS OF THE HOUR, and one correction the corpus needs.
//
// Sixth in the series with pantheon-map.mjs, divine-sets.mjs, correspondences.mjs, time-cycles.mjs
// and divine-attributes.mjs. time-cycles.mjs asks where a NUMBER comes from. This file asks the
// next question: when a tradition names its days and its hours after animals and gods, are the
// systems related — or do they merely look related once translated into English?
//
// ⭐ THE CORRECTION THIS FILE EXISTS TO CARRY.
//
// This repo's knowledge corpus states, in at least five files, that the Aztec first era "4 Tiger"
// is an anomaly — "THERE ARE NO TIGERS IN THE AMERICAS", therefore trans-Pacific contact, therefore
// a global consciousness network preserving Asian fauna. See `aztec_tiger_anomaly` in
// knowledge/consciousness/ultimate_global_consciousness_synthesis.json and `aztec_tiger_mystery` in
// knowledge/history/libya_mediterranean_civilization_origin.json.
//
// The anomaly is an artefact of TRANSLATION and it dissolves in the source language.
//
// The Nahuatl is *Nahui Ōcēlōtl*. **Ōcēlōtl means JAGUAR** — Panthera onca, an animal native to
// Mesoamerica, whose range reached the Valley of Mexico. It does not mean tiger. The day-sign is
// drawn as a jaguar in the codices, and the jaguar is the single most important predator in
// Mesoamerican religion.
//
// "Tiger" enters through Spanish. Spanish had no word for the jaguar, so the chroniclers wrote
// *tigre* — as Spanish speakers still do. English translations inherited "tiger" from the Spanish,
// not from the Nahuatl. So the question "how did the Aztecs know what a tiger was?" has the answer:
// they did not say tiger. They said jaguar, and they had jaguars.
//
// This is the same shape as the caduceus in divine-attributes.mjs and the 1927 rainbow chakras in
// correspondences.mjs — a modern artefact riding on an ancient object, invisible once flattened into
// English. It removes ONE piece of evidence from the contact thesis. It does not touch the others,
// and this file does not pretend it does.
//
//   import { SYSTEMS, ARTIFACTS, animalSigns, hourGods, sharedAnimals } from './day-signs.mjs'
//   node integrations/day-signs.mjs artifacts

import { fileURLToPath } from 'node:url';
import { TIERS, tierRank } from './pantheon-map.mjs';

export { TIERS, tierRank };

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── the systems ────────────────────────────────────────────────────────────────────────────────
// `period` is what one member of the cycle governs: a day, a night-hour, an unequal hour, a year.
export const SYSTEMS = [
  {
    id: 'tonalpohualli', label: 'Aztec day-signs (tonalpohualli)', tradition: 'aztec',
    n: 20, period: 'day', attested: 1300, tier: 'epigraphic',
    source: 'Codex Borbonicus, Codex Borgia, Codex Telleriano-Remensis; Sahagún, Historia general (Florentine Codex) Book IV',
    note: 'Twenty signs × thirteen numbers = a 260-day count. The signs are things, not gods — but each is PATRONISED by a god, which is the join to the hour-god systems.',
    animalMembers: ['cipactli (crocodilian)', 'ehecatl (wind)', 'calli (house)', 'cuetzpalin (lizard)', 'coatl (serpent)',
      'miquiztli (death)', 'mazatl (deer)', 'tochtli (rabbit)', 'atl (water)', 'itzcuintli (dog)',
      'ozomahtli (monkey)', 'malinalli (grass)', 'acatl (reed)', 'ocelotl (JAGUAR)', 'cuauhtli (eagle)',
      'cozcacuauhtli (vulture)', 'ollin (movement)', 'tecpatl (flint)', 'quiahuitl (rain)', 'xochitl (flower)'],
  },
  {
    id: 'earthly-branches', label: 'Chinese zodiac animals (the twelve earthly branches)', tradition: 'chinese',
    n: 12, period: 'year', attested: -1200, tier: 'epigraphic',
    source: 'The twelve branches are on Shang oracle bones (c. 1200 BC) as a day-count; the ANIMAL associations are later — attested by the Han, e.g. Wang Chong, Lunheng (1st c. CE)',
    note: '⚠️ The branches and the animals are separated by more than a thousand years. The cycle is ancient; the zoo is a later overlay. Anyone comparing "Chinese animal years" to another animal calendar is comparing the LATER layer.',
    animalMembers: ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig'],
  },
  {
    id: 'decans', label: 'Egyptian decans', tradition: 'egyptian',
    n: 36, period: 'ten-day week / night-hour', attested: -2100, tier: 'epigraphic',
    source: 'Coffin-lid star clocks from the First Intermediate Period/Middle Kingdom onward; later the Dendera zodiac (Ptolemaic)',
    note: 'THE ORIGINAL GODS OF THE HOUR. Decans are stars whose heliacal risings mark night-hours; they are deified, and they are the mechanism by which the hour acquired a god at all. Later absorbed into Hellenistic astrology as 36 ten-degree divisions of the zodiac.',
    animalMembers: [],
  },
  {
    id: 'planetary-hours', label: 'The planetary hours (Chaldean order)', tradition: 'hellenistic',
    n: 7, period: 'unequal hour', attested: 150, tier: 'attested',
    source: 'The Chaldean-order hour scheme underlies the planetary WEEK; Dio Cassius, Roman History XXXVII.18–19 explains the derivation explicitly',
    note: 'The one system here that demonstrably GENERATED another: rotating seven planets through 24 hours and taking the ruler of the first hour yields the weekday order we still use. Dio reports it as a known derivation, not a theory.',
    animalMembers: [],
  },
  {
    id: 'lords-of-the-night', label: 'The Nine Lords of the Night (Yohualtēuctin)', tradition: 'aztec',
    n: 9, period: 'night', attested: 1300, tier: 'epigraphic',
    source: 'Codex Borbonicus; Codex Borgia; the series is shared with the Maya G1–G9 glyphs',
    note: 'Genuine hour-gods of the Americas, and the closest real parallel to the decans — a fixed rotating series of deities governing successive nights.',
    animalMembers: [],
  },
  {
    id: 'nakshatra', label: 'The nakshatras (lunar mansions)', tradition: 'hindu',
    n: 27, period: 'lunar day-station', attested: -1000, tier: 'attested',
    source: 'Named lists in the Atharvaveda (XIX.7) and the Taittirīya Saṃhitā; each nakshatra has a presiding deity',
    note: 'A lunar, not solar, division — 27 or 28 stations the moon passes. Each carries a devatā, so this IS a gods-of-the-period system, and it is older than the Hellenistic zodiac reaching India.',
    animalMembers: [],
  },
  {
    id: 'hora', label: 'Horā (the Hindu planetary hour)', tradition: 'hindu',
    n: 7, period: 'hour', attested: 400, tier: 'attested',
    source: 'Yavanajātaka and the later Sanskrit jyotiṣa tradition; the name horā is itself borrowed from Greek hōra',
    note: '⭐ A DOCUMENTED TRANSMISSION, not a coincidence. The Sanskrit term horā is the Greek ὥρα. This is what a real borrowing looks like in the evidence — the loanword travels with the technique — and it is the standard against which every unevidenced "these two systems must be connected" claim should be measured.',
    animalMembers: [],
  },
];

export const getSystem = (id) => SYSTEMS.find((s) => s.id === String(id || '').toLowerCase()) || null;
export const TRADITIONS = [...new Set(SYSTEMS.map((s) => s.tradition))].sort();
export const byTradition = (t) => SYSTEMS.filter((s) => s.tradition === String(t || '').toLowerCase());

/** Systems whose members are animals — the only ones a "same animals?" comparison can even use. */
export const animalSigns = () => SYSTEMS.filter((s) => s.animalMembers.length > 0);

/** Systems that assign a deity to a unit of time. The operator's "Gods of the Hour". */
export const hourGods = () => SYSTEMS.filter((s) => /hour|night/.test(s.period) || s.id === 'nakshatra');

// ── translation artefacts ──────────────────────────────────────────────────────────────────────
// Claims that look like evidence of contact but are produced by the translation itself.
export const ARTIFACTS = [
  {
    id: 'aztec-tiger',
    claim: 'The Aztec first era is "4 Tiger" and there are no tigers in the Americas — so the knowledge came from Asia.',
    appearsIn: [
      'knowledge/consciousness/ultimate_global_consciousness_synthesis.json (aztec_tiger_anomaly)',
      'knowledge/consciousness/global_consciousness_network.json',
      'knowledge/history/libya_mediterranean_civilization_origin.json (aztec_tiger_mystery)',
      'knowledge/history/atlas_atlantis_genealogy_synthesis.json',
      'knowledge/spirituality/lord_of_ages_theological_synthesis.json',
    ],
    sourceLanguage: 'Classical Nahuatl',
    term: 'ōcēlōtl',
    actualMeaning: 'jaguar (Panthera onca) — native to Mesoamerica, and the central predator of Mesoamerican religion',
    howTheErrorEnters: 'Spanish had no word for the jaguar, so the chroniclers wrote tigre — as Spanish speakers still do for the jaguar. English translations inherited "tiger" from the Spanish, never from the Nahuatl.',
    verdict: 'dissolved',
    verifiedAgainst: 'Wiktionary Classical Nahuatl lemma ōcēlōtl: "(it is) a jaguar (Panthera onca)"; Central Nahuatl: "jaguar". The day-sign is drawn as a jaguar throughout the codices.',
    scope: 'This removes ONE piece of evidence from the trans-Pacific-contact argument. It does not bear on the others, which stand or fall on their own.',
  },
  {
    id: 'ocelot-the-cat',
    claim: 'The ocelot is the animal the Aztec day-sign is named for.',
    sourceLanguage: 'Classical Nahuatl',
    term: 'ōcēlōtl',
    actualMeaning: 'jaguar',
    howTheErrorEnters: 'English "ocelot" descends from ōcēlōtl via French, but was applied to a DIFFERENT and much smaller cat, Leopardus pardalis. The English word is a misapplication of the Nahuatl one.',
    verdict: 'dissolved',
    verifiedAgainst: 'Same lemma. The two cats are not the same animal and the day-sign is the jaguar.',
    scope: 'A second, quieter consequence of the same word — worth recording because it makes the first error feel plausible.',
  },
  {
    id: 'chinese-animal-antiquity',
    claim: 'The Chinese animal zodiac is a Bronze Age system contemporary with the oracle bones.',
    sourceLanguage: 'Old Chinese',
    term: 'the twelve earthly branches (dìzhī)',
    actualMeaning: 'a twelve-unit counting cycle',
    howTheErrorEnters: 'The BRANCHES are on Shang oracle bones c. 1200 BC. The ANIMALS attached to them are attested much later, by the Han. Calling the animals Bronze Age transfers the age of the count to the zoo.',
    verdict: 'partial',
    verifiedAgainst: 'Wang Chong, Lunheng (1st c. CE) is the standard early witness for the animal series.',
    scope: 'Does not dissolve the system — it dates the layer. Any cross-cultural animal-calendar comparison must use the later date.',
  },
];

export const artifacts = () => ARTIFACTS;
export const dissolved = () => ARTIFACTS.filter((a) => a.verdict === 'dissolved');

/**
 * Animals appearing in more than one animal-sign system, by ENGLISH gloss.
 * Deliberately shaped to make its own weakness visible: matching on the English is exactly the
 * mistake the tiger case is made of, so the result carries a warning rather than a conclusion.
 */
export function sharedAnimals() {
  const seen = new Map();
  for (const s of animalSigns()) {
    for (const m of s.animalMembers) {
      // Compare on the English gloss only — the parenthetical — never on the native term.
      const gloss = (m.match(/\(([^)]+)\)/)?.[1] || m).toLowerCase().trim();
      if (!seen.has(gloss)) seen.set(gloss, new Set());
      seen.get(gloss).add(s.id);
    }
  }
  const shared = [...seen.entries()].filter(([, ids]) => ids.size > 1)
    .map(([animal, ids]) => ({ animal, systems: [...ids] }));
  return {
    shared,
    warning: 'Matched on ENGLISH glosses. That is the same operation that produced the "4 Tiger" error — '
      + 'two traditions can share a gloss and share no animal. Treat every row as a question, not a finding.',
  };
}

/** Shape check. Returns problems; never throws. */
export function validate() {
  const problems = [];
  for (const s of SYSTEMS) {
    if (!Number.isFinite(s.n) || s.n <= 0) problems.push(`${s.id}: bad n`);
    if (!TIERS.includes(s.tier)) problems.push(`${s.id}: unknown tier ${s.tier}`);
    if (!s.source) problems.push(`${s.id}: no source`);
    if (s.animalMembers.length && s.animalMembers.length !== s.n) problems.push(`${s.id}: ${s.animalMembers.length} members but n=${s.n}`);
  }
  for (const a of ARTIFACTS) {
    if (!a.verifiedAgainst) problems.push(`${a.id}: no verification recorded`);
    if (!['dissolved', 'partial', 'stands'].includes(a.verdict)) problems.push(`${a.id}: bad verdict`);
    if (a.verdict === 'dissolved' && !a.scope) problems.push(`${a.id}: dissolved without stating what it does NOT touch`);
  }
  return { ok: problems.length === 0, problems };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'day-signs',
    counts: { systems: SYSTEMS.length, artifacts: ARTIFACTS.length, dissolved: dissolved().length },
    note: 'named days and gods of the hour across traditions, plus the claims that look like contact '
        + 'evidence but are produced by translation. ōcēlōtl means jaguar.',
  }, null, 2));
}

export default { SYSTEMS, ARTIFACTS, TIERS, getSystem, byTradition, animalSigns, hourGods, sharedAnimals, artifacts, dissolved, validate, handler };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === 'artifacts') {
    for (const a of ARTIFACTS) {
      console.log(`\n[${a.verdict.toUpperCase()}] ${a.id}\n  claim: ${a.claim}\n  ${a.term} = ${a.actualMeaning}\n  how the error enters: ${a.howTheErrorEnters}\n  verified: ${a.verifiedAgainst}`);
      if (a.appearsIn) for (const f of a.appearsIn) console.log(`    corpus: ${f}`);
    }
  } else {
    const v = validate();
    console.log(`${SYSTEMS.length} systems · ${ARTIFACTS.length} artefacts (${dissolved().length} dissolved) · valid: ${v.ok}`);
    for (const s of SYSTEMS) console.log(`  ${String(s.n).padStart(2)}  ${s.label}  [${s.period}]  ${s.attested} (${s.tier})`);
    const sa = sharedAnimals();
    console.log(`\nshared animal glosses: ${sa.shared.map((x) => x.animal).join(', ') || '(none)'}`);
    console.log(`  ⚠️ ${sa.warning}`);
  }
}
