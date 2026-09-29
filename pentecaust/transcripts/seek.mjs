#!/usr/bin/env node
// seek.mjs — Pentecaust transcripts: find human-made transcripts first, queue the rest for our own Whisper, and ingest
// the worker's output through the machine edit pass.
//
//   node pentecaust/transcripts/seek.mjs seek   [--limit N]            # IA subtitle files + official transcripts → store
//   node pentecaust/transcripts/seek.mjs queue  --out queue.json       # items with no subtitles yet, shortest first
//   node pentecaust/transcripts/seek.mjs ingest --from <worker-out-dir> # ai-whisper tracks + ai-edited (clean pass)
//
// SEEK prefers human work: subtitle files uploaded with the Internet Archive item (.srt/.vtt/.sbv) are provenance
// 'human-found'; a list entry's official `transcript` URL is 'official' (plain text). IA's own machine ASR files
// (*.asr.*) and release-named subtitle-site files are skipped — we'd rather run and label our own. No third-party subtitle sites (their files are users'
// copyrighted uploads). Injectable fetch; soft-fail per item.

import fs from 'node:fs';
import path from 'node:path';
import { allFreeFilms } from '../../integrations/soapbox/free-film-registry.mjs';
import { bestVideoFile, looksLikeRip } from '../../integrations/soapbox/archive-video.mjs';
import { parseAny, toVtt, cleanCues, parseVtt } from './vtt.mjs';
import { addTrack, getMeta, bestTrack, TRANSCRIPTS_DIR } from './store.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
const UA = { 'user-agent': 'Pentecaust-Transcripts/1.0 (+https://stream.soapbox.community)' };
const IA = 'https://archive.org';
const SUB_RE = /\.(srt|vtt|sbv)$/i;

async function getJson(u) { try { const r = await _fetch(u, { headers: UA }); return r && r.ok ? await r.json() : null; } catch { return null; } }
async function getText(u) { try { const r = await _fetch(u, { headers: UA }); return r && r.ok ? await r.text() : null; } catch { return null; } }

/** English-looking human subtitle files in an IA item, best first. */
export function subtitleFiles(files = []) {
  // release-named files (720p.BluRay…[group].srt) come from subtitle sites, not the uploader — skipped
  return (files || []).filter((f) => f && SUB_RE.test(f.name || '') && !/\.asr\./i.test(f.name || '') && !looksLikeRip(f.name) && !/\[[^\]]+\]/.test(f.name || '') && !/(^|[._-])(de|fr|es|it|pt|ru|nl|ja|zh|ko|ar)([._-]|$)/i.test(f.name || ''))
    .sort((a, b) => (/(^|[._-])(en|eng|english)([._-]|$)/i.test(b.name) ? 1 : 0) - (/(^|[._-])(en|eng|english)([._-]|$)/i.test(a.name) ? 1 : 0) || (/\.srt$/i.test(b.name) ? 1 : 0) - (/\.srt$/i.test(a.name) ? 1 : 0));
}

/** Seconds of an item from IA metadata (first video file's length). */
export function itemSeconds(md) {
  const f = bestVideoFile(md && md.files);
  const l = f && f.length;
  if (!l) return 0;
  if (/:/.test(String(l))) return String(l).split(':').reduce((a, x) => a * 60 + (+x || 0), 0);
  return +l || 0;
}

export async function seekOne(film, dir = TRANSCRIPTS_DIR()) {
  const src = 'ia'; const id = String(film.id);
  const found = [];
  const md = await getJson(`${IA}/metadata/${encodeURIComponent(id)}`);
  if (md && Array.isArray(md.files)) {
    for (const f of subtitleFiles(md.files).slice(0, 1)) {
      const url = `${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`;
      const text = await getText(url);
      const cues = text ? parseAny(text, path.extname(f.name)) : [];
      if (cues.length >= 5) {
        const t = addTrack(src, id, { title: film.title, body: toVtt(cues, { note: `Subtitles uploaded with the Internet Archive item ${id} (${f.name}).` }), lang: 'en', kind: 'subtitles', format: 'vtt', provenance: 'human-found', source: url }, dir);
        if (t) found.push(t);
      }
    }
  }
  if (film.transcript && /^https?:\/\//.test(film.transcript)) {
    const raw = await getText(film.transcript);
    const text = raw ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim() : '';
    if (text.length > 200) {
      const t = addTrack(src, id, { title: film.title, body: text, lang: 'en', kind: 'transcript', format: 'txt', provenance: 'official', source: film.transcript }, dir);
      if (t) found.push(t);
    }
  }
  return { id, found, seconds: md ? itemSeconds(md) : 0, mp4: md ? mp4Url(md) : '' };
}

