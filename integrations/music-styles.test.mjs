import { test } from 'node:test';
import assert from 'node:assert';
import { styleFor, dropPrompt, dropLyricSkeleton, STYLES, DROP_SHAPE, WOBBLE_SOUND, LYRIC_DROP_MARKERS } from './music-styles.mjs';

test('every style names a tempo and carries the drop shape where a drop belongs', () => {
  for (const [id, s] of Object.entries(STYLES)) {
    assert.ok(s.bpm >= 60 && s.bpm <= 200, id);
    assert.match(s.prompt, /bpm/, id);
    assert.match(s.prompt, /build|drop/, id);
  }
});

test('the drop shape describes tension, the gap, and a half-time landing — the parts engines miss', () => {
  assert.match(DROP_SHAPE, /riser/);
  assert.match(DROP_SHAPE, /snare roll accelerating/);
  assert.match(DROP_SHAPE, /sub-bass dropping out/);
  assert.match(DROP_SHAPE, /near silence/);           // no gap, no drop
  assert.match(DROP_SHAPE, /half-time/);
  assert.match(WOBBLE_SOUND, /sine sub under 60 Hz/); // the weight
  assert.match(WOBBLE_SOUND, /LFO on the filter cutoff/);
});

test('styleFor returns a usable prompt, and an unknown style returns nothing rather than junk', () => {
  assert.match(styleFor('dubstep'), /^dubstep, 140 bpm/);
  assert.match(styleFor('gospel-dubstep', 'in the key of F'), /in the key of F$/);
  assert.equal(styleFor('nope'), '');
  assert.equal(styleFor(), '');
});

test('any genre can be given the drop shape, with the tempo kept sane', () => {
  assert.match(dropPrompt('ancient temple music', { bpm: 128 }), /^ancient temple music, 128 bpm/);
  assert.match(dropPrompt('x', { bpm: 9000 }), /200 bpm/);
  assert.match(dropPrompt('x', { bpm: 'nonsense' }), /140 bpm/);
});

test('the lyric skeleton puts the form where the engine reads it', () => {
  const sk = dropLyricSkeleton({ verse: 'a line', build: 'rising', drop: 'now' });
  assert.match(sk, /\[intro\]/);
  assert.match(sk, /\[build\]/);
  assert.match(sk, /\[drop\]/);
  assert.ok(LYRIC_DROP_MARKERS.includes('[drop]'));
});
