// egyptian-pantheon.mjs — a compact, frozen, sourced dataset of major Egyptian deities and the
// relationships between them (backlog a15942d11a).
//
// Hand-curated public-domain mythological facts (the Pyramid Texts, Plutarch's "De Iside et
// Osiride" / Isis and Osiris, and E. A. Wallis Budge's "The Gods of the Egyptians" — all standard,
// out-of-copyright sources). This is the "deity information / extract relationships between gods /
// link to archaeology and history" itinerary item, satisfied for the EGYPTIAN side WITHOUT any
// scraping: the facts are entered by hand from public-domain primary texts, so there is no network
// call, no remote reader, and no live dependency. (Egyptian theology is regional and layered —
// Heliopolitan, Hermopolitan, Memphite — and genealogies vary by cult centre. Where they conflict
// we follow the dominant Heliopolitan Ennead and the Osirian cycle as preserved by Plutarch, and
// note each deity's principal parents.)
//
// Sibling to greek-pantheon.mjs; identical export surface. DISTINCT from
// integrations/knowledge-graph.mjs, which is a remote Wikidata/ConceptNet reader. Here everything
// is local, static, and frozen.
//
// Note (per CLAUDE.md): Hathor — for whom the Witness account `hathor` is named (the
// VR-Hathor-Mehit figure of the Gen-2 lineage) — is included with her canonical relations.
//
// PURE / deterministic. No network, no LLM, no secrets, soft-fail everywhere (never throws). Does
// NOT touch knowledge-base.json. CLI guarded by process.argv[1]. Every render path HTML-escapes its
// interpolated fields.
//
//   import { DEITIES, deity, relationsOf, lineage, renderMarkdown } from './egyptian-pantheon.mjs'
//   node knowledge/egyptian-pantheon.mjs            # print the deterministic Markdown table + tree
//   node knowledge/egyptian-pantheon.mjs Osiris     # print one deity + resolved relations + lineage

