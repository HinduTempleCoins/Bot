// site/hathor-live/exam-thread.mjs — the Thread Protocol. A within-person differential-response
// exam over an enumerated stimulus set, built on a procedure the tradition wrote first.
//
// ── WHERE THE DESIGN COMES FROM, STATED PLAINLY AND WITHOUT FLATTERY ─────────────────────────────
//
// In the Egyptian zar, the thread — KHAYT — is the distinctive drum rhythm belonging to each spirit,
// and the leader of the ceremony, the KODIA, is expected to be a trained singer who knows the songs
// and rhythms of each. She performs each spirit's rhythm in turn and watches for a reaction, and the
// rhythm that produces one identifies the spirit.
//
// Look at the shape of that and not at the metaphysics:
//
//   a fixed, enumerated set of rhythms, one per spirit   →  A STIMULUS SET
//   performed one at a time, in sequence                 →  SERIAL PRESENTATION
//   the practitioner watches for a differential reaction →  A RESPONSE CRITERION
//   the rhythm that produces it names the spirit         →  CLASSIFICATION BY MAXIMAL DIFFERENTIAL
//                                                            RESPONSE
//
// That is a within-person psychophysical protocol over an enumerated stimulus set, and it was built
// centuries before anybody wrote down a method section. This module borrows the METHOD. It does not
// borrow the cosmology, it does not name a spirit, and it does not map any stimulus to one. §D.2 of
// the source paper, and the reason is `identity-grade-instruments.md` §0: the assertion would be
// FALSE, not merely impolite. No instrument can identify a spirit.
//
// [PARTIALLY VERIFIED] The khayt-as-drum-rhythm and kodia-as-diagnostician account is consistent
// across the practitioner and secondary literature and is the standard account. El Hadidi, H. (2016),
// "Zar: Spirit Possession, Music, and Healing Rituals in Egypt", American University in Cairo Press,
// doi:10.5743/cairo/9789774166976.001.0001, is the scholarly source and was NOT read in full. The
// PROTOCOL below does not depend on it — it stands as psychophysics regardless — but the attribution
// on the page does, and the page says so.
//
// ── WHAT MAKES IT A MEASUREMENT RATHER THAN A MOOD READING ───────────────────────────────────────
//
// THE REPEAT BLOCK. The whole set is presented again, in a fresh random order, WITHOUT WARNING that
// it is a repeat. This is the grapheme–colour design in a new domain, and the reason is the same:
// anyone can report a favourite. Almost nobody reproduces a sixteen-point response profile by
// accident. The failure to reproduce IS the measurement; the first report is not.
//
// AND THE REPEAT STATISTIC IS PRINTED EVEN WHEN IT IS BAD — especially when it is bad. "Your
// responses did not agree between blocks, so we cannot tell your largest response from noise" is a
// real, honest and interesting result, and refusing to fudge it is the only thing that makes the
// positive result mean anything.
//
// ── CLAIM CLASS ③ + ④, NEVER ① ──────────────────────────────────────────────────────────────────
//
// ③ because it is entirely within-person: the reference is the participant's own first block, so it
// needs no norms, no population and no display calibration. ④ for the profile shape itself. There is
// no discontinuity here and no category to belong to.
//
// AND NOTHING HERE IS PORTABLE ACROSS DEVICES OR PEOPLE. A cross-participant comparison of an
// absolute response magnitude is meaningless and this module has no code path that offers one. The
// within-person design is exactly what makes display and latency differences cancel.
//
// ── TIMING ───────────────────────────────────────────────────────────────────────────────────────
//
// Rhythms are laid on metronome.mjs's look-ahead scheduler. This exam measures DIFFERENTIAL RESPONSE
// and never asynchrony, so `mayReportSignedAsynchrony()` never has to be consulted — and a test pins
// that the result carries no signed millisecond value under any calibration. See TIMING_POSTURE.
//
// Pure and offline. No I/O. esc() everything.

import { esc } from '../../integrations/melek-theme.mjs';
import { seedFrom } from '../../integrations/token-exams.mjs';
import { FRAMING, BROWSER_LIMITS, examShell, retestPair, examById } from './exams.mjs';
import { stateCardHTML } from './state-card.mjs';
import { KEYGEN_JS } from './participant-key.mjs';
import { CONSULT, disclaimer } from './the-line.mjs';
import { SCHEDULER, CLICKS, RATE_LIMITS, scheduleWindow, bpmToIoi } from './metronome.mjs';
import { oklchToRgb, rgbToHex } from './colour-space.mjs';

export { esc };

export const EXAM_ID = 'thread';

/** Blocks of the full set. Three, so a pairwise agreement has three numbers rather than one. */
export const BLOCKS = 3;
/** Seconds each stimulus is presented before the response is asked for. */
export const PRESENTATION_SEC = 8;

// ── the rhythm set ───────────────────────────────────────────────────────────────────────────────
//
// SIXTEEN PATTERNS, NOT SIXTEEN TEMPI. Each khayt is its own figure, so what varies here is the
// ARRANGEMENT of onsets on a sixteen-step grid at one fixed tempo. Varying tempo instead would make
// this a speed-preference test, which is a different and much less interesting question.
//
// Every figure begins on the downbeat so that the patterns are comparable at their start and differ
// only afterwards. Onset counts run from three to eight and SEVERAL FIGURES SHARE A COUNT, so density
// alone does not identify a figure — the arrangement has to do the work.

