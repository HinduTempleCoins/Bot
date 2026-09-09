// interactions-data.mjs — the curated, mechanism-first interaction corpus behind interactions.mjs.
//
// WHY A CURATED TABLE AND NOT AN API. There is no free, openly-licensed, comprehensive drug–drug
// interaction dataset a public repo may redistribute. NLM retired its RxNav Drug Interaction API on
// 2024-01-02 (see integrations/soapbox/pharma.mjs, which already had to route around it); DrugBank's
// full interaction set is a commercial licence; openFDA carries FDA labelling, which is public domain
// but only covers FDA-APPROVED PRODUCTS — it has no label for nutmeg, none for grapefruit, none for
// harmala alkaloids, and no label at all for the plant preparations this library exists to serve.
// So the honest architecture is: a hand-curated MECHANISM table built from primary literature and FDA
// labelling, every claim carrying a DOI resolved against Crossref, with openFDA available at runtime
// as an ADDITIONAL source — never as the coverage story.
//
// WHY MECHANISM AND NOT PAIRS. `CYP3A4 inhibition` explains grapefruit, ketoconazole, ritonavir,
// clarithromycin, and black pepper's piperine with ONE rule. A pairs list would need 5 × (every CYP3A4
// substrate) rows, and the rows nobody typed would be invisible. Mechanism generalises. Pairs do not,
// and their gaps do not announce themselves.
//
// Every CITES entry below was resolved against the Crossref REST API on 2026-09-09 and the returned
// title recorded verbatim in `title`. Three DOIs in the first draft resolved to REAL BUT WRONG papers
// and were corrected; see .local/oilahuasca-interactions.md for that log.

export const LAST_REVIEWED = '2026-09-09';

/**
 * CITES — the bibliography. `verified: 'crossref'` means the DOI was resolved and its title matched
 * what is recorded here. `verified: 'pmid'` means no DOI exists and the PubMed id is the handle.
 * Anything not verified carries `verified: false` and MUST be rendered with an [UNVERIFIED] marker.
 */
