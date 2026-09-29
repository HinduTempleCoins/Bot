// video-studio.mjs — Hathor Video Studio: type a topic, pick a length and a style, get a video (InVideo/CapCut-like),
// on OUR free CPU engines or on the user's OWN engines (bring your own API) — per stage.
//
//   /video-studio                 create form (topic · 1/10/30/60 min · style · tags · engines per stage)
//   /video-studio/job/<id>        status: stage progress, shot plan (editable before render), preview, final mp4
//   /video-studio/gallery         finished public videos (opt-in) with sources/licences
//   /video-studio/tools           the free and open tools + media sources it is built with (licences)
//   /video-studio/docs            "Add your own API" — the provider JSON contract
//   /video-studio/api/*           JSON API (plan, jobs) + the WORKER API (token): the CPU worker PULLS queued jobs over
//                                 HTTPS and PUTs results back — no SSH trust between hosts.
//
// KEYS: a user's provider keys stay in THEIR BROWSER (localStorage), exactly like /engines; their-engine stages run
// from the browser straight to the provider; only the RESULT (a shot plan, an image URL/data) reaches our server.
// Pentecaust Connect is the opt-in server-side custodian. Nothing here reads, logs or stores a provider key.
// Everything carries the Alpha notice. Pure builders + a small JSONL store; esc() on every interpolation; soft-fail.

import { readFileSync, existsSync, appendFileSync, mkdirSync, statSync, createWriteStream, createReadStream, renameSync, openSync, readSync, closeSync } from 'node:fs';
import { ENGINE_CLIENT_JS } from './engines.mjs';
import * as TK from './video-studio-toolkit.mjs';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const __dir = dirname(fileURLToPath(import.meta.url));
export const VS_DIR = () => process.env.VSTUDIO_DIR || join(process.env.DATA_DIR || join(process.cwd(), '.data', 'hathor'), 'video-studio');
const JOBS = () => join(VS_DIR(), 'jobs.jsonl');
const MEDIA = (id) => join(VS_DIR(), 'media', id);

export const ALPHA = 'Alpha — these are Hathor’s first videos, made on our own servers or on your engines. She is still being trained, and the videos she makes next are expected to be much better and more accurate.';
export const LENGTHS = [1, 10, 30, 60];
export const STYLES = {
  eerie: { name: 'Eerie recreation — wordless', note: 'Slow, atmospheric, ambient sound, sparse on-screen text: place, era and a question. The default.', secsPerShot: 8 },
  documentary: { name: 'Documentary — on-screen text', note: 'More text: chapter cards and a line under every shot.', secsPerShot: 7 },
  narrated: { name: 'Narrated (coming later)', note: 'Hathor narrates. Not available yet.', secsPerShot: 7, disabled: true },
};
export const STAGES = {
  plan: { name: 'Script & shot plan', providers: ['ours', 'openai', 'gemini', 'groq', 'openrouter', 'anthropic', 'custom'] },
  images: { name: 'Images', providers: ['ours', 'fal', 'gemini', 'worker', 'custom'] },
  motion: { name: 'Motion & assembly', providers: ['ours'] },
  music: { name: 'Sound', providers: ['ours'] },
};
export const PROVIDER_NAMES = { ours: 'Ours (free, our CPU — queued)', openai: 'OpenAI (your key)', gemini: 'Google Gemini (your key)', groq: 'Groq (your key)', openrouter: 'OpenRouter (your key)', anthropic: 'Anthropic (your key)', fal: 'fal.ai (your key)', worker: 'Your own worker (URL + password)', custom: 'Your own API (see docs)' };

// Our CPU is shared: cap what the free engine takes per day, and per visitor.
export const LIMITS = { perVisitorPerDay: +(process.env.VSTUDIO_PER_VISITOR || 3), oursMinutesPerDay: +(process.env.VSTUDIO_OURS_MINUTES || 90), maxShots: 600, uploadMB: 700 };
export const RENDER_SECS_PER_VIDEO_MINUTE = 45; // measured budget for reuse-first assembly on the worker (updated from real runs)

// ── store (append-only JSONL: each line is a full job snapshot; last line per id wins) ──────────────────────
let _cache = null;
export function __resetStore() { _cache = null; }
export function loadJobs() {
  if (_cache) return _cache;
  const m = new Map();
  try {
    for (const l of readFileSync(JOBS(), 'utf8').split('\n')) { if (!l) continue; try { const j = JSON.parse(l); if (j && j.id) m.set(j.id, j); } catch {} }
  } catch {}
  _cache = m;
  return m;
}
export function saveJob(job) {
  try { mkdirSync(VS_DIR(), { recursive: true }); appendFileSync(JOBS(), JSON.stringify(job) + '\n'); loadJobs().set(job.id, job); return true; } catch { return false; }
}
export const getJob = (id) => (/^[a-f0-9]{16}$/.test(String(id || '')) ? loadJobs().get(id) || null : null);
export const voterHash = (key) => createHash('sha256').update(`${process.env.VSTUDIO_SALT || 'hathor-vstudio-v1'}:${key}`).digest('hex').slice(0, 24);
const today = () => new Date().toISOString().slice(0, 10);

/** Queue position + honest ETA for an ours-engine job. */
export function queueInfo(job, jobs = loadJobs()) {
  const queued = [...jobs.values()].filter((j) => j.status === 'queued' || j.status === 'rendering').sort((a, b) => a.created - b.created);
  const pos = queued.findIndex((j) => j.id === job.id);
  const ahead = pos < 0 ? [] : queued.slice(0, pos);
  const mins = ahead.reduce((n, j) => n + (+j.minutes || 1), 0) + (+job.minutes || 1);
  return { position: pos < 0 ? 0 : pos + 1, etaMinutes: Math.ceil((mins * RENDER_SECS_PER_VIDEO_MINUTE) / 60) + 2 };
}

// ── our planner: topic → shot plan, reuse-first from the remakes gallery (no LLM, no key, deterministic) ─────
const STOP = new Set('the and of a an in on to for with from before after about how what who why when their its is are was were into at by as or'.split(' '));
const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const QUESTIONS = ['How was this made?', 'Who stood here?', 'What did they see?', 'How long did this take?', 'What did they believe?', 'Where did they come from?', 'What remains of it now?', 'Who remembered this?'];

