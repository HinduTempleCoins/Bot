// video-studio-toolkit.mjs — the Video Studio as a TOOLKIT: every pipeline we run, each taking the user's own
// engines (API keys, in their browser) AND their own DATA (uploads). Tools, data formats (templates + JSON Schemas),
// validation, uploads with per-visitor quotas, and issued API keys for the jobs API.
//
//   /video-studio/toolkit            the tools, which are live, which wait for an engine
//   /video-studio/data               data formats, downloadable templates, schemas
//   /video-studio/data/<file>        a template or schema
//   /video-studio/api/uploads        PUT a file (?voter=&licence=&kind=) → { id, url } — validated, quota'd
//   /video-studio/u/<id>             an upload (unguessable id)
//   /video-studio/api/keys           POST {voter} → an API key (shown once; stored hashed)
//   /video-studio/api/validate       POST {kind, data} → { ok, errors[] } (dry-run validation)
// Pure builders + validators + a JSONL index. esc() everything. Soft-fail.

import { readFileSync, existsSync, appendFileSync, mkdirSync, createWriteStream, renameSync, statSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DIR = () => process.env.VSTUDIO_DIR || join(process.env.DATA_DIR || join(process.cwd(), '.data', 'hathor'), 'video-studio');
const UPLOADS = () => join(DIR(), 'uploads');
const UPLOAD_INDEX = () => join(DIR(), 'uploads.jsonl');
const KEYS = () => join(DIR(), 'keys.jsonl');

// ── the tools ──────────────────────────────────────────────────────────────────────────────────────
// status: 'live' (renders now) | 'engine-pending' (inputs accepted + validated; renders once its engine is enabled on
// the worker — VSTUDIO_ENGINES lists what the worker runs) | 'page' (an existing live page).
export const TOOLS = {
  film: { name: 'Film from a topic', what: 'Type a topic → a wordless eerie recreation, reuse-first from our gallery.', inputs: ['topic', 'optional: your images, your text'], engine: 'film', href: '/video-studio' },
  animate: { name: 'Animate your images', what: 'Upload images (or pick gallery scenes) → slow camera moves, crossfades, cards → a clip.', inputs: ['images (jpg/png/webp)', 'cards/questions'], engine: 'animate' },
  subtitles: { name: 'Subtitles & transcript', what: 'A video URL or upload → timed subtitles (Whisper on our CPU) you can edit.', inputs: ['video URL (https) or mp4 upload'], engine: 'subtitles' },
  remake: { name: 'Remake an artwork', what: 'Upload a painting, relief or fresco → realistic, half vaporwave or full MELEK look, in several peoples.', inputs: ['image'], href: '/remake', status: 'page' },
  map: { name: 'Animated history map', what: 'Your GeoJSON territories (fromYear/toYear) or a CSV route (place, lat, lon, year) → a map film with a ticking year.', inputs: ['GeoJSON or waypoint CSV'], engine: 'map' },
  documentary: { name: 'Documentary with your material', what: 'A topic plus your own research text, image pack and music → a longer film.', inputs: ['topic', 'text (.md/.txt)', 'asset pack (images + assets.json)', 'music (licence required)'], engine: 'documentary' },
};
export const enabledEngines = () => new Set(String(process.env.VSTUDIO_ENGINES || 'film,animate,subtitles').split(',').map((s) => s.trim()).filter(Boolean));
export function toolStatus(id) { const t = TOOLS[id]; if (!t) return 'unknown'; if (t.status) return t.status; return enabledEngines().has(t.engine) ? 'live' : 'engine-pending'; }

// ── uploads ────────────────────────────────────────────────────────────────────────────────────────
export const KINDS = {
  image: { types: ['image/jpeg', 'image/png', 'image/webp'], maxMB: 25, ext: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } },
  text: { types: ['text/plain', 'text/markdown'], maxMB: 2, ext: { 'text/plain': 'txt', 'text/markdown': 'md' } },
  geojson: { types: ['application/geo+json', 'application/json'], maxMB: 20, ext: { 'application/geo+json': 'geojson', 'application/json': 'geojson' } },
  csv: { types: ['text/csv'], maxMB: 5, ext: { 'text/csv': 'csv' } },
  assets: { types: ['application/json'], maxMB: 2, ext: { 'application/json': 'json' } },
  audio: { types: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac'], maxMB: 100, ext: { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac' } },
  video: { types: ['video/mp4', 'video/webm'], maxMB: 2048, ext: { 'video/mp4': 'mp4', 'video/webm': 'webm' } },
};
export const QUOTA = { perDayBytes: 10 * 1024 ** 3 }; // the Studio HardDrive pattern: 2 GB a file (video), 10 GB a day
export const LICENCES = ['mine', 'cc0', 'public-domain', 'cc-by', 'cc-by-sa', 'permission', 'private-use-only'];