export const CITES = Object.freeze({
  dunkley2003: { authors: 'Dunkley EJC, Isbister GK, Sibbritt D, Dawson AH, Whyte IM', year: 2003, title: 'The Hunter Serotonin Toxicity Criteria: simple and accurate diagnostic decision rules for serotonin toxicity', journal: 'QJM', doi: '10.1093/qjmed/hcg109', verified: 'crossref' },
  boyer2005: { authors: 'Boyer EW, Shannon M', year: 2005, title: 'The Serotonin Syndrome', journal: 'New England Journal of Medicine', doi: '10.1056/NEJMra041867', verified: 'crossref' },
  gillman2005: { authors: 'Gillman PK', year: 2005, title: 'Monoamine oxidase inhibitors, opioid analgesics and serotonin toxicity', journal: 'British Journal of Anaesthesia', doi: '10.1093/bja/aei210', verified: 'crossref' },
  gillman2006: { authors: 'Gillman PK', year: 2006, title: 'A Review of Serotonin Toxicity Data: Implications for the Mechanisms of Antidepressant Drug Action', journal: 'Biological Psychiatry', doi: '10.1016/j.biopsych.2005.11.016', verified: 'crossref' },
  sternbach1991: { authors: 'Sternbach H', year: 1991, title: 'The serotonin syndrome', journal: 'American Journal of Psychiatry', doi: '10.1176/ajp.148.6.705', verified: 'crossref' },
  quinn2009: { authors: 'Quinn DK, Stern TA', year: 2009, title: 'Linezolid and Serotonin Syndrome', journal: 'The Primary Care Companion to The Journal of Clinical Psychiatry', doi: '10.4088/PCC.09r00853', verified: 'crossref' },
  gillman2003linezolid: { authors: 'Gillman PK', year: 2003, title: 'Linezolid and Serotonin Toxicity', journal: 'Clinical Infectious Diseases', doi: '10.1086/378895', verified: 'crossref' },
  lawrence2006: { authors: 'Lawrence KR, Adra M, Gillman PK', year: 2006, title: 'Serotonin Toxicity Associated with the Use of Linezolid: A Review of Postmarketing Data', journal: 'Clinical Infectious Diseases', doi: '10.1086/503839', verified: 'crossref' },
  schwartz2008: { authors: 'Schwartz AR, Pizon AF, Brooks DE', year: 2008, title: 'Dextromethorphan-induced serotonin syndrome', journal: 'Clinical Toxicology', doi: '10.1080/15563650701668625', verified: 'crossref' },
  beakley2015: { authors: 'Beakley BD, Kaye AM, Kaye AD', year: 2015, title: 'Tramadol, Pharmacology, Side Effects, and Serotonin Syndrome: A Review', journal: 'Pain Physician', doi: '10.36076/ppj.2015/18/395', verified: 'crossref' },
  evans2010: { authors: 'Evans RW, Tepper SJ, Shapiro RE, Sun-Edelstein C, Tietjen GE', year: 2010, title: 'The FDA Alert on Serotonin Syndrome With Use of Triptans Combined With Selective Serotonin Reuptake Inhibitors or Selective Serotonin-Norepinephrine Reuptake Inhibitors: American Headache Society Position Paper', journal: 'Headache', doi: '10.1111/j.1526-4610.2010.01691.x', verified: 'crossref' },

  blackwell1963: { authors: 'Blackwell B', year: 1963, title: 'Hypertensive crisis due to monoamine-oxidase inhibitors', journal: 'The Lancet', doi: '10.1016/S0140-6736(63)92743-0', verified: 'crossref' },
  blackwell1967: { authors: 'Blackwell B, Marley E, Price J, Taylor D', year: 1967, title: 'Hypertensive Interactions Between Monoamine Oxidase Inhibitors and Foodstuffs', journal: 'British Journal of Psychiatry', doi: '10.1192/bjp.113.497.349', verified: 'crossref' },
  walker1996: { authors: 'Walker SE, Shulman KI, Tailor SAN, Gardner D', year: 1996, title: 'Tyramine Content of Previously Restricted Foods in Monoamine Oxidase Inhibitor Diets', journal: 'Journal of Clinical Psychopharmacology', doi: '10.1097/00004714-199610000-00007', verified: 'crossref' },
  shulman1999: { authors: 'Shulman KI, Walker SE', year: 1999, title: 'Refining the MAOI Diet', journal: 'The Journal of Clinical Psychiatry', doi: '10.4088/jcp.v60n0308', verified: 'crossref' },
  shulman1997beer: { authors: 'Shulman KI, Tailor SAN, Walker SE, Gardner DM', year: 1997, title: 'Tap (Draft) Beer and Monoamine Oxidase Inhibitor Dietary Restrictions', journal: 'The Canadian Journal of Psychiatry', doi: '10.1177/070674379704200311', verified: 'crossref' },
  tailor1994: { authors: 'Tailor SAN, Shulman KI, Walker SE, Moss J, Gardner D', year: 1994, title: 'Hypertensive Episode Associated with Phenelzine and Tap Beer — A Reanalysis of the Role of Pressor Amines in Beer', journal: 'Journal of Clinical Psychopharmacology', doi: '10.1097/00004714-199402000-00002', verified: 'crossref' },
  shulman1989: { authors: 'Shulman KI, Walker SE, MacKenzie S, Knowles S', year: 1989, title: 'Dietary Restriction, Tyramine, and the Use of Monoamine Oxidase Inhibitors', journal: 'Journal of Clinical Psychopharmacology', doi: '10.1097/00004714-198912000-00002', verified: 'crossref' },
  gillman2011: { authors: 'Gillman PK', year: 2011, title: 'Advances Pertaining to the Pharmacology and Interactions of Irreversible Nonselective Monoamine Oxidase Inhibitors', journal: 'Journal of Clinical Psychopharmacology', doi: '10.1097/JCP.0b013e31820469ea', verified: 'crossref' },
  gillman2018: { authors: 'Gillman PK, Feinberg SS, Fochtmann LJ', year: 2018, title: 'A reassessment of the safety profile of monoamine oxidase inhibitors: elucidating tired old tyramine myths', journal: 'Journal of Neural Transmission', doi: '10.1007/s00702-018-1932-y', verified: 'crossref' },
  azzaro2006: { authors: 'Azzaro AJ, VanDenBerg CM, Blob LF, et al.', year: 2006, title: 'Tyramine Pressor Sensitivity During Treatment With the Selegiline Transdermal System 6 mg/24 h in Healthy Subjects', journal: 'The Journal of Clinical Pharmacology', doi: '10.1177/0091270006289852', verified: 'crossref' },
  bonnet2003: { authors: 'Bonnet U', year: 2003, title: 'Moclobemide: Therapeutic Use and Clinical Studies', journal: 'CNS Drug Reviews', doi: '10.1111/j.1527-3458.2003.tb00245.x', verified: 'crossref' },
  gardner1996: { authors: 'Gardner DM, Shulman KI, Walker SE, Tailor SAN', year: 1996, title: 'The making of a user friendly MAOI diet', journal: 'The Journal of Clinical Psychiatry 57(3):99-104', doi: null, pmid: '8617704', verified: 'pmid' },

  bailey2013: { authors: 'Bailey DG, Dresser G, Arnold JMO', year: 2013, title: 'Grapefruit–medication interactions: Forbidden fruit or avoidable consequences?', journal: 'CMAJ (published online 2012-11-26)', doi: '10.1503/cmaj.120951', verified: 'crossref' },
  bailey1991: { authors: 'Bailey DG, Spence JD, Munoz C, Arnold JMO', year: 1991, title: 'Interaction of citrus juices with felodipine and nifedipine', journal: 'The Lancet', doi: '10.1016/0140-6736(91)90872-M', verified: 'crossref' },
  paine2006: { authors: 'Paine MF, Widmer WW, Hart HL, et al.', year: 2006, title: 'A furanocoumarin-free grapefruit juice establishes furanocoumarins as the mediators of the grapefruit juice-felodipine interaction', journal: 'The American Journal of Clinical Nutrition', doi: '10.1093/ajcn/83.5.1097', verified: 'crossref' },
  lown1997: { authors: 'Lown KS, Bailey DG, Fontana RJ, et al.', year: 1997, title: 'Grapefruit juice increases felodipine oral availability in humans by decreasing intestinal CYP3A protein expression', journal: 'Journal of Clinical Investigation', doi: '10.1172/JCI119439', verified: 'crossref' },
  lundahl1995: { authors: 'Lundahl J, Regårdh CG, Edgar B, Johnsson G', year: 1995, title: 'Relationship between time of intake of grapefruit juice and its effect on pharmacokinetics and pharmacodynamics of felodipine in healthy subjects', journal: 'European Journal of Clinical Pharmacology', doi: '10.1007/BF00192360', verified: 'crossref' },
  greenblatt2003: { authors: 'Greenblatt DJ, von Moltke LL, Harmatz JS, et al.', year: 2003, title: 'Time course of recovery of cytochrome p450 3A function after single doses of grapefruit juice', journal: 'Clinical Pharmacology & Therapeutics', doi: '10.1016/S0009-9236(03)00118-8', verified: 'crossref' },
  edwards1996: { authors: 'Edwards DJ, Bellevue FH 3rd, Woster PM', year: 1996, title: "Identification of 6',7'-dihydroxybergamottin, a cytochrome P450 inhibitor, in grapefruit juice", journal: 'Drug Metabolism and Disposition', doi: '10.1016/s0090-9556(25)08464-8', verified: 'crossref' },
  lilja1998: { authors: 'Lilja JJ, Kivistö KT, Neuvonen PJ', year: 1998, title: 'Grapefruit juice—simvastatin interaction: Effect on serum concentrations of simvastatin, simvastatin acid, and HMG-CoA reductase inhibitors', journal: 'Clinical Pharmacology & Therapeutics', doi: '10.1016/S0009-9236(98)90130-8', verified: 'crossref' },

  bhardwaj2002: { authors: 'Bhardwaj RK, Glaeser H, Becquemont L, Klotz U, Gupta SK, Fromm MF', year: 2002, title: 'Piperine, a Major Constituent of Black Pepper, Inhibits Human P-glycoprotein and CYP3A4', journal: 'The Journal of Pharmacology and Experimental Therapeutics', doi: '10.1124/jpet.102.034728', verified: 'crossref' },
  shoba1998: { authors: 'Shoba G, Joy D, Joseph T, Majeed M, Rajendran R, Srinivas PSSR', year: 1998, title: 'Influence of Piperine on the Pharmacokinetics of Curcumin in Animals and Human Volunteers', journal: 'Planta Medica', doi: '10.1055/s-2006-957450', verified: 'crossref' },
  volak2008: { authors: 'Volak LP, Ghirmai S, Cashman JR, Court MH', year: 2008, title: 'Curcuminoids Inhibit Multiple Human Cytochromes P450, UDP-Glucuronosyltransferase, and Sulfotransferase Enzymes, whereas Piperine is a Relatively Selective CYP3A4 Inhibitor', journal: 'Drug Metabolism and Disposition', doi: '10.1124/dmd.108.020552', verified: 'crossref' },
  bahramsoltani2017: { authors: 'Bahramsoltani R, Rahimi R, Farzaei MH', year: 2017, title: 'Pharmacokinetic interactions of curcuminoids with conventional drugs: A review', journal: 'Journal of Ethnopharmacology', doi: '10.1016/j.jep.2017.07.022', verified: 'crossref' },

  stormer1993: { authors: 'Størmer FC, Reistad R, Alexander J', year: 1993, title: 'Glycyrrhizic acid in liquorice—Evaluation of health hazard', journal: 'Food and Chemical Toxicology', doi: '10.1016/0278-6915(93)90080-I', verified: 'crossref' },
  omar2012: { authors: 'Omar HR, Komarova I, El-Ghonemi M, et al.', year: 2012, title: 'Licorice abuse: time to send a warning message', journal: 'Therapeutic Advances in Endocrinology and Metabolism', doi: '10.1177/2042018812454322', verified: 'crossref' },
  farese1991: { authors: 'Farese RV Jr, Biglieri EG, Shackleton CHL, Irony I, Gomez-Fontes R', year: 1991, title: 'Licorice-Induced Hypermineralocorticoidism', journal: 'New England Journal of Medicine', doi: '10.1056/NEJM199110243251706', verified: 'crossref' },

  abraham2010: { authors: 'Abraham K, Wöhrlin F, Lindtner O, Heinemeyer G, Lampen A', year: 2010, title: 'Toxicology and risk assessment of coumarin: Focus on human data', journal: 'Molecular Nutrition & Food Research', doi: '10.1002/mnfr.200900281', verified: 'crossref' },
  woehrlin2010: { authors: 'Woehrlin F, Fry H, Abraham K, Preiss-Weigert A', year: 2010, title: 'Quantification of Flavoring Constituents in Cinnamon: High Variation of Coumarin in Cassia Bark from the German Retail Market and in Authentic Samples from Indonesia', journal: 'Journal of Agricultural and Food Chemistry', doi: '10.1021/jf102112p', verified: 'crossref' },
  efsa2004coumarin: { authors: 'EFSA Scientific Panel on Food Additives, Flavourings, Processing Aids and Materials in Contact with Food (AFC)', year: 2004, title: 'Opinion of the Scientific Panel on food additives, flavourings, processing aids and materials in contact with food (AFC) on coumarin', journal: 'EFSA Journal', doi: '10.2903/j.efsa.2004.104', verified: 'crossref' },
  izeludlow2004: { authors: 'Ize-Ludlow D, Ragone S, Bruck IS, Bernstein JN, Duchowny M, Peña BM', year: 2004, title: 'Neurotoxicities in Infants Seen With the Consumption of Star Anise Tea', journal: 'Pediatrics', doi: '10.1542/peds.2004-0058', verified: 'crossref' },

  ruschitzka2000: { authors: 'Ruschitzka F, Meier PJ, Turina M, Lüscher TF, Noll G', year: 2000, title: "Acute heart transplant rejection due to Saint John's wort", journal: 'The Lancet', doi: '10.1016/S0140-6736(99)05467-7', verified: 'crossref' },
  piscitelli2000: { authors: 'Piscitelli SC, Burstein AH, Chaitt D, Alfaro RM, Falloon J', year: 2000, title: "Indinavir concentrations and St John's wort", journal: 'The Lancet', doi: '10.1016/S0140-6736(99)05712-8', verified: 'crossref' },
  moore2000: { authors: 'Moore LB, Goodwin B, Jones SA, et al.', year: 2000, title: "St. John's wort induces hepatic drug metabolism through activation of the pregnane X receptor", journal: 'PNAS', doi: '10.1073/pnas.130155097', verified: 'crossref' },
  henderson2002: { authors: 'Henderson L, Yue QY, Bergquist C, Gerden B, Arlett P', year: 2002, title: "St John's wort (Hypericum perforatum): drug interactions and clinical outcomes", journal: 'British Journal of Clinical Pharmacology', doi: '10.1046/j.1365-2125.2002.01683.x', verified: 'crossref' },
  johne1999: { authors: 'Johne A, Brockmöller J, Bauer S, Maurer A, Langheinrich M, Roots I', year: 1999, title: "Pharmacokinetic interaction of digoxin with an herbal extract from St John's wort (Hypericum perforatum)", journal: 'Clinical Pharmacology & Therapeutics', doi: '10.1053/cp.1999.v66.a101944', verified: 'crossref' },

  stein2001: { authors: 'Stein U, Greyer H, Hentschel H', year: 2001, title: 'Nutmeg (myristicin) poisoning — report on a fatal case and a series of cases recorded by a poison information centre', journal: 'Forensic Science International', doi: '10.1016/S0379-0738(00)00369-8', verified: 'crossref' },
  ehrenpreis2014: { authors: 'Ehrenpreis JE, DesLauriers C, Lank P, Armstrong PK, Leikin JB', year: 2014, title: 'Nutmeg Poisonings: A Retrospective Review of 10 Years Experience from the Illinois Poison Center, 2001-2011', journal: 'Journal of Medical Toxicology', doi: '10.1007/s13181-013-0379-7', verified: 'crossref' },
  truitt1963: { authors: 'Truitt EB Jr, Duritz G, Ebersberger EM', year: 1963, title: 'Evidence of Monoamine Oxidase Inhibition by Myristicin and Nutmeg', journal: 'Proceedings of the Society for Experimental Biology and Medicine', doi: '10.3181/00379727-112-28128', verified: 'crossref' },
  beyer2006: { authors: 'Beyer J, Ehlers D, Maurer HH', year: 2006, title: 'Abuse of Nutmeg (Myristica fragrans Houtt.): Studies on the Metabolism and the Toxicologic Detection of its Ingredients Elemicin, Myristicin, and Safrole in Rat and Human Urine Using Gas Chromatography/Mass Spectrometry', journal: 'Therapeutic Drug Monitoring', doi: '10.1097/00007691-200608000-00013', verified: 'crossref' },

  herraiz2010: { authors: 'Herraiz T, González D, Ancín-Azpilicueta C, Arán VJ, Guillén H', year: 2010, title: 'β-Carboline alkaloids in Peganum harmala and inhibition of human monoamine oxidase (MAO)', journal: 'Food and Chemical Toxicology', doi: '10.1016/j.fct.2009.12.019', verified: 'crossref' },
  callaway1998: { authors: 'Callaway JC, Grob CS', year: 1998, title: 'Ayahuasca Preparations and Serotonin Reuptake Inhibitors: A Potential Combination for Severe Adverse Interactions', journal: 'Journal of Psychoactive Drugs', doi: '10.1080/02791072.1998.10399712', verified: 'crossref' },
  callaway1999: { authors: 'Callaway JC, McKenna DJ, Grob CS, et al.', year: 1999, title: 'Pharmacokinetics of Hoasca alkaloids in healthy humans', journal: 'Journal of Ethnopharmacology', doi: '10.1016/S0378-8741(98)00168-8', verified: 'crossref' },
  riba2003: { authors: 'Riba J, Valle M, Urbano G, Yritia M, Morte A, Barbanoj MJ', year: 2003, title: 'Human Pharmacology of Ayahuasca: Subjective and Cardiovascular Effects, Monoamine Metabolite Excretion, and Pharmacokinetics', journal: 'The Journal of Pharmacology and Experimental Therapeutics', doi: '10.1124/jpet.103.049882', verified: 'crossref' },

  holbrook2005: { authors: 'Holbrook AM, Pereira JA, Labiris R, et al.', year: 2005, title: 'Systematic Overview of Warfarin and Its Drug and Food Interactions', journal: 'Archives of Internal Medicine', doi: '10.1001/archinte.165.10.1095', verified: 'crossref' },
  roden2004: { authors: 'Roden DM', year: 2004, title: 'Drug-Induced Prolongation of the QT Interval', journal: 'New England Journal of Medicine', doi: '10.1056/NEJMra032426', verified: 'crossref' },
  faber2004: { authors: 'Faber MS, Fuhr U', year: 2004, title: 'Time response of cytochrome P450 1A2 activity on cessation of heavy smoking', journal: 'Clinical Pharmacology & Therapeutics', doi: '10.1016/j.clpt.2004.04.003', verified: 'crossref' },
  culmmerdek2005: { authors: 'Culm-Merdek KE, von Moltke LL, Harmatz JS, Greenblatt DJ', year: 2005, title: 'Fluvoxamine impairs single-dose caffeine clearance without altering caffeine pharmacodynamics', journal: 'British Journal of Clinical Pharmacology', doi: '10.1111/j.1365-2125.2005.02467.x', verified: 'crossref' },
  gurley2005: { authors: 'Gurley BJ, Gardner SF, Hubbard MA, et al.', year: 2005, title: 'In vivo effects of goldenseal, kava kava, black cohosh, and valerian on human cytochrome P450 1A2, 2D6, 2E1, and 3A4/5 phenotypes', journal: 'Clinical Pharmacology & Therapeutics', doi: '10.1016/j.clpt.2005.01.009', verified: 'crossref' },

  // Regulatory / reference works. Not journal articles, so no DOI — the URL is the handle and each was
  // retrieved on the date shown.
  fdaTable: { authors: 'U.S. Food and Drug Administration', year: 2023, title: 'Drug Development and Drug Interactions: Table of Substrates, Inhibitors and Inducers', journal: 'FDA', url: 'https://www.fda.gov/drugs/drug-interactions-labeling/drug-development-and-drug-interactions-table-substrates-inhibitors-and-inducers', verified: 'url' },
  flockhart: { authors: 'Flockhart DA, Thacker D, McDonald C, Desta Z', year: 2021, title: 'The Flockhart Cytochrome P450 Drug-Drug Interaction Table', journal: 'Division of Clinical Pharmacology, Indiana University School of Medicine', url: 'https://drug-interactions.medicine.iu.edu', verified: 'url' },
  crediblemeds: { authors: 'Woosley RL, Heise CW, Gallo T, Woosley RD, Lambson J, Romero KA', year: 2025, title: 'QTdrugs List', journal: 'CredibleMeds, AZCERT Inc.', url: 'https://crediblemeds.org', verified: 'url' },
  // openFDA's own licence page, retrieved 2026-09-09, states verbatim: "unless otherwise noted, the
  // content, data, documentation, code, and related materials on openFDA is public domain and made
  // available with a Creative Commons CC0 1.0 Universal dedication… You can copy, modify, distribute
  // and perform the work, even for commercial purposes, all without asking permission." Note that the
  // SPL TEXT inside is manufacturer-authored, so NLM's own policy declines to guarantee its status.
  openfdaLabel: { authors: 'U.S. Food and Drug Administration', year: 2026, title: 'Structured Product Labeling via the openFDA drug/label API (CC0 1.0 Universal)', journal: 'openFDA', url: 'https://open.fda.gov/apis/drug/label/', verified: 'url' },
});

