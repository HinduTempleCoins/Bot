// genai-colab-templates.mjs — a curated library of Google-Colab notebook templates for the GenAI page.
//
// THE IDEA (operator's spec, GenAI phase 2): the page doesn't run the notebooks — it curates a teach
// layer of well-known, runnable Colab notebooks (image gen, fine-tune, audio, video, upscale, …) as
// launch links + honest descriptions. Free Colab gives a GPU for a while; we point people at the good
// notebooks and say plainly what each one needs.
//
// Pure data + lookups + one pure URL builder. No network, no keys, no side effects — fully testable.
//
//   listColab()              -> all notebooks
//   getColab(id)             -> one or null
//   colabByKind(kind)        -> notebooks of a kind
//   colabLaunchUrl(id)       -> the https://colab.research.google.com/... open-in-Colab URL ('' if none)
//   validateColabTemplates() -> integrity check for /health + tests
//
// Each notebook:
//   { id, title, kind, summary, gpu (what it needs), repo (github/HF the notebook lives in),
//     notebookUrl (a github/HF/raw .ipynb URL — we build the Colab launch link from it),
//     colabUrl (optional explicit colab.research.google.com link, used as-is if present) }
//
// Kinds: image | finetune | audio | video | upscale | text

export const COLAB_KINDS = ['image', 'finetune', 'audio', 'video', 'upscale', 'text'];

// Colab opens a github-hosted notebook via https://colab.research.google.com/github/<owner>/<repo>/blob/<path>
const COLAB_GH = 'https://colab.research.google.com/github/';

export const COLAB_TEMPLATES = [
  {
    id: 'comfyui-in-colab',
    title: 'ComfyUI in Colab',
    kind: 'image',
    summary: 'Run a full ComfyUI server inside Colab with a public tunnel — then load any of our ComfyUI workflow templates. The bridge between the two layers on this page.',
    gpu: 'free T4 is enough for SD1.5/SDXL; FLUX wants more',
    repo: 'comfyanonymous/ComfyUI',
    notebookUrl: 'https://github.com/comfyanonymous/ComfyUI/blob/master/notebooks/comfyui_colab.ipynb',
  },
  {
    id: 'sdxl-diffusers',
    title: 'SDXL with 🤗 Diffusers',
    kind: 'image',
    summary: 'Generate images with SDXL using the Hugging Face Diffusers library — a few cells, very approachable. Good first notebook for text-to-image.',
    gpu: 'free T4',
    repo: 'huggingface/notebooks',
    notebookUrl: 'https://github.com/huggingface/notebooks/blob/main/diffusers/stable_diffusion.ipynb',
  },
  {
    id: 'dreambooth-lora',
    title: 'DreamBooth LoRA — Fine-tune SDXL on your subject',
    kind: 'finetune',
    summary: 'Train a small LoRA so the model learns a specific person, object, or style from a handful of images. Outputs a tiny .safetensors you load anywhere.',
    gpu: 'free T4 works for LoRA; full DreamBooth wants more VRAM',
    repo: 'huggingface/notebooks',
    notebookUrl: 'https://github.com/huggingface/notebooks/blob/main/diffusers/SDXL_DreamBooth_LoRA_.ipynb',
  },
  {
    id: 'musicgen',
    title: 'MusicGen — Text to Music',
    kind: 'audio',
    summary: 'Generate short music clips from a text description with Meta\'s MusicGen. Great for blog/reel background cues — pair the output with the reel template maker.',
    gpu: 'free T4',
    repo: 'facebookresearch/audiocraft',
    notebookUrl: 'https://github.com/facebookresearch/audiocraft/blob/main/demos/musicgen_demo.ipynb',
  },
  {
    id: 'bark-tts',
    title: 'Bark — Text to Speech / Voice',
    kind: 'audio',
    summary: 'Generate spoken audio (and sound effects) from text with Bark. Useful for voiceover on reels and tutorials.',
    gpu: 'free T4',
    repo: 'suno-ai/bark',
    notebookUrl: 'https://github.com/suno-ai/bark/blob/main/notebooks/long_form_generation.ipynb',
  },
  {
    id: 'whisper-transcribe',
    title: 'Whisper — Transcribe audio to text',
    kind: 'text',
    summary: 'Transcribe (and translate) audio with OpenAI Whisper — turn a recording into captions for your reel or a transcript for a post.',
    gpu: 'free T4 (or CPU for the small models)',
    repo: 'openai/whisper',
    notebookUrl: 'https://github.com/openai/whisper/blob/main/notebooks/LibriSpeech.ipynb',
  },
  {
    id: 'animatediff',
    title: 'AnimateDiff — Text to short video',
    kind: 'video',
    summary: 'Generate short animated clips from a prompt with AnimateDiff motion modules on top of SD. A free-tier on-ramp to text-to-video.',
    gpu: 'free T4 (short clips); more VRAM for longer/HD',
    repo: 'huggingface/notebooks',
    notebookUrl: 'https://github.com/huggingface/notebooks/blob/main/diffusers/animatediff.ipynb',
  },
  {
    id: 'realesrgan-upscale',
    title: 'Real-ESRGAN — Upscale & restore images',
    kind: 'upscale',
    summary: 'Upscale and clean up photos and art (including a face-enhance mode) with Real-ESRGAN. Fast, no diffusion — a good finishing step.',
    gpu: 'free T4 (or CPU, slower)',
    repo: 'xinntao/Real-ESRGAN',
    notebookUrl: 'https://github.com/xinntao/Real-ESRGAN/blob/master/inference_realesrgan.py',
    colabUrl: 'https://colab.research.google.com/drive/1k2Zod6kSHEvraybHl50Lys0LerhyTMCo',
  },
  {
    id: 'flux-diffusers',
    title: 'FLUX.1 with 🤗 Diffusers',
    kind: 'image',
    summary: 'Run FLUX.1 — top-tier prompt following and text-in-image — via Diffusers. Heavier; use the [schnell] variant or quantization on the free tier.',
    gpu: 'free T4 only with the schnell/quantized variant; [dev] wants more',
    repo: 'huggingface/notebooks',
    notebookUrl: 'https://github.com/huggingface/notebooks/blob/main/diffusers/flux.ipynb',
  },
];

