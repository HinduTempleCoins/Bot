// maps.mjs — /maps on the Hathor Studio: animated history maps (empires over time, a ticking year, campaign routes),
// rendered on our CPU by integrations/maps/render_map.py. Clips are NOT in git: they live in MAPS_DIR on the web host
// with the renderer's index.json ({ updated, clips: [{ id, title, subtitle, fromYear, toYear, polities, duration,
// file, file720, poster, licence, credit, tags }] }). Territories are Cliopatria (CC BY 4.0) — every clip shows its
// credit. Pure builders + a sanitised, Range-capable media server. esc() everything.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const MAPS_DIR = () => process.env.MAPS_DIR || '/var/lib/hathor-maps';
const FILE_RE = /^[a-z0-9][a-z0-9-]{0,60}(_720)?\.(mp4|jpg)$/;

export function formatYear(y) {
  const n = Math.round(Number(y));
  if (!Number.isFinite(n)) return '';
  if (n < 0) return `${-n} BC`;
  const ad = n === 0 ? 1 : n;
  return ad < 1000 ? `AD ${ad}` : String(ad);
}

export function loadMapsIndex(dir = MAPS_DIR()) {
  try {
    const j = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
    return Array.isArray(j.clips) ? { updated: j.updated, clips: j.clips.filter((c) => c && FILE_RE.test(String(c.file || ''))) } : { clips: [] };
  } catch { return { clips: [] }; }
}

export function mapsBody(index) {
  const clips = [...(index.clips || [])].sort((a, b) => (a.fromYear ?? 0) - (b.fromYear ?? 0));
  const cards = clips.map((c) => `<section class="card mp-card" id="${esc(c.id)}">
      <video controls playsinline preload=none poster="/maps/media/${esc(c.poster || '')}">
        <source src="/maps/media/${esc(c.file720 || c.file)}" type="video/mp4"></video>
      <h3>${esc(c.title)}</h3>
      <p class=muted style="font-size:13px;margin:2px 0">${esc(formatYear(c.fromYear))} – ${esc(formatYear(c.toYear))}${c.duration ? ` · ${esc(Math.round(c.duration))} s` : ''}${c.file720 ? ` · <a href="/maps/media/${esc(c.file)}" download>1080p</a>` : ''}</p>
      ${c.subtitle ? `<p style="font-size:13px;margin:4px 0">${esc(c.subtitle)}</p>` : ''}
      ${(c.polities || []).length ? `<p class=muted style="font-size:12px;margin:4px 0">${esc(c.polities.slice(0, 12).join(' · '))}</p>` : ''}
      <p class=muted style="font-size:11px;margin:6px 0 0">${esc(c.credit || '')}</p>
    </section>`).join('');
  return `<style>.mp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
    .mp-card video{width:100%;border-radius:8px;background:#000;aspect-ratio:16/9;display:block}.mp-card h3{margin:8px 0 2px;font-size:16px}</style>
    <h1>History maps <span class=muted style="font-size:14px">· empires over time</span></h1>
    <div class=card style="border-color:var(--gold)"><b>Alpha.</b> Hathor's first maps, made on our own servers. Later versions will be more accurate. Borders are one scholarly reconstruction; ancient frontiers were uncertain and changed within these years.</div>
    <p class=muted>Borders change as the year ticks: Egypt, Kush and Nubia, Mesopotamia, Persia, Alexander's march, Rome, Hannibal, the Phoenicians and Carthage, Byzantium, the Ottomans, China, India, the caliphates, the Mongols, the Aztec and Inca, and the whole world. Territories from <a href="https://github.com/Seshat-Global-History-Databank/cliopatria" rel=noopener>Cliopatria</a> (Seshat Global History Databank, CC BY 4.0), simplified and recoloured; base map Natural Earth (public domain). Make your own with your own data in the <a href="/video-studio">Video Studio</a>.</p>
    ${cards ? `<div class=mp-grid>${cards}</div>` : '<div class=card><p class=empty>The first maps are still rendering. Check back soon.</p></div>'}`;
}

export function mapsLd(index, base) {
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name: 'Hathor Studio — history maps', url: `${base}/maps`,
    itemListElement: (index.clips || []).slice(0, 100).map((c, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: { '@type': 'VideoObject', name: c.title, description: `${c.subtitle || c.title}. ${c.credit || ''}`.trim(),
        thumbnailUrl: `${base}/maps/media/${c.poster}`, contentUrl: `${base}/maps/media/${c.file}`,
        ...(c.duration ? { duration: `PT${Math.round(c.duration)}S` } : {}),
        ...(index.updated ? { uploadDate: new Date(index.updated * 1000).toISOString() } : {}),
        license: 'https://creativecommons.org/licenses/by/4.0/' },
    })),
  };
}

export function serveMapsMedia(req, res, rel, dir = MAPS_DIR()) {
  const name = String(rel || '');
  const full = FILE_RE.test(name) ? join(dir, name) : null;
  if (!full || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const type = name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
  const size = statSync(full).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ''));
  if (range && type === 'video/mp4') {
    const start = range[1] === '' ? size - +range[2] : +range[1];
    const end = range[1] !== '' && range[2] !== '' ? Math.min(+range[2], size - 1) : size - 1;
    if (!(start >= 0 && start <= end && end < size)) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'public, max-age=86400' });
    return res.end(readFileSync(full).subarray(start, end + 1));
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'public, max-age=86400' });
  return res.end(readFileSync(full));
}
