// store.mjs — Pentecaust transcripts store. One folder per item (source + id), holding every track with its
// provenance, and a queue of reader corrections. Built so later phases slot in: a translated track is just another
// lang with parent = the track it came from; a dub is a kind:'dub' track; live captions a kind:'live' track.
//
//   <TRANSCRIPTS_DIR>/<src>/<id>/meta.json   { src, id, title, tracks: [Track] }
//   <TRANSCRIPTS_DIR>/<src>/<id>/<file>      the track bodies (.vtt / .txt)
//   <TRANSCRIPTS_DIR>/<src>/<id>/edits.jsonl reader corrections (append-only; voter stored as a salted hash)
//
// Track: { lang, kind: 'subtitles'|'transcript', format: 'vtt'|'txt', provenance, source, model, created, file,
//          parent?, changes? }
// provenance, best first: human-edited > official > human-found > ai-edited > ai-whisper.
// Soft-fail: readers return null/[] on any error; writers return false.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
export const TRANSCRIPTS_DIR = () => process.env.TRANSCRIPTS_DIR || path.resolve(__dir, '..', '..', 'data', 'transcripts');
export const PROVENANCE_RANK = ['human-edited', 'official', 'human-found', 'ai-edited', 'ai-whisper'];
export const HUMAN = new Set(['human-edited', 'official', 'human-found']);
const SRC_RE = /^[a-z]{2,12}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export function validKey(src, id) { return SRC_RE.test(String(src || '')) && ID_RE.test(String(id || '')) && !String(id).includes('..'); }
export function itemDir(src, id, dir = TRANSCRIPTS_DIR()) { return validKey(src, id) ? path.join(dir, src, id) : null; }

export function getMeta(src, id, dir = TRANSCRIPTS_DIR()) {
  const d = itemDir(src, id, dir);
  if (!d) return null;
  try { const m = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8')); return m && Array.isArray(m.tracks) ? m : null; } catch { return null; }
}

const rank = (t) => { const i = PROVENANCE_RANK.indexOf(t.provenance); return i < 0 ? 99 : i; };
/** Best track for a language and format (a human track beats an AI one; newest wins a tie). */
export function bestTrack(meta, { lang = 'en', format = 'vtt' } = {}) {
  const ts = (meta && meta.tracks || []).filter((t) => t.lang === lang && (!format || t.format === format));
  ts.sort((a, b) => rank(a) - rank(b) || String(b.created || '').localeCompare(String(a.created || '')));
  return ts[0] || null;
}

export function readTrack(src, id, track, dir = TRANSCRIPTS_DIR()) {
  const d = itemDir(src, id, dir);
  if (!d || !track || !/^[A-Za-z0-9._-]+$/.test(track.file || '')) return null;
  try { return fs.readFileSync(path.join(d, track.file), 'utf8'); } catch { return null; }
}

/** Add (or replace, same lang+provenance+format) a track. → the stored track or null. */
export function addTrack(src, id, { title = '', body, ...t }, dir = TRANSCRIPTS_DIR()) {
  const d = itemDir(src, id, dir);
  if (!d || typeof body !== 'string' || !body.trim() || !PROVENANCE_RANK.includes(t.provenance)) return null;
  const lang = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(t.lang || '') ? t.lang : 'en';
  const format = t.format === 'txt' ? 'txt' : 'vtt';
  try {
    fs.mkdirSync(d, { recursive: true });
    const file = `${lang}.${t.provenance}.${format}`;
    fs.writeFileSync(path.join(d, file), body);
    const meta = getMeta(src, id, dir) || { src, id, title, tracks: [] };
    if (title && !meta.title) meta.title = title;
    const track = { lang, kind: t.kind === 'transcript' ? 'transcript' : 'subtitles', format, provenance: t.provenance, source: t.source || '', model: t.model || '', created: t.created || new Date().toISOString(), file, ...(t.parent ? { parent: t.parent } : {}), ...(t.changes ? { changes: t.changes } : {}) };
    meta.tracks = meta.tracks.filter((x) => x.file !== file).concat(track);
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(meta, null, 1));
    return track;
  } catch { return null; }
}

export function appendEdit(src, id, edit, dir = TRANSCRIPTS_DIR()) {
  const d = itemDir(src, id, dir);
  if (!d) return false;
  try { fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, 'edits.jsonl'), JSON.stringify(edit) + '\n'); return true; } catch { return false; }
}
export function listEdits(src, id, dir = TRANSCRIPTS_DIR()) {
  const d = itemDir(src, id, dir);
  if (!d) return [];
  try { return fs.readFileSync(path.join(d, 'edits.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

/** Every item with at least one track: [{ src, id, title, best }]. */
export function listItems(dir = TRANSCRIPTS_DIR()) {
  const out = [];
  let srcs = [];
  try { srcs = fs.readdirSync(dir).filter((s) => SRC_RE.test(s)); } catch { return out; }
  for (const src of srcs) {
    let ids = [];
    try { ids = fs.readdirSync(path.join(dir, src)); } catch { continue; }
    for (const id of ids) { const m = getMeta(src, id, dir); if (m && m.tracks.length) out.push({ src, id, title: m.title || id, best: bestTrack(m) || bestTrack(m, { format: 'txt' }) }); }
  }
  return out;
}
