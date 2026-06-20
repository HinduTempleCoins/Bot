// youtube-transcript.mjs — the LANGUAGE-CENTER organ that CREATES a transcript from a YouTube video.
//
// Operator (2026-06-20): "add YouTube transcript creation through the Language Center." `vtt-srt-parse.mjs`
// already PARSES caption files; the missing piece was the FETCHER — pull a video's caption/timedtext track.
// This is it. It resolves a video id/URL, fetches the available caption track (the `timedtext` endpoint,
// or a caller-provided track URL), normalizes YouTube's XML cue format → a clean transcript + timed cues,
// and soft-fails to {needsAsr:true} when a video has no captions (so the audio path / Whisper can take over).
//
// Pure + injectable `fetch` → fully offline-testable (no network in tests). Soft-fails, never throws.
// House style: ESM, CLI guard, handler(req,res).

import { parse as parseCaptionFile } from './vtt-srt-parse.mjs';

// Pull the 11-char video id out of any common YouTube URL form (or accept a bare id).
export function videoId(input) {
  const s = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// YouTube's timedtext XML: <text start="1.2" dur="3.4">caption &amp; text</text>
export function parseTimedtextXml(xml) {
  const cues = [];
  const re = /<text(?:\s+start="([\d.]+)")?(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const startMs = Math.round((Number(m[1]) || 0) * 1000);
    const durMs = Math.round((Number(m[2]) || 0) * 1000);
    const text = decodeEntities(m[3]).replace(/\s+/g, ' ').trim();
    if (text) cues.push({ index: cues.length + 1, startMs, endMs: startMs + durMs, text });
  }
  return cues;
}

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function cuesToTranscript(cues) {
  const lines = [];
  for (const c of cues) { const t = c.text.trim(); if (t && t !== lines[lines.length - 1]) lines.push(t); }
  return lines.join(' ');
}

/**
 * Create a transcript for a video.
 * @param {string} idOrUrl
 * @param {object} opts { fetch, lang='en', trackUrl? }  fetch is injected (offline-testable)
 * @returns {Promise<{ ok, videoId, lang, source, cues, transcript, needsAsr?, note? }>}
 */
export async function fetchTranscript(idOrUrl, opts = {}) {
  const id = videoId(idOrUrl);
  const lang = opts.lang || 'en';
  // honor an EXPLICIT falsy fetch ({fetch:null}) as "no fetch"; otherwise fall back to the global.
  const f = ('fetch' in opts) ? opts.fetch : (typeof fetch === 'function' ? fetch : null);
  if (!id) return { ok: false, videoId: null, lang, source: null, cues: [], transcript: '', note: 'bad-id' };
  if (!f) return { ok: false, videoId: id, lang, source: null, cues: [], transcript: '', note: 'no-fetch' };

  const urls = opts.trackUrl ? [opts.trackUrl] : [
    `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(lang)}&v=${id}`,
    `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(lang)}&v=${id}&kind=asr`,
  ];

  for (const url of urls) {
    let raw = '';
    try { const r = await f(url); raw = r && typeof r.text === 'function' ? await r.text() : String(r || ''); }
    catch { continue; }
    if (!raw || !raw.trim()) continue;
    // YouTube timedtext is XML; a caller-provided track may be SRT/VTT → delegate to the parser.
    let cues = [];
    if (/<text[\s>]/.test(raw)) cues = parseTimedtextXml(raw);
    else { try { cues = parseCaptionFile(raw) || []; } catch { cues = []; } }
    if (cues.length) {
      const isAsr = /kind=asr/.test(url);
      return { ok: true, videoId: id, lang, source: isAsr ? 'youtube-asr' : 'youtube-captions', cues, transcript: cuesToTranscript(cues), needsAsr: false };
    }
  }
  // No caption track found — the audio path (Whisper/STT) must create it.
  return { ok: false, videoId: id, lang, source: null, cues: [], transcript: '', needsAsr: true, note: 'no-captions' };
}

export function handler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let p = {}; try { p = JSON.parse(body || '{}'); } catch {}
    const out = await fetchTranscript(p.video || p.url || '', { lang: p.lang });
    res.writeHead(out.ok ? 200 : 422, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node youtube-transcript.mjs <videoIdOrUrl>'); }
  else fetchTranscript(arg).then((r) => console.log(r.ok ? r.transcript.slice(0, 800) : `[${r.note || 'failed'}] needsAsr=${!!r.needsAsr}`));
}