/**
 * MECHANISMS — the axes. A finding always names one of these, because the mechanism is the part that
 * transfers to a substance not yet in the table.
 */
export const MECHANISMS = Object.freeze({
  'mao-a-inhibition': { slug: 'mao-inhibition', name: 'MAO-A inhibition', kind: 'enzyme-inhibition', short: 'Blocks monoamine oxidase A, the enzyme that breaks down serotonin, noradrenaline and dietary tyramine.', why: 'Two separate hazards come off one enzyme: serotonin accumulates (toxicity) and dietary tyramine is no longer destroyed in the gut wall (pressor response).' },
  'mao-b-inhibition': { slug: 'mao-inhibition', name: 'MAO-B inhibition', kind: 'enzyme-inhibition', short: 'Blocks monoamine oxidase B, which preferentially handles dopamine and phenylethylamine.', why: 'At low, B-selective doses the tyramine hazard is much smaller; selectivity is lost as dose rises.' },
  'serotonin-reuptake-inhibition': { slug: 'serotonin', name: 'Serotonin reuptake inhibition', kind: 'pharmacodynamic', short: 'Blocks the serotonin transporter (SERT), raising synaptic serotonin.', why: 'Additive with anything else that raises serotonin; combined with MAO inhibition it is the classic lethal pairing.' },
  'serotonin-release': { slug: 'serotonin', name: 'Serotonin release', kind: 'pharmacodynamic', short: 'Forces serotonin out of the presynaptic terminal rather than merely blocking its return.', why: 'The most dangerous of the serotonergic mechanisms to combine with MAO inhibition.' },
  'serotonin-agonism': { slug: 'serotonin', name: 'Direct serotonin receptor agonism', kind: 'pharmacodynamic', short: 'Binds serotonin receptors directly (5-HT1A/1B/1D/2A).', why: 'Contributes to serotonergic load; 5-HT1A/2A agonism is the axis implicated in serotonin toxicity.' },
  'cyp3a4-inhibition': { slug: 'cyp3a4', name: 'CYP3A4 inhibition', kind: 'enzyme-inhibition', short: 'Slows the enzyme that metabolises roughly half of all prescription drugs.', why: 'A CYP3A4 substrate taken with a CYP3A4 inhibitor reaches higher blood levels than its dose implies.' },
  'cyp3a4-induction': { slug: 'cyp3a4', name: 'CYP3A4 induction', kind: 'enzyme-induction', short: 'Increases CYP3A4 expression, usually via the pregnane X receptor.', why: 'The mirror hazard: the drug is destroyed faster and silently stops working. Transplant rejection, HIV breakthrough, contraceptive failure.' },
  'cyp2d6-inhibition': { slug: 'cyp2d6', name: 'CYP2D6 inhibition', kind: 'enzyme-inhibition', short: 'Slows the enzyme handling many antidepressants, antipsychotics, opioids and psilocin.', why: 'For a prodrug like codeine the effect inverts — less active drug, not more.' },
  'cyp1a2-inhibition': { slug: 'cyp1a2', name: 'CYP1A2 inhibition', kind: 'enzyme-inhibition', short: 'Slows the caffeine/clozapine/olanzapine/theophylline enzyme.', why: 'Narrow-margin drugs on this pathway accumulate quickly.' },
  'cyp1a2-induction': { slug: 'cyp1a2', name: 'CYP1A2 induction', kind: 'enzyme-induction', short: 'Raises CYP1A2 expression — polycyclic aromatic hydrocarbons and cruciferous vegetables do this.', why: 'Stopping the inducer (quitting smoking) is itself an interaction: levels rise with no dose change.' },
  'cyp2c9-inhibition': { slug: 'cyp2c9', name: 'CYP2C9 inhibition', kind: 'enzyme-inhibition', short: 'Slows the enzyme handling S-warfarin, phenytoin and NSAIDs.', why: 'S-warfarin is the clinically dominant enantiomer; small shifts move the INR.' },
  'cyp2c19-inhibition': { slug: 'cyp2c19', name: 'CYP2C19 inhibition', kind: 'enzyme-inhibition', short: 'Slows the enzyme handling clopidogrel activation, PPIs and some benzodiazepines.', why: 'For clopidogrel the effect is loss of antiplatelet activity, not accumulation.' },
  'pgp-inhibition': { slug: 'p-glycoprotein', name: 'P-glycoprotein inhibition', kind: 'transporter', short: 'Blocks the efflux pump that ejects drugs back into the gut lumen and out of the brain.', why: 'Raises absorption of P-gp substrates like digoxin, and can raise brain exposure independently of blood level.' },
  'pgp-induction': { slug: 'p-glycoprotein', name: 'P-glycoprotein induction', kind: 'transporter', short: 'Increases the efflux pump, lowering absorption.', why: 'St John\'s wort does this and CYP3A4 induction at the same time — two mechanisms pointing the same way.' },
  '11bhsd2-inhibition': { slug: 'mineralocorticoid', name: '11β-HSD2 inhibition (pseudohyperaldosteronism)', kind: 'enzyme-inhibition', short: 'Blocks the enzyme that inactivates cortisol in the kidney, so cortisol acts on the mineralocorticoid receptor.', why: 'Produces the picture of excess aldosterone with low aldosterone: sodium retention, potassium loss, hypertension.' },
  'qt-prolongation': { slug: 'qt', name: 'QT prolongation', kind: 'pharmacodynamic', short: 'Delays cardiac repolarisation, usually by blocking the hERG potassium channel.', why: 'Additive across agents, and made worse by low potassium or magnesium — which is how an electrolyte interaction becomes a cardiac one.' },
  'tyramine-load': { slug: 'tyramine', name: 'Dietary tyramine load', kind: 'dietary', short: 'Food that carries pressor amines produced by bacterial decarboxylation during ageing or fermentation.', why: 'Harmless when gut and liver MAO-A destroy it. Not harmless when that enzyme is blocked.' },
  'ldopa-load': { slug: 'tyramine', name: 'Dietary L-dopa load', kind: 'dietary', short: 'Food carrying levodopa, which is converted to dopamine and noradrenaline.', why: 'This is why broad-bean PODS are on the MAOI list — the mechanism is L-dopa, not tyramine, and the distinction matters because it changes which part of the plant is the problem.' },
  'hepatotoxicity': { slug: 'liver', name: 'Additive hepatotoxicity', kind: 'organ-toxicity', short: 'Two or more agents with documented liver injury signals taken together.', why: 'Not a pharmacokinetic interaction; the additivity is at the organ.' },
  'seizure-threshold': { slug: 'seizure', name: 'Seizure-threshold lowering', kind: 'pharmacodynamic', short: 'Agents that make a seizure more likely, additively.', why: 'A CYP interaction that raises the blood level of a seizure-threshold-lowering drug converts a pharmacokinetic problem into a neurological one.' },
});

