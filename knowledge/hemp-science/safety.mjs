// safety.mjs — the Product Safety and Analytical Integrity shelf: what actually went wrong in the
// synthetic-cannabinoid era, what the published product surveys find in converted cannabinoids today,
// how to recognise and respond to a toxic presentation, and what to demand as a buyer or provide as a
// vendor.
//
// WHAT THIS SHELF IS. Four pages. The first reconstructs the K2 and Spice failure accurately, because
// the wrong lesson has been drawn from it for fifteen years. The second states what the published
// analytical surveys of acid-isomerised and novel cannabinoid products actually report. The third is
// recognition and response — the synthetic-cannabinoid toxidrome set beside cannabis overconsumption,
// with the emergency thresholds and the harm-reduction basics. The fourth is a working buyer and vendor
// instrument: what to demand, what to provide, and the red flags.
//
// THE CORRECTION THIS SHELF EXISTS TO MAKE. The K2 era is usually narrated as a story about chemists
// and synthesis. It was not. The compounds came from published academic pharmacology — the JWH series
// out of John W. Huffman's structure-activity work — were manufactured in bulk by contract producers
// elsewhere, and reached distributors as powder. Those distributors sprayed the powder in solvent onto
// inert plant material with hand sprayers: no balance capable of the input mass, no dose-per-gram
// calculation, no homogeneity control, no assay. Uneven distribution meant one portion of a batch could
// carry many times the dose of the rest, so the same bag that was safe yesterday delivered a massive
// dose today. Further downstream again, people improvised with household chemicals. Every layer of that
// is a formulation, dosing, identification and information failure on an already-existing compound. The
// hazard was consuming an UNIDENTIFIED compound of UNKNOWN pharmacology at an UNKNOWN and non-uniform
// dose. It was not a knowledge gap about how to make them, and treating it as one is what produced
// fifteen years of withheld information and preventable harm.
//
// AND THE HALF THAT AN EARLIER REVISION OF THIS SHELF GOT WRONG. That account assigned the causal
// weight to the distribution and formulation layer and treated the scheduling regime as neutral
// background — the setting in which the failure happened. It is not background. It is the SELECTION
// PRESSURE that decided WHICH molecule the distribution layer was handling. The Federal Register
// records each turn of it: five compounds of the JWH and CP type temporarily scheduled on 1 March 2011
// (76 FR 11075) and placed in schedule I by statute on 9 July 2012 (Public Law 112-144, title XI
// subtitle D, § 1152); the tetramethylcyclopropanoyl indoles on 16 May 2013 (78 FR 28735); the indazole
// carboxamides including AB-FUBINACA on 10 February 2014 (79 FR 7577); and the sequence still running
// in December 2023 (88 FR 86040). The market was driven UP the potency curve, not out of existence.
// Both halves are therefore true and neither is sufficient alone: layer three did the killing
// mechanically, and the scheduling regime is what put a full agonist in layer three's hands instead of
// a partial one. The general form of that dynamic — the iron law of prohibition, the analogue treadmill
// — is argued with its three documented case histories on the regulatory shelf.
//
// WHERE THE MATERIAL COMES FROM. The receptor pharmacology (Showalter 1996 for Δ9-THC affinity,
// Huffman 2005 for the naphthoylindole series, Banister and Connor 2018 for the generational
// evolution); the clinical case series and reviews (Adams 2017 on AMB-FUBINACA, Hermanns-Clausen 2013,
// Tait 2015, Thornton 2013, Mir 2011, Trecki 2015, Castaneto 2014 and 2015); the outbreak literature
// (Kelkar 2018, Hussain 2018 and MMWR 2018 for brodifacoum; Blount 2020, Wu 2020 and MMWR 2020 for
// EVALI); the product-composition and label-accuracy surveys (Meehan-Atrash and Rahman 2021 and 2022,
// Lin 2026, Helander 2022, Burgess 2024, Vandrey 2015, Bonn-Miller 2017, Johnson 2022); and the
// compendial and accreditation framework (USP <467>, USP <905>, ISO/IEC 17025).
//
// WHAT THIS SHELF DELIBERATELY DOES NOT CONTAIN. No preparative or synthetic procedures of any kind:
// no reagents, catalysts, equivalents, concentrations, temperatures, times, work-ups or yields, no
// precursor sourcing, and no step-by-step for isomerisation, homologation or acetylation. The
// converted-cannabinoid page names the transformation only at the level of structure — a ring closure
// under acid catalysis, documented from Adams 1940 onward — and otherwise describes exclusively what
// the finished products were found to contain. The recognition page is educational: it describes what is
// documented and where the emergency thresholds are. It does not diagnose, prescribe, or instruct anyone
// on the treatment of a named person.

const F = Object.freeze;

export const SHELF = F({
  id: 'safety',
  title: 'Product Safety and Analytical Integrity',
  blurb: 'What the K2 era actually failed at — the scheduling regime that selected for the more dangerous compounds, documented turn by turn in the Federal Register, and the distribution layer that could not handle what it was given — what the published surveys find in converted cannabinoid products, how to recognise synthetic-cannabinoid toxicity against cannabis overconsumption, and the buyer and vendor instrument that separates a tested market from the failure mode.',
  updated: '2026-09-27',
});

/**
 * CITES — this shelf's bibliography.
 *
 * verified: 'crossref'  DOI resolved against the Crossref REST API on 2026-09-27; the returned title,
 *                       author list, year and journal are recorded from that response.
 * verified: 'standard'  a standard or compendial chapter; its designation is the identifier, not a DOI.
 * verified: 'url'       an agency notice or rule; the volume-and-page citation and the publication date
 *                       were resolved against the Federal Register API on 2026-09-27 and the returned
 *                       title, date and document URL are recorded from that response.
 * verified: 'statute'   a statute or public law; the citation IS the identifier. No DOI exists and none
 *                       is invented.
 * verified: false       bibliographic details recorded from the literature, identifier NOT resolved in
 *                       this pass. Render with an unverified marker. Never guess an identifier.
 */
