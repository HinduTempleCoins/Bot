// site/hathor-live/exam-thread.test.mjs — offline, no network, no fs.
//
// Two things are being pinned here. The STATISTICS, hand-checked against values worked out by hand
// rather than against whatever the code happened to print. And the REFUSAL: that the result names a
// stimulus and never a spirit, and that a bad repeat statistic is printed rather than softened.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXAM_ID, BLOCKS, GRID_STEPS, RHYTHM_BPM, RHYTHM_SUBDIVISION,
  RHYTHMS, HUES, SETS, SET_IDS, setById, INTENSITY, VALENCE, TIMING_POSTURE,
  REPEAT_ALPHA, patternEvents, buildRun, pearson, blockProfiles, repeatStatistic,
  peakStimulus, scoreSitting, resultCopy, threadPageHTML,
} from './exam-thread.mjs';
import { examById, claimClassOf } from './exams.mjs';
import { mayReportSignedAsynchrony, bpmToIoi, CALIBRATION } from './metronome.mjs';
import { rgbToOklch, hexToRgb } from './colour-space.mjs';
import { claimsCheck, CONSULT } from './the-line.mjs';

// ── the stimulus sets ────────────────────────────────────────────────────────────────────────────

test('sixteen rhythms, all distinct figures on one grid, all starting on the downbeat', () => {
  assert.equal(RHYTHMS.length, 16);
  assert.equal(new Set(RHYTHMS.map((r) => r.mask)).size, 16, 'no two figures may be the same');
  assert.equal(new Set(RHYTHMS.map((r) => r.id)).size, 16);
  for (const r of RHYTHMS) {
    assert.equal(r.mask.length, GRID_STEPS);
    assert.match(r.mask, /^[x.]+$/);
    assert.equal(r.mask[0], 'x', 'every figure starts on the downbeat so they are comparable at the start');
    assert.ok(r.onsets >= 3 && r.onsets <= 8, `${r.id} has ${r.onsets} onsets`);
  }
  // ⭐ Density must not be a giveaway: several figures share an onset count, so telling them apart
  // requires hearing the arrangement.
  const counts = RHYTHMS.map((r) => r.onsets);
  assert.ok(new Set(counts).size < counts.length, 'onset counts must not be unique per figure');
});

test('these are PATTERN variants, not tempo variants — one bpm for the whole set', () => {
  // Each khayt is its own figure. Varying tempo would make this a speed-preference test.
  const run = buildRun({ set: 'rhythm', seed: 's' });
  assert.equal(new Set(run.trials.map((t) => t.bpm)).size, 1);
  assert.equal(run.trials[0].bpm, RHYTHM_BPM);
});

test('sixteen hues, evenly spaced, every one inside the gamut before clipping', () => {
  assert.equal(HUES.length, 16);
  for (const h of HUES) {
    assert.equal(h.inGamut, true, `${h.id} would be clipped, and a clipped swatch is not the colour asked for`);
    // The hex actually round-trips to the hue that was asked for, within rounding.
    const back = rgbToOklch(hexToRgb(h.hex));
    // Signed circular difference in degrees, wrapped into (-180, 180].
    const diff = (((back.H - h.hue + 180) % 360) + 360) % 360 - 180;
    assert.ok(Math.abs(diff) < 2, `${h.id}: asked ${h.hue}°, got ${back.H.toFixed(1)}°`);
  }
  const gaps = HUES.map((h, i) => (i ? h.hue - HUES[i - 1].hue : 22.5));
  assert.ok(gaps.every((g) => Math.abs(g - 22.5) < 1e-9), 'the sample must be even around the circle');
});

test('⛔ no wavelength is printed anywhere — not in the data, not on either page', () => {
  const surfaces = [JSON.stringify(HUES), threadPageHTML({ set: 'colour' }), threadPageHTML({ set: 'rhythm' })].join(' ');
  assert.ok(!/\bnm\b|nanometre|nanometer/i.test(surfaces.replace(/never print a wavelength[\s\S]{0,400}/gi, '')),
    'converting a screen colour to nanometres needs primaries we do not have');
});

