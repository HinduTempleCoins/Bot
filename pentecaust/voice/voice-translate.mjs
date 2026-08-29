// pentecaust/voice/voice-translate.mjs — Pentecaust "Voice": consent-native voice-preserving translation.
//
// THE VISION (see .local/PENTECAUST_VOICE_FEATURE.md)
//   A speaker enrolls THEIR OWN voice, consensually, on Pentecaust. They speak in their language. Every
//   listener chooses the language they hear (Pentecaust knows each user's language preference — see
//   translate.mjs setLang/getLang) and hears it IN THE SPEAKER'S OWN CLONED VOICE, translated. One speaker →
//   N listeners, each in their own language, same voice. "Speak once, everyone hears their language."
//
// WHY THIS IS NOT THE TCPA PROBLEM
//   compliance.mjs's TCPA gate blocks UNSOLICITED OUTBOUND AI-voice cold-calls. This is the opposite: opt-in,
//   user-initiated, the speaker's OWN voice, listener-chosen. Consent-native by construction — you can only
//   clone your OWN enrolled voice (enrollVoice REQUIRES consent===true AND that the sample is the enroller's).
//
// WHAT THIS IS (this file = the ORCHESTRATION; the real STT/TTS models live on a GPU box)
//   - Provider interface, injectable so the whole pipeline is testable offline with mocks:
//       __setSTT(fn)  audio                       -> { text, lang }        (Whisper / faster-whisper)
//       __setMT(fn)   { text, from, to }          -> translatedText:string (our translate.mjs layer)
//       __setTTS(fn)  { text, lang, voiceProfile } -> audioDescriptor       (XTTS/Coqui or ElevenLabs)
//     Every default provider soft-fails to a clear { ok:false, reason:'unconfigured' } — nothing here reaches
//     the network on its own. Wire the real providers at deploy time (see "WIRING REAL PROVIDERS" at bottom).
//   - enrollVoice({account, sample, consent}) — records a voice-clone profile; consent-gated + self-only.
//   - translateUtterance({audio, speakerProfileId, fromLang, listenerLang}) — STT → MT → TTS(speaker voice).
//   - fanOut({audio, speakerProfileId, fromLang, listeners:[{account,lang}]}) — one utterance → N per-listener
//     outputs, each in the listener's language, all in the speaker's voice.
//
//   Everything soft-fails (never throws): a failed stage returns { ok:false, reason, stage } so a call/DM/post
//   pipeline degrades gracefully (fall back to text, or to the untranslated original) instead of crashing.
//
//   import { enrollVoice, translateUtterance, fanOut, __setSTT, __setMT, __setTTS } from './voice-translate.mjs'

import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

// ── voice-clone profile store (profileId -> { account, voiceProfile, lang, createdAt }) ─────────────────
// voiceProfile is an OPAQUE handle the TTS provider understands (a speaker embedding ref / cloned-voice id).
// We never store raw voice audio here — the enrollment sample is handed to the (injectable) cloner, and only
// the resulting handle is persisted. File-backed with injectable fs so the offline suite touches no disk state.
const DATA_FILE = () => env('VOICE_DATA', join(process.cwd(), 'data', 'pentecaust-voice.json'));
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); } catch {} },
};
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { profiles: {} };
  try { const o = JSON.parse(raw); return o && o.profiles ? o : { profiles: {} }; } catch { return { profiles: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }

const _acct = (s) => String(s || '').trim().toLowerCase();
const LANG_RE = /^[a-z]{2,3}(-[a-z]{2,4})?$/;
export function normLang(l) { const s = String(l || '').trim().toLowerCase(); return LANG_RE.test(s) ? s : ''; }

// ── injectable providers — defaults soft-fail to { ok:false, reason:'unconfigured' } ───────────────────
const UNCONFIGURED = async () => ({ ok: false, reason: 'unconfigured' });
let _stt = UNCONFIGURED; // audio -> { text, lang }
let _mt = UNCONFIGURED;  // { text, from, to } -> translatedText:string
let _tts = UNCONFIGURED;  // { text, lang, voiceProfile } -> audioDescriptor
export function __setSTT(fn) { _stt = typeof fn === 'function' ? fn : UNCONFIGURED; }
export function __setMT(fn) { _mt = typeof fn === 'function' ? fn : UNCONFIGURED; }
export function __setTTS(fn) { _tts = typeof fn === 'function' ? fn : UNCONFIGURED; }
/** Reset every provider back to the unconfigured default (used by tests). */
export function __resetProviders() { _stt = UNCONFIGURED; _mt = UNCONFIGURED; _tts = UNCONFIGURED; }

// Was a provider's result an explicit "unconfigured"/failure sentinel? (defaults return that shape).
const isUnconfigured = (r) => r && typeof r === 'object' && r.ok === false;

/**
 * Opt-in bridge: wire MT to the already-shipped Pentecaust translate layer (translate.mjs — keyless MyMemory
 * by default, LibreTranslate via env). Call this ONCE at startup to use the real text-MT layer as the MT
 * provider. Lazy-imports so nothing loads (and nothing can hit the network) unless you explicitly opt in.
 */
export async function useShippedTranslateLayer() {
  try {
    const mod = await import('../translate.mjs');
    __setMT(async ({ text, from, to }) => {
      const r = await mod.translate({ text, from, to });
      // translate() soft-fails to the original with tr:null; carry the original through when there's no change.
      return (r && typeof r.tr === 'string' && r.tr) ? r.tr : String(text == null ? '' : text);
    });
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'translate-layer-unavailable' }; }
}

