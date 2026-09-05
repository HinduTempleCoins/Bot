// site/hathor-live/practices.mjs — the techniques that need no hardware at all.
//
// The entrainment library needs a device, a screen or headphones. This file is the other half: the
// practices a person can be TAUGHT and then do with nothing, in the dark, for free. Counting sheep,
// the lucid-dream induction family (MILD / SSILD / WILD / DILD / WBTB), reality testing, imagery
// distraction, dream recall.
//
// They are graded on EXACTLY the same scale as sessions.mjs, for the same reason: this corner of the
// field is thick with confident instruction and thin with evidence, and the honest move is to say
// which is which. Two of the entries here exist specifically to correct folk technique with data —
// counting sheep is the famous one, and the study that tested it found it did not work while a
// different, very specific mental task did.
//
// Nothing here is a medical intervention and none of it is a treatment for insomnia. Sleep that stays
// broken is a clinical matter; see a doctor rather than a frequency or a mantra.
//
//   import { PRACTICES, PRACTICE_FAMILIES, byFamily, practiceGrade } from './practices.mjs'

export const PRACTICE_FAMILIES = [
  { id: 'onset', name: 'Getting to sleep', blurb: 'What to do with a mind that will not stop. The folk answer is wrong and the literature says what to do instead.' },
  { id: 'lucid', name: 'Lucid dreaming', blurb: 'The induction family. Two techniques have real comparative data behind them; the rest are tradition.' },
  { id: 'recall', name: 'Dream recall', blurb: 'The single strongest predictor of whether any induction technique works for you.' },
  { id: 'cueing', name: 'Cued reactivation', blurb: 'Using a smell or a sound in sleep to re-trigger something practised while awake.' },
];