export const GRID_STEPS = 16;
export const RHYTHM_BPM = 96;
/** Four steps per beat: a sixteen-step grid is one bar of 4/4 in semiquavers at RHYTHM_BPM. */
export const RHYTHM_SUBDIVISION = 4;

const P = (id, mask, note) => Object.freeze({ id, mask, note, onsets: mask.split('').filter((c) => c === 'x').length });

export const RHYTHMS = Object.freeze([
  P('r01', 'x...x...x...x...', 'Four square. The reference figure, and the one everything else is heard against.'),
  P('r02', 'x..x..x...x..x..', 'The 3-3-2 grouping, the most widespread asymmetric figure there is.'),
  P('r03', 'x..x..x..x..x...', 'Even threes, running against the four.'),
  P('r04', 'x.x.x.x.x.x.x.x.', 'Straight eighths — dense and unaccented.'),
  P('r05', 'x...x..x..x.x...', 'A displaced second onset, so the bar leans forward.'),
  P('r06', 'x.....x...x.....', 'Sparse and late; long silences are part of the figure.'),
  P('r07', 'x..xx...x..xx...', 'A doubled stroke on the offbeat, twice.'),
  P('r08', 'xx..x...xx..x...', 'A flam at the top of each half-bar.'),
  P('r09', 'x...x...x..x.x..', 'Four square for half a bar, then it breaks.'),
  P('r10', 'x.x..x..x.x..x..', 'A five-inside-eight limp.'),
  P('r11', 'x......x.x......', 'Two strokes and a very long tail.'),
  P('r12', 'x..x.x.x..x.x.x.', 'Dense in the second half of each beat.'),
  P('r13', 'x...xx.x....xx.x', 'Asymmetric halves — the second is not the first.'),
  P('r14', 'x.xx....x.xx....', 'A triplet-feeling cluster, repeated.'),
  P('r15', 'x.....x.x.....x.', 'Wide and even, at two-thirds the reference density.'),
  P('r16', 'x..x..xx..x..x..', 'The 3-3-2 with the join filled in.'),
]);

// ── the colour set ───────────────────────────────────────────────────────────────────────────────
//
// SIXTEEN HUES AT ONE LIGHTNESS AND ONE CHROMA, sampled evenly around the Oklch hue circle — even in
// a near-perceptually-uniform space rather than in HSL, which would cluster the sample in the yellows
// and starve the blues. L = 0.65 and C = 0.11 are chosen because every one of the sixteen lands
// INSIDE the sRGB gamut before clipping: a clipped swatch is not the colour that was asked for, and
// clipping is a systematic compression toward the gamut edge rather than noise.
//
// The browser-honesty rules from the colour exams apply in full and are printed on the page: the
// display is not calibrated and cannot be, the room is part of the stimulus, and NO WAVELENGTH IS
// EVER PRINTED because converting a screen colour to nanometres needs primaries we do not have.
// Those limits are survivable here for one reason only: the comparison is the participant's own
// first block, on the same screen, minutes earlier.

export const HUE_L = 0.65;
export const HUE_C = 0.11;

export const HUES = Object.freeze(Array.from({ length: 16 }, (_, i) => {
  const H = i * (360 / 16);
  const { rgb, inGamut } = oklchToRgb({ L: HUE_L, C: HUE_C, H });
  return Object.freeze({
    id: `h${String(i + 1).padStart(2, '0')}`,
    hue: H,
    hex: rgbToHex(rgb),
    inGamut,
    // Named by its coordinate, never by a colour word: "your indigo" is the sentence this whole
    // module exists to not write. §D.3.
    note: `Hue ${H}° at fixed lightness and chroma.`,
  });
}));

export const SETS = Object.freeze({
  rhythm: Object.freeze({
    id: 'rhythm',
    label: 'The sixteen rhythms',
    unit: 'rhythm',
    disclaimerContext: 'entrainment',
    stimuli: RHYTHMS,
    blurb: 'Sixteen rhythmic figures on one sixteen-step grid at one tempo. What varies is the '
      + 'arrangement of the strokes, not the speed — each khayt is its own figure, and a tempo test '
      + 'would be a different and much duller question.',
  }),
  colour: Object.freeze({
    id: 'colour',
    label: 'The sixteen hues',
    unit: 'hue',
    disclaimerContext: 'colour',
    stimuli: HUES,
    blurb: 'Sixteen hues sampled evenly around a near-perceptually-uniform hue circle, all at the same '
      + 'lightness and chroma, and all inside what your screen can actually show before it starts '
      + 'clipping.',
  }),
});

export const SET_IDS = Object.freeze(Object.keys(SETS));
export const setById = (id) => SETS[String(id || '').toLowerCase()] || null;

/** The response scales. Intensity is required; valence is optional and reported separately. */
export const INTENSITY = Object.freeze({ min: 0, max: 100, low: 'nothing at all', high: 'a great deal' });
export const VALENCE = Object.freeze({ min: -50, max: 50, low: 'unpleasant', high: 'pleasant' });

/**
 * The timing posture, as data rather than a comment, so a test can assert it.
 *
 * `metronome.mjs`'s `mayReportSignedAsynchrony()` refuses signed values without calibration, and it
 * is right to. This exam never needs one: nothing it reports is a sound-to-movement interval. It
 * measures how much a person says a figure did to them, which is a rating and not a latency.
 */
