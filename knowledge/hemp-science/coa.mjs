// coa.mjs — Reading a Certificate of Analysis: the hemp industry's working instrument.
//
// What this shelf is: a practical, arithmetic-complete guide to the single document the hemp and
// cannabinoid industry runs on. It is written for a lab tech who has to defend a number, a
// formulator who has to convert it into a dose per unit, a compliance officer who has to decide
// whether a crop passes, and a buyer who has to decide whether a PDF means anything. It is also a
// safety instrument: most of what goes wrong with converted and novel cannabinoid products is
// visible on, or conspicuously missing from, a certificate of analysis, and the panels and red-flags
// pages are written so that a non-chemist can find it.
//
// Where the material comes from: the analytical standards themselves (ISO/IEC 17025, USP and ICH
// chapters), United States hemp statute and rulemaking, the peer-reviewed product-survey literature
// on label accuracy, and the analytical-chemistry literature on why a compound without a reference
// standard cannot be quantified.
//
// What this shelf deliberately does NOT contain: any preparative or synthetic procedure. No
// reagents, catalysts, solvents, equivalents, molar concentrations, reaction temperatures, times,
// work-ups or yields for making or converting any cannabinoid. Conversion chemistry is referred to
// only as literature that exists, and only where a reader needs to know that a product category was
// made that way in order to read its certificate of analysis correctly. Process metals and process
// solvents are discussed as analytes that a panel does or does not cover, and are deliberately not
// named where naming them would amount to route information. The total-THC page is arithmetic and
// analytics only: molar masses, mass fractions and unit conversions.

export const SHELF = Object.freeze({
  id: 'coa',
  title: 'Reading a Certificate of Analysis',
  blurb: 'What a COA is and is not, the total-THC decarboxylation arithmetic done properly, what each analytical panel does and does not cover, and a red-flag checklist.',
  updated: '2026-09-27',
});

/** CITES — this module's own bibliography. Keys are lowercase author+year or standard+year. */
export const CITES = Object.freeze({
  iso17025: {
    authors: 'International Organization for Standardization and International Electrotechnical Commission',
    year: 2017,
    title: 'ISO/IEC 17025:2017 — General requirements for the competence of testing and calibration laboratories',
    journal: 'International standard', verified: 'standard',
  },
  usp467: {
    authors: 'United States Pharmacopeial Convention',
    year: 2026,
    title: 'USP General Chapter 467, Residual Solvents',
    journal: 'United States Pharmacopeia and National Formulary; chapter content is revised periodically, so cite the edition in force',
    verified: 'standard',
  },
  usp232: {
    authors: 'United States Pharmacopeial Convention',
    year: 2026,
    title: 'USP General Chapters 232 and 233, Elemental Impurities — Limits, and Elemental Impurities — Procedures',
    journal: 'United States Pharmacopeia and National Formulary', verified: 'standard',
  },
  ichq3c: {
    authors: 'International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use',
    year: 2021,
    title: 'ICH Q3C — Impurities: Guideline for Residual Solvents',
    journal: 'ICH harmonised guideline; class 1, 2 and 3 solvent scheme. Revision letter changes over time, so cite the revision in force',
    verified: 'standard',
  },
  ichq2: {
    authors: 'International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use',
    year: 2023,
    title: 'ICH Q2 — Validation of Analytical Procedures',
    journal: 'ICH harmonised guideline; source of the detection-limit and quantitation-limit definitions used here',
    verified: 'standard',
  },
  farmbill2018: {
    authors: 'United States Congress', year: 2018,
    title: 'Agriculture Improvement Act of 2018, Public Law 115-334 — definition of hemp as Cannabis sativa L. with a delta-9 tetrahydrocannabinol concentration of not more than 0.3 percent on a dry weight basis',
    journal: 'United States statute', verified: 'statute',
  },
  usdahemp2021: {
    authors: 'United States Department of Agriculture, Agricultural Marketing Service', year: 2021,
    title: 'Establishment of a Domestic Hemp Production Program, final rule, codified at 7 CFR Part 990 — total THC sampling and testing requirements, post-decarboxylation measurement, and the acceptable hemp THC level concept incorporating measurement uncertainty',
    journal: 'United States federal rulemaking, January 2021. Federal Register page number omitted deliberately rather than guessed',
    verified: false,
  },
  vandrey2015: {
    authors: 'Vandrey R, Raber JC, Raber ME, Douglass B, Miller C, Bonn-Miller MO', year: 2015,
    title: 'Cannabinoid dose and label accuracy in edible medical cannabis products',
    journal: 'JAMA 313(24):2491-2493', verified: false,
  },
  bonnmiller2017: {
    authors: 'Bonn-Miller MO, Loflin MJE, Thomas BF, Marcu JP, Hyke T, Vandrey R', year: 2017,
    title: 'Labeling accuracy of cannabidiol extracts sold online',
    journal: 'JAMA 318(17):1708-1709', verified: false,
  },
  hazekamp2018: {
    authors: 'Hazekamp A', year: 2018,
    title: 'The trouble with CBD oil',
    journal: 'Medical Cannabis and Cannabinoids 1(1):65-72', verified: false,
  },
  auwarter2009: {
    authors: 'Auwarter V, Dresen S, Weinmann W, Muller M, Putz M, Ferreiros N', year: 2009,
    title: 'Spice and other herbal blends: harmless incense or cannabinoid designer drugs?',
    journal: 'Journal of Mass Spectrometry 44(5):832-837', verified: false,
  },
  babalonis2021: {
    authors: 'Babalonis S, Raup-Konsavage WM, Akpunonu PD, Balla A, Vrana KE', year: 2021,
    title: 'Delta-8-THC: legal status, widespread availability, and safety concerns',
    journal: 'Cannabis and Cannabinoid Research 6(5):362-365', verified: false,
  },
  marzullo2020: {
    authors: 'Marzullo P, Foschi F, Coppini DA, Fanchini F, Magnani L, Rusconi S, Luzzani M, Passarella D',
    year: 2020,
    title: 'Cannabidiol as the substrate in acid-catalyzed intramolecular cyclization',
    journal: 'Journal of Natural Products. CITED BY REFERENCE ONLY — this shelf reproduces no part of any procedure in it, and notes only that the literature documents that acid-catalysed cyclisation of cannabidiol yields a MIXTURE of products rather than a single compound, which is why a product made that way needs more than a potency panel',
    verified: false,
  },
  iupacmass: {
    authors: 'IUPAC Commission on Isotopic Abundances and Atomic Weights',
    year: 2026,
    title: 'Standard atomic weights — used here to compute molar masses for the decarboxylation mass fraction',
    journal: 'Reference data', verified: false,
  },
  regcompilation: {
    authors: 'Compiled from United States state cannabis and hemp testing regulations across multiple jurisdictions',
    year: 2026,
    title: 'Panel scope, action limits, water activity and moisture requirements — jurisdictional compilation',
    journal: 'Compilation for orientation only; limits differ by state and change frequently, so verify against the rule in force where the product is sold',
    verified: false,
  },
  methodcompilation: {
    authors: 'Compiled from published cannabis and hemp potency and terpene method literature and laboratory method summaries',
    year: 2026,
    title: 'Analytical method conventions: liquid chromatography for acid and neutral cannabinoids, gas chromatography and in-inlet decarboxylation, gas chromatography with mass spectrometric or flame-ionisation detection for terpenes',
    journal: 'Method compilation', verified: false,
  },
});

/**
 * PAGES — each becomes one wiki page at /science/coa/<slug>.
 */
