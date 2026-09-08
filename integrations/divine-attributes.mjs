// divine-attributes.mjs — WHAT THE GOD IS HOLDING, AND WHO SAYS IT MEANS THAT.
//
// Fifth in the series with pantheon-map.mjs (is this god that god?), divine-sets.mjs (the counted
// groups), correspondences.mjs (when was this table first written down?) and time-cycles.mjs.
// `hierophant-entities.mjs` answers "who is this god"; nothing in the corpus recorded what the god
// HOLDS, RIDES, WEARS, or is ACCOMPANIED BY — which is most of what an image of a god actually is.
//
// THE DISTINCTION THIS FILE EXISTS FOR, and it is not the one the other files make.
//
// The sibling modules date a claim once. An attribute needs dating TWICE, because the object and its
// explanation are almost never the same age:
//
//   `attested`        — when the god is first shown or said to carry the thing
//   `meaningAttested` — when somebody first says what carrying it MEANS
//
// Those can be a thousand years apart, and the gap is where the genre does its damage. Athena's owl
// is on Athenian coins in the 6th century BC; "the owl means wisdom" is a much later gloss on a bird
// that was probably local before it was symbolic. Collapsing the two dates into one row produces a
// table where a Bronze Age cult object and a Victorian explanation of it are indistinguishable —
// the exact failure `pantheon-map.mjs` was built to prevent for equations, reproduced for iconography.
//
// So every entry carries both, each with its own tier, and `retrofitted()` returns the ones where the
// meaning is centuries younger than the object. That list is the useful output of this file.
//
// TIERS are imported from pantheon-map.mjs rather than restated. One ladder, one definition.
//
//   import { ATTRIBUTES, forDeity, byKind, retrofitted, tracers } from './divine-attributes.mjs'
//   node integrations/divine-attributes.mjs shiva

import { fileURLToPath } from 'node:url';
import { TIERS, tierRank } from './pantheon-map.mjs';

export { TIERS, tierRank };

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The five things an image of a god actually contains, beyond the body. */
export const KINDS = Object.freeze(['weapon', 'animal', 'plant', 'instrument', 'regalia']);

