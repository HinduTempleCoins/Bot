// animations.mjs — Hathor's animation lab: short test clips she makes on our CPU from the remakes and her
// characters (integrations/hathor_animate.py), shown with thumbs up / down and comments so the next batch
// gets better. Every clip carries its RECIPE (kind, motion, amplitude, camera, pace, narration); the worker
// pulls /animations/feedback.json and favours the choices people liked (Thompson sampling).
//
// Clips are NOT in git: they live in ANIMS_DIR on the web host with a manifest.json:
//   { updated, arms: {param: [values]}, clips: [ { id, kind, motion, amplitude, camera, pace, narrate, title, ... } ] }
// Feedback is an append-only JSONL file (ANIM_FEEDBACK or DATA_DIR/anim-feedback.jsonl). A voter is a random key
// made in the browser; the server stores only its salted hash. The latest vote per voter per clip counts.
// Pure builders + a sanitised file server (with Range, for video; clips are small, ~0.2–1 MB, so buffered). esc() on every interpolation. Soft-fail.

import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const ANIMS_DIR = () => process.env.ANIMS_DIR || '/var/lib/hathor-anims';
export const FEEDBACK_PATH = () => process.env.ANIM_FEEDBACK || join(process.env.DATA_DIR || join(process.cwd(), '.data', 'hathor'), 'anim-feedback.jsonl');
const SALT = () => process.env.ANIM_VOTER_SALT || 'hathor-animations-v1';
// clip ids: the worker's 12-hex hashes, or a short named series id (dna-ep1). No dots or slashes, so never a path.
const ID_RE = /^(?:[a-f0-9]{12}|[a-z][a-z0-9-]{2,40})$/;
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
export const COMMENT_MAX = 500;

// motion + amplitude only mean something when a figure is animated (puppet, Hathor's scene)
export const FIGURE_KINDS = new Set(['puppet', 'scene']);
const FIGURE_ONLY = new Set(['motion', 'amplitude']);
export const KIND_NAMES = { 'character-scene': 'Character scene', cutout: 'Cutout animation', flash: 'Flash animation', alive: 'AI motion', parallax: 'Depth parallax', explainer: 'Explainer', kenburns: 'Camera move', looks: 'Look morph', peoples: 'Peoples', puppet: 'Brought to life', scene: 'Hathor’s scene' };

export function loadAnimManifest(dir = ANIMS_DIR()) {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    return m && Array.isArray(m.clips) ? m : { clips: [] };
  } catch { return { clips: [] }; }
}

export const voterHash = (key) => createHash('sha256').update(`${SALT()}:${key}`).digest('hex').slice(0, 24);

export function readFeedback(path = FEEDBACK_PATH()) {
  try {
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function appendFeedback(entry, path = FEEDBACK_PATH()) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + '\n');
    return true;
  } catch { return false; }
}

/** per clip: {up, down, comments:[{ts,text,vote}]}; per arm: {param:{value:{up,down}}} (arms need the manifest). */
export function aggregate(entries, manifest = { clips: [] }) {
  const latest = new Map(); // `${id}|${voter}` -> vote
  const clips = {};
  const c = (id) => (clips[id] ||= { up: 0, down: 0, comments: [] });
  for (const e of entries) {
    if (!e || !ID_RE.test(e.id || '')) continue;
    if (e.vote === 'up' || e.vote === 'down') latest.set(`${e.id}|${e.voter}`, e.vote);
    if (e.comment) c(e.id).comments.push({ ts: e.ts, text: e.comment, vote: e.vote || '' });
  }
  for (const [k, v] of latest) { const id = k.split('|')[0]; c(id)[v === 'up' ? 'up' : 'down'] += 1; }
  const arms = {};
  for (const clip of manifest.clips || []) {
    const s = clips[clip.id];
    if (!s) continue;
    for (const p of ['kind', 'motion', 'amplitude', 'camera', 'pace', 'narrate']) {
      const v = clip[p];
      if (!v || (FIGURE_ONLY.has(p) && !FIGURE_KINDS.has(clip.kind))) continue; // a camera move has no motion to credit
      const a = ((arms[p] ||= {})[v] ||= { up: 0, down: 0 });
      a.up += s.up; a.down += s.down;
    }
  }
  return { clips, arms };
}

