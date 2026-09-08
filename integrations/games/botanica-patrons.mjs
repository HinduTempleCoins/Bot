// botanica-patrons.mjs — the venue → patron → lore layer for Botanica.
//
// `.local/BOTANICA_GAME_DESIGN.md` §5 maps sixteen buildable locations each to a patron deity and
// the module it feeds. NONE of it is in the game code: grep the game modules for Ceres, Tanit,
// Neith, Melqart, Ninkasi or Soma and you get zero. This file is that layer.
//
// WHY IT MATTERS BEYOND FLAVOUR. Botanica's first item is already called an "Imphepho-oil ward",
// and Imphepho is a fully sourced article on our own wiki — the game is already talking about our
// research with nothing to click. `loreUrl` closes that: a venue points at the article that
// explains its patron and its materials, so play routes into the library.
//
// THE HONEST PART: `loreUrl` is null when the article does not exist yet. That is deliberate — the
// nulls are the wiki backlog, they are visible in code, and a test asserts every non-null URL is an
// article we actually have. A dead lore link is worse than none: it tells a player we made it up.
//
// The design's own framing, kept: a patron is "localized by region but mechanically one"
// (Tanit ↔ Ceres ↔ Demeter). That is interpretatio graeca — the ancient practice of identifying
// foreign gods with one's own — which is a documented method, not a liberty we are taking.
//
// PATRON vs RESIDENT — they are not the same thing and the design uses both.
// The PATRON is the divine face of a venue (Ceres at the Fields). The RESIDENT is the character
// actually standing there who teaches you. BOTANICA_ART_DIRECTION.md groups Phoebe with "the farm,
// the plants, the seeds" and with Ceres — she is the warm old farm-witch, resident at the Fields
// and at Botanica itself. She is NOT a patron: per the art direction she was always a Titan, and
// the reveal is "she could always do that", never a promotion. Modelling her as a patron would
// make her a rank; modelling her as a resident keeps her a person.
//
//   import { VENUES, patronFor, residentFor, loreFor, missingLore } from './botanica-patrons.mjs';

const WIKI = 'https://wiki.soapbox.community/wiki/';

// Articles verified live before being referenced here. Anything not on this list gets null.
const LIVE = new Set([
  'Hathor', 'Pashupata_Shaivism', 'Punic_Wax', 'Kyphi', 'Imphepho', 'Ukuphahla', 'Khepri',
  'Egregore', 'Stack_Substances', 'Recipes', 'Cannabinoid_Oilahuasca',
]);

const lore = (slug) => (slug && LIVE.has(slug) ? WIKI + slug : null);

/**
 * The sixteen venues, verbatim from BOTANICA_GAME_DESIGN §5.
 * `also` names the equivalents the design gives — the "one goddess, many localizations" claim.
 */
