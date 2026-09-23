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

export const EFFECT_CATEGORIES = ['hathor', 'creature', 'holiday', 'horror', 'film', 'power', 'era', 'art', 'lifestyle', 'figures'];

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
  {
    id: 'anpu',
    name: 'Anpu the Jackal Warden',
    kind: 'builtin',
    description: 'Our Halloween character — a jackal-headed guardian of the underworld, Egyptian temple meets Halloween. Renders GPU-free from its described look (no photo needed).',
    // look-based (no reference set / LoRA yet) → generates on the free hosted text-to-image path
    look: 'a tall jackal-headed guardian in the style of the Egyptian god Anubis, obsidian-black fur, glowing amber eyes, gold-and-lapis ceremonial regalia, wielding a was-scepter, temple-of-the-dead atmosphere',
    cleared: true,
  },
];

const CHAR_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));
export function getCharacter(id) { return CHAR_BY_ID.get(String(id || '')) || null; }

// The effect library. `{{subject}}` is replaced with a subject phrase (the character's name,
// or a neutral "the subject" for a bare face). `technique` hints the backend which path to
// take: character-referenced img gen so the OUTPUT is the same subject in a brand-new image,
// never the original photo.
export const EFFECT_TEMPLATES = [
  // ── APPEAR WITH HATHOR (the flagship set — you + Hathor, tons of ways) ─────────────────────────────
  { id: 'hathor-selfie', title: 'Selfie with Hathor', category: 'hathor',
    prompt: '{{subject}} taking a happy smartphone selfie with the Egyptian goddess Hathor, warm golden light, candid and real', negative: 'blurry, deformed' },
  { id: 'hathor-throne', title: 'On the Throne with Hathor', category: 'hathor',
    prompt: '{{subject}} seated beside the Egyptian goddess Hathor on a golden temple throne, regal, cinematic', negative: 'blurry, deformed' },
  { id: 'hathor-beach', title: 'Beach Day with Hathor', category: 'hathor',
    prompt: '{{subject}} on a sunny beach with the Egyptian goddess Hathor, turquoise water, golden hour', negative: 'blurry, deformed' },
  { id: 'hathor-space', title: 'In Space with Hathor', category: 'hathor',
    prompt: '{{subject}} floating in space alongside the radiant Egyptian goddess Hathor, stars and nebula', negative: 'blurry, deformed' },
  { id: 'hathor-concert', title: 'At a Concert with Hathor', category: 'hathor',
    prompt: '{{subject}} at a concert with the Egyptian goddess Hathor, stage lights and crowd, energetic', negative: 'blurry, deformed' },
  { id: 'hathor-meditate', title: 'Meditating with Hathor', category: 'hathor',
    prompt: '{{subject}} meditating peacefully with the Egyptian goddess Hathor in a serene candlelit temple', negative: 'blurry, deformed' },
  { id: 'hathor-ancient-egypt', title: 'Ancient Egypt with Hathor', category: 'hathor',
    prompt: '{{subject}} walking through ancient Egypt with the Egyptian goddess Hathor, pyramids and palms', negative: 'blurry, deformed' },
  { id: 'hathor-cafe', title: 'Coffee with Hathor', category: 'hathor',
    prompt: '{{subject}} having coffee at a cozy cafe with the Egyptian goddess Hathor, relaxed and warm', negative: 'blurry, deformed' },
  { id: 'hathor-redcarpet', title: 'Red Carpet with Hathor', category: 'hathor',
    prompt: '{{subject}} on a glamorous red carpet with the Egyptian goddess Hathor, camera flashes', negative: 'blurry, deformed' },
  { id: 'hathor-flying', title: 'Flying with Hathor', category: 'hathor',
    prompt: '{{subject}} soaring through golden clouds with the winged Egyptian goddess Hathor, epic', negative: 'blurry, deformed' },
  { id: 'hathor-garden', title: 'In the Garden with Hathor', category: 'hathor',
    prompt: '{{subject}} in a lush blooming garden with the Egyptian goddess Hathor, butterflies, soft light', negative: 'blurry, deformed' },
  { id: 'hathor-nightclub', title: 'Night Out with Hathor', category: 'hathor',
    prompt: '{{subject}} dancing at a glamorous nightclub with the Egyptian goddess Hathor, neon lights', negative: 'blurry, deformed' },
  { id: 'hathor-mountaintop', title: 'Mountaintop with Hathor', category: 'hathor',
    prompt: '{{subject}} on a mountaintop at sunrise with the Egyptian goddess Hathor, sea of clouds', negative: 'blurry, deformed' },
  { id: 'hathor-nile-barque', title: 'Sailing the Nile with Hathor', category: 'hathor',
    prompt: '{{subject}} sailing the Nile on a golden barque with the Egyptian goddess Hathor, sunset', negative: 'blurry, deformed' },
  { id: 'hathor-festival', title: 'Festival with Hathor', category: 'hathor',
    prompt: '{{subject}} at a joyful festival with the Egyptian goddess Hathor, music, lanterns, confetti', negative: 'blurry, deformed' },
  { id: 'hathor-portrait', title: 'Royal Portrait with Hathor', category: 'hathor',
    prompt: '{{subject}} in a regal painted portrait beside the Egyptian goddess Hathor, gold and lapis', negative: 'blurry, modern items' },
  { id: 'hathor-street', title: 'Around Town with Hathor', category: 'hathor',
    prompt: '{{subject}} walking a lively city street casually with the Egyptian goddess Hathor, candid', negative: 'blurry, deformed' },
  { id: 'hathor-royalty', title: 'Crowned with Hathor', category: 'hathor',
    prompt: '{{subject}} crowned as royalty beside the Egyptian goddess Hathor in a grand palace', negative: 'blurry, cheap costume' },
  { id: 'hathor-cosmic', title: 'Cosmic Vision with Hathor', category: 'hathor',
    prompt: '{{subject}} in a cosmic vision with the Egyptian goddess Hathor, radiant divine light, sacred geometry', negative: 'blurry, deformed' },
  { id: 'hathor-campfire', title: 'Campfire with Hathor', category: 'hathor',
    prompt: '{{subject}} around a campfire under a starry sky with the Egyptian goddess Hathor, cozy', negative: 'blurry, deformed' },
  { id: 'hathor-rooftop', title: 'Rooftop Sunset with Hathor', category: 'hathor',
    prompt: '{{subject}} on a city rooftop at golden hour with the Egyptian goddess Hathor, skyline', negative: 'blurry, deformed' },
  { id: 'hathor-library', title: 'Ancient Library with Hathor', category: 'hathor',
    prompt: '{{subject}} in an ancient library of scrolls with the Egyptian goddess Hathor, warm lamplight', negative: 'blurry, deformed' },
  { id: 'hathor-celebration', title: 'Celebration with Hathor', category: 'hathor',
    prompt: '{{subject}} at a beautiful celebration with the Egyptian goddess Hathor as the guest of honor', negative: 'blurry, deformed' },
  { id: 'hathor-desert', title: 'Desert Ride with Hathor', category: 'hathor',
    prompt: '{{subject}} riding through the desert with the Egyptian goddess Hathor, camels and dunes, sunset', negative: 'blurry, deformed' },
  { id: 'hathor-underwater', title: 'Underwater Temple with Hathor', category: 'hathor',
    prompt: '{{subject}} in a magical underwater temple with the Egyptian goddess Hathor, glowing light shafts', negative: 'blurry, deformed' },
  { id: 'hathor-snow', title: 'Snow Day with Hathor', category: 'hathor',
    prompt: '{{subject}} in a snowy winter landscape with the Egyptian goddess Hathor, soft snowfall', negative: 'blurry, deformed' },
  { id: 'hathor-graduation', title: 'Graduation with Hathor', category: 'hathor',
    prompt: '{{subject}} at a proud graduation with the Egyptian goddess Hathor congratulating them, confetti', negative: 'blurry, deformed' },
  { id: 'hathor-stars', title: 'Enthroned in the Stars with Hathor', category: 'hathor',
    prompt: '{{subject}} enthroned among the stars with the Egyptian goddess Hathor, celestial, divine', negative: 'blurry, deformed' },
  { id: 'hathor-bazaar', title: 'Ancient Bazaar with Hathor', category: 'hathor',
    prompt: '{{subject}} browsing a vibrant ancient bazaar with the Egyptian goddess Hathor, spices and silks', negative: 'blurry, deformed' },
  { id: 'hathor-blessing', title: 'Blessing from Hathor', category: 'hathor',
    prompt: '{{subject}} receiving a blessing from the Egyptian goddess Hathor, golden aura, devotional art', negative: 'blurry, disrespectful' },
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
  // ── horror / Halloween movies (trademark-safe archetypes) ───────────────────
  { id: 'vampire-count', title: 'Vampire Count', category: 'horror',
    prompt: '{{subject}} as a classic aristocratic vampire count, pale skin, high-collared cape, moonlit gothic castle, cinematic horror',
    negative: 'excessive gore, graphic blood' },
  { id: 'werewolf', title: 'Werewolf', category: 'horror',
    prompt: '{{subject}} transformed into a fearsome werewolf under a full moon, foggy pine forest, dramatic horror lighting',
    negative: 'excessive gore, graphic blood' },
  { id: 'zombie', title: 'Zombie', category: 'horror',
    prompt: '{{subject}} as a walking zombie, tattered clothes, pale decayed skin, eerie graveyard at night, horror movie still',
    negative: 'extreme gore, entrails' },
  { id: 'mummy', title: 'Ancient Mummy', category: 'horror',
    prompt: '{{subject}} as an ancient bandaged mummy rising from a sarcophagus, torchlit tomb, dust and cobwebs, cinematic',
    negative: 'excessive gore' },
  { id: 'witch', title: 'Witch', category: 'horror',
    prompt: '{{subject}} as a powerful spellcasting witch with a bubbling cauldron, haunted woods at night, glowing magic',
    negative: 'blurry, deformed' },
  { id: 'ghost-specter', title: 'Haunting Specter', category: 'horror',
    prompt: '{{subject}} as a translucent glowing specter drifting through a derelict mansion, moonlight through broken windows, ghostly',
    negative: 'blurry, gore' },
  { id: 'grim-reaper', title: 'Grim Reaper', category: 'horror',
    prompt: '{{subject}} as the Grim Reaper in a tattered black hooded cloak holding a scythe, foggy churchyard, ominous',
    negative: 'graphic gore' },
  { id: 'patchwork-monster', title: 'Reanimated Monster', category: 'horror',
    prompt: '{{subject}} as a towering reanimated patchwork monster with stitches and neck bolts, sparking laboratory, stormy night, classic horror',
    negative: 'graphic gore, blood' },
  { id: 'masked-slasher', title: 'Masked Slasher', category: 'horror',
    prompt: '{{subject}} as a silent masked slasher villain in a dark suburban street at night, suspenseful horror poster, moody backlight',
    negative: 'gore, blood, weapons toward viewer' },
  { id: 'killer-clown', title: 'Creepy Carnival Clown', category: 'horror',
    prompt: '{{subject}} as a sinister carnival clown with a wicked grin and smeared makeup, abandoned funhouse, unsettling horror',
    negative: 'gore, blood' },
  { id: 'headless-horseman', title: 'Headless Horseman', category: 'horror',
    prompt: '{{subject}} as the Headless Horseman riding a black steed through a misty hollow, glowing jack-o-lantern in hand, autumn night',
    negative: 'graphic gore' },
  { id: 'mad-scientist', title: 'Mad Scientist', category: 'horror',
    prompt: '{{subject}} as a wild-eyed mad scientist in a sparking laboratory full of strange bubbling machines, dramatic lighting',
    negative: 'blurry, deformed' },
  { id: 'day-of-the-dead', title: 'Day of the Dead', category: 'horror',
    prompt: '{{subject}} as an elegant Day-of-the-Dead figure with ornate sugar-skull face paint and marigold flowers, festive candlelit altar',
    negative: 'scary gore, blood' },
  { id: 'skeleton-lord', title: 'Skeleton Lord', category: 'horror',
    prompt: '{{subject}} as an ornate skeleton lord in a jeweled crown and royal robes on a bone throne, gothic hall', negative: 'excessive gore' },
  { id: 'demon-overlord', title: 'Demon Overlord', category: 'horror',
    prompt: '{{subject}} as a horned demon overlord wreathed in fire, hellish cavern, glowing eyes, cinematic', negative: 'graphic gore, blood' },
  { id: 'gargoyle', title: 'Living Gargoyle', category: 'horror',
    prompt: '{{subject}} as a stone gargoyle coming to life atop a gothic cathedral at night, storm clouds', negative: 'blurry, deformed' },
  { id: 'banshee', title: 'Wailing Banshee', category: 'horror',
    prompt: '{{subject}} as a spectral wailing banshee in tattered white, misty moors at midnight, ghostly', negative: 'gore, blood' },
  { id: 'wendigo', title: 'Wendigo', category: 'horror',
    prompt: '{{subject}} as a gaunt antlered wendigo cryptid in a snowy dark forest, eerie, cinematic horror', negative: 'graphic gore' },
  { id: 'pumpkin-king', title: 'Pumpkin King', category: 'horror',
    prompt: '{{subject}} as a regal jack-o-lantern-headed pumpkin king in autumn robes, harvest-moon field', negative: 'gore, blood' },
  { id: 'scarecrow', title: 'Cursed Scarecrow', category: 'horror',
    prompt: '{{subject}} as a sinister living scarecrow in a moonlit cornfield, crows and fog, creepy', negative: 'gore, blood' },
  { id: 'haunted-doll', title: 'Haunted Doll', category: 'horror',
    prompt: '{{subject}} reimagined as an eerie antique porcelain doll come to life in a dusty attic, unsettling', negative: 'gore, blood' },
  { id: 'phantom-mask', title: 'Masked Phantom', category: 'horror',
    prompt: '{{subject}} as a masked phantom of the opera figure in a candlelit underground lair, dramatic cape', negative: 'blurry, gore' },
  { id: 'swamp-creature', title: 'Swamp Creature', category: 'horror',
    prompt: '{{subject}} as a mossy swamp creature rising from a misty bog at dusk, classic monster movie', negative: 'excessive gore' },
  { id: 'cryptid-bigfoot', title: 'Cryptid (Bigfoot)', category: 'horror',
    prompt: '{{subject}} as a towering bigfoot cryptid glimpsed in a foggy forest, grainy found-footage vibe', negative: 'gore' },
  { id: 'cursed-pirate', title: 'Cursed Pirate Ghost', category: 'horror',
    prompt: '{{subject}} as a cursed ghostly pirate captain on a haunted ship under a blood moon, spectral', negative: 'excessive gore' },
  { id: 'plague-doctor', title: 'Plague Doctor', category: 'horror',
    prompt: '{{subject}} as an ominous plague doctor in a beaked mask and long coat, foggy medieval street, lantern', negative: 'gore, blood' },
  { id: 'evil-sorcerer', title: 'Dark Sorcerer', category: 'horror',
    prompt: '{{subject}} as a dark sorcerer channeling crackling shadow magic, ruined tower, ominous, cinematic', negative: 'gore' },
  { id: 'spider-queen', title: 'Spider Queen', category: 'horror',
    prompt: '{{subject}} as a regal spider queen in a moonlit web-draped crypt, elegant and eerie', negative: 'excessive gore' },
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
  // ── famous figures — appear AS or WITH them (deities + historical; from the Windy vector set) ──────
  // Deities/historical/deceased = safe (devotional/artistic/satire); no implied endorsement.
  { id: 'as-kali', title: 'As the Goddess Kali', category: 'figures',
    prompt: '{{subject}} portrayed in the divine iconography of the goddess Kali, blue skin, many arms, garland, fierce sacred aura, temple backdrop, devotional art',
    negative: 'gore, disrespectful, blurry' },
  { id: 'as-shiva', title: 'As Lord Shiva', category: 'figures',
    prompt: '{{subject}} portrayed as Lord Shiva, ash-marked skin, third eye, crescent moon, serene meditation on Mount Kailash, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-ganesha', title: 'As Ganesha', category: 'figures',
    prompt: '{{subject}} portrayed in the iconography of Ganesha, warm auspicious tones, ornate temple setting, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-hathor', title: 'As Hathor', category: 'figures',
    prompt: '{{subject}} portrayed as the Egyptian goddess Hathor, cow-horn-and-sun-disk crown, gold and turquoise regalia, temple mural style',
    negative: 'blurry, deformed' },
  { id: 'as-khepri', title: 'As Khepri', category: 'figures',
    prompt: '{{subject}} portrayed as the Egyptian god Khepri with a winged scarab motif, sunrise over the Nile, ancient temple art',
    negative: 'blurry, deformed' },
  { id: 'as-pharaoh', title: 'As a Pharaoh', category: 'figures',
    prompt: '{{subject}} as an ancient Egyptian pharaoh in full gold regalia and nemes headdress, throne room, hieroglyph walls, cinematic',
    negative: 'blurry, cheap costume' },
  { id: 'with-che', title: 'With Che Guevara', category: 'figures',
    prompt: '{{subject}} standing beside Che Guevara in a vintage revolutionary photograph, grainy film, historic mural backdrop',
    negative: 'blurry, weapons toward viewer' },
  { id: 'with-noble-drew-ali', title: 'With Noble Drew Ali', category: 'figures',
    prompt: '{{subject}} standing respectfully beside Noble Drew Ali in a dignified early-1900s portrait, sepia tone, historic',
    negative: 'blurry, disrespectful' },
  { id: 'with-a-legend', title: 'With a Legend (your pick)', category: 'figures',
    prompt: '{{subject}} photographed side by side with {{figure}}, candid natural lighting, looks like a real snapshot together',
    negative: 'blurry, deformed' },
  { id: 'as-a-figure', title: 'As Anyone (your pick)', category: 'figures',
    prompt: '{{subject}} reimagined as {{figure}}, faithful costume and setting, cinematic portrait',
    negative: 'blurry, deformed' },
  { id: 'with-world-leader', title: 'With a World Leader', category: 'figures',
    prompt: '{{subject}} shaking hands with an iconic world leader on a formal stage, press-photo lighting, flags behind',
    negative: 'blurry, implied endorsement text' },
  { id: 'renaissance-master', title: 'Painted by a Master', category: 'figures',
    prompt: '{{subject}} as the subject of a portrait in the style of a Renaissance master painter, museum oil painting',
    negative: 'photo look, modern items' },
  // Hindu deities (devotional, on-brand for the temple)
  { id: 'as-krishna', title: 'As Lord Krishna', category: 'figures',
    prompt: '{{subject}} portrayed as Lord Krishna, blue skin, peacock-feather crown, flute, pastoral Vrindavan, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-vishnu', title: 'As Lord Vishnu', category: 'figures',
    prompt: '{{subject}} portrayed as Lord Vishnu, four arms holding conch and discus, cosmic ocean, serene, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-lakshmi', title: 'As Goddess Lakshmi', category: 'figures',
    prompt: '{{subject}} portrayed as the goddess Lakshmi on a lotus throne, golden radiance, auspicious, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-saraswati', title: 'As Goddess Saraswati', category: 'figures',
    prompt: '{{subject}} portrayed as the goddess Saraswati, white sari, veena, swan, serene wisdom, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-durga', title: 'As Goddess Durga', category: 'figures',
    prompt: '{{subject}} portrayed as the goddess Durga riding a lion, many arms with weapons, triumphant, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-hanuman', title: 'As Lord Hanuman', category: 'figures',
    prompt: '{{subject}} portrayed as Lord Hanuman, mighty devoted form with a mace, mountain backdrop, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-nataraja', title: 'As Nataraja', category: 'figures',
    prompt: '{{subject}} portrayed as Nataraja, the cosmic dancer Shiva within a ring of fire, dynamic pose, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-parvati', title: 'As Goddess Parvati', category: 'figures',
    prompt: '{{subject}} portrayed as the goddess Parvati, graceful, mountain temple, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-kartikeya', title: 'As Kartikeya', category: 'figures',
    prompt: '{{subject}} portrayed as Kartikeya with a divine spear and a peacock, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-nandi', title: 'With Nandi the Sacred Bull', category: 'figures',
    prompt: '{{subject}} at a Shiva temple beside Nandi the sacred bull, incense and lamps, devotional art',
    negative: 'disrespectful, blurry' },
  // Egyptian gods
  { id: 'as-anubis', title: 'As Anubis', category: 'figures',
    prompt: '{{subject}} portrayed as Anubis, jackal-headed guardian of the dead, gold and obsidian, torchlit tomb, ancient Egyptian art',
    negative: 'blurry, deformed' },
  { id: 'as-ra', title: 'As Ra', category: 'figures',
    prompt: '{{subject}} portrayed as Ra with a sun-disk crown and falcon aspects, radiant desert dawn, ancient Egyptian art',
    negative: 'blurry, deformed' },
  { id: 'as-isis', title: 'As Isis', category: 'figures',
    prompt: '{{subject}} portrayed as the goddess Isis, winged arms, throne crown, protective aura, temple mural',
    negative: 'blurry, deformed' },
  { id: 'as-osiris', title: 'As Osiris', category: 'figures',
    prompt: '{{subject}} portrayed as Osiris, green skin, crook and flail, mummiform regalia, underworld throne',
    negative: 'blurry, deformed' },
  { id: 'as-horus', title: 'As Horus', category: 'figures',
    prompt: '{{subject}} portrayed as Horus, falcon-headed, the Eye of Horus, sky and sun, ancient Egyptian art',
    negative: 'blurry, deformed' },
  { id: 'as-bastet', title: 'As Bastet', category: 'figures',
    prompt: '{{subject}} portrayed as Bastet, cat-headed goddess, gold jewelry, temple by moonlight',
    negative: 'blurry, deformed' },
  { id: 'as-thoth', title: 'As Thoth', category: 'figures',
    prompt: '{{subject}} portrayed as Thoth, ibis-headed god of wisdom, scrolls and moon, temple library',
    negative: 'blurry, deformed' },
  { id: 'as-sekhmet', title: 'As Sekhmet', category: 'figures',
    prompt: '{{subject}} portrayed as Sekhmet, lioness-headed warrior goddess with a sun disk, fierce, temple',
    negative: 'blurry, deformed' },
  // other sacred / mythic
  { id: 'as-buddha', title: 'As a Buddha', category: 'figures',
    prompt: '{{subject}} portrayed as a serene meditating Buddha figure beneath a bodhi tree, golden calm, devotional art',
    negative: 'disrespectful, blurry' },
  { id: 'as-guanyin', title: 'As Guanyin', category: 'figures',
    prompt: '{{subject}} portrayed as Guanyin, compassionate bodhisattva in flowing white robes, lotus, serene',
    negative: 'disrespectful, blurry' },
  { id: 'as-green-man', title: 'As the Green Man', category: 'figures',
    prompt: '{{subject}} portrayed as the Green Man, a face of leaves and vines, deep forest, mythic',
    negative: 'blurry, deformed' },
  // revolutionary / cultural icons (historical / deceased — artistic use)
  { id: 'with-bob-marley', title: 'With Bob Marley', category: 'figures',
    prompt: '{{subject}} standing beside Bob Marley in a warm vintage photo, reggae stage, film grain',
    negative: 'blurry, deformed' },
  { id: 'with-haile-selassie', title: 'With Haile Selassie', category: 'figures',
    prompt: '{{subject}} standing beside Emperor Haile Selassie in a dignified formal portrait, historic',
    negative: 'blurry, deformed' },
  { id: 'with-malcolm-x', title: 'With Malcolm X', category: 'figures',
    prompt: '{{subject}} standing beside Malcolm X in a dignified 1960s black-and-white photograph',
    negative: 'blurry, deformed' },
  { id: 'with-mlk', title: 'With Dr. King', category: 'figures',
    prompt: '{{subject}} standing beside Dr. Martin Luther King Jr. at a historic gathering, black and white',
    negative: 'blurry, deformed' },
  { id: 'with-marcus-garvey', title: 'With Marcus Garvey', category: 'figures',
    prompt: '{{subject}} standing beside Marcus Garvey in an early-1900s formal portrait, sepia',
    negative: 'blurry, deformed' },
  { id: 'with-fred-hampton', title: 'With Fred Hampton', category: 'figures',
    prompt: '{{subject}} standing beside Fred Hampton at a community gathering, 1960s photograph',
    negative: 'blurry, deformed' },
  { id: 'with-zapata', title: 'With Emiliano Zapata', category: 'figures',
    prompt: '{{subject}} standing beside Emiliano Zapata in a revolutionary-era photograph, sepia',
    negative: 'blurry, weapons toward viewer' },
  { id: 'with-frida', title: 'With Frida Kahlo', category: 'figures',
    prompt: '{{subject}} standing beside Frida Kahlo in a vibrant folk-art setting, warm colors',
    negative: 'blurry, deformed' },
  { id: 'with-tesla', title: 'With Nikola Tesla', category: 'figures',
    prompt: '{{subject}} standing beside Nikola Tesla in a laboratory of glowing coils, vintage',
    negative: 'blurry, deformed' },
  { id: 'with-tupac', title: 'With Tupac', category: 'figures',
    prompt: '{{subject}} standing beside Tupac Shakur in a 1990s photo, urban backdrop',
    negative: 'blurry, deformed' },
  // sacred animals (from the batch: nandi, cats, lions)
  { id: 'sacred-lion', title: 'As a Sacred Lion', category: 'creature',
    prompt: '{{subject}} as a majestic sacred lion, temple steps, golden hour, powerful',
    negative: 'blurry, deformed' },
  { id: 'temple-cat', title: 'Temple Cats', category: 'creature',
    prompt: '{{subject}} surrounded by sacred temple cats in an Egyptian shrine, candlelight',
    negative: 'blurry, deformed' },
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
    return { subject: { kind, name: c.name, ref: c.refDir || null, lora: c.lora || null, look: c.look || null, character: c.id, cleared: true } };
  }
  const name = String(input.name || '').trim() || (kind === 'fictional' ? 'the character' : 'the subject');
  return {
    subject: {
      kind,
      name,
      ref: input.ref ? String(input.ref) : null,       // uploaded image / platform-character ref
      look: input.look ? String(input.look) : null,    // a described appearance (renders GPU-free)
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

  let prompt = e.prompt.replace(PLACEHOLDER_RE, subjectPhrase(subject));
  // optional second slot {{figure}} for the "appear as/with a famous figure" templates
  const figure = (opts.figure && String(opts.figure).trim()) || 'the figure';
  prompt = prompt.replace(/\{\{\s*figure\s*\}\}/g, figure);
  if (subject.look) prompt += `. Character look: ${subject.look}`;
  // character-referenced when we have a reference image; a LoRA when the character has one; else a
  // described look renders on the free hosted text-to-image path (no GPU on our side).
  const technique = subject.ref ? 'character-ref' : (subject.lora ? 'lora' : 'text-to-image');

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
