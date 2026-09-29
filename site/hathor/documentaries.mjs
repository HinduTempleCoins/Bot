// documentaries.mjs — Hathor's documentaries (ALPHA) on the Studio: wordless, eerie recreations of the ancient world
// built on our own servers (integrations/documentary/). A list page and a film page with chapters, the on-screen text
// (each factual card marked historical record / tradition / the Institute's interpretation), sources, the parts it
// could not find yet, and FEEDBACK so the next batch gets better: 👍/👎 + comment, and timestamped notes ("at 3:12 …")
// captured from the player. Every film's recipe (style, shots, assets) is kept, so feedback maps back to choices;
// /documentaries/feedback.json exports it for the batch planner.
//
// Films are NOT in git: DOCS_DIR (default /var/lib/hathor-docs) holds <id>/film.mp4, poster.jpg, film.json, and a
// manifest.json { updated, films:[film.json minus recipe] }. Feedback: append-only JSONL (DOCS_FEEDBACK or
// DATA_DIR/docs-feedback.jsonl); voter = random browser key, stored only as a salted hash; latest vote counts.

import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync, openSync, readSync, closeSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const DOCS_DIR = () => process.env.DOCS_DIR || '/var/lib/hathor-docs';
export const DOCS_FEEDBACK = () => process.env.DOCS_FEEDBACK || join(process.env.DATA_DIR || join(process.cwd(), '.data', 'hathor'), 'docs-feedback.jsonl');
export const ALPHA_BANNER = 'Alpha — these are Hathor\'s first documentaries, made on our own servers. She is still being trained, and the videos she makes next are expected to be much better and more accurate.';
const SALT = () => process.env.DOCS_VOTER_SALT || 'hathor-docs-v1';
const ID_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
export const COMMENT_MAX = 600;
const KIND_LABEL = { record: 'Historical record', tradition: 'Tradition / scripture', interpretation: 'The Institute\'s interpretation' };

export function loadDocs(dir = DOCS_DIR()) {
  try { const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); return m && Array.isArray(m.films) ? m : { films: [] }; } catch { return { films: [] }; }
}
export function loadFilm(id, dir = DOCS_DIR()) {
  if (!ID_RE.test(String(id || ''))) return null;
  try { return JSON.parse(readFileSync(join(dir, id, 'film.json'), 'utf8')); } catch { return null; }
}

export const voterHash = (key) => createHash('sha256').update(`${SALT()}:${key}`).digest('hex').slice(0, 24);
export function readFeedback(path = DOCS_FEEDBACK()) {
  try { return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}
function append(entry, path = DOCS_FEEDBACK()) {
  try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, JSON.stringify(entry) + '\n'); return true; } catch { return false; }
}

/** per film: { up, down, comments:[{ts,text,vote}], notes:[{at,text}] } */
export function aggregate(entries) {
  const latest = new Map(); const films = {};
  const f = (id) => (films[id] ||= { up: 0, down: 0, comments: [], notes: [] });
  for (const e of entries) {
    if (!e || !ID_RE.test(e.id || '')) continue;
    if (e.vote === 'up' || e.vote === 'down') latest.set(`${e.id}|${e.voter}`, e.vote);
    if (e.comment && e.at == null) f(e.id).comments.push({ ts: e.ts, text: e.comment, vote: e.vote || '' });
    if (e.comment && e.at != null) f(e.id).notes.push({ ts: e.ts, at: e.at, text: e.comment });
  }
  for (const [k, v] of latest) f(k.split('|')[0])[v] += 1;
  for (const x of Object.values(films)) x.notes.sort((a, b) => a.at - b.at);
  return films;
}

const hits = new Map();
export function __resetDocsRate() { hits.clear(); }
function rateOk(ip, per = +(process.env.DOCS_RATE_PER_HOUR || 200)) {
  const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => t > now - 3600e3);
  if (arr.length >= per) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr); return true;
}

