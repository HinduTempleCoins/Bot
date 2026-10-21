// interactions-cannabis.mjs — the cannabinoid, endocannabinoid and botanical-potentiator extension to
// the mechanism-based interaction engine in interactions.mjs / interactions-data.mjs.
//
// WHY A SEPARATE FILE. interactions-data.mjs is the curated core: MAOIs, serotonergic drugs, the major
// CYPs, P-gp, tyramine, the licorice mineralocorticoid axis. This file adds the axes the hemp-science
// section needs and the core did not model — the endocannabinoid enzymes (FAAH, MAGL), endocannabinoid
// membrane transport, CB1 and CB2, GABA-A positive modulation, GABA-transaminase, phase-2 UGT and SULT,
// CYP2E1, and additive CNS depression — plus the substances that act on them. Merging happens in
// interactions.mjs, so the core file is untouched and the diff stays reviewable.
//
// THE FOUR NEW RULES, AND WHY EACH EXISTS
//   ruleAdditiveCNS       The kava/alcohol/benzodiazepine/opioid axis. The single most common real-world
//                         harm in this whole corpus, and the core engine had no rule for it.
//   ruleEndocannabinoid   A stack that inhibits FAAH *and* MAGL *and* blocks eCB transport *and* adds a
//                         CB1 agonist is the "cannabinoid oilahuasca" design. It is the corpus' own
//                         central idea and it deserves a finding rather than silence.
//   ruleFullAgonist       A synthetic full CB1 agonist alongside anything else. Partial-agonist ceiling
//                         is what makes cannabis survivable; a full agonist removes it. This is the K2
//                         mechanism and the engine should say so out loud.
//   ruleLiverLoad         Slowing the clearance of a hepatotoxicity-signal botanical with a CYP
//                         inhibitor. The kava-plus-grapefruit pattern: two mechanisms pointing at one
//                         organ, and a "potentiation" that is also a toxicology problem.
//
// REGISTER. This file describes documented pharmacology and names hazards. It does not tell anyone what
// to take, and it carries no efficacy language — the rendered output is scanned for claim phrases by
// site/hathor-live/the-line.mjs claimsCheck, and that test is a feature.
//
// IN-VITRO HONESTY. Most natural FAAH/MAGL/uptake inhibition below is in-vitro potency at micromolar
// concentrations. A micromolar IC50 against an enzyme in a dish says nothing about whether a dietary or
// tea dose reaches that concentration at the enzyme in a person. Every such role carries that caveat in
// its note, because a table that omits it reads as a dosing recommendation.

