// horror-taxonomy.mjs — the SoapBox Stream HORROR classification + curation layer.
//
// Encodes the operator's own horror research — "A Map of Horror" (the 8-standalone-genre proposal) and
// "Girl Has to Kill Everyone" (the survival wing) — as a data model the streaming surface organizes by,
// instead of a generic one-word "Horror" genre. Two purposes:
//
//   1. TAXONOMY  — HORROR_GENRES (the 8 top-level genres + the subgenres each absorbs) and SURVIVAL_WING
//      (the "Girl Has to Kill Everyone" categories). Powers horror category pages + navigation on
//      site/stream/. This is film taxonomy + curation, not a content source of its own.
//   2. STOCK     — for each branch, either directly-streamable PUBLIC-DOMAIN films (curated IA
//      identifiers, all verified public-domain) OR, when a branch is mostly modern copyrighted work
//      (the whole survival/trafficking wing is), a live Internet-Archive keyword QUERY plus reference
//      "where-to-watch" leads. We NEVER rehost and only ever stock legal / PD / free-to-air titles.
//
// OPERATOR REFINEMENT (2026-09-22): the lead survival category is "sex trafficking / the network" — a
// survivor against a whole RING / operation (a systemic antagonist), which is what "kill EVERYONE"
// (plural) actually means. Lone-attacker and home-invasion are kept as SEPARATE, de-emphasized
// categories — trafficking is never collapsed into them.
//
// LICENSING DISCIPLINE: `stock:'pd'` entries are curated public-domain IA items and play in-app through
// the stream surface's own license gate (gateWatch). `stock:'reference'` categories are catalogs of
// (mostly copyrighted) titles we do NOT stream — they render as link-out / where-to-watch leads only.
// The stream server's gateWatch still independently refuses anything not license-cleared, so a mistaken
// entry here can surface as a lead but can never auto-play a copyrighted stream.
//
// House style: ESM, zero deps, __setFetch hook, keyless, soft-fail-never-throw, esc() on HTML, guarded
// CLI. The live fetch delegates to archive-video.mjs (its __setFetch is fanned by ours).
//
//   import { HORROR_GENRES, SURVIVAL_WING, curatedTiles, horrorFilms, iaQueryFor, __setFetch } from './horror-taxonomy.mjs'
//   node integrations/soapbox/horror-taxonomy.mjs supernatural

