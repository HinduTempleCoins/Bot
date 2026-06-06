// SoapBox Generative AI Page — the open directory of image/video generators.
//
// Operator (2026-06-06): "also have all of the Options for Competitors too, we want
// People to use Bing and whatever else to make Images on our Blogs." Same philosophy
// as the pool's pinned-upstream-releases and Hierophant's link-out catalog: we run our
// own free generation in-page, AND we point at every good external generator — the
// goal is images on MELEK blogs, not lock-in to our engine.
//
// Pure data + lookups. No network, no keys. The genai page renders this as the
// "More ways to make images" directory.

export const GENERATORS = [
  // --- the big free image makers ---
  {
    id: 'bing-image-creator', name: 'Bing Image Creator', kind: 'image',
    url: 'https://www.bing.com/images/create',
    maker: 'Microsoft (DALL·E family)',
    free: 'free with a Microsoft account; daily "boost" credits, slower after',
    signup: 'Microsoft account',
    strengths: 'easy, good general quality, totally mainstream',
  },
  {
    id: 'gemini', name: 'Google Gemini', kind: 'image',
    url: 'https://gemini.google.com/',
    maker: 'Google (Imagen family)',
    free: 'free tier in the Gemini app/site',
    signup: 'Google account',
    strengths: 'strong photorealism, easy edits by conversation',
  },
  {
    id: 'chatgpt-images', name: 'ChatGPT Images', kind: 'image',
    url: 'https://chatgpt.com/',
    maker: 'OpenAI (GPT-image)',
    free: 'limited free generations per day',
    signup: 'OpenAI account',
    strengths: 'excellent text-in-image and instruction following',
  },
  {
    id: 'meta-ai', name: 'Meta AI — Imagine', kind: 'image',
    url: 'https://www.meta.ai/',
    maker: 'Meta (Emu)',
    free: 'free with a Meta/Facebook/Instagram account',
    signup: 'Meta account',
    strengths: 'fast, fine for casual blog art',
  },
  {
    id: 'grok-image', name: 'Grok (X)', kind: 'image',
    url: 'https://grok.com/',
    maker: 'xAI (Aurora / FLUX lineage)',
    free: 'limited free generations',
    signup: 'X account',
    strengths: 'loose content policy, good realism',
  },
  // --- the dedicated art platforms (free daily credits) ---
  {
    id: 'ideogram', name: 'Ideogram', kind: 'image',
    url: 'https://ideogram.ai/',
    maker: 'Ideogram',
    free: 'free daily credits',
    signup: 'account',
    strengths: 'best-in-class TEXT inside images — logos, posters, signs',
  },
  {
    id: 'leonardo', name: 'Leonardo.Ai', kind: 'image',
    url: 'https://leonardo.ai/',
    maker: 'Leonardo (SDXL/FLUX pipelines)',
    free: 'free daily tokens',
    signup: 'account',
    strengths: 'game-art styles, consistent characters, upscaling',
  },
  {
    id: 'playground', name: 'Playground', kind: 'image',
    url: 'https://playground.com/',
    maker: 'Playground',
    free: 'free tier',
    signup: 'account',
    strengths: 'design-oriented: posters, thumbnails, social cards',
  },
  {
    id: 'adobe-firefly', name: 'Adobe Firefly', kind: 'image',
    url: 'https://firefly.adobe.com/',
    maker: 'Adobe',
    free: 'monthly free generative credits',
    signup: 'Adobe account',
    strengths: 'commercially-safe training data; great for business blogs',
  },
  {
    id: 'canva-ai', name: 'Canva (Magic Media)', kind: 'image',
    url: 'https://www.canva.com/',
    maker: 'Canva',
    free: 'free plan includes limited AI generations',
    signup: 'account',
    strengths: 'generation INSIDE a full design tool — banners, headers, thumbnails',
  },
  // --- zero-signup / open ---
  {
    id: 'craiyon', name: 'Craiyon', kind: 'image',
    url: 'https://www.craiyon.com/',
    maker: 'Craiyon',
    free: 'free, no account needed',
    signup: 'none',
    strengths: 'zero-friction; quality is modest but it always works',
  },
  {
    id: 'pollinations', name: 'Pollinations', kind: 'image',
    url: 'https://pollinations.ai/',
    maker: 'Pollinations (open infra)',
    free: 'free, no key, open API',
    signup: 'none',
    strengths: 'the open ecosystem option — same engine our page uses as fallback',
  },
  {
    id: 'hf-spaces', name: 'Hugging Face Spaces', kind: 'image',
    url: 'https://huggingface.co/spaces',
    maker: 'community (FLUX, SD3.5, thousands of models)',
    free: 'free hosted demos (ZeroGPU)',
    signup: 'optional',
    strengths: 'try the newest open models the day they drop',
  },
  // --- video (the CapCut-adjacent lane) ---
  {
    id: 'capcut', name: 'CapCut', kind: 'video',
    url: 'https://www.capcut.com/',
    maker: 'ByteDance',
    free: 'free editor + free AI features; template ecosystem',
    signup: 'account',
    strengths: 'THE template-driven editor — the model for our future template maker',
  },
  {
    id: 'runway', name: 'Runway', kind: 'video',
    url: 'https://runwayml.com/',
    maker: 'Runway',
    free: 'limited free credits',
    signup: 'account',
    strengths: 'serious text/image-to-video',
  },
  {
    id: 'luma-dream-machine', name: 'Luma Dream Machine', kind: 'video',
    url: 'https://lumalabs.ai/dream-machine',
    maker: 'Luma',
    free: 'limited free generations',
    signup: 'account',
    strengths: 'fast, dreamy image-to-video',
  },
  {
    id: 'pika', name: 'Pika', kind: 'video',
    url: 'https://pika.art/',
    maker: 'Pika',
    free: 'limited free credits',
    signup: 'account',
    strengths: 'playful effects, easy short clips',
  },
  {
    id: 'kling', name: 'Kling AI', kind: 'video',
    url: 'https://klingai.com/',
    maker: 'Kuaishou',
    free: 'daily free credits',
    signup: 'account',
    strengths: 'strong motion quality on the free tier',
  },
];

export function byKind(kind) {
  return GENERATORS.filter((g) => g.kind === kind);
}

export function getGenerator(id) {
  return GENERATORS.find((g) => g.id === id) || null;
}

export function noSignupOptions() {
  return GENERATORS.filter((g) => g.signup === 'none');
}
