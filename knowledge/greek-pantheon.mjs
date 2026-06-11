// greek-pantheon.mjs — a compact, frozen, sourced dataset of major Greek deities and the
// relationships between them (backlog 852d7ecd77).
//
// Hand-curated public-domain mythological facts (Hesiod's Theogony, Homer, Apollodorus' Library,
// the Homeric Hymns — all standard, out-of-copyright sources). This is the "Theoi.com -> deity
// information / extract relationships between gods" itinerary item, satisfied WITHOUT any scraping:
// the facts are entered by hand from public-domain primary texts, so there is no network call, no
// remote reader, and no live dependency. (Mythology has variant genealogies; where they conflict
// we follow the dominant Hesiodic/Apollodoran tradition and note the deity's principal parents.)
//
// This module is DISTINCT from integrations/knowledge-graph.mjs, which is a remote
// Wikidata/ConceptNet reader. Here everything is local, static, and frozen.
//
// PURE / deterministic. No network, no LLM, no secrets, soft-fail everywhere (never throws). Does
// NOT touch knowledge-base.json. CLI guarded by process.argv[1]. Every render path HTML-escapes its
// interpolated fields.
//
//   import { DEITIES, deity, relationsOf, lineage, renderMarkdown } from './greek-pantheon.mjs'
//   node knowledge/greek-pantheon.mjs            # print the deterministic Markdown table + tree
//   node knowledge/greek-pantheon.mjs Zeus       # print one deity + resolved relations + lineage

// --- HTML escape (single local copy; identical behavior to the engine's esc) ----------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- static data: major Greek deities + relationships --------------------------------------
//
// Each entry: { name, domain, parents[], consorts[], children[], epithets[], source }.
// Names are the canonical English spellings; relationship fields reference other entries by the
// same canonical name so the graph can be resolved internally. Frozen (deep) so callers cannot
// mutate the shared corpus.
function freezeDeity(d) {
  return Object.freeze({
    name: d.name,
    domain: d.domain,
    parents: Object.freeze([...d.parents]),
    consorts: Object.freeze([...d.consorts]),
    children: Object.freeze([...d.children]),
    epithets: Object.freeze([...d.epithets]),
    source: d.source,
  });
}

