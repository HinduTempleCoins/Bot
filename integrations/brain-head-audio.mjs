// brain-head-audio.mjs — Hathor's AUDITORY lobe: HEAR and SPEAK. The auditory-cortex gap in the brain
// architecture. One head over the native-CPU audio lane (transformers.js / ONNX, same as MiniLM & vision):
//
//   listen(audio)      automatic-speech-recognition (Whisper) — turn speech into text
//   hearSound(audio)   audio-classification (AST / YAMNet, 521 AudioSet classes) — name a sound
//   speak(text)        text-to-speech (SpeechT5) — turn text into a waveform  [needs speaker embeddings]
//
// Injectable + soft-fail (house style): tests inject a fake pipe (ZERO network/download); if a model can't
// load, each method soft-returns null/[] and never throws. Importing this module does NO work, pulls NO model.
//
//   import { createAudioHead } from './brain-head-audio.mjs';
//   const a = createAudioHead();
//   await a.listen('clip.wav');            // -> "peace be with you"
//   await a.hearSound('street.wav');       // -> [{label:'Traffic noise', score:..}, ...]
//
// Per-task model overrides: MELEK_AUDIO_STT, MELEK_AUDIO_CLASSIFY, MELEK_AUDIO_TTS

export const AUDIO_MODELS = {
  listen:    { task: 'automatic-speech-recognition', model: process.env.MELEK_AUDIO_STT      || 'Xenova/whisper-base.en' },
  hearSound: { task: 'audio-classification',         model: process.env.MELEK_AUDIO_CLASSIFY || 'onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX' },
  speak:     { task: 'text-to-speech',               model: process.env.MELEK_AUDIO_TTS      || 'Xenova/speecht5_tts' },
};

// Default x-vector speaker embeddings for SpeechT5 (CMU Arctic) — overridable.
const SPEAKER_EMB = process.env.MELEK_TTS_SPEAKER || 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/speaker_embeddings.bin';

let _factory = null;
export function __setPipelineFactory(fn) { _factory = typeof fn === 'function' ? fn : null; _cache.clear(); }

const _cache = new Map();
async function loadPipe(task, model) {
  const key = `${task}|${model}`;
  if (_cache.has(key)) return _cache.get(key);
  const p = (async () => {
    if (_factory) { try { return await _factory(task, model); } catch { return null; } }
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      try { env.allowRemoteModels = true; } catch { /* older builds */ }
      return await pipeline(task, model);
    } catch { return null; }
  })();
  _cache.set(key, p);
  const pipe = await p; _cache.set(key, pipe); return pipe;
}

// Node has no AudioContext, so transformers.js can't load audio from a path/URL — it needs decoded
// samples. Decode a .wav path/URL/Buffer to a mono 16 kHz Float32Array (what Whisper/AST expect) via
// `wavefile` (lazy import). Already-decoded input (Float32Array/Array) passes through. Soft-fails to the
// original input so a fake pipe (tests) or a future backend still works.
let _wf = null, _wfTried = false;
async function loadWavefile() {
  if (_wfTried) return _wf;
  _wfTried = true;
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const m = require('wavefile');
    _wf = m.WaveFile || m.default || m;
  } catch { _wf = null; }
  return _wf;
}
export async function decodeAudio(input, targetRate = 16000) {
  if (!input || typeof input !== 'string') return input; // Float32Array/Array/tensor already
  const WaveFile = await loadWavefile();
  if (!WaveFile) return input; // no decoder → let the pipeline try (and soft-fail)
  try {
    let buf;
    if (/^https?:\/\//.test(input)) { const r = await fetch(input); buf = Buffer.from(await r.arrayBuffer()); }
    else { const { readFile } = await import('node:fs/promises'); buf = await readFile(input); }
    const wav = new WaveFile(buf);
    wav.toBitDepth('32f');
    wav.toSampleRate(targetRate);
    let samples = wav.getSamples();
    if (Array.isArray(samples)) samples = samples[0]; // stereo → first channel (mono)
    return samples instanceof Float32Array ? samples : Float32Array.from(samples);
  } catch { return input; }
}

async function run(spec, input, ...rest) {
  try {
    const pipe = await loadPipe(spec.task, spec.model);
    if (!pipe) return null;
    const audio = await decodeAudio(input);
    return await pipe(audio, ...rest);
  } catch { return null; }
}

export function createAudioHead(overrides = {}) {
  const M = { ...AUDIO_MODELS, ...overrides };
  return {
    models: M,
    /** Speech -> text (Whisper). Returns string | null. */
    async listen(audio, opts = {}) {
      const out = await run(M.listen, audio, opts);
      const r = Array.isArray(out) ? out[0] : out;
      return (r && (r.text ?? r.generated_text)) || null;
    },
    /** Name the sound(s) in a clip (AudioSet). Returns ranked [{label,score}] | []. */
    async hearSound(audio, k = 5) {
      const out = await run(M.hearSound, audio, { topk: k });
      return out ? (Array.isArray(out) ? out : [out]).slice(0, k) : [];
    },
    /** Text -> speech (SpeechT5). Returns { audio, sampling_rate } | null. Needs speaker embeddings. */
    async speak(text, { speaker_embeddings = SPEAKER_EMB } = {}) {
      return await run(M.speak, String(text || ''), { speaker_embeddings });
    },
    capabilities() { return Object.keys(M); },
  };
}