/** CITES_CANNABIS — added bibliography. `verified: false` means we did not confirm the identifier. */
export const CITES_CANNABIS = Object.freeze({
  // ── endocannabinoid targets and natural ligands ────────────────────────────────────────────────
  gertsch2008: { authors: 'Gertsch J, Leonti M, Raduner S, et al.', year: 2008, title: 'Beta-caryophyllene is a dietary cannabinoid', journal: 'PNAS', doi: '10.1073/pnas.0803601105', verified: 'crossref' },
  ligresti2016: { authors: 'Ligresti A, De Petrocellis L, Di Marzo V', year: 2016, title: 'From Phytocannabinoids to Cannabinoid Receptors and Endocannabinoids: Pleiotropic Physiological and Pathological Roles Through Complex Pharmacology', journal: 'Physiological Reviews', doi: '10.1152/physrev.00002.2016', verified: 'crossref' },
  pertwee2008: { authors: 'Pertwee RG', year: 2008, title: 'The diverse CB1 and CB2 receptor pharmacology of three plant cannabinoids: delta9-tetrahydrocannabinol, cannabidiol and delta9-tetrahydrocannabivarin', journal: 'British Journal of Pharmacology', doi: '10.1038/sj.bjp.0707442', verified: 'crossref' },
  longSelective2009: { authors: 'Long JZ, Li W, Booker L, et al.', year: 2009, title: 'Selective blockade of 2-arachidonoylglycerol hydrolysis produces cannabinoid behavioral effects', journal: 'Nature Chemical Biology', doi: '10.1038/nchembio.129', verified: 'crossref' },
  schlosburg2010: { authors: 'Schlosburg JE, Blankman JL, Long JZ, et al.', year: 2010, title: 'Chronic monoacylglycerol lipase blockade causes functional antagonism of the endocannabinoid system', journal: 'Nature Neuroscience', doi: '10.1038/nn.2601', verified: 'crossref' },

  // ── the natural inhibitors ─────────────────────────────────────────────────────────────────────
  // 8-PN as a MAGL inhibitor and as a phytoestrogen. The estrogenicity is not a footnote: it is the
  // best-documented pharmacology this compound has.
  // Was a placeholder ("Publication reporting…") with no identifier, which the core dataset's own test
  // correctly refuses. Resolved against Crossref: this is the paper the claim comes from.
  pn8magl: { authors: 'Tung C-W, Fung K-M, Hsu C-C, Tseng T-S', year: 2021, title: "Discovery of 8-prenylnaringenin from hop (Humulus lupulus L.) as a potent monoacylglycerol lipase inhibitor for treatments of neuroinflammation and Alzheimer's disease", journal: 'RSC Advances', doi: '10.1039/d1ra05311f', verified: 'crossref',
    note: 'The DOI, title, authors and journal were resolved against Crossref. The specific IC50 figure was NOT read off the paper text in that pass, so the role below states the potency band rather than a number.' },
  milligan1999: { authors: 'Milligan SR, Kalita JC, Heyerick A, Rong H, De Cooman L, De Keukeleire D', year: 1999, title: 'Identification of a potent phytoestrogen in hops (Humulus lupulus L.) and beer', journal: 'The Journal of Clinical Endocrinology & Metabolism', doi: '10.1210/jcem.84.6.5887', verified: 'crossref' },
  // Re-keyed from `nikolic2005`, which named neither the right author nor the right year, and resolved
  // against Crossref. Cited for the intestinal conversion of isoxanthohumol to 8-prenylnaringenin,
  // which is why hop exposure is person-dependent.
  possemiers2011: { authors: 'Possemiers S, Bolca S, Verstraete W, Heyerick A', year: 2011, title: 'The intestinal microbiome: A separate organ inside the body with the metabolic potential to influence the bioactivity of xenobiotics', journal: 'Fitoterapia', doi: '10.1016/j.fitote.2010.07.012', verified: 'crossref' },
  nicolussi2014: { authors: 'Nicolussi S, Gertsch J', year: 2015, title: 'Endocannabinoid transport revisited', journal: 'Vitamins and Hormones', doi: '10.1016/bs.vh.2014.12.011', verified: 'crossref' },
  nicolussi2014guineensine: { authors: 'Nicolussi S, Viveros-Paredes JM, Gachet MS, et al.', year: 2014, title: 'Guineensine is a novel inhibitor of endocannabinoid uptake showing cannabimimetic behavioral effects in BALB/c mice', journal: 'Pharmacological Research', doi: '10.1016/j.phrs.2013.12.010', verified: 'crossref' },
  raduner2006: { authors: 'Raduner S, Majewska A, Chen JZ, et al.', year: 2006, title: 'Alkylamides from Echinacea are a new class of cannabinomimetics: cannabinoid type 2 receptor-dependent and -independent immunomodulatory effects', journal: 'Journal of Biological Chemistry', doi: '10.1074/jbc.M601074200', verified: 'crossref' },
  // Was a placeholder with no identifier. Resolved against Crossref.
  alasmari2018: { authors: 'Alasmari M, Bӧhlke M, Kelley C, Maher T, Pino-Figueroa A', year: 2018, title: 'Inhibition of Fatty Acid Amide Hydrolase (FAAH) by Macamides', journal: 'Molecular Neurobiology', doi: '10.1007/s12035-018-1115-8', verified: 'crossref' },
  faahFlavonoid: { authors: 'Thors L, Belghiti M, Fowler CJ', year: 2008, title: 'Inhibition of fatty acid amide hydrolase by kaempferol and related naturally occurring flavonoids', journal: 'British Journal of Pharmacology', doi: '10.1038/bjp.2008.237', verified: 'crossref',
    note: 'CORRECTED. This record previously carried doi 10.1038/bjp.2008.294 marked verified; that DOI resolves to a Salvia divinorum ileitis paper by Capasso et al., not to this one. Re-resolved against Crossref, returned title matching exactly.' },
  // Replaced the unsourced `ligrestiBiochanin` placeholder. No paper on biochanin A and anandamide
  // hydrolysis could be resolved; this one — same isoflavone class, on the TRANSPORT step rather than
  // hydrolysis — could be, so the role below is re-attributed to the constituents actually studied.
  thors2007: { authors: 'Thors L, Eriksson J, Fowler CJ', year: 2007, title: 'Inhibition of the cellular uptake of anandamide by genistein and its analogue daidzein in cells with different levels of fatty acid amide hydrolase-driven uptake', journal: 'British Journal of Pharmacology', doi: '10.1038/sj.bjp.0707401', verified: 'crossref' },

  // ── kava ───────────────────────────────────────────────────────────────────────────────────────
  // The in-vitro CYP picture and the in-vivo probe picture DISAGREE for kava, and the honest handling
  // is to carry both rather than to pick the scarier one. Gurley 2005 is already in the core CITES.
  mathews2002: { authors: 'Mathews JM, Etheridge AS, Black SR', year: 2002, title: 'Inhibition of human cytochrome P450 activities by kava extract and kavalactones', journal: 'Drug Metabolism and Disposition', doi: '10.1124/dmd.30.11.1153', verified: 'crossref' },
  ligresti2012yangonin: { authors: 'Ligresti A, Villano R, Allarà M, Ujváry I, Di Marzo V', year: 2012, title: 'Kavalactones and the endocannabinoid system: the plant-derived yangonin is a novel CB1 receptor ligand', journal: 'Pharmacological Research', doi: '10.1016/j.phrs.2012.04.003', verified: 'crossref' },
  teschke2011: { authors: 'Teschke R, Sarris J, Lebot V', year: 2011, title: 'Kava hepatotoxicity solution: A six-point plan for new kava standardization', journal: 'Phytomedicine', doi: '10.1016/j.phymed.2011.01.018', verified: 'crossref' },
  sarris2011: { authors: 'Sarris J, Kavanagh DJ, Byrne G, Bone KM, Adams J, Deed G', year: 2009, title: 'The Kava Anxiety Depression Spectrum Study (KADSS): a randomized, placebo-controlled crossover trial using an aqueous extract of Piper methysticum', journal: 'Psychopharmacology', doi: '10.1007/s00213-009-1549-9', verified: 'crossref' },
  chua2016: { authors: 'Chua HC, Christensen ETH, Hoestgaard-Jensen K, et al.', year: 2016, title: 'Kavain, the Major Constituent of the Anxiolytic Kava Extract, Potentiates GABA-A Receptors: Functional Characteristics and Molecular Mechanism', journal: 'PLOS ONE', doi: '10.1371/journal.pone.0157700', verified: 'crossref' },

  // ── the GABA botanicals ────────────────────────────────────────────────────────────────────────
  awad2007: { authors: 'Awad R, Muhammad A, Durst T, Trudeau VL, Arnason JT', year: 2009, title: 'Bioassay-guided fractionation of lemon balm (Melissa officinalis L.) using an in vitro measure of GABA transaminase activity', journal: 'Phytotherapy Research', doi: '10.1002/ptr.2763', verified: 'crossref' },
  benke2009: { authors: 'Benke D, Barberis A, Kopp S, et al.', year: 2009, title: 'GABA-A receptors as in vivo substrate for the anxiolytic action of valerenic acid, a major constituent of valerian root extracts', journal: 'Neuropharmacology', doi: '10.1016/j.neuropharm.2008.07.041', verified: 'crossref' },
  awad2003: { authors: 'Awad R, Arnason JT, Trudeau V, et al.', year: 2003, title: 'Phytochemical and biological analysis of skullcap (Scutellaria lateriflora L.): a medicinal plant with anxiolytic properties', journal: 'Phytomedicine', doi: '10.1078/0944-7113-00348', verified: 'crossref' },
  dhawan2004: { authors: 'Dhawan K, Dhawan S, Sharma A', year: 2004, title: 'Passiflora: a review update', journal: 'Journal of Ethnopharmacology', doi: '10.1016/j.jep.2004.02.023', verified: 'crossref' },

  // ── the cannabinoids themselves ────────────────────────────────────────────────────────────────
  jiang2011: { authors: 'Jiang R, Yamaori S, Okamoto Y, Yamamoto I, Watanabe K', year: 2013, title: 'Cannabidiol is a potent inhibitor of the catalytic activity of cytochrome P450 2C19', journal: 'Drug Metabolism and Pharmacokinetics', doi: '10.2133/dmpk.DMPK-12-RG-129', verified: 'crossref' },
  geffrey2015: { authors: 'Geffrey AL, Pollack SF, Bruno PL, Thiele EA', year: 2015, title: 'Drug-drug interaction between clobazam and cannabidiol in children with refractory epilepsy', journal: 'Epilepsia', doi: '10.1111/epi.13060', verified: 'crossref' },
  stott2013: { authors: 'Stott C, White L, Wright S, Wilbraham D, Guy G', year: 2013, title: 'A phase I, open-label, randomized, crossover study in three parallel groups to evaluate the effect of Rifampicin, Ketoconazole, and Omeprazole on the pharmacokinetics of THC/CBD oromucosal spray in healthy volunteers', journal: 'SpringerPlus', doi: '10.1186/2193-1801-2-236', verified: 'crossref' },
  brown2019: { authors: 'Brown JD, Winterstein AG', year: 2019, title: 'Potential Adverse Drug Events and Drug-Drug Interactions with Medical and Consumer Cannabidiol (CBD) Use', journal: 'Journal of Clinical Medicine', doi: '10.3390/jcm8070989', verified: 'crossref' },
  epidiolexLabel: { authors: 'U.S. Food and Drug Administration', year: 2018, title: 'EPIDIOLEX (cannabidiol) oral solution — prescribing information, including the transaminase-elevation and clobazam interaction sections', journal: 'FDA Structured Product Labeling', url: 'https://www.accessdata.fda.gov/scripts/cder/daf/', verified: 'url' },

  // ── the synthetic full agonists ────────────────────────────────────────────────────────────────
  huffman1994: { authors: 'Huffman JW, Dai D, Martin BR, Compton DR', year: 1994, title: 'Design, synthesis and pharmacology of cannabimimetic indoles', journal: 'Bioorganic & Medicinal Chemistry Letters', doi: '10.1016/S0960-894X(01)80143-1', verified: 'crossref' },
  atwood2010: { authors: 'Atwood BK, Huffman J, Straiker A, Mackie K', year: 2010, title: 'JWH018, a common constituent of "Spice" herbal blends, is a potent and efficacious cannabinoid CB1 receptor agonist', journal: 'British Journal of Pharmacology', doi: '10.1111/j.1476-5381.2010.00787.x', verified: 'crossref' },
  adams2017: { authors: 'Adams AJ, Banister SD, Irizarry L, Trecki J, Schwartz M, Gerona R', year: 2017, title: '"Zombie" Outbreak Caused by the Synthetic Cannabinoid AMB-FUBINACA in New York', journal: 'New England Journal of Medicine', doi: '10.1056/NEJMoa1610300', verified: 'crossref' },
  tait2016: { authors: 'Tait RJ, Caldicott D, Mountain D, Hill SL, Lenton S', year: 2016, title: 'A systematic review of adverse events arising from the use of synthetic cannabinoids and their associated treatment', journal: 'Clinical Toxicology', doi: '10.3109/15563650.2015.1110590', verified: 'crossref' },
  moritz2018: { authors: 'Moritz E, Austin C, Wahl M, et al.', year: 2018, title: 'Notes from the Field: Outbreak of Severe Bleeding Among Patients Using Synthetic Cannabinoids Contaminated with Brodifacoum', journal: 'MMWR Morbidity and Mortality Weekly Report', doi: '10.15585/mmwr.mm6745a5', verified: 'crossref' },

  // ── CNS depression, alcohol and the liver ──────────────────────────────────────────────────────
  lieber1997: { authors: 'Lieber CS', year: 1997, title: 'Cytochrome P-4502E1: its physiological and pathological role', journal: 'Physiological Reviews', doi: '10.1152/physrev.1997.77.2.517', verified: 'crossref' },
  chan2017: { authors: 'Chan LN, Anderson GD', year: 2014, title: 'Pharmacokinetic and pharmacodynamic drug interactions with ethanol (alcohol)', journal: 'Clinical Pharmacokinetics', doi: '10.1007/s40262-014-0155-0', verified: 'crossref' },
  dowell2016: { authors: 'Dowell D, Haegerich TM, Chou R', year: 2016, title: 'CDC Guideline for Prescribing Opioids for Chronic Pain — United States, 2016 (concurrent benzodiazepine and opioid risk)', journal: 'JAMA', doi: '10.1001/jama.2016.1464', verified: 'crossref' },
  mucunaClinical: { authors: 'Katzenschlager R, Evans A, Manson A, et al.', year: 2004, title: 'Mucuna pruriens in Parkinson\'s disease: a double blind clinical and pharmacological study', journal: 'Journal of Neurology, Neurosurgery & Psychiatry', doi: '10.1136/jnnp.2003.028761', verified: 'crossref' },
});

