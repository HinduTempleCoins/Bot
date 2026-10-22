// shilpa-poster.mjs — @shilpa-shastra publishes the historical remakes gallery on MELEK in large batches.
// Reads the public gallery manifest, posts the next BATCH unposted scenes (every image of each, with its source
// credit and a link to that scene in the gallery), opens with a researched Śilpa Śāstra intro + fact card
// (.local/hathor/shilpa/SHILPA_SHASTRA_RESEARCH.md), and signs through MELEK-Signer with a comment/vote-only
// token (no key on this box). Run by a timer 4x/day; once everything is posted it only picks up new renders.
// Also posts a "Moving pictures" set of Hathor's new videos — animations, documentaries, animated maps — as they are made
// (each run: the next remake set, then the next video set). Every post says plainly that these are features we are
// testing and developing.
// Also posts the Dada scenes — the magazine-clipping series (one public-domain photograph as the ground, real
// cutouts pasted on it) — a few at a time, each with the source photograph it was built on.
// Env: MELEK_SIGNER_TOKEN (required), MELEK_SIGNER_URL, SHILPA_STATE_DIR, SHILPA_DADA_BATCH. Flags: --dry (print, don't post), --batch=N.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const BATCH = +(process.argv.find((a) => a.startsWith('--batch='))?.slice(8) || 20);
const GALLERY = 'https://hathor.soapbox.community/remakes';
const STUDIO_GALLERY = 'https://hathor.soapbox.community/gallery';
const SIGNER = String(process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN || '';
const RPC = 'https://melek.salon/rpc';
const AUTHOR = 'shilpa-shastra';
const STATE_DIR = process.env.SHILPA_STATE_DIR || new URL('./.shilpa-state/', import.meta.url).pathname, STATE = `${STATE_DIR}/state.json`;
const LOOK_NAMES = { '1_real': 'Realistic', '2_half': 'Half vaporwave', '3_full': 'Full MELEK aesthetic' };
const PEOPLE = { depicted: 'As depicted', egyptian: 'Egyptian', minoan: 'Minoan', punic: 'Punic (Carthaginian)', greek: 'Greek', nubian: 'Nubian', libyan: 'Libyan (Amazigh)', levantine: 'Levantine', pale: 'Pale' };

export const INTROS = [
  `Śilpa Śāstra is the Sanskrit science of arts and crafts. Its treatises teach how an image is measured, how its attributes are fixed, how its maker prepares, and how its eyes are finally opened. The canon measures a figure by its own face and keeps a deity's attributes fixed so that anyone, in any land, can know who is shown. This account publishes our historical remakes in that spirit. Each scene, whether Egyptian, Nubian, Minoan, Punic or Greek, is remade side by side for several peoples. The attributes stay constant and the people change. Today's set follows.`,
  `A bronze Naṭarāja from Tamil Nadu and a painted one from Kerala share no single face, yet no one mistakes him. In Śilpa Śāstra the identity of a sacred figure lives in its *lakṣaṇa*: the gesture, the emblem, the headdress, the measured proportion. We remake ancient scenes the same way. Hathor keeps her horns, sun-disk and menat across every version, and the people who carry them change from Nile to Nubia to the Aegean. Here they are, side by side.`,
  `Classical Indian image-makers used a unit taken from the figure itself: the *tāla*, one face-length, divided into twelve fingers. Gods, goddesses, humans and spirits each have their own count, so proportion itself says what order of being you are looking at. Egypt had a squared grid and Greece had Polykleitos' canon, each a sibling workshop with its own measure. Our remakes keep each scene's canon and attributes and let the peoples vary. Here is the next batch.`,
  `The old manuals told the image-maker to meditate first and to see the deity described in its *dhyāna* verse before touching stone. The verse was the brief. Finished images were brought to life by opening their eyes. Egypt's sculptors knew a parallel rite, the Opening of the Mouth, and one of their words for sculptor meant "one who causes to live." We work in that lineage of attention. Each scene below is remade for several peoples with its sacred attributes kept intact.`,
];

export const FACTS = [
  ['The science of making', `*Śilpa* means art, craft and skill; *śāstra* means a systematic teaching. Stella Kramrisch read *śilpa* as spanning "art, skill, craft, labor, ingenuity, rite and ritual, form and creation." Śilpa Śāstra is the body of treatises that governs how images, paintings, bronzes, carvings and crafted things are made, measured and consecrated.`, 'https://en.wikipedia.org/wiki/Shilpa_Shastras'],
  ['The All-Maker', `Two hymns of the Ṛgveda (10.81–82) praise Viśvakarman, "All-Maker," the one with eyes, faces, arms and feet on every side, who forged heaven and earth. Later tradition made him architect of the gods, and artisans across India still worship their tools on his festival.`, 'https://sacred-texts.com/hin/rigveda/rv10081.htm'],
  ['Imitating the divine workshop', `The Aitareya Brāhmaṇa (VI.27), as rendered by Coomaraswamy, says every human work of art is made "in imitation of the angelic works of art." Human craft is a copy of a heavenly original. That idea sits at the root of the Indian arts.`, 'https://archive.org/details/dli.ernet.234006'],
  ['A ruler cut from the image itself', `Hindu iconometry measures in *tāla*, one face-length from hairline to chin, divided into 12 aṅgulas. The aṅgula is the image's own "finger," so the same proportions hold for a hand-sized bronze or a colossus.`, 'https://archive.org/details/in.ernet.dli.2015.35798'],
  ['Proportion is theology', `In the Āgamic canon, Brahmā, Viṣṇu and Śiva are made in the tallest class (*uttama-daśatāla*, 124 aṅgulas). The great goddesses take 120 and the guardian gods 116. Humans are *aṣṭatāla*, Gaṇeśa *pañcatāla*, children and dwarfs *catustāla*. How tall a figure stands, counted in its own face-lengths, tells you what order of being it is.`, 'https://archive.org/details/in.ernet.dli.2015.35798'],
  ['Made from vision, not from a model', `The icon-maker was to enter meditation and see the deity described in its *dhyāna* verse before carving. As Coomaraswamy renders a verse of the Śukranīti, the imager must be "expert in vision… certainly not in the presence of a model" can the work be done. The brief is a poem, and the studio is the mind.`, 'https://archive.org/details/dli.ernet.234006'],
  ['Opening the eyes', `When a mūrti is finished, *netronmīlana*, the opening of the eyes, brings it to life. The sculptor cuts the last line of the eye, or the priest touches it with a golden needle during *prāṇa-pratiṣṭhā*, the "establishing of breath." In Swamimalai the bronze casters still call this rite *kaṇ-tiṟappu*.`, 'https://en.wikipedia.org/wiki/Prana_pratishtha'],
  ['A parallel on the Nile', `From the 4th Dynasty on, Egyptian priests performed the Opening of the Mouth on statues, often in the sculptor's workshop, the "House of Gold," so the image could breathe, see and eat. One Egyptian word for sculptor, *sꜥnḫ*, means "one who causes to live." These are parallels between two ancient workshops, not a claim that one borrowed from the other.`, 'https://en.wikipedia.org/wiki/Opening_of_the_mouth_ceremony'],
  ['The king’s blueprint in stone', `In the 11th century King Bhoja of Dhārā was credited with the *Samarāṅgaṇa Sūtradhāra*, 83 chapters on towns, temples, painting, sculpture and even mechanical automata. At his unfinished Bhojpur temple, the builders' working drawings are still engraved in the surrounding rock, a rare case where the treatise and the site survive side by side.`, 'https://en.wikipedia.org/wiki/Samarangana_Sutradhara'],
  ['The oldest painting manual', `The *Citrasūtra*, chapters 35–43 of the third book of the Viṣṇudharmottara Purāṇa (c. 5th–7th century CE, date debated), is the oldest complete Sanskrit treatise on painting. It covers proportion, colour, shading, the feelings a picture should carry, and the arts painting depends on. Stella Kramrisch translated it in 1924.`, 'https://archive.org/details/vishnudharmottar031493mbp'],
  ['Likeness to the type', `The six limbs of painting include *pramāṇa* (measure), *bhāva* (feeling) and *sādṛśya* (likeness). In a sacred image, likeness means fidelity to the canonical type, not to a sitter. That is why a deity's weapon, gesture, mount and headdress are fixed by the texts: the attributes carry the identity. The Bṛhat Saṃhitā (6th c.) sets Yama on a buffalo with a club and puts a noose in Varuṇa's hand.`, 'https://en.wikipedia.org/wiki/Six_limbs_(Indian_painting)'],
  ['The guild is still working', `Mamallapuram's Government College of Architecture and Sculpture was founded in 1957 to carry the sthapati tradition into the modern era. In Swamimalai, around 1,200 Vishwakarma sthapatis still cast Chola-style bronzes by lost wax (beeswax, resin and groundnut oil, 4:4:1). The craft has held a Geographical Indication since 2008–09.`, 'https://en.wikipedia.org/wiki/Swamimalai_Bronze_Icons'],
  ['Sibling workshops, each with its own measure', `Egypt drew figures on a grid of 18 squares from soles to hairline, later 21 to the upper eyelid; Polykleitos built the Greek body from finger-to-palm *symmetria*; Song China's *Yingzao Fashi* (1103) sized buildings by the cai–fen module; the Topkapı Scroll kept the geometry of Islamic craft. Each is its own canon, set beside Śilpa Śāstra, not above it.`, 'https://en.wikipedia.org/wiki/Yingzao_Fashi'],
];

const STUDIO = 'https://hathor.soapbox.community';
const MUSIC = (process.env.SHILPA_MUSIC_SITE || 'https://stream.soapbox.community').replace(/\/$/, '');
export const TESTING = `*We are testing these features and looking to develop them. This is Hathor's alpha work, made on our own servers — the images and videos she makes next are expected to be much better and more accurate. Tell us what works and what doesn't: every video page has 👍/👎, comments and timestamped notes.*`;

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
const getJson = async (u) => { try { const r = await _fetch(u, { signal: AbortSignal.timeout(30000) }); return r.ok ? await r.json() : null; } catch { return null; } };
const mmss = (sec) => { const n = Math.round(+sec || 0); return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : ''; };

/** Every published video as { key, kind, title, summary, url, poster, seconds, credit } — soft-fail per source. */
export async function collectVideos() {
  const out = [];
  const docs = await getJson(`${STUDIO}/documentaries/manifest.json`);
  for (const f of (docs && docs.films) || []) {
    if (!f.id) continue;
    out.push({ key: `doc:${f.id}`, kind: 'Documentary', title: f.title || f.id, summary: f.summary || '', url: `${STUDIO}/documentaries/${f.id}`, poster: `${STUDIO}/documentaries/media/${f.id}/poster.jpg`, seconds: f.seconds, credit: Array.isArray(f.credits) ? f.credits.slice(0, 3).join(' · ') : '' });
  }
  const maps = await getJson(`${STUDIO}/maps/index.json`);
  for (const c of (maps && maps.clips) || []) {
    if (!c.id) continue;
    out.push({ key: `map:${c.id}`, kind: 'Animated map', title: c.title || c.id, summary: c.subtitle || [c.fromYear, c.toYear].every((y) => y != null) ? `${c.fromYear < 0 ? `${-c.fromYear} BC` : `AD ${c.fromYear}`} → ${c.toYear < 0 ? `${-c.toYear} BC` : `AD ${c.toYear}`}` : '', url: `${STUDIO}/maps#${c.id}`, poster: c.poster ? `${STUDIO}/maps/media/${c.poster}` : '', seconds: c.duration, credit: c.credit || '' });
  }
  const anims = await getJson(`${STUDIO}/animations/manifest.json`);
  for (const c of (anims && anims.clips) || []) {
    if (!c.id) continue;
    out.push({ key: `anim:${c.id}`, kind: c.kind === 'character-scene' ? 'Character scene' : 'Test animation', title: c.kind === 'puppet' ? (c.puppet_title || c.title) : c.title, summary: '', url: `${STUDIO}/animations#c-${c.id}`, poster: `${STUDIO}/animations/media/${c.id}/poster.jpg`, seconds: c.seconds, credit: '' });
  }
  return out;
}

// Songs made with Hathor Sandalphon. Read from the music library's own catalogue so a song is posted
// once it is actually live and playable — never before.
export async function collectSongs() {
  const cat = await getJson(`${MUSIC}/music/catalog.json`);
  return ((cat && cat.tracks) || []).filter((t) => t && t.id && t.url).map((t) => ({
    key: `song:${t.id}`,
    title: t.title || t.id,
    genre: t.genre || '',
    album: t.album || '',
    seconds: t.seconds || 0,
    url: t.url,
    audio: t.audio || '',
    embed: `${MUSIC}/music/embed/${t.id}`,
  }));
}

export function buildSongPost(items, setNo) {
  const albums = [...new Set(items.map((s) => s.album).filter(Boolean))];
  const title = `Songs, Set ${setNo}: ${albums.length ? albums.join(', ') : 'new songs'} from Hathor Sandalphon (testing)`.slice(0, 250);
  const block = (s) => [
    `### [${s.title}](${s.url})`,
    `*${[s.genre, s.album, s.seconds ? mmss(s.seconds) : ''].filter(Boolean).join(' · ')}*`,
    `▶ **[Listen here](${s.url})** — the player shows the melody as notes on a staff, or as guitar tab.`,
  ].filter(Boolean).join('\n\n');
  const body = [
    'Hathor Sandalphon is the music-making part of Hathor. These songs were written and recorded on our own '
    + 'servers with open-licence engines — original words and original music, never a copy of anyone else\'s song.',
    TESTING,
    '---',
    ...items.map(block),
    '---',
    `Every song, with its notes and its separate parts: [the music library](${MUSIC}/music) · `
    + 'make your own: [Hathor Sandalphon](https://pentecaust.com/sandalphon) · [the beat maker](https://pentecaust.com/sandalphon/beats)',
  ].join('\n\n');
  return { title, body, permlink: `shilpa-shastra-songs-set-${setNo}`, tags: ['shilpashastra', 'music', 'song', 'melek', 'ai'] };
}

export function buildVideoPost(items, setNo) {
  const kinds = [...new Set(items.map((v) => v.kind))];
  const title = `Moving Pictures, Set ${setNo}: ${kinds.join(', ')} from Hathor's studio (testing)`.slice(0, 250);
  const block = (v) => [
    `### [${v.title}](${v.url})`,
    `*${v.kind}${v.seconds ? ` · ${mmss(v.seconds)}` : ''}*${v.summary ? ` — ${v.summary}` : ''}`,
    v.poster ? `[![${v.title}](${v.poster})](${v.url})` : '',
    `▶ **[Watch it here](${v.url})**${v.credit ? `  
*Credits: ${v.credit}*` : ''}`,
  ].filter(Boolean).join('\n\n');
  const body = [
    `Hathor is learning to make moving pictures from the same remakes, characters and objects that fill the Śilpa Śāstra gallery — wordless documentaries, animated maps with the years ticking by, and short test animations.`,
    TESTING,
    '---',
    ...items.map(block),
    '---',
    `Everything in this set, and everything that comes next: [documentaries](${STUDIO}/documentaries) · [animated maps](${STUDIO}/maps) · [animation lab](${STUDIO}/animations) · [make your own](${STUDIO}/video-studio).`,
  ].join('\n\n');
  return { title, body, permlink: `shilpa-shastra-moving-pictures-set-${setNo}`, tags: ['shilpashastra', 'video', 'history', 'animation', 'melek', 'ai'] };
}

// --- Dada scenes -------------------------------------------------------------------------------
// The magazine-clipping Dada series built on melek-witnesses (/root/dada-real/eco, spec
// ECOSYSTEM_STORY.md, build notes SCENES.md). Scene stills are hosted on the image host; every
// description below is the build note for that scene, and every credit is the public-domain
// source photograph it was built on. Nothing here is written copy — the ground, the figures and
// the words are what the scene is actually made of.
const IMG = (process.env.SHILPA_IMG_BASE || 'https://melek.salon/img').replace(/\/$/, '');

export const DADA_SCENES = [
  { key: 'dada:bank', name: 'the bank robbery', title: 'Bank robbery', img: '016946a4e9dbfd30db3000e013c778e37551def8',
    ground: 'Grafton Bank (LCCN 2014713884) — a real 1920s bank on a real intersection, crowd and cars already in it',
    figures: 'bears, Angus bull, Colt SAA + Iver Johnson revolvers, bowler + top hat, $ neon sign on the bank, money bag, gold, 1925 Model T, Thompson gunman, 1905 police dog, bills, Iver Johnson ad' },
  { key: 'dada:poker', name: 'Dogs Playing Poker', title: 'Dogs Playing Poker', img: 'f3bfbd0d048a87f1a207fe3237e7df7a80c1d537',
    ground: 'C. M. Coolidge, *A Friend in Need* (1903), public domain — the card table is the setting',
    figures: 'bear heads, Hereford bull head, dolphins, breaching humpback, shiba, pasted over the dogs; money bag, Colt, gold, bills' },
  { key: 'dada:guerrilla-action', name: 'the guerrilla art action', title: 'Guerrilla art action', img: '7c9293166b826accc63472d282f7bf05570cee95',
    ground: 'New Orleans, 1920 — posters on the wall of old St Anthony church; one real wall of pasted bills',
    figures: 'bear in a beret with a real paste bucket and brush, cubs, dog, the 1965 Acid Test flyer and an Iver Johnson ad going up on the wall, $ sign',
    words: 'WE ARE LOOKING FOR PEOPLE / WHO LIKE TO DRAW',
    after: 'After the Guerrilla Art Action Group (1969) and the Guerrilla Girls: unsanctioned art actions, not protest marches.' },
  { key: 'dada:freemason', name: 'Freemason', title: 'Freemason / Illuminati', img: '94fc0aa1ea1e6a7343d4d9a87a15ca5e798b2755',
    ground: 'Knights Templar near their St. Anthony Lodge on 5th Street Southeast — one real street, one real lodge, the regalia already in the photo',
    figures: 'bear in a real Masonic Master apron and top hat, cubs in a second apron, Eye of Providence, the dollar-note pyramid seal, Melek Taus, bull, $ sign' },
  { key: 'dada:nyse', name: 'the Stock Exchange', title: 'Guerrilla theatre — the Yippies at the Stock Exchange', img: '93d71bd2a88cc9fb9b0b2c56d4c973600ac3890b',
    ground: 'New York Stock Exchange traders floor (LC-U9-10548-6) — one real trading floor',
    figures: 'bear/bull/dolphin heads on the traders, eight 1907 five-dollar bills raining down, a dollar note on the floor',
    after: 'After Abbie Hoffman and the Yippies throwing dollar bills from the gallery onto the NYSE floor, 24 August 1967.' },
  { key: 'dada:acid-test', name: 'the Acid Test', title: 'The Acid Test', img: 'ff19727074a34d611e086a3e0e9505c35c5b0db6',
    ground: 'Dreamland roller skating rink, Seattle, c. 1909 — one real hall packed with people',
    figures: 'bears, bull, dolphins, the real 1965 Acid Test flyer, a real psychedelic light-and-sound-show poster, tie-dye, bubbles, a star',
    words: 'CAN YOU PASS THE ACID TEST? · bus sign: FURTHUR',
    after: 'Words exact from the Fillmore Auditorium poster of 27 November 1966 (Grateful Dead Archive). The words, not the copyrighted poster image.' },
  { key: 'dada:da-dandy', name: 'Da-Dandy', title: 'Da-Dandy', img: '39008130b95f468d299433726543f80aedc509db',
    ground: '1923 Hess Brothers Rotunda, Allentown PA — one real department-store floor',
    figures: 'bear in a real top hat with a monocle, bear cubs, bowler, pearls, Crown Jewels, diamond, perfume, pocket watch, Marilyn Monroe',
    after: 'After Hannah Höch’s *Da-Dandy* (1919).' },
  { key: 'dada:temple', name: 'the Egyptian temple', title: 'Gods / Egyptian temple', img: 'e0ad5df2deda59f2a94a2fa7c5987d6da3235743',
    ground: 'Pylon, Temple of Horus at Edfu — one real temple pylon',
    figures: 'crowned bear, Amenhotep III head, Melek Taus, Kek, Hereford bull, Egyptian gold, Eye of Providence' },
  { key: 'dada:forms', name: 'forms and tickets', title: 'Grosz forms and tickets', img: 'd0630cbc83c02858006407b6ca480ab30ae71321',
    ground: 'Behind the teller’s window at Oxford National Bank, 1916',
    figures: 'bear and bull at the counter, Edison stock ticker, 1920 stamps, a lunch token, a 1920s invoice, a coin bank, typewriter, bills, $ sign' },
  { key: 'dada:coin-family', name: 'the coin family portrait', title: 'Coin family portrait', img: 'a6d2f5eab3469ea9dfd7bc83485b68b656d318f9',
    ground: 'Alc\u00e1zar of Segovia throne room \u2014 one real throne room',
    figures: 'Melek Taus (the angel, most prominent, per the spec), two shiba portraits (Doge), Kek and frogs (Pepe), a chimpanzee (the ape), Crown Jewels, a Bar Kokhba shekel, gold, Betty Boop',
    after: 'Family portraits of the coins, with our angels always the most prominent figure. The ape is in the popular profile-picture style but deliberately a little different, so the art does not copy any one project\u2019s ape.' },
  { key: 'dada:art-critic', name: 'The Art Critic', title: 'The Art Critic', img: 'd115cb6c9cd3d63644e0a9b4939c850ebe2d7606',
    ground: 'Giuseppe Gabrielli, *The National Gallery, Interior of Room 32* (1886)',
    figures: 'a suited man with a Hereford bull head, a carpenter rule where Hausmann put the pencil, coin bank, $ sign, 1920 stamps, a 1920s invoice, a lunch token, gold, a bear',
    after: 'After Raoul Hausmann’s *The Art Critic* (1919).' },
  { key: 'dada:parade', name: 'the circus parade', title: 'Fairs, parades, streets and food', img: '62772b9c83b839f587986c9d239ea2c250a6c77d',
    ground: '1909 Circus Parade, Allentown PA — one real circus parade with elephants and a float',
    figures: 'bear in a top hat, Hereford bull, cubs, a breaching whale, a Bread and Puppet clipping, a Macaroni Waiter engraving, dog statue, $ sign' },
  { key: 'dada:fountain', name: 'Fountain', title: 'Duchamp’s Fountain', img: 'aaddd20e53c221b33097308ad31729b24cda0a9a',
    ground: 'Sydney Art Gallery interior — one real sculpture gallery',
    figures: 'a 1928 Standard plumbing-fixture ad as the readymade, bear in a top hat, bull, Automaton of a Friar, dog statue, stamp, invoice',
    words: 'FOUNTAIN',
    after: 'Duchamp’s exact title. No urinal exists in the library; the 1928 Standard plumbing-fixture advertisement stands in.' },
  { key: 'dada:heartfield', name: 'money behind the back', title: 'Heartfield — money behind the back', img: '5c4bbbbdbee0542c43731ba6bc3dd51852971765',
    ground: 'Interior of Hamilton National Bank, Chattanooga, Tennessee',
    figures: 'bear in a top hat in front, a breaching whale behind passing a money bag, gold and bills; $ sign, bull',
    after: 'After John Heartfield’s photomontage of the hand taking money behind the back.' },
  { key: 'dada:automatons', name: 'the automatons', title: 'Automatons', img: '72d9beb42f23e1c245fa3a7621b213e77b313229',
    ground: 'Center Street, Provo, Utah — one real downtown street',
    figures: 'bear mechanical head wearing Hausmann’s actual objects (ribbon tin, tape measure, folding rule, watch movement, pipe, case, a TWENTY TWO card), blank top-hatted automaton, Automaton of a Friar, 12 mannequin heads, clockwork, chess automaton, bull, ball bearing',
    after: 'After Raoul Hausmann’s *Mechanical Head (The Spirit of Our Time)*, 1919, and George Grosz’s *Republican Automatons*, 1920.' },
  { key: 'dada:veterans', name: 'the cyborg veterans', title: 'Cyborg veterans', img: 'e45d9548379330d67dc78968542293cc33d48a60',
    ground: 'Manufacture of prosthetics and orthopedic shoes, 1910s — one real 1910s limb workshop',
    figures: 'scarred bear with prosthetic and robot hands, Johnson-Norton + Peerless 1915 limb ads, *The Disabled Soldier* 1919 figures, 3-D printed hand, robot arm, microcontroller board, Elizabethan prosthetic arm, dental prosthesis, bull',
    after: 'After Otto Dix and Max Ernst’s veterans with mechanical limbs — 1918-style prosthetics alongside more advanced cyborg parts.' },
  { key: 'dada:panthers', name: 'the Black Panthers', title: 'Black Panthers', img: '4eb4b9f2ca072e71e7ed867f73aa78a2e675bdcb',
    ground: 'Black Panther March — one real march',
    figures: 'bear in a black beret with a black leather jacket, raised fist, The Black Panther masthead, the Party Platform, the Free Breakfast flyer, cubs, bull, dog',
    words: 'UP AGAINST THE WALL' },
  { key: 'dada:kitchen-knife', name: 'Cut with the Kitchen Knife', title: 'Cut with the Kitchen Knife', img: '0d97739ebf6c5dc525f09449fa13e7a9f97a41a6',
    ground: 'Main kitchen, Shanley’s, New York — one real working kitchen',
    figures: 'scissors, knife and board, meat grinders, typewriter, rotary phone, flat-iron stove, bulb, ball bearing, turbine, gauge, Stuart Davis egg beater, chimp at a typewriter, bears, bull, bills',
    after: 'After Hannah Höch’s *Cut with the Kitchen Knife Dada through the Last Weimar Beer-Belly Cultural Epoch* (1919). Density is the point of this one theme.' },
];

const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function buildDadaPost(items, setNo) {
  const title = `Dada scenes: ${andList(items.map((s) => s.name))}`.slice(0, 250);
  const block = (s) => [
    `### ${s.title}`,
    `![${s.title}](${IMG}/${s.img}.jpg)`,
    `**The ground:** ${s.ground}`,
    `**Cut out and pasted on:** ${s.figures}`,
    s.words ? `**Words in the scene:** ${s.words}` : '',
    s.after || '',
  ].filter(Boolean).join('\n\n');
  const body = [
    'Magazine-clipping pop art and Dada: real photos, not cartoons, each piece cut out of a printed page. '
    + 'Every animal is a kind of market — the bear is the bear market, the bull the bull market, the minnows the '
    + 'small holders, the whales the big ones, the dolphins the quick traders.',
    'Three rules these were built to. **One ground per scene:** one photograph is the setting, the building is '
    + 'already in it or is one building pasted on, and everything else — the animals, the revolvers, the hats, the '
    + 'money bags — sits on top. **Real cutouts from real public-domain photographs, never generated imagery.** '
    + '**Text only in the operator’s exact words, or exact historical titles and quotes — nothing invented.**',
    '---',
    ...items.map(block),
    '---',
    'Every source photograph above is public domain, taken from Wikimedia Commons; provenance for each scene is '
    + 'kept with the build. Made on our own servers.',
  ].join('\n\n');
  return { title, body, permlink: `shilpa-shastra-dada-set-${setNo}`, tags: ['shilpashastra', 'dada', 'art', 'melek', 'history'] };
}

const loadState = () => { try { return { videos: [], videoSets: 0, songs: [], songSets: 0, dada: [], dadaSets: 0, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch { return { posted: [], sets: 0, videos: [], videoSets: 0, songs: [], songSets: 0, dada: [], dadaSets: 0 }; } };
const saveState = (s) => { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 1)); };

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  return (await r.json()).result;
}