import * as archiveVideo from './archive-video.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) {
  _fetch = fn || ((...a) => globalThis.fetch(...a));
  archiveVideo.__setFetch(_fetch); // the live horror fetch runs through archive-video
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ── PART ONE: the 8 standalone genres ("A Map of Horror" — The Proposal) ─────────────────────────────
// The thesis: horror is not "intense thriller" — it is a family of ~8 genres that never got separated,
// each with more internal grammar than the whole thriller category. Thriller is a tone, not the parent.
// `keywords` seed the live Internet-Archive query; `subgenres` are the branches each genre absorbs.
export const HORROR_GENRES = Object.freeze([
  {
    id: 'supernatural',
    title: 'Supernatural',
    organizedAround: 'A cosmology — something exists beyond the material and it wants something.',
    subgenres: ['Haunting', 'Possession / Exorcism', 'Witchcraft', 'Ancient Magic', 'Folk Horror', 'Gothic / Period'],
    keywords: ['haunted', 'ghost', 'haunting', 'witch', 'exorcism', 'possession', 'gothic', 'phantom'],
  },
  {
    id: 'slasher',
    title: 'Slasher',
    organizedAround: 'A body count and a set of archetypes — set-piece kills, a final girl.',
    subgenres: ['Slasher (proper)', 'Giallo', 'Holiday', 'Serial Killer / Monster'],
    keywords: ['slasher', 'killer', 'murder', 'stalker', 'maniac', 'psycho'],
  },
  {
    id: 'survival',
    title: 'Survival & Captivity',
    organizedAround: 'Mechanics — can she get out, and what does it cost. Mechanical, not emotional.',
    subgenres: ['Sex Trafficking / The Network', 'Captivity & Escape', 'Siege', 'Backwoods & Hunted', 'Home Invasion', 'Natural / Animal Attack', 'Girl Has to Kill Everyone'],
    keywords: ['survival', 'captive', 'kidnapped', 'trapped', 'hunted', 'escape'],
    note: 'See SURVIVAL_WING for the full "Girl Has to Kill Everyone" breakdown, led by the trafficking-network category.',
  },
  {
    id: 'body',
    title: 'Body Horror',
    organizedAround: 'The anatomy is the site of the fear — anatomical, not situational.',
    subgenres: ['Body Horror', 'Splatter', 'Werewolf & Transformation', 'Medical / Institutional'],
    keywords: ['transformation', 'mutation', 'flesh', 'infected', 'werewolf', 'surgery'],
  },
  {
    id: 'cosmic',
    title: 'Cosmic',
    organizedAround: 'Comprehension itself is the injury — the universe is indifferent.',
    subgenres: ['Lovecraftian', 'Sci-Fi Horror', 'Post-Apocalyptic / Zombie', 'Kaiju'],
    keywords: ['lovecraft', 'cosmic', 'alien', 'sci-fi horror', 'apocalypse', 'zombie', 'monster from space'],
  },
  {
    id: 'monster',
    title: 'Monster',
    organizedAround: 'A creature with rules, a history, and a fandom.',
    subgenres: ['Vampire', 'Werewolf', 'Creature Feature', 'Classic Monster', 'Killer Object / Doll'],
    keywords: ['vampire', 'werewolf', 'creature', 'monster', 'dracula', 'frankenstein', 'mummy'],
  },
  {
    id: 'exploitation',
    title: 'Exploitation',
    organizedAround: 'A production mode and a distribution history — an aesthetic, not just a violence level.',
    subgenres: ['Grindhouse', 'Cannibal', 'Nunsploitation', 'Ozploitation', 'Blaxploitation horror', 'The Bad Movie shelf'],
    keywords: ['grindhouse', 'exploitation', 'drive-in', 'cannibal', 'shock'],
  },
  {
    id: 'psychological',
    title: 'Psychological',
    organizedAround: 'The unreliable interior.',
    subgenres: ['Slow Burn', 'Cult / Compound', 'Killer Kid', 'Hagsploitation', 'Found Footage', 'Webcam / Screen Life'],
    keywords: ['psychological', 'cult', 'found footage', 'madness', 'paranoia', 'nightmare'],
  },
]);