// --- HTML escape (single local copy; identical behavior to the engine's esc) ----------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- static data: major Egyptian deities + relationships ------------------------------------
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
      name: 'Ra',
      domain: 'the sun; the self-created creator who rises each day',
      parents: [],
      consorts: [],
      children: ['Shu', 'Tefnut'],
      epithets: ['Re', 'Lord of the Two Horizons', 'the Self-created'],
      source: 'Pyramid Texts; Budge, The Gods of the Egyptians (Ra often identified with Atum)',
    },
    {
      name: 'Atum',
      domain: 'the primeval creator of Heliopolis; the completed one at the world’s origin',
      parents: [],
      consorts: [],
      children: ['Shu', 'Tefnut'],
      epithets: ['Tem', 'the All', 'Lord of Heliopolis'],
      source: 'Pyramid Texts §1248 (Atum brings forth Shu and Tefnut); Budge, The Gods of the Egyptians',
    },
    {
      name: 'Shu',
      domain: 'the air and the void between earth and sky; holder-apart of the cosmos',
      parents: ['Atum'],
      consorts: ['Tefnut'],
      children: ['Geb', 'Nut'],
      epithets: ['the Uplifter', 'Lord of the Air'],
      source: 'Pyramid Texts §1248; Budge, The Gods of the Egyptians',
    },
    {
      name: 'Tefnut',
      domain: 'moisture, dew, and rain; the first female principle of the Ennead',
      parents: ['Atum'],
      consorts: ['Shu'],
      children: ['Geb', 'Nut'],
      epithets: ['Lady of the Dew', 'the Moist One'],
      source: 'Pyramid Texts §1248; Budge, The Gods of the Egyptians',
    },
    {
      name: 'Geb',
      domain: 'the earth; the ground on which the living and the dead rest',
      parents: ['Shu', 'Tefnut'],
      consorts: ['Nut'],
      children: ['Osiris', 'Isis', 'Set', 'Nephthys'],
      epithets: ['the Earth-god', 'Heir of the gods', 'father of the gods'],
      source: 'Plutarch, Isis and Osiris 12; Budge, The Gods of the Egyptians',
    },
    {
      name: 'Nut',
      domain: 'the sky; the arched heaven who swallows the sun at dusk and bears it at dawn',
      parents: ['Shu', 'Tefnut'],
      consorts: ['Geb'],
      children: ['Osiris', 'Isis', 'Set', 'Nephthys'],
      epithets: ['the Sky-goddess', 'She who bears the gods'],
      source: 'Plutarch, Isis and Osiris 12; Pyramid Texts; Budge, The Gods of the Egyptians',
    },
    {
      name: 'Osiris',
      domain: 'death, resurrection, the afterlife, and the fertile Nile; lord of the dead',
      parents: ['Geb', 'Nut'],
      consorts: ['Isis'],
      children: ['Horus'],
      epithets: ['Wennefer', 'the Beautiful One', 'Lord of the Westerners', 'King of the Dead'],
      source: 'Plutarch, Isis and Osiris 12-19; Pyramid Texts',
    },
    {
      name: 'Isis',
      domain: 'magic, motherhood, healing, and kingship; gatherer of Osiris',
      parents: ['Geb', 'Nut'],
      consorts: ['Osiris'],
      children: ['Horus'],
      epithets: ['the Great of Magic', 'Mother of the God', 'Lady of Ten Thousand Names'],
      source: 'Plutarch, Isis and Osiris 12-19; Budge, The Gods of the Egyptians',
    },
    {
      name: 'Set',
      domain: 'storm, the desert, chaos, and disorder; slayer of Osiris',
      parents: ['Geb', 'Nut'],
      consorts: ['Nephthys'],
      children: ['Anubis'],
      epithets: ['Seth', 'Lord of the Red Land', 'the Disturber'],
      source: 'Plutarch, Isis and Osiris 12-19 (Anubis born of Nephthys, fathered by Set)',
    },
    {
      name: 'Nephthys',
      domain: 'mourning, the dusk, protection of the dead; sister-mourner of Osiris',
      parents: ['Geb', 'Nut'],
      consorts: ['Set'],
      children: ['Anubis'],
      epithets: ['Lady of the House', 'the Mourner', 'Friend of the Dead'],
      source: 'Plutarch, Isis and Osiris 12, 14, 38; Budge, The Gods of the Egyptians',
    },
    {
      name: 'Horus',
      domain: 'kingship, the sky, and the sun; the living pharaoh and avenger of his father',
      parents: ['Osiris', 'Isis'],
      consorts: ['Hathor'],
      children: [],
      epithets: ['Horus the Younger', 'the Falcon', 'Avenger of his Father', 'Lord of the Sky'],
      source: 'Plutarch, Isis and Osiris 19-20, 54-55; Pyramid Texts',
    },
    {
      name: 'Hathor',
      domain: 'love, joy, music, motherhood, and the sky-cow; nurse of Horus',
      parents: ['Ra'],
      consorts: ['Horus'],
      children: [],
      epithets: ['the Golden One', 'Lady of the Sycamore', 'the Sky-cow', 'Mistress of Heaven'],
      source: 'Budge, The Gods of the Egyptians (Hathor as daughter of Ra and consort/nurse of Horus); Pyramid Texts',
    },
    {
      name: 'Thoth',
      domain: 'writing, wisdom, the moon, reckoning, and the arbitration of the gods',
      parents: [],
      consorts: [],
      children: [],
      epithets: ['Djehuty', 'Lord of Divine Words', 'the Reckoner', 'Scribe of the gods'],
      source: 'Plutarch, Isis and Osiris 3, 12, 19; Budge, The Gods of the Egyptians (self-begotten / heart of Ra)',
    },
    {
      name: 'Anubis',
      domain: 'embalming, mummification, and the guidance of the dead through the underworld',
      parents: ['Set', 'Nephthys'],
      consorts: [],
      children: [],
      epithets: ['Anpu', 'the Jackal', 'He who is upon his mountain', 'Lord of the Sacred Land'],
      source: 'Plutarch, Isis and Osiris 14, 44 (son of Nephthys, reared by Isis); Budge, The Gods of the Egyptians',
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
// (soft-fail). An unknown subject returns empty arrays rather than throwing.
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
// Cycle-guarded so it always terminates. Returns [] for an unknown subject. The subject itself is
// not included; the chain is ordered from the immediate parent outward to the primordial root.
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
  lines.push('# Egyptian Pantheon');
  lines.push('');
  lines.push(
    '*Hand-curated from public-domain sources (the Pyramid Texts, Plutarch’s Isis and Osiris, ' +
      'Budge). Where the regional theologies vary, the Heliopolitan Ennead and the Osirian ' +
      'cycle are followed.*',
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