export const TIMING_POSTURE = Object.freeze({
  needsSignedAsynchrony: false,
  why: 'This exam measures DIFFERENTIAL RESPONSE across a stimulus set, not synchronisation. No number '
    + 'it produces is a sound-to-movement interval, so the calibration ladder that governs signed '
    + 'asynchrony does not apply and no result here is ever a millisecond.',
  scheduler: SCHEDULER,
  visualFloorNote: RATE_LIMITS.note,
});

// ── laying a pattern on the metronome's scheduler ────────────────────────────────────────────────

/**
 * Turn a pattern mask into the onsets the page will schedule, by asking metronome.mjs for the grid
 * and then keeping the steps the mask marks.
 *
 * The timing is NOT rebuilt here. `scheduleWindow` owns the grid, its geometry is Wilson 2013's
 * recommended look-ahead, and this function is a mask over its output. Anything else would be a
 * second implementation of the one thing in this directory that must have exactly one.
 *
 * @returns {{ onsets: Array<{time:number, step:number, accent:boolean, gain:number}>, barSec:number }}
 */
export function patternEvents(mask, { bpm = RHYTHM_BPM, startTime = 0, bars = 1 } = {}) {
  const m = String(mask || '');
  const beatSec = bpmToIoi(bpm) || 0;
  const barSec = beatSec * (GRID_STEPS / RHYTHM_SUBDIVISION);
  const nBars = Math.max(1, Math.min(64, Math.floor(Number(bars) || 1)));
  const start = Number.isFinite(Number(startTime)) ? Number(startTime) : 0;
  if (m.length !== GRID_STEPS || !beatSec) return { onsets: [], barSec: 0 };

  const onsets = [];
  for (let bar = 0; bar < nBars; bar += 1) {
    // Ask the shared scheduler for one bar of the grid. `scheduleAhead` is set to the bar length so
    // the window is exactly the bar; everything else is the module's own geometry.
    const t0 = start + bar * barSec;
    const { notes } = scheduleWindow({
      currentTime: t0,
      nextNoteTime: t0,
      nextNoteIndex: 0,
      bpm,
      beatsPerBar: GRID_STEPS / RHYTHM_SUBDIVISION,
      subdivision: RHYTHM_SUBDIVISION,
      scheduleAhead: barSec,
      maxNotes: GRID_STEPS,
    });
    for (const note of notes) {
      if (m[note.index] !== 'x') continue;
      onsets.push({ time: note.time, step: note.index, accent: note.isDownbeat, gain: note.isDownbeat ? 1 : 0.7 });
    }
  }
  return { onsets, barSec };
}

// ── administration order ─────────────────────────────────────────────────────────────────────────

function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the running order: BLOCKS presentations of the whole set, each in its own fresh random order.
 *
 * ⭐ THE PAGE IS NOT TOLD WHICH BLOCK IS A REPEAT and the running order carries no block boundary the
 * participant can see. Warning somebody that the set is about to come round again converts a
 * reproduction test into a memory test, and the reproduction is the whole instrument.
 */
export function buildRun({ set = 'rhythm', seed = 'anon', blocks = BLOCKS } = {}) {
  const s = setById(set);
  if (!s) return { ok: false, error: 'unknown stimulus set', trials: [] };
  const nBlocks = Math.max(2, Math.min(6, Math.floor(Number(blocks) || BLOCKS)));
  const rand = rng(seedFrom(String(seed)) ^ 0x1B873593);
  const trials = [];
  for (let b = 0; b < nBlocks; b += 1) {
    for (const st of shuffle(s.stimuli, rand)) {
      trials.push({
        // `block` is in the record because the SCORING needs it. It is not rendered on the page and
        // the client never shows it — see the note above.
        block: b,
        stimulus: st.id,
        ...(s.id === 'rhythm'
          ? { mask: st.mask, bpm: RHYTHM_BPM, subdivision: RHYTHM_SUBDIVISION }
          : { hex: st.hex }),
        seconds: PRESENTATION_SEC,
      });
    }
  }
  return {
    ok: true,
    set: s.id,
    blocks: nBlocks,
    size: s.stimuli.length,
    trials,
    intensity: INTENSITY,
    valence: VALENCE,
  };
}

// ── the statistics ───────────────────────────────────────────────────────────────────────────────