/** MECHANISMS_CANNABIS — the added axes. Same shape as the core MECHANISMS. */
export const MECHANISMS_CANNABIS = Object.freeze({
  'faah-inhibition': { slug: 'endocannabinoid', name: 'FAAH inhibition', kind: 'enzyme-inhibition', short: 'Slows fatty acid amide hydrolase, the enzyme that breaks down anandamide and the related fatty-acid amides.', why: 'Raises anandamide tone rather than adding an outside agonist. Additive with anything else acting on the same system, and the clinical FAAH-inhibitor programmes are a reminder that an enzyme inhibitor is not inherently mild.' },
  'magl-inhibition': { slug: 'endocannabinoid', name: 'MAGL inhibition', kind: 'enzyme-inhibition', short: 'Slows monoacylglycerol lipase, which performs the large majority of 2-AG hydrolysis in brain.', why: 'Raises 2-AG and simultaneously diverts it away from the arachidonic-acid pool. Sustained complete blockade produces CB1 desensitisation in animals, so more inhibition is not simply more effect.' },
  'ecb-uptake-inhibition': { slug: 'endocannabinoid', name: 'Endocannabinoid transport inhibition', kind: 'transporter', short: 'Slows the movement of anandamide and 2-AG out of the synapse and into the cell.', why: 'A third route to the same raised tone, and one that stacks with FAAH and MAGL inhibition because the mechanisms are separate. The transport mechanism itself is not settled science.' },
  'cb1-agonism': { slug: 'endocannabinoid', name: 'CB1 agonism (partial)', kind: 'pharmacodynamic', short: 'Activates the CB1 receptor as a partial agonist, as the plant cannabinoids do.', why: 'Partial agonism has a ceiling: beyond a point more drug does not produce more receptor activation. That ceiling is the reason cannabis does not depress respiration to the point of death.' },
  'cb1-full-agonism': { slug: 'endocannabinoid', name: 'CB1 FULL agonism', kind: 'pharmacodynamic', short: 'Activates CB1 with full efficacy and usually with far higher affinity — the synthetic cannabimimetics.', why: 'There is no ceiling. This is the pharmacological difference behind the seizures, tachyarrhythmias, agitated delirium and deaths recorded for the synthetic cannabinoids and not for cannabis.' },
  'cb2-agonism': { slug: 'endocannabinoid', name: 'CB2 agonism', kind: 'pharmacodynamic', short: 'Activates the peripheral and immune-cell cannabinoid receptor.', why: 'Not psychoactive. Relevant here because several very common dietary constituents do it, so it is a real pharmacology hiding in the spice rack rather than an exotic one.' },
  'gaba-a-pam': { slug: 'cns-depression', name: 'GABA-A positive modulation', kind: 'pharmacodynamic', short: 'Increases the effect of GABA at the GABA-A receptor without being GABA.', why: 'The shared mechanism of alcohol, the benzodiazepines, the Z-drugs and the kavalactones. Additivity across agents on this axis is the mechanism behind sedation deepening into respiratory depression.' },
  'gaba-t-inhibition': { slug: 'cns-depression', name: 'GABA-transaminase inhibition', kind: 'enzyme-inhibition', short: 'Slows the enzyme that degrades GABA, so GABA persists in the synapse.', why: 'A different route to the same increased inhibitory tone, which is why it is described as synergistic with GABA-A modulation rather than merely additive.' },
  'cns-depression': { slug: 'cns-depression', name: 'Additive CNS depression', kind: 'pharmacodynamic', short: 'Sedation, impaired coordination, and at sufficient combined load impaired airway protection and breathing.', why: 'The most common serious harm in this whole corpus and the least exotic. It does not need a metabolic interaction to happen: the agents simply add.' },
  'cyp2e1-inhibition': { slug: 'cyp2e1', name: 'CYP2E1 inhibition', kind: 'enzyme-inhibition', short: 'Slows the enzyme handling ethanol at higher concentrations and the bioactivation of paracetamol to NAPQI.', why: 'Both directions matter: inhibition and induction change how much reactive metabolite the liver makes, which is why this enzyme is a hepatotoxicity axis rather than a plain clearance one.' },
  'cyp2e1-induction': { slug: 'cyp2e1', name: 'CYP2E1 induction', kind: 'enzyme-induction', short: 'Raises CYP2E1 expression — chronic ethanol and fasting do this.', why: 'More enzyme means more reactive metabolite from the same paracetamol dose, which is the mechanism behind hepatotoxicity at doses that would otherwise be tolerated.' },
  'ugt-inhibition': { slug: 'phase-2', name: 'UGT inhibition (glucuronidation)', kind: 'enzyme-inhibition', short: 'Slows the phase-2 conjugation that makes a compound water-soluble enough to excrete.', why: 'Phase 2 is the step most interaction checkers skip. Cannabinoids are heavily glucuronidated, so this is not a side issue in this corpus.' },
  'sult-inhibition': { slug: 'phase-2', name: 'SULT inhibition (sulfation)', kind: 'enzyme-inhibition', short: 'Slows sulfotransferase conjugation, which is also readily saturated by a large phenolic load.', why: 'Saturation and inhibition look the same from outside: the substrate is routed down a different pathway than expected.' },
});

const S = (o) => Object.freeze(o);

// The caveat that belongs on every natural enzyme-inhibition role. Written once and reused so it cannot
// be present on some rows and missing on others.
const INVITRO = 'Reported from in-vitro enzyme assays. A micromolar IC50 in a dish does not establish '
  + 'that a dietary, tea or capsule dose reaches that concentration at the enzyme in a person, and for '
  + 'most of these compounds no human pharmacokinetic study exists. Treated here as a mechanism worth '
  + 'knowing about, not as an established clinical effect.';

/**
 * SUBSTANCE_PATCHES — additional roles for substances the core file already lists. Merged by id in
 * interactions.mjs. Nothing is removed or rewritten; roles are appended.
 */
export const SUBSTANCE_PATCHES = Object.freeze([
  S({
    id: 'kava',
    addRoles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'moderate', note: 'Kavain and the other major kavalactones potentiate GABA-A currents by a mechanism distinct from the benzodiazepine site. This is the axis that makes combination with alcohol, benzodiazepines, Z-drugs or opioids the practical hazard rather than any of the exotic mechanisms below.', cites: ['chua2016', 'sarris2011'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'moderate', cites: ['chua2016'] },
      { mech: 'faah-inhibition', role: 'inhibits', strength: 'weak', note: INVITRO, cites: ['ligresti2012yangonin'] },
      { mech: 'magl-inhibition', role: 'inhibits', strength: 'weak', note: INVITRO, cites: ['ligresti2012yangonin'] },
      { mech: 'cb1-agonism', role: 'agonist', strength: 'weak', note: 'Yangonin binds CB1 with a reported Ki near 720 nM — the same order as the endocannabinoid 2-AG at roughly 472 nM. Binding affinity is not efficacy, and what yangonin does at the receptor once bound is less well characterised than the binding itself.', cites: ['ligresti2012yangonin'] },
      { mech: 'mao-b-inhibition', role: 'inhibits', strength: 'weak', note: 'All six major kavalactones inhibit MAO-B reversibly in vitro. B-selective and reversible inhibition carries a much smaller dietary-tyramine hazard than a non-selective irreversible MAOI, which is why this is scored weak rather than dropped.', cites: ['mathews2002'] },
      { mech: 'cyp2c9-inhibition', role: 'inhibits', strength: 'moderate', note: 'Methysticin and dihydromethysticin are the potent inhibitors in vitro, with CYP2C9 and CYP2C19 the most affected. Note the disagreement worth carrying: in the Gurley human probe study kava did NOT significantly move CYP3A4 or CYP2D6, while it did inhibit CYP2E1. In vitro potency and in vivo probe results point in different directions here and the honest reading keeps both.', cites: ['mathews2002', 'gurley2005'] },
      { mech: 'cyp2c19-inhibition', role: 'inhibits', strength: 'moderate', note: 'Same in-vitro source as CYP2C9, same in-vivo caveat.', cites: ['mathews2002'] },
      { mech: 'cyp2e1-inhibition', role: 'inhibits', strength: 'moderate', note: 'The one CYP effect the Gurley human probe study did find. CYP2E1 is the paracetamol bioactivation pathway, which connects a CYP finding to the hepatotoxicity signal on the same substance.', cites: ['gurley2005'] },
    ],
  }),
  S({
    id: 'black-pepper',
    addRoles: [
      { mech: 'ecb-uptake-inhibition', role: 'inhibits', strength: 'moderate', note: 'Guineensine, a separate pepper alkaloid from piperine, inhibits endocannabinoid membrane transport in the nanomolar range (reported EC50 near 290 nM) and does NOT inhibit FAAH or MAGL — a mechanistically clean case, and the reason black pepper appears on the endocannabinoid axis and not only the CYP one.', cites: ['nicolussi2014guineensine', 'nicolussi2014'] },
      { mech: 'cb2-agonism', role: 'agonist', strength: 'weak', note: 'Beta-caryophyllene is 7-35% of the essential oil and is a selective CB2 agonist with GRAS status as a food additive.', cites: ['gertsch2008'] },
      { mech: 'cyp2c9-inhibition', role: 'inhibits', strength: 'weak', cites: ['volak2008'] },
      { mech: 'cyp1a2-inhibition', role: 'inhibits', strength: 'weak', cites: ['volak2008'] },
    ],
  }),
  S({
    id: 'turmeric',
    addRoles: [
      { mech: 'ugt-inhibition', role: 'inhibits', strength: 'moderate', note: 'Curcuminoids inhibit UDP-glucuronosyltransferase as well as the CYPs, which is a phase-2 interaction and is exactly the pathway cannabinoids are cleared through.', cites: ['volak2008'] },
      { mech: 'sult-inhibition', role: 'inhibits', strength: 'moderate', cites: ['volak2008'] },
    ],
  }),
  S({
    id: 'grapefruit',
    addRoles: [
      { mech: 'ugt-inhibition', role: 'inhibits', strength: 'weak', note: 'Reported in vitro alongside the far better characterised CYP3A4 effect. Listed for completeness; the CYP3A4 mechanism is the one that moves drug levels in people.', cites: ['volak2008'] },
    ],
  }),
]);

