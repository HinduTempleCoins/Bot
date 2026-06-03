import { test } from 'node:test';
import assert from 'node:assert';
import {
  pickVoice, chunkForTts, transcribe, speak,
  VOICES, DEFAULT_VOICE,
} from './voice-tier.mjs';

// ---- PURE: pickVoice ----------------------------------------------------------------

test('pickVoice: empty prefs → default voice', () => {
  assert.equal(pickVoice(), DEFAULT_VOICE.id);
  assert.equal(pickVoice({}), DEFAULT_VOICE.id);
});

test('pickVoice: exact voice id and short name both resolve', () => {
  assert.equal(pickVoice({ voice: 'en_US-ryan' }), 'en_US-ryan');
  assert.equal(pickVoice({ name: 'amy' }), 'en_US-amy');
  assert.equal(pickVoice({ voice: 'RYAN' }), 'en_US-ryan'); // case-insensitive
});

test('pickVoice: exact locale match', () => {
  assert.equal(pickVoice({ locale: 'en-US' }), VOICES.find((v) => v.locale === 'en-US').id);
  assert.equal(pickVoice({ locale: 'fr-FR' }), 'fr_FR-siwis');
});

test('pickVoice: lang + gender best fit', () => {
  assert.equal(pickVoice({ lang: 'en', gender: 'm' }), VOICES.find((v) => v.lang === 'en' && v.gender === 'm').id);
  assert.equal(pickVoice({ lang: 'en', gender: 'female' }), VOICES.find((v) => v.lang === 'en' && v.gender === 'f').id);
});

test('pickVoice: lang alone picks first in that language', () => {
  assert.equal(pickVoice({ lang: 'es' }), 'es_ES-davefx');
});

test('pickVoice: unknown prefs fall back to default, never throws', () => {
  assert.equal(pickVoice({ lang: 'xx', voice: 'nope' }), DEFAULT_VOICE.id);
  assert.equal(pickVoice({ gender: 'm' }), DEFAULT_VOICE.id); // no lang → no match path → default
});

// ---- PURE: chunkForTts --------------------------------------------------------------

test('chunkForTts: empty / nullish → []', () => {
  assert.deepEqual(chunkForTts(''), []);
  assert.deepEqual(chunkForTts('   '), []);
  assert.deepEqual(chunkForTts(null), []);
  assert.deepEqual(chunkForTts(undefined), []);
});

test('chunkForTts: short text → single chunk', () => {
  const out = chunkForTts('Hello there.', 280);
  assert.deepEqual(out, ['Hello there.']);
});

test('chunkForTts: splits on sentence boundaries and respects maxLen', () => {
  const text = 'First sentence here. Second sentence here. Third one now! And a fourth?';
  const out = chunkForTts(text, 40);
  assert.ok(out.length > 1, 'should split into multiple chunks');
  for (const c of out) assert.ok(c.length <= 40, `chunk within limit: "${c}"`);
  // round-trip: concatenated words preserved
  assert.equal(out.join(' ').replace(/\s+/g, ' '), text);
});

test('chunkForTts: keeps terminating punctuation with the sentence', () => {
  const out = chunkForTts('One. Two. Three.', 8);
  assert.ok(out.every((c) => /[.!?…]$/.test(c)), 'each chunk ends with sentence punctuation');
});

test('chunkForTts: a single over-long sentence is hard-split on whitespace', () => {
  const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
  const out = chunkForTts(long, 15);
  assert.ok(out.length > 1);
  for (const c of out) assert.ok(c.length <= 15, `within limit: "${c}"`);
});

test('chunkForTts: a single word longer than the limit is sliced', () => {
  const out = chunkForTts('supercalifragilisticexpialidocious', 10);
  assert.ok(out.length > 1);
  for (const c of out) assert.ok(c.length <= 10);
  assert.equal(out.join(''), 'supercalifragilisticexpialidocious');
});

// ---- transcribe: normalize injected responses + soft-fail ---------------------------

test('transcribe: soft-fails without an endpoint (never throws)', async () => {
  const r = await transcribe({ audioRef: 'sample.wav' });
  assert.equal(r.ok, false);
  assert.equal(r.text, '');
  assert.equal(r.reason, 'whisper-not-configured');
});

test('transcribe: missing audioRef soft-fails', async () => {
  const r = await transcribe({});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-audio-ref');
});

test('transcribe: normalizes injected client object response', async () => {
  const client = async (ref) => ({ text: '  hello world  ', language: 'en', segments: [{ t: ref }] });
  const r = await transcribe({ audioRef: 'a.wav', client });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'hello world');
  assert.equal(r.language, 'en');
  assert.equal(r.segments.length, 1);
});

test('transcribe: normalizes injected client string response', async () => {
  const r = await transcribe({ audioRef: 'a.wav', client: async () => 'just text' });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'just text');
});

test('transcribe: empty injected response soft-fails', async () => {
  const r = await transcribe({ audioRef: 'a.wav', client: async () => ({ text: '' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-text');
});

test('transcribe: throwing client is caught (soft-fail)', async () => {
  const r = await transcribe({ audioRef: 'a.wav', client: async () => { throw new Error('boom'); } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /client-error/);
});

// ---- speak: normalize injected responses + soft-fail --------------------------------

test('speak: soft-fails without an endpoint (never throws), still resolves a voice', async () => {
  const r = await speak({ text: 'hi', voice: 'amy' });
  assert.equal(r.ok, false);
  assert.equal(r.audioRef, null);
  assert.equal(r.reason, 'piper-not-configured');
  assert.equal(r.voice, 'en_US-amy');
});

test('speak: empty text soft-fails', async () => {
  const r = await speak({ text: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-text');
});

test('speak: normalizes injected client object response (url)', async () => {
  const client = async (text, { voice }) => ({ url: 'https://x/out.wav', voice, mime: 'audio/wav' });
  const r = await speak({ text: 'speak this', voice: { lang: 'en' }, client });
  assert.equal(r.ok, true);
  assert.equal(r.audioRef, 'https://x/out.wav');
  assert.equal(r.kind, 'url');
  assert.equal(r.mime, 'audio/wav');
});

test('speak: normalizes injected client string response', async () => {
  const r = await speak({ text: 'hi', client: async () => '/tmp/out.wav' });
  assert.equal(r.ok, true);
  assert.equal(r.audioRef, '/tmp/out.wav');
  assert.equal(r.kind, 'url'); // string passthrough defaults to url kind
});

test('speak: response with no audio soft-fails', async () => {
  const r = await speak({ text: 'hi', client: async () => ({ status: 'done' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-audio');
});

test('speak: throwing client is caught (soft-fail)', async () => {
  const r = await speak({ text: 'hi', client: async () => { throw new Error('nope'); } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /client-error/);
});