function magicOk(kind, head) {
  const h = head.toString('hex', 0, 12);
  if (kind === 'image') return h.startsWith('ffd8ff') || h.startsWith('89504e47') || (h.startsWith('52494646') && head.toString('ascii', 8, 12) === 'WEBP');
  if (kind === 'video') return head.toString('ascii', 4, 8) === 'ftyp' || h.startsWith('1a45dfa3');
  if (kind === 'audio') return h.startsWith('494433') || h.startsWith('fffb') || h.startsWith('fff3') || h.startsWith('4f676753') || h.startsWith('52494646') || h.startsWith('664c6143');
  return !head.includes(0); // text-like kinds: no NUL bytes
}

let _idx = null;
function uploads() {
  if (_idx) return _idx;
  const m = new Map();
  try { for (const l of readFileSync(UPLOAD_INDEX(), 'utf8').split('\n')) { if (!l) continue; try { const u = JSON.parse(l); if (u && u.id) m.set(u.id, u); } catch {} } } catch {}
  _idx = m; return m;
}
export function __resetToolkit() { _idx = null; _keys = null; }
export const getUpload = (id) => (/^[a-f0-9]{32}$/.test(String(id || '')) ? uploads().get(id) || null : null);
const today = () => new Date().toISOString().slice(0, 10);
export function usedToday(voter) { return [...uploads().values()].filter((u) => u.voter === voter && u.day === today()).reduce((n, u) => n + (u.bytes || 0), 0); }

/** Stream an upload to disk with type/size/quota/magic/content validation. → { code, body } */
export async function receiveUpload(req, { voter, kind, licence, type }) {
  const K = KINDS[kind];
  if (!K) return { code: 400, body: { ok: false, error: `kind must be one of ${Object.keys(KINDS).join(', ')}` } };
  if (!K.types.includes(type)) return { code: 415, body: { ok: false, error: `${kind} must be ${K.types.join(' or ')}` } };
  if (!LICENCES.includes(licence)) return { code: 400, body: { ok: false, error: `licence is required: ${LICENCES.join(', ')}` } };
  const declared = +((req.headers && req.headers['content-length']) || 0);
  const max = K.maxMB * 1024 * 1024;
  if (declared > max) return { code: 413, body: { ok: false, error: `${kind} files are limited to ${K.maxMB} MB` } };
  if (usedToday(voter) + declared > QUOTA.perDayBytes) return { code: 429, body: { ok: false, error: 'daily upload quota (10 GB) reached' } };
  const id = randomBytes(16).toString('hex');
  mkdirSync(UPLOADS(), { recursive: true });
  const file = join(UPLOADS(), `${id}.${K.ext[type]}`);
  const tmp = `${file}.part`;
  const n = await new Promise((resolve) => {
    let got = 0; let over = false; const ws = createWriteStream(tmp);
    req.on('data', (c) => { got += c.length; if (got > max) { over = true; req.unpipe(ws); ws.end(); } });
    req.pipe(ws);
    ws.on('finish', () => resolve(over ? -1 : got));
    ws.on('error', () => resolve(0)); req.on('error', () => resolve(0));
  });
  const fail = (code, error) => { try { unlinkSync(tmp); } catch {} return { code, body: { ok: false, error } }; };
  if (n === -1) return fail(413, `${kind} files are limited to ${K.maxMB} MB`);
  if (!n) return fail(400, 'empty upload');
  const head = Buffer.alloc(Math.min(64, n)); const fd = openSync(tmp, 'r'); readSync(fd, head, 0, head.length, 0); closeSync(fd);
  if (!magicOk(kind, head)) return fail(415, `that file does not look like ${kind}`);
  if (['geojson', 'csv', 'assets'].includes(kind)) {
    let text = ''; try { text = readFileSync(tmp, 'utf8'); } catch {}
    const v = validate(kind, text);
    if (!v.ok) return fail(422, v.errors.slice(0, 8).join('; '));
  }
  renameSync(tmp, file);
  const rec = { id, voter, kind, type, licence, bytes: n, day: today(), at: Date.now(), file: `${id}.${K.ext[type]}` };
  try { appendFileSync(UPLOAD_INDEX(), JSON.stringify(rec) + '\n'); uploads().set(id, rec); } catch { return fail(500, 'store unavailable'); }
  return { code: 200, body: { ok: true, id, url: `/video-studio/u/${id}`, kind, bytes: n } };
}