// ── page ──────────────────────────────────────────────────────────────────────────────────────────
function chips(c) {
  const bits = [KIND_NAMES[c.kind] || c.kind];
  if (c.kind === 'puppet' || c.kind === 'scene') bits.push(`${c.motion} · ${c.amplitude}`);
  bits.push(c.camera, c.pace, c.narrate === 'yes' ? 'narrated' : 'silent');
  return bits.map((b) => `<span class=an-chip>${esc(b)}</span>`).join('');
}

function learningPanel(arms) {
  const names = { kind: 'Kind', motion: 'Motion', amplitude: 'Strength', camera: 'Camera', pace: 'Pace', narrate: 'Narration' };
  const rows = Object.entries(names).map(([p, label]) => {
    const vals = Object.entries(arms[p] || {}).filter(([, s]) => s.up + s.down > 0)
      .sort((a, b) => (b[1].up - b[1].down) - (a[1].up - a[1].down));
    if (!vals.length) return '';
    return `<tr><th>${esc(label)}</th><td>${vals.map(([v, s]) => `<span class=an-chip>${esc(v)} <b style="color:#7bd88f">${s.up}</b>/<b style="color:#ff7a7a">${s.down}</b></span>`).join(' ')}</td></tr>`;
  }).join('');
  return rows ? `<details class=card open><summary><b>What Hathor is learning from your votes</b></summary>
    <p class=muted style="font-size:12px">Thumbs up / down on each choice. The next batch makes more of what you like and still tries new things.</p>
    <table class=an-tbl>${rows}</table></details>` : '';
}

