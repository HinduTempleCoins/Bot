// genai-effect-templates.mjs — CapCut/Midjourney-style "put the SUBJECT into a scene" effect
// templates for the GenAI page, plus the Character model and the consent gate.
//
// THE IDEA (operator's spec): a wide selection of one-tap AI effects that keep the SAME
// subject but drop them into a new world — gorilla, monkey cameo, Grinch, Scrooge, Star Wars,
// military, mafia, superhero, etc. The subject is a CHARACTER:
//   • 'builtin'      — ships with the platform (Hathor: character/reference + character/lora)
//   • 'platform'     — a character the USER created on our platform (preferred path)
//   • 'fictional'    — a made-up character / non-real subject (no proof needed)
//   • 'real-person'  — a real human likeness → REQUIRES consent (bio-consent broker)
//
// Consent gate (operator's rule): ONLY 'real-person' needs to prove permission. Fictional
// and platform-created characters are open; builtins are pre-cleared. The generation itself
// is character-referenced (same person, new scene — not the original photo), executed by the
// providers/ComfyUI layer; this module is PURE data + PURE logic, fully testable offline.
//
//   listEffects() / listEffects(category)     -> effect templates
//   getEffect(id)                             -> one or null
//   EFFECT_CATEGORIES, CHARACTERS
//   getCharacter(id)                          -> a built-in character or null
//   subjectFromInput({kind,name,ref,consent}) -> normalized subject | throws-free {error}
//   needsConsent(subjectKind)                 -> bool
//   buildEffectJob(effectId, subject, opts)   -> { ok, job } | { ok:false, error|needsConsent }
//   validateEffects()                         -> integrity check for /health + tests

export const EFFECT_CATEGORIES = ['creature', 'holiday', 'film', 'power', 'era', 'art', 'lifestyle'];

export const SUBJECT_KINDS = ['builtin', 'platform', 'fictional', 'real-person'];

// Built-in characters that ship with the platform. Hathor already has a reference set + LoRA.
export const CHARACTERS = [
  {
    id: 'hathor',
    name: 'Hathor',
    kind: 'builtin',
    description: 'The MELEK AI Witness — the platform mascot character.',
    refDir: 'character/reference',
    lora: 'character/lora',
    cleared: true, // pre-cleared: the platform owns this character
  },
];

const CHAR_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));
export function getCharacter(id) { return CHAR_BY_ID.get(String(id || '')) || null; }

