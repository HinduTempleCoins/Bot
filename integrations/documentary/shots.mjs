// shots.mjs — narration sentences → visuals → storyboard. Reuse first: every sentence is matched by keyword against
// an index of images we already have (the remakes gallery, the worker's character/object/landscape library), with a
// people preference (e.g. Nubian versions for Kush) and no reuse of an image within the last few shots. Only where
// nothing fits does it ask for a new CPU render, up to a budget; past the budget it falls back to the chapter's best
// image. Pure functions — the worker builds the index and does the renders.

// Words that should never appear in an asset used by a film about antiquity (checked on title/credit/text).
export const ANACHRONISM = /\b(minarets?|mosques?|cathedrals?|churche?s?|crescent|rifles?|muskets?|pistols?|cannons?|steam(ship|boat)s?|railways?|telegraph|dahabieh|ottoman|mamluk|bazaars?|pasha)\b/i;
/** shots of an ancient-era board whose asset is modern or carries an anachronism word → [{ at: index, asset, why }] */
export function anachronismCheck(board, index) {
  const byPath = new Map(index.map((x) => [x.path, x]));
  const out = [];
  board.shots.forEach((s, i) => {
    const a = byPath.get(s.image);
    if (!a) return;
    if (a.depicts === 'modern') out.push({ shot: i, asset: a.id, why: 'depicts a modern scene' });
    else if (ANACHRONISM.test(`${a.text} ${a.credit || ''}`)) out.push({ shot: i, asset: a.id, why: `anachronism word: ${(`${a.text} ${a.credit || ''}`.match(ANACHRONISM) || [])[0]}` });
  });
  return out;
}

export const ALPHA_LINE = 'Alpha — Hathor is still being trained; her next documentaries will be much better and more accurate.';

// concept → words that may appear in image titles/groups/credits
export const SYNONYMS = {
  kush: ['kush', 'kushite', 'nubia', 'nubian', 'cush'], nubia: ['nubia', 'nubian', 'kush', 'kushite'],
  nile: ['nile', 'river', 'boat', 'cataract', 'felucca', 'ports'], river: ['nile', 'river', 'euphrates', 'tigris'],
  egypt: ['egypt', 'egyptian', 'pharaoh', 'theban', 'tomb'], pharaoh: ['pharaoh', 'king', 'royal', 'kushite king', 'dynasty'],
  archers: ['archer', 'archers', 'bow', 'military', 'nubian archers'], bow: ['archer', 'bow'],
  army: ['army', 'military', 'soldier', 'chariot', 'division'], war: ['army', 'military', 'battle', 'chariot'],
  temple: ['temple', 'shrine', 'amun', 'stele'], amun: ['amun', 'temple', 'ram'],
  gold: ['gold', 'tribute', 'treasure', 'jewel'], tribute: ['tribute', 'procession', 'gifts', 'visitors'],
  queen: ['queen', 'kandake', 'cleopatra', 'nefertiti', 'lady'], kandake: ['queen', 'kandake'],
  pyramid: ['pyramid', 'meroe', 'tomb'], meroe: ['meroe', 'pyramid', 'nubia'],
  eden: ['garden', 'lotus', 'paradise', 'river'], garden: ['garden', 'lotus', 'perfume'],
  flood: ['flood', 'ark', 'waters', 'hyperborea', 'delos'], noah: ['noah', 'ark', 'flood'],
  incense: ['incense', 'perfume', 'kyphi', 'myrrh', 'litter'], arabia: ['arabia', 'incense', 'caravan', 'desert'],
  babel: ['babel', 'tower', 'ziggurat', 'babylon'], nimrod: ['hunter', 'king', 'babylon'],
  assyria: ['assyria', 'assyrian', 'army'], rome: ['rome', 'roman', 'legion'],
  iron: ['iron', 'forge', 'smith', 'weapon', 'axe'], script: ['script', 'glyph', 'inscription', 'stele', 'hieroglyph'],
  stela: ['stele', 'stela', 'inscription'], mountain: ['mountain', 'cliff', 'barkal', 'western mountain'],
  procession: ['procession', 'visitors', 'tribute'], bible: ['scroll', 'papyrus', 'book of the dead'],
  sea: ['ship', 'port', 'coast', 'sea'], desert: ['desert', 'sand', 'caravan'],
};

const STOP = new Set('the a an of and or to in on at by for with from as is was were be been it its this that these those his her their our your we you they he she i my me who which what when where how there here into over under after before about also not but so then than out up down all any each most more much many one two three four five six seven eight nine ten'.split(' '));