export function serveUpload(res, id) {
  const u = getUpload(id);
  const full = u && join(UPLOADS(), u.file);
  if (!u || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  res.writeHead(200, { 'content-type': u.type, 'content-length': statSync(full).size, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-disposition': u.kind === 'text' || u.kind === 'csv' ? 'inline' : 'inline' });
  return res.end(readFileSync(full));
}

// ── validation (pure) ─────────────────────────────────────────────────────────────────────────────
const num = (v) => typeof v === 'number' && Number.isFinite(v);
export function validate(kind, text) {
  const errors = [];
  if (kind === 'geojson') {
    let g; try { g = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
    if (!g || g.type !== 'FeatureCollection' || !Array.isArray(g.features)) return { ok: false, errors: ['must be a GeoJSON FeatureCollection'] };
    if (!g.features.length) errors.push('no features');
    if (g.features.length > 5000) errors.push('at most 5,000 features');
    g.features.slice(0, 5000).forEach((f, i) => {
      if (!f || f.type !== 'Feature' || !f.geometry || !['Polygon', 'MultiPolygon', 'Point', 'LineString', 'MultiLineString'].includes(f.geometry.type)) errors.push(`feature ${i}: needs a Polygon, MultiPolygon, Point or LineString geometry`);
      const p = (f && f.properties) || {};
      if (!p.name) errors.push(`feature ${i}: properties.name is required`);
      if (!num(p.fromYear)) errors.push(`feature ${i}: properties.fromYear must be a number (negative = BC)`);
      if (p.toYear != null && !num(p.toYear)) errors.push(`feature ${i}: properties.toYear must be a number`);
      if (num(p.fromYear) && num(p.toYear) && p.toYear < p.fromYear) errors.push(`feature ${i}: toYear is before fromYear`);
    });
  } else if (kind === 'csv') {
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
    const head = (lines[0] || '').toLowerCase().split(',').map((s) => s.trim());
    for (const c of ['place', 'lat', 'lon', 'year']) if (!head.includes(c)) errors.push(`header needs a "${c}" column`);
    if (lines.length < 3) errors.push('a route needs at least 2 waypoints');
    if (lines.length > 5001) errors.push('at most 5,000 waypoints');
    const ix = Object.fromEntries(head.map((h, i) => [h, i]));
    lines.slice(1, 5001).forEach((l, i) => {
      const c = l.split(',');
      const lat = +c[ix.lat]; const lon = +c[ix.lon]; const y = +c[ix.year];
      if (!(lat >= -90 && lat <= 90)) errors.push(`row ${i + 2}: lat out of range`);
      if (!(lon >= -180 && lon <= 180)) errors.push(`row ${i + 2}: lon out of range`);
      if (!Number.isFinite(y)) errors.push(`row ${i + 2}: year must be a number`);
    });
  } else if (kind === 'assets') {
    let a; try { a = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
    const files = a && Array.isArray(a.files) ? a.files : null;
    if (!files) return { ok: false, errors: ['must be { "files": [ … ] }'] };
    files.forEach((f, i) => {
      if (!f || !f.file) errors.push(`files[${i}]: "file" is required (the uploaded image id or name)`);
      if (!['character', 'object', 'background', 'symbol', 'scene'].includes(f && f.type)) errors.push(`files[${i}]: type must be character, object, background, symbol or scene`);
      if (!LICENCES.includes(f && f.licence)) errors.push(`files[${i}]: licence must be one of ${LICENCES.join(', ')}`);
    });
  } else return { ok: false, errors: [`unknown kind ${kind}`] };
  return { ok: !errors.length, errors: errors.slice(0, 50) };
}

// ── templates + schemas ────────────────────────────────────────────────────────────────────────────
export const TEMPLATES = {
  'map-territories.geojson': { type: 'application/geo+json', body: JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'Kingdom of Kush (Napatan)', fromYear: -780, toYear: -590, licence: 'mine', note: 'approximate extent' }, geometry: { type: 'Polygon', coordinates: [[[30.5, 16.5], [34.5, 16.5], [34.5, 20.5], [30.5, 20.5], [30.5, 16.5]]] } },
    { type: 'Feature', properties: { name: 'Meroë', fromYear: -590, toYear: 350, licence: 'mine' }, geometry: { type: 'Point', coordinates: [33.75, 16.94] } }] }, null, 1) },
  'map-route.csv': { type: 'text/csv', body: 'place,lat,lon,year,note\nNapata,18.53,31.83,-730,Piye marches north\nThebes,25.70,32.64,-728,\nMemphis,29.85,31.25,-727,Memphis falls\n' },
  'assets.json': { type: 'application/json', body: JSON.stringify({ files: [{ file: '<upload id or file name>', type: 'character', people: 'Kushite', era: '25th Dynasty', region: 'Nile', licence: 'mine', tags: ['king', 'warrior'] }] }, null, 1) },
  'film-plan.json': { type: 'application/json', body: JSON.stringify({ title: 'Kush and the Nile', minutes: 1, style: 'eerie', chapters: [{ title: 'The river', shots: [{ image: 'https://…', card: 'Meroë, Kingdom of Kush, c. 300 BC', question: 'Who built these?', credit: 'your source', secs: 8 }] }], sources: ['…'] }, null, 1) },
};
export const SCHEMAS = {
  'map-territories.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Video Studio map territories', type: 'object', required: ['type', 'features'], properties: { type: { const: 'FeatureCollection' }, features: { type: 'array', maxItems: 5000, items: { type: 'object', required: ['type', 'geometry', 'properties'], properties: { type: { const: 'Feature' }, geometry: { type: 'object', required: ['type'], properties: { type: { enum: ['Polygon', 'MultiPolygon', 'Point', 'LineString', 'MultiLineString'] } } }, properties: { type: 'object', required: ['name', 'fromYear'], properties: { name: { type: 'string' }, fromYear: { type: 'number', description: 'negative = BC' }, toYear: { type: 'number' }, licence: { enum: LICENCES } } } } } } } },
  'assets.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Video Studio asset pack', type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'object', required: ['file', 'type', 'licence'], properties: { file: { type: 'string' }, type: { enum: ['character', 'object', 'background', 'symbol', 'scene'] }, people: { type: 'string' }, era: { type: 'string' }, region: { type: 'string' }, licence: { enum: LICENCES }, tags: { type: 'array', items: { type: 'string' } } } } } } },
  'job.schema.json': { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Video Studio job', type: 'object', required: ['tool'], properties: { tool: { enum: Object.keys(TOOLS).filter((k) => !TOOLS[k].status) }, topic: { type: 'string' }, minutes: { enum: [1, 10, 30, 60] }, style: { enum: ['eerie', 'documentary'] }, inputs: { type: 'array', items: { type: 'string', description: 'upload ids' } }, params: { type: 'object' }, plan: { type: 'object' }, public: { type: 'boolean' } } },
};