/** SUBSTANCES_CANNABIS — the added substances. Same shape as the core SUBSTANCES. */
export const SUBSTANCES_CANNABIS = Object.freeze([
  // ── the cannabinoids ───────────────────────────────────────────────────────────────────────────
  S({ id: 'thc', name: 'Delta-9-THC (cannabis)', aka: ['cannabis', 'marijuana', 'delta-9-THC', 'delta 9 thc', 'weed', 'dronabinol', 'THC'], kind: 'plant', slug: 'thc',
    summary: 'A CB1 PARTIAL agonist with a reported CB1 Ki near 40.7 nM, and a CYP2C9 and CYP3A4 substrate. Both halves matter: the partial agonism is why there is a ceiling on receptor activation, and the substrate status is why a CYP inhibitor in the same stack raises exposure without any change in dose.',
    roles: [
      { mech: 'cb1-agonism', role: 'agonist', strength: 'moderate', note: 'Partial agonist. The ceiling on CB1 activation is the pharmacological reason acute cannabis does not produce the respiratory depression that defines opioid death, and it is exactly the property a synthetic full agonist does not have.', cites: ['pertwee2008', 'ligresti2016'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'moderate', note: 'Sedation and impaired coordination, additive with alcohol and with the sedative botanicals. The additive impairment is documented even where the individual agents are mild.', cites: ['chan2017'] },
      { mech: 'cyp2c9-inhibition', role: 'substrate', strength: 'moderate', note: 'Cleared substantially by CYP2C9, with CYP3A4 also contributing, so a CYP2C9 or CYP3A4 inhibitor raises exposure. CYP2C9 is polymorphic, which is one reason the same inhaled or oral amount produces very different blood levels between people.', cites: ['stott2013', 'brown2019'] },
      { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'moderate', cites: ['stott2013'] },
      { mech: 'ugt-inhibition', role: 'substrate', strength: 'moderate', note: 'The 11-hydroxy and carboxy metabolites are glucuronidated before excretion, which is also why the carboxy-glucuronide is what a urine screen finds long after any effect has gone.', cites: ['brown2019'] },
    ] }),
  S({ id: 'cbd', name: 'Cannabidiol (CBD)', aka: ['CBD', 'cannabidiol', 'Epidiolex', 'hemp extract'], kind: 'supplement', slug: 'cbd',
    summary: 'The most interaction-heavy substance in the whole hemp category, and the one most often assumed to be inert. It inhibits several CYPs and the phase-2 conjugating enzymes, and at the doses used in the epilepsy literature it carries a transaminase-elevation signal of its own.',
    roles: [
      { mech: 'cyp2c19-inhibition', role: 'inhibits', strength: 'moderate', note: 'The best-documented clinical example in the cannabinoid field: CBD raises N-desmethylclobazam, the active metabolite of clobazam, with sedation as the visible consequence. That interaction was characterised in children with refractory epilepsy and is in the product labelling.', cites: ['jiang2011', 'geffrey2015', 'epidiolexLabel'] },
      { mech: 'cyp2c9-inhibition', role: 'inhibits', strength: 'moderate', note: 'Relevant to anyone on warfarin, where case reports describe a rising INR after CBD was added.', cites: ['brown2019'] },
      { mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'weak', cites: ['brown2019', 'stott2013'] },
      { mech: 'cyp1a2-inhibition', role: 'inhibits', strength: 'weak', cites: ['brown2019'] },
      { mech: 'ugt-inhibition', role: 'inhibits', strength: 'moderate', note: 'A phase-2 effect on top of the phase-1 ones, which is why the interaction surface is wider than a CYP table alone suggests.', cites: ['brown2019'] },
      { mech: 'hepatotoxicity', role: 'provides', strength: 'moderate', note: 'Dose-dependent transaminase elevations are documented at the high milligram-per-kilogram doses used in the epilepsy trials, and the signal is larger when valproate is co-administered. Whether the low doses in consumer products carry the same signal is not established.', cites: ['epidiolexLabel', 'brown2019'] },
    ],
    toxicity: 'The interaction profile scales with dose, and consumer products span three orders of magnitude of dose with labelling that product surveys repeatedly find inaccurate. A stack built on an assumed CBD dose is built on a number that may not be true.',
    toxicityCites: ['brown2019'] }),
  S({ id: 'delta-8-thc', name: 'Delta-8-THC and converted cannabinoids', aka: ['delta-8', 'delta 8', 'delta-10', 'delta-8-THC', 'HHC'], kind: 'supplement', slug: 'delta-8-thc',
    summary: 'Pharmacologically a CB1 partial agonist like delta-9. The distinctive hazard is not the receptor pharmacology but the product: published analyses of converted-cannabinoid products repeatedly report unidentified isomers and side-products, residual reaction chemicals, and label potency that does not match assay.',
    roles: [
      { mech: 'cb1-agonism', role: 'agonist', strength: 'moderate', note: 'Partial agonist, generally reported as somewhat less potent than delta-9 at CB1, so the ceiling argument applies here too.', cites: ['pertwee2008'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'moderate', cites: ['chan2017'] },
      { mech: 'cyp2c9-inhibition', role: 'substrate', strength: 'moderate', cites: ['brown2019'] },
    ],
    toxicity: 'What is in the container is the open question. Unassigned chromatographic peaks on a certificate of analysis are unidentified compounds being consumed, and a potency-only panel cannot find them. This engine models the named cannabinoid; it cannot model an unidentified side-product, and nothing here should be read as covering one.',
    toxicityCites: ['moritz2018'] }),
  S({ id: 'synthetic-cannabinoid', name: 'Synthetic cannabinoid receptor agonists (K2 / Spice type)', aka: ['K2', 'Spice', 'JWH-018', 'AMB-FUBINACA', 'AB-FUBINACA', '5F-ADB', 'synthetic cannabinoid', 'synthetic marijuana'], kind: 'drug-class', slug: 'synthetic-cannabinoid',
    summary: 'CB1 FULL agonists, typically at far higher affinity than delta-9-THC. JWH-018 is reported near 9 nM with full efficacy against delta-9-THC near 40.7 nM with partial efficacy, and the later indazole carboxamides are more potent again. The absence of a ceiling is the entire difference.',
    roles: [
      { mech: 'cb1-full-agonism', role: 'agonist', strength: 'strong', note: 'Full efficacy at CB1 with no ceiling on receptor activation, which is why the recorded harms include seizures, tachyarrhythmia, myocardial ischaemia, agitated delirium, hyperthermia, rhabdomyolysis, acute kidney injury and death — none of which characterise cannabis.', cites: ['atwood2010', 'huffman1994', 'tait2016'] },
      { mech: 'seizure-threshold', role: 'agonist', strength: 'strong', note: 'Seizure, including status epilepticus, is a documented presentation and is one of the clearest clinical separations from cannabis.', cites: ['tait2016', 'adams2017'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'strong', cites: ['adams2017'] },
      { mech: 'qt-prolongation', role: 'agonist', strength: 'moderate', note: 'Tachyarrhythmia and ECG change are reported across the case literature. Scored moderate because the agents are structurally heterogeneous and the data are case-series rather than systematic.', cites: ['tait2016'] },
    ],
    toxicity: 'Three compounding failures, and the third is the one that killed people: an unidentified compound, so no dose-response information to titrate along; a full agonist, so no ceiling; and material made by spraying a potent powder onto inert plant matter without any means of achieving or verifying even distribution, so one portion of a bag can carry many times the dose of another. Tolerance to a partial agonist does not transfer to a full agonist and may make matters worse by licensing a larger amount. Contamination is documented independently of the agonist itself — the 2018 brodifacoum outbreak produced coagulopathy and deaths from a long-acting anticoagulant in the product.',
    toxicityCites: ['tait2016', 'adams2017', 'moritz2018'] }),

  // ── the endocannabinoid botanicals ─────────────────────────────────────────────────────────────
  S({ id: 'hops', name: 'Hops (8-prenylnaringenin)', aka: ['Humulus lupulus', '8-prenylnaringenin', '8-PN', 'xanthohumol', 'isoxanthohumol'], kind: 'plant', slug: 'hops',
    summary: 'Carries the most potent natural MAGL inhibitor reported, 8-prenylnaringenin — which is simultaneously one of the most potent phytoestrogens known. Both facts belong to the same molecule and only one of them is usually mentioned.',
    roles: [
      { mech: 'magl-inhibition', role: 'inhibits', strength: 'weak', note: `8-prenylnaringenin is reported to inhibit MAGL with an IC50 in the low micromolar range. A specific figure is not quoted here because the number was not confirmed against the paper text. ${INVITRO}`, cites: ['pn8magl'] },
      { mech: 'cb2-agonism', role: 'agonist', strength: 'weak', note: 'Via beta-caryophyllene and humulene in the volatile fraction.', cites: ['gertsch2008'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'weak', note: 'The traditional sedative use has modest human support, usually in combination products with valerian, which makes attribution to hops alone difficult.', cites: ['benke2009'] },
    ],
    toxicity: 'The estrogenic activity of 8-prenylnaringenin is well characterised and is a genuine pharmacological consequence, not a curiosity. Exposure is also person-dependent in a way most botanicals are not: isoxanthohumol is converted to 8-prenylnaringenin by gut microbiota in some individuals and not others, so the same preparation delivers different amounts of the active compound to different people.',
    toxicityCites: ['milligan1999', 'possemiers2011'] }),
  S({ id: 'maca', name: 'Maca (macamides)', aka: ['Lepidium meyenii', 'macamides', 'maca root'], kind: 'supplement', slug: 'maca',
    summary: 'The macamides are N-benzylamides structurally analogous to anandamide, and they act on both of the routes that terminate anandamide signalling — hydrolysis and transport.',
    roles: [
      { mech: 'faah-inhibition', role: 'inhibits', strength: 'weak', note: INVITRO, cites: ['alasmari2018'] },
      { mech: 'ecb-uptake-inhibition', role: 'inhibits', strength: 'weak', note: `Reported inhibition of anandamide uptake. The specific IC50 figure that circulates for this was not confirmed against the paper in this pass, so no number is quoted. ${INVITRO}`, cites: ['alasmari2018'] },
    ],
    toxicity: 'Macamide content varies widely between products, so the dose of the active constituent is not knowable from the label. The glucosinolates carry a thyroid caution at high sustained intake.',
    // No citation: the glucosinolate/thyroid caution is not what the macamide FAAH paper is about, and
    // citing it here would be a mis-citation. The caution stands as a compositional fact about the root.
    toxicityCites: [] }),
  // GINGER IS DELIBERATELY ABSENT. Its only modelled role was gingerol/shogaol inhibition of FAAH, and
  // no source for that claim could be resolved: the citation supporting it was a placeholder with no
  // identifier, and the flavonoid paper it was paired with (Thors 2008) is about kaempferol and does
  // not cover gingerols. Asserting an unsourced pharmacological role in an engine people consult about
  // their own medicines is worse than leaving the substance out, so it is out. If a real source turns
  // up, the role and the substance go back in together with it.
  S({ id: 'kaempferol-foods', name: 'Kaempferol-rich foods (broccoli, kale, tea)', aka: ['kaempferol', 'broccoli', 'kale', 'green tea'], kind: 'food', slug: 'kaempferol-foods',
    summary: 'Kaempferol is a competitive FAAH inhibitor with a reported Ki near 5 micromolar. It is in this table as the clearest illustration of why an in-vitro number is not a dose: nobody reaches 5 micromolar plasma kaempferol by eating broccoli.',
    roles: [
      { mech: 'faah-inhibition', role: 'inhibits', strength: 'weak', note: `Competitive inhibition, reported Ki near 5 micromolar. ${INVITRO} Cruciferous vegetables separately induce CYP1A2, which is the interaction from this food group that actually shows up in people.`, cites: ['faahFlavonoid'] },
    ] }),
  S({ id: 'red-clover', name: 'Red clover / soy isoflavones (genistein, daidzein)', aka: ['biochanin A', 'genistein', 'daidzein', 'Trifolium pratense', 'red clover', 'soy isoflavones'], kind: 'supplement', slug: 'red-clover',
    summary: 'Soy and red-clover isoflavones touch the endocannabinoid axis at the TRANSPORT step: genistein and daidzein inhibit cellular anandamide uptake in vitro. The biochanin A claim that circulates for this group is on the hydrolysis step instead, and no source for it could be resolved, so it is not asserted here. As with hops, the same molecule class is estrogenic and that is much the better-documented pharmacology.',
    roles: [
      { mech: 'ecb-uptake-inhibition', role: 'inhibits', strength: 'weak', note: `Genistein and daidzein, not biochanin A — those are the two the paper studied. ${INVITRO}`, cites: ['thors2007'] },
    ],
    toxicity: 'Isoflavone estrogenicity is the established activity of this group and is the consideration that matters for anyone with a hormone-sensitive condition or on endocrine therapy.',
    toxicityCites: ['milligan1999'] }),
  S({ id: 'echinacea', name: 'Echinacea (alkylamides)', aka: ['Echinacea purpurea', 'Echinacea angustifolia', 'alkylamides', 'dodecadienamide'], kind: 'plant', slug: 'echinacea',
    summary: 'The 2,4-dodecadienamides bind CB2 and were the scaffold from which a selective endocannabinoid transport inhibitor was later developed. Unusually for this group, alkylamide oral absorption in humans is reasonably documented.',
    roles: [
      { mech: 'cb2-agonism', role: 'agonist', strength: 'weak', note: 'CB2-dependent and CB2-independent immunomodulatory effects were both reported for the alkylamide fraction.', cites: ['raduner2006'] },
      { mech: 'ecb-uptake-inhibition', role: 'inhibits', strength: 'weak', note: `The selective transport inhibitor WOBE437 was derived from this scaffold, which is the strongest reason to take the mechanism seriously. ${INVITRO}`, cites: ['nicolussi2014', 'raduner2006'] },
    ],
    toxicity: 'Published CYP results for Echinacea are inconsistent between studies, with CYP1A2 and CYP3A4 findings pointing in different directions, so no CYP role is asserted here. Asteraceae-family allergy is the common practical caution.',
    toxicityCites: ['gurley2005'] }),
  // ACMELLA / SPILANTHOL IS DELIBERATELY ABSENT. Both of its modelled roles (CB2 agonism, FAAH
  // inhibition) rested on one placeholder citation with no identifier, and no paper on spilanthol at
  // CB2 or on FAAH could be resolved. The Echinacea alkylamide-to-CB2 literature is real but concerns
  // the 2,4-dodecadienamides of a different plant and does not transfer. Same rule as ginger above.
  // The plant's monograph, its paraesthetic action and its ethnobotany belong on the botanicals shelf;
  // what is withheld HERE is specifically the claim that it engages the endocannabinoid system.
  S({ id: 'beta-caryophyllene', name: 'Beta-caryophyllene', aka: ['caryophyllene', 'BCP', 'copaiba', 'clove oil'], kind: 'food', slug: 'beta-caryophyllene',
    summary: 'A sesquiterpene present across the ordinary spice rack — black pepper, cloves, hops, rosemary, oregano, cannabis, copaiba — and a selective CB2 agonist with GRAS status as a food additive. It does not activate CB1, so it is not psychoactive.',
    roles: [
      { mech: 'cb2-agonism', role: 'agonist', strength: 'moderate', note: 'Selective for CB2 with negligible CB1 activity. Note that the widely repeated claim that beta-caryophyllene acts at CB1 is mistaken; the primary literature describes it as a CB2-selective agonist, and it is orally bioavailable, which is unusual for a terpene.', cites: ['gertsch2008'] },
    ] }),

  // ── the GABA and sedative botanicals ───────────────────────────────────────────────────────────
  S({ id: 'lemon-balm', name: 'Lemon balm (rosmarinic acid)', aka: ['Melissa officinalis', 'rosmarinic acid', 'melissa'], kind: 'plant', slug: 'lemon-balm',
    summary: 'Rosmarinic acid inhibits GABA-transaminase in vitro, which is a different route to raised inhibitory tone from GABA-A modulation and is the stated reason the two are combined.',
    roles: [
      { mech: 'gaba-t-inhibition', role: 'inhibits', strength: 'weak', note: INVITRO, cites: ['awad2007'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'weak', cites: ['awad2007'] },
    ] }),
  S({ id: 'valerian', name: 'Valerian (valerenic acid)', aka: ['Valeriana officinalis', 'valerenic acid', 'valerian root'], kind: 'plant', slug: 'valerian',
    summary: 'Valerenic acid acts at GABA-A in vivo, which places valerian on the same additive axis as alcohol, the benzodiazepines and the kavalactones.',
    roles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'weak', note: 'Valerenic acid was shown to act through GABA-A receptors in vivo, which is a stronger class of evidence than most of the botanical entries on this page carry.', cites: ['benke2009'] },
      { mech: 'gaba-t-inhibition', role: 'inhibits', strength: 'weak', note: INVITRO, cites: ['awad2007'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'moderate', cites: ['benke2009'] },
    ] }),
  S({ id: 'skullcap', name: 'American skullcap (baicalin, baicalein)', aka: ['Scutellaria lateriflora', 'baicalin', 'baicalein', 'skullcap'], kind: 'plant', slug: 'skullcap',
    summary: 'Baicalin and baicalein are GABA-A positive allosteric modulators, so this is another additive sedative axis rather than an independent mechanism.',
    roles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'weak', cites: ['awad2003'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'weak', cites: ['awad2003'] },
    ],
    toxicity: 'Products sold as skullcap have historically been adulterated with Teucrium species, which carry a hepatotoxicity signal. Species identification is the practical issue with this material, not its own pharmacology.',
    toxicityCites: ['awad2003'] }),
  S({ id: 'chamomile', name: 'Chamomile (apigenin)', aka: ['Matricaria', 'apigenin', 'chamomile tea'], kind: 'plant', slug: 'chamomile',
    summary: 'Apigenin binds GABA-A. The effect is mild and the interest here is additivity rather than the plant on its own.',
    roles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'weak', cites: ['awad2003'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'weak', cites: ['awad2003'] },
    ] }),
  S({ id: 'passionflower', name: 'Passionflower', aka: ['Passiflora incarnata', 'passion flower', 'harmine', 'harmaline'], kind: 'plant', slug: 'passionflower',
    summary: 'Sedative on the GABA axis, and separately a source of harmala alkaloids. The second fact is the one that matters: harmine and harmaline are reversible MAO-A inhibitors, so passionflower imports the MAOI hazards into a stack that was assembled for sedation.',
    roles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'weak', cites: ['dhawan2004'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'weak', cites: ['dhawan2004'] },
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'weak', reversible: true, note: 'Harmine and harmaline content in Passiflora preparations is variable and generally low, and the inhibition is reversible, so this is scored weak. It is listed rather than omitted because a weak reversible MAO-A inhibitor in a stack that also contains a serotonergic drug or a dietary L-dopa load is exactly the combination the serotonin and tyramine rules exist to catch.', cites: ['dhawan2004', 'herraiz2010'] },
    ] }),
  S({ id: 'california-poppy', name: 'California poppy', aka: ['Eschscholzia californica'], kind: 'plant', slug: 'california-poppy',
    summary: 'GABA-A binding with reported weak activity at opioid receptors. Additive on the sedation axis.',
    roles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'weak', cites: ['awad2003'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'weak', cites: ['awad2003'] },
    ] }),
  S({ id: 'kanna', name: 'Kanna (Sceletium tortuosum)', aka: ['Sceletium tortuosum', 'mesembrine', 'kanna'], kind: 'plant', slug: 'kanna',
    summary: 'The mesembrine alkaloids inhibit serotonin reuptake and PDE4. That puts kanna on the serotonergic axis, and the serotonergic axis is the one with a documented fatal combination in this dataset.',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'moderate', note: 'Mesembrine is described as a serotonin reuptake inhibitor. Combination with an MAO inhibitor — including the harmala alkaloids in passionflower or ayahuasca preparations — is the mechanism behind serotonin toxicity, and it is a real rather than theoretical concern for a botanical stack assembled from a forum list.', cites: ['callaway1998'] },
    ] }),
  S({ id: 'blue-lotus', name: 'Blue lotus (Nymphaea caerulea)', aka: ['Nymphaea caerulea', 'blue lily', 'aporphine', 'nuciferine'], kind: 'plant', slug: 'blue-lotus',
    summary: 'Aporphine alkaloids with reported dopamine-receptor activity. The pharmacology is thinly characterised and the material is listed here so that its absence from a result is not read as its absence from consideration.',
    roles: [
      { mech: 'cns-depression', role: 'agonist', strength: 'weak', note: 'Sedation is the commonly reported effect. There is very little human pharmacology for this plant and no reliable dose-response information.', cites: ['dhawan2004'] },
    ] }),
  S({ id: 'mucuna', name: 'Mucuna pruriens (L-dopa)', aka: ['Mucuna pruriens', 'velvet bean', 'L-DOPA', 'levodopa', 'kapikachhu'], kind: 'supplement', slug: 'mucuna',
    summary: 'Seeds carry roughly 3-6% L-dopa by weight, which makes this a dietary levodopa source rather than a herb with an incidental amine content. That is the whole interaction story.',
    roles: [
      { mech: 'ldopa-load', role: 'provides', strength: 'strong', note: 'L-dopa is decarboxylated to dopamine and onward to noradrenaline. With a monoamine oxidase inhibitor present the pressor response is not destroyed, and that is a documented hypertensive hazard — the same mechanism that puts broad-bean pods rather than broad beans on the MAOI list. Mucuna delivers far more L-dopa than any food does.', cites: ['mucunaClinical', 'gardner1996'] },
    ],
    toxicity: 'Two further considerations. Dopamine antagonists, including most antipsychotics and metoclopramide, oppose this pharmacology directly. And L-dopa is a catechol that oxidises readily in light, warmth and at neutral to alkaline pH, so the amount actually present in an aged or poorly stored preparation is not the amount on the label.',
    toxicityCites: ['mucunaClinical'] }),

  // ── the CNS depressants the sedative botanicals are actually combined with ─────────────────────
  S({ id: 'alcohol', name: 'Alcohol (ethanol)', aka: ['ethanol', 'beer', 'wine', 'spirits', 'booze'], kind: 'food', slug: 'alcohol',
    summary: 'The substance most likely to be in a stack and least likely to be declared. It is a GABA-A positive modulator, a CYP2E1 substrate that inhibits the enzyme acutely and induces it chronically, and a hepatotoxin.',
    roles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'strong', cites: ['chan2017'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'strong', note: 'Additive with every other agent on this axis, and the combination that most often converts sedation into loss of airway protection.', cites: ['chan2017'] },
      { mech: 'cyp2e1-inhibition', role: 'inhibits', strength: 'moderate', note: 'Acutely, ethanol competes for CYP2E1 and inhibits it. Chronically it INDUCES the enzyme, and the two states have opposite consequences for the same paracetamol dose — which is why "does alcohol interact with paracetamol" has no single answer without knowing the pattern of drinking.', cites: ['lieber1997', 'chan2017'] },
      { mech: 'cyp2e1-induction', role: 'induces', strength: 'moderate', note: 'Chronic intake. More enzyme means more reactive metabolite from paracetamol, which is the mechanism of hepatotoxicity at doses otherwise tolerated.', cites: ['lieber1997'] },
      { mech: 'hepatotoxicity', role: 'provides', strength: 'strong', cites: ['lieber1997'] },
    ] }),
  // slug is 'benzodiazepines-and-z-drugs', NOT 'benzodiazepines': interactions-data.mjs's `midazolam`
  // record already owns that slug, and sharing it collides the generated pair-page slugs.
  S({ id: 'benzodiazepines', name: 'Benzodiazepines and Z-drugs', aka: ['diazepam', 'alprazolam', 'Xanax', 'clonazepam', 'lorazepam', 'zolpidem', 'Ambien', 'clobazam', 'benzo'], kind: 'drug-class', slug: 'benzodiazepines-and-z-drugs',
    summary: 'GABA-A positive modulators at their own receptor site, and mostly CYP3A4 substrates. Both roles fire at once when a CYP3A4-inhibiting botanical is in the same stack: the drug is both potentiated pharmacodynamically and cleared more slowly.',
    roles: [
      { mech: 'gaba-a-pam', role: 'agonist', strength: 'strong', cites: ['dowell2016'] },
      { mech: 'cns-depression', role: 'agonist', strength: 'strong', cites: ['dowell2016'] },
      { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', note: 'Midazolam, triazolam and alprazolam are CYP3A4-dependent; clobazam is cleared through CYP2C19, which is the pathway cannabidiol inhibits. Lorazepam, oxazepam and temazepam are glucuronidated instead and are much less affected by CYP inhibition.', cites: ['fdaTable'] },
      { mech: 'cyp2c19-inhibition', role: 'substrate', strength: 'moderate', note: 'Clobazam and diazepam. This is the pathway behind the documented cannabidiol interaction.', cites: ['geffrey2015'] },
    ] }),
  S({ id: 'opioids', name: 'Opioids', aka: ['oxycodone', 'morphine', 'hydrocodone', 'fentanyl', 'codeine phosphate', 'methadone', 'buprenorphine', 'opiate'], kind: 'drug-class', slug: 'opioids',
    summary: 'Respiratory depression is the mechanism of death, and it is additive with everything else on the CNS-depression axis. The combined benzodiazepine-and-opioid risk is explicit in the prescribing guidance.',
    roles: [
      { mech: 'cns-depression', role: 'agonist', strength: 'strong', note: 'Unlike the cannabinoid receptors, the opioid receptors are densely expressed in the brainstem respiratory centres, which is the anatomical reason this axis has a fatal endpoint that CB1 agonism does not.', cites: ['dowell2016'] },
      { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', note: 'Oxycodone, fentanyl and methadone are CYP3A4-dependent, so a CYP3A4 inhibitor raises exposure at an unchanged dose.', cites: ['fdaTable'] },
      { mech: 'cyp2d6-inhibition', role: 'substrate', strength: 'moderate', note: 'Codeine and tramadol are PRODRUGS requiring CYP2D6 activation, so an inhibitor produces LESS active drug, not more. The direction inverts, and this is the classic case where assuming inhibition means accumulation gives the wrong answer.', cites: ['flockhart'] },
    ] }),
  S({ id: 'gabapentinoids', name: 'Gabapentin and pregabalin', aka: ['gabapentin', 'pregabalin', 'Lyrica', 'Neurontin'], kind: 'drug-class', slug: 'gabapentinoids',
    summary: 'Not GABA-A drugs despite the name, but firmly on the additive CNS-depression axis, and specifically implicated in respiratory depression when combined with opioids.',
    roles: [
      { mech: 'cns-depression', role: 'agonist', strength: 'moderate', cites: ['dowell2016'] },
    ] }),

  // ── the remaining botanicals from the corpus, listed so that silence is not mistaken for absence ─
  S({ id: 'artemisia-capillaris', name: 'Artemisia capillaris (Yin Chen Hao)', aka: ['Yin Chen Hao', 'yerba lena yesca', 'Artemisia capillaris', 'scoparone', 'capillarisin'], kind: 'plant', slug: 'artemisia-capillaris',
    summary: 'A hepatotropic herb whose actives include the coumarin scoparone. It is in this table mainly to say what is NOT established: there is no good human interaction pharmacology for it, and it is frequently combined with exactly the CYP inhibitors that would slow the clearance of its own constituents.',
    roles: [
      { mech: 'cb2-agonism', role: 'agonist', strength: 'weak', note: 'Via beta-caryophyllene in the volatile fraction.', cites: ['gertsch2008'] },
    ],
    toxicity: 'Two practical cautions rather than a modelled mechanism. First, Artemisia is a genus with very different chemistry between species — A. absinthium carries thujone, A. annua carries artemisinin — so misidentification is the real hazard and the material should be identified rather than assumed. Second, the marketing of this plant as psychoactive is not supported by the literature; the documented pharmacology is hepatobiliary.',
    toxicityCites: ['gurley2005'] }),
  S({ id: 'helichrysum', name: 'Helichrysum species (Imphepho)', aka: ['imphepho', 'impepho', 'Helichrysum odoratissimum', 'Helichrysum cymosum', 'Helichrysum petiolare', 'immortelle'], kind: 'plant', slug: 'helichrysum',
    summary: 'Aromatic Asteraceae used as ritual incense in southern Africa, with essential oils dominated by alpha-pinene, 1,8-cineole and beta-caryophyllene. No human interaction pharmacology exists for these species; the CB2 role below follows from a constituent, not from a study of the plant.',
    roles: [
      { mech: 'cb2-agonism', role: 'agonist', strength: 'weak', note: 'Inferred from beta-caryophyllene content, reported near 19% of the essential oil in H. cymosum. Inference from a constituent is weaker evidence than a study of the preparation, and is labelled as such.', cites: ['gertsch2008'] },
    ],
    toxicity: 'Smoke condensates from burning this material contain different compounds from solvent extracts, so what is inhaled is not what an extract assay describes. Asteraceae-family allergy applies.',
    toxicityCites: ['gertsch2008'] }),
  S({ id: 'garlic', name: 'Garlic (allicin)', aka: ['allicin', 'Allium sativum', 'raw garlic', 'aged garlic extract'], kind: 'seasoning', slug: 'garlic',
    summary: 'Widely described in forums as a potentiator. The documented human pharmacokinetic finding points the other way for at least one drug, which is worth stating precisely because the folk claim is confident.',
    roles: [
      { mech: 'cyp3a4-induction', role: 'induces', strength: 'weak', note: 'Garlic supplementation reduced saquinavir exposure in a human study, consistent with induction rather than inhibition. Claims that garlic potentiates other substances by inhibiting their metabolism are not supported by that result, and the popular claim and the measured direction disagree.', cites: ['gurley2005'] },
    ],
    toxicity: 'The consideration with real clinical weight is antiplatelet activity, which matters around surgery and alongside anticoagulants. This engine does not model bleeding risk at all, so that hazard will not appear in any result here.',
    toxicityCites: ['holbrook2005'] }),
  S({ id: 'cacao', name: 'Cacao / chocolate', aka: ['cacao', 'cocoa', 'chocolate', 'theobromine'], kind: 'food', slug: 'cacao',
    summary: 'Contains anandamide and related lipids at trace concentrations, plus theobromine. The anandamide content is real and is far too low to matter pharmacologically, which is a useful calibration for the rest of this table.',
    roles: [
      { mech: 'tyramine-load', role: 'provides', strength: 'weak', note: 'Chocolate appears on older MAOI diet lists. The revised tyramine literature puts its content low enough that it is no longer generally restricted, and the honest statement is that the restriction was relaxed rather than that it was always wrong.', cites: ['shulman1999', 'walker1996'] },
    ] }),
  S({ id: 'black-seed-oil', name: 'Black seed oil (Nigella sativa)', aka: ['Nigella sativa', 'thymoquinone', 'black cumin', 'kalonji'], kind: 'supplement', slug: 'black-seed-oil',
    summary: 'Thymoquinone is reported to affect several CYP pathways in vitro. Human data are limited and the direction of effect is not consistent across studies, so no specific CYP role is asserted.',
    roles: [],
    toxicity: 'Listed with no modelled mechanism on purpose. It appears in the potentiator literature, the in-vitro CYP reports are real, and the human pharmacokinetic work needed to turn that into a usable statement has not been done. An empty roles list here means "known about, not characterised", which is different from absent.',
    toxicityCites: ['gurley2005'] }),
  S({ id: 'ginkgo', name: 'Ginkgo biloba', aka: ['Ginkgo biloba', 'ginkgo', 'EGb 761'], kind: 'supplement', slug: 'ginkgo',
    summary: 'Reported CYP effects are inconsistent between studies and the effect sizes in human probe work are small. The consideration with clinical weight is antiplatelet activity, which this engine does not model.',
    roles: [],
    toxicity: 'Bleeding risk alongside anticoagulants and antiplatelets is the documented concern, and there are case reports of haemorrhage. Because additive bleeding risk is outside this dataset entirely, a clean result here is particularly uninformative for this substance.',
    toxicityCites: ['holbrook2005'] }),
]);