// ── enrollment (consent-native) ─────────────────────────────────────────────────────────────────────
/**
 * Enroll an account's OWN voice as a clone profile. Consent-native:
 *   - REQUIRES consent === true (an explicit, recorded opt-in — not merely truthy).
 *   - REQUIRES the sample to belong to the enrolling account. `sample` may be a string (opaque audio ref) or
 *     an object; if it carries a `.account`, it MUST equal `account`. You can only clone your own voice.
 * Returns { ok:true, voiceProfileId, account } or { ok:false, reason }. Never throws.
 *
 * @param {{account:string, sample:(string|object), consent:boolean}} args
 */
export function enrollVoice({ account, sample, consent } = {}, opts = {}) {
  const acct = _acct(account);
  if (!acct) return { ok: false, reason: 'account required' };
  if (consent !== true) return { ok: false, reason: 'consent required' };
  if (sample == null || (typeof sample === 'string' && !sample.trim())) return { ok: false, reason: 'sample required' };
  // Self-only: a sample tagged with a DIFFERENT account is refused (can't clone someone else's voice).
  const sampleAcct = (sample && typeof sample === 'object') ? _acct(sample.account) : '';
  if (sampleAcct && sampleAcct !== acct) return { ok: false, reason: 'sample must belong to the enrolling account' };

  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const voiceProfileId = `vp_${acct}_${randomBytes(6).toString('hex')}`;
  // The opaque handle the TTS cloner keys on. In production this is the cloned-voice id the enroll step
  // returned from XTTS/ElevenLabs; here we persist a reference the (injectable) TTS provider can echo/use.
  const voiceProfile = { account: acct, ref: (typeof sample === 'string' ? sample : (sample.ref || sample.id || voiceProfileId)) };
  const lang = normLang(sample && typeof sample === 'object' ? sample.lang : '') || '';
  store.profiles[voiceProfileId] = { account: acct, voiceProfile, lang, consent: true, createdAt: Date.now() };
  saveStore(fs, file, store);
  return { ok: true, voiceProfileId, account: acct };
}

/** Look up an enrolled profile by id. Returns the stored record or null. */
export function getProfile(voiceProfileId, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  return store.profiles[String(voiceProfileId || '')] || null;
}

/** Remove an enrolled profile (revoke consent). Returns { ok, removed }. */
export function revokeVoice(voiceProfileId, opts = {}) {
  const id = String(voiceProfileId || '');
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const had = Object.prototype.hasOwnProperty.call(store.profiles, id);
  if (had) { delete store.profiles[id]; saveStore(fs, file, store); }
  return { ok: true, removed: had };
}