export const CITES = F({
  // ── receptor pharmacology and structural evolution ──────────────────────────────────────────────
  showalter1996: { authors: 'Showalter VM, Compton DR, Martin BR, Abood ME', year: 1996, title: 'Evaluation of binding in a transfected cell line expressing a peripheral cannabinoid receptor (CB2): identification of cannabinoid receptor subtype selective ligands', journal: 'The Journal of Pharmacology and Experimental Therapeutics', doi: '10.1016/s0022-3565(25)20744-3', verified: 'crossref' },
  huffman2005: { authors: 'Huffman JW, Zengin G, Wu MJ, Lu J, Hynd G, Bushell K, et al.', year: 2005, title: 'Structure-activity relationships for 1-alkyl-3-(1-naphthoyl)indoles at the cannabinoid CB1 and CB2 receptors: steric and electronic effects of naphthoyl substituents. New highly selective CB2 receptor agonists', journal: 'Bioorganic & Medicinal Chemistry', doi: '10.1016/j.bmc.2004.09.050', verified: 'crossref' },
  banister2018: { authors: 'Banister SD, Connor M', year: 2018, title: 'The Chemistry and Pharmacology of Synthetic Cannabinoid Receptor Agonist New Psychoactive Substances: Evolution', journal: 'Handbook of Experimental Pharmacology', doi: '10.1007/164_2018_144', verified: 'crossref' },
  banister2018origins: { authors: 'Banister SD, Connor M', year: 2018, title: 'The Chemistry and Pharmacology of Synthetic Cannabinoid Receptor Agonists as New Psychoactive Substances: Origins', journal: 'Handbook of Experimental Pharmacology', doi: '10.1007/164_2018_143', verified: 'crossref' },
  adams1940: { authors: 'Adams R, Pease DC, Cain CK, Clark JH', year: 1940, title: 'Structure of Cannabidiol. VI. Isomerization of Cannabidiol to Tetrahydrocannabinol, a Physiologically Active Product', journal: 'Journal of the American Chemical Society', doi: '10.1021/ja01866a040', verified: 'crossref' },

  // ── the scheduling record: the Federal Register as the government's own documentation ───────────
  // Each record below was resolved against the Federal Register API on 2026-09-27. The volume-and-page
  // citation, the publication date and the title are as returned. The fuller timeline, the parallel
  // case histories and the enforcement-architecture analysis are on regulatory/the-analogue-treadmill.
  fr2011sc5: { authors: 'Drug Enforcement Administration', year: 2011, title: 'Schedules of Controlled Substances: Temporary Placement of Five Synthetic Cannabinoids Into Schedule I (final order) — JWH-018, JWH-073, JWH-200, CP-47,497 and the CP-47,497 C8 homologue', journal: 'Federal Register 76:11075, 1 March 2011', url: 'https://www.federalregister.gov/documents/2011/03/01/2011-4428/schedules-of-controlled-substances-temporary-placement-of-five-synthetic-cannabinoids-into-schedule', verified: 'url' },
  sdapa2012: { authors: 'United States Congress', year: 2012, title: 'Synthetic Drug Abuse Prevention Act of 2012, Public Law 112-144, title XI subtitle D § 1152 — placing cannabimimetic agents and 26 named substances (15 cannabimimetic agents, 9 phenethylamines and 2 cathinones) into schedule I; signed 9 July 2012', journal: 'Statutes at Large (Food and Drug Administration Safety and Innovation Act)', url: 'https://www.govinfo.gov/content/pkg/PLAW-112publ144/html/PLAW-112publ144.htm', verified: 'statute' },
  fr2013drugcodes: { authors: 'Drug Enforcement Administration', year: 2013, title: 'Establishment of Drug Codes for 26 Substances (final rule) — DEA\'s own account of what the Synthetic Drug Abuse Prevention Act placed in schedule I on 9 July 2012, and of the five synthetic cannabinoids whose permanent-scheduling rulemaking the Act superseded', journal: 'Federal Register 78:664, 4 January 2013', url: 'https://www.federalregister.gov/documents/2013/01/04/2012-31698/establishment-of-drug-codes-for-26-substances', verified: 'url' },
  fr2013sc3: { authors: 'Drug Enforcement Administration', year: 2013, title: 'Schedules of Controlled Substances: Temporary Placement of Three Synthetic Cannabinoids Into Schedule I (final order) — UR-144, 5-fluoro-UR-144 (XLR11) and APINACA (AKB48)', journal: 'Federal Register 78:28735, 16 May 2013', url: 'https://www.federalregister.gov/documents/2013/05/16/2013-11593/schedules-of-controlled-substances-temporary-placement-of-three-synthetic-cannabinoids-into-schedule', verified: 'url' },
  fr2014sc4: { authors: 'Drug Enforcement Administration', year: 2014, title: 'Schedules of Controlled Substances: Temporary Placement of Four Synthetic Cannabinoids Into Schedule I (final order) — PB-22, 5F-PB-22, AB-FUBINACA and ADB-PINACA', journal: 'Federal Register 79:7577, 10 February 2014', url: 'https://www.federalregister.gov/documents/2014/02/10/2014-02848/schedules-of-controlled-substances-temporary-placement-of-four-synthetic-cannabinoids-into-schedule', verified: 'url' },
  fr2023sc6: { authors: 'Drug Enforcement Administration', year: 2023, title: 'Schedules of Controlled Substances: Temporary Placement of MDMB-4en-PINACA, 4F-MDMB-BUTICA, ADB-4en-PINACA, CUMYL-PEGACLONE, 5F-EDMB-PICA, and MMB-FUBICA into Schedule I (final order)', journal: 'Federal Register 88:86040, 12 December 2023', url: 'https://www.federalregister.gov/documents/2023/12/12/2023-27243/schedules-of-controlled-substances-temporary-placement-of-mdmb-4en-pinaca-4f-mdmb-butica', verified: 'url' },
  cowan1986: { authors: 'Cowan RC', year: 1986, title: 'How the Narcs Created Crack — the essay that names the iron law of prohibition: the more intense the enforcement, the more potent the prohibited substance becomes', journal: 'National Review, December 1986; primary text not obtained in this pass', verified: false },
  beletsky2017: { authors: 'Beletsky L, Davis CS', year: 2017, title: "Today's fentanyl crisis: Prohibition's Iron Law, revisited", journal: 'International Journal of Drug Policy', doi: '10.1016/j.drugpo.2017.05.050', verified: 'crossref' },

  // ── product composition, variability and identification ─────────────────────────────────────────
  auwarter2009: { authors: 'Auwärter V, Dresen S, Weinmann W, Müller M, Pütz M, Ferreirós N', year: 2009, title: "'Spice' and other herbal blends: harmless incense or cannabinoid designer drugs?", journal: 'Journal of Mass Spectrometry', doi: '10.1002/jms.1558', verified: 'crossref' },
  dresen2010: { authors: 'Dresen S, Ferreirós N, Pütz M, Westphal F, Zimmermann R, Auwärter V', year: 2010, title: 'Monitoring of herbal mixtures potentially containing synthetic cannabinoids as psychoactive compounds', journal: 'Journal of Mass Spectrometry', doi: '10.1002/jms.1811', verified: 'crossref' },
  frinculescu2016: { authors: 'Frinculescu A, Lyall CL, Ramsey J, Miserez B', year: 2016, title: 'Variation in commercial smoking mixtures containing third-generation synthetic cannabinoids', journal: 'Drug Testing and Analysis', doi: '10.1002/dta.1975', verified: 'crossref' },
  luzio2019: { authors: 'Luzio A, Couceiro J, Ferreira C, Quintas A', year: 2019, title: "Assessing the content of a synthetic cannabinoid 'research chemical' package", journal: 'Annals of Medicine', doi: '10.1080/07853890.2018.1562026', verified: 'crossref' },
  castaneto2015: { authors: 'Castaneto MS, Wohlfarth A, Desrosiers NA, Hartman RL, Gorelick DA, Huestis MA', year: 2015, title: 'Synthetic cannabinoids pharmacokinetics and detection methods in biological matrices', journal: 'Drug Metabolism Reviews', doi: '10.3109/03602532.2015.1029635', verified: 'crossref' },
  emcdda2021: { authors: 'European Monitoring Centre for Drugs and Drug Addiction', year: 2021, title: 'Synthetic cannabinoids in Europe — a review (EU Early Warning System)', journal: 'EMCDDA, Lisbon', verified: false },
  emcdda2017: { authors: 'European Monitoring Centre for Drugs and Drug Addiction', year: 2017, title: 'Perspectives on Drugs: Synthetic cannabinoids in Europe', journal: 'EMCDDA, Lisbon', verified: false },

  // ── clinical toxicity ───────────────────────────────────────────────────────────────────────────
  adams2017: { authors: 'Adams AJ, Banister SD, Irizarry L, Trecki J, Schwartz M, Gerona R', year: 2017, title: "'Zombie' Outbreak Caused by the Synthetic Cannabinoid AMB-FUBINACA in New York", journal: 'New England Journal of Medicine', doi: '10.1056/NEJMoa1610300', verified: 'crossref' },
  trecki2015: { authors: 'Trecki J, Gerona RR, Schwartz MD', year: 2015, title: 'Synthetic Cannabinoid-Related Illnesses and Deaths', journal: 'New England Journal of Medicine', doi: '10.1056/nejmp1505328', verified: 'crossref' },
  castaneto2014: { authors: 'Castaneto MS, Gorelick DA, Desrosiers NA, Hartman RL, Pirard S, Huestis MA', year: 2014, title: 'Synthetic cannabinoids: Epidemiology, pharmacodynamics, and clinical implications', journal: 'Drug and Alcohol Dependence', doi: '10.1016/j.drugalcdep.2014.08.005', verified: 'crossref' },
  hermannsclausen2013: { authors: 'Hermanns-Clausen M, Kneisel S, Szabo B, Auwärter V', year: 2013, title: 'Acute toxicity due to the confirmed consumption of synthetic cannabinoids: clinical and laboratory findings', journal: 'Addiction', doi: '10.1111/j.1360-0443.2012.04078.x', verified: 'crossref' },
  tait2015: { authors: 'Tait RJ, Caldicott D, Mountain D, Hill SL, Lenton S', year: 2015, title: 'A systematic review of adverse events arising from the use of synthetic cannabinoids and their associated treatment', journal: 'Clinical Toxicology', doi: '10.3109/15563650.2015.1110590', verified: 'crossref' },
  thornton2013: { authors: 'Thornton SL, Wood C, Friesen MW, Gerona RR', year: 2013, title: 'Synthetic cannabinoid use associated with acute kidney injury', journal: 'Clinical Toxicology', doi: '10.3109/15563650.2013.770870', verified: 'crossref' },
  mir2011: { authors: 'Mir A, Obafemi A, Young A, Kane C', year: 2011, title: 'Myocardial Infarction Associated With Use of the Synthetic Cannabinoid K2', journal: 'Pediatrics', doi: '10.1542/peds.2010-3823', verified: 'crossref' },
  law2016: { authors: 'Law RK, Schier J, Martin C, Chang A, Wolkin A, Schauben J', year: 2016, title: 'Increase in Adverse Health Effects Related to Synthetic Cannabinoid Use', journal: 'Online Journal of Public Health Informatics', doi: '10.5210/ojphi.v8i1.6479', verified: 'crossref' },
  kelkar2018: { authors: 'Kelkar AH, Smith NA, Martial A, Moole H, Tarantino MD, Roberts JC', year: 2018, title: 'An Outbreak of Synthetic Cannabinoid-Associated Coagulopathy in Illinois', journal: 'New England Journal of Medicine', doi: '10.1056/NEJMoa1807652', verified: 'crossref' },
  hussain2018: { authors: 'Hussain N, Hussain F, Haque D, Saeed S, Jesudas R', year: 2018, title: 'An Outbreak of Brodifacoum Coagulopathy Due to Synthetic Marijuana in Central Illinois', journal: 'Mayo Clinic Proceedings', doi: '10.1016/j.mayocp.2018.05.005', verified: 'crossref' },
  moritz2018: { authors: 'Moritz E, Austin C, Wahl M, DesLauriers C, Navon L, Walblay K, et al.', year: 2018, title: 'Notes from the Field: Outbreak of Severe Illness Linked to the Vitamin K Antagonist Brodifacoum and Use of Synthetic Cannabinoids — Illinois, March–April 2018', journal: 'MMWR (Morbidity and Mortality Weekly Report) 67:607-608', doi: '10.15585/mmwr.mm6721a4', verified: 'crossref' },

  // ── cannabis overconsumption and pharmacokinetics ───────────────────────────────────────────────
  monte2019: { authors: 'Monte AA, Shelton SK, Mills E, Saben J, Hopkinson A, Sonn B, et al.', year: 2019, title: 'Acute Illness Associated With Cannabis Use, by Route of Exposure', journal: 'Annals of Internal Medicine', doi: '10.7326/m18-2809', verified: 'crossref' },
  allen2004: { authors: 'Allen JH, de Moore GM, Heddle R, Twartz JC', year: 2004, title: 'Cannabinoid hyperemesis: cyclical hyperemesis in association with chronic cannabis abuse', journal: 'Gut', doi: '10.1136/gut.2003.036350', verified: 'crossref' },
  huestis2007: { authors: 'Huestis MA', year: 2007, title: 'Human Cannabinoid Pharmacokinetics', journal: 'Chemistry & Biodiversity', doi: '10.1002/cbdv.200790152', verified: 'crossref' },
  lucas2018: { authors: 'Lucas CJ, Galettis P, Schneider J', year: 2018, title: 'The pharmacokinetics and the pharmacodynamics of cannabinoids', journal: 'British Journal of Clinical Pharmacology', doi: '10.1111/bcp.13710', verified: 'crossref' },

  // ── converted and novel cannabinoid products ────────────────────────────────────────────────────
  meehanatrash2022: { authors: 'Meehan-Atrash J, Rahman I', year: 2022, title: 'Novel Δ8-Tetrahydrocannabinol Vaporizers Contain Unlabeled Adulterants, Unintended Byproducts of Chemical Synthesis, and Heavy Metals', journal: 'Chemical Research in Toxicology', doi: '10.1021/acs.chemrestox.1c00388', verified: 'crossref' },
  meehanatrash2021: { authors: 'Meehan-Atrash J, Rahman I', year: 2021, title: 'Cannabis Vaping: Existing and Emerging Modalities, Chemistry, and Pulmonary Toxicology', journal: 'Chemical Research in Toxicology', doi: '10.1021/acs.chemrestox.1c00290', verified: 'crossref' },
  meehanatrash2017: { authors: 'Meehan-Atrash J, Luo W, Strongin RM', year: 2017, title: 'Toxicant Formation in Dabbing: The Terpene Story', journal: 'ACS Omega', doi: '10.1021/acsomega.7b01130', verified: 'crossref' },
  lin2026: { authors: 'Lin K, Sun Y, Raghu R, Suharu P, Effah F, Rahman I', year: 2026, title: 'Toxicity and health effects of delta-8, delta-9, and delta-10-tetrahydrocannabinol and unregulated cannabinoids in vaping products', journal: 'Toxicology Reports', doi: '10.1016/j.toxrep.2026.102202', verified: 'crossref' },
  helander2022: { authors: 'Helander A, Johansson M, Andersson A, Villén T', year: 2022, title: 'Analytical and medico-legal problems linked to the presence of delta-8-tetrahydrocannabinol (delta-8-THC): Results from urine drug testing in Sweden', journal: 'Drug Testing and Analysis', doi: '10.1002/dta.3190', verified: 'crossref' },
  kruger2022: { authors: 'Kruger JS, Kruger DJ', year: 2022, title: "Delta-8-THC: Delta-9-THC's nicer younger sibling?", journal: 'Journal of Cannabis Research', doi: '10.1186/s42238-021-00115-8', verified: 'crossref' },
  burgess2024: { authors: 'Burgess A, Hays HL, Badeti J, Spiller HA, Rine NI, Gaw CE, et al.', year: 2024, title: 'Delta-8 tetrahydrocannabinol, delta-10 tetrahydrocannabinol, and tetrahydrocannabinol-O acetate exposures reported to poison centers', journal: 'Clinical Toxicology', doi: '10.1080/15563650.2024.2340115', verified: 'crossref' },
  fdaDelta8: { authors: 'US Food and Drug Administration', year: 2022, title: 'FDA warns consumers about the accidental ingestion by children of food products containing THC, and about products containing delta-8 THC', journal: 'FDA Consumer Update', verified: false },

  // ── label accuracy and dose control ────────────────────────────────────────────────────────────
  vandrey2015: { authors: 'Vandrey R, Raber JC, Raber ME, Douglass B, Miller C, Bonn-Miller MO', year: 2015, title: 'Cannabinoid Dose and Label Accuracy in Edible Medical Cannabis Products', journal: 'JAMA', doi: '10.1001/jama.2015.6613', verified: 'crossref' },
  bonnmiller2017: { authors: 'Bonn-Miller MO, Loflin MJE, Thomas BF, Marcu JP, Hyke T, Vandrey R', year: 2017, title: 'Labeling Accuracy of Cannabidiol Extracts Sold Online', journal: 'JAMA', doi: '10.1001/jama.2017.11909', verified: 'crossref' },
  johnson2022: { authors: 'Johnson E, Kilgore M, Babalonis S', year: 2022, title: 'Label accuracy of unregulated cannabidiol (CBD) products: measured concentration vs. label claim', journal: 'Journal of Cannabis Research', doi: '10.1186/s42238-022-00140-1', verified: 'crossref' },
  johnsonarbor2023: { authors: 'Johnson-Arbor K', year: 2023, title: 'Regional Cannabis Edible Variability in the United States (letter)', journal: 'Cannabis and Cannabinoid Research', doi: '10.1089/can.2022.0302', verified: 'crossref' },

  // ── outbreak literature, contaminants and hardware ─────────────────────────────────────────────
  blount2020: { authors: 'Blount BC, Karwowski MP, Shields PG, Morel-Espinosa M, Valentin-Blasini L, Gardner M, et al.', year: 2020, title: 'Vitamin E Acetate in Bronchoalveolar-Lavage Fluid Associated with EVALI', journal: 'New England Journal of Medicine', doi: '10.1056/NEJMoa1916433', verified: 'crossref' },
  wu2020: { authors: "Wu D, O'Shea DF", year: 2020, title: 'Potential for release of pulmonary toxic ketene from vaping pyrolysis of vitamin E acetate', journal: 'Proceedings of the National Academy of Sciences', doi: '10.1073/pnas.1920925117', verified: 'crossref' },
  krishnasamy2020: { authors: 'Krishnasamy VP, Hallowell BD, Ko JY, Board A, Hartnett KP, Salvatore PP, et al.', year: 2020, title: 'Update: Characteristics of a Nationwide Outbreak of E-cigarette, or Vaping, Product Use-Associated Lung Injury — United States, August 2019–January 2020', journal: 'MMWR (Morbidity and Mortality Weekly Report) 69:90-94', doi: '10.15585/mmwr.mm6903e2', verified: 'crossref' },
  olmedo2018: { authors: 'Olmedo P, Goessler W, Tanda S, Grau-Perez M, Jarmul S, Aherrera A, et al.', year: 2018, title: 'Metal Concentrations in e-Cigarette Liquid and Aerosol Samples: The Contribution of Metallic Coils', journal: 'Environmental Health Perspectives', doi: '10.1289/ehp2175', verified: 'crossref' },
  sullivan2013: { authors: 'Sullivan N, Elzinga S, Raber JC', year: 2013, title: 'Determination of Pesticide Residues in Cannabis Smoke', journal: 'Journal of Toxicology', doi: '10.1155/2013/378168', verified: 'crossref' },

  // ── standards, compendia and public-health services ────────────────────────────────────────────
  iso17025: { authors: 'International Organization for Standardization / International Electrotechnical Commission', year: 2017, title: 'ISO/IEC 17025:2017 General requirements for the competence of testing and calibration laboratories', journal: 'ISO', verified: 'standard' },
  usp905: { authors: 'United States Pharmacopeia', year: 2023, title: 'General Chapter <905> Uniformity of Dosage Units', journal: 'USP-NF', verified: 'standard' },
  usp467: { authors: 'United States Pharmacopeia', year: 2023, title: 'General Chapter <467> Residual Solvents', journal: 'USP-NF', verified: 'standard' },
  poisonCenters: { authors: "America's Poison Centers (formerly the American Association of Poison Control Centers)", year: 2025, title: 'Poison Help line, 1-800-222-1222 — free, confidential, staffed 24 hours a day by nurses, pharmacists and toxicologists', journal: 'US national poison centre network', verified: false },
});

