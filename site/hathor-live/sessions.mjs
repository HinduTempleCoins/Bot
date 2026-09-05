// site/hathor-live/sessions.mjs — the entrainment session library (iDoser-style catalogue).
//
// Each session is a PROGRAM: an ordered list of {hz, secs} steps. A step holding one frequency is a
// plain session; a sequence of descending steps is a ramp (which is how the sleep literature actually
// delivers it — 8Hz down to 2Hz, mirroring the natural alpha→theta→delta descent).
//
// EVIDENCE GRADING IS PART OF THE DATA, not a footnote. Every session carries `grade` and `evidence`,
// because most of this market sells frequency-specific claims that the literature does not support.
// Grades:
//   'strong'       — mechanistic work + human trials + a pivotal trial in progress
//   'moderate'     — replicated human effects, verified entrainment, outcomes often self-reported
//   'promising'    — small studies, real entrainment shown, outcomes preliminary
//   'weak'         — poor or inconsistent evidence; included because people ask for it, labelled honestly
//   'traditional'  — no clinical evidence at all; cultural//historical provenance only
//
// SAFETY, THE PART THAT MATTERS: the most provocative photic band is 15–25Hz — NOT 40Hz. IFCM
// photosensitivity ranges: 8–40Hz on eye closure, 15–20Hz eyes closed, 18Hz eyes open. So any session
// whose visual channel sits in 13–26Hz is flagged `photicRisk:'high'` and the UI must treat it as such.
// Audio carries no photic seizure risk at any frequency.
//
//   import { SESSIONS, CATEGORIES, byCategory, totalSeconds, peakHz, photicRisk } from './sessions.mjs'

// The high-risk photic band, inclusive. Derived from the IFCM/EEG-lab figures above, widened slightly
// at both ends because individual photosensitivity thresholds vary.
export const PHOTIC_HIGH_RISK = [13, 26];

export const CATEGORIES = [
  { id: 'gamma',      name: 'Gamma / Cognition', blurb: 'The 40Hz research line. The strongest evidence in the whole field.' },
  { id: 'pain',       name: 'Pain',              blurb: 'Alpha entrainment. Dose-response has been shown.' },
  { id: 'sleep',      name: 'Sleep',             blurb: 'Descending ramps that mirror the natural descent into sleep.' },
  { id: 'calm',       name: 'Calm / Anxiety',    blurb: 'Theta and delta. The largest anxiety effect in the binaural literature.' },
  { id: 'focus',      name: 'Focus',             blurb: 'Beta and SMR. Weakest evidence, highest photic risk — read the warnings.' },
  { id: 'meditation', name: 'Meditation',        blurb: 'Theta states. Long tradition, thin clinical evidence.' },
  { id: 'chamber',    name: 'The Chamber',       blurb: 'Full-field, enclosed, ~12 minutes. The context IS the intervention.' },
  { id: 'training',   name: 'Perceptual Training', blurb: 'Strobe used the OTHER way: intermittent occlusion to train the visual system, not to entrain it.' },
  { id: 'visionary',  name: 'Visionary',         blurb: 'Alpha-band flicker with the eyes CLOSED — the Dreamachine effect.' },
];