export function animationsBody(manifest, agg, { sort = 'new' } = {}) {
  const clips = [...(manifest.clips || [])];
  const score = (c) => { const s = agg.clips[c.id] || { up: 0, down: 0 }; return s.up - s.down; };
  if (sort === 'top') clips.sort((a, b) => score(b) - score(a));
  else if (sort === 'unrated') clips.sort((a, b) => { const sa = agg.clips[a.id], sb = agg.clips[b.id]; return ((sa ? sa.up + sa.down : 0) - (sb ? sb.up + sb.down : 0)); });
  const tabs = [['new', 'Newest'], ['unrated', 'Needs votes'], ['top', 'Best liked']]
    .map(([k, n]) => `<a class="pill${k === sort ? ' on' : ''}" href="/animations?sort=${k}">${esc(n)}</a>`).join(' ');
  const cards = clips.map((c) => {
    const s = agg.clips[c.id] || { up: 0, down: 0, comments: [] };
    const com = s.comments.slice(-5).reverse().map((x) => `<li>${x.vote === 'up' ? '👍 ' : x.vote === 'down' ? '👎 ' : ''}${esc(x.text)}</li>`).join('');
    const who = c.puppet_title && c.kind !== 'puppet' ? ` · with ${esc(c.puppet_title)}` : '';
    return `<section class="card an-card" id="c-${esc(c.id)}">
      <video controls playsinline preload=none poster="/animations/media/${esc(c.id)}/poster.jpg" src="/animations/media/${esc(c.id)}/clip.mp4"></video>
      <h3>${esc(c.kind === 'puppet' ? (c.puppet_title || c.title) : c.title)}<span class=muted style="font-size:12px">${who}</span></h3>
      <div>${chips(c)}</div>
      ${c.narration_text ? `<p class=muted style="font-size:12px;margin:6px 0 0">“${esc(c.narration_text)}”</p>` : ''}
      <form class=an-form data-id="${esc(c.id)}">
        <div class=row style="gap:6px;align-items:center;margin-top:8px">
          <button type=button class=an-v data-v=up>👍 <span>${s.up}</span></button>
          <button type=button class=an-v data-v=down>👎 <span>${s.down}</span></button>
          <span class="muted an-msg" style="font-size:12px"></span></div>
        <textarea class=q name=comment maxlength=${COMMENT_MAX} placeholder="What would make it better? (optional)" style="min-height:44px;margin-top:6px"></textarea>
        <button type=submit class=pill style="margin-top:4px">Send comment</button>
      </form>
      ${com ? `<ul class=an-com>${com}</ul>` : ''}
    </section>`;
  }).join('');
  return `<style>.an-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
    .an-card video{width:100%;border-radius:8px;background:#000;aspect-ratio:16/9;display:block}
    .an-card h3{margin:8px 0 4px;font-size:15px}.an-chip{display:inline-block;font-size:11px;border:1px solid var(--line2);border-radius:10px;padding:1px 7px;margin:2px 3px 0 0;color:var(--mut)}
    .an-v{font-size:15px}.an-v.on{border-color:var(--gold)}.an-com{font-size:13px;margin:8px 0 0;padding-left:18px}.an-tbl th{text-align:left;padding-right:10px;font-size:13px;vertical-align:top}
    .pill.on{border-color:var(--gold);color:var(--gold)}</style>
    <h1>Animation lab <span class=muted style="font-size:14px">· Hathor is learning to animate</span></h1>
    <div class=card style="border-color:var(--gold)"><b>Alpha.</b> These are Hathor's first test animations, made on our own servers. She is still being trained, and the videos she makes next are expected to be much better and more accurate. Your votes and comments are part of that training.</div>
    <p class=muted>Short test animations Hathor makes on our own servers from the <a href="/remakes">Remakes</a> and the characters she is building.
      They are rough on purpose: tell her what works. 👍 or 👎 each one, and say why if you can. Every clip records how it was made, so your votes
      decide what she makes next.</p>
    ${learningPanel(agg.arms)}
    <p>${tabs} <span class=muted style="font-size:12px">${clips.length} clips</span></p>
    ${cards ? `<div class=an-grid>${cards}</div>` : '<div class=card><p class=empty>The first batch is still rendering. Check back soon.</p></div>'}
    <script>(function(){var K='hathor-anim-voter',k;try{k=localStorage.getItem(K);if(!k){var a=new Uint8Array(16);crypto.getRandomValues(a);k=Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('');localStorage.setItem(K,k);}}catch(e){k='anon-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
      function send(f,v,c){var m=f.querySelector('.an-msg');var p=new URLSearchParams({id:f.dataset.id,voter:k,vote:v||'',comment:c||''});
        return fetch('/api/animations/rate',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:p.toString()}).then(function(r){return r.json()}).then(function(j){
          if(!j.ok){m.textContent=j.error==='rate-limited'?'Slow down a little.':'Could not save.';return;}
          f.querySelector('[data-v=up] span').textContent=j.up;f.querySelector('[data-v=down] span').textContent=j.down;m.textContent=c?'Thank you, noted.':'Saved.';
        }).catch(function(){m.textContent='Could not save.';});}
      document.querySelectorAll('.an-form').forEach(function(f){var last='';
        f.querySelectorAll('.an-v').forEach(function(b){b.addEventListener('click',function(){last=b.dataset.v;f.querySelectorAll('.an-v').forEach(function(x){x.classList.toggle('on',x===b)});send(f,last,'');});});
        f.addEventListener('submit',function(e){e.preventDefault();var t=f.comment.value.trim();if(!t)return;send(f,last,t).then(function(){f.comment.value='';});});});})();</script>`;
}