/** POST /api/documentaries/feedback: id, voter, vote?, comment?, at? (seconds into the film for a timestamped note) */
export function feedback(params, ip, { dir = DOCS_DIR(), path = DOCS_FEEDBACK() } = {}) {
  const id = String(params.get('id') || '');
  const voter = String(params.get('voter') || '');
  const vote = String(params.get('vote') || '');
  const comment = String(params.get('comment') || '').replace(/\s+/g, ' ').trim().slice(0, COMMENT_MAX);
  const atRaw = params.get('at');
  const at = atRaw != null && atRaw !== '' ? Math.max(0, Math.min(36000, Math.round(+atRaw * 10) / 10)) : null;
  if (!ID_RE.test(id) || !loadFilm(id, dir)) return { code: 404, body: { ok: false, error: 'unknown film' } };
  if (!KEY_RE.test(voter)) return { code: 400, body: { ok: false, error: 'bad voter' } };
  if (vote && vote !== 'up' && vote !== 'down') return { code: 400, body: { ok: false, error: 'bad vote' } };
  if (at != null && (!comment || Number.isNaN(at))) return { code: 400, body: { ok: false, error: 'a note needs text' } };
  if (!vote && !comment) return { code: 400, body: { ok: false, error: 'nothing to save' } };
  if (!rateOk(ip)) return { code: 429, body: { ok: false, error: 'rate-limited' } };
  const e = { ts: Date.now(), id, voter: voterHash(voter) };
  if (vote) e.vote = vote; if (comment) e.comment = comment; if (at != null) e.at = at;
  if (!append(e, path)) return { code: 500, body: { ok: false, error: 'store unavailable' } };
  const s = aggregate(readFeedback(path))[id] || { up: 0, down: 0 };
  return { code: 200, body: { ok: true, up: s.up, down: s.down } };
}

/** export for the batch planner: votes/notes per film joined with each film's recipe (style + assets per shot). */
export function feedbackExport(dir = DOCS_DIR(), path = DOCS_FEEDBACK()) {
  const agg = aggregate(readFeedback(path));
  const films = {};
  for (const f of loadDocs(dir).films) {
    const full = loadFilm(f.id, dir) || {};
    films[f.id] = { ...(agg[f.id] || { up: 0, down: 0, comments: [], notes: [] }), style: full.style || '', minutes: full.minutes, recipe: full.recipe || null };
  }
  return { updated: Date.now(), films };
}