export const PRACTICES = [
  // ── getting to sleep ───────────────────────────────────────────────────────────────────────────
  {
    id: 'imagery-distraction',
    family: 'onset',
    name: 'Imagery distraction (what to do instead of counting sheep)',
    grade: 'moderate',
    minutes: 10,
    summary:
      'Build one specific, interesting, absorbing scene and stay inside it — not a count, not a list. ' +
      'The scene has to be engaging enough that re-engaging with your worries would take effort.',
    steps: [
      'Before bed, pick ONE scene you find genuinely interesting. Specific, not generic: a particular shop you know, a route you have walked, a workshop you would like to build.',
      'Lying down, enter the scene and furnish it. What is underfoot, what is the light, what can you hear, what is on the shelf to your left.',
      'Keep elaborating. New detail, not repetition. The task is to occupy the space a worry would otherwise fill.',
      'When you notice you have drifted back to a worry — you will — return to the scene rather than fighting the worry.',
    ],
    evidence:
      'Harvey & Payne (2002, Behaviour Research and Therapy) gave 41 people with insomnia one of three ' +
      'instructions: distract with imagery, distract generally, or nothing at all. Imagery distraction ' +
      'produced shorter sleep-onset latency and less frequent, less distressing pre-sleep thought than ' +
      'no instruction. GENERAL distraction — the counting-sheep shape — did not.',
    citations: [{ label: 'Harvey & Payne 2002', url: 'https://pubmed.ncbi.nlm.nih.gov/11863237/' }],
    caution: 'Not a treatment for chronic insomnia. If sleep stays broken for weeks, that is a clinical matter, not a technique problem.',
  },
  {
    id: 'counting-sheep',
    family: 'onset',
    name: 'Counting sheep',
    grade: 'weak',
    minutes: 10,
    summary:
      'The most famous sleep technique in the world, and the one study that actually tested its shape ' +
      'found it did nothing. Listed because people ask, and because the correction is more useful than the omission.',
    steps: [
      'The traditional instruction: count imagined sheep passing, one by one, until sleep comes.',
      'What the evidence says: a repetitive, unengaging count is "general distraction", and general distraction did not shorten sleep onset.',
      'Use imagery distraction instead — same idea, but a specific absorbing scene rather than a monotonous count.',
    ],
    evidence:
      'In Harvey & Payne (2002) the general-distraction arm was predicted to be WORSE than no instruction ' +
      'at all; that prediction was not supported either. So the honest summary is that it neither helped ' +
      'nor measurably hurt — it simply did not do the thing it is famous for. Imagery, in the same study, did.',
    citations: [{ label: 'Harvey & Payne 2002', url: 'https://pubmed.ncbi.nlm.nih.gov/11863237/' }],
  },

  // ── lucid dreaming ─────────────────────────────────────────────────────────────────────────────
  {
    id: 'mild',
    family: 'lucid',
    name: 'MILD — Mnemonic Induction of Lucid Dreams',
    grade: 'moderate',
    minutes: 10,
    summary:
      'Prospective memory. You rehearse the intention to notice you are dreaming, attached to a specific ' +
      'remembered dream, so the intention is waiting for you when the dream starts.',
    steps: [
      'Wake from a dream (an alarm ~5 hours in, or a natural waking) and recall it in as much detail as you can.',
      'Pick the moment in that dream that was most obviously impossible — the dreamsign.',
      'Repeat, meaning it rather than reciting it: "Next time I am dreaming, I will remember that I am dreaming."',
      'While repeating, SEE yourself back in that dream, reaching the dreamsign, and recognising it. Vividly, not abstractly.',
      'Let yourself fall asleep while still holding the intention.',
    ],
    evidence:
      'The International Lucid Dream Induction Study (Adventure-Heart 2020, Frontiers in Psychology) ran ' +
      '355 participants across five technique combinations. MILD and SSILD came out SIMILARLY EFFECTIVE, ' +
      'and a hybrid of the two showed no advantage over either alone. Success predicted by good general ' +
      'dream recall and by falling asleep within ten minutes of finishing the technique. No adverse effect ' +
      'on sleep quality was found.',
    citations: [
      { label: 'International Lucid Dream Induction Study 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32765385/' },
      { label: 'Induction techniques: systematic review 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36408823/' },
    ],
    note: 'The ten-minute figure is the practical one. If the technique leaves you wide awake, it is working against itself.',
  },
  {
    id: 'ssild',
    family: 'lucid',
    name: 'SSILD — Senses Initiated Lucid Dream',
    grade: 'moderate',
    minutes: 8,
    summary:
      'Cycle attention through sight, hearing and touch in slow repeated passes, then simply go to sleep. ' +
      'No visualisation and no affirmation — which makes it the technique of choice if MILD keeps you awake.',
    steps: [
      'Wake after ~4-5 hours of sleep. Lie comfortably, eyes closed.',
      'Three or four QUICK cycles: attend to what you see behind closed eyelids, then to what you hear, then to what you feel in your body. A few seconds each.',
      'Then three or four SLOW cycles: same three senses, roughly thirty seconds each. Observe; do not strain to produce anything.',
      'Stop, and go to sleep normally without holding any intention. That is the whole technique.',
    ],
    evidence:
      'In the same 355-person International Lucid Dream Induction Study, SSILD performed comparably to MILD. ' +
      'That is the useful finding: two mechanistically different techniques, similar results, so choose the ' +
      'one that lets you fall back asleep quickly.',
    citations: [{ label: 'International Lucid Dream Induction Study 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32765385/' }],
  },
  {
    id: 'wbtb',
    family: 'lucid',
    name: 'WBTB — Wake Back To Bed',
    grade: 'moderate',
    minutes: 30,
    summary:
      'Not an induction technique on its own — a multiplier. Waking late in the night and returning to sleep ' +
      'puts you into REM-dense sleep with an alert enough mind to hold an intention.',
    steps: [
      'Set an alarm for roughly 4.5 to 6 hours after you fall asleep — late enough that REM periods are long.',
      'Get up. Stay awake 10 to 30 minutes: read about dreaming, write the dream you just had, do the technique.',
      'Go back to bed and run MILD or SSILD as you fall asleep.',
    ],
    evidence:
      'Sleep-laboratory work supports the wake-then-return structure (Erlacher and colleagues, 2020), and a ' +
      '2022 study examined how the TIMING of the interruption changes the result — earlier interruptions are ' +
      'not automatically better, so the late-night window matters.',
    citations: [
      { label: 'Sleep laboratory WBTB study 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32670163/' },
      { label: 'WBTB timing, 2022', url: 'https://pubmed.ncbi.nlm.nih.gov/35645242/' },
    ],
    caution: 'This deliberately fragments your night. Do not run it before a day that needs you sharp, and not at all if you are already sleep-deprived.',
  },
  {
    id: 'dild-reality-testing',
    family: 'lucid',
    name: 'DILD and reality testing',
    grade: 'weak',
    minutes: 2,
    summary:
      'DILD is not a technique — it is the CATEGORY of becoming lucid from inside a dream. Reality testing is ' +
      'the daytime habit meant to produce it: checking, repeatedly, whether you are awake.',
    steps: [
      'Several times a day, genuinely ask whether you are dreaming — genuinely, not as a formality.',
      'Test it physically. Read text, look away, read it again (it changes in dreams). Try to push a finger through your palm. Pinch your nose shut and try to breathe in.',
      'Pair the check with things that recur in your dreams, so the habit fires where it is needed.',
    ],
    evidence:
      'Reality testing is the most widely taught technique and among the least well supported on its own. ' +
      'In the International Lucid Dream Induction Study it was a component of the combinations tested rather ' +
      'than the active ingredient, and reviews of induction techniques repeatedly find single daytime methods ' +
      'underperform the night-time memory techniques. Graded weak alone, useful as a component.',
    citations: [{ label: 'Induction techniques: systematic review 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36408823/' }],
  },
  {
    id: 'wild',
    family: 'lucid',
    name: 'WILD — Wake Initiated Lucid Dream',
    grade: 'traditional',
    minutes: 20,
    summary:
      'Cross from waking directly into a dream without losing awareness. The most dramatic technique in the ' +
      'family and the one with the least controlled evidence behind it.',
    steps: [
      'Best attempted after WBTB, when sleep pressure will carry you across quickly.',
      'Lie still and let the body fall asleep while attention stays on one quiet anchor — the breath, or the shapes behind the eyelids.',
      'Expect the transition: hypnagogic imagery, sounds, a sense of weight or vibration, sometimes sleep paralysis.',
      'Do not grab at the imagery. Let it thicken until it is a place, then step in.',
    ],
    evidence:
      'Rich first-person and instructional literature; very little controlled data specific to WILD as a ' +
      'discrete technique. Graded traditional for that reason, not because practitioners are wrong.',
    citations: [{ label: 'Induction techniques: systematic review 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36408823/' }],
    caution:
      'Sleep paralysis is a normal and harmless part of this transition and can be genuinely frightening the ' +
      'first time. It ends on its own. Knowing that in advance is most of the remedy.',
  },

  // ── dream recall ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'dream-journal',
    family: 'recall',
    name: 'Dream recall training',
    grade: 'moderate',
    minutes: 5,
    summary:
      'The unglamorous one that the data says matters most. In the 355-person study, superior general dream ' +
      'recall was a predictor of successful induction — so this is the prerequisite, not the accessory.',
    steps: [
      'Keep paper and pen within reach. Screens light you up and cost you the dream.',
      'On waking, do not move and do not open your eyes. Hold still and let the dream come back first.',
      'Write it immediately, even a fragment, even one image. Fragments train recall as well as full dreams.',
      'Read back over the journal weekly and mark what recurs — those recurrences are your dreamsigns, and MILD needs them.',
    ],
    evidence:
      'Adventure-Heart (2020) identified superior general dream recall as a predictor of successful lucid ' +
      'induction across 355 participants. Recall is trainable, which makes it the highest-leverage place to start.',
    citations: [{ label: 'International Lucid Dream Induction Study 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32765385/' }],
  },

  // ── cued reactivation ──────────────────────────────────────────────────────────────────────────
  {
    id: 'olfactory-cue',
    family: 'cueing',
    name: 'Scent-cued reality testing',
    grade: 'promising',
    minutes: 5,
    summary:
      'Practise reality testing while a distinctive smell is present, then reintroduce that smell during ' +
      'early-morning sleep. The cue re-activates the practised behaviour inside the dream. This is where the ' +
      'scent work and the dream work meet.',
    steps: [
      'Choose one distinctive scent you do not otherwise encounter.',
      'For several days, do your reality checks with that scent present, so the two are bound together.',
      'During the early-morning sleep window, have the scent reintroduced — a timer diffuser, or someone else placing it.',
    ],
    evidence:
      'A 2020 proof-of-concept in Consciousness and Cognition induced lucid dreams by olfactory-cued ' +
      'reactivation of reality testing during early-morning sleep. Proof of concept means exactly that: ' +
      'the mechanism was demonstrated, the effect is not yet established at scale.',
    citations: [{ label: 'Olfactory-cued reactivation 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32570154/' }],
    note: 'Targeted memory reactivation is the general form of this, and it is one of the better-supported ideas in sleep science. The lucid application is the new and unproven part.',
  },
];

export const byFamily = (id) => PRACTICES.filter((p) => p.family === id);
export const practiceGrade = (id) => (PRACTICES.find((p) => p.id === id) || {}).grade || null;
export const PRACTICE_IDS = PRACTICES.map((p) => p.id);

export default PRACTICES;
