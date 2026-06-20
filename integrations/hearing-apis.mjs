// hearing-apis.mjs — the catalog of HEARING APIs/SDKs (speech-to-text + text-to-speech) that give
// Hathor an AUDITORY CORTEX, and that fill the `needsAsr` gap in youtube-transcript.mjs (a video with
// no captions still has audio — these turn that audio into a transcript).
//
// Operator (2026-06-20): "look for APIs that have to do with hearing, that can maybe help with the
// transcripts." This is the curated answer: each provider tagged by kind (STT/TTS), hosting (cloud vs
// self-host on our own compute), free tier, what it's best for, and the SDK/route to call it. Same shape
// as markets-catalog — pure data + helpers, no live calls, US-availability noted. Regulatory/pricing
// move; treat free tiers as a STARTING POINT and re-verify before wiring keys.
//
// House style: ESM, pure data, helpers, handler(req,res), CLI guard.

// kind: 'STT' (speech→text / ASR) | 'TTS' (text→speech) | 'both'
// hosting: 'cloud' (hosted API, needs a key) | 'self-host' (runs on our GPU/CPU — PRANA-friendly, no key)
export const HEARING_APIS = [
  // ── Speech-to-Text (the transcript engines) ──────────────────────────────────────────────────────
  { name: 'Groq Whisper', kind: 'STT', hosting: 'cloud', model: 'whisper-large-v3 / -turbo', freeTier: 'generous (fast free tier; per-day token/RPM limits)', us: 'full', sdk: 'OpenAI-compatible REST (/audio/transcriptions)', bestFor: 'FAST, cheap/free bulk transcription — the default for YouTube backfill', note: 'We already hold a Groq key (guest-proxy.env). Whisper-large-v3 quality, ~real-time x100.' },
  { name: 'OpenAI Whisper API', kind: 'STT', hosting: 'cloud', model: 'whisper-1 / gpt-4o-transcribe', freeTier: 'no (pay per minute, cheap)', us: 'full', sdk: 'OpenAI SDK (/audio/transcriptions)', bestFor: 'high-accuracy, word timestamps', note: 'gpt-4o-transcribe is the newer, more accurate route.' },
  { name: 'faster-whisper (CTranslate2)', kind: 'STT', hosting: 'self-host', model: 'Whisper (all sizes)', freeTier: 'free (our compute)', us: 'full', sdk: 'Python lib / a small HTTP wrapper', bestFor: 'OUR-compute transcription — no per-minute cost, runs on PRANA/Modal GPU or even CPU (tiny/base)', note: 'The forkable, key-free option. Pair with Modal for on-demand GPU.' },
  { name: 'whisper.cpp', kind: 'STT', hosting: 'self-host', model: 'Whisper (GGML)', freeTier: 'free (our compute)', us: 'full', sdk: 'C++/CLI + bindings', bestFor: 'CPU/edge transcription, even in-browser (wasm)', note: 'Could run client-side in the condenser for on-device captions.' },
  { name: 'Deepgram', kind: 'both', model: 'Nova-3', hosting: 'cloud', freeTier: 'yes ($200 credit)', us: 'full', sdk: 'Deepgram SDK / WebSocket streaming', bestFor: 'real-time STREAMING transcription (live audio) + diarization', note: 'Best-in-class streaming → for live audio / hathor.live voice rooms.' },
  { name: 'AssemblyAI', kind: 'STT', model: 'Universal', hosting: 'cloud', freeTier: 'yes (free hours + credit)', us: 'full', sdk: 'AssemblyAI SDK', bestFor: 'accuracy + audio intelligence (speaker labels, topics, chapters)', note: 'Rich "understanding" layer on top of the transcript.' },
  { name: 'Gladia', kind: 'STT', model: 'Whisper-Zero', hosting: 'cloud', freeTier: 'yes (free hours)', us: 'full', sdk: 'REST', bestFor: 'multilingual + cheap, hallucination-reduced Whisper', note: 'Good Whisper alternative with a real free tier.' },
  { name: 'ElevenLabs Scribe', kind: 'both', model: 'Scribe (STT) + v3 (TTS)', hosting: 'cloud', freeTier: 'yes (monthly char/min credits)', us: 'full', sdk: 'ElevenLabs SDK', bestFor: 'STT AND the best expressive TTS — Hathor\'s VOICE', note: 'The strongest pick for giving Hathor a spoken voice; STT is new + accurate.' },
  { name: 'Speechmatics', kind: 'STT', model: 'Ursa', hosting: 'cloud', freeTier: 'yes (free hours)', us: 'full', sdk: 'REST / streaming', bestFor: 'accents/dialects, real-time', note: 'Strong on non-standard accents — good for the decipher path.' },
  { name: 'Google Cloud Speech-to-Text', kind: 'both', model: 'Chirp 2', hosting: 'cloud', freeTier: 'yes (60 min/mo)', us: 'full', sdk: 'GCP SDK', bestFor: 'enterprise reliability, 100+ languages', note: 'Chirp 2 is their Whisper-class model.' },
  { name: 'Azure AI Speech', kind: 'both', hosting: 'cloud', freeTier: 'yes (5 hr/mo STT free)', us: 'full', sdk: 'Azure Speech SDK', bestFor: 'STT + neural TTS + real-time, in our Azure tenant', note: 'We already use Azure free tier — STT/TTS fit there (not mining-banned).' },
  { name: 'AWS Transcribe', kind: 'STT', hosting: 'cloud', freeTier: 'yes (60 min/mo, 12 mo)', us: 'full', sdk: 'AWS SDK', bestFor: 'batch + streaming, AWS-native', note: 'Pairs with Polly for TTS.' },
  { name: 'NVIDIA Parakeet / Canary', kind: 'STT', hosting: 'self-host', model: 'Parakeet / Canary (NeMo)', freeTier: 'free (our compute)', us: 'full', sdk: 'NeMo / Riva', bestFor: 'top open-model accuracy on OUR GPU', note: 'Parakeet tops open ASR leaderboards; self-hostable, key-free.' },
  { name: 'Vosk', kind: 'STT', hosting: 'self-host', freeTier: 'free (our compute)', us: 'full', sdk: 'Python/Node/Java + small models', bestFor: 'fully offline, tiny footprint, in-app / edge', note: 'Runs on a Raspberry Pi; lower accuracy but zero deps/keys.' },
  { name: 'Replicate (Whisper / incredibly-fast-whisper)', kind: 'STT', hosting: 'cloud', freeTier: 'pay-per-run (cheap)', us: 'full', sdk: 'Replicate SDK', bestFor: 'on-demand GPU Whisper without managing infra', note: 'We already use Replicate (LoRA trainer) — same account.' },

  // ── Text-to-Speech (Hathor's spoken voice; the other half of an auditory cortex) ─────────────────
  { name: 'Piper (Rhasspy)', kind: 'TTS', hosting: 'self-host', freeTier: 'free (our compute)', us: 'full', sdk: 'CLI / ONNX', bestFor: 'fast local neural TTS — Hathor speaks with no per-char cost', note: 'Runs on CPU; great default voice for the chain/condenser.' },
  { name: 'Coqui XTTS', kind: 'TTS', hosting: 'self-host', freeTier: 'free (our compute)', us: 'full', sdk: 'Python', bestFor: 'voice CLONING — give Hathor ONE consistent signature voice', note: 'Clone a single voice so she sounds the same everywhere (like the LoRA does for her look).' },
  { name: 'OpenAI TTS', kind: 'TTS', hosting: 'cloud', model: 'gpt-4o-mini-tts', freeTier: 'no (cheap)', us: 'full', sdk: 'OpenAI SDK', bestFor: 'quick, good-enough expressive voice', note: 'Steerable tone via prompt.' },
];