// ── the scheduler is REUSED, not rebuilt ─────────────────────────────────────────────────────────

test('patternEvents lays the mask on metronome.mjs’s grid rather than inventing timing', () => {
  const mask = 'x..x..x...x..x..';
  const { onsets, barSec } = patternEvents(mask, { bpm: RHYTHM_BPM });
  assert.deepEqual(onsets.map((o) => o.step), [0, 3, 6, 10, 13]);
  // One bar of 4/4 at 96 bpm = 4 × (60/96) = 2.5 s exactly.
  assert.equal(barSec, 2.5);
  const step = bpmToIoi(RHYTHM_BPM) / RHYTHM_SUBDIVISION; // 0.15625 s
  assert.ok(Math.abs(step - 0.15625) < 1e-12);
  for (const o of onsets) assert.ok(Math.abs(o.time - o.step * step) < 1e-9);
  assert.equal(onsets[0].accent, true, 'the downbeat is accented by pitch and level, never by attack');
});

test('patternEvents repeats over bars and refuses a mask that is not the grid length', () => {
  const two = patternEvents('x...x...x...x...', { bpm: RHYTHM_BPM, bars: 2 });
  assert.equal(two.onsets.length, 8);
  assert.equal(two.onsets[4].time, 2.5, 'the second bar starts exactly one bar in');
  assert.deepEqual(patternEvents('xx', {}).onsets, []);
  assert.deepEqual(patternEvents(null, {}).onsets, []);
});

test('⭐ the exam never needs a signed asynchrony, and its result carries no millisecond', () => {
  assert.equal(TIMING_POSTURE.needsSignedAsynchrony, false);
  // metronome.mjs refuses signed values without calibration, and it is right to. This exam simply
  // never asks: nothing it reports is a sound-to-movement interval.
  assert.equal(mayReportSignedAsynchrony({ calibration: 'none' }).ok, false);
  assert.equal(mayReportSignedAsynchrony({ calibration: 'paired' }).ok, false);
  assert.equal(CALIBRATION.none.signedOk, false);
  const r = scoreSitting({ set: 'rhythm', responses: repeaterResponses(), permutations: 400 });
  const json = JSON.stringify(r);
  assert.ok(!/asynchron/i.test(json));
  assert.ok(!/"ms"|millisecond/i.test(json));
});

// ── the running order ────────────────────────────────────────────────────────────────────────────

test('the run is three complete blocks, each a fresh permutation of the whole set', () => {
  const run = buildRun({ set: 'rhythm', seed: 'abc' });
  assert.equal(run.ok, true);
  assert.equal(run.blocks, BLOCKS);
  assert.equal(run.trials.length, 16 * BLOCKS);
  for (let b = 0; b < BLOCKS; b += 1) {
    const ids = run.trials.filter((t) => t.block === b).map((t) => t.stimulus);
    assert.equal(ids.length, 16);
    assert.deepEqual([...ids].sort(), RHYTHMS.map((r) => r.id).sort(), `block ${b} must be the whole set`);
  }
  const orders = [0, 1, 2].map((b) => run.trials.filter((t) => t.block === b).map((t) => t.stimulus).join(','));
  assert.notEqual(orders[0], orders[1], 'a repeat in the same order would be a memory test');
  assert.notEqual(orders[1], orders[2]);
});

test('the same seed reproduces the run; a different seed does not', () => {
  const a = buildRun({ set: 'colour', seed: 'k' }).trials.map((t) => t.stimulus).join(',');
  const b = buildRun({ set: 'colour', seed: 'k' }).trials.map((t) => t.stimulus).join(',');
  const c = buildRun({ set: 'colour', seed: 'other' }).trials.map((t) => t.stimulus).join(',');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(buildRun({ set: 'nope' }).ok, false);
});

