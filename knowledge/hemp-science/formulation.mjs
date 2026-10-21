// formulation.mjs — the Formulation and Dosing Safety shelf: how a compound already in hand gets
// distributed, diluted, weighed and dosed without killing the person who takes it.
//
// WHAT THIS SHELF IS. Six pages on the step that sits between having a potent compound and consuming
// it: hot spots (uneven distribution across a carrier), dose arithmetic (mass fraction, volumetric
// dosing, and what a scale can and cannot actually weigh), homogeneity (why even mixing is a safety
// property and how producers verify it), residual solvent (why the distributing or extracting solvent
// has to come out, and what the limits are), titration (the pharmacokinetic reasons start-low-go-slow
// is a protocol rather than a platitude), and adulterants (what has actually been found on and in
// products, with the documented outbreaks).
//
// WHY IT EXISTS. The synthetic-cannabinoid era is usually narrated as a chemistry problem. It was not.
// The compounds came out of published academic pharmacology, were manufactured in bulk elsewhere, and
// arrived at distributors as powder. The distributors sprayed that powder, in solvent, onto inert plant
// material with hand sprayers — with no balance capable of the task, no dose-per-gram calculation and
// no way to check whether the result was even. Uneven distribution meant that one portion of a batch
// could carry many times the dose of another portion of the same batch, so a person who dosed safely
// yesterday could take a massive dose today out of the same bag. Downstream of that were people
// improvising with household chemicals because nothing better was available and nobody would tell them
// anything. Every one of those failures is a FORMULATION and DOSING failure on an already-obtained
// compound. That is the gap this shelf closes, because withholding this material is what got people
// hurt.
//
// WHERE THE MATERIAL COMES FROM. The clinical and forensic literature on synthetic-cannabinoid product
// composition and variability (Auwärter 2009, Dresen 2010, Frinculescu 2016, Luzio 2019, Adams 2017);
// the outbreak literature (brodifacoum: Kelkar 2018, Hussain 2018; EVALI: Blount 2020, Wu 2020);
// cannabinoid pharmacokinetics (Huestis 2007, Lucas 2018, Monte 2019); product label-accuracy surveys
// (Vandrey 2015, Bonn-Miller 2017, Johnson 2022, Meehan-Atrash 2022); and the pharmaceutical
// compendial framework for the things this page is about — residual solvents (USP <467>, ICH Q3C),
// dose uniformity (USP <905>), and weighing (USP <1176>, USP <1251>), plus the low-dose content-
// uniformity theory that explains why particle size and blending control variance (Johnson 2008).
//
// WHAT THIS SHELF DELIBERATELY DOES NOT CONTAIN. No preparative or synthetic procedures of any kind:
// no reagents, catalysts, equivalents, molar concentrations, reaction temperatures, times, work-ups or
// yields for making any cannabinoid or any other compound, no precursor sourcing, and no step-by-step
// for isomerisation, homologation or acetylation. It also contains no dosing recommendations for any
// specific substance and no individualised medical advice. It describes arithmetic, measurement,
// mixing, pharmacokinetics and documented failure modes — the handling of a compound someone already
// has, which is a different subject from making one.

const F = Object.freeze;

export const SHELF = F({
  id: 'formulation',
  title: 'Formulation and Dosing Safety',
  blurb: 'Hot spots, dose arithmetic, homogeneity, residual solvent, titration and adulterants: the handling steps between an obtained compound and a dose, and the documented ways each one has killed people.',
  updated: '2026-09-27',
});

/**
 * CITES — this shelf's bibliography.
 *
 * verified: 'crossref'  DOI resolved against the Crossref REST API on 2026-09-27 and the returned
 *                       title, author list, year and journal recorded from that response.
 * verified: 'standard'  a standard or compendial chapter; its designation is the identifier, not a DOI.
 * verified: false       bibliographic details recorded from the literature, identifier NOT resolved in
 *                       this pass. Render with an unverified marker. Never guess an identifier.
 */
export const CITES = F({
  // ── product composition and variability ─────────────────────────────────────────────────────────
  auwarter2009: { authors: 'Auwärter V, Dresen S, Weinmann W, Müller M, Pütz M, Ferreirós N', year: 2009, title: "'Spice' and other herbal blends: harmless incense or cannabinoid designer drugs?", journal: 'Journal of Mass Spectrometry', doi: '10.1002/jms.1558', verified: 'crossref' },
  dresen2010: { authors: 'Dresen S, Ferreirós N, Pütz M, Westphal F, Zimmermann R, Auwärter V', year: 2010, title: 'Monitoring of herbal mixtures potentially containing synthetic cannabinoids as psychoactive compounds', journal: 'Journal of Mass Spectrometry', doi: '10.1002/jms.1811', verified: 'crossref' },
  frinculescu2016: { authors: 'Frinculescu A, Lyall CL, Ramsey J, Miserez B', year: 2016, title: 'Variation in commercial smoking mixtures containing third-generation synthetic cannabinoids', journal: 'Drug Testing and Analysis', doi: '10.1002/dta.1975', verified: 'crossref' },
  luzio2019: { authors: 'Luzio A, Couceiro J, Ferreira C, Quintas A', year: 2019, title: "Assessing the content of a synthetic cannabinoid 'research chemical' package", journal: 'Annals of Medicine', doi: '10.1080/07853890.2018.1562026', verified: 'crossref' },
  adams2017: { authors: 'Adams AJ, Banister SD, Irizarry L, Trecki J, Schwartz M, Gerona R', year: 2017, title: "'Zombie' Outbreak Caused by the Synthetic Cannabinoid AMB-FUBINACA in New York", journal: 'New England Journal of Medicine', doi: '10.1056/NEJMoa1610300', verified: 'crossref' },
  banister2018: { authors: 'Banister SD, Connor M', year: 2018, title: 'The Chemistry and Pharmacology of Synthetic Cannabinoid Receptor Agonist New Psychoactive Substances: Evolution', journal: 'Handbook of Experimental Pharmacology', doi: '10.1007/164_2018_144', verified: 'crossref' },
  huffman2005: { authors: 'Huffman JW, Zengin G, Wu MJ, Lu J, Hynd G, Bushell K, et al.', year: 2005, title: 'Structure-activity relationships for 1-alkyl-3-(1-naphthoyl)indoles at the cannabinoid CB1 and CB2 receptors: steric and electronic effects of naphthoyl substituents. New highly selective CB2 receptor agonists', journal: 'Bioorganic & Medicinal Chemistry', doi: '10.1016/j.bmc.2004.09.050', verified: 'crossref' },
  showalter1996: { authors: 'Showalter VM, Compton DR, Martin BR, Abood ME', year: 1996, title: 'Evaluation of binding in a transfected cell line expressing a peripheral cannabinoid receptor (CB2): identification of cannabinoid receptor subtype selective ligands', journal: 'The Journal of Pharmacology and Experimental Therapeutics', doi: '10.1016/s0022-3565(25)20744-3', verified: 'crossref' },

  // ── clinical toxicity and outbreaks ─────────────────────────────────────────────────────────────
  trecki2015: { authors: 'Trecki J, Gerona RR, Schwartz MD', year: 2015, title: 'Synthetic Cannabinoid-Related Illnesses and Deaths', journal: 'New England Journal of Medicine', doi: '10.1056/nejmp1505328', verified: 'crossref' },
  castaneto2014: { authors: 'Castaneto MS, Gorelick DA, Desrosiers NA, Hartman RL, Pirard S, Huestis MA', year: 2014, title: 'Synthetic cannabinoids: Epidemiology, pharmacodynamics, and clinical implications', journal: 'Drug and Alcohol Dependence', doi: '10.1016/j.drugalcdep.2014.08.005', verified: 'crossref' },
  castaneto2015: { authors: 'Castaneto MS, Wohlfarth A, Desrosiers NA, Hartman RL, Gorelick DA, Huestis MA', year: 2015, title: 'Synthetic cannabinoids pharmacokinetics and detection methods in biological matrices', journal: 'Drug Metabolism Reviews', doi: '10.3109/03602532.2015.1029635', verified: 'crossref' },
  hermannsclausen2013: { authors: 'Hermanns-Clausen M, Kneisel S, Szabo B, Auwärter V', year: 2013, title: 'Acute toxicity due to the confirmed consumption of synthetic cannabinoids: clinical and laboratory findings', journal: 'Addiction', doi: '10.1111/j.1360-0443.2012.04078.x', verified: 'crossref' },
  thornton2013: { authors: 'Thornton SL, Wood C, Friesen MW, Gerona RR', year: 2013, title: 'Synthetic cannabinoid use associated with acute kidney injury', journal: 'Clinical Toxicology', doi: '10.3109/15563650.2013.770870', verified: 'crossref' },
  kelkar2018: { authors: 'Kelkar AH, Smith NA, Martial A, Moole H, Tarantino MD, Roberts JC', year: 2018, title: 'An Outbreak of Synthetic Cannabinoid-Associated Coagulopathy in Illinois', journal: 'New England Journal of Medicine', doi: '10.1056/NEJMoa1807652', verified: 'crossref' },
  hussain2018: { authors: 'Hussain N, Hussain F, Haque D, Saeed S, Jesudas R', year: 2018, title: 'An Outbreak of Brodifacoum Coagulopathy Due to Synthetic Marijuana in Central Illinois', journal: 'Mayo Clinic Proceedings', doi: '10.1016/j.mayocp.2018.05.005', verified: 'crossref' },
  mmwrBrodifacoum2018: { authors: 'Moritz E, Austin C, Wahl M, DesLauriers C, Navon L, Walblay K, et al.', year: 2018, title: 'Notes from the Field: Outbreak of Severe Illness Linked to the Vitamin K Antagonist Brodifacoum and Use of Synthetic Cannabinoids — Illinois, March–April 2018', journal: 'MMWR (Morbidity and Mortality Weekly Report) 67:607-608', doi: '10.15585/mmwr.mm6721a4', verified: 'crossref' },
  blount2020: { authors: 'Blount BC, Karwowski MP, Shields PG, Morel-Espinosa M, Valentin-Blasini L, Gardner M, et al.', year: 2020, title: 'Vitamin E Acetate in Bronchoalveolar-Lavage Fluid Associated with EVALI', journal: 'New England Journal of Medicine', doi: '10.1056/NEJMoa1916433', verified: 'crossref' },
  wu2020: { authors: "Wu D, O'Shea DF", year: 2020, title: 'Potential for release of pulmonary toxic ketene from vaping pyrolysis of vitamin E acetate', journal: 'Proceedings of the National Academy of Sciences', doi: '10.1073/pnas.1920925117', verified: 'crossref' },
  cdcEvali2020: { authors: 'US Centers for Disease Control and Prevention', year: 2020, title: 'Outbreak of Lung Injury Associated with the Use of E-Cigarette, or Vaping, Products (final case counts as of 18 February 2020)', journal: 'CDC Office on Smoking and Health', verified: false },
  krishnasamy2020: { authors: 'Krishnasamy VP, Hallowell BD, Ko JY, Board A, Hartnett KP, Salvatore PP, et al.', year: 2020, title: 'Update: Characteristics of a Nationwide Outbreak of E-cigarette, or Vaping, Product Use-Associated Lung Injury — United States, August 2019–January 2020', journal: 'MMWR (Morbidity and Mortality Weekly Report) 69:90-94', doi: '10.15585/mmwr.mm6903e2', verified: 'crossref' },
  monte2019: { authors: 'Monte AA, Shelton SK, Mills E, Saben J, Hopkinson A, Sonn B, et al.', year: 2019, title: 'Acute Illness Associated With Cannabis Use, by Route of Exposure', journal: 'Annals of Internal Medicine', doi: '10.7326/m18-2809', verified: 'crossref' },

  // ── pharmacokinetics ───────────────────────────────────────────────────────────────────────────
  huestis2007: { authors: 'Huestis MA', year: 2007, title: 'Human Cannabinoid Pharmacokinetics', journal: 'Chemistry & Biodiversity', doi: '10.1002/cbdv.200790152', verified: 'crossref' },
  lucas2018: { authors: 'Lucas CJ, Galettis P, Schneider J', year: 2018, title: 'The pharmacokinetics and the pharmacodynamics of cannabinoids', journal: 'British Journal of Clinical Pharmacology', doi: '10.1111/bcp.13710', verified: 'crossref' },

  // ── contaminants, diluents and hardware ────────────────────────────────────────────────────────
  sullivan2013: { authors: 'Sullivan N, Elzinga S, Raber JC', year: 2013, title: 'Determination of Pesticide Residues in Cannabis Smoke', journal: 'Journal of Toxicology', doi: '10.1155/2013/378168', verified: 'crossref' },
  olmedo2018: { authors: 'Olmedo P, Goessler W, Tanda S, Grau-Perez M, Jarmul S, Aherrera A, et al.', year: 2018, title: 'Metal Concentrations in e-Cigarette Liquid and Aerosol Samples: The Contribution of Metallic Coils', journal: 'Environmental Health Perspectives', doi: '10.1289/ehp2175', verified: 'crossref' },
  meehanatrash2021: { authors: 'Meehan-Atrash J, Rahman I', year: 2021, title: 'Cannabis Vaping: Existing and Emerging Modalities, Chemistry, and Pulmonary Toxicology', journal: 'Chemical Research in Toxicology', doi: '10.1021/acs.chemrestox.1c00290', verified: 'crossref' },
  meehanatrash2022: { authors: 'Meehan-Atrash J, Rahman I', year: 2022, title: 'Novel Δ8-Tetrahydrocannabinol Vaporizers Contain Unlabeled Adulterants, Unintended Byproducts of Chemical Synthesis, and Heavy Metals', journal: 'Chemical Research in Toxicology', doi: '10.1021/acs.chemrestox.1c00388', verified: 'crossref' },
  meehanatrash2017: { authors: 'Meehan-Atrash J, Luo W, Strongin RM', year: 2017, title: 'Toxicant Formation in Dabbing: The Terpene Story', journal: 'ACS Omega', doi: '10.1021/acsomega.7b01130', verified: 'crossref' },
  lin2026: { authors: 'Lin K, Sun Y, Raghu R, Suharu P, Effah F, Rahman I', year: 2026, title: 'Toxicity and health effects of delta-8, delta-9, and delta-10-tetrahydrocannabinol and unregulated cannabinoids in vaping products', journal: 'Toxicology Reports', doi: '10.1016/j.toxrep.2026.102202', verified: 'crossref' },

  // ── label accuracy and dose uniformity ─────────────────────────────────────────────────────────
  vandrey2015: { authors: 'Vandrey R, Raber JC, Raber ME, Douglass B, Miller C, Bonn-Miller MO', year: 2015, title: 'Cannabinoid Dose and Label Accuracy in Edible Medical Cannabis Products', journal: 'JAMA', doi: '10.1001/jama.2015.6613', verified: 'crossref' },
  bonnmiller2017: { authors: 'Bonn-Miller MO, Loflin MJE, Thomas BF, Marcu JP, Hyke T, Vandrey R', year: 2017, title: 'Labeling Accuracy of Cannabidiol Extracts Sold Online', journal: 'JAMA', doi: '10.1001/jama.2017.11909', verified: 'crossref' },
  johnson2022: { authors: 'Johnson E, Kilgore M, Babalonis S', year: 2022, title: 'Label accuracy of unregulated cannabidiol (CBD) products: measured concentration vs. label claim', journal: 'Journal of Cannabis Research', doi: '10.1186/s42238-022-00140-1', verified: 'crossref' },
  johnsonarbor2023: { authors: 'Johnson-Arbor K', year: 2023, title: 'Regional Cannabis Edible Variability in the United States (letter)', journal: 'Cannabis and Cannabinoid Research', doi: '10.1089/can.2022.0302', verified: 'crossref' },
  johnson2008: { authors: 'Johnson KC', year: 2008, title: 'Particle Size of Drug Substance and Product Content Uniformity — Theoretical Considerations', journal: 'Formulation and Analytical Development for Low-Dose Oral Drug Products (Wiley)', doi: '10.1002/9780470386361.ch3', verified: 'crossref' },

  // ── compendial and standards material ──────────────────────────────────────────────────────────
  usp467: { authors: 'United States Pharmacopeia', year: 2023, title: 'General Chapter <467> Residual Solvents', journal: 'USP-NF', verified: 'standard' },
  ichq3c: { authors: 'International Council for Harmonisation', year: 2021, title: 'ICH Q3C(R8) Impurities: Guideline for Residual Solvents', journal: 'ICH Harmonised Guideline', verified: 'standard' },
  usp905: { authors: 'United States Pharmacopeia', year: 2023, title: 'General Chapter <905> Uniformity of Dosage Units', journal: 'USP-NF', verified: 'standard' },
  usp1176: { authors: 'United States Pharmacopeia', year: 2023, title: 'General Chapter <1176> Prescription Balances and Volumetric Apparatus', journal: 'USP-NF', verified: 'standard' },
  usp1251: { authors: 'United States Pharmacopeia', year: 2023, title: 'General Chapter <1251> Weighing on an Analytical Balance', journal: 'USP-NF', verified: 'standard' },
  iso17025: { authors: 'International Organization for Standardization / International Electrotechnical Commission', year: 2017, title: 'ISO/IEC 17025:2017 General requirements for the competence of testing and calibration laboratories', journal: 'ISO', verified: 'standard' },
  emcdda2021: { authors: 'European Monitoring Centre for Drugs and Drug Addiction', year: 2021, title: 'Synthetic cannabinoids in Europe — a review (EU Early Warning System)', journal: 'EMCDDA, Lisbon', verified: false },
});