/** { title, minutes, style, chapters:[{title, shots:[{image, card, question, secs, credit, scene}]}], sources:[...] } */
export function ourPlan({ topic, minutes = 10, style = 'eerie', tags = [] }, manifest = { scenes: [] }, base = '') {
  const st = STYLES[style] && !STYLES[style].disabled ? STYLES[style] : STYLES.eerie;
  const need = Math.min(LIMITS.maxShots, Math.max(4, Math.round((minutes * 60) / st.secsPerShot)));
  const q = new Set([...words(topic), ...tags.flatMap(words)]);
  const scored = (manifest.scenes || []).map((s) => {
    const hay = words(`${s.title} ${s.group} ${s.credit}`);
    let score = 0; for (const w of hay) if (q.has(w)) score += 1;
    return { s, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  // matching scenes first, then the rest of the gallery, so a long film never runs dry
  const matchedKeys = new Set(scored.map((x) => x.s.key));
  const pool = [...scored.map((x) => x.s), ...(manifest.scenes || []).filter((s) => !matchedKeys.has(s.key))];
  const shots = [];
  // one image per scene first, then its other looks/peoples, so the film moves through places before repeating
  for (let round = 0; shots.length < need && round < 30; round++) {
    let added = 0;
    for (const s of pool) {
      if (shots.length >= need) break;
      const files = Object.entries(s.looks || {}).flatMap(([, set]) => Object.values(set || {}));
      const f = files[round];
      if (!f) continue;
      added += 1;
      shots.push({ scene: s.key, image: `${base}/remakes/img/${s.key}/${f}`, card: s.title, credit: s.credit || '', group: s.group || '', secs: st.secsPerShot, question: (shots.length % 5 === 2) ? QUESTIONS[shots.length % QUESTIONS.length] : '' });
    }
    if (!added) break;
  }
  for (let i = 0; shots.length && shots.length < need; i++) shots.push({ ...shots[i], question: '' }); // small gallery: revisit, a new camera pass
  const chapters = [];
  for (const sh of shots) {
    const g = sh.group || 'Scenes';
    if (!chapters.length || chapters[chapters.length - 1].title !== g) chapters.push({ title: g, shots: [] });
    chapters[chapters.length - 1].shots.push(sh);
  }
  const sources = [...new Set(shots.map((s) => s.credit).filter(Boolean))];
  return { title: String(topic || 'Untitled').slice(0, 120), minutes, style: STYLES[style] && !STYLES[style].disabled ? style : 'eerie', engine: 'ours', matched: scored.length, chapters, sources,
    music: { name: 'Synthesized ambient drone (made by the renderer — no third-party recording)', licence: 'none needed' } };
}

/** Validate a plan coming from the browser (their LLM) or an edit — clamp, drop junk, keep only http(s)/data images. */
export function cleanPlan(p, { minutes = 10 } = {}) {
  if (!p || typeof p !== 'object') return null;
  const okImg = (u) => /^https:\/\/[^\s"'<>]{4,2000}$/.test(String(u || '')) || /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]{100,}$/.test(String(u || '').slice(0, 3_000_000));
  const chapters = (Array.isArray(p.chapters) ? p.chapters : []).slice(0, 40).map((c) => ({
    title: String(c.title || '').slice(0, 120),
    shots: (Array.isArray(c.shots) ? c.shots : []).slice(0, LIMITS.maxShots).map((s) => ({
      image: okImg(s.image) ? String(s.image) : '', prompt: String(s.prompt || '').slice(0, 600), card: String(s.card || '').slice(0, 160),
      question: String(s.question || '').slice(0, 160), credit: String(s.credit || '').slice(0, 300), secs: Math.max(2, Math.min(30, +s.secs || 8)), scene: String(s.scene || '').slice(0, 80),
    })).filter((s) => s.image || s.prompt),
  })).filter((c) => c.shots.length);
  const n = chapters.reduce((k, c) => k + c.shots.length, 0);
  if (!n || n > LIMITS.maxShots) return null;
  return { title: String(p.title || '').slice(0, 120), minutes: LENGTHS.includes(+p.minutes) ? +p.minutes : minutes, style: STYLES[p.style] && !STYLES[p.style].disabled ? p.style : 'eerie',
    engine: String(p.engine || 'ours').slice(0, 20), chapters, sources: (Array.isArray(p.sources) ? p.sources : []).map((x) => String(x).slice(0, 300)).slice(0, 200),
    music: { name: 'Synthesized ambient drone (made by the renderer — no third-party recording)', licence: 'none needed' } };
}

// The prompt a user's own LLM gets (from their browser). Returns strict JSON shaped like ourPlan().
export function planPrompt({ topic, minutes, style }) {
  const st = STYLES[style] || STYLES.eerie;
  const n = Math.max(4, Math.round((minutes * 60) / st.secsPerShot));
  return `You are planning a ${minutes}-minute wordless, eerie, atmospheric recreation video (the "how did they build this / living among the ancients" style) about: "${topic}".
No narration. Return ONLY JSON: {"title": str, "chapters": [{"title": str, "shots": [{"prompt": "a detailed image-generation prompt for this shot (photorealistic historical recreation, cinematic)", "card": "on-screen place + era text, e.g. \\"Meroë, Kingdom of Kush, c. 300 BC\\" (or empty)", "question": "an occasional short question that makes the viewer think (or empty)", "credit": "the source this shot is based on (a text, carving, excavation) or empty", "secs": ${st.secsPerShot}}]}], "sources": [str]}.
About ${n} shots in total, grouped into 3–12 chapters. Where a subject is tradition, scripture or myth (giants, gods at real places, the Table of Nations), say so in the card (\\"as the tradition tells it\\") rather than presenting it as established history.`;
}

// ── HTML ────────────────────────────────────────────────────────────────────────────────────────────
const alphaBox = () => `<div class=card style="border-color:var(--gold)"><b>Alpha.</b> ${esc(ALPHA.replace(/^Alpha — /, ''))}</div>`;

export function createBody() {
  const opts = (stage) => STAGES[stage].providers.map((p) => `<option value="${esc(p)}">${esc(PROVIDER_NAMES[p])}</option>`).join('');
  return `<h1>Video Studio <span class=muted style="font-size:14px">· a topic in, a film out</span></h1>
${alphaBox()}
<form id=vsform class=card>
  <label class=fld for=vstopic>What is it about?</label>
  <input class=q id=vstopic name=topic maxlength=200 required placeholder="e.g. Kush and the Nile · Giants in the old stories · Building the pyramids · Persepolis">
  <div class=row style="gap:10px;flex-wrap:wrap;margin-top:10px">
    <label>Length <select class=q name=minutes style="width:auto">${LENGTHS.map((m) => `<option value="${m}"${m === 10 ? ' selected' : ''}>${m} min</option>`).join('')}</select></label>
    <label>Style <select class=q name=style style="width:auto">${Object.entries(STYLES).map(([k, s]) => `<option value="${esc(k)}"${s.disabled ? ' disabled' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label>Tags <input class=q name=tags maxlength=120 placeholder="Egypt, Nubia, giants…" style="width:220px"></label>
  </div>
  <details style="margin-top:10px"><summary><b>Engines</b> — ours for free, or bring your own API for any stage</summary>
    <p class=muted style="font-size:12px">Your keys stay in <b>this browser</b> and go only to the provider you pick. Our server never sees them. <a href="/video-studio/docs">Add your own API →</a></p>
    <div class=row style="gap:10px;flex-wrap:wrap">
      <label>${esc(STAGES.plan.name)} <select class=q name=eng_plan style="width:auto">${opts('plan')}</select></label>
      <label>${esc(STAGES.images.name)} <select class=q name=eng_images style="width:auto">${opts('images')}</select></label>
      <label>${esc(STAGES.motion.name)} <select class=q name=eng_motion style="width:auto" disabled>${opts('motion')}</select></label>
      <label>${esc(STAGES.music.name)} <select class=q name=eng_music style="width:auto" disabled>${opts('music')}</select></label>
    </div>
    <div id=vskeys class=row style="gap:10px;flex-wrap:wrap;margin-top:8px"></div>
    <p class=muted style="font-size:12px">Images on your fal / Gemini / own worker use your <a href="/engines">Engines</a> settings.</p>
  </details>
  <label style="display:block;margin-top:10px"><input type=checkbox name=public checked> Show the finished film in the public gallery</label>
  <p style="margin-top:10px"><button type=submit id=vsgo>Plan my film</button> <span class=muted id=vsmsg style="font-size:12px"></span></p>
</form>
<div id=vsplan></div>
<p><a class=pill href="/video-studio/toolkit">Toolkit — animate your images, subtitles, maps, remakes, your own data →</a></p>
<p class=muted>See what others made in the <a href="/video-studio/gallery">gallery</a> · <a href="/video-studio/tools">the free and open tools it is built with</a> · <a href="/video-studio/docs">add your own API</a></p>
<script>${ENGINE_CLIENT_JS}
${VS_CLIENT_JS}</script>`;
}

export function jobBody(job, q) {
  const status = { planned: 'Planned — review the shot plan, then render', queued: `Queued — position ${q.position}, about ${q.etaMinutes} min`, rendering: `Rendering — ${esc(job.stage || '')} ${job.pct != null ? `${Math.round(job.pct)}%` : ''}`, done: 'Finished', failed: 'Failed' }[job.status] || job.status;
  const shots = (job.plan && job.plan.chapters || []).flatMap((c) => c.shots.map((s) => ({ ...s, chapter: c.title })));
  const planList = shots.slice(0, 200).map((s, i) => `<li>${s.image && /^https:/.test(s.image) ? `<img src="${esc(s.image)}" alt="" loading=lazy style="width:96px;border-radius:4px;vertical-align:middle;margin-right:6px">` : ''}<b>${esc(s.card || s.prompt.slice(0, 80))}</b>${s.question ? ` <i class=muted>${esc(s.question)}</i>` : ''} <span class=muted style="font-size:11px">${esc(s.chapter)}${s.credit ? ` · ${esc(s.credit)}` : ''}</span></li>`).join('');
  const video = job.status === 'done' ? `<video controls playsinline preload=metadata style="width:100%;max-width:960px;border-radius:10px;background:#000" poster="/video-studio/media/${esc(job.id)}/poster.jpg" src="/video-studio/media/${esc(job.id)}/video.mp4"></video>
<p><a class=pill href="/video-studio/media/${esc(job.id)}/video.mp4" download>Download</a> <span class=muted style="font-size:12px">${esc(job.durationSecs ? `${Math.round(job.durationSecs / 60 * 10) / 10} min` : '')}</span></p>` : '';
  const sources = (job.plan && job.plan.sources || []).map((s) => `<li>${esc(s)}</li>`).join('');
  const subs = job.tool === 'subtitles' && job.status === 'done' ? `<div class=card><b>Subtitles</b> <a class=pill href="/video-studio/media/${esc(job.id)}/subtitles.vtt" download>Download .vtt</a>${job.params && job.params.url ? ` <a class=pill href="${esc(job.params.url)}" target=_blank rel=noopener>the video</a>` : ''}<pre id=vtt style="white-space:pre-wrap;font-size:12px;max-height:420px;overflow:auto"></pre></div><script>fetch('/video-studio/media/${esc(job.id)}/subtitles.vtt').then(function(r){return r.text()}).then(function(t){document.getElementById('vtt').textContent=t})</script>` : '';
  return `<h1>${esc(job.plan && job.plan.title || job.topic)}</h1>
${alphaBox()}
<div class=card><b>Status:</b> <span id=vsstatus>${esc(status)}</span>${job.error ? ` — <span class=muted>${esc(job.error)}</span>` : ''}
${job.status === 'planned' ? `<form method=post action="/video-studio/api/jobs/${esc(job.id)}/render" style="margin-top:8px"><button>Render it</button> <span class=muted style="font-size:12px">${shots.length} shots · ~${esc(job.minutes)} min · edit below first if you like</span></form>` : ''}</div>
${job.tool && job.tool !== 'film' ? `<p class=muted>Tool: <b>${esc((TK.TOOLS[job.tool] || {}).name || job.tool)}</b>${(job.inputs || []).length ? ` · ${job.inputs.length} of your files` : ''}</p>` : ''}
${job.tool === 'subtitles' ? subs : video}
${job.status === 'planned' && (!job.tool || job.tool === 'film' || job.tool === 'documentary') ? `<details class=card><summary><b>Edit the plan</b> (JSON)</summary><form method=post action="/video-studio/api/jobs/${esc(job.id)}/plan"><textarea class=q name=plan style="min-height:240px;font-family:monospace;font-size:12px">${esc(JSON.stringify(job.plan, null, 1))}</textarea><button>Save plan</button></form></details>` : ''}
<h2>Shot plan <span class=muted style="font-size:13px">(${shots.length} shots)</span></h2><ol style="font-size:13px">${planList}</ol>${shots.length > 200 ? `<p class=muted>…and ${shots.length - 200} more.</p>` : ''}
<h2>Sources &amp; licences</h2><ul style="font-size:13px">${sources || '<li class=muted>—</li>'}<li>Sound: ${esc(job.plan && job.plan.music && job.plan.music.name || '')}</li></ul>
${['queued', 'rendering'].includes(job.status) ? `<script>setTimeout(function(){location.reload()},15000)</script>` : ''}`;
}

export function galleryBody(jobs = loadJobs()) {
  const done = [...jobs.values()].filter((j) => j.status === 'done' && j.public).sort((a, b) => b.finished - a.finished).slice(0, 120);
  return `<h1>Video Studio gallery</h1>${alphaBox()}
${done.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">${done.map((j) => `<a class=card href="/video-studio/job/${esc(j.id)}" style="text-decoration:none"><img src="/video-studio/media/${esc(j.id)}/poster.jpg" alt="" loading=lazy style="width:100%;border-radius:8px"><b>${esc(j.plan && j.plan.title || j.topic)}</b><br><span class=muted style="font-size:12px">${esc(j.minutes)} min · ${esc((STYLES[j.style] || STYLES.eerie).name)}</span></a>`).join('')}</div>` : '<div class=card><p class=empty>No films yet — <a href="/video-studio">make the first one</a>.</p></div>'}`;
}

// Tools: fork K's registry (integrations/documentary/tools.json + integrations/media-sources.mjs) when present, plus the core.
export const CORE_TOOLS = [
  { name: 'FFmpeg', what: 'motion (pan/zoom), crossfades, text cards, encoding', licence: 'LGPL/GPL', url: 'https://ffmpeg.org' },
  { name: 'Stable Diffusion 1.5 (DreamShaper 8) + LCM-LoRA', what: 'new images on our CPU', licence: 'CreativeML OpenRAIL-M', url: 'https://huggingface.co/Lykon/dreamshaper-8' },
  { name: 'ControlNet (canny, openpose)', what: 'remakes keep the layout of the source artwork', licence: 'Apache-2.0', url: 'https://github.com/lllyasviel/ControlNet-v1-1-nightly' },
  { name: 'faster-whisper', what: 'transcripts and subtitles (Pentecaust)', licence: 'MIT', url: 'https://github.com/SYSTRAN/faster-whisper' },
  { name: 'Piper TTS', what: 'narration voice (for the narrated style, later)', licence: 'MIT', url: 'https://github.com/rhasspy/piper' },
  { name: 'Museum open access (Met, Cleveland, Art Institute of Chicago) + Wikimedia Commons', what: 'the source artworks the remakes are made from', licence: 'CC0 / public domain / CC BY(-SA) per item', url: 'https://www.metmuseum.org/about-the-met/policies-and-documents/open-access' },
];
export function loadTools(root = join(__dir, '..', '..')) {
  const out = { tools: [...CORE_TOOLS], media: [] };
  try { const t = JSON.parse(readFileSync(join(root, 'integrations', 'documentary', 'tools.json'), 'utf8')); const list = Array.isArray(t) ? t : (t.tools || []);
    for (const x of list) if (x && x.name && !out.tools.some((y) => y.name === x.name)) out.tools.push({ name: x.name, what: x.what || x.use || x.purpose || '', licence: x.licence || x.license || '', url: x.url || x.repo || '' });
    if (Array.isArray(t.media)) out.media.push(...t.media);
  } catch {}
  return out;
}
export async function loadMediaSources(root = join(__dir, '..', '..')) {
  try { const m = await import(join(root, 'integrations', 'media-sources.mjs')); const list = m.SOURCES || m.MEDIA_SOURCES || m.default || []; return Array.isArray(list) ? list : Object.values(list); } catch { return []; }
}
export function toolsBody(t, media = []) {
  const row = (x) => `<tr><td><b>${x.url ? `<a href="${esc(x.url)}" target=_blank rel=noopener>${esc(x.name)}</a>` : esc(x.name)}</b></td><td>${esc(x.what || x.description || '')}</td><td>${esc(x.licence || x.license || '')}</td></tr>`;
  const all = [...media, ...(t.media || [])];
  return `<h1>Built with free and open tools</h1>${alphaBox()}
<p class=muted>Everything the Video Studio does on our servers runs on free and open software and openly licensed media. You can run the same tools yourself — or plug in your own APIs.</p>
<h2>Tools</h2><table class=an-tbl style="width:100%;font-size:13px"><tr><th>Tool</th><th>What it does here</th><th>Licence</th></tr>${t.tools.map(row).join('')}</table>
${all.length ? `<h2>Media sources</h2><table class=an-tbl style="width:100%;font-size:13px"><tr><th>Source</th><th>What</th><th>Licence</th></tr>${all.map(row).join('')}</table>` : ''}`;
}

export function docsBody(base) {
  const example = { title: 'Kush and the Nile', minutes: 10, style: 'eerie', chapters: [{ title: 'The river', shots: [{ image: 'https://…/shot1.jpg', card: 'Meroë, Kingdom of Kush, c. 300 BC', question: 'Who built these?', credit: 'Excavation reports, Meroë', secs: 8 }, { prompt: 'photorealistic recreation of…', card: '', secs: 8 }] }], sources: ['…'] };
  return `<h1>Add your own API</h1>${alphaBox()}
<p>Every stage of a film can run on your own engine. Pick it in the <b>Engines</b> panel on the <a href="/video-studio">create form</a>; your key stays in your browser and is sent only to that provider.</p>
<h2>Script &amp; shot plan — any LLM</h2>
<p>OpenAI, Gemini, Groq, OpenRouter and Anthropic are built in. For <b>Your own API</b>, give an HTTPS URL that accepts <code>POST {"prompt": "…"}</code> (with your bearer token if you set one) and returns <code>{"text": "…"}</code>, where the text is the JSON plan below. The prompt we send asks for exactly this shape:</p>
<pre style="white-space:pre-wrap;font-size:12px" class=card>${esc(JSON.stringify(example, null, 1))}</pre>
<p>A shot needs an <code>image</code> (HTTPS URL or <code>data:image/…;base64</code>) <i>or</i> a <code>prompt</code> (we make the image). <code>secs</code> 2–30. Up to ${LIMITS.maxShots} shots.</p>
<h2>Images — any image API</h2>
<p>fal.ai, Gemini and your own worker come from your <a href="/engines">Engines</a> settings. For <b>Your own API</b>: HTTPS URL, <code>POST {"prompt": "…", "size": "768x512"}</code> → <code>{"url": "https://…"}</code> or <code>{"base64": "…", "mime": "image/png"}</code>.</p>
<h2>Run the whole thing yourself</h2>
<p>Our worker is open source. It pulls jobs from <code>${esc(base)}/video-studio/api/worker/next</code> with a token, renders with FFmpeg, and sends the film back — see <code>integrations/video_studio_worker.py</code> in the <a href="https://github.com/HinduTempleCoins/Bot" target=_blank rel=noopener>repository</a>.</p>`;
}

// ── browser runtime: engines per stage, keys in localStorage, their LLM called from here ──────────────
export const VS_CLIENT_JS = `
(function(){
  var K='hathor.vstudio'; function L(){try{return JSON.parse(localStorage.getItem(K)||'{}')||{}}catch(e){return{}}} function S(c){try{localStorage.setItem(K,JSON.stringify(c))}catch(e){}}
  function voter(){var v='hathor.vstudio.voter',k;try{k=localStorage.getItem(v);if(!k){var a=new Uint8Array(16);crypto.getRandomValues(a);k=Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('');localStorage.setItem(v,k)}}catch(e){k='anon-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)}return k}
  var f=document.getElementById('vsform'); if(!f) return;
  var msg=document.getElementById('vsmsg'), keys=document.getElementById('vskeys'), c=L();
  ['eng_plan','eng_images'].forEach(function(n){ if(c[n]) f[n].value=c[n]; f[n].addEventListener('change',function(){c[n]=f[n].value;S(c);drawKeys()}); });
  function field(name,label,ph){var w=document.createElement('label');w.textContent=label+' ';var i=document.createElement('input');i.className='q';i.type=/key|token/.test(name)?'password':'text';i.placeholder=ph||'';i.style.width='260px';i.value=c[name]||'';i.addEventListener('change',function(){c[name]=i.value.trim();S(c)});w.appendChild(i);keys.appendChild(w)}
  function drawKeys(){keys.innerHTML='';var p=f.eng_plan.value;
    if(p==='openai'){field('openai_key','OpenAI key','sk-…');field('openai_model','model','gpt-4o-mini')}
    if(p==='gemini'){field('gemini_key','Gemini key','AIza…');field('gemini_model','model','gemini-2.5-flash')}
    if(p==='groq'){field('groq_key','Groq key','gsk_…');field('groq_model','model','llama-3.3-70b-versatile')}
    if(p==='openrouter'){field('openrouter_key','OpenRouter key','sk-or-…');field('openrouter_model','model','meta-llama/llama-3.3-70b-instruct')}
    if(p==='anthropic'){field('anthropic_key','Anthropic key','sk-ant-…');field('anthropic_model','model','claude-sonnet-5')}
    if(p==='custom'){field('custom_plan_url','Your plan API (HTTPS)','https://…');field('custom_plan_token','bearer token (optional)','')}
    if(f.eng_images.value==='custom'){field('custom_img_url','Your image API (HTTPS)','https://…');field('custom_img_token','bearer token (optional)','')}
  }
  drawKeys();
  async function theirLLM(prompt){ var p=f.eng_plan.value, r, j;
    var oai=function(url,key,model){return fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({model:model,messages:[{role:'user',content:prompt}],response_format:{type:'json_object'}})}).then(function(r){return r.json()}).then(function(j){return j.choices&&j.choices[0]&&j.choices[0].message.content})};
    if(p==='openai') return oai('https://api.openai.com/v1/chat/completions',c.openai_key,c.openai_model||'gpt-4o-mini');
    if(p==='groq') return oai('https://api.groq.com/openai/v1/chat/completions',c.groq_key,c.groq_model||'llama-3.3-70b-versatile');
    if(p==='openrouter') return oai('https://openrouter.ai/api/v1/chat/completions',c.openrouter_key,c.openrouter_model||'meta-llama/llama-3.3-70b-instruct');
    if(p==='gemini'){ r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+(c.gemini_model||'gemini-2.5-flash')+':generateContent',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':c.gemini_key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json'}})}); j=await r.json(); return j.candidates&&j.candidates[0].content.parts[0].text; }
    if(p==='anthropic'){ r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':c.anthropic_key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:c.anthropic_model||'claude-sonnet-5',max_tokens:16000,messages:[{role:'user',content:prompt}]})}); j=await r.json(); return j.content&&j.content[0]&&j.content[0].text; }
    if(p==='custom'){ var h={'content-type':'application/json'}; if(c.custom_plan_token) h.authorization='Bearer '+c.custom_plan_token; r=await fetch(c.custom_plan_url,{method:'POST',headers:h,body:JSON.stringify({prompt:prompt})}); j=await r.json(); return j.text; }
    throw new Error('ours'); }
  function jsonFrom(t){ t=String(t||''); var a=t.indexOf('{'), b=t.lastIndexOf('}'); return JSON.parse(t.slice(a,b+1)); }
  async function post(u,body){ var r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); var j=await r.json().catch(function(){return null}); if(!r.ok||!j||!j.ok) throw new Error((j&&j.error)||('HTTP '+r.status)); return j; }
  f.addEventListener('submit', async function(e){ e.preventDefault(); var b=document.getElementById('vsgo'); b.disabled=true;
    var base={topic:f.topic.value.trim(), minutes:+f.minutes.value, style:f.style.value, tags:f.tags.value.split(',').map(function(s){return s.trim()}).filter(Boolean), public:f.public.checked, voter:voter(), engines:{plan:f.eng_plan.value, images:f.eng_images.value}};
    try{ var plan=null;
      if(base.engines.plan!=='ours'){ msg.textContent='Your '+base.engines.plan+' is writing the shot plan…';
        var pr=await post('/video-studio/api/plan-prompt',{topic:base.topic,minutes:base.minutes,style:base.style}); plan=jsonFrom(await theirLLM(pr.prompt)); plan.engine=base.engines.plan; }
      if(plan && base.engines.images!=='ours' && typeof HE!=='undefined'){ var shots=[]; (plan.chapters||[]).forEach(function(c){(c.shots||[]).forEach(function(s){ if(!s.image&&s.prompt) shots.push(s)})});
        for(var i=0;i<shots.length;i++){ msg.textContent='Your image engine: shot '+(i+1)+' of '+shots.length+'…'; try{ var im=await HE.run({prompt:shots[i].prompt,size:'768x512'}); shots[i].image=im.src; }catch(err){} } }
      msg.textContent='Saving your plan…';
      var j=await post('/video-studio/api/jobs', Object.assign({}, base, plan?{plan:plan}:{}));
      location.href='/video-studio/job/'+j.id;
    }catch(err){ msg.textContent='Could not plan it: '+(err&&err.message||err); b.disabled=false; }
  });
})();`;

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────
function readRaw(req, limit) {
  return new Promise((resolve) => {
    const chunks = []; let n = 0; let over = false;
    req.on('data', (c) => { n += c.length; if (n > limit) { over = true; return; } chunks.push(c); });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}
async function readJson(req, limit = 4 * 1024 * 1024) { const b = await readRaw(req, limit); if (!b) return null; try { return JSON.parse(b.toString('utf8') || '{}'); } catch { return null; } }
async function readForm(req) { const b = await readRaw(req, 4 * 1024 * 1024); try { return new URLSearchParams(b ? b.toString('utf8') : ''); } catch { return new URLSearchParams(); } }
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

const hits = new Map();
export function __resetRate() { hits.clear(); }
function rateOk(ip, n = 30) { const now = Date.now(); const a = (hits.get(ip) || []).filter((t) => t > now - 3600e3); if (a.length >= n) { hits.set(ip, a); return false; } a.push(now); hits.set(ip, a); return true; }

function workerAuth(req) {
  const want = String(process.env.VSTUDIO_WORKER_TOKEN || '');
  const got = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (want.length < 24 || got.length !== want.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(want)); } catch { return false; }
}

/** Create a job from a browser request. → { code, body } */
export function createJob(body, ip, manifest, base, keyVoter = null) {
  if (!body || typeof body !== 'object') return { code: 400, body: { ok: false, error: 'bad request' } };
  const tool = body.tool == null ? 'film' : String(body.tool);
  if (!TK.TOOLS[tool] || TK.TOOLS[tool].status === 'page') return { code: 400, body: { ok: false, error: `tool must be one of ${Object.keys(TK.TOOLS).filter((k) => !TK.TOOLS[k].status).join(', ')}` } };
  if (keyVoter) body = { ...body, voter: `key-${keyVoter}` };
  const params = body.params && typeof body.params === 'object' ? Object.fromEntries(Object.entries(body.params).slice(0, 20).map(([k, v]) => [String(k).slice(0, 40), typeof v === 'number' ? v : String(v).slice(0, 500)])) : {};
  if (tool !== 'film' && !body.topic) body = { ...body, topic: params.title || params.topic || TK.TOOLS[tool].name };
  const topic = String(body.topic || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const minutes = LENGTHS.includes(+body.minutes) ? +body.minutes : 10;
  const style = STYLES[body.style] && !STYLES[body.style].disabled ? body.style : 'eerie';
  const voter = String(body.voter || '');
  if (topic.length < 3) return { code: 400, body: { ok: false, error: 'Tell it what the film is about.' } };
  if (!/^[A-Za-z0-9-]{16,64}$/.test(voter)) return { code: 400, body: { ok: false, error: 'bad visitor key' } };
  if (!rateOk(`create:${ip}`, 12)) return { code: 429, body: { ok: false, error: 'Slow down a little.' } };
  const vh = keyVoter || voterHash(voter);
  const jobs = [...loadJobs().values()];
  const mine = jobs.filter((j) => j.voter === vh && j.day === today()).length;
  if (mine >= LIMITS.perVisitorPerDay) return { code: 429, body: { ok: false, error: `That is ${LIMITS.perVisitorPerDay} films today — come back tomorrow, or run it on your own worker.` } };
  const tags = (Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).slice(0, 40)).slice(0, 10);
  const inputs = (Array.isArray(body.inputs) ? body.inputs : []).slice(0, 60).map(String);
  for (const id of inputs) { const u = TK.getUpload(id); if (!u || u.voter !== vh) return { code: 400, body: { ok: false, error: `input ${id.slice(0, 8)}… is not one of your uploads` } }; }
  const kinds = inputs.map((id) => TK.getUpload(id).kind);
  if (tool === 'animate' && !kinds.filter((k) => k === 'image').length) return { code: 400, body: { ok: false, error: 'upload at least one image' } };
  if (tool === 'subtitles' && !kinds.includes('video') && !/^https:\/\/[^\s"'<>]{4,1000}\.(mp4|webm)(\?.*)?$/i.test(String(params.url || ''))) return { code: 400, body: { ok: false, error: 'give an https .mp4/.webm URL or upload a video' } };
  if (tool === 'map' && !kinds.some((k) => k === 'geojson' || k === 'csv')) return { code: 400, body: { ok: false, error: 'upload a GeoJSON or a route CSV' } };
  const plan = tool === 'film' || tool === 'documentary'
    ? (body.plan ? cleanPlan(body.plan, { minutes }) : ourPlan({ topic, minutes, style, tags }, manifest, base))
    : { title: topic, minutes, style, engine: 'ours', chapters: [], sources: [...new Set(inputs.map((id) => `Your ${TK.getUpload(id).kind} (${TK.getUpload(id).licence})`))], music: { name: 'Synthesized ambient drone (made by the renderer — no third-party recording)', licence: 'none needed' } };
  if (!plan) return { code: 400, body: { ok: false, error: 'The plan was empty or not valid.' } };
  const engines = { plan: STAGES.plan.providers.includes(body.engines && body.engines.plan) ? body.engines.plan : 'ours', images: STAGES.images.providers.includes(body.engines && body.engines.images) ? body.engines.images : 'ours', motion: 'ours', music: 'ours' };
  const id = randomBytes(8).toString('hex');
  const job = { id, tool, topic, minutes, style, tags, engines, params, inputs, public: body.public !== false && body.public != null ? !!body.public : tool === 'film', voter: vh, day: today(), created: Date.now(), status: 'planned', plan };
  if (!saveJob(job)) return { code: 500, body: { ok: false, error: 'store unavailable' } };
  return { code: 200, body: { ok: true, id } };
}

/** Move a planned job into the ours queue, respecting the daily CPU budget. */
export function queueJob(job) {
  if (!job || job.status !== 'planned') return { ok: false, error: 'not in a state that can render' };
  if (TK.toolStatus(job.tool || 'film') !== 'live') return { ok: false, error: `Rendering for "${TK.TOOLS[job.tool].name}" opens soon — your inputs are saved and validated, and this job will be kept.` };
  const used = [...loadJobs().values()].filter((j) => j.queuedDay === today() && j.id !== job.id && ['queued', 'rendering', 'done'].includes(j.status)).reduce((n, j) => n + (+j.minutes || 1), 0);
  if (used + (+job.minutes || 1) > LIMITS.oursMinutesPerDay) return { ok: false, error: `Our free CPU is full for today (${LIMITS.oursMinutesPerDay} minutes of film a day). Try a shorter film, tomorrow, or your own worker.` };
  saveJob({ ...job, status: 'queued', queuedDay: today(), queuedAt: Date.now() });
  return { ok: true };
}

export function serveMedia(req, res, id, file) {
  const full = join(MEDIA(id), file);
  if (!/^[a-f0-9]{16}$/.test(id) || !/^(video\.mp4|poster\.jpg|subtitles\.vtt)$/.test(file) || !existsSync(full)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const type = file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.vtt') ? 'text/vtt; charset=utf-8' : 'image/jpeg';
  const size = statSync(full).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ''));
  if (range && type === 'video/mp4') {
    const start = range[1] === '' ? size - +range[2] : +range[1];
    const end = range[1] !== '' && range[2] !== '' ? Math.min(+range[2], size - 1) : size - 1;
    if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'public, max-age=86400' });
    if (typeof res.on === 'function') return createReadStream(full, { start, end }).pipe(res); // real server: stream
    const buf = Buffer.alloc(end - start + 1); const fd = openSync(full, 'r'); readSync(fd, buf, 0, buf.length, start); closeSync(fd); return res.end(buf);
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'public, max-age=86400' });
  if (typeof res.on === 'function') return createReadStream(full).pipe(res);
  return res.end(readFileSync(full));
}

async function receiveUpload(req, id, file) {
  const dir = MEDIA(id); mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${file}.part`);
  const max = LIMITS.uploadMB * 1024 * 1024;
  return new Promise((resolve) => {
    let n = 0; let over = false; const ws = createWriteStream(tmp);
    req.on('data', (c) => { n += c.length; if (n > max) { over = true; req.destroy(); } });
    req.pipe(ws);
    ws.on('finish', () => { if (over || n === 0) return resolve(false); try { renameSync(tmp, join(dir, file)); resolve(n); } catch { resolve(false); } });
    ws.on('error', () => resolve(false));
    req.on('error', () => resolve(false));
  });
}

/** Route everything under /video-studio. ctx: { pageShell, sendHtml, clientIp, base, loadRemakes }. → true if handled. */
export async function videoStudioRoute(req, res, path, ctx) {
  if (path !== '/video-studio' && !path.startsWith('/video-studio/')) return false;
  const method = (req.method || 'GET').toUpperCase();
  const page = (title, body, desc) => ctx.sendHtml(res, ctx.pageShell(title, body, { canonical: `${ctx.base}${path}`, description: desc || 'Hathor Video Studio — type a topic, get a film: wordless eerie recreations of the ancient world, made free on our servers or on your own engines.' }));
  const ip = ctx.clientIp(req);
  try {
    if (path === '/video-studio' && method === 'GET') { page('Video Studio — a topic in, a film out', createBody()); return true; }
    if (path === '/video-studio/gallery') { page('Video Studio gallery', galleryBody()); return true; }
    if (path === '/video-studio/tools') { page('Built with free and open tools — Video Studio', toolsBody(loadTools(), await loadMediaSources())); return true; }
    if (path === '/video-studio/docs') { page('Add your own API — Video Studio', docsBody(ctx.base)); return true; }
    let m = /^\/video-studio\/job\/([a-f0-9]{16})$/.exec(path);
    if (m) { const j = getJob(m[1]); if (!j) { page('Not found — Video Studio', '<h1>Not found</h1>'); return true; } page(`${j.plan && j.plan.title || j.topic} — Video Studio`, jobBody(j, queueInfo(j))); return true; }
    m = /^\/video-studio\/media\/([a-f0-9]{16})\/(video\.mp4|poster\.jpg|subtitles\.vtt)$/.exec(path);
    if (m) { serveMedia(req, res, m[1], m[2]); return true; }

    // ── public API ──
    if (path === '/video-studio/api/plan-prompt' && method === 'POST') { const b = await readJson(req, 64 * 1024); json(res, 200, { ok: true, prompt: planPrompt({ topic: String(b && b.topic || '').slice(0, 200), minutes: LENGTHS.includes(+(b && b.minutes)) ? +b.minutes : 10, style: b && b.style }) }); return true; }
    if (path === '/video-studio/api/jobs' && method === 'POST') { const b = await readJson(req, 40 * 1024 * 1024); const r = createJob(b, ip, ctx.loadRemakes(), ctx.base, TK.voterFromKey(req)); json(res, r.code, r.body); return true; }
    if (path === '/video-studio/toolkit') { page('Toolkit — everything we do, with your engines and your data', TK.toolkitBody()); return true; }
    if (path === '/video-studio/data') { page('Your data — formats, templates, API', TK.dataBody(ctx.base)); return true; }
    m = /^\/video-studio\/data\/([a-z0-9.-]+)$/.exec(path);
    if (m) {
      const t = TK.TEMPLATES[m[1]]; const sc = TK.SCHEMAS[m[1]];
      if (!t && !sc) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return true; }
      res.writeHead(200, { 'content-type': `${t ? t.type : 'application/schema+json'}; charset=utf-8`, 'content-disposition': `attachment; filename="${m[1]}"` }); res.end(t ? t.body : JSON.stringify(sc, null, 1)); return true;
    }
    m = /^\/video-studio\/u\/([a-f0-9]{32})$/.exec(path);
    if (m) { TK.serveUpload(res, m[1]); return true; }
    if (path === '/video-studio/api/uploads' && method === 'PUT') {
      const u = new URL(req.url, 'http://x');
      const kv = TK.voterFromKey(req); const v = String(u.searchParams.get('voter') || '');
      if (!kv && !/^[A-Za-z0-9-]{16,64}$/.test(v)) { json(res, 400, { ok: false, error: 'bad visitor key' }); return true; }
      if (!rateOk(`up:${ip}`, 120)) { json(res, 429, { ok: false, error: 'rate-limited' }); return true; }
      const r = await TK.receiveUpload(req, { voter: kv || voterHash(v), kind: String(u.searchParams.get('kind') || ''), licence: String(u.searchParams.get('licence') || ''), type: String((req.headers && req.headers['content-type']) || '').split(';')[0].trim().toLowerCase() });
      json(res, r.code, r.body); return true;
    }
    if (path === '/video-studio/api/keys' && method === 'POST') { const b = await readJson(req, 4096); const v = String(b && b.voter || ''); if (!/^[A-Za-z0-9-]{16,64}$/.test(v) || !rateOk(`key:${ip}`, 10)) { json(res, 400, { ok: false, error: 'bad visitor key' }); return true; } const k = TK.issueKey(voterHash(v)); json(res, k ? 200 : 429, k ? { ok: true, key: k, note: 'Shown once. Send it as Authorization: Bearer <key>.' } : { ok: false, error: 'key limit reached' }); return true; }
    if (path === '/video-studio/api/validate' && method === 'POST') { const b = await readJson(req, 25 * 1024 * 1024); json(res, 200, TK.validate(String(b && b.kind || ''), String(b && b.data || ''))); return true; }
    m = /^\/video-studio\/api\/jobs\/([a-f0-9]{16})$/.exec(path);
    if (m && method === 'GET') { const j = getJob(m[1]); if (!j) { json(res, 404, { ok: false }); return true; } const { voter, ...pub } = j; json(res, 200, { ok: true, job: { ...pub, queue: queueInfo(j) } }); return true; }
    m = /^\/video-studio\/api\/jobs\/([a-f0-9]{16})\/(render|plan)$/.exec(path);
    if (m && method === 'POST') {
      const j = getJob(m[1]);
      if (!j) { json(res, 404, { ok: false }); return true; }
      if (!rateOk(`job:${ip}`, 60)) { json(res, 429, { ok: false, error: 'rate-limited' }); return true; }
      if (m[2] === 'plan') {
        const f = await readForm(req); let p = null; try { p = cleanPlan(JSON.parse(f.get('plan') || ''), { minutes: j.minutes }); } catch {}
        if (p && j.status === 'planned') saveJob({ ...j, plan: p });
      } else { const r = queueJob(j); if (!r.ok) saveJob({ ...j, error: r.error }); }
      res.writeHead(303, { location: `/video-studio/job/${j.id}` }); res.end(); return true;
    }

    // ── worker API (token) — the CPU worker pulls jobs and pushes results; no SSH between hosts ──
    if (path.startsWith('/video-studio/api/worker/')) {
      if (!workerAuth(req)) { json(res, 401, { ok: false }); return true; }
      if (path === '/video-studio/api/worker/next' && method === 'POST') {
        const next = [...loadJobs().values()].filter((j) => j.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt)[0];
        if (!next) { json(res, 200, { ok: true, job: null }); return true; }
        saveJob({ ...next, status: 'rendering', stage: 'starting', pct: 0, startedAt: Date.now() });
        const inputs = (next.inputs || []).map((u) => { const r = TK.getUpload(u); return r ? { id: u, kind: r.kind, type: r.type, licence: r.licence, url: `${ctx.base}/video-studio/u/${u}` } : null; }).filter(Boolean);
        json(res, 200, { ok: true, job: { id: next.id, tool: next.tool || 'film', topic: next.topic, minutes: next.minutes, style: next.style, params: next.params || {}, inputs, plan: next.plan } }); return true;
      }
      m = /^\/video-studio\/api\/worker\/([a-f0-9]{16})\/(progress|done|fail|video\.mp4|poster\.jpg|subtitles\.vtt)$/.exec(path);
      const j = m && getJob(m[1]);
      if (!j) { json(res, 404, { ok: false }); return true; }
      if (m[2] === 'progress' && method === 'POST') { const b = await readJson(req, 16 * 1024) || {}; saveJob({ ...j, stage: String(b.stage || '').slice(0, 60), pct: Math.max(0, Math.min(100, +b.pct || 0)) }); json(res, 200, { ok: true }); return true; }
      if ((m[2] === 'video.mp4' || m[2] === 'poster.jpg' || m[2] === 'subtitles.vtt') && method === 'PUT') { const n = await receiveUpload(req, j.id, m[2]); json(res, n ? 200 : 400, { ok: !!n, bytes: n || 0 }); return true; }
      if (m[2] === 'done' && method === 'POST') { const b = await readJson(req, 16 * 1024) || {}; const ok = existsSync(join(MEDIA(j.id), (j.tool === 'subtitles' ? 'subtitles.vtt' : 'video.mp4'))); saveJob({ ...j, status: ok ? 'done' : 'failed', error: ok ? '' : 'no video uploaded', finished: Date.now(), durationSecs: +b.durationSecs || 0, renderSecs: +b.renderSecs || 0, stage: '', pct: 100 }); json(res, 200, { ok }); return true; }
      if (m[2] === 'fail' && method === 'POST') { const b = await readJson(req, 16 * 1024) || {}; saveJob({ ...j, status: 'failed', error: String(b.error || 'render failed').slice(0, 300), finished: Date.now() }); json(res, 200, { ok: true }); return true; }
      json(res, 405, { ok: false }); return true;
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return true;
  } catch (e) { json(res, 500, { ok: false, error: 'server error' }); return true; }
}

export default { videoStudioRoute, ourPlan, cleanPlan, createJob, queueJob, planPrompt, loadJobs, getJob, ALPHA };