// ── the rules ─────────────────────────────────────────────────────────────────────────────────────
// Each rule takes the same (by, stack) shape as the core rules and returns findings. A rule must never
// throw: interactions.mjs wraps each in a try/catch, and a rule that throws would silently vanish.

const STRENGTH = { strong: 3, moderate: 2, weak: 1, variable: 2 };
const str = (r) => STRENGTH[r && r.strength] || 1;
const citesOf = (...rs) => [...new Set(rs.flatMap((r) => (r && r.cites) || []))];

/**
 * ruleAdditiveCNS — two or more agents on the CNS-depression axis. The most ordinary rule in the file
 * and the one most likely to matter to a real person.
 */
export function ruleAdditiveCNS(by) {
  const out = [];
  const dep = by['cns-depression']?.agonist || [];
  const uniqueSubs = [...new Map(dep.map((x) => [x.sub.id, x])).values()];
  if (uniqueSubs.length < 2) return out;
  const load = uniqueSubs.reduce((a, x) => a + str(x.r), 0);
  const strongCount = uniqueSubs.filter((x) => str(x.r) >= 3).length;
  // Two strong depressants, or one strong plus substantial additional load, is the picture in the
  // fatal-combination literature. Below that it is impairment rather than an airway problem.
  const severity = strongCount >= 2 ? 'critical' : (strongCount >= 1 && load >= 4) ? 'major' : load >= 4 ? 'major' : 'moderate';
  const gaba = [...new Map((by['gaba-a-pam']?.agonist || []).map((x) => [x.sub.id, x])).values()];
  out.push({
    id: `cns:${uniqueSubs.map((x) => x.sub.id).sort().join('+')}`,
    severity,
    mechanism: MECHANISMS_CANNABIS['cns-depression'].name,
    mechanismIds: ['cns-depression', ...(gaba.length >= 2 ? ['gaba-a-pam'] : [])],
    participants: uniqueSubs.map((x) => x.sub.id),
    headline: `Additive CNS depression: ${uniqueSubs.map((x) => x.sub.name).join(' + ')}`,
    what: 'These add. No metabolic interaction is required and none of them has to be strong on its own: '
      + 'sedation, impaired coordination and impaired judgement stack, and at sufficient combined load so '
      + 'does loss of airway protection and depression of breathing. '
      + (gaba.length >= 2
        ? `More than one of these acts at the GABA-A receptor (${gaba.map((x) => x.sub.name).join(', ')}), which is the shared site behind the combinations that appear in the fatal-overdose literature. `
        : '')
      + 'The practical trap is that tolerance to one agent does not confer tolerance to the combination, '
      + 'and that the dose of each that felt unremarkable alone is the dose people then take together.',
    substrateNote: 'A CYP finding elsewhere in this result compounds this one: an inhibitor that raises the '
      + 'blood level of a sedative raises the depth of sedation without any change in what was taken.',
    participantNotes: uniqueSubs.map((x) => x.r.note || ''),
    watchFor: 'Deepening drowsiness, slurred speech, unsteadiness, difficulty being roused, slow or shallow '
      + 'breathing, snoring or gurgling in someone asleep. Someone who cannot be woken is an emergency, not '
      + 'someone sleeping it off.',
    cites: citesOf(...uniqueSubs.map((x) => x.r), ...gaba.map((x) => x.r)),
  });
  return out;
}

