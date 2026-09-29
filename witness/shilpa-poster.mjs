// shilpa-poster.mjs — @shilpa-shastra publishes the historical remakes gallery on MELEK in large batches.
// Reads the public gallery manifest, posts the next BATCH unposted scenes (every image of each, with its source
// credit and a link to that scene in the gallery), opens with a researched Śilpa Śāstra intro + fact card
// (.local/hathor/shilpa/SHILPA_SHASTRA_RESEARCH.md), and signs through MELEK-Signer with a comment/vote-only
// token (no key on this box). Run by a timer 4x/day; once everything is posted it only picks up new renders.
// Also posts a "Moving pictures" set of Hathor's new videos — animations, documentaries, animated maps — as they are made
// (each run: the next remake set, then the next video set). Every post says plainly that these are features we are
// testing and developing.
// Env: MELEK_SIGNER_TOKEN (required), MELEK_SIGNER_URL, SHILPA_STATE_DIR. Flags: --dry (print, don't post), --batch=N.
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

const loadState = () => { try { return { videos: [], videoSets: 0, ...JSON.parse(readFileSync(STATE, 'utf8')) }; } catch { return { posted: [], sets: 0, videos: [], videoSets: 0 }; } };
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
}