// ── PART TWO: the survival wing — "Girl Has to Kill Everyone" ────────────────────────────────────────
// The two tests (from the paper):
//   Martyrs wing  — "If she stops killing, does she die?"  → survival/captivity mechanics.
//   Eyes-of-My-Mother wing — "Is the film watching her be the monster (snapping point or not)?"
// Operator refinement: the LEAD category is the trafficking NETWORK — a survivor vs. a whole ring /
// operation (systemic antagonist). "Everyone" is plural on purpose. Lone-attacker and home-invasion
// are separate, de-emphasized categories; trafficking is never folded into them.
//
// `emphasis`: 'lead' (surface first + stock), 'standard', 'deemphasized'.
// `stock`:    'pd'        — curated public-domain films in PD_HORROR_FILMS, streamable in-app.
//             'reference' — mostly modern copyrighted; surfaced as leads/link-outs, NOT streamed.
//             'mixed'     — some genuine PD titles + a reference catalog + a live IA query.
// `titles` are the paper's reference examples (where-to-watch leads); `iaQuery` is the live PD search.
export const SURVIVAL_WING = Object.freeze([
  {
    id: 'trafficking-network',
    title: 'Sex Trafficking — The Network',
    wing: 'martyrs',
    emphasis: 'lead',
    stock: 'mixed',
    thesis: 'A survivor against a whole ring / operation — not a single attacker. She has to take on the '
      + 'network to get out or bring it down: the surgeon and the handlers and the buyers, an operation '
      + 'with structure. This is the sharpest reading of "kill EVERYONE" (plural = the system).',
    // The paper\'s flagship examples (modern, copyrighted → where-to-watch leads, not streamed):
    titles: [
      { t: 'Caged / Captifs', y: 2010, note: 'Held by organ/traffic ring; kills the surgeon, the handlers, the dogs on the way out' },
      { t: 'Bound to Vengeance', y: 2015, note: 'Escaped captive forces her abductor to lead her through the whole trafficking ring' },
      { t: 'Raze', y: 2013, note: '50 women forced to fight to the death for an operation, snipers on their loved ones' },
      { t: 'Even Lambs Have Teeth', y: 2015, note: 'Escape a holding-cell town the captor family owns' },
      { t: 'Thriller: A Cruel Picture', y: 1973, note: 'Trafficked and mute; trains in secret, then executes every handler' },
      { t: 'The Furies', y: 2019, note: 'Kill-or-be-killed game run by masked assassins as an operation' },
    ],
    // Genuinely PUBLIC-DOMAIN, on-thesis stock: pre-code "white slavery" / trafficking-ring exploitation
    // films (all verified PD). These DO stream in-app.
    pdTitles: ['slaves_in_bondage', 'gambling_with_souls', 'MadYouth1940', 'escape_by_night_1937'],
    iaQuery: '"white slavery" OR trafficking OR "vice ring" OR racket',
    watchLeads: 'Tubi rotates these (Raze, Bound to Vengeance, Caged, Even Lambs Have Teeth) — treat as leads, not guarantees.',
  },
  {
    id: 'captivity-escape',
    title: 'Captivity & Escape',
    wing: 'martyrs',
    emphasis: 'standard',
    stock: 'reference',
    thesis: 'Taken, caged, or locked in by one captor or a small crew; the only door out is through them. '
      + 'Distinct from the network above — the antagonist is not a whole operation.',
    titles: [
      { t: 'Fresh', y: 2022, note: 'Locked basement; freedom means killing everyone upstairs' },
      { t: 'The Princess', y: 2022, note: 'Locked in a tower; fights down through a castle of soldiers' },
      { t: 'Carnage Park', y: 2016, note: "Dumped in a sniper's electric-fenced desert compound" },
      { t: 'Would You Rather', y: 2013, note: 'Deadly parlor game in a mansion' },
    ],
    iaQuery: 'captive OR kidnapped OR abducted',
    watchLeads: 'Fresh/The Princess (Hulu); Would You Rather/Carnage Park cycle through Tubi.',
  },
  {
    id: 'siege',
    title: 'Siege',
    wing: 'martyrs',
    emphasis: 'standard',
    stock: 'reference',
    thesis: 'She is cornered in one location and the killers come to her — she holds and turns the space '
      + 'into the weapon.',
    titles: [
      { t: 'Hunt Her, Kill Her', y: 2023, note: 'Night-shift janitor alone in a factory vs. masked intruders' },
      { t: 'While She Was Out', y: 2008, note: 'Christmas Eve; four attackers, one toolbox' },
      { t: 'Everly', y: 2014, note: 'Fends off waves of assassins in one apartment' },
      { t: 'Wait Until Dark', y: 1967, note: 'Blind woman fights three invaders on her terms — grandmother of the genre' },
      { t: 'Kimi', y: 2022, note: 'Agoraphobic worker; the apartment becomes the weapon' },
    ],
    iaQuery: 'siege OR trapped OR "one night"',
    watchLeads: 'Hunt Her Kill Her / While She Was Out cycle through Tubi; Wait Until Dark rental.',
  },
  {
    id: 'backwoods-hunted',
    title: 'Backwoods & Hunted',
    wing: 'martyrs',
    emphasis: 'standard',
    stock: 'reference',
    thesis: 'Rural isolation; she is hunted like an animal and has to hunt back to get out alive.',
    titles: [
      { t: 'I Spit on Your Grave', y: 2010, note: 'Cornered at a remote cabin; engineers traps for every attacker' },
      { t: 'Eden Lake', y: 2008, note: 'Hunted through the woods by a teen gang' },
      { t: 'The Last House on the Left', y: 2009, note: 'The gang shelters in the victim family\'s home; the family executes them' },
      { t: 'Final Girl', y: 2015, note: 'Boys who hunt women for sport pick the one trained for exactly this' },
    ],
    iaQuery: 'backwoods OR "the most dangerous game" OR hunted',
    watchLeads: 'I Spit on Your Grave (2010)+Deja Vu, Final Girl, Ravage on Tubi.',
  },
  {
    id: 'urban-stylized',
    title: 'Urban & Stylized Necessity',
    wing: 'martyrs',
    emphasis: 'standard',
    stock: 'reference',
    thesis: 'Same no-exit logic, city streets or heightened action styling.',
    titles: [
      { t: 'Ms .45', y: 1981, note: 'Attacked twice in one day in NYC; the .45 becomes her only option' },
      { t: 'Freeway', y: 1996, note: 'Teen shoots her way through a corrupt landscape' },
      { t: 'We Will Not Die Tonight', y: 2018, note: 'Manila stuntwoman fights her way out from a crime boss' },
    ],
    iaQuery: 'vigilante OR "self defense"',
    watchLeads: 'Ms .45, Freeway on Tubi.',
  },
  {
    id: 'she-is-the-monster',
    title: 'She Is the Monster',
    wing: 'eyes-of-my-mother',
    emphasis: 'standard',
    stock: 'reference',
    thesis: 'The film is watching HER, not her escape — with a snapping point (Carrie, Pearl, Thelma, '
      + 'Ginger Snaps) or without one (Audition, May, Excision, Raw, The Love Witch).',
    titles: [
      { t: 'The Eyes of My Mother', y: 2016, note: 'Primary title of the wing' },
      { t: 'Carrie', y: 1976, note: 'Bullied telekinetic; the prom doors close (snapping point)' },
      { t: 'Audition', y: 1999, note: 'The quiet woman was always the horror (no snapping point)' },
      { t: 'Raw', y: 2016, note: 'Discovers what she already was, and does not turn back' },
    ],
    iaQuery: '"she was always" OR "her true nature"',
    watchLeads: 'Carrie on Tubi; most of this wing is Shudder/Prime/rental.',
  },
  {
    id: 'home-invasion',
    title: 'Home Invasion',
    wing: 'martyrs',
    emphasis: 'deemphasized',
    stock: 'reference',
    thesis: 'A single household attacked in its own home by intruders. Kept SEPARATE from the trafficking '
      + 'network and de-emphasized per the operator — the antagonist is an intrusion, not an operation.',
    titles: [
      { t: "You're Next", y: 2011, note: 'Family estate ambushed; survivalist upbringing kicks in' },
      { t: 'The Strangers', y: 2008 },
      { t: 'Hush', y: 2016 },
      { t: 'Intruders / Shut In', y: 2015, note: 'She locks the burglars in with her' },
    ],
    iaQuery: '"home invasion" OR intruder',
    watchLeads: "You're Next (Netflix/Prime).",
  },
  {
    id: 'lone-attacker',
    title: 'Lone Attacker',
    wing: 'martyrs',
    emphasis: 'deemphasized',
    stock: 'reference',
    thesis: 'A single perpetrator (one stalker / one assailant). Kept SEPARATE and de-emphasized per the '
      + 'operator — this is the trope the trafficking-network category is explicitly NOT.',
    titles: [
      { t: 'Revenge', y: 2017, note: 'Retribution against the men who left her for dead' },
      { t: 'Black Rock', y: 2012, note: 'Hunted on a remote island — small crew, not a ring' },
    ],
    iaQuery: 'stalker OR "one man"',
    watchLeads: 'Revenge, Black Rock on Tubi.',
  },
]);

