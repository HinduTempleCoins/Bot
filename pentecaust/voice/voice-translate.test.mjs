// voice-translate.test.mjs — OFFLINE. Mocked STT/MT/TTS providers, temp store file. Soft-fail-never-throw.
// No network: STT/TTS models are not available here, so we test the ORCHESTRATION with injectable mocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  enrollVoice, getProfile, revokeVoice, translateUtterance, fanOut, normLang,
  __setSTT, __setMT, __setTTS, __resetProviders,
} from './voice-translate.mjs';

let n = 0;
function freshFile() {
  const f = join(tmpdir(), `pentecaust-voice-test-${process.pid}-${n++}.json`);
  try { unlinkSync(f); } catch {}
  return f;
}
const O = (file) => ({ file });

// Deterministic offline mocks.
const mockSTT = (text = 'hello there', lang = 'en') => async () => ({ text, lang });
// MT that tags the target language so we can assert per-listener routing: "[es] hello there".
const mockMT = () => async ({ text, to }) => `[${to}] ${text}`;
// TTS that echoes the voiceProfile so we can assert the SPEAKER'S voice carried through, plus lang+text.
const mockTTS = () => async ({ text, lang, voiceProfile }) => ({ format: 'wav', lang, text, voice: voiceProfile && voiceProfile.account });

function wireAll() { __setSTT(mockSTT()); __setMT(mockMT()); __setTTS(mockTTS()); }

// ── enrollment: consent gate + self-only ───────────────────────────────────────────────────────────
test('enrollVoice: refuses without consent===true', () => {
  const o = O(freshFile());
  assert.equal(enrollVoice({ account: 'ana', sample: 's', consent: false }, o).ok, false);
  assert.equal(enrollVoice({ account: 'ana', sample: 's' }, o).reason, 'consent required');
  // truthy-but-not-true is still refused (explicit opt-in only)
  assert.equal(enrollVoice({ account: 'ana', sample: 's', consent: 1 }, o).ok, false);
});

test('enrollVoice: requires account and sample', () => {
  const o = O(freshFile());
  assert.equal(enrollVoice({ sample: 's', consent: true }, o).reason, 'account required');
  assert.equal(enrollVoice({ account: 'ana', sample: '', consent: true }, o).reason, 'sample required');
  assert.equal(enrollVoice({ account: 'ana', consent: true }, o).reason, 'sample required');
});

test('enrollVoice: consent-native — cannot clone someone else\'s voice', () => {
  const o = O(freshFile());
  const bad = enrollVoice({ account: 'ana', sample: { account: 'bob', ref: 'x' }, consent: true }, o);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /belong/);
  // same account on the sample is fine
  const good = enrollVoice({ account: 'ana', sample: { account: 'ana', ref: 'x' }, consent: true }, o);
  assert.equal(good.ok, true);
});

test('enrollVoice: success returns a voiceProfileId + persists the profile', () => {
  const o = O(freshFile());
  const r = enrollVoice({ account: 'Hathor', sample: 'audio-ref', consent: true }, o);
  assert.equal(r.ok, true);
  assert.equal(r.account, 'hathor');
  assert.match(r.voiceProfileId, /^vp_hathor_[0-9a-f]{12}$/);
  const p = getProfile(r.voiceProfileId, o);
  assert.equal(p.account, 'hathor');
  assert.equal(p.consent, true);
  assert.equal(p.voiceProfile.account, 'hathor');
});

test('revokeVoice: removes the profile', () => {
  const o = O(freshFile());
  const r = enrollVoice({ account: 'ana', sample: 's', consent: true }, o);
  assert.equal(revokeVoice(r.voiceProfileId, o).removed, true);
  assert.equal(getProfile(r.voiceProfileId, o), null);
  assert.equal(revokeVoice(r.voiceProfileId, o).removed, false); // idempotent
});

