// site/hathor-live/metronome.test.mjs — offline. No network, no DOM, no AudioContext.
//
// The tests that matter are the honesty gates: a metronome is easy to build and easy to build
// dishonestly, and the dishonest version is the one that prints a signed millisecond number.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METRONOME_PAGE, SCHEDULER, TEMPO, RATE_LIMITS, CLICKS, CALIBRATION, BIMODAL_INPUT_PLATFORMS,
  bpmToIoi, ioiToBpm, clampBpm, scheduleWindow, polyrhythm, lcm,
  tapTempo, median, detectInputFloor,
  mayReportSignedAsynchrony, latencyReport, visualBeatPolicy, stackWithEntrainment, esc,
} from './metronome.mjs';

test('esc escapes every dangerous character', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('bpm <-> ioi round trips, and rejects nonsense without throwing', () => {
  assert.equal(bpmToIoi(120), 0.5);
  assert.equal(ioiToBpm(0.5), 120);
  assert.equal(bpmToIoi(0), null);
  assert.equal(bpmToIoi(-4), null);
  assert.equal(bpmToIoi('nope'), null);
  assert.equal(ioiToBpm(0), null);
});

test('clampBpm keeps tempo in range and never returns NaN', () => {
  assert.equal(clampBpm(1), TEMPO.minBpm);
  assert.equal(clampBpm(10000), TEMPO.maxBpm);
  assert.equal(clampBpm('x'), TEMPO.defaultBpm);
  assert.equal(clampBpm(NaN), TEMPO.defaultBpm);
  assert.equal(clampBpm(120), 120);
});

// ── The scheduler ─────────────────────────────────────────────────────────────────────────────────

test('scheduleWindow emits exactly the notes inside the look-ahead horizon', () => {
  // 120 BPM = 0.5 s per beat. A 1.2 s horizon from t=0 holds notes at 0, .5, 1.0 => 3 notes.
  const r = scheduleWindow({ currentTime: 0, nextNoteTime: 0, nextNoteIndex: 0, bpm: 120, scheduleAhead: 1.2 });
  assert.equal(r.notes.length, 3);
  assert.deepEqual(r.notes.map((n) => n.time), [0, 0.5, 1]);
  assert.equal(r.nextNoteIndex, 3);
  assert.equal(r.nextNoteTime, 1.5);
});

test('scheduleWindow is resumable: two calls equal one long call', () => {
  const long = scheduleWindow({ currentTime: 0, nextNoteTime: 0, nextNoteIndex: 0, bpm: 120, scheduleAhead: 2.1 });
  const a = scheduleWindow({ currentTime: 0, nextNoteTime: 0, nextNoteIndex: 0, bpm: 120, scheduleAhead: 1.2 });
  const b = scheduleWindow({
    currentTime: 0, nextNoteTime: a.nextNoteTime, nextNoteIndex: a.nextNoteIndex, bpm: 120, scheduleAhead: 2.1,
  });
  assert.deepEqual([...a.notes, ...b.notes].map((n) => n.index), long.notes.map((n) => n.index));
});

test('scheduleWindow marks downbeats and subdivisions correctly', () => {
  const r = scheduleWindow({
    currentTime: 0, nextNoteTime: 0, nextNoteIndex: 0, bpm: 120, beatsPerBar: 4, subdivision: 2, scheduleAhead: 2.1,
  });
  // 8 notes per bar at subdivision 2; 0.25 s apart.
  assert.equal(r.notes.length, 9);
  assert.equal(r.notes[0].isDownbeat, true);
  assert.equal(r.notes[1].isBeat, false);   // the "and" of one
  assert.equal(r.notes[2].isBeat, true);    // beat two
  assert.equal(r.notes[2].isDownbeat, false);
  assert.equal(r.notes[8].isDownbeat, true); // bar two
  assert.equal(r.notes[8].bar, 1);
});

test('accent is by gain, and the downbeat is the loudest', () => {
  const r = scheduleWindow({
    currentTime: 0, nextNoteTime: 0, nextNoteIndex: 0, bpm: 120, beatsPerBar: 4, subdivision: 2, scheduleAhead: 1.1,
  });
  assert.ok(r.notes[0].gain > r.notes[2].gain);
  assert.ok(r.notes[2].gain > r.notes[1].gain);
});

test('scheduleWindow soft-fails on a broken clock instead of throwing or spinning', () => {
  const r = scheduleWindow({ currentTime: NaN, nextNoteTime: 0, nextNoteIndex: 0, bpm: 120 });
  assert.deepEqual(r.notes, []);
  const r2 = scheduleWindow({});
  assert.deepEqual(r2.notes, []);
});

test('scheduleWindow respects maxNotes so a runaway horizon cannot hang the page', () => {
  const r = scheduleWindow({
    currentTime: 0, nextNoteTime: 0, nextNoteIndex: 0, bpm: 300, scheduleAhead: 1000, maxNotes: 10,
  });
  assert.equal(r.notes.length, 10);
});

// ── Polyrhythm ────────────────────────────────────────────────────────────────────────────────────

test('lcm', () => {
  assert.equal(lcm(3, 2), 6);
  assert.equal(lcm(4, 3), 12);
  assert.equal(lcm(4, 2), 4);
});

test('polyrhythm 3:2 lands both voices on the downbeat and nowhere else', () => {
  const p = polyrhythm(3, 2, 6);
  assert.equal(p.grid, 6);
  assert.equal(p.events.length, 4);            // steps 0, 2, 3, 4
  assert.equal(p.events[0].both, true);
  assert.equal(p.events.filter((e) => e.both).length, 1);
  assert.deepEqual(p.events.map((e) => e.step), [0, 2, 3, 4]);
});

test('polyrhythm soft-fails on a bad cycle length', () => {
  assert.deepEqual(polyrhythm(3, 2, 0).events, []);
  assert.deepEqual(polyrhythm(3, 2, 'x').events, []);
});

// ── Tap tempo ─────────────────────────────────────────────────────────────────────────────────────

test('median handles even, odd and empty', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(median(null), 0);
});