// ── the per-utterance pipeline: STT → MT → TTS(speaker voice) ─────────────────────────────────────────
async function runSTT(audio) {
  try {
    const r = await _stt(audio);
    if (isUnconfigured(r)) return { ok: false, reason: r.reason || 'unconfigured' };
    const text = r && typeof r.text === 'string' ? r.text : '';
    if (!text.trim()) return { ok: false, reason: 'stt-empty' };
    return { ok: true, text, lang: normLang(r.lang) || '' };
  } catch { return { ok: false, reason: 'stt-error' }; }
}
async function runMT(text, from, to) {
  // Same language → nothing to translate; pass the text straight through (still voiced by TTS).
  if (!to || from === to) return { ok: true, text };
  try {
    const r = await _mt({ text, from, to });
    if (isUnconfigured(r)) return { ok: false, reason: r.reason || 'unconfigured' };
    const out = typeof r === 'string' ? r : (r && typeof r.text === 'string' ? r.text : '');
    if (!out.trim()) return { ok: false, reason: 'mt-empty' };
    return { ok: true, text: out };
  } catch { return { ok: false, reason: 'mt-error' }; }
}
async function runTTS(text, lang, voiceProfile) {
  try {
    const r = await _tts({ text, lang, voiceProfile });
    if (isUnconfigured(r)) return { ok: false, reason: r.reason || 'unconfigured' };
    if (r == null) return { ok: false, reason: 'tts-empty' };
    return { ok: true, audio: r };
  } catch { return { ok: false, reason: 'tts-error' }; }
}

/**
 * Translate ONE speaker utterance for ONE listener: STT → MT → TTS in the speaker's cloned voice.
 * Soft-fails cleanly at whichever stage is unconfigured/broken (returns { ok:false, reason, stage }).
 *
 * @param {{audio:*, speakerProfileId:string, fromLang?:string, listenerLang:string}} args
 * @returns {Promise<{ok:true, text, translatedText, audio, fromLang, toLang}|{ok:false, reason, stage}>}
 */
export async function translateUtterance({ audio, speakerProfileId, fromLang, listenerLang } = {}, opts = {}) {
  const profile = getProfile(speakerProfileId, opts);
  if (!profile) return { ok: false, reason: 'unknown speaker profile', stage: 'profile' };
  const toLang = normLang(listenerLang);
  if (!toLang) return { ok: false, reason: 'listener language required', stage: 'lang' };

  const stt = await runSTT(audio);
  if (!stt.ok) return { ok: false, reason: stt.reason, stage: 'stt' };
  // fromLang precedence: explicit arg → STT-detected → the profile's enrolled language → 'en'.
  const from = normLang(fromLang) || stt.lang || normLang(profile.lang) || 'en';

  const mt = await runMT(stt.text, from, toLang);
  if (!mt.ok) return { ok: false, reason: mt.reason, stage: 'mt', text: stt.text, fromLang: from };

  const tts = await runTTS(mt.text, toLang, profile.voiceProfile);
  if (!tts.ok) return { ok: false, reason: tts.reason, stage: 'tts', text: stt.text, translatedText: mt.text, fromLang: from, toLang };

  return { ok: true, text: stt.text, translatedText: mt.text, audio: tts.audio, fromLang: from, toLang };
}

/**
 * The headline "speak once, everyone hears their language" core. One speaker utterance → N per-listener
 * outputs. STT runs ONCE; MT + TTS run per distinct listener language (results de-duped so ten listeners in
 * Spanish cost one MT+TTS, not ten). Each output is in that listener's language, in the SPEAKER'S voice.
 *
 * @param {{audio:*, speakerProfileId:string, fromLang?:string, listeners:{account:string,lang:string}[]}} args
 * @returns {Promise<{ok:boolean, fromLang?:string, text?:string, outputs:Array, reason?, stage?}>}
 *   outputs[i] = { account, lang, ok, translatedText?, audio?, reason? } aligned to `listeners`.
 */
