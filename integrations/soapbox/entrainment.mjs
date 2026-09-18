// entrainment.mjs — MELEK/Hathor original BRAINWAVE-ENTRAINMENT audio (binaural beats, isochronic
// tones, 40 Hz gamma, and iDoser-style "state" tracks). Sibling of music-catalog.mjs / radio.mjs in
// the SoapBox media layer, and surfaced the same way (a reader that returns shaped tracks; a surface
// maps them to tiles/rows).
//
// WHY THIS IS THE CLEAN, FULLY-LEGAL PATH: every track here is an ORIGINAL we synthesize from pure sine
// tones (see tools/generate-entrainment.sh). A sine wave is not copyrightable and nobody licenses it —
// so these files are OURS BY CONSTRUCTION (CC0, posture:'host', ours to serve). We do NOT ship, wrap,
// reference, or imitate iDoser's paid/copyrighted files or any pirated audio. The "state" tracks are
// named by the STATE they target (Focus / Energy / Calm / Meditate / Sleep / Ground) — never by drug
// names, and with NO "digital drug" claims.
//
// HONEST FRAMING (harm-reduction posture, no medical claims): brainwave entrainment is presented as a
// relaxation / focus aid, not a treatment. Every track carries SAFETY_NOTE and honest metadata
// (frequency, intended state, binaural vs. isochronic, whether headphones are needed).
//
//   • binaural  = stereo; a carrier in each ear differing by the target Hz. The "beat" is perceived,
//                 not present in either channel — so it REQUIRES HEADPHONES.
//   • isochronic = a single carrier amplitude-pulsed at the target Hz. Works on speakers, no headphones.
//
// Pattern matches radio.mjs / music-catalog.mjs: ESM, zero deps, keyless, pure + offline (no network,
// so no __setFetch needed), soft-fail-never-throw, esc() all interpolation, guarded CLI.
//
//   import { entrainmentTracks, byType, byState, toTile, renderList, dataNote, SAFETY_NOTE,
//            TYPES, STATES, esc } from './entrainment.mjs'
//   node integrations/soapbox/entrainment.mjs            # list the curated set

// The public base URL the generated audio is served from (deploy artifact — see tools/generate-
// entrainment.sh; the .opus files live on the SoapBox data host, not committed to this repo, exactly
// as music-catalog.mjs references freepd.com / archive.org URLs rather than rehosting bytes here).
// Override with ENTRAINMENT_BASE. A relative base (e.g. '/media/entrainment') also works when a surface
// serves the files from its own www dir.
export const ENTRAINMENT_BASE = String(
  process.env.ENTRAINMENT_BASE || 'https://pool.soapbox.community/media/entrainment',
).replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const TYPES = ['binaural', 'isochronic'];
export const STATES = ['Focus', 'Energy', 'Calm', 'Meditate', 'Sleep', 'Ground'];

// The single safety note shown on every entrainment track/surface. Honest, harm-reduction, no medical
// or "digital drug" claims.
export const SAFETY_NOTE =
  'For relaxation and focus only — not medical treatment, and no cure or drug-like effect is claimed. '
  + 'Do not listen while driving or operating machinery. If you have a history of epilepsy or seizures, '
  + 'or wear a pacemaker, talk to a doctor first. Binaural tracks need headphones; keep the volume gentle.';

// ── the curated set ─────────────────────────────────────────────────────────────────────────────────
// Each entry is the honest spec of one generated original. `beatHz` is the entrainment target; `carrier`
// is the audible tone it rides on. 40 Hz gamma leads (the band with the most real research). Duration is
// the generated loop length in seconds. `file` is the basename under ENTRAINMENT_BASE.
const SET = [
  {
    id: 'gamma-40hz-focus', state: 'Focus', beatHz: 40, carrier: 220, type: 'isochronic',
    blurb: '40 Hz gamma — the band tied to attention and cognition in the research literature. Pulsed, so it works on speakers.',
    duration: 120,
  },
  {
    id: 'beta-18hz-energy', state: 'Energy', beatHz: 18, carrier: 200, type: 'isochronic',
    blurb: 'Beta ~18 Hz — an alert, awake range for daytime work. Pulsed tone, no headphones needed.',
    duration: 120,
  },
  {
    id: 'alpha-10hz-calm', state: 'Calm', beatHz: 10, carrier: 200, type: 'binaural',
    blurb: 'Alpha ~10 Hz — the relaxed-but-awake range. Binaural, so use headphones.',
    duration: 120,
  },
  {
    id: 'theta-6hz-meditate', state: 'Meditate', beatHz: 6, carrier: 200, type: 'binaural',
    blurb: 'Theta ~6 Hz — a still, meditative / early-creative range. Binaural; headphones needed.',
    duration: 120,
  },
  {
    id: 'delta-2_5hz-sleep', state: 'Sleep', beatHz: 2.5, carrier: 150, type: 'isochronic',
    blurb: 'Delta ~2.5 Hz — the slow range associated with deep sleep. Low, softly-pulsed carrier.',
    duration: 120,
  },
  {
    id: 'schumann-7_83hz-ground', state: 'Ground', beatHz: 7.83, carrier: 136.1, type: 'binaural',
    blurb: 'Schumann 7.83 Hz — the "grounding" resonance, on a 136.1 Hz earth-tone carrier. Binaural; headphones.',
    duration: 120,
  },
];