export const DEITIES = Object.freeze(
  [
    {
      name: 'Chaos',
      domain: 'the primordial void; the first thing to come into being',
      parents: [],
      consorts: [],
      children: ['Gaia', 'Tartarus', 'Eros', 'Erebus', 'Nyx'],
      epithets: ['the Yawning Gap'],
      source: 'Hesiod, Theogony 116-122',
    },
    {
      name: 'Gaia',
      domain: 'the Earth; mother of all',
      parents: ['Chaos'],
      consorts: ['Uranus'],
      children: ['Cronus', 'Oceanus', 'Rhea', 'Coeus', 'Hyperion', 'Iapetus', 'Themis'],
      epithets: ['Mother Earth', 'Gaea'],
      source: 'Hesiod, Theogony 126-153',
    },
    {
      name: 'Uranus',
      domain: 'the sky; the first ruler of the cosmos',
      parents: ['Gaia'],
      consorts: ['Gaia'],
      children: ['Cronus', 'Rhea', 'Oceanus', 'Coeus', 'Hyperion', 'Iapetus', 'Themis'],
      epithets: ['Father Sky', 'Ouranos'],
      source: 'Hesiod, Theogony 126-138',
    },
    {
      name: 'Cronus',
      domain: 'the Titan king; time and the harvest',
      parents: ['Uranus', 'Gaia'],
      consorts: ['Rhea'],
      children: ['Zeus', 'Hera', 'Poseidon', 'Hades', 'Demeter', 'Hestia'],
      epithets: ['the youngest Titan', 'Kronos'],
      source: 'Hesiod, Theogony 137, 453-458',
    },
    {
      name: 'Rhea',
      domain: 'Titaness of motherhood and generation',
      parents: ['Uranus', 'Gaia'],
      consorts: ['Cronus'],
      children: ['Zeus', 'Hera', 'Poseidon', 'Hades', 'Demeter', 'Hestia'],
      epithets: ['Mother of the Gods'],
      source: 'Hesiod, Theogony 453-458',
    },
    {
      name: 'Zeus',
      domain: 'king of the gods; sky, thunder, justice',
      parents: ['Cronus', 'Rhea'],
      consorts: ['Hera', 'Leto', 'Demeter', 'Maia', 'Dione'],
      children: ['Athena', 'Apollo', 'Artemis', 'Ares', 'Hephaestus', 'Hermes', 'Dionysus', 'Persephone', 'Aphrodite'],
      epithets: ['Cloud-gatherer', 'Olympian', 'Aegis-bearer'],
      source: 'Hesiod, Theogony 457, 886-944; Homer, Iliad',
    },
    {
      name: 'Hera',
      domain: 'queen of the gods; marriage and women',
      parents: ['Cronus', 'Rhea'],
      consorts: ['Zeus'],
      children: ['Ares', 'Hephaestus', 'Hebe', 'Eileithyia'],
      epithets: ['Ox-eyed', 'Queen of Heaven'],
      source: 'Hesiod, Theogony 921-923',
    },
    {
      name: 'Poseidon',
      domain: 'the sea, earthquakes, and horses',
      parents: ['Cronus', 'Rhea'],
      consorts: ['Amphitrite'],
      children: ['Triton'],
      epithets: ['Earth-shaker', 'Lord of the Sea'],
      source: 'Hesiod, Theogony 456; Homer, Odyssey',
    },
    {
      name: 'Hades',
      domain: 'the underworld and the dead',
      parents: ['Cronus', 'Rhea'],
      consorts: ['Persephone'],
      children: [],
      epithets: ['the Unseen', 'Lord of the Dead', 'Pluto'],
      source: 'Hesiod, Theogony 455; Homeric Hymn to Demeter',
    },
    {
      name: 'Demeter',
      domain: 'the harvest, grain, and agriculture',
      parents: ['Cronus', 'Rhea'],
      consorts: ['Zeus'],
      children: ['Persephone'],
      epithets: ['the Grain-giver', 'Lawbringer'],
      source: 'Hesiod, Theogony 454, 912-914',
    },
    {
      name: 'Hestia',
      domain: 'the hearth, home, and sacrificial fire',
      parents: ['Cronus', 'Rhea'],
      consorts: [],
      children: [],
      epithets: ['the Hearth-keeper', 'eldest of Cronus’ children'],
      source: 'Hesiod, Theogony 454',
    },
    {
      name: 'Athena',
      domain: 'wisdom, craft, and just warfare',
      parents: ['Zeus'],
      consorts: [],
      children: [],
      epithets: ['Grey-eyed', 'Pallas', 'Tritogeneia'],
      source: 'Hesiod, Theogony 924-926 (born from Zeus’ head)',
    },
    {
      name: 'Apollo',
      domain: 'the sun, prophecy, music, and healing',
      parents: ['Zeus', 'Leto'],
      consorts: [],
      children: ['Asclepius'],
      epithets: ['Phoebus', 'the Far-shooter', 'Loxias'],
      source: 'Hesiod, Theogony 918-920; Homeric Hymn to Apollo',
    },
    {
      name: 'Artemis',
      domain: 'the hunt, the moon, wild things, and childbirth',
      parents: ['Zeus', 'Leto'],
      consorts: [],
      children: [],
      epithets: ['the Huntress', 'Lady of Wild Things'],
      source: 'Hesiod, Theogony 918-920',
    },
    {
      name: 'Ares',
      domain: 'war, bloodlust, and courage',
      parents: ['Zeus', 'Hera'],
      consorts: ['Aphrodite'],
      children: ['Phobos', 'Deimos', 'Harmonia'],
      epithets: ['the War-god', 'Bane of mortals'],
      source: 'Hesiod, Theogony 921-922',
    },
    {
      name: 'Hephaestus',
      domain: 'fire, the forge, and metalworking',
      parents: ['Hera'],
      consorts: ['Aphrodite'],
      children: [],
      epithets: ['the Smith-god', 'the Lame One'],
      source: 'Hesiod, Theogony 927-929 (born of Hera alone)',
    },
    {
      name: 'Hermes',
      domain: 'travel, trade, thieves, and the messenger of the gods',
      parents: ['Zeus', 'Maia'],
      consorts: [],
      children: ['Pan'],
      epithets: ['the Messenger', 'Argeiphontes', 'the Wayfinder'],
      source: 'Hesiod, Theogony 938-939; Homeric Hymn to Hermes',
    },
    {
      name: 'Dionysus',
      domain: 'wine, ecstasy, theatre, and ritual madness',
      parents: ['Zeus', 'Semele'],
      consorts: ['Ariadne'],
      children: [],
      epithets: ['Bacchus', 'the Twice-born', 'the Liberator'],
      source: 'Hesiod, Theogony 940-942',
    },
    {
      name: 'Aphrodite',
      domain: 'love, beauty, and desire',
      parents: ['Uranus'],
      consorts: ['Ares', 'Hephaestus'],
      children: ['Eros', 'Harmonia'],
      epithets: ['Foam-born', 'Cytherea', 'the Golden'],
      source: 'Hesiod, Theogony 188-206 (born of Uranus’ sea-foam)',
    },
    {
      name: 'Persephone',
      domain: 'the underworld queen; spring growth',
      parents: ['Zeus', 'Demeter'],
      consorts: ['Hades'],
      children: [],
      epithets: ['Kore', 'the Maiden', 'Dread Persephone'],
      source: 'Hesiod, Theogony 912-914; Homeric Hymn to Demeter',
    },
    {
      name: 'Leto',
      domain: 'Titaness of motherhood and modesty',
      parents: ['Coeus'],
      consorts: ['Zeus'],
      children: ['Apollo', 'Artemis'],
      epithets: ['the Gentle', 'Mother of the Twins'],
      source: 'Hesiod, Theogony 404-408, 918-920',
    },
  ].map(freezeDeity),
);