export const PAGES = Object.freeze([

  // ----------------------------------------------------------- reading-a-coa
  Object.freeze({
    slug: 'reading-a-coa',
    title: 'What a Certificate of Analysis Is, and What It Is Not',
    kind: 'tool',
    summary: 'A COA is a report about one sample at one moment, issued under a defined scope of accreditation, by a defined method, with defined limits. Everything it is commonly assumed to prove that it does not prove.',
    facts: Object.freeze({
      'What it is': 'a laboratory report on a specific sample, identified by a sample identifier, tested by named methods, against named limits, on named dates, signed by an authorised signatory',
      'What it is not': 'a certificate about a batch, a brand, a product line, or anything that was not in the container the lab received',
      'Governing competence standard': 'ISO/IEC 17025:2017 for testing laboratory competence — scope-specific, not blanket',
      'The weakest link': 'sampling. The report describes the sample that reached the lab',
      'Minimum fields to look for': 'sample identifier, batch or lot, matrix type, date received, date tested, method reference, detection and quantitation limits, measurement uncertainty, authorised signatory',
      'Two kinds of report': 'compliance testing against a regulatory panel, versus research-and-development or informational testing with no regulatory standing',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'The one-sentence definition, and why it matters',
        body: 'A certificate of analysis is a laboratory report stating what a named analytical method found in a specific sample on a specific date. That is the whole of it. Every common misuse of a COA comes from quietly widening one of those three limits — from the sample to the batch, from the method to all possible analytes, or from the test date to the present. A COA does not certify a product, a company, a process, or a claim on a label. It certifies nothing at all in the ordinary sense of the word: it reports measurements, and the reader supplies the inference. The discipline this page is trying to install is the habit of asking, for every number on the page, what sample it describes, by what method, with what limit of detection, and how long ago.',
        cites: Object.freeze(['iso17025']),
      }),
      Object.freeze({
        h: 'ISO/IEC 17025 accreditation: scope-specific, not a logo',
        body: 'ISO/IEC 17025:2017 sets the general requirements for the competence, impartiality and consistent operation of testing and calibration laboratories. An accreditation body assesses a laboratory against it and grants accreditation for a defined SCOPE — a specific list of test methods, on specific matrices, for specific analytes, with specific ranges. This is the single most misread fact in the industry. A laboratory can be accredited for cannabinoid potency in plant matrix and NOT accredited for pesticide residues, or accredited for potency in flower and not in an edible matrix, or accredited for a method whose range does not cover the concentration actually reported. The accreditation certificate and its annexed scope document are separate things, and the scope is the one that answers the question. What to do about it in practice: find the accreditation body and certificate number on the COA, look the laboratory up in the accreditation body\'s public directory, open the scope annex, and check that the specific method and matrix on your report appear in it. What accreditation does establish: that the laboratory has been assessed for technical competence, method validation, equipment calibration, personnel qualification, quality control, proficiency testing participation and impartiality, in the areas within scope. What it does not establish: that any given result is correct, that analytes outside the method were absent, that the sample was representative, or that the laboratory is competent in anything outside the scope. A logo on a PDF establishes none of it.',
        bullets: Object.freeze([
          'Accreditation is granted for a scope — a list of methods, matrices, analytes and ranges.',
          'Check the accreditation body directory, not the logo on the report.',
          'Accredited for potency does not mean accredited for pesticides, metals, solvents or microbials.',
          'Accredited in flower does not mean accredited in concentrate, edible or topical matrices.',
          'Accreditation is about laboratory competence, not about the correctness of any single number.',
        ]),
        cites: Object.freeze(['iso17025']),
      }),
      Object.freeze({
        h: 'Accredited third party, in-house, and unaccredited',
        body: 'Three tiers exist and they are not interchangeable. An accredited third-party laboratory has no commercial interest in the result and has been externally assessed within a scope. An in-house laboratory may be technically excellent and is frequently the better-equipped facility, but it has an obvious interest in the outcome and is usually not externally assessed, so its results function as process control rather than as independent verification. An unaccredited third party is the ambiguous case: some are competent laboratories that have not pursued accreditation for a given method, and some are not competent at all, and the report itself rarely lets you tell which. There is also a fourth category that appears in practice — the report with no laboratory identity at all, or with a laboratory that cannot be found in any directory, which should be treated as no report. In the survey literature on product label accuracy, the failures concentrate where independent verification is weakest. The practical rule for a buyer: for anything going into or onto a human body, require an accredited third-party report whose scope covers the panel and the matrix, and treat in-house data as supporting evidence rather than as the answer.',
        cites: Object.freeze(['iso17025', 'bonnmiller2017', 'vandrey2015']),
      }),
      Object.freeze({
        h: 'Anatomy of the document, field by field',
        body: 'The fields below are what a usable COA contains. Missing fields are not cosmetic omissions; each one removes a specific inference the reader would otherwise be entitled to make. Read the table as a checklist and as an explanation of why each field is load-bearing.',
        table: Object.freeze({
          cols: Object.freeze(['Field', 'What it is', 'What its absence costs you']),
          rows: Object.freeze([
            Object.freeze(['Sample identifier', 'the laboratory\'s unique identifier for the material it received and tested', 'you cannot look the report up with the lab, so the report cannot be independently confirmed at all']),
            Object.freeze(['Batch or lot', 'the producer\'s identifier for the production run the sample came from', 'you cannot connect the report to the product in your hand; the report could describe any material']),
            Object.freeze(['Matrix type', 'flower, concentrate, distillate, edible, tincture, topical, vape formulation', 'method suitability and accreditation scope both depend on matrix; a method validated in flower may be wrong for an edible']),
            Object.freeze(['Sample description and mass', 'what arrived, how much, in what condition', 'you cannot judge whether the aliquot could have been representative']),
            Object.freeze(['Date received and date tested', 'when the lab got it and when it was analysed', 'you cannot judge degradation, and you cannot detect a report that predates the batch it claims to describe']),
            Object.freeze(['Date of report and revision', 'issue date, and whether this supersedes an earlier version', 'you cannot tell whether a later corrected report exists']),
            Object.freeze(['Method reference', 'the specific analytical method, ideally with a version or standard-method identifier', 'you cannot tell what was actually measured, which analytes were in the calibration set, or whether acid forms were resolved']),
            Object.freeze(['Detection limit and quantitation limit', 'the method\'s sensitivity floor for each analyte', 'a non-detect result becomes uninterpretable; see the panels page']),
            Object.freeze(['Measurement uncertainty', 'the expanded uncertainty associated with the reported value', 'a result near a regulatory line cannot be evaluated; this is decisive for hemp compliance']),
            Object.freeze(['Units and basis', 'percent w/w, mg/g, mg/mL, mg per unit; as-received or dry-weight', 'the number is not convertible and may be off by the moisture content or by a factor of ten']),
            Object.freeze(['Result qualifiers', 'ND, less than LOQ, estimated, outside calibration range', 'you will read a qualified number as a firm one']),
            Object.freeze(['Authorised signatory', 'the named person accepting technical responsibility', 'nobody is accountable for the report']),
            Object.freeze(['Accreditation body and certificate number', 'who accredited the lab, under what number', 'you cannot verify the scope, which is the whole point of accreditation']),
            Object.freeze(['Sampling statement', 'who took the sample, by what plan, and whether the lab took it', 'the biggest single weakness in the document is left undocumented']),
          ]),
        }),
        cites: Object.freeze(['iso17025', 'ichq2']),
      }),
      Object.freeze({
        h: 'Full panel versus potency only',
        body: 'A potency-only report answers exactly one question: how much of the cannabinoids in the method\'s calibration set were in this sample. It says nothing about pesticide residues, residual process solvents, heavy metals, mycotoxins, microbial contamination, water activity, or any compound the method was not calibrated for. A full-panel report covers the set of panels required by the relevant jurisdiction, which is not the same set everywhere and is not the same set for every matrix. Two practical consequences. First, the phrase "lab tested" on a package is compatible with a potency-only report and therefore carries almost no information; ask which panels. Second, and much more important, a potency-only report on a converted or novel cannabinoid product is a specific and serious gap rather than a general one, because potency is the question least likely to reveal what went wrong with that category of product. The red-flags page treats this as its own item.',
        cites: Object.freeze(['regcompilation', 'babalonis2021']),
      }),
      Object.freeze({
        h: 'Sampling is the weakest link, and it is usually invisible',
        body: 'Everything downstream of sampling can be perfect and the report still be wrong about the batch, because the report describes the sample and nothing else. A COA is a statement about the batch only to the extent that the sample was representative of the batch, and representativeness is a property of the sampling plan, not of the laboratory. The failure modes are mundane and common: the producer selected the material to send rather than sampling it randomly; a single grab was taken from one location in a heterogeneous lot; the increments were not taken in proportion to lot size; the sample was taken from finished top-grade material and the lot includes material that is not; or the sample was homogenised in a way that destroyed the analyte being measured. Cannabinoid and contaminant distribution in a real lot is genuinely heterogeneous — plant material varies by plant, by position on the plant and by drying position, and an edible batch varies by how well it was mixed, which is the subject of the formulation homogeneity page. Regulatory hemp programmes address this directly by specifying who samples and how: the United States hemp rule ties compliance testing to sampling performed by an authorised sampling agent under a defined plan, precisely because producer-selected samples are not evidence about a crop. For everything outside such a programme, look for an explicit statement of who took the sample and by what plan. If the COA says nothing about sampling, the honest reading is that the report describes an unknown quantity of material selected by an interested party.',
        bullets: Object.freeze([
          'Independent sampling by the laboratory or an authorised agent is the strong case.',
          'Producer-supplied sample, sampling plan documented, is the workable case.',
          'Producer-supplied sample with no sampling statement is the common case and is weak evidence about the batch.',
          'Heterogeneity is real: one grab from one location does not characterise a lot.',
        ]),
        cites: Object.freeze(['usdahemp2021', 'iso17025']),
      }),
      Object.freeze({
        h: 'Batch and lot must match the product in your hand',
        body: 'This is the cheapest and most skipped check in the industry. Read the batch or lot identifier on the COA and read the batch or lot identifier printed on the package, and confirm they are the same string. A COA for a different batch of the same product is not evidence about your unit: potency varies between runs, contamination events are batch-specific, and the entire purpose of lot identification is to make a specific production run traceable. Related checks in the same family: the product name and matrix on the COA should match what you are holding, and the test date should postdate the production date. A COA whose test date precedes the batch it claims to describe is either a clerical error or a reused document, and in either case the report does not describe your product. Many laboratories publish a lookup by sample identifier — use it; see the red-flags page.',
        cites: Object.freeze(['iso17025', 'regcompilation']),
      }),
      Object.freeze({
        h: 'Compliance testing versus research-and-development reports',
        body: 'A compliance COA is issued against a regulatory panel, with regulatory action limits, by a laboratory whose scope covers that panel, and it carries consequences. A research-and-development report — often labelled for informational purposes only, for research use only, or not for compliance — is a measurement performed outside that framework. It may be technically sound, and process chemists rely on such reports constantly and legitimately. What it is not is evidence that a product meets a standard, and it frequently omits the panels that a compliance report would have required. Two specific patterns worth recognising: a report that covers only the panels a producer wanted covered, and a report on an intermediate — a distillate, an isolate, a crude input — being presented as if it described a finished product. An input COA tells you about the input. It tells you nothing about what was added, what solvents were used downstream, whether the finished product is homogeneous, or what the finished dose per unit is. Ask for the finished-product report on the finished lot.',
        cites: Object.freeze(['regcompilation', 'hazekamp2018']),
      }),
      Object.freeze({
        h: 'A COA has a shelf life, even when nothing is wrong with it',
        body: 'Cannabinoids and terpenes degrade. Tetrahydrocannabinol oxidises to cannabinol; monoterpenes evaporate and oxidise; acid forms decarboxylate slowly at ambient temperature; microbial counts can rise in insufficiently dried material. A COA is therefore a statement about the sample at the test date, and its usefulness decays with the material. There is no universal expiry, because the rate depends on the matrix, the packaging, the light exposure and the storage temperature, but a report that is a year older than the product on the shelf is weak evidence about the current contents of the package and an old terpene figure is the weakest number on it. For a buyer, compare test date to purchase date and treat a large gap as a question. For a producer, the answer to that question is stability data on the actual package, not a reassurance.',
        cites: Object.freeze(['hazekamp2018', 'methodcompilation']),
      }),
    ]),
    seeAlso: Object.freeze([
      'coa/panels', 'coa/total-thc-math', 'coa/red-flags',
      'safety/buyer-vendor-checklist', 'safety/converted-cannabinoid-products',
      'formulation/homogeneity', 'formulation/residual-solvent', 'regulatory/market-consequences',
    ]),
    cites: Object.freeze(['iso17025', 'ichq2', 'usdahemp2021', 'regcompilation', 'vandrey2015', 'bonnmiller2017', 'hazekamp2018', 'babalonis2021', 'methodcompilation']),
  }),

  // --------------------------------------------------------- total-thc-math
  Object.freeze({
    slug: 'total-thc-math',
    title: 'Total THC: The Decarboxylation Arithmetic, Shown',
    kind: 'tool',
    summary: 'Total THC equals delta-9-THC plus 0.877 times THCA. Where 0.877 comes from, why it is a theoretical ceiling rather than a delivered dose, the same factor for CBD and CBDA, and the unit conversions the hemp industry actually needs.',
    facts: Object.freeze({
      'The equation': 'Total THC = delta-9-THC + (THCA multiplied by 0.877)',
      'The CBD equation': 'Total CBD = CBD + (CBDA multiplied by 0.877)',
      'THCA molar mass': 'C22H30O4, about 358.48 g/mol',
      'Delta-9-THC molar mass': 'C21H30O2, about 314.47 g/mol',
      'Carbon dioxide lost': 'CO2, about 44.01 g/mol',
      'The factor': '314.47 divided by 358.48 equals 0.8772, conventionally 0.877',
      'What the factor is': 'the mass fraction retained when one molecule of carbon dioxide is lost from the acid',
      'What the result is': 'a THEORETICAL MAXIMUM assuming complete decarboxylation with no loss to cannabinol or anything else',
      'Percent w/w to mg/g': 'multiply by 10',
      'mg/g to milligrams per unit': 'multiply by the unit mass in grams',
      'Federal hemp line': '0.3 percent delta-9-THC on a DRY WEIGHT basis, per the 2018 Agriculture Improvement Act',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'Where 0.877 comes from — the derivation, not the folklore',
        body: 'In the living plant the tetrahydrocannabinol is present almost entirely as its carboxylic acid, tetrahydrocannabinolic acid, and the acid is not psychoactive at the cannabinoid receptor in the way the neutral compound is. Heat and time remove the carboxyl group as carbon dioxide and leave the neutral cannabinoid. The arithmetic follows directly from the two molar masses. Tetrahydrocannabinolic acid is C22H30O4: twenty-two carbons at 12.011, thirty hydrogens at 1.008 and four oxygens at 15.999 sum to about 358.48 g/mol. Delta-9-tetrahydrocannabinol is C21H30O2: twenty-one carbons, thirty hydrogens and two oxygens sum to about 314.47 g/mol. The difference, 358.48 minus 314.47, is 44.01 g/mol, which is exactly the molar mass of carbon dioxide — CO2, one carbon at 12.011 and two oxygens at 15.999 each. The reaction loses one carbon and two oxygens and nothing else. So the mass of neutral cannabinoid obtainable from a given mass of the acid is the ratio of the two molar masses: 314.47 divided by 358.48 equals 0.8772, which the industry rounds to 0.877. That is the entire origin of the number. It is not an empirical efficiency factor, not a regulatory fudge, and not a measured conversion rate. It is stoichiometry: the fraction of the acid\'s mass that is not carbon dioxide.',
        bullets: Object.freeze([
          'THCA, C22H30O4, about 358.48 g/mol.',
          'Delta-9-THC, C21H30O2, about 314.47 g/mol.',
          'Difference: 44.01 g/mol, the molar mass of CO2 exactly.',
          '314.47 divided by 358.48 equals 0.8772, rounded to 0.877.',
          'The factor is a mass fraction from stoichiometry, not a measured yield.',
        ]),
        cites: Object.freeze(['iupacmass', 'usdahemp2021']),
      }),
      Object.freeze({
        h: 'The same factor for CBD and CBDA, and for acid-neutral pairs generally',
        body: 'Cannabidiolic acid is C22H30O4 and cannabidiol is C21H30O2 — the same formulas as the THC pair, because cannabidiol and delta-9-tetrahydrocannabinol are isomers of one another and their acids are likewise isomers. The molar masses are therefore the same, about 358.48 and about 314.47, the carbon dioxide lost is the same 44.01, and the factor is the same 0.877. Total CBD equals CBD plus 0.877 times CBDA. The generalisation is worth stating because it is the reason a single factor appears throughout cannabinoid reporting: for any acid-neutral cannabinoid pair differing only by one carboxyl group, the mass fraction retained is the neutral molar mass divided by the acid molar mass, and for the whole C21-neutral and C22-acid family — cannabidiol, delta-9-tetrahydrocannabinol, delta-8-tetrahydrocannabinol, cannabichromene, cannabigerol and their acids — that ratio is approximately 0.877. It is NOT 0.877 for pairs outside that family. Cannabigerol and cannabigerolic acid happen to be C21H32O2 and C22H32O4, which gives 316.48 divided by 360.49, or about 0.878 — close, but arrived at separately. Tetrahydrocannabivarin and its acid are propyl-side-chain compounds with smaller molar masses, C19H26O2 and C20H26O4, giving roughly 286.4 divided by 330.4, or about 0.867. If a report gives a total for a varin cannabinoid computed with 0.877, the factor is wrong, and anyone computing a total for an unusual cannabinoid should derive the factor from that compound\'s own formulas rather than reusing this one.',
        bullets: Object.freeze([
          'Total CBD = CBD + (CBDA multiplied by 0.877). Same formulas, same factor.',
          'The 0.877 applies to the C21-neutral and C22-acid pairs: CBD, delta-9-THC, delta-8-THC, CBC.',
          'CBG and CBGA give about 0.878 by their own molar masses.',
          'Varin (propyl side chain) cannabinoids give about 0.867 — derive the factor, do not assume it.',
        ]),
        cites: Object.freeze(['iupacmass']),
        contested: true,
        caveat: 'The varin and CBG factors here are computed from molecular formulas rather than quoted from a regulatory document. Check the factor a specific jurisdiction requires before using a derived one in a compliance calculation.',
      }),
      Object.freeze({
        h: 'Why total THC is a ceiling and not a prediction',
        body: 'The arithmetic assumes complete decarboxylation of all the acid to the neutral cannabinoid with no losses. Neither condition holds in reality. Decarboxylation is a kinetic process, not a switch: its rate rises steeply with temperature, so the conversion is time-and-temperature dependent, and in any real heating — an oven, a vaporizer, a lit joint, or the inlet of a gas chromatograph — the conversion is substantially but not perfectly complete. More important, the neutral cannabinoid is itself labile: delta-9-tetrahydrocannabinol oxidises to cannabinol, and that pathway is accelerated by heat, light and air, so some of what the arithmetic assigns to total THC is lost to cannabinol rather than delivered. The correct reading of a total-THC figure is therefore: the maximum mass of neutral cannabinoid that this sample\'s acid content could theoretically yield, if every molecule converted and nothing degraded. It is a conservative regulatory ceiling — which is exactly what a compliance limit should be, because a regulator wants the upper bound on what a crop could produce — and it is NOT a prediction of what a consumer receives. The consumer receives less, by a margin that depends on the product, the preparation and the route, and that nobody can compute from a COA. Any product claim that treats total THC as a delivered dose has confused a ceiling with an estimate.',
        cites: Object.freeze(['usdahemp2021', 'methodcompilation']),
        contested: true,
        caveat: 'The magnitude of the shortfall between total THC and delivered neutral cannabinoid is product-, preparation- and route-specific and is not quantified here. The direction is not in doubt: real conversion is incomplete and some product is lost to cannabinol.',
      }),
      Object.freeze({
        h: 'An analytical footnote that decides which number you get',
        body: 'How the laboratory measured the sample determines whether a total-THC calculation is even necessary, and this is a real source of confusion between reports. A liquid-chromatographic method run without heating resolves the acid and the neutral forms as separate analytes and reports both, which is what makes the 0.877 arithmetic applicable and auditable: you can see the acid, see the neutral, and check the sum yourself. A gas-chromatographic method heats the sample in the inlet, which decarboxylates the acids on the way into the column, so a gas-chromatographic potency result is inherently a post-decarboxylation total and the acid and neutral forms are not separately reported. Two consequences. First, a gas-chromatographic report showing zero THCA is not evidence that the plant contained no THCA — it is evidence that the method destroyed it before detection. Second, a report that gives delta-9-THC, THCA and total THC as three columns is a liquid-chromatographic report and you can verify its arithmetic; a report giving a single THC number may be either, and the method reference is the only way to tell. United States hemp compliance testing is specified as post-decarboxylation or equivalent precisely so that both method families arrive at the same regulated quantity.',
        cites: Object.freeze(['methodcompilation', 'usdahemp2021']),
      }),
      Object.freeze({
        h: 'Worked example 1: flower potency',
        body: 'A liquid-chromatographic potency report on dried flower gives delta-9-THC at 0.28 percent w/w and THCA at 12.40 percent w/w. Compute total THC. Multiply the acid by the factor: 12.40 times 0.877 equals 10.8748. Add the neutral: 10.8748 plus 0.28 equals 11.1548, so total THC is 11.15 percent w/w, which rounds to 11.2 percent. Convert to mg/g by multiplying by ten: 111.5 mg/g. For a one-gram pre-roll from that lot, the total-THC ceiling is 111.5 mg. Note what the arithmetic shows about the structure of the number: the acid contributed 10.87 of the 11.15, so 97.5 percent of the total-THC figure is a calculated quantity that was never actually present as delta-9-THC in the sample. The 0.28 percent is what the lab measured as neutral cannabinoid; the rest is potential. Anyone quoting the 11.15 as though the flower contained that much active compound is quoting a conversion that has not happened yet.',
        cites: Object.freeze(['iupacmass', 'methodcompilation']),
      }),
      Object.freeze({
        h: 'Worked example 2: the compliance trap — passing one standard and failing the other',
        body: 'This is the live compliance issue and it costs growers crops. A hemp sample assays delta-9-THC at 0.25 percent and THCA at 0.45 percent, dry weight basis. Against a DELTA-9-ONLY standard of 0.3 percent, the relevant number is 0.25 percent and the sample passes with room to spare. Against a TOTAL-THC standard of 0.3 percent, compute: 0.45 times 0.877 equals 0.39465, plus 0.25 equals 0.64465, so total THC is 0.645 percent — more than double the limit, and the same sample fails decisively. Nothing about the plant changed; only the definition did. The 2018 Agriculture Improvement Act defines hemp by delta-9-tetrahydrocannabinol concentration of not more than 0.3 percent on a dry weight basis, while the federal implementing rule requires testing to be post-decarboxylation or use an equivalent method, which in practice means total THC. The consequence for anyone in this industry is that "which THC" is always a live question: a certificate showing a compliant delta-9 figure and a substantial THCA figure is not a compliant certificate under a total-THC regime, and a cultivar selected to pass a delta-9-only test can be non-compliant the moment the standard is stated the other way. Check which standard the jurisdiction in question applies before drawing any conclusion from a number near the line, and note that state standards and international standards differ from each other and from the United States federal rule.',
        cites: Object.freeze(['farmbill2018', 'usdahemp2021']),
        contested: true,
        caveat: 'Jurisdictions differ and rules change. This worked example illustrates the arithmetic of the delta-9 versus total-THC distinction; it is not a statement of the standard in force in any particular place, and it is not legal advice. Verify the applicable rule.',
      }),
      Object.freeze({
        h: 'Worked example 3: dry weight basis, the other way to fail',
        body: 'The federal hemp definition is on a DRY WEIGHT basis, and a result reported as received is not on that basis unless the material was already dry. A sample is received at 8.0 percent moisture and the as-received total THC is 0.28 percent — apparently compliant. Convert to dry weight by dividing by the dry mass fraction: 0.28 divided by 0.92 equals 0.3043 percent. On a dry weight basis the same sample is above 0.3 percent and fails. The general form is straightforward: dry-weight result equals as-received result divided by (1 minus the moisture fraction). At 8 percent moisture the correction is a factor of about 1.087, at 12 percent about 1.136, at 15 percent about 1.176 — so a fifteen-percent-moisture sample\'s dry-weight figure is nearly eighteen percent higher than its as-received figure. This correction is invisible unless the report states the basis and the moisture content, which is why the basis field is on the anatomy checklist. Any comparison between two COAs that does not confirm both are on the same basis is an unreliable comparison, and any compliance judgement made from an as-received figure against a dry-weight limit is simply the wrong calculation.',
        cites: Object.freeze(['farmbill2018', 'usdahemp2021']),
      }),
      Object.freeze({
        h: 'Worked example 4: measurement uncertainty at the line',
        body: 'A total-THC result is not a point, it is a value with an uncertainty, and near a regulatory line the uncertainty decides the outcome. Suppose a compliance test returns total THC of 0.32 percent dry weight with an expanded measurement uncertainty of plus or minus 0.04 percent. The interval runs from 0.28 to 0.36 percent, and it contains 0.3 percent. The United States hemp rule addresses exactly this situation with the acceptable hemp THC level concept: the distribution around the measured value is considered, so a result whose uncertainty interval includes the limit can be treated as within compliance even though the point estimate exceeds it. Two things follow for practice. First, a COA without a measurement-uncertainty statement cannot support a decision near the line in either direction, which is why the field is mandatory on the anatomy checklist rather than optional. Second, the uncertainty is a property of the method and the laboratory, so two laboratories can return defensibly different results on the same lot and neither be wrong. When a result matters and the margin is small, the questions are what the expanded uncertainty is and how the jurisdiction treats it — not whether the point estimate cleared the number.',
        cites: Object.freeze(['usdahemp2021', 'iso17025', 'ichq2']),
        contested: true,
        caveat: 'The acceptable-hemp-THC-level treatment described here is a feature of the United States federal hemp rule as this shelf understands it; the exact mechanism and its application are matters of the rule in force and of the jurisdiction. Verify before relying on it.',
      }),
      Object.freeze({
        h: 'The unit conversions this industry actually needs',
        body: 'Most real-world COA errors are not chemistry errors, they are unit errors, and almost all of them are factor-of-ten or per-what errors. The conversions below are the complete working set. Note particularly the mg/mL versus mg/g distinction for liquids: they are equal only if the density is exactly 1.00 g/mL, and carrier oils are typically around 0.91 to 0.93 g/mL, so treating them as interchangeable introduces a seven-to-nine-percent error — enough to move a label claim outside tolerance on its own.',
        table: Object.freeze({
          cols: Object.freeze(['From', 'To', 'Operation', 'Worked instance']),
          rows: Object.freeze([
            Object.freeze(['percent w/w', 'mg/g', 'multiply by 10', '11.15 percent equals 111.5 mg/g']),
            Object.freeze(['mg/g', 'percent w/w', 'divide by 10', '111.5 mg/g equals 11.15 percent']),
            Object.freeze(['percent w/w', 'ppm (mg/kg)', 'multiply by 10,000', '0.3 percent equals 3,000 ppm']),
            Object.freeze(['mg/g', 'mg per unit', 'multiply by the unit mass in grams', '2.55 mg/g in a 4.0 g gummy equals 10.2 mg per gummy']),
            Object.freeze(['mg per unit', 'mg per package', 'multiply by the unit count', '10.2 mg times 20 gummies equals 204 mg per package']),
            Object.freeze(['mg/mL', 'mg per package', 'multiply by the fill volume in mL', '34.1 mg/mL in a 30 mL bottle equals 1,023 mg']),
            Object.freeze(['mg/mL', 'mg/g', 'divide by the density in g/mL', '34.1 mg/mL at 0.92 g/mL equals 37.1 mg/g']),
            Object.freeze(['mg/g', 'mg/mL', 'multiply by the density in g/mL', '37.1 mg/g at 0.92 g/mL equals 34.1 mg/mL']),
            Object.freeze(['as-received percent', 'dry-weight percent', 'divide by (1 minus the moisture fraction)', '0.28 percent at 8.0 percent moisture equals 0.3043 percent']),
          ]),
        }),
        cites: Object.freeze(['methodcompilation', 'iupacmass']),
      }),
      Object.freeze({
        h: 'Worked example 5: per serving versus per package',
        body: 'Two numbers on an edible or tincture label describe different things and the industry routinely conflates them. Take a 30 mL tincture labelled 1,000 mg CBD. The COA reports 34.1 mg/mL total CBD, computed as CBD plus 0.877 times CBDA. Per package: 34.1 times 30 equals 1,023 mg, which is 102.3 percent of the label claim and comfortably inside a typical plus-or-minus-ten-percent tolerance. Per serving, if the serving is one millilitre: 34.1 mg. If the dropper is 0.75 mL and the label calls that a serving, the serving is 25.6 mg and the package contains 40 servings, not 30. Now a gummy: 4.0 g unit mass, COA total THC 2.55 mg/g, so 10.2 mg per gummy against a 10 mg label, and a twenty-count package contains 204 mg. Notice that the per-package number is a multiplication of the per-unit number and is therefore only as good as the homogeneity of the batch — if the actives are unevenly distributed, the average is right and the individual unit may not be, which is why per-unit compliance and batch-average compliance are different tests and why the formulation shelf treats homogeneity separately. A COA that reports a batch average in mg/g does not establish that any individual unit is within tolerance; a COA that reports per-unit results on multiple units sampled across the batch begins to.',
        cites: Object.freeze(['methodcompilation', 'vandrey2015']),
      }),
      Object.freeze({
        h: 'Checking a report\'s arithmetic — the audit you can do in thirty seconds',
        body: 'Because the factor is stoichiometric, a liquid-chromatographic report that gives the neutral, the acid and the total can be audited by the reader, and it is worth doing because transcription and spreadsheet errors are common. Take the acid figure, multiply by 0.877, add the neutral figure, and compare with the printed total. Agreement to the last reported digit is expected; a discrepancy means either a different factor was used, the total was computed on a different basis, or something was entered wrong. Do the same for CBD and CBDA. Then check the internal consistency of the units: if the report gives both percent and mg/g columns, the mg/g should be exactly ten times the percent. Then check that the total-cannabinoid line, if present, is the sum of the individual analytes as reported — laboratories differ in whether they sum the as-measured values or the decarboxylation-adjusted values, and the difference is large, so a total-cannabinoid figure that matches neither convention is a flag. None of this requires chemistry. It requires a calculator and two minutes, and it catches a meaningful share of defective reports.',
        bullets: Object.freeze([
          'Acid times 0.877 plus neutral should equal the printed total, for THC and for CBD.',
          'mg/g should be exactly ten times percent w/w.',
          'Total cannabinoids should reconcile to one stated convention — as-measured, or decarb-adjusted.',
          'Per-package should equal per-unit times unit count, and mg per bottle should equal mg/mL times fill volume.',
          'Dry-weight figures should equal as-received divided by (1 minus moisture fraction).',
        ]),
        cites: Object.freeze(['methodcompilation', 'iupacmass']),
      }),
    ]),
    seeAlso: Object.freeze([
      'coa/reading-a-coa', 'coa/panels', 'coa/red-flags',
      'cannabinoids/decarboxylation', 'cannabinoids/biosynthesis',
      'formulation/dose-arithmetic', 'formulation/homogeneity', 'formulation/titration',
      'regulatory/market-consequences', 'terpenes/vaporization-bands',
    ]),
    cites: Object.freeze(['iupacmass', 'usdahemp2021', 'farmbill2018', 'methodcompilation', 'iso17025', 'ichq2', 'vandrey2015']),
  }),

  // ------------------------------------------------------------------ panels
  Object.freeze({
    slug: 'panels',
    title: 'The Panels: What Each One Covers, and What It Does Not',
    kind: 'tool',
    summary: 'Potency, terpenes, residual solvents, heavy metals, pesticides, mycotoxins, microbials, water activity and moisture — each panel\'s blind spot, plus why a non-detect is a statement about a method and an unidentified peak is the most important thing on a converted-cannabinoid report.',
    facts: Object.freeze({
      'The governing principle': 'a panel finds what its method was calibrated to find, and is blind to everything else',
      'Potency': 'quantifies only the cannabinoids in the method calibration set',
      'Terpenes': 'gas chromatography with mass-spectrometric or flame-ionisation detection, against a selected analyte list',
      'Residual solvents': 'framework is USP General Chapter 467 and ICH Q3C class 1, 2 and 3',
      'Heavy metals': 'the standard four are lead, cadmium, arsenic and mercury',
      'Pesticides': 'a defined target list; an off-list compound is invisible',
      'Mycotoxins': 'typically aflatoxins B1, B2, G1 and G2 plus ochratoxin A',
      'Microbials': 'total counts plus specified pathogens and specified Aspergillus species',
      'Water activity and moisture': 'the mould-risk pair; commonly a water-activity ceiling around 0.65 and a moisture ceiling around 12 to 15 percent',
      'ND': 'not detected AT OR ABOVE the method detection limit — not absent',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'The governing principle, stated once so it can be applied everywhere',
        body: 'Every analytical panel answers a question of the form: how much of THESE analytes, by THIS method, is in this sample. An analyte that is not in the method — no reference standard, no calibration curve, no place in the target list — cannot be quantified and will usually not be reported at all. This is not a shortcoming of any particular laboratory; it is how quantitative analysis works. A calibration curve is built by running known concentrations of an authentic reference standard and fitting the instrument response, and without the standard there is no curve and no defensible number. The consequence runs through every section below and it is the single most useful thing to understand about a COA: the panels define the universe the report can describe, and everything outside that universe is silently absent rather than reported as unknown. A clean full panel means the listed analytes were within limits. It does not mean the sample was clean.',
        cites: Object.freeze(['ichq2', 'auwarter2009']),
      }),
      Object.freeze({
        h: 'Cannabinoid potency — and the core lesson of the K2 era',
        body: 'A potency panel is usually liquid chromatography with ultraviolet or diode-array detection, sometimes with mass-spectrometric detection, calibrated against authentic reference standards for a defined set of cannabinoids: commonly delta-9-THC, THCA, delta-8-THC, CBD, CBDA, CBG, CBGA, CBN, CBC, THCV and CBDV, with the exact set varying by laboratory and jurisdiction. It reports how much of each of THOSE analytes was present. It cannot report a cannabinoid for which the laboratory has no reference standard, and the analytical history of the synthetic-cannabinoid era is the clearest demonstration of why that matters. Auwarter and colleagues, analysing the herbal blends sold as Spice, found that the products contained synthetic cannabinoid receptor agonists that no routine screen was looking for — compounds absent from every target list precisely because they were novel, so that material could pass through testing, screening and clinical assessment while carrying pharmacologically potent compounds nobody had a method for. The lesson generalises exactly to the current novel-cannabinoid market: a product marketed under a cannabinoid name that has no commercially available certified reference standard cannot have been quantified, whatever the report says. If a name appears on a label and a number appears on a COA next to it, the question is which reference standard established that number, and a laboratory can answer it. The red-flags page makes this a checklist item.',
        cites: Object.freeze(['auwarter2009', 'ichq2', 'babalonis2021']),
      }),
      Object.freeze({
        h: 'Terpene panels',
        body: 'Terpene panels are typically gas chromatography with mass-spectrometric or flame-ionisation detection, against a selected list of analytes — commonly somewhere between ten and forty compounds, depending on the laboratory. Three limitations are worth knowing. First, the list is a selection, and a terpene present in the sample but absent from the list is not reported; the rare and thinly documented compounds discussed on the terpene shelf, such as faurinone and the curcumene isomers, are exactly the ones least likely to be on any panel and least likely to have a certified standard available. Second, there is no meaningful total: a terpene total on a report is the sum of the listed analytes, not the sample\'s total volatile content, and two laboratories with different lists will report different totals for identical material. Third, terpene results are the most sample-handling-sensitive numbers on any COA, because the analytes are volatile by definition and losses during grinding, weighing, storage and transfer are real and systematic; the most volatile compounds, alpha-pinene and myrcene above all, are the ones most easily lost between the field and the injector. Treat a terpene figure as a lower bound on what was in the plant and as a statement about the laboratory\'s list as much as about the sample. Note also that isomers matter and are frequently not resolved: an ocimene figure without an isomer assignment, or a curcumene figure without one, has discarded information, and chiral compounds such as limonene, linalool and alpha-pinene are reported as a single combined figure unless a chiral column was used.',
        cites: Object.freeze(['methodcompilation', 'ichq2']),
        contested: true,
        caveat: 'Panel sizes and analyte lists are laboratory-specific and this section describes the general convention rather than any particular laboratory\'s method. Terpene totals are not comparable between laboratories with different lists.',
      }),
      Object.freeze({
        h: 'Residual solvents — USP 467 and the ICH classes',
        body: 'Residual solvents are the volatile organic compounds left in a product from processing. The relevant framework is not a cannabis-specific invention: it is USP General Chapter 467, Residual Solvents, which operationalises the ICH Q3C guideline, and it exists because the pharmaceutical industry had to solve this problem first. ICH Q3C sorts solvents into three classes by toxicological concern, and the class of a finding is the first thing to read. Class 1 solvents are those to be avoided: known human carcinogens or compounds of severe environmental or toxicological concern, including benzene and carbon tetrachloride, with limits set in the low parts-per-million and in some cases lower. Class 2 solvents are to be limited: compounds with known but less severe toxicity, each with its own permitted daily exposure and concentration limit. Class 3 solvents are those of low toxic potential, where a generous default limit applies. What a CLASS 1 FINDING MEANS is therefore specific and serious: a class 1 solvent is not supposed to be in the product at all, so its presence is evidence about the process rather than a quality-margin question. It indicates either that a class 1 solvent was used, or that a solvent used was contaminated with one, or that one was generated. Two further points. The residual-solvent panel, like every panel, covers a defined list: a solvent not on the list is not looked for. And a residual-solvent result is only meaningful for the matrix tested, so an input COA showing clean solvents does not describe a finished product that went through further processing.',
        bullets: Object.freeze([
          'Class 1: avoid. Known carcinogens and severe hazards. A finding is a process finding, not a margin question.',
          'Class 2: limit. Each has a permitted daily exposure and a concentration limit.',
          'Class 3: low toxic potential, generous default limit.',
          'The panel covers a list. Off-list solvents are not looked for.',
          'Test the finished matrix, not only the input.',
        ]),
        cites: Object.freeze(['usp467', 'ichq3c']),
      }),
      Object.freeze({
        h: 'Heavy metals — and why four is not enough for converted products',
        body: 'The standard heavy-metals panel in this industry covers four elements: lead, cadmium, arsenic and mercury. The framework behind the approach is the USP elemental-impurities chapters, and the four are chosen because cannabis is an efficient accumulator of soil metals and because these four are the classic toxicological priorities. For plant material grown in soil, a clean four-element result is genuinely informative. For a converted or synthesised cannabinoid product it is much less so, and this is a structural gap rather than a technicality. Chemical conversion processes can introduce process metals — metals that were part of the chemistry rather than part of the soil — and a four-element panel does not look for them, because the panel was designed for an agricultural contamination model and not for a manufacturing one. This shelf does not name the metals in question, because naming which metals to expect from which process is route information and this shelf does not carry route information. The actionable point for a buyer or a formulator does not require the names: for a product whose cannabinoid was made rather than extracted, ask whether the metals panel was an expanded elemental screen or the standard four, and understand that a standard four-element pass is silent about process residues. An expanded multi-element screen is the right question to ask, and a laboratory can say whether it offers one within its accreditation scope.',
        cites: Object.freeze(['usp232', 'babalonis2021', 'regcompilation']),
        contested: true,
        caveat: 'Panel composition varies by jurisdiction and some programmes require more than four elements. The general point stands: verify which elements were actually determined rather than assuming a metals panel is comprehensive.',
      }),
      Object.freeze({
        h: 'Pesticides — a target list, so an off-list compound is invisible',
        body: 'Pesticide screening is multi-residue analysis by liquid or gas chromatography with tandem mass spectrometry against a defined target list of active ingredients, with an action limit for each. Jurisdictional lists range from a few dozen compounds to several hundred and they do not agree with each other. The blind spot is structural and unavoidable: multi-residue methods identify and quantify against reference standards for listed compounds, so a pesticide that is not on the list is not detected, not reported, and not implied by a clean result. Three practical corollaries. A pesticide panel pass means the listed residues were below their action limits in that sample. It does not mean no pesticide was used. And a product tested against a short jurisdictional list and then sold into a jurisdiction with a longer one has not been tested to the destination standard. For anyone specifying testing, the list is the specification — ask which list, count the analytes, and check that the compounds of concern for the growing region are on it.',
        cites: Object.freeze(['regcompilation', 'ichq2']),
      }),
      Object.freeze({
        h: 'Mycotoxins and microbials',
        body: 'Mycotoxin panels typically determine the four aflatoxins — B1, B2, G1 and G2, usually with a limit on total aflatoxins and sometimes a separate tighter limit on B1 — together with ochratoxin A. These are fungal metabolites, so they are markers of a fungal history: mycotoxins can persist after the organism that produced them is gone, which means a clean microbial result and a mycotoxin finding are not contradictory, and remediation that kills mould does not remove the toxin it already made. Microbial panels combine non-specific counts with specified organisms: total aerobic microbial count, total yeast and mould count, bile-tolerant Gram-negative bacteria, and specified pathogens including Escherichia coli, Salmonella species and, in many jurisdictions, named Aspergillus species — commonly A. flavus, A. fumigatus, A. niger and A. terreus, which are singled out because of inhalational risk in immunocompromised users of inhaled products. Two limitations to carry forward. Culture-based and molecular methods answer subtly different questions — a molecular method may detect nucleic acid from organisms that are no longer viable, and a culture method may miss organisms that are viable but not culturable under the chosen conditions — so the method reference matters for interpretation. And microbial results have the shortest useful life of any panel, because a population can grow after testing if the water activity permits it, which is why the next section exists.',
        cites: Object.freeze(['regcompilation', 'methodcompilation']),
        contested: true,
        caveat: 'Specified organisms, action limits and permitted methods differ substantially between jurisdictions and are revised often. The organism lists here are the common pattern, not a universal requirement.',
      }),
      Object.freeze({
        h: 'Water activity and moisture — the two numbers that predict the future',
        body: 'Every other panel is retrospective: it says what was in the sample when it was tested. Water activity is the one number on a flower COA that is predictive, because it says whether microbial growth can occur in the package going forward. Water activity is the ratio of the vapour pressure of water in the material to that of pure water at the same temperature, expressed from 0 to 1, and it measures AVAILABLE water rather than total water. Below roughly 0.60 to 0.65 most moulds cannot grow; a common regulatory ceiling for cannabis flower is 0.65. Moisture content is the separate, related measurement of total water as a percentage of mass, commonly capped somewhere in the 12 to 15 percent region, and it matters for a second reason as well: the dry-weight basis conversion on the total-THC page needs it. The two numbers are not substitutes. Material can be at an acceptable moisture content with unevenly distributed water and a local water activity that supports growth, and material can be dry by water activity while being too dry for quality. For a buyer, a flower COA with a passing microbial panel and no water-activity figure has told you about the past and nothing about the shelf.',
        cites: Object.freeze(['regcompilation', 'usdahemp2021']),
        contested: true,
        caveat: 'The 0.65 water-activity ceiling and the 12 to 15 percent moisture range are common regulatory values compiled across jurisdictions, not a single universal standard. Verify the limit in force.',
      }),
      Object.freeze({
        h: 'LOD, LOQ, and why non-detect is a statement about the method',
        body: 'Three result qualifiers appear on COAs and they are routinely misread as one thing. The limit of detection, LOD, is the lowest concentration at which the analyte can be reliably distinguished from a blank — the method can tell something is there but cannot say how much, and the ICH validation guideline is the standard source for how it is established. The limit of quantitation, LOQ, is the lowest concentration that can be measured with acceptable precision and accuracy — the floor for a reportable number, and always above the LOD. ND, not detected, means the analyte was not detected AT OR ABOVE THE DETECTION LIMIT OF THIS METHOD. It does not mean zero, it does not mean absent, and it does not mean safe. A result of ND on a method with a detection limit of 1 part per million and a result of ND on a method with a detection limit of 1 part per billion are different statements by a factor of a thousand, and the COA distinguishes them only if it prints the limits. This is precisely why the LOD and LOQ columns are on the anatomy checklist, and why a report that gives ND without limits is much weaker than it looks. The corollary for the middle ground: a result reported as detected but below the quantitation limit is a real detection, and treating it as a non-detect is an error in the direction of false reassurance. In practice: read ND as "below this method\'s floor", find the floor, and decide whether that floor is low enough for the decision you are making.',
        bullets: Object.freeze([
          'LOD: the analyte can be distinguished from a blank. Presence, not amount.',
          'LOQ: the lowest concentration reportable as a number with stated precision. Always above the LOD.',
          'ND: not detected at or above this method\'s detection limit. Not zero, not absent.',
          'Detected below LOQ: a real detection that cannot be quantified. Not the same as ND.',
          'An ND with no printed detection limit is an uninterpretable result.',
        ]),
        cites: Object.freeze(['ichq2', 'iso17025']),
      }),
      Object.freeze({
        h: 'The unidentified peak: the most important thing on a converted-cannabinoid COA, and usually absent',
        body: 'This section is the analytical heart of the shelf. A chromatogram separates a sample into peaks; a quantitative method assigns the peaks it was calibrated for and reports concentrations for those. Anything else that came off the column is still there in the trace, as a peak with a retention time and an area and no name. On a report for extracted plant material, unassigned peaks are usually minor plant constituents and are of modest interest. On a report for a product whose cannabinoid was made by chemical conversion rather than extracted, the unassigned peaks are the single most informative feature of the entire document — because the conversion literature establishes that acid-catalysed cyclisation and isomerisation of cannabidiol yield a MIXTURE of products rather than one clean compound, and because those additional products are, by definition, compounds for which no reference standard exists and no pharmacology has been done. Marzullo and colleagues document in the chemical literature that such cyclisation gives multiple products; this shelf cites that work for that fact alone and reproduces nothing of any procedure. Babalonis and colleagues, reviewing delta-8-THC products, identify exactly this as the safety gap: widely available products made by conversion, sold without characterisation of the accompanying reaction products. So the questions that matter on such a report are: how much of the total chromatographic area was assigned to identified analytes, how much was not, and what is the largest single unassigned peak. And the reason this section is difficult to act on is that MOST COAS DO NOT REPORT ANY OF IT. A potency report prints a table of named cannabinoids and their concentrations. It does not print the chromatogram, it does not print total area, it does not print an unassigned area percent, and there is usually no field in which an unidentified major component could appear. A product can therefore show a clean, plausible, internally consistent potency table while a substantial fraction of the material is uncharacterised, and nothing on the certificate would indicate it. What to ask for, in order: the chromatograms rather than only the summary table; a statement of total identified versus unidentified area; a full-scan mass-spectrometric screen rather than a targeted potency method; and, for anything inhaled, characterisation of the finished formulation rather than of the input. A laboratory operating in good faith can answer all four. A refusal to answer is itself information.',
        bullets: Object.freeze([
          'Ask for the chromatogram, not only the results table.',
          'Ask for identified versus unidentified area percent.',
          'A targeted potency method cannot see an unknown; a full-scan screen can at least flag one.',
          'For converted-cannabinoid products, an unassigned major peak is the finding that matters most and is the one least likely to be printed.',
          'No reference standard means no quantitation; no pharmacology on the by-products means no basis for a safety claim about them.',
        ]),
        cites: Object.freeze(['marzullo2020', 'babalonis2021', 'auwarter2009', 'ichq2']),
        contested: true,
        caveat: 'The claim that conversion chemistry yields mixtures is established in the chemical literature and is cited by reference only. The specific identity, quantity and toxicology of by-products are product- and process-specific and are not characterised here; that absence of characterisation is the point of the section, not a gap in it.',
      }),
    ]),
    seeAlso: Object.freeze([
      'coa/reading-a-coa', 'coa/total-thc-math', 'coa/red-flags',
      'safety/k2-what-went-wrong', 'safety/converted-cannabinoid-products', 'safety/buyer-vendor-checklist',
      'formulation/residual-solvent', 'formulation/adulterants',
      'cannabinoids/isomers', 'cannabinoids/jwh-distinction', 'terpenes/overview',
    ]),
    cites: Object.freeze(['ichq2', 'ichq3c', 'usp467', 'usp232', 'auwarter2009', 'babalonis2021', 'marzullo2020', 'regcompilation', 'methodcompilation', 'iso17025', 'usdahemp2021']),
  }),

  // --------------------------------------------------------------- red-flags
  Object.freeze({
    slug: 'red-flags',
    title: 'Red Flags: A Practical COA Checklist',
    kind: 'safety',
    summary: 'Fourteen checks a buyer, retailer or formulator can run on a certificate of analysis without a chemistry background, with what each one means and what to do about it.',
    facts: Object.freeze({
      'Use': 'run the list against the COA and the package together; most checks take seconds',
      'Hardest stop': 'no COA at all, or a batch or lot that does not match the product',
      'Most-missed check': 'verify the report with the laboratory by sample identifier, using the lab\'s own lookup',
      'Most consequential category': 'a potency-only report on a converted or novel cannabinoid product',
      'Documented base rate': 'product surveys repeatedly find label potency that does not match assay, in edibles and in CBD products',
    }),
    sections: Object.freeze([
      Object.freeze({
        h: 'How to use this list',
        body: 'These are the checks that catch real defects, ordered roughly from hardest stop to most subtle. None of them requires chemistry. Most require reading two documents side by side — the certificate and the package — and one requires opening a web page. A single flag is a question, not a verdict; several together are a pattern. Where a flag has a section elsewhere on this shelf, it is cross-referenced rather than repeated. This is education and harm reduction, not legal or medical advice, and it is written for the reader who is going to buy or formulate something regardless and would rather do it with the document read properly.',
        cites: Object.freeze(['regcompilation']),
      }),
      Object.freeze({
        h: 'The checklist',
        table: Object.freeze({
          cols: Object.freeze(['Flag', 'What it means', 'What to do']),
          rows: Object.freeze([
            Object.freeze(['1. No COA at all', 'nothing about the contents has been verified by anybody outside the seller; the label is an unsupported assertion', 'request it; a seller who cannot produce one for the lot has not tested the lot']),
            Object.freeze(['2. Batch or lot on the COA does not match the package', 'the report describes different material; potency varies between runs and contamination is batch-specific', 'treat as no COA for your unit and request the report for your lot']),
            Object.freeze(['3. No dates, or a test date before the batch existed', 'either a clerical failure or a reused document; in both cases the report does not describe your product', 'request a dated report for your lot; check date received, date tested and date of report separately']),
            Object.freeze(['4. COA much older than the product', 'cannabinoids oxidise, terpenes evaporate, microbial counts can rise; the report is weak evidence about current contents', 'compare test date to purchase date; ask for stability data or recent testing on the lot']),
            Object.freeze(['5. Potency-only panel on a converted or novel cannabinoid product', 'the panel least able to reveal what goes wrong with that category; by-products, process residues and process metals are all outside it', 'require a full panel plus an expanded elemental screen and full-scan chromatographic data; see the panels page']),
            Object.freeze(['6. Unaccredited laboratory, or accreditation scope that does not cover this panel or matrix', 'the accreditation logo may be real and irrelevant; scope is method-, matrix- and analyte-specific', 'find the accreditation body and certificate number, open the public scope annex, confirm the method and matrix appear']),
            Object.freeze(['7. COA is an image or PDF with no lab-verifiable reference', 'an unverifiable document is trivially forged or altered, and altered COAs circulate', 'use the laboratory\'s own lookup by sample identifier; if the lab has no lookup, telephone or email the lab and confirm the sample identifier']),
            Object.freeze(['8. Named cannabinoid that no method could have quantified', 'a novel cannabinoid with no commercially available certified reference standard has no calibration curve, so the number cannot be a quantitation', 'ask which reference standard established the figure; an honest lab answers directly; see the K2 lesson on the panels page']),
            Object.freeze(['9. Label potency that does not match the assay', 'the documented failure mode in the survey literature, in both directions — underlabelled and overlabelled', 'do the arithmetic yourself from the COA, per unit and per package; see the total-THC page']),
            Object.freeze(['10. Not for human consumption on something clearly meant to be consumed', 'a labelling posture adopted to sidestep a regulatory framework while the product is sold and used as a consumable; it usually travels with the absence of the testing that framework would require', 'read it as a statement that the product was not qualified for consumption, and ask which panels were run']),
            Object.freeze(['11. ND results with no detection limits printed', 'not detected is a statement about the method floor; without the floor the result is uninterpretable', 'request the LOD and LOQ for the analytes that matter to you']),
            Object.freeze(['12. No measurement uncertainty on a result near a regulatory line', 'a point estimate cannot support a compliance decision at the margin', 'request the expanded uncertainty; see worked example 4 on the total-THC page']),
            Object.freeze(['13. No sampling statement', 'the report describes material selected by an interested party; representativeness is undocumented', 'ask who sampled, under what plan, and how many increments; independent sampling is the strong case']),
            Object.freeze(['14. Input or research-use report presented as a finished-product report', 'a distillate or isolate COA says nothing about what was added downstream, about finished-product solvents, or about homogeneity', 'request the finished-product COA on the finished lot; check the matrix field']),
          ]),
        }),
        cites: Object.freeze(['iso17025', 'ichq2', 'vandrey2015', 'bonnmiller2017', 'babalonis2021', 'auwarter2009', 'regcompilation', 'usdahemp2021']),
      }),
      Object.freeze({
        h: 'Verify the report with the laboratory — the check almost nobody runs',
        body: 'A certificate of analysis is a PDF or an image, and both are trivially editable. Altered COAs — with potency figures changed, failing results removed, dates moved, or an entire document rebuilt around a different product name — are a known problem in this market, and the countermeasure is simple and underused. Many laboratories publish a public lookup where a sample identifier, an order number or a QR code returns the laboratory\'s own copy of the report, and comparing that copy against the one the seller supplied detects alteration immediately. Where a laboratory has no lookup, it will still confirm a sample identifier by telephone or email. Three practical notes. A QR code printed on a package is not itself verification: check where it leads, because a code that resolves to a seller-controlled page proves nothing and a code that resolves to the laboratory\'s own domain proves a great deal. Compare the laboratory copy field by field, not by overall impression — dates, batch, panel set and every result. And a laboratory that cannot be found in any accreditation directory or contacted at all should be treated as a laboratory that does not exist.',
        cites: Object.freeze(['iso17025', 'regcompilation']),
      }),
      Object.freeze({
        h: 'Label accuracy: the base rate is documented, not anecdotal',
        body: 'The suspicion that labels and contents diverge is not cynicism, it is a finding. Vandrey and colleagues, reporting in JAMA in 2015, assayed edible medical cannabis products from dispensaries and found that a minority were accurately labelled for cannabinoid content, with both underlabelled and overlabelled products among the failures — a result that matters because an edible\'s label is the only dose information the consumer has. Bonn-Miller and colleagues, also in JAMA, assayed cannabidiol extracts sold online and found widespread mislabelling of CBD content, again in both directions, together with products containing detectable tetrahydrocannabinol that the labels did not disclose. Hazekamp\'s review of the CBD oil market describes the same picture from the quality-systems side. Two conclusions follow. First, treat a label claim as a claim and the COA as the evidence for it, and do the arithmetic yourself from the COA rather than trusting the front of the package — the total-THC page gives the conversions. Second, note the direction of the risk: underlabelling is a dosing hazard for the consumer, overlabelling is a value and efficacy problem, and undisclosed THC in a product sold as non-intoxicating is a hazard of a third kind entirely, with consequences for anyone subject to drug testing or caring for someone who is.',
        cites: Object.freeze(['vandrey2015', 'bonnmiller2017', 'hazekamp2018']),
        evidence: 'human',
        contested: true,
        caveat: 'These surveys sampled specific markets at specific times — dispensary edibles in 2015 and online CBD extracts in 2017 — and the mislabelling rates they report should not be treated as the current rate in any particular market. The finding that mislabelling is common and bidirectional is robust across the literature; the specific percentages are not current.',
      }),
      Object.freeze({
        h: 'What a good COA package looks like',
        body: 'It helps to know what you are aiming at rather than only what to avoid. A strong documentation package for a consumable cannabinoid product has: an accredited third-party laboratory whose published scope covers this method and this matrix; a batch or lot identifier that matches the package; test dates close to the production date; the full panel set required for the destination market, on the FINISHED product rather than on an input; detection and quantitation limits printed for every analyte; measurement uncertainty on anything near a limit; units and basis stated unambiguously, with moisture content where a dry-weight basis applies; an explicit sampling statement naming who sampled and under what plan; an authorised signatory; and a working laboratory-side lookup by sample identifier. For a converted or novel cannabinoid product, add two more: an expanded elemental screen rather than the standard four metals, and full-scan chromatographic data with a statement of identified versus unidentified area. That list is achievable — plenty of operators already meet it — and the gap between it and what is typically offered is the real state of the market.',
        cites: Object.freeze(['iso17025', 'ichq2', 'usp232', 'usp467', 'babalonis2021']),
      }),
    ]),
    seeAlso: Object.freeze([
      'coa/reading-a-coa', 'coa/panels', 'coa/total-thc-math',
      'safety/buyer-vendor-checklist', 'safety/converted-cannabinoid-products', 'safety/k2-what-went-wrong',
      'formulation/adulterants', 'formulation/dose-arithmetic',
      'regulatory/market-consequences', 'regulatory/state-positioning',
    ]),
    cites: Object.freeze(['iso17025', 'ichq2', 'usp232', 'usp467', 'vandrey2015', 'bonnmiller2017', 'hazekamp2018', 'babalonis2021', 'auwarter2009', 'regcompilation', 'usdahemp2021']),
  }),

]);

export default { SHELF, CITES, PAGES };
