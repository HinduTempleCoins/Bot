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
export const PEOPLES = { depicted: 'As depicted', egyptian: 'Egyptian', minoan: 'Minoan', punic: 'Punic (Carthaginian)', greek: 'Greek', nubian: 'Nubian', libyan: 'Libyan (Amazigh)', levantine: 'Levantine', pale: 'Pale' };

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

// ── /remake — the customer tool: upload a painting/relief/fresco, keep its layout, choose a look and a people ──
export const REMAKE_LOOKS = {
  real: { name: 'Realistic', suffix: 'Photorealistic historical recreation, real people with real skin texture, real fabric and gold, natural sunlight, cinematic 35mm photograph, highly detailed',
    neg: 'porcelain doll face, painting, painted, brush strokes, flat painting, cartoon, anime, drawing, illustration, text, watermark, blurry, deformed, extra limbs', scale: 0.5 },
  half: { name: 'Half vaporwave', suffix: 'Half photorealistic ancient scene, half vaporwave: pastel pink and teal neon glow, retro sunset gradient sky, chrome and gold accents, soft synthwave light, still historically detailed, cinematic',
    neg: 'text, watermark, blurry, deformed, extra limbs, low quality', scale: 0.7 },
  full: { name: 'Full MELEK aesthetic', suffix: 'Full MELEK VR-vaporwave aesthetic: a futuristic neon temple, the figures wear sleek VR headset visors glowing magenta, holographic hieroglyphs, chrome and gold, pastel pink purple and cyan light, dreamy vaporwave, highly detailed',
    neg: 'text, watermark, blurry, deformed, extra limbs, low quality', scale: 0.65 },
};
export const REMAKE_PEOPLES = {
  asdrawn: { name: 'As drawn', words: '' },
  egyptian: { name: 'Egyptian', words: 'brown-skinned Egyptian' },
  nubian: { name: 'Nubian', words: 'dark-skinned Nubian' },
  libyan: { name: 'Libyan (Amazigh)', words: 'light-brown-skinned Libyan Amazigh' },
  levantine: { name: 'Levantine', words: 'light olive-skinned Levantine' },
  minoan: { name: 'Minoan', words: 'olive and bronze-skinned Minoan Cretan' },
  punic: { name: 'Punic (Carthaginian)', words: 'olive and brown-skinned Punic Carthaginian' },
  greek: { name: 'Greek', words: 'olive-skinned ancient Greek' },
  pale: { name: 'Pale', words: 'very fair-skinned' },
};

/** Build the remake prompt from the user's words, the chosen look and people. → { prompt, negativePrompt, scale } */
export function remakePrompt({ desc = '', look = 'real', people = 'asdrawn' } = {}) {
  const L = REMAKE_LOOKS[look] || REMAKE_LOOKS.real;
  const P = REMAKE_PEOPLES[people] || REMAKE_PEOPLES.asdrawn;
  const what = String(desc || '').replace(/\s+/g, ' ').trim().slice(0, 500) || 'the people and scene in this ancient artwork';
  const who = P.words ? `, the people are ${P.words}` : '';
  return { prompt: `${what}${who}. ${L.suffix}`, negativePrompt: L.neg, scale: L.scale };
}

export function remakeToolBody({ note = '' } = {}) {
  const looks = Object.entries(REMAKE_LOOKS).map(([k, v]) => `<option value="${esc(k)}">${esc(v.name)}</option>`).join('');
  const peoples = Object.entries(REMAKE_PEOPLES).map(([k, v]) => `<option value="${esc(k)}">${esc(v.name)}</option>`).join('');
  return `<h1>Remake <span class=muted style="font-size:14px">· bring an ancient artwork to life</span></h1>
    <p class=muted>Upload a tomb painting, relief, fresco, vase or old engraving. We keep its layout (the same people, poses and
      composition) and re-render it: realistic, half vaporwave, or the full MELEK look. Choose which people to show, or keep them
      as drawn. See what it makes on the <a href="/remakes">Remakes gallery</a>.</p>
    ${note ? `<div class=card><p class=empty>${esc(note)}</p></div>` : ''}
    <form class=gform id=rmform method=post action="/api/remake"><div class=card>
      <label class=pill style="cursor:pointer">📎 Choose the artwork <input type=file id=rmfile accept="image/*" hidden></label>
      <span class=muted id=rmname style="font-size:12px;margin-left:8px">a clear photo or scan works best</span>
      <input type=hidden name=image id=rmurl>
      <label class=fld for=rmdesc style="margin-top:10px">What is happening in it? (optional, helps a lot)</label>
      <textarea class=q id=rmdesc name=desc placeholder="e.g. four noblewomen at a banquet wearing wax headcones, one playing a flute"></textarea>
      <div class=row style="margin-top:10px;gap:8px;flex-wrap:wrap">
        <select class=q name=look style="width:auto">${looks}</select>
        <select class=q name=people style="width:auto">${peoples}</select>
        <button type=submit id=rmbtn>Remake it</button></div>
      <p class=muted style="font-size:12px">Made on our own servers. It takes a few minutes, so keep this tab open.</p>
    </div></form>
    <script>(function(){var f=document.getElementById('rmform'),fi=document.getElementById('rmfile'),u=document.getElementById('rmurl'),
      n=document.getElementById('rmname'),b=document.getElementById('rmbtn');
      fi.addEventListener('change',function(){var x=fi.files&&fi.files[0];u.value='';n.textContent=x?('using '+x.name):'a clear photo or scan works best';});
      f.addEventListener('submit',async function(e){if(u.value)return;e.preventDefault();var x=fi.files&&fi.files[0];if(!x){n.textContent='Choose the artwork first.';return;}
        b.disabled=true;b.textContent='Uploading…';try{var r=await fetch('/api/upload',{method:'POST',headers:{'content-type':x.type||'image/jpeg'},body:x});var j=await r.json();
        if(j&&j.ok&&j.url){u.value=j.url;b.textContent='Remaking… (a few minutes)';f.submit();}else{b.disabled=false;b.textContent='Remake it';n.textContent='Upload failed — try a smaller image.';}}
        catch(err){b.disabled=false;b.textContent='Remake it';n.textContent='Upload failed — try again.';}});})();</script>`;
}