export const SESSIONS = [
  // ── gamma ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'genus-40', name: 'GENUS 40', category: 'gamma',
    method: 'combined', carrier: 440,
    program: [{ hz: 40, secs: 3600 }],
    grade: 'strong',
    evidence: 'The clinical protocol: 40Hz, one hour, daily. Phase 2A over 3 months in mild probable '
      + "Alzheimer's showed lesser ventricular dilation and hippocampal atrophy, increased default-mode "
      + 'connectivity and better face-name delayed recall vs control. 670-participant pivotal trial (HOPE, '
      + 'NCT05637801) has completed enrolment.',
    note: 'The full protocol is an hour. Shorter runs have not been tested for the same outcomes.',
  },
  {
    id: 'genus-40-short', name: 'GENUS 40 · short', category: 'gamma',
    method: 'auditory', carrier: 440,
    program: [{ hz: 40, secs: 900 }],
    grade: 'promising',
    evidence: '40Hz auditory stimuli produced the highest EEG response and increased regional cerebral '
      + 'blood flow in healthy participants. Fifteen minutes is a practical dose, not the trial dose.',
  },

  // ── pain ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'alpha-10-pain', name: 'Alpha 10 · pain', category: 'pain',
    method: 'combined', carrier: 340,
    program: [{ hz: 10, secs: 1200 }],
    grade: 'moderate',
    evidence: 'Four minutes of 10Hz sensory stimulation entrains alpha and decreases pain, and the degree '
      + 'of frontal alpha power increase CORRELATES with the pain reduction — a dose-response relationship. '
      + 'A 2025 randomised crossover trial (Journal of Pain) ran two weeks of active vs sham pre-sleep '
      + 'stimulation at home in fibromyalgia: alpha power was enhanced under active vs sham, with '
      + 'self-reported improvement in pain and sleep.',
  },

  // ── sleep ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'descent-8-2', name: 'Descent 8→2', category: 'sleep',
    method: 'auditory', carrier: 200,
    program: [
      { hz: 8, secs: 300 }, { hz: 6, secs: 300 }, { hz: 5, secs: 300 },
      { hz: 4, secs: 300 }, { hz: 3, secs: 300 }, { hz: 2, secs: 600 },
    ],
    grade: 'promising',
    evidence: 'Audio-visual stimulation descending from 8Hz to 2Hz achieved entrainment and improved both '
      + 'pain and insomnia symptoms in chronic-pain participants. The ramp mirrors the natural '
      + 'alpha→theta→delta descent rather than holding one frequency.',
    note: 'Audio-only by default so you can run it with your eyes shut and let it end without you.',
  },
  {
    id: 'alpha-presleep', name: 'Pre-sleep Alpha', category: 'sleep',
    method: 'auditory', carrier: 300,
    program: [{ hz: 10, secs: 600 }, { hz: 8, secs: 600 }],
    grade: 'moderate',
    evidence: 'The pre-sleep arm of the 2025 fibromyalgia crossover trial — 10Hz delivered at home before '
      + 'sleep, verified by enhanced alpha spectral power against sham.',
  },

  // ── calm ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'theta-6-calm', name: 'Theta 6 · calm', category: 'calm',
    method: 'auditory', carrier: 240,
    program: [{ hz: 6, secs: 1200 }],
    grade: 'moderate',
    evidence: 'Theta/delta binaural beats carry the largest anxiety effect in the meta-analytic literature: '
      + "Hedges' g = 0.69 (medium-to-large) across five effect sizes in four studies, total N=159. Small N — "
      + 'directional. Overall binaural-beat effect across cognition, anxiety and pain: g = 0.45.',
  },
  {
    id: 'periprocedural', name: 'Before a Procedure', category: 'calm',
    method: 'binaural', carrier: 250,
    program: [{ hz: 6, secs: 1800 }],
    grade: 'moderate',
    evidence: 'A 2025 systematic review and meta-analysis of 15 RCTs (>1,000 patients) found perioperative '
      + 'binaural-beat audio significantly reduced anxiety, postoperative pain, systolic blood pressure and '
      + 'heart rate — and outperformed non-binaural "placebo" music head-to-head. A separate 2025 review of '
      + '9 dental trials found significant reduction in dental anxiety.',
    note: 'Binaural — needs headphones. This is the one clinical use where binaural specifically was tested.',
  },

  // ── focus ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'smr-14', name: 'SMR 14', category: 'focus',
    method: 'auditory', carrier: 320,
    program: [{ hz: 14, secs: 1500 }],
    grade: 'weak',
    evidence: 'Cognitive effects are the least consistent finding in the entrainment literature. Binaural '
      + 'beats are not a reliable tool for concentration; they appear to help some people under some '
      + 'conditions. Included because it is asked for, graded honestly.',
    note: 'AUDIO ONLY by default. 14Hz sits inside the 15-25Hz photic danger band once you add light.',
  },

  // ── meditation ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'theta-4-deep', name: 'Theta 4 · deep', category: 'meditation',
    method: 'auditory', carrier: 210,
    program: [{ hz: 8, secs: 300 }, { hz: 6, secs: 600 }, { hz: 4, secs: 900 }],
    grade: 'promising',
    evidence: 'Theta (4-8Hz) is the band of the wake-sleep boundary — daydreaming and meditative states. '
      + 'Entrainment into it is demonstrable; that it produces the *contents* of meditation is not.',
  },
  {
    id: 'schumann', name: 'Schumann 7.83', category: 'meditation',
    method: 'auditory', carrier: 220,
    program: [{ hz: 7.83, secs: 1800 }],
    grade: 'traditional',
    evidence: 'The 7.83Hz Schumann resonance is REAL and well documented geophysics — the fundamental of '
      + 'the Earth-ionosphere cavity (Schumann 1952; Rycroft et al. 2000; Harrison 2013 on the Carnegie '
      + 'curve), and it does fall at the theta-alpha boundary of human brainwave frequencies. What has NO '
      + 'clinical evidence is the separate claim that playing a 7.83Hz tone through headphones confers a '
      + 'health benefit. Those are two different propositions and this grade concerns only the second. '
      + 'Any effect from this session is most likely a plain alpha-band effect.',
    note: 'Graded on the audio-playback claim, not on the geophysics. See the Conserved Library paper '
      + '(knowledge/consciousness/conserved_library_genome_to_cosmos.json, §6) for the continuous-circuit '
      + 'framework from ion channel to ionosphere.',
  },

  // ── chamber ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'chamber-alpha', name: 'Chamber · Alpha', category: 'chamber',
    method: 'combined', carrier: 260,
    program: [{ hz: 10, secs: 690 }],
    grade: 'moderate',
    chamber: true,
    evidence: 'The protocol from Cone et al., npj Digital Medicine, 28 March 2026 (n=74): synchronised '
      + 'rhythmic light and audio at 9-11Hz, 11.5 minutes, inside an immersive reflective chamber. '
      + 'Produced substantial acute improvement in anxiety, mood disturbance, flow states and vitality, '
      + 'with STAI state-anxiety reduction reaching magnitudes comparable to established pharmacological '
      + 'and psychotherapeutic interventions requiring far longer treatment.',
    note: 'The study found alpha and theta arms performed EQUIVALENTLY — the immersive context, not the '
      + 'frequency, is a primary active ingredient. Run this fullscreen, in a dark room, with headphones.',
  },
  {
    id: 'chamber-theta', name: 'Chamber · Theta', category: 'chamber',
    method: 'combined', carrier: 220,
    program: [{ hz: 6, secs: 690 }],
    grade: 'moderate',
    chamber: true,
    evidence: 'The theta arm (4-7Hz) of the same 2026 chamber study. It performed equivalently to the '
      + 'alpha arm — which is the finding, not a footnote. Offered so you can test the equivalence '
      + 'yourself rather than take it on trust.',
    note: 'Same protocol, different band. If you notice a difference between this and Chamber · Alpha, '
      + 'that is worth recording — the published result says you should not.',
  },

  // ── visionary ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'dreamachine', name: 'Dreamachine', category: 'visionary',
    method: 'flicker', carrier: 0,
    program: [{ hz: 10, secs: 900 }],
    grade: 'promising',
    eyesClosed: true,
    evidence: 'Alpha-band flicker viewed through CLOSED eyelids reliably produces geometric form '
      + 'constants — lattices, spirals, tunnels — the effect Brion Gysin and Ian Sommerville built the '
      + 'Dreamachine around in 1959 at 8-13Hz. The phenomenology is well documented and reproducible; the '
      + 'mechanism is understood as driven activity in visual cortex, not as anything mystical.',
    note: 'EYES CLOSED. The light goes through the eyelid — you do not look at it. Still a flicker source, '
      + 'so the photosensitivity warning applies in full.',
  },

  // ── gamma, continued: the 2025-26 evidence update ────────────────────────────────────────────
  {
    id: 'genus-40-vibrotactile', name: 'GENUS 40 · vibrotactile', category: 'gamma',
    method: 'auditory', carrier: 40,
    program: [{ hz: 40, secs: 1800 }],
    grade: 'promising',
    evidence: 'A FIFTH delivery route. Kim et al. (Scientific Reports, July 2026) compared 40Hz vibrotactile '
      + 'stimulation delivered by a GLOVE against combined visual+auditory in 15 healthy participants, and '
      + 'found the glove evoked 40Hz EEG responses in central, frontal and — to a lesser extent — occipital '
      + 'cortex. That matters because it reaches the gamma response with NO light at all, which is the whole '
      + 'problem for photosensitive people.',
    note: 'This session plays the 40Hz audio reference. The browser cannot deliver true 40Hz vibrotactile — '
      + 'the Vibration API is a coarse on/off pattern, not a waveform, and phones vary wildly. The real route '
      + 'is built hardware; see the build guide. We are not going to pretend a phone buzz is the study.',
  },

  // ── perceptual training: strobe used the other way ───────────────────────────────────────────
  {
    id: 'strobe-training', name: 'Stroboscopic training', category: 'training',
    method: 'flicker',
    program: [{ hz: 6, secs: 300 }, { hz: 4, secs: 300 }, { hz: 3, secs: 300 }],
    grade: 'promising',
    evidence: 'Completely different use of a strobe: not entrainment, but INTERMITTENT OCCLUSION — removing '
      + 'visual information so the system learns to work on less. A 2026 study in Frontiers in Physiology found '
      + 'stroboscopic vision training improved sports-vision and punching performance; a 2024 study in Life '
      + 'tested elite curling athletes; and a 2025 paper in Applied Neuropsychology found repeated training '
      + 'improved ANTICIPATION skill without changing general perceptual-cognitive skills — a useful, specific '
      + 'negative result that keeps the claim honest.',
    note: 'Done with the EYES OPEN and moving, ideally while catching or tracking something. Sitting still and '
      + 'staring at it is not the intervention.',
    eyesClosed: false,
  },

  // ── sleep: acoustic stimulation for consolidation ────────────────────────────────────────────
  {
    id: 'pink-noise-sleep', name: 'Pink noise · consolidation', category: 'sleep',
    method: 'auditory', carrier: 0,
    program: [{ hz: 1, secs: 2700 }],
    grade: 'promising',
    evidence: 'The best-supported idea in sleep audio is not a tone at a frequency — it is sound delivered in '
      + 'PHASE with your own slow oscillations during deep sleep. A 2026 paper in npj Science of Learning covers '
      + 'slow-oscillation and spindle stimulation effects on physiology and memory; a 2026 Neuroscientist review '
      + '("Echoes of Pink Noise") proposes the mechanism for enhancing sleep-dependent memory consolidation.',
    note: 'HONEST LIMIT: real closed-loop stimulation needs live EEG to find the up-phase of your slow waves. '
      + 'Open-loop pink noise — what a browser can play — is the weaker cousin, and we grade it as what it is.',
    eyesClosed: true,
  },
];

export const byCategory = (id) => SESSIONS.filter((s) => s.category === id);
export const totalSeconds = (s) => (s.program || []).reduce((n, p) => n + (p.secs || 0), 0);
export const peakHz = (s) => (s.program || []).reduce((m, p) => Math.max(m, p.hz || 0), 0);

/** Does this session drive LIGHT inside the high-risk photic band? Audio-only sessions are never high risk. */
export function photicRisk(s) {
  const visual = s.method === 'flicker' || s.method === 'isf' || s.method === 'combined';
  if (!visual) return 'none';
  const [lo, hi] = PHOTIC_HIGH_RISK;
  return (s.program || []).some((p) => p.hz >= lo && p.hz <= hi) ? 'high' : 'standard';
}

export default SESSIONS;
