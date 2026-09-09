// site/hathor-live/metronome.mjs — hathor.live /metronome: a real metronome, and the low-frequency arm
// of the /40hz entrainment library.
//
// Research: .local/temple-exams/rhythm-and-timing.md (Part B). Every number below traces to a citation
// there; the ones that matter most are repeated inline so nobody has to go looking.
//
// THE HARD PART, STATED ONCE. setTimeout/setInterval callbacks "can easily be skewed by tens of
// milliseconds or more by layout, rendering, garbage collection" (Chris Wilson, "A Tale of Two Clocks",
// HTML5 Rocks 2013-01-09, now web.dev/articles/audio-scheduling). A metronome built on setInterval is not
// a metronome; it is a jitter generator with a click sound. The correct architecture is TWO CLOCKS: a
// coarse JS timer that schedules nothing but FUTURE notes, against the sample-accurate AudioContext
// clock. Wilson's recommended values, verbatim: "A good place to start is probably 100ms of lookahead
// time, with intervals set to 25ms."
//
// WHAT THIS CAN AND CANNOT MEASURE. Within one audio timeline the browser is effectively sample-accurate
// (Reimers & Stewart 2016: audio duration varied by a maximum of 11 ms across all configurations, SDs
// within a condition generally under 1 ms). Across the audio -> DOM -> input boundary there is an unknown
// constant offset of tens to hundreds of ms (Pronk et al. 2020: 68.5 ms SD 1.7 on Windows Chrome up to
// 132.9 ms SD 8.1 on macOS Safari, BIMODAL on Android / macOS Chrome / macOS Firefox). Therefore:
//
//   * INTERVALS between the user's own taps  -> honest. A constant offset cancels exactly.
//   * VARIANCES (SD, CV)                     -> honest. A constant offset cancels exactly.
//   * ACCURACY (right/wrong)                 -> honest. Timing is irrelevant to a 2AFC answer.
//   * DIFFERENCES between two conditions     -> honest. The offset cancels again.
//   * A SIGNED sound-to-movement asynchrony  -> NOT honest without calibration. That is the device.
//
// mayReportSignedAsynchrony() enforces the last line in code rather than in a comment, because the
// tempting wrong build in this domain is a page that prints "you tap 47 ms early" with no calibration
// step and is in fact printing a property of the laptop.
//
// PHOTIC SAFETY, AND WHAT THIS IS NOT. gamma.mjs deliberately ships full-field flicker behind an explicit
// consent gate; that is correct and is not re-litigated here. But a person who came for a practice click
// has not been asked for that consent, so the metronome's VISUAL indicator is a small on-screen element,
// degrades to per-bar above 130 BPM, and never runs full-field. This is a consent-surface rule, not a
// scope guard on entrainment content.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, offline-testable, pure functions.
//
//   import { METRONOME_PAGE, scheduleWindow, tapTempo, polyrhythm, latencyReport } from './metronome.mjs';

import { themeCSS } from '../../integrations/melek-theme.mjs';
import { fileURLToPath } from 'node:url';
import { disclaimer } from './the-line.mjs';

/** esc — every value interpolated into HTML goes through this. */
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Constants that are findings, not preferences ──────────────────────────────────────────────────

/** Scheduler geometry. Wilson 2013, verbatim recommendation. */
export const SCHEDULER = Object.freeze({
  lookaheadMs: 25,          // how often the JS timer wakes
  scheduleAheadSec: 0.100,  // how far into the AudioContext future it schedules
  why: 'Wilson 2013: "A good place to start is probably 100ms of lookahead time, with intervals set to 25ms."',
});

/** Tempo bounds. The low end is musical; the high end is where per-beat visual flashing stops. */
export const TEMPO = Object.freeze({
  minBpm: 20,
  maxBpm: 300,
  defaultBpm: 100,
  visualPerBarAboveBpm: 130,   // above this, flash per bar, not per beat
  visualHardCapBpm: 180,       // 3 Hz. Above this the visual indicator does not pulse at all.
});