/**
 * ruleFullAgonist — a synthetic full CB1 agonist in the stack. Fires on the substance alone, with no
 * second participant required, because the hazard is the agent rather than a combination.
 */
export function ruleFullAgonist(by) {
  const out = [];
  const full = [...new Map((by['cb1-full-agonism']?.agonist || []).map((x) => [x.sub.id, x])).values()];
  if (!full.length) return out;
  const partial = [...new Map((by['cb1-agonism']?.agonist || []).map((x) => [x.sub.id, x])).values()];
  out.push({
    id: `cb1-full:${full.map((x) => x.sub.id).join('+')}`,
    severity: 'critical',
    mechanism: MECHANISMS_CANNABIS['cb1-full-agonism'].name,
    mechanismIds: ['cb1-full-agonism'],
    participants: full.map((x) => x.sub.id),
    headline: `Full CB1 agonist present: ${full.map((x) => x.sub.name).join(' + ')}`,
    what: 'A partial agonist has a ceiling on how much receptor activation it can produce; a full agonist '
      + 'does not. That single pharmacological difference is why the recorded harms for this class include '
      + 'seizure, tachyarrhythmia, myocardial ischaemia, agitated delirium, hyperthermia, rhabdomyolysis, '
      + 'acute kidney injury and death, while the same list does not characterise cannabis. '
      + (partial.length
        ? `A partial CB1 agonist is also declared here (${partial.map((x) => x.sub.name).join(', ')}). Experience with it is not a guide to this, and tolerance built on a partial agonist does not transfer to a full one — it mainly licenses a larger amount. `
        : '')
      + 'Three further problems compound the pharmacology: the specific compound in a product of this kind '
      + 'is usually unidentified, so there is no dose-response information to work from; distribution across '
      + 'a carrier is typically uneven, so one portion can carry many times the dose of another; and '
      + 'contamination has been documented independently of the agonist, including an outbreak caused by a '
      + 'long-acting anticoagulant rodenticide.',
    watchFor: 'Seizure, chest pain, severe agitation or aggression, confusion, very high or very low blood '
      + 'pressure, high temperature, vomiting, dark urine or greatly reduced urine output. This picture does '
      + 'not respond the way cannabis overconsumption does, and naloxone has no effect on it — though giving '
      + 'naloxone is still reasonable where opioids cannot be excluded.',
    participantNotes: full.map((x) => x.r.note || ''),
    cites: citesOf(...full.map((x) => x.r), ...partial.map((x) => x.r)),
  });
  return out;
}