// ── single utterance pipeline ────────────────────────────────────────────────────────────────────────
test('translateUtterance: STT → MT → TTS in the speaker voice', async () => {
  const o = O(freshFile());
  wireAll();
  const en = enrollVoice({ account: 'ana', sample: 'ana-voice', consent: true }, o);
  const r = await translateUtterance({ audio: 'bytes', speakerProfileId: en.voiceProfileId, fromLang: 'en', listenerLang: 'es' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'hello there');
  assert.equal(r.translatedText, '[es] hello there');
  assert.equal(r.fromLang, 'en');
  assert.equal(r.toLang, 'es');
  assert.equal(r.audio.lang, 'es');
  assert.equal(r.audio.voice, 'ana'); // speaker's cloned voice carried through
  __resetProviders();
});

test('translateUtterance: same language → MT passthrough, still voiced', async () => {
  const o = O(freshFile());
  wireAll();
  const en = enrollVoice({ account: 'ana', sample: 's', consent: true }, o);
  const r = await translateUtterance({ audio: 'b', speakerProfileId: en.voiceProfileId, fromLang: 'en', listenerLang: 'en' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.translatedText, 'hello there'); // no MT tag — passed through
  assert.equal(r.audio.voice, 'ana');
  __resetProviders();
});

test('translateUtterance: unknown speaker profile soft-fails', async () => {
  const o = O(freshFile());
  wireAll();
  const r = await translateUtterance({ audio: 'b', speakerProfileId: 'vp_nope', listenerLang: 'es' }, o);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'profile');
  __resetProviders();
});

test('translateUtterance: STT-detected language used when fromLang omitted', async () => {
  const o = O(freshFile());
  __setSTT(mockSTT('hola', 'es')); __setMT(mockMT()); __setTTS(mockTTS());
  const en = enrollVoice({ account: 'ana', sample: 's', consent: true }, o);
  const r = await translateUtterance({ audio: 'b', speakerProfileId: en.voiceProfileId, listenerLang: 'en' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.fromLang, 'es');
  assert.equal(r.translatedText, '[en] hola');
  __resetProviders();
});

// ── fan-out: one utterance → N listeners, N languages, one voice ──────────────────────────────────────
test('fanOut: 3 listeners in 3 languages, all in the speaker voice', async () => {
  const o = O(freshFile());
  wireAll();
  const en = enrollVoice({ account: 'hathor', sample: 'h', consent: true }, o);
  const r = await fanOut({
    audio: 'utterance', speakerProfileId: en.voiceProfileId, fromLang: 'en',
    listeners: [{ account: 'ana', lang: 'es' }, { account: 'yusuf', lang: 'tr' }, { account: 'li', lang: 'zh' }],
  }, o);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'hello there');
  assert.equal(r.outputs.length, 3);
  const byAcct = Object.fromEntries(r.outputs.map((x) => [x.account, x]));
  assert.equal(byAcct.ana.translatedText, '[es] hello there');
  assert.equal(byAcct.yusuf.translatedText, '[tr] hello there');
  assert.equal(byAcct.li.translatedText, '[zh] hello there');
  // every output carries the SPEAKER'S voice
  for (const out of r.outputs) { assert.equal(out.ok, true); assert.equal(out.audio.voice, 'hathor'); }
  __resetProviders();
});

test('fanOut: de-dupes shared listener languages (MT/TTS run once per language)', async () => {
  const o = O(freshFile());
  let mtCalls = 0, ttsCalls = 0;
  __setSTT(mockSTT());
  __setMT(async ({ text, to }) => { mtCalls++; return `[${to}] ${text}`; });
  __setTTS(async ({ text, lang, voiceProfile }) => { ttsCalls++; return { lang, voice: voiceProfile.account }; });
  const en = enrollVoice({ account: 'hathor', sample: 'h', consent: true }, o);
  const r = await fanOut({
    audio: 'u', speakerProfileId: en.voiceProfileId, fromLang: 'en',
    listeners: [{ account: 'a', lang: 'es' }, { account: 'b', lang: 'es' }, { account: 'c', lang: 'fr' }],
  }, o);
  assert.equal(r.ok, true);
  assert.equal(r.outputs.length, 3);
  assert.equal(mtCalls, 2); // es + fr, not 3
  assert.equal(ttsCalls, 2);
  __resetProviders();
});

test('fanOut: per-listener soft-fail — bad listener lang does not sink the batch', async () => {
  const o = O(freshFile());
  wireAll();
  const en = enrollVoice({ account: 'hathor', sample: 'h', consent: true }, o);
  const r = await fanOut({
    audio: 'u', speakerProfileId: en.voiceProfileId, fromLang: 'en',
    listeners: [{ account: 'ana', lang: 'es' }, { account: 'bad', lang: '???' }],
  }, o);
  assert.equal(r.ok, true);
  const byAcct = Object.fromEntries(r.outputs.map((x) => [x.account, x]));
  assert.equal(byAcct.ana.ok, true);
  assert.equal(byAcct.bad.ok, false);
  assert.match(byAcct.bad.reason, /language/);
  __resetProviders();
});

// ── unconfigured soft-fail (the default providers) ────────────────────────────────────────────────────
test('unconfigured: pipeline soft-fails at STT with reason unconfigured', async () => {
  const o = O(freshFile());
  __resetProviders(); // all three default to unconfigured
  const en = enrollVoice({ account: 'ana', sample: 's', consent: true }, o);
  const r = await translateUtterance({ audio: 'b', speakerProfileId: en.voiceProfileId, listenerLang: 'es' }, o);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'stt');
  assert.equal(r.reason, 'unconfigured');
});

test('unconfigured: MT unconfigured soft-fails at MT stage (STT/TTS mocked)', async () => {
  const o = O(freshFile());
  __setSTT(mockSTT()); __setMT(null); __setTTS(mockTTS()); // __setMT(null) → back to unconfigured default
  const en = enrollVoice({ account: 'ana', sample: 's', consent: true }, o);
  const r = await translateUtterance({ audio: 'b', speakerProfileId: en.voiceProfileId, fromLang: 'en', listenerLang: 'es' }, o);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'mt');
  assert.equal(r.reason, 'unconfigured');
  assert.equal(r.text, 'hello there'); // STT result still surfaced for graceful text fallback
  __resetProviders();
});

test('unconfigured: TTS unconfigured soft-fails at TTS stage but returns the translated text', async () => {
  const o = O(freshFile());
  __setSTT(mockSTT()); __setMT(mockMT()); __setTTS(null);
  const en = enrollVoice({ account: 'ana', sample: 's', consent: true }, o);
  const r = await translateUtterance({ audio: 'b', speakerProfileId: en.voiceProfileId, fromLang: 'en', listenerLang: 'es' }, o);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'tts');
  assert.equal(r.translatedText, '[es] hello there'); // text pipeline succeeded; only the voice stage failed
  __resetProviders();
});

test('provider that throws is caught (never throws out)', async () => {
  const o = O(freshFile());
  __setSTT(async () => { throw new Error('boom'); }); __setMT(mockMT()); __setTTS(mockTTS());
  const en = enrollVoice({ account: 'ana', sample: 's', consent: true }, o);
  const r = await translateUtterance({ audio: 'b', speakerProfileId: en.voiceProfileId, listenerLang: 'es' }, o);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'stt');
  assert.equal(r.reason, 'stt-error');
  __resetProviders();
});

test('normLang guard', () => {
  assert.equal(normLang('EN'), 'en');
  assert.equal(normLang('pt-BR'), 'pt-br');
  assert.equal(normLang('???'), '');
  assert.equal(normLang(''), '');
});