export function sceneMarkdown(s) {
  const lines = [`### [${s.title}](${GALLERY}#${s.key})`];
  if (s.credit) lines.push(`*Source: ${s.credit}*`);
  if (s.source) lines.push(`Original: ![${s.title} — original](${GALLERY}/img/${s.key}/${s.source})`);
  for (const [look, people] of Object.entries(s.looks || {})) {
    const imgs = Object.entries(people).map(([p, f]) => `![${PEOPLE[p] || p} — ${LOOK_NAMES[look] || look}](${GALLERY}/img/${s.key}/${f})`);
    if (imgs.length) lines.push(`**${LOOK_NAMES[look] || look}** — ${Object.keys(people).map((p) => PEOPLE[p] || p).join(' · ')}\n\n${imgs.join('\n')}`);
  }
  return lines.join('\n\n');
}

export function buildPost(scenes, setNo) {
  const intro = INTROS[(setNo - 1) % INTROS.length];
  const [ft, fb, fs] = FACTS[(setNo - 1) % FACTS.length];
  const groups = [...new Set(scenes.map((s) => s.group).filter(Boolean))];
  const title = `Śilpa Śāstra · Remakes of the Ancient World, Set ${setNo}: ${groups.slice(0, 3).join(', ')}${groups.length > 3 ? ' & more' : ''}`.slice(0, 250);
  const body = [
    intro,
    `> **${ft}.** ${fb} ([source](${fs}))`,
    TESTING,
    `**The full gallery, every scene in every look:** [${GALLERY}](${GALLERY}) · Shilpa Shastra gallery: [${STUDIO_GALLERY}](${STUDIO_GALLERY})`,
    '---',
    ...scenes.map(sceneMarkdown),
    '---',
    `All ${scenes.length} scenes in this set, and every other remake, are in the gallery: **[${GALLERY}](${GALLERY})**. Made on our own servers in [Hathor Studio](https://hathor.soapbox.community); each scene links to its place in the gallery.`,
  ].join('\n\n');
  return { title, body, permlink: `shilpa-shastra-remakes-set-${setNo}`, tags: ['shilpashastra', 'art', 'history', 'remakes', 'melek', 'egypt'] };
}