// ── curated PUBLIC-DOMAIN horror films (verified PD Internet-Archive items) ─────────────────────────
// These stream in-app. `g` = HORROR_GENRES id; `sub` = the subgenre label. Trafficking-network PD stock
// is the pre-code "white slavery" exploitation set (genuinely public domain, on-thesis).
export const PD_HORROR_FILMS = Object.freeze([
  // Monster / Classic Monster / Gothic
  { id: 'Nosferatu1922', title: 'Nosferatu', year: 1922, g: 'monster', sub: 'Vampire / Classic Monster' },
  { id: 'TheCabinetOfDrCaligari', title: 'The Cabinet of Dr. Caligari', year: 1920, g: 'monster', sub: 'Classic Monster / Gothic' },
  { id: 'the_phantom_of_the_opera', title: 'The Phantom of the Opera', year: 1925, g: 'monster', sub: 'Classic Monster' },
  { id: 'whitezombie1932', title: 'White Zombie', year: 1932, g: 'monster', sub: 'Classic Monster' },
  { id: 'TheVampireBat', title: 'The Vampire Bat', year: 1933, g: 'monster', sub: 'Vampire' },
  { id: 'TheDevilBat1940', title: 'The Devil Bat', year: 1940, g: 'monster', sub: 'Creature Feature' },
  { id: 'atom_age_vampire', title: 'Atom Age Vampire', year: 1960, g: 'monster', sub: 'Vampire' },
  { id: 'TheHunchbackOfNotreDame1923', title: 'The Hunchback of Notre Dame', year: 1923, g: 'monster', sub: 'Gothic / Classic Monster' },
  // Supernatural / Haunting / Gothic
  { id: 'house_on_haunted_hill_ipod', title: 'House on Haunted Hill', year: 1959, g: 'supernatural', sub: 'Haunting' },
  { id: 'the_bat_whispers', title: 'The Bat Whispers', year: 1930, g: 'supernatural', sub: 'Old Dark House / Haunting' },
  { id: 'CarnivalOfSouls', title: 'Carnival of Souls', year: 1962, g: 'supernatural', sub: 'Haunting / Slow Burn' },
  { id: 'the_screaming_skull', title: 'The Screaming Skull', year: 1958, g: 'supernatural', sub: 'Haunting' },
  // Cosmic / Sci-Fi Horror / Zombie
  { id: 'night_of_the_living_dead', title: 'Night of the Living Dead', year: 1968, g: 'cosmic', sub: 'Post-Apocalyptic / Zombie' },
  { id: 'the_last_man_on_earth', title: 'The Last Man on Earth', year: 1964, g: 'cosmic', sub: 'Post-Apocalyptic / Zombie' },
  { id: 'TheBrainThatWouldntDie', title: "The Brain That Wouldn't Die", year: 1962, g: 'cosmic', sub: 'Sci-Fi Horror / Body' },
  { id: 'TheKillerShrews', title: 'The Killer Shrews', year: 1959, g: 'cosmic', sub: 'Creature / Sci-Fi Horror' },
  // Slasher ancestors / Serial killer
  { id: 'Maniac1934', title: 'Maniac', year: 1934, g: 'slasher', sub: 'Serial Killer / Exploitation' },
  { id: 'DementiaOr13', title: 'Dementia 13', year: 1963, g: 'slasher', sub: 'Proto-slasher (Coppola)' },
  { id: 'TheTerror1963', title: 'The Terror', year: 1963, g: 'supernatural', sub: 'Gothic' },
  // Body horror / transformation
  { id: 'Dr.JekyllAndMr.Hyde1920', title: 'Dr. Jekyll and Mr. Hyde', year: 1920, g: 'body', sub: 'Transformation / Body Horror' },
  // Exploitation / Bad-movie shelf
  { id: 'PlanNineFromOuterSpace', title: 'Plan 9 from Outer Space', year: 1959, g: 'exploitation', sub: 'The Bad Movie shelf' },
  { id: 'TheApe1940', title: 'The Ape', year: 1940, g: 'exploitation', sub: 'Grindhouse / Creature' },
  // Survival / trafficking-network — genuine PD pre-code exploitation ("white slavery"):
  { id: 'slaves_in_bondage', title: 'Slaves in Bondage', year: 1937, g: 'survival', sub: 'Sex Trafficking / The Network' },
  { id: 'gambling_with_souls', title: 'Gambling with Souls', year: 1936, g: 'survival', sub: 'Sex Trafficking / The Network' },
  { id: 'MadYouth1940', title: 'Mad Youth', year: 1940, g: 'survival', sub: 'Sex Trafficking / The Network' },
  { id: 'escape_by_night_1937', title: 'Escape by Night', year: 1937, g: 'survival', sub: 'Sex Trafficking / The Network' },
]);