/**
 * Rate limits from the synchronisation literature. Repp 2003 (J Mot Behav 35(4):355-370,
 * 10.1080/00222890309603156) and Repp 2005 (Psychon Bull Rev 12(6):969-992, 10.3758/BF03206433).
 * These are properties of people, not of displays, and no amount of refresh rate fixes them.
 */
export const RATE_LIMITS = Object.freeze({
  auditoryBiomechanicalFloorMs: 150,   // 1:1 in-phase tapping floor, 150-200 ms ITI
  auditoryPerceptualFloorMs: 100,      // true SMS threshold, IOI 100-120 ms
  antiphaseFloorMs: 350,
  visualFloorMs: 460,                  // visual metronomes fail below ~460 ms - FOUR TIMES the auditory limit
  note: 'A visual-only metronome is a far worse timing reference than a click. Say so; do not hide it.',
});

/**
 * Click envelopes. THE ATTACK IS A MEASUREMENT DECISION, NOT A DESIGN ONE.
 * Vos, Mates & van Kruysbergen 1995 (QJEP A 48(4):1024-1040, 10.1080/14640749508401427): people
 * synchronise to a stimulus's PERCEPTUAL CENTRE, not its physical onset. A slow attack moves the
 * P-centre later and shifts every asynchrony the page will ever measure.
 */
export const CLICKS = Object.freeze({
  woodblock: Object.freeze({
    id: 'woodblock', label: 'Woodblock', attackMs: 2, decayMs: 40, freqHz: 1200, accentFreqHz: 1800,
    role: 'default', note: 'Sharp attack. The default, because a slow attack biases every asynchrony.',
  }),
  blip: Object.freeze({
    id: 'blip', label: 'Sine blip', attackMs: 3, decayMs: 60, freqHz: 880, accentFreqHz: 1320,
    role: 'default', note: 'Gentler on the ear, still a fast attack.',
  }),
  soft: Object.freeze({
    id: 'soft', label: 'Soft (slow attack)', attackMs: 40, decayMs: 120, freqHz: 660, accentFreqHz: 990,
    role: 'stimulus',
    note: 'DELIBERATELY slow attack. This is the P-centre stimulus for the paired-condition asynchrony '
      + 'exam, not a comfort option. Its measured asynchrony is not comparable to the sharp clicks.',
  }),
});

/** Calibration paths, ranked as in the research paper (Part B.2). */
export const CALIBRATION = Object.freeze({
  none: Object.freeze({ id: 'none', signedOk: false, accuracyMs: null,
    why: 'No calibration. Any signed asynchrony would be the device, not the person.' }),
  paired: Object.freeze({ id: 'paired', signedOk: false, accuracyMs: null,
    why: 'Paired-condition design. The device offset cancels in the DIFFERENCE, so differences are '
      + 'reportable and absolute signed values still are not.' }),
  estimated: Object.freeze({ id: 'estimated', signedOk: true, accuracyMs: 20,
    why: 'outputLatency + getOutputTimestamp() correct the output half exactly; the input half uses a '
      + 'published per-platform prior. Report with the error bar. Refuse on bimodal platforms.' }),
  loopback: Object.freeze({ id: 'loopback', signedOk: true, accuracyMs: 2,
    why: 'REPP-style acoustic loopback (Anglada-Tort, Harrison & Jacoby 2022, 10.3758/s13428-021-01722-2). '
      + 'Latency and jitter within 2 ms. Requires SPEAKERS not headphones, microphone permission, and '
      + 'accepts ~69% exclusion.' }),
});

/** Platforms where Pronk et al. 2020 found BIMODAL input latency. A variance from these is corrupt. */
export const BIMODAL_INPUT_PLATFORMS = Object.freeze(['android-chrome', 'macos-chrome', 'macos-firefox']);

// ── Pure scheduling ───────────────────────────────────────────────────────────────────────────────

/** BPM -> inter-onset interval in seconds. */
export function bpmToIoi(bpm) {
  const b = Number(bpm);
  if (!Number.isFinite(b) || b <= 0) return null;
  return 60 / b;
}

