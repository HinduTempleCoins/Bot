// genai-school.mjs — the GenAI School: a Witness-School-style learning track for the GenAI page.
//
// THE IDEA (operator's spec): learn it here, then graduate to running it YOURSELF. Each lesson
// teaches a rung of the ladder — use our free templates, then ComfyUI, then run your own on
// Colab / Modal / Fal, then pull from the open model/prompt libraries (Hugging Face, Civitai,
// GitHub), then upload your own templates, then (optionally) mint them as NFTs with HONEST value
// disclaimers, then publish what you made to the Library (wiki) and share it in the forum.
//
// Pure data + pure functions — no network, fully testable offline. The lessons LINK to our own
// routes and to the real external tools; they do not embed keys or fetch anything.
//
//   TRACKS, LESSONS
//   listLessons() / listLessons(track)   -> lessons
//   getLesson(id)                         -> one or null
//   NFT_DISCLAIMER                        -> the honest value disclaimer (reused by the NFT lesson + mint UI)
//   validateSchool()                      -> integrity check for /health + tests

export const TRACKS = [
  { id: 'basics',     title: 'Basics — how AI images work' },
  { id: 'templates',  title: 'Our templates — make something in one tap' },
  { id: 'comfyui',    title: 'ComfyUI — build your own pipeline' },
  { id: 'self-serve', title: 'Run it yourself — Colab, Modal, Fal' },
  { id: 'sources',    title: 'Model & prompt libraries — Hugging Face, Civitai, GitHub' },
  { id: 'community',  title: 'Share — upload, Library, forum' },
  { id: 'nft',        title: 'NFTs & collectibles — the honest version' },
];

// The honest value disclaimer (operator's exact intent): most minted templates have little or no
// market value; treat them as numismatic/sentimental at best; some MAY become rare collectibles;
// none are guaranteed to; this is education on NFTs in game economies, not investment advice.
export const NFT_DISCLAIMER =
  'Honest heads-up: most templates or images you mint will have little or no market value — treat ' +
  'them as numismatic or sentimental keepsakes, not investments. A few may become rare collectibles ' +
  'over time; none are guaranteed to, and most will be worth less than what you put in. We teach how ' +
  'NFTs work in game economies and collections — this is education, not financial advice or a promise ' +
  'of value. Never spend money on minting that you cannot afford to treat as a hobby.';

// External tools we point people to (for the "run it yourself" ladder). Costs are approximate and
// change — each lesson says to check current pricing.
const TOOLS = {
  colab:  { name: 'Google Colab', url: 'https://colab.research.google.com/', cost: 'free tier; Pro ~$10/mo for better GPUs' },
  modal:  { name: 'Modal',        url: 'https://modal.com/',                 cost: 'generous free monthly credits, then pay-as-you-go' },
  fal:    { name: 'fal.ai',       url: 'https://fal.ai/',                    cost: 'pay-per-generation; fast hosted models' },
  comfy:  { name: 'ComfyUI',      url: 'https://github.com/comfyanonymous/ComfyUI', cost: 'free, open source (run local or on the above)' },
  hf:     { name: 'Hugging Face', url: 'https://huggingface.co/',           cost: 'free to browse; models/datasets, some gated' },
  civitai:{ name: 'Civitai',      url: 'https://civitai.com/',              cost: 'free to browse; check each item’s license before commercial use' },
  github: { name: 'GitHub',       url: 'https://github.com/search?q=comfyui+workflow', cost: 'free; community ComfyUI workflows & prompt packs' },
};

// Our own surfaces (relative; the page fills BASE_URL). The Library + forum are cross-site.
const OURS = {
  generate: '/', templates: '/templates', reels: '/reel-maker', characters: '/char',
  comfyui: '/comfyui', colab: '/colab', gallery: '/gallery',
  library: 'https://wiki.soapbox.community', forum: 'https://forum.soapbox.community',
};

