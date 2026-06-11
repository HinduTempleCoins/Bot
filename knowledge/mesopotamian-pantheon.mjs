// mesopotamian-pantheon.mjs — a compact, frozen, sourced dataset of the major Mesopotamian
// (Sumerian-Akkadian) deities (backlog 85d7ce60cc).
//
// Hand-curated public-domain reference facts drawn from standard, out-of-copyright scholarship and
// primary corpora (the Sumerian King List, the Enuma Elish, the Descent of Inanna/Ishtar, temple
// hymns, and the surviving god-lists). This is the "Mesopotamian / Sumerian-Akkadian pantheon
// reference" itinerary item, satisfied WITHOUT any scraping: the facts are entered by hand, so there
// is no network call, no remote reader, and no live dependency. Where Sumerian and Akkadian
// traditions name the same divine figure (e.g. Inanna / Ishtar) both names are recorded so either
// can be looked up.
//
// This module is a sibling in shape to knowledge/greek-pantheon.mjs: PURE static reference data,
// frozen, deterministic. No network, no LLM, no secrets, soft-fail everywhere (never throws). It
// does NOT touch knowledge-base.json. CLI guarded by process.argv[1]. Every render path
// HTML-escapes its interpolated fields. Feeds the ancient-mystery / pagan-texts corpus.
//
//   import { PANTHEON, byName, byDomain, byCity, search } from './mesopotamian-pantheon.mjs'
//   node knowledge/mesopotamian-pantheon.mjs            # print the deterministic table
//   node knowledge/mesopotamian-pantheon.mjs Ishtar     # print one deity entry

// --- HTML escape (single local copy; identical behavior to the engine's esc) ----------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- normalization: lowercase + strip diacritics, for accent/case-insensitive matching -------
// Long-marked transliterations (Anu/Ānu, Sin/Sîn, Shamash/Šamaš, Ea/Éa) are common in Assyriology;
// normalizing them lets a caller search by the plain ASCII form and still hit the marked spelling.
function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .trim();
}

// --- static data: major Mesopotamian deities ------------------------------------------------
//
// Each entry: { name, sumerianName, akkadianName, domain, cityCult, symbols[], summary }.
// `name` is the conventional combined/English label; sumerianName/akkadianName carry the two
// tradition-specific names (either may equal name, or be null where only one tradition uses it).
// Frozen (deep) so callers cannot mutate the shared corpus.
function freezeDeity(d) {
  return Object.freeze({
    name: d.name,
    sumerianName: d.sumerianName ?? null,
    akkadianName: d.akkadianName ?? null,
    domain: d.domain,
    cityCult: d.cityCult,
    symbols: Object.freeze([...(d.symbols ?? [])]),
    summary: d.summary,
  });
}