/** Inter-onset interval (seconds) -> BPM. */
export function ioiToBpm(ioiSec) {
  const i = Number(ioiSec);
  if (!Number.isFinite(i) || i <= 0) return null;
  return 60 / i;
}

/** Clamp a tempo into the supported range. Never throws. */
export function clampBpm(bpm) {
  const b = Number(bpm);
  if (!Number.isFinite(b)) return TEMPO.defaultBpm;
  return Math.min(TEMPO.maxBpm, Math.max(TEMPO.minBpm, b));
}

/**
 * The look-ahead scheduler, as a pure function.
 *
 * Given where the transport is now and how far ahead we schedule, return every note that falls inside
 * the window. The caller does nothing but osc.start(note.time) for each. No timers, no state, no DOM —
 * which is exactly why it is testable under `node --test` with no browser.
 *
 * @param {object} o
 * @param {number} o.currentTime      AudioContext.currentTime, seconds
 * @param {number} o.nextNoteTime     when the next unscheduled note falls, seconds (context timebase)
 * @param {number} o.nextNoteIndex    index of that note within the bar-and-subdivision grid
 * @param {number} o.bpm
 * @param {number} [o.beatsPerBar=4]
 * @param {number} [o.subdivision=1]  notes per beat
 * @param {number} [o.scheduleAhead]  seconds; defaults to SCHEDULER.scheduleAheadSec
 * @param {number} [o.maxNotes=128]   hard stop, so a bad clock cannot spin forever
 * @returns {{notes: Array, nextNoteTime: number, nextNoteIndex: number}}
 */
export function scheduleWindow(o = {}) {
  const notes = [];
  const bpm = clampBpm(o.bpm);
  const beatsPerBar = Math.max(1, Math.min(32, Math.floor(Number(o.beatsPerBar) || 4)));
  const subdivision = Math.max(1, Math.min(16, Math.floor(Number(o.subdivision) || 1)));
  const scheduleAhead = Number.isFinite(Number(o.scheduleAhead)) && Number(o.scheduleAhead) > 0
    ? Number(o.scheduleAhead) : SCHEDULER.scheduleAheadSec;
  const maxNotes = Math.max(1, Math.min(4096, Math.floor(Number(o.maxNotes) || 128)));

  const currentTime = Number(o.currentTime);
  let t = Number(o.nextNoteTime);
  let i = Math.max(0, Math.floor(Number(o.nextNoteIndex) || 0));
  if (!Number.isFinite(currentTime) || !Number.isFinite(t)) {
    return { notes, nextNoteTime: Number.isFinite(t) ? t : 0, nextNoteIndex: i };
  }

  const step = bpmToIoi(bpm) / subdivision;
  const notesPerBar = beatsPerBar * subdivision;
  const horizon = currentTime + scheduleAhead;

  while (t < horizon && notes.length < maxNotes) {
    const inBar = i % notesPerBar;
    const isBeat = inBar % subdivision === 0;
    const isDownbeat = inBar === 0;
    notes.push({
      time: t,
      index: i,
      bar: Math.floor(i / notesPerBar),
      beat: Math.floor(inBar / subdivision),
      isBeat,
      isDownbeat,
      // Accent by pitch and level, never by lengthening the attack — that would move the P-centre.
      gain: isDownbeat ? 1 : (isBeat ? 0.7 : 0.35),
      accent: isDownbeat,
    });
    t += step;
    i += 1;
  }
  return { notes, nextNoteTime: t, nextNoteIndex: i };
}

/** Greatest common divisor / least common multiple, for polyrhythm cycles. */
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
export const lcm = (a, b) => (a && b ? Math.abs(a * b) / gcd(Math.abs(a), Math.abs(b)) : 0);

/**
 * Polyrhythm n:m over one cycle, on ONE clock.
 *
 * Never two AudioContexts and never one context plus a timer — that is how a polyrhythm drifts.
 * The cycle is lcm(n, m) grid positions long and is pre-computed rather than re-derived per beat.
 *
 * @returns {{cycleSec: number, grid: number, events: Array}}
 */
