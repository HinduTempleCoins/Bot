// terpenes.mjs — Terpene Monographs shelf for the MELEK hemp-science wiki.
//
// What this shelf is: a per-compound reference for the terpenes and terpenoids that matter to the
// hemp and botanical-extract industries — structure class, molecular formula, atmospheric boiling
// point, documented receptor and enzyme activity with the concentration at which it was documented,
// the botanical sources that actually carry the compound and at what share of the volatile fraction,
// and the vaporization band in which it comes off a dry-herb device. It is written for three
// readers at once: a lab tech reading a GC report, a formulator choosing a botanical, and a buyer
// deciding whether a terpene table on a marketing page means anything.
//
// Where the material comes from: the primary pharmacology literature; the operator's Van Kush Family
// Temple Pharmacopoeia knowledgebase (January 2026) for the South African Helichrysum chemotypes,
// the black-pepper beta-caryophyllene range and the vaporization bands; and the operator's earlier
// 2016 terpene notes (marsresident / Van Kush Family, Steemit), which this shelf corrects in four
// places — see the correction sections on beta-caryophyllene and limonene.
//
// What this shelf deliberately does NOT contain: any preparative or synthetic procedure. No
// reagents, catalysts, solvents, equivalents, molar concentrations, reaction temperatures, times,
// work-ups or yields for making or converting any cannabinoid or terpene; no precursor sourcing; no
// step-by-step isomerisation, homologation or acetylation. Distillation and extraction are named as
// facts that a chemotype figure depends on, never given as a method. Pharmacology, analytics,
// taxonomy, physical constants and regulation only.

export const SHELF = Object.freeze({
  id: 'terpenes',
  title: 'Terpene Monographs',
  blurb: 'Per-compound reference: structure, formula, boiling point, documented receptor activity, botanical sources by percent of volatile fraction, and vaporization bands.',
  updated: '2026-09-27',
});

/** CITES — this module's own bibliography. Keys are lowercase author+year. */
export const CITES = Object.freeze({
  gertsch2008: {
    authors: 'Gertsch J, Leonti M, Raduner S, Racz I, Chen JZ, Xie XQ, Altmann KH, Karsak M, Zimmer A',
    year: 2008,
    title: 'Beta-caryophyllene is a dietary cannabinoid',
    journal: 'Proceedings of the National Academy of Sciences of the USA 105(26):9099-9104',
    doi: '10.1073/pnas.0803601105', verified: 'doi',
  },
  russo2011: {
    authors: 'Russo EB', year: 2011,
    title: 'Taming THC: potential cannabis synergy and phytocannabinoid-terpenoid entourage effects',
    journal: 'British Journal of Pharmacology 163(7):1344-1364',
    doi: '10.1111/j.1476-5381.2011.01238.x', verified: 'doi',
  },
  booth2019: {
    authors: 'Booth JK, Bohlmann J', year: 2019,
    title: 'Terpenes in Cannabis sativa — from plant genome to humans',
    journal: 'Plant Science 284:67-72', doi: '10.1016/j.plantsci.2019.03.022', verified: 'crossref',
  },
  santiago2019: {
    authors: 'Santiago M, Sachdev S, Arnold JC, McGregor IS, Connor M', year: 2019,
    title: 'Absence of entourage: terpenoids commonly found in Cannabis sativa do not modulate the functional activity of delta-9-THC at human CB1 and CB2 receptors',
    journal: 'Cannabis and Cannabinoid Research 4(3):165-176', doi: '10.1089/can.2019.0016', verified: 'crossref',
  },
  lavigne2021: {
    authors: 'LaVigne JE, Hecksel R, Keresztes A, Streicher JM', year: 2021,
    title: 'Cannabis sativa terpenes are cannabimimetic and selectively enhance cannabinoid activity',
    journal: 'Scientific Reports 11:8232', doi: '10.1038/s41598-021-87740-8', verified: 'crossref',
  },
  rao1990: {
    authors: 'Rao VSN, Menezes AMS, Viana GSB', year: 1990,
    title: 'Effect of myrcene on nociception in mice',
    journal: 'Journal of Pharmacy and Pharmacology 42(12):877-878', doi: '10.1111/j.2042-7158.1990.tb07046.x', verified: 'crossref',
  },
  lorenzetti1991: {
    authors: 'Lorenzetti BB, Souza GEP, Sarti SJ, Santos Filho D, Ferreira SH', year: 1991,
    title: 'Myrcene mimics the peripheral analgesic activity of lemongrass tea',
    journal: 'Journal of Ethnopharmacology 34(1):43-48', doi: '10.1016/0378-8741(91)90187-i', verified: 'crossref',
  },
  dovale2002: {
    authors: 'do Vale TG, Furtado EC, Santos JG, Viana GSB', year: 2002,
    title: 'Central effects of citral, myrcene and limonene, constituents of essential oil chemotypes from Lippia alba',
    journal: 'Phytomedicine 9(8):709-714', doi: '10.1078/094471102321621304', verified: 'crossref',
  },
  miyazawa2005: {
    authors: 'Miyazawa M, Yamafuji C', year: 2005,
    title: 'Inhibition of acetylcholinesterase activity by bicyclic monoterpenoids',
    journal: 'Journal of Agricultural and Food Chemistry 53(5):1765-1768', doi: '10.1021/jf040019b', verified: 'crossref',
  },
  perry2000: {
    authors: 'Perry NSL, Houghton PJ, Theobald A, Jenner P, Perry EK', year: 2000,
    title: 'In-vitro inhibition of human erythrocyte acetylcholinesterase by Salvia lavandulaefolia essential oil and constituent terpenes',
    journal: 'Journal of Pharmacy and Pharmacology 52(7):895-902', doi: '10.1211/0022357001774598', verified: 'crossref',
  },
  juergens2003: {
    authors: 'Juergens UR, Dethlefsen U, Steinkamp G, Gillissen A, Repges R, Vetter H', year: 2003,
    title: 'Anti-inflammatory activity of 1.8-cineol (eucalyptol) in bronchial asthma: a double-blind placebo-controlled trial',
    journal: 'Respiratory Medicine 97(3):250-256', doi: '10.1053/rmed.2003.1432', verified: 'crossref',
  },
  worth2009: {
    authors: 'Worth H, Schacher C, Dethlefsen U', year: 2009,
    title: 'Concomitant therapy with cineole (eucalyptole) reduces exacerbations in COPD',
    journal: 'Respiratory Research 10:69', verified: false,
  },
  miyazawa2001: {
    authors: 'Miyazawa M, Shindo M, Shimada T', year: 2001,
    title: 'Oxidation of 1,8-cineole, the monoterpene cyclic ether originated from Eucalyptus polybractea, by cytochrome P450 3A enzymes in rat and human liver microsomes',
    journal: 'Drug Metabolism and Disposition 29(2):200-205', verified: false,
  },
  miyazawa2002: {
    authors: 'Miyazawa M, Shindo M, Shimada T', year: 2002,
    title: 'Metabolism of (+)- and (-)-limonenes to respective carveols and perillyl alcohols by CYP2C9 and CYP2C19 in human liver microsomes',
    journal: 'Drug Metabolism and Disposition 30(5):602-607', doi: '10.1124/dmd.30.5.602', verified: 'crossref',
  },
  sun2007: {
    authors: 'Sun J', year: 2007,
    title: 'D-limonene: safety and clinical applications',
    journal: 'Alternative Medicine Review 12(3):259-264', verified: false,
  },
  komiya2006: {
    authors: 'Komiya M, Takeuchi T, Harada E', year: 2006,
    title: 'Lemon oil vapor causes an anti-stress effect via modulating the 5-HT and DA activities in mice',
    journal: 'Behavioural Brain Research 172(2):240-249', doi: '10.1016/j.bbr.2006.05.006', verified: 'crossref',
  },
  elisabetsky1995: {
    authors: 'Elisabetsky E, Marschner J, Onofre Souza D', year: 1995,
    title: 'Effects of linalool on glutamatergic system in the rat cerebral cortex',
    journal: 'Neurochemical Research 20(4):461-465', doi: '10.1007/bf00973103', verified: 'crossref',
  },
  linck2010: {
    authors: 'Linck VM, da Silva AL, Figueiro M, Caramao EB, Moreno PRH, Elisabetsky E', year: 2010,
    title: 'Effects of inhaled linalool in anxiety, social interaction and aggressive behavior in mice',
    journal: 'Phytomedicine 17(8-9):679-683', doi: '10.1016/j.phymed.2009.10.002', verified: 'crossref',
  },
  milanos2017: {
    authors: 'Milanos S, Elsharif SA, Janzen D, Buettner A, Villmann C', year: 2017,
    title: 'Metabolic products of linalool and modulation of GABA-A receptors',
    journal: 'Frontiers in Chemistry 5:46', doi: '10.3389/fchem.2017.00046', verified: 'crossref',
  },
  fernandes2007: {
    authors: 'Fernandes ES, Passos GF, Medeiros R, da Cunha FM, Ferreira J, Campos MM, Pianowski LF, Calixto JB',
    year: 2007,
    title: 'Anti-inflammatory effects of compounds alpha-humulene and (-)-trans-caryophyllene isolated from the essential oil of Cordia verbenacea',
    journal: 'European Journal of Pharmacology 569(3):228-236', doi: '10.1016/j.ejphar.2007.04.059', verified: 'crossref',
  },
  rogerio2009: {
    authors: 'Rogerio AP, Andrade EL, Leite DFP, Figueiredo CP, Calixto JB', year: 2009,
    title: 'Preventive and therapeutic anti-inflammatory properties of the sesquiterpene alpha-humulene in experimental airways allergic inflammation',
    journal: 'British Journal of Pharmacology 158(4):1074-1087', doi: '10.1111/j.1476-5381.2009.00177.x', verified: 'crossref',
  },
  lourens2008: {
    authors: 'Lourens ACU, Viljoen AM, van Heerden FR', year: 2008,
    title: 'South African Helichrysum species: a review of the traditional uses, biological activity and phytochemistry',
    journal: 'Journal of Ethnopharmacology 119(3):630-652', doi: '10.1016/j.jep.2008.06.011', verified: 'crossref',
  },
  lanz2016: {
    authors: 'Lanz C, Mattsson J, Soydaner U, Brenneisen R', year: 2016,
    title: 'Medicinal cannabis: in vitro validation of vaporizers for the smoke-free inhalation of cannabis',
    journal: 'PLoS ONE 11(1):e0147286', doi: '10.1371/journal.pone.0147286', verified: 'crossref',
  },
  gieringer2004: {
    authors: 'Gieringer D, St. Laurent J, Goodrich S', year: 2004,
    title: 'Cannabis vaporizer combines efficient delivery of THC with effective suppression of pyrolytic compounds',
    journal: 'Journal of Cannabis Therapeutics 4(1):7-27', doi: '10.1300/j175v04n01_02', verified: 'crossref',
  },
  moir2008: {
    authors: 'Moir D, Rickert WS, Levasseur G, Larose Y, Maertens R, White P, Desjardins S', year: 2008,
    title: 'A comparison of mainstream and sidestream marijuana and tobacco cigarette smoke produced under two machine smoking conditions',
    journal: 'Chemical Research in Toxicology 21(2):494-502', doi: '10.1021/tx700275p', verified: 'crossref',
  },
  vankush2026: {
    authors: 'Van Kush Family Research Institute (operator)', year: 2026,
    title: 'Temple Pharmacopoeia knowledgebase: botanical preparations, extraction science and formulation frameworks',
    journal: 'Internal operator document, compiled January 2026', verified: false,
  },
  marsresident2016: {
    authors: 'marsresident / Van Kush Family (operator)', year: 2016,
    title: 'Terpenes: cannabis chemistry and natural medicine',
    journal: 'Steemit post, STEEM era; archived in this repo as knowledge/herbs/terpenes.json',
    verified: false,
  },
  compounddb: {
    authors: 'Compiled from public compound databases (PubChem, NIST WebBook) and supplier specification sheets',
    year: 2026,
    title: 'Physical constants for terpenes and terpenoids: formula, molar mass, atmospheric boiling point',
    journal: 'Reference compilation; individual values vary between sources and are given as ranges here',
    verified: false,
  },
});

/**
 * PAGES — each becomes one wiki page at /science/terpenes/<slug>.
 */