test('tapTempo recovers a clean tempo', () => {
  const stamps = [0, 500, 1000, 1500, 2000, 2500];
  const r = tapTempo(stamps);
  assert.equal(r.ok, true);
  assert.equal(r.bpm, 120);
  assert.equal(r.floorSuspect, false);
});

test('tapTempo uses a median, so one wild tap does not move the tempo', () => {
  const clean = tapTempo([0, 500, 1000, 1500, 2000, 2500]).bpm;
  const dirty = tapTempo([0, 500, 1000, 1180, 1500, 2000, 2500]).bpm;
  assert.ok(Math.abs(clean - dirty) < 12, `median should absorb one bad tap: ${clean} vs ${dirty}`);
});

test('tapTempo resets the window when the user stops and starts again', () => {
  const r = tapTempo([0, 500, 1000, 1500, 9000, 9400, 9800, 10200, 10600]);
  assert.equal(r.ok, true);
  assert.ok(r.resets >= 1);
  assert.ok(Math.abs(r.bpm - 150) < 5, `should follow the new tempo, got ${r.bpm}`);
});

test('tapTempo needs two taps and says so rather than throwing', () => {
  const r = tapTempo([100]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /at least two/i);
  assert.equal(tapTempo(null).ok, false);
  assert.equal(tapTempo('nope').ok, false);
});

test('tapTempo rejects non-increasing timestamps without throwing', () => {
  const r = tapTempo([1000, 900, 800]);
  assert.equal(r.ok, false);
});

test('detectInputFloor catches a hardware-limited run and clears a human one', () => {
  // Every interval pinned at ~16.7 ms: that is a frame period, not a finger.
  const pinned = Array.from({ length: 20 }, () => 16.7);
  assert.equal(detectInputFloor(pinned), true);
  // A human fast run has spread.
  const human = [180, 205, 192, 210, 188, 199, 215, 195];
  assert.equal(detectInputFloor(human), false);
  // Too few intervals to judge.
  assert.equal(detectInputFloor([16.7, 16.7]), false);
});

test('tapTempo flags a floored run in its reason string', () => {
  const stamps = [0];
  for (let i = 1; i < 25; i += 1) stamps.push(stamps[i - 1] + 16.7);
  const r = tapTempo(stamps);
  assert.equal(r.floorSuspect, true);
  assert.match(r.reason, /device, not your finger/i);
});

// ── The honesty gates. These are the point of the module. ─────────────────────────────────────────

test('an uncalibrated page may NOT print a signed asynchrony', () => {
  const r = mayReportSignedAsynchrony({});
  assert.equal(r.ok, false);
  assert.match(r.reason, /device, not the person/i);
});

