// genai-templates.mjs — the CapCut seed: a registry of prompt templates for the GenAI page.
//
// THE IDEA (operator's spec): grow toward CapCut-style templates — pick a template, fill a few labelled
// slots, get a ready-to-generate prompt. This module is PURE DATA + one pure function. No network, no
// keys, no side effects — fully testable offline.
//
//   fillTemplate(id, slots) -> final prompt string (slots that are missing fall back to the slot's
//                              `example`, so a half-filled form still produces something good).
//
// Each template:
//   { id, title, category, promptPattern (with {{slot}} placeholders), slots:[{key,label,placeholder,example}],
//     defaultSize, example (the fully-filled example prompt) }
//
// Categories: poster | avatar | scene | card | meme

export const CATEGORIES = ['poster', 'avatar', 'scene', 'card', 'meme'];

export const TEMPLATES = [
  {
    id: 'egyptian-temple-poster',
    title: 'Egyptian Temple Poster',
    category: 'poster',
    promptPattern: 'A majestic ancient Egyptian temple of {{deity}} at {{time}}, {{style}}, monumental columns with hieroglyphs, golden light, highly detailed, poster composition',
    slots: [
      { key: 'deity', label: 'Deity / theme', placeholder: 'e.g. Hathor', example: 'Hathor' },
      { key: 'time', label: 'Time of day', placeholder: 'e.g. golden sunset', example: 'golden sunset' },
      { key: 'style', label: 'Art style', placeholder: 'e.g. cinematic matte painting', example: 'cinematic matte painting' },
    ],
    defaultSize: '768x1024',
  },
  {
    id: 'angelic-portrait',
    title: 'Angelic Figure Portrait',
    category: 'avatar',
    promptPattern: 'Portrait of an angelic figure, {{descriptor}}, {{wings}}, radiant halo, {{palette}} color palette, soft divine lighting, ethereal, fine art',
    slots: [
      { key: 'descriptor', label: 'Figure', placeholder: 'e.g. serene winged guardian', example: 'serene winged guardian' },
      { key: 'wings', label: 'Wings', placeholder: 'e.g. vast feathered wings', example: 'vast feathered wings' },
      { key: 'palette', label: 'Palette', placeholder: 'e.g. gold and white', example: 'gold and white' },
    ],
    defaultSize: '768x768',
  },
  {
    id: 'coin-token-logo',
    title: 'Coin / Token Logo',
    category: 'card',
    promptPattern: 'A clean circular cryptocurrency coin logo for "{{name}}", {{symbol}} motif, {{metal}} metallic finish, minimal vector style, centered, plain background, crisp edges',
    slots: [
      { key: 'name', label: 'Coin name', placeholder: 'e.g. MELEK', example: 'MELEK' },
      { key: 'symbol', label: 'Central symbol', placeholder: 'e.g. ankh', example: 'ankh' },
      { key: 'metal', label: 'Finish', placeholder: 'e.g. gold', example: 'gold' },
    ],
    defaultSize: '1024x1024',
  },
  {
    id: 'vaporwave-landscape',
    title: 'Vaporwave Landscape',
    category: 'scene',
    promptPattern: 'A {{subject}} in vaporwave aesthetic, {{palette}} gradient sky, neon grid, retro 80s synthwave, chrome accents, dreamy haze, highly detailed',
    slots: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. desert highway', example: 'desert highway' },
      { key: 'palette', label: 'Palette', placeholder: 'e.g. pink and teal', example: 'pink and teal' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'ancient-manuscript-page',
    title: 'Ancient Manuscript Page',
    category: 'card',
    promptPattern: 'An aged {{material}} manuscript page about {{topic}}, ornate {{script}} script, gold-leaf illuminated initial, weathered edges, museum photograph, top-down',
    slots: [
      { key: 'material', label: 'Material', placeholder: 'e.g. papyrus', example: 'papyrus' },
      { key: 'topic', label: 'Topic', placeholder: 'e.g. the stars', example: 'the stars' },
      { key: 'script', label: 'Script', placeholder: 'e.g. hieratic', example: 'hieratic' },
    ],
    defaultSize: '768x1024',
  },
  {
    id: 'witness-school-diagram',
    title: 'Witness-School Diagram',
    category: 'card',
    promptPattern: 'A clean educational infographic diagram explaining "{{concept}}", {{style}}, labelled nodes and arrows, flat design, {{palette}} on dark background, technical clarity',
    slots: [
      { key: 'concept', label: 'Concept', placeholder: 'e.g. how block production works', example: 'how block production works' },
      { key: 'style', label: 'Style', placeholder: 'e.g. isometric', example: 'isometric' },
      { key: 'palette', label: 'Accent palette', placeholder: 'e.g. blue and gold', example: 'blue and gold' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'garden-herb-illustration',
    title: 'Garden / Herb Illustration',
    category: 'card',
    promptPattern: 'A botanical illustration of {{plant}}, {{style}}, detailed leaves and {{feature}}, labelled herbarium plate, soft watercolor, cream background',
    slots: [
      { key: 'plant', label: 'Plant', placeholder: 'e.g. holy basil (tulsi)', example: 'holy basil (tulsi)' },
      { key: 'style', label: 'Style', placeholder: 'e.g. vintage scientific', example: 'vintage scientific' },
      { key: 'feature', label: 'Feature to show', placeholder: 'e.g. flowering tops', example: 'flowering tops' },
    ],
    defaultSize: '768x1024',
  },
  {
    id: 'space-scene',
    title: 'Space Scene',
    category: 'scene',
    promptPattern: 'A breathtaking deep-space scene with {{subject}}, {{phenomenon}}, distant stars, {{palette}} nebula, ultra-detailed, astrophotography style, vast scale',
    slots: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. a ringed planet', example: 'a ringed planet' },
      { key: 'phenomenon', label: 'Phenomenon', placeholder: 'e.g. a passing comet', example: 'a passing comet' },
      { key: 'palette', label: 'Nebula palette', placeholder: 'e.g. violet and gold', example: 'violet and gold' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'meme-card',
    title: 'Meme Card',
    category: 'meme',
    promptPattern: 'A funny meme image: {{subject}} {{action}}, {{style}}, bold expressive, exaggerated, internet meme energy, clean composition with space for a caption',
    slots: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. a wise old cat', example: 'a wise old cat' },
      { key: 'action', label: 'Doing what', placeholder: 'e.g. staring at a candle', example: 'staring at a candle' },
      { key: 'style', label: 'Style', placeholder: 'e.g. cartoon', example: 'cartoon' },
    ],
    defaultSize: '1024x1024',
  },
  {
    id: 'profile-avatar',
    title: 'Profile Avatar',
    category: 'avatar',
    promptPattern: 'A stylized profile avatar of {{subject}}, {{style}}, {{palette}} palette, centered headshot, clean simple background, expressive, social-media ready',
    slots: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. a robed sage', example: 'a robed sage' },
      { key: 'style', label: 'Style', placeholder: 'e.g. flat illustration', example: 'flat illustration' },
      { key: 'palette', label: 'Palette', placeholder: 'e.g. warm earth tones', example: 'warm earth tones' },
    ],
    defaultSize: '768x768',
  },
  {
    id: 'banner',
    title: 'Wide Banner',
    category: 'poster',
    promptPattern: 'A wide horizontal banner for "{{title}}", {{theme}} theme, {{palette}} palette, balanced composition with open space for overlay text, cinematic, high resolution',
    slots: [
      { key: 'title', label: 'Banner title', placeholder: 'e.g. Witness School', example: 'Witness School' },
      { key: 'theme', label: 'Theme', placeholder: 'e.g. ancient-meets-digital', example: 'ancient-meets-digital' },
      { key: 'palette', label: 'Palette', placeholder: 'e.g. midnight blue and gold', example: 'midnight blue and gold' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'festival-flyer',
    title: 'Festival Flyer',
    category: 'poster',
    promptPattern: 'A vibrant festival flyer for "{{event}}", {{mood}} mood, {{palette}} palette, decorative motifs, dynamic layout with room for date and details, poster art',
    slots: [
      { key: 'event', label: 'Event name', placeholder: 'e.g. Harvest Light Festival', example: 'Harvest Light Festival' },
      { key: 'mood', label: 'Mood', placeholder: 'e.g. joyful celebratory', example: 'joyful celebratory' },
      { key: 'palette', label: 'Palette', placeholder: 'e.g. saffron and magenta', example: 'saffron and magenta' },
    ],
    defaultSize: '768x1024',
  },
];

// fast lookup
const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
export function getTemplate(id) { return BY_ID.get(String(id || '')) || null; }
export function templatesByCategory(cat) { return TEMPLATES.filter((t) => t.category === cat); }

// fillTemplate — pure. Replaces every {{slot}} with the provided value (trimmed) or the slot's example.
// Unknown templates → ''. Extra/unknown slot keys are ignored. Output is the final prompt string.
export function fillTemplate(id, slots = {}) {
  const t = getTemplate(id);
  if (!t) return '';
  const vals = {};
  for (const s of t.slots) {
    const raw = slots && slots[s.key] != null ? String(slots[s.key]).trim() : '';
    vals[s.key] = raw || s.example || '';
  }
  return t.promptPattern.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) =>
    (vals[k] != null ? vals[k] : '')).replace(/\s+/g, ' ').trim();
}

// the fully-filled example prompt for a template (used in previews / the picker)
export function exampleFor(id) { return fillTemplate(id, {}); }

// integrity check (for /health + a test): every template well-formed, every {{slot}} declared.
export function validateTemplates() {
  const errors = [];
  const seen = new Set();
  for (const t of TEMPLATES) {
    if (!t.id) errors.push('template with no id');
    if (seen.has(t.id)) errors.push(`duplicate id: ${t.id}`);
    seen.add(t.id);
    if (!t.title) errors.push(`${t.id}: no title`);
    if (!CATEGORIES.includes(t.category)) errors.push(`${t.id}: bad category ${t.category}`);
    if (!t.promptPattern) errors.push(`${t.id}: no promptPattern`);
    if (!Array.isArray(t.slots)) errors.push(`${t.id}: no slots array`);
    if (!t.defaultSize) errors.push(`${t.id}: no defaultSize`);
    const declared = new Set((t.slots || []).map((s) => s.key));
    const used = new Set();
    let m;
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    while ((m = re.exec(t.promptPattern || ''))) used.add(m[1]);
    for (const u of used) if (!declared.has(u)) errors.push(`${t.id}: pattern uses undeclared slot {{${u}}}`);
    for (const s of (t.slots || [])) {
      if (!s.key) errors.push(`${t.id}: slot with no key`);
      if (!s.label) errors.push(`${t.id}: slot ${s.key} has no label`);
      if (!used.has(s.key)) errors.push(`${t.id}: declared slot ${s.key} never used in pattern`);
    }
  }
  return { ok: errors.length === 0, errors, count: TEMPLATES.length };
}

if (process.argv[1] && process.argv[1].endsWith('genai-templates.mjs')) {
  const v = validateTemplates();
  console.log(`${TEMPLATES.length} templates · ${v.ok ? '✓ valid' : '✗ ' + v.errors.join('; ')}`);
  for (const t of TEMPLATES) console.log(`  [${t.category}] ${t.id} → ${exampleFor(t.id)}`);
}