export const PAGES = Object.freeze([

  // ---------------------------------------------------------------- overview
  Object.freeze({
    slug: 'overview',
    title: 'Terpenes and Terpenoids: How to Read This Shelf',
    kind: 'terpene',
    summary: 'What a terpene is, how the classes are built from isoprene units, why an essential-oil percentage is not a plant percentage, and what the pharmacology literature actually supports.',
    facts: Object.freeze({
      'Building block': 'isoprene, C5H8',
      'Monoterpene': 'two isoprene units, C10H16 skeleton, molar mass about 136 g/mol',
      'Monoterpenoid': 'oxygen-containing monoterpene, for example C10H18O at about 154 g/mol',
      'Sesquiterpene': 'three isoprene units, C15H24, molar mass about 204 g/mol',
      'Sesquiterpenoid': 'oxygen-containing sesquiterpene, for example C15H24O at about 220 g/mol',
      'Typical total terpene content of dried cannabis flower': 'roughly 1 to 4 percent by dry weight',
      'Pages on this shelf': '10 compound monographs plus this overview and a vaporization-band reference',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'The nomenclature, kept straight',
        body: 'Terpenes are hydrocarbons assembled from five-carbon isoprene units: monoterpenes from two (C10), sesquiterpenes from three (C15), diterpenes from four (C20), triterpenes from six (C30). A terpenoid is a terpene that carries oxygen — an alcohol, an ether, a ketone, an aldehyde or an epoxide. The distinction matters analytically and practically: adding oxygen raises the molar mass and the boiling point and usually raises water solubility, which is why 1,8-cineole (a cyclic ether, C10H18O) behaves differently in a hydrosol than alpha-pinene (a bicyclic hydrocarbon, C10H16) even though both are monoterpene-class and both come out of the same distillation. Terpenes in cannabis are products of the plastidial and cytosolic isoprenoid pathways acting on terpene synthase genes; the chemovar differences that the market calls strain differences are largely allelic differences in those synthases plus growing and curing conditions.',
        cites: Object.freeze(['booth2019', 'russo2011']),
      }),
      Object.freeze({
        h: 'The single most common misreading of a terpene table',
        body: 'An essential-oil composition figure is a percentage OF THE VOLATILE FRACTION, not of the plant. When a source says Helichrysum odoratissimum is 17.44 percent 1,8-cineole, it means 1,8-cineole was 17.44 percent of the oil recovered by distillation — and the oil yield of that material was on the order of 0.15 to 0.25 percent of the dried herb. So 1,8-cineole is on the order of 0.03 to 0.04 percent of the plant, not 17 percent of it. Marketing copy routinely collapses this distinction and it is the single most frequent error in consumer-facing terpene tables. A cannabis certificate of analysis is usually the opposite convention — terpenes reported as percent w/w or mg/g of the flower or the concentrate itself — so the two kinds of number are not comparable without saying which basis is in use. Always look for the basis line on the report.',
        bullets: Object.freeze([
          'Essential-oil analysis: percent of the recovered volatile oil. Denominator is the oil.',
          'Cannabis COA terpene panel: percent w/w or mg/g of the sample. Denominator is the product.',
          'Yield converts between them, and yield is rarely printed next to the composition.',
        ]),
        cites: Object.freeze(['vankush2026', 'lourens2008']),
      }),
      Object.freeze({
        h: 'Chemotype variance: why one number is never the answer',
        body: 'Terpene composition within a single named species varies by population, chemotype, plant part, harvest timing, drying regime and distillation parameters. South African Helichrysum is a worked example: alpha-pinene is reported up to 43 percent of the oil in H. odoratissimum and at 29.82 percent in H. cymosum, with the sesquiterpene and ketone profiles differing enough between species that faurinone dominates H. petiolare while (E)-caryophyllene dominates H. cymosum. The same is true of cannabis, where two plants sold under one cultivar name can differ severalfold in a given terpene. Treat every percentage in this shelf as one reported analysis of one population, not a species constant. Where a range is known, the range is given.',
        cites: Object.freeze(['vankush2026', 'lourens2008', 'booth2019']),
        contested: true,
        caveat: 'Single-analysis chemotype figures. Any one number here describes the specific sampled material, not the species. Ranges in published reviews are frequently wider than the operator figures quoted alongside them.',
      }),
      Object.freeze({
        h: 'What the pharmacology actually supports, and what it does not',
        body: 'The honest state of the evidence, compound by compound, is uneven. One terpene has a clean, replicated, mechanistically specific receptor finding at physiologically plausible concentration: beta-caryophyllene at CB2. Several have solid animal behavioural or anti-inflammatory data with mechanism partly characterised: myrcene, linalool, alpha-humulene, 1,8-cineole. Several have in-vitro enzyme findings at concentrations far above anything a human achieves from inhaling or eating the plant: much of the acetylcholinesterase and cytochrome-P450 literature falls here. And two compounds on this shelf, faurinone and gamma-curcumene, have essentially no dedicated pharmacology at all. The entourage effect — the claim that terpenes modify cannabinoid effect at the receptor — is genuinely contested: Santiago and colleagues found no modulation of THC activity at human CB1 or CB2 by the common cannabis terpenoids, while LaVigne and colleagues reported cannabimimetic and additive effects for several of the same compounds in a different assay system. Both are in vitro. Neither settles the human question. This shelf marks these sections contested rather than picking a side.',
        cites: Object.freeze(['gertsch2008', 'santiago2019', 'lavigne2021', 'russo2011']),
        contested: true,
        caveat: 'The entourage effect is an open question with directly conflicting in-vitro results (Santiago 2019 negative, LaVigne 2021 positive) and no adequate human pharmacodynamic study. Confident claims in either direction are ahead of the data.',
        evidence: 'in vitro',
      }),
      Object.freeze({
        h: 'Boiling point is not a vaporizer setting',
        body: 'Every monograph on this shelf reports two different temperatures and they are not the same thing. The boiling point is a physical constant of the pure compound at one atmosphere. The vaporization band is an empirical, device-dependent range over which that compound is observed to come off plant material in a dry-herb vaporizer — lower than the neat boiling point, because the compound is a dilute component of a mixture and evaporates from a matrix at partial pressure rather than boiling. A vaporizer dial reading 175 degrees Celsius is also not a statement that the material is at 175 degrees Celsius. See the vaporization-bands page for the full treatment.',
        cites: Object.freeze(['lanz2016', 'vankush2026', 'compounddb']),
      }),
      Object.freeze({
        h: 'Corrections made to the operator archive',
        body: 'The 2016 Van Kush terpene notes in this repo (knowledge/herbs/terpenes.json) are the ancestor of this shelf and are right about more than they are wrong about. Four claims in them do not survive the current literature and are corrected here rather than quietly dropped, because the same four claims are extremely widespread and a reader will meet them again elsewhere. In short: beta-caryophyllene is a selective CB2 agonist, not a CB1 ligand; the compound associated with canine cannabis detection in the literature is caryophyllene oxide, not beta-caryophyllene itself; limonene is not called biphenyl and is not a limonoid; and beta-caryophyllene holds GRAS status as a flavouring, which is not the same thing as FDA approval of a cannabinoid. The full corrections, with sources, are on the beta-caryophyllene and limonene pages.',
        cites: Object.freeze(['marsresident2016', 'gertsch2008', 'russo2011']),
      }),
    ]),
    seeAlso: Object.freeze([
      'terpenes/vaporization-bands', 'terpenes/beta-caryophyllene', 'terpenes/limonene',
      'endocannabinoid/entourage-effect', 'botanicals/helichrysum', 'coa/panels',
    ]),
    cites: Object.freeze(['booth2019', 'russo2011', 'gertsch2008', 'santiago2019', 'lavigne2021', 'lourens2008', 'vankush2026', 'marsresident2016', 'lanz2016', 'compounddb']),
  }),

  // ---------------------------------------------------------------- myrcene
  Object.freeze({
    slug: 'myrcene',
    title: 'Myrcene (beta-myrcene)',
    kind: 'terpene',
    summary: 'The acyclic monoterpene that is usually the dominant terpene in cannabis and in hop oil. Sedative and naloxone-reversible analgesic effects are documented in rodents; the famous blood-brain-barrier claim is not supported in humans.',
    facts: Object.freeze({
      'Structure class': 'acyclic (open-chain) monoterpene',
      'Molecular formula': 'C10H16',
      'Molar mass': 'about 136.24 g/mol',
      'Boiling point at 1 atm': 'about 166 to 168 degrees Celsius (331 to 334 degrees Fahrenheit)',
      'Vaporization band': 'about 155 to 170 degrees Celsius (311 to 338 degrees Fahrenheit)',
      'Aroma': 'earthy, herbaceous, hop-like, faintly clove and mango',
      'Chief industrial sources': 'hop oil, cannabis, lemongrass, bay, mango peel',
      'Documented receptor or enzyme target': 'no clean single receptor; behavioural analgesia in mice is naloxone-reversible, implying opioid-system involvement rather than direct cannabinoid receptor binding',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Structure and physical constants',
        body: 'Myrcene is the simplest of the common cannabis terpenes: an acyclic monoterpene, C10H16, molar mass about 136.24 g/mol, with two isolated double bonds and one conjugated diene. Beta-myrcene is the isomer of commercial and biological interest; alpha-myrcene is a rearranged isomer that is not a meaningful natural constituent. Its atmospheric boiling point is reported at about 166 to 168 degrees Celsius (331 to 334 degrees Fahrenheit). That figure is at one atmosphere and for the neat compound, and it is not a vaporizer set-point: in a dry-herb device myrcene is observed coming off plant material from roughly 155 degrees Celsius upward, well before its neat boiling point, because it is a dilute component evaporating from a matrix. The diene makes myrcene readily oxidised and readily polymerised, which is why aged or heat-abused material loses myrcene first and why a myrcene figure on an old certificate of analysis is the least durable number on the page.',
        cites: Object.freeze(['compounddb', 'lanz2016']),
      }),
      Object.freeze({
        h: 'Sedative and analgesic pharmacology',
        body: 'The rodent data on myrcene are among the better-characterised of any cannabis terpene. Rao, Menezes and Viana reported that myrcene produced antinociception in mice and that the effect was reversed by naloxone, which points to opioid-system involvement rather than a direct cannabinoid mechanism. Lorenzetti and colleagues had already reported that myrcene reproduced the peripheral analgesic activity of lemongrass tea. do Vale and colleagues reported sedative and motor-relaxant central effects for myrcene among the Lippia alba chemotype constituents. Taken together this is a coherent animal picture of a sedating, peripherally analgesic monoterpene. What it is not is a demonstration of the same effects at the doses a human gets from inhaling flower or drinking a beer; the rodent doses were administered systemically and are substantially higher on a body-weight basis than realistic human exposure. The operator archive describes myrcene as having opioid analgesic effects. That claim is better supported than most terpene folklore and is retained here, with the naloxone-reversibility detail restored and the species qualifier attached.',
        cites: Object.freeze(['rao1990', 'lorenzetti1991', 'dovale2002', 'marsresident2016']),
        evidence: 'animal',
        contested: true,
        caveat: 'Animal-only, systemic dosing, doses above realistic human dietary or inhaled exposure. Naloxone reversibility implicates the opioid system but the molecular target has not been identified.',
      }),
      Object.freeze({
        h: 'The blood-brain-barrier claim, and the mango',
        body: 'The claim that myrcene increases blood-brain-barrier permeability, and therefore that myrcene-rich material or eating a mango beforehand potentiates THC, is the single most repeated statement in the popular cannabis literature. The primary-source support for it in humans is weak to absent. Tracing the citation chain leads to review articles that assert the permeability effect without a human study behind it, and to older secondary sources; the specific experiment — myrcene administered to humans, barrier permeability measured, cannabinoid brain penetration shown to increase — does not appear to exist. The mango practice compounds the problem with a dose question: mango flesh carries myrcene at a low fraction of a percent of a low essential-oil content, so the amount ingested from one fruit is small, and no pharmacokinetic study has shown it changes THC exposure. The mechanism is plausible on its face — small lipophilic monoterpenes do interact with membranes, and other terpenes are used as transdermal penetration enhancers — and it may yet turn out to be real. As of now it is a plausible mechanism with essentially no human evidence, and this shelf will not repeat it as fact. The honest formulation is: unproven, frequently asserted, worth testing.',
        cites: Object.freeze(['russo2011', 'booth2019', 'vankush2026', 'marsresident2016']),
        contested: true,
        caveat: 'CONTESTED. No human study demonstrates that myrcene increases blood-brain-barrier permeability or increases cannabinoid brain penetration. The claim propagates through review and popular literature by citation of secondary sources. The mango folk practice has a plausible mechanism and essentially no human evidence, and the ingested myrcene dose from one fruit is small.',
        evidence: 'anecdotal',
      }),
      Object.freeze({
        h: 'Where myrcene actually is, and at what percent',
        body: 'Myrcene is typically the dominant terpene of both hop oil and most cannabis chemovars, which is why the two smell related. In hop oil it commonly runs from about 30 to well over 50 percent of the volatile fraction depending on variety and age, and because hop oil is a large share of what gives beer its aroma, beer is a much larger dietary myrcene exposure for most people than cannabis is. In cannabis the terpene fraction itself is roughly 1 to 4 percent of dry flower weight, and myrcene commonly occupies a large share of that fraction in indica-typed chemovars — but chemovar variation is wide and myrcene-poor cannabis is common. Note the two different denominators in the table below and read the source column.',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported myrcene content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Hops (Humulus lupulus), hop oil', 'commonly 30 to 50-plus percent, variety-dependent', 'percent of volatile oil', 'Russo 2011; operator archive']),
            Object.freeze(['Cannabis sativa, dried flower', 'frequently the largest single terpene; total terpenes about 1 to 4 percent of dry weight', 'percent of product w/w', 'Booth and Bohlmann 2019']),
            Object.freeze(['Lemongrass (Cymbopogon spp.)', 'present alongside dominant citral; roughly 10 to 20 percent in some chemotypes', 'percent of volatile oil', 'Lorenzetti 1991; operator archive']),
            Object.freeze(['Indian bay leaf, bay', 'present as a minor to moderate constituent', 'percent of volatile oil', 'operator archive']),
            Object.freeze(['Mango (Mangifera indica), peel and flesh', 'present; flesh essential-oil content is very low, so absolute intake per fruit is small', 'percent of volatile oil', 'operator archive; see the BBB caveat above']),
          ]),
        }),
        cites: Object.freeze(['russo2011', 'booth2019', 'lorenzetti1991', 'marsresident2016', 'vankush2026']),
        contested: true,
        caveat: 'Percent-of-oil and percent-of-product figures appear in the same table with different denominators, as marked in the Basis column. Hop and cannabis myrcene shares vary severalfold by variety, harvest and storage.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'For a formulator, myrcene is the terpene most likely to be missing from a finished product relative to its label: it is volatile, it oxidises, and it is lost preferentially during drying, curing, distillation under heat, and open-vessel handling. For a lab tech, myrcene is also the analyte most sensitive to sample handling between receipt and injection — headspace losses during grinding and weighing are real and systematic. For a buyer, a high myrcene figure on a certificate of analysis for old stock should be treated with suspicion and cross-checked against the test date. Regulatory note: beta-myrcene has been listed as a substance of concern in some jurisdictional carcinogen listings on the basis of high-dose rodent bioassay data, which is a labelling and occupational-exposure matter for concentrate handlers rather than a statement about dietary exposure from hops or fruit.',
        cites: Object.freeze(['compounddb', 'sun2007']),
        contested: true,
        caveat: 'The carcinogen-listing point is a regulatory-classification fact about high-dose rodent bioassays, not a risk statement about ordinary dietary or inhaled exposure. Check the specific jurisdiction and the specific listing before relying on it.',
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/vaporization-bands', 'terpenes/humulene', 'botanicals/hops', 'endocannabinoid/entourage-effect', 'coa/panels']),
    cites: Object.freeze(['compounddb', 'lanz2016', 'rao1990', 'lorenzetti1991', 'dovale2002', 'russo2011', 'booth2019', 'vankush2026', 'marsresident2016', 'sun2007']),
  }),

  // ------------------------------------------------------- beta-caryophyllene
  Object.freeze({
    slug: 'beta-caryophyllene',
    title: 'Beta-Caryophyllene',
    kind: 'terpene',
    summary: 'The bicyclic sesquiterpene with a cyclobutane ring that is a selective CB2 agonist at sub-micromolar concentration — a dietary cannabinoid with GRAS flavouring status. Not a CB1 ligand, contrary to a widespread claim.',
    facts: Object.freeze({
      'Structure class': 'bicyclic sesquiterpene, notable for a rare cyclobutane ring fused to a nine-membered ring',
      'Molecular formula': 'C15H24',
      'Molar mass': 'about 204.36 g/mol',
      'Boiling point at 1 atm': 'about 254 to 257 degrees Celsius (489 to 495 degrees Fahrenheit); supplier and database values scatter between roughly 250 and 265 degrees Celsius',
      'Vaporization band': 'about 175 to 200 degrees Celsius (347 to 392 degrees Fahrenheit)',
      'Documented receptor target': 'selective full agonist at cannabinoid receptor type 2 (CB2); reported Ki in the low nanomolar range at CB2 with functional agonism in the sub-micromolar range, and no meaningful activity at CB1',
      'Food status': 'FDA GRAS (generally recognised as safe) as a flavouring substance; widely used in food and fragrance',
      'Oxidation product': 'caryophyllene oxide, the epoxide, a distinct compound with its own significance',
      'Oral bioavailability': 'orally active, unlike many volatile terpenes',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Structure: the cyclobutane is the point',
        body: 'Beta-caryophyllene is C15H24 at about 204.36 g/mol, a bicyclic sesquiterpene whose unusual feature is a cyclobutane ring fused to a nine-membered carbocycle with a trans-configured endocyclic double bond. That strained, rigid, highly lipophilic shape is why it fits CB2 while resembling nothing in the classical cannabinoid series: it is not a resorcinol, has no phenolic hydroxyl and no alkyl side chain, and so bears no structural relation to THC at all. The atmospheric boiling point is high for a terpene — around 254 to 257 degrees Celsius, above the cannabinoid decarboxylation range — which has a direct practical consequence: beta-caryophyllene survives conditions that destroy monoterpenes, so a concentrate or a long-cured flower that has lost its monoterpenes often retains a relatively enriched caryophyllene share. The epoxide, caryophyllene oxide, forms readily on air exposure and is a separate analyte with separate significance.',
        cites: Object.freeze(['gertsch2008', 'compounddb', 'russo2011']),
      }),
      Object.freeze({
        h: 'Selective CB2 agonism — the strongest receptor finding on this shelf',
        body: 'Gertsch and colleagues, publishing in PNAS in 2008 under the title "Beta-caryophyllene is a dietary cannabinoid", showed that (E)-beta-caryophyllene binds cannabinoid receptor type 2 with high affinity — reported in the low nanomolar range — and acts there as a full agonist, inhibiting adenylate cyclase and activating downstream CB2 signalling in the sub-micromolar concentration range, while showing no significant activity at CB1. In vivo they reported that oral beta-caryophyllene reduced inflammatory paw oedema in wild-type mice and that the effect was absent in CB2-knockout animals, which is the genetic control that makes the mechanism claim credible rather than merely correlational. This is the cleanest receptor pharmacology of any compound on this shelf: a specific receptor, a nanomolar affinity, functional agonism, a knockout control, and oral activity at a dietary compound. It is the basis for describing beta-caryophyllene as a dietary cannabinoid and for the whole strategy of modulating the CB2 arm of the endocannabinoid system with common culinary and medicinal botanicals rather than with cannabis.',
        cites: Object.freeze(['gertsch2008']),
        evidence: 'animal',
      }),
      Object.freeze({
        h: 'CORRECTION to the operator archive: CB2, not CB1',
        body: 'The 2016 Van Kush terpene notes state that caryophyllene "attaches to CB1 receptor". That is not what the literature shows, and the distinction is not a technicality — it inverts the compound\'s entire significance. Beta-caryophyllene is a SELECTIVE CB2 agonist with negligible activity at CB1. This is exactly why it is non-psychoactive and exactly why it is legal as a food flavouring: CB1 is the receptor whose activation in the central nervous system produces intoxication, and beta-caryophyllene does not engage it. A CB1 ligand in the spice cabinet would be a very different regulatory object. The popular claim that beta-caryophyllene hits CB1 is common — it appears in blog posts, dispensary copy and secondary summaries — and it is mistaken; the primary source, Gertsch 2008 in PNAS, reports the selectivity explicitly. The operator notes are right about the two conclusions that follow from the correct mechanism — that it is not structurally similar to THC, and that it holds food-additive status — and the mechanism itself simply needs to be restated as CB2.',
        bullets: Object.freeze([
          'Claim in the archive: attaches to CB1. Status: incorrect.',
          'Literature: selective CB2 full agonist, low nanomolar affinity at CB2, no meaningful CB1 activity (Gertsch 2008, PNAS).',
          'Consequence: non-psychoactive, which is why the GRAS flavouring status and the archive\'s "not similar to THC in structure" observation both hold.',
        ]),
        cites: Object.freeze(['gertsch2008', 'marsresident2016']),
      }),
      Object.freeze({
        h: 'CORRECTION to the operator archive: the detection-dog compound is caryophyllene oxide',
        body: 'The archive states that caryophyllene is "what dogs are trained to smell for marijuana detection". The compound named in the literature for that role is caryophyllene oxide — the epoxide of beta-caryophyllene — not beta-caryophyllene itself. Russo\'s 2011 review identifies caryophyllene oxide as the component characteristic of the cannabis odour signature used in canine detection. The two are distinct analytes with distinct chromatographic behaviour, and a terpene panel that reports beta-caryophyllene does not necessarily report caryophyllene oxide. The underlying point in the archive is sound; the compound identity needs one word added.',
        cites: Object.freeze(['russo2011', 'marsresident2016']),
      }),
      Object.freeze({
        h: 'CORRECTION, partial: GRAS is not FDA approval of a cannabinoid',
        body: 'The archive calls beta-caryophyllene the "first cannabinoid approved as food additive by FDA". The substance of this is right and the framing needs care. Beta-caryophyllene holds GRAS status as a flavouring substance in the United States and is in long-standing food and fragrance use. GRAS is a determination that a substance is generally recognised as safe for its intended use — it is not an FDA approval of a drug, and it certainly was not granted in recognition of any cannabinoid activity: the flavouring status long predates the 2008 CB2 finding. The accurate sentence is that beta-caryophyllene is a compound with GRAS flavouring status that was LATER shown to be a cannabinoid-receptor agonist, which is a more interesting fact than the one the archive states. It is also not an approval that transfers to anything else; nothing about beta-caryophyllene\'s status says anything about the status of any other cannabinoid.',
        cites: Object.freeze(['gertsch2008', 'marsresident2016']),
      }),
      Object.freeze({
        h: 'Other documented activity',
        body: 'Beyond CB2, beta-caryophyllene has a broad anti-inflammatory profile documented in animal models. Fernandes and colleagues isolated alpha-humulene and (-)-trans-caryophyllene from Cordia verbenacea oil and reported anti-inflammatory effects for both in rodent models, including inhibition of oedema and of inflammatory mediator release. The operator\'s Temple Pharmacopoeia also lists beta-caryophyllene among natural monoacylglycerol-lipase-relevant compounds in its endocannabinoid framework; that placement should be read as a system-level grouping rather than as a demonstrated MAGL inhibition constant, and the MAGL shelf treats the enzyme-inhibitor evidence directly. Orally, beta-caryophyllene is unusual among terpenes in being systemically available after ingestion, which is what makes a dietary CB2 strategy coherent at all — most volatile terpenes are extensively metabolised or simply not absorbed in meaningful quantity.',
        cites: Object.freeze(['gertsch2008', 'fernandes2007', 'vankush2026']),
        evidence: 'animal',
        contested: true,
        caveat: 'The MAGL association is a framework grouping in the operator document, not a published inhibition constant for beta-caryophyllene. Treat CB2 agonism as the established mechanism and other enzyme-level claims as unestablished for this compound.',
      }),
      Object.freeze({
        h: 'Where beta-caryophyllene actually is, and at what percent',
        body: 'Beta-caryophyllene is the unifying compound across the operator\'s botanical inventory and across a very large part of the culinary spice cabinet. The figures below are percentages of the volatile fraction unless the basis column says otherwise, and the ranges are wide because pepper and clove chemotypes vary as much as cannabis chemovars do.',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported beta-caryophyllene content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Black pepper (Piper nigrum)', '7 to 35 percent', 'percent of essential oil', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Imphepho, Helichrysum cymosum', '19.20 percent, reported as (E)-caryophyllene', 'percent of essential oil', 'operator Temple Pharmacopoeia 2026; cf. Lourens 2008']),
            Object.freeze(['Copaiba oleoresin (Copaifera spp.)', 'a dominant constituent, commonly reported in the tens of percent', 'percent of oleoresin volatile fraction', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Cloves (Syzygium aromaticum)', 'a moderate constituent behind dominant eugenol', 'percent of essential oil', 'operator archive 2016; Russo 2011']),
            Object.freeze(['Cannabis sativa', 'commonly the leading sesquiterpene; share of terpene fraction varies widely by chemovar', 'percent of terpene fraction', 'Booth and Bohlmann 2019; Russo 2011']),
            Object.freeze(['Hops (Humulus lupulus)', 'variable, alongside myrcene and humulene', 'percent of hop oil', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Yerba Lena Yesca, Artemisia capillaris', 'present in the volatile fraction, quantity not specified in source', 'percent of volatile fraction', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Rosemary, oregano, basil', 'present as a minor to moderate constituent behind their own dominant compounds', 'percent of essential oil', 'operator archive 2016']),
            Object.freeze(['Uziza (Piper guineense) leaf and peppercorn', 'named in the operator archive as a notably rich source', 'percent of essential oil, figure not given', 'operator archive 2016']),
          ]),
        }),
        cites: Object.freeze(['vankush2026', 'marsresident2016', 'lourens2008', 'russo2011', 'booth2019']),
        contested: true,
        caveat: 'Chemotype ranges, mostly single-source or operator-compiled. The black-pepper 7 to 35 percent range and the copaiba figure come from the operator document; published pepper oil analyses span at least that range and sometimes wider. The Uziza claim is an operator observation without a quantitative analysis attached.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'For a formulator, beta-caryophyllene is the terpene to reach for when the goal is a CB2-directed effect without cannabis and without intoxication, and it is robust enough to survive warm processing that would strip monoterpenes. For a lab tech, watch the oxide: a sample with a high caryophyllene-oxide-to-caryophyllene ratio has been exposed to air, heat or time, and that ratio is a useful freshness indicator even though it is rarely reported as such. For a buyer, beta-caryophyllene content is one of the few terpene numbers on a certificate of analysis that maps onto a mechanism with a real receptor behind it, which makes it worth more attention than the total-terpene headline figure.',
        cites: Object.freeze(['gertsch2008', 'russo2011']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/humulene', 'terpenes/vaporization-bands', 'endocannabinoid/cb2', 'endocannabinoid/magl', 'botanicals/black-pepper', 'botanicals/helichrysum', 'coa/panels']),
    cites: Object.freeze(['gertsch2008', 'russo2011', 'compounddb', 'marsresident2016', 'fernandes2007', 'vankush2026', 'lourens2008', 'booth2019']),
  }),

  // ------------------------------------------------------------- alpha-pinene
  Object.freeze({
    slug: 'alpha-pinene',
    title: 'Alpha-Pinene',
    kind: 'terpene',
    summary: 'The most widely distributed terpene in nature, a bicyclic monoterpene that inhibits acetylcholinesterase in vitro. Dominant in the operator\'s Helichrysum material at up to 43 percent of the oil.',
    facts: Object.freeze({
      'Structure class': 'bicyclic monoterpene, pinane skeleton with a four-membered ring bridge',
      'Molecular formula': 'C10H16',
      'Molar mass': 'about 136.24 g/mol',
      'Boiling point at 1 atm': 'about 155 to 156 degrees Celsius (311 to 313 degrees Fahrenheit)',
      'Vaporization band': 'about 150 to 165 degrees Celsius (302 to 329 degrees Fahrenheit) — one of the first compounds off the material',
      'Enantiomers': '(+)-alpha-pinene and (-)-alpha-pinene occur naturally in differing ratios by species; the ratio is a chemotype marker',
      'Documented enzyme target': 'acetylcholinesterase inhibition in vitro, in the micromolar to high-micromolar range',
      'Aroma': 'pine, resinous, dry',
      'Also': 'principal component of turpentine; a major atmospheric biogenic volatile',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Structure and physical constants',
        body: 'Alpha-pinene is a bicyclic monoterpene, C10H16 at about 136.24 g/mol, built on the pinane skeleton: a six-membered ring bridged by a two-carbon unit to give a fused four-membered ring, with the double bond endocyclic in the six-membered ring (beta-pinene, the isomer, has it exocyclic). Its atmospheric boiling point of about 155 to 156 degrees Celsius is the lowest on this shelf, which makes alpha-pinene the compound that leaves the material first — in drying, in curing, in storage, and in the opening seconds of a vaporization session. That volatility, plus the strained bicyclic skeleton\'s readiness to rearrange under acid, is why alpha-pinene figures on a certificate of analysis are strongly dependent on how and when the sample was handled. Both enantiomers occur naturally and their ratio differs by species and population; a chiral GC column resolves them and an ordinary one does not, so most reports give a single combined alpha-pinene figure.',
        cites: Object.freeze(['compounddb', 'lourens2008']),
      }),
      Object.freeze({
        h: 'Acetylcholinesterase inhibition: real finding, in-vitro concentrations',
        body: 'Alpha-pinene inhibits acetylcholinesterase, the enzyme that hydrolyses acetylcholine in the synaptic cleft. Miyazawa and Yamafuji screened bicyclic monoterpenoids for acetylcholinesterase inhibition and found activity among the pinane-type compounds; Perry and colleagues, working on Salvia lavandulaefolia essential oil and its constituent terpenes, reported in-vitro inhibition of human erythrocyte acetylcholinesterase by the oil and by constituent monoterpenes including alpha-pinene. The mechanistic claim that follows in the popular literature — that alpha-pinene counteracts the short-term memory impairment of THC by raising synaptic acetylcholine — is a reasonable extrapolation and is presented as such in Russo\'s entourage review, but it has not been demonstrated in a controlled human study. Two things constrain how far this can be taken. First, the inhibition is observed in the micromolar to high-micromolar range, which is far above the plasma concentration a human reaches from inhaling or eating a botanical carrying a few tenths of a percent alpha-pinene. Second, an in-vitro enzyme assay on erythrocyte or purified enzyme does not establish central nervous system activity at realistic exposure. The correct summary is: documented enzyme inhibition, plausible mechanism, unproven in humans at achievable concentrations.',
        cites: Object.freeze(['miyazawa2005', 'perry2000', 'russo2011']),
        contested: true,
        caveat: 'In-vitro only, at micromolar to high-micromolar concentrations well above realistic human plasma exposure from botanical sources. The THC-memory-counteraction application is an extrapolation in a review article, not a human finding.',
        evidence: 'in vitro',
      }),
      Object.freeze({
        h: 'Respiratory and other reported activity',
        body: 'Alpha-pinene is frequently described as a bronchodilator and as an anti-inflammatory, and it is a constituent of many traditional respiratory preparations — including the operator\'s Imphepho, whose traditional uses include smoke inhalation for respiratory conditions and coughs. The bronchodilatory literature for alpha-pinene specifically is thinner than for 1,8-cineole, where there are actual controlled human trials; much of what gets attributed to alpha-pinene in respiratory contexts is attributable to the cineole that usually accompanies it, since the two co-occur in rosemary, eucalyptus and Helichrysum. This shelf treats the alpha-pinene respiratory claim as unresolved and directs the reader to the cineole page for the part of that story with human trials behind it.',
        cites: Object.freeze(['russo2011', 'lourens2008', 'vankush2026']),
        contested: true,
        caveat: 'Attribution problem: alpha-pinene almost always co-occurs with 1,8-cineole in the botanicals where respiratory benefit is reported, and the controlled human respiratory trials are on cineole, not on alpha-pinene. Do not transfer the cineole evidence to alpha-pinene.',
      }),
      Object.freeze({
        h: 'Where alpha-pinene actually is, and at what percent',
        body: 'Alpha-pinene is the most widely distributed terpene in the plant kingdom and is a major biogenic volatile in forest air. The operator\'s South African Helichrysum material is a notably rich source, and alpha-pinene is described in the review literature as a constituent common to all the South African Helichrysum species surveyed. Again, these are percentages of the recovered volatile oil, and the oil yield from Helichrysum material is on the order of 0.15 to 0.25 percent of the dried herb.',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported alpha-pinene content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Imphepho, Helichrysum odoratissimum', 'up to 43 percent', 'percent of essential oil', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Imphepho, Helichrysum cymosum', '29.82 percent', 'percent of essential oil', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['South African Helichrysum spp., generally', 'alpha-pinene named as a major constituent common to all species surveyed', 'qualitative', 'Lourens 2008; operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Rosemary (Salvia rosmarinus)', 'commonly in the low tens of percent, behind 1,8-cineole', 'percent of essential oil', 'operator archive; Perry 2000 for the Salvia work']),
            Object.freeze(['Pine and conifer resin, turpentine', 'principal component', 'percent of volatile fraction', 'reference compilation']),
            Object.freeze(['Cannabis sativa', 'a common but usually minor constituent of the terpene fraction', 'percent of terpene fraction', 'Booth and Bohlmann 2019']),
            Object.freeze(['Yerba Lena Yesca, Artemisia capillaris', 'present in the volatile fraction', 'qualitative', 'operator Temple Pharmacopoeia 2026']),
          ]),
        }),
        cites: Object.freeze(['vankush2026', 'lourens2008', 'perry2000', 'booth2019', 'compounddb']),
        contested: true,
        caveat: 'Single-analysis chemotype figures from the operator document. The "up to 43 percent" is an upper reported value, not a typical one, and Helichrysum populations vary substantially.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'Because alpha-pinene boils lowest of anything on this shelf, it is the compound that tells you most about handling. A material that still assays high in alpha-pinene was dried gently, stored cold and closed, and tested soon. A material that has lost its alpha-pinene while keeping its caryophyllene has been warm, open or old. For steam distillation, alpha-pinene comes over in the earliest fraction, which is why a fractionated collection differs chemically from a single pooled collection — relevant to anyone buying Helichrysum or rosemary oil by composition spec. For vaporization, alpha-pinene dominates the first draw and is largely gone by the third; see the vaporization-bands page.',
        cites: Object.freeze(['compounddb', 'vankush2026', 'lanz2016']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/cineole', 'terpenes/vaporization-bands', 'botanicals/helichrysum', 'botanicals/artemisia-capillaris', 'coa/panels']),
    cites: Object.freeze(['compounddb', 'lourens2008', 'miyazawa2005', 'perry2000', 'russo2011', 'vankush2026', 'booth2019', 'lanz2016']),
  }),

  // ----------------------------------------------------------------- cineole
  Object.freeze({
    slug: 'cineole',
    title: '1,8-Cineole (Eucalyptol)',
    kind: 'terpene',
    summary: 'A monoterpenoid cyclic ether with the best human respiratory trial evidence of any compound on this shelf, and a documented CYP3A substrate relationship. Dominant in Helichrysum odoratissimum at 17.44 percent of the oil.',
    facts: Object.freeze({
      'Structure class': 'monoterpenoid — bicyclic monoterpene cyclic ether (oxide), also named eucalyptol',
      'Molecular formula': 'C10H18O',
      'Molar mass': 'about 154.25 g/mol',
      'Boiling point at 1 atm': 'about 176 to 177 degrees Celsius (349 to 351 degrees Fahrenheit)',
      'Vaporization band': 'about 165 to 180 degrees Celsius (329 to 356 degrees Fahrenheit)',
      'Documented human evidence': 'randomised double-blind placebo-controlled trials in bronchial asthma and in COPD exacerbation reduction',
      'Documented enzyme relationship': 'oxidised by CYP3A enzymes in rat and human liver microsomes',
      'Regulatory': 'long-standing food flavouring and over-the-counter respiratory-product use; also a known irritant and, at high ingested doses in children, a recognised poisoning hazard',
      'Aroma': 'camphoraceous, cooling, eucalyptus',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Structure and physical constants',
        body: '1,8-Cineole is a monoterpenoid: C10H18O at about 154.25 g/mol, a bicyclic ether in which an oxygen bridges the 1 and 8 positions of a p-menthane skeleton to give a rigid oxabicyclic cage. The ether oxygen is the whole story — it raises the molar mass and the boiling point relative to the C10H16 monoterpenes, gives measurable water solubility (which is why cineole is prominent in hydrosols and not only in the oil), and makes the molecule a clean substrate for oxidative metabolism. Atmospheric boiling point is about 176 to 177 degrees Celsius. The name eucalyptol is the same compound; 1,8-cineole is the preferred name because 1,4-cineole also exists and is a different substance.',
        cites: Object.freeze(['compounddb']),
      }),
      Object.freeze({
        h: 'Respiratory effects — the human trials',
        body: 'Cineole carries better human evidence than any other compound on this shelf. Juergens and colleagues ran a double-blind placebo-controlled trial of 1,8-cineole in bronchial asthma and reported anti-inflammatory activity, with steroid-sparing effect as the clinical endpoint. Worth, Schacher and Dethlefsen ran a randomised placebo-controlled trial of concomitant cineole therapy in chronic obstructive pulmonary disease and reported a reduction in exacerbations. Mechanistically cineole is described as mucolytic and secretolytic, and as inhibiting inflammatory cytokine production in respiratory tissue. This is the evidence base underneath the very old practice of inhaling eucalyptus and eucalyptus-type volatiles for respiratory complaints — including the traditional smoke inhalation recorded for Imphepho, which is a cineole-rich material. The trials are on isolated 1,8-cineole administered in defined doses, not on inhaled plant smoke, and that distinction matters: smoke condensates from burning plant material have been shown to contain different compounds than solvent extracts of the same plant, so the trial evidence does not transfer directly to a combustion route.',
        cites: Object.freeze(['juergens2003', 'worth2009', 'lourens2008', 'vankush2026']),
        evidence: 'human',
        contested: true,
        caveat: 'The human trials used defined doses of isolated 1,8-cineole. They do not establish equivalent effect from inhaling smoke or vapour of a cineole-containing plant, where the delivered dose is unknown and combustion generates compounds absent from the intact material.',
      }),
      Object.freeze({
        h: 'Cytochrome P450: cineole is a CYP3A substrate',
        body: 'Miyazawa, Shindo and Shimada showed that 1,8-cineole is oxidised by CYP3A enzymes in rat and human liver microsomes, identifying CYP3A4 as a principal catalyst of its hydroxylation in human liver. The direction of that relationship is worth stating carefully, because consumer-facing writing usually gets it backwards: cineole is documented as a SUBSTRATE of CYP3A, which is a statement about how the body clears cineole. Whether cineole meaningfully inhibits or induces CYP3A at human exposure levels — and therefore whether it could alter the clearance of a co-administered drug — is a separate question that microsomal substrate work does not answer. 1,8-cineole does appear in the induction literature for some enzyme systems in animal models. Anyone reasoning about interactions should go to the CYP450 shelf and should note that the compound with the most-cited CYP3A INHIBITION data in this botanical space is piperine from black pepper, not cineole.',
        cites: Object.freeze(['miyazawa2001']),
        evidence: 'in vitro',
        contested: true,
        caveat: 'Substrate relationship, not an inhibition constant. Microsomal metabolism data do not establish a clinically relevant drug interaction. Do not read this as an interaction warning or as its absence.',
      }),
      Object.freeze({
        h: 'Toxicity and handling, stated plainly',
        body: 'Cineole is not a benign compound at arbitrary dose, and this belongs on an industry page rather than being softened. Eucalyptus oil and 1,8-cineole ingestion is a recognised paediatric poisoning, with central nervous system depression and seizure reported after ingestion of small volumes of concentrated oil by small children; concentrated cineole is also a mucous-membrane and skin irritant. The relevant industrial consequences are containment, child-resistant packaging and dilution discipline for anyone handling cineole-rich oils, and awareness that a hydrosol carries cineole too, at much lower concentration. This is a handling and packaging fact about a compound already in hand, not medical advice.',
        cites: Object.freeze(['compounddb', 'juergens2003']),
        contested: true,
        caveat: 'Toxicology summary compiled from general reference sources rather than from a specific primary case series cited here; treat the concentration thresholds as directional and consult a current toxicology reference for numbers.',
      }),
      Object.freeze({
        h: 'Where 1,8-cineole actually is, and at what percent',
        body: 'The operator\'s Helichrysum odoratissimum figure makes cineole one of the two defining compounds of that material alongside alpha-pinene, and the review literature names 1,8-cineole and alpha-pinene together as the constituents common to the South African Helichrysum species surveyed.',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported 1,8-cineole content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Imphepho, Helichrysum odoratissimum', '17.44 percent', 'percent of essential oil', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['South African Helichrysum spp., generally', 'named with alpha-pinene as a major constituent common to all species surveyed', 'qualitative', 'Lourens 2008']),
            Object.freeze(['Eucalyptus globulus and related species', 'the dominant constituent, commonly the large majority of the oil in cineole-type chemotypes', 'percent of essential oil', 'reference compilation']),
            Object.freeze(['Rosemary (Salvia rosmarinus)', 'commonly a leading constituent in cineole-type chemotypes', 'percent of essential oil', 'operator archive; reference compilation']),
            Object.freeze(['Bay laurel, cardamom, sage', 'a major to moderate constituent depending on chemotype', 'percent of essential oil', 'reference compilation']),
            Object.freeze(['Cannabis sativa', 'a minor constituent where present', 'percent of terpene fraction', 'Booth and Bohlmann 2019']),
          ]),
        }),
        cites: Object.freeze(['vankush2026', 'lourens2008', 'compounddb', 'booth2019']),
        contested: true,
        caveat: 'Chemotype figures. Rosemary and eucalyptus both have cineole-poor chemotypes sold under the same common name; a composition spec, not a species name, is what tells you what is in the drum.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'For a formulator, cineole is the monoterpenoid that survives into the hydrosol — the aqueous distillation byproduct the operator\'s document flags as valuable for toners and sprays is cineole-bearing, and that is a real, saleable second product from the same distillation run rather than a waste stream. For a lab tech, cineole is a well-behaved GC analyte and its ratio to alpha-pinene is a useful chemotype fingerprint for Helichrysum and rosemary material. For a buyer, insist on a composition certificate rather than a species name.',
        cites: Object.freeze(['vankush2026', 'lourens2008']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/alpha-pinene', 'terpenes/vaporization-bands', 'botanicals/helichrysum', 'cyp450/cyp3a4', 'coa/panels']),
    cites: Object.freeze(['compounddb', 'juergens2003', 'worth2009', 'miyazawa2001', 'lourens2008', 'vankush2026', 'booth2019']),
  }),

  // ---------------------------------------------------------------- limonene
  Object.freeze({
    slug: 'limonene',
    title: 'Limonene',
    kind: 'terpene',
    summary: 'A cyclic monoterpene — not a biphenyl and not a limonoid, contrary to the operator archive. Monoaminergic anti-stress effects documented in rodents; CYP findings are in-vitro and concentration-limited.',
    facts: Object.freeze({
      'Structure class': 'monocyclic monoterpene (p-menthadiene); a cyclohexene ring with an isopropenyl substituent',
      'Molecular formula': 'C10H16',
      'Molar mass': 'about 136.24 g/mol',
      'Boiling point at 1 atm': 'about 176 degrees Celsius (349 degrees Fahrenheit)',
      'Vaporization band': 'about 165 to 180 degrees Celsius (329 to 356 degrees Fahrenheit)',
      'Enantiomers': 'd-limonene, the (R)-(+) form, smells of orange and is the commercially dominant one; l-limonene, the (S)-(-) form, smells of pine and turpentine',
      'Documented enzyme relationship': 'metabolised to carveols and perillyl alcohols by CYP2C9 and CYP2C19 in human liver microsomes; in-vitro inhibition of several CYPs reported at high concentration',
      'Documented behavioural finding': 'lemon-oil vapour anti-stress effect in mice via 5-HT and dopamine modulation',
      'Industrial status': 'high-volume citrus-processing byproduct; GRAS flavouring; widely used industrial solvent and degreaser',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'CORRECTION to the operator archive: limonene is not biphenyl, and not a limonoid',
        body: 'The 2016 Van Kush terpene notes record limonene as "also called Biphenyl" and suggest that "limonoids are an entire class of cannabinoids", with the entry linking to the Wikipedia article on limonoids. Three separate things need correcting, politely but clearly, because all three are easy mistakes to make from the name alone. First, biphenyl is a completely different compound — two benzene rings joined by a single bond, C12H10, an aromatic used as a heat-transfer fluid and a fungistat. Limonene is C10H16, a monocyclic monoterpene built on the p-menthadiene skeleton: one non-aromatic cyclohexene ring carrying a methyl group and an isopropenyl group. It contains no benzene ring at all, and the two compounds share neither structure, class, odour nor use. Second, limonoids are not limonene relatives: they are highly oxygenated triterpenoid derivatives (C26 and related skeletons) characteristic of the Rutaceae and Meliaceae — limonin in citrus seed, azadirachtin in neem — and they are bitter, non-volatile and structurally remote from limonene. The shared root is the fruit, not the chemistry. Third, limonoids are not a class of cannabinoids and there is no evidence that they act at cannabinoid receptors as a class. The compound on this shelf that genuinely turned out to be a cannabinoid despite not looking like one is beta-caryophyllene, at CB2. Limonene\'s own documented pharmacology is monoaminergic and metabolic, described below, and it is interesting on its own terms without the limonoid detour.',
        bullets: Object.freeze([
          'Biphenyl: C12H10, two fused-free benzene rings, aromatic. Not limonene, not related.',
          'Limonene: C10H16, monocyclic monoterpene, p-menthadiene skeleton, no aromatic ring.',
          'Limonoids: oxygenated triterpenoid derivatives of Rutaceae and Meliaceae. Bitter, non-volatile, not cannabinoids, not limonene relatives.',
        ]),
        cites: Object.freeze(['marsresident2016', 'compounddb', 'gertsch2008']),
      }),
      Object.freeze({
        h: 'Structure and physical constants',
        body: 'Limonene is C10H16 at about 136.24 g/mol, a monocyclic monoterpene with one endocyclic and one exocyclic double bond, boiling at about 176 degrees Celsius at one atmosphere. It is chiral and the two enantiomers are perceptually and commercially distinct: d-limonene, the (R)-(+) form, is the orange-peel compound recovered in enormous volume as a citrus-processing byproduct and used as a flavouring and as a solvent; l-limonene, the (S)-(-) form, smells piney. Most reports and most certificates of analysis give a single combined limonene figure unless a chiral column was used. Limonene autoxidises on air exposure to limonene hydroperoxides and carvone, and those oxidation products — not limonene itself — are the recognised contact sensitisers, which is why a fresh drum and an old drum of the same material have different irritancy profiles. That is a storage and labelling fact of real industrial consequence.',
        cites: Object.freeze(['compounddb', 'sun2007']),
      }),
      Object.freeze({
        h: 'Monoaminergic and behavioural findings',
        body: 'The clearest behavioural work on limonene comes through citrus-oil vapour studies. Komiya, Takeuchi and Harada reported that lemon-oil vapour produced an anti-stress effect in mice and that the effect was accompanied by modulation of serotonergic and dopaminergic activity, which is the primary-source basis for describing limonene as mood-modulating by a monoaminergic route. do Vale and colleagues, in the Lippia alba chemotype work, reported central effects for limonene alongside citral and myrcene. The operator archive\'s statement that limonene "can affect mood when smoked or ingested" is broadly consistent with this literature, which is a fairer assessment than the archive usually gets credit for. The frequently repeated claim that limonene acts through adenosine A2A receptors is a different matter: it circulates widely in terpene writing and this shelf could not trace it to a primary source it is willing to assert, so it is recorded here as unverified rather than repeated. The documented monoaminergic finding stands on its own.',
        cites: Object.freeze(['komiya2006', 'dovale2002', 'marsresident2016']),
        evidence: 'animal',
        contested: true,
        caveat: 'Rodent inhalation and systemic studies on citrus oil and on isolated limonene; no controlled human mood study is cited here. The adenosine A2A mechanism commonly attributed to limonene could not be traced to a primary source we are prepared to assert, and is flagged as unverified rather than reported as fact.',
      }),
      Object.freeze({
        h: 'Cytochrome P450: what is actually documented',
        body: 'Miyazawa, Shindo and Shimada showed that both limonene enantiomers are metabolised to the corresponding carveols and perillyl alcohols by CYP2C9 and CYP2C19 in human liver microsomes. That is a substrate relationship: it says which human enzymes clear limonene, and it is the best-supported P450 fact about the compound. Separately, in-vitro microsomal work has reported weak inhibition of several cytochrome P450 isoforms including CYP2C9 and CYP2D6 by d-limonene. Two cautions apply to that second finding and they are the same cautions that apply to most in-vitro terpene enzymology. The inhibition is reported at concentrations far above the plasma levels achievable from dietary or aromatic exposure, and no clinical drug interaction attributable to limonene has been demonstrated in humans — Sun\'s safety and clinical-applications review is notable for how well tolerated high oral doses of d-limonene have been in human studies without interaction signals emerging. Anyone reasoning about real interaction risk in this botanical space should go to the CYP450 shelf and start with piperine, where the human data are much stronger.',
        cites: Object.freeze(['miyazawa2002', 'sun2007']),
        evidence: 'in vitro',
        contested: true,
        caveat: 'The CYP2C9 and CYP2D6 inhibition findings are in-vitro microsomal results at concentrations above plausible human exposure, and this shelf does not name a specific primary inhibition paper it can verify. No human limonene drug interaction has been demonstrated. Do not use this section as an interaction warning in either direction.',
      }),
      Object.freeze({
        h: 'Where limonene actually is, and at what percent',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported limonene content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Citrus peel oils (orange, lemon, grapefruit)', 'the dominant constituent, commonly the large majority of cold-pressed peel oil', 'percent of essential oil', 'Sun 2007; reference compilation']),
            Object.freeze(['Black pepper (Piper nigrum)', 'a leading constituent alongside beta-caryophyllene and the pinenes', 'percent of essential oil', 'operator archive; reference compilation']),
            Object.freeze(['Cannabis sativa', 'a common major terpene in many chemovars', 'percent of terpene fraction', 'Booth and Bohlmann 2019; Russo 2011']),
            Object.freeze(['Dill, caraway, celery seed', 'a major constituent alongside carvone', 'percent of essential oil', 'reference compilation']),
            Object.freeze(['Conifers (l-limonene)', 'present as a minor to moderate constituent', 'percent of volatile fraction', 'reference compilation']),
          ]),
        }),
        cites: Object.freeze(['sun2007', 'compounddb', 'booth2019', 'russo2011', 'marsresident2016']),
        contested: true,
        caveat: 'Percent-of-oil figures with wide chemotype and processing variation; citrus peel oil composition in particular depends heavily on extraction route.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'Limonene is the terpene most likely to be in a product for a reason that has nothing to do with pharmacology: it is cheap, it is available in tanker quantity as a citrus byproduct, and it is an excellent nonpolar solvent and degreaser. That has two consequences for this industry. First, a suspiciously high limonene figure in a terpene-added product may reflect the cheapest available bulk terpene rather than a botanical profile. Second, limonene\'s solvent character is exactly why it should not be treated casually as a flavouring at high loading in any product with plastic contact surfaces — it attacks some polymers. For a lab tech, note the oxidation products: limonene hydroperoxides and carvone appearing on a chromatogram are an age marker.',
        cites: Object.freeze(['sun2007', 'compounddb']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/beta-caryophyllene', 'terpenes/vaporization-bands', 'cyp450/cyp2c9', 'cyp450/cyp2d6', 'botanicals/black-pepper', 'coa/red-flags']),
    cites: Object.freeze(['marsresident2016', 'compounddb', 'gertsch2008', 'sun2007', 'komiya2006', 'dovale2002', 'miyazawa2002', 'booth2019', 'russo2011']),
  }),

  // ---------------------------------------------------------------- linalool
  Object.freeze({
    slug: 'linalool',
    title: 'Linalool',
    kind: 'terpene',
    summary: 'An acyclic monoterpene alcohol with rodent anxiolytic and sedative data, documented effects on glutamate release and on GABA-A receptors — the latter largely via its metabolites rather than the parent compound.',
    facts: Object.freeze({
      'Structure class': 'acyclic monoterpenoid — a tertiary monoterpene alcohol',
      'Molecular formula': 'C10H18O',
      'Molar mass': 'about 154.25 g/mol',
      'Boiling point at 1 atm': 'about 198 to 199 degrees Celsius (388 to 390 degrees Fahrenheit)',
      'Vaporization band': 'about 175 to 190 degrees Celsius (347 to 374 degrees Fahrenheit)',
      'Enantiomers': '(R)-(-)-linalool, the licareol form, is the lavender-type odour; (S)-(+)-linalool, coriandrol, is the coriander-type',
      'Documented targets': 'inhibition of glutamate release and glutamate binding in rat cortex; modulation of GABA-A receptors reported principally for linalool metabolites',
      'Aroma': 'floral, lavender, faintly citrus and woody',
      'Regulatory': 'GRAS flavouring; also an EU-declarable fragrance allergen, principally via its oxidation products',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Structure and physical constants',
        body: 'Linalool is a monoterpenoid — an acyclic tertiary alcohol, C10H18O at about 154.25 g/mol, boiling at about 198 to 199 degrees Celsius at one atmosphere. That is the highest boiling point of any monoterpene-class compound on this shelf and it puts linalool at the top of the monoterpene vaporization band, overlapping the bottom of the sesquiterpene band. The tertiary hydroxyl makes linalool prone to acid-catalysed dehydration and rearrangement, and prone to autoxidation to linalool hydroperoxides — which, as with limonene, are the recognised contact sensitisers rather than the parent alcohol, and are the reason linalool appears on fragrance-allergen declaration lists. Both enantiomers occur naturally in characteristic distributions; lavender is dominated by the (R)-(-) form.',
        cites: Object.freeze(['compounddb']),
      }),
      Object.freeze({
        h: 'Glutamate and GABA: what is documented, and the metabolite twist',
        body: 'Elisabetsky, Marschner and Onofre Souza reported that linalool inhibits glutamatergic transmission in rat cerebral cortex, affecting glutamate binding and release — the earliest specific mechanistic account of linalool\'s central effects, and one that points to reduced excitatory drive rather than to direct inhibitory potentiation. Linck and colleagues later showed that INHALED linalool produced anxiolytic effects in mice with increased social interaction and reduced aggression, which is important because it establishes activity by the route actually used in aromatherapy and in vaporization rather than only by injection. The GABA story needs a specific caveat. Milanos and colleagues examined linalool and its metabolic products at GABA-A receptors and found that the modulation attributed to linalool is substantially carried by metabolites rather than by the parent compound. That is a genuinely important qualification: it means an in-vitro assay on neat linalool and an in-vivo inhalation experiment can disagree for a real reason, and it means the popular shorthand that linalool is a GABA-A modulator is an oversimplification of a metabolite-dependent effect.',
        cites: Object.freeze(['elisabetsky1995', 'linck2010', 'milanos2017']),
        evidence: 'animal',
        contested: true,
        caveat: 'Rodent data. GABA-A modulation is reported principally for linalool metabolites, not for the parent compound, so parent-compound in-vitro assays and whole-animal inhalation results are not directly comparable. No controlled human anxiolysis trial on isolated linalool is cited here.',
      }),
      Object.freeze({
        h: 'Anticonvulsant, analgesic and anti-inflammatory reports',
        body: 'Beyond the anxiolytic literature, linalool appears in rodent anticonvulsant, antinociceptive and local-anaesthetic-like reports, and it is one of the terpenes most often invoked in the entourage discussion as a candidate contributor to a sedating or anxiolytic profile in cannabis. Russo\'s review collects these threads. The constraint is the same one that applies across this shelf: linalool is typically a low-percentage constituent of the terpene fraction of cannabis, and the terpene fraction is itself a few percent of dry flower weight, so the absolute quantity delivered is small compared with the doses used in the animal work. LaVigne and colleagues reported that several cannabis terpenes including linalool behaved cannabimimetically and could enhance cannabinoid receptor activity in their assay system; Santiago and colleagues, testing common cannabis terpenoids for modulation of THC activity at human CB1 and CB2, found none. Both results are in vitro and they disagree.',
        cites: Object.freeze(['russo2011', 'lavigne2021', 'santiago2019', 'booth2019']),
        contested: true,
        caveat: 'Entourage claims for linalool rest on conflicting in-vitro results and on animal doses well above the amount present in inhaled or ingested plant material. Dose realism is the binding constraint, not mechanism plausibility.',
        evidence: 'in vitro',
      }),
      Object.freeze({
        h: 'Where linalool actually is, and at what percent',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported linalool content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Lavender (Lavandula spp.)', 'a dominant constituent alongside linalyl acetate', 'percent of essential oil', 'Linck 2010; reference compilation']),
            Object.freeze(['Coriander seed (Coriandrum sativum)', 'the dominant constituent, largely the (S)-(+) enantiomer', 'percent of essential oil', 'reference compilation']),
            Object.freeze(['Sweet basil, rosewood, ho wood', 'a major constituent', 'percent of essential oil', 'reference compilation']),
            Object.freeze(['Cannabis sativa', 'a common minor to moderate constituent of the terpene fraction', 'percent of terpene fraction', 'Booth and Bohlmann 2019; Russo 2011']),
            Object.freeze(['Lippia alba chemotypes', 'present; central effects studied alongside citral, myrcene and limonene', 'percent of essential oil', 'do Vale 2002']),
          ]),
        }),
        cites: Object.freeze(['linck2010', 'compounddb', 'booth2019', 'russo2011', 'dovale2002']),
        contested: true,
        caveat: 'Chemotype figures from reference compilation and from the cited studies; lavender oil composition in particular is heavily cultivar- and altitude-dependent and is frequently adulterated with synthetic linalool and linalyl acetate.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'Linalool is one of the most-adulterated compounds in the essential-oil trade because synthetic linalool is cheap and the natural material is not; enantiomeric-excess analysis on a chiral column is the standard way to catch it, since synthetic linalool is typically racemic while natural material is not. For a formulator, the hydroperoxide issue governs shelf life and allergen declaration on anything linalool-bearing that will be sold in the EU. For a lab tech, linalool\'s high boiling point among monoterpenes means it does not track with alpha-pinene and myrcene as a freshness indicator — a sample can be linalool-rich and monoterpene-poor simply from having been warm.',
        cites: Object.freeze(['compounddb']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/vaporization-bands', 'terpenes/limonene', 'endocannabinoid/entourage-effect', 'coa/panels']),
    cites: Object.freeze(['compounddb', 'elisabetsky1995', 'linck2010', 'milanos2017', 'russo2011', 'lavigne2021', 'santiago2019', 'booth2019', 'dovale2002']),
  }),

  // ---------------------------------------------------------------- humulene
  Object.freeze({
    slug: 'humulene',
    title: 'Alpha-Humulene',
    kind: 'terpene',
    summary: 'The monocyclic eleven-membered-ring sesquiterpene isomeric with beta-caryophyllene, with genuine rodent anti-inflammatory data in oedema and in allergic airway inflammation — and no cannabinoid receptor activity.',
    facts: Object.freeze({
      'Structure class': 'monocyclic sesquiterpene — an eleven-membered carbocycle (humulane skeleton)',
      'Molecular formula': 'C15H24',
      'Molar mass': 'about 204.36 g/mol',
      'Relationship to beta-caryophyllene': 'a ring-opened isomer; identical formula and mass, different skeleton, different pharmacology',
      'Boiling point at 1 atm': 'not reliably tabulated; expect the sesquiterpene region of roughly 250 to 280 degrees Celsius. The figure of about 106 degrees Celsius that circulates in cannabis terpene charts is a REDUCED-PRESSURE value and is not an atmospheric boiling point',
      'Vaporization band': 'about 180 to 205 degrees Celsius (356 to 401 degrees Fahrenheit)',
      'Documented activity': 'anti-inflammatory in rodent oedema models and in an experimental allergic airway inflammation model, including by oral and aerosol routes',
      'Cannabinoid receptor activity': 'none documented; unlike its isomer beta-caryophyllene, alpha-humulene is not a CB2 agonist',
      'Aroma': 'hoppy, woody, faintly earthy',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Structure: the isomer that is not a cannabinoid',
        body: 'Alpha-humulene, historically alpha-caryophyllene, is C15H24 at about 204.36 g/mol — the same formula and the same molar mass as beta-caryophyllene. The difference is the skeleton: alpha-humulene is a single eleven-membered ring with three double bonds, where beta-caryophyllene is the bicyclic form with the strained cyclobutane. The two interconvert in the laboratory and co-occur in nature, and they are the clearest demonstration on this shelf that terpene pharmacology is about shape rather than composition. Beta-caryophyllene\'s rigid bicyclic geometry lets it occupy CB2 at nanomolar affinity. Alpha-humulene, with the same atoms in a floppy macrocycle, has no documented cannabinoid receptor activity at all. Anyone tempted to reason from formula to activity in this space should keep this pair in mind.',
        cites: Object.freeze(['gertsch2008', 'fernandes2007', 'compounddb']),
      }),
      Object.freeze({
        h: 'A boiling-point warning specific to this compound',
        body: 'Cannabis terpene charts very commonly list alpha-humulene with a boiling point of about 106 degrees Celsius. That number is a reduced-pressure distillation figure — a temperature measured under vacuum — and it is not an atmospheric boiling point. Reproducing it in a chart headed "boiling point" next to atmospheric values for the monoterpenes creates a nonsensical ordering in which a sesquiterpene appears to be the most volatile compound in cannabis, which it is not. This shelf does not assert a precise atmospheric figure for alpha-humulene because we do not have one we can verify; by analogy with beta-caryophyllene, the same formula and a similar polarity, expect the 250 to 280 degrees Celsius region. The practical vaporization band, which is what a device user actually needs, is around 180 to 205 degrees Celsius and is given above.',
        cites: Object.freeze(['compounddb', 'lanz2016']),
        contested: true,
        caveat: 'We do not assert an atmospheric boiling point for alpha-humulene. The commonly circulated figure near 106 degrees Celsius is a reduced-pressure value, and the 250 to 280 degrees Celsius estimate given here is an analogy to beta-caryophyllene, not a measurement.',
      }),
      Object.freeze({
        h: 'Anti-inflammatory pharmacology',
        body: 'Alpha-humulene has better-characterised anti-inflammatory data than most terpenes. Fernandes and colleagues isolated alpha-humulene and (-)-trans-caryophyllene from Cordia verbenacea essential oil and reported that both inhibited oedema and inflammatory mediator release in rodent models, by oral and topical routes. Rogerio and colleagues then tested alpha-humulene specifically in an experimental model of allergic airway inflammation and reported both preventive and therapeutic anti-inflammatory effects, with reductions in eosinophil recruitment and in inflammatory mediators, including when administered by aerosol. The aerosol result is worth flagging for this industry because it is direct evidence of activity by an inhaled route for a sesquiterpene that a vaporizer delivers. Mechanistically the reports implicate reduced pro-inflammatory cytokine and mediator production rather than a specific receptor; no cannabinoid receptor involvement is described, and the operator\'s own material correctly lists alpha-humulene as anti-inflammatory rather than as a cannabinoid.',
        cites: Object.freeze(['fernandes2007', 'rogerio2009', 'vankush2026']),
        evidence: 'animal',
        contested: true,
        caveat: 'Rodent models with systemic, topical and aerosol dosing at defined doses. No human trial on isolated alpha-humulene is cited here, and no specific molecular target has been established.',
      }),
      Object.freeze({
        h: 'Where alpha-humulene actually is, and at what percent',
        body: 'Alpha-humulene is named for hops, where it is one of the characteristic oil components, and it is a routine co-traveller of beta-caryophyllene wherever that compound occurs — the biosynthetic routes are related and the two are typically reported together on a terpene panel. The operator\'s Artemisia capillaris material is one of the inventory sources.',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported alpha-humulene content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Hops (Humulus lupulus)', 'a characteristic constituent of hop oil, variety-dependent', 'percent of hop oil', 'operator Temple Pharmacopoeia 2026; reference compilation']),
            Object.freeze(['Yerba Lena Yesca, Artemisia capillaris', 'present; listed as anti-inflammatory and also found in hops', 'qualitative', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Cordia verbenacea', 'a constituent of the essential oil, isolated for the anti-inflammatory studies', 'percent of essential oil', 'Fernandes 2007; Rogerio 2009']),
            Object.freeze(['Cannabis sativa', 'a common sesquiterpene, usually reported alongside beta-caryophyllene', 'percent of terpene fraction', 'Booth and Bohlmann 2019; Russo 2011']),
            Object.freeze(['Sage, ginseng, balsam fir', 'present as a minor to moderate constituent', 'percent of essential oil', 'reference compilation']),
          ]),
        }),
        cites: Object.freeze(['vankush2026', 'fernandes2007', 'rogerio2009', 'booth2019', 'russo2011', 'compounddb']),
        contested: true,
        caveat: 'Mostly qualitative or compiled figures; the operator document does not give a quantitative humulene percentage for Artemisia capillaris or hops.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'For a lab tech, alpha-humulene and beta-caryophyllene are the pair to check for coelution and misassignment: same formula, same nominal mass, close retention on some columns, and confusion between them is a recurring source of error on terpene panels. Confirm against a reference standard for each, separately. For a formulator, alpha-humulene is the sesquiterpene with the best inhaled-route anti-inflammatory evidence, which makes it interesting in a vaporization context in a way that its lack of receptor pharmacology might otherwise obscure. For a buyer, a terpene panel that reports one of this pair and not the other is reporting an incomplete sesquiterpene picture.',
        cites: Object.freeze(['rogerio2009', 'gertsch2008']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/beta-caryophyllene', 'terpenes/vaporization-bands', 'botanicals/hops', 'botanicals/artemisia-capillaris', 'coa/panels']),
    cites: Object.freeze(['gertsch2008', 'fernandes2007', 'rogerio2009', 'compounddb', 'lanz2016', 'vankush2026', 'booth2019', 'russo2011']),
  }),

  // ----------------------------------------------------------------- ocimene
  Object.freeze({
    slug: 'ocimene',
    title: 'Ocimene',
    kind: 'terpene',
    summary: 'An acyclic monoterpene of the herbivore-induced plant volatile system, dominant in Helichrysum petiolare at 17.21 percent of the oil. Ecologically well characterised, pharmacologically thin.',
    facts: Object.freeze({
      'Structure class': 'acyclic monoterpene, an isomeric triene series',
      'Molecular formula': 'C10H16',
      'Molar mass': 'about 136.24 g/mol',
      'Isomers': 'alpha-ocimene and the (E)- and (Z)- isomers of beta-ocimene; (E)-beta-ocimene is the form usually reported in botanical analyses',
      'Boiling point at 1 atm': 'about 175 to 177 degrees Celsius (347 to 351 degrees Fahrenheit); reported figures vary with isomer and source',
      'Vaporization band': 'about 155 to 175 degrees Celsius (311 to 347 degrees Fahrenheit)',
      'Documented biology': 'well characterised as a herbivore-induced and floral plant volatile with signalling roles in plant-insect interaction; human pharmacology is sparse',
      'Aroma': 'sweet, herbaceous, woody, green',
      'Stability': 'a conjugated triene, so among the least stable monoterpenes; oxidises and polymerises readily',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Structure, isomers, and why the isomer label matters',
        body: 'Ocimene is C10H16 at about 136.24 g/mol, an acyclic monoterpene triene occurring as a family of isomers: alpha-ocimene, (E)-beta-ocimene and (Z)-beta-ocimene. The conjugated triene makes it the least stable monoterpene on this shelf — it oxidises and polymerises readily, isomerises on standing, and is easily lost or altered between harvest and injection. Analytically that means an ocimene figure is only as good as the sample handling behind it, and that a report giving "ocimene" without specifying the isomer has discarded information: the isomers differ in odour and in their ecological roles, and a chromatographic assignment to the wrong isomer is a common error. Atmospheric boiling point is in the region of 175 to 177 degrees Celsius, with reported values varying by isomer and source.',
        cites: Object.freeze(['compounddb', 'lourens2008']),
      }),
      Object.freeze({
        h: 'What is actually documented: plant signalling, not human pharmacology',
        body: 'The strongest body of evidence about ocimene is ecological rather than pharmacological. (E)-beta-ocimene is one of the best-characterised herbivore-induced plant volatiles: plants under insect attack emit it, and it functions in indirect defence by attracting predators and parasitoids of the attacking herbivore, as well as in floral signalling to pollinators and in honeybee brood pheromone communication. That is a real, well-replicated body of work and it is the honest headline for this compound. Human pharmacology is another matter. Scattered in-vitro reports describe antifungal, antiviral and anti-inflammatory activity for ocimene-containing oils or for ocimene itself, but there is no receptor target, no replicated animal behavioural model and no human study of the kind that exists for myrcene, linalool or cineole. This shelf therefore does not give ocimene a pharmacology section it has not earned. Ocimene is present, it is analytically useful as a chemotype marker, and its human effects are undetermined.',
        cites: Object.freeze(['booth2019', 'lourens2008']),
        contested: true,
        caveat: 'LOW EVIDENCE for human pharmacology. No receptor target, no replicated animal behavioural data, no human trial. The well-supported ocimene literature is plant-ecological. Claims of specific therapeutic effects for ocimene in consumer material are not supported by the sources available to this shelf.',
        evidence: 'in vitro',
      }),
      Object.freeze({
        h: 'Where ocimene actually is, and at what percent',
        body: 'The operator\'s Helichrysum petiolare analysis makes (E)-beta-ocimene one of the two defining compounds of that material, alongside faurinone — a profile that distinguishes H. petiolare from the pinene- and cineole-dominated H. odoratissimum and H. cymosum, and is part of why the species are chemically distinguishable even though tradition treats them as interchangeable.',
        table: Object.freeze({
          cols: Object.freeze(['Botanical', 'Reported ocimene content', 'Basis', 'Source']),
          rows: Object.freeze([
            Object.freeze(['Imphepho, Helichrysum petiolare', '17.21 percent, reported as (E)-beta-ocimene', 'percent of essential oil', 'operator Temple Pharmacopoeia 2026']),
            Object.freeze(['Sweet basil (Ocimum basilicum), the namesake genus', 'present in several chemotypes', 'percent of essential oil', 'reference compilation']),
            Object.freeze(['Cannabis sativa', 'a common minor to moderate terpene, frequently reported as beta-ocimene', 'percent of terpene fraction', 'Booth and Bohlmann 2019']),
            Object.freeze(['Hops, lavender, orchids, mint', 'present as a minor constituent and as a floral volatile', 'percent of volatile fraction', 'reference compilation']),
            Object.freeze(['Many plants under herbivore attack', 'induced emission; the quantity is a response, not a constant', 'emission rate', 'plant-volatile literature, summarised in Booth and Bohlmann 2019']),
          ]),
        }),
        cites: Object.freeze(['vankush2026', 'booth2019', 'compounddb', 'lourens2008']),
        contested: true,
        caveat: 'The H. petiolare figure is a single reported analysis in the operator document. Note also that ocimene emission in many plants is inducible, so a measured content depends on the plant\'s recent stress history as well as its genotype.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'Ocimene is the terpene most likely to disappear between the field and the report. If ocimene matters to a product specification — and for Helichrysum petiolare material it is a defining constituent — the chain of custody, temperature and time between harvest and analysis has to be controlled and documented, not assumed. For a lab tech, resolve and report the isomer. For a buyer, an ocimene figure on an old certificate of analysis is weak evidence about current material.',
        cites: Object.freeze(['compounddb', 'vankush2026']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/faurinone', 'terpenes/vaporization-bands', 'botanicals/helichrysum', 'coa/panels']),
    cites: Object.freeze(['compounddb', 'lourens2008', 'booth2019', 'vankush2026']),
  }),

  // --------------------------------------------------------------- faurinone
  Object.freeze({
    slug: 'faurinone',
    title: 'Faurinone',
    kind: 'terpene',
    summary: 'A thinly documented sesquiterpenoid ketone, reported at 20.66 percent of Helichrysum petiolare oil as a first identification in that species. Almost nothing is known about its pharmacology and this page says so.',
    facts: Object.freeze({
      'Structure class': 'sesquiterpenoid ketone, per the sources available to this shelf',
      'Molecular formula': 'reported as C15H24O, molar mass about 220.4 g/mol — we have not verified this against a primary structural report',
      'Boiling point': 'not established in any source available to this shelf',
      'Vaporization band': 'not measured. By analogy with other sesquiterpenoids, expect the 175 to 200 degrees Celsius (347 to 392 degrees Fahrenheit) band. This is an inference, not a measurement',
      'Documented receptor or enzyme activity': 'NONE that this shelf can cite',
      'Name origin': 'apparently from Valeriana fauriei, from which the compound is reported to have been first described — stated here as probable etymology, not as a verified provenance',
      'Evidence level': 'LOW. One quantitative analysis in the operator document; no pharmacology',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Why this page is short',
        body: 'Faurinone is a genuinely thinly documented compound and this page is not going to pretend otherwise. It appears on this shelf for one reason: the operator\'s Temple Pharmacopoeia records faurinone at 20.66 percent of the essential oil of Helichrysum petiolare, noted as a first identification in that species. That makes it the single largest reported constituent of a material in the operator\'s inventory, which is a good enough reason to have a page — a formulator working with H. petiolare oil is working with something that is one fifth faurinone, and ought to be told that the pharmacology of that fifth is unknown. What follows is what is actually known and, more importantly, what is not. An honest short page is better than a padded long one, and every terpene reference that pads out its rare-compound entries with plausible-sounding activity claims is doing the reader harm.',
        cites: Object.freeze(['vankush2026']),
        contested: true,
        caveat: 'LOW EVIDENCE PAGE. The quantitative figure rests on a single analysis recorded in an internal operator document. No pharmacology, toxicology or physical-constant data are cited here because this shelf has none it can verify.',
      }),
      Object.freeze({
        h: 'What is reported',
        body: 'Faurinone is described as a sesquiterpenoid ketone. The operator document records it at 20.66 percent of the H. petiolare essential oil, as a first identification in that species, alongside (E)-beta-ocimene at 17.21 percent — so H. petiolare is chemically distinguished from its congeners H. odoratissimum and H. cymosum, which are dominated by alpha-pinene with 1,8-cineole and (E)-caryophyllene respectively. The review literature on South African Helichrysum species records a broad and species-variable sesquiterpenoid chemistry, which is consistent with a ketone of this kind being present, but this shelf does not claim that the review names faurinone specifically at this figure. The name appears to derive from Valeriana fauriei, the Japanese valerian from which the compound is reported to have been first described; that etymology is given as probable, not as a verified provenance, and no primary structural paper is cited here because none has been verified.',
        cites: Object.freeze(['vankush2026', 'lourens2008']),
        contested: true,
        caveat: 'Single-source quantitative figure. The Valeriana fauriei etymology and the C15H24O formula are both unverified against a primary source and should be checked before being relied on in any specification or publication.',
      }),
      Object.freeze({
        h: 'What is NOT known',
        body: 'The following are open questions, listed explicitly so that nobody mistakes the silence for an absence of interest. There is no established receptor or enzyme target for faurinone. There is no reported binding at cannabinoid receptors, and nothing about a sesquiterpenoid ketone skeleton predicts one — recall that alpha-humulene and beta-caryophyllene share a formula and differ completely in receptor behaviour, so skeletal analogy is a poor guide here. There is no animal behavioural or anti-inflammatory data this shelf can cite. There is no toxicology: no acute dose data, no sensitisation data, no repeat-exposure data. There is no verified boiling point, vapour pressure or thermal-degradation profile, which means there is no measured basis for a vaporization band and the band given in the facts above is an analogy to other sesquiterpenoids. There is no reference-standard availability statement, which matters directly for analysis: a compound without a commercially available certified reference standard cannot be quantified against a calibration curve, and a lab reporting it is most likely reporting a library-match identification with a relative area percent rather than a true quantitation. That is the same analytical limitation the COA shelf discusses for novel cannabinoids, and it applies here.',
        bullets: Object.freeze([
          'No receptor or enzyme target documented.',
          'No animal or human pharmacology documented.',
          'No toxicology, sensitisation or repeat-exposure data documented.',
          'No verified physical constants; the vaporization band on this page is an inference from compound class.',
          'Reference-standard availability unknown; a reported figure may be a library match with relative area percent, not a quantitation.',
        ]),
        cites: Object.freeze(['vankush2026', 'gertsch2008']),
        contested: true,
        caveat: 'This section documents an absence of evidence. Absence of reported toxicity is not evidence of safety, and a compound at 20 percent of an oil with no toxicology behind it is a reason for caution in a topical or inhaled product, not a reason for confidence.',
      }),
      Object.freeze({
        h: 'Industry notes and a research opening',
        body: 'For a formulator: if you are working with H. petiolare oil, a fifth of the volatile fraction is a compound with no published safety or pharmacology data. That is not a prohibition — plenty of traditional materials are in that position and the plant has a long record of ritual and medicinal use — but it should be a documented known-unknown in your product file rather than an invisible one, and it argues for characterising the oil you actually have rather than relying on a species name. For a researcher: this is a real opening. A compound at 20 percent of a distinctive traditional material, with a first-identification claim attached and essentially no pharmacology, is exactly the kind of gap that a small, well-designed characterisation study could close. The first useful steps are unglamorous: confirm the identification against an authentic standard, establish the physical constants, and publish the structure with a verifiable identifier — none of which this shelf can currently point to.',
        cites: Object.freeze(['vankush2026', 'lourens2008']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/ocimene', 'terpenes/gamma-curcumene', 'terpenes/vaporization-bands', 'botanicals/helichrysum', 'coa/panels']),
    cites: Object.freeze(['vankush2026', 'lourens2008', 'gertsch2008']),
  }),

  // ---------------------------------------------------------- gamma-curcumene
  Object.freeze({
    slug: 'gamma-curcumene',
    title: 'Gamma-Curcumene',
    kind: 'terpene',
    summary: 'A bisabolane-type sesquiterpene hydrocarbon reported at 15.76 percent of Helichrysum odoratissimum oil. Structurally placed, pharmacologically almost undocumented as an isolated compound.',
    facts: Object.freeze({
      'Structure class': 'sesquiterpene hydrocarbon, bisabolane type — the curcumene series related to turmeric sesquiterpenes',
      'Molecular formula': 'C15H24',
      'Molar mass': 'about 204.36 g/mol',
      'Related compounds': 'alpha-curcumene, beta-curcumene, ar-curcumene, and the turmeric turmerones; ar-curcumene is the aromatic member and is much better studied',
      'Boiling point': 'not reliably tabulated in any source available to this shelf; expect the sesquiterpene region',
      'Vaporization band': 'not measured. By analogy with other sesquiterpenes, expect the 175 to 200 degrees Celsius (347 to 392 degrees Fahrenheit) band. This is an inference, not a measurement',
      'Documented receptor or enzyme activity': 'NONE for gamma-curcumene specifically that this shelf can cite',
      'Evidence level': 'LOW. Structurally well placed; pharmacologically undocumented as an isolated compound',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'What gamma-curcumene is',
        body: 'Gamma-curcumene is a sesquiterpene hydrocarbon, C15H24 at about 204.36 g/mol, belonging to the bisabolane structural family — the same skeletal group as alpha-, beta- and ar-curcumene and, more distantly, the turmerones of turmeric. The curcumene name comes from Curcuma, and the group is best known from turmeric volatile oil, where it sits alongside the far more famous non-volatile curcuminoids. Note the trap in that sentence: curcumene and curcumin are unrelated compounds that share a plant and three syllables. Curcumin is a non-volatile diarylheptanoid polyphenol with a very large research literature; gamma-curcumene is a volatile sesquiterpene hydrocarbon with almost none. Do not transfer a claim from one to the other, and be alert for consumer copy that does.',
        cites: Object.freeze(['compounddb', 'vankush2026']),
        contested: true,
        caveat: 'The structural class assignment is from reference compilation rather than from a primary structural paper cited here. The commonly quoted formula C15H24 and mass about 204.4 g/mol follow from the class and are consistent across compound databases.',
      }),
      Object.freeze({
        h: 'Why it is on this shelf',
        body: 'Gamma-curcumene has a page because the operator\'s Temple Pharmacopoeia records it at 15.76 percent of the essential oil of Helichrysum odoratissimum, making it the third major constituent of that material after alpha-pinene (up to 43 percent) and 1,8-cineole (17.44 percent). Two of those three compounds have substantial pharmacology sections on this shelf. The third does not, and a reader working with H. odoratissimum oil deserves to know which is which rather than to infer that everything in a well-studied oil is itself well studied. The South African Helichrysum review literature describes a varied sesquiterpenoid chemistry across the genus which is consistent with curcumene-type compounds being present; this shelf does not claim that the review reports this specific figure.',
        cites: Object.freeze(['vankush2026', 'lourens2008']),
        contested: true,
        caveat: 'Single-source quantitative figure from an internal operator document, describing one analysis of one population.',
      }),
      Object.freeze({
        h: 'What is NOT known',
        body: 'There is no documented receptor or enzyme target for gamma-curcumene as an isolated compound. There is no animal behavioural, analgesic or anti-inflammatory study on the isolated compound that this shelf can cite. There is no toxicology and no sensitisation data. There is no reliably tabulated boiling point or vapour pressure, so the vaporization band on this page is an inference from compound class rather than a measurement. The nearest relative with a real literature is ar-curcumene, the aromatic member of the series, which appears in antimicrobial and antiproliferative in-vitro reports — and activity in ar-curcumene is not evidence about gamma-curcumene. Much of what circulates about "curcumene" activity is in fact about turmeric oil as a mixture, about the turmerones, or about curcumin, and attributing any of it to gamma-curcumene is an error. The same reference-standard point applies as for faurinone: without a certified standard, a reported percentage is most likely a mass-spectral library match with a relative area percent rather than a true quantitation, and a purchaser relying on that figure should ask the lab which it is.',
        bullets: Object.freeze([
          'No receptor or enzyme target documented for the isolated compound.',
          'No animal or human pharmacology on the isolated compound.',
          'No toxicology or sensitisation data.',
          'No verified physical constants; the vaporization band here is an inference from compound class.',
          'Claims about turmeric oil, the turmerones, ar-curcumene or curcumin are not claims about gamma-curcumene.',
        ]),
        cites: Object.freeze(['compounddb', 'vankush2026']),
        contested: true,
        caveat: 'This section documents an absence of evidence, not a finding of inactivity or of safety. Treat gamma-curcumene as an uncharacterised major constituent of the material.',
      }),
      Object.freeze({
        h: 'Industry notes',
        body: 'For a formulator, H. odoratissimum oil is a material in which roughly a sixth of the volatile fraction is an uncharacterised sesquiterpene. Document that as a known-unknown. For a lab tech, the curcumene isomers are a classic identification hazard: several isomers with the same nominal mass and similar spectra, so library matching alone will not reliably distinguish gamma- from alpha-, beta- or ar-curcumene, and the assignment should be qualified on the report unless a standard was run. For a researcher, this is the same opening as faurinone and the same first steps: authentic standard, physical constants, verifiable structural identifier.',
        cites: Object.freeze(['vankush2026', 'compounddb']),
      }),
    ]),
    seeAlso: Object.freeze(['terpenes/overview', 'terpenes/faurinone', 'terpenes/alpha-pinene', 'terpenes/cineole', 'botanicals/helichrysum', 'coa/panels']),
    cites: Object.freeze(['compounddb', 'vankush2026', 'lourens2008']),
  }),

  // ------------------------------------------------------- vaporization-bands
  Object.freeze({
    slug: 'vaporization-bands',
    title: 'Vaporization Temperature Bands: An Industry Reference',
    kind: 'tool',
    summary: 'A band-by-band temperature reference from about 140 degrees Celsius to combustion, mapping bands to compound classes, with the caveats that make the numbers usable: set-point is not material temperature, device geometry matters, and terpene loss is progressive and sequential.',
    facts: Object.freeze({
      'Monoterpene band': '155 to 175 degrees Celsius (311 to 347 degrees Fahrenheit)',
      'Sesquiterpene band': '175 to 200 degrees Celsius (347 to 392 degrees Fahrenheit)',
      'Flavonoid band': '200 to 230 degrees Celsius (392 to 446 degrees Fahrenheit)',
      'Cannabinoid acid decarboxylation': 'proceeds appreciably from roughly 105 to 120 degrees Celsius upward and accelerates with temperature; effectively complete in the 130 to 160 degrees Celsius region on inhalation timescales',
      'THC and CBD boiling range': 'commonly cited at roughly 157 and 160 to 180 degrees Celsius respectively as reduced-pressure or extrapolated values — treat these figures with the same caution as the humulene case',
      'Combustion threshold': 'above roughly 230 degrees Celsius you are approaching pyrolysis and combustion regardless of the dial reading',
      'Scoparone (Artemisia capillaris)': 'about 200 degrees Celsius',
      'L-DOPA (Mucuna pruriens)': 'degrades above 200 degrees Celsius — Mucuna is a poor vaporization candidate',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'The band table',
        body: 'The bands below are the practical working reference: the temperature region in which a compound class is observed to come off plant material in a dry-herb vaporizer. They are NOT neat-compound boiling points. A compound present as a dilute component of a plant matrix evaporates at its partial pressure, well below its pure boiling point, which is why the monoterpene band starts near 155 degrees Celsius while several monoterpenes boil above 170. The operator bands come from the Temple Pharmacopoeia and are consistent with the vaporizer validation literature.',
        table: Object.freeze({
          cols: Object.freeze(['Band', 'Celsius', 'Fahrenheit', 'What comes off', 'Notes and sources']),
          rows: Object.freeze([
            Object.freeze(['Warm-up and acid decarboxylation', '105 to 155', '221 to 311', 'water, the most volatile monoterpenes, and progressive decarboxylation of cannabinoid acids to neutral cannabinoids', 'decarboxylation is time-and-temperature dependent, not a threshold; see coa/total-thc-math for the arithmetic']),
            Object.freeze(['Monoterpene band', '155 to 175', '311 to 347', 'alpha-pinene, myrcene, ocimene, limonene, 1,8-cineole', 'operator Temple Pharmacopoeia 2026; alpha-pinene leads, being the lowest-boiling']),
            Object.freeze(['Upper monoterpenoid band', '175 to 190', '347 to 374', 'linalool and other higher-boiling monoterpene alcohols', 'overlaps the bottom of the sesquiterpene band']),
            Object.freeze(['Sesquiterpene band', '175 to 200', '347 to 392', 'beta-caryophyllene, alpha-humulene, curcumenes, sesquiterpenoid ketones', 'operator Temple Pharmacopoeia 2026; this is the CB2-active band, since beta-caryophyllene is here']),
            Object.freeze(['Flavonoid band', '200 to 230', '392 to 446', 'flavonoids and other less volatile phenolics', 'operator Temple Pharmacopoeia 2026; also the band where thermal degradation of heat-labile constituents becomes significant']),
            Object.freeze(['Approaching combustion', 'above 230', 'above 446', 'pyrolysis products: benzene, polycyclic aromatic hydrocarbons, carbon monoxide, tars', 'Moir 2008 for the smoke toxicant profile; Gieringer 2004 for the vaporization contrast']),
          ]),
        }),
        cites: Object.freeze(['vankush2026', 'lanz2016', 'gieringer2004', 'moir2008', 'compounddb']),
        contested: true,
        caveat: 'Band edges are conventional and approximate, and they overlap. Different sources give edges several degrees apart. Use them to reason about sequence and about what you are losing, not as precise thresholds.',
      }),
      Object.freeze({
        h: 'Specific compounds from the operator inventory',
        body: 'The operator\'s Temple Pharmacopoeia includes two non-cannabis compounds with directly practical thermal behaviour, and both are worth putting on an industry page because they are the kind of detail that decides whether a blend makes sense at all.',
        table: Object.freeze({
          cols: Object.freeze(['Compound', 'Temperature', 'Botanical', 'Consequence']),
          rows: Object.freeze([
            Object.freeze(['Scoparone (6,7-dimethoxycoumarin)', 'about 200 degrees Celsius', 'Artemisia capillaris (Yin Chen Hao, Yerba Lena Yesca)', 'volatilises at the top of the sesquiterpene band, so Artemisia material releases it usefully in a dry-herb device']),
            Object.freeze(['L-DOPA', 'degrades above 200 degrees Celsius', 'Mucuna pruriens', 'Mucuna is a POOR vaporization candidate. L-DOPA is a water-soluble amino acid that degrades rather than volatilises; heating it destroys it']),
            Object.freeze(['1,8-cineole and alpha-pinene', 'monoterpene band, 155 to 175 degrees Celsius', 'Imphepho (Helichrysum spp.), rosemary, Artemisia', 'the reason Imphepho is described as a good low-temperature dry-herb candidate']),
            Object.freeze(['beta-caryophyllene', 'sesquiterpene band, 175 to 200 degrees Celsius', 'Imphepho (H. cymosum), black pepper, cloves, copaiba, cannabis', 'a CB2 agonist requires the higher band; a session run only in the monoterpene band leaves it in the bowl']),
          ]),
        }),
        cites: Object.freeze(['vankush2026', 'gertsch2008']),
        contested: true,
        caveat: 'The scoparone and L-DOPA figures are from the operator document without a primary thermal-analysis citation. The L-DOPA degradation direction is well established and consistent with the compound class; treat the 200 degrees Celsius figure as approximate.',
      }),
      Object.freeze({
        h: 'Caveat 1: the dial is not the material',
        body: 'A vaporizer set-point is a target for a heater or a heated air stream, not a measurement of the plant material. Actual material temperature depends on the sensor location, the control loop, the thermal mass of the oven, the packing density of the load, the draw rate and the ambient temperature, and it is routinely tens of degrees away from the displayed number — in either direction, and it changes during a session. Lanz and colleagues validated vaporizers in vitro and found substantial device-to-device differences in delivered cannabinoid quantity at nominally comparable settings, which is the same phenomenon viewed from the output end. The practical consequence: a set-point number is meaningful as a repeatable control on one specific device, and is nearly meaningless transferred between devices. Never treat a temperature recommendation from one device as a specification for another, and never treat a set-point as an analytical parameter.',
        cites: Object.freeze(['lanz2016']),
        evidence: 'in vitro',
      }),
      Object.freeze({
        h: 'Caveat 2: conduction and convection devices are not interchangeable',
        body: 'In a conduction device the material sits against a hot surface and heat moves inward by contact, so the load has a steep internal gradient: the material touching the wall can be well above the set-point and scorching while the centre is below it and barely volatilising. In a convection device heat arrives with the drawn air, so the temperature the material sees is tied to airflow — a slow draw delivers less heat than a fast one, and the effective temperature is a function of how the user inhales. Hybrid devices split the difference. The same numeric set-point therefore produces genuinely different chemistry in the three architectures, and this is a large part of why user temperature recommendations do not transfer. For anyone writing a product instruction or a study method, the device architecture and the draw protocol are part of the specification, not incidental details.',
        cites: Object.freeze(['lanz2016', 'gieringer2004']),
        contested: true,
        caveat: 'The conduction and convection contrast is a heat-transfer argument supported by the device-variability findings in the validation literature rather than by a dedicated head-to-head chemical study cited here.',
      }),
      Object.freeze({
        h: 'Caveat 3: the first draw and the last draw are different products',
        body: 'Terpene loss during a session is progressive and sequential, not uniform. The lowest-boiling compounds leave first and are depleted from the load before the higher-boiling ones have begun to come off in quantity. So the first draw of a session is monoterpene-rich and cannabinoid-poorer; the last draw is cannabinoid-and-sesquiterpene-weighted and has almost no monoterpene left, because the alpha-pinene and myrcene are already gone. Two consequences follow. First, aroma and effect drift within a session by chemistry, not by imagination, and a user who reports that a device is harsh or flat at the end of a bowl is reporting something real. Second, a study or a product claim that reports a single composition for "the vapour" has averaged over a changing mixture and has lost the information that matters. If a protocol matters, fractionate: collect and analyse draws separately. The same logic explains why stepping a session up through the bands — starting in the monoterpene band and finishing in the sesquiterpene band — recovers more of the total volatile profile than running a single high set-point, which destroys the monoterpenes on the way.',
        cites: Object.freeze(['lanz2016', 'gieringer2004', 'compounddb']),
        contested: true,
        caveat: 'The sequential-depletion account follows from differing volatilities and is consistent with the vaporizer validation literature, but this shelf does not cite a dedicated per-draw compositional study. Treat the direction as sound and the magnitude as unquantified.',
      }),
      Object.freeze({
        h: 'Caveat 4: above roughly 230 degrees Celsius you are burning it',
        body: 'The upper bound on this table is not a preference, it is a chemistry change. Above roughly 230 degrees Celsius plant material moves from volatilisation into pyrolysis, and pyrolysis generates compounds that were not present in the material at all: benzene, polycyclic aromatic hydrocarbons, carbon monoxide, and tars. Moir and colleagues characterised mainstream and sidestream smoke from cannabis and tobacco cigarettes under machine smoking conditions and documented this toxicant profile. Gieringer, St. Laurent and Goodrich reported the contrast from the other direction: a vaporizer delivered cannabinoids while suppressing the pyrolytic compounds. The point for this shelf is that the toxicant question is governed by temperature and not by the label on the device — a vaporizer run hot enough is producing combustion products, and a dial that reads 210 degrees Celsius on a device whose hot spots run 60 degrees above set-point is producing them too. This is also the reason the operator document\'s observation about Imphepho smoke matters: research found that smoke condensates from burning the plant contain different compounds than solvent extracts of it, because combustion creates new chemistry. Vaporization within the bands is an attempt to avoid creating that chemistry; exceeding them abandons the attempt.',
        cites: Object.freeze(['moir2008', 'gieringer2004', 'vankush2026', 'lourens2008']),
        evidence: 'in vitro',
      }),
      Object.freeze({
        h: 'Caveat 5: decarboxylation is a rate, not a switch',
        body: 'Cannabinoid acids lose carbon dioxide to give the neutral cannabinoids, and this is the single most consequential reaction in the warm-up phase of any vaporization session. It is kinetics, not a threshold: the rate rises steeply with temperature, so decarboxylation proceeds slowly at low temperature over long times and fast at high temperature over short times, and any statement of the form "decarboxylation happens at X degrees" has omitted the time axis. Two practical consequences. First, on inhalation timescales the conversion is substantially complete within the warm-up and lower monoterpene bands, which is why inhaled cannabis delivers neutral cannabinoids from acidic starting material. Second, the conversion is never quantitative and some product is lost onward to cannabinol by oxidation, which is exactly why the total-THC arithmetic on the COA shelf is a theoretical ceiling rather than a prediction of delivered dose. The boiling points commonly quoted for THC and CBD themselves — around 157 degrees Celsius for THC is the usual figure — deserve the same scepticism this shelf applied to humulene: they are reduced-pressure or extrapolated values that circulate as though they were atmospheric boiling points, and a vaporizer does not need to reach a cannabinoid\'s boiling point to volatilise it from a matrix.',
        cites: Object.freeze(['gieringer2004', 'lanz2016', 'compounddb']),
        contested: true,
        caveat: 'The commonly cited THC boiling point near 157 degrees Celsius is not a well-founded atmospheric value and should not be used as a device set-point rationale. Decarboxylation kinetics vary with matrix, moisture and heating profile; no single temperature figure describes it.',
      }),
      Object.freeze({
        h: 'How to use this page',
        body: 'For a formulator choosing between a vaporizable botanical and a liquid or oral format, read the band table against what you actually want delivered: if the active is a monoterpene or a sesquiterpene, a dry-herb route is viable; if it is a water-soluble amino acid like L-DOPA, it is not, and the Mucuna row is the worked example. For a lab tech designing a delivered-dose experiment, the four caveats above are the method section: specify the device architecture, the set-point, the load mass and packing, the draw protocol, and whether draws were pooled or fractionated, because without those the number is not reproducible. For a buyer or a retail educator, the honest short version is: lower bands preserve aroma compounds and deliver less per draw; higher bands deliver more and destroy the light terpenes; above roughly 230 degrees Celsius the device is a combustion device whatever it says on the box.',
        cites: Object.freeze(['vankush2026', 'lanz2016', 'moir2008']),
      }),
    ]),
    seeAlso: Object.freeze([
      'terpenes/overview', 'terpenes/alpha-pinene', 'terpenes/beta-caryophyllene', 'terpenes/myrcene',
      'botanicals/helichrysum', 'botanicals/artemisia-capillaris', 'botanicals/mucuna',
      'cannabinoids/decarboxylation', 'coa/total-thc-math', 'safety/toxidrome',
    ]),
    cites: Object.freeze(['vankush2026', 'lanz2016', 'gieringer2004', 'moir2008', 'compounddb', 'gertsch2008', 'lourens2008']),
  }),

]);

export default { SHELF, CITES, PAGES };
