// scripts.mjs — ANCIENT SCRIPTS for Hathor Studio: every letter/sign of 29 real scripts (Phoenician/Paleo-Hebrew,
// cuneiform, hieroglyphs, runes, Ogham, Linear B, Brahmi, Tifinagh…) as downloadable glyph objects, plus an
// inscription maker that sets real text in the script (in the browser, with the same open font). Image models
// invent fake letters; these are the real ones. Built by integrations/glyph_library.py into GLYPHS_DIR:
//   <dir>/index.json, <dir>/<script>/catalog.json, <dir>/<script>/<cp>.png, <dir>/fonts/<Stem>-Regular.ttf
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const GLYPHS_DIR = () => process.env.GLYPHS_DIR || '/var/lib/hathor-glyphs';
const RTL = new Set(['phoenician', 'aramaic', 'samaritan', 'nabataean', 'palmyrene', 'old_south_arabian', 'old_north_arabian',
  'kharoshthi', 'avestan', 'pahlavi', 'parthian', 'old_turkic', 'lydian', 'meroitic']);

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
export function loadIndex(dir = GLYPHS_DIR()) { const j = readJson(join(dir, 'index.json')); return j && Array.isArray(j.scripts) ? j.scripts : []; }
export function loadScript(id, dir = GLYPHS_DIR()) {
  if (!/^[a-z_]+$/.test(String(id || ''))) return null;
  return readJson(join(dir, id, 'catalog.json'));
}

export function scriptsIndexBody(index) {
  const groups = [];
  for (const s of index) if (!groups.includes(s.group)) groups.push(s.group);
  const cards = groups.map((g) => `<h2>${esc(g)}</h2><div class=grid>${index.filter((s) => s.group === g).map((s) =>
    `<a class=sec href="/scripts/${esc(s.id)}"><div class=t>${esc(s.name)}</div><div class=d>${esc(s.count)} signs${s.note ? ` · ${esc(s.note)}` : ''}</div></a>`).join('')}</div>`).join('');
  return `<h1>Ancient Scripts <span class=muted style="font-size:14px">· real letters, not invented ones</span></h1>
    <p class=muted>Image generators make up fake writing. Here is the real thing: every letter and sign of ${index.length} ancient scripts,
      each one a clean image you can download and use in your designs or in the <a href="/compose">Reference Studio</a>. Open a script
      to type your own inscription in it. Fonts: Noto (SIL Open Font License). Phrygian and Proto-Sinaitic/Proto-Canaanite are not in
      Unicode yet; they are being drawn from published sign tables.</p>
    ${cards || '<div class=card><p class=muted>The script library is being published.</p></div>'}`;
}

export function scriptPageBody(cat) {
  const rtl = RTL.has(cat.id);
  const tiles = cat.glyphs.map((g) => `<a class=gl href="/scripts/img/${esc(g.file)}" download="${esc(cat.id)}-${esc(g.cp)}.png" title="${esc(g.name)}">
      <img src="/scripts/img/${esc(g.file)}" alt="${esc(g.name)}" loading=lazy width=72 height=72><span>${esc(g.name.replace(/^[A-Z ]+?(LETTER|SIGN|RUNE|SYLLABLE|CHARACTER|IDEOGRAM|HIEROGLYPH)\s*/, ''))}</span></a>`).join('');
  return `<style>.gls{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
    .gl{display:flex;flex-direction:column;align-items:center;border:1px solid var(--line2);border-radius:8px;padding:8px 4px;background:#fff;text-decoration:none}
    .gl img{width:72px;height:72px} .gl span{font-size:10px;color:#555;text-align:center;margin-top:4px;word-break:break-word}
    @font-face{font-family:'ancient';src:url('/scripts/fonts/${esc(cat.font.split(' ')[0])}-Regular.ttf')}</style>
    <p class=muted><a href="/scripts">← All scripts</a></p>
    <h1>${esc(cat.name)} <span class=muted style="font-size:14px">· ${esc(cat.count)} signs</span></h1>
    ${cat.note ? `<p class=muted>${esc(cat.note)}</p>` : ''}
    <div class=card><b>Write an inscription</b>
      <p class=muted style="font-size:12px">Type in the box (paste signs from the grid, or type Latin letters where this script's font maps them). Download a transparent PNG to carve, paint or print.${rtl ? ' This script is written right to left.' : ''}</p>
      <input class=q id=ins placeholder="paste or type signs here" style="font-family:ancient,sans-serif;font-size:28px;direction:${rtl ? 'rtl' : 'ltr'}">
      <div class=row style="gap:8px;margin-top:8px;flex-wrap:wrap"><select class=q id=col style="width:auto"><option value="#111">black</option><option value="#b8860b">gold</option><option value="#8b2500">red ochre</option><option value="#1e3a8a">lapis blue</option><option value="#f5f0e6">white</option></select>
        <button type=button id=dl>Download PNG</button></div>
      <canvas id=cv style="max-width:100%;margin-top:10px;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0/16px 16px"></canvas></div>
    <div class=gls>${tiles}</div>
    <script>(function(){var ins=document.getElementById('ins'),cv=document.getElementById('cv'),col=document.getElementById('col');
      document.querySelectorAll('.gl').forEach(function(a){a.addEventListener('click',function(e){if(e.shiftKey)return;e.preventDefault();ins.value+=a.querySelector('img').alt?String.fromCodePoint(parseInt(a.href.split('/').pop(),16)):'';draw();});});
      function draw(){var t=ins.value;if(!t){cv.width=cv.height=0;return;}var x=cv.getContext('2d');x.font='120px ancient';var w=Math.ceil(x.measureText(t).width)+40;
        cv.width=Math.max(w,60);cv.height=180;x=cv.getContext('2d');x.font='120px ancient';x.direction='${rtl ? 'rtl' : 'ltr'}';x.fillStyle=col.value;x.textBaseline='middle';
        x.fillText(t,${rtl ? 'cv.width-20' : '20'},90);}
      ins.addEventListener('input',draw);col.addEventListener('change',draw);
      document.fonts&&document.fonts.load('120px ancient').then(draw);
      document.getElementById('dl').addEventListener('click',function(){if(!ins.value)return;var a=document.createElement('a');a.download='${esc(cat.id)}-inscription.png';a.href=cv.toDataURL('image/png');a.click();});})();</script>
    <p class=muted style="font-size:12px">Click a sign to add it to the inscription; shift-click (or right-click → save) to download the sign itself.</p>`;
}

/** Serve /scripts/img/<script>/<cp>.png and /scripts/fonts/<Stem>-Regular.ttf — nothing else. */
export function serveGlyphAsset(res, kind, rel, dir = GLYPHS_DIR()) {
  const ok = kind === 'img' ? /^[a-z_]+\/[0-9A-F]{4,6}\.png$/.test(rel) : /^NotoSans[A-Za-z]+-Regular\.ttf$/.test(rel);
  const full = join(dir, kind === 'img' ? '' : 'fonts', normalize(String(rel || '')));
  if (!ok || !full.startsWith(normalize(dir) + sep) || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  res.writeHead(200, { 'content-type': kind === 'img' ? 'image/png' : 'font/ttf', 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' });
  return res.end(readFileSync(full));
}

export default { loadIndex, loadScript, scriptsIndexBody, scriptPageBody, serveGlyphAsset, GLYPHS_DIR };