// The effect library. `{{subject}}` is replaced with a subject phrase (the character's name,
// or a neutral "the subject" for a bare face). `technique` hints the backend which path to
// take: character-referenced img gen so the OUTPUT is the same subject in a brand-new image,
// never the original photo.
export const EFFECT_TEMPLATES = [
  // ── creature ──────────────────────────────────────────────────────────────
  { id: 'gorilla', title: 'Giant Gorilla', category: 'creature',
    prompt: '{{subject}} transformed into a massive, powerful gorilla, cinematic jungle backdrop, realistic fur and muscle, dramatic lighting',
    negative: 'blurry, extra limbs, distorted face' },
  { id: 'monkey-cameo', title: 'Monkey Jumps In', category: 'creature',
    prompt: '{{subject}} in a candid photo while a mischievous monkey leaps into the frame, chaotic funny moment, photorealistic',
    negative: 'blurry, deformed' },
  { id: 'dino-world', title: 'Dinosaur World', category: 'creature',
    prompt: '{{subject}} standing in a prehistoric landscape as dinosaurs roam behind them, epic scale, movie still',
    negative: 'cartoonish, low detail' },
  { id: 'dragon-rider', title: 'Dragon Rider', category: 'creature',
    prompt: '{{subject}} riding a great dragon over a fantasy kingdom, wind and fire, epic fantasy poster',
    negative: 'blurry, extra heads' },
  // ── holiday ───────────────────────────────────────────────────────────────
  { id: 'holiday-grump', title: 'Green Holiday Grump', category: 'holiday',
    prompt: '{{subject}} reimagined as a grumpy green furry holiday creature, snowy mountain village below, whimsical storybook lighting',
    negative: 'scary, gore' },
  { id: 'scrooge', title: 'Ebenezer Scrooge', category: 'holiday',
    prompt: '{{subject}} as a Victorian Scrooge by candlelight, top hat and overcoat, foggy 1800s London street',
    negative: 'modern clothing, blurry' },
  { id: 'santa-workshop', title: 'Santa’s Workshop', category: 'holiday',
    prompt: '{{subject}} as a jolly Santa in a cozy toy workshop, warm festive lights, elves in the background',
    negative: 'blurry, distorted' },
  { id: 'halloween-monster', title: 'Halloween Monster', category: 'holiday',
    prompt: '{{subject}} in a playful Halloween monster costume, spooky-fun graveyard scene, full moon',
    negative: 'graphic gore, blood' },
  // ── film ──────────────────────────────────────────────────────────────────
  { id: 'space-saga-jedi', title: 'Space Saga: Light Knight', category: 'film',
    prompt: '{{subject}} as a heroic space knight in flowing robes holding a glowing laser sword, sci-fi temple, epic film still',
    negative: 'blurry, extra fingers' },
  { id: 'space-saga-sith', title: 'Space Saga: Dark Lord', category: 'film',
    prompt: '{{subject}} as a menacing dark space lord in black armor with a red laser blade, ominous starship interior, cinematic',
    negative: 'blurry, deformed' },
  { id: 'action-hero', title: 'Action Movie Hero', category: 'film',
    prompt: '{{subject}} as an action-movie lead walking away from an explosion, gritty poster, dramatic backlight',
    negative: 'blurry, cartoon' },
  { id: 'noir-detective', title: 'Film-Noir Detective', category: 'film',
    prompt: '{{subject}} as a 1940s film-noir detective, trench coat and fedora, rainy neon alley, black-and-white cinematic',
    negative: 'color cast, blurry' },
  // ── power ─────────────────────────────────────────────────────────────────
  { id: 'superhero', title: 'Superhero', category: 'power',
    prompt: '{{subject}} as a caped superhero mid-flight over a city skyline, dynamic comic-cinematic lighting, heroic pose',
    negative: 'blurry, extra limbs' },
  { id: 'supervillain', title: 'Supervillain', category: 'power',
    prompt: '{{subject}} as a stylish supervillain with dramatic costume and glowing power effects, moody lair, cinematic',
    negative: 'blurry, deformed' },
  { id: 'astronaut', title: 'Astronaut', category: 'power',
    prompt: '{{subject}} as an astronaut floating in space with Earth behind them, detailed spacesuit, NASA-style photo',
    negative: 'blurry, wrong helmet reflection' },
  // ── era ───────────────────────────────────────────────────────────────────
  { id: 'military-commander', title: 'Military Commander', category: 'era',
    prompt: '{{subject}} as a decorated military commander in formal dress uniform with medals, stately portrait, dramatic lighting',
    negative: 'blurry, incorrect insignia clutter' },
  { id: 'medieval-knight', title: 'Medieval Knight', category: 'era',
    prompt: '{{subject}} as a medieval knight in polished plate armor, castle courtyard, banners, epic portrait',
    negative: 'modern items, blurry' },
  { id: 'viking-warrior', title: 'Viking Warrior', category: 'era',
    prompt: '{{subject}} as a fierce Viking warrior with braided hair and furs, longship and cold shore behind, cinematic',
    negative: 'blurry, plastic look' },
  { id: 'pirate-captain', title: 'Pirate Captain', category: 'era',
    prompt: '{{subject}} as a swashbuckling pirate captain on a ship deck at golden hour, tricorn hat, adventurous portrait',
    negative: 'blurry, deformed' },
  { id: 'royal-monarch', title: 'Royal Monarch', category: 'era',
    prompt: '{{subject}} as a crowned monarch in royal regalia on a throne, gold and velvet, grand palace, oil-painting realism',
    negative: 'blurry, cheap costume' },
  { id: 'cyberpunk', title: 'Cyberpunk', category: 'era',
    prompt: '{{subject}} as a cyberpunk character in a neon-soaked megacity, holographic signage, rain, cinematic sci-fi',
    negative: 'blurry, washed out' },
  // ── lifestyle (dramatized fiction) ──────────────────────────────────────────
  { id: 'mafia-don', title: 'Mafia Don (1920s)', category: 'lifestyle',
    prompt: '{{subject}} as a 1920s mafia don in a pinstripe suit, dim speakeasy, vintage film grain, dramatic portrait',
    negative: 'weapons pointed at viewer, gore, blurry' },
  { id: 'cartel-drama', title: 'Cartel Drama (telenovela)', category: 'lifestyle',
    prompt: '{{subject}} as the lead of a stylized telenovela crime drama, sharp suit, desert villa at dusk, cinematic poster',
    negative: 'drugs, weapons pointed at viewer, gore, blurry' },
  { id: 'rockstar', title: 'Rockstar on Stage', category: 'lifestyle',
    prompt: '{{subject}} as a rockstar performing on a huge stage, spotlights and crowd, energetic concert photo',
    negative: 'blurry, extra hands' },
  { id: 'ceo-magazine', title: 'Magazine Cover CEO', category: 'lifestyle',
    prompt: '{{subject}} on the cover of a business magazine, confident studio portrait, bold cover typography space',
    negative: 'blurry, distorted text' },
  // ── art ───────────────────────────────────────────────────────────────────
  { id: 'anime-hero', title: 'Anime Hero', category: 'art',
    prompt: '{{subject}} redrawn as an anime hero, cel-shaded, expressive eyes, dynamic action background',
    negative: 'photorealistic, blurry' },
  { id: 'animated-3d', title: '3D Animated Character', category: 'art',
    prompt: '{{subject}} as a charming 3D animated movie character, soft studio lighting, modern 3D-animation-studio render style',
    negative: 'creepy, uncanny, blurry' },
  { id: 'renaissance', title: 'Renaissance Oil Painting', category: 'art',
    prompt: '{{subject}} as the subject of a Renaissance oil painting, chiaroscuro lighting, ornate frame, museum quality',
    negative: 'modern items, photo look' },
  { id: 'statue-marble', title: 'Marble Statue', category: 'art',
    prompt: '{{subject}} as a classical white marble statue on a pedestal in a grand museum hall, dramatic lighting',
    negative: 'color skin, blurry' },
];

