// genai-comfyui-templates.mjs — a curated library of ComfyUI workflow templates for the GenAI page.
//
// THE IDEA (operator's spec, GenAI phase 2): the page does NOT run ComfyUI — it curates a library of
// ready-to-import workflow graphs users copy/download into THEIR OWN ComfyUI. Each entry has a plain
// description + a minimal-but-real workflow JSON (the ComfyUI "API format" graph) the page hands off as
// a downloadable .json, plus an optional upstream link for the full/heavier version.
//
// Pure data + lookups + one pure exporter. No network, no keys, no side effects — fully testable offline.
//
//   listComfy()                -> all templates
//   getComfy(id)               -> one template or null
//   comfyByKind(kind)          -> templates of a kind
//   workflowJson(id)           -> pretty-printed workflow JSON string (downloadable), '' if unknown
//   validateComfyTemplates()   -> integrity check for /health + tests
//
// Each template:
//   { id, title, kind, summary, nodes (count, informational), models:[...], link (optional upstream),
//     workflow:{...} }  — `workflow` is a ComfyUI-shaped node graph (the small, importable version).
//
// Kinds: txt2img | upscale | inpaint | img2img | video | controlnet

export const COMFY_KINDS = ['txt2img', 'upscale', 'inpaint', 'img2img', 'video', 'controlnet'];