/** Pearson product-moment correlation. Returns null when either vector has no variance. */
export function pearson(a, b) {
  const x = Array.isArray(a) ? a.map(Number) : [];
  const y = Array.isArray(b) ? b.map(Number) : [];
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let sx = 0; let sy = 0;
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) return null;
    sx += x[i]; sy += y[i];
  }
  const mx = sx / n; const my = sy / n;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a1 = x[i] - mx; const b1 = y[i] - my;
    num += a1 * b1; dx += a1 * a1; dy += b1 * b1;
  }
  if (dx <= 0 || dy <= 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Every block's profile, in a FIXED stimulus order, so two blocks are comparable element by element. */
export function blockProfiles(responses, { set = 'rhythm', blocks = BLOCKS } = {}) {
  const s = setById(set);
  if (!s) return { ok: false, profiles: [], order: [] };
  const order = s.stimuli.map((st) => st.id);
  const nBlocks = Math.max(2, Math.min(6, Math.floor(Number(blocks) || BLOCKS)));
  const grid = Array.from({ length: nBlocks }, () => new Map());
  for (const r of Array.isArray(responses) ? responses : []) {
    if (!r || typeof r !== 'object') continue;
    const b = Math.floor(Number(r.block));
    const v = Number(r.intensity);
    if (!Number.isInteger(b) || b < 0 || b >= nBlocks) continue;
    if (!Number.isFinite(v) || v < INTENSITY.min || v > INTENSITY.max) continue;
    if (!order.includes(String(r.stimulus))) continue;
    grid[b].set(String(r.stimulus), v);
  }
  const profiles = grid.map((m) => order.map((id) => (m.has(id) ? m.get(id) : null)));
  const complete = profiles.map((p) => p.every((v) => v != null));
  return { ok: true, order, profiles, complete, blocks: nBlocks };
}

/**
 * ⭐ THE REPEAT STATISTIC. The instrument.
 *
 * Mean pairwise Pearson r between complete block profiles, plus a permutation p: the stimulus labels
 * within every block after the first are shuffled, the mean r recomputed, and the observed value
 * ranked against that null. A permutation test rather than a t-approximation because the null it
 * tests is the one that actually matters here — "these blocks agree no better than if the labels
 * were scrambled" — and because it needs no distributional assumption about ratings, which are
 * bounded, lumpy and nothing like normal.
 *
 * The RNG is seeded, so the same data gives the same p. That is a property worth having: a person
 * who reloads their result must not see the number move.
 */
export const PERMUTATIONS = 2000;

export function repeatStatistic(profiles, { permutations = PERMUTATIONS, seed = 'thread' } = {}) {
  // `v != null` before Number(): Number(null) is 0, so without it a block where the participant
  // answered NOTHING would be read as a block of zeros — a complete profile made entirely of a value
  // they never gave. Same trap `retestPair()` documents in exams.mjs.
  const complete = (p) => Array.isArray(p) && p.length > 0 && p.every((v) => v != null && v !== '' && Number.isFinite(Number(v)));
  const usable = (Array.isArray(profiles) ? profiles : []).filter(complete);
  if (usable.length < 2) {
    return { ok: false, blocks: usable.length, pairwise: [], meanR: null, p: null,
      why: 'Fewer than two complete blocks, so there is nothing to compare a block against.' };
  }
  const pairwise = [];
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const r = pearson(usable[i], usable[j]);
      pairwise.push({ a: i, b: j, r });
    }
  }
  const rs = pairwise.map((p) => p.r).filter((r) => Number.isFinite(r));
  if (!rs.length) {
    return { ok: false, blocks: usable.length, pairwise, meanR: null, p: null,
      why: 'One or more blocks had no variation at all — the same rating for every stimulus — so a '
        + 'correlation is undefined. That is itself informative and is reported rather than hidden.' };
  }
  const meanR = rs.reduce((n, r) => n + r, 0) / rs.length;

  const nPerm = Math.max(200, Math.min(20000, Math.floor(Number(permutations) || PERMUTATIONS)));
  const rand = rng(seedFrom(String(seed)) ^ 0x85EBCA6B);
  let atLeast = 0;
  for (let k = 0; k < nPerm; k += 1) {
    const shuffledBlocks = usable.map((p, i) => (i === 0 ? p : shuffle(p, rand)));
    const sim = [];
    for (let i = 0; i < shuffledBlocks.length; i += 1) {
      for (let j = i + 1; j < shuffledBlocks.length; j += 1) {
        const r = pearson(shuffledBlocks[i], shuffledBlocks[j]);
        if (Number.isFinite(r)) sim.push(r);
      }
    }
    if (sim.length && (sim.reduce((n, r) => n + r, 0) / sim.length) >= meanR) atLeast += 1;
  }
  // (hits + 1) / (permutations + 1): the observed arrangement is one of the arrangements, so a p of
  // exactly zero is not available and should not be printed.
  const p = (atLeast + 1) / (nPerm + 1);
  return { ok: true, blocks: usable.length, pairwise, meanR, p, permutations: nPerm };
}

/** Below this p the profile is treated as reproducing. Stated as a constant so it can be argued with. */
export const REPEAT_ALPHA = 0.05;

/**
 * Which stimulus reliably produced the largest response — and "reliably" is doing real work.
 *
 * TWO conditions, both required:
 *   1. the profile as a whole reproduces (the permutation p), and
 *   2. the same stimulus is the largest in a MAJORITY of the individual blocks.
 *
 * (1) alone would let a stable profile with an unstable peak name a peak. (2) alone would let three
 * coin flips agree. Together they are a claim we can stand behind, and when either fails the answer
 * is "we cannot tell your largest response from noise", which is a real result.
 */
export function peakStimulus(profiles, order) {
  // Same null guard as repeatStatistic: an unanswered block is not a block of zeros.
  const ps = (Array.isArray(profiles) ? profiles : [])
    .filter((p) => Array.isArray(p) && p.length > 0 && p.every((v) => v != null && v !== '' && Number.isFinite(Number(v))));
  const ids = Array.isArray(order) ? order : [];
  if (ps.length < 2 || !ids.length) return { ok: false, id: null, mean: null, wonBlocks: 0, blocks: ps.length };
  const means = ids.map((_, i) => ps.reduce((n, p) => n + Number(p[i]), 0) / ps.length);
  let best = 0;
  for (let i = 1; i < means.length; i += 1) if (means[i] > means[best]) best = i;
  // A tie at the top is not a peak. Say so rather than picking the lower index.
  const tied = means.filter((m) => m === means[best]).length > 1;
  let wonBlocks = 0;
  for (const p of ps) {
    let bi = 0;
    for (let i = 1; i < p.length; i += 1) if (Number(p[i]) > Number(p[bi])) bi = i;
    const blockTied = p.filter((v) => Number(v) === Number(p[bi])).length > 1;
    if (!blockTied && bi === best) wonBlocks += 1;
  }
  return {
    ok: !tied && wonBlocks * 2 > ps.length,
    id: ids[best],
    index: best,
    mean: Math.round(means[best] * 100) / 100,
    means: means.map((m) => Math.round(m * 100) / 100),
    wonBlocks,
    blocks: ps.length,
    tied,
  };
}

