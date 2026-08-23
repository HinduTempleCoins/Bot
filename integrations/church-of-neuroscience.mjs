// church-of-neuroscience.mjs — the "Church of Neuroscience" biohacking + plant-medicine knowledge
// vertical for the Library corpus. This is the operator's OWN writing (the Convergence-framework
// corpus, BRIEF.md §2/§6): the record of a personal research program, encoded here as a
// SCIENCE-DISCUSSION library — NOT a how-to.
//
// SCOPE (BRIEF.md §6, load-bearing): "discussing the science is in; step-by-step 'apply X to your
// head' recipes are out." Accordingly this module contains NO preparation, extraction, or synthesis
// procedure, and NO dose-as-instruction (no seed counts, no mg schedules). Where the underlying
// material is dangerous the verbatim caution is carried on the article and rendered on the page.
//
// POSTURE — this is original operator writing, so every article is HOST posture (ours to serve),
// consistent with the license-router's HOST / WINDOW / POINT vocabulary (defensively imported).
//
// The corpus is three parts:
//   I   — Church of Neuroscience (@marsresident, Steemit 2016)
//   II  — Plant Medicine for Humans (@punicwax, Blurt/Steemit 2021)
//   III — 2026 Update (new, well-cited; instrumentation, 40Hz methods, safety, retractions/status)
//
// PURE + soft-fail-never-throw. No network, no keys, no writes. All rendered interpolation goes
// through esc(); every href is http(s)-allowlisted (esc() alone does NOT neutralize javascript:/data:
// URIs). handler(req,res) serves an index + per-article pages; CLI/listen is guarded by process.argv[1].
//
//   import { ARTICLES, getArticle, listArticles, search, renderIndex, renderArticle, handler,
//            DISCLAIMER, EDITORIAL_POSTURE, POSTURE, CAUTIONS } from './church-of-neuroscience.mjs'
//   PORT=8171 BASE_URL=https://library.melek.salon/neuroscience node integrations/church-of-neuroscience.mjs
//   node integrations/church-of-neuroscience.mjs            # list the corpus

import { createServer } from 'node:http';

// ── posture vocabulary (defensive reuse of the license-router's HOST/WINDOW/POINT) ─────────────────
let _POSTURES;
try { ({ POSTURES: _POSTURES } = await import('./license-router.mjs')); } catch { _POSTURES = null; }
export const POSTURE = Object.freeze(
  _POSTURES && _POSTURES.HOST ? _POSTURES : { HOST: 'host', WINDOW: 'window', POINT: 'point' },
);

