// vtt-srt-parse.mjs — PURE subtitle (SRT / WebVTT) parser → clean transcript + timed cues.
// No network, no fetching, no summarizing, no keys, no I/O beyond an optional CLI file read.
// Backlog adf83d0ca0.
//
// PURPOSE:
//   The YouTube-transcript-summarization pipeline pulls caption files (SRT or WebVTT) elsewhere;
//   THIS module only parses them. It turns raw caption text into:
//     - an array of timed cues  [{index,startMs,endMs,text}]
//     - a clean plain-text transcript (with consecutive-duplicate-line dedupe, common in
//       YouTube auto-captions where each cue repeats the previous tail).
//   Parsing only. It never fetches, never summarizes, never touches the network.
//
// SUPPORTED:
//   - SRT timestamps  'HH:MM:SS,mmm'  (comma decimal)
//   - VTT timestamps  'HH:MM:SS.mmm'  (dot decimal); also 'MM:SS.mmm' (no hours)
//   - WEBVTT header line, NOTE blocks and STYLE blocks are stripped.
//   - multi-line cues are joined into one line.
//   - basic inline tags (<i>, <b>, <c>, <c.colorClass>, <v Speaker>, <00:00:01.000> etc.) stripped.
//
// SOFT-FAIL, NEVER THROW: malformed cues are skipped; bad input returns [] / '' / NaN-safe values.
//
//   import { detectFormat, parse, toPlainText, timecodeToMs, msToTimecode } from './integrations/vtt-srt-parse.mjs';
//
// CLI:  node integrations/vtt-srt-parse.mjs <file.srt|file.vtt>   # prints toPlainText(parse(file))

// ── format detection ────────────────────────────────────────────────────────────────────────
export function detectFormat(text) {
  if (typeof text !== 'string' || text.length === 0) return 'unknown';
  // WEBVTT must be the first non-BOM token of the file.
  const head = text.replace(/^﻿/, '').trimStart();
  if (/^WEBVTT\b/.test(head)) return 'vtt';
  // A dotted-decimal cue timing line ('-->') is VTT; a comma-decimal one is SRT.
  if (/\d{1,2}:\d{2}:\d{2}\.\d{3}\s*-->/.test(text) || /\d{1,2}:\d{2}\.\d{3}\s*-->/.test(text)) return 'vtt';
  if (/\d{1,2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) return 'srt';
  return 'unknown';
}

// ── timecode helpers ────────────────────────────────────────────────────────────────────────
// Accept both 'HH:MM:SS,mmm' (SRT) and 'HH:MM:SS.mmm' / 'MM:SS.mmm' (VTT). Returns NaN on garbage.
export function timecodeToMs(tc) {
  if (typeof tc !== 'string') return NaN;
  const m = tc.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return NaN;
  const hh = m[1] === undefined ? 0 : Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  // pad/truncate fractional part to milliseconds
  const frac = (m[4] + '000').slice(0, 3);
  const ms = Number(frac);
  if ([hh, mm, ss, ms].some((n) => !Number.isFinite(n))) return NaN;
  return ((hh * 3600 + mm * 60 + ss) * 1000) + ms;
}

// Always emits VTT-style 'HH:MM:SS.mmm'. Negative / non-finite → '00:00:00.000'.
export function msToTimecode(ms) {
  let n = Number(ms);
  if (!Number.isFinite(n) || n < 0) n = 0;
  n = Math.round(n);
  const msPart = n % 1000;
  let s = Math.floor(n / 1000);
  const ss = s % 60;
  s = Math.floor(s / 60);
  const mm = s % 60;
  const hh = Math.floor(s / 60);
  const p2 = (x) => String(x).padStart(2, '0');
  const p3 = (x) => String(x).padStart(3, '0');
  return `${p2(hh)}:${p2(mm)}:${p2(ss)}.${p3(msPart)}`;
}

// ── tag stripping ───────────────────────────────────────────────────────────────────────────
// Strip inline caption markup: <i> <b> <u> <c.foo> <v Bob> <ruby> and inline timestamp tags
// like <00:00:01.234>. Decode the handful of HTML entities subtitles actually use.
function stripTags(line) {
  if (typeof line !== 'string') return '';
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Is this line a cue timing line? Capture start/end timecodes (ignore VTT cue settings after end).
function matchTiming(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(/^\s*((?:\d{1,3}:)?\d{1,2}:\d{1,2}[.,]\d{1,3})\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{1,2}[.,]\d{1,3})/);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}

// ── core parser ─────────────────────────────────────────────────────────────────────────────
// Block-based: split on blank lines, find the timing line in each block, join the rest as text.
// WEBVTT header, NOTE and STYLE blocks are dropped. Malformed blocks are skipped, never thrown.
export function parse(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  // Normalise newlines, drop a leading BOM.
  const norm = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  // Split into blocks on one-or-more blank lines.
  const blocks = norm.split(/\n[ \t]*\n+/);
  const cues = [];
  let idx = 0;
  for (const raw of blocks) {
    const block = raw.replace(/^\n+|\n+$/g, '');
    if (block === '') continue;
    const lines = block.split('\n');
    // Drop the WEBVTT signature line / NOTE / STYLE / REGION blocks entirely.
    const first = lines[0].trim();
    if (/^WEBVTT\b/.test(first)) continue;
    if (/^NOTE\b/.test(first)) continue;
    if (/^STYLE\b/.test(first)) continue;
    if (/^REGION\b/.test(first)) continue;

    // Find the timing line in this block.
    let timingLine = -1;
    let timing = null;
    for (let i = 0; i < lines.length; i++) {
      const t = matchTiming(lines[i]);
      if (t) { timingLine = i; timing = t; break; }
    }
    if (!timing) continue; // no timing → not a cue block; skip.

    const startMs = timecodeToMs(timing.start);
    const endMs = timecodeToMs(timing.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue; // malformed → skip.

    // Everything AFTER the timing line is the cue text (a numeric index line, if any,
    // sits before the timing line and is ignored). Join multi-line, strip tags, drop empties.
    const textLines = lines
      .slice(timingLine + 1)
      .map(stripTags)
      .filter((l) => l !== '');
    const cueText = textLines.join(' ').replace(/[ \t]+/g, ' ').trim();
    if (cueText === '') continue; // empty cue → nothing to transcribe.

    cues.push({ index: idx++, startMs, endMs, text: cueText });
  }
  return cues;
}

// ── transcript flattening ───────────────────────────────────────────────────────────────────
// Join cue texts into one transcript. dedupe collapses CONSECUTIVE identical lines (auto-caption
// rolling repeats) — not all duplicates, only adjacent ones, preserving order.
export function toPlainText(cues, { dedupe = true, join = ' ' } = {}) {
  if (!Array.isArray(cues)) return '';
  const joiner = typeof join === 'string' ? join : ' ';
  const out = [];
  let prev = null;
  for (const c of cues) {
    if (!c || typeof c.text !== 'string') continue;
    const line = c.text.trim();
    if (line === '') continue;
    if (dedupe && prev !== null && line === prev) continue;
    out.push(line);
    prev = line;
  }
  return out.join(joiner);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node integrations/vtt-srt-parse.mjs <file.srt|file.vtt>');
    process.exit(1);
  }
  import('node:fs').then((fs) => {
    let text = '';
    try {
      text = fs.readFileSync(path, 'utf8');
    } catch (e) {
      console.error(`could not read ${path}: ${e && e.message}`);
      process.exit(1);
      return;
    }
    const fmt = detectFormat(text);
    const cues = parse(text);
    console.error(`# format=${fmt} cues=${cues.length}`);
    console.log(toPlainText(cues));
  });
}