async function signerComment(op) {
  const r = await fetch(`${SIGNER}/v1/broadcast`, { method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'posting', ops: [['comment', op]], client_ref: `shilpa-${op.permlink}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`signer ${r.status}: ${j.error || 'failed'}`);
  return j.result;
}

// The chain allows one top-level post per account every 5 minutes: wait out whatever is left of that window.
async function waitForRootWindow() {
  const acct = await rpc('condenser_api.get_accounts', [[AUTHOR]]).catch(() => null);
  const last = acct && acct[0] && Date.parse(`${acct[0].last_root_post}Z`);
  const head = await rpc('condenser_api.get_dynamic_global_properties', []).catch(() => null);
  const now = head ? Date.parse(`${head.time}Z`) : Date.now();
  const wait = last ? last + 5 * 60 * 1000 + 10000 - now : 0;
  if (wait > 0) { console.log(`waiting ${Math.ceil(wait / 1000)} s (one root post per 5 minutes)`); await new Promise((r) => setTimeout(r, wait)); }
}

async function postOnce(p, image, app) {
  await waitForRootWindow();
  const existing = await rpc('condenser_api.get_content', [AUTHOR, p.permlink]).catch(() => null);
  if (existing && existing.author === AUTHOR) return 'already on chain';
  const res = await signerComment({ parent_author: '', parent_permlink: p.tags[0], author: AUTHOR, permlink: p.permlink, title: p.title, body: p.body,
    json_metadata: JSON.stringify({ tags: p.tags, app, image: image ? [image] : [], links: [GALLERY], format: 'markdown' }) });
  return `tx ${res && (res.id || res.trx_id)}`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (!TOKEN && !DRY) { console.log('MELEK_SIGNER_TOKEN not set — nothing posted'); process.exit(0); }
  // stop switch (deploy/PRODUCTION.md): while the flag file exists, post nothing
  if (process.env.PRODUCTION_PAUSE_FILE && existsSync(process.env.PRODUCTION_PAUSE_FILE)) { console.log('production paused (flag file present) — nothing posted'); process.exit(0); }
  const st = loadState();
  let postedRemakes = false;
  // 1) the next remake set
  const m = await getJson(`${GALLERY}/manifest.json`) || { scenes: [] };
  const done = new Set(st.posted);
  const todo = (m.scenes || []).filter((s) => s.key && !done.has(s.key) && Object.keys(s.looks || {}).length);
  console.log(`gallery ${(m.scenes || []).length} scenes · posted ${done.size} · to post ${todo.length}`);
  if (todo.length) {
    const batch = todo.slice(0, BATCH);
    const setNo = (st.sets || 0) + 1;
    const p = buildPost(batch, setNo);
    const images = (p.body.match(/!\[/g) || []).length;
    if (DRY) console.log(`would post set ${setNo}: "${p.title}" — ${batch.length} scenes, ${images} images, ${p.body.length} chars`);
    else {
      const r = await postOnce(p, `${GALLERY}/img/${batch[0].key}/${Object.values(Object.values(batch[0].looks)[0])[0]}`, 'shilpa-shastra/poster').catch((e) => { console.log(`set ${setNo} not posted: ${e.message}`); return null; });
      if (r) {
        console.log(`posted set ${setNo}: ${batch.length} scenes, ${images} images, ${r}`);
        st.posted = [...done, ...batch.map((s) => s.key)]; st.sets = setNo; saveState(st);
        postedRemakes = true;
      }
    }
  }
  // 2) the next "Moving pictures" set: new documentaries first, then maps, then test animations
  const vids = await collectVideos();
  const vdone = new Set(st.videos || []);
  const order = { Documentary: 0, 'Character scene': 1, 'Animated map': 2, 'Test animation': 3 };
  const vtodo = vids.filter((v) => !vdone.has(v.key)).sort((a, b) => order[a.kind] - order[b.kind]);
  console.log(`videos ${vids.length} · posted ${vdone.size} · to post ${vtodo.length}`);
  if (vtodo.length) {
    const vb = vtodo.slice(0, +(process.env.SHILPA_VIDEO_BATCH || 12));
    const vset = (st.videoSets || 0) + 1;
    const p = buildVideoPost(vb, vset);
    if (DRY) console.log(`would post video set ${vset}: "${p.title}" — ${vb.length} videos, ${p.body.length} chars`);
    else {
      // the chain allows one top-level post per account every 5 minutes
      const r = await postOnce(p, vb[0].poster, 'shilpa-shastra/moving-pictures').catch((e) => { console.log(`video set ${vset} not posted: ${e.message}`); return null; });
      if (!r) process.exit(0);
      console.log(`posted video set ${vset}: ${vb.length} videos, ${r}`);
      st.videos = [...vdone, ...vb.map((v) => v.key)]; st.videoSets = vset; saveState(st);
    }
  }
  // 3) the next "Songs" set — whatever is live in the music library and has not been posted yet
  const songs = await collectSongs();
  const sdone = new Set(st.songs || []);
  const stodo = songs.filter((x) => !sdone.has(x.key));
  console.log(`songs ${songs.length} · posted ${sdone.size} · to post ${stodo.length}`);
  if (stodo.length) {
    const sb = stodo.slice(0, +(process.env.SHILPA_SONG_BATCH || 6));
    const sset = (st.songSets || 0) + 1;
    const p = buildSongPost(sb, sset);
    if (DRY) console.log(`would post song set ${sset}: "${p.title}" — ${sb.length} songs, ${p.body.length} chars`);
    else {
      const r = await postOnce(p, '', 'shilpa-shastra/songs').catch((e) => { console.log(`song set ${sset} not posted: ${e.message}`); return null; });
      if (!r) process.exit(0);
      console.log(`posted song set ${sset}: ${sb.length} songs, ${r}`);
      st.songs = [...sdone, ...sb.map((x) => x.key)]; st.songSets = sset; saveState(st);
    }
  }

  // 4) the next Dada scene set — the magazine-clipping series, a few scenes at a time
  const ddone = new Set(st.dada || []);
  const dtodo = DADA_SCENES.filter((s) => !ddone.has(s.key));
  console.log(`dada ${DADA_SCENES.length} \u00b7 posted ${ddone.size} \u00b7 to post ${dtodo.length}`);
  if (dtodo.length) {
    const db = dtodo.slice(0, +(process.env.SHILPA_DADA_BATCH || 6));
    const dset = (st.dadaSets || 0) + 1;
    const p = buildDadaPost(db, dset);
    if (DRY) console.log(`would post dada set ${dset}: "${p.title}" \u2014 ${db.length} scenes, ${p.body.length} chars\n\n${p.body}`);
    else {
      // the chain allows one top-level post per account every 5 minutes
      const r = await postOnce(p, `${IMG}/${db[0].img}.jpg`, 'shilpa-shastra/dada').catch((e) => { console.log(`dada set ${dset} not posted: ${e.message}`); return null; });
      if (!r) process.exit(0);
      console.log(`posted dada set ${dset}: ${db.length} scenes, ${r}`);
      st.dada = [...ddone, ...db.map((s) => s.key)]; st.dadaSets = dset; saveState(st);
    }
  }
}