/**
 * PAGES — each becomes one wiki page at /science/formulation/<slug>.
 */
export const PAGES = F([

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'hot-spots',
    title: 'Hot Spots: Why Uneven Distribution Kills',
    kind: 'safety',
    summary: 'A potent compound spread unevenly across a carrier produces lethal variance inside a single batch: one portion carries several times the dose of another, the difference is invisible, and the user\'s own prior safe experience with the same material is actively misleading. This is the mechanism that did most of the killing in the synthetic-cannabinoid era, and the arithmetic behind it applies to any potent cannabinoid or novel compound today.',
    facts: F({
      'The failure mode': 'uneven distribution of a potent active across a carrier, so portions of one batch differ severalfold in delivered dose',
      'Why it is dangerous': 'a full agonist has no ceiling effect, and the margin between an active dose and a harmful dose can be a single-digit multiple',
      'Why it is invisible': 'at a few milligrams of active per gram of carrier there is no colour, taste or smell cue, and the carrier looks identical throughout',
      'Why experience does not protect': 'a safe dose yesterday from the same bag is evidence about that portion, not about the batch',
      'Documented': 'severalfold variation measured between and within commercial smoking mixtures',
      'The control': 'dissolve, dilute and dose by volume; verify homogeneity by multi-point assay — never eyeball a potent compound',
    }),
    sections: F([
      F({
        h: 'What a hot spot is',
        body: 'A hot spot is a region of a batch where the active compound is present at a higher concentration than the batch average. It arises whenever a small mass of a potent substance has to be distributed across a much larger mass of carrier — plant material, an edible base, a powder blend, a vape diluent — and the distribution step does not actually achieve uniformity. Nothing about a hot spot is exotic. It is the default outcome of mixing a milligram-scale active into a kilogram-scale carrier by any method that is not deliberately engineered for uniformity, and it is the reason the pharmaceutical industry treats content uniformity as a release test rather than a matter of good intentions. The dangerous version of the problem has three ingredients together: a compound potent enough that a dose is measured in milligrams or fractions of a milligram, a distribution step incapable of evenness at that mass fraction, and a narrow gap between the dose that produces the intended effect and the dose that produces harm. Remove any one of the three and uneven mixing is a quality complaint. Put all three together and it is a mechanism of death, because the variance in the batch lands directly on top of a margin that was already thin.',
        cites: F(['johnson2008', 'frinculescu2016', 'usp905']),
        evidence: 'human',
      }),
      F({
        h: 'The arithmetic, worked',
        body: 'Take a concrete case and do the numbers. One gram of a potent compound — 1000 milligrams — is to be distributed across 500 grams of inert carrier. The nominal mass fraction is 1000 mg divided by 500 g, which is 2 milligrams of active per gram of carrier, or 0.2 percent by mass. If a portion is half a gram, that portion nominally contains 1 mg of active. Now suppose, as is the case for the potent full agonists, that 1 mg is around the active dose and that serious adverse effects are documented somewhere above roughly 5 mg. The nominal product is a one-dose-per-half-gram product with a fivefold margin, and on paper that looks survivable. The moment the distribution is uneven, that fivefold margin is spent by a threefold error. A 3x hot spot delivers 3 mg in the same half gram: three doses at once, still under the stated harm threshold but with the margin gone. A 10x hot spot delivers 10 mg: twice the harm threshold, from a portion that looks exactly like every other portion. A 30x hot spot delivers 30 mg, thirty doses in one sitting, and there is no ceiling effect at the receptor to blunt it. The cold spots matter too and are usually left out of the discussion: a 0.3x region delivers 0.3 mg, reads as weak or inert product, and invites the user to take more — which is precisely the behaviour that turns the next hot spot into a mass overdose. Note that the numbers above are a worked illustration with a stated premise, not a dosing statement about any real substance; the point is the structure of the arithmetic, which holds whatever the real figures are.',
        table: F({
          cols: F(['Local concentration', 'Active per gram of carrier', 'Dose in a 0.5 g portion', 'Relative to one nominal dose', 'Mass fraction']),
          rows: F([
            F(['Cold spot, 0.3x', '0.6 mg/g', '0.3 mg', '0.3x — reads as weak, invites re-dosing', '0.06 %']),
            F(['Nominal, perfectly even', '2 mg/g', '1 mg', '1x — the intended dose', '0.2 %']),
            F(['3x hot spot', '6 mg/g', '3 mg', '3x — the whole assumed margin, spent', '0.6 %']),
            F(['10x hot spot', '20 mg/g', '10 mg', '10x — twice the assumed harm threshold', '2 %']),
            F(['30x hot spot', '60 mg/g', '30 mg', '30x — a mass overdose from one bowl', '6 %']),
          ]),
        }),
        cites: F(['frinculescu2016', 'auwarter2009', 'dresen2010', 'adams2017']),
        contested: true,
        caveat: 'The 1 mg active dose and 5 mg harm threshold in this example are a stated premise chosen to make the arithmetic legible, not measured values for any named compound. For most synthetic cannabinoid receptor agonists no human dose-response data exist at all, which is itself the central hazard. The measured facts being illustrated are the mass-fraction arithmetic and the documented severalfold variation in real products.',
        evidence: 'human',
      }),
      F({
        h: 'Why the variance is invisible',
        body: 'Look again at the mass-fraction column. An evenly distributed batch at 2 mg/g is 0.2 percent active by mass; a tenfold hot spot is 2 percent. Two percent of a pale or colourless residue, spread over leaf material that is already brown and green and variegated, looks like nothing. There is no colour gradient to see, because the mass involved is too small to shift the appearance of the carrier. There is no reliable taste or smell cue either: most of these compounds are odourless at these loadings, and the carrier is typically chosen or flavoured in ways that dominate whatever is there. The user therefore has no sensory channel through which the difference between a nominal portion and a tenfold portion can present itself. Worse, the one piece of evidence the user does have is misleading in a specific and dangerous way. Prior safe use of the same bag feels like the strongest possible evidence of safety — it is personal, direct, and recent. It is also evidence about the portions already consumed and nothing else. If the batch is heterogeneous, each portion is an independent draw from a distribution whose spread the user cannot see and has never been told about. Confidence built from ten safe portions is exactly the confidence that produces a large, unhesitating dose from the eleventh.',
        bullets: F([
          'At a few mg per gram, a tenfold concentration difference is still a fraction of a percent by mass — below any visual threshold.',
          'There is no bitterness, pungency or aroma cue at these loadings; the carrier dominates.',
          'Powder and residue migrate, so the top and the bottom of a container are not the same material.',
          'Prior safe portions from the same package are evidence about those portions, not about the batch.',
          'A weak portion is read as weak product, and the natural response — take more — raises exposure on the next draw.',
        ]),
        cites: F(['frinculescu2016', 'luzio2019', 'auwarter2009']),
        evidence: 'human',
      }),
      F({
        h: 'Why hand spraying cannot distribute a potent compound evenly',
        body: 'The distribution method used across the synthetic-cannabinoid supply chain was a solution of the compound applied to plant material with a hand sprayer or a garden sprayer, sometimes in a cement mixer or a drum, sometimes in a bin with a shovel. It cannot work, for reasons that are mechanical rather than moral. Spray deposition is a statistical process: droplets land where they land, and the coefficient of variation of deposited mass per unit area at hand-sprayer droplet sizes and pass counts is large. The solvent then evaporates from the surface of the leaf faster than it wicks into and across the material, so the compound crystallises or dries approximately where the droplet landed instead of redistributing. Plant material is not a uniform substrate either: leaf, stem and fines have very different surface areas per gram, so even perfect spray coverage per unit area produces very different loadings per unit mass across the fractions. Then the batch is agitated, bagged and shipped, and dry particulate segregates by size and density during every one of those steps — fines and loose crystal fall through and accumulate at the bottom of a drum or a bag, which is why the last scoop out of a container is systematically different from the first. Finally, none of it is checked: a distributor spraying powder onto leaf typically has no analytical instrument, no reference standard for the compound, and no balance that can weigh the input mass accurately in the first place, so there is no measurement anywhere in the process that could reveal the variance. Analyses of seized commercial smoking mixtures bear this out, reporting substantial variation in active content between products sold under the same brand and within packages of the same product.',
        bullets: F([
          'Droplet landing is statistical; hand-applied spray has a large coefficient of variation in deposited mass.',
          'Surface evaporation outruns wicking, so the compound dries where the droplet hit rather than equilibrating.',
          'Leaf, stem and fines have different surface-area-to-mass ratios, so even coverage per area is uneven per gram.',
          'Dry particulate segregates by size and density during mixing, transport and packaging — top and bottom differ.',
          'No assay, no reference standard and no adequate balance means the variance is never measured, so it is never corrected.',
        ]),
        cites: F(['frinculescu2016', 'auwarter2009', 'dresen2010', 'johnson2008', 'emcdda2021']),
        evidence: 'human',
      }),
      F({
        h: 'What this looked like clinically',
        body: 'The clinical signature of a hot-spot batch is a cluster: several severe presentations arriving within hours of each other, in one area, from one product, while the same product has been circulating uneventfully. That pattern recurs throughout the synthetic-cannabinoid literature and is what poison centres and emergency departments learned to recognise. The best-documented single instance is the Brooklyn episode of July 2016, in which a group of people who had used the same packaged herbal product presented together with profound sedation, blank staring and slow mechanical movements; the product was found to contain AMB-FUBINACA, an indazole carboxamide far more potent than the earlier naphthoylindoles, at a high loading per gram of plant material, and the de-esterified metabolite was identified in serum. Case series from European clinical toxicology units through the same period describe the same shape of event: tachycardia, agitation, hallucinations, seizures and vomiting in patients who had used a product identical in appearance to material they or others had tolerated. Outbreak clusters, rather than a steady rate of individual harms, are the epidemiological fingerprint of variance inside a batch, because a uniform product produces harms in proportion to use while a heterogeneous product produces them in bursts wherever the hot material lands.',
        cites: F(['adams2017', 'hermannsclausen2013', 'trecki2015', 'castaneto2014', 'thornton2013', 'emcdda2021']),
        evidence: 'human',
      }),
      F({
        h: 'The general principle: homogeneity is a safety property',
        body: 'State it plainly, because it generalises past any single compound. The narrower the margin between an active dose and a harmful dose, the more homogeneity stops being a quality nicety and becomes a safety property of the product. For a substance with a wide margin, a threefold mixing error produces a stronger or weaker experience. For a substance with a narrow margin, the same threefold error produces a hospitalisation. Since the mixing error is a property of the process and the margin is a property of the pharmacology, the required precision of the process is set by the pharmacology and not by convenience. This is why the pharmaceutical world does not mix potent actives dry and hope: it dissolves them, doses by volume or by a validated granulation, controls particle size, blends geometrically, and then tests finished units individually against a uniformity specification. The practical corollary for anyone handling a potent compound they already have is short. Do not attempt to distribute a milligram-scale active by eye, by spray, or by stirring it into a large mass. Dissolve a weighed mass in a known volume, dose the solution by volume, and treat the solution as the unit of control. Volumetric handling converts the problem from one of achieving uniform dispersion of a solid — which is hard, invisible and unverifiable without instruments — into one of measuring a liquid, which is cheap, visible and repeatable with a syringe. Every other approach is a bet that the mixing was good enough, placed by someone who has no way to see whether it was.',
        bullets: F([
          'Required process precision is set by the active-to-harmful margin, not by what is convenient.',
          'A true solution has uniform concentration by definition; a dry blend has uniformity only to the extent it was engineered and verified.',
          'Volumetric dosing of a solution replaces an unverifiable mixing problem with a measurable liquid problem.',
          'If uniformity cannot be verified, the honest description of the product is unknown dose, not nominal dose.',
        ]),
        cites: F(['usp905', 'johnson2008', 'usp1251']),
        evidence: 'human',
      }),
      F({
        h: 'Why the same arithmetic applies today',
        body: 'The compounds have changed and the retail context has changed; the arithmetic has not. Any active whose dose is measured in single milligrams or below, distributed across a carrier by a process that is not verified, reproduces the identical failure mode. That covers a good deal of the current market. Converted and novel cannabinoid products are formulated by processors whose analytical capability varies from full in-house chromatography to none; some of the compounds being sold have no established human dose-response and no validated quantitative method, which means both the numerator and the denominator of the dose calculation are uncertain. Vape formulations concentrate an active into a small liquid volume where a mixing error is compounded by a device-dependent delivered fraction. Edibles are the classic case of a potent active in a large, structurally non-uniform matrix, and published surveys have repeatedly found label potency and assayed potency diverging in both directions, with regional variability in labelled unit strength on top of that. None of this requires an underground chemist to go wrong. It requires only a potent compound, an unverified mixing step and a narrow margin — the same three ingredients, in a legal supply chain.',
        cites: F(['meehanatrash2022', 'lin2026', 'vandrey2015', 'bonnmiller2017', 'johnson2022', 'johnsonarbor2023', 'banister2018']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['formulation/dose-arithmetic', 'formulation/homogeneity', 'formulation/titration', 'safety/k2-what-went-wrong', 'safety/toxidrome', 'coa/panels']),
    cites: F(['johnson2008', 'usp905', 'usp1251', 'frinculescu2016', 'auwarter2009', 'dresen2010', 'luzio2019', 'adams2017', 'hermannsclausen2013', 'trecki2015', 'castaneto2014', 'thornton2013', 'emcdda2021', 'meehanatrash2022', 'lin2026', 'vandrey2015', 'bonnmiller2017', 'johnson2022', 'johnsonarbor2023', 'banister2018']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'dose-arithmetic',
    title: 'Dose Arithmetic: Mass Fraction, Volumetric Dosing and What a Scale Can Actually Weigh',
    kind: 'tool',
    summary: 'The working page: how to compute active per gram and per serving for any carrier, how to do volumetric dosing by dissolving a weighed mass in a known volume, and the resolution, accuracy and linearity limits that decide whether a number off a balance means anything. A milligram-scale compound handled with a kitchen scale is not being dosed; it is being guessed at.',
    facts: F({
      'Mass fraction': 'total active mass ÷ total carrier mass',
      'Dose per serving': 'mass fraction × serving mass',
      'Solution concentration': 'mass dissolved ÷ final volume, e.g. 100 mg in 100 mL = 1 mg/mL',
      'Practical weighing floor': 'roughly 50-100× the balance readability if the number has to mean something',
      'Insulin syringe resolution': '1 unit = 0.01 mL, so at 1 mg/mL one unit delivers 10 µg',
      'The rule': 'if you cannot weigh it, dilute it and dose by volume',
    }),
    sections: F([
      F({
        h: 'Mass fraction: the one calculation everything else rests on',
        body: 'Every dose-per-unit question is the same two-step calculation. First, the mass fraction: divide the total mass of active by the total mass of the finished mixture. Second, the dose: multiply that mass fraction by the mass of one serving. Both steps require that the two masses are actually known, which is where most real errors live — not in the arithmetic, but in the confidence placed on the input numbers. The total active mass is known only to the accuracy of the balance that weighed it and the purity of the material, and purity is a number that comes from an assay, not from a supplier claim. The total mixture mass has to include everything: carrier, diluent, sugar, fat, the mass of the solvent only if it stays in the product. And the arithmetic assumes uniformity, which the mixing step has to earn — the mass-fraction calculation gives the batch average, and the batch average is the dose of a given serving only to the extent the batch is homogeneous. Compute the average first, then treat it as an upper bound on your knowledge rather than a property of the serving in your hand.',
        bullets: F([
          'Mass fraction = total active mass ÷ total finished mass. Express it as mg per gram, or as a percentage.',
          'Dose per serving = mass fraction × serving mass.',
          'Purity matters: 1.00 g of material assayed at 85 % active is 850 mg of active, not 1000 mg.',
          'The result is the batch mean. Without verified homogeneity it is not the dose of any particular unit.',
        ]),
        cites: F(['usp905', 'johnson2008']),
        evidence: 'human',
      }),
      F({
        h: 'Worked examples: plant material, edible base, tincture, vape base',
        body: 'Plant material. 2.0 g of active, assayed at 90 percent, gives 1800 mg of active, distributed over 800 g of carrier. Mass fraction: 1800 mg ÷ 800 g = 2.25 mg/g, which is 0.225 percent by mass. A 0.3 g portion nominally carries 0.3 × 2.25 = 0.675 mg. Edible base. 1.00 g of distillate assayed at 85 percent total cannabinoids gives 850 mg of active, which is taken up into a 500 g gummy mass poured into 100 pieces of 5 g each. Mass fraction: 850 mg ÷ 500 g = 1.7 mg/g; dose per piece: 5 g × 1.7 mg/g = 8.5 mg. Check the arithmetic the other way around, which catches most errors: 100 pieces × 8.5 mg = 850 mg, the mass you started with. Tincture. 1000 mg of active brought to a final volume of 100 mL gives 10 mg/mL. A 1 mL dropper delivers 10 mg; 0.5 mL delivers 5 mg. Do not convert that into drops: drop volume varies by 30 percent or more with dropper tip geometry, viscosity, temperature and how the bulb is squeezed, so a drop is not a unit of volume and a dropper marked only in drops is an unmeasured dose. Vape base. 1.00 g of active at 90 percent, that is 900 mg, brought to 4.0 g total with 3.0 g of diluent, gives 900 mg ÷ 4.0 g = 225 mg/g, or 22.5 percent by mass. A 1 mL cartridge holding about 1.05 g of that liquid contains roughly 236 mg. What it does not tell you is the delivered dose per draw, because the fraction of liquid that is aerosolised and inhaled depends on the coil, the power, the draw duration and the user, and none of those are on the label. Per-cartridge and per-gram figures can be computed honestly; per-puff delivered dose cannot be computed from a formulation sheet.',
        table: F({
          cols: F(['Carrier', 'Active in', 'Finished mass or volume', 'Mass fraction / concentration', 'Dose per serving']),
          rows: F([
            F(['Plant material', '1800 mg (2.0 g at 90 %)', '800 g', '2.25 mg/g (0.225 %)', '0.675 mg per 0.3 g portion']),
            F(['Gummy base', '850 mg (1.0 g at 85 %)', '500 g in 100 pieces', '1.7 mg/g', '8.5 mg per 5 g piece']),
            F(['Tincture', '1000 mg', '100 mL final volume', '10 mg/mL', '5 mg per 0.5 mL — measured, not counted in drops']),
            F(['Vape liquid', '900 mg (1.0 g at 90 %)', '4.0 g total', '225 mg/g (22.5 %)', '≈236 mg per 1 mL cartridge; per-puff not computable']),
          ]),
        }),
        cites: F(['vandrey2015', 'meehanatrash2021', 'huestis2007']),
        evidence: 'human',
      }),
      F({
        h: 'Volumetric dosing: the only reliable method at the milligram scale',
        body: 'Volumetric dosing means dissolving a weighed mass of the compound in a known final volume of a suitable diluent, then dosing the resulting solution by volume. It is the standard approach in pharmacy compounding and in every analytical laboratory, for one reason: at the milligram and sub-milligram scale, liquid volume can be measured accurately with cheap equipment while solid mass cannot. A 1 mL syringe graduated in hundredths of a millilitre costs almost nothing and is repeatable; a balance that can honestly weigh 5 mg costs orders of magnitude more, needs calibration masses, a draught shield and a stable bench, and is still the weakest link in the chain. Volumetric handling also solves the homogeneity problem at the same time, because a true solution has the same concentration everywhere in it by definition. Worked dilution. Weigh 100 mg of compound — a mass large enough that a modest balance can handle it, which is the whole point — and bring it to a final volume of 100 mL in a diluent in which it fully dissolves at that concentration. The concentration is 100 mg ÷ 100 mL = 1 mg/mL, or 1000 µg/mL. Then 1.0 mL delivers 1 mg, 0.5 mL delivers 500 µg, and 0.1 mL delivers 100 µg. In an insulin syringe, where 100 units correspond to 1 mL, one unit is 0.01 mL and therefore 10 µg, which gives usable resolution two orders of magnitude below anything a consumer balance can resolve. Serial dilution for lower still. Take 1.0 mL of the 1 mg/mL stock — containing 1 mg — and bring it to 10 mL: the new concentration is 0.1 mg/mL, that is 100 µg/mL, and one insulin-syringe unit now delivers 1 µg. Each tenfold step costs one transfer and multiplies your resolution by ten. Two constraints are non-negotiable. The compound has to be genuinely soluble in the diluent at the stock concentration, because exceeding solubility silently produces a suspension that separates and hands back the same non-uniformity you were trying to escape. And the diluent has to be acceptable by the intended route: a solvent that is fine for a laboratory stock solution is not automatically fine to swallow, and one that is tolerable to swallow may be unacceptable to inhale. Those are separate judgements, and the residual-solvent page covers the second.',
        bullets: F([
          'Weigh a mass your balance can actually handle, then dilute down to the dose — never try to weigh the dose.',
          '100 mg into 100 mL = 1 mg/mL. 1 mL = 1 mg; 0.1 mL = 100 µg; one insulin-syringe unit (0.01 mL) = 10 µg.',
          'Serial dilution: 1 mL of stock into 10 mL final = one tenfold step. Two steps takes 1 mg/mL to 10 µg/mL.',
          'Label every container with compound, concentration and date. An unlabelled stock solution is an unknown.',
          'Verify solubility at the stock concentration. A cloudy or settling stock is a suspension, not a solution.',
          'Diluent acceptability is route-specific and is a separate question from solubility.',
        ]),
        cites: F(['usp1176', 'usp1251', 'usp467']),
        evidence: 'human',
      }),
      F({
        h: 'Scales: resolution, accuracy, linearity — and where people get hurt',
        body: 'This is the part that does the damage, because a digital display invites a confidence the instrument does not support. Three different properties get conflated. Resolution, or readability, is the size of the smallest increment the display can show — the last digit. Accuracy is how close the reading is to the true mass, and it is always worse than the readability, sometimes by several counts. Linearity is whether the error is constant across the range: a balance may be within a count at half of its capacity and several counts off near zero or near full load, which is exactly the region where small masses live. Repeatability is a fourth property: place the same mass five times and see the spread. Run the numbers on the instruments people actually own. A kitchen scale reading in 0.1 g steps has a readability of 100 mg. Its last digit alone is 20 times a 5 mg dose, so a 5 mg target cannot even be displayed, let alone measured; the reading for 5 mg is 0.0 g, and the difference between 0 mg and 49 mg of compound is invisible to it. A jeweller-style scale reading in 0.01 g steps has a readability of 10 mg, twice a 5 mg dose, and typical specified accuracy of a few counts, so its honest uncertainty around a 5 mg target spans zero to several doses. A consumer milligram scale reading in 0.001 g steps displays single milligrams, which is why people trust them, but the specified accuracy of inexpensive units is commonly a few milligrams and their linearity near the bottom of the range is poor — a display of 5 mg may correspond to anything from 2 to 8 mg, and the user has no way to know which. An analytical balance with 0.1 mg readability, sited properly and calibrated with certified masses, is a different class of instrument, and even that one has a minimum mass below which its own repeatability dominates the result. The formal version of this constraint is the minimum weighable quantity: the smallest mass for which the balance repeatability, multiplied by a coverage factor, stays inside the accuracy you require. The classical pharmacy form of the same calculation divides the balance sensitivity requirement by the acceptable percentage error — a sensitivity requirement of 6 mg with a 5 percent acceptable error gives a minimum weighable quantity of 120 mg, which is why compounding pharmacists dilute rather than weigh small doses. A serviceable rule of thumb that falls out of the same arithmetic: do not weigh below roughly 50 to 100 times the readability of the balance if the number has to mean anything. On a 1 mg-readability scale that puts the floor around 50 to 100 mg. Then there is the environment, which routinely dwarfs the instrument specification. Calibrate with certified masses at a mass near the working range, not with a coin. Re-zero often, because drift with temperature is real. Watch tare error: taring a container and then adding material means the container mass is inside the measurement chain, and a large tare on a small net mass eats resolution. Static electricity on a plastic scoop or weighing boat will move a powder and shift a reading by milligrams. Draughts, a leaning bench, vibration from a refrigerator compressor, and off-centre loading all produce errors larger than the last digit. None of this is fussiness; it is the difference between a number and a guess wearing a decimal point.',
        table: F({
          cols: F(['Instrument', 'Readability', 'Typical honest accuracy', 'Can it weigh a 5 mg dose?']),
          rows: F([
            F(['Kitchen scale', '0.1 g (100 mg)', 'one to several counts, i.e. ±100 mg or worse', 'No. Readability is 20× the dose; 5 mg reads as zero.']),
            F(['Jeweller-style pocket scale', '0.01 g (10 mg)', '±0.02 to 0.03 g typical', 'No. Uncertainty spans several doses.']),
            F(['Consumer milligram scale', '0.001 g (1 mg)', 'commonly ±2 to 5 mg, poor linearity near zero', 'No. A 5 mg display may be 2 to 8 mg.']),
            F(['Analytical balance, calibrated and sited', '0.1 mg', '±0.2 to 0.3 mg with good practice', 'Yes, at the edge — and only with a determined minimum weighable quantity.']),
          ]),
        }),
        cites: F(['usp1251', 'usp1176']),
        contested: true,
        caveat: 'The accuracy columns are typical figures for these instrument classes rather than a specification for any particular model, and consumer-scale performance varies widely between units and over their life. Determine the minimum weighable quantity for the balance in hand from its own repeatability, as USP <1251> describes, rather than relying on a class generalisation. The 50-100× readability figure is a practical rule of thumb, not a compendial requirement.',
        evidence: 'human',
      }),
      F({
        h: 'The honest conclusion',
        body: 'If you cannot weigh it, you must dilute it and dose by volume. That sentence is the operational content of this page. A compound whose dose is measured in single milligrams, handled with a kitchen scale or a pocket scale, is not being dosed — it is being guessed at, and the guess has an error distribution several times wider than the dose itself. The guess does not become better because the display shows three decimal places, because the material looks fine, or because it worked last time. The remedy is cheap and available: weigh a mass the instrument can handle, dissolve it to a known concentration, label the container, and measure the dose with a syringe. That single change converts an unmeasurable solid-handling problem into a measurable liquid-handling one, removes the mixing-uniformity failure mode at the same time, and leaves a documented concentration behind, which is also the only thing that lets a clinician help if something goes wrong.',
        bullets: F([
          'A milligram-scale dose off a 0.1 g or 0.01 g scale is a guess, not a measurement.',
          'Dilution moves the weighing step to a mass the instrument can actually resolve.',
          'A labelled stock solution is also a record: it tells a clinician what was taken and at what concentration.',
          'No arithmetic on this page substitutes for knowing what the compound is; an unidentified substance has no dose.',
        ]),
        cites: F(['usp1176', 'usp1251', 'castaneto2015']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['formulation/hot-spots', 'formulation/homogeneity', 'formulation/titration', 'equipment/scales', 'coa/total-thc-math', 'coa/reading-a-coa']),
    cites: F(['usp905', 'usp1176', 'usp1251', 'usp467', 'johnson2008', 'vandrey2015', 'meehanatrash2021', 'huestis2007', 'castaneto2015']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'homogeneity',
    title: 'Homogeneity: Even Mixing as a Safety Specification',
    kind: 'safety',
    summary: 'Solution, suspension and dry blend are three different states with three different guarantees, and only a true solution has uniform concentration by definition. This page covers solubility as the hard constraint, wetting and penetration, geometric dilution, fat-phase distribution in edibles, settling over time, and how producers verify uniformity by multi-point sampling and an RSD specification instead of assuming it.',
    facts: F({
      'Solution': 'molecularly dispersed; concentration uniform by definition, up to the solubility limit',
      'Suspension': 'solid particles dispersed in liquid; uniform only while agitated, and it settles',
      'Dry blend': 'uniform only to the extent it was engineered; segregates by particle size and density',
      'Geometric dilution': 'build the blend up in doubling steps rather than adding a small mass to a large one',
      'Verification': 'multi-point sampling from different locations in the batch, assay each, specify the RSD',
      'Compendial analogue': 'USP <905> uniformity of dosage units — acceptance value on 10 units, individuals within 75-125 % of the mean',
    }),
    sections: F([
      F({
        h: 'Three states, three different guarantees',
        body: 'Mixing a potent active into a carrier can end in one of three physical states, and they do not offer the same protection. In a true solution the active is molecularly dispersed in the solvent, and the concentration is the same in every aliquot by definition; take a millilitre from the top or the bottom and you have the same dose. In a suspension the active is present as solid particles dispersed through a liquid; the concentration is uniform only while the suspension is agitated, and Stokes settling begins the moment it stops, so the first dose out of an unshaken bottle and the last dose out of it differ, sometimes by a lot. In a dry blend the active is a minor solid component among larger masses of other solids, and the blend is uniform only to the extent that the blending process was designed to make it so and verified to have done so; dry blends also de-mix, segregating by particle size and density under vibration and handling, which is why the bottom of a shipped drum is not the same material as the top. The practical ranking follows directly: for a potent active, get it into solution and keep it there. A solution is the only one of the three states whose uniformity is a property of physics rather than a property of your process control.',
        bullets: F([
          'Solution: uniform by definition; the safest state for a potent minor component.',
          'Suspension: uniform only under agitation; settles by particle size and density difference; shake-before-use is a dose instruction, not a courtesy.',
          'Dry blend: uniform only if engineered and verified; actively de-mixes during handling and transport.',
        ]),
        cites: F(['johnson2008', 'usp905']),
        evidence: 'human',
      }),
      F({
        h: 'Solubility is the constraint that silently converts a solution into a suspension',
        body: 'Every diluent has a saturation concentration for every solute, and it is a hard ceiling. Dissolve up to it and you have a solution; attempt to exceed it and the excess remains or comes out as solid, and what you have is a suspension that looks like a solution until it separates. This failure is quiet, which is what makes it dangerous: a stock that was prepared above saturation may appear clear while warm and then deposit crystal on the walls and the bottom as it cools, at which point the liquid phase is depleted and every volumetric dose drawn from it is lower than the label, while the material that eventually gets scraped or shaken back into suspension is a concentrated slug. Temperature, co-solvent ratio and the presence of other dissolved matter all move the saturation point, so a stock that is fine on the bench in summer can precipitate in a cold room. The checks are simple. Hold the prepared stock at the coldest temperature it will see and look for haze, crystal on the glass, or a film at the meniscus. Filter or discard anything that has deposited rather than trying to redissolve it in place. Prepare stocks comfortably below the saturation limit rather than at it, and accept a larger volume as the price of a solution that stays one. Lipophilic cannabinoids in particular are poorly soluble in water and readily soluble in oils, ethanol and glycols, which is why aqueous edible matrices are formulated as emulsions rather than solutions and why an aqueous beverage with an unemulsified cannabinoid will separate.',
        cites: F(['usp905', 'meehanatrash2021', 'lucas2018']),
        evidence: 'human',
      }),
      F({
        h: 'Wetting, penetration and why a solvent has to do more than arrive',
        body: 'When a solution is applied to a solid carrier, the outcome depends on whether the liquid wets and penetrates the carrier or merely sits on its surface. Wetting is a matter of surface energy and viscosity: a liquid that beads on a waxy leaf cuticle deposits its solute in the footprint of the droplet, while a liquid that spreads and wicks distributes it along the capillary paths of the material. The competition is with evaporation. A volatile carrier solvent applied to a large surface area can be gone before capillary transport has moved it any distance, in which case the solute dries approximately where it landed and the distribution is a map of the spray pattern rather than of the material. Slower evaporation, gentler application, and mechanical redistribution during drying all push toward evenness; a fast-flashing solvent applied under a fan pushes hard the other way. The same logic governs edible bases: an active dissolved in a fat phase will distribute through the fat wherever the fat goes, so incorporation has to be complete before the matrix sets, and anything that sets or gels quickly locks in whatever distribution existed at that instant. This is also where the residual-solvent question begins, because the solvent that carried the compound in has to come back out, and a solvent chosen for good wetting is often one that is retained in an oily or viscous matrix far longer than intuition suggests.',
        cites: F(['meehanatrash2021', 'usp467', 'ichq3c']),
        evidence: 'human',
      }),
      F({
        h: 'Geometric dilution: the technique that actually works for a potent minor component',
        body: 'The intuitive way to mix a small mass into a large one — put the small mass in and stir — is close to the worst available method, because the small mass has to travel the whole distance and nothing in the process makes it do so. Geometric dilution inverts the problem. Combine the potent component with an approximately equal volume of diluent and mix that pair thoroughly. Then add another quantity of diluent approximately equal to the current total and mix again. Repeat, roughly doubling the mass at each step, until the whole batch is incorporated. Each step is a mix of two comparable masses, which is the case mixing handles well, and the number of steps grows only logarithmically with the dilution factor: taking 100 mg of active into 100 g of carrier is a thousandfold dilution and takes about ten doubling steps. Two supporting practices matter as much as the sequence. Particle size should be reduced and matched before blending, because content-uniformity variance in a low-dose blend scales with the particle size of the active — a coarse crystal is a hot spot with a delivery vehicle, and sieving or gentle milling of the active before the first step does more for uniformity than any amount of subsequent mixing. And the mixing action should fold and tumble rather than stir: rotational tumbling with a variety of particle paths distributes a minor component, while stirring in a fixed geometry can circulate material in stable paths that never intermix. Over-mixing a dry blend is also a real failure, because prolonged agitation of a mixture with dissimilar particle sizes eventually segregates it again.',
        bullets: F([
          'Double the mass at each step rather than adding a small mass to a large one; a thousandfold dilution is about ten steps.',
          'Reduce and match particle size before blending — content-uniformity variance scales with the particle size of the low-dose component.',
          'Tumble and fold rather than stir; vary the particle paths.',
          'Mix long enough to distribute and not so long that segregation restarts; determine the time empirically with assays, not by feel.',
          'A dry blend that will be shipped or stored will de-mix in transit. If the dose matters, unit-dose it before it travels.',
        ]),
        cites: F(['johnson2008', 'usp1176', 'usp905']),
        evidence: 'human',
      }),
      F({
        h: 'Edibles: full incorporation and the fat phase',
        body: 'Edibles concentrate every difficulty on this page. The active is lipophilic, the matrix is usually a multi-phase system of sugar, water, hydrocolloid and fat, and the finished article is a discrete unit whose individual dose is what the consumer experiences — which means the relevant specification is unit-to-unit variance, not batch average. Because cannabinoids partition into fat, the fat phase is where the active lives, and the distribution of the fat therefore determines the distribution of the dose. An active dissolved in an oil that is then emulsified into a batter is distributed as well as the emulsion is; an active added directly to a sugar syrup will not dissolve, will form a separate phase, and will migrate. Anything that separates the phases after mixing re-sorts the dose: fat rising in a warm mould, a poorly stabilised emulsion breaking, or a syrup skinning over. Deposition timing matters as well, since a mould poured over several minutes while the mass is settling produces a dose gradient from the first cavity to the last. There is a documented reason to treat all of this seriously rather than as artisanal detail. Independent assays of retail edible products have repeatedly found labelled and measured cannabinoid content diverging in both directions, including substantial under- and over-labelling, and reviewers have noted regional variability in labelled unit strength on top of measurement disagreement. Meanwhile emergency-department data show that edibles account for a share of cannabis-attributable acute visits far out of proportion to their share of total cannabinoid sold, which is the clinical shape of a product class in which the delivered dose is poorly controlled and the pharmacokinetics punish error.',
        cites: F(['vandrey2015', 'johnsonarbor2023', 'monte2019', 'lucas2018']),
        evidence: 'human',
      }),
      F({
        h: 'How uniformity is verified rather than assumed',
        body: 'The distinguishing practice of a competent producer is not better mixing; it is measurement. Uniformity is verified by sampling the batch at multiple locations that are chosen to be the places most likely to differ — top, middle and bottom of a vessel, the centre and the walls, the first, middle and last units off a depositor, the first and last scoop out of a drum — assaying each sample independently, and then computing the spread rather than the average. Ten units is the conventional starting sample size, and the statistic that matters is the relative standard deviation between them, together with the range: a mean at target with a 25 percent RSD is a dangerous batch, and the mean alone will not say so. A composite sample, in which several increments are combined and homogenised before a single assay, measures the batch mean accurately and says nothing whatever about unit-to-unit variance; this distinction is important because a great many cannabis certificates of analysis report exactly one composite result for an edible batch, and that result is not a uniformity test. The pharmacopoeial analogue is worth knowing even where it does not legally apply: USP <905> Uniformity of Dosage Units assays ten individual units, combines the deviation of the mean from target with the observed standard deviation into a single acceptance value, and additionally requires that no individual unit fall outside 75 to 125 percent of the mean at the second stage. That structure exists precisely because pharmaceutical regulators concluded that a correct batch average is not evidence of a correct dose. Cannabis-industry practice varies enormously against that benchmark, from processors running in-process uniformity assays on every lot to processors who have never measured variance at all, and the certificate rarely distinguishes the two.',
        bullets: F([
          'Sample where the batch is most likely to differ, not where it is convenient.',
          'Assay increments individually. Report the RSD and the range, not only the mean.',
          'A composite assay measures the mean and is not a uniformity test.',
          'USP <905>: 10 units, an acceptance value combining mean deviation and standard deviation, individuals within 75-125 % of the mean at stage 2.',
          'Retain samples from each lot so that a later complaint can be investigated against the material that caused it.',
        ]),
        cites: F(['usp905', 'johnson2008', 'iso17025', 'vandrey2015']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['formulation/hot-spots', 'formulation/dose-arithmetic', 'formulation/residual-solvent', 'products/edibles', 'coa/reading-a-coa', 'safety/buyer-vendor-checklist']),
    cites: F(['johnson2008', 'usp905', 'usp1176', 'usp467', 'ichq3c', 'iso17025', 'meehanatrash2021', 'lucas2018', 'vandrey2015', 'johnsonarbor2023', 'monte2019']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'residual-solvent',
    title: 'Residual Solvent: Limits, Classes and Why Inhalation Is the Hard Case',
    kind: 'safety',
    summary: 'Any solvent used to extract a compound or to distribute it onto a carrier has to be removed, and the compendial framework for how much may remain is explicit: USP <467> and ICH Q3C sort solvents into three classes and set either a concentration limit or a permitted daily exposure. Inhalation is the hard case because there is no first pass, the delivery is alveolar, and heating opens a pyrolysis route that swallowing does not.',
    facts: F({
      'Class 1': 'to be avoided — known or strongly suspected carcinogens or environmental hazards; benzene 2 ppm, carbon tetrachloride 4 ppm, 1,2-dichloroethane 5 ppm',
      'Class 2': 'limited by a permitted daily exposure; e.g. methanol 30 mg/day, dichloromethane 6.0 mg/day, toluene 8.9 mg/day, acetonitrile 4.1 mg/day, hexane 2.9 mg/day',
      'Class 3': 'low toxic potential; PDE of 50 mg/day or more, giving a default 5000 ppm (0.5 %) — ethanol, acetone, ethyl acetate, heptane, isopropanol',
      'PDE vs ppm': 'the ppm limit is the PDE divided by an assumed daily product intake (10 g in the USP Option 1 calculation)',
      'Hard case': 'inhalation — no first-pass metabolism, direct alveolar delivery, plus a pyrolysis route on heating',
      'Not evidence': '"it evaporated" — retention in a viscous or oily matrix is exactly why the panel exists',
    }),
    sections: F([
      F({
        h: 'Why the solvent has to come out',
        body: 'Solvents appear at two points in the life of a cannabinoid product: extraction, where a solvent pulls the compound out of plant material, and distribution or formulation, where a solvent carries a concentrated compound into or onto a carrier so that it can be spread out. In both cases the solvent has done its job once the compound is where it needs to be, and from that moment it is an impurity. It is an impurity with a particular character: volatile, present at concentrations orders of magnitude above the active in the original mixture, and prone to being retained by exactly the viscous, oily, high-boiling matrices that cannabinoid products consist of. That is why residual solvent is a named, mandatory analytical panel rather than a matter of judgement, and why the pharmaceutical world reduced the question to a written specification decades ago. The frame to carry is that removal is a process step with a verification step attached, not an assumption. The compendial chapters exist because the industry that wrote them learned that solvent retention is routinely worse than the people doing the processing believe.',
        cites: F(['usp467', 'ichq3c', 'meehanatrash2021']),
        evidence: 'human',
      }),
      F({
        h: 'The three classes, and the difference between a concentration limit and a PDE',
        body: 'USP <467> and the ICH Q3C guideline it derives from sort solvents into three classes by toxicological character. Class 1 solvents are to be avoided: known or strongly suspected human carcinogens and environmental hazards for which there is no functional level considered acceptable in a product, so the limits are set at the lowest practically controllable concentrations. Class 2 solvents have significant non-genotoxic animal toxicity or other suspected toxicity and are limited by a permitted daily exposure, a mass per day derived from toxicological no-effect levels and safety factors. Class 3 solvents have low toxic potential at levels normally accepted in products, with permitted daily exposures of 50 mg per day or more, and are limited by default to 5000 ppm — half a percent — unless a higher level is justified. The conceptual distinction between a concentration limit and a permitted daily exposure is worth holding, because it is where most misreadings happen. A PDE is a mass of solvent per day that is considered tolerable; a ppm limit is a concentration. The one becomes the other only by assuming how much product a person consumes in a day, and the USP Option 1 calculation makes that assumption explicit at 10 grams of product per day. It follows that a ppm figure carries a hidden intake assumption, and that a product consumed in much larger daily quantities than the assumption is not covered by a passing ppm result. It also follows that comparing two solvents by their ppm limits alone is comparing their toxicities filtered through an identical, arbitrary intake figure.',
        table: F({
          cols: F(['Class', 'Basis', 'Examples', 'Limits']),
          rows: F([
            F(['Class 1 — avoid', 'known or strongly suspected human carcinogen, or environmental hazard; no acceptable functional level', 'benzene, carbon tetrachloride, 1,2-dichloroethane, 1,1-dichloroethene, 1,1,1-trichloroethane', 'benzene 2 ppm; carbon tetrachloride 4 ppm; 1,2-dichloroethane 5 ppm; 1,1-dichloroethene 8 ppm; 1,1,1-trichloroethane 1500 ppm']),
            F(['Class 2 — limit', 'significant non-genotoxic animal toxicity or other suspected toxicity; controlled by a permitted daily exposure', 'methanol, dichloromethane, toluene, acetonitrile, hexane, and others', 'PDE per day, with an Option 1 ppm equivalent at 10 g/day intake: methanol 30 mg (3000 ppm); dichloromethane 6.0 mg (600 ppm); toluene 8.9 mg (890 ppm); acetonitrile 4.1 mg (410 ppm); hexane 2.9 mg (290 ppm)']),
            F(['Class 3 — low toxic potential', 'no known human health hazard at levels normally accepted; PDE 50 mg/day or more', 'ethanol, acetone, ethyl acetate, heptane, isopropanol, and similar', 'default 5000 ppm (0.5 %), higher with justification']),
          ]),
        }),
        cites: F(['usp467', 'ichq3c']),
        contested: true,
        caveat: 'These are pharmaceutical limits from USP <467> and ICH Q3C and they are the correct conceptual reference, but they are not the rules most cannabinoid products are actually tested against. State cannabis programmes set their own residual-solvent action levels, which differ from each other and from the compendial figures, and they include hydrocarbon gases such as butane, propane and isobutane that the ICH classification does not address. Check the limit list that a particular certificate was issued against; a pass is a pass against that list only.',
        evidence: 'human',
      }),
      F({
        h: 'Inhalation is the hard case',
        body: 'Residual-solvent limits as written are oral limits. They were derived for medicines that are swallowed, and the exposure model behind them assumes gastrointestinal absorption followed by hepatic first pass. Inhalation breaks every part of that model. There is no first-pass metabolism, so a solvent that the liver would largely clear before it reached the systemic circulation instead arrives intact. Delivery is alveolar, across a very large, very thin, extremely well-perfused surface, so absorption is fast and close to complete for a volatile compound. And the target organ is the lung itself, which is not the organ the oral limit was protecting. On top of that, inhalation of a cannabinoid product involves heat, and heat opens a route that swallowing does not: pyrolysis. A solvent that is merely unpleasant to swallow can decompose on a hot coil or in a flame into something materially worse — chlorinated solvents are the textbook case, with thermal and oxidative decomposition products that are corrosive and toxic to the airway. This is not hypothetical chemistry for the cannabis case. Vitamin E acetate, a diluent chosen for its viscosity and not for its inhalation profile, was identified in the bronchoalveolar-lavage fluid of nearly all patients in the EVALI case series and in none of the healthy comparators, and its pyrolysis has been shown to release ketene, a highly pulmonary-toxic gas. Terpene constituents in dabbing and vaping have likewise been shown to generate degradation products including methacrolein and benzene at high temperatures. The working conclusion is that a residual-solvent result on an inhaled product should be read more conservatively than the oral limit implies, and that the identity of every intentional diluent, not just the residue of an unintentional one, is part of the safety question.',
        cites: F(['blount2020', 'wu2020', 'meehanatrash2017', 'meehanatrash2021', 'usp467']),
        evidence: 'human',
      }),
      F({
        h: 'Why "it evaporated" is not evidence',
        body: 'The most common reasoning error in this area is to treat a solvent as gone because it is volatile and because time has passed. Volatility describes the escaping tendency of a pure liquid at a surface. What governs the loss of the last fraction of a solvent from a product is not its boiling point but its partitioning into and diffusion out of the matrix, and cannabinoid matrices are close to the worst case: viscous, high-boiling, lipophilic and often thick-layered. A solvent dissolved in such a matrix has to diffuse to a surface before it can leave, diffusion through a viscous oil is slow, and as the surface layer depletes the driving gradient falls, so the last percent takes disproportionately long. Heating to speed the process cooks the product and can degrade actives; applying vacuum helps but only in proportion to the surface area presented. The result, repeatedly, is that products believed to be solvent-free carry measurable residue, and this is precisely the observation that caused the residual-solvent panel to exist as a mandatory test rather than a voluntary one. Surveys of retail Δ8-THC vaporiser products have reported exactly this pattern, finding reaction and processing solvents alongside unlabelled compounds and metals. The only statement that counts about residual solvent is a chromatographic measurement on the finished product, against a stated limit list, on the batch in hand.',
        cites: F(['meehanatrash2022', 'lin2026', 'usp467', 'ichq3c']),
        evidence: 'human',
      }),
      F({
        h: 'How to read a residual-solvent panel',
        body: 'Read four things in order. First, the limit list: which solvents were looked for, and against whose limits. A panel that reports six analytes is silent about every solvent not on it, and a clean report against a short list is weak evidence about a process that may have used something else entirely. Ask specifically whether the solvents actually used in extraction, in any conversion step and in formulation are among the analytes. Second, the reporting limits: a result of "not detected" or "less than the limit of quantitation" means only that the analyte was below the method\'s own floor, and a method with a reporting limit near the action level provides much less assurance than one with a floor far beneath it. Compare the LOQ column to the limit column, not just the result to the limit. Third, the units and the basis: ppm by mass, µg/g and mg/kg are the same number, while a result expressed per unit or per container has already had an assumption applied. Fourth, the sample chain: whether the tested sample is from the batch identified on the product, whether the laboratory is accredited to ISO/IEC 17025 with residual solvents inside its declared scope, and whether the certificate can be verified with the laboratory by sample identifier rather than taken as a PDF from the seller. A residual-solvent panel is a strong document when all four hold and close to decorative when they do not.',
        bullets: F([
          'Which analytes, against which limit list — a short panel is silent about everything off it.',
          'Compare the reporting limit to the action level; a high LOQ hides a lot.',
          'ppm = µg/g = mg/kg. Per-unit or per-container figures embed an assumption.',
          'Accreditation to ISO/IEC 17025 matters only if residual solvents are inside the declared scope.',
          'Verify the certificate with the laboratory by sample identifier, and check that the batch matches the product.',
        ]),
        cites: F(['iso17025', 'usp467', 'meehanatrash2022']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['coa/panels', 'coa/reading-a-coa', 'formulation/homogeneity', 'formulation/adulterants', 'processing/extraction-methods', 'safety/converted-cannabinoid-products']),
    cites: F(['usp467', 'ichq3c', 'iso17025', 'blount2020', 'wu2020', 'meehanatrash2017', 'meehanatrash2021', 'meehanatrash2022', 'lin2026']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'titration',
    title: 'Titration: Start Low and Go Slow as a Protocol',
    kind: 'safety',
    summary: 'Start low and go slow is a pharmacokinetic argument, not a slogan: the safe re-dosing interval is set by the time to peak effect for the route, which is minutes for inhalation and hours for oral. It also has a hard limit — tolerance to a partial agonist does not transfer to a full agonist, and an unidentified compound cannot be titrated at all because there is no dose-response curve to titrate along.',
    facts: F({
      'Inhaled': 'onset within minutes, peak plasma within minutes and peak subjective effect commonly 10-30 minutes; short feedback loop',
      'Oral': 'onset typically 30-120 minutes, peak commonly 2-4 hours, highly variable with food and individual metabolism',
      'Oral first pass': 'hepatic conversion of Δ9-THC to 11-OH-THC, which is at least as active and readily crosses into the brain',
      'The interval rule': 'wait past the expected PEAK, not past the expected onset',
      'The hard limit': 'partial-agonist tolerance does not transfer to a full agonist, and may license a larger dose',
      'The absolute limit': 'an unidentified compound has no dose-response information, so it cannot be titrated rationally',
    }),
    sections: F([
      F({
        h: 'Why it is a protocol and not a platitude',
        body: 'Titration is the practice of approaching an unknown effective dose from below in increments small enough that an overshoot is recoverable, waiting long enough between increments to observe the full effect of the last one. Stated that way it is obviously a measurement procedure rather than a piece of caution, and its two parameters are the increment size and the waiting interval. Both are set by pharmacology. The increment should be a fraction of the smallest dose expected to do anything, because the point is to find the threshold rather than to land on the target in one step. The interval is the parameter people get wrong, and it is set by the time to peak effect rather than by the time to onset. Redosing after onset but before peak is the single most reliable way to produce an overdose with a substance that is otherwise forgiving, because the second dose lands while the first is still rising and the two peaks sum. The reason the protocol is worth writing out formally is that the correct interval differs between routes by two orders of magnitude, and intuitions calibrated on one route are dangerous on the other.',
        cites: F(['huestis2007', 'lucas2018']),
        evidence: 'human',
      }),
      F({
        h: 'Route pharmacokinetics, with numbers',
        body: 'Inhalation. Absorption across the alveolar surface is fast and the drug reaches the brain in one circulation time, so onset is within minutes; plasma concentrations of Δ9-THC peak within roughly the first ten minutes of the end of smoking and subjective effect commonly peaks somewhere around ten to thirty minutes, declining substantially over two to four hours. The feedback loop is therefore short: a person who waits half an hour has seen most of what a dose is going to do. The bioavailability of the inhaled route is variable but relatively high, and — importantly — it is dominated by technique, device and puff topography, which is why a labelled cartridge concentration does not translate into a delivered dose. Oral. Absorption is slower and irregular, onset is typically thirty to a hundred and twenty minutes, and peak plasma concentration commonly falls two to four hours after ingestion, with wide inter-individual variation and a strong food effect: a high-fat meal increases absorption of a lipophilic cannabinoid substantially and shifts the curve. Oral bioavailability is low and variable, in part because of extensive first-pass metabolism. That first pass is also the mechanism that makes the oral route different in kind and not only in timing: hepatic metabolism converts Δ9-THC to 11-hydroxy-Δ9-THC, a metabolite that is at least as pharmacologically active as the parent and readily enters the central nervous system, so an oral dose delivers a different mix of active species than an inhaled one. The combination of a long, variable delay and a metabolite with strong central activity is the mechanistic explanation for why edible overconsumption is the classic acute presentation: the person waits, feels little, takes more, and then receives the sum of the doses at a peak they cannot shorten. Emergency-department data bear this out, with edibles accounting for a share of cannabis-attributable acute visits far larger than their share of total cannabinoid sold.',
        table: F({
          cols: F(['Route', 'Onset', 'Peak', 'Practical wait before any re-dose', 'Dominant variability']),
          rows: F([
            F(['Inhaled', 'within minutes', 'plasma within about 10 minutes; subjective commonly 10-30 minutes', 'at least 30 minutes past the last inhalation', 'device, technique and puff topography']),
            F(['Oral', 'typically 30-120 minutes', 'commonly 2-4 hours', 'at least 4 hours; longer if food was involved', 'food effect, first-pass metabolism, individual variation']),
            F(['Oromucosal or sublingual', 'intermediate, with an oral component from any swallowed fraction', 'mixed, with a later oral peak', 'treat as oral unless the swallowed fraction is genuinely negligible', 'how much was actually swallowed']),
          ]),
        }),
        cites: F(['huestis2007', 'lucas2018', 'monte2019']),
        evidence: 'human',
      }),
      F({
        h: 'Why 11-OH-THC matters to the protocol',
        body: 'The oral route is not simply the inhaled route delayed. Substantial first-pass hepatic metabolism of Δ9-THC produces 11-hydroxy-Δ9-THC, and this metabolite is itself a cannabinoid receptor agonist that is reported to be equipotent with or more potent than the parent compound, with ready brain penetration. An oral dose therefore delivers a pharmacologically different exposure, weighted toward a metabolite, arriving over a longer window. The practical consequences for titration are three. Milligram figures do not transfer between routes, so an oral dose cannot be inferred from an inhaled dose that felt right. The oral peak may be both later and disproportionately stronger than the plasma curve of the parent compound alone would suggest. And inter-individual differences in hepatic metabolism, including genetic variation in the enzymes involved and competing substrates or inhibitors, act on the oral route far more than on the inhaled one — which means the same product produces a wider spread of experiences orally than it does by inhalation.',
        cites: F(['huestis2007', 'lucas2018']),
        contested: true,
        caveat: 'The relative potency of 11-OH-THC against Δ9-THC comes from a small body of older controlled human work and animal data, and the figures quoted in the literature vary. That it is active, brain-penetrant and formed in quantity by the oral route is not in dispute; a precise potency ratio is not well established and should not be treated as a number to calculate with.',
        evidence: 'human',
      }),
      F({
        h: 'Tolerance to a partial agonist does not transfer to a full agonist',
        body: 'This is the point on this page that has actually killed people, and it deserves to be stated without softening. Δ9-THC is a partial agonist at CB1, with reported binding affinity in the tens of nanomolar. The synthetic cannabinoid receptor agonists sold as herbal-incense products are, as a class, high-affinity full agonists: JWH-018, the first-generation compound in wide circulation, has reported CB1 affinity around an order of magnitude tighter than Δ9-THC and behaves as a full agonist, and the later indazole- and indole-carboxamide generations are more potent again. A partial agonist has a ceiling: beyond a certain receptor occupancy, additional drug produces no additional maximal effect, which is a large part of why acute cannabis overconsumption is usually a bad few hours rather than a medical emergency. A full agonist has no such ceiling, so the dose-response relationship keeps climbing into effects that have no counterpart in cannabis intoxication — seizures, tachyarrhythmia, extreme hypertension or hypotension, hyperthermia and agitated delirium. Tolerance acquired through heavy cannabis use is largely CB1 receptor downregulation and desensitisation. Against a full agonist that can drive a maximal response from a reduced receptor population, that adaptation offers much less protection than it feels like it should — and it is worse than useless in one specific respect: it licenses a larger dose. The heavy user is precisely the person whose experience tells them that a small amount will do little, and who therefore takes an amount that a full agonist will turn into a toxicological event. The same logic applies whenever a product of unknown composition is approached with tolerance built on a known one, which is a common situation in a market where novel cannabinoids appear faster than they can be characterised.',
        cites: F(['showalter1996', 'huffman2005', 'banister2018', 'castaneto2014', 'hermannsclausen2013']),
        contested: true,
        caveat: 'The non-transfer of tolerance is a mechanistic inference from receptor pharmacology — partial versus full agonism at CB1, and the affinity difference — combined with clinical case series in which experienced cannabis users presented with severe synthetic-cannabinoid toxicity. There is no controlled human cross-tolerance study comparing Δ9-THC tolerance against a synthetic full agonist, and there could not ethically be one. The reported affinity figures are single-laboratory values from different assay systems and are not directly comparable to two significant figures.',
        evidence: 'in vitro',
      }),
      F({
        h: 'Batch variance, and the compound you cannot titrate',
        body: 'Titration works within a stable dose-response relationship. Two things break it. The first is batch-to-batch variance: a dose established on one batch is information about that batch, and a new batch is a new unknown that has to be approached from below again. Where distribution was uneven the situation is worse still, because even one batch does not have a single dose-response relationship — the variance is within it, so a previously safe portion is not evidence about the next portion. This is the same argument the hot-spots page makes, arriving from the other direction: titration, which is the standard defence against an unknown potency, is defeated by a product whose potency varies inside the package. The second and absolute limit is identity. Titration presupposes that there is a dose-response curve for the substance being taken, even if the person does not know where they sit on it. An unidentified compound has no such curve available: the increment size cannot be chosen, because the scale is unknown; the waiting interval cannot be chosen, because the time to peak is unknown and for many novel compounds is longer than intuition suggests; and the shape of the curve is unknown, including whether there is a ceiling at all. A substance that is only known by what it was sold as is not being titrated; it is being sampled. The honest statement of the limit is that harm reduction can make consuming an identified compound at an unknown personal dose much safer, and can do relatively little about consuming an unidentified compound at an unknown dose. That is why identity, not dose, is the first question.',
        bullets: F([
          'A dose established on one batch is information about that batch only.',
          'Within-batch variance defeats titration itself, because the next portion is a new draw.',
          'Without identity there is no dose-response curve, so no increment and no interval can be chosen rationally.',
          'Sold-as is not identity. Only analysis against an authentic reference standard is identity.',
        ]),
        cites: F(['frinculescu2016', 'luzio2019', 'castaneto2015', 'trecki2015']),
        evidence: 'human',
      }),
      F({
        h: 'What the protocol logic looks like, stated generally',
        body: 'Written out as logic rather than as a recommendation for any substance: establish identity before anything else, because every subsequent step depends on it. Establish concentration, by assay or by a documented dilution you performed and labelled. Choose an increment that is a fraction of the smallest dose expected to produce any effect for that compound by that route. Take one increment. Wait past the expected peak for the route, not past the expected onset — which means minutes to tens of minutes for inhalation and hours for ingestion, with the oral interval extended if food was involved. Record what happened, because the next increment is a decision that needs data. Then, if a further increment is taken at all, take one increment and not two. Do not change route and dose in the same step, and do not change product and dose in the same step, because a single experiment with two variables answers nothing. Treat any new batch as a new unknown. None of this is specific to a substance and none of it is a dosing recommendation; it is the general structure of approaching an unknown dose-response relationship from below, which is the same structure a pharmacologist would use and the same one a clinical dose-escalation study is built on.',
        cites: F(['huestis2007', 'lucas2018', 'castaneto2015']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['formulation/dose-arithmetic', 'formulation/hot-spots', 'safety/toxidrome', 'safety/k2-what-went-wrong', 'cyp450/overview', 'endocannabinoid/cb1']),
    cites: F(['huestis2007', 'lucas2018', 'monte2019', 'showalter1996', 'huffman2005', 'banister2018', 'castaneto2014', 'castaneto2015', 'hermannsclausen2013', 'frinculescu2016', 'luzio2019', 'trecki2015']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'adulterants',
    title: 'Adulterants: What Has Actually Been Found in Products',
    kind: 'safety',
    summary: 'The documented contamination record, not a list of fears: brodifacoum in synthetic-cannabinoid products causing an outbreak of coagulopathy, household and agricultural insecticides on smoked material, vitamin E acetate as the diluent behind the EVALI epidemic, and metals from hardware and catalysts. The principle that closes the page is that "it was sold as X" is not identification.',
    facts: F({
      'Brodifacoum': 'long-acting vitamin K antagonist found in synthetic-cannabinoid products; Illinois-centred outbreak, spring 2018; coagulopathy, deaths, months of high-dose vitamin K1',
      'Insecticides': 'organophosphates and pyrethroids on smoked material; combustion generates further toxicants and transfers residues into smoke',
      'Vitamin E acetate': 'diluent chosen for viscosity; identified in bronchoalveolar lavage of 48 of 51 EVALI patients and none of 99 comparators; pyrolyses to ketene',
      'EVALI scale': 'about 2800 hospitalised cases or deaths and 68 deaths reported by mid-February 2020',
      'Metals': 'from heating coils and hardware, and from catalysts in converted-cannabinoid production',
      'The principle': 'sold-as is not identification; only analysis against an authentic reference standard is',
    }),
    sections: F([
      F({
        h: 'Brodifacoum: the documented case that nobody predicted',
        body: 'In the spring of 2018 emergency departments in Illinois began receiving patients with unexplained bleeding — haematuria, gum and nose bleeding, bruising, flank pain, some with intracranial or retroperitoneal haemorrhage — who had in common the recent use of synthetic-cannabinoid products. Coagulation studies showed a markedly prolonged prothrombin time correcting with vitamin K, and the responsible agent was identified as brodifacoum, a long-acting 4-hydroxycoumarin anticoagulant rodenticide, present in the products themselves and detectable in patient serum. The outbreak produced hundreds of reported cases centred on Illinois with additional cases in other states, and several deaths. The clinical problem is brodifacoum\'s pharmacokinetics: it is a superwarfarin with an elimination half-life measured in weeks, so treatment is not a single dose of vitamin K but high-dose oral phytonadione continued for months, with repeated coagulation monitoring and a supply and cost problem that was itself a barrier to care. Why it was in the products at all was never established with certainty; hypotheses in the literature include deliberate addition believed to prolong effects and contamination from shared equipment or supply, and both are consistent with a supply chain in which the people doing the formulation had no analytical oversight of what was in their hands. The general lesson is the important part. The contaminant was not a plausible guess. No harm-reduction list of the period included a rodenticide, no user could have detected it, and no product-identity assumption covered it. A supply chain with no analysis in it can deliver anything, and the space of possible contaminants is not limited to the things anyone thought to worry about.',
        cites: F(['kelkar2018', 'hussain2018', 'mmwrBrodifacoum2018']),
        evidence: 'human',
      }),
      F({
        h: 'Insecticides on smoked material: the "bug spray" phenomenon, described as what it was',
        body: 'Reports of people applying household or agricultural insecticide to plant material and smoking it appeared in the same period and in the same populations as the synthetic-cannabinoid harms, and they are usually recounted as a punchline. They should not be. They were the furthest downstream layer of a supply chain that had already failed: people improvising with what was physically available in a corner shop, in a market where the actual product was unidentifiable, unpredictably dosed and periodically unavailable, and where no source of straight information was on offer because every institution positioned itself to withhold rather than to explain. Mockery is both cruel and analytically useless — it locates the problem in the user rather than in the information vacuum that produced the behaviour. The pharmacology of what those products contain is worth knowing plainly. Household and agricultural insecticide formulations are typically organophosphates or carbamates, which inhibit acetylcholinesterase and produce a cholinergic syndrome, or pyrethroids, which act on voltage-gated sodium channels and in high exposure produce paraesthesia, agitation, tremor and seizures; formulations also carry synergists such as piperonyl butoxide, along with petroleum distillate carriers and propellants. Inhaling combustion products of any of these is a different and worse exposure than the label warnings contemplate, because pyrolysis generates additional toxicants and because inhalation bypasses first-pass metabolism entirely. That pesticide residues do transfer into smoke rather than being destroyed by combustion has been measured directly for cannabis, with recoveries in mainstream smoke high enough to matter for several compounds, and the same physics applies to a deliberately applied insecticide at far higher loading. The correct response to this material is to explain it, which is what this page is for.',
        cites: F(['sullivan2013', 'trecki2015', 'castaneto2014']),
        evidence: 'human',
      }),
      F({
        h: 'Vitamin E acetate and EVALI: a diluent chosen for the wrong property',
        body: 'The cannabis-adjacent case that makes the general point most cleanly is EVALI, the outbreak of e-cigarette or vaping product use-associated lung injury that ran through late 2019 and into 2020 and was associated principally with THC-containing vaping products from informal sources. Patients presented with dyspnoea, cough, fever, gastrointestinal symptoms and bilateral pulmonary infiltrates, many requiring intensive care. By mid-February 2020 the national case count stood at roughly 2800 hospitalised cases or deaths with 68 confirmed deaths. Investigation converged on vitamin E acetate: it was identified in bronchoalveolar-lavage fluid from 48 of 51 case patients and in none of 99 healthy comparators, a separation about as clean as this kind of epidemiology produces. Vitamin E acetate had been adopted as a cutting agent because it is viscous, oily and miscible with cannabis extract, which made diluted product look and behave like undiluted product in a cartridge — that is, it was selected for a property that defeats a consumer\'s visual quality check, with no consideration of its behaviour in a lung. Subsequent work showed that heating it releases ketene, a highly pulmonary-toxic gas, supplying a plausible mechanism for the injury. The structural lesson generalises well past this one compound. A diluent is not a neutral filler; it is an ingredient consumed by the same route as the active, in larger quantity than the active, and its inhalation toxicology is a separate question from its food safety. A substance can be entirely unremarkable to swallow and severely injurious to inhale, and the heated route adds degradation chemistry that no oral safety assessment covers.',
        cites: F(['blount2020', 'wu2020', 'cdcEvali2020', 'krishnasamy2020', 'meehanatrash2021']),
        evidence: 'human',
      }),
      F({
        h: 'Metals, from hardware and from catalysts',
        body: 'Two distinct metal exposures show up in this product class. The first is hardware: the metallic heating coils and associated components of vaping devices shed metal into the liquid and the aerosol, and measured aerosol concentrations of chromium, nickel, lead and manganese have been attributed specifically to the coil, with the effect varying by device and by operating power. This is a property of the device, not of the cannabinoid, and it is therefore invisible to any testing performed on the liquid before it is put into the hardware. The second is catalysis: converted-cannabinoid production uses acid catalysis, and where the catalyst is a metal species or the reaction is run in metal equipment, metal residues can carry through into the product. That matters analytically because the standard cannabis heavy-metal panel is a fixed short list — typically lead, arsenic, cadmium and mercury, the four metals that regulators were worried about for agricultural inputs — and it does not look for the metals a conversion step would plausibly contribute. A clean four-metal result on a converted product is therefore weak evidence about catalyst residues, and the analysis that would answer the question is a broader elemental scan that is rarely ordered. Surveys of retail Δ8-THC vaporiser products have reported metals alongside unlabelled compounds and processing residues, which is the expected signature of a product class formulated by processors with heterogeneous analytical capability.',
        cites: F(['olmedo2018', 'meehanatrash2022', 'lin2026']),
        evidence: 'human',
      }),
      F({
        h: 'Sold-as is not identification',
        body: 'Everything on this page reduces to one principle. A product name, a label, a brand, a seller\'s assurance and a community consensus are all statements about what a substance is supposed to be. None of them is a measurement. Identification means an analytical determination of what a sample actually contains, performed against an authentic reference standard of the suspected compound — the standard being the thing that turns a retention time and a spectrum into a name. This is exactly what was unavailable during the synthetic-cannabinoid era: new analogues appeared faster than reference standards could be synthesised and distributed, so even well-equipped laboratories could not put a name to material in circulation, and routine immunoassay drug screens did not detect these compounds at all. The same gap is live now in a different form: novel cannabinoids appear on labels for which no validated quantitative method and no commercially available reference standard exists, which means the number printed next to the name cannot have been measured in the ordinary sense. The practical consequences are worth stating flatly. The absence of a compound from a certificate means it was not looked for or was below the method floor, not that it is absent. An unassigned chromatographic peak is an unidentified compound present in the product. A product with no certificate is a product of unknown composition, and the only honest description of consuming it is that the identity of what is being consumed is unknown. That is not a moral judgement; it is a statement about the evidence, and it is the one piece of information that a person deciding what to do actually needs.',
        bullets: F([
          'Identification requires an analysis against an authentic reference standard. A label is not an analysis.',
          'Not detected means below the method floor for the analytes that were sought — nothing more.',
          'An unassigned peak is an unidentified compound being consumed.',
          'Routine immunoassay screens did not detect synthetic cannabinoid receptor agonists; a negative drug screen is not evidence of what was taken.',
          'Keep the packaging and any remaining material if someone becomes unwell — it is the only route to identification after the fact.',
        ]),
        cites: F(['castaneto2015', 'trecki2015', 'emcdda2021', 'meehanatrash2022', 'iso17025']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['coa/panels', 'coa/red-flags', 'safety/k2-what-went-wrong', 'safety/toxidrome', 'formulation/residual-solvent', 'products/carriers-and-diluents']),
    cites: F(['kelkar2018', 'hussain2018', 'mmwrBrodifacoum2018', 'sullivan2013', 'trecki2015', 'castaneto2014', 'castaneto2015', 'blount2020', 'wu2020', 'cdcEvali2020', 'krishnasamy2020', 'meehanatrash2021', 'meehanatrash2022', 'olmedo2018', 'lin2026', 'emcdda2021', 'iso17025']),
  }),

]);

export default { SHELF, CITES, PAGES };
