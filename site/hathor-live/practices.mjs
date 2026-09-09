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
  { id: 'verified', name: 'How we know it is real', blurb: 'Lucidity is the one inner state that has been made objectively verifiable. Two experiments did that, and everything else on this page rests on them.' },
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

  // ── how we know it is real ─────────────────────────────────────────────────────────────────────
  //
  // ⭐ This section is the foundation and it was missing. Every induction technique below is a claim
  // about a private event, and private events are normally unfalsifiable. Lucid dreaming is the
  // exception: in 1981 it was made into a MEASUREMENT, and in 2021 into a two-way conversation.
  {
    id: 'lrlr-signalling',
    family: 'verified',
    name: 'LRLR — the eye-signal paradigm that made lucidity a measurement',
    grade: 'strong',
    minutes: 0,
    summary:
      'During REM sleep the body is paralysed but the eyes are not. A lucid dreamer who has agreed in ' +
      'advance to look hard left-right-left-right can therefore send a signal OUT of the dream and onto ' +
      'the polygraph, timestamped, while the EEG independently confirms REM. That is why lucid dreaming ' +
      'is a scientific object rather than a claim.',
    steps: [
      'Before sleep, the dreamer and the experimenter agree a signal — the standard one is two full left-right eye sweeps, LRLR.',
      'The sleeper is recorded with EOG (eye movement), EEG (brain state) and EMG (muscle tone) simultaneously.',
      'On becoming lucid, the dreamer performs the agreed eye movements as a deliberate dream action.',
      'The signal appears in the EOG trace during unambiguous REM, with the chin EMG flat. The dreamer was asleep, and reported it deliberately.',
      'Because the signal is timestamped, anything else the dreamer does can now be timed against physiology — this is the technique every lab result on this page depends on.',
    ],
    evidence:
      'La Berge, Nagel, Dement and Zarcone (1981, Perceptual and Motor Skills 52:727-732) verified lucid ' +
      'dreaming in five selected subjects who signalled by prearranged dream actions during unequivocal ' +
      'REM sleep. Keith Hearne had recorded ocular signalling from a lucid dreamer independently in 1975 ' +
      'at the University of Hull; LaBerge’s group published the peer-reviewed paradigm. The eyes work ' +
      'because REM atonia spares the extraocular muscles — the one motor channel a dreaming body leaves open.',
    citations: [
      { label: 'La Berge et al. 1981, Perceptual and Motor Skills — DOI 10.2466/pms.1981.52.3.727', url: 'https://doi.org/10.2466/pms.1981.52.3.727' },
      { label: 'PubMed 24171230', url: 'https://pubmed.ncbi.nlm.nih.gov/24171230/' },
    ],
    note:
      'The honest framing: this proves the dreamer was awake INSIDE sleep and could act on a prior ' +
      'intention. It does not adjudicate what the dream is, and no experiment on this page does.',
  },
  {
    id: 'two-way-dialogue',
    family: 'verified',
    name: 'Two-way dialogue during REM — Konkoly et al. 2021',
    grade: 'strong',
    minutes: 0,
    summary:
      'Four independent laboratories, working separately and converging, put questions to sleeping ' +
      'people and got answers back. Arithmetic, yes/no, sensory discrimination — answered from inside ' +
      'verified REM sleep, in real time, by eye movements and facial muscles.',
    steps: [
      'The dreamer signals lucidity with the LRLR paradigm above. The lab confirms REM from the EEG.',
      'The experimenter speaks a question aloud — for example a small addition or subtraction with an answer between 1 and 6, or a yes/no question.',
      'The dreamer answers by counting out eye movements, or by contracting the smile muscle for yes and the frown muscle for no.',
      'On waking, the dreamer usually reports having received the question inside the dream — sometimes as a voice from outside, sometimes woven into the dream scene, sometimes with details that diverge from the recording.',
    ],
    evidence:
      'Konkoly and colleagues (2021, Current Biology 31:1417-1427.e6) ran 36 participants across four ' +
      'laboratories in the USA, Germany, France and the Netherlands, including one participant with ' +
      'narcolepsy type 1. Six participants achieved documented two-way exchanges. Across 158 trials in ' +
      'signal-verified lucid REM: 29 correct (18.4%), 5 incorrect (3.2%), 28 ambiguous (17.7%) and 96 with ' +
      'no response (60.8%). The low response rate is the honest headline — most questions got nothing. ' +
      'But 29 correct against 5 incorrect is not noise, and the four labs used different methods and ' +
      'different populations and all four got it.',
    citations: [
      { label: 'Konkoly et al. 2021, Current Biology — DOI 10.1016/j.cub.2021.01.026', url: 'https://doi.org/10.1016/j.cub.2021.01.026' },
      { label: 'Open access — PMC8162929', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8162929/' },
    ],
    note:
      'What this established, stated precisely: a sleeping brain can perceive an external signal, ' +
      'comprehend it, compute on it and issue a voluntary motor response — all while asleep and ' +
      'dreaming. It is an interface, not a seance, and the paper claims nothing more than that. What ' +
      'a person MEETS in a dream is not a question this experiment is able to ask.',
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
      'DILD is not a technique — it is the CATEGORY of becoming lucid from inside a dream. Reality ' +
      'testing is the daytime habit meant to produce it: checking, repeatedly, whether you are awake. ' +
      'Graded weak because the trial that isolated it found it did almost nothing on its own; it works ' +
      'as the daytime half of MILD, which is a different claim from the one it is usually sold with.',
    steps: [
      'Several times a day, genuinely ask whether you are dreaming — genuinely, not as a formality. A check performed without doubt trains nothing.',
      'Use a check that has actually been tested. See REALITY_CHECKS on this page: the re-reading test is the one with data behind it, and the light switch is not.',
      'Pair the check with things that recur in your dreams, so the habit fires where it is needed.',
      'Treat it as the daytime component of MILD rather than as a standalone method — that is the combination the trials actually tested.',
    ],
    evidence:
      'Aspy, Delfabbro, Proeve and Mohr (2017, Dreaming 27(3):206-231 — the National Australian Lucid ' +
      'Dream Induction Study, N=169) compared reality testing, WBTB and MILD in combination. The ' +
      'combination worked; the paper’s own emphasis is that MILD carried it, and the strongest single ' +
      'predictor was how fast the participant fell asleep after finishing MILD. Among those who fell ' +
      'asleep within five minutes of the technique, lucid dreams followed on almost 46% of attempts. ' +
      'Stumbrys et al. (2012, Consciousness and Cognition 21:1456-1475) reviewed 35 studies and ' +
      'concluded that NONE of the induction techniques were verified to induce lucid dreams reliably ' +
      'and consistently — a verdict that still stands and that this library is not going to soften.',
    citations: [
      { label: 'Aspy et al. 2017, Dreaming — DOI 10.1037/drm0000059', url: 'https://doi.org/10.1037/drm0000059' },
      { label: 'Stumbrys et al. 2012 systematic review — DOI 10.1016/j.concog.2012.07.003', url: 'https://doi.org/10.1016/j.concog.2012.07.003' },
      { label: 'Induction techniques: systematic review 2023', url: 'https://pubmed.ncbi.nlm.nih.gov/36408823/' },
    ],
    note:
      'The 46% figure is a percentage of ATTEMPTS by a self-selected subgroup, not a success rate for ' +
      'the technique. It is quoted everywhere without that qualifier. Ours carries it.',
  },
  {
    id: 'galantamine',
    family: 'lucid',
    name: 'Galantamine — the strongest drug evidence, and its real cautions',
    grade: 'moderate',
    minutes: 0,
    summary:
      'An acetylcholinesterase inhibitor, licensed for Alzheimer’s disease, that raised lucid-dream ' +
      'frequency in a double-blind placebo-controlled crossover trial in a clean dose-response. It is ' +
      'the best pharmacological result in the field — and it is a real drug with a real label, which is ' +
      'the half that gets left out.',
    steps: [
      'What was studied: 121 participants, 0 mg / 4 mg / 8 mg galantamine hydrobromide, counterbalanced order, three consecutive nights, taken at a middle-of-night waking after about 4.5 hours of sleep.',
      'What it produced: at least one lucid dream on 14% of placebo nights, 27% at 4 mg (OR 2.29) and 42% at 8 mg (OR 4.46). Dream recall, sensory vividness and scene complexity also rose.',
      'READ THIS BEFORE THE HEADLINE NUMBER: the "placebo" arm was not nothing. Every arm did a wake-back-to-bed plus MILD. The 42% is galantamine ON TOP of a technique that already works — not galantamine alone.',
      'The setting was an eight-day residential lucid-dreaming workshop, in participants selected for high dream recall and strong motivation. Those numbers do not transfer to an unselected person at home.',
      'The authors themselves screened OUT asthma, beta-blocker use, cardiac arrhythmia and severe mental illness before enrolling. Take their exclusion list as the minimum, not as a formality.',
    ],
    evidence:
      'LaBerge, LaMarca and Baird (2018, PLOS ONE 13(8):e0201246): double-blind, placebo-controlled, ' +
      'crossover, N=121, dose-related increase in lucid dreaming. Side effects were reported by 14 ' +
      'participants (12%) on an active dose — mild gastrointestinal upset, nausea (n=5), difficulty ' +
      'falling back to sleep (n=5), next-day fatigue — against 3% on placebo. This is one trial, from ' +
      'one institute, with a self-report outcome and a highly selected sample. It has not been ' +
      'independently replicated. Moderate is the correct grade and it is not modesty.',
    citations: [
      { label: 'LaBerge, LaMarca & Baird 2018, PLOS ONE — DOI 10.1371/journal.pone.0201246', url: 'https://doi.org/10.1371/journal.pone.0201246' },
      { label: 'FDA-approved label (galantamine), DailyMed', url: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=e80ec152-3616-4a13-9266-715550a8c398' },
    ],
    caution:
      'Galantamine is a cholinesterase inhibitor and the label’s warnings apply to anyone taking it, ' +
      'not only to Alzheimer’s patients. CARDIAC: vagotonic effects on the sinoatrial and ' +
      'atrioventricular nodes — bradycardia and AV block are foreseeable, and syncope in the trials rose ' +
      'with dose (0.7% placebo, 0.4% at 4 mg twice daily, 1.3% at 8 mg twice daily, 2.2% at 12 mg twice ' +
      'daily). Anyone on a beta-blocker or with a conduction problem is stacking two things that slow ' +
      'the same node. RESPIRATORY: use caution in severe asthma or obstructive pulmonary disease. ' +
      'NEUROLOGIC: cholinesterase inhibitors carry a seizure risk and can worsen extrapyramidal ' +
      'disorders. GI: monitor for ulcer symptoms and bleeding, especially alongside NSAIDs. ' +
      'GENITOURINARY: bladder outflow obstruction. ANAESTHESIA: it exaggerates succinylcholine-type ' +
      'neuromuscular blockade — tell an anaesthetist. RENAL/HEPATIC: not recommended with creatinine ' +
      'clearance under 9 mL/min or Child-Pugh 10-15. Common adverse reactions at treatment doses: ' +
      'nausea 20.7% (placebo 5.5%), vomiting 10.5% (2.3%), dizziness 7.5% (3.4%).',
    note:
      'INTERACTIONS, stated because withholding them is the harm. Cholinergic burden is additive: ' +
      'galantamine plus another cholinesterase inhibitor (donepezil, rivastigmine, pyridostigmine) or a ' +
      'direct cholinergic agonist (bethanechol) stacks the same effect. It works AGAINST anticholinergics ' +
      'and they work against it — which includes a great many antihistamines, tricyclics, and the ' +
      'deliriant plants (Datura, Brugmansia, Atropa) documented elsewhere in this library. CYP2D6 and ' +
      'CYP3A4 inhibitors raise galantamine exposure: paroxetine by about 40%; ketoconazole about 30% AUC; ' +
      'erythromycin about 10%; amitriptyline, fluoxetine, fluvoxamine and quinidine reduce clearance by ' +
      '25-33%. See integrations/interactions.mjs for the structured interaction record; this entry is the ' +
      'narrative half and the two must not disagree.',
  },
  {
    id: 'sleep-paralysis',
    family: 'lucid',
    name: 'Sleep paralysis — what it is, how common, and how it ends',
    grade: 'strong',
    minutes: 0,
    summary:
      'REM atonia persisting into waking awareness. You are awake, you cannot move, and roughly a third ' +
      'of episodes come with a felt presence in the room. It is frightening, it is harmless, it ends by ' +
      'itself, and it is the single most likely thing to happen to someone practising WILD. Teaching ' +
      'WILD without teaching this would be the omission that does the damage.',
    steps: [
      'What is happening: the muscle paralysis that keeps you from acting out dreams has outlasted the dream. Breathing is automatic and unaffected — the diaphragm is not part of REM atonia. The chest pressure people report is a perception, not a restriction.',
      'What it feels like: inability to move or speak, often a presence in the room, sometimes a weight on the chest, sometimes vivid hypnagogic figures. Cultures name the figure differently — the Old Hag, the kanashibari, the jinn — and the phenomenology is remarkably stable across all of them.',
      'How it ends: on its own, in seconds to a couple of minutes, always. Trying to force a large movement tends to prolong the panic; moving one finger or one toe, or slowing the breath, usually breaks it faster.',
      'If you are practising WILD deliberately, expect it, and decide in advance that you will stay still and watch rather than fight. The people who describe it as a doorway and the people who describe it as an assault are in the same physiological state.',
      'When it is NOT just this: recurrent sleep paralysis with daytime sleep attacks, cataplexy or hypnagogic hallucinations can be narcolepsy. That is a diagnosis and it is made by a clinician, not by a web page.',
    ],
    evidence:
      'Sharpless and Barber (2011, Sleep Medicine Reviews 15:311-315) aggregated 35 studies, total ' +
      'N=36,533: at least one lifetime episode in 7.6% of the general population, 28.3% of students and ' +
      '31.9% of psychiatric patients (34.6% among those with panic disorder). It is common, and it is ' +
      'commonest in exactly the population that reads pages like this one.',
    citations: [
      { label: 'Sharpless & Barber 2011 — DOI 10.1016/j.smrv.2011.01.007', url: 'https://doi.org/10.1016/j.smrv.2011.01.007' },
      { label: 'PubMed 21571556', url: 'https://pubmed.ncbi.nlm.nih.gov/21571556/' },
    ],
    caution:
      'Frequent, distressing episodes, or episodes with daytime sleepiness or cataplexy, belong with a ' +
      'sleep clinician. Knowing the physiology reduces the fear; it does not make recurrent paralysis a ' +
      'thing to manage alone.',
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
      'first time. It ends on its own. Knowing that in advance is most of the remedy — read the ' +
      'sleep-paralysis entry BEFORE your first attempt, not after it. It carries the prevalence figures, ' +
      'the reason your breathing is never actually restricted, and what shortens an episode.',
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

// ── REALITY CHECKS, GRADED ONE BY ONE ───────────────────────────────────────────────────────────
//
// ⭐ Reality testing is taught as a single thing with a menu of interchangeable checks. It is not.
// The checks have wildly different evidential status and nobody grades them, so this file does.
//
// The finding that matters: the RE-READING test has data — self-published, un-peer-reviewed data, but
// real data with a sample size. The LIGHT SWITCH, the most confidently repeated check in the whole
// community, rests on a single n=8 questionnaire from 1981 whose only published follow-up found the
// OPPOSITE. Everything else is untested. Saying so is the product.
//
// `status` values, most to least supported:
//   'tested'     — a study with a sample exists, even if it is weak or not peer-reviewed
//   'contested'  — a study exists AND a published follow-up contradicts it
//   'extrapolated' — untested itself; rides on the mechanism of something that was tested
//   'folklore'   — widely taught, no study of any kind, and we are not going to pretend otherwise
export const REALITY_CHECKS = Object.freeze([
  {
    id: 're-reading',
    name: 'Read text, look away, read it again',
    status: 'tested',
    how: 'Find short writing. Read it. Look away and repeat it to yourself twice. Read it again and see whether it says the same thing. If it changed, you are dreaming.',
    verdict:
      'The best-supported check there is, and the support is thinner than its reputation. LaBerge, ' +
      'Steiner and Giguère ran it with 46 subjects (27 men, 19 women): 38 (83%) reported the writing ' +
      'changed on the first re-reading; of the 8 who reported no change, 7 tried a second re-reading and ' +
      '6 of those (86%) reported a change. Across two re-readings only 1 subject of 46 (2%) reported no ' +
      'change at all. ⚠️ It was published in NightLight, the Lucidity Institute’s own subscriber ' +
      'newsletter — NOT peer-reviewed, no control condition, self-report from participants who knew the ' +
      'hypothesis. The authors themselves note the design confounds order with intention. Believe the ' +
      'direction; do not quote the percentage as if it came from a journal.',
    citations: [
      { label: 'LaBerge, Steiner & Giguère, "To sleep, perchance to read", NightLight 8(1&2), 1996 — non-peer-reviewed newsletter', url: 'https://www.mindfulluciddreaming.com/post/2018/07/16/to-sleep-perchance-to-read' },
      { label: 'LaBerge, Lucid Dreaming (1985) — where the re-reading test was first proposed', url: 'https://www.lucidity.com/LucidDreamingFAQ2.html' },
    ],
  },
  {
    id: 'digital-clock',
    name: 'Look at a digital clock, look away, look again',
    status: 'extrapolated',
    how: 'Check the time. Look away. Check again. In a dream the numbers are commonly reported to be different, garbled, or not numbers at all.',
    verdict:
      'No study has ever isolated clocks. It is the re-reading test wearing a different hat — a clock ' +
      'face is text — so it inherits that mechanism and none of its evidence. Reasonable to use, ' +
      'dishonest to cite. Graded extrapolated for exactly that reason.',
    citations: [
      { label: 'LaBerge, Steiner & Giguère 1996 (the text result it borrows from)', url: 'https://www.mindfulluciddreaming.com/post/2018/07/16/to-sleep-perchance-to-read' },
    ],
  },
  {
    id: 'light-switch',
    name: 'Flip a light switch',
    status: 'contested',
    how: 'The claim as taught: light switches do not work in dreams, so try one, and if the light does not come on you are dreaming.',
    verdict:
      '⭐ THE ANSWER IS NOT "FOLKLORE", AND IT IS NOT "IT WORKS" EITHER. There is exactly one primary ' +
      'source: Keith Hearne (1981, Journal of Mental Imagery 5(2):97-100) asked eight lucid dreamers — ' +
      'self-selected correspondents of his own, naive to the purpose — to try switching on a light. Six ' +
      'reported it would not work properly, one could not find the switch, and one could do it only ' +
      'after covering her eyes and abolishing the imagery first. Hearne proposed a CEILING on dream ' +
      'image brightness that the dream then rationalises around. That is n=8, uncontrolled, from a ' +
      'journal that no longer publishes. ⛔ And the only published follow-up found the opposite: Moss ' +
      '(1989, same journal, 13(2):135-137) reported a single subject who logged 70 lucid dreams over ' +
      'three months and completed the light-switch task in 11 of 15 dreams where he attempted it, with ' +
      'brightness in five of them exceeding any previous level. So the check is CONTESTED, not ' +
      'established, and the confident version of it circulating online cites neither paper. Do not rely ' +
      'on a light switch to tell you whether you are awake.',
    citations: [
      { label: 'Hearne 1981, Journal of Mental Imagery 5(2):97-100 (full PDF)', url: 'https://www.keithhearne.com/wp-content/uploads/2010/06/LIGHT-SWITCH-EFFECT.pdf' },
      { label: 'Moss 1989, Journal of Mental Imagery 13(2):135-137 — record only; full text not retrievable', url: 'https://psycnet.apa.org/record/1990-21675-001' },
    ],
    note:
      'What SURVIVES the contradiction is more interesting than the check: Hearne’s subjects did not ' +
      'report darkness, they reported flickering, filaments glowing dull orange, lights coming on ' +
      'somewhere other than where they pointed. Something about dream luminance resists being driven ' +
      'upward on demand. That is a testable claim about dream imagery and nobody has tested it since 1989.',
  },
  {
    id: 'nose-pinch',
    name: 'Pinch your nose shut and try to breathe in',
    status: 'folklore',
    how: 'Hold your nostrils closed with one hand, close your mouth, and try to inhale. In a dream, the breath is commonly reported to come anyway.',
    verdict:
      'No study, at any sample size, ever. Widely taught and mechanistically the most attractive of the ' +
      'untested checks — it does not depend on reading, which means it survives the poor visual acuity ' +
      'and unstable detail that dreams are known for, and it gives an unambiguous yes/no. Attractive ' +
      'reasoning is not evidence. Folklore, and useful folklore, and labelled.',
    citations: [
      { label: 'Stumbrys et al. 2012 — the review that found no induction technique reliably verified', url: 'https://doi.org/10.1016/j.concog.2012.07.003' },
    ],
  },
  {
    id: 'hand-through-palm',
    name: 'Push a finger through your palm',
    status: 'folklore',
    how: 'Press the index finger of one hand into the opposite palm, expecting it to pass through.',
    verdict:
      'No study of any kind. It is taught constantly. The one thing in its favour is that it requires ' +
      'you to hold an EXPECTATION while checking, and expectation is the part of reality testing that ' +
      'the MILD literature suggests is doing the work. That is an argument, not a result.',
    citations: [
      { label: 'Stumbrys et al. 2012 systematic review', url: 'https://doi.org/10.1016/j.concog.2012.07.003' },
    ],
  },
  {
    id: 'count-fingers',
    name: 'Count your fingers',
    status: 'folklore',
    how: 'Look at your hands and count. The claim is that dream hands have the wrong number of fingers, or that the count changes.',
    verdict:
      'No study. The oldest and most-repeated check in the community and there is nothing behind it but ' +
      'accumulated anecdote. Included so the list is complete and so nobody has to wonder whether we ' +
      'left it out because it works.',
    citations: [
      { label: 'Stumbrys et al. 2012 systematic review', url: 'https://doi.org/10.1016/j.concog.2012.07.003' },
    ],
  },
]);

export const REALITY_CHECK_STATUSES = Object.freeze(['tested', 'contested', 'extrapolated', 'folklore']);

/** realityCheck(id) — soft lookup. Returns null for anything unknown; never throws. */
export const realityCheck = (id) => REALITY_CHECKS.find((c) => c.id === id) || null;

/** realityCheckStatus(id) — the grade alone, or null. */
export const realityCheckStatus = (id) => (realityCheck(id) || {}).status || null;

/** folkloreChecks() — the ones with no study behind them at all. The honest half of the menu. */
export const folkloreChecks = () => REALITY_CHECKS.filter((c) => c.status === 'folklore');

export const byFamily = (id) => PRACTICES.filter((p) => p.family === id);
export const practiceGrade = (id) => (PRACTICES.find((p) => p.id === id) || {}).grade || null;
export const PRACTICE_IDS = PRACTICES.map((p) => p.id);

export default PRACTICES;