export function keywords(text) {
  const ws = (String(text).toLowerCase().match(/[a-zà-ÿ]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
  const out = new Set();
  for (const w of ws) { out.add(w); for (const s of SYNONYMS[w] || []) out.add(s); }
  return [...out];
}

/** index: [{ path, text, people? }] → best image for a sentence, or null. */
export function matchImage(sentence, index, { people = '', recent = [], chapterWords = [] } = {}) {
  const kw = keywords(sentence);
  const ck = chapterWords;
  let best = null; let bestScore = 0;
  for (const im of index) {
    if (recent.includes(im.path)) continue;
    const t = ` ${im.text.toLowerCase()} `;
    let s = 0;
    for (const k of kw) if (t.includes(` ${k}`) || t.includes(k)) s += k.length > 5 ? 2 : 1;
    if (s < 1) continue; // the scene itself must match; topic words only break ties
    for (const k of ck) if (t.includes(k)) s += 0.6; // topic/sequence words: keep a Kush film in Kush
    if (people && im.people === people) s += 1;
    if (s > bestScore) { bestScore = s; best = im; }
  }
  return bestScore >= 1.5 ? best : null;
}

export function renderPrompt(sentence, { people = '' } = {}) {
  const who = people === 'nubian' ? 'dark-skinned Nubian (Kushite) people, ' : people === 'egyptian' ? 'brown-skinned Egyptian people, ' : '';
  return `${sentence.replace(/[«»]/g, '')} ${who}photorealistic historical recreation of the ancient world, natural light, cinematic 35mm photograph, highly detailed`;
}

/**
 * chapters: [{ title, lines:[{text,tag,source}] }] → { shots, renders }
 * Each shot: { image | render:<n>, say, caption?, min, chapter, card? }. Cards (title/chapter/end) are images the
 * worker draws; renders are prompts the worker turns into images before building.
 */
export function planShots({ topic, chapters, index, people = '', renderBudget = 8, recentWindow = 6 }) {
  const shots = []; const renders = []; const recent = [];
  shots.push({ card: 'title', title: topic.title, subtitle: topic.summary, alpha: ALPHA_LINE, min: 6, chapter: -1 });
  chapters.forEach((ch, ci) => {
    const chapterWords = keywords(ch.title);
    shots.push({ card: 'chapter', title: ch.title, number: ci + 1, min: 3.5, chapter: ci });
    let fallback = null;
    for (const line of ch.lines) {
      let im = matchImage(line.text, index, { people, recent, chapterWords });
      if (!im && renders.length < renderBudget) {
        renders.push({ prompt: renderPrompt(line.text, { people }), for: line.text });
        shots.push({ render: renders.length - 1, say: line.text, min: 3.5, chapter: ci, tag: line.tag, source: line.source });
        continue;
      }
      im = im || fallback || matchImage(ch.title, index, { people }) || index[(shots.length * 7) % Math.max(1, index.length)];
      fallback = fallback || im;
      if (im) { recent.push(im.path); if (recent.length > recentWindow) recent.shift(); }
      shots.push({ image: im ? im.path : '', say: line.text, min: 3.5, chapter: ci, tag: line.tag, source: line.source });
    }
  });
  shots.push({ card: 'end', title: 'Sources and credits', alpha: ALPHA_LINE, min: 8, chapter: chapters.length });
  return { shots, renders };
}

/** Sources list for the page and the YouTube description, grouped by kind. */
export function sourcesOf(chapters) {
  const by = { record: new Set(), tradition: new Set(), interpretation: new Set() };
  for (const ch of chapters) for (const l of ch.lines) if (l.tag && by[l.tag]) by[l.tag].add(l.source);
  return { record: [...by.record], tradition: [...by.tradition], interpretation: [...by.interpretation] };
}

/** YouTube-ready metadata. chapterStarts: seconds per chapter. */
export function youtubeMeta({ topic, chapters, chapterStarts, sources, url }) {
  const ts = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
  const desc = [
    topic.summary, '',
    `ALPHA: this is one of Hathor's first documentaries, made on our own servers. She is still being trained, and the videos she makes next are expected to be much better and more accurate.`, '',
    'Chapters:', `0:00 Introduction`, ...chapters.map((c, i) => `${ts(chapterStarts[i])} ${c.title}`), '',
    'How to read this film: we mark what is the historical record, what is scripture or tradition, and what is the Van Kush Family Research Institute\'s own interpretation.', '',
    'Historical record:', ...sources.record.map((s) => `• ${s}`), '',
    'Scripture and tradition:', ...sources.tradition.map((s) => `• ${s}`),
    ...(sources.interpretation.length ? ['', 'Institute interpretation:', ...sources.interpretation.map((s) => `• ${s}`)] : []), '',
    `Watch, read the transcript and see every source: ${url}`,
    'Made by Hathor, the AI witness of the MELEK chain, with Hathor Studio: https://hathor.soapbox.community',
  ].join('\n');
  return { title: `${topic.title} | Hathor Documentary (Alpha)`, description: desc, tags: ['history', 'documentary', 'ancient history', 'Kush', 'Nubia', 'Nile', 'Bible history', 'archaeology', 'Hathor', 'MELEK'] };
}