/**
 * ruleEndocannabinoid — a stack assembled to raise endocannabinoid tone from several directions at
 * once. This is the corpus' own "cannabinoid oilahuasca" design, and the finding exists to state what
 * is and is not known about it rather than to leave it unremarked.
 */
export function ruleEndocannabinoid(by) {
  const out = [];
  const axes = ['faah-inhibition', 'magl-inhibition', 'ecb-uptake-inhibition'];
  const hits = [];
  const present = [];
  for (const m of axes) {
    const xs = [...new Map((by[m]?.inhibits || []).map((x) => [x.sub.id, x])).values()];
    if (xs.length) { present.push(m); hits.push(...xs); }
  }
  const cb1 = [...new Map((by['cb1-agonism']?.agonist || []).map((x) => [x.sub.id, x])).values()];
  const full = (by['cb1-full-agonism']?.agonist || []).length;
  // Two or more separate termination mechanisms, or one plus a declared CB1 agonist, is the design.
  if (present.length < 2 && !(present.length >= 1 && cb1.length)) return out;
  const subs = [...new Map([...hits, ...cb1].map((x) => [x.sub.id, x])).values()];
  out.push({
    id: `ecb:${subs.map((x) => x.sub.id).sort().join('+')}`,
    // Not scored high. The honest reading is that the individual effects are mostly in-vitro and the
    // combination is unstudied — which is itself the finding, and inflating the severity would be as
    // dishonest as omitting it.
    severity: full ? 'major' : cb1.length ? 'moderate' : 'monitor',
    mechanism: 'stacked endocannabinoid modulation',
    mechanismIds: [...present, ...(cb1.length ? ['cb1-agonism'] : [])],
    participants: subs.map((x) => x.sub.id),
    headline: `Endocannabinoid tone raised from ${present.length + (cb1.length ? 1 : 0)} directions: ${subs.map((x) => x.sub.name).join(' + ')}`,
    what: 'This stack acts on more than one of the routes that terminate endocannabinoid signalling — '
      + `${present.map((m) => MECHANISMS_CANNABIS[m].name).join(', ')}`
      + (cb1.length ? ', alongside a declared CB1 agonist' : '')
      + '. The mechanisms are separate, so in principle they are not redundant. Three things should be said '
      + 'plainly about what follows from that. The individual inhibition figures behind most of these '
      + 'botanicals come from in-vitro enzyme assays at micromolar concentrations, and for most of them '
      + 'there is no human pharmacokinetic study establishing that an ordinary dose reaches those '
      + 'concentrations. The combination has not been studied in people at all. And more inhibition is not '
      + 'straightforwardly more effect: sustained complete MAGL blockade produces functional CB1 '
      + 'desensitisation in animals, so the system pushes back.',
    substrateNote: 'Several of the plants on this axis carry a second, better-documented pharmacology that '
      + 'is easy to overlook while attending to the cannabinoid one — estrogenic activity for hops and the '
      + 'isoflavones, CYP and P-glycoprotein inhibition for pepper and turmeric, GABA-A modulation and a '
      + 'liver signal for kava. Those are the effects most likely to actually show up.',
    participantNotes: subs.map((x) => x.r.note || ''),
    watchFor: 'Unexpectedly strong or prolonged effect from an unchanged amount of a cannabinoid, and '
      + 'sedation if any of the same plants are also on the CNS-depression axis.',
    cites: citesOf(...subs.map((x) => x.r), { cites: ['schlosburg2010', 'nicolussi2014', 'ligresti2016'] }),
  });
  return out;
}

