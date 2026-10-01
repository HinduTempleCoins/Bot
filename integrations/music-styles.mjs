// integrations/music-styles.mjs — STYLE RECIPES for Hathor Sandalphon: the prompt wording that actually
// gets a style right, written down once so every song and every surface uses the same words.
//
// WHY THIS FILE EXISTS. A song engine is only as good as the words you hand it. Some styles come out
// right from two words ("traditional hymn, pipe organ"); others fall apart unless you describe the SHAPE
// of the music in time. The drop in dubstep is the famous example and the one AI music is worst at: the
// engine will happily make a wobble bass and then never build to anything, because nothing in the prompt
// told it that the whole point is tension, a gap, and a landing.
//
// WHAT A DROP ACTUALLY IS (the thing to encode):
//   • the build, 8–16 bars: a riser climbing, the snare roll shortening (1/4 → 1/8 → 1/16 → 1/32),
//     the filter opening, and the sub-bass LEAVING so the low end is empty;
//   • the gap: a beat or two of near silence at the end of the last bar — taking the low end away is
//     what makes the next one land. No gap, no drop;
//   • the drop itself: kick on 1, snare on 3, the wobble in front, at full volume, in HALF TIME while
//     the tempo has not changed — that is where the weight comes from;
//   • the bass in two layers: a near-sine sub under 60 Hz carrying the weight, and a mid-bass above it
//     doing the movement — the wobble is an LFO on the filter cutoff, synced at 1/4 for a steady groove
//     and switched to 1/8 or 1/16 for the frantic bars.
//
// Sources behind the wording: standard dubstep arrangement practice (build → gap → half-time drop),
// and LFO-to-filter wobble design. Encoded as prompt text, not as a sample pack — we synthesise.
//
//   import { styleFor, STYLES, dropPrompt, LYRIC_DROP_MARKERS } from './music-styles.mjs'

/** the structural words that make an engine build and land, rather than loop */
export const DROP_SHAPE =
  'clear song structure: 16-bar build with a rising riser, snare roll accelerating from eighths to '
  + 'sixteenths to thirty-seconds, filter opening, sub-bass dropping out, then one beat of near silence, '
  + 'then the drop lands at full volume in half-time feel with kick on one and snare on three';

/** the sound-design words for the bass itself */
export const WOBBLE_SOUND =
  'two-layer bass: clean sine sub under 60 Hz for weight, growling mid-bass wobble above it, '
  + 'LFO on the filter cutoff synced to the beat, quarter-note wobble in the groove bars and '
  + 'sixteenth-note wobble in the frantic bars';

export const STYLES = {
  dubstep: {
    label: 'Dubstep',
    bpm: 140,
    prompt: `dubstep, 140 bpm, half-time drums, ${WOBBLE_SOUND}, ${DROP_SHAPE}, heavy, dark, wide stereo, clean low end`,
    note: 'Half-time at 140 bpm is the genre: the drums feel like 70 while the tempo is 140.',
  },
  'riddim-dubstep': {
    label: 'Riddim dubstep',
    bpm: 150,
    prompt: `riddim dubstep, 150 bpm, half-time, relentless triplet wobble bass, ${DROP_SHAPE}, minimal, hypnotic, heavy`,
    note: 'Riddim lives on repetition — the same short bass phrase, bar after bar.',
  },
  'melodic-dubstep': {
    label: 'Melodic dubstep',
    bpm: 150,
    prompt: `melodic dubstep, 150 bpm, piano and pad intro, soaring female vocal, ${DROP_SHAPE}, `
      + 'the drop is melodic rather than only heavy: supersaw lead over half-time drums, emotional, uplifting',
    note: 'The drop carries a tune, not only bass.',
  },
  'gospel-dubstep': {
    label: 'Gospel dubstep',
    bpm: 140,
    prompt: `dubstep with a gospel choir, 140 bpm, hammond organ and handclaps in the build, `
      + `${DROP_SHAPE}, the choir holds a long chord through the gap and the drop lands under it, `
      + `${WOBBLE_SOUND}, triumphant, heavy, joyful`,
    note: 'Ours: the choir carries the gap, so the drop lands under a held chord instead of silence.',
  },
  'ancient-dubstep': {
    label: 'Ancient dubstep',
    bpm: 140,
    prompt: `dubstep built on ancient instruments, 140 bpm, lyre and ney and frame drums in the build, `
      + `shofar as the riser, ${DROP_SHAPE}, the drop replaces the synth with deep gongs and bronze drums, `
      + `${WOBBLE_SOUND}, ceremonial, enormous`,
    note: 'Ours: the gong IS the sub — struck bronze and a sub-bass are the same physics.',
  },
};

/** the structure markers that go in the LYRICS, where an engine reads form */
export const LYRIC_DROP_MARKERS = ['[intro]', '[build]', '[drop]', '[verse]', '[chorus]', '[bridge]', '[breakdown]', '[outro]'];

/** a ready style string, with anything extra appended */
export function styleFor(id, extra = '') {
  const s = STYLES[String(id || '').toLowerCase()];
  if (!s) return '';
  return extra ? `${s.prompt}, ${String(extra).slice(0, 200)}` : s.prompt;
}

/** a drop-shaped style for any genre — the shape is the part engines miss */
export function dropPrompt(genre, { bpm = 140, extra = '' } = {}) {
  const g = String(genre || 'electronic').slice(0, 80);
  return `${g}, ${Math.max(60, Math.min(200, Math.round(Number(bpm) || 140)))} bpm, ${DROP_SHAPE}, ${WOBBLE_SOUND}${extra ? `, ${String(extra).slice(0, 200)}` : ''}`;
}

/** a lyric skeleton that puts the form where the engine reads it */
export function dropLyricSkeleton({ build = '', drop = '', verse = '' } = {}) {
  return [
    '[intro]', verse || '', '',
    '[build]', build || '', '',
    '[drop]', drop || '', '',
  ].join('\n').trim();
}