test('the colour run carries hexes and the rhythm run carries masks — never both', () => {
  const col = buildRun({ set: 'colour', seed: 'x' });
  assert.ok(col.trials.every((t) => t.hex && !t.mask));
  const rhy = buildRun({ set: 'rhythm', seed: 'x' });
  assert.ok(rhy.trials.every((t) => t.mask && !t.hex));
});

// ── the statistics, hand-checked ─────────────────────────────────────────────────────────────────

test('pearson against values worked out by hand', () => {
  assert.equal(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1);
  assert.equal(pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1);
  // x = 1..5, y = 2,1,4,3,5. Sxy = 4, Sxx = 10, Syy = 10 → r = 4/10 = 0.8, by hand.
  assert.ok(Math.abs(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]) - 0.8) < 1e-12);
  // A vector with no variance has no correlation, and null is the honest answer rather than 0.
  assert.equal(pearson([3, 3, 3, 3, 3], [1, 2, 3, 4, 5]), null);
  assert.equal(pearson([1, 2], [1, 2]), null, 'two points is not a correlation');
  assert.equal(pearson('nonsense', [1, 2, 3]), null);
});

// A synthetic participant whose profile is real: intensity rises with stimulus index, plus a small
// deterministic wobble that differs by block, so the blocks agree strongly but not perfectly.
function repeaterResponses({ set = 'rhythm', blocks = BLOCKS } = {}) {
  const ids = setById(set).stimuli.map((s) => s.id);
  const out = [];
  for (let b = 0; b < blocks; b += 1) {
    ids.forEach((id, i) => out.push({ block: b, stimulus: id, intensity: i * 5 + ((i + b) % 3), valence: 0 }));
  }
  return out;
}

// And one whose blocks are unrelated: each block is the same set of values in a different, fixed
// permutation, so the marginal distributions are identical and only the AGREEMENT differs.
function nonRepeaterResponses({ set = 'rhythm' } = {}) {
  const ids = setById(set).stimuli.map((s) => s.id);
  const perms = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [7, 2, 14, 5, 0, 11, 3, 15, 8, 1, 12, 6, 9, 4, 13, 10],
    [12, 9, 4, 15, 6, 1, 13, 0, 11, 7, 2, 10, 5, 14, 3, 8],
  ];
  const out = [];
  perms.forEach((p, b) => ids.forEach((id, i) => out.push({ block: b, stimulus: id, intensity: p[i] * 5 })));
  return out;
}

test('a profile that reproduces gets a high mean r and a small permutation p', () => {
  const prof = blockProfiles(repeaterResponses(), { set: 'rhythm' });
  assert.equal(prof.complete.filter(Boolean).length, 3);
  const stat = repeatStatistic(prof.profiles, { permutations: 1000, seed: 'fixed' });
  assert.equal(stat.ok, true);
  assert.equal(stat.pairwise.length, 3, 'three blocks give three pairs');
  assert.ok(stat.meanR > 0.99, `meanR was ${stat.meanR}`);
  assert.ok(stat.p < REPEAT_ALPHA, `p was ${stat.p}`);
  // p can never be exactly zero: the observed arrangement is one of the arrangements.
  assert.ok(stat.p > 0);
  assert.equal(stat.p, 1 / 1001, 'no permutation should beat a near-perfect profile');
});

test('a profile that does not reproduce is reported as not reproducing, with the number shown', () => {
  const prof = blockProfiles(nonRepeaterResponses(), { set: 'rhythm' });
  const stat = repeatStatistic(prof.profiles, { permutations: 1000, seed: 'fixed' });
  assert.equal(stat.ok, true);
  assert.ok(Math.abs(stat.meanR) < 0.4, `meanR was ${stat.meanR}`);
  assert.ok(stat.p > REPEAT_ALPHA, `p was ${stat.p}`);
});

