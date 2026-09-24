// genai-convert.mjs — the hub's FILE-CONVERSION engine for the complex creative formats we actually
// work in (3D game assets, vector/print, animation, audio, layered/raster, PDF). Dispatches to the
// FREE/CPU tools WE hold on the box — ffmpeg, ImageMagick, assimp, rsvg-convert, ghostscript, qpdf.
// No GPU, no paid service. ("We hold the libraries.")
//
// SAFE BY CONSTRUCTION: extensions are allow-listed; args are passed as an ARRAY to execFile (no shell,
// no injection); every run has a hard timeout; paths are caller-controlled temp files. The catalog +
// arg-builder are PURE and offline-testable; only convert() touches the filesystem/child process.
//
//   import { supportedTargets, buildArgs, convert, CONVERSIONS } from './genai-convert.mjs'
//   const out = await convert('/tmp/model.fbx', 'glb')        // → { ok, outPath }
//   node integrations/genai-convert.mjs in.fbx glb            // CLI

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, join, dirname, basename } from 'node:path';
const run = promisify(execFile);

// group → { tool, from[], to[] }. `to` = formats we can PRODUCE for that group.
export const CONVERSIONS = [
  { group: '3d', tool: 'assimp', from: ['obj', 'fbx', 'gltf', 'glb', 'stl', 'dae', 'ply', '3ds', 'x'], to: ['obj', 'gltf', 'glb', 'stl', 'ply', 'dae'] },
  { group: 'video', tool: 'ffmpeg', from: ['mp4', 'webm', 'mov', 'gif', 'avi', 'mkv', 'apng', 'm4v'], to: ['mp4', 'webm', 'gif', 'apng'] },
  { group: 'audio', tool: 'ffmpeg', from: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'], to: ['mp3', 'ogg', 'wav', 'flac'] },
  { group: 'vector', tool: 'rsvg-convert', from: ['svg'], to: ['png', 'pdf'] },
  { group: 'raster', tool: 'magick', from: ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp', 'psd', 'gif', 'avif', 'heic'], to: ['png', 'jpg', 'webp', 'tiff', 'pdf'] },
  { group: 'pdf', tool: 'gs', from: ['pdf'], to: ['pdf'] }, // compress
];

const norm = (f) => String(f || '').replace(/^\./, '').toLowerCase().replace('jpeg', 'jpg');

// what can this input become? (union across every group that can READ it)
export function supportedTargets(fromExt) {
  const f = norm(fromExt);
  const out = new Set();
  for (const c of CONVERSIONS) if (c.from.includes(f)) for (const t of c.to) if (t !== f) out.add(t);
  return [...out];
}

// pick the group/tool that converts from→to
export function pickTool(fromExt, toExt) {
  const f = norm(fromExt), t = norm(toExt);
  const c = CONVERSIONS.find((x) => x.from.includes(f) && x.to.includes(t));
  return c ? c.tool : null;
}

// PURE arg-builder → { bin, args } (no execution). Throws on an unsupported pair.
export function buildArgs(inPath, outPath, opts = {}) {
  const f = norm(extname(inPath)), t = norm(extname(outPath));
  const tool = pickTool(f, t);
  if (!tool) throw new Error(`unsupported conversion ${f} → ${t}`);
  const q = Number.isFinite(+opts.quality) ? Math.min(100, Math.max(1, +opts.quality)) : 80;
  switch (tool) {
    case 'assimp': return { bin: 'assimp', args: ['export', inPath, outPath] };
    case 'ffmpeg': {
      const a = ['-y', '-i', inPath];
      if (t === 'gif') a.push('-vf', 'fps=15,scale=480:-1:flags=lanczos');
      return { bin: 'ffmpeg', args: [...a, outPath] };
    }
    case 'rsvg-convert': {
      if (t === 'pdf') return { bin: 'rsvg-convert', args: ['-f', 'pdf', '-o', outPath, inPath] };
      return { bin: 'rsvg-convert', args: ['-o', outPath, inPath] };
    }
    case 'magick': return { bin: 'magick', args: [inPath, '-quality', String(q), outPath] };
    case 'gs': return { bin: 'gs', args: ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/ebook', '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${outPath}`, inPath] };
    default: throw new Error(`no builder for ${tool}`);
  }
}

// run the conversion (child process, hard timeout). outPath defaults next to input.
export async function convert(inPath, toExt, opts = {}) {
  const t = norm(toExt);
  const outPath = opts.outPath || join(dirname(inPath), basename(inPath, extname(inPath)) + '.' + t);
  let bin, args;
  try { ({ bin, args } = buildArgs(inPath, outPath, opts)); }
  catch (e) { return { ok: false, error: String(e && e.message) }; }
  try {
    await run(bin, args, { timeout: opts.timeout || 120000, maxBuffer: 1 << 26 });
    return { ok: true, outPath, tool: bin };
  } catch (e) { return { ok: false, error: `convert failed: ${String(e && e.message).slice(0, 200)}` }; }
}

// all input→output pairs we advertise (for a UI / catalog)
export function catalog() {
  const map = {};
  for (const c of CONVERSIONS) for (const f of c.from) map[f] = supportedTargets(f);
  return map;
}

if (process.argv[1] && process.argv[1].endsWith('genai-convert.mjs')) {
  const [inp, to] = process.argv.slice(2);
  if (!inp || !to) { console.log('catalog:', JSON.stringify(catalog(), null, 2)); }
  else { const r = await convert(inp, to); console.log(JSON.stringify(r)); }
}