export const LESSONS = [
  {
    id: 'how-it-works', track: 'basics', minutes: 5,
    title: 'How AI image generation works',
    summary: 'A prompt describes what you want; a diffusion model turns noise into an image that matches it. A negative prompt says what to avoid. Seeds make results repeatable. That is the whole game.',
    teaches: ['prompt', 'negative prompt', 'seed', 'model/checkpoint'],
    do: [{ label: 'Generate one free, no login', href: OURS.generate }],
  },
  {
    id: 'use-templates', track: 'templates', minutes: 5,
    title: 'Use our templates — one tap',
    summary: 'Do not start from a blank box. Pick a template, fill a couple of fields, and generate. We have image templates, CapCut-style reel/video templates, and character-transformation effects.',
    teaches: ['image templates', 'reel templates', 'effect templates'],
    do: [
      { label: 'Image templates', href: OURS.templates },
      { label: 'Reel maker (video)', href: OURS.reels },
      { label: 'Character effects', href: OURS.characters },
    ],
  },
  {
    id: 'characters-consent', track: 'templates', minutes: 8,
    title: 'Characters, consent & public figures',
    summary: 'Make a reusable character on the platform, or use a fictional one — no proof needed. A real person’s face needs consent. Public figures are fair game for satire and art; do not imply they endorse anything, and never make non-consensual intimate images.',
    teaches: ['create a character', 'consent gate (real faces only)', 'right of publicity', 'parody protection'],
    do: [{ label: 'Create a character', href: OURS.characters }],
  },
  {
    id: 'prompt-craft', track: 'basics', minutes: 10,
    title: 'Prompt craft (and where good prompts come from)',
    summary: 'Structure: subject, style, lighting, camera, detail; then a negative prompt for what to avoid. You do not have to invent them — huge open prompt libraries exist to learn from.',
    teaches: ['prompt structure', 'styles & modifiers', 'reading others’ prompts'],
    do: [
      { label: 'Hugging Face prompt datasets', href: TOOLS.hf.url + 'datasets?search=stable-diffusion-prompts' },
      { label: 'Civitai (images show their prompts)', href: TOOLS.civitai.url },
    ],
  },
  {
    id: 'comfyui-intro', track: 'comfyui', minutes: 15,
    title: 'ComfyUI — build your own pipeline',
    summary: 'ComfyUI is a free node graph: load a model, encode prompts, sample, decode, save. Once you can read a graph you can do things templates cannot — img2img, inpainting, ControlNet, character consistency, video.',
    teaches: ['node graphs', 'checkpoints', 'samplers', 'img2img / inpaint / controlnet'],
    do: [
      { label: 'Our ComfyUI workflow library', href: OURS.comfyui },
      { label: 'ComfyUI (open source)', href: TOOLS.comfy.url },
      { label: 'Community workflows on GitHub', href: TOOLS.github.url },
    ],
  },
  {
    id: 'models-loras', track: 'sources', minutes: 12,
    title: 'Models & LoRAs — the open libraries',
    summary: 'Checkpoints set the base style; LoRAs add a character or look on top. The big open libraries are Hugging Face and Civitai. CHECK THE LICENSE on each — some are free for anything, some are non-commercial, which matters if you sell or mint.',
    teaches: ['checkpoints vs LoRAs', 'where to get them', 'licenses (commercial vs non-commercial)'],
    do: [
      { label: 'Civitai — LoRAs & checkpoints', href: TOOLS.civitai.url },
      { label: 'Hugging Face — models', href: TOOLS.hf.url + 'models?pipeline_tag=text-to-image' },
    ],
  },
  {
    id: 'run-it-yourself', track: 'self-serve', minutes: 15,
    title: 'Run it yourself — Colab, Modal, Fal',
    summary: 'Graduate off our templates: run the same tools on your own compute. Google Colab is the cheapest start (~$10/mo Pro), Modal gives free monthly credits, Fal is fast pay-per-generation. Same models, your control, no lock-in.',
    teaches: ['hosted GPUs', 'cost tradeoffs', 'launching a notebook'],
    do: [
      { label: 'Our Colab notebook library', href: OURS.colab },
      { label: `${TOOLS.colab.name} — ${TOOLS.colab.cost}`, href: TOOLS.colab.url },
      { label: `${TOOLS.modal.name} — ${TOOLS.modal.cost}`, href: TOOLS.modal.url },
      { label: `${TOOLS.fal.name} — ${TOOLS.fal.cost}`, href: TOOLS.fal.url },
    ],
  },
  {
    id: 'upload-template', track: 'community', minutes: 8,
    title: 'Upload your own template',
    summary: 'Made something good? Package it as a template — a name, the prompt/workflow, and the fields others fill in — and share it. Browse and remix what others uploaded, gallery-style.',
    teaches: ['template packaging', 'attribution & license', 'remixing'],
    do: [
      { label: 'Browse the gallery', href: OURS.gallery },
      { label: 'Discuss & share in the forum', href: OURS.forum },
    ],
  },
  {
    id: 'nfts-game-economies', track: 'nft', minutes: 12,
    title: 'NFTs & collectibles in game economies',
    summary: 'You can mint a template or image as an NFT — useful as an in-game item, a collectible, or a way to sign your work on-chain. First, read this honestly.',
    teaches: ['what an NFT actually is', 'in-game item economies', 'rarity & collectibility', 'the honest value talk'],
    disclaimer: NFT_DISCLAIMER,
    do: [{ label: 'Learn NFTs in the Library', href: OURS.library }],
  },
  {
    id: 'publish-library', track: 'community', minutes: 6,
    title: 'Publish to the Library & the forum',
    summary: 'Write up what you made — the template, how it works, the prompt — as an article in the Library of Ashurbanipal, then start a forum thread that links to it. That is how the good stuff gets found and built on.',
    teaches: ['documenting your work', 'linking Library articles in forum posts', 'building a body of work'],
    do: [
      { label: 'The Library (wiki)', href: OURS.library },
      { label: 'The forum', href: OURS.forum },
    ],
  },
];