test('the permutation p is deterministic — a reload must not move the number', () => {
  const prof = blockProfiles(repeaterResponses(), { set: 'rhythm' }).profiles;
  const a = repeatStatistic(prof, { permutations: 600, seed: 'same' });
  const b = repeatStatistic(prof, { permutations: 600, seed: 'same' });
  assert.equal(a.p, b.p);
  assert.equal(a.meanR, b.meanR);
});

test('a block with no variation at all is reported, not hidden', () => {
  const ids = RHYTHMS.map((r) => r.id);
  const rows = [];
  ids.forEach((id, i) => rows.push({ block: 0, stimulus: id, intensity: i * 3 }));
  ids.forEach((id) => rows.push({ block: 1, stimulus: id, intensity: 50 }));
  const prof = blockProfiles(rows, { set: 'rhythm', blocks: 2 });
  const stat = repeatStatistic(prof.profiles, { permutations: 300 });
  assert.equal(stat.ok, false);
  assert.match(stat.why, /no variation at all/);
});

test('fewer than two complete blocks gives no statistic and says why', () => {
  const rows = RHYTHMS.map((r, i) => ({ block: 0, stimulus: r.id, intensity: i }));
  const prof = blockProfiles(rows, { set: 'rhythm' });
  const stat = repeatStatistic(prof.profiles, { permutations: 300 });
  assert.equal(stat.ok, false);
  assert.match(stat.why, /Fewer than two complete blocks/);
});

// ── the peak ─────────────────────────────────────────────────────────────────────────────────────

test('a peak is named only when it wins a majority of blocks and is not tied', () => {
  const ids = ['a', 'b', 'c', 'd'];
  // 'd' is top in all three blocks.
  const stable = [[1, 2, 3, 9], [2, 1, 4, 8], [0, 3, 2, 7]];
  const p1 = peakStimulus(stable, ids);
  assert.equal(p1.ok, true);
  assert.equal(p1.id, 'd');
  assert.equal(p1.wonBlocks, 3);
  // Means 1,2,3,9 / 2,1,4,8 / 0,3,2,7 → d mean = 8, hand-checked.
  assert.equal(p1.mean, 8);

  // A wandering peak: highest mean is 'd' but it tops only one block.
  const wander = [[9, 1, 1, 1], [1, 9, 1, 1], [1, 1, 1, 12]];
  const p2 = peakStimulus(wander, ids);
  assert.equal(p2.id, 'd');
  assert.equal(p2.wonBlocks, 1);
  assert.equal(p2.ok, false, 'one block out of three is not "reliably"');

  // A tie at the top is not a peak, and picking the lower index would be a fabrication.
  const tied = peakStimulus([[5, 5, 1, 1], [5, 5, 1, 1]], ids);
  assert.equal(tied.tied, true);
  assert.equal(tied.ok, false);
});

// ── a whole sitting ──────────────────────────────────────────────────────────────────────────────

test('⭐ a repeating sitting names a STIMULUS and explicitly refuses to name anything else', () => {
  const r = scoreSitting({ set: 'rhythm', responses: repeaterResponses(), permutations: 800, seed: 'z' });
  assert.equal(r.ok, true);
  assert.equal(r.repeats, true);
  assert.equal(r.completeBlocks, 3);
  assert.equal(r.answered, 48);
  assert.equal(r.expected, 48);
  assert.equal(r.peak.id, 'r16', 'the synthetic profile rises with index, so the last figure wins');

  const copy = resultCopy(r);
  assert.match(copy.headline, /Your profile repeated/);
  assert.match(copy.peakLine, /r16/);
  assert.match(copy.peakLine, /x\.\.x\.\.xx\.\.x\.\.x\./, 'the figure itself is printed, so "the stimulus" is concrete');
  const prose = copy.lines.join(' ');
  // THE SENTENCE. Not a hedge — a statement about what an instrument can and cannot establish.
  assert.match(prose, /It does not name a spirit, a Thread, a deity, a colour-of-you/);
  assert.match(prose, /the statement would be false/);
  assert.equal(copy.neverSay, 'This is your Thread.');
});

