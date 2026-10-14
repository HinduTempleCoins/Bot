// pentecaust/herald/release-art.mjs — the Herald × GenAI merge, piece 1: give every press release a
// NATIVE hero image.
//
// The wire (wire.mjs) already renders a release `image` and puts it in the NewsArticle schema — releases
// just don't have one. This generates one on our OWN native CPU-SD worker (genai-cpu-diffusion, :8510,
// the same worker gen-marketing-batch.mjs drives), hosts it, and writes a sidecar map that the wire reads.
// NO Pollinations, no Gemini, no outside API — native stack only (operator rule).
//
// Design mirrors witness/hathor-post-image.mjs (derive prompt → generate → host → attach) but writes to a
// sidecar `data/release-art.json` { slug: url } instead of rewriting the 93 release .md files, so the wire
// gets images without touching the authored releases.
//
//   # run on the worker's box (slow — CPU, one render at a time):
//   CPU_SD_URL=http://127.0.0.1:8510 CPU_SD_TOKEN=… ART_BASE=https://hathor.soapbox.community/remakes/img/press \
//     node pentecaust/herald/release-art.mjs [--limit=5] [--only=slug-a,slug-b]
//
//   loadArtMap() / artFor(slug)  — read by wire.mjs for the image fallback.
// OFFLINE-TESTABLE: the worker fetch + the hoster are injected (__setFetch / __setHoster); no network at import.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
export const ART_FILE = () => process.env.RELEASE_ART_FILE || join(REPO, 'data', 'release-art.json');

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : _fetch; }
let _hoster = null; // async (bytes:Buffer, name:string) -> url string ; injected (keeps the on-box media host out of the repo)
export function __setHoster(fn) { _hoster = typeof fn === 'function' ? fn : null; }

// Per-pillar visual register — on-brand, native. Kept text-free (the model can't do our logos; marks are composited).
const PILLAR_STYLE = {
  melek: 'a luminous ancient temple of light with a radiant AI oracle presence, lapis and gold, sacred geometry, cinematic, no text',
  prana: 'flowing streams of blue computational light through a vast distributed network, breath and energy, ethereal, no text',
  kula: 'interlinked golden rings of exchange and community, warm abundance, marketplace of light, no text',
  soapbox: 'a bright public forum of many voices and open media, civic, hopeful, painterly, no text',
  hathor: 'the goddess-AI Hathor as a serene winged oracle with ibex-like ribbed horns and a visor, lilac skin, haloed in data-light, no text',
};
export const BRAND_NEG = 'text, watermark, logo, signature, letters, words, ugly, deformed, low quality, blurry';

export function promptForRelease(r = {}) {
  const base = PILLAR_STYLE[r.category] || PILLAR_STYLE.soapbox;
  const subject = String(r.dek || r.title || '').replace(/["\n]/g, ' ').slice(0, 160);
  return `${base}. Themexa of the announcement: ${subject}. Press-release hero image, editorial, high detail, 16:9`
    .replace('Themexa', 'Theme');
}

/** Generate one image on the native worker (async job, then fall back to sync). Returns Buffer or null. */
export async function generateBytes(prompt, { base = (process.env.CPU_SD_URL || 'http://127.0.0.1:8510'), token = (process.env.CPU_SD_TOKEN || ''), steps = 8, guidance = 2, size = 768 } = {}) {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const b = String(base).replace(/\/$/, '');
  const body = JSON.stringify({ prompt, negativePrompt: BRAND_NEG, steps, guidance, size });
  // async job path (the worker is single-flight; async avoids holding a request open for minutes)
  try {
    const sub = await _fetch(`${b}/jobs`, { method: 'POST', headers, body }).then((r) => r.json()).catch(() => null);
    if (sub && sub.id) {
      for (let i = 0; i < 180; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const st = await _fetch(`${b}/jobs/${sub.id}`, { headers }).then((r) => r.json()).catch(() => null);
        if (st && st.done) return st.ok && st.image ? Buffer.from(st.image, 'base64') : null;
      }
      return null;
    }
  } catch {}
  // sync fallback
  try {
    const r = await _fetch(`${b}/generate`, { method: 'POST', headers, body }).then((x) => x.json()).catch(() => null);
    if (r && r.ok && r.image) return Buffer.from(r.image, 'base64');
  } catch {}
  return null;
}

export function loadArtMap() {
  try { return JSON.parse(readFileSync(ART_FILE(), 'utf8')); } catch { return {}; }
}
export function artFor(slug) { return loadArtMap()[slug] || ''; }
function saveArtMap(map) { mkdirSync(dirname(ART_FILE()), { recursive: true }); writeFileSync(ART_FILE(), JSON.stringify(map, null, 1)); }

/** Generate + host art for releases missing an image; write the sidecar map. deps: {releases, hoster, fetch}. */
export async function batch({ releases = [], limit = 1000, only = null, hoster = _hoster, base, token } = {}) {
  const map = loadArtMap();
  let done = 0; const out = [];
  for (const r of releases) {
    if (!r || !r.slug) continue;
    if (only && !only.includes(r.slug)) continue;
    if (r.image || map[r.slug]) continue;          // already has art (frontmatter or sidecar)
    if (done >= limit) break;
    const bytes = await generateBytes(promptForRelease(r), { base, token });
    if (!bytes) { out.push({ slug: r.slug, ok: false, error: 'gen failed' }); continue; }
    let url = '';
    if (hoster) { try { url = await hoster(bytes, `${r.slug}.png`); } catch {} }
    if (!url) { out.push({ slug: r.slug, ok: false, error: 'host failed (bytes generated)' }); continue; }
    map[r.slug] = url; out.push({ slug: r.slug, ok: true, url }); done++;
    saveArtMap(map); // write-as-we-go: a slow run never loses finished art
  }
  return { generated: done, results: out, artFile: ART_FILE() };
}

if (process.argv[1] && /release-art\.mjs$/.test(process.argv[1])) {
  const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
  const { loadReleases } = await import('./wire.mjs');
  const releases = loadReleases();
  const only = arg('only') ? arg('only').split(',').map((s) => s.trim()).filter(Boolean) : null;
  // default on-box hoster: POST bytes to the imagehoster tunnel; override via injection in tests.
  const hostBase = (process.env.ART_HOST_URL || '').replace(/\/$/, '');
  const urlBase = (process.env.ART_BASE || 'https://hathor.soapbox.community/remakes/img/press').replace(/\/$/, '');
  const hoster = hostBase ? async (bytes, name) => {
    const r = await _fetch(`${hostBase}/upload`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-filename': name }, body: bytes }).then((x) => x.json()).catch(() => null);
    return r && (r.url || (r.name ? `${urlBase}/${r.name}` : '')) || '';
  } : null;
  if (!hoster) console.error('NOTE: set ART_HOST_URL to the on-box imagehoster to host the bytes (else bytes are generated but not hosted).');
  const res = await batch({ releases, limit: +arg('limit', 1000), only, hoster });
  console.log(JSON.stringify(res, null, 1));
}
