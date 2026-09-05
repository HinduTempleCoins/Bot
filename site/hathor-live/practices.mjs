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
  { id: 'clinical', name: 'Where it is actually used', blurb: 'The one application with clinical standing: nightmares. Plus what the meditation evidence really shows.' },
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

  // ── lucid: the folk family, documented honestly ────────────────────────────────────────────────
  {
    id: 'fild',
    family: 'lucid',
    name: 'FILD — Finger Induced Lucid Dream',
    grade: 'traditional',
    minutes: 3,
    summary:
      'After a brief waking, make tiny alternating finger movements — as if playing two piano keys — ' +
      'while the body falls back asleep, then reality-test. Popular, fast, and completely untested.',
    steps: [
      'Wake after 4-6 hours. Move as little as possible and keep your eyes shut.',
      'Rest two fingers on the mattress and make micro-movements, alternating, as if pressing two piano keys very lightly. Barely move at all.',
      'Continue for roughly 20-30 seconds while letting sleep take the rest of you.',
      'Reality-test — the nose-pinch breath test is the usual one here, because it works even if you cannot see clearly.',
    ],
    evidence:
      'No controlled study. FILD is a community technique with a large body of anecdote and zero ' +
      'published trials. Graded traditional on that basis, which is a statement about the evidence and ' +
      'not about whether practitioners experience something.',
    citations: [{ label: 'Induction techniques: systematic review 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36408823/' }],
    note: 'Listed because it is one of the most-asked-about techniques. If it works for you, that is a report worth filing.',
  },
  {
    id: 'deild',
    family: 'lucid',
    name: 'DEILD — Dream Exit Initiated Lucid Dream (chaining)',
    grade: 'traditional',
    minutes: 5,
    summary:
      'Re-enter the dream you just left. When you wake from a dream, stay completely still, keep your ' +
      'eyes closed, and slide straight back in while the dream is still warm.',
    steps: [
      'The instant you wake from a dream, do not move and do not open your eyes. Movement is what ends it.',
      'Do not think about the day. Hold the dream you just left.',
      'Let yourself sink back, expecting to arrive in the same scene.',
      'Reality-test as soon as anything forms.',
    ],
    evidence:
      'No controlled trials. The underlying observation — that dream re-entry is easiest immediately after ' +
      'a REM awakening — is consistent with sleep-laboratory work on the wake-then-return structure, but ' +
      'DEILD itself has not been tested as a discrete technique.',
    citations: [{ label: 'Sleep laboratory WBTB study 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32670163/' }],
  },
  {
    id: 'ada-cat',
    family: 'lucid',
    name: 'ADA and CAT — all-day awareness, cycle adjustment',
    grade: 'traditional',
    minutes: 1,
    summary:
      'Two daytime approaches. ADA: hold continuous sensory awareness through the day so the habit carries ' +
      'into sleep. CAT: shift your wake time earlier for a period so the body clock puts you in light REM-rich ' +
      'sleep when you would normally be deeply asleep.',
    steps: [
      'ADA — several times an hour, take deliberate stock of all senses at once: what you see at the edges, what you hear behind you, what your feet feel.',
      'CAT — for one week, wake 90 minutes earlier than usual and stay up. On alternate weeks, return to your normal time and reality-test hard on the mornings you sleep in.',
      'Both are habit-formation plays rather than night-of techniques.',
    ],
    evidence:
      'Neither has controlled data. They are included because both are widely taught and because the ' +
      'reasoning behind CAT — exploiting circadian REM distribution — is at least mechanistically coherent, ' +
      'which is more than can be said for some of the field.',
    citations: [{ label: 'Induction techniques: systematic review 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36408823/' }],
    caution: 'CAT deliberately manipulates your sleep schedule. Do not run it alongside shift work or while sleep-deprived.',
  },
  {
    id: 'gamma-tacs-rem',
    family: 'cueing',
    name: 'Gamma current during REM — the 40Hz result in the dream literature',
    grade: 'promising',
    minutes: 0,
    summary:
      'The single most striking result in lucid-dream research, and the reason this library sits on a page ' +
      'about 40Hz. Frontal current stimulation in the lower gamma band during REM sleep induced ' +
      'self-reflective awareness in dreams — and other frequencies did not.',
    steps: [
      'This is a laboratory finding, not a home protocol. It is here as evidence, not as instruction.',
      'What was done: frontal transcranial alternating current at 25Hz and 40Hz, applied during ongoing REM sleep.',
      'What happened: self-reflective awareness appeared in dreams, and control frequencies produced nothing.',
      'The buildable version of this hardware is on this page, but applying current to your own head while asleep is not something we are handing you as a recipe.',
    ],
    evidence:
      'Voss et al. (2014, Nature Neuroscience) established a CAUSAL link where only correlation existed ' +
      'before: fronto-temporal gamma EEG had been associated with dream awareness, and this showed that ' +
      'driving it produces the awareness. The paper states that other stimulation frequencies were not ' +
      'effective, "suggesting that higher order consciousness is indeed related to synchronous oscillations ' +
      'around 25 and 40 Hz."',
    citations: [{ label: 'Voss et al. 2014, Nature Neuroscience', url: 'https://pubmed.ncbi.nlm.nih.gov/24816141/' }],
    note:
      'Hold this next to the 2026 chamber study elsewhere on this page, which found alpha and theta ' +
      'performed EQUIVALENTLY and concluded the immersive context was the active ingredient. Here, frequency ' +
      'was decisive; there, it was not. Both results are real and they are about different things. We publish ' +
      'both rather than the one that flatters the product.',
    caution:
      'Do not improvise this. Stimulating your own head while asleep means no one is monitoring you and you ' +
      'cannot end the session. The lab did it with staff, EEG and a stop condition.',
  },
  {
    id: 'tlr',
    family: 'cueing',
    name: 'TLR — Targeted Lucidity Reactivation',
    grade: 'promising',
    minutes: 45,
    summary:
      'Train reality testing against a specific sound while awake, then replay that sound quietly during REM ' +
      'so the trained behaviour fires inside the dream. The cued cousin of MILD, and the version that has ' +
      'reached a clinical pilot.',
    steps: [
      'Pick a distinctive, non-startling audio cue.',
      'Awake, practise reality testing repeatedly with the cue playing, so cue and check are bound.',
      'Sleep — a morning nap is the studied window, because REM is dense there.',
      'The cue is replayed quietly during REM, below waking threshold.',
    ],
    evidence:
      'The cueing logic is targeted memory reactivation, one of the better-supported ideas in sleep science. ' +
      'A 2025 pilot in the Journal of Sleep Research combined cognitive behavioural therapy with targeted ' +
      'lucidity reactivation to treat narcolepsy-related nightmares — which is TLR being taken seriously in a ' +
      'clinical setting rather than only a curiosity.',
    citations: [
      { label: 'CBT + targeted lucidity reactivation for nightmares, 2025', url: 'https://pubmed.ncbi.nlm.nih.gov/39438131/' },
      { label: 'Olfactory-cued reactivation 2020', url: 'https://pubmed.ncbi.nlm.nih.gov/32570154/' },
    ],
    note: 'Needs someone or something to deliver the cue at the right time. That timing is the hard part and the reason this is not yet a home technique.',
  },

  // ── recall: the chemical adjunct ───────────────────────────────────────────────────────────────
  {
    id: 'b6-recall',
    family: 'recall',
    name: 'Vitamin B6 for dream recall',
    grade: 'moderate',
    minutes: 0,
    summary:
      'The one supplement in this library with a proper trial behind it — and the trial found something ' +
      'narrower than what it is sold for. B6 increased how MUCH dream content people recalled. It did not ' +
      'make dreams more vivid, more bizarre, or more colourful.',
    steps: [
      'What was studied: 240 mg pyridoxine hydrochloride before bed, five consecutive nights.',
      'What it did: significantly increased the amount of dream content recalled.',
      'What it did NOT do: vividness, bizarreness and colour were all unaffected, despite being exactly what the marketing claims.',
      'Why it belongs here anyway: recall is the strongest predictor of successful lucid induction, so more recall is a real lever even if it is not the glamorous one.',
    ],
    evidence:
      'Aspy and colleagues (2018, Perceptual and Motor Skills) ran a randomised, double-blind, ' +
      'placebo-controlled trial in 100 participants, replicating a 2002 pilot at larger scale. B6 increased ' +
      'recalled dream content only. Notably the B-COMPLEX arm did worse: significantly lower self-rated sleep ' +
      'quality. More B vitamins is not better here.',
    citations: [
      { label: 'Aspy et al. 2018, Perceptual and Motor Skills', url: 'https://pubmed.ncbi.nlm.nih.gov/29665762/' },
      { label: 'Ebben et al. 2002 pilot', url: 'https://pubmed.ncbi.nlm.nih.gov/11883552/' },
    ],
    caution:
      'This matters more than the effect does. Chronic high-dose pyridoxine causes peripheral sensory ' +
      'neuropathy — numbness and tingling in the hands and feet, sometimes slow to reverse. 240 mg is far ' +
      'above dietary intake and the trial ran FIVE NIGHTS, not indefinitely. Do not take this as a standing ' +
      'nightly supplement, and stop at any pins and needles.',
  },

  // ── clinical ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'lucid-nightmares',
    family: 'clinical',
    name: 'Lucid dreaming for nightmares',
    grade: 'promising',
    minutes: 0,
    summary:
      'The application with actual clinical standing. If you know you are dreaming inside a nightmare, you ' +
      'can change what happens — and that is used as a treatment.',
    steps: [
      'Usually taught alongside imagery rehearsal therapy: rewrite the nightmare while awake, rehearse the new version, then use lucidity to steer toward it.',
      'The lucid element is not always required for the treatment to work; rescripting alone has the stronger evidence base.',
      'This is done with a clinician when the nightmares are frequent, trauma-linked or disabling.',
    ],
    evidence:
      'A 2006 pilot in Psychotherapy and Psychosomatics tested lucid dreaming treatment for nightmares; a ' +
      '2015 study in Acta Neurologica Scandinavica used it as an add-on to Gestalt therapy; and the American ' +
      'Academy of Sleep Medicine best-practice guide for nightmare disorder in adults places these approaches ' +
      'within the recognised options. A 2022 Scientific Reports paper examined mindful acceptance and lucid ' +
      'dreaming against nightmare frequency and distress.',
    citations: [
      { label: 'Lucid dreaming treatment for nightmares, 2006', url: 'https://pubmed.ncbi.nlm.nih.gov/17053341/' },
      { label: 'AASM best practice guide, nightmare disorder', url: 'https://pubmed.ncbi.nlm.nih.gov/20726290/' },
      { label: 'Mindful acceptance and nightmares, 2022', url: 'https://pubmed.ncbi.nlm.nih.gov/36131106/' },
    ],
    caution: 'Trauma-linked nightmares are a clinical matter. Do not self-treat PTSD with a dream technique — this belongs with a clinician.',
  },
  {
    id: 'meditation-lucid',
    family: 'clinical',
    name: 'Meditation — what the evidence actually shows',
    grade: 'weak',
    minutes: 0,
    summary:
      'Long-term meditators do report more lucid dreams than non-meditators. But when an eight-week ' +
      'mindfulness course was tested in a blinded randomised design, it did NOT increase lucid dream ' +
      'frequency. Association is not the same as an intervention that works on your timescale.',
    steps: [
      'The correlation is real: frequent lucid dreaming tracks with meditation practice style, meta-awareness and trait mindfulness.',
      'The causal test at eight weeks came back negative.',
      'The honest reading: whatever long-term practice does, it is not something an eight-week course delivered.',
    ],
    evidence:
      'Baird and colleagues (2019) used three complementary methods — a cross-sectional comparison of ' +
      'long-term meditators against meditation-naive individuals, a trait-mindfulness analysis, and a ' +
      'BLINDED RANDOMISED CONTROLLED test of an 8-week mindfulness course. Lucid dreaming was more frequent in ' +
      'long-term meditators; the 8-week course did not increase it. A 2024 paper in Brain Sciences replicated ' +
      'the association with practice style and meta-awareness.',
    citations: [
      { label: 'Baird et al. 2019 — meditators yes, MBSR no', url: 'https://pubmed.ncbi.nlm.nih.gov/31058200/' },
      { label: 'Meditation style and meta-awareness, 2024', url: 'https://pubmed.ncbi.nlm.nih.gov/38790474/' },
    ],
    note:
      'Graded weak as an INDUCTION TECHNIQUE, which is what this library grades. That is not a judgement on ' +
      'meditation, only on the claim that taking it up will make you lucid.',
  },
];

export const byFamily = (id) => PRACTICES.filter((p) => p.family === id);
export const practiceGrade = (id) => (PRACTICES.find((p) => p.id === id) || {}).grade || null;
export const PRACTICE_IDS = PRACTICES.map((p) => p.id);

export default PRACTICES;