const BY_ID = new Map(LESSONS.map((l) => [l.id, l]));
export function getLesson(id) { return BY_ID.get(String(id || '')) || null; }
export function listLessons(track) {
  if (!track) return LESSONS;
  return LESSONS.filter((l) => l.track === track);
}

export function validateSchool() {
  const errors = [];
  const trackIds = new Set(TRACKS.map((t) => t.id));
  const seen = new Set();
  for (const l of LESSONS) {
    if (!l.id) { errors.push('lesson with no id'); continue; }
    if (seen.has(l.id)) errors.push(`duplicate lesson id: ${l.id}`);
    seen.add(l.id);
    if (!l.title) errors.push(`${l.id}: no title`);
    if (!trackIds.has(l.track)) errors.push(`${l.id}: unknown track ${l.track}`);
    if (!l.summary) errors.push(`${l.id}: no summary`);
    if (!(+l.minutes > 0)) errors.push(`${l.id}: bad minutes`);
    if (!Array.isArray(l.do) || !l.do.length) errors.push(`${l.id}: no "do" links`);
    for (const d of (l.do || [])) {
      if (!d.label) errors.push(`${l.id}: a link has no label`);
      if (!d.href) errors.push(`${l.id}: link "${d.label}" has no href`);
    }
  }
  // every track should have at least one lesson
  for (const t of TRACKS) if (!LESSONS.some((l) => l.track === t.id)) errors.push(`track ${t.id} has no lessons`);
  // the NFT lesson must carry the disclaimer
  const nft = LESSONS.find((l) => l.track === 'nft');
  if (!nft || !nft.disclaimer) errors.push('NFT lesson is missing the value disclaimer');
  return { ok: errors.length === 0, errors, lessons: LESSONS.length, tracks: TRACKS.length };
}

if (process.argv[1] && process.argv[1].endsWith('genai-school.mjs')) {
  const v = validateSchool();
  console.log(`GenAI School · ${v.lessons} lessons across ${v.tracks} tracks · ${v.ok ? '✓ valid' : '✗ ' + v.errors.join('; ')}`);
  for (const t of TRACKS) {
    const ls = listLessons(t.id);
    console.log(`  [${t.id}] ${ls.map((l) => l.id).join(', ')}`);
  }
}
