// symbols.mjs — RELIGIOUS & OCCULT SYMBOLS for Hathor Studio: ~230 real symbols across traditions and time
// (Egyptian, Mesopotamian, Punic, Greek & Roman, Hebrew & Kabbalah, Christian, Islamic, Hindu, Buddhist, Taoist,
// Norse, Celtic, alchemy, astrology, Western esoteric, Mesoamerican, African & diaspora…) as clean black-on-
// transparent objects. Image models draw these wrong; these are sourced ones, each with its period, what it is
// documented to mean, whether that history is attested, disputed or modern, and the image's licence and author.
// Built by integrations/genai-symbol-harvest.mjs + integrations/symbol_library.py into SYMBOLS_DIR:
//   <dir>/catalog.json, <dir>/<id>.png, <dir>/<id>.orig.png (coloured original where one exists)
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { getEntity } from '../../integrations/hierophant-entities.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const SYMBOLS_DIR = () => process.env.SYMBOLS_DIR || '/var/lib/hathor-symbols';
const HIEROPHANT = () => (process.env.HIEROPHANT_SITE || 'https://hierophant.soapbox.community').replace(/\/$/, '');

let _cache = null;
export function loadSymbols(dir = SYMBOLS_DIR()) {
  if (_cache && _cache.dir === dir) return _cache.list;
  let list = [];
  try { const j = JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf8')); list = Array.isArray(j.symbols) ? j.symbols : []; } catch { /* none yet */ }
  _cache = { dir, list };
  return list;
}
export function __resetSymbols() { _cache = null; }
export function getSymbol(id, dir) { return loadSymbols(dir).find((s) => s.id === id) || null; }
/** Symbols belonging to a Hierophant figure (for the god pages). */
export function symbolsForFigure(figureId, dir) { return loadSymbols(dir).filter((s) => (s.figures || []).includes(figureId)); }

const STATUS = {
  attested: '',
  disputed: '<span class=sbadge style="background:#6b4d12">disputed</span>',
  modern: '<span class=sbadge style="background:#2d4a6b">modern</span>',
};
const STYLE = `<style>.sgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin:10px 0 22px}
.stile{display:block;text-align:center;padding:10px 6px;border:1px solid var(--line2);border-radius:10px;background:#f4efe4;color:#222;text-decoration:none}
.stile img{width:72px;height:72px;object-fit:contain}.stile span{display:block;font-size:12px;margin-top:6px;line-height:1.25}
.sbadge{display:inline-block;color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px;vertical-align:middle}
.sbig{background:#f4efe4;border-radius:12px;padding:18px;text-align:center}.sbig img{max-width:320px;width:100%}</style>`;

const imgUrl = (s) => `/symbols/img/${encodeURIComponent(s.image.file)}`;

export function symbolsIndexBody(list = loadSymbols()) {
  const groups = new Map();
  for (const s of list) { if (!s.image) continue; const g = s.group || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  const n = [...groups.values()].reduce((a, g) => a + g.length, 0);
  const sections = [...groups].map(([g, items]) => `<h2 id="${esc(g.toLowerCase().replace(/[^a-z]+/g, '-'))}">${esc(g)} <span class=muted style="font-size:13px">· ${items.length}</span></h2>
    <div class=sgrid>${items.map((s) => `<a class=stile href="/symbols/${esc(s.id)}" data-q="${esc(`${s.name} ${(s.tradition || []).join(' ')} ${g}`.toLowerCase())}"><img src="${imgUrl(s)}" alt="${esc(s.name)}" loading=lazy><span>${esc(s.name)}${STATUS[s.status] || ''}</span></a>`).join('')}</div>`).join('');
  return `${STYLE}<h1>Sacred Symbols</h1>
    <p class=muted>${n} religious and occult symbols from across the world and across time — clean objects to use in your designs, each with where it comes from, what it is documented to mean, and whether that history is <b>attested</b>, <b>disputed</b> or <b>modern</b>. Image-makers draw these wrong; these are the real ones, with their sources and credits. Many link to their gods in the <a href="${esc(HIEROPHANT())}">Hierophant</a>.</p>
    <div class=card><input class=q id=sq placeholder="Search: ankh, pentagram, Thor, alchemy, lotus…" style="width:100%"></div>
    <p class=muted style="font-size:13px">${[...groups.keys()].map((g) => `<a href="#${esc(g.toLowerCase().replace(/[^a-z]+/g, '-'))}">${esc(g)}</a>`).join(' · ')}</p>
    ${sections || '<div class=card><p class=empty>The symbol library is being published — check back shortly.</p></div>'}
    <script>(function(){var q=document.getElementById('sq');if(!q)return;q.addEventListener('input',function(){var v=q.value.toLowerCase().trim();
      document.querySelectorAll('.stile').forEach(function(t){t.style.display=!v||t.dataset.q.indexOf(v)>=0?'':'none'});
      document.querySelectorAll('.sgrid').forEach(function(g){var any=[].some.call(g.children,function(t){return t.style.display!=='none'});g.style.display=any?'':'none';g.previousElementSibling.style.display=any?'':'none'});});})();</script>`;
}

export function symbolPageBody(s) {
  const H = HIEROPHANT();
  const figs = (s.figures || []).map((id) => { const e = getEntity(id); return e ? `<a href="${esc(H)}/gods/${esc(id)}">${esc(e.name)}</a>` : null; }).filter(Boolean);
  const src = (s.sources || []).map((x) => `<li><a href="${esc(x.url)}" rel="noopener" target=_blank>${esc(x.title || x.url)}</a></li>`).join('');
  const im = s.image;
  const credit = im ? `${esc(im.licence || '')}${im.author ? ` · ${esc(im.author)}` : ''}${im.source ? ` · <a href="${esc(im.source)}" rel="noopener" target=_blank>source</a>` : ''}` : '';
  const hasOrig = im && existsSync(join(SYMBOLS_DIR(), im.file.replace(/\.png$/, '.orig.png')));
  return `${STYLE}<p class=muted><a href="/symbols">← all symbols</a></p>
    <h1>${esc(s.name)}${STATUS[s.status] || ''}</h1>
    <div class=card>
      ${im ? `<div class=sbig><img src="${imgUrl(s)}" alt="${esc(s.name)}"></div>` : '<p class=muted>No openly licensed image of this one yet.</p>'}
      <p style="margin-top:12px">${esc(s.meaning || '')}</p>
      <p class=muted><b>Tradition:</b> ${esc((s.tradition || []).join(', '))} · <b>Period:</b> ${esc(s.period || '—')}${s.unicode ? ` · <b>Unicode:</b> ${esc(s.unicode)}` : ''}</p>
      ${s.note ? `<p class=muted><b>${s.status === 'attested' ? 'Note' : s.status === 'modern' ? 'Modern history' : 'Disputed'}:</b> ${esc(s.note)}</p>` : ''}
      ${figs.length ? `<p><b>Figures:</b> ${figs.join(' · ')}</p>` : ''}
      ${im ? `<div class=row style="margin-top:10px">
        <a class="pill gold" href="${imgUrl(s)}" download>⬇ Download PNG</a>
        ${hasOrig ? `<a class=pill href="/symbols/img/${esc(im.file.replace(/\.png$/, '.orig.png'))}" download>⬇ Coloured original</a>` : ''}
        <a class=pill href="/compose?ref=${encodeURIComponent(imgUrl(s))}&role=object&label=${encodeURIComponent(s.name)}">➕ Use in Reference Studio</a></div>` : ''}
      ${src ? `<p class=muted style="margin-top:12px"><b>Sources</b></p><ul class=muted>${src}</ul>` : ''}
      ${credit ? `<p class=muted style="font-size:12px"><b>Image:</b> ${credit}. Please keep this credit when you use it.</p>` : ''}
    </div>`;
}

/** Serve /symbols/img/<id>.png or <id>.orig.png — nothing else. */
export function serveSymbolAsset(res, rel, dir = SYMBOLS_DIR()) {
  const ok = /^[a-z0-9-]+(\.orig)?\.png$/.test(String(rel || ''));
  const full = join(dir, normalize(String(rel || '')));
  if (!ok || !full.startsWith(normalize(dir) + sep) || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' });
  return res.end(readFileSync(full));
}

export default { loadSymbols, getSymbol, symbolsForFigure, symbolsIndexBody, symbolPageBody, serveSymbolAsset, SYMBOLS_DIR };