// ── SUBSTANCES ────────────────────────────────────────────────────────────────────────────────────
// A substance is anything a person can declare they are taking: a prescription, a supplement, a plant
// preparation, a food, a seasoning. The engine does not care which — it cares what ROLES the substance
// plays on which MECHANISMS.
//
//   roles: [{ mech, role, strength, note, cites }]
//     role  'inhibits' | 'induces' | 'substrate' | 'provides' | 'agonist'
//     strength  'strong' | 'moderate' | 'weak' | 'variable'
//
//   nti: true          narrow therapeutic index — a small shift in level is a clinical event
//   kind: 'medication' | 'supplement' | 'plant' | 'food' | 'seasoning' | 'drug-class' | 'other'
//
// A substance with an empty roles[] is still worth listing: it tells the reader we KNOW about it and
// have no documented mechanism for it, which is different from it being absent.
const S = (o) => Object.freeze(o);

export const SUBSTANCES = Object.freeze([
  // ── MAO inhibitors ──────────────────────────────────────────────────────────────────────────────
  S({ id: 'phenelzine', name: 'Phenelzine', aka: ['Nardil'], kind: 'medication', slug: 'phenelzine',
    summary: 'Irreversible, non-selective MAO inhibitor. The reference case for both hazards on this page.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'strong', note: 'Irreversible; enzyme activity returns only as new enzyme is synthesised, over about two weeks.', cites: ['gillman2011', 'gillman2018'] },
      { mech: 'mao-b-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2011'] },
    ],
    // Verbatim from the FDA label, retrieved via the openFDA drug/label API on 2026-09-09. Quoted
    // rather than paraphrased because it is the regulator's own words on the mechanism this engine
    // scores as critical — the label and the literature agree, and saying so is the point.
    fdaLabel: 'In patients receiving nonselective monoamine oxidase (MAO) inhibitors in combination '
      + 'with serotoninergic agents (e.g., dexfenfluramine, fluoxetine, fluvoxamine, paroxetine, '
      + 'sertraline, citalopram, venlafaxine) there have been reports of serious, sometimes fatal, '
      + 'reactions. Because Phenelzine Sulfate Tablets is a monoamine oxidase (MAO) inhibitor, '
      + 'Phenelzine Sulfate Tablets should not be used concomitantly with a serotoninergic agent.',
    fdaLabelCite: 'openfdaLabel' }),
  S({ id: 'tranylcypromine', name: 'Tranylcypromine', aka: ['Parnate'], kind: 'medication', slug: 'tranylcypromine',
    summary: 'Irreversible non-selective MAOI with additional amphetamine-like releasing activity.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'strong', note: 'Irreversible and non-selective, and unlike phenelzine it additionally releases noradrenaline in the manner of an amphetamine. That second property is why its pressor reactions can be more abrupt, and why it is the MAOI with the most stimulant-like adverse-effect profile.', cites: ['gillman2011', 'gillman2018'] },
      { mech: 'mao-b-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2011'] },
    ] }),
  S({ id: 'isocarboxazid', name: 'Isocarboxazid', aka: ['Marplan'], kind: 'medication', slug: 'isocarboxazid',
    summary: 'Irreversible non-selective MAOI.',
    roles: [{ mech: 'mao-a-inhibition', role: 'inhibits', strength: 'strong', note: 'Irreversible and non-selective. The same two-week enzyme-resynthesis rule applies to it as to phenelzine and tranylcypromine, so both the dietary restriction and the washout interval before any serotonergic drug are measured in weeks rather than days.', cites: ['gillman2011'] }] }),
  S({ id: 'moclobemide', name: 'Moclobemide', aka: ['Manerix', 'Aurorix', 'RIMA'], kind: 'medication', slug: 'moclobemide',
    summary: 'Reversible inhibitor of MAO-A (RIMA). Reversibility is the whole point: dietary tyramine can displace it from the enzyme, so the pressor hazard is far smaller than with the irreversible drugs.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'moderate', reversible: true, note: 'Reversible and competitive — tyramine displaces it. The tyramine pressor dose is raised only about 2–4 fold, versus roughly 10–50 fold for irreversible MAOIs, and the classic diet is not generally required at standard doses.', cites: ['bonnet2003', 'gillman2018'] },
    ] }),
  S({ id: 'selegiline-oral', name: 'Selegiline (oral)', aka: ['Eldepryl', 'l-deprenyl'], kind: 'medication', slug: 'selegiline-oral',
    summary: 'MAO-B selective at low dose (≤10 mg/day). Selectivity is dose-dependent and is lost as dose rises.',
    roles: [
      { mech: 'mao-b-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2011'] },
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'weak', note: 'At doses above roughly 10 mg/day B-selectivity is progressively lost and the MAO-A hazards return.', cites: ['gillman2011'] },
    ] }),
  S({ id: 'selegiline-transdermal', name: 'Selegiline transdermal system', aka: ['EMSAM', 'STS'], kind: 'medication', slug: 'selegiline-transdermal',
    summary: 'The patch bypasses the gut. Brain MAO-A and MAO-B are inhibited while gut MAO-A is largely spared — which is exactly why the 6 mg/24 h dose carries no tyramine diet.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'moderate', note: 'Central MAO-A inhibited; INTESTINAL MAO-A largely spared, which is the mechanistic reason the diet is not required at 6 mg/24 h.', cites: ['azzaro2006'] },
      { mech: 'mao-b-inhibition', role: 'inhibits', strength: 'strong', cites: ['azzaro2006'] },
    ] }),
  S({ id: 'rasagiline', name: 'Rasagiline', aka: ['Azilect'], kind: 'medication', slug: 'rasagiline',
    summary: 'MAO-B selective irreversible inhibitor used in Parkinson disease.',
    roles: [{ mech: 'mao-b-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2011'] }] }),
  S({ id: 'linezolid', name: 'Linezolid', aka: ['Zyvox'], kind: 'medication', slug: 'linezolid',
    summary: 'An oxazolidinone ANTIBIOTIC that is also a reversible, non-selective MAO inhibitor. The most-missed MAOI in medicine, because nobody expects an antibiotic to be one.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'moderate', reversible: true, note: 'Reversible. Serotonin toxicity has been reported repeatedly when it is started in someone already on a serotonergic antidepressant.', cites: ['gillman2003linezolid', 'quinn2009', 'lawrence2006'] },
    ] }),
  S({ id: 'methylene-blue', name: 'Methylene blue (methylthioninium chloride)', aka: ['methylthioninium'], kind: 'medication', slug: 'methylene-blue',
    summary: 'A dye and antidote that is a potent MAO-A inhibitor. Given intravenously in surgery and for methaemoglobinaemia — a second MAOI hiding in plain sight.',
    roles: [{ mech: 'mao-a-inhibition', role: 'inhibits', strength: 'strong', note: 'Given intravenously in theatre for vasoplegia and parathyroid localisation, and for methaemoglobinaemia — settings where nobody is reviewing the patient\'s antidepressant. Serotonin toxicity following intraoperative methylene blue in a patient on an SSRI is a recognised event, and the exposure is a single dose nobody wrote on a medication list.', cites: ['gillman2018'] }] }),
  S({ id: 'harmala', name: 'Harmala alkaloids (harmine, harmaline, tetrahydroharmine)', aka: ['Syrian rue', 'Peganum harmala', 'Banisteriopsis caapi', 'caapi', 'ayahuasca vine'], kind: 'plant', slug: 'harmala',
    summary: 'The β-carbolines in Syrian rue and the ayahuasca vine. Reversible, competitive, MAO-A selective — pharmacologically a RIMA, and the reason an orally-inactive tryptamine becomes orally active.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'strong', reversible: true, note: 'Harmine and harmaline are potent competitive MAO-A inhibitors in human tissue; tetrahydroharmine additionally inhibits serotonin reuptake.', cites: ['herraiz2010', 'callaway1999', 'riba2003'] },
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'weak', note: 'Tetrahydroharmine component.', cites: ['callaway1999'] },
    ] }),
  S({ id: 'ayahuasca', name: 'Ayahuasca (hoasca, daime)', aka: ['hoasca', 'daime', 'yagé', 'vegetal'], kind: 'plant', slug: 'ayahuasca',
    summary: 'A brew combining a harmala-containing vine with a DMT-containing admixture. Carries both mechanisms at once: MAO-A inhibition and direct serotonin agonism.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'strong', reversible: true, note: 'The brew delivers MAO-A inhibition and a direct 5-HT agonist in the same cup, by design — that is what makes it orally active. It therefore carries the serotonergic hazard from both directions at once, which is the specific reason the ayahuasca harm-reduction literature is emphatic about SSRI washout before a session.', cites: ['callaway1999', 'riba2003'] },
      { mech: 'serotonin-agonism', role: 'agonist', strength: 'strong', cites: ['riba2003'] },
    ] }),

  // ── serotonergic drugs ──────────────────────────────────────────────────────────────────────────
  S({ id: 'fluoxetine', name: 'Fluoxetine', aka: ['Prozac'], kind: 'medication', slug: 'fluoxetine',
    summary: 'SSRI, and a strong CYP2D6 inhibitor in its own right. Its active metabolite norfluoxetine has a 1–2 week half-life, so the washout before an MAOI is 5 weeks, not 2.',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', note: 'Because of norfluoxetine\'s long half-life, the conventional interval before starting an MAOI is about 5 weeks.', cites: ['gillman2006', 'boyer2005'] },
      { mech: 'cyp2d6-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable', 'flockhart'] },
    ] }),
  S({ id: 'paroxetine', name: 'Paroxetine', aka: ['Paxil', 'Seroxat'], kind: 'medication', slug: 'paroxetine',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2006'] },
      { mech: 'cyp2d6-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable', 'flockhart'] },
    ] }),
  S({ id: 'sertraline', name: 'Sertraline', aka: ['Zoloft'], kind: 'medication', slug: 'sertraline',
    roles: [{ mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', note: 'A potent SSRI with a comparatively clean CYP-inhibition profile — unlike fluoxetine and paroxetine it is not a strong CYP2D6 inhibitor, so the serotonergic axis is essentially the whole of its interaction story.', cites: ['gillman2006'] }] }),
  S({ id: 'citalopram', name: 'Citalopram / escitalopram', aka: ['Celexa', 'Lexapro', 'escitalopram'], kind: 'medication', slug: 'citalopram',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2006'] },
      { mech: 'qt-prolongation', role: 'agonist', strength: 'moderate', note: 'Dose-dependent QT prolongation; the reason citalopram carries a maximum-dose restriction.', cites: ['crediblemeds', 'roden2004'] },
    ] }),
  S({ id: 'fluvoxamine', name: 'Fluvoxamine', aka: ['Luvox', 'Faverin'], kind: 'medication', slug: 'fluvoxamine',
    summary: 'SSRI and the strongest routinely-used CYP1A2 inhibitor — which is why it multiplies caffeine, clozapine and theophylline levels.',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2006'] },
      { mech: 'cyp1a2-inhibition', role: 'inhibits', strength: 'strong', note: 'Roughly fivefold reduction in caffeine clearance in healthy volunteers.', cites: ['culmmerdek2005', 'fdaTable'] },
    ] }),
  S({ id: 'venlafaxine', name: 'Venlafaxine / desvenlafaxine', aka: ['Effexor'], kind: 'medication', slug: 'venlafaxine',
    roles: [{ mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', note: 'Venlafaxine is serotonergic at all doses and adds noradrenaline reuptake inhibition as the dose rises, which is why it appears in serotonin-toxicity series more often than its prescribing volume alone would predict, and why it is the SNRI most associated with toxicity in overdose.', cites: ['gillman2006'] }] }),
  S({ id: 'duloxetine', name: 'Duloxetine', aka: ['Cymbalta'], kind: 'medication', slug: 'duloxetine',
    roles: [{ mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', note: 'An SNRI, so it carries the serotonergic hazard of an SSRI with noradrenergic activity on top. It is also a substrate of CYP1A2 and CYP2D6, which means a CYP inhibitor elsewhere in the stack raises the serotonergic load without anyone changing a dose.', cites: ['gillman2006'] }] }),
  S({ id: 'clomipramine', name: 'Clomipramine', aka: ['Anafranil'], kind: 'medication', slug: 'clomipramine',
    summary: 'The one tricyclic that is a potent serotonin reuptake inhibitor. Gillman\'s data separate it and imipramine from the rest of the class on exactly this axis.',
    roles: [{ mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2006'] }] }),
  S({ id: 'amitriptyline', name: 'Amitriptyline', aka: ['Elavil'], kind: 'medication', slug: 'amitriptyline',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'weak', note: 'Most tricyclics other than clomipramine and imipramine are weak SRIs and are NOT strongly associated with serotonin toxicity.', cites: ['gillman2006'] },
      { mech: 'qt-prolongation', role: 'agonist', strength: 'moderate', cites: ['crediblemeds'] },
    ] }),
  S({ id: 'tramadol', name: 'Tramadol', aka: ['Ultram'], kind: 'medication', slug: 'tramadol',
    summary: 'An opioid that is also a serotonin and noradrenaline reuptake inhibitor, and lowers the seizure threshold. Three mechanisms in one tablet, which is why it appears in so many case reports.',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'moderate', note: 'Tramadol is the opioid most often named in serotonin-toxicity case reports, and the reason is structural rather than incidental: the molecule was designed with monoamine reuptake activity, so the analgesia and the serotonergic load are not separable by dose adjustment. Gillman\'s classification puts it with meperidine, methadone and the fentanyls among the SRI opioids, apart from morphine, codeine and oxycodone which are not.', cites: ['beakley2015', 'gillman2005'] },
      { mech: 'seizure-threshold', role: 'agonist', strength: 'moderate', cites: ['beakley2015'] },
      { mech: 'cyp2d6-inhibition', role: 'substrate', strength: 'moderate', note: 'CYP2D6 converts tramadol to its far more potent O-desmethyl metabolite, so a CYP2D6 inhibitor reduces ANALGESIA while leaving the serotonergic parent drug in place.', cites: ['beakley2015', 'flockhart'] },
    ] }),
  S({ id: 'meperidine', name: 'Meperidine (pethidine)', aka: ['Demerol', 'pethidine'], kind: 'medication', slug: 'meperidine',
    summary: 'The historical MAOI-opioid catastrophe. Gillman\'s review separates the opioids that are serotonin reuptake inhibitors (meperidine, tramadol, methadone, dextropropoxyphene, and the fentanyls) from those that are not (morphine, codeine, oxycodone, buprenorphine).',
    roles: [{ mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'strong', cites: ['gillman2005'] }] }),
  S({ id: 'dextromethorphan', name: 'Dextromethorphan', aka: ['DXM', 'Robitussin DM', 'Delsym'], kind: 'medication', slug: 'dextromethorphan',
    summary: 'An over-the-counter cough suppressant that is a serotonin reuptake inhibitor and a CYP2D6 substrate. Sold without a prescription, which is exactly why it gets missed.',
    roles: [
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'moderate', note: 'Dextromethorphan is bought off a supermarket shelf in a cough syrup, so it is absent from the medication list a patient recites and absent from the pharmacy record. Case reports of serotonin toxicity with it involve exactly that: a serotonergic antidepressant plus an over-the-counter cold remedy nobody counted as a drug.', cites: ['schwartz2008', 'boyer2005'] },
      { mech: 'cyp2d6-inhibition', role: 'substrate', strength: 'strong', note: 'The archetypal CYP2D6 probe substrate. A CYP2D6 inhibitor raises its level several-fold.', cites: ['flockhart', 'fdaTable'] },
    ] }),
  S({ id: 'triptans', name: 'Triptans (sumatriptan, rizatriptan, zolmitriptan…)', aka: ['sumatriptan', 'rizatriptan', 'zolmitriptan', 'Imitrex'], kind: 'drug-class', slug: 'triptans',
    summary: 'Selective 5-HT1B/1D agonists. The FDA issued a 2006 alert about serotonin syndrome with triptan + SSRI/SNRI; the American Headache Society reviewed the evidence and found it weak.',
    roles: [{ mech: 'serotonin-agonism', role: 'agonist', strength: 'weak', note: 'The AHS position paper concluded the evidence for triptan + SSRI/SNRI serotonin syndrome is insufficient to support the FDA alert as written — the receptor subtypes involved (5-HT1B/1D) are not the ones implicated in serotonin toxicity. Reported here as a documented signal of contested strength, not as a strong hazard.', cites: ['evans2010'] }] }),
  S({ id: 'mdma', name: 'MDMA', aka: ['3,4-methylenedioxymethamphetamine', 'ecstasy', 'molly'], kind: 'other', slug: 'mdma',
    summary: 'A serotonin RELEASER, not merely a reuptake inhibitor. Releasers are the class most strongly implicated in fatal serotonin toxicity with MAO inhibitors.',
    roles: [{ mech: 'serotonin-release', role: 'agonist', strength: 'strong', note: 'Releasers are categorically more dangerous with MAO inhibition than reuptake inhibitors are. A reuptake inhibitor stops serotonin returning to the terminal; a releaser empties the terminal into the synapse, and with MAO blocked there is no route of destruction for what is released. The fatal MAOI cases in the literature are concentrated in this combination.', cites: ['gillman2006', 'boyer2005'] }] }),
  S({ id: 'psilocybin', name: 'Psilocybin / psilocin', aka: ['psilocin', 'magic mushrooms', 'Psilocybe'], kind: 'plant', slug: 'psilocybin',
    summary: 'A 5-HT2A agonist whose active form, psilocin, is cleared by CYP2D6 and by UGT glucuronidation — which is the pharmacological basis of the oilahuasca corpus\' potentiation claims.',
    roles: [
      { mech: 'serotonin-agonism', role: 'agonist', strength: 'strong', cites: ['boyer2005'] },
      { mech: 'cyp2d6-inhibition', role: 'substrate', strength: 'moderate', note: 'Psilocin is a CYP2D6 substrate; inhibiting CYP2D6 raises exposure. This is the archive\'s own potentiation mechanism and it cuts both ways — the same rule that predicts a stronger experience predicts an unintended overdose.', cites: ['flockhart'] },
    ] }),
  S({ id: 'dmt', name: 'N,N-DMT', aka: ['dimethyltryptamine', 'chacruna', 'Psychotria viridis', 'Mimosa hostilis'], kind: 'plant', slug: 'dmt',
    summary: 'Orally inactive alone because gut and liver MAO-A destroy it. Orally active only when MAO-A is inhibited — which means every oral DMT preparation is, by construction, an MAOI preparation.',
    roles: [{ mech: 'serotonin-agonism', role: 'agonist', strength: 'strong', note: 'Rapidly deaminated by MAO-A; oral activity requires MAO-A inhibition.', cites: ['callaway1999', 'riba2003'] }] }),
  S({ id: 'lithium', name: 'Lithium', aka: ['lithium carbonate', 'Lithobid'], kind: 'medication', slug: 'lithium', nti: true,
    summary: 'Narrow therapeutic index, cleared by the kidney rather than by CYP enzymes — so the things that shift it are salt, water, NSAIDs, ACE inhibitors and thiazides, not CYP inhibitors.',
    roles: [{ mech: 'serotonin-agonism', role: 'agonist', strength: 'weak', note: 'Listed among agents contributing to serotonergic load in case series.', cites: ['boyer2005'] }] }),
  S({ id: 'buspirone', name: 'Buspirone', aka: ['Buspar'], kind: 'medication', slug: 'buspirone',
    roles: [
      { mech: 'serotonin-agonism', role: 'agonist', strength: 'moderate', note: '5-HT1A partial agonist.', cites: ['boyer2005'] },
      { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', note: 'A textbook CYP3A4 victim: grapefruit juice raises buspirone exposure severalfold.', cites: ['bailey2013', 'flockhart'] },
    ] }),
  S({ id: 'bupropion', name: 'Bupropion', aka: ['Wellbutrin', 'Zyban'], kind: 'medication', slug: 'bupropion',
    summary: 'Not serotonergic — a noradrenaline/dopamine reuptake inhibitor. It is on this list for two other reasons: it is a strong CYP2D6 inhibitor, and it lowers the seizure threshold.',
    roles: [
      { mech: 'cyp2d6-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable', 'flockhart'] },
      { mech: 'seizure-threshold', role: 'agonist', strength: 'strong', cites: ['fdaTable'] },
    ] }),

  // ── seasonings and foods: the part people do not expect ─────────────────────────────────────────
  S({ id: 'grapefruit', name: 'Grapefruit', aka: ['grapefruit juice', 'pomelo', 'Seville orange', 'sour orange', 'bitter orange (Seville)'], kind: 'food', slug: 'grapefruit',
    summary: 'The canonical food–drug interaction. Furanocoumarins — bergamottin and 6\',7\'-dihydroxybergamottin — destroy INTESTINAL CYP3A4 irreversibly. The enzyme has to be resynthesised, so the effect outlasts the juice by days.',
    roles: [
      { mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'strong', note: 'Mechanism-based (irreversible) inactivation of enterocyte CYP3A4. A single 200–300 mL glass is enough. Recovery of CYP3A activity takes roughly 3 days, and separating the juice from the dose by a few hours does NOT avoid it — which is the part almost every patient gets wrong.', cites: ['bailey2013', 'bailey1991', 'paine2006', 'lown1997', 'lundahl1995', 'greenblatt2003', 'edwards1996'] },
      { mech: 'pgp-inhibition', role: 'inhibits', strength: 'weak', cites: ['bailey2013'] },
    ] }),
  S({ id: 'black-pepper', name: 'Black pepper (piperine)', aka: ['piperine', 'Piper nigrum', 'long pepper', 'BioPerine'], kind: 'seasoning', slug: 'black-pepper',
    summary: 'The reason piperine is in supplement stacks is exactly the reason it is on this page: it inhibits CYP3A4 and P-glycoprotein, so it raises the blood level of whatever it is sold alongside. "Enhanced bioavailability" and "drug interaction" are the same sentence read from two directions.',
    roles: [
      { mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'moderate', note: 'Volak et al. characterise piperine as a relatively SELECTIVE CYP3A4 inhibitor among the common spice constituents. Shoba et al. measured a 20-fold increase in curcumin bioavailability in humans from 20 mg piperine.', cites: ['bhardwaj2002', 'volak2008', 'shoba1998'] },
      { mech: 'pgp-inhibition', role: 'inhibits', strength: 'moderate', cites: ['bhardwaj2002'] },
    ] }),
  S({ id: 'turmeric', name: 'Turmeric / curcumin', aka: ['curcumin', 'Curcuma longa', 'curcuminoids'], kind: 'seasoning', slug: 'turmeric',
    summary: 'Curcuminoids inhibit several CYPs plus the phase-2 conjugating enzymes (UGT and SULT). Phase 2 matters here: the corpus\' own metabolism files turn on glucuronidation and sulfation, and this is a common seasoning that moves both.',
    roles: [
      { mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'moderate', note: 'Also inhibits UGT and SULT — a phase-2 interaction, which most interaction checkers do not model at all.', cites: ['volak2008', 'bahramsoltani2017'] },
      { mech: 'cyp2c9-inhibition', role: 'inhibits', strength: 'moderate', cites: ['volak2008', 'bahramsoltani2017'] },
    ] }),
  S({ id: 'licorice', name: 'Licorice (glycyrrhizin)', aka: ['liquorice', 'Glycyrrhiza glabra', 'glycyrrhizin', 'glycyrrhizic acid', 'mulethi'], kind: 'seasoning', slug: 'licorice',
    summary: 'The interaction almost nobody knows about, and it hospitalises people. Glycyrrhizin inhibits 11β-HSD2, so cortisol acts on the mineralocorticoid receptor: sodium and water retained, potassium lost, blood pressure up. Reported at intakes as low as ~100 mg glycyrrhizin per day sustained.',
    roles: [
      { mech: '11bhsd2-inhibition', role: 'inhibits', strength: 'strong', note: 'Produces hypokalaemia, metabolic alkalosis, oedema and hypertension — pseudohyperaldosteronism, with aldosterone SUPPRESSED. Case reports include rhabdomyolysis, hypokalaemic paralysis and cardiac arrhythmia. It resolves on withdrawal, but slowly (weeks).', cites: ['stormer1993', 'omar2012', 'farese1991'] },
    ] }),
  S({ id: 'nutmeg', name: 'Nutmeg (myristicin, elemicin)', aka: ['myristicin', 'elemicin', 'Myristica fragrans', 'mace'], kind: 'seasoning', slug: 'nutmeg',
    summary: 'The corpus\' own founding substance, and a jar in the average kitchen. Myristicin and elemicin are allylbenzenes; nutmeg is a documented poisoning agent with a fatal case in the literature, and myristicin has documented MAO-inhibitory activity.',
    roles: [
      { mech: 'mao-a-inhibition', role: 'inhibits', strength: 'weak', note: 'Truitt et al. (1963) demonstrated MAO inhibition by myristicin and nutmeg. The evidence is old and largely non-human; treat it as a documented signal of uncertain human magnitude, not as an equivalent of a prescribed MAOI. Marked here deliberately as WEAK rather than dropped, because a weak documented signal in a kitchen spice is worth a reader knowing about.', cites: ['truitt1963'] },
      { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'moderate', note: 'Myristicin, elemicin and safrole are metabolised by CYP enzymes including CYP3A4 and CYP1A2; inhibiting those pathways shifts which metabolites form. This is the archive\'s central mechanistic claim.', cites: ['beyer2006'] },
    ],
    toxicity: 'Acute nutmeg poisoning is documented from roughly 5 g upward (about one to two whole nutmegs), with anticholinergic-like delirium, tachycardia, severe nausea and a 24–72 h course. A fatal case is reported in an adolescent; the Illinois Poison Center series describes 32 cases over 10 years, most in intentional-abuse context. There is no antidote — care is supportive.',
    toxicityCites: ['stein2001', 'ehrenpreis2014'] }),
  S({ id: 'cinnamon-cassia', name: 'Cassia cinnamon (coumarin)', aka: ['cassia', 'Cinnamomum cassia', 'Chinese cinnamon', 'coumarin', 'supermarket cinnamon'], kind: 'seasoning', slug: 'cinnamon-cassia',
    summary: 'Cassia is what almost all supermarket "cinnamon" is, and it carries coumarin — a hepatotoxin in susceptible people. Ceylon cinnamon (Cinnamomum verum) carries almost none. This is a species distinction, not a quality one, and the label rarely states it.',
    roles: [
      { mech: 'hepatotoxicity', role: 'provides', strength: 'moderate', note: 'Woehrlin et al. measured German retail cassia powder at a median of about 3 g coumarin per kg, versus trace amounts in Ceylon cinnamon. EFSA set a coumarin TDI of 0.1 mg/kg body weight per day; a few grams of cassia powder daily can exceed it for an adult. Coumarin hepatotoxicity is idiosyncratic and reversible on withdrawal. NOTE: this coumarin is NOT an anticoagulant — it is not warfarin, and cinnamon is not a blood thinner by this route.', cites: ['woehrlin2010', 'abraham2010', 'efsa2004coumarin'] },
    ] }),
  S({ id: 'cinnamon-ceylon', name: 'Ceylon cinnamon', aka: ['Cinnamomum verum', 'true cinnamon'], kind: 'seasoning', slug: 'cinnamon-ceylon',
    summary: 'The low-coumarin species. Listed so that the distinction from cassia is stated rather than implied.',
    roles: [{ mech: 'hepatotoxicity', role: 'provides', strength: 'weak', note: 'Coumarin content is at or near the detection limit in authentic Ceylon samples — orders of magnitude below cassia.', cites: ['woehrlin2010'] }] }),
  S({ id: 'star-anise', name: 'Star anise (Chinese vs Japanese)', aka: ['Illicium verum', 'Illicium anisatum', 'badian', 'shikimi'], kind: 'seasoning', slug: 'star-anise',
    summary: 'A substitution hazard rather than a drug interaction. Chinese star anise (Illicium verum) is the culinary spice. Japanese star anise (Illicium anisatum) is a neurotoxic look-alike containing anisatin, a GABA-A antagonist that causes seizures. Adulteration of commercial supply has caused clusters of infant poisonings.',
    roles: [
      { mech: 'seizure-threshold', role: 'agonist', strength: 'strong', note: 'Applies to Illicium anisatum and to adulterated supply, NOT to authentic Illicium verum. Ize-Ludlow et al. describe seven infants with neurological toxicity after star anise tea; the two species are difficult to tell apart once ground.', cites: ['izeludlow2004'] },
    ] }),
  S({ id: 'clove', name: 'Clove (eugenol)', aka: ['eugenol', 'Syzygium aromaticum'], kind: 'seasoning', slug: 'clove',
    summary: 'Eugenol inhibits several CYPs. Included because the archive names clove as a core potentiator herb.',
    roles: [
      { mech: 'cyp2d6-inhibition', role: 'inhibits', strength: 'weak', note: 'MARKED WEAK DELIBERATELY. The in-vitro inhibition is well described; human in-vivo confirmation at culinary or capsule doses is what this dataset does not have. Treat the magnitude as unestablished in humans.', cites: ['flockhart'] },
      { mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'weak', note: 'Same caveat: in-vitro signal, human magnitude unestablished.', cites: ['flockhart'] },
    ] }),
  S({ id: 'caffeine', name: 'Caffeine', aka: ['coffee', 'tea', 'energy drink', 'guarana'], kind: 'food', slug: 'caffeine',
    summary: 'The most-consumed CYP1A2 substrate on earth, which makes it a sensitive early warning for anything that moves that enzyme.',
    roles: [
      { mech: 'cyp1a2-inhibition', role: 'substrate', strength: 'strong', note: 'Fluvoxamine reduces caffeine clearance roughly fivefold. If a new medication suddenly makes your usual coffee feel like three, that is CYP1A2 talking.', cites: ['culmmerdek2005', 'flockhart'] },
    ] }),
  S({ id: 'tobacco-smoke', name: 'Tobacco smoke', aka: ['smoking', 'cigarettes'], kind: 'other', slug: 'tobacco-smoke',
    summary: 'Not the nicotine — the polycyclic aromatic hydrocarbons in the smoke, which induce CYP1A2. Included because STOPPING is the interaction: levels of clozapine, olanzapine and theophylline rise with no dose change.',
    roles: [
      { mech: 'cyp1a2-induction', role: 'induces', strength: 'strong', note: 'Faber and Fuhr measured CYP1A2 activity falling by about 36% within roughly a week of stopping heavy smoking. Nicotine replacement does NOT substitute — the inducer is the smoke, not the nicotine, so vaping or patches will not hold the induction.', cites: ['faber2004', 'flockhart'] },
    ] }),
  S({ id: 'cruciferous', name: 'Cruciferous vegetables and charred meat', aka: ['broccoli', 'brussels sprouts', 'cabbage', 'grilled meat', 'char-grilled'], kind: 'food', slug: 'cruciferous',
    summary: 'Dietary CYP1A2 inducers. Real, modest, and mostly relevant if a very large dietary change coincides with a narrow-margin CYP1A2 drug.',
    roles: [{ mech: 'cyp1a2-induction', role: 'induces', strength: 'weak', cites: ['flockhart'] }] }),

  // ── tyramine-bearing foods ──────────────────────────────────────────────────────────────────────
  S({ id: 'aged-cheese', name: 'Aged and mature cheese', aka: ['cheddar', 'stilton', 'blue cheese', 'camembert', 'parmesan', 'gruyere'], kind: 'food', slug: 'aged-cheese',
    summary: 'The original "cheese reaction". Tyramine forms as bacteria decarboxylate tyrosine during ageing, so content tracks maturation, not fat or type. Fresh cheeses — cottage, ricotta, cream cheese, fresh mozzarella — are low.',
    roles: [{ mech: 'tyramine-load', role: 'provides', strength: 'strong', note: 'Walker et al. measured wide variation: many aged cheeses well above 6 mg per serving, some samples far higher, with the same named cheese varying between samples. Variability is the hazard — you cannot tell by looking.', cites: ['walker1996', 'shulman1999', 'blackwell1963', 'blackwell1967'] }] }),
  S({ id: 'cured-meat', name: 'Cured, dried and fermented meat', aka: ['salami', 'pepperoni', 'prosciutto', 'dry sausage', 'aged sausage', 'liver pate'], kind: 'food', slug: 'cured-meat',
    roles: [{ mech: 'tyramine-load', role: 'provides', strength: 'strong', note: 'Fermented and air-dried sausages are consistently high. Fresh meat is not a source; spoiled or improperly stored meat is.', cites: ['walker1996', 'shulman1999'] }] }),
  S({ id: 'soy-sauce', name: 'Soy sauce and fermented soy', aka: ['miso', 'tempeh', 'fermented bean curd', 'natto', 'tamari', 'fish sauce'], kind: 'food', slug: 'soy-sauce',
    summary: 'The category where the modern measurements changed the advice most: Shulman and Walker found soy sauce samples ranging from negligible to very high, and fermented soybean products (miso, fermented bean curd) among the highest.',
    roles: [{ mech: 'tyramine-load', role: 'provides', strength: 'variable', note: 'Highly variable between products and brands. Ordinary soy sauce in a normal serving is usually modest; fermented soybean pastes and fermented bean curd can be high.', cites: ['shulman1999', 'walker1996'] }] }),
  S({ id: 'yeast-extract', name: 'Yeast extract and brewer\'s yeast', aka: ['Marmite', 'Vegemite', 'brewer\'s yeast', 'Bovril', 'yeast extract spread'], kind: 'food', slug: 'yeast-extract',
    summary: 'Concentrated yeast extract is one of the reliably high-tyramine items and one of the few where the classic prohibition survives modern measurement unchanged. Baker\'s yeast in bread is NOT a source.',
    roles: [{ mech: 'tyramine-load', role: 'provides', strength: 'strong', cites: ['walker1996', 'gardner1996', 'gillman2018'] }] }),
  S({ id: 'tap-beer', name: 'Tap (draught) and unpasteurised beer', aka: ['draught beer', 'draft beer', 'home-brew', 'cask ale', 'unpasteurised beer'], kind: 'food', slug: 'tap-beer',
    summary: 'The precise version of "avoid beer". Shulman et al. measured Canadian tap beers and found some with tyramine high enough to matter, while bottled and canned beers were consistently low. The rule is about pasteurisation and ongoing fermentation, not alcohol.',
    roles: [{ mech: 'tyramine-load', role: 'provides', strength: 'variable', note: 'Bottled/canned commercial beer: low, and two standard drinks are generally regarded as acceptable in modern MAOI guidance. Tap, cask and home-brewed beer: unpredictable and occasionally high. Tailor et al. re-analysed the classic phenelzine + tap beer hypertensive case and confirmed pressor amines in the beer.', cites: ['shulman1997beer', 'tailor1994', 'gillman2018'] }] }),
  S({ id: 'sauerkraut', name: 'Sauerkraut, kimchi and fermented vegetables', aka: ['kimchi', 'fermented vegetables', 'fermented cabbage'], kind: 'food', slug: 'sauerkraut',
    roles: [{ mech: 'tyramine-load', role: 'provides', strength: 'moderate', cites: ['walker1996', 'gardner1996'] }] }),
  S({ id: 'broad-bean', name: 'Broad bean (fava) PODS', aka: ['fava bean', 'fava pods', 'broad bean pods', 'Vicia faba'], kind: 'food', slug: 'broad-bean',
    summary: 'On the MAOI list for a DIFFERENT reason from everything else on it. The pods carry L-dopa, not tyramine — which is why the restriction is specifically about the pods and about large quantities, and why calling it "a tyramine food" gets the advice wrong.',
    roles: [{ mech: 'ldopa-load', role: 'provides', strength: 'moderate', note: 'The mechanism is levodopa content in the pod, converted to dopamine and noradrenaline. The shelled bean itself is a much smaller concern. Stating this correctly is the difference between a workable diet and a needlessly restrictive one.', cites: ['gardner1996', 'gillman2018'] }] }),
  S({ id: 'aged-fermented-generic', name: 'Anything aged, fermented, pickled, smoked or spoiled', aka: ['fermented food', 'aged food', 'spoiled food'], kind: 'food', slug: 'aged-fermented',
    summary: 'The general rule behind the list, stated so a reader can extend it to a food we did not name — which is the whole point of a mechanism-based checker.',
    roles: [{ mech: 'tyramine-load', role: 'provides', strength: 'variable', note: 'Tyramine is produced by bacterial decarboxylation of tyrosine. Freshness is the variable that matters; a food that was low last week can be high after poor storage.', cites: ['gardner1996', 'shulman1999', 'gillman2018'] }] }),

  // ── supplements and botanicals ──────────────────────────────────────────────────────────────────
  S({ id: 'st-johns-wort', name: "St John's wort", aka: ['Hypericum perforatum', 'hypericum', 'SJW'], kind: 'supplement', slug: 'st-johns-wort',
    summary: 'The canonical INDUCER, and the reason "natural" says nothing about safety. It activates the pregnane X receptor, raising CYP3A4 and P-glycoprotein together — so the drug is destroyed faster AND absorbed less. It has also caused documented transplant rejection and HIV treatment failure. Separately, it is serotonergic.',
    roles: [
      { mech: 'cyp3a4-induction', role: 'induces', strength: 'strong', note: 'Moore et al. identified PXR activation as the mechanism. Ruschitzka et al. reported acute heart transplant rejection from ciclosporin level collapse; Piscitelli et al. measured a 57% median fall in indinavir AUC in healthy volunteers.', cites: ['moore2000', 'ruschitzka2000', 'piscitelli2000', 'henderson2002'] },
      { mech: 'pgp-induction', role: 'induces', strength: 'strong', note: 'Johne et al. measured reduced digoxin exposure with hypericum extract.', cites: ['johne1999'] },
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'moderate', note: 'Serotonin syndrome has been reported with SJW plus SSRIs.', cites: ['henderson2002', 'boyer2005'] },
    ] }),
  S({ id: 'goldenseal', name: 'Goldenseal', aka: ['Hydrastis canadensis', 'berberine', 'hydrastine'], kind: 'supplement', slug: 'goldenseal',
    summary: 'One of the few botanicals with in-vivo human evidence of substantial CYP inhibition — Gurley et al. measured it directly with probe substrates, and it was the strongest of the four botanicals tested.',
    roles: [
      { mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'moderate', cites: ['gurley2005'] },
      { mech: 'cyp2d6-inhibition', role: 'inhibits', strength: 'moderate', cites: ['gurley2005'] },
    ] }),
  S({ id: 'kava', name: 'Kava', aka: ['Piper methysticum', 'kavalactones', 'awa'], kind: 'plant', slug: 'kava',
    summary: 'Carries a hepatotoxicity signal and measurable CYP2E1 inhibition in vivo. In the Gurley probe study kava did NOT significantly move CYP3A4 or CYP2D6, which is worth stating because it is frequently claimed that it does.',
    roles: [
      { mech: 'hepatotoxicity', role: 'provides', strength: 'moderate', cites: ['gurley2005'] },
    ] }),

  // ── the CYP reference drugs, so the rules have something to fire against ───────────────────────
  S({ id: 'ketoconazole', name: 'Ketoconazole / itraconazole', aka: ['itraconazole', 'Nizoral', 'Sporanox'], kind: 'medication', slug: 'ketoconazole',
    roles: [{ mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable'] }, { mech: 'pgp-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable'] }] }),
  S({ id: 'clarithromycin', name: 'Clarithromycin / erythromycin', aka: ['erythromycin', 'Biaxin'], kind: 'medication', slug: 'clarithromycin',
    roles: [{ mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable'] }, { mech: 'qt-prolongation', role: 'agonist', strength: 'moderate', cites: ['crediblemeds'] }] }),
  S({ id: 'ritonavir', name: 'Ritonavir', aka: ['Norvir', 'ritonavir-boosted', 'Paxlovid'], kind: 'medication', slug: 'ritonavir',
    summary: 'Deliberately used AS a CYP3A4 inhibitor to boost other antivirals — a reminder that an interaction is a tool when it is intended and a hazard when it is not.',
    roles: [{ mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable'] }] }),
  S({ id: 'rifampicin', name: 'Rifampicin (rifampin)', aka: ['rifampin', 'Rifadin'], kind: 'medication', slug: 'rifampicin',
    roles: [{ mech: 'cyp3a4-induction', role: 'induces', strength: 'strong', cites: ['fdaTable'] }, { mech: 'pgp-induction', role: 'induces', strength: 'strong', cites: ['fdaTable'] }] }),
  S({ id: 'carbamazepine', name: 'Carbamazepine', aka: ['Tegretol'], kind: 'medication', slug: 'carbamazepine', nti: true,
    roles: [{ mech: 'cyp3a4-induction', role: 'induces', strength: 'strong', cites: ['fdaTable'] }, { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', cites: ['flockhart'] }] }),
  S({ id: 'simvastatin', name: 'Simvastatin / lovastatin / atorvastatin', aka: ['lovastatin', 'atorvastatin', 'Zocor', 'Lipitor', 'statin', 'statins'], kind: 'medication', slug: 'statins',
    summary: 'Simvastatin and lovastatin are the two statins most dependent on CYP3A4. The consequence of over-exposure is myopathy and, rarely, rhabdomyolysis.',
    roles: [{ mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', note: 'Lilja et al. measured a roughly 16-fold increase in simvastatin AUC with high-dose grapefruit juice. Pravastatin, rosuvastatin and fluvastatin are NOT primarily CYP3A4 substrates and are the usual way round this.', cites: ['lilja1998', 'bailey2013', 'flockhart'] }] }),
  S({ id: 'felodipine', name: 'Felodipine / nifedipine / amlodipine', aka: ['nifedipine', 'amlodipine', 'calcium channel blocker', 'Plendil'], kind: 'medication', slug: 'calcium-channel-blockers',
    roles: [{ mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', note: 'Felodipine is the drug the grapefruit effect was discovered in, by accident, during an ethanol-interaction study that used grapefruit juice to mask the taste.', cites: ['bailey1991', 'lown1997', 'bailey2013'] }] }),
  S({ id: 'midazolam', name: 'Midazolam / triazolam / alprazolam', aka: ['triazolam', 'alprazolam', 'Xanax', 'Halcion', 'Versed'], kind: 'medication', slug: 'benzodiazepines',
    roles: [{ mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', note: 'Midazolam is the standard CYP3A4 probe substrate. Lorazepam, oxazepam and temazepam are glucuronidated instead and largely avoid this.', cites: ['flockhart', 'fdaTable'] }] }),
  S({ id: 'ciclosporin', name: 'Ciclosporin / tacrolimus', aka: ['cyclosporine', 'tacrolimus', 'Neoral', 'Prograf'], kind: 'medication', slug: 'ciclosporin', nti: true,
    roles: [
      { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', cites: ['flockhart', 'fdaTable'] },
      { mech: 'cyp3a4-induction', role: 'substrate', strength: 'strong', note: 'The transplant-rejection case: induction drops the level below the therapeutic window and the graft is attacked.', cites: ['ruschitzka2000'] },
      { mech: 'pgp-inhibition', role: 'substrate', strength: 'strong', cites: ['fdaTable'] },
    ] }),
  S({ id: 'warfarin', name: 'Warfarin', aka: ['Coumadin', 'Jantoven'], kind: 'medication', slug: 'warfarin', nti: true,
    summary: 'The narrow-therapeutic-index drug with the largest interaction literature of any medicine. Holbrook et al. catalogued interactions across 642 reports.',
    roles: [
      { mech: 'cyp2c9-inhibition', role: 'substrate', strength: 'strong', note: 'S-warfarin, the more potent enantiomer, is a CYP2C9 substrate. R-warfarin goes through CYP1A2 and CYP3A4.', cites: ['holbrook2005', 'flockhart'] },
      { mech: 'cyp3a4-induction', role: 'substrate', strength: 'moderate', cites: ['holbrook2005'] },
    ] }),
  S({ id: 'digoxin', name: 'Digoxin', aka: ['Lanoxin', 'digitalis'], kind: 'medication', slug: 'digoxin', nti: true,
    summary: 'Not a CYP drug at all — a P-glycoprotein substrate, and exquisitely sensitive to potassium. Two different mechanisms on this page reach it.',
    roles: [
      { mech: 'pgp-inhibition', role: 'substrate', strength: 'strong', cites: ['fdaTable'] },
      { mech: 'pgp-induction', role: 'substrate', strength: 'strong', cites: ['johne1999'] },
      { mech: '11bhsd2-inhibition', role: 'substrate', strength: 'strong', note: 'Digoxin binds the same site on the sodium-potassium ATPase that potassium does, so when serum potassium falls, digoxin binding rises and the drug becomes more toxic at an unchanged blood level. Digoxin toxicity is potentiated by hypokalaemia — so anything that lowers potassium (licorice, thiazide and loop diuretics) raises digoxin risk without changing the digoxin level at all.', cites: ['omar2012'] },
    ] }),
  S({ id: 'phenytoin', name: 'Phenytoin', aka: ['Dilantin'], kind: 'medication', slug: 'phenytoin', nti: true,
    roles: [
      { mech: 'cyp2c9-inhibition', role: 'substrate', strength: 'strong', note: 'Non-linear (saturable) kinetics: a small change in clearance produces a large change in level.', cites: ['flockhart'] },
      { mech: 'cyp3a4-induction', role: 'induces', strength: 'strong', cites: ['fdaTable'] },
    ] }),
  S({ id: 'theophylline', name: 'Theophylline', aka: ['aminophylline', 'Theo-24'], kind: 'medication', slug: 'theophylline', nti: true,
    roles: [
      { mech: 'cyp1a2-inhibition', role: 'substrate', strength: 'strong', cites: ['flockhart', 'fdaTable'] },
      { mech: 'cyp1a2-induction', role: 'substrate', strength: 'strong', note: 'The smoking-cessation case: stop smoking, theophylline rises, and nothing about the prescription changed.', cites: ['faber2004'] },
      { mech: 'seizure-threshold', role: 'agonist', strength: 'strong', cites: ['flockhart'] },
    ] }),
  S({ id: 'clozapine', name: 'Clozapine / olanzapine', aka: ['olanzapine', 'Clozaril', 'Zyprexa'], kind: 'medication', slug: 'clozapine', nti: true,
    roles: [
      { mech: 'cyp1a2-inhibition', role: 'substrate', strength: 'strong', cites: ['flockhart'] },
      { mech: 'cyp1a2-induction', role: 'substrate', strength: 'strong', note: 'Clozapine levels can roughly double after smoking cessation. This is a documented cause of toxicity in inpatient settings where smoking stops abruptly.', cites: ['faber2004', 'flockhart'] },
      { mech: 'seizure-threshold', role: 'agonist', strength: 'strong', cites: ['flockhart'] },
    ] }),
  S({ id: 'amiodarone', name: 'Amiodarone', aka: ['Cordarone', 'Pacerone'], kind: 'medication', slug: 'amiodarone',
    roles: [
      { mech: 'qt-prolongation', role: 'agonist', strength: 'strong', cites: ['crediblemeds', 'roden2004'] },
      { mech: 'cyp3a4-inhibition', role: 'inhibits', strength: 'moderate', cites: ['fdaTable'] },
      { mech: 'cyp2c9-inhibition', role: 'inhibits', strength: 'moderate', cites: ['holbrook2005'] },
      { mech: 'pgp-inhibition', role: 'inhibits', strength: 'strong', cites: ['fdaTable'] },
    ] }),
  S({ id: 'oral-contraceptive', name: 'Combined oral contraceptive', aka: ['the pill', 'ethinylestradiol', 'birth control pill', 'OCP'], kind: 'medication', slug: 'oral-contraceptive',
    summary: 'A CYP3A4 substrate where the failure mode is not toxicity but an unintended pregnancy — which is why an inducer is as serious as an inhibitor.',
    roles: [{ mech: 'cyp3a4-induction', role: 'substrate', strength: 'strong', note: 'Breakthrough bleeding and contraceptive failure are documented with St John\'s wort.', cites: ['henderson2002', 'fdaTable'] }] }),
  S({ id: 'indinavir', name: 'HIV protease inhibitors (indinavir and others)', aka: ['indinavir', 'protease inhibitor', 'antiretroviral'], kind: 'medication', slug: 'protease-inhibitors',
    roles: [{ mech: 'cyp3a4-induction', role: 'substrate', strength: 'strong', cites: ['piscitelli2000'] }, { mech: 'cyp3a4-inhibition', role: 'substrate', strength: 'strong', cites: ['fdaTable'] }] }),
  S({ id: 'thiazide', name: 'Thiazide and loop diuretics', aka: ['hydrochlorothiazide', 'furosemide', 'bendroflumethiazide', 'water pill'], kind: 'medication', slug: 'diuretics',
    roles: [{ mech: '11bhsd2-inhibition', role: 'provides', strength: 'moderate', note: 'Not an 11β-HSD2 inhibitor — but it lowers potassium by its own mechanism, so it ADDS to the licorice picture. Represented on this axis because the clinical consequence (hypokalaemia) is the same one.', cites: ['omar2012'] }] }),
  S({ id: 'codeine', name: 'Codeine', aka: ['co-codamol'], kind: 'medication', slug: 'codeine',
    summary: 'A prodrug. CYP2D6 converts it to morphine, so a CYP2D6 INHIBITOR makes it work LESS, not more — the interaction runs backwards from what people assume.',
    roles: [
      { mech: 'cyp2d6-inhibition', role: 'substrate', strength: 'strong', note: 'Inhibiting CYP2D6 reduces conversion to morphine and therefore reduces analgesia. Ultra-rapid metabolisers have the opposite problem.', cites: ['flockhart', 'fdaTable'] },
      { mech: 'serotonin-reuptake-inhibition', role: 'inhibits', strength: 'none', note: 'Explicitly listed as NOT a serotonin reuptake inhibitor. Gillman separates codeine, morphine, oxycodone and buprenorphine from the SRI opioids — this distinction is why "opioid + MAOI" is not one rule but two.', cites: ['gillman2005'] },
    ] }),
]);