test('⭐ a non-repeating sitting says so plainly and names nothing', () => {
  const r = scoreSitting({ set: 'rhythm', responses: nonRepeaterResponses(), permutations: 800, seed: 'z' });
  assert.equal(r.repeats, false);
  const copy = resultCopy(r);
  assert.match(copy.headline, /did not repeat/);
  assert.match(copy.peakLine, /cannot tell your largest response from noise/);
  // The repeat statistic is STILL printed. Especially when it is bad.
  assert.match(copy.repeatLine, /Mean r = /);
  assert.match(copy.repeatLine, /permutation test/);
  assert.match(copy.repeatLine, /p = /);
  // And no figure is named as a peak.
  const prose = copy.lines.join(' ');
  assert.ok(!/Your largest response was to/.test(prose));
});

test('the colour set scores the same way and the result is still within-person only', () => {
  const r = scoreSitting({ set: 'colour', responses: repeaterResponses({ set: 'colour' }), permutations: 500, seed: 'c' });
  assert.equal(r.ok, true);
  assert.equal(r.set, 'colour');
  assert.equal(r.unit, 'hue');
  assert.match(resultCopy(r).peakLine, /hue 337\.5°/);
  const prose = resultCopy(r).lines.join(' ');
  assert.match(prose, /Everything here is you against you/);
  assert.match(prose, /would be meaningless/);
});

test('valence is summarised, never used to name anything', () => {
  const rows = repeaterResponses();
  for (const row of rows) row.valence = 20;
  const r = scoreSitting({ set: 'rhythm', responses: rows, permutations: 300 });
  assert.ok(r.valenceProfile.every((v) => v === 20));
  // It is not in the stored score, and no branch reads it to choose a peak.
  assert.equal(r.score.valence, undefined);
  assert.equal(r.peak.id, 'r16');
});

test('junk rows are dropped rather than clamped, and an unknown set is refused', () => {
  const rows = [
    { block: 0, stimulus: 'r01', intensity: 500 },
    { block: 9, stimulus: 'r01', intensity: 10 },
    { block: 0, stimulus: 'nope', intensity: 10 },
    { block: 0, stimulus: 'r02', intensity: 10 },
    null, 'x',
  ];
  const prof = blockProfiles(rows, { set: 'rhythm' });
  assert.equal(prof.profiles[0].filter((v) => v != null).length, 1);
  assert.equal(scoreSitting({ set: 'nope', responses: rows }).ok, false);
  assert.doesNotThrow(() => scoreSitting({ set: 'rhythm', responses: null }));
  assert.equal(resultCopy(null).headline, 'Nothing was scored.');
});

// ── the register and the page ────────────────────────────────────────────────────────────────────

test('the exam is registered as within-person and as experiential self-report', () => {
  const e = examById(EXAM_ID);
  assert.ok(e);
  assert.equal(e.kind, 'perception');
  assert.equal(e.claimClass, 'within-person');
  assert.equal(claimClassOf(e).mark, '③');
  assert.equal(e.experientialSelfReport, true, 'sixteen "how much did that do to you" sliders is a report');
  assert.equal(e.neverSay, 'This is your Thread.');
  assert.equal(e.route, '/exams/thread');
});

test('both pages carry consultBanner and CONSULT.notALab, and the colour page carries the colour context', () => {
  for (const set of SET_IDS) {
    const html = threadPageHTML({ set });
    assert.match(html, /class="consult"/, set);
    assert.ok(html.includes(CONSULT.short), set);
    assert.ok(html.includes(CONSULT.notALab.slice(0, 60)), set);
  }
  const colour = threadPageHTML({ set: 'colour' });
  // The `colour` disclaimer context, by name: the coloured lamp is the exact article that was
  // condemned in United States v. Ghadiali, so this surface disclaims restoration by name.
  assert.match(colour, /no colour is matched to a condition/);
  assert.match(colour, /restores/);
  assert.match(colour, /not calibrated and cannot be/);
});