// `attested` / `meaningAttested` are years; NEGATIVE IS BC. `null` means we could not date it and
// say so rather than guessing — an undated row is a known gap, not a silent one.
export const ATTRIBUTES = [
  // ── GREEK ─────────────────────────────────────────────────────────────────────────────────────
  {
    deity: 'zeus', tradition: 'greek', kind: 'weapon', name: 'keraunos (thunderbolt)',
    attested: -700, tier: 'attested',
    source: 'Hesiod, Theogony 501–506 — the Cyclopes give Zeus thunder and the smoking bolt; Homer, Iliad VIII.133',
    meaning: 'sovereignty enforced by the sky-god; the instrument by which the Titanomachy is won',
    meaningAttested: -700, meaningTier: 'attested',
    note: 'Object and meaning are the same age here — Hesiod gives the bolt AND says what it is for. That is unusual, and it is the baseline the retrofitted cases are measured against.',
  },
  {
    deity: 'zeus', tradition: 'greek', kind: 'animal', name: 'eagle (aetos)',
    attested: -700, tier: 'attested',
    source: 'Homer, Iliad XXIV.310–315 — the eagle sent as Zeus’s surest omen; XII.200–209',
    meaning: 'the god’s messenger and omen-bearer, not an emblem of "power" in the modern heraldic sense',
    meaningAttested: -700, meaningTier: 'attested',
  },
  {
    deity: 'athena', tradition: 'greek', kind: 'regalia', name: 'aegis',
    attested: -700, tier: 'attested',
    source: 'Homer, Iliad V.738–742 — the tasselled aegis bearing the Gorgon’s head',
    meaning: 'apotropaic terror — a thing worn to rout an enemy, not a shield in the defensive sense',
    meaningAttested: -700, meaningTier: 'attested',
    note: 'Whether the aegis is a shield, a goatskin, or a cape is genuinely unsettled in the sources. Recorded as unsettled rather than resolved.',
  },
  {
    deity: 'athena', tradition: 'greek', kind: 'animal', name: 'owl (glaux)',
    attested: -525, tier: 'epigraphic',
    source: 'Athenian silver tetradrachms bearing the owl, struck from the late 6th century BC; Homer’s epithet glaukopis is earlier but its sense is disputed',
    meaning: 'wisdom',
    meaningAttested: 1600, meaningTier: 'conjecture',
    note: 'THE TRACER. The bird is on the coinage in the 6th century BC. "The owl means wisdom" is a late gloss that the ancient sources do not make in those terms — glaukopis may mean bright-eyed or grey-eyed rather than owl-faced. Object: ancient. Explanation: early modern.',
  },
  {
    deity: 'apollo', tradition: 'greek', kind: 'instrument', name: 'lyre (chelys / kithara)',
    attested: -650, tier: 'attested',
    source: 'Homeric Hymn to Hermes 418–502 — Hermes builds the lyre from a tortoise shell and gives it to Apollo',
    meaning: 'the ordered, measured music of the Olympian order — set against the aulos and Dionysiac ecstasy',
    meaningAttested: -380, meaningTier: 'attested',
    note: 'The Apollo/Dionysos, lyre/aulos opposition is genuinely ancient — Plato, Republic III.399d prefers the lyre and rejects the aulos. Nietzsche did not invent it, though he is usually credited.',
  },
  {
    deity: 'apollo', tradition: 'greek', kind: 'plant', name: 'laurel (daphne)',
    attested: -600, tier: 'cultic',
    source: 'Homeric Hymn to Apollo; the Pythia’s laurel and the Pythian victor’s wreath at Delphi. The Daphne aetiology is late — Ovid, Metamorphoses I.452–567',
    meaning: 'prophetic possession and victory',
    meaningAttested: -600, meaningTier: 'cultic',
    note: 'The cult use precedes the myth that explains it. Ovid supplies a story for a practice already centuries old — a standard shape in this material.',
  },
  {
    deity: 'hermes', tradition: 'greek', kind: 'regalia', name: 'kerykeion (caduceus)',
    attested: -650, tier: 'attested',
    source: 'Homeric Hymn to Hermes 528–532 — the golden three-leafed staff; herald’s staff in Attic vase painting from the 6th century BC',
    meaning: 'heraldic immunity and safe passage, including passage between the living and the dead',
    meaningAttested: -650, meaningTier: 'attested',
    note: '⚠️ THE FAMOUS ERROR, and it is modern and American. The kerykeion (two snakes, winged) is a HERALD’S staff. The physician’s emblem is the Rod of Asclepius — ONE snake, no wings. The US Army Medical Corps adopted the caduceus in 1902 and American medicine copied the mistake; European medicine largely did not. A commercial or medical use of the caduceus is a citation of a 1902 filing error, not of antiquity.',
  },
  {
    deity: 'dionysos', tradition: 'greek', kind: 'regalia', name: 'thyrsos',
    attested: -405, tier: 'attested',
    source: 'Euripides, Bacchae (produced posthumously c. 405 BC) — the fennel stalk tipped with a pine cone and bound with ivy',
    meaning: 'the god’s possession made portable; it strikes water and wine from rock in the play itself',
    meaningAttested: -405, meaningTier: 'attested',
  },
  {
    deity: 'dionysos', tradition: 'greek', kind: 'plant', name: 'ivy (kissos) and vine',
    attested: -405, tier: 'cultic',
    source: 'Euripides, Bacchae; ivy-wreathed Dionysos is standard on Attic black-figure from the 6th century BC',
    meaning: 'the evergreen that does not die back — paired with the vine that does',
    meaningAttested: null, meaningTier: 'conjecture',
    note: 'The evergreen/deciduous pairing is a plausible and commonly repeated reading that I could not trace to an ancient source. Marked conjecture rather than asserted.',
  },
  {
    deity: 'poseidon', tradition: 'greek', kind: 'weapon', name: 'trident (triaina)',
    attested: -700, tier: 'attested',
    source: 'Homer, Iliad XII.27; Odyssey IV.506; Hesiod, Theogony',
    meaning: 'the earth-shaker’s instrument; plausibly a fishing spear raised to divine scale',
    meaningAttested: null, meaningTier: 'structural',
    note: 'The tuna-spear derivation is widely repeated and is structurally reasonable, but I did not find it stated in an ancient source. Structural, not attested.',
  },

  // ── EGYPTIAN ──────────────────────────────────────────────────────────────────────────────────
  {
    deity: 'thoth', tradition: 'egyptian', kind: 'instrument', name: 'scribal palette and reed pen',
    attested: -2400, tier: 'epigraphic',
    source: 'Old Kingdom Pyramid Texts and Old Kingdom scribal iconography; the palette (gsti) is Thoth’s standard attribute thereafter',
    meaning: 'writing as a divine act; the god records the verdict at the weighing of the heart',
    meaningAttested: -1550, meaningTier: 'attested',
    note: 'Book of the Dead spell 125 (New Kingdom) shows Thoth recording the judgment — the meaning is attested, later than the object.',
  },
  {
    deity: 'thoth', tradition: 'egyptian', kind: 'animal', name: 'ibis and baboon',
    attested: -3000, tier: 'epigraphic',
    source: 'Early Dynastic ibis iconography; the vast ibis mummy deposits at Tuna el-Gebel and Saqqara are Late Period',
    meaning: 'two theriomorphic forms of one god, not two gods',
    meaningAttested: null, meaningTier: 'structural',
  },
  {
    deity: 'hathor', tradition: 'egyptian', kind: 'instrument', name: 'sistrum (sekhem / sesheshet)',
    attested: -2000, tier: 'epigraphic',
    source: 'Middle Kingdom onward; Hathoric sistrum handles carved with the goddess’s face are a standard temple object',
    meaning: 'the rattle whose sound placates the goddess and drives off hostile force',
    meaningAttested: -1550, meaningTier: 'attested',
    note: 'One of the very few musical instruments that IS a deity’s attribute rather than merely associated with one. The instrument carries her face on its handle — the object and the god are the same object.',
  },
  {
    deity: 'sekhmet', tradition: 'egyptian', kind: 'animal', name: 'lioness',
    attested: -2400, tier: 'epigraphic',
    source: 'Old Kingdom; the Karnak granite Sekhmet statues (Amenhotep III, 18th Dynasty) survive in the hundreds',
    meaning: 'plague and its cure held by one power — the goddess who sends the arrows also withdraws them',
    meaningAttested: -1550, meaningTier: 'attested',
  },

  // ── HINDU ─────────────────────────────────────────────────────────────────────────────────────
  // The operator's own tradition. Dating here is deliberately conservative: text dates in Sanskrit
  // literature are ranges, not years, and are given as the earliest defensible attestation.
  {
    deity: 'shiva', tradition: 'hindu', kind: 'weapon', name: 'trishula (trident)',
    attested: -100, tier: 'epigraphic',
    source: 'Trishula on Kushan-era coinage of Vima Kadphises and Kanishka (1st–2nd c. CE); the Shiva/Rudra complex is far older (Rigveda) but the trident as fixed attribute is later',
    meaning: 'commonly glossed as the three gunas, or creation/preservation/destruction, or the three times',
    meaningAttested: null, meaningTier: 'conjecture',
    note: 'The trident is securely ancient. The three-fold GLOSSES are numerous, mutually inconsistent, and mostly late — which is itself the evidence that they are explanations supplied for an object already there. Listed as conjecture without picking a winner.',
  },
  {
    deity: 'shiva', tradition: 'hindu', kind: 'instrument', name: 'damaru (hourglass drum)',
    attested: 400, tier: 'attested',
    source: 'Standard in the Nataraja iconography developed under the Cholas (10th–12th c. CE); earlier textual and sculptural association in the Puranic period',
    meaning: 'in the Nataraja program the drum is the sound from which creation proceeds, held opposite the fire of dissolution',
    meaningAttested: 1000, meaningTier: 'attested',
    note: 'The Nataraja meaning is genuinely attested by the iconographic program itself — the hands are a composed argument, not a collection. This is the clearest case in the file of an image that states its own meaning.',
  },
  {
    deity: 'shiva', tradition: 'hindu', kind: 'animal', name: 'Nandi (bull vahana)',
    attested: -100, tier: 'epigraphic',
    source: 'Bull-and-Shiva on Kushan coinage; the seated Nandi facing the shrine is standard in South Indian temple architecture',
    meaning: 'the mount, and the devotee — Nandi faces the god, and the worshipper looks between his horns',
    meaningAttested: null, meaningTier: 'cultic',
    note: 'The darshana-between-the-horns practice is a living cultic fact, observable, and I record it at that tier rather than as a textual claim.',
  },
  {
    deity: 'shiva', tradition: 'hindu', kind: 'plant', name: 'bilva / bel (Aegle marmelos)',
    attested: null, tier: 'cultic',
    source: 'Bilva-patra offering is standard in Shaiva puja and appears in Puranic prescription; I did not fix an earliest date',
    meaning: 'the trifoliate leaf offered to the trident-bearer — the leaf’s three lobes read against the three prongs',
    meaningAttested: null, meaningTier: 'cultic',
    note: 'UNDATED. The practice is unambiguous and current; the earliest attestation is not something I established here. Recorded as a gap.',
  },
  {
    deity: 'vishnu', tradition: 'hindu', kind: 'weapon', name: 'Sudarshana chakra and Panchajanya shankha',
    attested: 100, tier: 'epigraphic',
    source: 'The four-armed Vishnu with chakra, shankha, gada and padma is fixed by the Gupta period; earlier on Kushan-era images',
    meaning: 'the four attributes are a set — the discus and conch are not independent emblems but positions in a fixed scheme',
    meaningAttested: null, meaningTier: 'structural',
  },
  {
    deity: 'durga', tradition: 'hindu', kind: 'weapon', name: 'the assembled arsenal',
    attested: 550, tier: 'attested',
    source: 'Devi Mahatmya (Markandeya Purana ch. 81–93), c. 6th c. CE — each god surrenders his own weapon to her: Shiva’s trident, Vishnu’s discus, Indra’s vajra, Varuna’s conch',
    meaning: 'the meaning is the ASSEMBLY, not any one weapon — she is armed by the collective divesting of the male gods, and that is the text’s explicit point',
    meaningAttested: 550, meaningTier: 'attested',
    note: 'The rare case where a text hands you the iconography AND its interpretation in the same passage. Nothing needs to be supplied.',
  },
  {
    deity: 'saraswati', tradition: 'hindu', kind: 'instrument', name: 'veena',
    attested: 400, tier: 'attested',
    source: 'Puranic period; the veena-bearing Saraswati is standard in Gupta and post-Gupta sculpture',
    meaning: 'learning and music held by one goddess — the instrument and the book in the same four hands',
    meaningAttested: null, meaningTier: 'structural',
  },
  {
    deity: 'ganesha', tradition: 'hindu', kind: 'animal', name: 'mushika (mouse/rat vahana)',
    attested: 500, tier: 'attested',
    source: 'Puranic; standard in Ganesha iconography from the Gupta period onward',
    meaning: 'various and late — the mount that goes everywhere, or desire subdued',
    meaningAttested: null, meaningTier: 'conjecture',
    note: 'The mount is secure; the glosses are numerous and inconsistent. Same shape as the trishula case.',
  },
  {
    deity: 'indra', tradition: 'hindu', kind: 'weapon', name: 'vajra',
    attested: -1200, tier: 'attested',
    source: 'Rigveda — the vajra is Indra’s weapon against Vritra throughout Mandala I and IV',
    meaning: 'the thunderbolt that releases the waters; later, in Buddhist use, the indestructible/adamantine',
    meaningAttested: -1200, meaningTier: 'attested',
    note: 'The oldest securely dated attribute in this file, and a genuine Indo-European cognate case with the Greek keraunos and Norse Mjölnir — a thunder-weapon held by a sky-god who kills a serpent. Structural, and strong.',
  },

  // ── NORSE ─────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ DATING CAVEAT that applies to this whole block: the Prose Edda is Snorri Sturluson, c. 1220,
  // a CHRISTIAN antiquarian writing centuries after conversion. The Poetic Edda is earlier in
  // composition but survives in a 13th-century manuscript. Norse "attestation" is late by construction.
  {
    deity: 'thor', tradition: 'norse', kind: 'weapon', name: 'Mjölnir',
    attested: 1220, tier: 'attested',
    source: 'Snorri Sturluson, Prose Edda, Skáldskaparmál (the dwarves’ forging contest); Þrymskviða in the Poetic Edda. Hammer AMULETS are archaeologically attested from the 9th–10th c., earlier than the texts',
    meaning: 'the weapon that guarantees the boundary against the giants; the amulet asserts it personally',
    meaningAttested: 1220, meaningTier: 'attested',
    note: 'The OBJECT is older than the TEXT here, and the evidence runs the other way from usual — the archaeology (pendants) predates the literary source by three centuries.',
  },
  {
    deity: 'odin', tradition: 'norse', kind: 'animal', name: 'Huginn and Muninn (ravens)',
    attested: 1220, tier: 'attested',
    source: 'Grímnismál 20 (Poetic Edda); Snorri, Gylfaginning 38',
    meaning: 'named as Thought and Memory in the source itself, and Odin says he fears more for Muninn’s return',
    meaningAttested: 1220, meaningTier: 'attested',
  },
  {
    deity: 'heimdall', tradition: 'norse', kind: 'instrument', name: 'Gjallarhorn',
    attested: 1220, tier: 'attested',
    source: 'Völuspá 46; Snorri, Gylfaginning 27, 51',
    meaning: 'the horn blown to announce Ragnarök — an instrument whose entire function is one future sounding',
    meaningAttested: 1220, meaningTier: 'attested',
  },

  // ── MESOPOTAMIAN ──────────────────────────────────────────────────────────────────────────────
  {
    deity: 'marduk', tradition: 'mesopotamian', kind: 'weapon', name: 'the net (and the four winds)',
    attested: -1100, tier: 'attested',
    source: 'Enūma Eliš IV.41–50 — Marduk nets Tiamat and drives the winds into her',
    meaning: 'the net is the instrument of cosmogony: the world is made from what it catches',
    meaningAttested: -1100, meaningTier: 'attested',
    note: 'A weapon that is not a blade. Worth keeping in the set precisely because it breaks the pattern the other weapon entries establish.',
  },
  {
    deity: 'inanna', tradition: 'mesopotamian', kind: 'regalia', name: 'rod and ring',
    attested: -2100, tier: 'epigraphic',
    source: 'Ur III and Old Babylonian glyptic and relief — including the Ur-Nammu stele; held by several deities, not Inanna alone',
    meaning: 'commonly read as measuring instruments — a surveyor’s rod and coiled line — i.e. the legitimation of a ruler',
    meaningAttested: null, meaningTier: 'structural',
    note: 'The measuring-tools reading is the mainstream scholarly one and is structurally strong, but it is a modern interpretation of an ancient image, not an ancient statement. Tiered accordingly.',
  },
];