export function mp4Url(md) {
  const f = bestVideoFile(md && md.files);
  const id = md && md.metadata && md.metadata.identifier;
  return f && id ? `${IA}/download/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}` : '';
}

/** Ingest one worker result folder (<out>/<src>/<id>/{en.ai-whisper.vtt, job.json}) → ai-whisper + ai-edited tracks. */
export function ingestOne(src, id, workDir, dir = TRANSCRIPTS_DIR()) {
  const d = path.join(workDir, src, id);
  let raw = ''; let job = {};
  try { raw = fs.readFileSync(path.join(d, 'en.ai-whisper.vtt'), 'utf8'); } catch { return null; }
  try { job = JSON.parse(fs.readFileSync(path.join(d, 'job.json'), 'utf8')); } catch {}
  const cues = parseVtt(raw);
  if (!cues.length) return null;
  const model = job.model || 'faster-whisper';
  const a = addTrack(src, id, { title: job.title || '', body: toVtt(cues, { note: `AI-made by ${model} on SoapBox's own servers. Not yet checked by a person.` }), lang: job.lang || 'en', kind: 'subtitles', format: 'vtt', provenance: 'ai-whisper', model, source: job.mp4 || '' }, dir);
  const { cues: clean, changes } = cleanCues(cues);
  const b = addTrack(src, id, { title: job.title || '', body: toVtt(clean, { note: `AI-made by ${model}, then machine-cleaned. Not yet checked by a person.` }), lang: job.lang || 'en', kind: 'subtitles', format: 'vtt', provenance: 'ai-edited', model: `${model} + clean-pass`, parent: a && a.file, changes }, dir);
  return { a, b, changes };
}

if (process.argv[1] && process.argv[1].endsWith('seek.mjs')) {
  const cmd = process.argv[2];
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const dir = TRANSCRIPTS_DIR();
  if (cmd === 'seek' || cmd === 'queue') {
    const films = allFreeFilms().slice(0, +arg('--limit', '100000'));
    const queue = []; let found = 0;
    for (const f of films) {
      const have = getMeta('ia', String(f.id), dir);
      if (cmd === 'queue' && have && bestTrack(have)) continue;
      const r = await seekOne(f, dir);
      found += r.found.length;
      const silent = f.year && +String(f.year).slice(0, 4) < 1929; // pre-sound: intertitles, nothing for Whisper to hear
      if (!silent && !r.found.some((t) => t.format === 'vtt') && !(have && bestTrack(have)) && r.mp4) queue.push({ src: 'ia', id: r.id, title: f.title, mp4: r.mp4, seconds: r.seconds });
      await new Promise((res) => setTimeout(res, 150));
    }
    queue.sort((a, b) => (a.seconds || 1e9) - (b.seconds || 1e9));
    if (cmd === 'queue' || arg('--out')) fs.writeFileSync(arg('--out', 'transcript-queue.json'), JSON.stringify(queue, null, 1));
    console.log(`${films.length} items checked · ${found} human/official tracks found · ${queue.length} queued for Whisper`);
  } else if (cmd === 'ingest') {
    const from = arg('--from', '');
    let n = 0;
    for (const src of fs.readdirSync(from)) for (const id of fs.readdirSync(path.join(from, src))) { const r = ingestOne(src, id, from, dir); if (r) { n += 1; console.log(`${src}/${id}: ${JSON.stringify(r.changes)}`); } }
    console.log(`ingested ${n}`);
  } else console.log('usage: seek.mjs seek|queue|ingest');
}