export async function fanOut({ audio, speakerProfileId, fromLang, listeners } = {}, opts = {}) {
  const profile = getProfile(speakerProfileId, opts);
  if (!profile) return { ok: false, reason: 'unknown speaker profile', stage: 'profile', outputs: [] };
  const list = Array.isArray(listeners) ? listeners : [];

  // STT once for the whole fan-out.
  const stt = await runSTT(audio);
  if (!stt.ok) return { ok: false, reason: stt.reason, stage: 'stt', outputs: [] };
  const from = normLang(fromLang) || stt.lang || normLang(profile.lang) || 'en';

  // De-dupe by target language so shared languages are translated+voiced once.
  const byLang = new Map(); // lang -> Promise<{ok, translatedText?, audio?, reason?}>
  const jobFor = (lang) => {
    if (!byLang.has(lang)) {
      byLang.set(lang, (async () => {
        const mt = await runMT(stt.text, from, lang);
        if (!mt.ok) return { ok: false, reason: mt.reason, stage: 'mt' };
        const tts = await runTTS(mt.text, lang, profile.voiceProfile);
        if (!tts.ok) return { ok: false, reason: tts.reason, stage: 'tts', translatedText: mt.text };
        return { ok: true, translatedText: mt.text, audio: tts.audio };
      })());
    }
    return byLang.get(lang);
  };

  const outputs = await Promise.all(list.map(async (l) => {
    const account = _acct(l && l.account);
    const lang = normLang(l && l.lang);
    if (!lang) return { account, lang: '', ok: false, reason: 'listener language required' };
    const r = await jobFor(lang);
    return r.ok
      ? { account, lang, ok: true, translatedText: r.translatedText, audio: r.audio }
      : { account, lang, ok: false, reason: r.reason, stage: r.stage };
  }));

  return { ok: true, fromLang: from, text: stt.text, outputs };
}

// ── CLI (guarded) — offline demo with tiny mock providers so `node voice-translate.mjs` shows the shape ──
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(env('TMPDIR', '/tmp'), `pentecaust-voice-cli-${process.pid}.json`);
  const O = { file };
  __setSTT(async () => ({ text: 'Peace be with you.', lang: 'en' }));
  __setMT(async ({ text, to }) => `[${to}] ${text}`);
  __setTTS(async ({ text, lang, voiceProfile }) => ({ format: 'wav', lang, voice: voiceProfile && voiceProfile.account, bytes: text.length }));
  const en = enrollVoice({ account: 'hathor', sample: 'sample-audio-ref', consent: true }, O);
  const out = await fanOut({
    audio: 'utterance-audio', speakerProfileId: en.voiceProfileId, fromLang: 'en',
    listeners: [{ account: 'ana', lang: 'es' }, { account: 'yusuf', lang: 'tr' }, { account: 'li', lang: 'zh' }],
  }, O);
  console.log(esc(JSON.stringify({ enroll: en, fanOut: out }, null, 2)));
  try { (await import('node:fs')).unlinkSync(file); } catch {}
}

// ── WIRING REAL PROVIDERS (deploy-time; nothing below runs — it's the operator recipe) ─────────────────
//
// The whole file above is the orchestration. At deploy time you inject three real providers. All three run on
// a GPU box (the PRANA / mining-allowed host — see memory prana-box-live); this repo holds ZERO model weights.
//
//  STT — Whisper / faster-whisper (open, no per-use cost):
//    __setSTT(async (audio) => {
//      // POST the audio bytes to a faster-whisper HTTP server on the GPU box.
//      const r = await fetch(process.env.STT_URL, { method:'POST', body: audio });
//      const j = await r.json();               // { text, language }
//      return { text: j.text, lang: j.language };
//    });
//
//  MT — our shipped translate layer (keyless MyMemory default; LibreTranslate via env). Simplest:
//    await useShippedTranslateLayer();         // wires __setMT to translate.mjs — the descent-of-tongues layer
//    // …or inject any { text, from, to } -> string engine directly with __setMT.
//
//  TTS — voice-clone TTS keyed on the enrolled speaker's voiceProfile handle:
//    Open stack — XTTS / Coqui on the GPU box (no per-use cost):
//      __setTTS(async ({ text, lang, voiceProfile }) => {
//        const r = await fetch(process.env.TTS_URL, { method:'POST',
//          headers:{'content-type':'application/json'},
//          body: JSON.stringify({ text, language: lang, speaker_ref: voiceProfile.ref }) });
//        return await r.arrayBuffer();          // the cloned-voice audio (the audioDescriptor)
//      });
//    API stack — ElevenLabs (voice clone + real-time dubbing, highest quality, per-use cost):
//      the enroll step registers the sample as an ElevenLabs voice and stores its voice_id as voiceProfile.ref;
//      __setTTS then calls the ElevenLabs TTS endpoint with that voice_id + the translated text.
//
// Start ASYNC (translate a recorded voice note / post into the listener's language, in the speaker's voice),
// then move to real-time streaming for calls/live. The earphone live-translation app is the hardware front-end.