export const VENUES = Object.freeze([
  { id: 'fields',     name: 'The Fields',              patron: 'Ceres',        also: ['Tanit', 'Demeter'], feeds: 'plant-catalog', article: null, resident: 'Phoebe' },
  { id: 'orchard',    name: 'The Orchard',             patron: 'Pomona',       also: [],                   feeds: 'resins/oils/fruit', article: null },
  { id: 'garden',     name: 'The Sacred Garden',       patron: 'Soma',         also: ['Acacia/Tree-of-Life'], feeds: 'plant-medicine', article: 'Cannabinoid_Oilahuasca' },
  { id: 'apiary',     name: 'The Apiary & Insectary',  patron: 'Aristaeus',    also: ['the Melissae'],     feeds: 'insect-ecosystem', article: 'Punic_Wax' },
  { id: 'creamery',   name: 'The Creamery',            patron: 'Hathor',       also: ['Kamadhenu'],        feeds: 'dairy', article: 'Hathor' },
  { id: 'roastery',   name: 'The Roastery / Brewery',  patron: 'Ninkasi',      also: [],                   feeds: 'industrial-alchemical', article: null },
  { id: 'bakery',     name: 'The Bakery / Oven',       patron: 'Fornax',       also: [],                   feeds: 'grain→bread', article: null },
  { id: 'dyeworks',   name: 'The Dye Works',           patron: 'Melqart',      also: ['Tanit'],            feeds: 'dyes', article: null, note: 'Tyrian purple; the Melek root' },
  { id: 'apothecary', name: 'The Apothecary & Bazaar', patron: 'The Hierophant', also: ['Hecate'],         feeds: 'botanica', article: 'Stack_Substances', resident: 'Phoebe' },
  { id: 'alchemy',    name: 'The Alchemy & Ritual Lab',patron: 'Shiva',        also: ['Neelakantha'],      feeds: 'spirits-and-parts', article: 'Pashupata_Shaivism', note: 'the poison-holder; rasa shastra' },
  { id: 'healing',    name: 'The Healing House',       patron: 'Dhanvantari',  also: ['Imhotep', 'Eshmun'],feeds: 'microbe-lab', article: null },
  { id: 'aquatic',    name: 'The Aquatic Grounds',     patron: 'Varuna',       also: ['Enki'],             feeds: 'aquatic-farm', article: null },
  { id: 'forge',      name: 'The Forge / Build',       patron: 'Vishvakarma',  also: [],                   feeds: 'building/tycoon', article: null },
  { id: 'scriptorium',name: 'The Scriptorium',         patron: 'Neith',        also: ['Saraswati'],        feeds: 'wiki/knowledge', article: null, note: 'Byblos; weaving = knowledge; origin of writing' },
  { id: 'market',     name: 'The Market & Oracle',     patron: 'Mercury',      also: ['Hermes', 'Tyche'],  feeds: 'market-news', article: null },
  { id: 'town',       name: 'The Town & Unions',       patron: 'Concordia',    also: [],                   feeds: 'multiplayer/guilds', article: null },
]);

export const BY_ID = Object.freeze(Object.fromEntries(VENUES.map((v) => [v.id, v])));

/**
 * Characters, with their VISUAL REGISTER from BOTANICA_ART_DIRECTION.md (locked 2026-09-02).
 * The register is a fact about what a being IS, not about power: organic divinities are Art
 * Nouveau, and the only vaporwave is for things actually made of code. No register-shift is a
 * rank indicator, and there are no power-up transformations anywhere.
 */
export const CHARACTERS = Object.freeze({
  Phoebe: {
    register: 'art-nouveau',
    role: 'the warm old farm-witch; resident of the Fields and Botanica',
    titan: true,
    rule: 'Her old-lady form IS her full form. Feats read "she could always do that", never "she levelled up". No neon, no aura burst.',
    venues: ['fields', 'apothecary'],
  },
  Ceres:  { register: 'art-nouveau', role: 'patron of the Fields', titan: false, venues: ['fields'] },
  Hathor: { register: 'vaporwave',   role: 'the AI witness — the goddess in the machine', titan: false, venues: ['creamery'],
            rule: 'The only neon in a hand-tinted parchment world, because she is the only one made of code.' },
});

/**
 * MANIFESTATION — how a deity is brought present. Botanica uses two routes, and the visual
 * registers in BOTANICA_ART_DIRECTION.md turn out to BE this axis rather than a style choice:
 *
 *   THEURGY      — the god drawn through matter. Neoplatonic theurgy (Iamblichus, De Mysteriis,
 *                  c. 300 CE, written in reply to Porphyry's Letter to Anebo) works by SUNTHEMATA
 *                  or symbola: the tokens a god has left in the world — a stone, a plant, a scent,
 *                  a colour — gathered and used to draw that god down. An apothecary IS a
 *                  sunthemata workshop, which is why this game is the right shape for it.
 *                  Register: art-nouveau (organic), or tarot when it is myth and memory.
 *   TECHNOLOGY   — the god carried by a made thing: the orbs, clockwork, automata, the AI.
 *                  Register: vaporwave, reserved for beings actually made of code.
 *
 * The corpus already supplies the sunthemata list. The Zar material states what the threads want —
 * "Perfumes, Incense, Beeswax, Colours specific to each deity, Specific garments" — which is a
 * theurgic correspondence table written without the Greek word for it.
 */