const EFFECT_BY_ID = new Map(EFFECT_TEMPLATES.map((e) => [e.id, e]));
export function getEffect(id) { return EFFECT_BY_ID.get(String(id || '')) || null; }
export function listEffects(category) {
  if (!category) return EFFECT_TEMPLATES;
  return EFFECT_TEMPLATES.filter((e) => e.category === category);
}

// consent gate: ONLY a real human likeness needs permission.
export function needsConsent(subjectKind) {
  return String(subjectKind || '') === 'real-person';
}

// Normalize a subject request. Returns { subject } or { error }. Never throws.
export function subjectFromInput(input = {}) {
  const kind = String(input.kind || '').trim();
  if (!SUBJECT_KINDS.includes(kind)) return { error: `unknown subject kind: ${kind || '(none)'}` };
  if (kind === 'builtin') {
    const c = getCharacter(input.name || input.id);
    if (!c) return { error: `unknown built-in character: ${String(input.name || input.id || '')}` };
    return { subject: { kind, name: c.name, ref: c.refDir, character: c.id, cleared: true } };
  }
  const name = String(input.name || '').trim() || (kind === 'fictional' ? 'the character' : 'the subject');
  return {
    subject: {
      kind,
      name,
      ref: input.ref ? String(input.ref) : null,       // uploaded image / platform-character ref
      consent: input.consent ? String(input.consent) : null, // a bio-consent record id, if any
    },
  };
}

