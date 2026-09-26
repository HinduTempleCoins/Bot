// remakes.mjs — the Shilpa Shastra REMAKES gallery: historical scenes (tomb paintings, stelae, frescoes) remade
// on our own CPU in three looks (realistic → half vaporwave → full MELEK aesthetic) and in several peoples per
// scene (Egyptian / Minoan, Nubian, Libyan, Levantine, pale), shown side by side with the source.
//
// Images are NOT in git (hundreds of them): they live in REMAKES_DIR on the web host, with a manifest.json:
//   { updated, scenes: [ { key, title, group, credit, source: "src.jpg", looks: { "1_real": { egyptian: "x.jpg", … } } } ] }
// Pure builders + a sanitised file server. esc() on every interpolation.

import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const REMAKES_DIR = () => process.env.REMAKES_DIR || '/var/lib/hathor-remakes';

export const LOOKS = [
  { id: '1_real', name: 'Realistic', note: 'As it would have looked.' },
  { id: '2_half', name: 'Half vaporwave', note: 'The same scene, half-shifted into VR-vaporwave.' },
  { id: '3_full', name: 'Full MELEK aesthetic', note: 'Neon temple, glowing visors, gold and magenta.' },
];
export const PEOPLES = { egyptian: 'Egyptian', minoan: 'Minoan', nubian: 'Nubian', libyan: 'Libyan (Amazigh)', levantine: 'Levantine', pale: 'Pale' };

export function loadManifest(dir = REMAKES_DIR()) {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    return m && Array.isArray(m.scenes) ? m : { scenes: [] };
  } catch { return { scenes: [] }; }
}

const img = (key, file, alt, lazy = true) =>
  `<a href="/remakes/img/${esc(key)}/${esc(file)}" target=_blank rel=noopener><img src="/remakes/img/${esc(key)}/${esc(file)}" alt="${esc(alt)}"${lazy ? ' loading=lazy' : ''}></a>`;

export function remakesBody(manifest, { look = '1_real', base = '' } = {}) {
  const lk = LOOKS.find((l) => l.id === look) || LOOKS[0];
  const scenes = manifest.scenes || [];
  const tabs = LOOKS.map((l) => {
    const n = scenes.filter((s) => s.looks && s.looks[l.id] && Object.keys(s.looks[l.id]).length).length;
    return `<a class="pill${l.id === lk.id ? ' on' : ''}" href="/remakes?look=${esc(l.id)}">${esc(l.name)} <span class=muted>(${n})</span></a>`;
  }).join(' ');
  const groups = [];
  for (const s of scenes) { if (!groups.includes(s.group || 'Scenes')) groups.push(s.group || 'Scenes'); }
  const cards = groups.map((g) => {
    const rows = scenes.filter((s) => (s.group || 'Scenes') === g).map((s) => {
      const set = (s.looks && s.looks[lk.id]) || {};
      const peoples = Object.keys(set);
      const tiles = peoples.map((p) => `<figure>${img(s.key, set[p], `${s.title} — ${PEOPLES[p] || p}`)}<figcaption>${esc(PEOPLES[p] || p)}</figcaption></figure>`).join('');
      return `<section class=card id="${esc(s.key)}"><h3 style="margin:0 0 4px">${esc(s.title)} <a class=muted href="#${esc(s.key)}" style="font-size:12px">#</a></h3>
        <p class=muted style="font-size:12px;margin:0 0 10px">${esc(s.credit || '')}</p>
        <div class=rm-row><figure class=src>${s.source ? img(s.key, s.source, `${s.title} — source`) : ''}<figcaption>Source</figcaption></figure>
        ${tiles || '<p class=muted>This look is still rendering.</p>'}</div></section>`;
    }).join('');
    return `<h2>${esc(g)}</h2>${rows}`;
  }).join('');
  const share = encodeURIComponent(`${base}/remakes`);
  return `<style>.rm-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.rm-row figure{margin:0;flex:0 0 auto;width:220px}
    .rm-row img{width:220px;height:auto;border-radius:8px;border:1px solid var(--line2);display:block}
    .rm-row figure.src img{border-color:var(--gold)} .rm-row figcaption{font-size:12px;color:var(--mut);margin-top:3px}
    .pill.on{border-color:var(--gold);color:var(--gold)}</style>
    <h1>Remakes <span class=muted style="font-size:14px">· the ancient world, re-rendered</span></h1>
    <p class=muted>Tomb paintings, stelae and frescoes remade on our own servers. Each keeps the original's people, poses and
      composition. The ancient Mediterranean was many peoples, so every scene is shown in several: Egyptian or Minoan, Nubian,
      Libyan, Levantine and pale, side by side. ${esc(lk.note)}</p>
    <div class=row style="gap:8px;flex-wrap:wrap;margin:10px 0">${tabs}</div>
    <p class=muted style="font-size:12px">Share: <a href="https://twitter.com/intent/tweet?url=${share}" target=_blank rel=noopener>X</a> ·
      copy <code>${esc(base)}/remakes</code> · every scene has its own # link. Made with the <a href="/learn/make">process you can learn here</a>.</p>
    ${cards || '<div class=card><p class=muted>The first remakes are still being published.</p></div>'}`;
}

/** Serve /remakes/img/<scene>/<file> from REMAKES_DIR — images only, no traversal. */
export function serveRemakeImage(res, rel, dir = REMAKES_DIR()) {
  const clean = normalize(String(rel || '')).replace(/^(\.\.(\/|\\|$))+/, '');
  if (!/^[\w-]+\/[\w.-]+\.(jpe?g|png|webp)$/i.test(clean) || clean.includes('..')) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const full = join(dir, clean);
  if (!full.startsWith(normalize(dir) + sep) || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const type = /\.png$/i.test(clean) ? 'image/png' : /\.webp$/i.test(clean) ? 'image/webp' : 'image/jpeg';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=86400' });
  return res.end(readFileSync(full));
}

export default { LOOKS, PEOPLES, loadManifest, remakesBody, serveRemakeImage, REMAKES_DIR };