// A minimal-but-valid ComfyUI graph is a map of node-id -> { class_type, inputs }. The graphs below are
// deliberately small, canonical starters — they import cleanly and are easy for a user to extend.
export const COMFY_TEMPLATES = [
  {
    id: 'sd15-txt2img-basic',
    title: 'Stable Diffusion 1.5 — Text to Image (basic)',
    kind: 'txt2img',
    summary: 'The canonical starter graph: load a checkpoint, encode a positive + negative prompt, KSample, decode, save. Swap in any SD1.5 checkpoint.',
    models: ['v1-5-pruned-emaonly.safetensors (or any SD1.5 checkpoint)'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/',
    workflow: {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a majestic Egyptian temple at golden hour, cinematic, highly detailed', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality, watermark, text', clip: ['4', 1] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK', images: ['8', 0] } },
    },
  },
  {
    id: 'sdxl-txt2img',
    title: 'SDXL — Text to Image',
    kind: 'txt2img',
    summary: 'SDXL base checkpoint at 1024×1024. Higher fidelity than SD1.5; needs more VRAM. Same shape as the basic graph with an SDXL checkpoint and a 1024 latent.',
    models: ['sd_xl_base_1.0.safetensors'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/sdxl/',
    workflow: {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'an angelic figure with vast feathered wings, radiant halo, fine art', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, deformed, low quality', clip: ['4', 1] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 25, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-SDXL', images: ['8', 0] } },
    },
  },
  {
    id: 'flux-txt2img',
    title: 'FLUX.1 [dev] — Text to Image',
    kind: 'txt2img',
    summary: 'FLUX uses a separate UNET + dual CLIP/T5 text encoders + a FLUX VAE. State-of-the-art prompt following and text-in-image. Heavy: best on a good GPU. Grab the model files from the linked example page.',
    models: ['flux1-dev.safetensors', 'clip_l.safetensors', 't5xxl_fp16.safetensors', 'ae.safetensors'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/flux/',
    workflow: {
      '12': { class_type: 'UNETLoader', inputs: { unet_name: 'flux1-dev.safetensors', weight_dtype: 'default' } },
      '11': { class_type: 'DualCLIPLoader', inputs: { clip_name1: 't5xxl_fp16.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' } },
      '10': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a clean circular MELEK coin logo, ankh motif, gold metallic finish, vector style', clip: ['11', 0] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1, model: ['12', 0], positive: ['6', 0], negative: ['6', 0], latent_image: ['5', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['10', 0] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-FLUX', images: ['8', 0] } },
    },
  },
  {
    id: 'upscale-latent-2x',
    title: 'Upscale — Latent 2× (hires fix)',
    kind: 'upscale',
    summary: 'Generate at base resolution, upscale the latent 2×, then a second low-denoise KSampler pass for crisp detail. The classic "hires fix" pipeline.',
    models: ['any SD1.5/SDXL checkpoint'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/2_pass_txt2img/',
    workflow: {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'an ornate manuscript page, illuminated, intricate detail', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['4', 1] } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '10': { class_type: 'LatentUpscale', inputs: { upscale_method: 'nearest-exact', width: 1024, height: 1024, crop: 'disabled', samples: ['3', 0] } },
      '11': { class_type: 'KSampler', inputs: { seed: 0, steps: 14, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 0.5, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['10', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-hires', images: ['8', 0] } },
    },
  },
  {
    id: 'upscale-model-esrgan',
    title: 'Upscale — Model (ESRGAN / 4×)',
    kind: 'upscale',
    summary: 'Take an existing image and upscale it with a pixel-space upscale model (e.g. 4x-UltraSharp / RealESRGAN). No diffusion — fast, deterministic, great for finishing.',
    models: ['4x-UltraSharp.pth (or any ESRGAN-family upscale model)'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/upscale_models/',
    workflow: {
      '1': { class_type: 'LoadImage', inputs: { image: 'your-image.png' } },
      '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } },
      '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-upscaled', images: ['3', 0] } },
    },
  },
  {
    id: 'inpaint-basic',
    title: 'Inpaint — Mask & Regenerate',
    kind: 'inpaint',
    summary: 'Load an image with a mask (paint the area to change in the Load Image node), encode it for inpainting, and KSample only the masked region. Good for fixing or replacing parts of an image.',
    models: ['any SD1.5 inpainting checkpoint'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/inpaint/',
    workflow: {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
      '1': { class_type: 'LoadImage', inputs: { image: 'your-image.png' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a golden ankh, intricate detail', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['4', 1] } },
      '12': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['1', 0], vae: ['4', 2], mask: ['1', 1], grow_mask_by: 6 } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['12', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-inpaint', images: ['8', 0] } },
    },
  },
  {
    id: 'img2img-basic',
    title: 'Image to Image — Restyle',
    kind: 'img2img',
    summary: 'Feed an existing image into the latent and run a partial-denoise KSampler to restyle it while keeping the composition. Lower denoise = closer to the original.',
    models: ['any SD1.5/SDXL checkpoint'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/img2img/',
    workflow: {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
      '1': { class_type: 'LoadImage', inputs: { image: 'your-image.png' } },
      '12': { class_type: 'VAEEncode', inputs: { pixels: ['1', 0], vae: ['4', 2] } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'vaporwave aesthetic, neon grid, retro synthwave', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['4', 1] } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 0.6, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['12', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-img2img', images: ['8', 0] } },
    },
  },
  {
    id: 'svd-img2video',
    title: 'Stable Video Diffusion — Image to Video',
    kind: 'video',
    summary: 'Animate a single still into a short clip with Stable Video Diffusion. Load the SVD checkpoint, feed your image, sample the video latents, decode to frames. Heavy — needs a capable GPU.',
    models: ['svd_xt.safetensors'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/video/',
    workflow: {
      '15': { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: 'svd_xt.safetensors' } },
      '1': { class_type: 'LoadImage', inputs: { image: 'your-image.png' } },
      '12': { class_type: 'SVD_img2vid_Conditioning', inputs: { width: 1024, height: 576, video_frames: 14, motion_bucket_id: 127, fps: 6, augmentation_level: 0, clip_vision: ['15', 1], init_image: ['1', 0], vae: ['15', 2] } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20, cfg: 2.5, sampler_name: 'euler', scheduler: 'karras', denoise: 1, model: ['15', 0], positive: ['12', 0], negative: ['12', 1], latent_image: ['12', 2] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['15', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-svd', images: ['8', 0] } },
    },
  },
  {
    id: 'controlnet-pose',
    title: 'ControlNet — Pose / Edge Guided',
    kind: 'controlnet',
    summary: 'Steer generation with a control image (pose, depth, canny edges). Load a ControlNet model, apply it to the conditioning, and the output follows your control image structure.',
    models: ['control_v11p_sd15_openpose.pth (or canny/depth)', 'any SD1.5 checkpoint'],
    link: 'https://comfyanonymous.github.io/ComfyUI_examples/controlnet/',
    workflow: {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
      '13': { class_type: 'ControlNetLoader', inputs: { control_net_name: 'control_v11p_sd15_openpose.pth' } },
      '1': { class_type: 'LoadImage', inputs: { image: 'control-pose.png' } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a robed sage standing, fine art portrait', clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['4', 1] } },
      '14': { class_type: 'ControlNetApply', inputs: { conditioning: ['6', 0], control_net: ['13', 0], image: ['1', 0], strength: 1 } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 768, batch_size: 1 } },
      '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['14', 0], negative: ['7', 0], latent_image: ['5', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'MELEK-controlnet', images: ['8', 0] } },
    },
  },
];

const BY_ID = new Map(COMFY_TEMPLATES.map((t) => [t.id, t]));
export function listComfy() { return COMFY_TEMPLATES; }
export function getComfy(id) { return BY_ID.get(String(id || '')) || null; }
export function comfyByKind(kind) { return COMFY_TEMPLATES.filter((t) => t.kind === kind); }

// node count is informational (shown in the UI); derived, not stored, so it can't drift.
export function comfyNodeCount(id) { const t = getComfy(id); return t ? Object.keys(t.workflow || {}).length : 0; }

// workflowJson — the downloadable artifact. Pretty-printed; '' for unknown id (soft-fail).
export function workflowJson(id) {
  const t = getComfy(id);
  if (!t || !t.workflow) return '';
  try { return JSON.stringify(t.workflow, null, 2); } catch { return ''; }
}

// integrity check (for /health + a test): every template well-formed, every workflow a valid node graph
// where every node-input reference points at a node that exists.
export function validateComfyTemplates() {
  const errors = [];
  const seen = new Set();
  for (const t of COMFY_TEMPLATES) {
    if (!t.id) { errors.push('comfy template with no id'); continue; }
    if (seen.has(t.id)) errors.push(`duplicate id: ${t.id}`);
    seen.add(t.id);
    if (!t.title) errors.push(`${t.id}: no title`);
    if (!COMFY_KINDS.includes(t.kind)) errors.push(`${t.id}: bad kind ${t.kind}`);
    if (!t.summary) errors.push(`${t.id}: no summary`);
    if (!Array.isArray(t.models) || !t.models.length) errors.push(`${t.id}: no models`);
    const wf = t.workflow;
    if (!wf || typeof wf !== 'object' || !Object.keys(wf).length) { errors.push(`${t.id}: empty workflow`); continue; }
    const ids = new Set(Object.keys(wf));
    let hasSave = false;
    for (const [nid, node] of Object.entries(wf)) {
      if (!node || !node.class_type) { errors.push(`${t.id}: node ${nid} has no class_type`); continue; }
      if (/save/i.test(node.class_type)) hasSave = true;
      const inputs = node.inputs || {};
      for (const v of Object.values(inputs)) {
        // a wire is [nodeId, slotIndex]; verify the referenced node exists
        if (Array.isArray(v) && v.length === 2 && typeof v[1] === 'number') {
          if (!ids.has(String(v[0]))) errors.push(`${t.id}: node ${nid} references missing node ${v[0]}`);
        }
      }
    }
    if (!hasSave) errors.push(`${t.id}: workflow has no Save node (no output)`);
    // the exporter must round-trip
    try { JSON.parse(workflowJson(t.id)); } catch { errors.push(`${t.id}: workflow does not serialize`); }
  }
  return { ok: errors.length === 0, errors, count: COMFY_TEMPLATES.length };
}

if (process.argv[1] && process.argv[1].endsWith('genai-comfyui-templates.mjs')) {
  const v = validateComfyTemplates();
  console.log(`${COMFY_TEMPLATES.length} ComfyUI templates · ${v.ok ? '✓ valid' : '✗ ' + v.errors.join('; ')}`);
  for (const t of COMFY_TEMPLATES) console.log(`  [${t.kind}] ${t.id} — ${comfyNodeCount(t.id)} nodes`);
}