test('a paired-condition design still may not print an ABSOLUTE signed value', () => {
  const r = mayReportSignedAsynchrony({ calibration: 'paired' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /cancels in the DIFFERENCE/i);
});

test('loopback calibration unlocks it, with a 2 ms accuracy', () => {
  const r = mayReportSignedAsynchrony({ calibration: 'loopback' });
  assert.equal(r.ok, true);
  assert.equal(r.accuracyMs, 2);
});

test('estimated calibration is refused on the platforms with bimodal input latency', () => {
  for (const p of BIMODAL_INPUT_PLATFORMS) {
    const r = mayReportSignedAsynchrony({ calibration: 'estimated', platform: p });
    assert.equal(r.ok, false, `${p} should be refused`);
    assert.match(r.reason, /bimodal/i);
  }
  const ok = mayReportSignedAsynchrony({ calibration: 'estimated', platform: 'windows-chrome' });
  assert.equal(ok.ok, true);
  assert.equal(ok.accuracyMs, 20);
});

test('an unknown calibration id falls back to "none" rather than passing', () => {
  const r = mayReportSignedAsynchrony({ calibration: 'definitely-calibrated-trust-me' });
  assert.equal(r.ok, false);
});

test('latencyReport never throws and always says input latency is unknown', () => {
  const a = latencyReport({ baseLatency: 0.01, outputLatency: 0.02, outputClass: 'wired' });
  assert.equal(a.baseLatencyMs, 10);
  assert.equal(a.outputLatencyMs, 20);
  assert.equal(a.totalOutputMs, 30);
  assert.equal(a.inputLatencyKnown, false);

  const b = latencyReport({});
  assert.equal(b.baseLatencyMs, null);
  assert.equal(b.outputLatencyMs, null);
  assert.equal(b.totalOutputMs, null);
  assert.ok(b.lines.some((l) => /not reported/i.test(l)));

  const bt = latencyReport({ outputClass: 'bluetooth' });
  assert.ok(bt.lines.some((l) => /100-300 ms/.test(l)));
});

// ── Visual policy ─────────────────────────────────────────────────────────────────────────────────

test('the visual beat degrades to per-bar, then off, and never goes full-field', () => {
  assert.equal(visualBeatPolicy(90).mode, 'beat');
  assert.equal(visualBeatPolicy(150).mode, 'bar');
  assert.equal(visualBeatPolicy(200).mode, 'off');
  for (const bpm of [40, 90, 150, 200, 300]) {
    assert.equal(visualBeatPolicy(bpm).fullField, false);
  }
});

test('the visual pulse never exceeds 3 Hz', () => {
  for (let bpm = TEMPO.minBpm; bpm <= TEMPO.maxBpm; bpm += 1) {
    assert.ok(visualBeatPolicy(bpm).pulseHz <= 3.0001, `${bpm} BPM pulsed at ${visualBeatPolicy(bpm).pulseHz} Hz`);
  }
});

test('the visual beat declares itself unreliable below the 460 ms synchronisation floor', () => {
  const slow = visualBeatPolicy(100);           // 600 ms IOI
  const fast = visualBeatPolicy(140);           // ~429 ms IOI
  assert.equal(slow.reliableAsTiming, true);
  assert.equal(fast.reliableAsTiming, false);
  assert.match(fast.note, /four times the limit/i);
  assert.equal(RATE_LIMITS.visualFloorMs, 460);
});

// ── /40hz stacking ────────────────────────────────────────────────────────────────────────────────

test('a metronome will not silently stack under an entrainment carrier', () => {
  assert.equal(stackWithEntrainment({}).ok, true);
  const refused = stackWithEntrainment({ carrierHz: 40 });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /no literature/i);
  const acked = stackWithEntrainment({ carrierHz: 40, acknowledged: true });
  assert.equal(acked.ok, true);
  assert.match(acked.reason, /untested/i);
});

// ── The page ──────────────────────────────────────────────────────────────────────────────────────

test('the page is a complete document with the metronome controls', () => {
  assert.match(METRONOME_PAGE, /^<!doctype html>/);
  assert.match(METRONOME_PAGE, /<title>Metronome — hathor\.live<\/title>/);
  for (const id of ['id="play"', 'id="tap"', 'id="bpm"', 'id="dot"', 'id="latency"']) {
    assert.ok(METRONOME_PAGE.includes(id), `missing ${id}`);
  }
});

test('the page never CALLS setInterval — the whole architecture depends on this', () => {
  // The word appears in the prose ("Never setInterval for a note"), which is fine and deliberate.
  // A CALL is not. This is the one regression that would silently ruin the instrument.
  assert.ok(!/setInterval\s*\(/.test(METRONOME_PAGE), 'setInterval(...) must never be called in the page');
  assert.ok(METRONOME_PAGE.includes('ctx.currentTime + AHEAD'), 'must schedule against the audio clock');
  assert.ok(/osc\.start\(t\)/.test(METRONOME_PAGE), 'notes must start at an explicit audio-clock time');
});

test('the page carries the disclaimer and the honest latency statement', () => {
  assert.match(METRONOME_PAGE, /not a medical device/i);
  assert.match(METRONOME_PAGE, /no browser API reports it/i);
});

test('the default click has a fast attack, and the slow one is labelled as a stimulus', () => {
  assert.ok(CLICKS.woodblock.attackMs <= 5);
  assert.ok(CLICKS.blip.attackMs <= 5);
  assert.equal(CLICKS.soft.role, 'stimulus');
  assert.match(CLICKS.soft.note, /P-centre|not a comfort option/i);
});

test('the scheduler constants match the published recommendation', () => {
  assert.equal(SCHEDULER.lookaheadMs, 25);
  assert.equal(SCHEDULER.scheduleAheadSec, 0.1);
  assert.match(SCHEDULER.why, /100ms of lookahead/);
});

test('every calibration entry declares whether it unlocks a signed value', () => {
  for (const [id, c] of Object.entries(CALIBRATION)) {
    assert.equal(c.id, id);
    assert.equal(typeof c.signedOk, 'boolean');
    assert.ok(c.why.length > 20, `${id} needs a real reason`);
  }
});
