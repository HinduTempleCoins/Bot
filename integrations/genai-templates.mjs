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

export const CATEGORIES = ['poster', 'avatar', 'scene', 'card', 'meme', 'print', 'environment'];

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
  // ── "Become X" portrait/character templates — designed to be used WITH an uploaded photo. Framed as a
  // close-up, face-centered portrait so the uploader's likeness is showcased (the wide scene templates
  // above drop them in small). Paired with the generate path's "keep their face" steering, these put
  // THE PERSON into the costume/scene. Category avatar. ──────────────────────────────────────────────
  {
    id: 'egyptian-royalty-portrait',
    title: 'Become Egyptian Royalty',
    category: 'avatar',
    promptPattern: 'A close-up cinematic portrait as ancient Egyptian royalty, wearing an ornate golden headdress, {{jewelry}}, and a wesekh broad collar, {{setting}} behind, warm golden light, painterly, the face fully visible and centered, highly detailed',
    slots: [
      { key: 'jewelry', label: 'Jewelry / accents', placeholder: 'e.g. lapis and gold', example: 'lapis and gold' },
      { key: 'setting', label: 'Background', placeholder: 'e.g. a sunlit temple hall', example: 'a sunlit temple hall' },
    ],
    defaultSize: '768x1024',
  },
  {
    id: 'angel-portrait',
    title: 'Become an Angel',
    category: 'avatar',
    promptPattern: 'A close-up portrait as a radiant angel, {{wings}} feathered wings, a glowing halo, {{palette}} palette, soft divine light, ethereal, the face fully visible and centered, fine art',
    slots: [
      { key: 'wings', label: 'Wings', placeholder: 'e.g. large pink and blue', example: 'large pink and blue' },
      { key: 'palette', label: 'Palette', placeholder: 'e.g. gold and white', example: 'gold and white' },
    ],
    defaultSize: '768x1024',
  },
  {
    id: 'game-hero-portrait',
    title: 'Become a Video-Game Hero',
    category: 'avatar',
    promptPattern: 'A character-select close-up portrait of a video-game hero, wearing {{armor}}, {{setting}} behind, {{style}} game art, dramatic rim light, the face fully visible and centered, high detail',
    slots: [
      { key: 'armor', label: 'Armor / outfit', placeholder: 'e.g. ornate fantasy plate armor', example: 'ornate fantasy plate armor' },
      { key: 'setting', label: 'Setting', placeholder: 'e.g. a ruined castle', example: 'a ruined castle' },
      { key: 'style', label: 'Art style', placeholder: 'e.g. stylized 3D RPG', example: 'stylized 3D RPG' },
    ],
    defaultSize: '768x1024',
  },
  {
    id: 'vaporwave-deity-portrait',
    title: 'Vaporwave Deity Portrait',
    category: 'avatar',
    promptPattern: 'A close-up vaporwave portrait as a neon deity, {{crown}}, glowing {{palette}} neon light, a retro synthwave grid behind, chrome accents, the face fully visible and centered, highly detailed',
    slots: [
      { key: 'crown', label: 'Crown / headpiece', placeholder: 'e.g. golden horned headdress', example: 'golden horned headdress' },
      { key: 'palette', label: 'Neon palette', placeholder: 'e.g. pink and cyan', example: 'pink and cyan' },
    ],
    defaultSize: '768x1024',
  },
  {
    id: 'warrior-portrait',
    title: 'Become a Warrior',
    category: 'avatar',
    promptPattern: 'A heroic close-up portrait as a {{kind}} warrior, wearing {{armor}}, {{setting}} background, cinematic dramatic light, the face fully visible and centered, highly detailed',
    slots: [
      { key: 'kind', label: 'Warrior type', placeholder: 'e.g. Nubian', example: 'Nubian' },
      { key: 'armor', label: 'Armor', placeholder: 'e.g. gold and leather', example: 'gold and leather' },
      { key: 'setting', label: 'Background', placeholder: 'e.g. desert at dawn', example: 'desert at dawn' },
    ],
    defaultSize: '768x1024',
  },
  // ── T-SHIRT / PRINT vector designs. Bold, flat, limited-palette, print-ready — pair with /vectorize
  // (raster→SVG) for screen printing. Great with CC0/Commons public-domain art & portraits (mint-safe,
  // bucket A in genai-asset-library.mjs). Category print. ──────────────────────────────────────────────
  {
    id: 'tshirt-graphic',
    title: 'T-Shirt Graphic',
    category: 'print',
    promptPattern: 'A bold t-shirt graphic of {{subject}}, {{style}} style, flat limited-color vector, clean thick outlines, high contrast, centered on a plain background, screen-print ready, no text',
    slots: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. a roaring lion', example: 'a roaring lion' },
      { key: 'style', label: 'Style', placeholder: 'e.g. bold retro', example: 'bold retro' },
    ],
    defaultSize: '1024x1024',
  },
  {
    id: 'public-domain-portrait-tee',
    title: 'Public-Domain Portrait Tee',
    category: 'print',
    promptPattern: 'A t-shirt design of {{figure}} as a bold {{style}} vector portrait, flat colors with halftone accents, thick outlines, high contrast, plain background, screen-print ready. Based on a public-domain / Commons artwork',
    slots: [
      { key: 'figure', label: 'Public-domain figure/artwork', placeholder: 'e.g. an ancient Egyptian queen', example: 'an ancient Egyptian queen' },
      { key: 'style', label: 'Style', placeholder: 'e.g. pop-art', example: 'pop-art' },
    ],
    defaultSize: '1024x1024',
  },
  {
    id: 'emblem-crest',
    title: 'Emblem / Crest',
    category: 'print',
    promptPattern: 'A symmetrical badge emblem of {{motif}}, {{palette}} flat vector, bold outlines, crest/seal layout, print-ready, clean plain background',
    slots: [
      { key: 'motif', label: 'Motif', placeholder: 'e.g. an ankh flanked by wings', example: 'an ankh flanked by wings' },
      { key: 'palette', label: 'Palette', placeholder: 'e.g. gold and black', example: 'gold and black' },
    ],
    defaultSize: '1024x1024',
  },
  {
    id: 'streetwear-graphic',
    title: 'Streetwear Graphic',
    category: 'print',
    promptPattern: 'A streetwear t-shirt graphic: {{subject}}, {{style}} aesthetic, bold flat vector, limited palette, heavy outlines, high contrast, print-ready, plain background',
    slots: [
      { key: 'subject', label: 'Subject', placeholder: 'e.g. a vaporwave Egyptian goddess', example: 'a vaporwave Egyptian goddess' },
      { key: 'style', label: 'Aesthetic', placeholder: 'e.g. vaporwave', example: 'vaporwave' },
    ],
    defaultSize: '1024x1024',
  },
  // ── ENVIRONMENT / scenic templates. Put yourself or Hathor INTO a place — landmarks, concerts, nature,
  // cityscapes, game worlds. Photo-forward (upload → you're in the scene) AND great as pure backdrops for
  // game art (Botanica). Fed by the scene/landmark libraries: Poly Haven HDRIs, Wikimedia/Openverse
  // landmarks, NASA scenes, museum CC0. Category environment. ─────────────────────────────────────────
  {
    id: 'famous-landmark',
    title: 'At a Famous Landmark',
    category: 'environment',
    promptPattern: 'A cinematic travel photo at {{landmark}}, {{time}}, epic wide composition, dramatic light, highly detailed, photoreal',
    slots: [
      { key: 'landmark', label: 'Landmark', placeholder: 'e.g. the Great Pyramids of Giza', example: 'the Great Pyramids of Giza' },
      { key: 'time', label: 'Time / weather', placeholder: 'e.g. golden hour', example: 'golden hour' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'concert-stage',
    title: 'On the Concert Stage',
    category: 'environment',
    promptPattern: 'On stage at a huge {{genre}} concert, roaring crowd, {{lights}} stage lights, haze, lens flare, epic live-show energy, cinematic',
    slots: [
      { key: 'genre', label: 'Show type', placeholder: 'e.g. electronic music', example: 'electronic music' },
      { key: 'lights', label: 'Lighting', placeholder: 'e.g. neon pink and blue', example: 'neon pink and blue' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'festival-scene',
    title: 'At a Festival',
    category: 'environment',
    promptPattern: 'At a vibrant {{festival}} festival, {{setting}}, crowds, banners and lights, joyful atmosphere, golden light, cinematic wide shot',
    slots: [
      { key: 'festival', label: 'Festival', placeholder: 'e.g. desert arts', example: 'desert arts' },
      { key: 'setting', label: 'Setting', placeholder: 'e.g. at dusk in the dunes', example: 'at dusk in the dunes' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'scenic-nature',
    title: 'Scenic Nature',
    category: 'environment',
    promptPattern: 'A breathtaking {{place}} landscape, {{time}}, epic natural scenery, volumetric light, ultra detailed, photoreal, wide cinematic composition',
    slots: [
      { key: 'place', label: 'Place', placeholder: 'e.g. a tropical waterfall', example: 'a tropical waterfall' },
      { key: 'time', label: 'Time / mood', placeholder: 'e.g. misty dawn', example: 'misty dawn' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'cityscape-rooftop',
    title: 'City Rooftop / Skyline',
    category: 'environment',
    promptPattern: 'A {{city}} skyline from a rooftop at {{time}}, glowing city lights, dramatic sky, cinematic, ultra detailed',
    slots: [
      { key: 'city', label: 'City vibe', placeholder: 'e.g. neon megacity', example: 'neon megacity' },
      { key: 'time', label: 'Time', placeholder: 'e.g. night', example: 'night' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'fantasy-realm',
    title: 'Fantasy / Game World',
    category: 'environment',
    promptPattern: 'A {{realm}} fantasy game environment, {{style}} game art, atmospheric, depth and scale, concept-art quality, detailed background suitable for a game scene',
    slots: [
      { key: 'realm', label: 'Realm', placeholder: 'e.g. a lush overgrown temple jungle', example: 'a lush overgrown temple jungle' },
      { key: 'style', label: 'Art style', placeholder: 'e.g. stylized painterly', example: 'stylized painterly' },
    ],
    defaultSize: '1024x768',
  },
  {
    id: 'sacred-temple-scene',
    title: 'Sacred Temple Scene',
    category: 'environment',
    promptPattern: 'Inside a {{temple}} sacred temple, {{light}}, monumental columns, incense haze, reverent atmosphere, cinematic, highly detailed',
    slots: [
      { key: 'temple', label: 'Temple', placeholder: 'e.g. ancient Egyptian', example: 'ancient Egyptian' },
      { key: 'light', label: 'Light', placeholder: 'e.g. golden shafts of sun', example: 'golden shafts of sun' },
    ],
    defaultSize: '1024x768',
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
