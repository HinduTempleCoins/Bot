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
    stock: 'reference',
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
    // No streamable stock of its own: the old white-slavery films are rescue narratives, so they live on
    // ROOTS_SHELF (near the genre, not in it). The flagships above are modern and copyrighted → leads only.
    pdTitles: [],
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

// ── curated PUBLIC-DOMAIN horror films (each verified live on the Internet Archive, 2026-09-29) ───────
// These stream in-app. `g` = HORROR_GENRES id; `sub` = the shelf label; `pd` = WHY it is public domain in the US:
// published 1930 or earlier (95-year term), or a documented later case (no notice / not renewed — cited to
// Wikipedia's article or its List of films in the public domain in the United States). IA uploader licence
// tags alone were NOT accepted as proof. Every id was checked: the item exists, is mediatype movies, is not
// dark, and has a real video file; trailers, colorized, riffed, hosted-compilation and Blu-ray/DVD rips were
// skipped. (Before this pass 13 of the 22 ids here pointed at items that did not exist.)
// The white-slavery / vice films are the ROOTS of the Girl Has to Kill Everyone genre — rescue and exposé
// narratives, not a girl killing everyone — so they sit on ROOTS_SHELF (g:'exploitation'), not in the genre.
export const PD_HORROR_FILMS = Object.freeze([
  { id: "Nosferatu1922", title: "Nosferatu", year: 1922, g: "monster", sub: "Vampire / Classic Monster", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "DasKabinettdesDoktorCaligariTheCabinetofDrCaligari", title: "The Cabinet of Dr. Caligari", year: 1920, g: "monster", sub: "Classic Monster / Gothic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "ThePhantomoftheOpera", title: "The Phantom of the Opera", year: 1925, g: "monster", sub: "Classic Monster", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "white_zombie", title: "White Zombie", year: 1932, g: "monster", sub: "Classic Monster / Zombie", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "TheVampireBat", title: "The Vampire Bat", year: 1933, g: "monster", sub: "Vampire", pd: "Wikipedia's article files it under its List of films in the public domain in the United States." },
  { id: "Devil_Bat_movie", title: "The Devil Bat", year: 1940, g: "monster", sub: "Creature Feature", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "The_Hunchback_of_Notre_Dame", title: "The Hunchback of Notre Dame", year: 1923, g: "monster", sub: "Gothic / Classic Monster", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "The.Mad.Monster", title: "The Mad Monster", year: 1942, g: "monster", sub: "Werewolf", pd: "Wikipedia's article files it under its List of films in the public domain in the United States." },
  { id: "DeadMenWalk", title: "Dead Men Walk", year: 1943, g: "monster", sub: "Vampire", pd: "Wikipedia's article files it under films in the public domain in the US (PRC, not renewed)." },
  { id: "TheGiantGilaMonster", title: "The Giant Gila Monster", year: 1959, g: "monster", sub: "Creature Feature", pd: "Wikipedia's article files it under films in the public domain in the US." },
  { id: "cco_attackofthegiantleeches", title: "Attack of the Giant Leeches", year: 1959, g: "monster", sub: "Creature Feature", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "CreatureFromTheHauntedSea", title: "Creature from the Haunted Sea", year: 1961, g: "monster", sub: "Creature / Comedy Horror", pd: "Wikipedia's article files it under films in the public domain in the US." },
  { id: "Little_ShopOf_Horrors.avi", title: "The Little Shop of Horrors", year: 1960, g: "monster", sub: "Comedy Horror / Killer Plant", pd: "Listed in Wikipedia's List of films in the public domain in the United States. Copyright not renewed." },
  { id: "ABucketofBlood", title: "A Bucket of Blood", year: 1959, g: "monster", sub: "Comedy Horror", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "le-manoir-du-diable-1896-georges-melies", title: "Le Manoir du diable (The Haunted Castle)", year: 1896, g: "monster", sub: "Silent short (Méliès) — the first horror film", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "bw5558885", title: "The Bat Whispers", year: 1930, g: "supernatural", sub: "Old Dark House / Haunting", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "CarnivalofSouls", title: "Carnival of Souls", year: 1962, g: "supernatural", sub: "Haunting / Slow Burn", pd: "Released without a valid copyright notice; public domain in the US (Wikipedia)." },
  { id: "TheScreamingSkull", title: "The Screaming Skull", year: 1958, g: "supernatural", sub: "Haunting", pd: "Listed in Wikipedia's List of films in the public domain in the United States. Never registered for copyright (Wikipedia)." },
  { id: "TheTerror1963", title: "The Terror", year: 1963, g: "supernatural", sub: "Gothic", pd: "Released without a copyright notice; public domain in the US (Wikipedia)." },
  { id: "Hxan1922720p", title: "Häxan", year: 1922, g: "supernatural", sub: "Witchcraft", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "ThePhantomCarriage", title: "The Phantom Carriage", year: 1921, g: "supernatural", sub: "Haunting", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "The_Cat_and_the_Canary", title: "The Cat and the Canary", year: 1927, g: "supernatural", sub: "Old Dark House / Haunting", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "TheBat1926", title: "The Bat", year: 1926, g: "supernatural", sub: "Old Dark House", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "Fall_of_the_House_of_Usher_1928_Watson", title: "The Fall of the House of Usher (Watson & Webber)", year: 1928, g: "supernatural", sub: "Gothic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "LaChuteDeLaMaisonUsher1928_201808", title: "The Fall of the House of Usher (Epstein)", year: 1928, g: "supernatural", sub: "Gothic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "FaustF.W.MurnauSilentFilm", title: "Faust", year: 1926, g: "supernatural", sub: "Ancient Magic / Gothic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "TheGolem_893", title: "The Golem", year: 1920, g: "supernatural", sub: "Ancient Magic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "destiny-1921-restored-movie-576p-sd", title: "Destiny (Der müde Tod)", year: 1921, g: "supernatural", sub: "Gothic / Death", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "the-magician", title: "The Magician", year: 1926, g: "supernatural", sub: "Ancient Magic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "1926-the-student-of-prague", title: "The Student of Prague", year: 1926, g: "supernatural", sub: "Gothic / Doppelgänger", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "warning-shadows-1923-restored-720p-hd", title: "Warning Shadows", year: 1923, g: "supernatural", sub: "Gothic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "seven-footprints-to-satan_1929", title: "Seven Footprints to Satan", year: 1929, g: "supernatural", sub: "Old Dark House", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "TheLastWarning1929PaulLeni", title: "The Last Warning", year: 1928, g: "supernatural", sub: "Old Dark House", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "TheHeadlessHorsemanSilent1922", title: "The Headless Horseman", year: 1922, g: "supernatural", sub: "Halloween / Folk Horror", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "RobertWienesgenuineATaleOfAVampire1920", title: "Genuine: A Tale of a Vampire", year: 1920, g: "supernatural", sub: "Gothic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "nightmare_castle", title: "Nightmare Castle", year: 1965, g: "supernatural", sub: "Gothic", pd: "Wikipedia's article files it under films in the public domain in the US." },
  { id: "the-skeleton-dance_1929", title: "The Skeleton Dance", year: 1929, g: "supernatural", sub: "Halloween short (Silly Symphony)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "hells-bells-1929", title: "Hell's Bells", year: 1929, g: "supernatural", sub: "Halloween short (Silly Symphony)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "SwingYouSinners1930Talkartoon", title: "Swing You Sinners!", year: 1930, g: "supernatural", sub: "Halloween short (Fleischer Talkartoon)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "TheHauntedHouse1921", title: "The Haunted House (Buster Keaton)", year: 1921, g: "supernatural", sub: "Halloween short / Comedy Horror", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "TheInfernalCauldron", title: "The Infernal Cauldron", year: 1903, g: "supernatural", sub: "Silent short (Méliès)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "Maniac1934", title: "Maniac", year: 1934, g: "slasher", sub: "Serial Killer / Exploitation", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "dementia-13-1963_202312", title: "Dementia 13", year: 1963, g: "slasher", sub: "Proto-slasher (Coppola)", pd: "Released without a valid copyright notice; public domain in the US (Wikipedia)." },
  { id: "TheLodgerAStoryOfTheLondonFog_579", title: "The Lodger: A Story of the London Fog", year: 1927, g: "slasher", sub: "Serial Killer (Hitchcock)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "The_Bat_Vincent_Price", title: "The Bat", year: 1959, g: "slasher", sub: "Old Dark House / Proto-slasher", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "Bluebeard", title: "Bluebeard", year: 1944, g: "slasher", sub: "Serial Killer", pd: "Wikipedia: the film is registered in the public domain." },
  { id: "Bowery_at_Midnight", title: "Bowery at Midnight", year: 1942, g: "slasher", sub: "Serial Killer", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "ThePenalty", title: "The Penalty", year: 1920, g: "slasher", sub: "Criminal Mastermind", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "Hitch_Hiker", title: "The Hitch-Hiker", year: 1953, g: "slasher", sub: "Serial Killer / Noir", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "silent-the-avenging-conscience-or-thou-shalt-not-kill", title: "The Avenging Conscience", year: 1914, g: "slasher", sub: "Murder / Poe (Griffith)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "lost_world", title: "The Lost World", year: 1925, g: "survival", sub: "Creature / Expedition", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "Sparrows1926720p", title: "Sparrows", year: 1926, g: "survival", sub: "Captivity & Escape — children escape a swamp baby farm", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "Dr.JekyllAndMr.Hyde1920", title: "Dr. Jekyll and Mr. Hyde", year: 1920, g: "body", sub: "Transformation / Body Horror", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "TheHandsOfOrlac1924", title: "The Hands of Orlac", year: 1924, g: "body", sub: "Body Horror / Transplant", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "the-unknown_1927", title: "The Unknown", year: 1927, g: "body", sub: "Body Horror", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "the-man-who-laughs-1928-restored-movie-576p-sd", title: "The Man Who Laughs", year: 1928, g: "body", sub: "Disfigurement / Gothic", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "silent-the-monster", title: "The Monster", year: 1925, g: "body", sub: "Mad Scientist", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "The_Wasp_Women", title: "The Wasp Woman", year: 1959, g: "body", sub: "Transformation", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "FrankensteinfullMovie", title: "Frankenstein (Edison)", year: 1910, g: "body", sub: "Mad Scientist", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "DrJekyllAndMrHyde1913", title: "Dr. Jekyll and Mr. Hyde", year: 1913, g: "body", sub: "Transformation", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "the-man-with-the-rubber-head-1901-directed-by-georges-melies", title: "The Man with the Rubber Head", year: 1901, g: "body", sub: "Silent short (Méliès)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "un-homme-de-tetes-or-the-four-troublesome-heads-by-georges-melies-189", title: "The Four Troublesome Heads", year: 1898, g: "body", sub: "Silent short (Méliès)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "UnChienAndalou1929_201807", title: "Un Chien Andalou", year: 1929, g: "body", sub: "Surrealist short (Buñuel & Dalí)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "night_of_the_living_dead_dvd", title: "Night of the Living Dead", year: 1968, g: "cosmic", sub: "Post-Apocalyptic / Zombie", pd: "Released without a copyright notice; public domain in the US (Wikipedia)." },
  { id: "TheLastManOnEarth_72", title: "The Last Man on Earth", year: 1964, g: "cosmic", sub: "Post-Apocalyptic / Zombie", pd: "Copyright not renewed; public domain in the US (Wikipedia)." },
  { id: "TheBrainThatWouldntDie_165", title: "The Brain That Wouldn't Die", year: 1962, g: "cosmic", sub: "Sci-Fi Horror / Body", pd: "Copyright not renewed; public domain in the US (Wikipedia)." },
  { id: "TheKillerShrews", title: "The Killer Shrews", year: 1959, g: "cosmic", sub: "Creature / Sci-Fi Horror", pd: "Wikipedia: now in the public domain." },
  { id: "teenagers_from_outerspace", title: "Teenagers from Outer Space", year: 1959, g: "cosmic", sub: "Invasion", pd: "Listed in Wikipedia's List of films in the public domain in the United States. Copyright not renewed." },
  { id: "indestructible_man", title: "Indestructible Man", year: 1956, g: "cosmic", sub: "Zombie / Revenant", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "RevoltoftheZombies_", title: "Revolt of the Zombies", year: 1936, g: "cosmic", sub: "Zombie", pd: "Wikipedia: the film is in the public domain." },
  { id: "1929TheMysteriousIsland", title: "The Mysterious Island", year: 1929, g: "cosmic", sub: "Sci-Fi Adventure / Creature", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "plan-9-from-outer-space", title: "Plan 9 from Outer Space", year: 1959, g: "exploitation", sub: "The Bad Movie shelf", pd: "Copyright not renewed; public domain in the US (Wikipedia)." },
  { id: "TheApe1940", title: "The Ape", year: 1940, g: "exploitation", sub: "Grindhouse / Creature", pd: "Wikipedia's article files it under its List of films in the public domain in the United States." },
  { id: "Eegah", title: "Eegah", year: 1962, g: "exploitation", sub: "The Bad Movie shelf", pd: "Wikipedia: the film is in the public domain." },
  { id: "reefer_madness1938", title: "Reefer Madness", year: 1936, g: "exploitation", sub: "Exploitation (scare film)", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "glenorglenda_201305", title: "Glen or Glenda", year: 1953, g: "exploitation", sub: "Ed Wood", pd: "Listed in Wikipedia's List of films in the public domain in the United States." },
  { id: "silent-traffic-in-souls", title: "Traffic in Souls", year: 1913, g: "exploitation", sub: "Roots: white-slavery films", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "silent-the-inside-of-the-white-slave-traffic", title: "The Inside of the White Slave Traffic", year: 1913, g: "exploitation", sub: "Roots: white-slavery films", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "tagebuch-einer-verlorenen-1929-1080p", title: "Diary of a Lost Girl", year: 1929, g: "exploitation", sub: "Roots: white-slavery films", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "the-road-to-ruin_1928", title: "The Road to Ruin", year: 1928, g: "exploitation", sub: "Roots: vice films", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "APageOfMadness", title: "A Page of Madness", year: 1926, g: "psychological", sub: "Medical / Institutional", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "waxworks-1924-restored-movie-720p-hd", title: "Waxworks", year: 1924, g: "psychological", sub: "Anthology as a Form", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
  { id: "shock", title: "Shock", year: 1946, g: "psychological", sub: "Medical / Institutional", pd: "Wikipedia's article cites it as a film in the public domain in the US." },
  { id: "silent-the-unholy-three", title: "The Unholy Three", year: 1925, g: "psychological", sub: "Criminal Masquerade (Browning & Chaney)", pd: "US public domain by age: published 1930 or earlier (95-year term)." },
]);

// October / Halloween picks for the /horror landing — all from the verified PD list above.
export const HALLOWEEN_PICKS = Object.freeze([
  'the-skeleton-dance_1929', 'TheHeadlessHorsemanSilent1922', 'night_of_the_living_dead_dvd', 'Nosferatu1922',
  'CarnivalofSouls', 'ThePhantomoftheOpera', 'DasKabinettdesDoktorCaligariTheCabinetofDrCaligari',
  'hells-bells-1929', 'Little_ShopOf_Horrors.avi', 'white_zombie', 'Hxan1922720p', 'TheHauntedHouse1921', 'SwingYouSinners1930Talkartoon',
]);

// Near the genre, NOT in it: the white-slavery / vice films the trafficking premise descends from. Rescue and
// exposé narratives — nobody is a girl who has to kill everyone — so this shelf sits OUTSIDE SURVIVAL_WING.
export const ROOTS_SHELF = Object.freeze({
  id: 'roots-white-slavery',
  title: 'Roots: the white-slavery films (near the genre, not in it)',
  wing: 'roots',
  emphasis: 'deemphasized',
  stock: 'mixed',
  thesis: 'Where the trafficking premise comes from: the white-slavery and vice films of 1913–1940. They are rescue '
    + 'and exposé narratives — police, reformers and families save the girl — so they are the history behind Girl Has '
    + 'to Kill Everyone, not part of it.',
  pdTitles: ['silent-traffic-in-souls', 'silent-the-inside-of-the-white-slave-traffic', 'tagebuch-einer-verlorenen-1929-1080p', 'the-road-to-ruin_1928'],
  titles: [
    { t: 'Slaves in Bondage', y: 1937, note: 'Vice-ring exposé — not streamed: its public-domain status is not documented' },
    { t: 'Gambling with Souls', y: 1936, note: 'Rigged gambling into forced prostitution — not streamed: public-domain status not documented' },
    { t: 'Mad Youth', y: 1940, note: 'Escort-racket exposé — not streamed: public-domain status not documented' },
  ],
  watchLeads: 'The four silent-era titles play free here; the 1930s exposés are leads only.',
});

// ── lookups ─────────────────────────────────────────────────────────────────────────────────────────
export function genreById(id) { return HORROR_GENRES.find((g) => g.id === String(id)) || null; }
export function survivalById(id) { return SURVIVAL_WING.find((s) => s.id === String(id)) || (ROOTS_SHELF.id === String(id) ? ROOTS_SHELF : null); }

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

// Our verified public-domain list is what clears these items at the IA licence check (archive-video.mjs no
// longer trusts IA community collections on their own).
archiveVideo.registerClearedIds(PD_HORROR_FILMS.map((f) => f.id));

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