// ── lookups ────────────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

export const DEITIES = [...new Set(ATTRIBUTES.map((a) => a.deity))].sort();
export const TRADITIONS = [...new Set(ATTRIBUTES.map((a) => a.tradition))].sort();

export const forDeity = (d) => ATTRIBUTES.filter((a) => a.deity === norm(d));
export const byKind = (k) => ATTRIBUTES.filter((a) => a.kind === norm(k));
export const byTradition = (t) => ATTRIBUTES.filter((a) => a.tradition === norm(t));

/** Every attribute of a kind, grouped by deity — "which gods carry a plant?" */
export function kindAcrossTraditions(kind) {
  const out = new Map();
  for (const a of byKind(kind)) {
    if (!out.has(a.tradition)) out.set(a.tradition, []);
    out.get(a.tradition).push({ deity: a.deity, name: a.name });
  }
  return out;
}

/**
 * ⭐ THE POINT OF THE FILE. Attributes whose MEANING is materially younger than the object, or whose
 * meaning is undated or conjectural. These are the rows where a modern explanation is riding on an
 * ancient image — and where a correspondence chart would show you nothing wrong.
 * `gapYears` is null when the meaning has no date at all, which is its own kind of answer.
 */
export function retrofitted({ minGap = 200 } = {}) {
  const out = [];
  for (const a of ATTRIBUTES) {
    const weak = a.meaningTier === 'conjecture' || a.meaningTier === 'structural';
    const gap = (a.attested != null && a.meaningAttested != null) ? a.meaningAttested - a.attested : null;
    if (gap != null && gap >= minGap) out.push({ ...a, gapYears: gap, why: `the meaning is ${gap} years younger than the object` });
    else if (a.meaningAttested == null && weak) out.push({ ...a, gapYears: null, why: `the meaning is undated and ${a.meaningTier}` });
  }
  return out.sort((x, y) => (y.gapYears || 0) - (x.gapYears || 0));
}