/** Human band name for a target frequency (honest, coarse buckets). */
export function bandName(hz) {
  const f = Number(hz) || 0;
  if (f < 4) return 'Delta';
  if (f < 8) return 'Theta';       // 7.83 Schumann sits at the theta/alpha edge — labelled Theta
  if (f < 13) return 'Alpha';
  if (f < 30) return 'Beta';
  return 'Gamma';
}

/** Shape one spec into a served track. Pure; never throws. */
export function toTrack(spec) {
  if (!spec || !spec.id) return null;
  const label = `${spec.state} — ${spec.beatHz} Hz ${bandName(spec.beatHz)} (${spec.type})`;
  return {
    id: spec.id,
    title: label,
    state: spec.state,
    freqHz: spec.beatHz,
    carrierHz: spec.carrier,
    type: spec.type,                                  // 'binaural' | 'isochronic'
    headphones: spec.type === 'binaural',             // binaural REQUIRES headphones
    artist: 'Hathor',                                 // generated by Hathor (operator attribution rule)
    creator: 'Hathor',
    source: 'Hathor / MELEK (generated original)',
    license: 'CC0',                                   // pure sine tones — uncopyrightable, ours by construction
    posture: 'host',                                  // ours to serve
    streamUrl: `${ENTRAINMENT_BASE}/${spec.id}.opus`,
    duration: spec.duration || 120,
    loop: true,
    blurb: spec.blurb || '',
    safety: SAFETY_NOTE,
  };
}

/** The full curated set as shaped tracks. Deterministic, offline. */
export function entrainmentTracks() {
  return SET.map(toTrack).filter(Boolean);
}

/** Only binaural or only isochronic tracks. */
export function byType(type) {
  const t = String(type || '').toLowerCase();
  return entrainmentTracks().filter((x) => x.type === t);
}

/** Tracks for a target state (Focus/Calm/Sleep/…), case-insensitive. */
export function byState(state) {
  const s = String(state || '').toLowerCase();
  return entrainmentTracks().filter((x) => x.state.toLowerCase() === s);
}

// ── surface mapping ───────────────────────────────────────────────────────────────────────────────
/** Map a track → the generic tile shape site/tunein + site/stream use (host posture, direct audio). */
export function toTile(t) {
  return {
    key: `entrain:${t.id}`, kind: 'entrainment', title: t.title,
    meta: [`${t.freqHz} Hz`, t.type, t.headphones ? 'headphones' : 'speakers-ok'].join(' · '),
    poster: '', live: false, posture: 'host',
    watch: '', href: t.streamUrl, earn: '',
    artist: t.artist, safety: t.safety,
  };
}

/** A small, esc-safe HTML list with an inline <audio> player + the safety note (surface-embeddable). */
export function renderList(tracks = entrainmentTracks()) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (!list.length) return '<p class=empty>No entrainment tracks right now.</p>';
  const rows = list.map((t) => `<div class=entrain data-id="${esc(t.id)}">
    <div class=etitle>${esc(t.title)}</div>
    <div class=emeta>${esc(t.freqHz)} Hz · ${esc(t.type)} · by ${esc(t.artist)} · ${esc(t.license)}${t.headphones ? ' · use headphones' : ' · speakers OK'}</div>
    <div class=eblurb>${esc(t.blurb)}</div>
    <audio controls preload=none loop src="${esc(t.streamUrl)}"></audio>
  </div>`).join('');
  return `<section class="entrainment">
    <h2>Entrainment · focus &amp; calm <span class=byline>original tones by Hathor</span></h2>
    ${rows}
    <p class="safety-note">${esc(SAFETY_NOTE)}</p>
  </section>`;
}

/** Provenance / posture line. */
export function dataNote() {
  return 'Original brainwave-entrainment tones generated by Hathor from pure sine waves (CC0, ours to '
    + 'serve). Binaural beats need headphones; isochronic tones work on speakers. '
    + 'Relaxation/focus aid — not medical treatment.';
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('entrainment.mjs')) {
  const tracks = entrainmentTracks();
  console.log(`MELEK Entrainment — ${tracks.length} original track(s) by Hathor`);
  console.log('─'.repeat(64));
  for (const t of tracks) {
    console.log(`  ${t.title.padEnd(40)} ${t.type.padEnd(11)} ${t.headphones ? 'headphones' : 'speakers  '}  ${t.streamUrl}`);
  }
  console.log(`  ${dataNote()}`);
  console.log(`  SAFETY: ${SAFETY_NOTE}`);
}