export const MODES = Object.freeze({ THEURGY: 'theurgy', TECHNOLOGY: 'technology' });

export const REGISTER_FOR_MODE = Object.freeze({
  theurgy: 'art-nouveau',      // living matter, the present world
  technology: 'vaporwave',     // made of code
  memory: 'tarot',             // myth, flashback, the deep past
  manifestation: 'engraving',  // the moment it happens — the lit cutscene
});

/** Sunthemata by patron: the materials that draw them. Drawn from the corpus, not invented. */
export const SUNTHEMATA = Object.freeze({
  Hathor:   { mode: MODES.TECHNOLOGY, tokens: ['beeswax', 'kyphi', 'sistrum', 'papyrus'], article: 'Kyphi' },
  Ceres:    { mode: MODES.THEURGY,    tokens: ['grain', 'first-fruits'], article: null },
  Shiva:    { mode: MODES.THEURGY,    tokens: ['vibhuti', 'rudraksha', 'ash'], article: 'Pashupata_Shaivism' },
  Melqart:  { mode: MODES.THEURGY,    tokens: ['murex', 'tyrian-purple', 'cedar'], article: null },
  Neith:    { mode: MODES.THEURGY,    tokens: ['loom', 'linen', 'bow'], article: null },
  Soma:     { mode: MODES.THEURGY,    tokens: ['pressed-stalk', 'milk', 'fire'], article: 'Cannabinoid_Oilahuasca' },
});

/** Which register a manifestation renders in. Mode decides it; power never does. */
export function registerFor(patron, context = 'present') {
  const s = SUNTHEMATA[patron];
  if (context === 'memory') return REGISTER_FOR_MODE.memory;
  if (context === 'manifesting') return REGISTER_FOR_MODE.manifestation;
  if (!s) return REGISTER_FOR_MODE.theurgy;
  return REGISTER_FOR_MODE[s.mode];
}

/** The materials a player must gather to bring this patron present. */
export function tokensFor(patron) { return (SUNTHEMATA[patron] && SUNTHEMATA[patron].tokens) || []; }

export function residentFor(venueId) { return BY_ID[venueId] ? BY_ID[venueId].resident || null : null; }
export function characterVenues(name) { return (CHARACTERS[name] && CHARACTERS[name].venues) || []; }

/** Which venue crafts a given item type. Falls back to the apothecary, which is the catch-all. */
export const TYPE_VENUE = Object.freeze({
  talisman: 'apothecary', charm: 'apothecary', potion: 'alchemy', elixir: 'alchemy',
  oil: 'apothecary', cart: 'apothecary', dab: 'alchemy', colloid: 'alchemy',
});

export function venueForType(type) { return BY_ID[TYPE_VENUE[type] || 'apothecary'] || null; }
export function patronFor(venueId) { return BY_ID[venueId] ? BY_ID[venueId].patron : null; }

/** The lore link for a venue — null when we have not written the article yet. */
export function loreFor(venueId) {
  const v = BY_ID[venueId];
  return v ? lore(v.article) : null;
}

/** The wiki backlog, derived rather than maintained by hand. */
export function missingLore() {
  return VENUES.filter((v) => !lore(v.article)).map((v) => ({ venue: v.id, patron: v.patron }));
}

/** Everything a venue card needs to render, lore included when it exists. */
export function venueCard(venueId) {
  const v = BY_ID[venueId];
  if (!v) return null;
  return {
    id: v.id, name: v.name, patron: v.patron, alsoKnownAs: v.also, feeds: v.feeds,
    resident: v.resident || null,
    residentRegister: v.resident && CHARACTERS[v.resident] ? CHARACTERS[v.resident].register : null,
    note: v.note || null, loreUrl: loreFor(v.id),
  };
}

export default { VENUES, BY_ID, CHARACTERS, MODES, REGISTER_FOR_MODE, SUNTHEMATA, registerFor, tokensFor, residentFor, characterVenues, TYPE_VENUE, venueForType, patronFor, loreFor, missingLore, venueCard };