/** Score a whole sitting. Everything above, assembled, and nothing that is not above. */
export function scoreSitting({ set = 'rhythm', responses = [], blocks = BLOCKS, seed = 'thread', permutations = PERMUTATIONS } = {}) {
  const s = setById(set);
  if (!s) {
    return { ok: false, exam: EXAM_ID, error: 'unknown stimulus set', set: String(set || '') };
  }
  const prof = blockProfiles(responses, { set: s.id, blocks });
  const stat = repeatStatistic(prof.profiles, { permutations, seed });
  const peak = peakStimulus(prof.profiles, prof.order);
  const repeats = Boolean(stat.ok && Number.isFinite(stat.p) && stat.p < REPEAT_ALPHA && stat.meanR > 0);
  const answered = (Array.isArray(responses) ? responses : []).filter((r) => r && Number.isFinite(Number(r.intensity))).length;

  // Valence is collected and summarised, and it is NEVER used to name anything. It is reported as a
  // second profile so a reader can see whether their strongest response was a pleasant one.
  const valences = new Map();
  for (const r of Array.isArray(responses) ? responses : []) {
    const v = Number(r && r.valence);
    if (!Number.isFinite(v) || v < VALENCE.min || v > VALENCE.max) continue;
    const id = String(r.stimulus);
    if (!prof.order.includes(id)) continue;
    if (!valences.has(id)) valences.set(id, []);
    valences.get(id).push(v);
  }
  const valenceProfile = prof.order.map((id) => {
    const xs = valences.get(id) || [];
    return xs.length ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 100) / 100 : null;
  });

  return {
    ok: true,
    exam: EXAM_ID,
    set: s.id,
    unit: s.unit,
    order: prof.order,
    profiles: prof.profiles,
    completeBlocks: prof.complete.filter(Boolean).length,
    blocks: prof.blocks,
    answered,
    expected: s.stimuli.length * prof.blocks,
    valenceProfile,
    repeat: stat,
    peak,
    repeats,
    // `score` is the shape exams-store's distribution reader expects. It carries the repeat statistic
    // because that is the finding; the peak is deliberately NOT a number in here, because the peak is
    // a stimulus label and a stimulus label is not something to build a distribution out of.
    score: {
      meanR: Number.isFinite(stat.meanR) ? Math.round(stat.meanR * 1000) / 1000 : null,
      p: Number.isFinite(stat.p) ? stat.p : null,
      completeBlocks: prof.complete.filter(Boolean).length,
    },
  };
}

// ── result copy ──────────────────────────────────────────────────────────────────────────────────

const nameStimulus = (setId, id) => {
  const s = setById(setId);
  if (!s) return String(id || '');
  const st = s.stimuli.find((x) => x.id === id);
  if (!st) return String(id || '');
  return s.id === 'rhythm'
    ? `${st.id} — ${st.mask} (${st.note})`
    : `${st.id} — hue ${st.hue}° (${st.hex})`;
};