const ts = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`; };
const banner = `<div class=card style="border-color:#e0a11b;background:#1a1405"><b style="color:#e0a11b">ALPHA</b> · ${esc(ALPHA_BANNER)}</div>`;
const STYLE = `<style>.dc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}.dc-card img{width:100%;border-radius:8px;aspect-ratio:16/9;object-fit:cover}
.dc-v{width:100%;border-radius:10px;background:#000;aspect-ratio:16/9}.dc-chip{display:inline-block;font-size:11px;border:1px solid var(--line2);border-radius:10px;padding:1px 7px;color:var(--mut);margin-right:4px}
.dc-t{font-family:ui-monospace,monospace;color:var(--gold)}.dc-list li{margin:3px 0}.dc-note{font-size:13px}</style>`;

export function listBody(manifest, agg) {
  const films = [...(manifest.films || [])].sort((a, b) => (b.made || 0) - (a.made || 0));
  const cards = films.map((f) => { const s = agg[f.id] || { up: 0, down: 0 }; return `<a class="card dc-card" href="/documentaries/${esc(f.id)}" style="text-decoration:none">
    <img src="/documentaries/media/${esc(f.id)}/poster.jpg" alt="" loading=lazy><h3 style="margin:8px 0 4px">${esc(f.title)}</h3>
    <div><span class=dc-chip>${esc(ts(f.seconds || 0))}</span><span class=dc-chip>wordless</span><span class=dc-chip>👍 ${s.up} · 👎 ${s.down}</span></div>
    <p class=muted style="font-size:13px;margin:6px 0 0">${esc((f.summary || '').slice(0, 160))}</p></a>`; }).join('');
  return `${STYLE}${banner}<h1>Documentaries <span class=muted style="font-size:14px">· the ancient world, recreated</span></h1>
  <p class=muted>Slow, wordless recreations — made by Hathor on our own servers from the scenes, characters and objects of the Studio. On-screen cards say plainly what is the historical record, what is scripture or tradition, and what is the Institute's reading. Watch, then tell her what works: vote, comment, or leave a note at any moment of the film.</p>
  ${cards ? `<div class=dc-grid>${cards}</div>` : '<div class=card><p class=empty>The first films are rendering now.</p></div>'}`;
}

export function filmBody(f, s = { up: 0, down: 0, comments: [], notes: [] }) {
  const chapters = (f.chapters || []).map((c) => `<li><a href="#" data-t="${esc(c.start)}" class=dc-seek><span class=dc-t>${esc(ts(c.start))}</span></a> ${esc(c.title)}</li>`).join('');
  const onscreen = (f.onscreen || []).map((o) => `<li><a href="#" data-t="${esc(o.at)}" class=dc-seek><span class=dc-t>${esc(ts(o.at))}</span></a> ${esc(o.text)}${KIND_LABEL[o.kind] ? ` <span class=dc-chip>${esc(KIND_LABEL[o.kind])}${o.source ? ` · ${esc(o.source)}` : ''}</span>` : ''}</li>`).join('');
  const src = f.sources || {};
  const srcHtml = Object.entries(KIND_LABEL).filter(([k]) => (src[k] || []).length).map(([k, lab]) => `<p><b>${esc(lab)}:</b> ${src[k].map(esc).join(' · ')}</p>`).join('');
  const notes = (s.notes || []).map((n) => `<li class=dc-note><a href="#" data-t="${esc(n.at)}" class=dc-seek><span class=dc-t>${esc(ts(n.at))}</span></a> ${esc(n.text)}</li>`).join('');
  const comments = (s.comments || []).slice(-20).reverse().map((c) => `<li class=dc-note>${c.vote === 'up' ? '👍 ' : c.vote === 'down' ? '👎 ' : ''}${esc(c.text)}</li>`).join('');
  const missing = (f.missing || []).slice(0, 30).map((m) => `<li class=dc-note>${esc(m.visual)}</li>`).join('');
  return `${STYLE}${banner}<p><a href="/documentaries">← All documentaries</a></p>
  <h1 style="margin-bottom:4px">${esc(f.title)}</h1><p class=muted style="margin-top:0">${esc(f.summary || '')}</p>
  <video id=dcv class=dc-v controls playsinline preload=metadata poster="/documentaries/media/${esc(f.id)}/poster.jpg" src="/documentaries/media/${esc(f.id)}/film.mp4"></video>
  <form id=dcf data-id="${esc(f.id)}" class=card style="margin-top:10px">
    <div class=row style="gap:6px;align-items:center;flex-wrap:wrap"><button type=button class=dc-v2 data-v=up>👍 <span>${s.up}</span></button><button type=button class=dc-v2 data-v=down>👎 <span>${s.down}</span></button>
    <span class="muted dc-msg" style="font-size:12px"></span></div>
    <textarea class=q name=comment maxlength=${COMMENT_MAX} placeholder="What works, what doesn't, what is wrong or missing?" style="min-height:48px;margin-top:6px"></textarea>
    <div class=row style="gap:6px;margin-top:6px;flex-wrap:wrap"><button type=submit class=pill>Send comment</button><button type=button id=dcnote class=pill>📍 Note at <span id=dcnow>0:00</span></button></div>
  </form>
  ${notes ? `<h2>Notes at moments</h2><ul class=dc-list>${notes}</ul>` : ''}
  ${chapters ? `<h2>Chapters</h2><ul class=dc-list>${chapters}</ul>` : ''}
  ${onscreen ? `<h2>On-screen text</h2><ul class=dc-list>${onscreen}</ul>` : ''}
  <h2>Sources</h2>${srcHtml || '<p class=muted>No sources listed.</p>'}${(f.credits || []).length ? `<p class=muted>${(f.credits || []).map(esc).join(' · ')}</p>` : ''}
  <p class=muted style="font-size:12px">Sound: ${esc(f.audio && f.audio.track || 'ambient')} (${esc(f.audio && f.audio.licence || '')}). Made in ${esc(Math.round(f.renderSeconds || 0))} s of CPU.</p>
  ${comments ? `<h2>Comments</h2><ul class=dc-list>${comments}</ul>` : ''}
  ${missing ? `<details><summary class=muted>Scenes Hathor has no parts for yet (${(f.missing || []).length}) — the next things to make</summary><ul class=dc-list>${missing}</ul></details>` : ''}
  <script>(function(){var v=document.getElementById('dcv'),f=document.getElementById('dcf'),m=f.querySelector('.dc-msg'),now=document.getElementById('dcnow'),K='hathor-doc-voter',k;
    try{k=localStorage.getItem(K);if(!k){var a=new Uint8Array(16);crypto.getRandomValues(a);k=Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('');localStorage.setItem(K,k);}}catch(e){k='anon-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
    function fmt(s){s=Math.round(s);return Math.floor(s/60)+':'+('0'+s%60).slice(-2)}
    v.addEventListener('timeupdate',function(){now.textContent=fmt(v.currentTime)});
    document.querySelectorAll('.dc-seek').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();v.currentTime=+a.dataset.t;v.play();})});
    function send(p){p.id=f.dataset.id;p.voter=k;return fetch('/api/documentaries/feedback',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(p).toString()}).then(function(r){return r.json()}).then(function(j){
      if(!j.ok){m.textContent=j.error==='rate-limited'?'Slow down a little.':'Could not save.';return j;}f.querySelector('[data-v=up] span').textContent=j.up;f.querySelector('[data-v=down] span').textContent=j.down;return j;}).catch(function(){m.textContent='Could not save.'});}
    f.querySelectorAll('.dc-v2').forEach(function(b){b.addEventListener('click',function(){send({vote:b.dataset.v}).then(function(j){if(j&&j.ok)m.textContent='Saved.'})})});
    f.addEventListener('submit',function(e){e.preventDefault();var t=f.comment.value.trim();if(!t)return;send({comment:t}).then(function(j){if(j&&j.ok){m.textContent='Thank you, noted.';f.comment.value='';}})});
    document.getElementById('dcnote').addEventListener('click',function(){var t=f.comment.value.trim();if(!t){m.textContent='Type your note first, then press this at the moment it is about.';return;}
      send({comment:t,at:v.currentTime.toFixed(1)}).then(function(j){if(j&&j.ok){m.textContent='Note saved at '+fmt(v.currentTime)+'.';f.comment.value='';}})});})();</script>`;
}

/** media: <id>/film.mp4 (Range) | poster.jpg */
export function serveDocMedia(req, res, rel, dir = DOCS_DIR()) {
  const m = /^([a-z0-9][a-z0-9-]{1,60})\/(film\.mp4|poster\.jpg)$/.exec(String(rel || ''));
  const full = m && join(dir, m[1], m[2]);
  if (!m || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const type = m[2].endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
  const size = statSync(full).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ''));
  // A real HTTP response is a writable stream: stream straight from disk (no memory cost), so full downloads and
  // open-ended ranges get the WHOLE file. (The in-memory chunked path below is only for non-stream test doubles.)
  if (typeof res.write === 'function' && typeof res.on === 'function' && type === 'video/mp4') {
    if (range) {
      const start = range[1] === '' ? size - +range[2] : +range[1];
      const end = range[1] !== '' && range[2] !== '' ? Math.min(+range[2], size - 1) : size - 1;
      if (!(start >= 0 && start <= end && end < size)) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'public, max-age=86400' });
      return createReadStream(full, { start, end }).on('error', () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'public, max-age=86400' });
    return createReadStream(full).on('error', () => res.destroy()).pipe(res);
  }
  if (range && type === 'video/mp4') {
    const start = range[1] === '' ? size - +range[2] : +range[1];
    const end = range[1] !== '' && range[2] !== '' ? Math.min(+range[2], size - 1) : Math.min(size - 1, start + 4 * 1024 * 1024 - 1);
    if (!(start >= 0 && start <= end && end < size)) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    // films are tens of MB: read only the requested range (capped at 4 MB per response)
    const buf = Buffer.alloc(end - start + 1);
    const fd = openSync(full, 'r'); try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': buf.length, 'cache-control': 'public, max-age=86400' });
    return res.end(buf);
  }
  if (type === 'video/mp4' && size > 4 * 1024 * 1024) { // no Range on a big film: send the first chunk as a 206 so players range from there
    const buf = Buffer.alloc(4 * 1024 * 1024); const fd = openSync(full, 'r'); try { readSync(fd, buf, 0, buf.length, 0); } finally { closeSync(fd); }
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes 0-${buf.length - 1}/${size}`, 'accept-ranges': 'bytes', 'content-length': buf.length });
    return res.end(buf);
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'public, max-age=86400' });
  return res.end(readFileSync(full));
}

export function ld(f, base) {
  return { '@context': 'https://schema.org', '@type': 'VideoObject', name: `${f.title} (Alpha)`, description: `${f.summary || ''} ${ALPHA_BANNER}`,
    thumbnailUrl: `${base}/documentaries/media/${f.id}/poster.jpg`, contentUrl: `${base}/documentaries/media/${f.id}/film.mp4`,
    ...(f.made ? { uploadDate: new Date(f.made * 1000).toISOString() } : {}), ...(f.seconds ? { duration: `PT${Math.round(f.seconds)}S` } : {}), creator: { '@type': 'Person', name: 'Hathor' } };
}