/**
 * PAGES — each becomes one wiki page at /science/safety/<slug>.
 */
export const PAGES = F([

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'k2-what-went-wrong',
    title: 'K2 and Spice: What Actually Went Wrong',
    kind: 'safety',
    summary: 'The documented mechanism, in the right order, and it has two halves. Scheduling was the selection pressure that chose the compound — the Federal Register records the market being driven from the JWH naphthoylindoles up to the indazole carboxamides at every enforcement step, not out of existence. And the distribution layer could not handle what it was given: bulk powder sprayed onto inert plant material by distributors with no balance, no dose calculation and no homogeneity control, with analytical identification permanently behind the analogue turnover. Layer three did the killing mechanically; the regime is what put a full agonist in layer three\'s hands instead of a partial one. The hazard was consuming an unidentified compound of unknown pharmacology at an unknown and non-uniform dose. It was not a knowledge gap about how to make them.',
    facts: F({
      'JWH-018': 'CB1 affinity reported at roughly 9 nM, full agonist',
      'Δ9-THC': 'CB1 affinity reported at 40.7 nM, partial agonist with a ceiling effect',
      'Later generations': 'indole and indazole carboxamides — AB-FUBINACA, AMB-FUBINACA, 5F-ADB, MDMB-CHMICA — more potent again',
      'The selection pressure': 'scheduling. Five JWH- and CP-type compounds temporarily scheduled 1 Mar 2011 (76 FR 11075), placed in schedule I by statute 9 Jul 2012 (Pub. L. 112-144 § 1152); successors scheduled 16 May 2013 (78 FR 28735) and 10 Feb 2014 (79 FR 7577); still running 12 Dec 2023 (88 FR 86040)',
      'Direction of travel': 'UP the potency curve, not out of existence — naphthoylindoles, then tetramethylcyclopropanoyl indoles, then the indazole carboxamides',
      'The documented outbreak': 'Brooklyn, July 2016; a packaged herbal product containing AMB-FUBINACA — an indazole carboxamide from the generation that arrived after the 2011 and 2012 actions',
      'The killing layer': 'distributors spraying bulk powder in solvent onto inert plant material with hand sprayers',
      'The analytical gap': 'analogue turnover outran reference standards and toxicology; routine immunoassay screens did not detect these compounds at all',
      'The lesson': 'unidentified compound, unknown pharmacology, unknown and non-uniform dose — on a molecule the regime selected',
    }),
    sections: F([
      F({
        h: 'The pharmacology: no ceiling effect',
        body: 'Δ9-tetrahydrocannabinol is a partial agonist at the CB1 receptor, with binding affinity reported at 40.7 nM in the transfected-cell work that established the comparative figures. Partial agonism has a specific and protective consequence: beyond a certain level of receptor occupancy, more drug does not produce more maximal effect, so the dose-response curve flattens. That ceiling is a large part of why acute cannabis overconsumption is characteristically an unpleasant few hours rather than a medical emergency. The compounds that became K2 and Spice are structurally unrelated to THC and pharmacologically different in the way that matters most. JWH-018, the first-generation naphthoylindole in wide circulation, has reported CB1 affinity around 9 nM — roughly an order of magnitude tighter than Δ9-THC — and behaves as a full agonist, meaning its dose-response curve keeps climbing where THC would have flattened. The clinical consequence of a full agonist with high affinity and no ceiling is a toxicology that cannabis does not have: seizures including status epilepticus, tachyarrhythmias, myocardial ischaemia and documented infarction in young people with no coronary disease, extreme hypertension or hypotension, hyperthermia, agitated delirium, rhabdomyolysis, acute kidney injury, and deaths. Later generations made this worse rather than better. The indole and indazole carboxamides — AB-FUBINACA, AMB-FUBINACA, 5F-ADB, MDMB-CHMICA and their relatives — are substantially more potent again, which compressed the already-thin margin between an active and a harmful quantity and reduced the mass of material needed to produce a severe outcome to a level that no distribution method in use could control.',
        cites: F(['showalter1996', 'huffman2005', 'banister2018', 'banister2018origins', 'castaneto2014', 'hermannsclausen2013', 'tait2015', 'mir2011', 'thornton2013']),
        contested: true,
        caveat: 'The affinity figures are single-laboratory values from different assay systems and years and are not directly comparable to two significant figures; they establish an order-of-magnitude difference and the partial-versus-full agonist distinction, not a precise ratio. Potency comparisons between later-generation compounds come largely from in-vitro functional assays, since no human dose-response data exist for most of them.',
        evidence: 'in vitro',
      }),
      F({
        h: 'The Brooklyn case series, as the documented example',
        body: 'On 12 July 2016 a large group of people in one neighbourhood of Brooklyn presented simultaneously with a strikingly uniform picture: profound sedation with blank staring, slow and mechanical limb movements, minimal verbal response, and slow groaning — a presentation distinct enough from ordinary intoxication that it was reported publicly in those terms. Thirty-three people were affected in the cluster and a substantial number were transported to hospital. Analysis of the packaged herbal product recovered from the scene identified AMB-FUBINACA, a methylated indazole carboxamide from a generation of compounds far more potent than the earlier naphthoylindoles, present at a high loading in the plant material, with the de-esterified metabolite identified in patient serum. The case is the best-documented instance in the literature of the specific pattern that characterises this era: not a steady rate of individual harms, but a burst of severe presentations from one product in one place at one time. That epidemiological shape is the fingerprint of variance inside a batch, because a uniformly formulated product produces harm in proportion to how much of it is used, while a heterogeneous one produces harm in clusters wherever the concentrated material lands. Poison-centre and emergency-department surveillance through the same period recorded exactly this bursty structure, with sharp regional spikes tied to particular products.',
        cites: F(['adams2017', 'law2016', 'trecki2015', 'emcdda2017']),
        evidence: 'human',
      }),
      F({
        h: 'Scheduling was the selection pressure, not the background',
        body: 'An earlier revision of this page put the whole causal weight on the distribution and formulation layer and treated the scheduling regime as neutral scenery — the setting in which a formulation failure happened. That was wrong, and it is worth correcting in the same place it was asserted, because the regime is the mechanism that decided WHICH molecule the formulation failure was performed on. The evidence is not an inference; it is the government\'s own record, and it reads as a sequence rather than as a series of unrelated enforcement actions. On 1 March 2011 the Drug Enforcement Administration temporarily placed five compounds in schedule I by final order: JWH-018, JWH-073, JWH-200, CP-47,497 and the CP-47,497 C8 homologue. Those five were made permanent on 9 July 2012, and by statute rather than by rule — the Synthetic Drug Abuse Prevention Act of 2012, title XI subtitle D section 1152 of Public Law 112-144, which placed them and a further set of substances directly into schedule I and added a structural-class definition of cannabimimetic agents; the agency\'s own implementing rule of 4 January 2013 sets out exactly what that Act covered and states that the pending permanent-scheduling rulemaking for the five cannabinoids had thereby been superseded. What replaced them was not nothing. By 16 May 2013 the agency was temporarily scheduling UR-144, 5-fluoro-UR-144 (XLR11) and APINACA (AKB48); by 10 February 2014 it was temporarily scheduling PB-22, 5F-PB-22, AB-FUBINACA and ADB-PINACA. AB-FUBINACA is the parent compound of the generation that produced the Brooklyn mass-casualty event two and a half years after that order. The sequence has not stopped and is not historical: on 12 December 2023 the agency temporarily scheduled MDMB-4en-PINACA, 4F-MDMB-BUTICA, ADB-4en-PINACA, CUMYL-PEGACLONE, 5F-EDMB-PICA and MMB-FUBICA. Read forward rather than as isolated notices, that record documents a market being driven UP the potency and danger curve rather than out of existence, and the direction of travel is the same at every turn: naphthoylindoles of the JWH type, then the tetramethylcyclopropanoyl indoles, then the indazole carboxamides whose clinical signature is the mass simultaneous severe presentation. That is the phenomenon Richard Cowan named the iron law of prohibition in 1986 and that Beletsky and Davis revisited for the fentanyl era — enforcement pressure on a supply chain is a selection pressure, and what it selects for is effect per unit of detectable mass. The four-layer analysis below is the other half of the cause and it still stands: layer three did the killing, mechanically. But a hand sprayer and a plastic bin are survivable with a partial agonist and are not survivable with a full agonist an order of magnitude tighter at the receptor, and it was the scheduling sequence, not the sprayer, that put the second compound in the bin. The general argument, with its parallel case histories in the phenethylamines and the opioids and with the enforcement-architecture evidence, is on the regulatory shelf.',
        table: F({
          cols: F(['Date', 'Action', 'Compounds', 'Federal Register / statute']),
          rows: F([
            F(['1 Mar 2011', 'temporary placement in schedule I, final order', 'JWH-018, JWH-073, JWH-200, CP-47,497, CP-47,497 C8 homologue', '76 FR 11075']),
            F(['9 Jul 2012', 'permanent placement, by statute rather than by rule', 'the same five, plus a cannabimimetic-agent class definition', 'Pub. L. 112-144, tit. XI subtit. D § 1152']),
            F(['4 Jan 2013', "the agency's implementing rule and its own account of the Act", 'drug codes for the 26 substances the Act scheduled', '78 FR 664']),
            F(['16 May 2013', 'temporary placement — the successor generation', 'UR-144, XLR11 (5-fluoro-UR-144), APINACA (AKB48)', '78 FR 28735']),
            F(['10 Feb 2014', 'temporary placement — the indazole carboxamides arrive', 'PB-22, 5F-PB-22, AB-FUBINACA, ADB-PINACA', '79 FR 7577']),
            F(['12 Jul 2016', 'the Brooklyn event, from a product containing AMB-FUBINACA', 'not an enforcement action — the consequence of the preceding row', 'Adams et al. 2017, NEJM']),
            F(['12 Dec 2023', 'temporary placement — the sequence still running', 'MDMB-4en-PINACA, 4F-MDMB-BUTICA, ADB-4en-PINACA, CUMYL-PEGACLONE, 5F-EDMB-PICA, MMB-FUBICA', '88 FR 86040']),
          ]),
        }),
        cites: F(['fr2011sc5', 'sdapa2012', 'fr2013drugcodes', 'fr2013sc3', 'fr2014sc4', 'fr2023sc6', 'cowan1986', 'beletsky2017', 'banister2018', 'adams2017', 'emcdda2021']),
        evidence: 'human',
      }),
      F({
        h: 'What actually changed between the generations, stated without the claim that the first ones were safe',
        body: 'The selection argument requires a statement about how the generations differed, and that statement is easy to overstate into something false. The honest version is this: the early JWH-era products had an effect profile and a case-report severity markedly different from the later indazole carboxamides. That is not the same proposition as "the early compounds were relatively safe", and this page does not assert the second. JWH-018 is a full agonist at CB1 with reported affinity around 9 nM against 40.7 nM for Δ9-THC; it has no ceiling effect; it produced seizures, tachyarrhythmias, documented myocardial infarction in young people without coronary disease, acute kidney injury and deaths, and it did so from the beginning. The difference is one of degree and of the shape the harm takes, and both halves matter. On degree: the indazole carboxamides are substantially more potent again on in-vitro functional measures, which compressed the already-thin margin between an active and a harmful quantity and reduced the mass needed for a severe outcome to a level no distribution method in use could control. On shape: the characteristic event of the later era is the burst — a cluster of severe, strikingly uniform presentations from one product in one place at one time, which is the epidemiological fingerprint of a compound so potent that ordinary batch heterogeneity becomes lethal heterogeneity. The early-era record is a steadier stream of individual severe cases; the later-era record is punctuated by mass events. What the generational comparison establishes, then, is not that prohibition made a safe thing dangerous. It is that prohibition made a dangerous thing more dangerous, repeatedly, in a documented direction, while never reducing availability — which is the only claim the evidence supports and the only one worth making.',
        bullets: F([
          'What is NOT claimed: that the JWH-era products were safe. They were full agonists with no ceiling and they killed people.',
          'What IS claimed: the effect profile and the case-report severity differed markedly from the later indazole carboxamides.',
          'Degree: later generations are substantially more potent on in-vitro functional measures, compressing the active-to-harmful margin.',
          'Shape: the later era is punctuated by mass simultaneous events, the fingerprint of lethal heterogeneity inside one batch.',
          'The supportable conclusion: prohibition made a dangerous thing more dangerous, repeatedly, without reducing availability.',
        ]),
        cites: F(['showalter1996', 'huffman2005', 'banister2018', 'banister2018origins', 'adams2017', 'trecki2015', 'tait2015', 'castaneto2014', 'emcdda2021']),
        contested: true,
        caveat: 'FLAGGED. Any statement that the early JWH-era products were "relatively safe" is not supported and is not made here — they were full CB1 agonists with no ceiling effect and a documented record of seizures, cardiac events and deaths. What is supported is a marked difference in effect profile and in case-report severity between the generations. The potency comparison between generations rests on in-vitro functional assays, since no human dose-response data exist for most of these compounds, and the generational contrast in case severity is drawn from case series and surveillance data collected under different reporting regimes in different years, which is not a controlled comparison.',
        evidence: 'in vitro',
      }),
      F({
        h: 'The supply chain failed in four distinct layers — and conflating them produces the wrong lesson',
        body: 'This is the second half of the causal account, and it matters because the popular account collapses four different failures into one and then draws a conclusion that is the opposite of useful. Everything in this section is downstream of the selection argument above: the regime chose the molecule, and then these four layers decided what happened to it. Layer one: origin. These compounds were academic tool compounds. The JWH series came out of John W. Huffman\'s published structure-activity research on cannabinoid receptor ligands, work done to probe receptor pharmacology, with structures and binding data in the open literature as normal science. They had never been through human toxicology, because nobody had ever proposed giving them to people. Layer two: manufacture. Bulk production was carried out by contract chemical producers, predominantly off-shore, operating with no pharmaceutical quality system — no identity confirmation, no purity specification, no impurity profiling, no batch records worth the name. The powder that arrived was of uncertain identity and uncertain purity before anyone touched it. Layer three, and this is the layer that did the killing: formulation. Distributors received powder and had to turn it into a retail product, which meant getting a few grams of an extremely potent compound distributed across kilograms of inert plant matter. They did it with solvent and hand sprayers, in bins, drums and cement mixers. They had no balance capable of accurately weighing the input mass, no calculation of dose per gram of finished product, no capacity to assay anything, and no way whatsoever to check whether the result was uniform. It was not uniform, and analyses of seized commercial mixtures document substantial variation in active content between products and within packages. That non-uniformity is what turned an unknown dose into a lethal lottery: the same bag could be tolerable in one portion and a massive overdose in the next, and the user had no sensory cue and no prior-experience defence against it. Layer four: downstream improvisation. Further down still were people with no access to even the retail product, improvising with household and agricultural chemicals on plant material — the cases usually reported as bug spray. That layer is a consequence of the first three plus an information vacuum, not a separate moral failing, and it is described properly on the adulterants page — where the pharmacology of the insecticide formulations involved, and the measured transfer of pesticide residues into mainstream smoke rather than their destruction by combustion, are set out. Layer three also let contaminants straight through, and the clearest documented instance is the spring 2018 Illinois-centred outbreak in which synthetic-cannabinoid products carried the long-acting anticoagulant rodenticide brodifacoum, producing hundreds of cases of coagulopathy, several deaths, and a treatment requirement of months of high-dose vitamin K1 — a contaminant nobody had thought to warn about, in a supply chain with no analysis anywhere in it. Now the point of separating the layers. Layer one was published science and cannot be unpublished. Layer two was an industrial quality failure. Layer four was desperation. Layer three — formulation and dosing of an already-obtained compound — is the one that produced the deaths, and it is also the only one that better information could have directly prevented. And sitting above all four, as the previous section sets out, is the regime: it did not cause the formulation failure, but it selected the molecule that the formulation failure was committed on, and every scheduling action moved that molecule further up the potency curve. The lesson that was actually drawn instead was that nobody should be told anything about any of it, which left the people in layers three and four with exactly the knowledge they had before, left the regime free to keep selecting, and guaranteed the failure would repeat.',
        table: F({
          cols: F(['Layer', 'What happened', 'What was missing', 'Would information have helped?']),
          rows: F([
            F(['0. The regime', 'each scheduling action displaced the market onto a less characterised, more potent successor — 2011, 2012, 2013, 2014, and still in 2023', 'any instrument aimed at testing, identification and labelling rather than at named structures', 'Not an information gap — an instrument-design failure. It chose which compound layer 3 handled']),
            F(['1. Origin', 'published academic structure-activity pharmacology; compounds and binding data in the open literature', 'human toxicology — never intended for human use', 'Not applicable; the science was public and correctly so']),
            F(['2. Bulk manufacture', 'contract production off-shore at scale', 'identity confirmation, purity specification, impurity profiling, batch records', 'A quality system, not an information gap']),
            F(['3. Formulation and distribution', 'bulk powder sprayed in solvent onto inert plant material with hand sprayers', 'an adequate balance, dose-per-gram arithmetic, homogeneity control, any assay at all', 'YES — directly. This is the layer that killed people and the gap this library closes']),
            F(['4. Downstream improvisation', 'household and agricultural chemicals applied to plant material', 'any accurate information at all, and access to an identified product', 'YES — and withholding it is what produced the behaviour']),
          ]),
        }),
        cites: F(['huffman2005', 'banister2018origins', 'frinculescu2016', 'auwarter2009', 'dresen2010', 'luzio2019', 'sullivan2013', 'kelkar2018', 'hussain2018', 'moritz2018', 'emcdda2021', 'fr2011sc5', 'fr2014sc4']),
        evidence: 'human',
      }),
      F({
        h: 'The analytical failure: identification could not keep up',
        body: 'Running alongside the formulation failure was an identification failure that made every other problem unmanageable. New analogues appeared faster than the analytical infrastructure could characterise them. Identifying a compound in a seized or clinical sample requires an authentic reference standard — the pure, known material against which a retention time, a mass spectrum and a fragmentation pattern become a name — and standards have to be synthesised, characterised and distributed, which takes months. Toxicology takes longer still. The consequence was that for much of this period neither forensic laboratories nor hospitals could reliably say what was in a product or in a patient, which meant clinicians were treating an unknown, surveillance systems could not attribute harms to compounds, and users could not have been informed of what they were taking even by someone who wanted to inform them. Compounding this, routine urine immunoassay drug screens — the tests actually available in an emergency department — do not detect these compounds at all, because the antibodies are raised against THC metabolites and the synthetic agonists are structurally unrelated. A negative cannabinoid screen in a patient with a florid toxidrome was therefore uninformative and, worse, was sometimes read as evidence against drug involvement. Confirmatory methods existed but required targeted mass spectrometry with the right standards, available in reference laboratories and not in real time. The legal driver made the cycle self-sustaining: each scheduling action against a named compound or a defined structural class created commercial pressure to move to the next structure that was not yet named, which by construction was the one with even less toxicology and no reference standard. Regulation aimed at structures rather than at testing and labelling selected directly for uncharacterised compounds. That is not a characterisation of the regime imposed from outside it: the dates line up in the Federal Register itself, with each temporary-scheduling order followed within a year or two by an order naming the successor structures, and the analytical infrastructure never once catching up.',
        cites: F(['castaneto2015', 'emcdda2017', 'emcdda2021', 'banister2018', 'trecki2015', 'fr2013sc3', 'fr2014sc4', 'fr2023sc6']),
        evidence: 'human',
      }),
      F({
        h: 'The lesson, stated so it cannot be misread',
        body: 'The hazard was consuming an unidentified compound, of unknown pharmacology, at an unknown and non-uniform dose — and the compound in question was the one the scheduling sequence had most recently selected for. Each of those three unknowns was independently sufficient to hurt someone and they arrived together, on a molecule that was in circulation because its predecessor had been named in a schedule. It was not a knowledge gap about how to make these compounds — that knowledge was in the published literature the whole time, which is where the bulk manufacturers got it, and no amount of withholding it from the public had any effect on their supply. What was withheld from the people actually at risk was the other material: how to tell what you have, why uneven distribution across a carrier produces a lethal variance inside one batch, what a milligram-scale dose means and why a kitchen scale cannot measure one, why solution-phase volumetric handling is the only reliable approach at that scale, how long to wait before re-dosing on each route, why tolerance built on a partial agonist does not protect against a full one, and what the emergency signs are. All of that is formulation, dosing, identification and recognition information about an already-obtained substance. Every piece of it would have reduced harm, and every piece of it was refused on the grounds that providing it would encourage use. It did not reduce use. It produced a decade and a half in which the only available information was what one unregulated seller told another. That is the reasoning behind this section of the library, and it is why the formulation shelf exists as a full technical reference rather than a warning page.',
        bullets: F([
          'Unidentified compound: no reference standard, no name, no immunoassay detection.',
          'Unknown pharmacology: full agonists with no ceiling effect and no human toxicology.',
          'Unknown and non-uniform dose: hot spots inside a single package, invisible to the user.',
          'And the compound was there because the regime had scheduled the last one — the selection pressure is part of the lesson, not context for it.',
          'The synthesis was never the secret. The formulation, dosing and recognition knowledge was what was withheld.',
        ]),
        cites: F(['adams2017', 'castaneto2014', 'castaneto2015', 'frinculescu2016', 'trecki2015', 'emcdda2021', 'fr2011sc5', 'beletsky2017']),
        evidence: 'human',
      }),
      F({
        h: 'Why this is not only history',
        body: 'The structural preconditions are all still present, in a legal market rather than a head-shop one. Potent compounds circulate for which no human dose-response data exist and no validated quantitative method or commercial reference standard is available, which means a number printed beside a novel cannabinoid name on a label cannot have been measured in the ordinary analytical sense. Formulation is carried out by processors whose analytical capability ranges from full in-house chromatography to none. Diluents continue to be selected for physical properties rather than inhalation toxicology, which is precisely the EVALI mechanism: vitamin E acetate was adopted because it was viscous and looked right in a cartridge, was then identified in the bronchoalveolar-lavage fluid of nearly every case patient and none of the healthy comparators in the national investigation, and has been shown to release the pulmonary toxicant ketene on heating. Hardware contributes its own exposure independently of the formulation, with metals shed from heating coils measured in e-cigarette liquid and aerosol. And the same regulatory reflex is not merely available, it is the one currently being reached for: pressure aimed at compounds and at structures rather than at testing, labelling and traceability again selects for whichever molecule is furthest outside the current definition and therefore least characterised. The scheduling record above is the proof that this is what that reflex does, and the federal redefinition of hemp taking effect in November 2026 is an instrument of exactly the kind — a quantity threshold on a named analyte class, indifferent to potency — which is why the market-consequence and treadmill pages on the regulatory shelf belong in the same reading as this one. The distinguishing features of a market that does not repeat the K2 outcome are analytical identification against authentic standards, verified dose uniformity, honest per-unit labelling, and information given to the people taking the risk. Those are the four things this shelf and the formulation shelf are about, and none of them is a scheduling action.',
        cites: F(['meehanatrash2022', 'lin2026', 'blount2020', 'wu2020', 'krishnasamy2020', 'olmedo2018', 'burgess2024', 'banister2018', 'fr2023sc6', 'beletsky2017']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['formulation/hot-spots', 'formulation/dose-arithmetic', 'formulation/adulterants', 'formulation/titration', 'safety/toxidrome', 'safety/converted-cannabinoid-products', 'cannabinoids/jwh-distinction', 'regulatory/analogue-act', 'regulatory/the-analogue-treadmill', 'regulatory/market-consequences']),
    cites: F(['showalter1996', 'huffman2005', 'banister2018', 'banister2018origins', 'castaneto2014', 'castaneto2015', 'hermannsclausen2013', 'tait2015', 'mir2011', 'thornton2013', 'adams2017', 'law2016', 'trecki2015', 'emcdda2017', 'emcdda2021', 'frinculescu2016', 'auwarter2009', 'dresen2010', 'luzio2019', 'sullivan2013', 'kelkar2018', 'hussain2018', 'moritz2018', 'meehanatrash2022', 'lin2026', 'blount2020', 'wu2020', 'krishnasamy2020', 'olmedo2018', 'burgess2024', 'fr2011sc5', 'sdapa2012', 'fr2013drugcodes', 'fr2013sc3', 'fr2014sc4', 'fr2023sc6', 'cowan1986', 'beletsky2017']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'converted-cannabinoid-products',
    title: 'Converted Cannabinoid Products: What the Surveys Found',
    kind: 'safety',
    summary: 'The live hemp-industry issue, stated as what the published product analyses actually report: residual acid catalysts and reaction solvents, unreacted starting material, multiple unidentified isomers and side-products showing up as unassigned chromatographic peaks, olivetol- and resorcinol-related impurities, catalyst metals that a standard four-metal panel does not look for, and label potency that does not match assay in both directions. An unassigned peak is an unidentified compound being consumed.',
    facts: F({
      'The transformation': 'a ring closure under acid catalysis, documented in the literature from Adams 1940 onward; no procedure appears anywhere in this library',
      'Residual catalyst and solvent': 'reported in retail Δ8-THC vaporiser product surveys',
      'Unassigned peaks': 'multiple unidentified isomers and side-products, frequently a substantial share of total cannabinoid chromatographic area',
      'Impurities': 'unreacted cannabidiol, Δ9-THC, and olivetol- and resorcinol-related species',
      'Metals': 'catalyst-attributable metals, which the standard lead/arsenic/cadmium/mercury panel does not seek',
      'Label accuracy': 'repeatedly found divergent from assay, in both directions',
      'Why peaks stay unassigned': 'usually the absence of a reference standard, not laboratory negligence',
    }),
    sections: F([
      F({
        h: 'What this page is and is not',
        body: 'Δ8-THC, Δ10-THC, tetrahydrocannabinol acetates, hexahydrocannabinol and a growing list of related compounds reach the market as products made by chemically transforming cannabidiol rather than by extracting the target cannabinoid from a plant that contains it in quantity. At the level of structure the transformation is a ring closure under acid catalysis, a reaction documented in the chemical literature from Adams and colleagues in 1940 onward, and it is chemically facile. That structural statement is the entirety of what this library says about how it is done: no reagents, no catalysts, no solvents, no concentrations, no temperatures, no times, no work-ups and no yields appear here or anywhere else in this section. What this page is about is the other half of the question, the half that is directly a consumer and buyer safety matter and is well covered in the published analytical literature: what the finished products have actually been found to contain when independent investigators assayed them.',
        cites: F(['adams1940', 'meehanatrash2022', 'lin2026']),
        evidence: 'human',
      }),
      F({
        h: 'What the product surveys report',
        body: 'The findings across the published surveys are consistent enough to summarise as a pattern. Residual reaction solvents and residual acid catalyst have been detected in retail products, which is the expected consequence of a transformation and purification step performed outside a pharmaceutical quality framework. Unreacted starting material is present, so cannabidiol frequently appears in a product sold as Δ8-THC, as does Δ9-THC — which matters legally as well as pharmacologically, because a product marketed on its non-Δ9 identity may contain quantities of Δ9-THC sufficient to produce both effects and positive drug tests. The most consistent and least discussed finding is the presence of multiple additional cannabinoid-like species: isomers, regioisomers and side-products that appear in chromatograms as peaks the laboratory cannot name, sometimes accounting for a substantial share of total cannabinoid chromatographic area in a given sample. Olivetol- and resorcinol-related impurities, traceable to the starting materials and side-reactions, have been reported. Metals attributable to catalysis and to processing equipment have been reported alongside the metals contributed by vaping hardware. And running through all of it is a label-accuracy problem: measured content diverging from label claim in both directions, which is the same finding as the broader cannabinoid-product literature has repeatedly produced for CBD extracts and edibles. Poison-centre data for Δ8-THC, Δ10-THC and THC-O-acetate exposures document that these products are producing clinical presentations at scale, including in children, which is the downstream consequence of an unlabelled and unverified dose reaching a general retail channel.',
        table: F({
          cols: F(['Finding', 'What it is', 'Why it matters', 'Would a standard panel catch it?']),
          rows: F([
            F(['Residual solvent', 'reaction and processing solvents retained in a viscous product', 'inhaled solvent has no first pass and a pyrolysis route', 'Only if that solvent is on the panel and the panel was ordered']),
            F(['Residual acid catalyst', 'catalyst species carried through', 'direct irritant and corrosive potential; a marker of poor purification', 'Generally no — not a routine cannabis analyte']),
            F(['Unreacted starting material', 'cannabidiol remaining in the product', 'the product is not what the label says; potency arithmetic is wrong', 'Yes, on a full cannabinoid panel']),
            F(['Δ9-THC content', 'Δ9 present in a product sold as non-Δ9', 'pharmacological effect and drug-test consequences the buyer did not expect', 'Yes, if Δ9 is reported rather than only the headline cannabinoid']),
            F(['Unassigned peaks', 'isomers and side-products with no identification', 'unidentified compounds being consumed, with no toxicology', 'They appear as peaks; naming them requires a reference standard']),
            F(['Olivetol and resorcinol species', 'starting-material and side-reaction impurities', 'unassessed for inhalation or ingestion at the levels present', 'No — not routine analytes']),
            F(['Catalyst metals', 'metals from catalysis and equipment', 'the four-metal panel was designed for agricultural inputs, not conversions', 'No — needs a broader elemental scan']),
            F(['Label-assay divergence', 'measured potency above or below the claim', 'the dose the consumer computes is wrong in an unknown direction', 'Yes — which is why a batch-matched COA is the whole point']),
          ]),
        }),
        cites: F(['meehanatrash2022', 'lin2026', 'helander2022', 'burgess2024', 'meehanatrash2021', 'meehanatrash2017']),
        contested: true,
        caveat: 'These are findings from a modest number of product surveys on samples purchased at particular times in particular markets, and the proportion of products affected and the magnitude of each finding vary considerably between studies. They establish that these contaminants and unassigned species are present in commercial products and that label accuracy is unreliable; they do not establish a prevalence figure for the market as a whole, and a well-run processor with real analytical control is not described by them.',
        evidence: 'human',
      }),
      F({
        h: 'An unassigned peak is an unidentified compound being consumed',
        body: 'This deserves to be pulled out, because it is the finding with the largest gap between its importance and the attention it gets. When a chromatogram of a cannabinoid product shows peaks that the report does not name, the honest reading is that the product contains compounds nobody has identified, in quantities that are sometimes not small, and that are being inhaled or ingested. The usual reason they stay unassigned is not laziness or negligence on the laboratory\'s part. Identifying a peak requires an authentic reference standard of the suspected compound to match retention and spectral behaviour against, and for novel isomers and side-products of a conversion no such standard is commercially available; a laboratory can often say a peak is cannabinoid-like from its mass spectrum and ultraviolet absorbance while being genuinely unable to name it. That is a structural gap in the analytical supply chain, the same gap that made the synthetic-cannabinoid era unmanageable, appearing again in a legal market. It follows that the correct thing for a buyer or a processor to ask for is not a certificate with no unassigned peaks — which is often unobtainable and is easy to fake by simply not reporting them — but a certificate that reports them honestly: total cannabinoid mass balance, the percentage of chromatographic area that is unassigned, and a statement of which compounds were sought against standards. A report that accounts for 100 percent of a sample with four named cannabinoids and no discussion of the remainder is either a very clean product or an incomplete report, and the report itself should tell you which.',
        bullets: F([
          'A named peak is a measurement. An unassigned peak is an unidentified compound present in the product.',
          'Peaks usually stay unassigned because no reference standard exists, not because the laboratory failed.',
          'Ask for mass balance and the unassigned fraction, not for a certificate with nothing unexplained on it.',
          'A report that names four cannabinoids and is silent about everything else has not told you the composition.',
        ]),
        cites: F(['meehanatrash2022', 'castaneto2015', 'iso17025', 'lin2026']),
        evidence: 'human',
      }),
      F({
        h: 'What a processor or a buyer can actually ask for',
        body: 'The practical content of this page is a request list, and every item on it is something a competent processor either has or can obtain. A batch-matched certificate of analysis from a laboratory accredited to ISO/IEC 17025 with the relevant analytes inside its declared scope, rather than a certificate from an unspecified laboratory or one accredited for a different matrix. A full panel rather than potency alone: cannabinoid profile, residual solvents, heavy metals, pesticides, mycotoxins, and microbiological where the matrix warrants it. For a converted product specifically, an elemental scan broad enough to cover catalyst metals rather than the four-metal agricultural list, and residual-solvent analytes that include the solvents actually used in the conversion and purification rather than only the ones used in extraction. Explicit reporting of the unassigned chromatographic fraction and a total-cannabinoid mass balance. A named compound identity, using the actual chemical name and, where they exist, a CAS number and the specified isomer and stereochemistry — a label reading Δ8 without specifying which compounds are present in what proportion is a marketing term, not an identity. Per-serving and per-container milligram figures, computed and stated rather than left to the buyer. And for any unit-dose product, evidence of dose uniformity rather than a single composite assay: increments sampled from different points in the batch, assayed individually, with the spread reported. A supplier who can provide that list is running a real quality operation; a supplier who treats the request as unreasonable has answered the question.',
        bullets: F([
          'Batch-matched COA, ISO/IEC 17025 laboratory, relevant analytes inside the declared scope.',
          'Full panel, not potency-only, on any converted or novel product.',
          'Residual-solvent analytes that match the solvents actually used, including in conversion and purification.',
          'Elemental scan broad enough for catalyst metals, not only lead, arsenic, cadmium and mercury.',
          'Unassigned-peak reporting and total-cannabinoid mass balance.',
          'Actual chemical identity — compound, isomer, stereochemistry, CAS where it exists.',
          'Per-serving and per-container milligram figures, and dose-uniformity evidence for unit-dose products.',
        ]),
        cites: F(['iso17025', 'usp905', 'usp467', 'meehanatrash2022', 'vandrey2015']),
        evidence: 'human',
      }),
      F({
        h: 'The label-accuracy baseline, for context',
        body: 'The label problem is not specific to converted cannabinoids; it is the background condition of the whole cannabinoid product market, and knowing the baseline prevents both complacency and overstatement. Independent assay of edible medical cannabis products found that a minority were accurately labelled, with both substantial under-labelling and substantial over-labelling present. Independent assay of cannabidiol extracts sold online found that most were inaccurately labelled, again in both directions, with some products containing detectable Δ9-THC that the label did not mention. Later work on unregulated cannabidiol products reproduced the finding that measured concentration and label claim diverge, and reviewers have documented regional variability in labelled unit strength for edibles on top of the measurement disagreement. Converted and novel cannabinoid products therefore inherit an already-poor label-accuracy baseline and add to it the specific difficulties of a chemically transformed product: additional species to quantify, some with no available standards, and a smaller pool of laboratories with validated methods for them. The implication for a buyer is that a batch-matched certificate is not a formality but the only actual evidence of content, and the implication for the industry is on the market-consequences page.',
        cites: F(['vandrey2015', 'bonnmiller2017', 'johnson2022', 'johnsonarbor2023', 'kruger2022', 'fdaDelta8']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['coa/reading-a-coa', 'coa/panels', 'coa/red-flags', 'formulation/residual-solvent', 'safety/buyer-vendor-checklist', 'cannabinoids/isomers', 'regulatory/market-consequences']),
    cites: F(['adams1940', 'meehanatrash2022', 'meehanatrash2021', 'meehanatrash2017', 'lin2026', 'helander2022', 'burgess2024', 'castaneto2015', 'iso17025', 'usp905', 'usp467', 'vandrey2015', 'bonnmiller2017', 'johnson2022', 'johnsonarbor2023', 'kruger2022', 'fdaDelta8']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'toxidrome',
    title: 'Recognition and Response: Two Different Presentations',
    kind: 'safety',
    summary: 'Cannabis overconsumption and synthetic full-agonist toxicity set side by side, because they are not the same event and do not call for the same response. Reassurance and a quiet room, which is usually right for cannabis, is not sufficient for the second. Includes the emergency thresholds, the naloxone question answered honestly, and the poison-centre facts — the Poison Help line is 1-800-222-1222, it is free and confidential, and calling it is not calling the police.',
    facts: F({
      'Cannabis overconsumption': 'tachycardia, anxiety and panic, orthostatic hypotension, nausea and vomiting; distressing, usually self-limiting, very rarely lethal alone',
      'Cyclic vomiting': 'cannabinoid hyperemesis syndrome in heavy chronic use — documented, recurrent, often hot-shower-relieved',
      'Full-agonist toxicity adds': 'agitated delirium, seizures including status, severe hypertension or hypotension, tachyarrhythmia, myocardial ischaemia, hyperthermia, rhabdomyolysis, acute kidney injury, death',
      'Emergency now': 'seizure, chest pain, loss of consciousness, high temperature, uncontrolled agitation, or any suspicion of an unidentified compound',
      'Naloxone': 'does not reverse cannabinoid toxicity — and is still reasonable if opioids cannot be excluded',
      'Poison Help': '1-800-222-1222 in the US — free, confidential, 24/7, staffed by clinicians, and not the police',
    }),
    sections: F([
      F({
        h: 'Cannabis overconsumption: what it looks like',
        body: 'Acute overconsumption of cannabis, most commonly from an edible, presents as a cluster of unpleasant but generally self-limiting findings: tachycardia, anxiety that can reach frank panic with a sense of impending death, orthostatic hypotension and dizziness on standing, conjunctival injection, nausea and vomiting, impaired coordination, and in some people transient psychotic features including paranoia and, less often, hallucinations. It is frightening out of proportion to its danger, and the frightening quality is part of the clinical problem because panic amplifies the tachycardia and the sense of catastrophe. It is very rarely lethal by itself in an otherwise healthy adult, and the usual course is resolution over hours as the drug is cleared — slowly, if it was ingested, which is why the experience can last much longer than people expect. The two situations that change that assessment are a person with significant cardiac disease, in whom the tachycardia and blood-pressure changes are not trivial, and a child, for whom an adult edible dose is a genuine emergency and has produced severe central nervous system depression requiring admission. Separately, heavy chronic use is associated with cannabinoid hyperemesis syndrome: recurrent episodes of intractable vomiting and abdominal pain, classically relieved temporarily by hot showers or baths, resolving with cessation and recurring on resumption. It is documented, frequently misdiagnosed for years, and can produce dehydration and electrolyte disturbance serious enough to require treatment even though its mechanism is not acute toxicity.',
        cites: F(['monte2019', 'allen2004', 'huestis2007', 'lucas2018']),
        evidence: 'human',
      }),
      F({
        h: 'Synthetic full-agonist toxicity: what is added, and why it is different',
        body: 'Synthetic cannabinoid receptor agonist toxicity includes some of the same features and then adds a set that cannabis does not produce, because a full agonist with no ceiling can drive receptor signalling — and downstream sympathetic and central effects — past where a partial agonist stops. The added features documented across clinical case series and systematic review are agitated delirium and violent agitation, sometimes requiring physical and chemical restraint; seizures, including generalised tonic-clonic seizures and status epilepticus; marked hypertension, and in other patients profound hypotension; tachyarrhythmias, with myocardial ischaemia and frank infarction reported in adolescents and young adults without coronary disease; hyperthermia; rhabdomyolysis, with acute kidney injury reported in clusters; profound central nervous system depression at the other end of the spectrum, as in the Brooklyn presentation; and death. The practical statement that follows is the one that matters most on this page: this does not respond the same way. Reassurance, a quiet low-stimulus room, fluids and time — which is usually the correct and sufficient management of cannabis overconsumption — is not sufficient here, because the trajectory is not self-limiting in the same way and the complications are the kind that require monitoring, active intervention and laboratory investigation. Treating a suspected synthetic-cannabinoid presentation as a bad weed trip, in the belief that waiting it out is the kind thing to do, is how a survivable event becomes a fatal one.',
        table: F({
          cols: F(['Feature', 'Cannabis overconsumption', 'Synthetic full-agonist toxicity']),
          rows: F([
            F(['Heart rate', 'tachycardia, common', 'tachycardia and tachyarrhythmias; ischaemia and infarction reported']),
            F(['Blood pressure', 'orthostatic hypotension typical', 'marked hypertension in some, profound hypotension in others']),
            F(['Mental state', 'anxiety, panic, paranoia; transient psychotic features in some', 'agitated delirium, violent agitation, or profound depression of consciousness']),
            F(['Seizures', 'not characteristic', 'documented, including status epilepticus']),
            F(['Temperature', 'not characteristic', 'hyperthermia documented']),
            F(['Muscle and kidney', 'not characteristic', 'rhabdomyolysis and acute kidney injury reported in clusters']),
            F(['Gastrointestinal', 'nausea and vomiting; cyclic vomiting in chronic heavy use', 'nausea and vomiting, often severe']),
            F(['Usual course', 'distressing, self-limiting over hours; rarely lethal alone in a healthy adult', 'unpredictable; deaths documented']),
            F(['Adequate response', 'reassurance, quiet room, fluids, time — usually sufficient', 'NOT sufficient — this needs assessment and monitoring']),
          ]),
        }),
        cites: F(['hermannsclausen2013', 'tait2015', 'castaneto2014', 'adams2017', 'thornton2013', 'mir2011', 'trecki2015']),
        evidence: 'human',
      }),
      F({
        h: 'When it is an emergency',
        body: 'The thresholds below are the documented ones, and they are deliberately low, because the cost of an unnecessary emergency assessment is small and the cost of a missed one is not recoverable. Call emergency services for a seizure of any duration, and immediately for a second seizure or one that does not stop. Call for chest pain, for collapse, for loss of consciousness or any state in which the person cannot be roused to purposeful response. Call for a high body temperature, for agitation that cannot be safely managed, and for any breathing difficulty. Call if the person is a child who has ingested a cannabis product, whatever they look like at the time, because the onset is delayed and the trajectory in a small body is not the adult one. And call, or at minimum call poison control, whenever the substance involved may be an unidentified or novel compound — because in that case nobody, including a clinician, can predict the course from the first hour, and the value of early assessment is highest precisely where the pharmacology is unknown. One more threshold that is easy to miss: a presentation that is out of proportion to what was supposedly taken is itself a warning sign, since it means either the dose or the identity of the substance is not what was believed, which is the signature of a hot spot or a mislabelled product.',
        bullets: F([
          'Seizure — any. Chest pain. Collapse or unrousable unresponsiveness. Difficulty breathing.',
          'High temperature. Agitation that cannot be safely managed.',
          'A child who has ingested a cannabis product — always, regardless of how they look initially.',
          'Any suspicion of an unidentified or novel compound.',
          'A presentation out of proportion to the reported dose — the dose or the identity is wrong.',
        ]),
        cites: F(['tait2015', 'castaneto2014', 'monte2019', 'burgess2024']),
        evidence: 'human',
      }),
      F({
        h: 'Naloxone: the honest answer',
        body: 'Naloxone does not reverse cannabinoid toxicity. It is a competitive antagonist at opioid receptors and has no action at cannabinoid receptors, so it will not touch the agitation, the seizures, the tachyarrhythmia or the sedation of a synthetic cannabinoid receptor agonist. Anyone who says otherwise is wrong, and expecting it to work is dangerous because it substitutes for calling for help. And the second half of the answer matters just as much: giving naloxone is still frequently the right first action when opioids cannot be excluded. Polysubstance use is the norm rather than the exception, the illicit supply is contaminated with fentanyl and its analogues across much of North America, products of unknown composition are by definition of unknown composition, and an unresponsive person with depressed breathing may be having an opioid event regardless of what they or their friends believe they took. Naloxone given to someone who has not taken opioids does essentially nothing; naloxone withheld from someone who has can cost them their life. So the correct framing to carry is both clauses at once: naloxone will not fix cannabinoid toxicity, and it may still be the right first action if opioids are possible. In an unresponsive person with slow or absent breathing, give it, call emergency services, and manage the airway — do not stand and reason about which drug it was.',
        bullets: F([
          'No opioid receptor involvement — naloxone does not reverse cannabinoid toxicity.',
          'Give it anyway if opioids cannot be excluded: unresponsive plus depressed breathing is an opioid-possible event.',
          'It is close to harmless in a person who has not taken opioids.',
          'Naloxone is never a substitute for calling emergency services.',
        ]),
        cites: F(['castaneto2014', 'tait2015', 'trecki2015']),
        evidence: 'human',
      }),
      F({
        h: 'Poison control: what it is, and what it is not',
        body: 'In the United States the Poison Help line is 1-800-222-1222. It routes to a regional poison centre staffed around the clock by nurses, pharmacists and physicians with toxicology training, the call is free, and it is confidential. It is not law enforcement. Calling poison control is not calling the police, poison centres do not dispatch police, and their function is clinical advice — including advice that resolves the situation at home without an emergency department visit, which is the outcome in a large share of calls. The belief that calling will bring the police is widespread and it kills people, because it converts a phone call into a delay measured in hours. Say what to tell them, so the call is efficient: the product as it was labelled or described, anything known about the actual compound, how much, by what route, how long ago, the person\'s approximate age and weight, what they are doing right now, and anything else they have taken including alcohol and prescribed medication. If there is packaging, remaining material, or a photograph of a label, have it in hand — and keep it, because it is the only route to identification after the fact, both for the clinicians treating this person and for the surveillance system that might warn the next one. Outside the United States the equivalent national poison information service is the thing to look up before it is needed rather than during.',
        cites: F(['poisonCenters', 'law2016', 'burgess2024']),
        evidence: 'human',
      }),
      F({
        h: 'Harm-reduction basics that change outcomes',
        body: 'The measures below are the ones with the clearest link to outcome, and none of them requires anyone to have made a different decision about whether to use. Do not use alone. An unresponsive person who is alone has no one to place them in the recovery position, no one to call, and no one to tell the clinicians what happened; almost every fatal outcome in this literature has that structure. Stagger use in a group rather than everyone dosing simultaneously from the same material, so that someone is in a position to help — this is exactly the defence against a hot spot, where the material that one person tolerated may not be what the next person gets. Start low and wait past the expected peak for the route, which is minutes to tens of minutes for inhalation and hours for ingestion; the titration page has the numbers. Use a known source and a product with a batch-matched certificate, and keep the packaging. If someone becomes unwell, tell the clinicians honestly and completely what was taken, including the things that are awkward to admit: they cannot treat what they do not know about, routine drug screens will not detect synthetic cannabinoid receptor agonists, and an incomplete history is the single most common reason a treatable presentation is managed wrongly. If a person is unresponsive but breathing, place them on their side in the recovery position with the head tilted to keep the airway clear and stay with them; if breathing is absent or agonal, that is a resuscitation situation and emergency services need to be on the line. None of this is instruction in the care of a specific person, and none of it replaces a clinician — it is the documented list of the things that make the difference between an event someone walks away from and one they do not.',
        bullets: F([
          'Do not use alone. Stagger use in a group so someone can act.',
          'Start low; wait past the peak for the route, not past the onset.',
          'Known source, batch-matched certificate, and keep the packaging and any remaining material.',
          'Tell clinicians the truth about everything taken — drug screens do not detect these compounds.',
          'Unresponsive but breathing: recovery position, airway clear, stay with them. Not breathing: emergency services now.',
          'Naloxone if opioids are possible, while calling for help — not instead of it.',
        ]),
        cites: F(['castaneto2015', 'tait2015', 'frinculescu2016', 'poisonCenters', 'huestis2007']),
        evidence: 'human',
      }),
      F({
        h: 'What this page is not',
        body: 'This is a description of documented presentations and documented emergency thresholds, written so that a person can recognise a situation and act on it in time. It is not a diagnosis, not a treatment protocol, and not advice about any particular person. It does not tell anyone what to administer, in what dose, or instead of what. Where it names a threshold, the action attached to that threshold is to get professional help, not to manage the event alone. The clinical management of cannabinoid toxicity — sedation choices, seizure management, cardiac and renal monitoring, fluid resuscitation and everything else — belongs to clinicians with the patient in front of them, and the reason this page exists is to shorten the time until that is who is looking after the person.',
        cites: F(['tait2015', 'castaneto2014']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['safety/k2-what-went-wrong', 'formulation/titration', 'formulation/hot-spots', 'formulation/adulterants', 'endocannabinoid/cb1', 'cyp450/overview']),
    cites: F(['monte2019', 'allen2004', 'huestis2007', 'lucas2018', 'hermannsclausen2013', 'tait2015', 'castaneto2014', 'castaneto2015', 'adams2017', 'thornton2013', 'mir2011', 'trecki2015', 'burgess2024', 'law2016', 'poisonCenters', 'frinculescu2016']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'buyer-vendor-checklist',
    title: 'Buyer and Vendor Checklist',
    kind: 'tool',
    summary: 'A working two-column instrument: what to demand as a buyer, what to provide as a vendor, and the red flags in one list. It closes with the argument the industry should be making — testing, labelling and traceability are the difference between this market and the K2 era, which makes them the industry\'s actual product rather than its compliance overhead.',
    facts: F({
      'The single most important document': 'a batch-matched certificate of analysis from an ISO/IEC 17025 laboratory with the analytes inside its declared scope',
      'Never accept': 'potency-only testing on a converted or novel product',
      'Always require': 'per-serving and per-container milligram figures, and the actual chemical identity of the compound',
      'For unit-dose products': 'dose-uniformity evidence by multi-point sampling, not one composite assay',
      'Vendor-side minimum': 'lot traceability, retained samples, homogeneity verification, honest labelling of unestablished pharmacology',
      'The argument': 'testing, labelling and traceability are the product, not the paperwork',
    }),
    sections: F([
      F({
        h: 'As a buyer: what to demand',
        body: 'Work down this list in order, because the early items make the later ones meaningful. First, a certificate of analysis that matches the batch or lot code physically present on the product in hand — not a certificate for the product line, not last quarter\'s certificate, and not an undated PDF. A certificate that cannot be tied to the specific material is a document about some other material. Second, the laboratory: accredited to ISO/IEC 17025, with the specific analytes and the specific matrix inside its declared scope of accreditation. Accreditation is scope-limited by design, so a laboratory accredited for cannabinoid potency in flower is not thereby accredited for residual solvents in a vape liquid, and the scope document is public. Third, the panel: on any converted or novel cannabinoid product, a potency-only certificate is not adequate, and the full set is cannabinoid profile, residual solvents, heavy metals, pesticides and mycotoxins, with microbiological testing where the matrix warrants it and a broader elemental scan where a catalyst may have been involved. Fourth, the things the report should disclose rather than hide: the unassigned chromatographic fraction, a total-cannabinoid mass balance, and the reporting limits for every analyte, so that "not detected" can be read against the method floor rather than taken as absence. Fifth, verification: where the laboratory publishes a sample-identifier lookup, verify the certificate with the laboratory rather than with the seller. Sixth, the label: a per-serving and a per-container milligram figure, stated on the product, plus the compound named by its actual chemical name with isomer and stereochemistry specified where they matter. A marketing name is not an identity.',
        bullets: F([
          'Batch-matched COA tied to the lot code on the product in hand.',
          'ISO/IEC 17025 accreditation with these analytes and this matrix inside the declared scope.',
          'Full panel on any converted or novel product — never potency-only.',
          'Unassigned-peak reporting, total-cannabinoid mass balance, and the reporting limit for every analyte.',
          'Verify with the laboratory by sample identifier where a lookup exists.',
          'Per-serving and per-container milligrams on the label, and the real chemical identity of the compound.',
          'Dose-uniformity evidence for anything sold as a unit dose.',
        ]),
        cites: F(['iso17025', 'usp905', 'usp467', 'meehanatrash2022', 'vandrey2015']),
        evidence: 'human',
      }),
      F({
        h: 'As a vendor: what to provide',
        body: 'Everything in the buyer list, plus the four things that only the producer can supply. Homogeneity verification: increments sampled from multiple points in each batch, assayed individually rather than composited, with the relative standard deviation and the range reported, and a written specification that a batch must meet before release. The pharmacopoeial model is worth adopting even where no regulator requires it — ten units, an acceptance value combining the deviation of the mean from target with the observed spread, and no individual unit outside 75 to 125 percent of the mean — because it is the framework that exists precisely to stop a correct batch average from standing in for a correct dose. Lot traceability: every finished unit traceable to a lot, every lot to its input material and its certificates, so that a complaint or an adverse report can be resolved to actual material rather than to a guess. Retained samples: a physical retain from each lot, stored under conditions that preserve it, for long enough to cover the shelf life plus a margin, because without a retain a later question about a lot is unanswerable forever. And honest labelling of what is not established: where a compound\'s human pharmacology and toxicology are not established, the label and the product information should say so plainly rather than borrowing the familiarity of cannabis. That last one is a commercial decision that feels costly and is not, because the alternative is a market where nobody can distinguish a careful producer from a careless one, and in that market the careless producer wins on price until an outbreak takes the whole category down.',
        bullets: F([
          'Homogeneity verification by multi-point sampling, individually assayed, with RSD and range reported against a written release specification.',
          'Lot traceability from finished unit back to input material and certificates.',
          'Retained samples from every lot, stored properly, for shelf life plus a margin.',
          'Honest labelling where pharmacology and toxicology are not established — say it rather than implying familiarity.',
          'Keep the certificates accessible to buyers by lot code, not on request-and-wait.',
        ]),
        cites: F(['usp905', 'iso17025', 'johnsonarbor2023', 'vandrey2015', 'lin2026']),
        evidence: 'human',
      }),
      F({
        h: 'Red flags, in one list',
        body: 'Each item below is a documented failure pattern rather than a matter of taste, and any one of them is sufficient reason to treat a product as unverified. No certificate of analysis at all. A certificate whose batch or lot code does not match the product. Potency-only testing on a converted or novel cannabinoid product, which leaves residual solvent, catalyst, metals and side-products entirely unaddressed. A novel cannabinoid named on a label that no validated quantitative method and no commercially available reference standard could have measured, which means the number beside it was not obtained in the ordinary analytical sense. Not-for-human-consumption labelling on a product that is plainly intended and merchandised for consumption — the exact device used throughout the K2 era to stay outside both food and drug regulation while selling something for inhalation, and its reappearance is a direct signal that the seller expects the product not to survive scrutiny. Label potency far from assay in either direction. An unaccredited laboratory, or an accredited one whose declared scope does not cover these analytes or this matrix. And no per-unit milligram figure anywhere, which means the consumer cannot compute a dose even if everything else is honest. Two further flags are worth adding from the market as it stands: a certificate supplied only as an image or a PDF from the seller with no laboratory-side verification path, and a product line that changes its headline compound faster than any toxicology could follow, which reproduces the structural driver that made the analogue era unmanageable.',
        table: F({
          cols: F(['Red flag', 'What it actually means']),
          rows: F([
            F(['No COA', 'composition unknown; nothing else on the label is evidence']),
            F(['COA batch mismatch', 'the document describes different material']),
            F(['Potency-only on a converted product', 'solvent, catalyst, metals and side-products all unaddressed']),
            F(['A novel cannabinoid with no validated method or reference standard', 'the printed number was not measured in the ordinary sense']),
            F(['"Not for human consumption" on a consumption product', 'a regulatory-evasion device with direct K2-era lineage']),
            F(['Label far from assay', 'the dose the buyer computes is wrong by an unknown factor']),
            F(['Unaccredited or scope-mismatched laboratory', 'the result has no competence assurance behind it']),
            F(['No per-unit milligram figure', 'the consumer cannot compute a dose at all']),
            F(['Seller-supplied PDF with no laboratory verification path', 'unverifiable, and trivially forged']),
            F(['Headline compound changing faster than toxicology', 'the analogue-treadmill driver, reproduced in a legal market']),
          ]),
        }),
        cites: F(['meehanatrash2022', 'iso17025', 'bonnmiller2017', 'johnson2022', 'castaneto2015', 'emcdda2021']),
        evidence: 'human',
      }),
      F({
        h: 'The argument the industry should be making',
        body: 'The difference between the legal hemp and cannabinoid market and the K2 era is not that the compounds are safer, because some of them are barely characterised, and it is not that the intentions are better, because intentions were never the variable. The difference is three concrete practices: analytical testing against authentic reference standards, honest per-unit labelling, and lot traceability with retained samples. Those three things are what make a dose computable, a contaminant findable, an outbreak traceable to a lot instead of to a rumour, and a careful producer distinguishable from a careless one. Which means they are not compliance overhead sitting on top of the product. They are the product. What a legitimate processor is actually selling, over and above the molecules, is the assurance that the contents are known, uniform and stated — and that assurance is the entire reason a customer should prefer a regulated supplier to an anonymous one. The strategic implication follows directly and is worth stating without diplomacy: any regulatory or market pressure that strips out testing, labelling or traceability recreates the failure mode. A ban that pushes a compound out of the tested market and into an untested one does not remove the compound; it removes the certificate. A price war won by skipping panels does not make products cheaper; it makes them unverified. A rule written against structures rather than against practices selects for whichever molecule is least characterised. The industry\'s interest and the public-health interest point the same direction here, and it is one of the few places in this field where that is true — which is exactly why the argument should be made in those terms rather than as a plea for lighter regulation.',
        cites: F(['emcdda2021', 'castaneto2015', 'banister2018', 'meehanatrash2022', 'iso17025']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['coa/red-flags', 'coa/reading-a-coa', 'coa/panels', 'regulatory/market-consequences', 'safety/converted-cannabinoid-products', 'formulation/homogeneity']),
    cites: F(['iso17025', 'usp905', 'usp467', 'meehanatrash2022', 'vandrey2015', 'johnsonarbor2023', 'lin2026', 'bonnmiller2017', 'johnson2022', 'castaneto2015', 'emcdda2021', 'banister2018']),
  }),

]);

export default { SHELF, CITES, PAGES };