// ── lookups ─────────────────────────────────────────────────────────────────────────────────────────
export function genreById(id) { return HORROR_GENRES.find((g) => g.id === String(id)) || null; }
export function survivalById(id) { return SURVIVAL_WING.find((s) => s.id === String(id)) || null; }

/** PD films curated for a given top-level genre id. */
export function pdFilmsFor(genreId) {
  const g = String(genreId || '');
  return PD_HORROR_FILMS.filter((f) => f.g === g);
}

/**
 * Build the Internet-Archive advancedsearch `q` clause for a horror genre (or survival category).
 * Scopes to the PD/horror film collections and ORs the branch keywords. PURE.
 */
export function iaQueryFor(idOrKeywords) {
  let kws = [];
  if (Array.isArray(idOrKeywords)) kws = idOrKeywords;
  else {
    const g = genreById(idOrKeywords);
    if (g) kws = g.keywords || [];
    else {
      const s = survivalById(idOrKeywords);
      if (s && s.iaQuery) return s.iaQuery;
    }
  }
  const clean = kws.map((k) => String(k).trim()).filter(Boolean);
  if (!clean.length) return 'horror';
  return clean.map((k) => (/\s/.test(k) ? `"${k}"` : k)).join(' OR ');
}

// ── curated tiles (offline, no network) — stock a branch immediately from PD_HORROR_FILMS ───────────
// Shaped to match archive-video's tile so site/stream/ tile()/gateWatch() consume them unchanged. The
// streamUrl is IA's OWN official player (archive.org/embed/<id>); the stream surface's gateWatch/
// embed-whitelist independently validates it before it can play.
export function toTile(film = {}) {
  if (!film || !film.id) return null;
  const id = String(film.id);
  return {
    id,
    title: film.title || id,
    kind: 'film',
    year: film.year != null ? String(film.year) : '',
    creator: film.sub || '',
    thumb: `https://archive.org/services/img/${id}`,
    streamUrl: `https://archive.org/embed/${id}`,
    embedUrl: `https://archive.org/embed/${id}`,
    license: 'Public domain (Internet Archive)',
    licenseToken: 'public-domain',
    source: 'Internet Archive',
    attribution: `Internet Archive — ${id}`,
    posture: 'window',
    details: `https://archive.org/details/${id}`,
    href: `https://archive.org/details/${id}`,
    horrorGenre: film.g || '',
    horrorSub: film.sub || '',
  };
}