// ── POST /api/animations/rate ─────────────────────────────────────────────────────────────────────
const hits = new Map();
export const RATE_PER_HOUR = +(process.env.ANIM_RATE_PER_HOUR || 200);
export function __resetAnimRate() { hits.clear(); }
function rateOk(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => t > now - 3600e3);
  if (arr.length >= RATE_PER_HOUR) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr); return true;
}

/** validate + store one vote/comment. params: URLSearchParams. → {code, body} */
export function rate(params, ip, manifest = loadAnimManifest(), path = FEEDBACK_PATH()) {
  const id = String(params.get('id') || '');
  const voter = String(params.get('voter') || '');
  const vote = String(params.get('vote') || '');
  const comment = String(params.get('comment') || '').replace(/\s+/g, ' ').trim().slice(0, COMMENT_MAX);
  if (!ID_RE.test(id) || !(manifest.clips || []).some((c) => c.id === id)) return { code: 404, body: { ok: false, error: 'unknown clip' } };
  if (!KEY_RE.test(voter)) return { code: 400, body: { ok: false, error: 'bad voter' } };
  if (vote && vote !== 'up' && vote !== 'down') return { code: 400, body: { ok: false, error: 'bad vote' } };
  if (!vote && !comment) return { code: 400, body: { ok: false, error: 'nothing to save' } };
  if (!rateOk(ip)) return { code: 429, body: { ok: false, error: 'rate-limited' } };
  const entry = { ts: Date.now(), id, voter: voterHash(voter) };
  if (vote) entry.vote = vote;
  if (comment) entry.comment = comment;
  if (!appendFeedback(entry, path)) return { code: 500, body: { ok: false, error: 'store unavailable' } };
  const s = aggregate(readFeedback(path)).clips[id] || { up: 0, down: 0 };
  return { code: 200, body: { ok: true, up: s.up, down: s.down } };
}

// ── media (mp4 with Range, poster jpg) ────────────────────────────────────────────────────────────
export function serveAnimMedia(req, res, rel, dir = ANIMS_DIR()) {
  const m = /^([a-f0-9]{12}|[a-z][a-z0-9-]{2,40})\/(clip\.mp4|poster\.jpg)$/.exec(String(rel || ''));
  const full = m && join(dir, m[1], m[2]);
  if (!m || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const type = m[2].endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
  const size = statSync(full).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ''));
  if (range && type === 'video/mp4') {
    let start = range[1] === '' ? size - +range[2] : +range[1];
    let end = range[1] !== '' && range[2] !== '' ? +range[2] : size - 1;
    if (!(start >= 0 && start <= end && end < size)) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'public, max-age=86400' });
    return res.end(readFileSync(full).subarray(start, end + 1));
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'public, max-age=86400' });
  return res.end(readFileSync(full));
}

/** schema.org ItemList of VideoObjects (Google video results + AI engines). */
export function animationsLd(manifest, base) {
  const clips = (manifest.clips || []).slice(0, 100);
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name: 'Hathor Studio — Animation lab', url: `${base}/animations`,
    itemListElement: clips.map((c, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: {
        '@type': 'VideoObject',
        name: c.kind === 'puppet' ? (c.puppet_title || c.title) : c.title,
        description: c.narration_text || `${KIND_NAMES[c.kind] || c.kind}: ${c.title} — a test animation Hathor made on our own servers.`,
        thumbnailUrl: `${base}/animations/media/${c.id}/poster.jpg`,
        contentUrl: `${base}/animations/media/${c.id}/clip.mp4`,
        ...(c.made ? { uploadDate: new Date(c.made * 1000).toISOString() } : {}),
        ...(c.seconds ? { duration: `PT${Math.max(1, Math.round(c.seconds))}S` } : {}),
        creator: { '@type': 'Person', name: 'Hathor', url: 'https://melek.salon/@hathor' },
      },
    })),
  };
}

export default { loadAnimManifest, aggregate, animationsBody, rate, serveAnimMedia, readFeedback, voterHash, ANIMS_DIR, FEEDBACK_PATH };