export const PANTHEON = Object.freeze(
  [
    {
      name: 'An / Anu',
      sumerianName: 'An',
      akkadianName: 'Anu',
      domain: 'the sky; supreme father of the gods',
      cityCult: 'Uruk',
      symbols: ['horned cap', 'the heavens'],
      summary:
        'The primeval sky-god and nominal head of the pantheon, source of kingship and divine ' +
        'authority. Largely remote in myth, he delegates active rule to Enlil and later Marduk.',
    },
    {
      name: 'Enlil',
      sumerianName: 'Enlil',
      akkadianName: 'Ellil',
      domain: 'wind, storm, air; executive king of the gods',
      cityCult: 'Nippur',
      symbols: ['horned cap', 'the Ekur temple'],
      summary:
        'Lord of the air and the working sovereign of the cosmos, who decrees destinies and grants ' +
        'kingship to mortal rulers. His chief temple, the Ekur at Nippur, was the religious center ' +
        'of Sumer.',
    },
    {
      name: 'Enki / Ea',
      sumerianName: 'Enki',
      akkadianName: 'Ea',
      domain: 'fresh water, wisdom, crafts, magic, and creation',
      cityCult: 'Eridu',
      symbols: ['flowing streams with fish', 'the goat-fish (Capricornus)', 'the turtle'],
      summary:
        'God of the subterranean fresh waters (the Abzu) and of cunning wisdom and magic. Patron of ' +
        'craftsmen and the benefactor of humanity, he warns Atra-hasis/Utnapishtim of the Flood.',
    },
    {
      name: 'Inanna / Ishtar',
      sumerianName: 'Inanna',
      akkadianName: 'Ishtar',
      domain: 'love, sexuality, war, and the planet Venus',
      cityCult: 'Uruk',
      symbols: ['eight-pointed star', 'lion', 'reed bundle (ring-post)'],
      summary:
        'The most celebrated Mesopotamian goddess, joining erotic love and martial fury. The myth ' +
        'of her descent to the underworld and the death of Dumuzi underlies the seasonal cycle.',
    },
    {
      name: 'Marduk',
      sumerianName: 'Marduk',
      akkadianName: 'Marduk',
      domain: 'kingship of the gods, order, and creation (Babylon)',
      cityCult: 'Babylon',
      symbols: ['the spade (marru)', 'the mushhushshu (snake-dragon)'],
      summary:
        'City-god of Babylon who, in the Enuma Elish, slays the chaos-sea Tiamat, fashions the world ' +
        'from her body, and is exalted as king of the gods, eclipsing Enlil in the Babylonian era.',
    },
    {
      name: 'Nanna / Sin',
      sumerianName: 'Nanna',
      akkadianName: 'Sin',
      domain: 'the moon; time, the calendar, and cattle',
      cityCult: 'Ur',
      symbols: ['crescent moon', 'the bull'],
      summary:
        'The moon-god, measurer of months and reckoner of time, whose great cult at Ur (and later ' +
        'Harran) made him a major astral deity. Father of Utu/Shamash and Inanna/Ishtar.',
    },
    {
      name: 'Utu / Shamash',
      sumerianName: 'Utu',
      akkadianName: 'Shamash',
      domain: 'the sun, justice, law, and divination',
      cityCult: 'Sippar',
      symbols: ['the sun-disc with rays', 'the pruning-saw'],
      summary:
        'The sun-god who sees all and is the divine judge and lawgiver; the Code of Hammurabi shows ' +
        'the king receiving the law from him. His chief seats were Sippar and Larsa.',
    },
    {
      name: 'Ninhursag',
      sumerianName: 'Ninhursag',
      akkadianName: 'Belet-ili',
      domain: 'the earth, mountains, fertility, and birth (mother goddess)',
      cityCult: 'Kesh',
      symbols: ['the omega-shaped birth-hut symbol'],
      summary:
        'The great mother-goddess and "lady of the foothills," associated with the fecundity of the ' +
        'earth and the shaping of life; known also as Ninmah, Nintu, and Damgalnuna in various roles.',
    },
    {
      name: 'Ningal',
      sumerianName: 'Ningal',
      akkadianName: 'Nikkal',
      domain: 'reeds, marshes; the "great lady," consort of the moon-god',
      cityCult: 'Ur',
      symbols: ['the crescent (as consort of Nanna)'],
      summary:
        'Goddess of reeds and the marshlands, consort of Nanna/Sin and mother of Utu/Shamash and ' +
        'Inanna/Ishtar; venerated alongside the moon-god at Ur and at Harran.',
    },
    {
      name: 'Nergal',
      sumerianName: 'Nergal',
      akkadianName: 'Nergal',
      domain: 'the underworld, plague, scorching sun, and war',
      cityCult: 'Kutha',
      symbols: ['the lion-headed mace', 'the scimitar'],
      summary:
        'God of death, pestilence, and the destructive midday sun, who through the myth of Nergal ' +
        'and Ereshkigal becomes lord of the underworld beside its queen.',
    },
    {
      name: 'Ereshkigal',
      sumerianName: 'Ereshkigal',
      akkadianName: 'Ereshkigal',
      domain: 'queen of the underworld (Kur / Irkalla)',
      cityCult: 'Kutha',
      symbols: ['the underworld throne'],
      summary:
        'Dread queen of the land of the dead and elder sister of Inanna/Ishtar; the goddess before ' +
        'whom Inanna must pass the seven gates in the Descent.',
    },
    {
      name: 'Adad / Ishkur',
      sumerianName: 'Ishkur',
      akkadianName: 'Adad',
      domain: 'storm, rain, thunder, and (destructively) flood',
      cityCult: 'Karkara',
      symbols: ['the lightning-fork', 'the bull'],
      summary:
        'The weather-god of storm and rain — bringer of fertile showers and of devastating floods ' +
        'alike — wielding the lightning-bolt and riding or standing upon the bull.',
    },
    {
      name: 'Dumuzi / Tammuz',
      sumerianName: 'Dumuzi',
      akkadianName: 'Tammuz',
      domain: 'shepherds, vegetation, and the dying-and-rising fertility cycle',
      cityCult: 'Bad-tibira',
      symbols: ['the shepherd’s crook', 'sprouting grain'],
      summary:
        'The shepherd-god and consort of Inanna/Ishtar, given over to the underworld as her ' +
        'substitute; his annual death and return mark the withering and renewal of vegetation.',
    },
    {
      name: 'Nabu',
      sumerianName: 'Nabu',
      akkadianName: 'Nabu',
      domain: 'writing, scribes, wisdom, and the planet Mercury',
      cityCult: 'Borsippa',
      symbols: ['the stylus on a writing tablet', 'the wedge'],
      summary:
        'God of scribal arts and wisdom, keeper of the Tablet of Destinies and son of Marduk; his ' +
        'cult at Borsippa rose with Babylon, and he was patron of literacy and record-keeping.',
    },
    {
      name: 'Ninurta',
      sumerianName: 'Ninurta',
      akkadianName: 'Ninurta',
      domain: 'war, the hunt, agriculture, and heroic victory',
      cityCult: 'Nippur',
      symbols: ['the mace Sharur', 'the plough', 'the lion-headed eagle (Anzu)'],
      summary:
        'Warrior-son of Enlil and divine champion who defeats the Anzu-bird and monstrous foes; also ' +
        'a god of farming, embodying the strength that both wages war and works the land.',
    },
  ].map(freezeDeity),
);

