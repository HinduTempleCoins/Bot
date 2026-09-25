// genai-cpu-diffusion.mjs — OUR OWN image generator: Stable Diffusion on CPU, self-hosted, no rented API, no GPU.
//
// Operator direction (2026-09-25): "just do better on CPU — they did it in 1990"; "our customers are not going to be
// running on this Codespace — we have servers." So this is a small HTTP worker that lives on our own box (hathor-node,
// beside the Studio), holds ONE diffusion pipeline in memory, and renders jobs one at a time. The Studio's provider
// chain (genai-providers.mjs → `cpusd`) calls it first; rented engines are only fallbacks.
//
// Two modes:
//   txt2img  — prompt → a new picture.
//   img2img  — prompt + a reference image (e.g. a Hathor character sheet) → the character RE-RENDERED into a new
//              scene (the model redraws it; this is generation, not cut-and-paste compositing).
//
// It is slow (minutes per image on CPU), so jobs are single-flight: one render at a time, the rest wait in a queue.
//
//   POST /generate  { prompt, negativePrompt?, steps?, guidance?, seed?, size?, image?:{base64,mime}, strength? }
//        -> { ok:true, mime:'image/png', base64, ms, mode }  |  { ok:false, error }
//   GET  /health    -> { ok, loaded, busy, queued, model }
//
//   node integrations/genai-cpu-diffusion.mjs        # PORT=8510 HOST=127.0.0.1 by default
//
// House style: ESM, soft-fail-never-throw, handler(req,res) exported, CLI guarded, pipeline injectable for tests.

const env = (k, d = '') => (process.env[k] != null && process.env[k] !== '' ? String(process.env[k]) : d);
export const MODEL_ID = () => env('CPU_SD_MODEL', 'aislamov/stable-diffusion-2-1-base-onnx');
export const MODEL_REV = () => env('CPU_SD_REVISION', 'cpu');
const MAX_STEPS = 40;

let _loadPipeline = async () => {
  const { DiffusionPipeline } = await import('@aislamov/diffusers.js');
  return DiffusionPipeline.fromPretrained(MODEL_ID(), { revision: MODEL_REV() });
};
let _sharp = async () => (await import('sharp')).default;
export function __setPipelineLoader(fn) { _loadPipeline = fn; pipePromise = null; }
export function __setSharp(fn) { _sharp = fn; }

let pipePromise = null;
let loaded = false;
function pipeline() {
  if (!pipePromise) pipePromise = _loadPipeline().then((p) => { loaded = true; return p; }).catch((e) => { pipePromise = null; throw e; });
  return pipePromise;
}

// ── single-flight queue ─────────────────────────────────────────────────────────────────────────
let busy = false;
const waiting = [];
function enqueue(job) {
  return new Promise((resolve) => { waiting.push({ job, resolve }); pump(); });
}
async function pump() {
  if (busy || !waiting.length) return;
  busy = true;
  const { job, resolve } = waiting.shift();
  try { resolve(await render(job)); } catch (e) { resolve({ ok: false, error: 'render failed' }); }
  finally { busy = false; pump(); }
}
export function status() { return { ok: true, loaded, busy, queued: waiting.length, model: `${MODEL_ID()}@${MODEL_REV()}` }; }

export function normJob(input = {}) {
  const prompt = String(input.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  const negativePrompt = String(input.negativePrompt || 'blurry, low quality, deformed, extra limbs, text, watermark').slice(0, 600);
  let steps = parseInt(input.steps, 10); if (!(steps >= 4 && steps <= MAX_STEPS)) steps = 20;
  let guidance = Number(input.guidance); if (!(guidance >= 1 && guidance <= 15)) guidance = 7.5;
  let seed = parseInt(input.seed, 10); if (!(seed >= 0)) seed = Math.floor(Math.random() * 2 ** 31);
  let strength = Number(input.strength); if (!(strength > 0 && strength <= 1)) strength = 0.65;
  const image = input.image && input.image.base64 ? { base64: String(input.image.base64), mime: String(input.image.mime || 'image/png') } : null;
  return { prompt, negativePrompt, steps, guidance, seed: String(seed), strength, image, size: 512 };
}

// reference image → Float32 [1,3,S,S] in [-1,1] (the VAE encoder's input range)
async function imageTensor(b64, size) {
  const sharp = await _sharp();
  const { data } = await sharp(Buffer.from(b64, 'base64')).removeAlpha().resize(size, size, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
  const n = size * size; const f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { f[i] = data[i * 3] / 127.5 - 1; f[n + i] = data[i * 3 + 1] / 127.5 - 1; f[2 * n + i] = data[i * 3 + 2] / 127.5 - 1; }
  return f;
}

async function render(job) {
  if (!job.prompt) return { ok: false, error: 'empty prompt' };
  const t0 = Date.now();
  const pipe = await pipeline();
  const input = {
    prompt: job.prompt, negativePrompt: job.negativePrompt, numInferenceSteps: job.steps,
    guidanceScale: job.guidance, seed: job.seed, width: job.size, height: job.size,
  };
  if (job.image) { input.img2imgFlag = true; input.inputImage = await imageTensor(job.image.base64, job.size); input.strength = job.strength; }
  const images = await pipe.run(input);
  const t = await images[0].mul(255).round().clipByValue(0, 255).transpose(0, 2, 3, 1);
  const raw = Buffer.from(t.data);
  const side = Math.round(Math.sqrt(raw.length / 3));
  const sharp = await _sharp();
  const png = await sharp(raw, { raw: { width: side, height: side, channels: 3 } }).png().toBuffer();
  return { ok: true, mime: 'image/png', base64: png.toString('base64'), ms: Date.now() - t0, mode: job.image ? 'img2img' : 'txt2img', seed: job.seed };
}

/** Programmatic entry (tests / same-process callers). Never throws. */
export async function generate(input) {
  const job = normJob(input);
  if (!job.prompt) return { ok: false, error: 'empty prompt' };
  return enqueue(job);
}

function readBody(req, cap = 12 << 20) {
  return new Promise((resolve) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n <= cap) chunks.push(c); });
    req.on('end', () => resolve(n > cap ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

export async function handler(req, res) {
  const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const path = String(req.url || '/').split('?')[0];
  if (req.method === 'GET' && path === '/health') return j(200, status());
  if (req.method === 'POST' && path === '/generate') {
    const raw = await readBody(req);
    if (!raw) return j(413, { ok: false, error: 'body too large' });
    let body; try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { return j(400, { ok: false, error: 'bad json' }); }
    const out = await generate(body);
    return j(out.ok ? 200 : 422, out);
  }
  return j(404, { ok: false, error: 'not found' });
}

if (process.argv[1] && process.argv[1].endsWith('genai-cpu-diffusion.mjs')) {
  const http = await import('node:http');
  const PORT = Number(env('PORT', '8510')); const HOST = env('HOST', '127.0.0.1');
  http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end('{"ok":false}'); } catch {} }); })
    .listen(PORT, HOST, () => console.log(`cpu-diffusion worker on http://${HOST}:${PORT} (${MODEL_ID()}@${MODEL_REV()})`));
  if (env('CPU_SD_PRELOAD', '1') === '1') pipeline().then(() => console.log('pipeline loaded')).catch((e) => console.log('pipeline load failed:', e && e.message));
}
