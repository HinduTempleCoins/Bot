// processing.mjs — the Extraction, Separation and Purification shelf: the hemp-industry unit-operations core.
//
// WHAT THIS SHELF IS. A working process reference for a small licensed processor or a lab tech: the
// nine unit operations that take live or dried plant material to a specified, saleable, testable
// product. Platform selection (CO2, ethanol, hydrocarbon, solventless), short-path and wiped-film
// distillation, rotary evaporation as a solvent-recovery discipline, winterization, decarboxylation
// as a process rather than as chemistry, crystallisation of isolate, preparative chromatography, and
// terpene recovery. Every page is written to be worked from: real temperatures, real pressures, real
// vacuum depths, real ratios, real times, with the honest statement of where published parameters
// disagree.
//
// EVERY OPERATION HERE IS SEPARATION OR PURIFICATION. Distillation, evaporation, winterization,
// decarboxylation, crystallisation, chromatography and terpene recovery separate and purify what the
// plant already made. Decarboxylation removes a carboxyl group the plant put there and is the one
// chemical change in the list; it is a unit operation with a time/temperature curve, and it is taught
// as one.
//
// WHAT THIS SHELF DELIBERATELY DOES NOT CONTAIN. Preparative conversion chemistry to produce
// intoxicating cannabinoids: acid-catalysed isomerisation of CBD to Δ8- or Δ9-THC, and side-chain
// homologation to THCP or THCJD. For those there are no reagents, no catalysts, no equivalents, no
// conditions, no work-ups and no yields anywhere on this shelf. The structural and regulatory
// treatment of those molecules lives on cannabinoids/isomers, cannabinoids/side-chain-series and
// regulatory/thcp-thcjd; the market consequence lives on safety/converted-cannabinoid-products. The
// exclusion is narrow and deliberate, and it is stated once, on extraction-methods, rather than used
// as an excuse to withhold separation parameters that a processor needs to run a safe plant.
//
// WHERE THE MATERIAL COMES FROM. Chemical-engineering and separation-science reference works (Perry,
// Mullin, Myerson, Snyder/Kirkland/Dolan), the cannabinoid separation and decarboxylation literature
// (Hazekamp on centrifugal partition chromatography, Wang and Veress and Perrotin-Brunel and Citti on
// decarboxylation kinetics, Fairbairn and Trofin on oxidative degradation, Gieringer on the
// volatilisation temperatures that the widely-copied cannabinoid boiling-point table actually rests
// on), the residual-solvent frameworks (ICH Q3C, USP General Chapter 467), fire and electrical code
// for solvent rooms (NFPA, OSHA 29 CFR 1910), and the operator's own corpus — the Van Kush Family
// Temple Pharmacopoeia knowledgebase (steam distillation, Helichrysum essential-oil yields,
// extraction method tiers) and the Marijuana Extraction personal history (dry-ice and ice-water hash,
// the BHO era and its injuries, the move to distillate).
//
// CITATION HONESTY. No identifier on this shelf has been resolved against Crossref or PubMed in this
// pass, so every record carries verified: false. That means the bibliographic details are recorded
// from the literature but the DOI or PMID has not been confirmed here. An unresolved citation is
// honest; a guessed DOI is a defect. A large part of processing practice has no journal source at all
// — it is vendor documentation and accumulated operating experience — and those sections are labelled
// evidence: 'industry practice' and cite the composite trade-practice record rather than pretending
// to a paper that does not exist.

const F = Object.freeze;

export const SHELF = F({
  id: 'processing',
  title: 'Extraction, Separation and Purification',
  blurb: 'The unit operations that turn plant material into a specified product: choosing an extraction platform, short-path and wiped-film distillation, solvent recovery, winterization, decarboxylation, crystallisation of isolate, preparative chromatography, and capturing the terpene fraction before heat destroys it.',
  updated: '2026-09-27',
});

/**
 * CITES — this shelf's bibliography.
 *
 * verified: false on every record. The bibliographic details are recorded from the literature or from
 * the named standard; no DOI, PMID or document number has been resolved in this pass. Never guess an
 * identifier — an unresolved citation is honest, a fabricated one is a serious defect.
 *
 * tradepractice is a composite record, not a paper. It stands for equipment-vendor documentation,
 * processor operating experience and the trade press. Sections that rest on it are labelled
 * evidence: 'industry practice' so a reader knows exactly what kind of authority is behind the number.
 */
export const CITES = F({
  tradepractice: { authors: 'Composite: extraction-equipment vendor documentation, processor operating experience, trade press', year: 2026,
    title: 'Processing trade practice (not a journal source — recorded as industry practice)',
    journal: 'trade and vendor documentation', verified: false },
  vkfri2026: { authors: 'Van Kush Family Research Institute', year: 2026,
    title: 'Temple Pharmacopoeia Knowledgebase: Botanical Preparations, Extraction Science, and Formulation Frameworks',
    journal: 'operator corpus, internal research compilation (January 2026)', verified: false },
  angelicalist2026: { authors: 'Angelicalist (Van Kush Family)', year: 2026,
    title: 'Marijuana Extraction: A Personal History and Technical Overview',
    journal: 'operator corpus record (knowledge/herbs)', verified: false },
  perry2019: { authors: "Green DW, Southard MZ (eds)", year: 2019,
    title: "Perry's Chemical Engineers' Handbook, 9th edition — distillation, evaporation, vacuum systems",
    journal: 'McGraw-Hill (reference work)', verified: false },
  spanwagner1996: { authors: 'Span R, Wagner W', year: 1996,
    title: 'A New Equation of State for Carbon Dioxide Covering the Fluid Region from the Triple-Point Temperature to 1100 K at Pressures up to 800 MPa',
    journal: 'Journal of Physical and Chemical Reference Data', verified: false },
  rovetto2017: { authors: 'Rovetto LJ, Aieta NV', year: 2017,
    title: 'Supercritical carbon dioxide extraction of cannabinoids from Cannabis sativa L.',
    journal: 'The Journal of Supercritical Fluids', verified: false },
  qamar2021: { authors: 'Qamar S, Torres YJM, Parekh HS, Falconer JR', year: 2021,
    title: 'Extraction of medicinal cannabinoids through supercritical carbon dioxide technologies: A review',
    journal: 'Journal of Chromatography B', verified: false },
  ichq3c: { authors: 'International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use', year: 2021,
    title: 'Impurities: Guideline for Residual Solvents, Q3C(R8) — solvent class definitions and permitted daily exposures',
    journal: 'ICH harmonised guideline', verified: false },
  usp467: { authors: 'United States Pharmacopeia', year: 2023,
    title: 'General Chapter 467, Residual Solvents — identification, control and quantification',
    journal: 'USP-NF (compendial chapter)', verified: false },
  nfpa: { authors: 'National Fire Protection Association', year: 2024,
    title: 'NFPA 30 Flammable and Combustible Liquids Code; NFPA 70 National Electrical Code Article 500 (hazardous classified locations)',
    journal: 'NFPA codes and standards', verified: false },
  osha1910: { authors: 'Occupational Safety and Health Administration', year: 2024,
    title: '29 CFR 1910.106 (flammable liquids), 1910.107, and 1910.307 (hazardous classified locations)',
    journal: 'US Code of Federal Regulations', verified: false },
  monte2015: { authors: 'Bell C, Slim J, Flaten HK, Lindberg G, Arek W, Monte AA', year: 2015,
    title: 'Butane Hash Oil Burns Associated with Marijuana Liberalization in Colorado',
    journal: 'Journal of Medical Toxicology', verified: false },
  prudent2011: { authors: 'National Research Council (US), Committee on Prudent Practices in the Laboratory', year: 2011,
    title: 'Prudent Practices in the Laboratory: Handling and Management of Chemical Hazards, updated version',
    journal: 'National Academies Press', verified: false },
  kelly1996: { authors: 'Kelly RJ', year: 1996,
    title: 'Review of Safety Guidelines for Peroxidizable Organic Chemicals',
    journal: 'Chemical Health and Safety', verified: false },
  armarego2017: { authors: 'Armarego WLF, Chai CLL', year: 2017,
    title: 'Purification of Laboratory Chemicals, 8th edition — solvent properties, drying, distillation practice',
    journal: 'Butterworth-Heinemann (reference work)', verified: false },
  gieringer2004: { authors: 'Gieringer D, St. Laurent J, Goodrich S', year: 2004,
    title: 'Cannabis Vaporizer Combines Efficient Delivery of THC with Effective Suppression of Pyrolytic Compounds',
    journal: 'Journal of Cannabis Therapeutics', verified: false },
  wang2016: { authors: 'Wang M, Wang YH, Avula B, Radwan MM, Wanas AS, van Antwerp J, Parcher JF, ElSohly MA, Khan IA', year: 2016,
    title: 'Decarboxylation Study of Acidic Cannabinoids: A Novel Approach Using Ultra-High-Performance Supercritical Fluid Chromatography/Photodiode Array-Mass Spectrometry',
    journal: 'Cannabis and Cannabinoid Research', verified: false },
  veress1990: { authors: 'Veress T, Szanto JI, Leisztner L', year: 1990,
    title: 'Determination of cannabinoid acids by high-performance liquid chromatography of their neutral derivatives formed by thermal decarboxylation: study of the decarboxylation process in open reactors',
    journal: 'Journal of Chromatography', verified: false },
  perrotinbrunel2011: { authors: 'Perrotin-Brunel H, Buijs W, van Spronsen J, van Roosmalen MJE, Peters CJ, Verpoorte R, Witkamp GJ', year: 2011,
    title: 'Decarboxylation of Δ9-tetrahydrocannabinol: kinetics and molecular modelling',
    journal: 'Journal of Molecular Structure', verified: false },
  citti2018: { authors: 'Citti C, Pacchetti B, Vandelli MA, Forni F, Cannazza G', year: 2018,
    title: 'Analysis of cannabinoids in commercial hemp seed oil and decarboxylation kinetics studies of cannabidiolic acid (CBDA)',
    journal: 'Journal of Pharmaceutical and Biomedical Analysis', verified: false },
  fairbairn1976: { authors: 'Fairbairn JW, Liebmann JA, Rowan MG', year: 1976,
    title: 'The stability of cannabis and its preparations on storage',
    journal: 'Journal of Pharmacy and Pharmacology', verified: false },
  trofin2012: { authors: 'Trofin IG, Dabija G, Váireanu DI, Filipescu L', year: 2012,
    title: 'Long-term storage and cannabis oil stability',
    journal: 'Revista de Chimie', verified: false },
  usdahemp2021: { authors: 'United States Department of Agriculture, Agricultural Marketing Service', year: 2021,
    title: 'Establishment of a Domestic Hemp Production Program, final rule, 7 CFR Part 990 — total THC and the decarboxylated basis',
    journal: 'US Federal Register / Code of Federal Regulations', verified: false },
  mullin2001: { authors: 'Mullin JW', year: 2001,
    title: 'Crystallization, 4th edition — nucleation, supersaturation, crystal habit, washing and drying',
    journal: 'Butterworth-Heinemann (reference work)', verified: false },
  myerson2019: { authors: 'Myerson AS, Erdemir D, Lee AY (eds)', year: 2019,
    title: 'Handbook of Industrial Crystallization, 3rd edition — seeding, cooling profiles, occluded solvent',
    journal: 'Cambridge University Press', verified: false },
  snyder2010: { authors: 'Snyder LR, Kirkland JJ, Dolan JW', year: 2010,
    title: 'Introduction to Modern Liquid Chromatography, 3rd edition — resolution, gradient elution, preparative scale-up',
    journal: 'Wiley', verified: false },
  hazekamp2004: { authors: 'Hazekamp A, Simons R, Peltenburg-Looman A, Sengers M, van Zweden R, Verpoorte R', year: 2004,
    title: 'Preparative isolation of cannabinoids from Cannabis sativa by centrifugal partition chromatography',
    journal: 'Journal of Liquid Chromatography and Related Technologies', verified: false },
  berthod2009: { authors: 'Berthod A, Maryutina T, Spivakov B, Shpigun O, Sutherland IA', year: 2009,
    title: 'Countercurrent chromatography in analytical chemistry (IUPAC Technical Report)',
    journal: 'Pure and Applied Chemistry', verified: false },
  ito2005: { authors: 'Ito Y', year: 2005,
    title: 'Golden rules and pitfalls in selecting optimum conditions for high-speed counter-current chromatography',
    journal: 'Journal of Chromatography A', verified: false },
  namdar2018: { authors: 'Namdar D, Mazuz M, Ion A, Koltai H', year: 2018,
    title: 'Variation in the compositions of cannabinoid and terpenoids in Cannabis sativa derived from inflorescence position along the stem and extraction methods',
    journal: 'Industrial Crops and Products', verified: false },
  adams1940: { authors: 'Adams R, Hunt M, Clark JH', year: 1940,
    title: 'Structure of cannabidiol, a product isolated from the marihuana extract of Minnesota wild hemp',
    journal: 'Journal of the American Chemical Society', verified: false },
  gaoni1964: { authors: 'Gaoni Y, Mechoulam R', year: 1964,
    title: 'Isolation, structure and partial synthesis of an active constituent of hashish',
    journal: 'Journal of the American Chemical Society', verified: false },
});

/**
 * PAGES — each becomes one wiki page at /science/processing/<slug>.
 */
