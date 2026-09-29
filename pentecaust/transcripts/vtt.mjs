// vtt.mjs — Pentecaust transcripts: subtitle formats and the cue clean-up ("edit") pass. Pure, no I/O.
//   parseSrt / parseSbv / parseVtt → cues [{ start, end, text }] (seconds)
//   toVtt(cues) → WebVTT text
//   cleanCues(cues) → the machine edit pass for AI transcripts: drop empties, collapse hallucinated repeats,
//     merge tiny cues into their neighbour, wrap to ≤42 chars per line / 2 lines per cue (subtitle convention).

const ts = (s) => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(String(s || '').trim());
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
};
export const fmt = (sec) => {
  const t = Math.max(0, Math.round((+sec || 0) * 1000));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), ms = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};
const stripTags = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

function parseBlocks(text, arrowRe) {
  const cues = [];
  for (const block of String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    const i = lines.findIndex((l) => arrowRe.test(l));
    if (i < 0) continue;
    const [a, b] = lines[i].split(arrowRe);
    const start = ts(a), end = ts(b);
    const text = stripTags(lines.slice(i + 1).join('\n'));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({ start, end, text });
  }
  return cues;
}
export const parseSrt = (t) => parseBlocks(t, /\s*-->\s*/);
export const parseVtt = (t) => parseBlocks(String(t || '').replace(/^WEBVTT[^\n]*\n/, ''), /\s*-->\s*/);
export function parseSbv(t) { // 0:00:01.000,0:00:03.000\ntext
  const cues = [];
  for (const block of String(t || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const [head, ...rest] = block.split('\n');
    const m = /^(\d+:\d{2}:\d{2}\.\d{1,3}),(\d+:\d{2}:\d{2}\.\d{1,3})$/.exec((head || '').trim());
    if (!m) continue;
    const start = ts(m[1]), end = ts(m[2]); const text = stripTags(rest.join('\n'));
    if (end > start && text) cues.push({ start, end, text });
  }
  return cues;
}
export function parseAny(text, ext = '') {
  const e = String(ext).toLowerCase().replace(/^\./, '');
  if (e === 'sbv') return parseSbv(text);
  if (e === 'vtt' || /^﻿?WEBVTT/.test(String(text || ''))) return parseVtt(text);
  return parseSrt(text);
}

export function toVtt(cues, { note = '' } = {}) {
  const head = `WEBVTT${note ? `\n\nNOTE ${String(note).replace(/-->/g, '→').replace(/\n+/g, ' ')}` : ''}\n`;
  return head + cues.map((c, i) => `\n${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${String(c.text).replace(/-->/g, '→')}\n`).join('');
}

/** Wrap text to ≤max chars per line, ≤2 lines per cue when possible (longer text keeps extra lines). */
export function wrap(text, max = 42) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The machine edit pass for AI-made cues. → { cues, changes: { dropped, repeats, merged, wrapped } } */
export function cleanCues(input, { minDur = 0.8, minChars = 3, maxLine = 42 } = {}) {
  const changes = { dropped: 0, repeats: 0, merged: 0, wrapped: 0 };
  let cues = (input || []).map((c) => ({ ...c, text: String(c.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((c) => { const ok = c.text && Number.isFinite(c.start) && c.end > c.start; if (!ok) changes.dropped += 1; return ok; })
    .sort((a, b) => a.start - b.start);
  // hallucinated repeats: Whisper loops the same line over silence/music — keep the first of a run of 2+
  const out = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev && norm(prev.text) && norm(prev.text) === norm(c.text)) { prev.end = Math.max(prev.end, c.end); changes.repeats += 1; continue; }
    out.push(c);
  }
  cues = out;
  // a phrase repeated inside one cue ("thank you thank you thank you thank you")
  for (const c of cues) {
    const r = /\b((?:\S+\s+){0,3}\S+)(?:\s+\1\b){2,}/i.exec(c.text);
    if (r) { c.text = c.text.replace(r[0], r[1]); changes.repeats += 1; }
  }
  // merge tiny cues into the previous one when they sit close together
  const merged = [];
  for (const c of cues) {
    const prev = merged[merged.length - 1];
    const tiny = (c.end - c.start) < minDur || c.text.length < minChars;
    if (prev && tiny && c.start - prev.end < 1.0 && (prev.text.length + c.text.length) < maxLine * 2) {
      prev.text = `${prev.text} ${c.text}`; prev.end = Math.max(prev.end, c.end); changes.merged += 1; continue;
    }
    merged.push({ ...c });
  }
  for (const c of merged) {
    const w = wrap(c.text, maxLine);
    if (w !== c.text) changes.wrapped += 1;
    c.text = w;
  }
  return { cues: merged, changes };
}

/** Plain text of cues (for the transcript page / search). */
export const cuesText = (cues) => (cues || []).map((c) => c.text.replace(/\n/g, ' ')).join(' ');