// --- internal index: lowercase name -> frozen deity entry -----------------------------------
const BY_NAME = Object.freeze(
  DEITIES.reduce((acc, d) => {
    acc[d.name.toLowerCase()] = d;
    return acc;
  }, Object.create(null)),
);

// --- deity(name) -> entry | null (case-insensitive, soft-fail) ------------------------------
export function deity(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  return BY_NAME[key] ?? null;
}

// --- relationsOf(name) -> { parents, children, consorts } resolved to known deities ---------
//
// Each named relation is resolved against the corpus; only relations that correspond to a known
// deity entry are returned (resolved to that frozen entry). Unknown names are dropped silently
// (soft-fail), so e.g. mortal mothers like Semele that lack their own entry simply don't appear.
// An unknown subject returns empty arrays rather than throwing.
export function relationsOf(name) {
  const d = deity(name);
  if (!d) {
    return Object.freeze({ parents: [], children: [], consorts: [] });
  }
  const resolve = (names) =>
    Object.freeze(
      names
        .map((n) => deity(n))
        .filter((x) => x != null),
    );
  return Object.freeze({
    parents: resolve(d.parents),
    children: resolve(d.children),
    consorts: resolve(d.consorts),
  });
}

// --- lineage(name) -> ancestor chain (names, root-ward) -------------------------------------
//
// Walks the parent links upward, following the FIRST known parent at each step (the dominant line),
// collecting ancestor names until it reaches a parentless primordial or a name with no known entry.
// Cycle-guarded (mythology has self-referential genealogies, e.g. Uranus born of Gaia who is his
// consort) so it always terminates. Returns [] for an unknown subject. The subject itself is not
// included; the chain is ordered from the immediate parent outward to the primordial root.
export function lineage(name) {
  const start = deity(name);
  if (!start) return [];
  const chain = [];
  const seen = new Set([start.name.toLowerCase()]);
  let current = start;
  while (current && current.parents.length) {
    // follow the first parent that resolves to a known, not-yet-seen entry
    let next = null;
    for (const pName of current.parents) {
      const p = deity(pName);
      if (p && !seen.has(p.name.toLowerCase())) {
        next = p;
        break;
      }
    }
    if (!next) break;
    chain.push(next.name);
    seen.add(next.name.toLowerCase());
    current = next;
  }
  return chain;
}

// --- renderMarkdown() -> deterministic table + lineage tree ---------------------------------
//
// Stable output: deities are emitted in corpus order (which is fixed and frozen), so the render is
// byte-stable across runs. Every interpolated field is esc()'d.
export function renderMarkdown() {
  const lines = [];
  lines.push('# Greek Pantheon');
  lines.push('');
  lines.push(
    '*Hand-curated from public-domain sources (Hesiod, Homer, Apollodorus). ' +
      'Where genealogies vary, the dominant Hesiodic tradition is followed.*',
  );
  lines.push('');
  lines.push('## Deities');
  lines.push('');
  lines.push('| Deity | Domain | Parents | Source |');
  lines.push('| --- | --- | --- | --- |');
  for (const d of DEITIES) {
    const parents = d.parents.length ? d.parents.map(esc).join(', ') : '—';
    lines.push(`| ${esc(d.name)} | ${esc(d.domain)} | ${parents} | ${esc(d.source)} |`);
  }
  lines.push('');
  lines.push('## Lineage');
  lines.push('');
  for (const d of DEITIES) {
    const chain = lineage(d.name);
    const path = chain.length ? chain.map(esc).join(' ← ') : '(primordial)';
    lines.push(`- **${esc(d.name)}** ← ${path}`);
  }
  // Trim trailing blank lines for a stable, newline-terminated document.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

// --- CLI (guarded; pure stdout) -------------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg) {
    const d = deity(arg);
    if (!d) {
      const known = DEITIES.map((x) => x.name).join(', ');
      console.log(`unknown deity: ${arg}\nknown deities: ${known}`);
    } else {
      const rel = relationsOf(d.name);
      const fmt = (xs) => (xs.length ? xs.map((x) => x.name).join(', ') : '(none known)');
      console.log(`${d.name} — ${d.domain}`);
      console.log(`epithets: ${d.epithets.join(', ') || '(none)'}`);
      console.log(`parents:  ${fmt(rel.parents)}`);
      console.log(`consorts: ${fmt(rel.consorts)}`);
      console.log(`children: ${fmt(rel.children)}`);
      const chain = lineage(d.name);
      console.log(`lineage:  ${chain.length ? chain.join(' <- ') : '(primordial)'}`);
      console.log(`source:   ${d.source}`);
    }
  } else {
    console.log(renderMarkdown());
  }
}
