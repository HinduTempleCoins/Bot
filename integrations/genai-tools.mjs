// genai-tools.mjs — the ONE registry of every creative tool in the hub, each with an INSTRUCTIONAL.
// It is the single source of truth that drives (a) the /tools hub page, (b) the how-to instructionals,
// (c) the wiki pages, and (d) the forum index with links. Add a tool here → it shows up everywhere.
// Pure data + renderers, no network.

export const TOOLS = [
  // — Generate —
  { id: 'generate', title: 'Generate', cat: 'Create', url: '/', what: 'Type a prompt (optionally a place + clouds) and make an image, free, no login.',
    howto: ['Open the studio home.', 'Type your prompt.', 'Optional: add a place (grounds the scene in real geo/climate) and clouds.', 'Optional: Upload a photo to put YOU in the image.', 'Pick a size, hit Generate.'] },
  { id: 'templates', title: 'Templates', cat: 'Create', url: '/templates', what: 'Pick a ready-made template (character, environment, print, poster…) and fill a few fields.',
    howto: ['Open Templates.', 'Choose one (e.g. "Become Egyptian Royalty", "At a Famous Landmark", "T-Shirt Graphic").', 'Fill the slots.', 'Photo-forward templates: upload your photo to become it.', 'Generate.'] },
  { id: 'characters', title: 'Character Effects', cat: 'Create', url: '/char', what: 'Keep the same character, put them in a new scene/effect.',
    howto: ['Open Characters.', 'Pick an effect.', 'Use Hathor, your own character, or a fictional one.', 'Generate.'] },
  { id: 'with-hathor', title: 'Appear with Hathor', cat: 'Create', url: '/hathor', what: 'Put yourself in a scene with Hathor.', howto: ['Open With Hathor.', 'Pick a scene.', 'Add your photo.', 'Generate.'] },
  { id: 'compose', title: 'Reference Studio', cat: 'Create', url: '/compose', what: 'Upload several references — characters + objects (jewelry, hair, clothing) + a scene — and generate them together in one image.',
    howto: ['Open Reference Studio.', 'Add a reference for each character, object, and the scene.', 'Tag each one (Character / Object / Scene) and name it.', 'Optionally describe the shot.', 'Generate together — everything lands in a single image.'] },
  { id: 'mythology', title: 'Mythology', cat: 'Create', url: '/mythology', what: 'Greek, Egyptian, Norse and Hindu gods from the Hierophant — become one, stand beside one, or put several characters in one scene doing whatever you say.',
    howto: ['Open Mythology.', 'Pick a god and choose As or With.', 'Add more characters (other gods, Hathor, your own) with + Add another character.', 'Say what they are doing — e.g. playing poker.', 'Make it.'] },
  { id: 'remake', title: 'Remake an Ancient Artwork', cat: 'Create', url: '/remake', what: 'Upload a tomb painting, relief, fresco or vase and bring it to life: realistic, half vaporwave or the full MELEK look, keeping the same people, poses and composition.',
    howto: ['Open Remake.', 'Choose a clear photo or scan of the artwork.', 'Optionally say what is happening in it.', 'Pick a look and which people to show (or keep them as drawn).', 'Remake it — it takes a few minutes on our servers.'] },
  { id: 'remakes', title: 'Remakes Gallery', cat: 'Create', url: '/remakes', what: 'The ancient world re-rendered: scenes in three looks and several peoples side by side, next to the original.', howto: ['Open Remakes.', 'Switch looks with the tabs.', 'Share any scene by its # link.'] },
  { id: 'scripts', title: 'Ancient Scripts', cat: 'Create', url: '/scripts', what: 'Real letters of 29 ancient scripts (Phoenician/Paleo-Hebrew, cuneiform, hieroglyphs, runes, Ogham, Linear B, Brahmi, Tifinagh…) as free images, plus an inscription maker — instead of the fake writing image models invent.',
    howto: ['Open Ancient Scripts.', 'Pick a script.', 'Click signs to build an inscription (or shift-click to download one sign).', 'Choose a colour and Download PNG.', 'Use it in the Reference Studio or your own design.'] },
  { id: 'engines', title: 'Your Engines', cat: 'Create', url: '/engines', what: 'Make images on our servers free, or plug in your own: your own worker (PC, Colab, Modal GPU), a fal.ai or Gemini key, or your keys saved on Pentecaust. Use it when our free engine is busy.',
    howto: ['Open Your engines.', 'Pick an engine.', 'Paste its key or URL (stays in your browser), or Link Pentecaust.', 'Test it, then Save — the Generate box now uses it.'] },
  // — Edit / files —
  { id: 'edit', title: 'Photo Editor', cat: 'Edit', url: '/edit', what: 'Edit an image in your browser.', howto: ['Open Editor.', 'Load or upload an image.', 'Apply edits.', 'Download.'] },
  { id: 'filters', title: 'AI Art Filters (GIMP)', cat: 'Edit', url: '/filters', what: 'Hathor runs a real filter from any engine (ImageMagick, GMIC, GIMP) for you — painterly, cartoon, charcoal, sketch, sepia, glow.',
    howto: ['Open AI Art Filters.', 'Upload an image.', 'Pick a filter (oilify, cartoon, softglow, sharpen, scale).', 'Apply & download — Hathor runs GIMP headless for you.'] },
  { id: 'convert', title: 'Convert & Compress', cat: 'Files', url: '/convert', what: 'Convert/compress images, and complex files (3D, video, audio, vector, PSD, PDF).',
    howto: ['Open Convert.', 'For images: choose format + quality.', 'For complex files: choose a file, type the target extension (glb, gif, png, mp3…).', 'Convert & download.'] },
  { id: 'vectorize', title: 'Vectorize', cat: 'Files', url: '/vectorize', what: 'Turn a raster image into clean SVG for t-shirts/print.', howto: ['Open Vectorize.', 'Upload/open an image.', 'Vectorize → download SVG.'] },
  // — Video / capture —
  { id: 'video', title: 'Video', cat: 'Video', url: '/video', what: 'Make/animate video (BYOK for premium engines).', howto: ['Open Video.', 'Enter a prompt or image.', 'Generate; premium engines run BYOK in your browser.'] },
  { id: 'reels', title: 'Reels', cat: 'Video', url: '/reel-maker', what: 'Build a reel storyboard from a template.', howto: ['Open Reels.', 'Pick a template.', 'Fill it.', 'Download the storyboard/spec.'] },
  { id: 'webcam', title: 'Webcam Studio', cat: 'Video', url: '/webcam', what: 'Record with effects in-browser.', howto: ['Open Webcam.', 'Allow camera.', 'Pick an effect, record, download.'] },
  { id: 'cards', title: 'Cards', cat: 'Create', url: '/cards', what: 'Make a print-ready business card.', howto: ['Open Cards.', 'Fill details + logo.', 'Download 300 DPI print file.'] },
  // — Advanced / learn —
  { id: 'comfyui', title: 'ComfyUI Workflows', cat: 'Advanced', url: '/comfyui', what: 'Node-graph AI workflows you can run yourself.', howto: ['Open ComfyUI.', 'Pick a workflow (txt2img, controlnet-pose…).', 'Download the JSON, run it in ComfyUI.'] },
  { id: 'colab', title: 'Colab Notebooks', cat: 'Advanced', url: '/colab', what: 'Run models on free Google Colab GPU.', howto: ['Open Colab.', 'Pick a notebook.', 'Open in Colab, run on free GPU.'] },
  { id: 'school', title: 'GenAI School', cat: 'Learn', url: '/school', what: 'Learn to do all of this yourself — and publish to MELEK.', howto: ['Open School.', 'Follow the lessons.', 'Publish your work on-chain.'] },
  { id: 'shilpa-shastra', title: 'Shilpa Shastra (Gallery)', cat: 'Learn', url: '/gallery', what: 'The art gallery — figure/nude art as art (18+ toggle).', howto: ['Open Shilpa Shastra.', 'Toggle NSFW (18+) to see figure/nude art.'] },
];

