// roman-pantheon.mjs — a compact, frozen, sourced dataset of major Roman deities, plus a
// Greek↔Roman cross-reference (the interpretatio romana) — backlog 227400cd99.
//
// Hand-curated public-domain classical-reference facts (Ovid's Metamorphoses & Fasti, Virgil's
// Aeneid, Varro / Cicero "De Natura Deorum", and the standard interpretatio romana by which the
// Romans identified their gods with the Greek Olympians). This is the ROMAN side of the mythology
// corpus and a sibling to greek-pantheon.mjs / egyptian-pantheon.mjs — but a PURE STATIC DATA
// module: there is no network call, no remote reader, no LLM, and no live dependency. The facts
// are entered by hand from public-domain sources. Data only; no claims beyond standard classical
// reference.
//
// DISTINCT from integrations/knowledge-graph.mjs, which is a remote Wikidata/ConceptNet reader.
// Here everything is local, static, and frozen.
//
// PURE / deterministic. No network, no LLM, no secrets, soft-fail everywhere (never throws). Does
// NOT touch knowledge-base.json. CLI guarded by process.argv[1]. Every render path HTML-escapes its
// interpolated fields.
//
//   import { PANTHEON, byName, byDomain, greekToRoman, romanToGreek, search } from './roman-pantheon.mjs'
//   node knowledge/roman-pantheon.mjs            # print the deterministic Greek↔Roman cross-reference table
//   node knowledge/roman-pantheon.mjs Jupiter    # print one deity entry

// --- HTML escape (single local copy; identical behavior to the engine's esc) ----------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- normalize: lowercase + strip diacritics (case/accent-insensitive lookup) ---------------
// e.g. "Júpiter" / "JUPITER" / " jupiter " all fold to "jupiter". Uses Unicode NFD decomposition
// and drops the combining marks; soft on non-strings.
function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// --- static data: major Roman deities -------------------------------------------------------
//
// Each entry: { name, domain, greekEquivalent, symbols[], epithets[], summary }.
// `greekEquivalent` is the canonical Greek name under the interpretatio romana (null where the
// deity is genuinely Roman with no clean Greek counterpart). Frozen (deep) so callers cannot
// mutate the shared corpus.
function freezeDeity(d) {
  return Object.freeze({
    name: d.name,
    domain: d.domain,
    greekEquivalent: d.greekEquivalent ?? null,
    symbols: Object.freeze([...(d.symbols ?? [])]),
    epithets: Object.freeze([...(d.epithets ?? [])]),
    summary: d.summary,
  });
}

