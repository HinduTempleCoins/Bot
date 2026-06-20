// auditory-cortex.mjs — Hathor's AUDITORY LOBE: hearing (speech→text) and voice (text→speech).
//
// The temporal-lobe counterpart to the visual cortex. It does NOT bind a specific provider — the STT/TTS
// engine is INJECTED (pick one from hearing-apis.mjs: Groq Whisper now, faster-whisper on our compute,
// Deepgram for streaming; ElevenLabs/Coqui/Piper for voice). This lobe is the seam: it takes audio →
// transcript (then runs the corpus DECIPHER so mis-heard names/terms are repaired), and text → speech.
//
// It also closes youtube-transcript.mjs's gap: when a video has no captions (`needsAsr:true`), hand its
// audio here. Pure orchestration, injectable, offline-testable, soft-fails (deaf-but-not-broken).
//
// House style: ESM, soft-fail, CLI guard, handler(req,res).

import { decipher } from './transcript-decipher.mjs';

/**
 * Hear: turn audio into a deciphered transcript.
 * @param {string|object} audioRef  a URL/path/handle the injected stt() understands
 * @param {object} deps {
 *   stt: async (audioRef, {lang}) => ({ text, cues?, words? }) | string   // the hearing engine (injected)
 *   complete?: Function     // optional ensemble refine for the decipher pass
 *   glossary?, lang?, decipher?: boolean (default true)
 * }
 * @returns {Promise<{ ok, transcript, raw, cues, corrections, deaf?, note? }>}
 */
export async function hear(audioRef, deps = {}) {
  if (!audioRef) return deaf('no-audio');
  if (typeof deps.stt !== 'function') return deaf('no-engine');
  let res;
  try { res = await deps.stt(audioRef, { lang: deps.lang || 'en' }); }
  catch { return deaf('engine-error'); }
  const raw = typeof res === 'string' ? res : (res && res.text) || '';
  const cues = (res && res.cues) || [];
  if (!raw.trim()) return deaf('nothing-heard');

  if (deps.decipher === false) return { ok: true, transcript: raw, raw, cues, corrections: [] };
  const d = await decipher(raw, { glossary: deps.glossary, complete: deps.complete });
  return { ok: true, transcript: d.text, raw, cues, corrections: d.corrections, refined: d.refined };
}

/**
 * Speak: turn text into audio via an injected TTS engine. Returns whatever the engine yields (a buffer,
 * a URL, a path) plus the spoken text. Soft-fails to { ok:false } — Hathor can always fall back to text.
 * @param {string} text
 * @param {object} deps { tts: async (text,{voice}) => audio, voice? }
 */
export async function speak(text, deps = {}) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, note: 'no-text' };
  if (typeof deps.tts !== 'function') return { ok: false, note: 'no-voice', text: t };
  try { const audio = await deps.tts(t, { voice: deps.voice || 'hathor' }); return { ok: true, text: t, audio }; }
  catch { return { ok: false, note: 'voice-error', text: t }; }
}

/**
 * Bridge for youtube-transcript's needsAsr path: given a video result that lacked captions, hear its
 * audio (the caller resolves the audio URL/stream the injected stt() accepts).
 */
export async function transcribeFromAudio(audioRef, deps = {}) {
  const h = await hear(audioRef, deps);
  return { ...h, source: 'asr' };
}

function deaf(note) { return { ok: false, transcript: '', raw: '', cues: [], corrections: [], deaf: true, note }; }

export function handler(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    // no engine injected at the HTTP boundary (wired on the box); returns the deaf shape honestly.
    let p = {}; try { p = JSON.parse(body || '{}'); } catch {}
    const out = await hear(p.audio, {});
    res.writeHead(out.ok ? 200 : 422, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // demo with a stub hearing engine that mis-hears, then decipher repairs it
  const stt = async () => ({ text: 'terrence mckinna and sasha shogun talked about silo sybin in prog' });
  hear('demo://audio', { stt }).then((h) => console.log(h.transcript, '\n', 'corrections:', h.corrections.length));
}