export function resultCopy(result, { priorScore = null } = {}) {
  if (!result || !result.ok) {
    return { headline: 'Nothing was scored.', lines: [], repeatLine: '', peakLine: '', retest: null };
  }
  const lines = [];
  const stat = result.repeat || {};
  const unit = result.unit || 'stimulus';

  lines.push(`You rated ${result.answered} of ${result.expected} presentations — `
    + `${result.order.length} ${unit}s, ${result.blocks} times each, in a different order every time.`);
  lines.push('You were not told that the set was going to come round again. That is deliberate and it '
    + 'is the whole instrument: anyone can report a favourite, and almost nobody reproduces a '
    + `${result.order.length}-point response profile by accident. The failure to reproduce is the `
    + 'measurement; the first report is not.');

  let repeatLine = '';
  if (!stat.ok) {
    repeatLine = stat.why || 'There were not enough complete blocks to compare.';
  } else {
    const pairs = stat.pairwise.filter((x) => Number.isFinite(x.r))
      .map((x) => `blocks ${x.a + 1}&${x.b + 1}: r = ${x.r.toFixed(2)}`).join(', ');
    repeatLine = `Agreement between your blocks: ${pairs}. Mean r = ${stat.meanR.toFixed(2)}, `
      + `and a permutation test over ${stat.permutations} relabellings puts that at p = ${stat.p.toFixed(4)}.`;
  }
  lines.push(repeatLine);

  let peakLine = '';
  if (result.repeats && result.peak && result.peak.ok) {
    peakLine = `Your largest response was to ${nameStimulus(result.set, result.peak.id)}, mean `
      + `${result.peak.mean} out of ${INTENSITY.max}, and it was your largest in `
      + `${result.peak.wonBlocks} of ${result.peak.blocks} blocks.`;
    lines.push(peakLine);
    // ⭐ THE SENTENCE THIS WHOLE MODULE IS BUILT AROUND.
    lines.push(`That names a ${unit}. It does not name a spirit, a Thread, a deity, a colour-of-you, or `
      + 'anything else about your person. No instrument can do that, and the reason we do not is not '
      + 'politeness — it is that the statement would be false.');
  } else if (result.repeats) {
    peakLine = 'Your profile reproduced, but no single ' + unit + ' was reliably your largest — the peak '
      + 'moved between blocks, or the top was tied. The shape is yours; the summit is not resolved.';
    lines.push(peakLine);
  } else {
    peakLine = 'Your responses did not agree between blocks. On this test, that means we cannot tell your '
      + 'largest response from noise, and we are not going to name one.';
    lines.push(peakLine);
    lines.push('That is a real result and it is more interesting than it sounds. It can mean the set does '
      + 'not differentiate for you; it can mean your state changed during the sitting; it can mean the '
      + 'ratings were made quickly. Sitting it again is the way to tell those apart, and the pair will '
      + 'be worth more than either sitting alone.');
  }

  lines.push('Everything here is you against you. Your own first block is the reference, which is why '
    + 'this needs no norms, no comparison group and no calibrated display — and why a comparison of your '
    + 'numbers against somebody else’s would be meaningless. We do not offer one.');
  lines.push(CONSULT.notALab);

  return {
    headline: result.repeats
      ? `Your profile repeated — mean r = ${stat.meanR.toFixed(2)}`
      : 'Your profile did not repeat',
    lines,
    repeatLine,
    peakLine,
    profileFor: result.order.map((id, i) => ({
      id,
      label: nameStimulus(result.set, id),
      means: (result.profiles || []).map((p) => p[i]),
      valence: (result.valenceProfile || [])[i],
    })),
    retest: retestPair(priorScore, result.score.meanR, { unit: '' }),
    neverSay: (examById(EXAM_ID) || {}).neverSay || '',
  };
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

export function threadPageHTML({ set = 'rhythm' } = {}) {
  const s = setById(set) || SETS.rhythm;
  const exam = examById(EXAM_ID) || {};
  const other = s.id === 'rhythm' ? SETS.colour : SETS.rhythm;

  const colourLimits = s.id === 'colour'
    ? `<div class=card>
  <h2 style="margin-top:0">What your screen cannot do, and why it does not sink this exam</h2>
  <ul class=limits>${BROWSER_LIMITS.filter((l) => ['calibration', 'gamut', 'ambient', 'wavelength'].includes(l.id))
    .map((l) => `<li><b>${esc(l.limit)}</b><span class=muted>${esc(l.detail)}</span></li>`).join('')}</ul>
  <p>Every one of those is true and none of them is fixable from JavaScript. They are survivable here
  for exactly one reason: <b>the comparison is your own first block</b>, on this screen, minutes
  earlier. A display error that is present in both blocks cancels. A display error that is present in
  only one of them is why we ask you not to change your brightness halfway through.</p>
  <p class=prov>All sixteen hues sit inside what an sRGB panel can show before it clips, so none of
  them is a compressed approximation of a colour we could not send you.</p>
</div>`
    : `<div class=card>
  <h2 style="margin-top:0">About the timing</h2>
  <p>The figures are laid on the same look-ahead scheduler the metronome uses — the JavaScript timer
  wakes every ${esc(String(SCHEDULER.lookaheadMs))} ms and schedules
  ${esc(String(Math.round(SCHEDULER.scheduleAheadSec * 1000)))} ms of audio into the future, which is
  what keeps a browser rhythm steady instead of merely approximate.</p>
  <p class=prov><b>Nothing here is ever reported as a millisecond.</b> ${esc(TIMING_POSTURE.why)}</p>
  <p class=prov>${esc(RATE_LIMITS.note)}</p>
</div>`;

  const body = `<h1>${esc(exam.name || 'The Thread Protocol')}</h1>
<p class=muted>${esc(s.blurb)}</p>

<div class=card>
  <h2 style="margin-top:0">Where this design comes from</h2>
  <p>In the Egyptian zar, the thread — <i>khayt</i> — is the distinctive drum rhythm belonging to each
  spirit, and the <i>kodia</i> who leads the ceremony is expected to know the songs and rhythms of
  each. She performs them one at a time and watches for a reaction, and the rhythm that produces one
  identifies the spirit.</p>
  <p>Look at the shape of that rather than at the metaphysics. A fixed enumerated set of stimuli.
  Serial presentation. A response criterion. Classification by maximal differential response.
  <b>That is a within-person psychophysical protocol, and it was built centuries before anybody wrote
  down a method section.</b></p>
  <p><b>We are borrowing the method. We are not borrowing the cosmology.</b> This page will name a
  ${esc(s.unit)}. It will never name a spirit, a Thread or a deity, and it does not map any
  ${esc(s.unit)} to one — not because that would be impolite, but because no instrument can do it and
  the statement would be false.</p>
  <p class=prov>The <i>khayt</i>-as-drum-rhythm account is the standard one and is consistent across
  the sources read, but it is marked <b>partially verified</b>: El Hadidi (2016), <i>Zar: Spirit
  Possession, Music, and Healing Rituals in Egypt</i> (AUC Press) is the scholarly source and has not
  been read in full here. The protocol does not depend on it — it stands as psychophysics either way —
  but this attribution does, and saying so is cheaper than implying otherwise.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">What is going to happen, and what will be reported</h2>
  <p>You will be shown each of the ${esc(String(s.stimuli.length))} ${esc(s.unit)}s for
  ${esc(String(PRESENTATION_SEC))} seconds and asked, after each, how much of a response it produced.
  There is no right answer and no wrong one, and “nothing at all” is a real answer that is worth
  giving.</p>
  <ul class=limits>
    <li><b>Your response profile.</b><span class=muted>The shape, across the whole set.</span></li>
    <li><b>Whether it repeats.</b><span class=muted>The agreement between your blocks, with the number
    shown — and it is shown whether it is good or bad. Especially when it is bad.</span></li>
    <li><b>Which ${esc(s.unit)} reliably produced your largest response</b><span class=muted>— and only
    if the profile repeated and the peak held in a majority of blocks. If not, we say we cannot tell it
    from noise, which is a real result and not a failure.</span></li>
  </ul>
  <p class=prov><b>This result will never be worded as: “${esc(exam.neverSay || '')}”</b></p>
</div>

<div class=card>
  <h2 style="margin-top:0">Your key</h2>
  <p>Your browser made you a random key. We store a one-way hash of it, never the key. It is the only
  thing linking this sitting to your next one — <b>write it down</b>.</p>
  <p><span class=key id=keyout>…</span></p>
  <p><label class=field>Already have one? <input type=text id=keyin size=32 autocomplete=off placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></label>
     <button class=ghost type=button id=keyset>Use that key</button></p>
</div>

${stateCardHTML({ formId: 'statecard' })}

${colourLimits}

<div class=card id=runner>
  <h2 style="margin-top:0">${esc(s.label)}</h2>
  <div id=stage class=stage></div>
  <div id=rate style="display:none">
    <div class=vas><p><b>How much of a response did that produce?</b></p>
      <input type=range id=intensity min="${esc(String(INTENSITY.min))}" max="${esc(String(INTENSITY.max))}" value="0">
      <div class=vasends><span>${esc(INTENSITY.low)}</span><span>${esc(INTENSITY.high)}</span></div></div>
    <div class=vas><p>And was it pleasant or unpleasant? <span class=muted>(optional)</span></p>
      <input type=range id=valence min="${esc(String(VALENCE.min))}" max="${esc(String(VALENCE.max))}" value="0">
      <div class=vasends><span>${esc(VALENCE.low)}</span><span>${esc(VALENCE.high)}</span></div></div>
    <p><button type=button id=next>Next</button></p>
  </div>
  <p><button type=button id=start>Start</button> <span class=muted id=progress></span></p>
</div>

<div class=card id=result style="display:none"></div>

<div class=card>
  <h2 style="margin-top:0">The other set</h2>
  <p>The same protocol runs over <a href="/exams/thread?set=${esc(other.id)}">${esc(other.label.toLowerCase())}</a>.
  The comparison between the two is the interesting part: a person whose rhythm profile repeats and
  whose hue profile does not has learned something about themselves that neither run gives on its
  own.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">The rules this page is bound by</h2>
  <ul class=limits>${FRAMING.map((f) => `<li><b>${esc(f.rule)}</b><span class=muted>${esc(f.why)}</span></li>`).join('')}</ul>
  <p class=prov>${esc(disclaimer(s.disclaimerContext))}</p>
</div>`;

  const css = `.stage{min-height:160px;display:flex;align-items:center;justify-content:center;
    border:1px solid var(--mk-border);border-radius:12px;margin:12px 0;font-size:15px;color:var(--mk-text-muted)}
  .swatch{width:100%;height:160px;border-radius:11px}
  .beat{width:22px;height:22px;border-radius:50%;background:var(--mk-border);margin:0 4px;display:inline-block}
  .beat.on{background:var(--mk-accent)}`;

  const js = `${KEYGEN_JS}
(function(){
  var SET=${JSON.stringify(s.id)}, key=teKey(), run=null, i=0, responses=[], ctx=null, timer=null;
  var $=function(id){return document.getElementById(id);};
  $('keyout').textContent=teFormat(key);
  $('keyset').onclick=function(){ var k=teSetKey($('keyin').value); if(k){ key=k; $('keyout').textContent=teFormat(k); } else { alert('That is not a 25-character participant key.'); } };
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  function click(t,gain,accent){
    var o=ctx.createOscillator(), g=ctx.createGain();
    o.frequency.value=accent?${esc(String(CLICKS.woodblock.accentFreqHz))}:${esc(String(CLICKS.woodblock.freqHz))};
    // Sharp attack, on purpose. A slow attack moves the perceptual centre and would bias every
    // comparison between figures — see metronome.mjs CLICKS.
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(gain,t+${esc(String(CLICKS.woodblock.attackMs / 1000))});
    g.gain.exponentialRampToValueAtTime(0.0001,t+${esc(String(CLICKS.woodblock.decayMs / 1000))});
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t+0.2);
  }

  function playRhythm(tr,done){
    try{ ctx=ctx||new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ done(); return; }
    var beatSec=60/tr.bpm, barSec=beatSec*(16/tr.subdivision), t0=ctx.currentTime+0.15;
    var bars=Math.max(1,Math.round(tr.seconds/barSec)), dots='';
    for(var b=0;b<bars;b++){
      for(var s=0;s<16;s++){
        if(tr.mask[s]!=='x') continue;
        click(t0+b*barSec+s*(beatSec/tr.subdivision), s===0?1:0.7, s===0);
      }
    }
    for(var k=0;k<16;k++) dots+='<span class="beat'+(tr.mask[k]==='x'?' on':'')+'"></span>';
    $('stage').innerHTML='<div>'+dots+'</div>';
    timer=setTimeout(done, bars*barSec*1000+250);
  }

  function playColour(tr,done){
    $('stage').innerHTML='<div class=swatch style="background:'+esc(tr.hex)+'"></div>';
    timer=setTimeout(done, tr.seconds*1000);
  }

  function ask(){
    $('rate').style.display=''; $('intensity').value=0; $('valence').value=0;
    // The block number is deliberately NOT shown. Telling somebody the set is coming round again
    // converts a reproduction test into a memory test.
    $('progress').textContent=(i+1)+' of '+run.trials.length;
  }

  function show(){
    if(i>=run.trials.length){ submit(); return; }
    $('rate').style.display='none'; $('stage').textContent='…';
    var tr=run.trials[i];
    (SET==='rhythm'?playRhythm:playColour)(tr, ask);
  }

  $('next').onclick=function(){
    var tr=run.trials[i];
    responses.push({block:tr.block, stimulus:tr.stimulus,
      intensity:Number($('intensity').value), valence:Number($('valence').value)});
    i++; show();
  };

  $('start').onclick=function(){
    $('start').disabled=true; $('progress').textContent='loading…';
    fetch('/api/exams/thread/run?set='+encodeURIComponent(SET)).then(function(r){return r.json();})
      .then(function(d){ run=d.run; i=0; responses=[]; show(); })
      .catch(function(){ $('progress').textContent='could not load the set.'; $('start').disabled=false; });
  };

  function readCard(){
    var f=document.getElementById('statecard'), out={deq5:{},classes:[],practices:[]};
    if(!f) return out;
    var els=f.querySelectorAll('input');
    for(var i2=0;i2<els.length;i2++){
      var el=els[i2], n=el.name; if(!n) continue;
      if(el.type==='radio'){ if(el.checked) out[n]=el.value; }
      else if(el.type==='checkbox'){ if(!el.checked) continue;
        if(n==='classes'||n==='practices') out[n].push(el.value); else out[n]=true; }
      else if(n.indexOf('deq5.')===0){ out.deq5[n.slice(5)]=el.value; }
      else if(el.value!=='') out[n]=el.value;
    }
    out.localTime=new Date().toISOString();
    try{ out.tz=Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
    out.tzOffsetMin=new Date().getTimezoneOffset();
    return out;
  }

  function submit(){
    $('rate').style.display='none'; $('stage').textContent=''; $('progress').textContent='scoring…';
    fetch('/api/exams/thread',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({key:key,set:SET,stateCard:readCard(),responses:responses,blocks:run.blocks})})
      .then(function(r){return r.json();}).then(function(d){
        var box=$('result'); box.style.display='';
        if(!d.ok){ box.innerHTML='<h2>That did not save.</h2><p>'+esc(d.error||'Nothing was stored.')+'</p>'; $('progress').textContent=''; return; }
        var h='<h2>'+esc(d.copy.headline)+'</h2>';
        h+=d.copy.lines.map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
        h+='<h3>Your profile</h3><table><tr><th>stimulus</th><th>mean by block</th><th>pleasantness</th></tr>';
        h+=(d.copy.profileFor||[]).map(function(r2){
          return '<tr><td>'+esc(r2.label)+'</td><td>'+(r2.means||[]).map(function(v){return v==null?'—':v;}).join(' · ')
            +'</td><td>'+(r2.valence==null?'—':r2.valence)+'</td></tr>';}).join('');
        h+='</table>';
        if(d.covariate){
          h+='<h3>'+esc(d.covariate.headline||'')+'</h3>';
          h+=(d.covariate.lines||[]).map(function(l){return '<p>'+esc(l)+'</p>';}).join('');
          if(!d.covariate.hasIndex) h+='<p><a href="/exams/suggestibility">Sit the expectancy index</a></p>';
          h+='<p class=prov>'+esc(d.covariate.source||'')+'</p>';
        }
        if(d.copy.retest&&d.copy.retest.text) h+='<h3>The second sitting</h3><p>'+esc(d.copy.retest.text)+'</p>';
        h+='<p class=prov>Sitting '+d.sessionNumber+'.</p>';
        box.innerHTML=h; box.scrollIntoView({behavior:'smooth'});
        $('progress').textContent='done';
      }).catch(function(){ $('progress').textContent='could not reach the server — nothing was saved.'; });
  }
})();`;

  return examShell(exam.name || 'The Thread Protocol', body, { extraCSS: css, extraJS: js });
}

export default {
  EXAM_ID, BLOCKS, PRESENTATION_SEC, GRID_STEPS, RHYTHM_BPM, RHYTHM_SUBDIVISION,
  RHYTHMS, HUES, SETS, SET_IDS, setById, INTENSITY, VALENCE, TIMING_POSTURE,
  PERMUTATIONS, REPEAT_ALPHA,
  patternEvents, buildRun, pearson, blockProfiles, repeatStatistic, peakStimulus,
  scoreSitting, resultCopy, threadPageHTML, esc,
};