export const PAGES = F([

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'extraction-methods',
    title: 'Choosing an Extraction Platform',
    kind: 'tool',
    summary: 'The comparative decision every processor makes first: CO2, ethanol, hydrocarbon or solventless. The platform sets yield, selectivity, terpene retention, capital cost, the fire and licensing burden, and — decisively — which downstream operations you are then obliged to run.',
    facts: F({
      'Platforms compared': 'CO2 (subcritical and supercritical), ethanol (cold and warm), hydrocarbon (butane, propane, blends), solventless (ice-water hash, rosin)',
      'CO2 critical point': '31.1 °C and 73.8 bar (about 1071 psi)',
      'Ethanol solvent class': 'Class 3 under ICH Q3C — low toxic potential, high permitted daily exposure',
      'Highest terpene retention': 'hydrocarbon (cold, low-temperature purge) and solventless',
      'Heaviest safety and licensing burden': 'hydrocarbon — classified electrical area, gas detection, closed loop',
      'No residual-solvent panel to fail': 'solventless only',
      'Decides the downstream': 'winterization, distillation feed quality and terpene strategy all follow from this choice',
    }),
    sections: F([
      F({
        h: 'The first decision sets every later one',
        body: 'Extraction platform selection is not one decision among many, it is the decision that constrains all the others. A supercritical CO2 run on dried flower gives a crude that is heavy in waxes and lipids, which means winterization is not optional and a rotary evaporator or falling-film unit must be sized for the ethanol that winterization consumes. A cold-ethanol run gives a crude that is cleaner in wax but has already lost most of its monoterpenes to the recovery step, which means a terpene product has to be captured separately or bought in. A cold hydrocarbon run on fresh-frozen material gives the best terpene retention available from a solvent process and gives a crude that often needs little or no winterization, and it costs you a classified electrical room, continuous gas monitoring, a closed-loop vessel with documented pressure ratings, and a licence that in many jurisdictions is harder to obtain than the cultivation licence. A solventless process has no residual-solvent panel to fail and the lightest regulatory footprint of the four, and it caps your yield well below anything a solvent can reach. There is no dominant platform. There is only a platform that matches your input material, your product mix, your capital, and the regulatory environment you can actually operate in.',
        bullets: F([
          'Input form matters as much as platform: fresh-frozen, dried-and-cured, and dried trim behave differently in every one of the four.',
          'Product mix matters more than yield: an isolate house and a live-resin house make opposite platform choices.',
          'The platform you can be permitted for is the only platform you have.',
        ]),
        cites: F(['tradepractice', 'angelicalist2026']),
        evidence: 'industry practice',
      }),
      F({
        h: 'CO2: subcritical and supercritical',
        body: 'Carbon dioxide has a critical point at 31.1 °C and 73.8 bar. Above both of those it is a supercritical fluid: gas-like diffusivity and viscosity with liquid-like density, and a solvent power that can be tuned continuously by changing pressure and temperature because density is the variable that sets solvating strength. Below the critical point but above the vapour pressure it is a liquid, and liquid CO2 — subcritical operation, typically run in the region of 5 to 25 °C and 55 to 70 bar — is a weaker, more selective solvent that favours the volatile and lower-molecular-weight fraction, which is why subcritical runs are used to pull a terpene-rich first fraction before a supercritical stage takes the cannabinoids. Supercritical cannabinoid extraction is commonly run somewhere in the 45 to 80 °C and 200 to 350 bar band, with higher density pulling more but pulling less selectively: push the density up and the waxes, lipids, chlorophyll degradation products and long-chain plant material come with the cannabinoids. Published academic envelopes and vendor recommendations differ substantially, and a processor tunes their own by running a pressure and temperature grid against assay rather than adopting a number from a paper.',
        bullets: F([
          'Density is the control handle: solvating power tracks CO2 density, not pressure or temperature alone.',
          'Co-solvent (entrainer) use, most often 1 to 10 percent ethanol, increases polarity and raises cannabinoid recovery, at the cost of pulling more polar plant material and reintroducing a residual-solvent question.',
          'Fractional collection into separate separator vessels at stepped pressures is a real advantage of the platform: you can bank a terpene fraction and a cannabinoid fraction from one run.',
          'Almost every CO2 crude requires winterization before distillation.',
          'High capital cost, and the pressure vessels bring ASME-style code, relief-device and periodic-inspection obligations.',
          'Low solvent-safety burden by comparison with hydrocarbon: CO2 is non-flammable. It is not harmless — it is an asphyxiant heavier than air, so low-level CO2 monitoring and room ventilation are required, and a high-pressure release is a mechanical hazard in its own right.',
        ]),
        cites: F(['spanwagner1996', 'rovetto2017', 'qamar2021', 'tradepractice']),
        contested: true,
        caveat: 'The critical point (31.1 °C, 73.8 bar) is a fixed physical constant and is not in dispute. The operating envelopes are: published supercritical cannabinoid extraction conditions range from roughly 40 to 90 °C and 100 to 500 bar across the literature and vendor documentation, with yields and selectivity reported against different input materials, particle sizes, moisture contents and flow rates. Treat the bands given here as orientation and establish your own envelope against assay.',
      }),
      F({
        h: 'Ethanol: cold versus warm',
        body: 'Ethanol is a polar protic solvent that dissolves cannabinoids readily and also dissolves chlorophyll, waxes, sugars and water-soluble plant material. Temperature is the selectivity handle. Warm or ambient ethanol — anything from room temperature upward — extracts fast and extracts nearly everything, giving a high-yield, dark, chlorophyll-heavy crude that will need both winterization and a hard polish before it distils to a pale product. Cold ethanol, typically chilled to −20 °C to −40 °C and sometimes to −60 °C or lower, is a poorer solvent for chlorophyll and for the plant waxes, so a short cold contact time co-extracts much less of both. The polarity consequence does not disappear: even cold ethanol pulls more polar material than hydrocarbon or subcritical CO2 will, so an ethanol crude is characteristically greener and more viscous than a hydrocarbon crude from the same biomass. The platform wins on throughput and on simplicity: ethanol extraction scales to tonnes per day with centrifuges and jacketed tanks, the equipment is ordinary process equipment, and the solvent is recoverable in high yield. The economics live and die on that recovery percentage, because ethanol is bought by volume and consumed by the litre per kilogram of biomass, so a falling-film evaporator that returns 95 percent or better of the solvent is the difference between a viable and an unviable operation. Ethanol is a Class 3 solvent under ICH Q3C, the lowest-concern class, with a correspondingly generous permitted daily exposure; that is a real advantage when a residual-solvent panel is the gate on saleability.',
        bullets: F([
          'Cold ethanol favours cannabinoids over chlorophyll and wax; warm ethanol maximises yield and maximises cleanup.',
          'Contact time matters as much as temperature — a long cold soak starts behaving like a warm one.',
          'Ethanol is flammable (flash point about 13 °C for anhydrous ethanol) and its vapour is denser than air, so the room still needs ventilation, ignition-source control and appropriate electrical classification, even though the burden is far below hydrocarbon.',
          'Water content in the biomass ends up in the ethanol and changes its polarity; wet input silently shifts your selectivity.',
          'Class 3 under ICH Q3C: low toxic potential, high permitted daily exposure, which is why an ethanol platform has an easier residual-solvent conversation than a hydrocarbon one.',
        ]),
        cites: F(['ichq3c', 'tradepractice', 'armarego2017']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Hydrocarbon: butane, propane and blends — and the hazard that must be stated plainly',
        body: 'Light hydrocarbons are non-polar and are excellent, selective solvents for cannabinoids and terpenes and poor solvents for chlorophyll and for much of the polar plant material. n-butane is the workhorse; propane, with a much higher vapour pressure, pulls a lighter, more terpene-weighted fraction and is often blended with butane at 20 to 30 percent to lift terpene recovery and drop viscosity. Run cold on fresh-frozen material, a hydrocarbon process gives the best terpene retention of any solvent platform, which is precisely why live resin and live rosin sit in that part of the market. The crude is often light enough in wax that winterization can be reduced or skipped, which shortens the whole downstream chain. Recovery is fast because the solvent boils near or below room temperature. Against that: the safety and licensing burden is the heaviest in the industry, and unlicensed hydrocarbon extraction is the single most common cause of serious injury in this field. That is not a disclaimer, it is the operating fact. Butane vapour is denser than air, so it pools at floor level and travels; its lower explosive limit is in the region of 1.8 percent by volume in air, meaning a small release in an enclosed space reaches an ignitable mixture quickly and invisibly; and the ignition energy required is trivially small — a light switch, a refrigerator compressor, a phone, a static discharge from a synthetic sleeve. The clinical literature on the resulting burn admissions is unambiguous, and the emergency-department series from jurisdictions that liberalised cannabis before they regulated extraction are the reason the modern rules exist. The operator corpus records the same history from inside it: people setting themselves on fire and destroying houses doing indoor butane extractions before the laws were written.',
        bullets: F([
          'Closed-loop only. An open blast tube venting hydrocarbon into a room is the configuration that produces the injuries.',
          'Classified electrical area (commonly specified as Class I Division 1 for the extraction room, Division 2 for adjacent space) with all equipment, wiring and lighting rated for it.',
          'Continuous lower-explosive-limit gas detection, interlocked to alarm and to shut down ignition-capable equipment, with alarm set points well below the LEL.',
          'Mechanical ventilation designed for a vapour heavier than air — extraction at floor level, not at ceiling level.',
          'Peer-reviewed engineering documentation of the vessel and relief devices, pressure-rated components, and documented hydrostatic testing; relief-valve discharge routed outside.',
          'Bonding and grounding of every vessel and transfer line; static is a sufficient ignition source.',
          'No solvent-wet material in an oven, no solvent recovery into an open vessel, no warm water bath heated by anything with a flame or an unrated element.',
          'Jurisdiction-specific licensing on top of all of the above; in many states the hydrocarbon endorsement is a separate and harder permission than the extraction licence itself.',
        ]),
        cites: F(['monte2015', 'nfpa', 'osha1910', 'angelicalist2026', 'tradepractice']),
      }),
      F({
        h: 'Solventless: ice-water hash and rosin',
        body: 'Solventless processing does not dissolve anything. Ice-water extraction agitates cold plant material in ice water so that the trichome heads, which are denser and more brittle when cold, break at the stalk and sink, and then classifies the collected material by size through a stack of mesh bags — the familiar 220, 160, 120, 90, 73, 45 and 25 micron series, where the 45 to 90 micron fractions are usually the most desirable because that is the size band of intact mature trichome heads. The wet hash is then freeze-dried, because air-drying a wet hash at ambient temperature invites microbial growth and oxidative loss. Rosin is the second half of the discipline: heat and pressure applied to flower, to kief or to dried ice-water hash forces the resin out of the trichome without a solvent. Flower rosin is typically pressed in the region of 80 to 100 °C, hash rosin lower, commonly 70 to 90 °C, with hold times measured in tens of seconds to a couple of minutes and pressure applied progressively rather than all at once; the trade rule of thumb is that lower temperature and longer hold gives better terpene retention and a more stable product, and higher temperature gives a higher, faster yield and a runnier, darker result. The operator corpus records the lineage of this method from dry-ice and bubble-bag kief work through the ice-water technique associated with Matt Rize, which used a small camping washing machine for controlled agitation. The regulatory consequence is the real prize: there is no solvent, therefore there is no residual-solvent panel to fail, therefore the capital, the room classification, the gas detection and much of the licensing burden simply do not apply. The cost is a hard yield ceiling — solventless recovers only what the trichome will give up mechanically, so it cannot approach a solvent platform on grams per kilogram, and it demands input material of a quality that solvent platforms do not, because you cannot refine your way out of poor starting material.',
        bullets: F([
          'Cold is the whole mechanism on the wash side: warm water softens the trichome and it deforms instead of breaking.',
          'Freeze-drying the wet hash is not optional at scale — it is the step that protects the terpenes and the microbial result.',
          'Rosin is a physical squeeze, so everything in the input that is not resin stays behind in the bag rather than being dissolved out with the target.',
          'Yield ceiling and input-quality dependence are the trade for the clean regulatory position.',
          'Low but non-zero hazard: hydraulic press pinch points and high surface temperatures, and heavy cold-water handling.',
        ]),
        cites: F(['angelicalist2026', 'vkfri2026', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Platform comparison',
        body: 'The table compresses the decision. Read it as relative ranking within this industry rather than as absolute figures: the yield column in particular is dominated by input material, moisture, particle size and operator skill, and any specific gram-per-kilogram number quoted for a platform without stating the input is meaningless. What is stable across operations is the ordering and the shape of the trade-offs.',
        table: F({
          cols: F(['Platform', 'Cannabinoid yield', 'Selectivity', 'Terpene retention', 'Capital cost', 'Operating cost', 'Safety burden', 'Licensing burden']),
          rows: F([
            F(['Supercritical CO2', 'high', 'tunable, moderate', 'low to moderate (better with a subcritical first cut)', 'very high', 'moderate (power, CO2, maintenance)', 'moderate (high pressure, asphyxiant)', 'moderate (pressure-vessel code)']),
            F(['Subcritical CO2', 'low to moderate', 'high for volatiles', 'good for the volatile fraction specifically', 'very high', 'moderate', 'moderate', 'moderate']),
            F(['Cold ethanol', 'high', 'moderate', 'low (most monoterpenes lost in recovery)', 'moderate', 'low to moderate, driven by solvent recovery percentage', 'moderate (flammable, Class 3)', 'moderate']),
            F(['Warm ethanol', 'highest of the ethanol modes', 'low', 'very low', 'low to moderate', 'low', 'moderate', 'moderate']),
            F(['Hydrocarbon (butane/propane)', 'high', 'high', 'highest of the solvent platforms', 'moderate to high', 'low to moderate', 'highest in the industry', 'highest in the industry']),
            F(['Ice-water hash', 'low', 'very high (mechanical)', 'high', 'low to moderate (freeze dryer dominates)', 'moderate (labour, water, ice)', 'low', 'lowest']),
            F(['Rosin / hash rosin', 'low', 'very high (mechanical)', 'high', 'low', 'low', 'low', 'lowest']),
          ]),
        }),
        cites: F(['tradepractice', 'angelicalist2026', 'namdar2018']),
        contested: true,
        caveat: 'Yield and terpene-retention rankings vary with input form (fresh-frozen versus dried), cultivar, and the exact operating parameters chosen. Namdar and colleagues showed that extraction method alone changes the recovered cannabinoid and terpenoid profile from the same biomass. Use this table to frame the decision, not to predict your numbers.',
        evidence: 'industry practice',
      }),
      F({
        h: 'What this shelf does not cover: conversion chemistry',
        body: 'One category of chemistry is deliberately absent from this shelf and from every page on it. Acid-catalysed isomerisation of CBD to Δ8-THC or Δ9-THC, and side-chain homologation to produce THCP, THCJD and the other extended-chain analogues, are preparative conversions that create an intoxicating molecule the plant did not supply in that quantity. They are documented in the chemical literature from Adams and colleagues in 1940 onward and, on the Δ9 side, from the Gaoni and Mechoulam partial synthesis of 1964; the isomerisation in particular is chemically facile and the procedures exist in those and later citations. No reagent, catalyst, solvent, equivalent, concentration, temperature, reaction time, work-up or yield for any of them appears anywhere on this shelf. The molecules themselves are described structurally and pharmacologically on cannabinoids/isomers and cannabinoids/side-chain-series, their legal position on regulatory/thcp-thcjd, and what an unspecified converted product actually contains — the reaction by-products, the unidentified peaks, the reason a COA on a converted product needs reading differently — on safety/converted-cannabinoid-products. Everything on this shelf is separation and purification of what is already there. That distinction is the line, it is drawn on purpose, and it is the only thing this shelf withholds.',
        cites: F(['adams1940', 'gaoni1964']),
        evidence: 'historical',
      }),
    ]),
    seeAlso: F(['processing/short-path-distillation', 'processing/winterization', 'processing/terpene-recovery', 'processing/decarboxylation', 'equipment/safety-and-fire', 'formulation/residual-solvent', 'safety/converted-cannabinoid-products']),
    cites: F(['tradepractice', 'angelicalist2026', 'vkfri2026', 'spanwagner1996', 'rovetto2017', 'qamar2021', 'ichq3c', 'nfpa', 'osha1910', 'monte2015', 'armarego2017', 'namdar2018', 'adams1940', 'gaoni1964']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'short-path-distillation',
    title: 'Short-Path Distillation',
    kind: 'tool',
    summary: 'Batch vacuum distillation of cannabinoid crude: why deep vacuum is what makes it possible at all, what every part of the apparatus is for, the fraction cuts in order, what a second pass actually buys, and how to manage total heat history so the product does not arrive with an isomerisation and oxidation history printed on its COA.',
    facts: F({
      'What it separates': 'cannabinoids from terpenes, residual solvent, water, pigments, sterols and polymerised residue, by difference in vapour pressure',
      'Typical jacket/mantle range': '130-180 °C',
      'Typical vacuum': 'roughly 0.1 to 0.001 mbar (about 75 to 0.75 micron) at the head for a cannabinoid body cut',
      'Control variable': 'vapour temperature at the head, not mantle temperature',
      'Residence time': 'tens of minutes to hours per batch — the platform weakness',
      'Typical output': 'high-80s to mid-90s percent total cannabinoids from decarboxylated, winterized crude',
      'Degradation markers': 'Δ8-THC from isomerisation, CBN from oxidation, darkening from polymerised residue',
    }),
    sections: F([
      F({
        h: 'What distillation is actually doing',
        body: 'Distillation separates a mixture by exploiting differences in vapour pressure. At any temperature, each component in a liquid mixture exerts its own partial vapour pressure; the component with the higher vapour pressure at that temperature is enriched in the vapour phase, and if you condense that vapour separately you have separated it from the rest. Boiling point is not a property of a molecule in isolation, it is the temperature at which that molecule exerts a vapour pressure equal to the pressure above the liquid. That single sentence is the whole basis of vacuum distillation: lower the pressure above the liquid and the temperature at which the liquid boils falls with it. In a cannabinoid distillation the components you are separating span an enormous range of volatility — monoterpenes that flash off almost immediately, residual solvent and water below them, then sesquiterpenes, then the cannabinoids themselves in a fairly narrow band, then sterols, waxes that survived winterization, pigments and finally material that will not distil at all at any temperature you can safely apply and stays behind as residue.',
        cites: F(['perry2019']),
      }),
      F({
        h: 'Pressure, boiling point and thermal load',
        body: 'The relationship between vapour pressure and temperature is exponential, not linear. The Clausius-Clapeyron relation captures the intuition: the logarithm of vapour pressure falls roughly linearly with the reciprocal of absolute temperature, with the slope set by the enthalpy of vaporisation. The practical consequence is that the first decade of vacuum buys you a large drop in boiling point, and each further decade buys you a smaller but still substantial drop — for a heavy, low-volatility compound, dropping from atmospheric pressure to around 1 mbar typically pulls the boiling point down by well over a hundred degrees. That is not a convenience, it is the enabling condition. Cannabinoids are thermally labile: at the temperature at which they would boil under one atmosphere they degrade appreciably before and while they boil, so an atmospheric-pressure distillation of THC or CBD does not produce distillate, it produces decomposition products. Under deep vacuum the same molecules move at a jacket temperature in the 130 to 180 °C band, where the rate of thermal degradation is slow enough that the material can be got over the head and condensed before very much of it is lost. The widely reproduced table of cannabinoid boiling points — THC at 157 °C, CBD at 160 to 180 °C, CBN around 185 °C and so on — comes originally from vaporiser research rather than from a distillation determination, and the figures are best read as approximate volatilisation temperatures rather than as thermodynamic boiling points measured at a stated pressure.',
        bullets: F([
          'Boiling point is a function of the pressure above the liquid, not an intrinsic constant.',
          'Reducing pressure reduces the temperature required, therefore reduces the thermal load, therefore reduces degradation.',
          'The reason to buy a better pump is not speed, it is product quality.',
          'Degradation is not a threshold effect at some magic temperature; it is a rate that rises steeply with temperature and accumulates with time.',
        ]),
        cites: F(['perry2019', 'gieringer2004']),
        contested: true,
        caveat: 'The 157 °C figure for THC and the associated cannabinoid boiling-point table are quoted throughout the trade without a stated pressure and trace back to vaporiser volatilisation work (Gieringer and colleagues), not to a controlled boiling-point determination. Published values for the same cannabinoid differ by tens of degrees between sources. Treat them as indicative of relative volatility only, and set your own cut points from what you observe at your own vacuum.',
      }),
      F({
        h: 'Vacuum depth: the units, and what each decade buys',
        body: 'Three unit systems are in daily use and a processor needs all three because gauges, pumps and papers do not agree on one. One standard atmosphere is 1013 mbar, 760 torr (equivalently 760 mmHg) and 760000 micron, where a micron is one thousandth of a torr. So 1 mbar is about 0.75 torr, which is about 750 micron; 0.1 mbar is about 75 micron; 0.01 mbar is about 7.5 micron; and 0.001 mbar is about 0.75 micron. A single-stage rotary-vane pump in good condition with fresh oil will reach the low tens of micron at the pump; a two-stage pump will reach the single digits or below. What you get at the boiling flask is always worse than what the pump can do, because every fitting, every length of hose, every bend and the conductance of the glassware itself costs you, and because anything volatile still dissolved in the charge is actively fighting the pump. This is why the gauge belongs as close to the still head as practical rather than at the pump inlet: a gauge at the pump reports the pump, not the process. Each decade of additional vacuum lowers the required vapour temperature further, sharpens the separation between adjacent fractions because relative volatility differences become easier to exploit at lower temperature, and shortens the time the material spends hot. The diminishing return is real but the direction never reverses: deeper is better, always, for product quality.',
        table: F({
          cols: F(['Pressure', 'In torr', 'In micron', 'What it is good for']),
          rows: F([
            F(['1013 mbar', '760', '760000', 'atmospheric — degrades cannabinoids before they boil, not usable']),
            F(['10 mbar', '7.5', '7500', 'stripping bulk solvent and water from the charge']),
            F(['1 mbar', '0.75', '750', 'terpene and volatile fraction; a marginal, hot cannabinoid pass']),
            F(['0.1 mbar', '0.075', '75', 'workable cannabinoid body cut; the practical floor for a well-plumbed single-stage setup']),
            F(['0.01 mbar', '0.0075', '7.5', 'good cannabinoid distillation; lower jacket temperature, better colour']),
            F(['0.001 mbar', '0.00075', '0.75', 'excellent; approaching the regime where mean free path matters and short-path geometry earns its name']),
          ]),
        }),
        cites: F(['perry2019', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'The apparatus, part by part',
        body: 'Every component of a short-path train has one job, and knowing which job it has is what lets you diagnose a bad run instead of guessing. The defining feature of the geometry is in the name: the distance from the evaporating surface to the condensing surface is short, so a molecule that leaves the liquid has a high probability of reaching the condenser without colliding its way back, and the pressure drop across the path is small enough that the deep vacuum you paid for actually exists at the boiling surface.',
        table: F({
          cols: F(['Part', 'What it does', 'How it is got wrong']),
          rows: F([
            F(['Boiling flask', 'holds the charge; its shape and fill level set the evaporating surface area', 'overfilled past about half its volume, which promotes bumping and carry-over of undistilled crude into the head']),
            F(['Heating mantle', 'supplies the heat of vaporisation through the flask wall', 'treated as the control variable; run open-loop; or left in place around a flask that has lost vacuum']),
            F(['Thermocouple / vapour probe', 'reports the temperature of the vapour entering the head', 'placed in the mantle, in the oil, or against the glass instead of in the vapour stream at the head — see below']),
            F(['Short-path head', 'gives the vapour the shortest possible route to the condenser at minimum pressure drop', 'wrapped in so much insulation that fractions cannot be distinguished, or left bare so the target fraction condenses in the head and refluxes back']),
            F(['Condenser', 'removes the heat of condensation so vapour becomes liquid', 'run too cold, so the fraction freezes and plugs the path; or too warm, so vapour passes uncondensed into the cold trap and the pump']),
            F(['Cow / receiving flasks', 'lets you swap receivers without breaking vacuum, so fractions are collected separately', 'rotated late, so a heads fraction is banked into the body cut']),
            F(['Cold trap', 'condenses everything that got past the condenser before it reaches the pump', 'run without coolant, or allowed to fill; a wet trap is how pump oil dies and how vacuum quietly degrades mid-run']),
            F(['Vacuum pump', 'establishes and maintains the pressure regime', 'undersized, run on contaminated oil, or plumbed through long narrow hose that throttles it']),
            F(['Vacuum gauge', 'tells you the pressure at the process', 'installed at the pump rather than near the head, so it reports a number you cannot act on']),
          ]),
        }),
        cites: F(['perry2019', 'tradepractice', 'armarego2017']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Why vapour temperature is the control variable',
        body: 'The mantle temperature tells you what the heater is doing. The vapour temperature at the head tells you what is distilling. Those are different facts and only the second one is actionable. The heat path runs mantle to glass to liquid to vapour, and each step has a lag and a gradient, so at any moment the mantle is substantially hotter than the bulk liquid and the bulk liquid is hotter than the vapour arriving at the head. A processor who drives mantle setpoint to a number read off someone else’s run is controlling the wrong end of the system: the same mantle setpoint on a different flask, a different fill level, a different vacuum or a different crude produces a completely different cut. The vapour probe must sit in the vapour stream at the head, below the point where the vapour turns toward the condenser, so it reads the temperature of what is actually passing. Run the process by watching that number stabilise, plateau and then climb: a plateau means a fraction is coming over at a consistent composition, and a climb means that fraction is exhausted and the next, heavier one is beginning. The mantle is then adjusted to sustain a steady rate of take-off rather than to hit a temperature.',
        bullets: F([
          'Plateau in vapour temperature means a fraction is running; a rise means the fraction is ending.',
          'Two runs at identical mantle setpoints can produce entirely different products; two runs at identical vapour temperature and vacuum will not.',
          'Rate of take-off, not temperature, is what you actually trim with the mantle.',
        ]),
        cites: F(['perry2019', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'The fraction cuts, in order',
        body: 'A short-path run is a sequence of cuts taken in ascending order of boiling point. What follows is the order in which they arrive and what is chemically in each. The cut points are decided by watching the vapour temperature and the appearance of the distillate, not by a clock, and they shift with vacuum depth and with the crude.',
        table: F({
          cols: F(['Cut', 'Roughly when', 'What is in it', 'What to do with it']),
          rows: F([
            F(['Residual solvent and water', 'first, at the lowest vapour temperature, often while still pulling down', 'ethanol, hydrocarbon or CO2 co-solvent left from extraction, plus water carried in the crude', 'discard or reclaim as solvent; never bank it into a product. Its presence means the feed was not properly degassed']),
            F(['Terpene / volatile fraction', 'next, low vapour temperature', 'monoterpenes and the lighter sesquiterpenes, aldehydes and esters — the aroma', 'collect deliberately and keep it: see terpene-recovery. If you do not take it as a cut it ends up in your cold trap or your pump oil']),
            F(['Heads', 'immediately before the body', 'heavier sesquiterpenes, small oxidised and low-molecular-weight material, the last of the volatiles, often a sharp or acrid smell', 'keep separate. It is the fraction that most damages the taste and clarity of a body cut if it is allowed to blend in']),
            F(['Main cannabinoid body', 'the long plateau, at the highest vacuum you can hold', 'the cannabinoids themselves — in a hemp crude predominantly CBD with CBC, CBG and minors, and whatever THC the input carried', 'this is the product. Collect it as one or more sub-cuts if you want to bank the palest portion separately']),
            F(['Tails', 'as vapour temperature climbs past the body plateau', 'the heaviest distillable cannabinoids and degradation products, CBN enriched, darker', 'keep separate and account for it. It can be re-run but the heat history carries forward']),
            F(['Residue', 'never distils', 'polymerised material, pigments, sterols, remaining waxes, inorganics, anything charred', 'waste. Its volume and colour are a direct readout of how hard the crude and the run were']),
          ]),
        }),
        cites: F(['perry2019', 'tradepractice', 'namdar2018']),
        evidence: 'industry practice',
      }),
      F({
        h: 'First pass versus second pass',
        body: 'A first pass on properly prepared feed does the bulk of the work: it separates the cannabinoid body from the volatiles below it and from the pigments, sterols and polymerised material above and outside it. What it does not do reliably is deliver colour. A first-pass distillate from good feed is usually amber to light gold; from mediocre feed it is dark. A second pass, run on the collected body cut alone, buys three specific things: colour, because the small quantity of coloured and coloured-precursor material that survived the first pass is left behind; potency, typically a few percentage points of total cannabinoids, because the remaining non-cannabinoid mass is removed; and the last of the volatiles and heads material, which is what actually fixes taste. What a second pass does not buy is a rescue for bad feed. Every pass adds heat history, and heat history is cumulative and irreversible, so a crude that needs three passes to look acceptable has been degraded three times to get there and its Δ8 and CBN numbers will say so. The correct response to a dark first pass is almost always to fix the upstream step — better winterization, a harder polish, a carbon or bentonite treatment of the crude, cleaner extraction — rather than to distil the same material again.',
        bullets: F([
          'Pass one: bulk separation. Pass two: colour, a few points of potency, and taste.',
          'Colour remediation belongs upstream, in winterization and polishing, not in a third distillation pass.',
          'Each pass is another full thermal exposure of the entire body cut.',
        ]),
        cites: F(['tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Realistic potency outcomes',
        body: 'A well-run pass on crude that has been correctly decarboxylated and winterized typically lands in the high-80s to mid-90s percent total cannabinoids by mass, and a clean second pass on a good first-pass body cut can sit in the mid-90s. Those numbers are achievable and ordinary; they are not remarkable. The honest caveat is that input quality dominates the outcome far more than technique does. Feed that was extracted from poorly stored or poorly dried biomass, feed that was not fully decarboxylated, feed that still carries wax because winterization was rushed, and feed with residual solvent in it all cap the achievable potency and colour regardless of how well the still is run, because the non-cannabinoid mass either distils with the target, stays behind and holds product with it, or degrades and colours the distillate. The corollary is that a potency number quoted without the input specification tells you nothing about the process. The honest way to report a distillation is input assay, output assay, mass balance and the degradation markers, together.',
        cites: F(['tradepractice']),
        contested: true,
        caveat: 'Single-figure potency claims for short-path output vary widely across the trade and are usually quoted without the input assay, the number of passes or the mass balance. The high-80s to mid-90s band reflects ordinary competent practice on good decarboxylated, winterized feed; it is not a specification and it is not achievable from poor feed at any skill level.',
        evidence: 'industry practice',
      }),
      F({
        h: 'Thermal degradation management: total heat history, not peak temperature',
        body: 'The single most useful idea in cannabinoid distillation is that degradation is driven by the integral of temperature over time, not by the peak temperature reached. Ten minutes at 170 °C can cost less product than four hours at 140 °C. That reframes every decision on the still: fill level, because a deeper charge takes longer to work through; vacuum depth, because deeper vacuum means lower temperature for the same rate; rate of take-off, because a slow run is a long run; pass count, because each pass re-exposes the whole cut; and whether to hold a finished flask hot while you deal with something else, because that is heat history with no separation being achieved in exchange. Two degradation markers will appear on the COA and both are diagnostic. Δ8-THC, or in a CBD-dominant material other isomerisation products, indicates acid- or heat-driven rearrangement — an isomer that was not in the plant appearing in the product is a process readout. CBN indicates oxidation of Δ9-THC, and it accumulates with heat, with time and with exposure to air and light; the storage literature going back to Fairbairn and colleagues established the same progression in stored cannabis and preparations, and Trofin and colleagues followed it in oils over long-term storage. If your product shows CBN that the feed assay did not, your process oxidised it. Limiting both markers is the same short list every time.',
        bullets: F([
          'Lower the temperature by deepening the vacuum before you raise the temperature to hit a rate.',
          'Shorten residence: smaller charges, steady take-off, do not hold a hot flask idle.',
          'Degas the feed properly before the body cut so you are not fighting volatiles at temperature.',
          'Exclude air. Oxidation to CBN needs oxygen; a leak is both a vacuum problem and a chemistry problem.',
          'Do not blend tails back into a fresh pass without accounting for it — you are importing an existing degradation history into a clean batch and it will show on the COA as CBN and colour.',
          'Assay input and output and keep the mass balance. Degradation you do not measure is degradation you will ship.',
        ]),
        cites: F(['fairbairn1976', 'trofin2012', 'perrotinbrunel2011', 'tradepractice']),
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'Vacuum distillation hazards are mechanical and thermal rather than chemical, and they are entirely manageable by a person who was taught them as part of learning the operation. Evacuated glassware stores no energy in the way a pressure vessel does, but it fails inward, and a flask that implodes under vacuum while holding two litres of 160 °C oil produces a spray of hot product and glass. Inspect every piece of glass before it goes under vacuum, in good light, for star cracks, scratches, chips at the joints and any cloudiness or strain mark; a star crack is a radiating set of fine lines from a point of impact and it is the classic precursor to an implosion. Retire damaged glass rather than using it one more time. Never apply vacuum to flat-walled or thin-walled vessels not rated for it. Heating mantles fail closed and can run away, so a mantle is used with a controller and a temperature limit, never bare on a variable transformer and unattended. Hot oil and hot glass cause the majority of actual injuries: heat-resistant gloves, a face shield when breaking a hot joint, and never a hot flask lifted by the neck. If the feed still holds solvent, the first cut is a flammable vapour being pulled through a hot system toward a pump, so solvent stripping happens with ventilation, with the pump exhaust routed out, and with the recognition that a rotary-vane pump exhaust is not a place to put hydrocarbon. Cold traps are a cryogenic hazard: dry ice and slush baths at −78 °C and liquid nitrogen at −196 °C cause contact burns through ordinary gloves in seconds, containers must be vented so they cannot pressurise, and a liquid-nitrogen trap left open to air condenses liquid oxygen, which with organic residue is an oxidiser hazard. Peroxide-forming solvents — diethyl ether, tetrahydrofuran, diisopropyl ether, dioxane — must never be concentrated to dryness anywhere on this equipment: peroxides accumulate in the residue and the residue is where the energy ends up. Finally, every vacuum system needs a defined way to be brought back to atmosphere deliberately, slowly and at a controlled point, so nobody ever vents a hot flask by pulling a hose off.',
        bullets: F([
          'Inspect for star cracks, chips and scratches every time, before vacuum, in good light.',
          'Controller and limit on every mantle; never unattended on a bare transformer.',
          'Face shield and heat gloves for hot joints; never lift a hot flask by the neck.',
          'Route pump exhaust outside; keep flammable first cuts ventilated.',
          'Cryogenic traps: vent the container, never seal it, treat −78 °C and −196 °C as burn hazards, and do not leave a liquid-nitrogen trap open to air.',
          'Never evaporate a peroxide-forming solvent to dryness.',
          'Have a defined, slow, controlled path back to atmospheric pressure.',
        ]),
        cites: F(['prudent2011', 'kelly1996', 'armarego2017', 'tradepractice']),
      }),
    ]),
    seeAlso: F(['processing/wiped-film', 'processing/decarboxylation', 'processing/winterization', 'processing/terpene-recovery', 'equipment/vacuum', 'equipment/thermal', 'equipment/glassware', 'coa/reading-a-coa', 'cannabinoids/isomers']),
    cites: F(['perry2019', 'gieringer2004', 'tradepractice', 'armarego2017', 'namdar2018', 'fairbairn1976', 'trofin2012', 'perrotinbrunel2011', 'prudent2011', 'kelly1996']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'wiped-film',
    title: 'Wiped-Film and Short-Path Rolled-Film Evaporation',
    kind: 'tool',
    summary: 'The continuous alternative to the batch flask: feed is spread as a thin film on a heated wall, residence time drops from tens of minutes to seconds, and heat history per molecule collapses. What that buys, what it costs, and the volume threshold at which the industry switches.',
    facts: F({
      'Also called': 'wiped-film evaporator (WFE), agitated thin-film evaporator (ATFE), rolled-film, short-path rolled-film',
      'Residence time': 'seconds — typically in the region of 5 to 60 s per pass',
      'Batch flask residence time': 'tens of minutes to hours for the same material',
      'Mode': 'continuous feed, continuous distillate and continuous residue take-off',
      'Typical jacket range': 'similar to short path, roughly 130-190 °C, at similar or deeper vacuum',
      'Switch-over point': 'commonly quoted around the low single-digit kilograms per hour of feed — vendor and operator figures vary',
      'Feed requirement': 'decarboxylated, winterized, degassed and solvent-free before it enters the unit',
    }),
    sections: F([
      F({
        h: 'What changes mechanically',
        body: 'A short-path still heats a static pool of liquid in a flask and waits for the volatile components to leave it. A wiped-film evaporator does the opposite: it feeds liquid continuously onto the inside of a heated cylindrical wall, where a rotating assembly of wiper blades or rollers spreads it into a thin, constantly renewed film and pushes it down the wall as it travels. The film is thin enough — a fraction of a millimetre — that a molecule anywhere in it is close to both the heated surface and the vapour space, so the heat transfer coefficient is high and the diffusion path to the surface is short. Vapour leaves the film, travels a very short distance to an internal condenser, condenses, and runs down to a distillate outlet. Whatever did not evaporate keeps travelling down the wall and leaves as residue at the bottom. Nothing accumulates, nothing sits. The mechanical agitation also means the unit tolerates a viscous, fouling feed that would bake onto a static flask wall, because the wipers are continuously scraping the surface clean.',
        bullets: F([
          'Thin film plus mechanical renewal equals very high heat-transfer coefficient at low temperature difference.',
          'Continuous in, continuous out: two product streams and no batch cycle.',
          'The wipers keep the heated surface clean, which is what allows viscous and fouling feeds.',
        ]),
        cites: F(['perry2019', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Residence time and heat history',
        body: 'This is the whole point. In a batch flask, the last molecule to distil has been sitting at temperature for as long as the run has been going — for a multi-hour pass, that is hours of thermal exposure for material that spends one second actually vaporising. In a wiped-film unit, every molecule experiences essentially the same short exposure, measured in seconds, because the film is moving and being replaced. The integral of temperature over time — the quantity that actually drives isomerisation and oxidation, as set out on short-path-distillation — is therefore smaller by orders of magnitude per unit of product, even though the wall temperature may be the same or slightly higher. The observable consequences are lighter colour at equal potency, lower CBN generation for the same throughput, and a much narrower spread of quality across a production day, since there is no start-of-batch versus end-of-batch difference. The trade is that the separation achieved in a single pass is less sharp than a carefully fractionated batch run, because a wiped-film stage is closer to a single-stage flash than to a fractionating column: you get a clean split between two streams, but you do not get the fine sequence of narrow cuts that a patient operator can take off a cow.',
        bullets: F([
          'Uniform, short thermal exposure for every molecule instead of a distribution running from seconds to hours.',
          'Lighter colour and lower degradation markers at equal potency.',
          'Less sharp fractionation per pass — sequential stages or multiple units are used to get the cuts back.',
        ]),
        cites: F(['perry2019', 'tradepractice', 'fairbairn1976']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Internal condenser geometry',
        body: 'Most cannabinoid wiped-film units place the condenser inside the evaporator body, coaxially, a short distance from the film. The reason is conductance. At the pressures where cannabinoids distil, the vapour is in a regime where the mean free path is long and the flow is not a bulk fluid flow but something closer to free molecular travel, so any length of pipe, any bend and any constriction between the evaporating surface and the condensing surface costs pressure and therefore costs you the temperature advantage you built the vacuum system to get. Putting the condenser two or three centimetres from the film all but eliminates that loss and lets the effective pressure at the evaporating surface approach what the pump can deliver. The same logic is why the short-path flask geometry exists; the wiped-film unit simply takes it further. The engineering consequences are that the internal condenser must be designed so condensate cannot drip back onto the film — otherwise you are running an unintended reflux and destroying your separation — and that the coolant temperature on the internal condenser has to be set high enough that the cannabinoid fraction stays fluid enough to run off, but low enough that it does not pass through to the vacuum system.',
        cites: F(['perry2019', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Throughput and why volume forces the move',
        body: 'Throughput on a wiped-film unit scales with the heated surface area and is quoted per hour rather than per batch, which is the economic difference. Small units used in cannabinoid work are commonly specified at something in the region of 0.5 to 2 kg/h of feed, mid-size units in the several kilograms per hour range, and large industrial thin-film and falling-film trains far beyond that. A short-path batch setup at the scale most small processors own handles a charge of a few litres and takes most of a shift per pass once you include pull-down, fraction changes, cool-down and cleaning, so its effective rate is low and its labour content per kilogram is high. Somewhere in the low single-digit kilograms per hour of sustained demand, the arithmetic flips: the wiped-film unit costs more to buy and to commission, but its output per operator-hour and its consistency across a day make the cost per kilogram lower and the product more saleable to a customer who specifies colour. The exact crossover is a function of local labour cost, how much your market pays for colour and terpene integrity, and how much idle time your batch setup actually has, so it is a calculation each operation does for itself rather than a published constant.',
        cites: F(['tradepractice']),
        contested: true,
        caveat: 'Throughput figures for cannabinoid wiped-film units are vendor specifications quoted against unstated feed compositions, and real sustained rates on winterized cannabinoid crude are frequently well below nameplate. The switch-over volume is an operation-specific economic calculation, not an industry constant. Treat every number in this section as an order-of-magnitude orientation.',
        evidence: 'industry practice',
      }),
      F({
        h: 'The trade-offs, stated honestly',
        body: 'A wiped-film unit is not a better short-path still, it is a different machine with a different failure surface. Capital cost is several times that of a comparable batch setup once the chiller, the vacuum train, the feed pump, the heated feed vessel and the discharge handling are included. There are more variables to tune and they interact: feed rate, wall temperature, wiper speed, internal condenser temperature, vacuum, and the temperature of the feed as it arrives all move the split, and a change in one requires re-trimming the others, so commissioning is a real project rather than an afternoon. The feed must be prepared: decarboxylated, winterized, filtered, and — critically — degassed and solvent-free, because a continuous unit has no patient pull-down phase in which volatiles can be stripped, and solvent-wet feed arriving at a hot wall under deep vacuum flashes, floods the vapour space, carries liquid over into the distillate and can pull the vacuum out from under the whole process. That is why most operations put a dedicated solvent-stripping or devolatilisation stage ahead of the wiped-film stage rather than trying to do both in one unit. Maintenance is also different in kind: wipers wear, seals on a rotating shaft under deep vacuum are a maintenance item and a leak path, and a mechanical seal failure is both a vacuum fault and a contamination route.',
        bullets: F([
          'Higher capital cost, and the ancillaries are a large part of it.',
          'More interacting variables; commissioning is a project, not a setup.',
          'Feed must arrive decarboxylated, winterized, filtered, degassed and dry — a stripping stage upstream is normal.',
          'Rotating-shaft vacuum seals and wiper wear are recurring maintenance and a leak path.',
          'Less forgiving of a mistake: a bad feed ruins a continuous run in seconds rather than over a batch you could have caught.',
        ]),
        cites: F(['tradepractice', 'perry2019']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Short path or wiped film: making the decision',
        body: 'The decision is mostly about volume, with product positioning and staffing as the secondary terms. The table gives the axes as they actually bite.',
        table: F({
          cols: F(['Axis', 'Short-path batch', 'Wiped film']),
          rows: F([
            F(['Mode', 'batch — charge, run, cut, cool, clean', 'continuous — feed in, two streams out']),
            F(['Residence time', 'tens of minutes to hours', 'seconds']),
            F(['Heat history per molecule', 'wide distribution, worst case is the whole run', 'narrow and short, near-identical for all material']),
            F(['Fractionation sharpness in one pass', 'high — narrow sequential cuts are possible', 'lower — a clean two-way split per stage']),
            F(['Throughput', 'low; labour-heavy per kilogram', 'high; scales with heated area']),
            F(['Capital cost', 'low to moderate', 'high, with substantial ancillaries']),
            F(['Tolerance of imperfect feed', 'moderate — you can strip volatiles during pull-down', 'low — feed must be dry and degassed before it enters']),
            F(['Operator skill profile', 'judgement during the run, fraction by fraction', 'setup and control discipline, then steady-state monitoring']),
            F(['Best fit', 'R and D, small batches, minor-cannabinoid work, many small distinct lots', 'sustained production of one or two specifications, colour-sensitive markets']),
          ]),
        }),
        cites: F(['tradepractice', 'perry2019']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'A wiped-film unit adds rotating machinery and a hot, pressurised-thermal-fluid circuit to the vacuum and thermal hazards already described for short-path work, and it removes the glass. Interlock the drive so the wiper assembly cannot be energised with the unit open, and treat the shaft coupling and any inspection port as a machine-guarding question. The heating jacket is usually served by a hot-oil circulator running at up to about 200 °C: that circuit has its own expansion, relief and leak hazards, hot oil causes severe burns, and an oil leak onto a hot surface is a fire. Thermal-fluid hoses and fittings are a consumable, not permanent fixtures. Because the unit is continuous, an upset develops while material is still being fed, so the feed pump needs to be interruptible from where the operator stands, and the control scheme should stop feed on loss of vacuum, loss of coolant or over-temperature rather than relying on someone noticing. Solvent-wet feed is a genuine hazard here and not merely a quality problem: a flash in the vapour space can overpressure a vessel designed for vacuum, so a relief path is required and feed dryness is verified before commissioning a run, not assumed. The vacuum train, the cold trap and the peroxide-forming-solvent prohibition are exactly as set out on short-path-distillation and apply unchanged.',
        bullets: F([
          'Interlock the drive; guard the shaft and every port.',
          'Hot-oil circuit at up to about 200 °C — burns, leaks onto hot surfaces, and hoses as consumables.',
          'Feed must be stoppable instantly, and should stop automatically on loss of vacuum, coolant or temperature control.',
          'Verify feed dryness before a run; a flash in a vacuum-rated vessel needs a relief path.',
          'Every vacuum, cold-trap and peroxide rule from short-path work carries over.',
        ]),
        cites: F(['prudent2011', 'nfpa', 'tradepractice']),
      }),
    ]),
    seeAlso: F(['processing/short-path-distillation', 'processing/rotary-evaporation', 'processing/winterization', 'equipment/vacuum', 'equipment/thermal', 'equipment/overview', 'products/viscosity-and-cbt']),
    cites: F(['perry2019', 'tradepractice', 'fairbairn1976', 'prudent2011', 'nfpa']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'rotary-evaporation',
    title: 'Rotary Evaporation and Solvent Recovery',
    kind: 'tool',
    summary: 'Solvent recovery treated as its own discipline rather than as a chore: the bath, vapour and condenser temperature relationship and the delta-20 rule, controlled vacuum ramps, fill fraction and rotation, why bumping happens and what it costs, recovery percentage as the economic driver, and the hard limit of what a rotovap can and cannot remove.',
    facts: F({
      'What it does': 'removes bulk solvent from a solution by evaporating it from a thin, continuously renewed film on a rotating flask under reduced pressure',
      'The rule of thumb': 'delta 20 — bath 20 °C above the solvent boiling point at the working vacuum, condenser 20 °C below it',
      'Ethanol boiling point at 1013 mbar': 'about 78.4 °C',
      'Ethanol boiling point at 178 mbar': 'about 40 °C',
      'Typical flask fill': 'one third to one half of nominal volume, never more',
      'Recovery target': '90 percent and up; a falling-film unit at production scale targets 95 percent and better',
      'What it does NOT do': 'bring residual solvent to a specification — that is a vacuum oven and a residual-solvent panel',
    }),
    sections: F([
      F({
        h: 'What a rotovap is for, and what it is not for',
        body: 'A rotary evaporator exists to take a large volume of solvent away from a small quantity of dissolved material quickly and gently, and to get most of that solvent back in a condition where it can be reused. It does this with three tricks at once. It reduces the pressure, so the solvent boils at a temperature the solute can tolerate. It rotates the flask, which spreads the liquid as a thin film over a large area of heated glass and continuously renews that film, so heat transfer is fast and there is no static superheated layer. And it condenses the vapour immediately into a separate receiving flask, so the solvent is recovered rather than exhausted. In a cannabinoid plant the rotovap sits after winterization, after a tincture or ethanol extraction, and after any chromatography or crystallisation step that left product in solvent. What it is not is a purification step for residual solvent. It removes solvent in bulk down to the point where the remaining solvent is held by the product rather than pooled in it, and then it effectively stops. Getting from there to a residual-solvent specification is a different operation with different equipment.',
        cites: F(['armarego2017', 'perry2019', 'tradepractice']),
      }),
      F({
        h: 'The three temperatures, and the delta-20 rule',
        body: 'A rotovap is controlled by three temperatures and one pressure, and the relationship between them is the whole craft. The bath temperature supplies the heat of vaporisation. The vapour temperature is the temperature at which the solvent is actually boiling, which is set by the pressure, not by the bath. The condenser temperature must be low enough to condense that vapour completely. The standard heuristic — often called the delta-20 rule or the 20-40-60 rule — sets the working vacuum so that the solvent boils at around 40 °C, puts the bath at about 20 °C above that boiling point, and keeps the coolant at about 20 °C below it. For ethanol that is a bath near 60 °C, a working pressure that puts the boiling point near 40 °C, and a chiller at about 20 °C or lower. The 20 °C driving force on the bath side gives a usable evaporation rate without making the glass wall hot enough to damage a thermally sensitive solute; the 20 °C margin on the condenser side gives enough capacity that vapour does not slip past the condenser, because vapour that is not condensed is solvent you do not recover, solvent in your vacuum pump, and a vacuum reading that will not hold. A useful diagnostic follows from this: if the vapour temperature reading rises toward the bath temperature, the flask is running dry and the solvent is gone; if the condensation ring creeps up the condenser toward the top, the condenser is at its capacity and you are losing vapour to the pump.',
        bullets: F([
          'Pressure sets the boiling point. The bath only sets the rate.',
          'Bath about 20 °C above the boiling point at working vacuum; condenser about 20 °C below it.',
          'Watch where the condensation ring sits: creeping upward means the condenser is overloaded.',
          'Vapour temperature climbing toward bath temperature means the flask has run dry.',
        ]),
        cites: F(['armarego2017', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Boiling point against pressure for ethanol',
        body: 'The relationship a processor actually needs at the panel is the boiling point of their solvent at the pressure they are working at. The figures below are calculated from standard Antoine coefficients for ethanol and rounded; they are approximate and will differ by a degree or two between sources and with water content, which matters because an ethanol-water mixture does not behave like anhydrous ethanol and an azeotrope near 95 percent ethanol by volume sets a floor on what simple evaporation will concentrate to. Build the same table for any other solvent you run — pentane, heptane, and hydrocarbon blends all have their own curve and the delta-20 arithmetic is done against the curve, not against the atmospheric boiling point.',
        table: F({
          cols: F(['Pressure', 'In torr', 'Ethanol boils at about', 'Bath for delta 20', 'Condenser for delta 20']),
          rows: F([
            F(['1013 mbar', '760', '78 °C', '98 °C', '58 °C']),
            F(['467 mbar', '350', '60 °C', '80 °C', '40 °C']),
            F(['294 mbar', '220', '50 °C', '70 °C', '30 °C']),
            F(['178 mbar', '134', '40 °C', '60 °C', '20 °C']),
            F(['104 mbar', '78', '30 °C', '50 °C', '10 °C']),
            F(['58 mbar', '44', '20 °C', '40 °C', '0 °C']),
          ]),
        }),
        cites: F(['armarego2017', 'perry2019']),
        contested: true,
        caveat: 'These values are computed from published Antoine coefficients for pure ethanol and rounded to the nearest degree; tabulated values differ slightly between sources and the presence of water shifts the curve and introduces the ethanol-water azeotrope, so treat the table as a working guide and verify against your own gauge and thermometer.',
      }),
      F({
        h: 'Vacuum control: why a ramp beats slamming to full vacuum',
        body: 'Pulling full vacuum the moment the flask is on is the most common beginner error and it has three separate costs. First, it drops the boiling point below the bath temperature by a wide margin all at once, so the entire surface of a large volume of solvent flashes simultaneously and the flask foams over into the vapour duct. Second, it entrains liquid as fine droplets which travel up the duct and are collected in the receiving flask, so the product you were concentrating is now in your recovered solvent. Third, on a volatile solvent, the sudden latent-heat demand chills the liquid sharply and evaporation then stalls until the bath catches up, which is slower overall than a controlled ramp would have been. The correct approach is to bring the pressure down progressively — either with a manual needle valve trimmed by hand or, better, with a vacuum controller working to a setpoint or to a boiling-point-detection mode — so that the solvent establishes a steady, controlled boil and stays there. Production-scale practice makes the same point differently: at real volumes a rotovap is replaced by a falling-film evaporator, which is a continuous device with the ramp problem designed out, feeding steadily rather than charging a batch.',
        bullets: F([
          'Ramp with a needle valve or a controller; never slam to base pressure on a full flask.',
          'Foam-over and droplet entrainment both put your product in the recovered solvent.',
          'A vacuum controller holding a setpoint is the single best upgrade to a manual rotovap.',
          'Above a certain volume the answer is a falling-film evaporator, not a bigger rotovap.',
        ]),
        cites: F(['armarego2017', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Fill fraction and rotation speed',
        body: 'Fill the flask between about one third and one half of its nominal volume and no more. The headspace is not wasted space, it is the disengagement volume that lets foam collapse and droplets fall back before they reach the vapour duct, and an overfilled flask removes exactly that margin. Rotation speed sets the film: too slow and the liquid sits as a pool at the bottom with a small, static, superheated contact area; too fast and on a viscous charge the liquid climbs the wall, thins to the point where it stops wetting properly, and the drive works against a badly balanced load. A moderate speed that keeps a visible, continuously renewed film over the submerged portion of the wall is what you are looking for, and for most flask sizes and viscosities that is somewhere in the range of roughly 100 to 200 rpm, trimmed by eye. Rotation matters most on viscous, concentrated charges, which is precisely the end of the run where bumping is most likely and where a static pool would scorch, so as the charge concentrates it is normal to lift the rotation rather than lower it.',
        cites: F(['armarego2017', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Bumping: what it is, why it happens, what it costs',
        body: 'Bumping is a sudden, violent, localised boil that throws liquid up the vapour duct instead of vapour. Its cause is superheating combined with nucleation delay: for a liquid to boil, a vapour bubble has to form, and bubble formation needs a nucleation site — a scratch, a dust particle, a dissolved gas pocket, a boiling stone. Smooth, clean glass under vacuum with a degassed liquid can be heated past the temperature at which it should boil without boiling at all, storing that superheat in the liquid. When nucleation finally occurs somewhere, the entire superheat is discharged at once and a large volume of vapour is generated in a fraction of a second. Under vacuum the pressure gradient carries the resulting slug of liquid straight up the duct. What it costs is immediate and expensive: product is thrown into the vapour path, into the condenser and into the receiving flask, contaminating recovered solvent that you intended to reuse; the batch has to be reconciled or written off; and if the material reaches the vacuum pump it contaminates the oil and degrades the pump. On a concentrated cannabinoid charge it also means a sticky, viscous deposit in the duct and condenser that is unpleasant and slow to clean. Prevention is a short list and all of it is routine. Keep the pressure ramp controlled so the liquid never gets far ahead of its boiling point. Keep the flask rotating, because rotation both renews the film and provides continuous mechanical nucleation. Keep the bath driving force modest — the delta-20 figure exists partly for this reason. Do not overfill. And watch the flask, particularly in the last third of the run when the charge has concentrated, its viscosity has risen, its boiling point has risen with it, and the temptation to raise the bath is strongest.',
        bullets: F([
          'Cause: superheat plus absence of nucleation sites, discharged all at once.',
          'Cost: product in the recovered solvent, a ruined mass balance, a contaminated condenser, and pump-oil damage.',
          'Prevention: controlled ramp, keep it rotating, modest bath driving force, fill to a half at most, and watch the concentrated end of the run.',
          'Never chase a stalled evaporation by raising the bath — deepen the vacuum instead.',
        ]),
        cites: F(['armarego2017', 'prudent2011', 'tradepractice']),
      }),
      F({
        h: 'Recovery percentage as an economic driver',
        body: 'In an ethanol plant the solvent is one of the largest recurring costs, and it is consumed at a ratio measured in litres per kilogram of biomass for extraction and again at 5 to 10 litres per kilogram of crude for winterization. Every point of recovery is therefore money. Recovery losses have identifiable causes and each one is addressable: vapour passing an overloaded or under-chilled condenser; leaks on joints, seals and the bump trap, which both cost vacuum and let vapour out; solvent left behind in the product because the run was stopped early; solvent left wetting the vessel walls and transfer lines; and vapour lost through the pump exhaust, which on a rotary-vane pump also means solvent in the oil. Measuring recovery honestly requires weighing or metering the solvent in and the solvent out on every batch rather than estimating, because a recovery number nobody measures is always better in conversation than it is in the ledger. At production volumes the same argument is what justifies a falling-film evaporator with an efficient condenser and a heat-recovery loop over a bank of rotovaps: it is bought to recover solvent, and the throughput is a side benefit.',
        cites: F(['tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'The limit of a rotovap: bulk solvent is not residual solvent',
        body: 'A rotovap removes solvent that is present as a bulk liquid phase. It does not remove the last fraction of a percent that is dissolved in, adsorbed onto, or occluded within a viscous product, because that solvent is no longer boiling out of a film — it has to diffuse through a thick, viscous, increasingly solvent-starved matrix, and the diffusion is slow at any temperature the product tolerates. This is why a batch can come off a rotovap apparently dry and still fail a residual-solvent panel by a wide margin. The operations that close that gap are a vacuum oven — thin the product out, hold it at a modest temperature under deep vacuum for hours, with a large surface-to-volume ratio so diffusion distances are short — or a purpose-built devolatilisation stage, and in the case of crystallised material a proper cold-solvent wash of the cake followed by vacuum drying. The specification you are working to comes from the residual-solvent frameworks: ICH Q3C classes solvents by toxic potential and sets permitted daily exposures, and USP General Chapter 467 is the compendial method and limit framework that laboratories work from. Class 1 solvents such as benzene are to be avoided outright, Class 2 solvents including hexane and methanol are limited to low parts-per-million figures, and Class 3 solvents such as ethanol, pentane and heptane carry much more generous limits. The practical consequence for a processor is that the solvent you choose upstream determines how hard this step is, and that the panel is the arbiter — not the appearance of the product and not how long it sat in the oven. Formulation/residual-solvent covers the limits, the panel and the arithmetic in full.',
        bullets: F([
          'Bulk solvent removal and residual-solvent specification are two different operations.',
          'The last fraction of a percent is a diffusion problem: thin films, long holds, deep vacuum.',
          'ICH Q3C classes and USP General Chapter 467 are the frameworks the panel is run against.',
          'Solvent choice upstream sets the difficulty of this step downstream.',
        ]),
        cites: F(['ichq3c', 'usp467', 'tradepractice']),
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'Rotary evaporation combines evacuated glassware, a heated bath and a volume of flammable solvent vapour, and each of the three has a specific discipline. Inspect every flask and the condenser before each use for star cracks, chips at the joints and scratches, in good light, and retire damaged glass; a round-bottom flask under vacuum with a hot solvent charge fails inward and sprays. Use flask clips or a keck clip on every joint — a flask that drops off a rotating drive into a hot bath is a common and entirely avoidable incident — and never rely on the vacuum alone to hold a flask on. Do not evacuate a flask that is not rated for it, and never a flat-bottomed or Erlenmeyer flask. Hot water baths cause scald burns and, at bath temperatures near or above the boiling point of the solvent in use, the bath itself becomes an ignition-relevant hot surface, so keep the bath temperature as low as the delta-20 arithmetic allows rather than as high as the dial permits. The condenser and the vacuum pump exhaust both handle flammable vapour: route the pump exhaust out of the workspace or into an appropriate scrubber, use a solvent-resistant diaphragm pump where possible rather than a rotary-vane pump that will accumulate solvent in its oil, and do not let recovered solvent accumulate in an open receiving flask in an unventilated room. Bond and ground metal transfer containers when decanting recovered solvent, because static from pouring is a real ignition source at these volumes. Peroxide-forming solvents — diethyl ether, THF, diisopropyl ether, dioxane — must never be taken to dryness on a rotovap; peroxides concentrate in the residue and the residue is where they are most dangerous, and any such solvent should be date-marked, tested and disposed of within its recommended window. Finally, vent to atmosphere deliberately and slowly through a valve at the end of a run, with the flask lifted out of the bath first, rather than by breaking a joint under vacuum.',
        bullets: F([
          'Inspect glass for star cracks and chips before every run; clip every joint.',
          'Keep the bath as cool as delta 20 allows; a hot bath is both a scald and an ignition-relevant surface.',
          'Route the pump exhaust out; prefer a chemically resistant diaphragm pump for solvent duty.',
          'Bond and ground containers when decanting recovered solvent — static is sufficient ignition.',
          'Never take a peroxide-forming solvent to dryness; date-mark and test those solvents.',
          'Lift the flask out of the bath, then vent slowly through a valve.',
        ]),
        cites: F(['prudent2011', 'kelly1996', 'nfpa', 'armarego2017']),
      }),
    ]),
    seeAlso: F(['processing/winterization', 'processing/extraction-methods', 'processing/crystallization', 'formulation/residual-solvent', 'equipment/vacuum', 'equipment/glassware', 'equipment/safety-and-fire']),
    cites: F(['armarego2017', 'perry2019', 'tradepractice', 'ichq3c', 'usp467', 'prudent2011', 'kelly1996', 'nfpa']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'winterization',
    title: 'Winterization',
    kind: 'tool',
    summary: 'Dewaxing crude by differential solubility at low temperature: the ratios, the hold temperatures and times, cold filtration and why letting the filtrate warm undoes the whole operation, the yield loss to expect, and which extraction platforms make it mandatory.',
    facts: F({
      'What it removes': 'plant waxes, cuticular lipids, long-chain fatty acids and esters, phospholipids, some chlorophyll and pigments',
      'Mechanism': 'differential solubility — waxes come out of cold ethanol, cannabinoids stay in',
      'Typical ratio': '1 part crude to 5-10 parts ethanol by volume',
      'Typical hold': '−20 °C to −80 °C for 12-48 hours',
      'Filtration': 'cold, under vacuum, through a filter aid; commonly stepped from about 25 µm down to 1 µm or finer',
      'Typical mass loss': 'often quoted at roughly 10-30 percent of crude mass as removed wax, highly input-dependent',
      'Mandatory after': 'CO2 extraction, almost always; ethanol extraction, usually; hydrocarbon, often reduced or not needed',
    }),
    sections: F([
      F({
        h: 'The purpose',
        body: 'Cannabis and hemp trichomes and cuticle carry a substantial load of waxes and lipids: long-chain fatty acids and their esters, sterols, phospholipids and the cuticular wax layer that protects the plant surface. A non-selective extraction pulls them along with the cannabinoids, and they cause three specific downstream problems. In distillation they raise the residue fraction, foul the flask or the heated wall, hold product in a viscous matrix so it is lost to the residue, and generate colour by degrading at distillation temperature — a waxy feed is the most common reason a first-pass distillate is dark. In a finished product they cause visible cloudiness and a grainy texture, and in a vaporiser cartridge they separate, wick badly and taste of burnt fat. And in a full-spectrum or broad-spectrum oil they dilute the active fraction with mass that nobody is paying for. Winterization is the standard remedy: dissolve the crude in ethanol, chill it hard enough that the waxes are no longer soluble while the cannabinoids still are, and filter the precipitated wax out cold.',
        bullets: F([
          'Clarity and taste in the finished product.',
          'Distillation performance: less residue, less fouling, less product held in the residue, lighter colour.',
          'Removing mass that is neither active nor saleable.',
        ]),
        cites: F(['tradepractice', 'perry2019']),
        evidence: 'industry practice',
      }),
      F({
        h: 'The mechanism: differential solubility',
        body: 'Solubility is temperature-dependent and the dependence is not the same for every solute in the same solvent. Cannabinoids, which are lipophilic but comparatively small and only moderately structured molecules, remain appreciably soluble in ethanol even at −40 °C and below. Plant waxes and long-chain lipids, which are large, saturated, highly ordered molecules that pack readily into a crystalline solid, lose solubility sharply as temperature falls and come out of solution as a flocculent white-to-yellow precipitate. That divergence is the entire separation. It also explains every parameter choice in the operation: the colder you go, the more completely the waxes precipitate and the finer the precipitate becomes; the longer you hold, the closer the system gets to equilibrium and the more completely nucleation and growth finish, giving a precipitate that filters instead of blinding the filter; and the more dilute the solution, the more cleanly the waxes separate from the viscous cannabinoid phase, because a concentrated solution is thick, traps precipitate, and filters badly. Note that this is a solubility separation and nothing else — no reaction occurs, no molecule is changed, and the recovered wax is the plant wax that was always there.',
        cites: F(['tradepractice', 'mullin2001']),
      }),
      F({
        h: 'Parameters: ratio, temperature and time',
        body: 'The working parameters in the trade are a crude-to-ethanol ratio of about 1:5 to 1:10 by volume, held at anywhere from −20 °C to −80 °C for 12 to 48 hours. Those three numbers trade against each other. A higher dilution (nearer 1:10) precipitates more completely and filters far more easily, at the cost of more solvent to buy, chill and recover, and a larger vessel; a tighter ratio nearer 1:5 saves solvent and time on the evaporator but gives a viscous solution, incomplete separation and a slow, blinding filtration. A colder hold is more complete and faster to reach an acceptable endpoint: at −20 °C, achievable in an ordinary laboratory freezer, an overnight to 48-hour hold is typical; at −40 °C to −80 °C, requiring a proper low-temperature chiller or freezer, 12 to 24 hours is usually sufficient and the result is more complete. Colder is better and there is a real difference between a −20 °C winterization and a −60 °C one in the clarity of the final product. Some operations run a two-stage cold hold, dropping the temperature in steps to get a coarser first precipitate that filters easily followed by a finer second one. What is not negotiable is that the hold must be long enough for the precipitate to form as a filterable solid rather than a colloidal haze; pulling a flask out of the freezer after two hours and filtering it produces a filtrate that looks clear and goes cloudy in the receiving vessel, because the precipitation was never finished.',
        table: F({
          cols: F(['Hold temperature', 'Typical hold time', 'Completeness', 'Equipment needed']),
          rows: F([
            F(['−10 to −20 °C', '24-48 h', 'partial; fine waxes remain in solution', 'ordinary freezer']),
            F(['−30 to −40 °C', '12-24 h', 'good', 'low-temperature freezer or recirculating chiller']),
            F(['−60 to −80 °C', '12-24 h', 'most complete; finest precipitate, hardest filtration', 'ultra-low freezer, dry-ice/ethanol bath, or cascade chiller']),
          ]),
        }),
        cites: F(['tradepractice', 'mullin2001']),
        contested: true,
        caveat: 'Winterization parameters are trade practice with no controlled published optimum for cannabis crude. Published and vendor-recommended ratios range from about 1:3 to 1:20, temperatures from −10 °C to −80 °C, and hold times from a few hours to several days, and the right combination depends on the wax load of the specific input, which depends on the extraction platform, the plant part and the cultivar. Establish your own by running a ratio-and-temperature matrix and judging on filtrate clarity after a warm-back test plus final product appearance, not by adopting a number.',
        evidence: 'industry practice',
      }),
      F({
        h: 'Filtration, and why it must stay cold',
        body: 'The filtration is where winterizations are won and lost. It is done under vacuum, through a Buchner funnel or a filter plate at laboratory scale and through a jacketed filter housing, plate-and-frame press or filter dryer at production scale. A filter aid — diatomaceous earth is the standard, sometimes with bentonite or activated carbon added when colour removal is also wanted — is used as a pre-coat bed on the medium and often also as a body feed mixed into the solution, because the precipitated wax is compressible and gelatinous and on its own it blinds a filter almost immediately; the rigid particles of the filter aid keep the cake permeable so flow continues. Media are normally stepped: a coarse pass in the region of 25 µm or above to take the bulk, then progressively finer passes at around 5 µm, 1 µm and sometimes 0.45 µm to catch the fines. The absolute requirement is that everything stays cold through the whole filtration. The waxes are only insoluble because they are cold; as soon as the solution warms toward ambient, the finer precipitate redissolves, passes straight through the filter, and reappears in the product when it is concentrated. In practice that means chilling the funnel, the receiving flask, the filter aid and the solvent used for rinsing, working quickly, keeping the vessel in a bath or a cold room rather than on a bench, and never leaving a part-finished filtration standing. A useful check on whether the operation worked is a warm-back test: take a sample of the filtrate, let it come to room temperature, and look for haze forming. If it hazes, the filtration was warm, incomplete or too coarse, and the material needs to go back.',
        bullets: F([
          'Vacuum filtration with a filter-aid pre-coat and often a body feed; the wax alone will blind any medium.',
          'Step the media coarse to fine rather than trying to do it in one pass.',
          'Pre-chill the funnel, the receiver, the filter aid and the rinse solvent.',
          'Warming during filtration redissolves the fines and silently undoes the work.',
          'Warm-back test on the filtrate is the honest check.',
        ]),
        cites: F(['tradepractice', 'perry2019', 'mullin2001']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Yield loss, and how to read it',
        body: 'Winterization removes mass, and some of what it removes is product. The removed wax fraction from a CO2 or ethanol crude is often quoted in the region of 10 to 30 percent of crude mass, and a small further loss comes from cannabinoids occluded in the wax cake and from product held in the filter aid and the wetted equipment. That loss is not a failure, it is the operation working: the wax was never saleable and it would have been lost to the distillation residue anyway, usually taking more product with it. What matters is measuring it honestly. Weigh the crude in, weigh the recovered oil out after solvent removal, assay both, and keep a cannabinoid mass balance rather than a mass-only one — because a 25 percent mass loss with no cannabinoid loss is an excellent winterization, and a 12 percent mass loss with 8 percent of the cannabinoids gone into the cake is a bad one. Washing the cake with a small volume of cold ethanol recovers most of the occluded cannabinoid and is worth doing at any scale. The other quantity worth tracking is the apparent potency increase: removing non-active mass raises the assayed percentage of the remaining oil, and an operation that reports that increase as if it were a purification achievement rather than the arithmetic of removing wax is misreporting.',
        cites: F(['tradepractice']),
        contested: true,
        caveat: 'The 10-30 percent figure is trade experience across mixed inputs, not a measured constant. Wax load varies enormously with plant part (trim and leaf carry far more cuticular wax than flower), cultivar, cure and extraction platform, so a specific operation should determine its own figure and track it as a process-control metric.',
        evidence: 'industry practice',
      }),
      F({
        h: 'Solvent removal, and what comes next',
        body: 'The filtrate is a dilute cannabinoid solution in ethanol, and the next operation is solvent recovery — a rotary evaporator at small scale, a falling-film evaporator at production scale, both covered on rotary-evaporation. The important point at the interface is that the winterized oil coming off the evaporator is not residual-solvent compliant and is not distillation-ready in that state. Ethanol retained in a viscous oil will flash in a distillation flask or, worse, in a wiped-film unit, so a deliberate devolatilisation step — a vacuum oven hold, or a low-temperature solvent-stripping pass on the still before the terpene cut — comes between winterization and the cannabinoid body cut. The standard sequence for a CO2 or ethanol crude going to distillate is therefore: extract, decarboxylate (order can vary), winterize, filter cold, recover solvent, devolatilise, then distil. Operations that skip the devolatilisation step diagnose it later as a vacuum problem they cannot hold, when it is actually solvent boiling out of the charge.',
        bullets: F([
          'Filtrate goes to rotary or falling-film evaporation for bulk solvent recovery.',
          'Winterized oil is not residual-solvent compliant and is not ready for a wiped-film feed.',
          'Devolatilise deliberately before distillation, or spend the run fighting your own vacuum.',
        ]),
        cites: F(['tradepractice', 'ichq3c']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Which platforms make it mandatory',
        body: 'Winterization is a consequence of the extraction platform. CO2-extracted material, particularly from a supercritical run at high density, carries a heavy wax and lipid load and essentially always requires winterization before distillation; the selectivity that makes high-density supercritical CO2 productive is the same non-selectivity that brings the cuticular wax with it. Ethanol-extracted material also generally requires it, warm-ethanol crude emphatically so, and cold-ethanol crude to a lesser degree because the cold extraction already left a large part of the wax in the biomass — which is exactly the point of running ethanol cold, and is a reason to think of cold extraction as a partial winterization performed in advance. Hydrocarbon-extracted material often needs much less and sometimes none, because butane and propane are poor solvents for the polar and the very-long-chain material, and a cold hydrocarbon run on fresh-frozen biomass can produce a crude clean enough to distil directly. Solventless material is not winterized at all in the normal sense; ice-water hash and rosin are mechanically separated resin and there is no solvent solution to chill, though rosin is sometimes cold-filtered or given a cold-ethanol treatment when it is destined for a distillate or an isolate stream rather than sold as a solventless product.',
        table: F({
          cols: F(['Input platform', 'Winterization requirement', 'Why']),
          rows: F([
            F(['Supercritical CO2', 'essentially always', 'high-density CO2 co-extracts cuticular wax and lipids']),
            F(['Subcritical CO2', 'usually, but a lighter load', 'weaker solvent leaves more of the heavy fraction behind']),
            F(['Warm ethanol', 'always, and often twice', 'non-selective; wax plus chlorophyll plus polar plant material']),
            F(['Cold ethanol', 'usually, lighter', 'the cold extraction is itself a partial dewaxing']),
            F(['Hydrocarbon', 'often reduced or unnecessary', 'poor solvent for long-chain and polar material']),
            F(['Solventless', 'not applicable as such', 'mechanical separation; no solution to chill']),
          ]),
        }),
        cites: F(['tradepractice', 'rovetto2017', 'qamar2021']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'Winterization puts a large volume of cold flammable solvent through a vacuum filtration, and each of those three words carries a hazard. Cold: at −40 °C and below, ethanol and dry-ice or cascade-chilled surfaces cause contact cold burns quickly, and cold does not feel as urgent as heat so people tolerate contact for longer — insulated cryogenic-rated gloves, not nitrile alone, and no bare-skin contact with cold metal. A dry-ice and ethanol bath at about −78 °C sublimes CO2 continuously, which displaces air in a low or enclosed space, so it needs ventilation and ideally low-level CO2 monitoring. Flammable: a volume of ethanol several times the volume of crude is being handled, transferred, filtered and evaporated, so the room needs ventilation, ignition-source control, appropriate electrical fittings, bonding and grounding on metal transfer vessels, and correct flammable-liquid storage under the flammable-liquids code. Vacuum: filtration flasks and funnels are evacuated glassware, so the same inspection discipline applies as anywhere else — check for star cracks and chips in good light, use only vacuum-rated vessels, never an Erlenmeyer under vacuum unless it is explicitly rated, and shield or cage large filtration flasks. Add one hazard specific to this step: diatomaceous earth is a respirable dust and crystalline-silica-containing grades are a recognised inhalation hazard, so filter aid is handled with respiratory protection and wetted rather than poured dry into a breathing zone. And handle the spent cake as what it is — a solvent-wet, flammable waste stream that must not be left in an open container in the workspace.',
        bullets: F([
          'Cryogenic-rated gloves; cold burns accumulate without the warning heat gives you.',
          'Dry-ice baths displace air — ventilate, and consider low-level CO2 monitoring.',
          'Large ethanol volumes: ventilation, ignition control, bonding and grounding, code-compliant storage.',
          'Vacuum filtration glassware gets the same star-crack inspection as a distillation flask.',
          'Diatomaceous earth is a respirable dust hazard; wet it, and wear respiratory protection.',
          'The spent filter cake is flammable solvent-wet waste; contain and dispose of it as such.',
        ]),
        cites: F(['prudent2011', 'nfpa', 'osha1910', 'tradepractice']),
      }),
    ]),
    seeAlso: F(['processing/rotary-evaporation', 'processing/extraction-methods', 'processing/short-path-distillation', 'processing/crystallization', 'equipment/glassware', 'equipment/safety-and-fire', 'formulation/residual-solvent']),
    cites: F(['tradepractice', 'perry2019', 'mullin2001', 'ichq3c', 'rovetto2017', 'qamar2021', 'prudent2011', 'nfpa', 'osha1910']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'decarboxylation',
    title: 'Decarboxylation as a Unit Operation',
    kind: 'tool',
    summary: 'The one deliberate chemical change in the processing chain, run as a process: first-order kinetics with a steep temperature dependence, the time/temperature trade and why published curves disagree, how to know when it is finished, the 0.877 arithmetic, and how continued heat turns a finished batch into a CBN product.',
    facts: F({
      'The reactions': 'THCA → Δ9-THC + CO2; CBDA → CBD + CO2; the same for CBGA, CBCA and the other acids',
      'Kinetic order': 'first order in the acid, with a strong Arrhenius temperature dependence',
      'Low-and-slow band': 'roughly 110-120 °C for 60-90 minutes',
      'Hot-and-fast band': 'roughly 140-150 °C for 20-40 minutes',
      'Mass loss on full conversion': 'the carboxyl group leaves as CO2 — about 12.3 percent of the acid mass',
      'Conversion factor': '0.877 — the ratio of the neutral cannabinoid mass to the acid mass',
      'Over-cooking marker': 'CBN rising on the COA',
      'Verification': 'potency assay showing the acid form consumed, not a clock and not a published curve',
    }),
    sections: F([
      F({
        h: 'What the operation is, and what it is not',
        body: 'The plant does not make Δ9-THC or CBD in quantity. It makes their carboxylic acids — THCA, CBDA, CBGA, CBCA and the corresponding varin-chain acids — and those acids are not the molecules that bind CB1 with useful affinity, nor are they what a total-THC calculation is based on. Decarboxylation removes the carboxyl group from the acid, releasing it as carbon dioxide and leaving the neutral cannabinoid. It happens slowly at room temperature over months, faster with light and air, and quickly at process temperatures. As an operation it belongs in the processing chain, not in the chemistry section: the question here is not what the reaction is but where in the process to put it, at what temperature and for how long, and how to prove it finished without over-running it. The reaction chemistry and the structural consequences live on cannabinoids/decarboxylation. What follows is the process. One framing note: decarboxylation is a loss of a carboxyl group from a molecule the plant supplied, and the product is the neutral cannabinoid the plant would have made on its own over time. It is not a conversion of one cannabinoid into a different one, and this shelf carries nothing of that second kind.',
        cites: F(['veress1990', 'wang2016']),
      }),
      F({
        h: 'Where it sits in the process, and why that is a real choice',
        body: 'Decarboxylation can be run on the biomass before extraction, on the crude after extraction, or, for some products, not at all. Decarboxylating the biomass first means a bulkier, slower heat step with more uneven heat transfer through a poorly conducting bed, but it also drives off moisture and avoids putting acid cannabinoids through the extraction; it is common in ethanol and CO2 operations. Decarboxylating the crude is faster, easier to monitor by mass and by assay, and easier to control because a stirred liquid has far more uniform temperature than a bed of flower, and it is the norm ahead of distillation because the still needs a decarboxylated feed regardless: an acid cannabinoid entering a distillation flask decarboxylates there anyway, releasing CO2 that fights the vacuum, foams the charge and carries material into the head. Not decarboxylating at all is the right answer for acid-cannabinoid products — THCA diamonds, CBDA tinctures, raw-cannabinoid formulations — and for anything where the acid form is the specification. The one thing you cannot do is leave it to chance: partial, uncontrolled decarboxylation mid-process is how a batch arrives at the still with an unpredictable CO2 load and a potency number nobody can reconcile.',
        bullets: F([
          'On biomass: simpler workflow, drives off moisture, poor heat uniformity.',
          'On crude: faster, uniform, monitorable, and it is what a distillation feed requires.',
          'Not at all: correct for acid-form products; a deliberate specification, not an omission.',
          'Uncontrolled partial decarboxylation upstream is the failure mode to avoid.',
        ]),
        cites: F(['tradepractice', 'wang2016']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Kinetics: first order, steeply temperature-dependent',
        body: 'The decarboxylation of cannabinoid acids is generally described as first order in the acid concentration, meaning the rate at any instant is proportional to how much acid is left, so conversion follows an exponential approach to completion: each successive half-life removes half of what remains. That has two practical consequences. The first is that the last few percent take disproportionately long — getting from 90 to 99 percent conversion costs about as much time as getting from 0 to 90 percent did — which is why people who stop at a visually plausible endpoint routinely leave several percent of acid in the product. The second is that the rate constant follows the Arrhenius relationship, rising steeply and non-linearly with temperature, so a modest temperature increase buys a large rate increase: raising the temperature by about 10 °C in this region typically multiplies the rate by a factor of roughly two to three. That is the whole basis of the time/temperature trade. Perrotin-Brunel and colleagues modelled the Δ9-THC case and reported kinetic parameters for it; Veress and colleagues characterised the process in open reactors and observed that the apparent kinetics are not cleanly single-step in a real matrix; Citti and colleagues studied CBDA specifically and found its kinetics differ from THCA, which matters for a hemp processor because a curve derived from THCA is not a CBDA curve. The complication that defeats naive modelling is that the same heat also drives the loss reactions — evaporation of the neutral cannabinoid, and oxidation of Δ9-THC toward CBN — so the measured acid-to-neutral conversion curve and the measured total-cannabinoid curve diverge as the run goes on.',
        bullets: F([
          'First order: exponential approach to completion; the last few percent are slow.',
          'Arrhenius: roughly a two- to three-fold rate increase per 10 °C in this region.',
          'THCA and CBDA do not share a curve; a hemp processor needs the CBDA data.',
          'Loss reactions run in parallel, so the optimum is a maximum in yield, not the end of the acid.',
        ]),
        cites: F(['perrotinbrunel2011', 'veress1990', 'citti2018', 'wang2016']),
      }),
      F({
        h: 'The time and temperature curve in practice',
        body: 'The working bands in the trade are a low-and-slow option of roughly 110-120 °C for 60-90 minutes and a hot-and-fast option of roughly 140-150 °C for 20-40 minutes, with a middle ground near 130 °C for 30-60 minutes. Low and slow preserves terpenes better (though most of the monoterpene fraction is lost at any of these temperatures unless it is being captured, which is the argument for taking a terpene cut before decarboxylating) and gives a gentler colour result; hot and fast is dramatically shorter and therefore lower in total oxidative exposure per batch despite the higher peak, which is the same total-heat-history argument that governs distillation. The honest and important caveat is that published decarboxylation curves differ substantially — not by a few minutes, but by factors — because they were measured on different things. Matrix matters: flower, kief, crude oil and a solvent solution behave differently. Moisture matters: water content changes heat transfer and appears to influence the apparent rate. Mass and vessel geometry matter enormously: an oven programme that fully decarboxylates a 200 g thin layer of crude in a tray will leave the centre of a 5 kg charge in a beaker substantially unconverted, because what the oven controller reads is not what the middle of the charge experiences. Agitation matters for the same reason. The practical conclusion is unambiguous: a processor must establish their own curve for their own matrix, mass and vessel, and verify against assay rather than trusting a number from a paper, a forum or this page.',
        table: F({
          cols: F(['Regime', 'Temperature', 'Time', 'What you get', 'What you lose']),
          rows: F([
            F(['Low and slow', '110-120 °C', '60-90 min', 'gentler colour, somewhat better volatile retention', 'long total exposure; the slow tail to full conversion is longest here']),
            F(['Middle', '125-135 °C', '30-60 min', 'the usual compromise for crude ahead of distillation', 'most monoterpenes']),
            F(['Hot and fast', '140-150 °C', '20-40 min', 'shortest total exposure; least time for oxidation to accumulate', 'volatiles almost entirely; tighter control needed to avoid overshoot']),
            F(['Too hot / too long', 'above about 150 °C, or any regime run past the endpoint', 'n/a', 'nothing you wanted', 'Δ9-THC oxidising to CBN, cannabinoid evaporation, darkening']),
          ]),
        }),
        cites: F(['veress1990', 'wang2016', 'citti2018', 'tradepractice']),
        contested: true,
        caveat: 'Published decarboxylation time/temperature curves disagree substantially. Reported optima span roughly 100-160 °C and 10-180 minutes across the literature and the trade, and the disagreement is real rather than sloppy: matrix, moisture, charge mass, vessel geometry, agitation and headspace all shift the curve, and THCA and CBDA differ from each other. Any single curve presented as canonical — including the bands in this table — should be treated as a starting point for your own verification by assay, not as a specification.',
      }),
      F({
        h: 'How to know it is finished',
        body: 'There are three levels of evidence and only the third one is proof. The crudest indicator is the visible evolution of CO2: a decarboxylating crude bubbles and foams as gas leaves, and the cessation of visible bubbling means the bulk of the reaction is done. That is a useful operator cue and it is not an endpoint, because the slow exponential tail produces gas too slowly to see while several percent of acid remains. The second level is mass loss. Full decarboxylation of an acid cannabinoid releases CO2 amounting to about 12.3 percent of the acid mass — 44 mass units of CO2 leaving a THCA molecule of about 358, and similarly for CBDA — so for a crude of known acid content the theoretical mass loss is calculable and a run that has reached it has, to first order, converted. The weakness is that mass loss also includes water and volatilised terpenes and cannabinoids, so on a real crude the number is confounded in both directions and it is a control chart rather than a proof. The third level, and the only one that settles it, is a potency assay of a representative sample showing the acid form consumed to whatever residual level your specification allows, with the neutral form present at the expected stoichiometric quantity and CBN not materially elevated. Sample properly: pull from a mixed, agitated charge, not from the top, because an unstirred vessel is stratified in both temperature and conversion. In a production setting the right pattern is to establish the curve once with time-point sampling and assay, then run to the established time and temperature with periodic verification, rather than assaying every batch to completion or assaying none.',
        bullets: F([
          'Cessation of visible CO2 evolution: an operator cue, never an endpoint.',
          'Mass loss against the roughly 12.3 percent theoretical: a good control chart, confounded by water and volatiles.',
          'Potency assay of the acid form: the only actual proof of conversion.',
          'Sample from a mixed charge — an unstirred vessel is stratified.',
        ]),
        cites: F(['wang2016', 'veress1990', 'tradepractice']),
      }),
      F({
        h: 'The 0.877 factor and total-THC arithmetic',
        body: 'Because the acid loses CO2 when it decarboxylates, one gram of THCA does not become one gram of Δ9-THC. The mass ratio of the neutral cannabinoid to its acid is the ratio of their molecular masses, about 314 to 358, which is approximately 0.877, and the same factor applies to the CBDA-to-CBD pair to a very close approximation. That factor is the basis of the total-THC calculation used in regulation: total THC equals the measured Δ9-THC plus 0.877 times the measured THCA, which answers the question "how much Δ9-THC would this sample contain if it were fully decarboxylated". It is the decarboxylated basis on which the US hemp programme measures compliance, which is why a hemp lot can be compliant as measured and non-compliant as consumed after heating, and why a processor must run their compliance arithmetic on the decarboxylated basis rather than on the as-received Δ9 number. The corollary inside the plant is a mass-balance one: a fully decarboxylated batch weighs less than the acid crude that went in, so a potency percentage that rises after decarboxylation is partly real concentration and partly the denominator shrinking. The full arithmetic, the rounding conventions, the measurement-uncertainty question and the worked examples are on coa/total-thc-math.',
        bullets: F([
          'Total THC = Δ9-THC + 0.877 × THCA. Total CBD = CBD + 0.877 × CBDA.',
          '0.877 is a molecular-mass ratio, not an efficiency factor — it is not a yield.',
          'Regulatory compliance in the US hemp programme is on the decarboxylated basis.',
          'Potency rising across decarboxylation is partly the denominator, not only the numerator.',
        ]),
        cites: F(['usdahemp2021', 'wang2016']),
      }),
      F({
        h: 'Over-decarboxylation: heat past the endpoint makes CBN',
        body: 'The reaction does not stop when the acid is gone, because the heat is still there and Δ9-THC has somewhere else to go. Continued thermal and oxidative exposure converts Δ9-THC to cannabinol by oxidation and aromatisation of the terpene ring, and CBN is the resulting marker. The degradation pathway has been documented since the classical storage-stability work — Fairbairn and colleagues followed the loss of THC and the appearance of CBN in stored cannabis and preparations, and Trofin and colleagues followed the same progression in oils over long-term storage — and the same chemistry runs faster and hotter in a decarboxylation vessel. The practical reading is that a CBN number on a COA is a process-history readout rather than a cultivar property: a sample with CBN materially above what its input carried has been heated, held hot, aerated, or stored badly, and the number tells you which part of your process is running long or hot. This is also why the same reaction is used deliberately: CBN is produced commercially by running exactly this oxidation on purpose, with controlled heat, time and oxygen exposure, on THC-containing material, and products/cbn-production covers it as an intentional operation. The distinction between a CBN product and an over-cooked batch is entirely whether it was specified and controlled. For a processor trying to avoid it, the levers are the familiar ones: stop at the endpoint rather than past it, keep the lowest temperature that reaches the endpoint in an acceptable time, exclude oxygen, and do not hold a finished charge hot while you deal with something else.',
        bullets: F([
          'Δ9-THC oxidises to CBN with continued heat, time and oxygen exposure.',
          'CBN on a COA reports process history, not genetics.',
          'The same reaction, specified and controlled, is how CBN is made deliberately.',
          'Stop at the endpoint; exclude air; never hold a finished charge hot.',
        ]),
        cites: F(['fairbairn1976', 'trofin2012', 'tradepractice']),
      }),
      F({
        h: 'Vacuum decarboxylation, foaming and headspace',
        body: 'Running the decarboxylation under reduced pressure changes three things for the better and one for the worse. It excludes oxygen, which directly suppresses the oxidation pathway to CBN and reduces darkening, and that is the main reason to do it. It removes the evolved CO2 continuously instead of letting it sit over the charge, which by Le Chatelier reasoning favours the forward reaction and in practice shortens the run at a given temperature. And it lets the same conversion be achieved at a lower temperature, because the removal of product gas and the exclusion of oxygen both help. What it makes worse is foaming: CO2 evolving from a viscous liquid under reduced pressure generates a far larger and more persistent foam than it does at atmospheric pressure, and that foam will climb out of the vessel and into the vacuum line if it is given the room. Managing that is straightforward mechanically and it is where most of the practical skill sits. Use a vessel with generous headspace — a third full at most, a quarter is better for the early aggressive phase — and prefer a wide, shallow charge to a deep one, because a shallow layer both foams less and transfers heat far more evenly. Ramp the vacuum rather than applying it fully at once, exactly as on a rotovap, so the initial gas burst is controlled. Stir or rotate, because agitation collapses foam, provides nucleation and eliminates the temperature stratification that otherwise leaves the middle of the charge unconverted. Fit a bump trap or a knock-out pot between the vessel and the vacuum line so that foam that does travel is caught before it reaches anything expensive. And account for the fact that vacuum will also pull off the terpene fraction, so if that fraction is wanted, it is captured in a cold trap ahead of the pump — see terpene-recovery — and not simply exhausted.',
        bullets: F([
          'Vacuum suppresses oxidation to CBN, removes evolved CO2, and lets the same conversion happen cooler.',
          'It also foams much harder: generous headspace, shallow charge, ramped vacuum, agitation, knock-out pot.',
          'Agitation does three jobs at once: foam control, nucleation, and killing temperature stratification.',
          'Vacuum decarboxylation strips the terpene fraction — capture it in a cold trap or lose it.',
        ]),
        cites: F(['tradepractice', 'armarego2017', 'perry2019']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'Decarboxylation is a hot operation that generates gas from a viscous liquid, and the hazards follow from exactly that. The evolved CO2 is a real volume: a kilogram of acid cannabinoid releases on the order of a hundred grams of CO2, which at room conditions is a meaningful volume of asphyxiant gas denser than air, so the vessel must never be sealed and the space must be ventilated — a closed vessel decarboxylating is a pressure vessel with no relief. That is the single most important point on this page from a safety standpoint. Foam-over under vacuum is the second: hot, sticky product travelling up a vacuum line is a burn hazard, a contamination event and, if it reaches a pump, an equipment loss, so a knock-out pot is standard rather than optional. Hot oil and hot glass do the actual injuring: charges at 110-150 °C in a beaker, flask or tray cause immediate deep burns, they do not look hot, and a viscous cannabinoid crude sticks to skin and keeps transferring heat, so heat-resistant gloves, a face shield when handling an open hot vessel, and tongs or a lifter rather than hands are required. Oven and mantle controls fail closed and run away, so a temperature limit and an independent over-temperature cutout are worth having on any vessel that will be left for ninety minutes. If the charge still carries solvent, this operation is where it will come out, in bulk, hot: a decarboxylation step is not a place to discover that the feed was not devolatilised, because a flammable vapour at 140 °C near an oven element is the worst version of that mistake. And the vapour that leaves during the run is not nothing — it is terpenes and volatilised cannabinoid, which is both a product loss and a respiratory exposure, so it is exhausted through extraction or condensed, not released into the room.',
        bullets: F([
          'Never seal a decarboxylating vessel. CO2 evolution in a closed vessel is an unrelieved pressure build.',
          'Ventilate: CO2 is an asphyxiant denser than air.',
          'Knock-out pot on any vacuum decarboxylation; assume foam will travel.',
          'Heat gloves, face shield, mechanical lifting — hot viscous crude sticks and keeps burning.',
          'Independent over-temperature cutout on a long unattended hold.',
          'Devolatilise before decarboxylating; do not discover residual solvent at 140 °C.',
          'Exhaust or condense the vapour — it is product and it is an exposure.',
        ]),
        cites: F(['prudent2011', 'nfpa', 'tradepractice']),
      }),
    ]),
    seeAlso: F(['cannabinoids/decarboxylation', 'coa/total-thc-math', 'products/cbn-production', 'processing/short-path-distillation', 'processing/terpene-recovery', 'equipment/thermal', 'equipment/vacuum']),
    cites: F(['veress1990', 'wang2016', 'citti2018', 'perrotinbrunel2011', 'usdahemp2021', 'fairbairn1976', 'trofin2012', 'tradepractice', 'armarego2017', 'perry2019', 'prudent2011', 'nfpa']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'crystallization',
    title: 'Crystallization and Isolate Production',
    kind: 'tool',
    summary: 'How CBD isolate is actually made: solubility against temperature, supersaturation, solvent systems, seeding to control nucleation and avoid oiling out, the slow-cool versus crash trade and what it does to crystal habit and occluded solvent, filtration, cake washing, vacuum drying to a residual-solvent specification, and why CBD crystallises readily while most minor cannabinoids do not.',
    facts: F({
      'What it achieves': 'purification of one molecule out of a mixture by selective crystal growth',
      'Normal specification for CBD isolate': '98-99.9 percent CBD',
      'Solvent systems described in the trade literature': 'pentane, heptane, and pentane/ethanol mixtures',
      'Feed requirement': 'high-purity distillate — crystallisation refines a good distillate, it does not rescue a bad one',
      'The control step': 'seeding, plus the cooling profile',
      'The failure mode to avoid': 'oiling out — the target separating as a second liquid phase instead of a solid',
      'The valuable by-product': 'mother liquor, carrying the minor cannabinoids and the rest of the feed',
      'Same physics, different legal category': 'THCA crystallisation, sold as diamonds',
    }),
    sections: F([
      F({
        h: 'What this operation is — and explicitly what it is not',
        body: 'Crystallisation is a purification. A molecule already present in the feed is persuaded to leave solution as an ordered solid while everything else stays dissolved, and because a growing crystal lattice accepts the molecule that fits it and rejects the ones that do not, the solid that forms is purer than the solution it came from. That is the entire mechanism, and it is why crystallisation is the most powerful single purification step available to a cannabinoid processor: a good distillate at 90 percent CBD becomes a 99-plus percent solid in one operation. Nothing is converted. No molecule is made. Every gram of CBD in the isolate was CBD in the distillate, and every gram of CBD in the distillate was CBD or CBDA in the plant. No step on this page is a conversion, none of it is written so that it could become one, and the acid-catalysed chemistry that turns CBD into something else is not on this shelf at all — see extraction-methods for where that line is drawn and cannabinoids/isomers for the structural treatment. The isolate produced here is a purification product, and that is what makes it the cleanest, most specifiable and most boring material in the industry, which is exactly its commercial virtue.',
        cites: F(['mullin2001', 'myerson2019']),
      }),
      F({
        h: 'Solubility, supersaturation and the driving force',
        body: 'Every solute has a solubility curve in every solvent: the maximum concentration that will stay in solution at a given temperature, which for nearly all organic solutes rises with temperature. Dissolve a solute at a high temperature to near its solubility limit and then cool the solution, and at some point the concentration present exceeds the concentration that can be held. That excess is supersaturation, and it is the thermodynamic driving force for crystallisation — the system now wants to deposit solid, and the amount by which it is supersaturated sets how hard it wants to. Between the solubility curve and the point of spontaneous nucleation there is a region, the metastable zone, where a solution is supersaturated but will not start crystallising on its own; it needs a surface to start on. That zone is where all controlled crystallisation is performed, because a solution held inside it deposits solid onto crystals that are already there, growing them in an orderly way, while a solution pushed past the metastable limit nucleates spontaneously everywhere at once and produces a mass of tiny, impure, solvent-trapping crystals or, worse, oils out. The craft of crystallisation is therefore the craft of generating supersaturation slowly enough and providing surfaces deliberately enough that growth beats nucleation.',
        bullets: F([
          'Supersaturation is the driving force; too little and nothing happens, too much and everything happens badly.',
          'The metastable zone is where controlled crystallisation lives.',
          'Growth on existing crystals gives purity; spontaneous nucleation everywhere gives fines and occlusion.',
        ]),
        cites: F(['mullin2001', 'myerson2019']),
      }),
      F({
        h: 'Solvent systems',
        body: 'The solvent has to dissolve the target well when warm and poorly when cold, dissolve the impurities well at all temperatures so they stay in the mother liquor, be removable to a residual-solvent specification, and be acceptable under the residual-solvent framework the product will be tested against. For CBD the solvents described in the trade literature are pentane, heptane, and pentane/ethanol mixtures. Pentane is a light non-polar alkane with a boiling point near 36 °C, which makes it very easy to remove from a cake and gives a steep solubility differential across a modest temperature range; the cost is extreme volatility and flammability. Heptane, boiling near 98 °C, is easier and safer to handle, dissolves a little more at a given temperature, and is harder to drive out of a crystal. A mixed system — typically a non-polar bulk with a small proportion of ethanol as a polarity modifier — is used to tune the solubility curve, to keep more of the impurity load in solution, and to slow the approach to supersaturation so that growth is controlled. All three of pentane, heptane and ethanol are Class 3 solvents under ICH Q3C, the lowest-concern class, which is a deliberate choice: the solvent used in the final purification step is the one most likely to end up in the product, so it should be the one with the most generous permitted exposure. Antisolvent crystallisation — dissolving in one solvent and adding a second in which the target is poorly soluble — is the other route to supersaturation and it is used in the same way, with the same seeding and rate discipline, except that the control variable is the addition rate rather than the cooling rate.',
        bullets: F([
          'Requirement: dissolves the target warm, not cold; dissolves the impurities always; comes out to specification.',
          'Pentane: steep differential, trivially easy to dry, extremely flammable and volatile.',
          'Heptane: safer handling, higher boiling, harder to drive out of the crystal.',
          'A small ethanol fraction tunes the curve and slows the approach to supersaturation.',
          'Class 3 solvents throughout — the final-step solvent is the one that ends up in the product.',
        ]),
        cites: F(['tradepractice', 'ichq3c', 'armarego2017', 'mullin2001']),
        evidence: 'industry practice',
      }),
      F({
        h: 'The operation, in order',
        body: 'The sequence is fixed and each step has a purpose that the next step depends on. First, start from high-purity distillate: crystallisation rejects impurities into the mother liquor, but a feed with a heavy impurity load gives a mother liquor so concentrated in impurity that the crystals grow through it and occlude it, so a second or third recrystallisation becomes necessary and the yield collapses. Second, dissolve the distillate completely in the warm solvent, with gentle heat and agitation, at a concentration close to but below saturation at the dissolution temperature; undissolved material acts as unintended nucleation sites and starts the crystallisation at a point you did not choose. Third, if the feed colour or impurity load warrants it, treat the hot solution — activated carbon or bentonite, then a hot filtration through a fine medium — because it is far easier to polish a solution than a solid, and a clarifying filtration also removes stray particulates that would otherwise nucleate. Fourth, cool into the metastable zone and seed. Fifth, cool further on a controlled profile while the crystals grow, with gentle agitation. Sixth, hold at the final temperature long enough for growth to finish and the mother liquor to reach equilibrium — cutting this short leaves product in solution. Seventh, filter. Eighth, wash the cake with cold solvent. Ninth, dry under vacuum to specification. Tenth, work up the mother liquor, which is a product stream in its own right.',
        bullets: F([
          'Feed quality first — crystallisation refines, it does not rescue.',
          'Full dissolution before cooling; undissolved solid is an uncontrolled seed.',
          'Clarify and polish hot, in solution, not later as a solid.',
          'Cool into the metastable zone, then seed, then continue cooling.',
          'Hold at final temperature — an early filtration leaves product in the liquor.',
        ]),
        cites: F(['mullin2001', 'myerson2019', 'tradepractice']),
      }),
      F({
        h: 'Seeding, and oiling out',
        body: 'Seeding is the single highest-leverage control in the whole operation. A small quantity of the existing pure crystal — commonly a fraction of a percent up to a few percent of the expected yield, added as a dry powder or as a slurry in cold solvent — is introduced when the solution has cooled into the metastable zone. What it does is take the decision about when and where nucleation happens out of the hands of chance: instead of the solution waiting until it is deeply supersaturated and then nucleating spontaneously in a burst, it begins depositing solid immediately onto the surfaces you provided, at a low supersaturation, growing crystals of known form. The consequences are a predictable batch time, a reproducible crystal size distribution, far less occluded solvent and impurity, and a much better filtration. Seeding also selects the crystal form, which matters wherever a compound has more than one, because the seed you add is the form that grows. The failure mode that seeding most reliably prevents is oiling out, and oiling out is the characteristic disaster of cannabinoid crystallisation. Because cannabinoids are viscous, low-melting, highly lipophilic molecules, a heavily supersaturated cannabinoid solution frequently separates as a second liquid phase — a sticky oil — rather than as a solid. Once that happens, the oil phase is a concentrated soup of the target together with every impurity that was in solution, it does not purify anything, it will not filter, it coats the vessel and the agitator, and the usual outcome is that the batch has to be redissolved and started again. The causes are always the same short list: cooling too fast, going too deep before nucleation begins, too high an initial concentration, too much impurity in the feed (impurities depress the melting point of the target and make the liquid phase more stable), and no seed. The remedy is the mirror image: seed early at low supersaturation, cool slowly, start from clean feed, and if oil appears, warm back up to redissolve it and re-approach the zone more slowly.',
        bullets: F([
          'Seed inside the metastable zone, at low supersaturation, with the crystal form you want.',
          'Seeding buys predictable batch time, reproducible size, less occlusion, better filtration.',
          'Oiling out is a second liquid phase, not a crystal — it purifies nothing and filters not at all.',
          'Causes of oiling out: fast cooling, deep supersaturation before nucleation, too concentrated, dirty feed, no seed.',
          'If it oils out, warm back to full solution and re-approach more slowly.',
        ]),
        cites: F(['mullin2001', 'myerson2019', 'tradepractice']),
      }),
      F({
        h: 'Slow cool against crash: crystal habit and occluded solvent',
        body: 'The cooling profile decides what kind of solid you get. A slow, controlled cool — degrees per hour rather than degrees per minute, often with a programmed ramp and a hold — keeps supersaturation low throughout, so growth dominates over nucleation and the crystals grow large, well-formed and few. Large well-formed crystals have a low surface-area-to-mass ratio, which means little mother liquor adheres to them; they have regular faces that reject foreign molecules as they grow, which means high intrinsic purity; and they form an open, permeable filter cake that drains and washes readily. A crash cool — plunging the solution to low temperature quickly — generates high supersaturation immediately, nucleation happens everywhere at once, and the result is a mass of fine crystals or an amorphous solid. Fines have an enormous surface area holding mother liquor, they grow so fast that they entrap pockets of solution inside the crystal as inclusions, and inclusions are the reason a crashed batch can fail a residual-solvent panel no matter how long it is dried: the solvent is not on the surface where vacuum can reach it, it is inside the solid. Fines also form a dense, compressible cake that blinds the filter and cannot be washed effectively. The industrial rule of thumb, which is worth internalising, is that time spent on the cooling profile is bought back three times over in filtration rate, wash efficiency and drying time. Agitation belongs in the same discussion: gentle, continuous agitation keeps the solution uniform so that no local region becomes deeply supersaturated, keeps crystals suspended so they grow evenly on all faces rather than sitting on the bottom, and improves heat transfer to the jacket; but vigorous agitation causes secondary nucleation by attrition, breaking crystals and creating fines, and can shear a growing crystal population into exactly the fine mass you were avoiding. Gentle and continuous is the target.',
        table: F({
          cols: F(['', 'Slow controlled cool', 'Crash cool']),
          rows: F([
            F(['Supersaturation', 'low and controlled throughout', 'high immediately']),
            F(['Dominant process', 'growth', 'nucleation']),
            F(['Crystal size', 'large, few, well-formed', 'fine, many, irregular or amorphous']),
            F(['Intrinsic purity', 'high — faces reject foreign molecules', 'low — inclusions trapped during fast growth']),
            F(['Occluded solvent', 'low, mostly surface, removable', 'high, internal, not removable by drying']),
            F(['Filtration', 'fast, open permeable cake', 'slow, dense compressible cake that blinds']),
            F(['Washing', 'effective', 'poor — the cake channels or blinds']),
            F(['Batch time', 'longer in the crystalliser', 'longer everywhere else, and often a failed panel']),
          ]),
        }),
        cites: F(['mullin2001', 'myerson2019']),
      }),
      F({
        h: 'Filtration, washing the cake, and drying to specification',
        body: 'Filtration separates the crystals from the mother liquor, and it is done cold, because the solid is only insoluble because it is cold — exactly the same rule as in winterization, and violated for exactly the same reason. A Buchner funnel or filter plate under vacuum at laboratory scale, a jacketed Nutsche filter, filter dryer or centrifuge at production scale; all of it pre-chilled. What comes out of the filter is not pure yet, because every crystal is wetted with a film of mother liquor that contains all the impurity the crystallisation rejected. Washing the cake is therefore not a finishing touch, it is the step that delivers the purity: a small volume of clean, cold solvent is displaced through the cake to push the mother liquor out and replace it with pure solvent. Cold matters because warm wash solvent dissolves the product it is supposed to be rinsing. Small volumes matter, applied as a displacement wash that flows evenly through the bed rather than as a flood that channels down one side; two or three small washes beat one large one. Then drying: the washed cake is wet with pure solvent, and that solvent is removed under vacuum, at a modest temperature, with a large surface area and enough time for diffusion out of the solid. This is the step that has to meet the residual-solvent specification, and it is a diffusion problem, so it is governed by cake thickness, temperature, vacuum depth and time — the same physics as the vacuum-oven discussion on rotary-evaporation. The specification comes from ICH Q3C and, for a laboratory running the panel, USP General Chapter 467; formulation/residual-solvent has the limits and the arithmetic. One warning that belongs here specifically: a crashed, fine, inclusion-bearing cake cannot be dried to specification at any reasonable temperature, because the solvent is inside the crystals and not on their surface. If a batch will not dry down, the problem is upstream in the cooling profile, and the fix is to redissolve and recrystallise properly rather than to dry it harder.',
        bullets: F([
          'Filter cold, with pre-chilled funnel, receiver and wash solvent.',
          'Wash with small volumes of clean cold solvent as a displacement, not a flood.',
          'The wash, not the filtration, is what delivers the purity.',
          'Dry under vacuum at modest temperature with a thin cake — it is a diffusion problem.',
          'A cake that will not dry to specification has inclusions; recrystallise, do not bake.',
        ]),
        cites: F(['mullin2001', 'myerson2019', 'ichq3c', 'usp467', 'tradepractice']),
      }),
      F({
        h: 'The mother liquor is a product, not a waste',
        body: 'The mother liquor is everything the crystal rejected, dissolved in the crystallisation solvent, plus the fraction of the target that remained in solution at the final temperature. In a CBD isolate operation that means it carries the minor cannabinoids — CBC, CBG, CBDV, the varin series, whatever THC the feed contained within its limit — together with residual terpenoids, oxidation products, colour bodies and a substantial quantity of CBD itself, because no crystallisation is complete and the solubility at the final temperature sets the floor on recovery. Throwing it away discards a meaningful fraction of the batch value twice over: the CBD left in solution, and the minor cannabinoid fraction that is worth considerably more per gram than the isolate is. The standard workup is to recover the solvent by evaporation, then either recrystallise the residue to pull a second crop of isolate (lower purity, often recycled into the next batch rather than sold as isolate), or send the residue to chromatography, which is where minor cannabinoids are actually isolated — and mother liquor from an isolate plant is one of the better feedstocks for that, because the major component has already been largely removed. That is the economic connection between this page and chromatography, and it is a real one: the reason a CBD isolate operation can afford a preparative chromatography capability is often the mother liquor stream.',
        bullets: F([
          'Carries the minor cannabinoids, the colour bodies, and a real quantity of unrecovered CBD.',
          'Recover the solvent, then either take a second crop or send it to chromatography.',
          'It is the natural feedstock for minor-cannabinoid isolation because the major component is gone.',
        ]),
        cites: F(['tradepractice', 'hazekamp2004']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Achievable purity, and the yield conversation',
        body: 'The normal commercial specification for CBD isolate is 98 to 99.9 percent CBD by mass, with 99 percent and above routine from good distillate and a single well-run crystallisation, and 99.5 percent and above achievable with a careful wash or a recrystallisation. That purity is not difficult in the sense of requiring exotic equipment; it is difficult in the sense of requiring feed quality, a controlled cooling profile and an honest wash. The yield conversation is separate and it is where operations deceive themselves. Single-pass crystal yield is limited by the solubility of the target in the solvent at the final temperature, so a fraction of the CBD always stays in the liquor; deeper final cooling and a leaner solvent ratio raise the yield and simultaneously raise the risk of fines and oiling out, so the yield-versus-purity trade is real and it is usually resolved by taking a good first crop at high purity and working the liquor up separately rather than by squeezing the first crop. A processor should report isolate purity and crystal yield and liquor cannabinoid content together, because a 99.9 percent isolate at 50 percent yield with an unworked liquor is a worse outcome than a 99.2 percent isolate at 80 percent yield with the liquor recovered.',
        cites: F(['tradepractice', 'mullin2001']),
        contested: true,
        caveat: 'The 98-99.9 percent range is the commercial specification band as sold and as tested; it is not a claim about any particular process achieving it. Reported yields vary widely with solvent, ratio, final temperature and feed purity, and most published figures come from vendors rather than from controlled studies.',
        evidence: 'industry practice',
      }),
      F({
        h: 'Why CBD crystallises readily and most cannabinoids do not',
        body: 'CBD is a mild oddity in its own chemical family: it is a crystalline solid at room temperature with a melting point in the region of 65 °C, whereas Δ9-THC, CBG, CBC and most of the other neutral cannabinoids are viscous oils or low-melting glasses that show no inclination to crystallise at all. The structural reason is molecular shape and packing. CBD is an open, comparatively symmetric, relatively rigid diphenol — two hydroxyl groups on an unfused resorcinol ring, a terpene ring that is not closed onto it — and that geometry lets CBD molecules pack into an ordered lattice with hydrogen bonding between the phenolic hydroxyls holding it together. THC, by contrast, has its pyran ring closed onto the aromatic ring, leaving a single free hydroxyl, a fused tricyclic shape with a stereocentre and an awkward, non-planar profile; it packs poorly, hydrogen-bonds less extensively, and prefers to remain a supercooled liquid. The consequences for a processor are practical and important. First, isolate production as a routine operation is essentially a CBD phenomenon among the neutral cannabinoids: you cannot simply apply this page to CBG or CBC and expect a crop, and attempts to crystallise most minors run into oiling out immediately because for those molecules the liquid phase is genuinely the stable one at the temperatures involved. Second, the route to isolating minor cannabinoids is therefore chromatographic rather than crystallographic, which is why preparative chromatography rather than crystallisation is the tool described for minors and for reference-grade material. Third, the minors that can be crystallised tend to be ones that also pack well — CBG is reported as crystallisable with more difficulty, and the acid forms are a separate story entirely. And fourth, this is why an isolate market exists for CBD at commodity prices while minor cannabinoids are priced per gram like reference standards: the purification economics are completely different molecules apart.',
        bullets: F([
          'CBD: open, symmetric, two free phenols, hydrogen-bonded lattice, melts near 65 °C, crystallises readily.',
          'THC and most neutral minors: fused, hindered, one free hydroxyl, poor packing, stay as oils or glasses.',
          'Therefore isolate production is largely a CBD operation, and minors go to chromatography instead.',
          'This is the structural reason minor cannabinoids cost what they cost.',
        ]),
        cites: F(['mullin2001', 'adams1940', 'gaoni1964', 'tradepractice']),
        contested: true,
        caveat: 'Melting points reported for CBD vary between roughly 62 and 68 °C across sources depending on polymorph and purity, and the crystallisability of individual minor cannabinoids is documented unevenly — much of what circulates about CBG and CBN crystallisation is trade experience rather than published crystallographic work. The structural explanation given here is the standard reading of the molecular geometry, not a measured result.',
      }),
      F({
        h: 'THCA diamonds: the same physics, a different legal category',
        body: 'The crystals sold as diamonds are THCA, the acid form, and their production is the same physics described on this page applied to a different molecule. THCA is a crystalline solid, more readily crystallised than neutral THC precisely because the carboxylic acid group gives it strong hydrogen-bonding capability and a shape that packs, which is the same structural argument as for CBD. The operations are recognisably identical: a supersaturated solution of THCA in a solvent or in its own terpene fraction, a controlled approach to supersaturation, nucleation and slow growth over days to weeks, then separation of the crystals from the liquid phase — which in the diamonds-and-sauce presentation is deliberately kept and sold alongside the crystals as the terpene-rich mother liquor rather than worked up. It is also the clearest illustration of why decarboxylation belongs where you put it and not elsewhere: THCA diamonds exist because the material was never decarboxylated, and heating them converts them to Δ9-THC, which is what happens when they are consumed. The only difference that matters between a THCA crystallisation and a CBD crystallisation is regulatory: CBD isolate from compliant hemp is a hemp product in most jurisdictions, and THCA crystal is a controlled-substance product in most, testing at or near the theoretical maximum total THC. The chemistry, the equipment and the craft are the same. Processing decisions about which one an operation can make are licensing decisions, not technical ones.',
        cites: F(['tradepractice', 'usdahemp2021', 'wang2016']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'Crystallisation handles the most hazardous solvents on this shelf at the coldest temperatures, so the discipline is specific. Pentane boils at about 36 °C and has a flash point near minus 49 °C, which means its vapour is ignitable at any temperature you will ever encounter, it boils at slightly above room temperature so a warm room pressurises a closed container, and its vapour is denser than air and travels. Pentane work requires ventilation designed for a heavier-than-air vapour, a genuinely ignition-free environment with appropriately rated electrical fittings, bonding and grounding of every metal vessel and every transfer (static from pouring a non-conductive solvent is a documented ignition source, and pentane is about as non-conductive as solvents get), and no open transfers of any volume. Heptane is less volatile but still a flammable liquid under the code and gets the same handling in kind if not in degree. Cold: crystallisers and cold rooms run from minus 20 °C to minus 80 °C, and cryogenic-rated gloves and no bare-skin contact with cold metal are required, with the same caution as on winterization that cold burns accumulate without the warning that heat gives. Warming a sealed cold vessel is a pressure hazard with a low-boiling solvent inside and must never be done — a vessel taken out of a minus 40 °C freezer and closed will pressurise as it warms. Dissolution at elevated temperature is a hot-flammable-solvent operation, so the heat source is a controlled bath with no open element and no flame anywhere, the vessel is refluxed or closed to a condenser rather than open to the room, and a solvent whose boiling point is near the dissolution temperature is under enough vapour pressure to push a stopper out. Vacuum filtration and vacuum drying bring the evacuated-glassware inspection rules from short-path-distillation. And two specifics: filter cakes and dried isolate are fine organic powders which can carry a dust-explosion risk in bulk handling and are a nuisance respiratory exposure at any scale, so handle them with extraction and containment; and no peroxide-forming ether — diethyl ether, diisopropyl ether, THF — should be used as a crystallisation solvent and then evaporated to dryness, because concentrating peroxides into a solid residue is the worst version of that hazard.',
        bullets: F([
          'Pentane is ignitable at every ordinary temperature, boils near 36 °C, and its vapour sinks and travels.',
          'Bond and ground everything; non-conductive solvents generate static on transfer.',
          'Never seal a cold vessel containing a low-boiling solvent and let it warm.',
          'Hot dissolution: controlled bath, no flame, no open element, condenser rather than an open vessel.',
          'Cryogenic gloves for freezer and cold-room work; no bare skin on cold metal.',
          'Evacuated glassware rules as on short-path work: inspect for star cracks, only rated vessels.',
          'Dried isolate is a fine organic dust — containment and extraction, and mind the dust-explosion question in bulk.',
          'No peroxide-forming ether evaporated to dryness, ever.',
        ]),
        cites: F(['prudent2011', 'kelly1996', 'nfpa', 'osha1910', 'armarego2017']),
      }),
    ]),
    seeAlso: F(['processing/chromatography', 'processing/short-path-distillation', 'processing/rotary-evaporation', 'formulation/residual-solvent', 'cannabinoids/side-chain-series', 'cannabinoids/isomers', 'products/viscosity-and-cbt', 'equipment/glassware', 'coa/panels']),
    cites: F(['mullin2001', 'myerson2019', 'tradepractice', 'ichq3c', 'usp467', 'armarego2017', 'hazekamp2004', 'adams1940', 'gaoni1964', 'usdahemp2021', 'wang2016', 'prudent2011', 'kelly1996', 'nfpa', 'osha1910']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'chromatography',
    title: 'Preparative Chromatography',
    kind: 'tool',
    summary: 'What each technique separates and when a processor actually needs one: flash columns for removing a specific impurity, preparative HPLC for minor cannabinoids and reference-grade material, and centrifugal partition and countercurrent chromatography for gram-to-kilogram separations at low solvent cost. Plus the reason a lab with preparative capability can make its own reference standards.',
    facts: F({
      'What it does that distillation cannot': 'separates compounds that boil at nearly the same temperature but differ in polarity or partitioning behaviour',
      'Flash': 'low-pressure column, silica (normal phase) or C18 (reverse phase), gradient or step elution',
      'Preparative HPLC': 'highest resolution, the standard route to minor cannabinoids and reference-grade material',
      'CPC and CCC': 'liquid-liquid, no solid stationary phase, high loading, low solvent cost per gram',
      'The cannabinoid problem it solves': 'CBD from THC, CBD from CBC, CBG and CBN from each other — separations distillation cannot make',
      'Why prep capability matters': 'the same separation that identifies a compound is what isolates it',
    }),
    sections: F([
      F({
        h: 'What chromatography does that distillation and crystallisation cannot',
        body: 'Distillation separates by vapour pressure, and crystallisation separates by lattice fit and solubility. Both are powerful and both have a blind spot: compounds that are similar in the relevant property cannot be separated by them at any level of effort. The cannabinoids are exactly that kind of family. CBD and Δ9-THC are isomers with the same molecular formula and very nearly the same molecular mass, and their volatilities are close enough that no practical number of distillation stages will cleanly separate them; CBC is an isomer too; CBG differs by one ring closure; and the varin-series homologues differ from their pentyl parents by two carbons in a side chain. None of that is a vapour-pressure difference you can exploit, and outside CBD very little of it is a crystallisation you can run. What those molecules do differ in is polarity, hydrogen-bonding capacity and how they partition between two immiscible liquids — and those are exactly the properties chromatography separates on. That is the whole reason a cannabinoid operation eventually buys a chromatography capability: it is the only unit operation available that can separate one cannabinoid from another. The two specific jobs it is bought for are removing THC from a broad-spectrum product to a non-detect specification, and isolating minor cannabinoids that no other operation will give you.',
        bullets: F([
          'Isomers cannot be distilled apart; CBD, THC and CBC are isomers.',
          'Crystallisation works for CBD and for the acids and poorly for almost everything else.',
          'Chromatography separates on polarity and partitioning, which is where these molecules differ.',
          'The two commercial drivers: THC remediation to non-detect, and minor-cannabinoid isolation.',
        ]),
        cites: F(['snyder2010', 'hazekamp2004']),
      }),
      F({
        h: 'Flash chromatography: normal and reverse phase',
        body: 'Flash chromatography is a low-pressure column separation, run at a few bar with a pump rather than by gravity, on a cartridge or packed column of silica or of bonded reverse-phase silica, with fraction collection and usually UV detection at the outlet. In normal phase the stationary phase is bare silica, which is polar, and the mobile phase is a non-polar organic — a hexane or heptane base with a polar modifier such as ethyl acetate or a small alcohol fraction — so the less polar compounds come off first and retention increases with polarity. In reverse phase the stationary phase is a C18-bonded silica, which is non-polar, and the mobile phase is aqueous, typically a water-methanol or water-acetonitrile mixture, so the more polar compounds elute first. Elution can be isocratic, at a single constant mobile-phase composition, or gradient, where the mobile phase composition is ramped during the run; a gradient compresses a run that would otherwise be very long and sharpens late peaks, and on cannabinoid separations it is the normal choice. The right job for flash is a specific, well-defined cleanup: removing one identified impurity, taking a colour or pigment fraction out, splitting a crude into a few broad bands to feed a later, finer separation, or pulling a target from a mother liquor that has already had the major component crystallised out. Its economics are its limitation. Loading on silica is modest — the trade rule of thumb is on the order of a few percent of the mass of the stationary phase for a difficult separation and up to perhaps ten percent for an easy one — and solvent consumption per gram of product is high, because you are pushing many column volumes of mobile phase through for each load. Silica cartridges are also typically single-use or limited-reuse in practice on a resinous feed, which adds a consumable cost, and the solvent has to be recovered or disposed of, which puts an evaporator downstream of every column. Flash is therefore cheap to buy and expensive to run, which makes it the right tool at gram-to-hundreds-of-grams scale and the wrong tool for sustained kilogram production.',
        bullets: F([
          'Normal phase: silica, non-polar mobile phase, less polar first.',
          'Reverse phase: C18, aqueous mobile phase, more polar first.',
          'Gradient elution shortens runs and sharpens late peaks; it is the default here.',
          'Best at: one identified impurity, a colour fraction, or a coarse pre-split.',
          'Economics: low capital, low loading, high solvent per gram, consumable stationary phase.',
        ]),
        cites: F(['snyder2010', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Preparative HPLC',
        body: 'Preparative HPLC is the same technique as the analytical HPLC in the QC laboratory, scaled up: high-pressure pumps, small well-packed particles, a column of larger internal diameter, higher flow rates, a detector with a shorter path or a split so it is not saturated, and an automated fraction collector. Because the particles are small and the packing is efficient, the number of theoretical plates is high and the resolution is the best available in the preparative world, which is what makes it the standard route to two things: isolating minor cannabinoids that are present at low percentage in a feed and that nothing else will separate, and producing reference-grade material at the purity an analytical standard requires. The scale-up from an analytical method is the part that needs care, and it is a real discipline rather than a matter of turning up the flow. The usual approach is geometric: keep the stationary phase chemistry, the particle size and the column length the same, scale the flow rate and the injected mass in proportion to the cross-sectional area of the column, and expect that the method will need re-optimising anyway because a preparative column is run deliberately overloaded relative to an analytical one. Overloading is the whole economic point — an analytical injection is a vanishing quantity designed to give a perfect peak, while a preparative injection is as large as it can be while the target peak still resolves from its neighbours — so the practical optimisation is a loading study that finds the maximum injection at which the target fraction still meets specification. Cost per gram is the highest of the three techniques on this page: the columns are expensive and finite, the solvent volumes are large, the hardware is expensive, and a substantial fraction of the run time produces fractions that are not product. That is acceptable when the product is a minor cannabinoid worth hundreds or thousands per gram or a certified reference material, and unacceptable for a commodity.',
        bullets: F([
          'Highest resolution available preparatively; the route to minors and to reference-grade material.',
          'Scale-up is geometric on cross-sectional area, then re-optimised — not simply a higher flow rate.',
          'Deliberate overloading is the economics; a loading study finds the limit.',
          'Highest cost per gram of the three techniques, justified only by product value.',
        ]),
        cites: F(['snyder2010', 'tradepractice']),
      }),
      F({
        h: 'Centrifugal partition and countercurrent chromatography',
        body: 'Countercurrent chromatography and its centrifugal-partition variant abandon the solid stationary phase altogether. Two immiscible liquid phases are used — a biphasic solvent system, in cannabinoid work commonly built from a non-polar alkane, an alcohol and water in a tuned ratio — and one phase is retained inside the instrument as the stationary phase by a centrifugal field while the other is pumped through it as the mobile phase. Separation happens by repeated partitioning of each solute between the two liquids, and the governing parameter is the partition coefficient of each compound in that solvent system, which can be measured in a test tube before any instrument is run. Because there is no solid support, four things follow, and together they are the reason the cannabinoid industry adopted the technique. There is no irreversible adsorption and no on-column degradation, so a resinous, dirty, high-loading feed that would foul a silica column is acceptable, and recovery is essentially total — everything injected comes out. Loading capacity is very high relative to the instrument size, because the stationary phase is a bulk liquid volume rather than a thin surface layer. Solvent cost per gram of product is low, because the solvent system is a defined mixture that is recovered by evaporation and, in many operations, reconstituted and reused. And there is no consumable stationary phase to replace. Hazekamp and colleagues published the preparative isolation of cannabinoids from Cannabis sativa by centrifugal partition chromatography, which is the reference point for the technique in this field; the general methodology and its pitfalls are set out by Ito and by the IUPAC technical report from Berthod and colleagues. The costs are real too: resolution is lower than preparative HPLC, so closely-eluting pairs are harder; the solvent-system selection is the hard part of method development and is a partition-coefficient screening exercise that takes real work; the instruments are mechanically complex, with a rotating seal or a seal-free planetary drive, and they need maintenance; and phase retention is sensitive to flow rate, rotation speed and temperature, so a system that is running well can be knocked out of retention by a change in any of them, dumping the stationary phase and ruining the run.',
        bullets: F([
          'Liquid-liquid: one liquid phase held by centrifugal force, the other pumped through it.',
          'No solid support, therefore no irreversible adsorption, no fouling, near-total recovery.',
          'High loading and low solvent cost per gram — the reasons the industry adopted it.',
          'Method development is solvent-system selection by partition-coefficient screening.',
          'Weaknesses: lower resolution than prep HPLC, mechanical complexity, and phase-retention sensitivity.',
        ]),
        cites: F(['hazekamp2004', 'ito2005', 'berthod2009']),
      }),
      F({
        h: 'Comparison',
        body: 'The three techniques are not competitors so much as tools for different points on the value-and-volume plane. A processor at gram scale doing occasional cleanups buys flash; a processor producing minor cannabinoids or reference material buys preparative HPLC; a processor separating kilograms of CBD, CBN and CBG on a routine basis buys CPC. Large operations own two of the three, and use one to feed the other.',
        table: F({
          cols: F(['', 'Flash', 'Preparative HPLC', 'CPC / CCC']),
          rows: F([
            F(['Stationary phase', 'silica or C18, solid, consumable', 'small-particle packed bed, solid, expensive and finite', 'a liquid — no solid phase at all']),
            F(['Resolution', 'low to moderate', 'highest', 'moderate']),
            F(['Loading per run', 'low (a few percent of phase mass)', 'moderate, deliberately overloaded', 'high relative to instrument size']),
            F(['Solvent consumption per gram', 'high', 'high', 'low']),
            F(['Sample recovery', 'good, but adsorption losses occur', 'good', 'essentially total']),
            F(['Tolerance of dirty, resinous feed', 'poor — fouls and requires pre-cleanup', 'poor — needs a clean, filtered sample', 'high — this is its signature advantage']),
            F(['Capital cost', 'low', 'high', 'moderate to high']),
            F(['Consumable cost', 'moderate and continuous (cartridges)', 'high (columns)', 'low (solvent system, recovered)']),
            F(['Method development effort', 'low', 'moderate', 'high — solvent-system screening']),
            F(['Best fit', 'one specific impurity, colour, coarse pre-split', 'minor cannabinoids, reference standards, hardest pairs', 'routine multi-gram to kilogram cannabinoid separations']),
          ]),
        }),
        cites: F(['snyder2010', 'hazekamp2004', 'ito2005', 'berthod2009', 'tradepractice']),
        contested: true,
        caveat: 'Loading capacities, solvent consumption per gram and cost comparisons between these techniques depend heavily on the specific separation, the feed purity and the instrument, and published figures come largely from vendors and from application notes rather than from controlled head-to-head studies. The ordering in this table is robust; the magnitudes are not specifications.',
        evidence: 'industry practice',
      }),
      F({
        h: 'The analytical side and the preparative side are the same separation',
        body: 'There is a point here that is easy to miss and important once seen: the method that identifies a compound and the method that isolates it are the same method at different scales. A QC laboratory develops an HPLC method that resolves CBD from CBC from CBG from THC on a small column with a tiny injection, and it uses that resolution to report a potency panel. A preparative laboratory takes that same stationary phase chemistry and that same mobile phase, puts it on a larger column, injects a thousand times more material, and collects the resolved peaks as fractions instead of integrating them as numbers. The chemistry is identical. The consequence is that a laboratory with preparative capability can make its own reference material: isolate a cannabinoid from a real extract by preparative chromatography, characterise it by the analytical method plus a structural confirmation, assign a purity, and use it as an in-house standard. That matters because the availability of certified reference material is the actual bottleneck in minor-cannabinoid and novel-cannabinoid analysis — a compound for which no standard exists cannot be quantified reliably, and often cannot even be identified with confidence, which is why a COA on an exotic-cannabinoid product frequently carries unidentified peaks and why potency claims for the newer analogues rest on so little. That bottleneck, its consequences for what can honestly be said about the newer cannabinoids, and the reason the research literature on them is so thin are covered on cannabinoids/research-frontier. This page is the practical half of that argument: the capability that dissolves the bottleneck is preparative chromatography, and an operation that owns it is in a different epistemic position from one that does not.',
        bullets: F([
          'Analytical resolution and preparative isolation are the same separation at different scale.',
          'A lab with prep capability can characterise and certify its own in-house standards.',
          'Absence of reference material is the real limit on minor and novel cannabinoid analysis.',
        ]),
        cites: F(['snyder2010', 'hazekamp2004']),
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'Chromatography is the largest solvent inventory on this shelf per gram of product, and that is the governing hazard. A single preparative run can push many litres of a flammable mobile phase through a system, and a working laboratory has feed reservoirs, waste carboys and fraction collections all holding open or semi-open volumes of solvent at once, so ventilation, ignition-source control, bonding and grounding on transfers, and code-compliant flammable-liquid storage and quantity limits are the baseline, not extras. Waste is a specific discipline here in a way it is not elsewhere: chromatography generates large volumes of mixed solvent waste, carboys fill faster than people expect, and an overflowing or unlabelled carboy of mixed organic waste in a laboratory is both a fire load and a disposal problem. Label every waste stream by composition, vent carboys properly, and never mix incompatible waste. Pressure is the second hazard: a preparative HPLC runs at high pressure and a column or fitting failure releases solvent as a spray, so the system is not opened under pressure, fittings are checked, and a pressure limit is set on the pump so a blockage stops the run instead of bursting something. On a CPC or CCC instrument the hazard is rotational: a rotor holding litres of solvent spinning at speed is a mechanical energy store, the interlocks exist for a reason, and a seal failure sprays solvent into the machine, so those interlocks are never defeated. Solvent-specific points matter: acetonitrile is acutely toxic and metabolises to cyanide, so it is handled with skin protection and in ventilation and its waste is segregated; methanol is absorbed through skin and is a specific ocular toxin; hexane has a documented peripheral-neuropathy hazard from chronic exposure, which is a real argument for heptane in its place. And the peroxide-forming solvents — diethyl ether, THF, diisopropyl ether, dioxane — turn up in chromatographic mobile phases more often than anywhere else on this shelf, so date-mark them, test them, respect their expiry, and never evaporate a fraction containing them to dryness. Finally, UV detectors and any lamp source are an eye hazard when a flow cell is opened or a lamp housing is defeated; leave the interlocks in place.',
        bullets: F([
          'Largest solvent inventory per gram of product on this shelf — ventilation, ignition control, grounding, storage limits.',
          'Waste discipline: label by composition, vent carboys, segregate incompatibles, do not let them overfill.',
          'Never open a pressurised system; set a pump pressure limit so a blockage stops the run.',
          'CPC rotors are a mechanical energy store holding solvent — never defeat the interlocks.',
          'Acetonitrile (cyanide metabolite), methanol (skin absorption, ocular), hexane (chronic neuropathy — prefer heptane).',
          'Peroxide-forming solvents appear most often here: date-mark, test, never evaporate to dryness.',
        ]),
        cites: F(['prudent2011', 'kelly1996', 'nfpa', 'osha1910', 'armarego2017']),
      }),
    ]),
    seeAlso: F(['processing/crystallization', 'processing/extraction-methods', 'cannabinoids/research-frontier', 'cannabinoids/isomers', 'coa/panels', 'coa/reading-a-coa', 'equipment/analytical', 'formulation/residual-solvent']),
    cites: F(['snyder2010', 'hazekamp2004', 'ito2005', 'berthod2009', 'tradepractice', 'prudent2011', 'kelly1996', 'nfpa', 'osha1910', 'armarego2017']),
  }),

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  F({
    slug: 'terpene-recovery',
    title: 'Terpene Recovery',
    kind: 'tool',
    summary: 'Capturing the volatile fraction before heat destroys it: why terpenes are lost first in every thermal operation, cold trapping ahead of the distillation body, vacuum stripping as a deliberate first cut, steam distillation of botanical and cannabis material with the operator Helichrysum yield data, hydrosols as the aqueous co-product, cannabis-derived against botanical terpenes as products, and the input-versus-output terpene panel that tells you where your terpenes went.',
    facts: F({
      'Why they go first': 'monoterpenes are the most volatile components in the mixture, so every thermal or vacuum step removes them first',
      'Monoterpene volatilisation band': 'roughly 155-175 °C at atmospheric pressure; far lower under vacuum',
      'Sesquiterpene band': 'roughly 175-200 °C at atmospheric pressure',
      'Cold-trap coolants': 'dry-ice slush at about −78 °C, liquid nitrogen at about −196 °C',
      'Helichrysum essential-oil yield (operator material)': '0.15-0.25 percent v/w — about 0.17-0.28 mL from 113 g of dried herb',
      'Preferred method for terpene preservation': 'steam distillation',
      'Aqueous co-product': 'hydrosol, carrying the water-soluble aromatics',
      'The diagnostic': 'a terpene panel on the input and on every output stream',
    }),
    sections: F([
      F({
        h: 'Terpenes are lost first in every operation, and that is both a quality and an economic loss',
        body: 'The terpene fraction consists of the most volatile components in the mixture. Monoterpenes such as myrcene, limonene, α-pinene and 1,8-cineole volatilise in the region of 155 to 175 °C at atmospheric pressure, and the sesquiterpenes, β-caryophyllene and α-humulene among them, in the region of 175 to 200 °C; under the deep vacuum used for cannabinoid work those figures drop enormously, which means that at any pressure and temperature at which cannabinoids move, the terpenes have already left. That has a consequence that runs through every page on this shelf: warm-ethanol extraction, solvent recovery on a rotovap, decarboxylation at 120 to 150 °C, pull-down on a still and a wiped-film pass all remove the terpene fraction as an unavoidable consequence of doing what they are for. If you have not made a deliberate arrangement to capture it, it has gone into the recovered solvent, into the cold trap as an unregarded contaminant, into the vacuum-pump oil, or into the room. The loss is a quality loss, because the aromatic and flavour character of the product is the terpene fraction and a distillate stripped of it is odourless and characterless — which is why terpenes are added back at formulation, and why a live product commands what it commands. It is also a direct economic loss, because cannabis-derived terpenes are among the highest-value-per-gram streams a processor can produce, frequently valued above the distillate they were separated from. A processor who is not capturing them is discarding the most valuable fraction of the batch first and paying to do it.',
        bullets: F([
          'Monoterpenes go first, sesquiterpenes second, cannabinoids last — in every thermal or vacuum step.',
          'Uncaptured, the fraction ends up in recovered solvent, the cold trap, the pump oil, or the room.',
          'Quality: the product character IS the terpene fraction.',
          'Economics: cannabis-derived terpenes often carry a higher price per gram than the distillate.',
        ]),
        cites: F(['vkfri2026', 'namdar2018', 'gieringer2004', 'tradepractice']),
      }),
      F({
        h: 'Cold trapping ahead of the distillation body',
        body: 'The simplest recovery arrangement is a cold trap between the still head or condenser and the vacuum pump, sized and cooled to condense what the main condenser did not. Every vacuum train needs one anyway for pump protection, so the question is not whether to have one but whether to treat what collects in it as a product or as waste. Coolant choice sets what it catches. An ice-water or chilled-glycol trap at 0 to −20 °C catches water and the heavier volatiles and lets the light monoterpenes through. A dry-ice and solvent slush at about −78 °C catches essentially the whole terpene fraction and is the normal choice for deliberate recovery. Liquid nitrogen at about −196 °C catches everything including residual solvent and water, which is excellent for pump protection and poor for product quality, because the resulting solid is a mixture of everything and has to be separated again. Geometry matters as much as temperature: a trap needs enough surface area and enough residence time for the vapour to actually reach a cold wall, so a deep, well-immersed trap with a coiled or baffled path works and a short straight tube dipped in a bath does not, and the trap must be placed as close to the source as the plumbing allows because a long warm line between the still and the trap is a line in which the vapour condenses and then re-evaporates. Two practical points that decide whether the recovered fraction is usable: run the trap cold from the start, before pull-down begins, because the first volatiles come off during pull-down and a trap cooled after the run has started misses them entirely; and collect the trap contents separately for each phase of the run, because the material that comes over during solvent stripping is not the material that comes over during the terpene cut and blending them gives you a solvent-contaminated terpene fraction that cannot be sold.',
        bullets: F([
          'Coolant sets the cut: glycol takes the heavy end, dry-ice slush takes the terpenes, liquid nitrogen takes everything.',
          'Surface area, residence time and proximity to the source decide the capture efficiency.',
          'Cool the trap before pull-down, not after — the first volatiles leave immediately.',
          'Change or empty the trap between run phases, or the solvent cut contaminates the terpene cut.',
        ]),
        cites: F(['perry2019', 'armarego2017', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Vacuum stripping the volatile fraction as a deliberate first cut',
        body: 'The better arrangement is to stop treating the terpene fraction as something that escapes and treat it as a fraction you take on purpose, early, under conditions chosen for it rather than for the cannabinoids. That means a dedicated low-temperature, moderate-vacuum stage ahead of the cannabinoid work: the charge is held at a bath or jacket temperature well below cannabinoid distillation range — a modest warmth is enough, because the volatility differential is large — at a vacuum deep enough to pull the volatiles over but not so deep that cannabinoids begin to move, with a well-cooled condenser or trap collecting the distillate. The cut is taken to its own receiver and banked. Done properly this achieves four things at once. It produces a saleable terpene fraction. It devolatilises the feed, which is exactly what the downstream distillation or wiped-film stage requires, so the operation you were going to have to do anyway now pays for itself. It removes the material that would otherwise foam, fight the vacuum and carry crude into the head during the cannabinoid pass. And it decouples the terpene decision from the cannabinoid decision, so the cannabinoid body cut can be run at whatever temperature and vacuum gives the best distillate without any consideration of what that does to an aromatic fraction that has already been banked. The sequencing point is worth stating plainly because it is commonly got wrong: the terpene cut is taken before decarboxylation where the process allows it, since decarboxylation at 120 to 150 °C in an open or vented vessel destroys or vents most of what was left, and a terpene fraction captured after decarboxylation is a fraction of a fraction.',
        bullets: F([
          'A deliberate low-temperature, moderate-vacuum first cut, to its own receiver.',
          'It doubles as the devolatilisation step the downstream stage requires.',
          'It stops the volatiles fighting the vacuum during the cannabinoid pass.',
          'Take it before decarboxylation wherever the process sequence allows.',
        ]),
        cites: F(['tradepractice', 'perry2019']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Steam distillation of botanical and cannabis material',
        body: 'Steam distillation is the classical method for volatile oils and it is the preferred method where terpene preservation is the objective. Steam is passed through or generated beneath a bed of plant material; the volatile constituents are carried with the steam, and the mixed vapour is condensed and the oil separated from the water in a receiver. The reason it preserves terpenes is thermodynamic rather than a matter of care: in a steam distillation each volatile component is carried over at a temperature well below its own boiling point, because it only needs to contribute its partial pressure to the total, and the total is reached at or below 100 °C. The material therefore never experiences the temperature at which the terpenes would isomerise, oxidise or polymerise, which is exactly the failure that a dry thermal extraction produces. The operator corpus records this directly, as the observed practice with the Van Kush Family Helichrysum material: steam distillation is preferred for terpene preservation, the essential-oil yield from the South African Helichrysum species runs at 0.15 to 0.25 percent v/w, and for the 113 g quarter-pound of dried herb held in inventory that is an expected 0.17 to 0.28 mL of essential oil — a figure worth stating because it makes concrete how small a volatile-oil yield is by mass and therefore why capture efficiency rather than plant quantity is the thing to optimise. The same corpus documents the species profiles that make the fraction interesting: H. odoratissimum at around 17 percent 1,8-cineole, up to 43 percent α-pinene and about 16 percent γ-curcumene; H. cymosum at about 30 percent α-pinene and 19 percent (E)-caryophyllene, which is the CB2-active sesquiterpene; and H. petiolare carrying about 21 percent faurinone and 17 percent (E)-β-ocimene. Applied to cannabis, steam distillation is a real option for terpene production from fresh or fresh-frozen material and it has a specific limitation: the cannabinoids are not volatile under these conditions, so they stay in the spent biomass, which means steam distillation is a terpene-only operation and the biomass must then be extracted separately for its cannabinoids. Some operations run exactly that way deliberately, taking the aromatic fraction by steam first and the cannabinoids by solvent afterwards. The other limitation is hydrolysis and thermal rearrangement of the more sensitive constituents in contact with hot water and steam over a long run, which is why short runs, steam rather than a full boil-up of submerged material, and prompt separation of oil from water are the standard precautions.',
        bullets: F([
          'Each component is carried over below its own boiling point — that is why terpenes survive.',
          'Operator data: Helichrysum essential-oil yield 0.15-0.25 percent v/w; 113 g gives about 0.17-0.28 mL.',
          'Steam distillation is preferred for terpene preservation in the operator corpus.',
          'On cannabis it is a terpene-only operation: the cannabinoids remain in the spent biomass for separate extraction.',
          'Short runs, steam rather than submerged boiling, prompt oil-water separation.',
        ]),
        cites: F(['vkfri2026', 'perry2019', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Hydrosols: the aqueous co-product',
        body: 'A steam distillation produces two products, not one. The oil separates and is collected, and the condensed water that carried it — the hydrosol, also called a distillate water or aromatic water — remains, and it is not waste. It holds the water-soluble and partially water-soluble aromatic constituents: the small oxygenated molecules, alcohols, aldehydes and acids that partition into water rather than into the oil phase, together with a trace colloidal dispersion of the oil itself. That composition is chemically different from the oil, not a dilute version of it, which is why a hydrosol smells recognisably of the plant but not identical to its essential oil. The operator corpus records the hydrosol from the Helichrysum distillation as a valuable by-product with an intended use in toners and sprays, and that is the normal commercial position: hydrosols are sold as finished cosmetic and culinary products in their own right. The practical handling points are that a hydrosol is mostly water with a low concentration of organics and is therefore microbiologically vulnerable in a way that an essential oil is not, so it needs clean collection, cold storage, and either a preservation system or a short shelf life; that it should be collected separately per run and not accumulated across batches; and that the separation of oil from hydrosol in the receiver should be prompt and complete, because prolonged contact lets the water-soluble fraction continue to partition out of the oil.',
        bullets: F([
          'Chemically distinct from the oil — the water-soluble aromatics, not a dilution.',
          'A saleable cosmetic product in its own right (operator use: toners and sprays).',
          'Mostly water, therefore microbiologically vulnerable: clean collection, cold storage, short shelf life or preservation.',
          'Separate oil from water promptly and completely.',
        ]),
        cites: F(['vkfri2026', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Cannabis-derived against botanical terpenes as products',
        body: 'Two quite different products go by the word terpenes and a processor should not confuse them, because they are not interchangeable commercially, in composition or in regulatory position. Cannabis-derived terpenes are the volatile fraction recovered from cannabis or hemp itself, by the cold-trapping, vacuum-stripping or steam routes on this page. Their selling point is authenticity: the fraction contains the full profile the cultivar actually produced, including the minor and trace constituents that are individually unremarkable and collectively responsible for a recognisable cultivar character, and it may carry a small quantity of cannabinoid carry-over, which is both part of why it behaves the way it does in a formulation and a regulatory fact that has to be declared and tested. Yields are low, the material is expensive, and it is the premium option. Botanical terpenes are the same or analogous molecules sourced from other plants — myrcene from hops or lemongrass, limonene from citrus peel, β-caryophyllene from black pepper or clove, α-pinene from pine, linalool from lavender — supplied as single compounds or as blends formulated to approximate a cultivar profile. They are far cheaper, available in consistent food-grade or GRAS quality with specifications and documentation, contain no cannabinoids, and can be blended to a target profile reproducibly. What they do not have is the trace complexity of the real fraction, and a formulated blend reconstructed from twenty named compounds does not smell the same as the material it was modelled on, because the model omits everything that was not on the list. The operator corpus makes the same observation from the botanical side that this shelf makes from the cannabis side: β-caryophyllene occurs across many botanicals and is orally bioavailable and CB2-active regardless of which plant it came from, which is the honest case for botanical sourcing of individual actives, while the case for cannabis-derived material is the profile rather than any single molecule. Formulation practice, blending ratios, solubility and the viscosity consequences of adding a terpene fraction back into a distillate are on products/terpene-blending.',
        table: F({
          cols: F(['', 'Cannabis-derived', 'Botanical']),
          rows: F([
            F(['Source', 'the cannabis or hemp batch itself', 'other plants, or fermentation, as single compounds']),
            F(['Profile', 'full, including trace constituents', 'a formulated approximation of a target profile']),
            F(['Cannabinoid content', 'small carry-over, must be declared and tested', 'none']),
            F(['Cost', 'high', 'low to moderate']),
            F(['Consistency', 'varies with the batch it came from', 'high, to specification']),
            F(['Documentation', 'your own analysis', 'supplier specification, food-grade or GRAS where applicable']),
            F(['Commercial position', 'premium, authenticity claim', 'volume, reproducibility, cost control']),
          ]),
        }),
        cites: F(['vkfri2026', 'namdar2018', 'tradepractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'The diagnostic: run a terpene panel on the input and on every output',
        body: 'The analytical point is the one that turns everything above into process control. A terpene panel is a gas-chromatographic analysis reporting the individual volatile constituents and their concentrations, and the reason to run it is not marketing, it is mass balance. Run it on the input biomass or crude, run it on the recovered terpene fraction, run it on the finished distillate, and run it on the recovered solvent and the cold-trap contents if you want the whole picture — and the numbers tell you where your terpenes went. A panel showing 2 percent total terpenes in the input and a recovered fraction accounting for a quarter of that, with nothing in the distillate, means three quarters of the fraction is in your recovered solvent, your pump oil or the room, and it identifies which by where you find it. A panel showing the profile of the recovered fraction skewed heavily toward sesquiterpenes relative to the input means the monoterpenes escaped upstream, before the point where you started capturing. A panel showing a recovered fraction with residual solvent in it means the trap was not changed between run phases. None of this is visible without the analysis, and all of it is actionable with it. Namdar and colleagues demonstrated the underlying fact in the literature — that the cannabinoid and terpenoid composition recovered from the same biomass changes with the extraction method used — which is the formal version of the practical rule that your process, not your plant, determines your terpene result. The panel is also what lets an operation make an honest claim about a live or full-spectrum product, and the inverse: coa/panels covers what a terpene panel does and does not report, and terpenes/vaporization-bands covers the temperature behaviour of the individual constituents.',
        bullets: F([
          'Panel the input, the recovered fraction, the distillate, and the trap and solvent streams.',
          'Total recovered against total input is a mass balance that names your loss point.',
          'A sesquiterpene-skewed recovery means the monoterpenes escaped before your capture point.',
          'Solvent in the terpene fraction means the trap was not changed between phases.',
          'Your process, not your cultivar, determines the terpene result you can claim.',
        ]),
        cites: F(['namdar2018', 'gieringer2004', 'tradepractice']),
      }),
      F({
        h: 'Safety, as part of the operation',
        body: 'Terpene recovery adds two hazard families to the vacuum and thermal work already described: cryogenics and steam. Cryogenic traps are the more dangerous of the two because they seem benign. A dry-ice and solvent slush at about −78 °C and liquid nitrogen at about −196 °C both cause contact cold burns through ordinary nitrile gloves in seconds, and cold does not produce the immediate withdrawal reflex heat does, so contact lasts longer; cryogenic-rated gloves, a face shield when pouring liquid nitrogen, and closed shoes are the minimum. No cryogenic vessel is ever sealed, because a sealed dewar or trap is a pressure vessel with a continuously evaporating contents, and a trap isolated between two closed valves while still cold will pressurise violently as it warms — traps get a defined venting path and are warmed deliberately with the vacuum broken and a vent open. Liquid nitrogen has a specific additional hazard that belongs on this page: a liquid-nitrogen trap left open to the atmosphere condenses oxygen out of the air, because oxygen liquefies at about −183 °C, well above liquid nitrogen temperature, and liquid oxygen in contact with organic residue in a trap is an oxidiser-plus-fuel combination that has caused violent events — so a liquid-nitrogen trap is used under vacuum, not open to air, and it is never allowed to accumulate organic residue and liquid oxygen together. Nitrogen and CO2 both displace air in an enclosed space and are asphyxiants, so the room needs ventilation and, where quantities are significant, oxygen-depletion monitoring. Steam distillation brings ordinary but underestimated hazards: a steam generator is a pressure vessel and requires a relief device, a pressure gauge and a low-water cutout, and the classic failure is a blocked vapour path — a plugged condenser, a closed valve, a packed bed that has swollen and sealed — turning an open still into a pressurised one, so there must be a relief path that cannot be isolated by any valve an operator can close. Steam burns are worse than hot-water burns because of the latent heat released on condensation; joints, seals and the receiver connection are where steam escapes, and they are checked cold and never adjusted hot. Finally, the recovered product itself is a hazard class of its own: concentrated terpenes are flammable liquids with low flash points, they are potent skin and eye irritants and sensitisers at concentration, some oxidise on storage to more sensitising products, and they attack many plastics and elastomers — so store them cold, dark, full and sealed in compatible containers, handle them with gloves and eye protection, and treat them as flammable inventory in the fire-load calculation for the room.',
        bullets: F([
          'Cryogenic-rated gloves and a face shield; cold burns accumulate without a withdrawal reflex.',
          'Never seal or valve-isolate a cold trap; warm it with a vent open.',
          'Never leave a liquid-nitrogen trap open to air — it condenses liquid oxygen onto organic residue.',
          'Nitrogen and CO2 displace air: ventilation, and oxygen monitoring at significant quantities.',
          'Steam generators are pressure vessels: relief device, gauge, low-water cutout, and a relief path no valve can isolate.',
          'Check steam joints cold, never adjust them hot; steam burns are worse than water burns.',
          'Concentrated terpenes are low-flash-point flammable irritants and sensitisers that attack plastics — cold, dark, full, sealed, compatible containers.',
        ]),
        cites: F(['prudent2011', 'nfpa', 'osha1910', 'armarego2017', 'tradepractice']),
      }),
    ]),
    seeAlso: F(['terpenes/vaporization-bands', 'terpenes/myrcene', 'terpenes/beta-caryophyllene', 'botanicals/helichrysum', 'products/terpene-blending', 'processing/short-path-distillation', 'processing/decarboxylation', 'coa/panels', 'equipment/vacuum']),
    cites: F(['vkfri2026', 'namdar2018', 'gieringer2004', 'perry2019', 'armarego2017', 'tradepractice', 'prudent2011', 'nfpa', 'osha1910']),
  }),

]);

export default { SHELF, CITES, PAGES };