// --- internal index: normalized name -> frozen entry (covers all three name fields) ----------
const BY_NAME = Object.freeze(
  PANTHEON.reduce((acc, d) => {
    for (const n of [d.name, d.sumerianName, d.akkadianName]) {
      if (!n) continue;
      const key = norm(n);
      if (key && !(key in acc)) acc[key] = d;
    }
    return acc;
  }, Object.create(null)),
);

// --- byName(name) -> entry | null (matches Sumerian or Akkadian name, accent/case-insensitive) -
// Also matches the combined `name` label and any whitespace-trimmed slash-separated component
// (e.g. "Anu", "An", or "An / Anu" all resolve to the same entry). Soft-fail: empty/unknown -> null.
export function byName(name) {
  const key = norm(name);
  if (!key) return null;
  if (BY_NAME[key]) return BY_NAME[key];
  // tolerate the combined "X / Y" form by trying each slash component
  for (const part of String(name ?? '').split('/')) {
    const p = norm(part);
    if (p && BY_NAME[p]) return BY_NAME[p];
  }
  return null;
}

// --- byDomain(domain) -> entry[] (substring match within the domain field, soft-fail) --------
export function byDomain(domain) {
  const q = norm(domain);
  if (!q) return [];
  return Object.freeze(PANTHEON.filter((d) => norm(d.domain).includes(q)));
}

// --- byCity(city) -> entry[] (substring match within the cityCult field, soft-fail) ----------
export function byCity(city) {
  const q = norm(city);
  if (!q) return [];
  return Object.freeze(PANTHEON.filter((d) => norm(d.cityCult).includes(q)));
}

// --- search(term) -> entry[] (free-text across every textual field + symbols, soft-fail) ------
export function search(term) {
  const q = norm(term);
  if (!q) return [];
  return Object.freeze(
    PANTHEON.filter((d) => {
      const hay = [
        d.name,
        d.sumerianName,
        d.akkadianName,
        d.domain,
        d.cityCult,
        d.summary,
        ...d.symbols,
      ]
        .map(norm)
        .join('  ');
      return hay.includes(q);
    }),
  );
}

// --- renderMarkdown() -> deterministic reference table --------------------------------------
//
// Stable output: deities are emitted in corpus order (fixed and frozen), so the render is
// byte-stable across runs. Every interpolated field is esc()'d.
export function renderMarkdown() {
  const lines = [];
  lines.push('# Mesopotamian Pantheon (Sumerian-Akkadian)');
  lines.push('');
  lines.push(
    '*Hand-curated public-domain reference. Where a deity is shared between traditions, ' +
      'both the Sumerian and Akkadian names are given.*',
  );
  lines.push('');
  lines.push('| Deity | Sumerian | Akkadian | Domain | Cult center | Symbols |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const d of PANTHEON) {
    const sum = d.sumerianName ? esc(d.sumerianName) : '—';
    const akk = d.akkadianName ? esc(d.akkadianName) : '—';
    const sym = d.symbols.length ? d.symbols.map(esc).join(', ') : '—';
    lines.push(
      `| ${esc(d.name)} | ${sum} | ${akk} | ${esc(d.domain)} | ${esc(d.cityCult)} | ${sym} |`,
    );
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

// --- CLI (guarded; pure stdout) -------------------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg) {
    const d = byName(arg) || (search(arg)[0] ?? null);
    if (!d) {
      const known = PANTHEON.map((x) => x.name).join(', ');
      console.log(`unknown deity: ${arg}\nknown deities: ${known}`);
    } else {
      console.log(`${d.name}`);
      console.log(`sumerian: ${d.sumerianName ?? '(n/a)'}`);
      console.log(`akkadian: ${d.akkadianName ?? '(n/a)'}`);
      console.log(`domain:   ${d.domain}`);
      console.log(`cult:     ${d.cityCult}`);
      console.log(`symbols:  ${d.symbols.join(', ') || '(none)'}`);
      console.log(`summary:  ${d.summary}`);
    }
  } else {
    console.log(renderMarkdown());
  }
}