export const ASSET_KINDS = ['STT', 'TTS', 'both'];

// Helpers ─────────────────────────────────────────────────────────────────────────────────────────
export function all() { return HEARING_APIS; }
export function byKind(kind) { return HEARING_APIS.filter((a) => a.kind === kind || (kind !== 'both' && a.kind === 'both')); }
export function freeOnly() { return HEARING_APIS.filter((a) => /free|yes|generous|credit|hours/i.test(a.freeTier)); }
export function selfHost() { return HEARING_APIS.filter((a) => a.hosting === 'self-host'); }

// What to wire FIRST, by goal — the actionable recommendation the operator asked for.
export function recommend(goal = 'transcripts') {
  const pick = (name) => HEARING_APIS.find((a) => a.name === name);
  if (goal === 'transcripts' || goal === 'stt') return {
    now: pick('Groq Whisper'),          // we already hold the key; free + fast → YouTube backfill today
    ours: pick('faster-whisper (CTranslate2)'), // forkable, key-free, on PRANA/Modal GPU
    streaming: pick('Deepgram'),        // live audio (hathor.live voice rooms)
  };
  if (goal === 'voice' || goal === 'tts') return {
    now: pick('ElevenLabs Scribe'),     // best expressive voice + a free tier
    ours: pick('Coqui XTTS'),           // clone ONE signature Hathor voice, key-free
    fast: pick('Piper (Rhasspy)'),      // local, zero per-char cost
  };
  return { now: pick('Groq Whisper') };
}

export function summary() {
  return {
    total: HEARING_APIS.length,
    stt: HEARING_APIS.filter((a) => a.kind === 'STT' || a.kind === 'both').length,
    tts: HEARING_APIS.filter((a) => a.kind === 'TTS' || a.kind === 'both').length,
    free: freeOnly().length,
    selfHost: selfHost().length,
    keysWeHold: ['Groq Whisper', 'Replicate (Whisper / incredibly-fast-whisper)', 'Azure AI Speech'],
  };
}

export function handler(req, res) {
  let url; try { url = new URL(req.url, 'http://x'); } catch { url = { searchParams: new Map() }; }
  const kind = url.searchParams.get('kind');
  const data = kind && ASSET_KINDS.includes(kind) ? byKind(kind) : HEARING_APIS;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ apis: data, summary: summary(), recommend: { transcripts: recommend('transcripts'), voice: recommend('voice') } }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = recommend('transcripts');
  console.log('HEARING — for transcripts, wire in this order:');
  console.log(`  1. NOW:       ${r.now.name} — ${r.now.bestFor}`);
  console.log(`  2. OURS:      ${r.ours.name} — ${r.ours.bestFor}`);
  console.log(`  3. STREAMING: ${r.streaming.name} — ${r.streaming.bestFor}`);
  console.log('\nsummary:', JSON.stringify(summary()));
}