export const PANTHEON = Object.freeze(
  [
    {
      name: 'Jupiter',
      domain: 'king of the gods; sky, thunder, law, and the Roman state',
      greekEquivalent: 'Zeus',
      symbols: ['thunderbolt', 'eagle', 'oak'],
      epithets: ['Optimus Maximus', 'Iuppiter', 'Tonans', 'Capitolinus'],
      summary:
        'Supreme deity of the Roman pantheon and the Capitoline Triad, god of the sky and thunder ' +
        'and guarantor of oaths and the state. Identified with the Greek Zeus.',
    },
    {
      name: 'Juno',
      domain: 'queen of the gods; marriage, women, and the state',
      greekEquivalent: 'Hera',
      symbols: ['peacock', 'diadem', 'pomegranate'],
      epithets: ['Regina', 'Moneta', 'Lucina'],
      summary:
        'Queen of the gods, wife and sister of Jupiter, protectress of marriage and of the women ' +
        'of Rome; member of the Capitoline Triad. Identified with the Greek Hera.',
    },
    {
      name: 'Neptune',
      domain: 'the sea, fresh water, earthquakes, and horses',
      greekEquivalent: 'Poseidon',
      symbols: ['trident', 'horse', 'dolphin'],
      epithets: ['Neptunus', 'Equester'],
      summary:
        'God of the sea and of waters generally, brother of Jupiter and Pluto. Honoured at the ' +
        'Neptunalia. Identified with the Greek Poseidon.',
    },
    {
      name: 'Pluto',
      domain: 'the underworld, the dead, and mineral wealth',
      greekEquivalent: 'Hades',
      symbols: ['bident', 'cypress', 'key', 'Cerberus'],
      epithets: ['Dis Pater', 'Orcus'],
      summary:
        'Ruler of the underworld and the dead, brother of Jupiter and Neptune; also a giver of ' +
        'the wealth beneath the earth. Identified with the Greek Hades.',
    },
    {
      name: 'Ceres',
      domain: 'agriculture, grain, fertility, and the harvest',
      greekEquivalent: 'Demeter',
      symbols: ['wheat sheaf', 'cornucopia', 'torch', 'sickle'],
      epithets: ['Mater', 'Legifera'],
      summary:
        'Goddess of grain and the harvest and of motherly love, mother of Proserpina; central to ' +
        'the Cerealia and the plebeian cult. Identified with the Greek Demeter.',
    },
    {
      name: 'Vesta',
      domain: 'the hearth, home, and the sacred fire of the state',
      greekEquivalent: 'Hestia',
      symbols: ['hearth-fire', 'eternal flame'],
      epithets: ['Mater'],
      summary:
        'Goddess of the hearth and the household, tended by the Vestal Virgins who kept her ' +
        'eternal flame in the Forum. Identified with the Greek Hestia.',
    },
    {
      name: 'Minerva',
      domain: 'wisdom, crafts, strategy, and just warfare',
      greekEquivalent: 'Athena',
      symbols: ['owl', 'olive tree', 'aegis', 'spear', 'helmet'],
      epithets: ['Medica', 'Capta'],
      summary:
        'Goddess of wisdom, handicraft, and strategic war, member of the Capitoline Triad and ' +
        'patroness of artisans. Identified with the Greek Athena.',
    },
    {
      name: 'Apollo',
      domain: 'the sun, prophecy, music, poetry, and healing',
      greekEquivalent: 'Apollo',
      symbols: ['lyre', 'laurel', 'bow', 'raven'],
      epithets: ['Phoebus', 'Medicus', 'Palatinus'],
      summary:
        'God of light, prophecy, music, and healing; one of the few deities the Romans adopted ' +
        'under the same name as the Greek Apollo, with no renaming.',
    },
    {
      name: 'Diana',
      domain: 'the hunt, the moon, wild places, and childbirth',
      greekEquivalent: 'Artemis',
      symbols: ['bow', 'crescent moon', 'stag', 'hunting dog'],
      epithets: ['Nemorensis', 'Trivia', 'Lucina'],
      summary:
        'Goddess of the hunt, the moon, and the wild, protectress of women in childbirth, ' +
        'worshipped at Lake Nemi. Identified with the Greek Artemis.',
    },
    {
      name: 'Mars',
      domain: 'war, military power, and (anciently) agriculture and the spring',
      greekEquivalent: 'Ares',
      symbols: ['spear', 'shield', 'wolf', 'woodpecker'],
      epithets: ['Gradivus', 'Ultor', 'Pater'],
      summary:
        'God of war and a guardian of agriculture, father of Romulus and Remus and so a father ' +
        'of the Roman people; far more honoured than his Greek counterpart Ares.',
    },
    {
      name: 'Venus',
      domain: 'love, beauty, desire, fertility, and prosperity',
      greekEquivalent: 'Aphrodite',
      symbols: ['dove', 'myrtle', 'rose', 'scallop shell'],
      epithets: ['Genetrix', 'Victrix', 'Cloacina'],
      summary:
        'Goddess of love and beauty and, as Venus Genetrix, divine ancestor of the Julian line ' +
        'through Aeneas. Identified with the Greek Aphrodite.',
    },
    {
      name: 'Vulcan',
      domain: 'fire, the forge, metalworking, and volcanoes',
      greekEquivalent: 'Hephaestus',
      symbols: ['hammer', 'anvil', 'tongs', 'fire'],
      epithets: ['Mulciber', 'Vulcanus'],
      summary:
        'God of fire and the forge, maker of the gods’ weapons, honoured at the Vulcanalia ' +
        'against the danger of fire. Identified with the Greek Hephaestus.',
    },
    {
      name: 'Mercury',
      domain: 'commerce, travel, messages, eloquence, and boundaries',
      greekEquivalent: 'Hermes',
      symbols: ['caduceus', 'winged sandals', 'winged cap', 'purse'],
      epithets: ['Mercurius'],
      summary:
        'God of trade, travellers, and communication and the messenger of the gods, patron of ' +
        'merchants and a guide of souls. Identified with the Greek Hermes.',
    },
    {
      name: 'Bacchus',
      domain: 'wine, vegetation, ecstasy, and ritual liberation',
      greekEquivalent: 'Dionysus',
      symbols: ['grapevine', 'thyrsus', 'ivy', 'wine cup'],
      epithets: ['Liber', 'Liber Pater'],
      summary:
        'God of wine, fertility, and ecstatic release, worshipped in the Bacchanalia and ' +
        'identified with the Italic Liber Pater. Identified with the Greek Dionysus.',
    },
    {
      name: 'Saturn',
      domain: 'time, generation, wealth, and the mythic Golden Age',
      greekEquivalent: 'Cronus',
      symbols: ['sickle', 'scythe', 'grain'],
      epithets: ['Saturnus', 'Frugifer'],
      summary:
        'Ancient god of seed-sowing and time and king of the lost Golden Age of Italy, honoured ' +
        'at the Saturnalia. Identified with the Greek Titan Cronus.',
    },
    {
      name: 'Janus',
      domain: 'beginnings, endings, doorways, transitions, and time',
      greekEquivalent: null,
      symbols: ['two faces', 'doorway', 'key', 'staff'],
      epithets: ['Geminus', 'Patulcius', 'Clusivius'],
      summary:
        'Two-faced god of doorways, beginnings, and transitions, looking to past and future at ' +
        'once; a genuinely Roman deity with no Greek equivalent. The month January bears his name.',
    },
  ].map(freezeDeity),
);

