import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all, byKind, freeOnly, selfHost, recommend, summary, handler, HEARING_APIS } from './hearing-apis.mjs';

test('catalog has STT + TTS + self-host + cloud entries', () => {
  assert.ok(all().length >= 12);
  assert.ok(HEARING_APIS.some((a) => a.kind === 'STT'));
  assert.ok(HEARING_APIS.some((a) => a.kind === 'TTS' || a.kind === 'both'));
  assert.ok(selfHost().length >= 3);
});

test('byKind includes both-kind providers for a specific kind', () => {
  const stt = byKind('STT');
  assert.ok(stt.every((a) => a.kind === 'STT' || a.kind === 'both'));
});

test('freeOnly returns providers with a free tier', () => {
  assert.ok(freeOnly().length > 0);
  assert.ok(freeOnly().some((a) => a.name === 'Groq Whisper'));
});

test('recommend(transcripts) leads with a key we already hold', () => {
  const r = recommend('transcripts');
  assert.equal(r.now.name, 'Groq Whisper');
  assert.equal(r.ours.hosting, 'self-host');
  assert.ok(r.streaming.name); // a streaming pick for live audio
});

test('recommend(voice) leads with an expressive TTS', () => {
  const r = recommend('voice');
  assert.match(r.now.name, /ElevenLabs/);
  assert.equal(r.ours.name, 'Coqui XTTS');
});

test('summary counts are coherent', () => {
  const s = summary();
  assert.equal(s.total, HEARING_APIS.length);
  assert.ok(s.stt > 0 && s.tts > 0 && s.free > 0 && s.selfHost > 0);
  assert.ok(s.keysWeHold.includes('Groq Whisper'));
});

test('handler returns the catalog JSON', () => {
  let body = '';
  const res = { writeHead() {}, end(b) { body = b; } };
  handler({ url: '/api/hearing' }, res);
  const j = JSON.parse(body);
  assert.ok(Array.isArray(j.apis));
  assert.ok(j.recommend.transcripts.now);
});