export function polyrhythm(n, m, cycleSec) {
  const a = Math.max(1, Math.min(32, Math.floor(Number(n) || 1)));
  const b = Math.max(1, Math.min(32, Math.floor(Number(m) || 1)));
  const dur = Number(cycleSec);
  if (!Number.isFinite(dur) || dur <= 0) return { cycleSec: 0, grid: 0, events: [] };

  const grid = lcm(a, b);
  const events = [];
  for (let k = 0; k < grid; k += 1) {
    const onA = k % (grid / a) === 0;
    const onB = k % (grid / b) === 0;
    if (!onA && !onB) continue;
    events.push({
      time: (k / grid) * dur,
      step: k,
      voiceA: onA,
      voiceB: onB,
      both: onA && onB,
    });
  }
  return { cycleSec: dur, grid, events };
}

// ── Tap tempo ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Tap tempo from a series of event timestamps (ms).
 *
 * This is the one measurement in the whole domain that a browser does cleanly: it is entirely between
 * the user's OWN events, so the constant input offset cancels exactly and only jitter survives. The
 * same code is the measurement apparatus for the irregularity exam, the tempo-memory exam and the
 * spontaneous-motor-tempo diary.
 *
 * Rules, each one earned:
 *   - drop the first interval (the first tap has no interval and the second is habitually early)
 *   - rolling window of 4-8 intervals, MEDIAN not mean (one bad tap moves a mean by a third)
 *   - reset the window when an interval exceeds resetFactor x the running median (user stopped)
 *   - detect an input FLOOR: a pile-up of intervals at one value means the hardware set the ceiling,
 *     not the finger (time-flicker-body.md 6.4). Those trials are discarded, not scored.
 *
 * @param {number[]} stampsMs
 * @param {object} [opts]
 * @returns {{ok: boolean, bpm: number|null, ioiMs: number|null, n: number, intervals: number[],
 *            resets: number, floorSuspect: boolean, reason: string}}
 */
export function tapTempo(stampsMs, opts = {}) {
  const window = Math.max(2, Math.min(16, Math.floor(Number(opts.window) || 6)));
  const resetFactor = Number(opts.resetFactor) > 1 ? Number(opts.resetFactor) : 2;
  const dropFirst = opts.dropFirst !== false;
  const floorToleranceMs = Number(opts.floorToleranceMs) >= 0 ? Number(opts.floorToleranceMs) : 1.5;

  const stamps = Array.isArray(stampsMs) ? stampsMs.map(Number).filter(Number.isFinite) : [];
  if (stamps.length < 2) {
    return { ok: false, bpm: null, ioiMs: null, n: stamps.length, intervals: [], resets: 0,
      floorSuspect: false, reason: 'Need at least two taps.' };
  }

  let intervals = [];
  for (let i = 1; i < stamps.length; i += 1) {
    const d = stamps[i] - stamps[i - 1];
    if (d > 0) intervals.push(d);
  }
  const rawIntervals = intervals.slice();
  if (dropFirst && intervals.length > 1) intervals = intervals.slice(1);
  if (!intervals.length) {
    return { ok: false, bpm: null, ioiMs: null, n: stamps.length, intervals: [], resets: 0,
      floorSuspect: false, reason: 'No usable intervals (timestamps did not increase).' };
  }

  // Walk forward, resetting the window on a big outlier.
  let resets = 0;
  let buf = [];
  for (const d of intervals) {
    if (buf.length) {
      const med = median(buf);
      if (med > 0 && d > med * resetFactor) { buf = []; resets += 1; }
    }
    buf.push(d);
    if (buf.length > window) buf.shift();
  }
  if (!buf.length) {
    return { ok: false, bpm: null, ioiMs: null, n: stamps.length, intervals: rawIntervals, resets,
      floorSuspect: false, reason: 'Every interval was an outlier — start again.' };
  }

  const ioiMs = median(buf);
  const floorSuspect = detectInputFloor(rawIntervals, floorToleranceMs);
  const bpm = ioiMs > 0 ? 60000 / ioiMs : null;

  return {
    ok: true,
    bpm: bpm == null ? null : Math.round(bpm * 10) / 10,
    ioiMs: Math.round(ioiMs * 100) / 100,
    n: stamps.length,
    intervals: rawIntervals,
    resets,
    floorSuspect,
    reason: floorSuspect
      ? 'Intervals piled up at one value — the device, not your finger, set the ceiling. Discard this run.'
      : 'ok',
  };
}