// --- internal indices (built once, frozen) --------------------------------------------------
// BY_NAME: normalized Roman name -> entry.  Greek↔Roman maps are derived from greekEquivalent,
// the frozen interpretatio-romana table. Where a Greek name maps to more than one Roman name the
// FIRST in corpus order wins (deterministic; none currently collide).
const BY_NAME = Object.freeze(
  PANTHEON.reduce((acc, d) => {
    acc[normalize(d.name)] = d;
    return acc;
  }, Object.create(null)),
);

const GREEK_TO_ROMAN = Object.freeze(
  PANTHEON.reduce((acc, d) => {
    if (d.greekEquivalent) {
      const k = normalize(d.greekEquivalent);
      if (!(k in acc)) acc[k] = d.name;
    }
    return acc;
  }, Object.create(null)),
);

const ROMAN_TO_GREEK = Object.freeze(
  PANTHEON.reduce((acc, d) => {
    if (d.greekEquivalent) acc[normalize(d.name)] = d.greekEquivalent;
    return acc;
  }, Object.create(null)),
);

// --- byName(name) -> entry | null (case/accent-insensitive, soft-fail) ----------------------
export function byName(name) {
  const key = normalize(name);
  if (!key) return null;
  return BY_NAME[key] ?? null;
}

// --- byDomain(domain) -> entries whose domain contains the term (case-insensitive) ----------
// Substring match against the domain string. Empty/whitespace term -> []. Never throws.
export function byDomain(domain) {
  const term = normalize(domain);
  if (!term) return Object.freeze([]);
  return Object.freeze(PANTHEON.filter((d) => normalize(d.domain).includes(term)));
}

// --- greekToRoman(greekName) -> Roman name | null --------------------------------------------
export function greekToRoman(greekName) {
  const key = normalize(greekName);
  if (!key) return null;
  return GREEK_TO_ROMAN[key] ?? null;
}

// --- romanToGreek(romanName) -> Greek name | null --------------------------------------------
export function romanToGreek(romanName) {
  const key = normalize(romanName);
  if (!key) return null;
  return ROMAN_TO_GREEK[key] ?? null;
}

// --- search(term) -> entries matching name / domain / epithet (case/accent-insensitive) -----
// Substring match across name, domain, and each epithet. Empty term -> []. Never throws.
export function search(term) {
  const t = normalize(term);
  if (!t) return Object.freeze([]);
  return Object.freeze(
    PANTHEON.filter(
      (d) =>
        normalize(d.name).includes(t) ||
        normalize(d.domain).includes(t) ||
        d.epithets.some((e) => normalize(e).includes(t)),
    ),
  );
}

// --- renderMarkdown() -> deterministic Greek↔Roman cross-reference table --------------------
//
// Stable output: deities are emitted in corpus order (fixed and frozen), so the render is
// byte-stable across runs. Every interpolated field is esc()'d.
export function renderMarkdown() {
  const lines = [];
  lines.push('# Roman Pantheon — Greek↔Roman Cross-reference');
  lines.push('');
  lines.push(
    '*Hand-curated from public-domain sources (Ovid, Virgil, Varro, Cicero) and the standard ' +
      'interpretatio romana by which Roman gods were identified with the Greek Olympians.*',
  );
  lines.push('');
  lines.push('| Roman | Greek | Domain | Symbols |');
  lines.push('| --- | --- | --- | --- |');
  for (const d of PANTHEON) {
    const greek = d.greekEquivalent ? esc(d.greekEquivalent) : '— (no Greek equivalent)';
    const symbols = d.symbols.length ? d.symbols.map(esc).join(', ') : '—';
    lines.push(`| ${esc(d.name)} | ${greek} | ${esc(d.domain)} | ${symbols} |`);
  }
  // Trim trailing blank lines for a stable, newline-terminated document.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

// --- CLI (guarded; pure stdout) -------------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg) {
    const d = byName(arg) ?? (greekToRoman(arg) ? byName(greekToRoman(arg)) : null);
    if (!d) {
      const known = PANTHEON.map((x) => x.name).join(', ');
      console.log(`unknown deity: ${arg}\nknown deities: ${known}`);
    } else {
      console.log(`${d.name} — ${d.domain}`);
      console.log(`greek equivalent: ${d.greekEquivalent ?? '(none)'}`);
      console.log(`symbols:  ${d.symbols.join(', ') || '(none)'}`);
      console.log(`epithets: ${d.epithets.join(', ') || '(none)'}`);
      console.log(`summary:  ${d.summary}`);
    }
  } else {
    console.log(renderMarkdown());
  }
}
