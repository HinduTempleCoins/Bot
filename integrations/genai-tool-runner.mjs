// genai-tool-runner.mjs — ENGINE-AGNOSTIC tool-runner: Hathor drives creative apps FOR the user, headless
// on our box. NOT tied to one app — a registry of ENGINES (ImageMagick, G'MIC, GIMP now; Blender/Inkscape
// next), each exposing a WHITELIST of parameterized ops. The AI picks engine+op+params; we run it. SAFE:
// no arbitrary scripts (no RCE), params clamped, args passed as arrays (no shell), and every run is
// SANDBOXED with bubblewrap (read-only root, writable /work only, NO network) with a direct fallback.
//
//   import { ENGINES, enginesCatalog, runOp } from './genai-tool-runner.mjs'
//   await runOp('gmic', 'painting', '/tmp/in.png', {})   // -> { ok, outPath }
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, join, basename } from 'node:path';
import { existsSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const run = promisify(execFile);
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function sandboxArgs(work) {
  const ro = [];
  for (const d of ['/usr', '/bin', '/lib', '/lib64', '/etc', '/opt']) if (existsSync(d)) ro.push('--ro-bind', d, d);
  return [...ro, '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--bind', work, '/work', '--setenv', 'HOME', '/work', '--unshare-net', '--die-with-parent'];
}
let _hasBwrap = null;
async function hasBwrap() { if (_hasBwrap !== null) return _hasBwrap; try { await run('bwrap', ['--version'], { timeout: 5000 }); _hasBwrap = true; } catch { _hasBwrap = false; } return _hasBwrap; }

// GIMP Script-Fu wrapper (script-mode engine): load → flatten → op fragment → export png.
function gimpScript(inP, outP, frag) {
  return `(let* ((img (car (gimp-file-load RUN-NONINTERACTIVE "${inP}" "in"))) (draw (car (gimp-image-flatten img)))) ${frag} (gimp-image-flatten img) (file-png-save RUN-NONINTERACTIVE img (car (gimp-image-get-active-drawable img)) "${outP}" "o" 0 9 1 1 1 1 1))`;
}

// The engine registry. mode 'args' = argv builder; mode 'script' = GIMP Script-Fu frag builder.
export const ENGINES = {
  imagemagick: { bin: 'convert', mode: 'args', label: 'ImageMagick', ops: {
    oilpaint: { desc: 'oil-paint look', params: [{ key: 'radius', lo: 1, hi: 15, default: 4 }], args: (i, o, p) => [i, '-paint', String(p.radius), o] },
    charcoal: { desc: 'charcoal drawing', params: [{ key: 'radius', lo: 1, hi: 10, default: 2 }], args: (i, o, p) => [i, '-charcoal', String(p.radius), o] },
    sketch:   { desc: 'pencil sketch', params: [], args: (i, o) => [i, '-colorspace', 'Gray', '-sketch', '0x20+120', o] },
    sepia:    { desc: 'vintage sepia', params: [{ key: 'pct', lo: 50, hi: 99, default: 80 }], args: (i, o, p) => [i, '-sepia-tone', `${p.pct}%`, o] },
    blur:     { desc: 'soft blur', params: [{ key: 'sigma', lo: 1, hi: 20, default: 4 }], args: (i, o, p) => [i, '-blur', `0x${p.sigma}`, o] },
    resize:   { desc: 'resize to width', params: [{ key: 'width', lo: 16, hi: 8000, default: 1024 }], args: (i, o, p) => [i, '-resize', String(p.width), o] },
  } },
  gmic: { bin: 'gmic', mode: 'args', label: "G'MIC", ops: {
    painting:  { desc: 'painterly (G\'MIC fx_painting)', params: [], args: (i, o) => [i, 'fx_painting', '4,0.5,0.1,0.1,0,0', 'output', o] },
    cartoon:   { desc: 'bold cartoon (G\'MIC)', params: [], args: (i, o) => [i, 'cartoon', '3,200,20,0.25,1.5,8,0', 'output', o] },
    stylize:   { desc: 'stylized colour abstraction (G\'MIC)', params: [], args: (i, o) => [i, 'fx_color_abstraction', '1,10,0.2', 'output', o] },
  } },
  gimp: { bin: 'gimp', mode: 'script', label: 'GIMP', ops: {
    oilify:   { desc: 'oil painting', params: [{ key: 'size', lo: 1, hi: 30, default: 8 }], frag: (p) => `(plug-in-oilify RUN-NONINTERACTIVE img draw ${p.size} 0)` },
    softglow: { desc: 'soft glow', params: [{ key: 'glow', lo: 0, hi: 1, default: 0.75 }], frag: (p) => `(plug-in-softglow RUN-NONINTERACTIVE img draw 10 ${p.glow} ${p.glow})` },
  } },
};

export function enginesCatalog() {
  return Object.entries(ENGINES).map(([id, e]) => ({ id, label: e.label, ops: Object.entries(e.ops).map(([op, s]) => ({ op, desc: s.desc, params: s.params.map((x) => x.key) })) }));
}
export function opExists(engine, op) { return !!(ENGINES[engine] && ENGINES[engine].ops[op]); }

// Run any engine op, sandboxed. inPath must be a path WE control. Soft-fails.
export async function runOp(engine, op, inPath, rawParams = {}, { timeout = 90000 } = {}) {
  const eng = ENGINES[engine];
  if (!eng || !eng.ops[op]) return { ok: false, error: `unknown engine/op: ${engine}/${op}` };
  const spec = eng.ops[op];
  const p = {}; for (const d of (spec.params || [])) p[d.key] = clamp(rawParams[d.key], d.lo, d.hi, d.default);
  let work;
  try {
    work = mkdtempSync(join(tmpdir(), 'tr-'));
    const inWork = join(work, 'in' + (extname(inPath) || '.png'));
    copyFileSync(inPath, inWork);
    const sandbox = await hasBwrap();
    const inArg = sandbox ? `/work/${basename(inWork)}` : inWork;
    const outArg = sandbox ? '/work/out.png' : join(work, 'out.png');
    const outReal = join(work, 'out.png');
    let bin, args;
    if (eng.mode === 'script') { bin = eng.bin; args = ['-i', '-b', gimpScript(inArg, outArg, spec.frag(p)), '-b', '(gimp-quit 0)']; }
    else { bin = eng.bin; args = spec.args(inArg, outArg, p); }
    if (sandbox) { args = [...sandboxArgs(work), bin, ...args]; bin = 'bwrap'; }
    await run(bin, args, { timeout, maxBuffer: 1 << 26 });
    if (!existsSync(outReal)) return { ok: false, error: `${engine}/${op}: no output` };
    return { ok: true, outPath: outReal, engine, op, sandboxed: sandbox };
  } catch (e) { return { ok: false, error: `${engine}/${op} failed: ${String(e && e.message).slice(0, 160)}` }; }
}