// ── html safety ────────────────────────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
// Only http(s) URLs may be used as hrefs — esc() does NOT neutralize javascript:/data: URIs, so an
// unrestricted href would be an XSS vector. Anything else routes to '' (rendered as plain text).
export function safeHref(u) {
  const raw = String(u == null ? '' : u).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

// ── the standing notes every article renders with ──────────────────────────────────────────────────
export const DISCLAIMER =
  'Nothing here is medical advice. This is a science-discussion library — the record of a personal '
  + 'research program, reported so the science can be read and checked, not followed as a protocol.';

// Reproduced verbatim as the vertical's standing editorial note (Part III editorial posture).
export const EDITORIAL_POSTURE =
  'Editorial posture: preparation and extraction protocols are omitted; the Datura seed-count is '
  + 'omitted (the poison warning is kept); third-party abstracts are condensed with source links; and '
  + 'nothing in this volume is medical advice.';

// The verbatim cautions the brief requires, carried on the articles where they apply.
export const CAUTIONS = Object.freeze({
  DATURA:
    'Datura is poisonous. The gap between an active amount and a fatal one is small and unpredictable. '
    + 'This library gives no seed count and no dose.',
  TACS_40HZ:
    '40Hz tACS puts current through the head. It is not a home experiment. Consult a neurologist.',
  LIGHT_40HZ:
    '40Hz light therapy is not an approved treatment — it is at the clinical-trial stage.',
  FLICKER_SAFETY:
    'Do not use any flicker method with a history of seizures or photosensitive epilepsy, or with a '
    + 'pacemaker or other implant. Start short and low, and stop on any discomfort.',
});

export const PARTS = Object.freeze({
  I: 'I — Church of Neuroscience',
  II: 'II — Plant Medicine for Humans',
  III: 'III — 2026 Update',
});

// Part III articles carry this re-check note (the corpus is a snapshot).
const PART_III_ASOF = 'as of Aug 2026, re-check vs HOPE trial NCT05637801';

// ── the corpus ───────────────────────────────────────────────────────────────────────────────────
// Each article: { id, title, part, tags[], posture, body[paragraphs], sources[{label,url?}],
//   disclaimer, cautions[], asOf? }. Prose is neutral, encyclopedic science-discussion. Claims are
// attributed to what the archive gives; no citations are invented. No dose-as-instruction anywhere.
const P = PARTS;

export const ARTICLES = Object.freeze([
  // ─────────────────────────── PART I — Church of Neuroscience ───────────────────────────
  {
    id: 'nootropics-method',
    title: 'Nootropics and the T-0 Self-Observation Method',
    part: P.I,
    tags: ['nootropics', 'racetams', 'cholinergics', 'method'],
    posture: POSTURE.HOST,
    body: [
      'The Church of Neuroscience material opens with the nootropic classes it drew on: the racetam '
      + 'family (piracetam and its relatives), studied since Soviet-era pharmacology as putative '
      + 'cognition modulators, and the cholinergics (choline donors such as alpha-GPC and citicoline) '
      + 'that supply the acetylcholine precursors racetam users pair them with. The pharmacology is '
      + 'reported here descriptively; efficacy in healthy adults remains contested in the literature.',
      'What the archive actually documents is not a dosing schedule but a method of self-observation. '
      + 'Effects were logged against a timeline — a baseline reading at T-0, then observations at '
      + 'roughly T+0:30 and T+1:00 — so that a change could be tied to a time-course rather than to '
      + 'impression alone. This is presented as a way to structure a personal record, not as a '
      + 'prescription; the timeline is a notebook convention, and the doses that would fill it are '
      + 'deliberately not given here.',
      'Read charitably, the T-0 method anticipates the pre-registration argument that recurs in the '
      + '2026 update: an observation is only worth anything if the protocol was fixed before the '
      + 'observing began. The 2016 notebook did this informally; a modern version would add a control '
      + 'and a blind.',
    ],
    sources: [{ label: '@marsresident, "Church of Neuroscience", Steemit (2016)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'herbs-overview',
    title: 'Herbs Overview: A Field Guide to the Ethnobotanical Literature',
    part: P.I,
    tags: ['herbs', 'ethnobotany', 'ayahuasca', 'kava', 'kanna', 'ibogaine'],
    posture: POSTURE.HOST,
    body: [
      'The herbs section is a survey of plants the ethnobotanical and pharmacological literature '
      + 'describes, summarized for readers rather than reproduced as recipes. Ubulawu (a southern '
      + 'African category of "dream root" plants) and Kanna (Sceletium tortuosum, an alkaloid-bearing '
      + 'succulent studied as a serotonin-reuptake modulator) sit alongside stimulant and bitter herbs '
      + 'like Betel nut and Wormwood (the thujone-bearing Artemisia of absinthe history).',
      'The psychoactive-plant entries are treated as pharmacology, not method. Ayahuasca is described '
      + 'through its two-part mechanism — the DMT-bearing admixture is orally inactive on its own, and '
      + 'only becomes bioavailable when a monoamine-oxidase inhibitor (the harmala alkaloids of the '
      + 'vine) blocks its first-pass breakdown. San Pedro (a mescaline cactus) and Rivea corymbosa '
      + '(morning-glory relative bearing ergine) are noted as long-documented entheogens; Ibogaine '
      + '(from Tabernanthe iboga) is flagged for its serious cardiac-QT risk and its research interest '
      + 'in interrupting opioid dependence.',
      'Kava (Piper methysticum) is covered as an anxiolytic whose kavalactones act at GABA-A and, per '
      + 'the Temple Pharmacopoeia notes, touch the endocannabinoid system (yangonin binds CB1). '
      + '"Oilahuasca" names the general principle — an orally-taken compound made bioavailable by '
      + 'co-administered enzyme inhibitors, the same logic as ayahuasca — and is discussed only as a '
      + 'pharmacokinetic idea. Ginseng and Ginkgo round out the adaptogen/circulatory end of the '
      + 'survey. Datura appears here only to be marked poisonous and sent to its own article. No '
      + 'preparation, extraction, or dose is given for any plant in this section.',
    ],
    sources: [
      { label: '@marsresident, "Church of Neuroscience", Steemit (2016)' },
      { label: 'Van Kush Temple Pharmacopoeia (knowledge/herbs)' },
    ],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'datura',
    title: 'Datura: A Poison, Documented Only as a Warning',
    part: P.I,
    tags: ['datura', 'poison', 'anticholinergic', 'safety'],
    posture: POSTURE.HOST,
    body: [
      'Datura (jimsonweed and its relatives) recurs across the dream and herb material because it is '
      + 'historically famous, not because it is usable. It is a potent anticholinergic deliriant '
      + '(scopolamine, atropine, hyoscyamine), and it is genuinely dangerous. The tropane-alkaloid '
      + 'content varies enormously from plant to plant, season to season, and part to part, so the '
      + 'amount that produces an effect and the amount that kills are close together and cannot be '
      + 'predicted from the plant.',
      CAUTIONS.DATURA,
      'For that reason this library records Datura only to warn against it. Where the source material '
      + 'carried a seed count, that number has been removed; the caution is what is kept. There is no '
      + 'preparation, no dose, and no "safe amount" here, because for this plant there is no reliable '
      + 'safe amount to give.',
    ],
    sources: [{ label: '@marsresident, "Church of Neuroscience", Steemit (2016)' }],
    disclaimer: DISCLAIMER,
    cautions: [CAUTIONS.DATURA],
  },
  {
    id: 'sar-cyp450',
    title: 'Structure-Activity Relationships and the CYP450 Enzymes',
    part: P.I,
    tags: ['sar', 'cyp450', 'metabolism', 'grapefruit', 'naringenin'],
    posture: POSTURE.HOST,
    body: [
      'A recurring theme is that a molecule\'s behaviour follows from its structure (structure-activity '
      + 'relationship, SAR) and from how the body\'s metabolic enzymes handle it. The cytochrome P450 '
      + '(CYP450) family is the liver\'s main drug-metabolizing machinery, and small changes to a '
      + 'molecule can move it from one CYP pathway to another, or change how fast it is cleared.',
      'The archive\'s worked example is the grapefruit effect: naringenin and related furanocoumarins '
      + 'in grapefruit inhibit specific CYP enzymes (notably CYP3A4), which slows the breakdown of '
      + 'anything that enzyme would otherwise clear and so raises its effective exposure. This is '
      + 'presented to explain why enzyme inhibition matters pharmacologically — it is the same logic '
      + 'that underlies the ayahuasca/"oilahuasca" bioavailability discussion — and as a caution: '
      + 'CYP interactions are exactly how ordinary foods and drugs produce unexpected, sometimes '
      + 'dangerous, potentiation. It is context for reading the literature, not an instruction to '
      + 'combine anything.',
    ],
    sources: [
      { label: '@marsresident, "Church of Neuroscience", Steemit (2016)' },
      { label: 'CYP450 enzyme/interaction notes (knowledge/psychedelics)' },
    ],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'building-brains',
    title: 'Building Brains: Glia, Myelin, Dendrites, and Life-Extension Ideas',
    part: P.I,
    tags: ['neuroscience', 'glia', 'myelin', 'ampakines', 'life-extension'],
    posture: POSTURE.HOST,
    body: [
      'The "Building Brains" essay collects mechanisms by which nervous tissue might be maintained or '
      + 'enhanced, each tied to a target cell type. On the life-extension end it pairs cycloastragenol '
      + '(a telomerase-activating saponin from Astragalus) with carnosine (an anti-glycation dipeptide) '
      + 'as a durability idea. It reaches for Einstein\'s brain — famous for an unusual density of glial '
      + 'cells — as the essay\'s organizing image: that the glia, not just the neurons, are worth '
      + 'building.',
      'From there it walks the glial and neuronal cast. Oligodendrocytes (the myelinating cells) are '
      + 'discussed through remyelination, citing clemastine — an old antihistamine repurposed in MS '
      + 'trials for its pro-myelination signal. Astrocytes are discussed through adenosine-receptor '
      + 'blockade (regadenoson is named as an adenosine-receptor agent), and dendritic/synaptic '
      + 'strengthening through the ampakines (AMPA-receptor positive modulators such as aniracetam and '
      + 'the research compound CX-614).',
      'One idea is explicitly flagged as UNTESTED and UNSAFE: the notion of using the endocannabinoid '
      + '2-AG as a traumatic-brain-injury neuroprotectant by "priming" with tacrolimus. The 2026 '
      + 'update revisits this and confirms it stayed a speculation — it was never validated and should '
      + 'not be treated as a protocol. This article reports these as hypotheses and preclinical '
      + 'signals, not as therapies.',
    ],
    sources: [{ label: '@marsresident, "Church of Neuroscience", Steemit (2016)' }],
    disclaimer: DISCLAIMER,
    cautions: ['The 2-AG / tacrolimus TBI "primer" idea is UNTESTED and UNSAFE — reported as a '
      + 'hypothesis only, never as a therapy.'],
  },
  {
    id: 'brain-balance',
    title: 'Brain Balance: The Cold-War Split in Neuroscience',
    part: P.I,
    tags: ['history', 'soviet-pharmacology', 'psychedelic-history', 'mdma', 'psilocybin'],
    posture: POSTURE.HOST,
    body: [
      'This essay is history of science rather than pharmacology. Its thesis is that twentieth-century '
      + 'brain research split along Cold-War lines: a Soviet/Eastern tradition that pursued '
      + '"nootropic" pharmacology (piracetam was synthesized in the Soviet bloc) and a Western '
      + 'tradition that took a different path, so that each side developed knowledge the other lacked.',
      'It surveys the Western strand: mid-century research on tryptamines and on melatonin; the '
      + 'psychiatric use of MDMA and psilocybin before prohibition foreclosed it; and the darker '
      + 'institutional history, naming the U.S. Army\'s Edgewood Arsenal chemical-warfare human '
      + 'experiments. It cites the observation, from early studies of Native American Church members, '
      + 'that regular peyote use co-occurred with low rates of alcoholism — an early data point in the '
      + 'idea that a psychedelic might treat addiction.',
      'The material is presented as documented history and as context for the modern psychedelic-'
      + 'psychiatry revival, which the 2026 update notes has since been substantially vindicated in '
      + 'controlled trials. It is not a how-to and contains no protocol.',
    ],
    sources: [{ label: '@marsresident, "Church of Neuroscience", Steemit (2016)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'building-muscle',
    title: 'Building Muscle Tissue: The Recovery and Atrophy Literature',
    part: P.I,
    tags: ['creatine', 'arginine', 'citrulline', 'sarms', 'recovery'],
    posture: POSTURE.HOST,
    body: [
      'The muscle-tissue essay reads the sports- and rehabilitation-science literature for what it says '
      + 'about building and preserving muscle, with an emphasis on recovery rather than performance. '
      + 'Creatine is covered through its best-evidenced and least-glamorous use: the spinal-cord-injury '
      + 'and neuromuscular literature, where creatine supplementation has been studied for functional '
      + 'recovery, not just for athletic gain.',
      'Arginine and citrulline are discussed as nitric-oxide precursors bearing on blood flow and '
      + 'wound healing (citrulline being the more bioavailable route to raising arginine). The '
      + 'selective androgen receptor modulators (SARMs) — S4/andarine is named — are discussed as '
      + 'research compounds studied for muscle-wasting (atrophy) and wound recovery. The essay is '
      + 'careful about a common confusion: a substance can be banned by anti-doping bodies without '
      + 'being a controlled substance; "banned in sport" and "illegal to possess" are different '
      + 'categories. These are summarized as literature; no dosing is given.',
    ],
    sources: [{ label: '@marsresident, "Church of Neuroscience", Steemit (2016)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'dream-stimulation',
    title: 'Dream-Stimulation Stacks: Lucid Dreaming, Ancient and Modern',
    part: P.I,
    tags: ['lucid-dreaming', 'dream-yoga', 'galantamine', 'ubulawu', 'oneirogens'],
    posture: POSTURE.HOST,
    body: [
      'The dream section places modern lucid-dreaming technique inside a much older lineage. It draws '
      + 'on Tibetan and Hindu dream yoga, and on ancient dreaming practices — the Egyptian rsw.t '
      + '(dream), temple dream-incubation, and the recurring cross-cultural idea of a shared or spirit '
      + 'dream-world. Against that background it lays out the contemporary induction techniques by '
      + 'their initials: WILD (wake-initiated), MILD (mnemonic), DILD (dream-initiated) and the WBTB '
      + '("wake back to bed") timing trick.',
      'Its "materials" list is a pharmacology reference, deliberately without doses. It names melatonin '
      + 'and 5-HTP (serotonin/melatonin precursors), Mucuna pruriens (an L-DOPA source), the choline '
      + 'donor alpha-GPC, and galantamine — an acetylcholinesterase inhibitor and the best-studied '
      + 'pharmacological lucid-dream aid. It lists the ubulawu "dream root" plants (Silene capensis, '
      + 'Helinus species), the memory compound PRL-8-53, the bioavailability enhancer piperine, the '
      + 'aromatic imphepho, oxytocin, the mulungu tree (Erythrina), and vitamin C. Datura appears in '
      + 'the list only tagged as a poison, with no amount — see the Datura article for the warning.',
      'Everything here is described as mechanism and tradition. The 2026 update carries an important '
      + 'correction to this section (the 40Hz-tACS lucid-dream claim did not replicate); read the '
      + 'retraction article alongside this one.',
    ],
    sources: [{ label: '@marsresident, "Church of Neuroscience", Steemit (2016)' }],
    disclaimer: DISCLAIMER,
    cautions: [CAUTIONS.DATURA],
  },
  {
    id: 'cancer-endocannabinoid-system',
    title: 'Cancer and the Endocannabinoid System',
    part: P.I,
    tags: ['cancer', 'endocannabinoid-system', 'cb1', 'cb2', 'faah'],
    posture: POSTURE.HOST,
    body: [
      'This essay summarizes the preclinical literature on cannabinoids in oncology and links out '
      + 'rather than overclaiming. It sets out the basic taxonomy first — neoplasm vs. tumor, benign '
      + 'vs. malignant — and then introduces the endocannabinoid system (ECS) as a therapeutic target: '
      + 'the CB1 and CB2 receptors, the endogenous ligands (anandamide and 2-AG), and the enzymes that '
      + 'make and break them, notably FAAH (fatty-acid amide hydrolase). FAAH inhibitors and dietary '
      + 'fatty acids are discussed as ways the system\'s tone can be shifted.',
      'It then surveys, at the level of "there is a literature here", the laboratory studies reporting '
      + 'anti-proliferative or pro-apoptotic cannabinoid effects across several cancer models — colon, '
      + 'lung, breast, glioma, and melanoma among them. The essay\'s own framing is cautious and it is '
      + 'reproduced cautiously: these are cell-culture and animal findings and hypotheses, not '
      + 'demonstrated human cancer treatments. Readers are pointed to the primary oncology literature '
      + 'rather than given any regimen.',
    ],
    sources: [
      { label: '@marsresident, "Church of Neuroscience", Steemit (2016)' },
      { label: 'Cannabinoid synthesis / ECS research notes (knowledge/herbs)' },
    ],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'future-medicine-psychedelics',
    title: 'The Future of Medicine: Reading Psychedelic Pharmacology by Structure and Enzyme',
    part: P.I,
    tags: ['pharmacology', 'allylbenzenes', 'cyp2a6', 'receptors', 'sar'],
    posture: POSTURE.HOST,
    body: [
      'The closing Part I essay is the most technical and the most explicitly hedged: it is a reference '
      + 'for reading pharmacology by structure and metabolism, and it contains no preparation or '
      + 'synthesis procedure. Its worked family is the allylbenzenes, where the essay gives a '
      + '"benzene-ring position guide": which of ring positions 1 through 6 a substituent occupies '
      + 'shapes the resulting molecule\'s character. This is presented as a way to read a structure, '
      + 'not as a route to make anything.',
      'On metabolism it discusses how a molecule such as safrole is handled by CYP enzymes (CYP2A6 is '
      + 'named), and identifies 17β-HSD2 as a key activating enzyme in the relevant pathway. It returns '
      + 'to the grapefruit/naringenin CYP-inhibition motif from the SAR article to note how enzyme '
      + 'inhibition changes a time-course — a window on the order of several hours. Again this is '
      + 'pharmacokinetics as explanation, not as a recipe.',
      'It closes with two reference tables condensed to their point: a receptor reference (plants and '
      + 'compounds acting as agonists at 5-HT1A, 5-HT1D, and 5-HT2A serotonin receptors, and plants '
      + 'touching the NMDA glutamate receptor) and an enzyme reference (common kitchen botanicals — '
      + 'cinnamon, clove, chamomile, goldenseal — noted as CYP inhibitors). These are given as '
      + 'literature summaries with the caution that "these interact" is itself the safety message.',
    ],
    sources: [
      { label: '@marsresident, "Church of Neuroscience", Steemit (2016)' },
      { label: 'CYP450 enzyme database / enzymatic-alchemy notes (knowledge/psychedelics)' },
    ],
    disclaimer: DISCLAIMER,
    cautions: [],
  },

  // ─────────────────────────── PART II — Plant Medicine for Humans ───────────────────────────
  {
    id: 'plant-medicine-periodic-table',
    title: 'Plant Medicine for Humans: Give the Body the Periodic Table',
    part: P.II,
    tags: ['nutrition', 'amino-acids', 'calendula', 'kali-van-kush', 'regimen'],
    posture: POSTURE.HOST,
    body: [
      'The 2021 "Plant Medicine for Humans" material reframes the project as a health regimen with a '
      + 'single organizing metaphor: "give the body the Periodic Table" — supply the full range of '
      + 'elements and building blocks the body works with, rather than chasing one compound. Under '
      + 'that banner "Plant Medicine for Humans" is summarized as, at its simplest, amino acids plus '
      + 'calendula (a traditional skin-and-tissue botanical).',
      'It ties the regimen back to the operator\'s Kali Van Kush line of soaps and oils — the plant '
      + 'chemistry of the topical products and the ingestible regimen are treated as one continuous '
      + 'interest in what plants do for human tissue. This article is the umbrella; the entries that '
      + 'follow (silica and collagen, chelated minerals and liposomal vitamin C, bone nutrients and '
      + 'creatine, the B-vitamins, and the growth-hormone axis) each take one strand. As with Part I, '
      + 'the framing is discussion of the nutrition and physiology, not a dosing plan.',
    ],
    sources: [{ label: '@punicwax, "Plant Medicine for Humans", Blurt/Steemit (2021)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'quartz-in-cells',
    title: 'Adding Quartz to Human Cells: Silica, Collagen, and Connective Tissue',
    part: P.II,
    tags: ['silica', 'orthosilicic-acid', 'collagen', 'horsetail'],
    posture: POSTURE.HOST,
    body: [
      'This entry\'s striking title — "adding quartz to human cells" — is a way into the biology of '
      + 'silicon in connective tissue. Silicates and silicon are discussed for their role alongside '
      + 'collagen in the strength of skin, bone, and vessel walls. The bioavailable form the essay '
      + 'centers on is orthosilicic acid, the soluble silicon species the body can actually absorb, '
      + 'and the traditional dietary source it names is horsetail (Equisetum), a silica-rich plant.',
      'The claim being reported is the mainstream nutritional one — that silicon supports collagen '
      + 'formation and connective-tissue integrity — presented as physiology rather than as a cure. No '
      + 'dose is given; the point is the mechanism (soluble silicon → collagen matrix), and the '
      + 'observation that the useful form is the soluble one, not "eating quartz".',
    ],
    sources: [{ label: '@punicwax, "Plant Medicine for Humans", Blurt/Steemit (2021)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'chelated-minerals-liposomal-c',
    title: 'Chelated Minerals and Liposomal Vitamin C: The Bioavailability Question',
    part: P.II,
    tags: ['minerals', 'chelates', 'traacs', 'liposomal', 'vitamin-c', 'bioavailability'],
    posture: POSTURE.HOST,
    body: [
      'This entry is about bioavailability — not just which nutrient, but in which form the body can '
      + 'take it up. It discusses amino-acid-chelated minerals (naming the TRAACS / Albion chelate '
      + 'technology, in which a mineral is bound to amino acids to improve absorption and reduce '
      + 'gastric irritation) as a more absorbable alternative to plain mineral salts, and liposomal '
      + 'vitamin C (ascorbate packaged in phospholipid vesicles) as a way to raise the fraction of an '
      + 'oral dose that is absorbed.',
      'The essay wraps this in the operator\'s characteristic planetary / Old Farmer\'s Almanac framing '
      + '— relating nutrition and gardening to seasonal and cosmological cycles as an organizing '
      + 'aesthetic. That framing is reported as the author\'s worldview, distinct from the '
      + 'absorption-chemistry claims, which are the mainstream ones. The takeaway offered is '
      + 'conceptual: form governs uptake. No amounts are prescribed.',
    ],
    sources: [{ label: '@punicwax, "Plant Medicine for Humans", Blurt/Steemit (2021)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'bone-vitamins-creatine',
    title: 'Bone Vitamins and Creatine: The Growth-Cycle Analogy',
    part: P.II,
    tags: ['bone', 'vitamin-k2', 'mk-7', 'creatine'],
    posture: POSTURE.HOST,
    body: [
      'This entry treats bone as a living, remodeling tissue and reaches for a plant analogy — a '
      + 'plant\'s growth cycle standing in for the deposition-and-resorption cycle of bone. On the '
      + 'nutrient side it discusses the bone-directed vitamins, naming a Bone-Up-style combination and '
      + 'singling out vitamin K2 in its MK-7 form, which directs calcium into bone (via osteocalcin) '
      + 'rather than into soft tissue.',
      'It also revisits creatine — a Part I subject — from the tissue-building angle, noting that it '
      + 'is sold in several chemical forms (the well-studied monohydrate among them) that differ in '
      + 'solubility and marketing more than in demonstrated benefit. The discussion stays at the level '
      + 'of what each nutrient does; it does not set a regimen.',
    ],
    sources: [{ label: '@punicwax, "Plant Medicine for Humans", Blurt/Steemit (2021)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'b-vitamins-observational',
    title: 'B-Vitamins and Observational Dosing: "Read Your Urine"',
    part: P.II,
    tags: ['b-vitamins', 'picamilon', 'niacin', 'gaba', 'self-observation'],
    posture: POSTURE.HOST,
    body: [
      'The B-vitamin entry pairs a specific compound with a general method. The compound is picamilon '
      + '(a molecule joining niacin to GABA), discussed because the niacin moiety helps the otherwise '
      + 'poorly-penetrating GABA cross the blood-brain barrier — a neat illustration of the '
      + 'bioavailability theme that runs through Part II.',
      'The method is what the essay calls "reading your urine": because the B-vitamins are water-'
      + 'soluble and their excess is excreted (riboflavin famously turning urine bright yellow), the '
      + 'body gives a crude visible signal of saturation. This is presented as an informal '
      + 'self-observation heuristic — a folk biomarker — not as a dosing instruction, and it echoes the '
      + 'T-0 observation method of Part I: watch the body\'s own readouts rather than trusting a number '
      + 'on a label.',
    ],
    sources: [{ label: '@punicwax, "Plant Medicine for Humans", Blurt/Steemit (2021)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },
  {
    id: 'human-growth-hormone',
    title: 'The Growth-Hormone Axis: Plant Hormones as an Analogy',
    part: P.II,
    tags: ['growth-hormone', 'igf-1', 'ghrh', 'peptides', 'auxins'],
    posture: POSTURE.HOST,
    body: [
      'The final Part II entry surveys the human growth-hormone axis and opens with an analogy to '
      + 'plant hormones: the auxins and cytokinins that govern plant growth are set beside the human '
      + 'endocrine signals as a way to think about growth regulation across kingdoms. The analogy is '
      + 'presented as a framing device, not as a claim that the molecules are interchangeable.',
      'It then names the components of the human axis that the peptide-research literature discusses: '
      + 'IGF-1 (and the research analog IGF-1 LR3), the growth-hormone-releasing hormone GHRH and the '
      + 'secretagogue peptides GHRP-2 and GHRP-6, and the gonadal-axis agents gonadorelin and hCG. At '
      + 'the consumer end it notes SeroVital, an amino-acid blend marketed as a growth-hormone '
      + 'secretagogue. These are catalogued as pharmacology and endocrinology — what each does in the '
      + 'axis — with no dosing, no sourcing, and no protocol; several are prescription or '
      + 'research-only agents, and the entry is a map of the axis, not a guide to using it.',
    ],
    sources: [{ label: '@punicwax, "Plant Medicine for Humans", Blurt/Steemit (2021)' }],
    disclaimer: DISCLAIMER,
    cautions: [],
  },

  // ─────────────────────────── PART III — 2026 Update ───────────────────────────
  {
    id: 'instrumentation-2026',
    title: 'Instrumentation in 2026: From Neulog to OpenBCI, Galea, and Consumer EEG',
    part: P.III,
    tags: ['eeg', 'openbci', 'galea', 'muse', 'wearables', 'pre-registration'],
    posture: POSTURE.HOST,
    body: [
      'The 2016 material improvised its measurement with education-grade Neulog sensors. The 2026 '
      + 'update replaces that with the hardware that now exists. OpenBCI\'s boards (Cyton and the '
      + 'smaller Ganglion) with the Ultracortex headset put research-grade EEG on one hardware clock — '
      + 'the single most important property for aligning a stimulus with a brain response. Galea '
      + '(OpenBCI\'s headset combining EEG with other physiological sensors) is noted as the '
      + 'higher-end integrated option.',
      'On the consumer side it tracks the sleep-EEG headbands: the Muse S (Athena / Gen 2) is the live '
      + 'option, validated in the literature against polysomnography with the usual caveats; the '
      + 'earlier Dreem band is noted as discontinued in 2021. Wrist wearables are included for '
      + 'sleep-staging and autonomic proxies, with the caveat that a wrist estimate is not an EEG.',
      'The point of the article is methodological, and it is the load-bearing one for all of Part III: '
      + 'better sensors do not by themselves produce evidence. Real evidence requires a '
      + 'PRE-REGISTERED protocol with a SHAM (placebo) condition — the analysis and the controls fixed '
      + 'in advance — without which even clean recordings only produce stories. ' + PART_III_ASOF + '.',
    ],
    sources: [
      { label: 'OpenBCI documentation', url: 'https://openbci.com' },
      { label: 'HOPE trial (40Hz sensory stimulation in Alzheimer\'s), NCT05637801',
        url: 'https://clinicaltrials.gov/study/NCT05637801' },
    ],
    disclaimer: DISCLAIMER,
    cautions: [],
    asOf: PART_III_ASOF,
  },
  {
    id: 'forty-hz-methods',
    title: '40Hz Methods: Seven Ways to Deliver Gamma Entrainment',
    part: P.III,
    tags: ['40hz', 'gamma', 'genus', 'tacs', 'flicker', 'audiovisual'],
    posture: POSTURE.HOST,
    body: [
      'The interest in 40Hz stimulation comes from the MIT GENUS work (Tsai lab), which reported that '
      + 'driving gamma-band (40Hz) activity in mouse models engaged microglia and glymphatic clearance '
      + 'and reduced amyloid — motivating a wave of human trials in Alzheimer\'s disease. This article '
      + 'catalogues the delivery methods that have been tried, in rough order of how they trade comfort '
      + 'against evidence.',
      '(1) Luminance flicker / strobe — the original and most unpleasant route; the OVERTURE trial '
      + 'reported headache and tinnitus among side effects. (2) Invisible spectral flicker (ISF) — '
      + 'modulates colour rather than brightness for far better comfort, and has been run in '
      + 'triple-masked trials. (3) Auditory 40Hz — clicks or modulated tone, used eyes-closed, with no '
      + 'photosensitivity risk. (4) Combined audiovisual — the current trial standard (as in the '
      + 'Spectris AD program), typically framed as about an hour a day at home. (5) Vibrotactile — '
      + '40Hz delivered through touch. (6) Electrical (tACS) — transcranial alternating-current '
      + 'stimulation at 40Hz. (7) Screens, apps, and DIY rigs — the least controlled category.',
      'Two of these carry non-negotiable cautions. The electrical route: ' + CAUTIONS.TACS_40HZ + ' '
      + 'And the light routes in general: ' + CAUTIONS.LIGHT_40HZ + ' See the safety-and-retractions '
      + 'article for the full flicker-safety list. ' + PART_III_ASOF + '.',
    ],
    sources: [
      { label: 'MIT GENUS — gamma entrainment using sensory stimulation (Tsai lab, Nature 2016 and later)' },
      { label: 'OVERTURE trial (Cognito Therapeutics, 40Hz sensory stimulation)' },
      { label: 'HOPE trial, NCT05637801', url: 'https://clinicaltrials.gov/study/NCT05637801' },
    ],
    disclaimer: DISCLAIMER,
    cautions: [CAUTIONS.TACS_40HZ, CAUTIONS.LIGHT_40HZ, CAUTIONS.FLICKER_SAFETY],
    asOf: PART_III_ASOF,
  },
  {
    id: 'safety-and-retractions',
    title: 'Safety, a Retraction, and Status Checks on the Old Claims',
    part: P.III,
    tags: ['safety', 'retraction', 'lucid-dreaming', 'tacs', 'status-check'],
    posture: POSTURE.HOST,
    body: [
      'Part III ends with the corrections, because a research record that never revises itself is not '
      + 'a research record. First, the non-negotiable safety floor for the 40Hz methods: '
      + CAUTIONS.FLICKER_SAFETY + ' And for the electrical route specifically: ' + CAUTIONS.TACS_40HZ
      + ' 40Hz light therapy is, to be explicit, ' + CAUTIONS.LIGHT_40HZ.toLowerCase(),
      'The headline retraction concerns lucid dreaming. Part I cited 40Hz tACS as a lucid-dream '
      + 'induction method, on the strength of Voss et al. (2014). It did not hold up: a 2019 review '
      + 'failed to replicate the effect, work from the Montreal Dream & Nightmare Lab did not reproduce '
      + 'it, and a 2022 analysis concluded that the frontal "40Hz" signal in the original was largely '
      + 'myogenic (muscle) artifact rather than cortical activity. What survives as a genuine, if '
      + 'modest, lucid-dreaming aid is the pharmacological/behavioural stack — galantamine with a '
      + 'choline donor on a WBTB wake, plus morning naps — against a natural base rate of roughly 18%. '
      + 'The electrical shortcut is dropped.',
      'The rest is a status-check ledger. Cycloastragenol / TA-65 held up as a telomere and '
      + 'immunosenescence biomarker in double-blind trials (a 2025 review affirms this) but has NOT '
      + 'been shown to extend human lifespan, and no clinical cancer-risk signal has emerged to date. '
      + 'The 2-AG / tacrolimus TBI "primer" idea stayed untested and unsafe; its translation stalled. '
      + 'The ampakines proved narrower in use than hoped — though the adjacent surprise, ketamine as a '
      + 'rapid antidepressant, more than paid for the field. And psychedelic psychiatry, the Part I '
      + 'wager, has been substantially vindicated in controlled trials. ' + EDITORIAL_POSTURE + ' '
      + PART_III_ASOF + '.',
    ],
    sources: [
      { label: 'Voss et al., "Induction of self awareness in dreams through frontal low current '
        + 'stimulation of gamma activity", Nature Neuroscience (2014) — subsequently not replicated' },
      { label: 'Montreal Dream & Nightmare Lab — non-replication of 40Hz tACS lucid-dream induction' },
      { label: 'HOPE trial, NCT05637801', url: 'https://clinicaltrials.gov/study/NCT05637801' },
    ],
    disclaimer: DISCLAIMER,
    cautions: [CAUTIONS.FLICKER_SAFETY, CAUTIONS.TACS_40HZ, CAUTIONS.LIGHT_40HZ],
    asOf: PART_III_ASOF,
  },
]);

// ── lookups (pure, soft-fail) ──────────────────────────────────────────────────────────────────────
/** Fetch one article by id. Returns null for a miss or bad input (never throws). */
export function getArticle(id) {
  const key = String(id == null ? '' : id).trim().toLowerCase();
  if (!key) return null;
  return ARTICLES.find((a) => a.id === key) || null;
}

/** List articles, optionally filtered by part label or tag. Always returns an array. */
export function listArticles({ part = '', tag = '' } = {}) {
  const p = String(part || '').trim().toLowerCase();
  const t = String(tag || '').trim().toLowerCase();
  return ARTICLES.filter((a) => {
    if (p && !a.part.toLowerCase().includes(p)) return false;
    if (t && !(a.tags || []).some((x) => String(x).toLowerCase() === t)) return false;
    return true;
  });
}

/** Naive full-text search over title/tags/body. Case-insensitive; empty query → []. Never throws. */
export function search(query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return [];
  const hits = [];
  for (const a of ARTICLES) {
    const hay = [a.title, (a.tags || []).join(' '), (a.body || []).join(' ')].join(' ').toLowerCase();
    const titleHit = a.title.toLowerCase().includes(q);
    const n = hay.split(q).length - 1;
    if (n > 0) hits.push({ id: a.id, title: a.title, part: a.part, score: (titleHit ? 100 : 0) + n });
  }
  return hits.sort((x, y) => y.score - x.score);
}

// ── rendering (all interpolation esc()'d; hrefs http(s)-allowlisted) ─────────────────────────────────
const STYLE =
  'body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:0 auto;'
  + 'padding:24px;color:#1a1a1a;background:#fbfbf8}a{color:#5a3e85}h1{margin:.2em 0}.muted{color:#666}'
  + '.disclaimer{background:#fff7e6;border:1px solid #e0c980;border-radius:8px;padding:12px 14px;'
  + 'margin:16px 0;font-size:14px}.caution{background:#fdecec;border:1px solid #e0a0a0;border-radius:8px;'
  + 'padding:12px 14px;margin:12px 0;font-weight:600}.badge{display:inline-block;background:#eee;'
  + 'border-radius:4px;padding:1px 7px;font-size:12px;margin-left:6px;color:#444}.grid a{display:block;'
  + 'padding:8px 0;border-bottom:1px solid #eee}.asof{font-size:13px;color:#8a6d00}'
  + '.alpha{position:fixed;top:8px;left:8px;background:#5a3e85;color:#fff;border-radius:4px;'
  + 'padding:2px 8px;font-size:11px;letter-spacing:.05em}';

function page(title, inner) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${esc(title)}</title><style>${STYLE}</style></head><body>`
    + '<span class="alpha">Alpha</span>' + inner + '</body></html>';
}

function disclaimerBlock() { return `<div class="disclaimer">${esc(DISCLAIMER)}</div>`; }

/** Escaped HTML for the corpus index. Pure; groups by part. */
export function renderIndex() {
  const byPart = [P.I, P.II, P.III].map((label) => {
    const arts = ARTICLES.filter((a) => a.part === label);
    const rows = arts.map((a) => `<a href="/a/${esc(a.id)}">${esc(a.title)}</a>`).join('');
    return `<h2>${esc(label)}</h2><div class="grid">${rows}</div>`;
  }).join('');
  const inner = '<h1>The Church of Neuroscience</h1>'
    + '<p class="muted">A biohacking and plant-medicine science-discussion library — the record of a '
    + 'personal research program across three parts.</p>'
    + disclaimerBlock()
    + `<p class="muted">${esc(EDITORIAL_POSTURE)}</p>`
    + byPart;
  return page('The Church of Neuroscience', inner);
}

/** Escaped HTML for one article, by id. Returns { code, html }. 404 with a safe page on a miss. */
export function renderArticle(id) {
  const a = getArticle(id);
  if (!a) {
    return { code: 404, html: page('Not found',
      `<h1>Not found</h1><p class="muted">No article "${esc(id)}". <a href="/">← Library</a></p>`) };
  }
  const cautions = (a.cautions || []).map((c) => `<div class="caution">${esc(c)}</div>`).join('');
  const paras = (a.body || []).map((p) => `<p>${esc(p)}</p>`).join('');
  const asOf = a.asOf ? `<p class="asof">Snapshot: ${esc(a.asOf)}.</p>` : '';
  const sources = (a.sources || []).map((s) => {
    const label = esc(s && s.label || '');
    const href = safeHref(s && s.url);
    return `<li>${href ? `<a href="${esc(href)}" rel="noopener noreferrer">${label}</a>` : label}</li>`;
  }).join('');
  const inner = '<p class="muted"><a href="/">← Library</a></p>'
    + `<h1>${esc(a.title)}</h1>`
    + `<p class="muted">Part ${esc(a.part)}<span class="badge">${esc(a.posture)}</span></p>`
    + disclaimerBlock()
    + cautions
    + paras
    + asOf
    + `<h2>Sources</h2><ul>${sources || '<li class="muted">—</li>'}</ul>`
    + `<p class="muted">${esc(EDITORIAL_POSTURE)}</p>`;
  return { code: 200, html: page(a.title, inner) };
}

// ── HTTP surface ─────────────────────────────────────────────────────────────────────────────────────
const PORT = +(process.env.PORT || 8171);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

/** handler(req,res) — GET / (index), GET /a/:id (article), GET /api/articles (JSON), /health. Never throws. */
export function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname;
    const sendHtml = (html, code = 200) => {
      res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
      res.end(html);
    };
    if (p === '/' || p === '/church-of-neuroscience') return sendHtml(renderIndex());
    if (p.startsWith('/a/')) {
      const r = renderArticle(decodeURIComponent(p.slice('/a/'.length)));
      return sendHtml(r.html, r.code);
    }
    if (p === '/api/articles') {
      const list = ARTICLES.map((a) => ({ id: a.id, title: a.title, part: a.part, tags: a.tags }));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ count: list.length, articles: list }));
    }
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }
    return sendHtml(page('404', '<h1>404</h1><p class="muted"><a href="/">← Library</a></p>'), 404);
  } catch (e) {
    try { res.writeHead(500); res.end('error'); } catch {}
  }
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('church-of-neuroscience.mjs')) {
  if (process.env.SERVE === '1') {
    createServer(handler).listen(PORT, HOST, () =>
      console.log(`Church of Neuroscience on ${BASE_URL} (bound ${HOST}:${PORT}, ${ARTICLES.length} articles)`));
  } else {
    console.log(`Church of Neuroscience — ${ARTICLES.length} articles`);
    console.log('─'.repeat(60));
    for (const label of [P.I, P.II, P.III]) {
      console.log(label);
      for (const a of ARTICLES.filter((x) => x.part === label)) console.log(`  ${a.id.padEnd(34)} ${a.title}`);
    }
  }
}