test('the page states the attribution AND its verification status', () => {
  const html = threadPageHTML({ set: 'rhythm' });
  assert.match(html, /khayt/);
  assert.match(html, /kodia/);
  assert.match(html, /borrowing the method/i);
  assert.match(html, /not borrowing the cosmology/i);
  assert.match(html, /partially verified/i);
  assert.match(html, /El Hadidi/);
  assert.match(html, /has not\s*\n?\s*been read in full/);
});

test('⛔ the page maps no stimulus to a spirit, and says so out loud', () => {
  const html = threadPageHTML({ set: 'rhythm' });
  assert.match(html, /It will never name a spirit, a Thread or a deity/);
  // The rhythm notes describe the FIGURE and nothing else — no entity, no attribute of the taker.
  for (const r of RHYTHMS) {
    assert.ok(!/spirit|deity|thread|angel|orisha/i.test(r.note), `${r.id}: ${r.note}`);
  }
  for (const h of HUES) {
    assert.ok(!/spirit|deity|thread|chakra|ray\b/i.test(h.note), `${h.id}: ${h.note}`);
    // And no colour WORD. "Your indigo" is the sentence this module exists in order not to write.
    assert.ok(!/indigo|violet|turquoise|crimson|azure/i.test(h.note), h.note);
  }
});

test('no participant key, sitting id or permutation seed reaches the page', () => {
  for (const set of SET_IDS) {
    const html = threadPageHTML({ set });
    const body = html.replace(/<script>[\s\S]*?<\/script>/g, '');
    assert.ok(!/[0-9A-HJ-NP-TV-Z]{25}/.test(body), 'no key-shaped string in the body');
    assert.ok(!/seed/i.test(body), 'the permutation seed is server-side and stays there');
  }
});

test('the run handed to the browser leaks nothing identifying', () => {
  const run = buildRun({ set: 'rhythm', seed: 'PARTICIPANTKEYSHAPEDTHING' });
  const json = JSON.stringify(run);
  assert.ok(!json.includes('PARTICIPANTKEYSHAPEDTHING'), 'the seed must not survive into the run');
  assert.ok(!/pid|participant|key|seed/i.test(json));
});

test('claimsCheck over the module’s own prose, and what it flags is inspected', () => {
  const prose = [
    ...RHYTHMS.map((r) => r.note),
    ...HUES.map((h) => h.note),
    ...Object.values(SETS).map((s) => s.blurb),
    TIMING_POSTURE.why,
    ...resultCopy(scoreSitting({ set: 'rhythm', responses: repeaterResponses(), permutations: 300 })).lines,
    ...resultCopy(scoreSitting({ set: 'rhythm', responses: nonRepeaterResponses(), permutations: 300 })).lines,
  ];
  const flagged = prose.map((l) => ({ l, c: claimsCheck(l) })).filter((x) => !x.c.ok);
  // Zero. Asserted as a number so a future edit that introduces a claim pattern fails here rather
  // than passing quietly. A clean result is the absence of the phrases the matcher knows — not a
  // clearance; the matcher has no model of negation or quotation.
  assert.equal(flagged.length, 0, JSON.stringify(flagged, null, 2));
});

test('the intensity and valence scales are what the page says they are', () => {
  assert.deepEqual([INTENSITY.min, INTENSITY.max], [0, 100]);
  assert.deepEqual([VALENCE.min, VALENCE.max], [-50, 50]);
  const html = threadPageHTML({ set: 'rhythm' });
  assert.match(html, /min="0" max="100"/);
  assert.match(html, /min="-50" max="50"/);
});