/**
 * ruleLiverLoad — a hepatotoxicity-signal substance whose clearance is being slowed by a CYP inhibitor
 * in the same stack. Two mechanisms pointing at one organ. The core engine had an additive-hepatotoxicity
 * rule; this is the different and less obvious case where the interaction CREATES the load.
 */
export function ruleLiverLoad(by) {
  const out = [];
  const hep = [...new Map((by.hepatotoxicity?.provides || []).map((x) => [x.sub.id, x])).values()];
  if (!hep.length) return out;
  const inhibitors = [];
  for (const m of ['cyp3a4-inhibition', 'cyp2c9-inhibition', 'cyp2c19-inhibition', 'cyp1a2-inhibition', 'cyp2d6-inhibition', 'cyp2e1-inhibition', 'ugt-inhibition']) {
    for (const x of (by[m]?.inhibits || [])) inhibitors.push({ ...x, mech: m });
  }
  const uniq = [...new Map(inhibitors.map((x) => [`${x.sub.id}:${x.mech}`, x])).values()];
  for (const h of hep) {
    const others = uniq.filter((x) => x.sub.id !== h.sub.id);
    if (!others.length) continue;
    const names = [...new Set(others.map((x) => x.sub.name))];
    out.push({
      id: `liver-load:${h.sub.id}+${[...new Set(others.map((x) => x.sub.id))].sort().join('+')}`,
      severity: str(h.r) >= 3 ? 'major' : 'moderate',
      mechanism: 'metabolic inhibition raising the exposure of a substance with a liver signal',
      mechanismIds: ['hepatotoxicity', ...new Set(others.map((x) => x.mech))],
      participants: [h.sub.id, ...new Set(others.map((x) => x.sub.id))],
      headline: `${h.sub.name} carries a liver signal, and ${names.join(' / ')} slow${names.length === 1 ? 's' : ''} drug metabolism`,
      what: 'These point at the same organ from two directions. One substance here has a documented '
        + 'hepatotoxicity signal; the others inhibit the enzymes that clear compounds through the liver. '
        + 'Slower clearance means higher and more prolonged exposure to the substance carrying the signal, '
        + 'at an unchanged dose. This is the mechanism underneath the popular idea of using a metabolic '
        + 'inhibitor as a potentiator: raising exposure is precisely what makes it a potentiator, and '
        + 'precisely what makes it a toxicology question at the same time. The two are not separable.',
      substrateNote: h.r.note || '',
      participantNotes: [h.r.note || '', ...others.map((x) => x.r.note || '')].filter(Boolean),
      watchFor: 'Fatigue out of proportion to the day, nausea, loss of appetite, discomfort under the right '
        + 'ribs, dark urine, pale stools, itching, or yellowing of the skin or the whites of the eyes. '
        + 'Transaminases rise before any of that is visible, which is the argument for a blood test rather '
        + 'than for watching for symptoms.',
      cites: citesOf(h.r, ...others.map((x) => x.r)),
    });
  }
  return out;
}

/** RULES_CANNABIS — appended to the core RULES array in interactions.mjs, in this order. */
export const RULES_CANNABIS = Object.freeze([ruleFullAgonist, ruleAdditiveCNS, ruleEndocannabinoid, ruleLiverLoad]);

/** The added coverage lines, merged into COVERS / DOES_NOT_COVER so the honesty block stays accurate. */
export const COVERS_CANNABIS = Object.freeze([
  'The endocannabinoid enzymes and transport: FAAH, MAGL, endocannabinoid membrane transport, CB1 and CB2',
  'Additive CNS depression and GABA-A positive modulation — the alcohol / benzodiazepine / opioid / kava axis',
  'The phytocannabinoids delta-9-THC, cannabidiol and the converted cannabinoids, as both substrates and inhibitors',
  'Synthetic full CB1 agonists as a class, and why they are pharmacologically unlike cannabis',
  'CYP2E1, and phase-2 glucuronidation and sulfation where a specific entry names them',
  'The sedative and potentiator botanicals of the kava literature, and dietary L-dopa from Mucuna',
]);

export const DOES_NOT_COVER_CANNABIS = Object.freeze([
  'Bleeding and antiplatelet risk, which is the mechanism that matters most for garlic, ginkgo and several other common supplements. It is not modelled at all, so a clean result says nothing about it.',
  'Whether any of the natural FAAH, MAGL or transport inhibition reported in vitro occurs at all at a dose a person would take. For most of these compounds nobody has measured it.',
  'The actual contents of an unregulated cannabinoid product. This engine models named compounds; an unidentified isomer or side-product in a converted-cannabinoid product is outside it by construction.',
  'Dose. Every cannabinoid interaction here scales with dose, and consumer product labelling for this category is repeatedly found inaccurate in published surveys.',
  'Inhalation-specific hazards — thermal degradation products, diluents chosen for rheology rather than for inhalation toxicology, and carrier and adulterant contamination.',
]);

export default {
  CITES_CANNABIS, MECHANISMS_CANNABIS, SUBSTANCES_CANNABIS, SUBSTANCE_PATCHES, RULES_CANNABIS,
  COVERS_CANNABIS, DOES_NOT_COVER_CANNABIS,
};