/** Entries carrying an explicit ⚠️ — a known, nameable error in the popular reading. */
export const tracers = () => ATTRIBUTES.filter((a) => String(a.note || '').includes('⚠️'));

/** Rows we could not date at all. A visible gap list beats a confident wrong number. */
export const undated = () => ATTRIBUTES.filter((a) => a.attested == null);

/** Same attribute-kind held by gods across traditions — the raw material for a comparison claim. */
export function parallels(kind) {
  const seen = byKind(kind);
  return seen.length < 2 ? [] : seen.map((a) => ({ deity: a.deity, tradition: a.tradition, name: a.name, tier: a.tier }));
}

/** Shape check — every row must carry its two datings and a source. Returns problems, never throws. */
export function validate() {
  const problems = [];
  for (const a of ATTRIBUTES) {
    const id = `${a.deity}/${a.name}`;
    if (!KINDS.includes(a.kind)) problems.push(`${id}: unknown kind ${a.kind}`);
    if (!TIERS.includes(a.tier)) problems.push(`${id}: unknown tier ${a.tier}`);
    if (!TIERS.includes(a.meaningTier)) problems.push(`${id}: unknown meaningTier ${a.meaningTier}`);
    if (!a.source) problems.push(`${id}: no source`);
    if (!a.meaning) problems.push(`${id}: no meaning recorded`);
    if (a.attested != null && !Number.isFinite(a.attested)) problems.push(`${id}: attested is not a year`);
  }
  return { ok: problems.length === 0, problems };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'divine-attributes',
    counts: { attributes: ATTRIBUTES.length, deities: DEITIES.length, traditions: TRADITIONS.length,
      retrofitted: retrofitted().length, tracers: tracers().length, undated: undated().length },
    kinds: KINDS, tiers: TIERS,
    note: 'every attribute is dated twice — when the god is first shown holding it, and when somebody '
        + 'first says what holding it means. The gap between those two dates is the finding.',
  }, null, 2));
}

export default { ATTRIBUTES, KINDS, TIERS, DEITIES, TRADITIONS, forDeity, byKind, byTradition, retrofitted, tracers, undated, parallels, validate, handler };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const who = process.argv[2];
  if (who) {
    for (const a of forDeity(who)) console.log(`${a.kind.padEnd(11)} ${a.name}\n   object: ${a.attested ?? '?'} (${a.tier})   meaning: ${a.meaningAttested ?? 'undated'} (${a.meaningTier})\n   ${a.source}`);
  } else {
    const v = validate();
    console.log(`${ATTRIBUTES.length} attributes · ${DEITIES.length} deities · ${TRADITIONS.length} traditions · valid: ${v.ok}`);
    console.log(`\nRETROFITTED (meaning younger than the object, or undated+weak): ${retrofitted().length}`);
    for (const r of retrofitted()) console.log(`  ${r.deity}/${r.name} — ${r.why}`);
    console.log(`\nTRACERS (a nameable error in the popular reading): ${tracers().length}`);
    for (const t of tracers()) console.log(`  ${t.deity}/${t.name}`);
  }
}