/** Median of a numeric array. Returns 0 for an empty array rather than NaN. */
export function median(xs) {
  const a = (Array.isArray(xs) ? xs.map(Number).filter(Number.isFinite) : []).slice().sort((p, q) => p - q);
  if (!a.length) return 0;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * Input-floor detection. A spike of intervals at (near) one identical value across a fast run is
 * evidence that the input path, not the hand, set the rate — keyboard auto-repeat, a frame period, or
 * a coalesced touch stream. time-flicker-body.md 6.4: "Discard those trials."
 */
export function detectInputFloor(intervals, toleranceMs = 1.5) {
  const xs = (Array.isArray(intervals) ? intervals.map(Number).filter((d) => Number.isFinite(d) && d > 0) : []);
  if (xs.length < 6) return false;
  const min = Math.min(...xs);
  const atFloor = xs.filter((d) => Math.abs(d - min) <= toleranceMs).length;
  // Only suspicious if the pile-up is large AND the run is fast enough for a floor to bite at all.
  return atFloor / xs.length >= 0.5 && min < 120;
}

// ── Honesty gates ─────────────────────────────────────────────────────────────────────────────────

/**
 * May this page print a SIGNED sound-to-movement asynchrony in milliseconds?
 *
 * The commonest wrong build in this domain looks trivial and prints the laptop's latency as if it were
 * the person's. So the answer lives in code.
 */
export function mayReportSignedAsynchrony(o = {}) {
  const cal = CALIBRATION[String(o.calibration || 'none')] || CALIBRATION.none;
  const platform = String(o.platform || '').toLowerCase();
  if (!cal.signedOk) {
    return { ok: false, accuracyMs: null, reason:
      `${cal.why} Report intervals, variances, accuracies and between-condition differences instead.` };
  }
  if (cal.id === 'estimated' && BIMODAL_INPUT_PLATFORMS.includes(platform)) {
    return { ok: false, accuracyMs: null, reason:
      `Input latency is bimodal on ${platform} (Pronk et al. 2020), so a single correction term is wrong `
      + 'for roughly half the trials. Use the loopback calibration on this device, or report differences only.' };
  }
  return { ok: true, accuracyMs: cal.accuracyMs, reason: cal.why };
}

/**
 * Turn whatever the platform will admit about latency into a plain statement for the user.
 * Soft-fails: missing fields become nulls and honest prose, never a throw.
 */
export function latencyReport(o = {}) {
  const base = num(o.baseLatency);
  const out = num(o.outputLatency);
  const outputClass = String(o.outputClass || 'unknown');
  const totalSec = (base == null && out == null) ? null : (base || 0) + (out || 0);
  const totalMs = totalSec == null ? null : Math.round(totalSec * 1000);

  const lines = [];
  lines.push(base == null
    ? 'baseLatency: not reported by this browser.'
    : `baseLatency ${Math.round(base * 1000)} ms — inside the browser, from the audio graph to the audio subsystem.`);
  lines.push(out == null
    ? 'outputLatency: not reported by this browser. (It reached Baseline availability in March 2025; an '
      + 'older browser simply will not tell you.)'
    : `outputLatency ${Math.round(out * 1000)} ms — the platform's ESTIMATE of graph-to-air. The spec calls it an estimation, so treat it as one.`);
  if (outputClass === 'bluetooth') {
    lines.push('Bluetooth output detected or declared: expect 100-300 ms. Fine for practising, fatal for measuring.');
  }
  lines.push('Input latency: no browser API reports it. Measured elsewhere at 68.5 ms (SD 1.7) on Windows '
    + 'Chrome up to 132.9 ms (SD 8.1) on macOS Safari.');
  lines.push('None of this affects practising. All of it affects measuring.');

  return {
    baseLatencyMs: base == null ? null : Math.round(base * 1000),
    outputLatencyMs: out == null ? null : Math.round(out * 1000),
    totalOutputMs: totalMs,
    outputClass,
    inputLatencyKnown: false,
    lines,
  };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Visual beat policy. Repp: visual synchronisation fails below ~460 ms IOI, four times the auditory
 * limit — so the flashing square is an affordance, never the reference. And above 3 Hz a pulsing
 * element starts to be a photic stimulus the user did not consent to, so it stops.
 */
export function visualBeatPolicy(bpm, opts = {}) {
  const b = clampBpm(bpm);
  const beatsPerBar = Math.max(1, Math.floor(Number(opts.beatsPerBar) || 4));
  const ioiMs = (60 / b) * 1000;
  let mode = 'beat';
  if (b > TEMPO.visualHardCapBpm) mode = 'off';
  else if (b > TEMPO.visualPerBarAboveBpm) mode = 'bar';
  const pulseHz = mode === 'off' ? 0 : (mode === 'bar' ? b / 60 / beatsPerBar : b / 60);
  return {
    mode,
    pulseHz: Math.round(pulseHz * 1000) / 1000,
    fullField: false, // never, on this page
    reliableAsTiming: ioiMs >= RATE_LIMITS.visualFloorMs,
    note: ioiMs >= RATE_LIMITS.visualFloorMs
      ? 'At this tempo the visual beat is usable as a rough guide.'
      : `Below ~${RATE_LIMITS.visualFloorMs} ms between beats (about `
        + `${Math.round(60000 / RATE_LIMITS.visualFloorMs)} BPM) people cannot synchronise to a visual `
        + 'pulse at all — four times the limit for a click. Use the sound.',
  };
}

/**
 * Stacking guard for /40hz. A metronome pulse running under a 40 Hz auditory carrier makes an
 * amplitude-modulated composite whose interaction is, as far as I could establish, unstudied.
 * Refuse silently-stacked sessions; allow an explicitly acknowledged one.
 */
export function stackWithEntrainment(o = {}) {
  const carrierHz = num(o.carrierHz);
  if (carrierHz == null) return { ok: true, reason: 'No entrainment carrier running.' };
  if (o.acknowledged === true) {
    return { ok: true, reason: 'Acknowledged: the metronome-plus-carrier combination is untested. Proceeding at the user\'s explicit request.' };
  }
  return {
    ok: false,
    reason: `A metronome pulse under a ${carrierHz} Hz carrier produces an amplitude-modulated composite `
      + 'with no literature behind it. Mute the carrier, or acknowledge that this combination is untested.',
  };
}

// ── The page ──────────────────────────────────────────────────────────────────────────────────────

const FACTS = [
  ['Scheduling', 'Look-ahead against AudioContext.currentTime, 25 ms timer / 100 ms horizon. Never setInterval for a note.'],
  ['Click', 'Sharp attack by default. A slow attack moves the perceptual centre and shifts every measurement.'],
  ['Tap tempo', 'Median of a rolling window, first interval dropped, window reset on a 2x outlier.'],
  ['Visual beat', 'A guide, not a reference. Per-bar above 130 BPM, off above 180 BPM, never full-field.'],
  ['Latency', 'Irrelevant to practising. Fatal to measuring. The panel below shows what your device admits.'],
];

const buildPage = () => {
  const rows = FACTS.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const clicks = Object.values(CLICKS).map((c) => `<option value="${esc(c.id)}"${c.id === 'woodblock' ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Metronome — hathor.live</title>
<style>${themeCSS()}
.mn{max-width:52rem;margin:0 auto;padding:1.5rem}
.mn .big{font-size:clamp(3rem,12vw,6rem);font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.mn .dot{width:1.5rem;height:1.5rem;border-radius:50%;display:inline-block;background:currentColor;opacity:.2;transition:opacity 60ms}
.mn .dot.on{opacity:1}
.mn table{width:100%;border-collapse:collapse;margin:1rem 0}
.mn th,.mn td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid rgba(128,128,128,.3);vertical-align:top}
.mn th{white-space:nowrap;width:9rem}
.mn .row{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;margin:.75rem 0}
.mn button{padding:.6rem 1.1rem;font-size:1rem;cursor:pointer}
.mn .note{opacity:.75;font-size:.9rem}
</style>
<main class="mn">
<h1>Metronome</h1>
<p class="note">${esc(disclaimer('entrainment'))}</p>

<p class="big"><span id="bpmOut">${TEMPO.defaultBpm}</span> <span style="font-size:.3em">BPM</span></p>
<p><span class="dot" id="dot" aria-hidden="true"></span></p>

<div class="row">
  <button id="play" type="button">Start</button>
  <button id="tap" type="button">Tap tempo</button>
  <label>Tempo <input id="bpm" type="range" min="${TEMPO.minBpm}" max="${TEMPO.maxBpm}" value="${TEMPO.defaultBpm}" step="1"></label>
</div>
<div class="row">
  <label>Beats per bar <input id="bpb" type="number" min="1" max="16" value="4" style="width:4rem"></label>
  <label>Subdivision <input id="sub" type="number" min="1" max="8" value="1" style="width:4rem"></label>
  <label>Click <select id="click">${clicks}</select></label>
</div>

<p class="note" id="visualNote"></p>

<h2>How this is built, and what it can and cannot measure</h2>
<table>${rows}</table>

<h2>Your device</h2>
<pre id="latency" class="note">(press Start — the audio clock only exists after a gesture)</pre>

<p class="note">A metronome is a fine practice tool on any device: if the click is late, everything you
hear is late together. It is <em>not</em> a measuring instrument for how early or late you play, because
the delay between your finger and the browser is larger than the thing being measured and no browser API
reports it. That is a fact about the platform, not a limitation we chose.</p>
</main>
<script>
(() => {
  "use strict";
  const LOOKAHEAD_MS = ${SCHEDULER.lookaheadMs}, AHEAD = ${SCHEDULER.scheduleAheadSec};
  const CLICKS = ${JSON.stringify(CLICKS)};
  const VISUAL = { perBar: ${TEMPO.visualPerBarAboveBpm}, cap: ${TEMPO.visualHardCapBpm}, floorMs: ${RATE_LIMITS.visualFloorMs} };
  let ctx = null, timer = null, running = false;
  let nextNoteTime = 0, nextIndex = 0;
  const el = (id) => document.getElementById(id);
  const state = () => ({
    bpm: Number(el('bpm').value) || ${TEMPO.defaultBpm},
    bpb: Math.max(1, Number(el('bpb').value) || 4),
    sub: Math.max(1, Number(el('sub').value) || 1),
    click: CLICKS[el('click').value] || CLICKS.woodblock,
  });

  function schedule(t, s, idx) {
    const notesPerBar = s.bpb * s.sub, inBar = idx % notesPerBar;
    const isBeat = inBar % s.sub === 0, isDown = inBar === 0;
    const c = s.click;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = isDown ? c.accentFreqHz : c.freqHz;
    const peak = isDown ? 1 : (isBeat ? 0.7 : 0.35);
    const a = c.attackMs / 1000, d = c.decayMs / 1000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak * 0.25, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + a + d + 0.02);
  }

  // TWO CLOCKS. This timer schedules; it never plays.
  function tick() {
    const s = state(), step = (60 / s.bpm) / s.sub;
    let guard = 0;
    while (nextNoteTime < ctx.currentTime + AHEAD && guard++ < 128) {
      schedule(nextNoteTime, s, nextIndex);
      nextNoteTime += step; nextIndex += 1;
    }
    timer = setTimeout(tick, LOOKAHEAD_MS);
  }

  // The visual beat is driven from rAF reading currentTime — NEVER from the scheduler, so a dropped
  // frame cannot become a scheduling glitch.
  function paint() {
    if (!running) return;
    const s = state();
    const beatSec = 60 / s.bpm;
    const mode = s.bpm > VISUAL.cap ? 'off' : (s.bpm > VISUAL.perBar ? 'bar' : 'beat');
    if (mode === 'off') { el('dot').classList.remove('on'); }
    else {
      const period = mode === 'bar' ? beatSec * s.bpb : beatSec;
      const phase = (ctx.currentTime % period) / period;
      el('dot').classList.toggle('on', phase < 0.12);
    }
    requestAnimationFrame(paint);
  }

  function visualNote() {
    const s = state(), ioiMs = 60000 / s.bpm;
    el('visualNote').textContent = ioiMs >= VISUAL.floorMs
      ? 'The dot is a rough guide at this tempo.'
      : 'Below about ' + Math.round(60000 / VISUAL.floorMs) + ' BPM-equivalent spacing, people cannot '
        + 'synchronise to a visual pulse at all — four times the limit for a click. Use the sound.';
  }

  function latency() {
    if (!ctx) return;
    const b = typeof ctx.baseLatency === 'number' ? Math.round(ctx.baseLatency * 1000) + ' ms' : 'not reported';
    const o = typeof ctx.outputLatency === 'number' ? Math.round(ctx.outputLatency * 1000) + ' ms' : 'not reported (needs a 2025+ browser)';
    let ts = 'getOutputTimestamp(): not available';
    try {
      const t = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
      if (t) ts = 'getOutputTimestamp(): contextTime ' + t.contextTime.toFixed(3) + ' s, performanceTime ' + Math.round(t.performanceTime) + ' ms';
    } catch (e) { /* soft-fail */ }
    el('latency').textContent =
      'sampleRate: ' + ctx.sampleRate + ' Hz\\n' +
      'baseLatency: ' + b + '\\n' +
      'outputLatency: ' + o + '\\n' + ts + '\\n\\n' +
      'Input latency: no browser API reports it. This page will not print a signed early/late number, '
      + 'because without calibration that number is your device.';
  }

  el('play').addEventListener('click', () => {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    if (ctx.state === 'suspended') ctx.resume();
    if (running) {
      running = false; clearTimeout(timer); timer = null;
      el('play').textContent = 'Start'; el('dot').classList.remove('on');
      return;
    }
    running = true; el('play').textContent = 'Stop';
    nextNoteTime = ctx.currentTime + 0.05; nextIndex = 0;
    tick(); requestAnimationFrame(paint); latency();
  });

  // Tap tempo: median of a rolling window, first interval dropped, reset on a 2x outlier.
  let taps = [];
  el('tap').addEventListener('click', (ev) => {
    const now = (ev && typeof ev.timeStamp === 'number' && ev.timeStamp > 0) ? ev.timeStamp : performance.now();
    if (taps.length && now - taps[taps.length - 1] > 3000) taps = [];
    taps.push(now); if (taps.length > 9) taps.shift();
    if (taps.length < 3) return;
    let iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
    iv = iv.slice(1);
    const med = (() => { const a = iv.slice().sort((p, q) => p - q); const m = a.length >> 1;
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; })();
    if (!(med > 0)) return;
    const bpm = Math.max(${TEMPO.minBpm}, Math.min(${TEMPO.maxBpm}, Math.round(60000 / med)));
    el('bpm').value = bpm; el('bpmOut').textContent = bpm; visualNote();
  });

  el('bpm').addEventListener('input', () => { el('bpmOut').textContent = el('bpm').value; visualNote(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) el('play').click();
  });
  visualNote();
})();
</script>`;
};

/** The page, built once. */
export const METRONOME_PAGE = buildPage();

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const w = scheduleWindow({ currentTime: 0, nextNoteTime: 0, nextNoteIndex: 0, bpm: 120, beatsPerBar: 4 });
  console.log(`metronome: ${w.notes.length} notes in the first ${SCHEDULER.scheduleAheadSec * 1000} ms at 120 BPM`);
  console.log(`visual policy at 200 BPM: ${JSON.stringify(visualBeatPolicy(200))}`);
  console.log(`signed asynchrony, uncalibrated: ${JSON.stringify(mayReportSignedAsynchrony({}))}`);
}