const BY_ID = new Map(COLAB_TEMPLATES.map((t) => [t.id, t]));
export function listColab() { return COLAB_TEMPLATES; }
export function getColab(id) { return BY_ID.get(String(id || '')) || null; }
export function colabByKind(kind) { return COLAB_TEMPLATES.filter((t) => t.kind === kind); }

// colabLaunchUrl — the "Open in Colab" link. Prefers an explicit colabUrl; otherwise builds the
// github-launch URL from a github blob URL. Returns '' if we can't form a valid Colab link (soft-fail).
export function colabLaunchUrl(id) {
  const t = getColab(id);
  if (!t) return '';
  if (t.colabUrl && /^https:\/\/colab\.research\.google\.com\//.test(t.colabUrl)) return t.colabUrl;
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/.exec(String(t.notebookUrl || ''));
  if (m) return COLAB_GH + m[1] + '/blob/' + m[2];
  return '';
}

// integrity check for /health + tests
export function validateColabTemplates() {
  const errors = [];
  const seen = new Set();
  for (const t of COLAB_TEMPLATES) {
    if (!t.id) { errors.push('colab template with no id'); continue; }
    if (seen.has(t.id)) errors.push(`duplicate id: ${t.id}`);
    seen.add(t.id);
    if (!t.title) errors.push(`${t.id}: no title`);
    if (!COLAB_KINDS.includes(t.kind)) errors.push(`${t.id}: bad kind ${t.kind}`);
    if (!t.summary) errors.push(`${t.id}: no summary`);
    if (!t.gpu) errors.push(`${t.id}: no gpu note`);
    const url = colabLaunchUrl(t.id);
    if (!/^https:\/\/colab\.research\.google\.com\//.test(url)) errors.push(`${t.id}: no valid Colab launch URL`);
  }
  return { ok: errors.length === 0, errors, count: COLAB_TEMPLATES.length };
}

if (process.argv[1] && process.argv[1].endsWith('genai-colab-templates.mjs')) {
  const v = validateColabTemplates();
  console.log(`${COLAB_TEMPLATES.length} Colab templates · ${v.ok ? '✓ valid' : '✗ ' + v.errors.join('; ')}`);
  for (const t of COLAB_TEMPLATES) console.log(`  [${t.kind}] ${t.id} → ${colabLaunchUrl(t.id)}`);
}
