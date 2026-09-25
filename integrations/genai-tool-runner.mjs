// genai-tool-runner.mjs — Hathor drives creative apps FOR the user, headless on our box. SAFE BY DESIGN:
// only a WHITELIST of parameterized operations (no arbitrary Script-Fu/Python from users or the AI = no
// RCE). Each op is a template with clamped numeric params; the AI picks op + params, we run it. First app:
// GIMP (2.10 headless) for artistic filters beyond ImageMagick. Blender/others add the same way.
//
//   import { GIMP_OPS, buildGimpScript, runGimp } from './genai-tool-runner.mjs'
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, dirname, join, basename } from 'node:path';
const run = promisify(execFile);

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// op -> { params:[{key,lo,hi,default}], script(drawableExpr, p) => Script-Fu fragment applied to the drawable }
export const GIMP_OPS = {
  oilify:   { desc: 'painterly oil-painting look', params: [{ key: 'size', lo: 1, hi: 30, default: 8 }],
              frag: (p) => `(plug-in-oilify RUN-NONINTERACTIVE img draw ${p.size} 0)` },
  cartoon:  { desc: 'bold cartoon outlines', params: [{ key: 'radius', lo: 1, hi: 50, default: 7 }, { key: 'black', lo: 0, hi: 1, default: 0.2 }],
              frag: (p) => `(plug-in-cartoon RUN-NONINTERACTIVE img draw ${p.radius} ${p.black})` },
  sharpen:  { desc: 'unsharp-mask sharpen', params: [{ key: 'amount', lo: 0, hi: 5, default: 0.5 }],
              frag: (p) => `(plug-in-unsharp-mask RUN-NONINTERACTIVE img draw 3 ${p.amount} 0)` },
  softglow: { desc: 'dreamy soft glow', params: [{ key: 'glow', lo: 0, hi: 1, default: 0.75 }],
              frag: (p) => `(plug-in-softglow RUN-NONINTERACTIVE img draw 10 ${p.glow} ${p.glow})` },
  scale:    { desc: 'resize to a max width', params: [{ key: 'width', lo: 16, hi: 4096, default: 1024 }],
              frag: () => '', scaleTo: true },
};

// Build a safe Script-Fu batch string for a whitelisted op with clamped params.
export function buildGimpScript(inPath, outPath, op, rawParams = {}) {
  const spec = GIMP_OPS[op];
  if (!spec) throw new Error(`unknown gimp op: ${op}`);
  const p = {}; for (const d of spec.params) p[d.key] = clamp(rawParams[d.key], d.lo, d.hi, d.default);
  const load = `(let* ((img (car (gimp-file-load RUN-NONINTERACTIVE "${inPath}" "in"))) (draw (car (gimp-image-flatten img))))`;
  const body = spec.scaleTo
    ? `(gimp-image-scale img ${p.width} (round (* ${p.width} (/ (car (gimp-image-height img)) (car (gimp-image-width img))))))`
    : spec.frag(p);
  const save = `(gimp-image-flatten img) (file-png-save RUN-NONINTERACTIVE img (car (gimp-image-get-active-drawable img)) "${outPath}" "o" 0 9 1 1 1 1 1))`;
  return `${load} ${body} ${save}`;
}

export function gimpOps() { return Object.entries(GIMP_OPS).map(([id, s]) => ({ id, desc: s.desc, params: s.params.map((x) => x.key) })); }

// Run a GIMP op headless. inPath must be a path WE control (a saved upload). Soft-fails.
export async function runGimp(inPath, op, params = {}, { timeout = 60000 } = {}) {
  let script, outPath;
  try {
    outPath = join(dirname(inPath), `${basename(inPath, extname(inPath))}.${op}.png`);
    script = buildGimpScript(inPath, outPath, op, params);
  } catch (e) { return { ok: false, error: String(e && e.message) }; }
  try {
    await run('gimp', ['-i', '-b', script, '-b', '(gimp-quit 0)'], { timeout, maxBuffer: 1 << 26 });
    return { ok: true, outPath, op };
  } catch (e) { return { ok: false, error: `gimp failed: ${String(e && e.message).slice(0, 160)}` }; }
}
