// site/hathor-live/sessions.test.mjs — the catalogue's own coherence tests.
//
// The load-bearing one is `evidenceAudit` over the shipped SESSIONS: it fails the build if anyone
// ever adds a 40Hz binaural session and grades it off the GENUS evidence. That evidence is about
// amplitude-modulated click trains and light flicker; it does not transfer.
//
// Offline, no I/O, no network.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSIONS, AUDIO_MODES, BINAURAL_BEAT_RATE_CEILING_HZ, BINAURAL_CARRIER_CEILING_HZ,
  audioMode, energyAtBeatRate, needsHeadphones, beatPerception, evidenceAudit, audioModeNote,
  photicRisk, peakHz,
} from './sessions.mjs';

test('every shipped session declares an audio mode the catalogue knows', () => {
  for (const s of SESSIONS) {
    assert.ok(AUDIO_MODES[audioMode(s)], `${s.id} has an unknown audio mode`);
    assert.equal(typeof s.audio, 'string', `${s.id} must declare audio explicitly, not rely on the fallback`);
  }
});

test('the shipped catalogue passes its own evidence audit', () => {
  assert.deepEqual(evidenceAudit(), []);
});

test('a 40Hz binaural session may not inherit the GENUS grade', () => {
  // This is the exact defect the schema previously could not express: `method` alone cannot tell a
  // 40Hz AM click train from a 40Hz binaural beat, so the second silently borrowed the first's grade.
  const impostor = {
    id: 'genus-40-binaural', grade: 'strong', method: 'auditory', audio: 'binaural',
    carrier: 440, program: [{ hz: 40, secs: 3600 }],
  };
  const problems = evidenceAudit([impostor]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].problem, /binaural beat past a perceptual ceiling/);
  assert.match(problems[0].problem, /does not transfer/);
});

test('the same program delivered as AM is fine at 40Hz', () => {
  const genuine = {
    id: 'genus-40-am', grade: 'strong', method: 'auditory', audio: 'am',
    carrier: 440, program: [{ hz: 40, secs: 3600 }],
  };
  assert.deepEqual(evidenceAudit([genuine]), []);
  assert.equal(energyAtBeatRate(genuine), true);
  assert.equal(needsHeadphones(genuine), false);
});

test('beatPerception applies both published ceilings, and only to binaural', () => {
  const past = beatPerception({ audio: 'binaural', carrier: 440, program: [{ hz: 40 }] });
  assert.equal(past.audible, false);
  assert.match(past.reasons[0], new RegExp(`${BINAURAL_BEAT_RATE_CEILING_HZ}Hz beat-rate ceiling`));

  const highCarrier = beatPerception({ audio: 'binaural', carrier: 2000, program: [{ hz: 6 }] });
  assert.equal(highCarrier.audible, false);
  assert.match(highCarrier.reasons[0], new RegExp(String(BINAURAL_CARRIER_CEILING_HZ)));

  const ok = beatPerception({ audio: 'binaural', carrier: 250, program: [{ hz: 6 }] });
  assert.equal(ok.audible, true);
  assert.deepEqual(ok.reasons, []);

  // An AM session is physically delivering the rate, so no perceptual ceiling gates it.
  const am = beatPerception({ audio: 'am', carrier: 440, program: [{ hz: 40 }] });
  assert.equal(am.audible, true);
});

test('the legacy fallback reads method: binaural as binaural, and never upgrades a guess', () => {
  assert.equal(audioMode({ method: 'binaural', program: [] }), 'binaural');
  assert.equal(audioMode({ method: 'flicker', program: [] }), 'none');
  assert.equal(audioMode({ method: 'auditory', program: [] }), 'am');
  assert.equal(audioMode(null), 'none');
  // An explicit declaration always wins over the fallback.
  assert.equal(audioMode({ method: 'binaural', audio: 'am', program: [] }), 'am');
});

test('the only binaural session in the catalogue is the one the trials actually used', () => {
  const binaural = SESSIONS.filter((s) => audioMode(s) === 'binaural');
  assert.deepEqual(binaural.map((s) => s.id), ['periprocedural']);
  // 6Hz, 250Hz carrier — both well inside the ceilings, which is why the perioperative RCT
  // literature it cites is about a stimulus its listeners could actually perceive.
  const b = beatPerception(binaural[0]);
  assert.equal(b.audible, true);
  assert.equal(needsHeadphones(binaural[0]), true);
});

test('audioModeNote tells the person, not just the schema', () => {
  const note = audioModeNote({ audio: 'binaural', carrier: 440, program: [{ hz: 40 }] });
  assert.match(note, /no beat to hear/);
  assert.match(audioModeNote({ audio: 'am', carrier: 440, program: [{ hz: 40 }] }), /physically in the sound/);
});

// --- the photic band, reported not changed -------------------------------------------------------
// This test DOCUMENTS current behaviour rather than asserting it is right. sessions.mjs cites the
// IFCM eye-closure range as 8-40Hz while PHOTIC_HIGH_RISK is 13-26, so several eyes-closed alpha
// sessions return 'standard'. Widening the band gates content, which is the operator's call. If the
// operator widens it, this test is the one to update — deliberately, with the change.
test('photicRisk currently flags only 13-26Hz (recorded, not endorsed)', () => {
  const standardAt = ['dreamachine', 'chamber-alpha', 'alpha-10-pain', 'genus-40']
    .map((id) => SESSIONS.find((s) => s.id === id))
    .filter(Boolean);
  assert.equal(standardAt.length, 4);
  for (const s of standardAt) {
    assert.equal(photicRisk(s), 'standard', `${s.id} (${peakHz(s)}Hz) — see the OPEN QUESTION note in sessions.mjs`);
  }
  assert.equal(photicRisk(SESSIONS.find((s) => s.id === 'smr-14')), 'none', 'smr-14 is audio-only by default');
});