// ── API keys (issued; stored hashed) ─────────────────────────────────────────────────────────────
let _keys = null;
function keys() { if (_keys) return _keys; const m = new Map(); try { for (const l of readFileSync(KEYS(), 'utf8').split('\n')) { if (!l) continue; try { const k = JSON.parse(l); m.set(k.h, k); } catch {} } } catch {} _keys = m; return m; }
const kh = (k) => createHash('sha256').update(`vstudio-key:${k}`).digest('hex');
export function issueKey(voter) {
  if ([...keys().values()].filter((k) => k.voter === voter).length >= 5) return null;
  const key = `vsk_${randomBytes(20).toString('hex')}`;
  const rec = { h: kh(key), voter, at: Date.now() };
  try { mkdirSync(DIR(), { recursive: true }); appendFileSync(KEYS(), JSON.stringify(rec) + '\n'); keys().set(rec.h, rec); } catch { return null; }
  return key;
}
/** voter hash for a request carrying `Authorization: Bearer vsk_…`, else null. */
export function voterFromKey(req) {
  const m = /^Bearer\s+(vsk_[a-f0-9]{40})$/.exec(String((req.headers && req.headers.authorization) || ''));
  const k = m && keys().get(kh(m[1]));
  return k ? k.voter : null;
}

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────
const badge = (s) => (s === 'live' ? '<span class=an-chip style="border-color:#7bd88f;color:#7bd88f">live</span>' : s === 'page' ? '<span class=an-chip style="border-color:#7bd88f;color:#7bd88f">live page</span>' : '<span class=an-chip>inputs accepted · rendering soon</span>');
export function toolkitBody() {
  return `<h1>Toolkit <span class=muted style="font-size:14px">· everything we do, with your engines and your data</span></h1>
<div class=card style="border-color:var(--gold)"><b>Alpha.</b> These are Hathor's first tools. She is still being trained, and what she makes next is expected to be much better and more accurate.</div>
<p class=muted>Every tool takes your own APIs (keys stay in your browser — <a href="/video-studio/docs">how</a>) and your own data (<a href="/video-studio/data">formats and templates</a>). Scripts can use the <a href="/video-studio/data#api">API</a>.</p>
${Object.entries(TOOLS).map(([id, t]) => `<div class=card><h3 style="margin:0 0 4px">${esc(t.name)} ${badge(toolStatus(id))}</h3><p style="margin:0 0 6px">${esc(t.what)}</p><p class=muted style="font-size:12px;margin:0">Input: ${esc(t.inputs.join(' · '))}</p>
${t.href ? `<p style="margin:6px 0 0"><a class=pill href="${esc(t.href)}">Open</a></p>` : `<details style="margin-top:6px"><summary>Use it</summary>${toolForm(id)}</details>`}</div>`).join('')}
<script>${TOOLKIT_JS}</script>`;
}
function toolForm(id) {
  const up = (kind, label, multi) => `<label class=fld>${esc(label)} <input type=file data-kind="${kind}"${multi ? ' multiple' : ''}></label>`;
  const lic = `<label>Licence of your files <select class=q name=licence style="width:auto">${LICENCES.map((l) => `<option>${esc(l)}</option>`).join('')}</select></label>`;
  const common = `<label style="display:block"><input type=checkbox name=public> Show it in the public gallery</label><p><button type=submit>Queue it</button> <span class="muted tkmsg" style="font-size:12px"></span></p>`;
  if (id === 'animate') return `<form class=tk data-tool=animate>${up('image', 'Images (up to 40)', true)}<label class=fld>Title <input class=q name=title maxlength=120></label><label>Seconds per image <input class=q name=secs type=number value=8 min=3 max=20 style="width:80px"></label>${lic}${common}</form>`;
  if (id === 'subtitles') return `<form class=tk data-tool=subtitles><label class=fld>Video URL (https, mp4/webm) <input class=q name=url placeholder="https://…/film.mp4"></label><p class=muted style="font-size:12px">…or upload: ${up('video', '', false)}</p><label>Language <select class=q name=lang style="width:auto"><option value="">detect</option><option>en</option><option>es</option><option>fr</option><option>de</option><option>it</option><option>pt</option><option>ar</option><option>hi</option></select></label>${lic}${common}</form>`;
  if (id === 'map') return `<form class=tk data-tool=map>${up('geojson', 'Territories (GeoJSON)', false)}${up('csv', 'or a route (CSV)', false)}<label class=fld>Title <input class=q name=title maxlength=120></label><label>From year <input class=q name=fromYear type=number style="width:100px"></label> <label>To year <input class=q name=toYear type=number style="width:100px"></label>${lic}${common}</form>`;
  if (id === 'documentary') return `<form class=tk data-tool=documentary><label class=fld>Topic <input class=q name=topic maxlength=200></label><label>Length <select class=q name=minutes style="width:auto"><option>10</option><option>30</option><option>60</option></select></label>${up('text', 'Your research (.md/.txt)', true)}${up('image', 'Your images', true)}${up('assets', 'Asset pack manifest (assets.json)', false)}${up('audio', 'Your music', false)}${lic}${common}</form>`;
  return '';
}
export function dataBody(base) {
  const curl = `curl -X POST ${base}/video-studio/api/keys -H 'content-type: application/json' -d '{"voter":"<your 16+ char visitor key>"}'
# → {"ok":true,"key":"vsk_…"}   (shown once — keep it)

curl -X PUT "${base}/video-studio/api/uploads?kind=csv&licence=mine" -H "Authorization: Bearer vsk_…" -H 'content-type: text/csv' --data-binary @map-route.csv
# → {"ok":true,"id":"…","url":"/video-studio/u/…"}

curl -X POST ${base}/video-studio/api/jobs -H "Authorization: Bearer vsk_…" -H 'content-type: application/json' \\
  -d '{"tool":"animate","params":{"title":"My gallery","secs":8},"inputs":["<upload id>","<upload id>"],"public":false}'
# → {"ok":true,"id":"…"}  then  POST ${base}/video-studio/api/jobs/<id>/render  and poll GET ${base}/video-studio/api/jobs/<id>`;
  return `<h1>Your data</h1>
<div class=card style="border-color:var(--gold)"><b>Alpha.</b> Formats may still change; templates and schemas here are the current ones.</div>
<h2>Formats</h2>
<table class=an-tbl style="width:100%;font-size:13px"><tr><th>Kind</th><th>Types</th><th>Max</th><th>Template</th></tr>
${Object.entries(KINDS).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v.types.join(', '))}</td><td>${v.maxMB >= 1024 ? `${v.maxMB / 1024} GB` : `${v.maxMB} MB`}</td><td>${k === 'geojson' ? '<a href="/video-studio/data/map-territories.geojson">map-territories.geojson</a> · <a href="/video-studio/data/map-territories.schema.json">schema</a>' : k === 'csv' ? '<a href="/video-studio/data/map-route.csv">map-route.csv</a>' : k === 'assets' ? '<a href="/video-studio/data/assets.json">assets.json</a> · <a href="/video-studio/data/assets.schema.json">schema</a>' : ''}</td></tr>`).join('')}</table>
<p class=muted style="font-size:12px">Every upload needs a licence: ${esc(LICENCES.join(', '))}. Up to 10 GB a day per visitor. Your files are used for your jobs only — nothing enters our public library unless you choose a licence we can accept and opt in.</p>
<h3>Maps</h3><p>GeoJSON <code>FeatureCollection</code>; each feature needs <code>properties.name</code> and <code>properties.fromYear</code> (negative = BC), optional <code>toYear</code>. Or a CSV route with columns <code>place,lat,lon,year</code>.</p>
<h3>Asset packs</h3><p>Upload the images first, then an <code>assets.json</code> listing each file with <code>type</code> (character, object, background, symbol, scene), <code>people</code>, <code>era</code>, <code>region</code>, <code>licence</code> and <code>tags</code>.</p>
<h3>Film plans</h3><p><a href="/video-studio/data/film-plan.json">film-plan.json</a> — the same shape your own LLM returns (see <a href="/video-studio/docs">Add your own API</a>).</p>
<h2 id=api>API</h2><p>Jobs: <a href="/video-studio/data/job.schema.json">job.schema.json</a>. Check a file before uploading: <code>POST /video-studio/api/validate {"kind":"geojson","data":"…"}</code>.</p>
<pre class=card style="white-space:pre-wrap;font-size:12px">${esc(curl)}</pre>`;
}

export const TOOLKIT_JS = `
(function(){
  function voter(){var v='hathor.vstudio.voter',k;try{k=localStorage.getItem(v);if(!k){var a=new Uint8Array(16);crypto.getRandomValues(a);k=Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('');localStorage.setItem(v,k)}}catch(e){k='anon-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)}return k}
  document.querySelectorAll('form.tk').forEach(function(f){ f.addEventListener('submit', async function(e){ e.preventDefault(); var m=f.querySelector('.tkmsg'); var lic=f.licence?f.licence.value:'mine';
    try{ var ids=[]; var inputs=f.querySelectorAll('input[type=file]');
      for(var i=0;i<inputs.length;i++){ var files=inputs[i].files||[]; for(var j=0;j<files.length;j++){ var fl=files[j]; m.textContent='Uploading '+fl.name+'…';
        var type=fl.type|| (/\\.geojson$/i.test(fl.name)?'application/geo+json':/\\.csv$/i.test(fl.name)?'text/csv':/\\.md$/i.test(fl.name)?'text/markdown':'application/octet-stream');
        var r=await fetch('/video-studio/api/uploads?kind='+inputs[i].dataset.kind+'&licence='+encodeURIComponent(lic)+'&voter='+voter(),{method:'PUT',headers:{'content-type':type},body:fl}); var j2=await r.json(); if(!j2.ok) throw new Error(fl.name+': '+j2.error); ids.push(j2.id); } }
      var params={}; new FormData(f).forEach(function(v,k){ if(k!=='licence'&&k!=='public'&&typeof v==='string') params[k]=v; });
      var r2=await fetch('/video-studio/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tool:f.dataset.tool, params:params, inputs:ids, topic:params.topic||params.title||'', minutes:+(params.minutes||1), voter:voter(), public:!!(f.public&&f.public.checked)})}); var j3=await r2.json();
      if(!j3.ok) throw new Error(j3.error); location.href='/video-studio/job/'+j3.id;
    }catch(err){ m.textContent=String(err&&err.message||err); } }); });
})();`;

export default { TOOLS, KINDS, LICENCES, validate, receiveUpload, serveUpload, getUpload, issueKey, voterFromKey, toolkitBody, dataBody, TEMPLATES, SCHEMAS, toolStatus };