const PLACEHOLDER_RE = /\{\{\s*subject\s*\}\}/g;
function subjectPhrase(subject) {
  return subject && subject.name ? String(subject.name) : 'the subject';
}

// buildEffectJob — pure. Produces the generation job spec for the providers/ComfyUI layer.
// Enforces the consent gate: a real-person subject without a consent record is refused.
export function buildEffectJob(effectId, subjectInput = {}, opts = {}) {
  const e = getEffect(effectId);
  if (!e) return { ok: false, error: `unknown effect: ${String(effectId || '')}` };

  const s = subjectFromInput(subjectInput);
  if (s.error) return { ok: false, error: s.error };
  const subject = s.subject;

  if (needsConsent(subject.kind) && !subject.consent && !subject.cleared) {
    return {
      ok: false,
      needsConsent: true,
      error: 'A real person’s likeness needs a consent record before it can be used. Create a character on the platform, use a fictional subject, or attach consent.',
    };
  }

  const prompt = e.prompt.replace(PLACEHOLDER_RE, subjectPhrase(subject));
  // character-referenced when we have a reference (builtin/platform/uploaded); else plain text-to-image
  const technique = subject.ref ? 'character-ref' : (subject.character ? 'lora' : 'text-to-image');

  const job = {
    kind: 'genai-effect',
    version: 1,
    effect: e.id,
    title: e.title,
    category: e.category,
    prompt,
    negative: e.negative || '',
    subject: { kind: subject.kind, name: subject.name, character: subject.character || null, hasRef: !!subject.ref },
    technique,
    consent: { required: needsConsent(subject.kind), record: subject.consent || null, cleared: !!subject.cleared },
    size: opts.size || '1024x1024',
    note: 'Character-consistent transform: same subject, brand-new image (not the original photo).',
  };
  return { ok: true, job };
}

export function validateEffects() {
  const errors = [];
  const seen = new Set();
  for (const e of EFFECT_TEMPLATES) {
    if (!e.id) { errors.push('effect with no id'); continue; }
    if (seen.has(e.id)) errors.push(`duplicate effect id: ${e.id}`);
    seen.add(e.id);
    if (!e.title) errors.push(`${e.id}: no title`);
    if (!EFFECT_CATEGORIES.includes(e.category)) errors.push(`${e.id}: bad category ${e.category}`);
    if (!e.prompt || !PLACEHOLDER_RE.test(e.prompt)) errors.push(`${e.id}: prompt missing {{subject}}`);
    PLACEHOLDER_RE.lastIndex = 0;
    // must build a serializable job for a fictional subject (no consent needed)
    const built = buildEffectJob(e.id, { kind: 'fictional', name: 'Test Hero' });
    if (!built.ok) errors.push(`${e.id}: buildEffectJob failed (${built.error})`);
    else { try { JSON.parse(JSON.stringify(built.job)); } catch { errors.push(`${e.id}: job does not serialize`); } }
  }
  if (!CHARACTERS.length) errors.push('no built-in characters');
  return { ok: errors.length === 0, errors, effects: EFFECT_TEMPLATES.length, characters: CHARACTERS.length };
}

if (process.argv[1] && process.argv[1].endsWith('genai-effect-templates.mjs')) {
  const v = validateEffects();
  console.log(`${v.effects} effects · ${v.characters} built-in character(s) · ${v.ok ? '✓ valid' : '✗ ' + v.errors.join('; ')}`);
  // demo the consent gate
  const real = buildEffectJob('gorilla', { kind: 'real-person', name: 'Ryan' });
  console.log('real-person, no consent →', real.ok ? 'ALLOWED (bug!)' : 'blocked ✓ (needsConsent=' + !!real.needsConsent + ')');
  const hathor = buildEffectJob('space-saga-jedi', { kind: 'builtin', name: 'hathor' });
  console.log('Hathor builtin →', hathor.ok ? `ok ✓ (${hathor.job.technique})` : 'FAILED');
}