export const CATEGORIES = [...new Set(TOOLS.map((t) => t.cat))];
export function toolsByCat() { const m = {}; for (const t of TOOLS) (m[t.cat] ||= []).push(t); return m; }
export function toolHowto(id) { return TOOLS.find((t) => t.id === id) || null; }

// Markdown for the WIKI (full instructionals) and a compact FORUM index (links to tools + wiki).
export function toolsWikiMarkdown() {
  let md = '# Hathor Studio — Tools & Instructionals\n\nEvery tool in the hub, with how to use it. Free, no login.\n';
  for (const [cat, tools] of Object.entries(toolsByCat())) {
    md += `\n## ${cat}\n`;
    for (const t of tools) { md += `\n### [${t.title}](${t.url})\n${t.what}\n\n`; t.howto.forEach((s, i) => (md += `${i + 1}. ${s}\n`)); }
  }
  return md;
}
export function toolsForumIndexMarkdown() {
  let md = '# Tools & Wiki index\n\nEverything you can make here, with links to each tool and its guide:\n\n';
  for (const [cat, tools] of Object.entries(toolsByCat())) {
    md += `**${cat}:** ` + tools.map((t) => `[${t.title}](${t.url})`).join(' · ') + '\n\n';
  }
  md += '\nFull guides on the Wiki. Ask questions here — link the tool you used.\n';
  return md;
}