/** Curated PD tiles for a genre id (offline). Soft-fails to []. */
export function curatedTiles(genreId, { limit = 24 } = {}) {
  const films = genreId ? pdFilmsFor(genreId) : PD_HORROR_FILMS.slice();
  const n = Math.max(1, Math.min(100, Number(limit) || 24));
  return films.slice(0, n).map(toTile).filter(Boolean);
}

// ── live horror fetch — a real IA search scoped to the horror collections ───────────────────────────
// Delegates to archive-video (its __setFetch is fanned by ours). Soft-fail → []. `genre` may be a
// HORROR_GENRES id, a SURVIVAL_WING id, or omitted (broad horror). A free-text `q` is AND-ed on top.
export async function horrorFilms({ genre = '', q = '', limit = 18 } = {}) {
  try {
    const branchQ = genre ? iaQueryFor(genre) : 'horror';
    // Prefer the SciFi_Horror curated PD collection; add feature_films/film_noir for breadth.
    const collections = ['SciFi_Horror', 'feature_films', 'film_noir'];
    const full = q ? `(${branchQ}) AND (${q})` : `(${branchQ})`;
    const tiles = await archiveVideo.searchArchive({ q: full, rows: limit, collections, kind: 'film' });
    return Array.isArray(tiles) ? tiles : [];
  } catch { return []; }
}

/** The taxonomy as rows the stream surface can render: each genre + its curated PD tiles. */
export function horrorGenreRows({ limit = 24 } = {}) {
  return HORROR_GENRES.map((g) => ({
    id: g.id, title: g.title, organizedAround: g.organizedAround, subgenres: g.subgenres,
    tiles: curatedTiles(g.id, { limit }),
  }));
}

export function dataNote() {
  return 'Horror organized by the operator\'s own taxonomy — "A Map of Horror" (8 standalone genres) and '
    + '"Girl Has to Kill Everyone" (the survival wing, led by the sex-trafficking / network category). '
    + 'We stream only curated PUBLIC-DOMAIN horror (Internet Archive) in-app; modern copyrighted branches '
    + 'are shown as where-to-watch leads and link-outs — we never rehost.';
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('horror-taxonomy.mjs')) {
  const arg = (process.argv[2] || '').trim();
  console.log('SoapBox Stream · Horror taxonomy');
  console.log('─'.repeat(66));
  if (!arg) {
    console.log(`${HORROR_GENRES.length} standalone genres (A Map of Horror):`);
    for (const g of HORROR_GENRES) {
      console.log(`  • ${g.title.padEnd(22)} ${pdFilmsFor(g.id).length} PD · absorbs: ${g.subgenres.join(', ')}`);
    }
    console.log(`\nSurvival wing — Girl Has to Kill Everyone (${SURVIVAL_WING.length} categories):`);
    for (const s of SURVIVAL_WING) {
      console.log(`  • [${s.emphasis.toUpperCase().padEnd(11)}] ${s.title}  (stock:${s.stock})`);
    }
    console.log('\n  ' + dataNote());
  } else {
    const tiles = curatedTiles(arg, { limit: 40 });
    console.log(`Genre "${arg}" — ${tiles.length} curated PD film(s):`);
    for (const t of tiles) console.log(`  ${(t.title || '').slice(0, 40).padEnd(42)} ${t.year || '----'}  ▶ ${t.streamUrl}`);
    console.log('  IA query: ' + iaQueryFor(arg));
  }
}
