// brain-head-vision.mjs — Hathor's OCCIPITAL lobe: general-purpose SEEING, not nature-specific. One head
// over the whole native-CPU vision lane (transformers.js / ONNX, same as MiniLM) with a task->model
// registry so every vision capability is reachable and extensible:
//
//   classify(img, labels?)  zero-shot (CLIP) with your labels, or ImageNet image-classification
//   caption(img)            image-to-text (what is in this picture) — BLIP / ViT-GPT2
//   detect(img, labels?)    object detection (DETR) or zero-shot detection (OWL-ViT) with your labels
//   readText(img)           OCR (TrOCR) — read text out of an image
//   depth(img)              depth estimation
//   segment(img)            segmentation
//
// Image ID is TRAINED weights, not code (the retinal-sex / fried-chicken-vs-labradoodle lesson): this head
// seats pretrained nets and more can be pinned per task. Species/mushroom/bird fine-tunes and the DINOv2+
// FAISS exemplar index (ID-by-similarity that grows with photos) build ON this seam.
//
// Injectable + soft-fail (house style): tests inject a fake pipe (ZERO network/download); if a model can't
// load, each method soft-returns null/[] and never throws. Importing this module does NO work, pulls NO model.
//
//   import { createVisionHead } from './brain-head-vision.mjs';
//   const v = createVisionHead();
//   await v.classify('photo.jpg', ['a bird','a flower','a mushroom','a dog','a car','a document']);
//   await v.caption('photo.jpg');  await v.readText('receipt.png');
//
// Per-task model overrides: MELEK_VISION_CLASSIFY, MELEK_VISION_CAPTION, MELEK_VISION_DETECT,
//   MELEK_VISION_ZSDETECT, MELEK_VISION_OCR, MELEK_VISION_DEPTH, MELEK_VISION_SEGMENT, MELEK_VISION_IMAGENET

// task -> { pipeline-task, default model } (all verified Xenova ONNX repos on the native lane)
export const VISION_MODELS = {
  zeroShotClassify: { task: 'zero-shot-image-classification', model: process.env.MELEK_VISION_CLASSIFY || 'Xenova/clip-vit-base-patch32' },
  classify:         { task: 'image-classification',            model: process.env.MELEK_VISION_IMAGENET || 'Xenova/vit-base-patch16-224' },
  caption:          { task: 'image-to-text',                   model: process.env.MELEK_VISION_CAPTION  || 'Xenova/vit-gpt2-image-captioning' },
  detect:           { task: 'object-detection',                model: process.env.MELEK_VISION_DETECT   || 'Xenova/detr-resnet-50' },
  zeroShotDetect:   { task: 'zero-shot-object-detection',      model: process.env.MELEK_VISION_ZSDETECT || 'Xenova/owlvit-base-patch32' },
  ocr:              { task: 'image-to-text',                   model: process.env.MELEK_VISION_OCR      || 'Xenova/trocr-small-printed' },
  depth:            { task: 'depth-estimation',                model: process.env.MELEK_VISION_DEPTH    || 'Xenova/depth-anything-small-hf' },
  segment:          { task: 'image-segmentation',              model: process.env.MELEK_VISION_SEGMENT  || 'Xenova/detr-resnet-50-panoptic' },
  embed:            { task: 'image-feature-extraction',        model: process.env.MELEK_VISION_EMBED    || 'Xenova/dinov2-small' },
};

// Injectable factory for tests: async (pipelineTask, model) => (input, opts) => result. null = real loader.
let _factory = null;
export function __setPipelineFactory(fn) { _factory = typeof fn === 'function' ? fn : null; _cache.clear(); }

const _cache = new Map(); // key `${task}|${model}` -> pipe (or a pending promise)
async function loadPipe(task, model) {
  const key = `${task}|${model}`;
  if (_cache.has(key)) return _cache.get(key);
  const p = (async () => {
    if (_factory) { try { return await _factory(task, model); } catch { return null; } }
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      try { env.allowRemoteModels = true; } catch { /* older builds */ }
      return await pipeline(task, model);
    } catch { return null; } // soft-fail
  })();
  _cache.set(key, p);
  const pipe = await p;
  _cache.set(key, pipe); // replace the promise with the resolved pipe
  return pipe;
}

// Call the pipe with whatever positional args the task needs. Zero-shot tasks take candidate_labels as a
// POSITIONAL second arg in this transformers.js version (pipe(image, labels)), not inside an options object.
async function run(spec, input, ...rest) {
  try {
    const pipe = await loadPipe(spec.task, spec.model);
    if (!pipe) return null;
    return await pipe(input, ...rest);
  } catch { return null; }
}

export function createVisionHead(overrides = {}) {
  const M = { ...VISION_MODELS, ...overrides };
  return {
    models: M,
    /** Zero-shot with candidate `labels`, else ImageNet classification. Returns ranked [{label,score}] | null. */
    async classify(image, labels = null, k = 5) {
      if (Array.isArray(labels) && labels.length) {
        const out = await run(M.zeroShotClassify, image, labels); // candidate_labels positional
        return out ? (Array.isArray(out) ? out : [out]).slice(0, k) : null;
      }
      const out = await run(M.classify, image, { topk: k });
      return out ? (Array.isArray(out) ? out : [out]).slice(0, k) : null;
    },
    /** One-line description of the image. Returns string | null. */
    async caption(image) {
      const out = await run(M.caption, image);
      const r = Array.isArray(out) ? out[0] : out;
      return (r && (r.generated_text ?? r.text)) || null;
    },
    /** Objects in the image. labels -> zero-shot detection; else trained detector. Returns [] | detections. */
    async detect(image, labels = null) {
      if (Array.isArray(labels) && labels.length) return (await run(M.zeroShotDetect, image, labels)) || []; // positional
      return (await run(M.detect, image)) || [];
    },
    /** Read text out of an image (OCR). Returns string | null. */
    async readText(image) {
      const out = await run(M.ocr, image);
      const r = Array.isArray(out) ? out[0] : out;
      return (r && (r.generated_text ?? r.text)) || null;
    },
    async depth(image) { return await run(M.depth, image); },
    async segment(image) { return (await run(M.segment, image)) || []; },
    /** DINOv2 image embedding, mean-pooled to a compact Float32 vector for FAISS. Returns number[] | null. */
    async embed(image) {
      const out = await run(M.embed, image, { pooling: 'mean', normalize: true });
      if (!out) return null;
      const data = out.data ?? out[0]?.data ?? out;
      if (!data) return null;
      // image-feature-extraction often returns patch tokens [1, tokens, hidden]; mean-pool over tokens.
      const dims = out.dims || out[0]?.dims;
      if (dims && dims.length === 3 && dims[0] === 1) {
        const [, tokens, hidden] = dims;
        const pooled = new Array(hidden).fill(0);
        for (let t = 0; t < tokens; t++) for (let h = 0; h < hidden; h++) pooled[h] += data[t * hidden + h];
        for (let h = 0; h < hidden; h++) pooled[h] /= tokens;
        return pooled;
      }
      return Array.from(data);
    },
    /** The capabilities this lobe exposes (for introspection / the 'what can you see' answer). */
    capabilities() { return Object.keys(M); },
  };
}
