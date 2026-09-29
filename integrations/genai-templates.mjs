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
  // ── Egyptian royalty & military by era (sourced: knowledge/history/egyptian-royalty-military.md) ──
  {"id": "pharaoh-portrait-by-era", "title": "Pharaoh Portrait by Era", "category": "avatar", "promptPattern": "Historically grounded portrait of the ancient Egyptian king {{ruler}} of the {{era}}, wearing the {{crown}} with a gold rearing cobra uraeus at the brow, plaited ceremonial false beard, {{regalia}}, broad collar of faience and gold beads, pleated linen shendyt kilt, face styled after surviving statues of this ruler, painted limestone temple relief background, museum lighting, fine detail", "slots": [{"key": "ruler", "label": "Ruler", "placeholder": "e.g. Senusret III", "example": "Senusret III"}, {"key": "era", "label": "Era", "placeholder": "e.g. Middle Kingdom, 12th Dynasty", "example": "Middle Kingdom, 12th Dynasty"}, {"key": "crown", "label": "Crown", "placeholder": "e.g. striped nemes headcloth", "example": "striped nemes headcloth"}, {"key": "regalia", "label": "Regalia in hand", "placeholder": "e.g. crook and flail crossed on the chest", "example": "crook and flail crossed on the chest"}], "defaultSize": "768x1024"},
  {"id": "kushite-king-25th-dynasty", "title": "Kushite King of the 25th Dynasty", "category": "avatar", "promptPattern": "Portrait of {{king}}, Kushite pharaoh of the 25th Dynasty, wearing a close-fitting cap crown with two rearing cobras side by side at the brow, a diadem of tiny uraei and ribbon streamers at the back, a gold ram's-head amulet on a thick cord whose ends fall over the shoulders, pleated kilt, {{pose}}, {{setting}}, broad-shouldered narrow-waisted proportions of Kushite royal sculpture, dignified, fine detail", "slots": [{"key": "king", "label": "King", "placeholder": "e.g. Taharqa", "example": "Taharqa"}, {"key": "pose", "label": "Pose", "placeholder": "e.g. striding with a mekes staff", "example": "striding with a mekes staff"}, {"key": "setting", "label": "Setting", "placeholder": "e.g. sandstone temple of Amun at Jebel Barkal", "example": "sandstone temple of Amun at Jebel Barkal"}], "defaultSize": "768x1024"},
  {"id": "hyksos-ruler-at-avaris", "title": "Hyksos Ruler at Avaris", "category": "scene", "promptPattern": "The Hyksos king {{ruler}}, heqa-khasut 'ruler of foreign lands', in the palace at Avaris in the eastern Nile Delta, presented in full Egyptian royal style beside a reinscribed Middle Kingdom sphinx, courtiers with the mushroom-shaped Asiatic coiffure and beards, {{detail}}, Middle Bronze Age Levantine and Egyptian material culture mixed, {{light}}", "slots": [{"key": "ruler", "label": "Ruler", "placeholder": "e.g. Khyan", "example": "Khyan"}, {"key": "detail", "label": "Detail", "placeholder": "e.g. scribes recording tribute, a Canaanite amphora", "example": "scribes recording tribute, a Canaanite amphora"}, {"key": "light", "label": "Lighting", "placeholder": "e.g. late afternoon Delta light", "example": "late afternoon Delta light"}], "defaultSize": "1024x768"},
  {"id": "chariot-charge-division", "title": "Chariot Charge of a Division", "category": "scene", "promptPattern": "New Kingdom Egyptian chariot charge of the division of {{division}} at {{battle}}, light two-wheeled chariots with six-spoked wheels and rear-set axles, each drawn by a yoked pair of horses and crewed by a driver holding a shield and an archer drawing a composite bow, {{pharaoh}} in the blue khepresh crown leading, dust, infantry with cowhide shields behind, {{style}}", "slots": [{"key": "division", "label": "Division (god)", "placeholder": "e.g. Amun", "example": "Amun"}, {"key": "battle", "label": "Battle", "placeholder": "e.g. Kadesh, 1274 BC", "example": "Kadesh, 1274 BC"}, {"key": "pharaoh", "label": "Pharaoh", "placeholder": "e.g. Ramesses II", "example": "Ramesses II"}, {"key": "style", "label": "Style", "placeholder": "e.g. cinematic, painted-relief colour palette", "example": "cinematic, painted-relief colour palette"}], "defaultSize": "1024x768"},
  {"id": "nubian-archers", "title": "Nubian Archers", "category": "scene", "promptPattern": "A company of Nubian archers of {{era}}, darker-skinned men in red loincloths carrying bows and arrows, marching in ranks as in the Asyut soldier models of Mesehti, {{unit}}, {{setting}}, historically grounded, detailed", "slots": [{"key": "era", "label": "Era", "placeholder": "e.g. the Middle Kingdom", "example": "the Middle Kingdom"}, {"key": "unit", "label": "Unit", "placeholder": "e.g. Medjay scouts leading the column", "example": "Medjay scouts leading the column"}, {"key": "setting", "label": "Setting", "placeholder": "e.g. desert road near the Second Cataract", "example": "desert road near the Second Cataract"}], "defaultSize": "1024x768"},
  {"id": "fortress-of-buhen", "title": "Fortress of Buhen", "category": "environment", "promptPattern": "The Middle Kingdom fortress of Buhen on the west bank of the Nile below the Second Cataract, walls about 10 m high and 5 m thick of stone and mud-brick, projecting bastions with loopholes, a 3 m deep moat and drawbridge, garrison on the ramparts, {{time}}, {{viewpoint}}", "slots": [{"key": "time", "label": "Time", "placeholder": "e.g. dawn over the Nile", "example": "dawn over the Nile"}, {"key": "viewpoint", "label": "Viewpoint", "placeholder": "e.g. aerial view from the river", "example": "aerial view from the river"}], "defaultSize": "1024x768"},
  {"id": "battle-of-the-delta", "title": "Battle of the Delta", "category": "scene", "promptPattern": "Ramesses III's naval ambush of the Sea Peoples in the Nile mouth, 1179-1175 BC: fast Egyptian warships with a single mast and square sail, about fifty rowers and two steering oars, archers shooting from the decks and from the shore, larger slower enemy ships overturning, Peleset warriors in plumed headdresses and Sherden in horned helmets with round shields, {{moment}}, {{viewpoint}}", "slots": [{"key": "moment", "label": "Moment", "placeholder": "e.g. grappling and boarding", "example": "grappling and boarding"}, {"key": "viewpoint", "label": "Viewpoint", "placeholder": "e.g. from an Egyptian deck", "example": "from an Egyptian deck"}], "defaultSize": "1024x768"},
  {"id": "queen-vulture-crown", "title": "Queen in the Vulture Crown", "category": "avatar", "promptPattern": "Portrait of {{queen}}, Great Royal Wife of Egypt, wearing the vulture crown of Nekhbet with the vulture's wings hanging down both sides of her head, {{addition}}, broad bead collar, fine pleated linen gown, {{setting}}, graceful, painted-tomb colours", "slots": [{"key": "queen", "label": "Queen", "placeholder": "e.g. Nefertari", "example": "Nefertari"}, {"key": "addition", "label": "Crown addition", "placeholder": "e.g. a modius ringed with uraei and tall double plumes", "example": "a modius ringed with uraei and tall double plumes"}, {"key": "setting", "label": "Setting", "placeholder": "e.g. her painted tomb in the Valley of the Queens", "example": "her painted tomb in the Valley of the Queens"}], "defaultSize": "768x1024"},
  {"id": "war-god-portrait", "title": "War God Portrait", "category": "avatar", "promptPattern": "Portrait of the Egyptian war deity {{god}}, {{form}}, holding {{attribute}}, temple-relief composition with hieroglyphic border, {{palette}}", "slots": [{"key": "god", "label": "God", "placeholder": "e.g. Onuris", "example": "Onuris"}, {"key": "form", "label": "Form", "placeholder": "e.g. bearded man in a robe with a four-feather headdress", "example": "bearded man in a robe with a four-feather headdress"}, {"key": "attribute", "label": "Attribute", "placeholder": "e.g. a spear", "example": "a spear"}, {"key": "palette", "label": "Palette", "placeholder": "e.g. ochre, lapis blue and gold", "example": "ochre, lapis blue and gold"}], "defaultSize": "768x1024"},
  {"id": "piye-victory-campaign", "title": "Piye's Victory", "category": "scene", "promptPattern": "The Kushite king Piye receiving the submission of the Delta rulers after his campaign north, as on his granite victory stela from Jebel Barkal: {{scene}}, Piye in the Kushite cap crown with double uraeus, Kushite archers and horses, {{setting}}, historically grounded", "slots": [{"key": "scene", "label": "Scene", "placeholder": "e.g. kneeling Delta rulers presenting tribute", "example": "kneeling Delta rulers presenting tribute"}, {"key": "setting", "label": "Setting", "placeholder": "e.g. before the walls of Memphis", "example": "before the walls of Memphis"}], "defaultSize": "1024x768"},
  {"id": "aamu-procession-arrival", "title": "Aamu Procession Arrives", "category": "scene", "promptPattern": "The Aamu of Shu arriving before the Egyptian official Khnumhotep II at Beni Hasan, 12th Dynasty: their leader Abisha with the title ruler of a foreign land, bearded Asiatic men with mushroom-shaped coiffures in multicoloured patterned garments, women and children, sandals and leather shoes while the Egyptians go barefoot, bows, quivers, spears and a duckbill axe carried openly, a man playing a lyre, donkeys carrying bellows, {{gift}}, {{style}}", "slots": [{"key": "gift", "label": "Gifts", "placeholder": "e.g. galena eye-paint, an ibex and a dorcas gazelle", "example": "galena eye-paint, an ibex and a dorcas gazelle"}, {"key": "style", "label": "Style", "placeholder": "e.g. as a painted tomb register, flat Middle Kingdom colours", "example": "as a painted tomb register, flat Middle Kingdom colours"}], "defaultSize": "1024x768"},
  {"id": "four-peoples-book-of-gates", "title": "The Four Peoples", "category": "print", "promptPattern": "The Four Peoples scene from the Fifth Hour of the Book of Gates in the tomb of Seti I: Horus leading four groups of men — Egyptians; bearded Asiatics with cloth headbands whose ends hang down; beardless dark-skinned Nubians with a thick red sash across the chest; Libyans with side locks in open gowns exposing the shoulders, with feathers and tattoos — {{rendering}}, {{background}}", "slots": [{"key": "rendering", "label": "Rendering", "placeholder": "e.g. as a painted tomb relief", "example": "as a painted tomb relief"}, {"key": "background", "label": "Background", "placeholder": "e.g. cream plaster with a blue hieroglyph band", "example": "cream plaster with a blue hieroglyph band"}], "defaultSize": "1024x768"},
  {"id": "medinet-habu-captives-before-amun", "title": "Captives Before Amun-Re", "category": "scene", "promptPattern": "Ramesses III presenting bound captives of {{captives}} to Amun, Mut and Khonsu, as carved at his mortuary temple of Medinet Habu, rows of prisoners, the king in {{crown}}, {{rendering}}", "slots": [{"key": "captives", "label": "Captives", "placeholder": "e.g. the Sea Peoples, Peleset in plumed headdresses", "example": "the Sea Peoples, Peleset in plumed headdresses"}, {"key": "crown", "label": "Crown", "placeholder": "e.g. the blue khepresh crown", "example": "the blue khepresh crown"}, {"key": "rendering", "label": "Rendering", "placeholder": "e.g. painted sunk relief on sandstone", "example": "painted sunk relief on sandstone"}], "defaultSize": "1024x768"},
  {"id": "shardana-bodyguard", "title": "Shardana Bodyguard", "category": "avatar", "promptPattern": "A Shardana (Sherden) warrior of Ramesses II's royal bodyguard, horned helmet with a disc ornament at the crest, round shield, long bronze sword, kilt and corslet, {{pose}}, {{setting}}, historically grounded", "slots": [{"key": "pose", "label": "Pose", "placeholder": "e.g. standing guard beside the royal chariot", "example": "standing guard beside the royal chariot"}, {"key": "setting", "label": "Setting", "placeholder": "e.g. the palace at Pi-Ramesses", "example": "the palace at Pi-Ramesses"}], "defaultSize": "768x1024"},
  {"id": "fayum-encaustic-portrait", "title": "Fayum Encaustic Portrait", "category": "avatar", "promptPattern": "A Roman-period Egyptian mummy portrait in encaustic wax on a wooden panel, frontal head and upper chest, broad visible brush strokes, of a {{age}} {{people}}, wearing {{jewellery}}, {{dress}}, plain dark background, as found at Hawara in the Faiyum", "slots": [{"key": "age", "label": "Age", "placeholder": "e.g. young", "example": "young"}, {"key": "people", "label": "Sitter", "placeholder": "e.g. Egyptian woman with a Greek name", "example": "Egyptian woman with a Greek name"}, {"key": "jewellery", "label": "Jewellery", "placeholder": "e.g. gold earrings and a gold necklace", "example": "gold earrings and a gold necklace"}, {"key": "dress", "label": "Dress", "placeholder": "e.g. a chiton and cloak", "example": "a chiton and cloak"}], "defaultSize": "768x1024"},
  {"id": "nubian-tribute-procession", "title": "Nubian Tribute Procession", "category": "scene", "promptPattern": "A New Kingdom procession of Nubian tribute bearers before the viceroy of Kush, as painted in the Theban tombs of Rekhmire and Huy: {{animals}}, gold rings, ivory, animal skins and ostrich feathers, elite Nubians in Egyptianised linen or in feathered headdresses with large hoop earrings, {{setting}}, painted-tomb colours", "slots": [{"key": "animals", "label": "Animals", "placeholder": "e.g. a giraffe with a monkey climbing its neck, leopards, cattle", "example": "a giraffe with a monkey climbing its neck, leopards, cattle"}, {"key": "setting", "label": "Setting", "placeholder": "e.g. the court at Thebes under Tutankhamun", "example": "the court at Thebes under Tutankhamun"}], "defaultSize": "1024x768"},
  {"id": "hittite-bride-arrival", "title": "The Hittite Bride Arrives", "category": "scene", "promptPattern": "Maathorneferure, daughter of the Hittite king Hattusili III, arriving at Pi-Ramesses in the winter of 1246-1245 BCE to marry Ramesses II, her caravan from Hattusa bringing gold, silver, bronze, cattle and sheep, Egyptian escort troops, {{moment}}, {{style}}", "slots": [{"key": "moment", "label": "Moment", "placeholder": "e.g. Ramesses II receiving her at the palace gate", "example": "Ramesses II receiving her at the palace gate"}, {"key": "style", "label": "Style", "placeholder": "e.g. cinematic historical painting", "example": "cinematic historical painting"}], "defaultSize": "1024x768"},
  {"id": "egyptian-infantry-model", "title": "Soldier Model", "category": "scene", "promptPattern": "A painted wooden tomb model of a company of {{troops}}, as in the Middle Kingdom models from Mesehti's tomb at Asyut, {{detail}}, museum display case", "slots": [{"key": "troops", "label": "Troops", "placeholder": "e.g. Egyptian spearmen with hide shields and white kilts", "example": "Egyptian spearmen with hide shields and white kilts"}, {"key": "detail", "label": "Detail", "placeholder": "e.g. forty figures striding in four ranks", "example": "forty figures striding in four ranks"}], "defaultSize": "1024x768"},
  {"id": "raphia-egyptian-phalanx", "title": "Raphia: the Egyptian Phalanx", "category": "scene", "promptPattern": "The Battle of Raphia, 217 BC: Ptolemy IV's 20,000 Egyptians trained in the Macedonian way, a deep phalanx with long sarissa pikes, African elephants facing the Seleucid Indian elephants of Antiochus III, {{moment}}, {{viewpoint}}", "slots": [{"key": "moment", "label": "Moment", "placeholder": "e.g. the phalanx advancing", "example": "the phalanx advancing"}, {"key": "viewpoint", "label": "Viewpoint", "placeholder": "e.g. low angle in the dust", "example": "low angle in the dust"}], "defaultSize": "1024x768"},
  {"id": "royal-regalia-flatlay", "title": "Royal Regalia Flat-lay", "category": "print", "promptPattern": "Museum flat-lay of ancient Egyptian royal regalia of {{era}}: {{crown}}, {{sceptre}}, {{jewellery}}, arranged on dark linen, labelled like a catalogue plate, photorealistic", "slots": [{"key": "era", "label": "Era", "placeholder": "e.g. the 18th Dynasty", "example": "the 18th Dynasty"}, {"key": "crown", "label": "Crown", "placeholder": "e.g. the blue khepresh crown", "example": "the blue khepresh crown"}, {"key": "sceptre", "label": "Sceptre", "placeholder": "e.g. crook and flail banded in blue glass, obsidian and gold", "example": "crook and flail banded in blue glass, obsidian and gold"}, {"key": "jewellery", "label": "Jewellery", "placeholder": "e.g. a broad bead collar and golden flies of valour", "example": "a broad bead collar and golden flies of valour"}], "defaultSize": "1024x768"},
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
