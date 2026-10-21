// products.mjs — the Product Formulation shelf: turning a cannabinoid extract into a finished product.
//
// WHAT THIS SHELF IS. The formulation-engineering reference for the stage after extraction and
// refinement: you have distillate or isolate in a jar and you now have to make something a person
// can actually use, at a dose you can defend, in hardware that will not fail. Five pages. Terpene
// blending covers why distillate needs its volatile fraction put back, at what inclusion rates, and
// how a cultivar profile is reconstructed from a GC panel. Viscosity and CBT is the vape-formulation
// engineering page, and it treats cannabitriol seriously as a working material rather than a
// curiosity. Carriers and diluents is a material-by-material reference organised by ROUTE, because
// the single most expensive mistake in this industry was treating food-safe as inhalation-safe.
// Edibles is dose-uniformity science. CBN production is the one cannabinoid conversion that is
// simply storage chemistry run deliberately.
//
// WHERE THE MATERIAL COMES FROM. The primary phytochemistry literature (Turner and ElSohly on the
// constituent inventory and the cannabinol decomposition pathway; Chan on the structure of
// cannabitriol; Hanus on the unified phytocannabinoid inventory), the e-cigarette aerosol-chemistry
// literature (Jensen, Sleiman, Kosmider, Meehan-Atrash and Strongin), the EVALI outbreak record
// (CDC field epidemiology, the bronchoalveolar-lavage work, and the ketene-pyrolysis chemistry), the
// human cannabinoid pharmacokinetics literature (Huestis, Wall, Lemberger), the edible label-accuracy
// audit literature (Vandrey), and trade practice where no citable source exists — which is labelled
// as such with evidence: 'industry practice' rather than dressed up as published fact.
//
// WHAT THIS SHELF DELIBERATELY DOES NOT CONTAIN. No preparative or synthetic procedure for making an
// intoxicating cannabinoid: no reagents, catalysts, solvents, equivalents, temperatures, reaction
// times, work-ups or yields for acid-catalysed isomerisation of CBD, for side-chain homologation to
// the C7 series, or for acetylation. Those conversions are referred to as existing in the cited
// literature and never reproduced. The CBN page is the deliberate exception in subject only, not in
// kind: CBN formation is oxidative degradation that happens in every badly stored jar, so the
// conditions that cause it are the same facts as the conditions to avoid, and they are presented as
// degradation kinetics and storage science, monitored by assay, not as a recipe. No dosing
// recommendations and no individualised medical advice: where doses appear they are the arithmetic of
// labelling and uniformity, not instructions to take anything.
//
// NO IDENTIFIERS WERE RESOLVED IN THIS PASS. Every citation below carries verified: false with the
// bibliographic details recorded from the literature and no DOI, PMID or patent number. That is
// deliberate per the shelf spec: an unresolved citation is honest, a guessed identifier is a defect.

const F = Object.freeze;

export const SHELF = F({
  id: 'products',
  title: 'Product Formulation',
  blurb: 'From refined extract to finished product: terpene reintroduction and strain-profile reconstruction, vape viscosity and crystallisation with cannabitriol treated as a working material, carriers and diluents ranked by route with the EVALI case told properly, edible dose uniformity, and deliberate CBN production as controlled oxidative aging.',
  updated: '2026-09-27',
});

/**
 * CITES — this shelf's bibliography.
 *
 * verified: false  bibliographic details recorded from the literature; no identifier resolved in
 *                  this pass. Render with an unverified marker. Never guess an identifier.
 */
export const CITES = F({
  // ── phytochemistry and the constituent inventory ─────────────────────────────────────────────────
  turner1980: { authors: 'Turner CE, ElSohly MA, Boeren EG', year: 1980, title: 'Constituents of Cannabis sativa L. XVII. A review of the natural constituents', journal: 'Journal of Natural Products', verified: false },
  turner1979: { authors: 'Turner CE, ElSohly MA', year: 1979, title: 'Constituents of Cannabis sativa L. XVI. A possible decomposition pathway of Δ9-tetrahydrocannabinol to cannabinol', journal: 'Journal of Heterocyclic Chemistry', verified: false },
  elsohly2005: { authors: 'ElSohly MA, Slade D', year: 2005, title: 'Chemical constituents of marijuana: the complex mixture of natural cannabinoids', journal: 'Life Sciences', verified: false },
  elsohly2014: { authors: 'ElSohly MA, Gul W', year: 2014, title: 'Constituents of Cannabis sativa', journal: 'Handbook of Cannabis (Pertwee RG, ed.), Oxford University Press', verified: false },
  hanus2016: { authors: 'Hanuš LO, Meyer SM, Muñoz E, Taglialatela-Scafati O, Appendino G', year: 2016, title: 'Phytocannabinoids: a unified critical inventory', journal: 'Natural Product Reports', verified: false },
  chan1976: { authors: 'Chan WR, Magnus KE, Watson HA', year: 1976, title: 'The structure of cannabitriol', journal: 'Experientia', verified: false },
  obata1966: { authors: 'Obata Y, Ishikawa Y', year: 1966, title: 'Studies on the constituents of hemp plant (Cannabis sativa L.)', journal: 'Bulletin of the Agricultural Chemical Society of Japan', verified: false, note: 'Cited for the first report of the constituent later characterised as cannabitriol. The 1966 paper did not assign the triol structure; that came with Chan 1976.' },
  boeren1979: { authors: 'Boeren EG, ElSohly MA, Turner CE', year: 1979, title: 'Cannabiripsol: a novel Cannabis constituent', journal: 'Experientia', verified: false },
  radwan2008: { authors: 'Radwan MM, ElSohly MA, Slade D, Ahmed SA, Khan IA, Ross SA', year: 2008, title: 'Isolation and characterization of new Cannabis constituents from a high potency variety', journal: 'Planta Medica', verified: false },
  pollastro2018: { authors: 'Pollastro F, Minassi A, Fresu LG', year: 2018, title: 'Cannabis phenolics and their bioactivities', journal: 'Current Medicinal Chemistry', verified: false },

  // ── terpenes, aroma and the entourage question ────────────────────────────────────────────────────
  russo2011: { authors: 'Russo EB', year: 2011, title: 'Taming THC: potential cannabis synergy and phytocannabinoid-terpenoid entourage effects', journal: 'British Journal of Pharmacology', verified: false },
  santiago2019: { authors: 'Santiago M, Sachdev S, Arnold JC, McGregor IS, Connor M', year: 2019, title: 'Absence of entourage: terpenoids commonly found in Cannabis sativa do not modulate the functional activity of Δ9-THC at human CB1 and CB2 receptors', journal: 'Cannabis and Cannabinoid Research', verified: false },
  lavigne2021: { authors: 'LaVigne JE, Hecksel R, Keresztes A, Streicher JM', year: 2021, title: 'Cannabis sativa terpenes are cannabimimetic and selectively enhance cannabinoid activity', journal: 'Scientific Reports', verified: false },
  booth2019: { authors: 'Booth JK, Bohlmann J', year: 2019, title: 'Terpenes in Cannabis sativa — from plant genome to humans', journal: 'Plant Science', verified: false },
  sommano2020: { authors: 'Sommano SR, Chittasupho C, Ruksiriwanich W, Jantrawut P', year: 2020, title: 'The cannabis terpenes', journal: 'Molecules', verified: false },
  giese2015: { authors: 'Giese MW, Lewis MA, Giese L, Smith KM', year: 2015, title: 'Development and validation of a reliable and robust method for the analysis of cannabinoids and terpenes in cannabis', journal: 'Journal of AOAC International', verified: false },
  hazekamp2012: { authors: 'Hazekamp A, Fischedick JT', year: 2012, title: 'Cannabis — from cultivar to chemovar', journal: 'Drug Testing and Analysis', verified: false },
  gilbert2018: { authors: 'Gilbert AN, DiVerdi JA', year: 2018, title: 'Consumer perceptions of strain differences in Cannabis aroma', journal: 'PLOS ONE', verified: false },
  brenneisen2007: { authors: 'Brenneisen R', year: 2007, title: 'Chemistry and analysis of phytocannabinoids and other Cannabis constituents', journal: 'Marijuana and the Cannabinoids (ElSohly MA, ed.), Humana Press', verified: false },
  meehan2017: { authors: 'Meehan-Atrash J, Luo W, Strongin RM', year: 2017, title: 'Toxicant formation in dabbing: the terpene story', journal: 'ACS Omega', verified: false },
  meehan2019: { authors: 'Meehan-Atrash J, Luo W, McWhirter KJ, Strongin RM', year: 2019, title: 'Aerosol gas-phase components from cannabis e-cigarettes and dabbing: mechanistic insight and quantitative risk analysis', journal: 'ACS Omega', verified: false },

  // ── vape aerosol chemistry, diluents and EVALI ────────────────────────────────────────────────────
  jensen2015: { authors: 'Jensen RP, Luo W, Pankow JF, Strongin RM, Peyton DH', year: 2015, title: 'Hidden formaldehyde in e-cigarette aerosols', journal: 'New England Journal of Medicine (letter)', verified: false },
  sleiman2016: { authors: 'Sleiman M, Logue JM, Montesinos VN, Russell ML, Litter MI, Gundel LA, Destaillats H', year: 2016, title: 'Emissions from electronic cigarettes: key parameters affecting the release of harmful chemicals', journal: 'Environmental Science & Technology', verified: false },
  kosmider2014: { authors: 'Kosmider L, Sobczak A, Fik M, Knysak J, Zaciera M, Kurek J, Goniewicz ML', year: 2014, title: 'Carbonyl compounds in electronic cigarette vapors: effects of nicotine solvent and battery output voltage', journal: 'Nicotine & Tobacco Research', verified: false },
  blount2020: { authors: 'Blount BC, Karwowski MP, Shields PG, et al. (Lung Injury Response Laboratory Working Group)', year: 2020, title: 'Vitamin E acetate in bronchoalveolar-lavage fluid associated with EVALI', journal: 'New England Journal of Medicine', verified: false },
  krishnasamy2020: { authors: 'Krishnasamy VP, Hallowell BD, Ko JY, et al.', year: 2020, title: 'Update: characteristics of a nationwide outbreak of e-cigarette, or vaping, product use-associated lung injury — United States, August 2019-January 2020', journal: 'Morbidity and Mortality Weekly Report (MMWR) 69(3):90-94, U.S. Centers for Disease Control and Prevention', doi: '10.15585/mmwr.mm6903e2', verified: 'crossref' },
  cdcEvali: { authors: 'U.S. Centers for Disease Control and Prevention', year: 2020, title: 'Outbreak of lung injury associated with the use of e-cigarette, or vaping, products: final outbreak surveillance summary', journal: 'CDC outbreak surveillance record', verified: false, note: 'Case and death totals quoted on this shelf are the CDC final surveillance figures as reported in the 2020 closure of the outbreak investigation. No identifier resolved.' },
  lanzarotta2020: { authors: 'Lanzarotta A, Falconer TM, Flurer R, Wilson RA', year: 2020, title: 'Hydrogen bonding between tetrahydrocannabinol and vitamin E acetate in unvaped, aerosolized, and condensed aerosol e-liquids', journal: 'Analytical Chemistry', verified: false },
  wu2020: { authors: "Wu D, O'Shea DF", year: 2020, title: 'Potential for release of pulmonary toxic ketene from vaping pyrolysis of vitamin E acetate', journal: 'Proceedings of the National Academy of Sciences', verified: false },
  marchiori2011: { authors: 'Marchiori E, Zanetti G, Mano CM, Hochhegger B', year: 2011, title: 'Exogenous lipoid pneumonia: clinical and radiological manifestations', journal: 'Respiratory Medicine', verified: false },
  rowe2020: { authors: 'Rowe RC, Sheskey PJ, Cook WG, Fenton ME (eds.)', year: 2020, title: 'Handbook of Pharmaceutical Excipients', journal: 'Pharmaceutical Press / American Pharmacists Association', verified: false },
  fdaInhalation: { authors: 'U.S. Food and Drug Administration', year: 2020, title: 'Statements and guidance on the distinction between substances generally recognized as safe for ingestion and substances evaluated for inhalation exposure', journal: 'FDA regulatory guidance and public statements', verified: false, note: 'Cited for the regulatory principle that a GRAS food determination carries no inhalation-safety finding. Recorded as a principle, not as a single numbered document.' },

  // ── emulsions and oral bioavailability ────────────────────────────────────────────────────────────
  mcclements2012: { authors: 'McClements DJ', year: 2012, title: 'Nanoemulsions versus microemulsions: terminology, differences, and similarities', journal: 'Soft Matter', verified: false },
  cherniakov2017: { authors: 'Cherniakov I, Izgelov D, Barasch D, Davidson E, Domb AJ, Hoffman A', year: 2017, title: 'Piperine-pro-nanolipospheres as a novel oral delivery system of cannabinoids: pharmacokinetic evaluation in healthy volunteers in comparison to buccal spray administration', journal: 'Journal of Controlled Release', verified: false },
  izgelov2020: { authors: 'Izgelov D, Domb AJ, Hoffman A', year: 2020, title: 'The effect of piperine pro-nanolipospheres on direct intestinal phase II metabolism: the raloxifene paradigm of enhanced oral bioavailability, and related cannabinoid work', journal: 'European Journal of Pharmaceutical Sciences', verified: false },
  millar2018: { authors: "Millar SA, Stone NL, Yates AS, O'Sullivan SE", year: 2018, title: 'A systematic review on the pharmacokinetics of cannabidiol in humans', journal: 'Frontiers in Pharmacology', verified: false },
  zgair2016: { authors: 'Zgair A, Wong JC, Lee JB, et al.', year: 2016, title: 'Dietary fats and pharmaceutical lipid excipients increase systemic exposure to orally administered cannabis and cannabis-based medicines', journal: 'American Journal of Translational Research', verified: false },

  // ── oral pharmacokinetics and the edible problem ──────────────────────────────────────────────────
  huestis2007: { authors: 'Huestis MA', year: 2007, title: 'Human cannabinoid pharmacokinetics', journal: 'Chemistry & Biodiversity', verified: false },
  lemberger1972: { authors: 'Lemberger L, Crabtree RE, Rowe HM', year: 1972, title: '11-Hydroxy-Δ9-tetrahydrocannabinol: pharmacology, disposition, and metabolism of a major metabolite of marihuana in man', journal: 'Science', verified: false },
  wall1983: { authors: 'Wall ME, Sadler BM, Brine D, Taylor H, Perez-Reyes M', year: 1983, title: 'Metabolism, disposition, and kinetics of delta-9-tetrahydrocannabinol in men and women', journal: 'Clinical Pharmacology & Therapeutics', verified: false },
  vandrey2015: { authors: 'Vandrey R, Raber JC, Raber ME, Douglass B, Miller C, Bonn-Miller MO', year: 2015, title: 'Cannabinoid dose and label accuracy in edible medical cannabis products', journal: 'JAMA', verified: false },
  monte2019: { authors: 'Monte AA, Shelton SK, Mills E, et al.', year: 2019, title: 'Acute illness associated with cannabis use, by route of exposure: an observational study', journal: 'Annals of Internal Medicine', verified: false },
  barrus2016: { authors: 'Barrus DG, Capogrossi KL, Cates SC, et al.', year: 2016, title: 'Tasty THC: promises and challenges of cannabis edibles', journal: 'Methods Report, RTI Press', verified: false },

  // ── stability, storage and CBN ────────────────────────────────────────────────────────────────────
  fairbairn1976: { authors: 'Fairbairn JW, Liebmann JA, Rowan MG', year: 1976, title: 'The stability of cannabis and its preparations on storage', journal: 'Journal of Pharmacy and Pharmacology', verified: false },
  trofin2012: { authors: 'Trofin IG, Dabija G, Vâiareanu DI, Filipescu L', year: 2012, title: 'The influence of long-term storage conditions on the stability of cannabinoids derived from cannabis resin', journal: 'Revista de Chimie', verified: false },
  zamengo2019: { authors: 'Zamengo L, Bettin C, Badocco D, Di Marco V, Miolo G, Frison G', year: 2019, title: 'The role of time and storage conditions on the composition of hashish and marijuana samples: a four-year study', journal: 'Forensic Science International', verified: false },
  wang2016: { authors: 'Wang M, Wang YH, Avula B, Radwan MM, Wanas AS, van Antwerp J, Parcher JF, ElSohly MA, Khan IA', year: 2016, title: 'Decarboxylation study of acidic cannabinoids: a novel approach using ultra-high-performance supercritical fluid chromatography/photodiode array-mass spectrometry', journal: 'Cannabis and Cannabinoid Research', verified: false },
  hazekamp2007: { authors: 'Hazekamp A', year: 2007, title: 'Cannabis; extracting the medicine', journal: 'Doctoral thesis, Leiden University', verified: false },
  corroon2021: { authors: 'Corroon J', year: 2021, title: 'Cannabinol and sleep: separating fact from fiction', journal: 'Cannabis and Cannabinoid Research', verified: false },
  karniol1975: { authors: 'Karniol IG, Shirakawa I, Takahashi RN, Knobel E, Musty RE', year: 1975, title: 'Effects of Δ9-tetrahydrocannabinol and cannabinol in man', journal: 'Pharmacology', verified: false },
  perezreyes1973: { authors: 'Perez-Reyes M, Timmons MC, Davis KH, Wall EM', year: 1973, title: 'A comparison of the pharmacological activity in man of intravenously administered Δ9-tetrahydrocannabinol, cannabinol, and cannabidiol', journal: 'Experientia', verified: false },
  rhee1997: { authors: 'Rhee MH, Vogel Z, Barg J, Bayewitch M, Levy R, Hanuš L, Breuer A, Mechoulam R', year: 1997, title: 'Cannabinol derivatives: binding to cannabinoid receptors and inhibition of adenylylcyclase', journal: 'Journal of Medicinal Chemistry', verified: false },
  showalter1996: { authors: 'Showalter VM, Compton DR, Martin BR, Abood ME', year: 1996, title: 'Evaluation of binding in a transfected cell line expressing a peripheral cannabinoid receptor (CB2): identification of cannabinoid receptor subtype selective ligands', journal: 'Journal of Pharmacology and Experimental Therapeutics', verified: false },

  // ── industry practice, no citable source ──────────────────────────────────────────────────────────
  tradePractice: { authors: 'MELEK hemp-science shelf, compiled from processor and formulator practice', year: 2026, title: 'Trade practice note: formulation parameters in common commercial use for which no peer-reviewed source was located', journal: 'MELEK wiki, hemp-science section', verified: false, note: 'Used wherever a number is real working practice rather than a published result. Sections citing this key carry evidence: industry practice.' },
});

/**
 * PAGES — each becomes one wiki page at /science/products/<slug>.
 */
export const PAGES = F([

  // ══ TERPENE BLENDING ════════════════════════════════════════════════════════════════════════════
  F({
    slug: 'terpene-blending',
    title: 'Terpene Reintroduction and Strain-Profile Reconstruction',
    kind: 'tool',
    summary: 'Distillation strips the volatile fraction by design, which is why refined cannabinoid extract is potent and characterless. This page covers putting it back: inclusion rates by product type, miscibility and blending temperature, how a cultivar profile is rebuilt from a GC panel and what that reconstruction cannot recover, botanical versus cannabis-derived stocks, and where the flavour claim ends and the effect claim starts.',
    facts: F({
      'Typical vape-cartridge inclusion': 'about 2 to 5 percent by mass of the finished formulation',
      'Upper practical bound for a cartridge': 'about 8 to 10 percent, where viscosity and hardware compatibility become limiting',
      'Typical tincture or edible inclusion': 'well under 1 percent, usually a fraction of a percent; flavour tolerance is the constraint',
      'Typical topical inclusion': 'about 0.5 to 2 percent of the finished topical; skin tolerance is the constraint',
      'Blending temperature': 'gentle warming to about 40 to 60 °C, enough to drop viscosity for mixing',
      'Monoterpene boiling points': 'roughly 155 to 180 °C at atmospheric pressure',
      'Sesquiterpene boiling points': 'roughly 210 to 270 °C at atmospheric pressure',
      'What a GC terpene panel reports': 'a selected target list, typically 10 to 40 compounds, not the whole volatile fraction',
    }),
    sections: F([
      F({
        h: 'Why refined extract has no character, and why that is the point',
        body: 'Distillation separates by volatility, and the cannabinoids are the least volatile thing of interest in the extract. A short-path or wiped-film run is therefore designed to drive off everything lighter than the cannabinoid fraction first: water, residual solvent, and the entire mono- and sesquiterpene complement. That is not a defect of the process, it is the process working. The consequence is that the material that comes off the main body is potent, pale, chemically simple and organoleptically dead. It has no cultivar identity because the molecules that carry cultivar identity have been removed several stages earlier. Terpene reintroduction is the formulation step that gives the product back an aroma, a flavour and a market position, and in a vape it also changes the rheology of the fill in ways that matter more than the flavour does.',
        bullets: F([
          'The volatile fraction is a small mass share of the flower and a very small mass share of the concentrate, but it carries essentially all of the aroma.',
          'A terpene recovery step during processing can capture some of the original fraction for later reintroduction; most operations instead buy stocks and blend.',
          'Aroma is the first thing a buyer evaluates and the only property they can assess before purchase, which is why this step gets disproportionate commercial attention.',
        ]),
        cites: F(['booth2019', 'sommano2020', 'brenneisen2007', 'hazekamp2007']),
        evidence: 'human',
      }),
      F({
        h: 'Inclusion rates by product type',
        body: 'Inclusion rate is bounded at both ends and the bounds are different for every route. In a vape cartridge the usual working band is about 2 to 5 percent terpene by mass of the finished fill. Below roughly 1 to 2 percent the draw is harsh and flavourless, because the terpene fraction is doing double duty as the flavour and as the thing that softens the aerosol. Above roughly 8 to 10 percent two separate problems arrive together: the fill becomes thin enough to leak past the wick and the seals of a cartridge designed for a thicker liquid, and the terpene load itself becomes a meaningful share of what is being inhaled and thermally decomposed. In edibles and tinctures the constraint is not rheology but the palate, and useful inclusion is a fraction of a percent; terpenes are aggressive flavours at a level far below where they change viscosity. In topicals the constraint is skin tolerance, since several common terpenes are documented dermal irritants and sensitisers at high load, so finished topicals typically sit under a couple of percent.',
        table: F({
          cols: F(['Product', 'Typical inclusion (mass %)', 'What sets the lower bound', 'What sets the upper bound']),
          rows: F([
            F(['Vape cartridge, distillate base', '2 to 5', 'Harsh, flavourless draw below about 1 to 2', 'Viscosity loss, leakage, hardware fit above about 8 to 10']),
            F(['Vape cartridge, isolate-heavy base', '3 to 8', 'Isolate alone is unusable in hardware', 'Same hardware limit; terpene is also the anti-crystallisation diluent']),
            F(['Dab or concentrate for flavour', '1 to 5', 'Detectability', 'Thermal decomposition at dab temperatures']),
            F(['Tincture, oil base', '0.1 to 0.5', 'Detectability', 'Palate; terpene bitterness and burn']),
            F(['Edible or beverage', 'under 0.1 typically', 'Detectability in a flavoured matrix', 'Palate, and emulsion stability']),
            F(['Topical', '0.5 to 2', 'Aroma expectation', 'Dermal irritation and sensitisation']),
          ]),
        }),
        cites: F(['tradePractice', 'sommano2020', 'meehan2019']),
        evidence: 'industry practice',
        contested: true,
        caveat: 'These bands are working commercial practice compiled from formulator and processor use, not values from a published study. They vary with hardware, cannabinoid profile and the specific terpene stock. Treat them as starting points to be confirmed empirically in your own hardware, not as specifications.',
      }),
      F({
        h: 'Solubility, miscibility and why a blend can come apart',
        body: 'Terpenes are lipophilic hydrocarbons and hydrocarbon derivatives, and cannabinoid distillate is a lipophilic resin, so at the crude level the two are freely miscible and mixing is not a solubility problem. The differences that matter are within the terpene fraction itself. Individual terpenes span a wide range of polarity and a wider range of volatility: an oxygenated monoterpene such as linalool or 1,8-cineole is measurably more polar than a pure hydrocarbon monoterpene such as alpha-pinene, and the sesquiterpenes boil 60 to 100 °C higher than the monoterpenes. Three practical consequences follow. A blend that looks homogeneous immediately after mixing can stratify slowly if a component is near its solubility limit in the resin, particularly where a polar oxygenated component is loaded heavily. A blend exposed to warmth or open headspace loses its lightest components preferentially, so the ratio drifts toward the sesquiterpenes over time and the product smells different at the end of a production run than at the start. And a blend introduced into hot distillate flashes off exactly the monoterpenes that were the most expensive part of the stock.',
        bullets: F([
          'Blend into warm, not hot, material. Gentle warming to roughly 40 to 60 °C drops the viscosity of distillate enough to mix without driving off the light ends.',
          'Every 20 °C above that costs monoterpenes you have already paid for, and the loss is selective, so it changes the profile and not just the total.',
          'Mix in a closed or headspace-minimised vessel, and mix to full homogeneity before filling. A cartridge filled from a partially mixed batch is a concentration gradient with a label on it.',
          'Stratification is a QC question, not a theoretical one: pull from top and bottom of a held vessel and assay, rather than assuming a blend stays blended.',
          'Terpene stocks themselves oxidise. Alpha-pinene and limonene form oxidation products on storage in air, so stock age and headspace history are part of the formulation record.',
        ]),
        cites: F(['sommano2020', 'booth2019', 'tradePractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Strain-profile reconstruction from a GC panel: the arithmetic',
        body: 'The trade practice of rebuilding a named cultivar profile from its laboratory terpene panel is straightforward arithmetic and it is worth spelling out because the honest limits live in the arithmetic rather than in the chemistry. A GC terpene panel reports each target compound as a mass percentage of the sample, typically flower. Step one is to sum the reported terpenes to get the total reported volatile fraction for that sample; that sum is usually somewhere between about 0.5 and 3 percent of flower mass. Step two is to divide each individual compound by that sum, which normalises the panel to relative percentages of the reported fraction and removes the effect of how terpene-rich that particular harvest was. Step three is to treat those normalised relative percentages as the recipe: to make 100 g of terpene blend you weigh out that many grams of each individual terpene stock. Step four is to decide the inclusion rate of the finished blend into the product, which is an independent decision from the ratio and is governed by the table above. A worked example: a panel reporting 0.62 percent myrcene, 0.31 percent beta-caryophyllene, 0.21 percent limonene, 0.14 percent alpha-pinene and 0.12 percent linalool sums to 1.40 percent; normalised, that is 44.3, 22.1, 15.0, 10.0 and 8.6 percent of the blend, and at a 4 percent inclusion rate a 1000 g batch of finished formulation takes 40 g of blend made from 17.7 g myrcene, 8.8 g beta-caryophyllene, 6.0 g limonene, 4.0 g alpha-pinene and 3.4 g linalool.',
        bullets: F([
          'Normalise, do not copy. The absolute percentages in a panel describe how much terpene that harvest had; only the ratios describe what it smelled like.',
          'Panels are usually reported on flower. A panel from concentrate has already been through a process that changed the ratio, so it describes the concentrate rather than the cultivar.',
          'Chirality is invisible in most panels. Alpha-pinene has two enantiomers with recognisably different odour, and a panel reporting a single alpha-pinene figure does not tell you which one, or in what ratio, the plant made.',
          'Weigh by mass, not by volume. Terpene densities differ enough that a volumetric shortcut moves the ratio.',
        ]),
        cites: F(['giese2015', 'hazekamp2012', 'sommano2020', 'tradePractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'What a reconstruction cannot recover',
        body: 'The reconstruction is faithful to the panel, and the panel is not faithful to the plant. A GC terpene method quantifies a selected target list, because quantification requires a reference standard for every analyte and a laboratory stocks standards for the compounds its customers ask about. A cultivar volatile profile, as characterised in the research literature, contains well over a hundred compounds, and the trace constituents include classes a cannabis terpene panel does not look for at all — most notably volatile sulfur compounds, which are present at parts-per-billion levels and are the documented source of some of the most distinctive and commercially prized aromas in modern cultivars. A blend rebuilt from a 20-compound panel therefore reproduces the ratio of the twenty compounds that were measured and omits everything that was not on the list, which is disproportionately the material that made the cultivar recognisable. The result usually smells like a competent generic version of the cultivar and not like the cultivar. This is a limitation of the method, honestly stated; it is not a reason not to do it, and it is the reason a reconstructed blend and a recovered native fraction are not the same product.',
        bullets: F([
          'You cannot rebuild what was never measured. The gap between a target list and a full volatile profile is the whole gap between a reconstruction and the original.',
          'Non-terpene volatiles — thiols and other sulfur compounds, esters, aldehydes — are frequently outside the panel scope and frequently the signature.',
          'Matrix matters. The same blend on distillate, on a live-resin base and on flower does not present the same way, because the base contributes and because volatilisation in hardware is not the same event as combustion.',
          'Honest labelling: a reconstructed profile is a cultivar-inspired blend. Describing it as the cultivar is a claim the arithmetic does not support.',
        ]),
        cites: F(['giese2015', 'booth2019', 'sommano2020', 'gilbert2018']),
        evidence: 'human',
      }),
      F({
        h: 'Botanical versus cannabis-derived terpenes',
        body: 'When a botanical stock and a cannabis-derived fraction contain the same molecule, they contain the same molecule: beta-caryophyllene from black pepper or clove is the same compound as beta-caryophyllene from cannabis, and no analysis distinguishes them at the single-compound level except by isotope ratio work that nobody in this trade does. That settles the chemistry and leaves four real differences. Cost and availability: single botanical terpenes are commodity flavour and fragrance materials produced at industrial scale and priced accordingly, while a cannabis-derived terpene fraction is a low-yield co-product of a cannabinoid process and costs one to two orders of magnitude more per unit mass. Purity and specification: a food- or fragrance-grade botanical isolate comes with a specification, a lot number and often a documented purity that a cannabis-derived fraction does not. Composition: this is the substantive one — a cannabis-derived fraction is not a set of terpenes, it is everything volatile that came off that material, which includes minor cannabinoids carried over in the fraction, oxidation products, and the trace non-terpene volatiles a botanical blend cannot contain by construction. And regulation: botanical terpene stocks sit inside established flavour and fragrance regulatory frameworks with defined food-use status, whereas a cannabis-derived fraction inherits the regulatory status of the cannabis it came from, which is jurisdiction-dependent and can make an otherwise identical product a controlled item.',
        table: F({
          cols: F(['Axis', 'Botanical / synthetic-nature-identical', 'Cannabis-derived fraction']),
          rows: F([
            F(['The molecules themselves', 'Identical where the compound is the same', 'Identical where the compound is the same']),
            F(['Cost per unit mass', 'Commodity; low', 'One to two orders of magnitude higher']),
            F(['Specification and lot documentation', 'Usually available, food or fragrance grade', 'Often minimal']),
            F(['Minor cannabinoids present', 'None', 'Yes, carried over in the fraction']),
            F(['Trace non-terpene volatiles', 'Only what the blender adds', 'Present, and part of why it smells right']),
            F(['Regulatory status', 'Flavour and fragrance frameworks', 'Inherits the cannabis status of the source']),
            F(['Batch-to-batch consistency', 'High', 'Varies with the source material']),
          ]),
        }),
        cites: F(['sommano2020', 'booth2019', 'tradePractice', 'rowe2020']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Flavour versus effect, stated honestly',
        body: 'Two claims travel together in the trade and they have completely different evidential standing. The flavour and aroma claim is immediate, large, reproducible and uncontroversial: adding a terpene blend to a characterless distillate changes what the product smells and tastes like, a user can detect the change reliably, and the effect is present at inclusion levels of a couple of percent. Nobody disputes this and it does not need a citation to a receptor study. The effect claim — that the ratio of terpenes in a product steers the character of the cannabinoid experience, so that one blend is sedating and another is energising — is popular, commercially load-bearing, and weakly supported in humans at these inclusion levels. The pharmacological arguments on the sceptical side are concrete: the terpene mass delivered in a few puffs of a 4 percent blend is small, the plasma concentrations that would result are far below the concentrations at which most terpenes show activity in vitro, and a direct functional study of common cannabis terpenoids at human CB1 and CB2 found no modulation of Δ9-THC signalling. The arguments on the other side are also real: some terpenes have documented activity at non-cannabinoid targets, beta-caryophyllene is a genuine CB2 agonist in its own right rather than a modulator, and a rodent study reported cannabimimetic and cannabinoid-enhancing behaviour for several cannabis terpenes. What is missing is the human dose-response work at realistic product inclusion levels. Until that exists, the correct position is that the flavour effect is established and the effect-steering claim is a hypothesis that the market has already priced as if it were settled.',
        bullets: F([
          'Established: terpene reintroduction changes aroma and flavour, and changes the harshness of a vape draw.',
          'Established: beta-caryophyllene binds and activates CB2 directly, which is a pharmacological fact about that one compound, not evidence for ratio-steering generally.',
          'Not established: that a 2 to 5 percent blend at typical use volumes reaches concentrations that modulate the subjective cannabinoid experience in humans.',
          'Confound: expectation. A product that smells strongly of a cultivar the user associates with a given effect is not a blinded comparison, and almost no trade evidence is blinded.',
        ]),
        cites: F(['russo2011', 'santiago2019', 'lavigne2021', 'gilbert2018', 'sommano2020']),
        contested: true,
        caveat: 'The effect-modulation claim is genuinely disputed. Russo 2011 set out the entourage hypothesis and remains the most-cited case for it; Santiago 2019 found no modulation of Δ9-THC activity at human CB1 or CB2 by common cannabis terpenoids in a functional assay; LaVigne 2021 reported cannabimimetic and enhancing effects in mice. In-vitro and rodent findings at applied concentrations do not establish a human effect at product inclusion levels. The aroma and flavour claim is not contested; only the effect claim is.',
        evidence: 'in vitro',
      }),
      F({
        h: 'Thermal fate: what happens to the blend in the hardware',
        body: 'A terpene blend is not inert in use. At vaporiser coil temperatures and at dab temperatures terpenes do not merely evaporate; they partially degrade, and the degradation chemistry is documented. Monoterpenes in particular are established precursors of aromatic degradation products under the thermal conditions of dabbing, and the same chemistry operates in a cartridge driven hard or run dry. This has two formulation consequences that are usually ignored. First, the aerosol a user inhales is not the blend you formulated, so a blend chosen purely for how it smells cold is a partial description of the product. Second, terpene load and device power interact: raising inclusion rate and raising coil temperature push in the same direction on degradation-product formation. This is the same reasoning that makes the diluent question on the viscosity page a safety question and not a rheology question — anything added to an inhaled formulation is being chosen as a pyrolysis feedstock whether the formulator thinks of it that way or not.',
        bullets: F([
          'Terpene degradation products documented from cannabis concentrate thermal studies include aromatic hydrocarbons and reactive carbonyls; formation rises with temperature.',
          'Running a cartridge dry or at high power is the worst case, because the residual film sees the highest temperature.',
          'A blend should be evaluated in the hardware it will ship in, hot, and not only in the jar, cold.',
        ]),
        cites: F(['meehan2017', 'meehan2019', 'sleiman2016']),
        evidence: 'in vitro',
      }),
    ]),
    seeAlso: F(['products/viscosity-and-cbt', 'products/carriers-and-diluents', 'processing/terpene-recovery', 'endocannabinoid/entourage-effect', 'terpenes/vaporization-bands', 'terpenes/beta-caryophyllene', 'terpenes/myrcene', 'formulation/adulterants', 'coa/panels']),
    cites: F(['booth2019', 'sommano2020', 'brenneisen2007', 'hazekamp2007', 'hazekamp2012', 'giese2015', 'gilbert2018', 'russo2011', 'santiago2019', 'lavigne2021', 'meehan2017', 'meehan2019', 'sleiman2016', 'rowe2020', 'tradePractice']),
  }),

  // ══ VISCOSITY AND CANNABITRIOL ══════════════════════════════════════════════════════════════════
  F({
    slug: 'viscosity-and-cbt',
    title: 'Viscosity, Crystallisation and Cannabitriol (CBT)',
    kind: 'cannabinoid',
    summary: 'The vape-formulation engineering page. Why cannabinoid distillate is too thick and some cannabinoids crystallise in a cartridge, what that does to hardware, and the full toolkit for controlling it — with cannabitriol treated properly: its structure, its class, its known members, its occurrence and isolation history, and its established working use as an anti-crystallisation and viscosity-modifying agent. Where the published record on CBT is thin, this page says so and treats the gap as an open research question rather than as doubt about the material.',
    facts: F({
      'Core problem': 'Cannabinoid distillate is a viscous resin; high-purity cannabinoid fractions crystallise in storage and in hardware',
      'Most common cartridge failure mode': 'clogging and separation from crystallisation or from an over-thinned fill',
      'Cannabitriol abbreviation': 'CBT',
      'Cannabitriol structural class': 'the cannabitriol (CBT) type, one of the recognised phytocannabinoid structural classes',
      'Cannabitriol parent skeleton': 'a 9,10-dihydroxy Δ6a(10a)-tetrahydrocannabinol; the added hydroxyls plus the phenol give the triol name',
      'Cannabitriol parent formula': 'C21H30O4, nominal mass about 346 (pentyl, C5, homolog)',
      'Principal homologs': 'CBT-C5 (pentyl) and CBT-C3 (propyl, cannabitriolvarin, CBTV)',
      'Natural abundance in Cannabis': 'trace; typically a very small fraction of one percent of total cannabinoids',
      'First report': 'Obata and Ishikawa 1966 (constituent); structure assigned by Chan, Magnus and Watson 1976',
      'Industry role': 'anti-crystallisation and viscosity-modifying additive in cannabinoid vape formulation',
      'Published rheology data': 'sparse; no peer-reviewed quantitative rheology or inhalation-toxicology study of CBT was located in this pass',
    }),
    sections: F([
      F({
        h: 'The problem: viscosity and crystallisation are two different failures',
        body: 'Cannabinoid distillate at room temperature is a resin, not a liquid — viscosity in the range of tens to hundreds of pascal-seconds depending on cannabinoid profile and temperature, which is to say it flows like cold honey or slower. That alone is a handling problem: it will not pass a filling needle at ambient temperature, it will not wick reliably in hardware designed for e-liquid, and it traps air. Crystallisation is a separate and worse failure. A cannabinoid in a near-pure state is a crystalline solid at room temperature, held in solution in the rest of the extract; when the solution is supersaturated, or is cooled, or is seeded by a crystal already present, the cannabinoid nucleates and grows crystals inside the product. In a cartridge that means a clogged wick, an unusable device, visible crystals that a customer reads as contamination, and a fill whose remaining liquid is no longer the composition on the label because part of the active has left solution. Crystallisation in the cartridge is the single most common reason a cartridge comes back.',
        bullets: F([
          'Two levers drive crystallisation: concentration relative to saturation, and temperature. Cold storage and shipping in winter are triggers.',
          'The purer the fraction, the worse the problem. A near-pure isolate has nothing in it to keep the isolate in solution.',
          'Seeding matters. A single crystal carried over from an upstream crystallisation step or a dirty vessel nucleates a whole batch.',
          'A supersaturated fill can sit clear for weeks and then crystallise in transit, which is why stability testing under thermal cycling is not optional.',
          'CBD is notoriously prone to this in high-CBD formulations; THCA and other acid forms crystallise readily; the neutral cannabinoids differ substantially from each other.',
        ]),
        cites: F(['hazekamp2007', 'tradePractice', 'elsohly2014']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Cannabitriol: structure and structural class',
        body: 'Cannabitriol is a genuine minor phytocannabinoid of Cannabis, not a synthetic additive invented by the vape trade, and it belongs to its own recognised structural class. The classifications used in the constituent literature — Turner and ElSohly in the 1980 review, ElSohly and Slade in the 2005 inventory, and Hanus in the 2016 unified critical inventory — enumerate roughly a dozen phytocannabinoid types, and cannabitriol (CBT) is one of them, sitting alongside the cannabigerol, cannabichromene, cannabidiol, tetrahydrocannabinol, cannabinol, cannabielsoin, cannabicyclol and cannabinodiol types. The parent structure is a tetrahydrocannabinol skeleton in which the Δ9 double bond is gone, a Δ6a(10a) double bond is present instead, and hydroxyl groups sit at C-9 and C-10. Counting the phenolic hydroxyl of the resorcinol ring, that is three hydroxyls on one molecule, which is where the triol name comes from. The pentyl parent is C21H30O4 with a nominal mass near 346, sixteen mass units above cannabinol and thirty-two above Δ9-THC — the difference of two oxygens, which is exactly what the biogenetic relationship implies. The hydroxylated, non-aromatic C-ring character is what distinguishes the class: cannabinol resolved the same oxidative pressure by aromatising its terpenoid ring, and cannabitriol resolved it by hydroxylating.',
        bullets: F([
          'Class membership is a structural statement, not a pharmacological one: the CBT type is defined by the 9,10-dihydroxy Δ6a(10a) arrangement.',
          'Stereochemistry is real and reported: trans and cis diastereomers exist, and the trans series has both enantiomers described in the literature.',
          'Do not confuse CBT the cannabinoid with the same three letters used elsewhere in the trade for unrelated blended additives. The chemistry above is what the literature means by cannabitriol.',
          'Do not confuse cannabitriol with cannabicitran, cannabiripsol or cannabielsoin; they are separate oxidised minor cannabinoids with separate skeletons, though cannabiripsol is polyhydroxylated and is discussed adjacent to the CBT group.',
        ]),
        cites: F(['chan1976', 'turner1980', 'elsohly2005', 'hanus2016', 'elsohly2014']),
        evidence: 'in vitro',
      }),
      F({
        h: 'Known members of the cannabitriol group',
        body: 'The constituent-inventory literature describes a small set of CBT-type compounds isolated from Cannabis, and the list is worth stating precisely because most secondary writing about CBT treats it as a single substance. The core members are the pentyl parent in its stereoisomeric forms and the propyl homolog. Beyond those, the inventories record a set of C-10 ethers, and a positional isomer with the hydroxyls at C-8 and C-9. A methodological caveat belongs with the ethers: compounds bearing a 10-ethoxy group have been isolated from ethanol-processed material, and whether they are true plant constituents or artefacts formed when ethanol adds across the enol ether during extraction is not settled in the literature. That is exactly the kind of question a shelf like this should record as open rather than resolve by assertion.',
        table: F({
          cols: F(['Compound', 'Relationship to the parent', 'Notes']),
          rows: F([
            F(['(−)-trans-cannabitriol (CBT-C5)', 'Pentyl parent, trans diastereomer', 'The compound usually meant by cannabitriol']),
            F(['(+)-trans-cannabitriol', 'Enantiomer of the above', 'Reported in the constituent literature']),
            F(['(±)-cis-cannabitriol', 'cis diastereomer', 'Reported; less discussed']),
            F(['Cannabitriol-C3 (cannabitriolvarin, CBTV)', 'Propyl side-chain homolog', 'Same relationship CBDV has to CBD']),
            F(['10-ethoxy-9-hydroxy-Δ6a(10a)-THC and its stereoisomers', 'C-10 ethyl ether of the parent', 'Possible extraction artefact of ethanolic processing; unresolved']),
            F(['8,9-dihydroxy-Δ6a(10a)-THC', 'Positional isomer of the diol', 'Reported in the inventory literature']),
            F(['Cannabiripsol', 'Adjacent polyhydroxylated constituent', 'Separate compound; grouped near CBT in some inventories']),
          ]),
        }),
        cites: F(['elsohly2005', 'turner1980', 'hanus2016', 'boeren1979', 'chan1976', 'radwan2008']),
        contested: true,
        caveat: 'The 10-ethoxy members may be artefacts of ethanolic extraction rather than true plant constituents; the literature records them without settling the question. The membership list is assembled from constituent-inventory reviews rather than from a single authoritative nomenclature standard, and naming across sources is inconsistent.',
        evidence: 'in vitro',
      }),
      F({
        h: 'Occurrence, isolation history and why it is rarely on a COA',
        body: 'Cannabitriol is a natural trace constituent of Cannabis. It was first reported from hemp by Obata and Ishikawa in 1966, as an isolate whose structure was not then assigned; the triol structure and its stereochemistry were established by Chan, Magnus and Watson in 1976, and further CBT-type constituents were characterised through the late 1970s and 1980s by the Mississippi group whose serial Constituents of Cannabis sativa papers built the constituent inventory the field still uses. Abundance is low — CBT sits well down the list of minor cannabinoids, at a level where it is a footnote in a whole-plant analysis rather than a quantified peak. Two practical facts follow. First, its concentration in plant material is far too low for the plant to be the commercial source of the CBT used in formulation; material offered to processors is manufactured, and this shelf does not describe how. Second, it is absent from routine certificates of analysis for a purely analytical reason: you cannot quantify what you have no reference standard for, and commercial laboratories stock standards for the cannabinoids their customers ask about. That is the same bottleneck named on the research-frontier page, and it is why a formulator can add a material to a product and then not see it on the panel that product is sold against.',
        bullets: F([
          'Trace natural abundance. Present in the plant, not present at a level that supports isolation as a commercial route.',
          'The isolation history is 1966 report, 1976 structure, then progressive characterisation of the group in the constituent-inventory series.',
          'Not on a standard cannabinoid panel. If you want CBT quantified you must ask a laboratory whose scope includes it and which holds the standard.',
          'A formulation containing CBT and assayed on a standard panel reports a lower total cannabinoid mass than the fill actually contains, because part of the fill is invisible to the method.',
        ]),
        cites: F(['obata1966', 'chan1976', 'turner1980', 'elsohly2005', 'elsohly2014']),
        evidence: 'in vitro',
      }),
      F({
        h: 'Biogenetic relationships: CBT as an oxidation relative and proposed intermediate',
        body: 'The reason cannabitriol appears in a discussion of cannabinoid transformation is that its skeleton sits on the oxidative pathway that also produces cannabinol. Δ9-THC under oxidative pressure can lose the Δ9 alkene either by aromatisation of the terpenoid ring, which gives cannabinol, or by oxygen addition across the ring, which gives hydroxylated species including the Δ6a(10a) diol arrangement of cannabitriol. Turner and ElSohly set out a decomposition pathway from Δ9-THC to cannabinol in 1979, and the same body of work situates the hydroxylated intermediates that the CBT group represents. The literature therefore describes CBT-type compounds both as isolable constituents and as species on the degradation route between THC and its aromatised and hydroxylated end products, with the Δ6a(10a)-THC skeleton as the recurring junction. It should be stated plainly that the mechanistic detail here is inferred from isolated structures and model studies rather than from a fully mapped kinetic pathway in planta, so the intermediate role is a well-grounded proposal and not a closed question. No preparative route is given here; the synthetic literature on Δ6a(10a) and hydroxylated cannabinoids exists and is cited for its existence only.',
        bullets: F([
          'Mass arithmetic tells the same story: Δ9-THC at nominal 314, cannabinol at 310 after aromatisation and loss of hydrogen, cannabitriol at 346 after addition of two oxygens.',
          'Both cannabinol and the cannabitriol group are oxidative fates of the same alkene. That is why both accumulate in aged material.',
          'Consequence for a processor: CBT-type compounds, like CBN, are part of what a process-history readout on an aged or heat-abused extract looks like.',
        ]),
        cites: F(['turner1979', 'turner1980', 'elsohly2005', 'hanus2016', 'pollastro2018']),
        contested: true,
        caveat: 'The intermediate role is a proposal supported by isolated structures, mass relationships and decomposition studies, not a kinetically mapped in-planta pathway. Treat the pathway diagram in secondary sources as a hypothesis with good structural support.',
        evidence: 'in vitro',
      }),
      F({
        h: 'CBT in formulation: what it actually does and why processors meet it as a working material',
        body: 'The reason a hemp processor encounters cannabitriol is entirely practical. CBT is sold to formulators as an anti-crystallisation and viscosity-modifying agent for cannabinoid vape formulations, and in that role it is not a novelty additive but one of the few materials that addresses the crystallisation problem without also thinning the fill and without adding a non-cannabinoid substance to an inhaled product. The working rationale the trade gives is structural: CBT is a cannabinoid, so it is fully miscible with cannabinoid resin and does not introduce a new chemical class into the aerosol, and its polyhydroxylated, non-planar structure disrupts the crystal packing of the cannabinoid it is dissolved in — it is a lattice interferent rather than a solvent. Reported working inclusion in the trade sits in the low single-digit percent range of the finished formulation, with higher loads used to hold high-CBD or isolate-heavy fills in solution. A formulator adding CBT is effectively choosing to solve a physical problem with a cannabinoid instead of with a diluent, which is a defensible choice for exactly the reasons the EVALI section below makes clear.',
        bullets: F([
          'Function: suppresses nucleation and crystal growth in supersaturated cannabinoid fills, and lowers apparent viscosity at a given temperature.',
          'Reported trade inclusion: commonly cited in the low single-digit percent range, higher for isolate-heavy or high-CBD formulations.',
          'Advantage over a non-cannabinoid diluent: it does not introduce a new substance class into an inhaled product, and it counts toward cannabinoid mass rather than diluting it.',
          'Disadvantage: it is not on standard analytical panels, its supply chain characterisation is variable, and its inhalation toxicology is not published.',
          'Material offered as CBT in the trade is not consistently characterised. Ask for a certificate of analysis with a named method and an identified analyte, and treat uncharacterised material as unknown.',
        ]),
        cites: F(['tradePractice', 'elsohly2005', 'hanus2016']),
        evidence: 'industry practice',
        contested: true,
        caveat: 'The anti-crystallisation function and the inclusion range are industry practice. No peer-reviewed quantitative rheology or crystallisation-kinetics study of CBT in cannabinoid formulations was located in this pass, and the mechanistic explanation given here (lattice interference by a non-planar polyhydroxylated cannabinoid) is a structurally reasonable account rather than a measured result.',
      }),
      F({
        h: 'The published record on CBT is thin, and that is a research gap this wiki is filling',
        body: 'It should be said directly rather than hedged into vagueness: compared with Δ9-THC and CBD, the published literature on cannabitriol is sparse. What exists is solid — the 1966 report, the 1976 structure determination, the constituent-inventory reviews that place it and enumerate its group, and the decomposition-pathway work that relates it to the oxidative fate of THC. What does not exist, as far as this pass could establish, is a receptor-pharmacology characterisation at CB1 and CB2 comparable to what is available for CBN, a quantitative rheology or crystallisation study documenting the formulation effect the trade relies on, any human pharmacokinetics, and any inhalation toxicology. That is a gap in the record, not a reason for scepticism about the compound: CBT is a structurally characterised natural product of known formula and known class with an established commercial use. The honest framing is that it is under-documented, that the specific questions are well defined, and that they are answerable with ordinary instrumentation. Naming them is more useful than repeating that it is understudied.',
        bullets: F([
          'Open question 1: CB1 and CB2 binding and functional activity of (−)-trans-cannabitriol, which would settle whether it contributes pharmacologically to a formulation or only physically.',
          'Open question 2: quantitative rheology and nucleation-suppression measurement across inclusion rates and cannabinoid profiles — the study the trade practice implies but does not have.',
          'Open question 3: thermal behaviour and degradation products at vaporiser coil temperatures, which is the toxicology question that matters for an inhaled additive.',
          'Open question 4: an accepted reference standard and a validated chromatographic method, without which CBT stays off certificates of analysis.',
          'Open question 5: whether the 10-ethoxy members are plant constituents or ethanolic-extraction artefacts.',
        ]),
        cites: F(['chan1976', 'obata1966', 'elsohly2005', 'hanus2016', 'turner1980', 'tradePractice']),
        evidence: 'in vitro',
      }),
      F({
        h: 'The rest of the viscosity toolkit',
        body: 'CBT is one lever among several and a competent formulation uses the cheap ones first. Temperature is the first lever and the free one: cannabinoid resin viscosity falls steeply with temperature, which is why filling is done warm, and why a cartridge that will not draw in a cold car will draw after a minute in a warm hand. It is a handling lever, not a product-stability lever, because it does nothing about the equilibrium the fill is sitting at. Formulation composition is the second and most underrated lever: crystallisation is a saturation phenomenon, so a broad cannabinoid profile with meaningful minor-cannabinoid content resists it far better than a near-pure isolate, and the practical implication is that chasing maximum purity and then fighting crystallisation is self-inflicted. Terpene content is the third lever, and it thins the fill genuinely and cheaply, at the cost of the hardware-compatibility and thermal-degradation limits set out on the terpene-blending page. Beyond those there is the class of added viscosity agents the trade uses, and it is here that the important safety line falls.',
        table: F({
          cols: F(['Lever', 'What it changes', 'Strength', 'Limit or cost']),
          rows: F([
            F(['Temperature', 'Apparent viscosity during handling', 'Large and immediate', 'Does not change the saturation state; reverses on cooling']),
            F(['Broad cannabinoid profile', 'Saturation margin; nucleation', 'Large, durable', 'Conflicts with maximum-purity marketing; needs the minors kept in']),
            F(['Terpene load', 'Viscosity, flavour, harshness', 'Moderate', 'Hardware leakage and thermal degradation above about 8 to 10 percent']),
            F(['Cannabitriol (CBT)', 'Nucleation and crystal growth; viscosity', 'Reported effective in the low single-digit percent', 'Thin published record; not on standard panels; inhalation toxicology unpublished']),
            F(['Non-cannabinoid diluents (PG, VG, MCT, and others)', 'Viscosity, wicking', 'Large', 'Route-specific hazard; see the carriers page. This is where EVALI came from']),
            F(['Hardware selection', 'Wick and aperture matched to the fill', 'Decisive in practice', 'Requires testing the actual fill in the actual hardware']),
            F(['Thermal-cycle stability testing', 'Nothing — it tells you the truth', 'Essential', 'Takes time; the alternative is finding out from customers']),
          ]),
        }),
        cites: F(['tradePractice', 'hazekamp2007', 'sleiman2016', 'meehan2019']),
        evidence: 'industry practice',
      }),
      F({
        h: 'The safety line: a viscosity agent chosen for rheology alone is how EVALI happened',
        body: 'This is the load-bearing sentence on the page. Choosing an additive for an inhaled product on the basis of its rheology, its cost and its appearance, without inhalation-toxicology data, is not a theoretical risk — it is the precise decision that produced the 2019 and 2020 outbreak of e-cigarette or vaping product use-associated lung injury. Vitamin E acetate was attractive because it is cheap, food-legal, oily, and close enough to cannabinoid distillate in colour and viscosity that a cut fill still looked and poured like an uncut one. Every property that recommended it was a property of the liquid in the jar, and none of them was a property of the aerosol in a lung. The outbreak record and the subsequent chemistry are covered in detail on the carriers and diluents page and on the adulterants page. The rule that follows for a formulator is narrow and absolute: for an inhaled product, the qualifying question about any additive is what is known about inhaling it, and food-grade status, GRAS status and cosmetic approval answer a different question. CBT is discussed above as a comparatively defensible choice partly because it is a cannabinoid already present in the plant and in the product class, but the honest version of that argument includes the fact that its inhalation toxicology is also unpublished.',
        bullets: F([
          'The correct question for any inhaled additive: what is the published inhalation data, and what does it do at coil temperature?',
          'Food-safe is not inhalation-safe. The two evaluations are not related and one does not imply the other.',
          'Appearance matching is a commercial property, not a safety property, and a diluent that is hard to detect by eye is a diluent that is hard to detect by eye.',
          'If a formulator cannot answer the inhalation question for an ingredient, the ingredient is an open risk and should be recorded as one in the formulation file.',
        ]),
        cites: F(['blount2020', 'krishnasamy2020', 'cdcEvali', 'lanzarotta2020', 'wu2020', 'fdaInhalation']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['products/carriers-and-diluents', 'products/terpene-blending', 'formulation/adulterants', 'safety/converted-cannabinoid-products', 'processing/crystallization', 'processing/short-path-distillation', 'cannabinoids/structural-classes', 'cannabinoids/research-frontier', 'coa/panels']),
    cites: F(['chan1976', 'obata1966', 'turner1979', 'turner1980', 'elsohly2005', 'elsohly2014', 'hanus2016', 'boeren1979', 'radwan2008', 'pollastro2018', 'hazekamp2007', 'sleiman2016', 'meehan2019', 'blount2020', 'krishnasamy2020', 'cdcEvali', 'lanzarotta2020', 'wu2020', 'fdaInhalation', 'tradePractice']),
  }),

  // ══ CARRIERS AND DILUENTS ═══════════════════════════════════════════════════════════════════════
  F({
    slug: 'carriers-and-diluents',
    title: 'Carriers and Diluents, Organised by Route',
    kind: 'safety',
    summary: 'A material-by-material reference for everything a cannabinoid gets dissolved in or cut with, organised by route of administration rather than by chemistry — because the central fact is that a diluent qualified as food-safe has not thereby been qualified for inhalation, and the 2019 to 2020 EVALI outbreak is what that distinction costs when it is ignored.',
    facts: F({
      'Organising principle': 'Route first. A material is appropriate for a route, never appropriate in general',
      'Oral and sublingual workhorses': 'MCT oil, olive oil, hemp seed oil, ethanol, glycerin',
      'Inhalation heritage diluents': 'propylene glycol and vegetable glycerin, inherited from nicotine e-liquid',
      'Documented inhaled-oil hazard': 'exogenous lipoid pneumonia from aspirated or inhaled lipids',
      'EVALI case count': 'approximately 2800 hospitalised cases in the CDC final surveillance summary',
      'EVALI deaths': 'at least 68 reported deaths',
      'EVALI marker': 'vitamin E acetate identified in bronchoalveolar-lavage fluid in the large majority of sampled cases',
      'PG and VG thermal products': 'formaldehyde, acetaldehyde and acrolein, rising with coil temperature and power',
    }),
    sections: F([
      F({
        h: 'Why this page is organised by route',
        body: 'Every safety evaluation a food or cosmetic ingredient has ever passed was an evaluation of a specific exposure route at a specific level. Generally-recognised-as-safe status in the United States is a determination about ingestion. A cosmetic ingredient review is a determination about dermal contact. Neither is a determination about what happens when the material is heated on a metal coil to several hundred degrees and drawn into an alveolus. The lung is not a modified stomach: it has no acid stage, no bile, no first-pass hepatic clearance, a surface area of the order of 70 square metres, a lining a single cell thick, and a clearance mechanism designed for particles and not for oils. Material that the gut would emulsify and metabolise sits in the lung and gets phagocytosed, or does not. This is the reason a diluent table must be indexed by route, and the reason the most common and most expensive formulation error in this industry is a category error rather than a chemistry error.',
        bullets: F([
          'Ingestion, sublingual absorption, dermal application and inhalation are four different toxicological questions about the same molecule.',
          'A supplier certificate saying food grade answers the ingestion question and is silent on the other three.',
          'The burden runs the right way round: for an inhaled product, absence of inhalation data is a reason not to use a material, not a neutral state.',
        ]),
        cites: F(['fdaInhalation', 'rowe2020', 'marchiori2011']),
        evidence: 'human',
      }),
      F({
        h: 'MCT oil (fractionated coconut oil)',
        body: 'Medium-chain triglyceride oil is the default oral and sublingual carrier for cannabinoids and deserves that position. It is a fractionated coconut or palm kernel product consisting predominantly of the C8 (caprylic) and C10 (capric) triglycerides, with the longer chains removed, which gives it three useful properties: it is liquid and stays liquid at refrigerator temperature unlike whole coconut oil, it is far more oxidatively stable than a polyunsaturated seed oil because it is essentially saturated, and it is close to colourless and neutral in taste. Pharmacokinetically it does real work rather than just filling volume: cannabinoids are highly lipophilic and their oral absorption is strongly food- and lipid-dependent, and co-administration with lipid excipients raises systemic exposure substantially. Medium-chain triglycerides are also handled differently from long-chain fats, being absorbed more directly, which is the rationale offered for preferring them. The hazard is route-specific and well documented: aspirated or inhaled lipid causes exogenous lipoid pneumonia, a recognised clinical and radiological entity, so MCT is a good oral carrier and is not an inhalation diluent regardless of how cleanly it mixes with distillate.',
        bullets: F([
          'Composition: predominantly C8 and C10 triglycerides; specification usually states the C8 to C10 ratio.',
          'Oral and sublingual: appropriate, and lipid co-administration meaningfully increases cannabinoid exposure.',
          'Inhalation: not appropriate. Exogenous lipoid pneumonia is the documented outcome of lipid in the lung.',
          'Practical note: MCT is a solvent for many plastics and elastomers over time; check container and gasket compatibility.',
          'Oxidative stability is good but not infinite; it is still stored cool, dark and with minimal headspace.',
        ]),
        cites: F(['rowe2020', 'zgair2016', 'millar2018', 'marchiori2011']),
        evidence: 'human',
      }),
      F({
        h: 'Propylene glycol and vegetable glycerin: the e-liquid heritage and its thermal chemistry',
        body: 'Propylene glycol and glycerin arrived in cannabinoid products by inheritance: they are the base of nicotine e-liquid, the hardware was designed around their viscosity and wicking behaviour, and the supply chain already existed. They are not cannabinoid solvents in the way a lipid is — cannabinoids have limited solubility in glycerin especially — so in a cannabinoid vape they function as thinning and aerosol-forming agents rather than as the carrier proper, and heavily PG- or VG-cut cannabinoid fills tend to separate. Both are hygroscopic, glycerin strongly so, which changes the water content of a stored fill and with it the aerosol. The important body of evidence is thermal. Heating these two compounds on a coil produces carbonyls, and the chemistry is not obscure: propylene glycol and glycerin dehydrate and fragment to formaldehyde, acetaldehyde and acrolein, glycerin being the principal acrolein source, and the yields rise sharply with coil temperature, power and dry or low-liquid operation. This has been measured repeatedly in the e-cigarette aerosol literature, including a widely discussed report of formaldehyde-releasing species in aerosol at high voltage and systematic work showing carbonyl output as a function of solvent and battery output.',
        bullets: F([
          'PG: lower viscosity, carries flavour, more throat hit, and the more cannabinoid-tolerant of the two.',
          'VG: higher viscosity, more visible aerosol, strongly hygroscopic, poor cannabinoid solvent.',
          'Documented thermal degradation products: formaldehyde, acetaldehyde, acrolein. Acrolein output is associated particularly with glycerin.',
          'Yields are power- and temperature-dependent, and worst under dry-wick or low-liquid conditions. Device behaviour is part of the product hazard.',
          'PG has documented airway-irritant properties on inhalation in occupational settings; that is separate from the degradation chemistry.',
          'A PG or VG cut also dilutes the cannabinoid mass per unit volume, which the label arithmetic has to account for.',
        ]),
        cites: F(['jensen2015', 'sleiman2016', 'kosmider2014', 'rowe2020', 'meehan2019']),
        evidence: 'in vitro',
        contested: true,
        caveat: 'The existence and identity of the carbonyl degradation products is well established. The quantitative yields reported across the e-cigarette literature vary widely with device, power, coil condition and puff regime, and some early high-yield reports were criticised for using operating conditions a user would find unpalatable. Treat the qualitative chemistry as settled and any specific yield figure as device- and condition-dependent.',
      }),
      F({
        h: 'Ethanol',
        body: 'Ethanol is the traditional carrier for a tincture and remains the correct choice for one. It dissolves cannabinoids readily, it is self-preserving above roughly 20 percent by volume, it permits sublingual absorption, and it evaporates cleanly, which is why it doubles as the extraction and winterisation solvent upstream. Its formulation limits are its taste and mucosal burn at high strength, the mouthfeel of a high-ethanol dose, its incompatibility with anyone avoiding alcohol, and its regulatory treatment as an alcoholic beverage ingredient in some jurisdictions once the product is consumable. In a vape it is not a diluent: it is volatile enough to change the aerosol dramatically, it is an airway irritant, and the practice of thinning distillate with ethanol produces a harsh product and an unquantified residual-solvent question. Ethanol also appears on this page in a second role — as the reason the 10-ethoxy cannabitriol ethers may be extraction artefacts, which is a reminder that a solvent is a reagent whenever the conditions allow.',
        bullets: F([
          'Oral and sublingual tincture: appropriate, well established, self-preserving at sufficient strength.',
          'Topical: used as a penetration aid and as a carrier in sprays; drying and irritating at high load.',
          'Inhalation: not appropriate as a formulation diluent, and residual ethanol from processing is a specification limit rather than an ingredient.',
          'Residual-solvent limits for ethanol in a finished product come from the pharmacopoeial residual-solvent framework and from state cannabis regulation; see the residual-solvent page.',
        ]),
        cites: F(['rowe2020', 'hazekamp2007', 'elsohly2005']),
        evidence: 'human',
      }),
      F({
        h: 'Olive oil and hemp seed oil',
        body: 'Olive oil is the carrier with the longest documented pharmaceutical history for cannabis preparations and has a genuine evidential advantage: the standardised olive-oil preparations used in medical-cannabis research were characterised and their cannabinoid content quantified, so the behaviour of the matrix is known. It contributes flavour, it is nutritionally unobjectionable, and its mostly monounsaturated fatty-acid profile is reasonably stable. Hemp seed oil is chosen mostly for narrative reasons — a hemp product in a hemp oil — and it has a real formulation drawback: it is high in polyunsaturated fatty acids, principally linoleic and alpha-linolenic, which makes it the least oxidatively stable of the common carriers, prone to rancidity, and demanding of cool dark storage and honest shelf-life dating. It also carries a labelling confusion the industry has never fixed, because hemp seed oil contains no meaningful cannabinoid content of its own and consumers routinely read the name as meaning it does. Neither oil belongs in an inhaled product, for the lipid reason that applies to all of them.',
        bullets: F([
          'Olive oil: documented pharmaceutical carrier for cannabis preparations, moderate stability, strong flavour contribution.',
          'Hemp seed oil: poor oxidative stability from its polyunsaturated profile; requires the shortest shelf life of the common carriers.',
          'Hemp seed oil contains no significant cannabinoids; any cannabinoid in the product was added.',
          'Both: oral only. Neither is an inhalation diluent.',
          'Antioxidant strategy for either: minimise headspace, store cool and dark, and date the product from fill rather than from sale.',
        ]),
        cites: F(['hazekamp2007', 'rowe2020', 'marchiori2011']),
        evidence: 'human',
      }),
      F({
        h: 'Vitamin E acetate and EVALI: the central cautionary case, told properly',
        body: 'In mid-2019 hospitals in the United States began reporting a severe acute lung injury in otherwise healthy people who vaped, and by the time the outbreak investigation closed the CDC surveillance summary recorded on the order of 2800 hospitalised cases and at least 68 deaths. The case-finding pointed overwhelmingly at informally supplied THC-containing cartridges. The chemical answer came from bronchoalveolar-lavage fluid: vitamin E acetate, alpha-tocopheryl acetate, was identified in lavage samples from the large majority of sampled patients and was not found in the comparison samples, and it was found in product samples associated with cases. The reason it was in the cartridges is the part a formulator needs to understand, because it is a formulation decision and not an accident. Vitamin E acetate is cheap, food- and cosmetic-legal, and its colour, viscosity and refractive behaviour are close enough to cannabinoid distillate that a cartridge cut heavily with it still looked, poured and hung on the glass like uncut distillate — it passed the only quality tests an informal supply chain applied, which were visual. Subsequent analytical work found that it hydrogen-bonds with tetrahydrocannabinol in the liquid, which helps explain why cut fills behaved like genuine ones, and pyrolysis chemistry showed that heating vitamin E acetate can release ketene, a potently toxic gas, giving a plausible mechanism for the acute injury. Every property that made it attractive was a property of the liquid; none was a property of the aerosol.',
        bullets: F([
          'Scale: approximately 2800 hospitalisations and at least 68 deaths in the CDC final surveillance summary; cases concentrated in informally sourced THC cartridges.',
          'Marker: vitamin E acetate in bronchoalveolar-lavage fluid in the great majority of sampled cases, and in associated product samples.',
          'Why it was used: cheap, food- and cosmetic-legal, and visually and rheologically indistinguishable from distillate at typical cut rates.',
          'Why that mattered: the supply chain tested by eye, and the adulterant was designed, in effect, to pass a visual test.',
          'Proposed mechanism: thermal release of ketene on vaping pyrolysis, alongside the general lipid-in-lung mechanism.',
          'The generalisable lesson is not about one molecule. It is that rheological and visual equivalence to distillate is exactly the property a dangerous cut will have.',
        ]),
        cites: F(['blount2020', 'krishnasamy2020', 'cdcEvali', 'lanzarotta2020', 'wu2020']),
        evidence: 'human',
        contested: true,
        caveat: 'Vitamin E acetate is the dominant and best-supported cause and the association with lavage fluid is strong, but the outbreak investigation did not establish that it was the sole agent in every case, and other contributors including other lipids and coating or metal contaminants were raised in the literature. The ketene mechanism is chemically plausible and demonstrated in pyrolysis experiments rather than proven as the in-vivo mechanism in patients. Case and death figures are the CDC surveillance totals at the close of the investigation and are subject to the limits of case-based surveillance.',
      }),
      F({
        h: 'Emulsifiers and surfactants',
        body: 'An emulsifier is not a carrier; it is the interfacial agent that lets a lipophilic active exist as a dispersed phase in an aqueous one, which is what any cannabinoid beverage, water-soluble powder or fast-onset edible depends on. Three families dominate. Lecithin, a phospholipid mixture from soy or sunflower, is a food-heritage emulsifier that is cheap, label-friendly, and moderately effective; it produces relatively coarse emulsions on its own and contributes flavour. The polysorbates, principally polysorbate 80 and polysorbate 20, are non-ionic ethoxylated sorbitan esters with high emulsifying power at low inclusion and are the workhorse of commercial nanoemulsion systems; their limitations are a soapy taste at higher inclusion, a consumer-perception problem because of the ethoxylated character, and — the important one — no inhalation qualification whatever. Gum acacia and the other hydrocolloids, along with modified starches, work by a different mechanism: they are stabilisers that raise continuous-phase viscosity and provide steric protection at the droplet surface rather than dropping interfacial tension much, so they hold an emulsion that something else created. In practice a commercial system uses a high-power surfactant to form the droplets and a hydrocolloid to keep them from coalescing.',
        table: F({
          cols: F(['Agent', 'Mechanism', 'Typical use', 'Limitation']),
          rows: F([
            F(['Lecithin (soy, sunflower)', 'Phospholipid interfacial film', 'Edibles, chocolates, coarse emulsions', 'Coarse droplets, flavour contribution, oxidation']),
            F(['Polysorbate 80 / 20', 'Non-ionic surfactant, low interfacial tension', 'Beverages, nanoemulsion concentrates', 'Taste at load, consumer perception, no inhalation data']),
            F(['Gum acacia, modified starch', 'Steric stabilisation, viscosity of the continuous phase', 'Beverage and powder stabilisation', 'Does not form fine droplets by itself']),
            F(['Sucrose esters, quillaja saponins', 'Natural-label surfactants', 'Beverages seeking a clean label', 'Higher cost, narrower processing window']),
            F(['Whey and pea protein', 'Protein interfacial film', 'Dairy-like and protein beverages', 'pH and ionic-strength sensitive, allergen labelling']),
          ]),
        }),
        cites: F(['rowe2020', 'mcclements2012', 'barrus2016']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Nanoemulsion and liposomal claims against the evidence',
        body: 'The underlying science is real and should not be dismissed along with the marketing. A cannabinoid taken orally in an oil has low and highly variable bioavailability, limited by poor aqueous solubility, by food effects, and by extensive first-pass metabolism; the human pharmacokinetic literature on cannabidiol documents exactly that variability. Reducing the dispersed lipid phase to droplets in the tens to low hundreds of nanometres increases interfacial area enormously, keeps the active presented to the intestinal wall in a solubilised state, and in self-emulsifying and pro-nanoliposphere systems has been shown in human volunteers to raise exposure and shorten time to peak relative to a simple oil. That is a genuine pharmacokinetic rationale with human data behind specific systems. The marketing claims are a different matter. Label statements of particle size are frequently unverifiable by the purchaser, because measuring droplet size requires dynamic light scattering on the diluted product under controlled conditions and the number on the carton is rarely traceable to a method. The words nanoemulsion, liposomal and water-soluble are used loosely and often interchangeably for systems that are none of those things — a true liposome is a phospholipid bilayer vesicle, not a surfactant-stabilised oil droplet, and a genuinely water-soluble cannabinoid is a chemically modified molecule rather than a dispersed one. And bioavailability multipliers quoted on packaging are almost never traceable to a human pharmacokinetic study of that product. The fair summary: the mechanism is sound, some specific formulations have human data, and the claim printed on a given commercial label usually does not.',
        bullets: F([
          'Sound: smaller droplets, larger interfacial area, better solubilisation, faster and higher absorption for a lipophilic active. Demonstrated for specific self-emulsifying systems in human volunteers.',
          'Sound: onset time genuinely shortens with a fine emulsion, which is the property beverage products are actually selling.',
          'Unverifiable as usually presented: a stated droplet size with no method, and a stated bioavailability multiple with no study of that product.',
          'Terminology abuse: liposomal, nanoemulsion and water-soluble describe different things and are used as synonyms in the trade.',
          'Stability is the hidden problem: fine emulsions coarsen by Ostwald ripening and coalescence over shelf life, so the size at fill is not the size at sale unless someone measured it at sale.',
          'What to ask a supplier: the measurement method, the instrument, the dilution protocol, the time point, and whether there is human pharmacokinetic data on this formulation rather than on the concept.',
        ]),
        cites: F(['mcclements2012', 'cherniakov2017', 'izgelov2020', 'millar2018', 'zgair2016']),
        contested: true,
        caveat: 'The pharmacokinetic mechanism is well supported and human data exist for particular self-emulsifying and pro-nanoliposphere formulations. Specific commercial claims — a named particle size, a bioavailability multiple, a liposomal designation — are generally not supported by published data on the product making the claim, and should be treated as marketing until a method and a study are produced. Nothing here says a given product does not work; it says the published basis for the printed number is usually absent.',
        evidence: 'human',
      }),
      F({
        h: 'The route table',
        body: 'The summary table. Read it as a route qualification, not as a ranking of materials: nearly every entry is appropriate somewhere and hazardous somewhere else, which is the entire point of the page. Where the hazard column says no inhalation data, that is a statement about the record and it is a reason for caution rather than a finding of harm — but for an inhaled product it is a reason not to use the material.',
        table: F({
          cols: F(['Material', 'Appropriate route', 'NOT appropriate for', 'Documented hazard', 'Citation']),
          rows: F([
            F(['MCT oil (C8/C10)', 'Oral, sublingual, topical', 'Inhalation', 'Exogenous lipoid pneumonia from inhaled or aspirated lipid', 'Marchiori 2011; Rowe, Excipients']),
            F(['Olive oil', 'Oral, topical', 'Inhalation', 'Same lipid-in-lung mechanism', 'Marchiori 2011; Hazekamp 2007']),
            F(['Hemp seed oil', 'Oral, topical', 'Inhalation', 'Same, plus rapid oxidative rancidity in the product', 'Marchiori 2011; Rowe, Excipients']),
            F(['Propylene glycol', 'Inhalation (with limits), oral, topical', 'High-power dry-coil operation', 'Airway irritation; thermal formaldehyde and acetaldehyde', 'Jensen 2015; Sleiman 2016; Kosmider 2014']),
            F(['Vegetable glycerin', 'Inhalation (with limits), oral, topical', 'High-power dry-coil operation', 'Thermal acrolein and other carbonyls; hygroscopic', 'Sleiman 2016; Kosmider 2014']),
            F(['Ethanol', 'Oral, sublingual, topical', 'Inhalation as a formulation diluent', 'Mucosal irritation; residual-solvent limits apply', 'Rowe, Excipients; Hazekamp 2007']),
            F(['Vitamin E acetate', 'Oral, topical (as a nutrient or cosmetic)', 'Inhalation, absolutely', 'EVALI: about 2800 hospitalisations, at least 68 deaths; ketene on pyrolysis', 'Blount 2020; Krishnasamy 2020; Wu 2020']),
            F(['Lecithin', 'Oral, topical', 'Inhalation', 'No inhalation qualification; phospholipid in lung is the same class of concern', 'Rowe, Excipients']),
            F(['Polysorbate 80 / 20', 'Oral, topical', 'Inhalation', 'No inhalation data; surfactant effects on lung surfactant are unstudied here', 'Rowe, Excipients; McClements 2012']),
            F(['Gum acacia, modified starch', 'Oral', 'Inhalation', 'Particulate hazard; no inhalation qualification', 'Rowe, Excipients']),
            F(['Cannabitriol (CBT)', 'Inhalation and oral in trade practice', 'Any route where you need published toxicology', 'Inhalation toxicology unpublished; see the viscosity page', 'ElSohly 2005; trade practice']),
            F(['Terpene blends', 'Inhalation, oral, topical, each at its own rate', 'High inclusion in a cartridge; high-temperature dabbing', 'Thermal degradation to aromatics and carbonyls; dermal sensitisation', 'Meehan-Atrash 2017, 2019']),
          ]),
        }),
        cites: F(['marchiori2011', 'rowe2020', 'hazekamp2007', 'jensen2015', 'sleiman2016', 'kosmider2014', 'blount2020', 'krishnasamy2020', 'wu2020', 'mcclements2012', 'elsohly2005', 'meehan2017', 'meehan2019', 'tradePractice']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['products/viscosity-and-cbt', 'products/edibles', 'products/terpene-blending', 'formulation/adulterants', 'formulation/residual-solvent', 'safety/converted-cannabinoid-products', 'safety/buyer-vendor-checklist', 'coa/red-flags']),
    cites: F(['marchiori2011', 'rowe2020', 'hazekamp2007', 'jensen2015', 'sleiman2016', 'kosmider2014', 'blount2020', 'krishnasamy2020', 'cdcEvali', 'lanzarotta2020', 'wu2020', 'mcclements2012', 'cherniakov2017', 'izgelov2020', 'millar2018', 'zgair2016', 'barrus2016', 'elsohly2005', 'meehan2017', 'meehan2019', 'fdaInhalation', 'tradePractice']),
  }),

  // ══ EDIBLES ═════════════════════════════════════════════════════════════════════════════════════
  F({
    slug: 'edibles',
    title: 'Edible Formulation and Dose Uniformity',
    kind: 'safety',
    summary: 'Why a lipophilic active has to be carried in a fat phase or emulsified to be absorbed at all, what first-pass metabolism to 11-hydroxy-THC does to the dose-response relationship, and dose uniformity per unit as the one safety property an edible producer actually controls — with the arithmetic, the incorporation technique, the stability chemistry and the labelling consequences.',
    facts: F({
      'Oral bioavailability of Δ9-THC': 'low and highly variable, commonly cited in the range of about 4 to 20 percent',
      'Principal oral first-pass metabolite': '11-hydroxy-Δ9-tetrahydrocannabinol (11-OH-THC)',
      'Oral onset': 'roughly 30 to 120 minutes, strongly food-dependent',
      'Oral peak': 'roughly 1 to 4 hours, later with a fatty meal',
      'Inhaled onset by comparison': 'seconds to minutes, peak within about 10 minutes',
      'Dose-uniformity arithmetic': 'total active in the batch divided by the number of units; the variance that matters is between units',
      'Common regulatory unit cap': 'frequently 5 or 10 mg THC per serving, jurisdiction-dependent',
      'Documented label accuracy problem': 'a minority of surveyed edible products were accurately labelled for cannabinoid content',
    }),
    sections: F([
      F({
        h: 'Lipophilicity: why the active must be in a fat phase or an emulsion',
        body: 'Cannabinoids are extremely lipophilic and essentially insoluble in water. That single physical property determines everything about edible formulation. An active that will not dissolve in the aqueous phase of a food cannot be absorbed from the gut in any meaningful quantity, because absorption across the intestinal epithelium requires the molecule to be presented in a solubilised state — dissolved in dietary lipid and incorporated into mixed micelles by bile salts, or already dispersed as fine solubilised droplets by the formulation itself. A cannabinoid stirred as a powder into a water-based food is not a low-dose product, it is a product where much of the dose passes through. This is also why food effects on oral cannabinoid pharmacokinetics are large and well documented, with a high-fat meal raising exposure substantially over a fasted state, and why lipid excipients are not inert bulk. The formulator has two legitimate routes: carry the active in a genuine fat phase of sufficient quantity, or build an emulsion so the active is presented as a fine dispersed lipid phase regardless of what the consumer ate.',
        bullets: F([
          'Absorption requires solubilisation. Fat in the product or fat in the meal does that work; without either, absorption is poor and erratic.',
          'Route one, fat phase: chocolate, butter or oil-based confectionery where there is enough lipid to dissolve the dose.',
          'Route two, emulsion: beverages, gummies and low-fat formats where the lipid phase is engineered rather than incidental.',
          'The food effect is a source of dose variance the producer cannot control, which is part of the argument for emulsified formats.',
          'A gummy is a mostly aqueous gel. Getting an even dose into one is an emulsification problem, not a mixing problem.',
        ]),
        cites: F(['huestis2007', 'zgair2016', 'millar2018', 'barrus2016']),
        evidence: 'human',
      }),
      F({
        h: 'Emulsification as formulation science',
        body: 'An oil-in-water emulsion is a kinetically stabilised dispersion of lipid droplets in an aqueous continuous phase, and every part of that phrase is a formulation lever. The emulsifier adsorbs at the oil-water interface, lowers interfacial tension so droplets can be broken up by the energy the process supplies, and then provides a steric or electrostatic barrier that stops them coalescing again. Energy input is what sets droplet size: gentle stirring gives a coarse emulsion with droplets of many micrometres, while high-pressure homogenisation, microfluidisation or high-intensity ultrasound produce droplets in the tens to low hundreds of nanometres. Droplet size then governs two things that matter commercially. Optically, fine emulsions are translucent rather than milky, which is why a clear cannabinoid beverage is a claim about droplet size. Pharmacokinetically, smaller droplets mean far greater interfacial area and faster lipolysis and solubilisation, which shortens time to onset and raises exposure — the mechanism described on the carriers page, where the honest limits of the commercial claims are also set out. Emulsion stability over shelf life, not at fill, is the specification that a producer should be testing: droplet growth by coalescence and Ostwald ripening, creaming, and the pH and ionic-strength sensitivity of protein- and hydrocolloid-stabilised systems all move the product over months.',
        bullets: F([
          'Coarse emulsion: droplets of micrometres, opaque, made with low-energy mixing and a food emulsifier like lecithin.',
          'Fine or nanoemulsion: droplets in the tens to low hundreds of nanometres, translucent, made with high-pressure or ultrasonic energy plus a high-power surfactant.',
          'Faster onset is a real and reproducible consequence of fine droplets; the size numbers printed on packaging usually are not verifiable.',
          'Instability modes to test for: creaming, coalescence, Ostwald ripening, and phase separation on freeze-thaw and thermal cycling.',
          'An emulsion that has crept in droplet size has also changed its absorption profile, so stability testing is dose testing.',
        ]),
        cites: F(['mcclements2012', 'barrus2016', 'millar2018', 'rowe2020']),
        evidence: 'in vitro',
      }),
      F({
        h: 'First-pass metabolism and 11-hydroxy-THC: the mechanism behind harder and later',
        body: 'The pharmacology that makes edibles behave differently from inhalation is not mysterious and it belongs in a formulation reference because it is a consequence of the route the formulator chose. An ingested cannabinoid is absorbed from the gut into the portal circulation and passes through the liver before it reaches systemic blood. Hepatic metabolism of Δ9-THC proceeds substantially by hydroxylation at the C-11 position to 11-hydroxy-Δ9-THC, which is itself psychoactive — characterised in human work from the early 1970s onward as at least as potent as the parent compound and crossing into the brain readily — before further oxidation to the inactive 11-nor-9-carboxy-THC that urine screening detects. Inhalation bypasses that pass: the drug goes from alveolus to arterial blood to brain, and the 11-hydroxy metabolite is formed in much smaller proportion relative to parent THC. The practical result is a route difference in three dimensions at once. Timing: absorption and hepatic transit take tens of minutes to hours, so onset is delayed and the peak is late, and a user who does not feel an effect at 45 minutes and takes a second unit is re-dosing before the first has peaked. Character: the metabolite profile the brain sees is different, with a much larger 11-hydroxy contribution, which is the mechanistic account of why an oral dose is described as stronger and more bodily at the same nominal milligrams. Variance: bioavailability is low and highly variable between people and between meals, so the same labelled dose produces a much wider spread of exposures than an inhaled one. The clinical epidemiology matches the pharmacology, with emergency presentations attributable to edibles over-represented relative to their share of sales.',
        bullets: F([
          'Ingested: gut, portal vein, liver, then systemic. Inhaled: alveolus, arterial blood, brain.',
          '11-OH-THC is an active metabolite formed disproportionately on the oral route and is at least as potent as Δ9-THC in human studies.',
          'Delayed onset plus a late peak is the condition under which re-dosing errors happen; it is a formulation and labelling problem, not only a user-education one.',
          'Oral bioavailability is low and variable, commonly quoted in the region of 4 to 20 percent, with large food effects on top.',
          'Higher variance at the same label means a unit dose has to be conservative for the label to mean anything across a population.',
        ]),
        cites: F(['lemberger1972', 'huestis2007', 'wall1983', 'monte2019', 'millar2018']),
        evidence: 'human',
        contested: true,
        caveat: 'The existence and activity of 11-OH-THC and the route difference in its formation are well established. The commonly repeated claim that the metabolite is a specific multiple more potent than Δ9-THC comes from small early human studies with different endpoints and should not be quoted as a fixed number. Oral bioavailability ranges vary widely across the literature depending on dose form, meal state and analytical method.',
      }),
      F({
        h: 'Dose uniformity per unit: the arithmetic and why the batch average is not the answer',
        body: 'Dose uniformity is the one safety property an edible producer fully controls, and the arithmetic is simple enough that getting it wrong is always a process failure rather than a knowledge failure. The nominal per-unit dose is total active in the batch divided by the number of units: 2000 mg of THC dosed into 400 gummies is 5 mg per gummy. That calculation is necessary and it is not the safety statement. The safety statement is about variance between units, because a consumer eats one unit and not the batch average. A batch that assays correctly at 5 mg per unit on average but ranges from 1 mg to 14 mg across the tray is a compliant average and a dangerous product, and it is dangerous in a specific way: the consumer who receives the 14 mg unit is also the consumer who most likely calibrated their expectations on an earlier 1 mg unit from the same box. The distribution, not the mean, is the specification. Two corollaries follow. First, potency losses have to be accounted for in the input calculation rather than discovered at assay, because heat, pH and process time destroy some of what went in. Second, the honest quantity to report internally is a mean with a spread, and a production process should be characterised by that spread before it ships.',
        bullets: F([
          'Nominal per-unit dose = total active in the batch ÷ number of units. Necessary, not sufficient.',
          'The specification that matters is the between-unit distribution: mean plus spread, not mean alone.',
          'Account for process loss on the input side. If the process destroys a known fraction, the batch input is sized for it and verified, not guessed.',
          'A hot spot is the failure this arithmetic exists to prevent: a local region of the matrix carrying a multiple of the nominal dose.',
          'A published audit of commercial edible products found that only a minority were accurately labelled for cannabinoid content, with both under- and over-labelling present. This is a documented industry-wide failure, not a hypothetical.',
        ]),
        cites: F(['vandrey2015', 'barrus2016', 'tradePractice']),
        evidence: 'human',
      }),
      F({
        h: 'Geometric dilution and full incorporation',
        body: 'The technique that produces uniformity is geometric dilution, and it is old pharmacy practice for exactly this problem. A small mass of potent active cannot be distributed evenly into a large mass of matrix in one step, because the mixing process can only reduce the scale of segregation so far per pass, and the difference in scale between a few grams of distillate and fifty kilograms of gummy slurry is too large. Geometric dilution solves it by doubling: the active is combined with a roughly equal mass of a compatible diluent and mixed to homogeneity, then that premix is combined with an equal mass of matrix and mixed, and so on until the batch is made. Each step is a mix over a manageable ratio, and the number of steps grows only as the logarithm of the dilution factor. For a cannabinoid the compatible diluent for the first steps is a lipid or the emulsion concentrate, because the active must be in solution before it is dispersed — attempting to disperse undissolved resin gives a suspension of concentrated droplets, which is a hot spot by construction. Two process facts complete the picture. Viscosity fights you: a viscous or partially set matrix does not mix in any useful sense, because flow is laminar and the fluid elements do not exchange, so a concentration gradient formed before the matrix stiffened is trapped permanently. And set time is a deadline: in a gelling system the window in which the batch can still be homogenised closes as the gel network forms, so the mix has to be complete before the set begins and depositing has to be fast enough that the last mould is filled from the same fluid as the first.',
        bullets: F([
          'Dissolve first, disperse second. An undissolved particle of active is a hot spot that mixing will not remove.',
          'Double the mass at each step rather than adding the active straight to the batch.',
          'Verify homogeneity of the premix before it goes into the batch. An inhomogeneous premix cannot be fixed downstream.',
          'Viscous and setting matrices trap gradients: laminar flow does not mix, and a gel does not flow at all.',
          'Depositing from a held reservoir has its own drift — the active can migrate or settle in the reservoir over a long run, which is why the sampling plan below spans the run.',
        ]),
        cites: F(['tradePractice', 'barrus2016', 'rowe2020']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Verifying uniformity: the sampling plan',
        body: 'A producer does not know a batch is uniform because the process was designed to be uniform; they know because units from across the run were assayed individually and the spread was measured. The minimum honest plan is to pull units from the start, the middle and the end of a depositing run, assay them individually rather than compositing them, and record each result. Compositing defeats the purpose: grinding five gummies together and assaying the blend recovers the mean the producer already calculated and destroys the only information the exercise was for, which is the variance. Positional sampling matters because the two dominant failure mechanisms are both positional. Settling or creaming in the holding reservoir produces a drift from start to end of run, so a start-and-end comparison detects it directly. Incomplete incorporation produces scatter without a trend, which shows up as a wide spread among units taken from the same position. For moulded products, position within the mould tray is a third axis worth sampling if the depositing head traverses. The output of the exercise is a characterised process: a mean, a spread, and a known worst case, which is what allows a per-unit label to be defended.',
        bullets: F([
          'Assay individual units, never a composite, when the question is uniformity.',
          'Sample start, middle and end of the run to catch reservoir settling as a trend.',
          'Scatter without a trend points at incorporation; a trend points at the reservoir or the depositor.',
          'Record it as a process characterisation, so a later drift is detectable against a baseline rather than judged against nothing.',
          'A compliance or customer-facing result needs an accredited laboratory; in-house assay is for knowing where you are. See the analytical page on the equipment shelf.',
        ]),
        cites: F(['vandrey2015', 'tradePractice']),
        evidence: 'industry practice',
      }),
      F({
        h: 'Thermal and pH stability during production and on the shelf',
        body: 'The dose in the product at sale is not the dose that went in, and the chemistry of the gap is well characterised. Decarboxylation of the acid cannabinoids to their neutral forms is temperature- and time-dependent and continues wherever the product sees heat, which means an incompletely decarboxylated input keeps converting during cooking and in storage and the total-THC figure moves. Oxidative degradation of Δ9-THC to cannabinol continues in the finished product for the whole of its shelf life, driven by oxygen, light and temperature, and the classic storage work identified light as the single largest factor in cannabis preparation losses, with subsequent long-term studies confirming progressive loss under ambient conditions. Acidic conditions matter in gummy and beverage systems, because low pH accelerates cannabinoid degradation and isomerisation over time, and a citric-acid-sharpened confection is a mildly acidic reactor held at room temperature for a year. The practical consequences are a formulation input calculation that accounts for expected loss, a packaging specification that takes oxygen and light seriously rather than aesthetically, and a shelf life that is dated from manufacture and supported by real stability data rather than assumed.',
        bullets: F([
          'Decarboxylation is time-at-temperature. An input that is not fully decarboxylated will keep converting in the product.',
          'Δ9-THC to CBN oxidation proceeds on the shelf. Light is the dominant driver identified in the storage literature; oxygen and heat compound it.',
          'Low pH in gummies and beverages accelerates cannabinoid loss and isomerisation over shelf life.',
          'Packaging is a formulation component: opaque or UV-blocking material, low oxygen headspace or an oxygen barrier, and a seal that survives distribution.',
          'A rising CBN figure on a retained-sample assay is a readout of how the product has been stored, which the CBN page treats at length.',
        ]),
        cites: F(['fairbairn1976', 'trofin2012', 'zamengo2019', 'wang2016', 'huestis2007']),
        evidence: 'in vitro',
      }),
      F({
        h: 'Labelling arithmetic: per unit and per package',
        body: 'The labelling consequence of everything above is that a package total without a per-unit figure is unusable information. A consumer holding a bag labelled 100 mg THC cannot determine a dose from it, because the number they need is the milligrams in the piece they are about to eat, and dividing by the count on the bag assumes a uniformity they have no way to verify and that the published audit literature says is frequently absent. A defensible label carries both numbers and states the count: milligrams per unit, units per package, and milligrams per package, with the arithmetic between them consistent. Two further points belong on any serious label. The delayed-onset warning is not boilerplate; it is the direct consequence of the pharmacokinetics above and the specific mechanism by which the most common acute harm from this product category occurs, so it should state a time and not merely say effects may be delayed. And where the active is a cannabinoid other than Δ9-THC, or where the product contains a substantial acid-form contribution, the total-THC arithmetic has to be stated on the same basis the regulator uses, which is the subject of the total-THC-math page. Most jurisdictions additionally cap per-serving and per-package amounts, frequently at 5 or 10 mg per serving, and the cap is a property of the unit rather than of the average.',
        bullets: F([
          'Required for use: milligrams per unit. Everything else is context.',
          'State count and package total as well, and make the three numbers consistent.',
          'A package total alone is not a dose statement and should be treated as a labelling defect.',
          'The onset warning should carry a time figure, because the harm mechanism is re-dosing inside the onset window.',
          'Per-serving caps are common and jurisdiction-specific; check the operative rule rather than a neighbouring state.',
          'Score, wrap or portion the product so the unit the label describes is the unit a consumer can actually separate.',
        ]),
        cites: F(['vandrey2015', 'monte2019', 'barrus2016', 'tradePractice']),
        evidence: 'human',
      }),
    ]),
    seeAlso: F(['formulation/homogeneity', 'formulation/dose-arithmetic', 'formulation/hot-spots', 'formulation/titration', 'products/carriers-and-diluents', 'products/cbn-production', 'coa/total-thc-math', 'processing/decarboxylation', 'equipment/scales', 'equipment/analytical']),
    cites: F(['huestis2007', 'lemberger1972', 'wall1983', 'vandrey2015', 'monte2019', 'barrus2016', 'millar2018', 'zgair2016', 'mcclements2012', 'rowe2020', 'fairbairn1976', 'trofin2012', 'zamengo2019', 'wang2016', 'tradePractice']),
  }),

  // ══ CBN PRODUCTION ══════════════════════════════════════════════════════════════════════════════
  F({
    slug: 'cbn-production',
    title: 'CBN: Degradation Read Forwards and Backwards',
    kind: 'cannabinoid',
    summary: 'Cannabinol is the oxidative degradation product of Δ9-THC, formed by air, light, heat and time, so making it deliberately means running faster a reaction that is already happening in every badly stored jar. The same chemistry read one way is a storage-history readout on a certificate of analysis and read the other way is a product category — this page does both, and treats the marketed sedative claim as the thinly supported claim it is.',
    facts: F({
      'Relationship to Δ9-THC': 'oxidative degradation product; not an enzymatic plant product in any quantity',
      'Chemical change': 'oxidation and aromatisation of the terpenoid C-ring to a fully aromatic ring',
      'Molecular formula': 'C21H26O2, nominal mass about 310 (the pentyl, C5, homolog)',
      'Δ9-THC for comparison': 'C21H30O2, nominal mass about 314',
      'Acid precursor': 'CBNA, formed correspondingly from THCA',
      'Propyl homolog': 'cannabinolvarin (CBNV, C3)',
      'Drivers of formation': 'oxygen, ultraviolet and visible light, elevated temperature, time; light is the largest single factor in the storage literature',
      'CB1 affinity': 'weak relative to Δ9-THC',
      'Intoxication': 'described as non- or minimally intoxicating at ordinary doses',
      'Marketed claim': 'sedative and sleep-promoting; human support is thin and confounded',
    }),
    sections: F([
      F({
        h: 'Why this conversion is different from the ones this shelf will not describe',
        body: 'It is worth being explicit about the distinction, because this page gives conditions and the rest of the shelf refuses to. CBN formation is not a synthesis. It is the spontaneous oxidative decay of Δ9-THC, it requires no reagent that is not already in the room, it proceeds in every jar of flower and every drum of distillate that is stored warm, bright or open, and its conditions are identical to the conditions a quality-control programme exists to prevent. Describing them is therefore the same act as describing correct storage — the information is symmetric, and withholding it would remove the storage guidance along with the production guidance. Producing CBN deliberately means accelerating that decay under control and measuring where you are with an assay. That is a different kind of operation from converting one cannabinoid into a different, more intoxicating one by adding a reagent, and this shelf does not describe the latter in any form. Nothing on this page names a reagent, a catalyst or a solvent, and nothing on it is a recipe: the honest position, stated again below, is that published and trade parameters disagree widely and the process is controlled by assay rather than by a fixed set of numbers.',
        bullets: F([
          'CBN is a degradation product. Every stored cannabis product is already making some.',
          'The production conditions and the storage-avoidance conditions are the same facts stated with opposite intent.',
          'CBN is non- or minimally intoxicating, which is a further reason the conversion sits outside the exclusion this shelf applies to intoxicant-producing conversions.',
        ]),
        cites: F(['turner1979', 'fairbairn1976', 'elsohly2005']),
        evidence: 'in vitro',
      }),
      F({
        h: 'The chemistry: oxidation and aromatisation of the C-ring',
        body: 'Δ9-THC carries a partially saturated terpenoid ring — a cyclohexene bearing the gem-dimethyl group and the Δ9 alkene — fused to the benzopyran core. Cannabinol is what that ring becomes when it is fully aromatised. Under oxidative conditions the ring loses hydrogen and the double bond migrates and multiplies until the ring is a benzene ring, giving a planar, fully aromatic tricyclic system with the pentyl chain and the phenol retained. The mass arithmetic states it compactly: Δ9-THC is C21H30O2 at nominal 314 and cannabinol is C21H26O2 at nominal 310, a loss of four hydrogens and nothing else. Turner and ElSohly set out a decomposition pathway from Δ9-THC to cannabinol in 1979, and intermediates on that route include hydroxylated species related to the cannabitriol group discussed on the viscosity page, which is why aged material accumulates both. Two structural consequences matter downstream. Aromatisation flattens the molecule and removes the stereocentres of the terpenoid ring, which changes receptor fit and is the structural account of CBN weak CB1 affinity. And the same chemistry runs on the acid series: THCA oxidises to CBNA, which decarboxylates to CBN, so a product can arrive at CBN by either order of the two steps.',
        bullets: F([
          'Δ9-THC, C21H30O2, nominal 314. Cannabinol, C21H26O2, nominal 310. Four hydrogens, one aromatic ring.',
          'Aromatisation removes the terpenoid-ring stereochemistry; CBN is achiral in that ring where THC is not.',
          'Parallel acid route: THCA to CBNA to CBN, or THCA to THC to CBN, depending on whether heat or oxidation gets there first.',
          'The propyl homolog cannabinolvarin (CBNV) stands in the same relation to THCV.',
          'Hydroxylated intermediates of the cannabitriol type accumulate alongside CBN in aged material, from the same oxidative pressure.',
        ]),
        cites: F(['turner1979', 'turner1980', 'elsohly2005', 'hanus2016', 'pollastro2018']),
        evidence: 'in vitro',
      }),
      F({
        h: 'Read as accidental degradation: CBN on a COA is a process and storage history',
        body: 'For anybody reading a certificate of analysis rather than writing one, this is the most useful thing on the page. A CBN figure is a readout of what happened to the material before it reached the laboratory. Fresh, properly dried, properly stored flower and freshly made extract carry very little CBN. A meaningful CBN peak means one of a small number of things happened: the material was stored for a long time, it was stored warm, it was stored in light, it was stored with a large oxygen headspace or in a permeable container, or it was over-processed with heat somewhere upstream — an over-long or over-hot decarboxylation, a distillation run too hot or too slow, or repeated thermal cycling. The storage literature is old and consistent on the drivers: the classic 1976 stability study identified light as the single most important factor in the loss of cannabinoids from preparations, and long-term studies of resin and plant material have since documented progressive THC loss with corresponding CBN increase over months to years under ambient conditions, with a four-year study of seized material characterising the trajectory. A reader can therefore use the THC-to-CBN ratio as a rough age and abuse indicator, with the caveat that it is not a clock — it is a function of conditions as much as of elapsed time, so a well-stored two-year-old sample can look fresher than a badly stored six-month-old one.',
        table: F({
          cols: F(['Driver', 'Mechanism', 'What to do about it']),
          rows: F([
            F(['Light, especially ultraviolet', 'Photochemical oxidation; the largest single factor in the storage literature', 'Opaque or UV-blocking containers; dark storage; no clear display jars']),
            F(['Oxygen headspace', 'Provides the oxidant; rate scales with available oxygen and surface area', 'Fill containers full, minimise headspace, consider inert headspace or barrier packaging']),
            F(['Elevated temperature', 'Raises the rate of every step on the pathway', 'Cool storage; no warm warehouses, no sunlit shelves, no heat during transport']),
            F(['Time at ambient', 'Integrates all of the above', 'Date from manufacture; rotate stock; support shelf life with real stability data']),
            F(['Over-decarboxylation', 'Excess time at temperature pushes past the acid-to-neutral conversion into degradation', 'Control decarboxylation by assay endpoint, not by a fixed clock']),
            F(['Hot or slow distillation', 'Thermal load on the cannabinoid fraction during processing', 'Deeper vacuum lowers the required temperature; see the vacuum and distillation pages']),
            F(['Large surface area', 'More interface with air; finely divided material degrades faster', 'Store whole rather than milled where possible; minimise exposed films']),
          ]),
        }),
        cites: F(['fairbairn1976', 'trofin2012', 'zamengo2019', 'wang2016', 'turner1979']),
        evidence: 'human',
      }),
      F({
        h: 'Read as deliberate production: controlled oxidative aging',
        body: 'Deliberate CBN production takes the same drivers and applies them on purpose to a THC-rich input under control. The levers are the ones in the table above, used in the opposite direction: oxygen availability, elevated temperature, light in the ultraviolet or near-ultraviolet, and time, alone or in combination. Trade and literature descriptions span a broad range — from long exposures at modest temperature with generous air contact, through warm ovens with deliberate headspace and stirring or thin-film presentation to increase interfacial area, to photochemical approaches using ultraviolet exposure as the primary driver rather than heat. What should be said plainly is that the published and trade parameters disagree with each other substantially, that reported conversion extents and times are not comparable across sources because the input material, the geometry, the oxygen supply and the light source all differ, and that there is no consensus set of conditions to state. The process is therefore controlled by assay: a run is sampled periodically, the THC and CBN figures are followed, and the run is stopped when the ratio reaches the target, which is a different discipline from following a recipe. Two practical constraints are consistent across sources. Selectivity is poor — the same oxidative pressure that makes CBN also makes the hydroxylated and other degradation products, so a converted material is a mixture and its full profile should be characterised rather than assumed. And the conversion is not quantitative, so mass balance has to be measured rather than presumed.',
        bullets: F([
          'Levers: oxygen contact, temperature, ultraviolet or near-ultraviolet light, time, and interfacial area. Nothing exotic is required, which is the whole point.',
          'Controlled by assay, not by clock. Sample, measure THC and CBN, stop at the target ratio.',
          'Reported parameters vary widely between sources and are not comparable; treat any single set of numbers as that operator experience with that geometry.',
          'Selectivity is poor. Expect a mixture including hydroxylated degradation products; characterise it rather than assuming CBN plus unreacted THC.',
          'Residual THC is the compliance question. A CBN product made from THC-rich input carries whatever THC survived and has to be assayed against the operative limit.',
          'Input choice matters: a distillate input gives a cleaner profile than plant material, which brings its own oxidation chemistry from chlorophyll and lipids.',
        ]),
        cites: F(['turner1979', 'fairbairn1976', 'trofin2012', 'tradePractice', 'hazekamp2007']),
        evidence: 'industry practice',
        contested: true,
        caveat: 'Published and trade parameters for deliberate CBN conversion disagree widely, and no consensus conditions exist. Temperatures, exposure times, light sources and reported conversion extents are not comparable across sources because input material, oxygen supply, film geometry and analytical method all differ. Nothing here should be read as a specification; the defensible practice is to characterise a specific process by assay in the specific equipment used.',
      }),
      F({
        h: 'CBN pharmacology, honestly',
        body: 'CBN is a weak cannabinoid-receptor ligand. Binding studies place its affinity at CB1 well below that of Δ9-THC, with a preference pattern across CB1 and CB2 that varies with the assay, and functional work on cannabinol derivatives characterised the series as low-potency relative to the parent. The human record is old and small. Cannabinol administered to human subjects in the 1970s produced little in the way of subjective effect on its own: an intravenous comparison of Δ9-THC, cannabinol and cannabidiol found cannabinol far less active than THC, and a separate human study of THC and cannabinol found that cannabinol alone produced minimal effects while altering some responses when given with THC. That is essentially the human dataset, and it is why the standard description of CBN as non-intoxicating or minimally intoxicating at ordinary doses is a reasonable reading of the evidence rather than a strong claim. What CBN does not have is a modern human pharmacology literature: there is no contemporary dose-ranging subjective-effects work, and there is very little on its non-cannabinoid targets.',
        bullets: F([
          'Weak CB1 affinity relative to Δ9-THC; CB1 and CB2 selectivity varies by assay and is not consistently reported.',
          'Minimal subjective effect alone in the small 1970s human studies; described as non- or minimally intoxicating at ordinary doses.',
          'No modern human dose-ranging subjective-effects study was located in this pass.',
          'It is a genuine cannabinoid-receptor ligand, so it is not pharmacologically inert; weak is not the same as inactive.',
        ]),
        cites: F(['rhee1997', 'showalter1996', 'perezreyes1973', 'karniol1975', 'pollastro2018']),
        evidence: 'human',
        contested: true,
        caveat: 'The human data are from small studies conducted in the 1970s with methods and endpoints that would not be accepted today, and the binding data come from a small number of in-vitro papers whose absolute values differ. Statements about CBN potency and intoxication should be read as the best available reading of a thin record, not as settled quantitative pharmacology.',
      }),
      F({
        h: 'The sedative claim: what is actually behind it',
        body: 'CBN is marketed almost entirely as a sleep cannabinoid, and that positioning rests on much less than its prominence suggests. The specific historical problem, which has been set out directly in the recent literature, is that the older human work that generated the sedation impression frequently administered cannabinol together with Δ9-THC, and THC has documented sedative effects of its own, so the sedation observed in those studies cannot be attributed to cannabinol. A review examining the question concluded that the evidence for cannabinol as a sedative is weak and that the belief is better explained by that confound and by subsequent repetition than by data. Two further factors sustain the claim commercially. The aged-cannabis folklore is intuitive and wrong in a specific way: old cannabis is described as sleepy, and old cannabis is high in CBN, but old cannabis is also low in THC, and a weaker product producing a duller, heavier experience is exactly what a loss of potency feels like. And CBN had a commercial vacancy to fill: it was the cannabinoid a processor could make from degraded or low-value THC-rich material, which meant there was a supply looking for a story. None of this establishes that CBN is not sedating. It establishes that the claim is not supported to the standard the market implies, and the honest statement on a label or a page is that human evidence is limited and the sedative reputation is substantially confounded.',
        bullets: F([
          'The principal confound: older human studies co-administered THC, which is itself sedating.',
          'The folklore confound: aged cannabis is both higher in CBN and lower in THC, so the sedation attributed to CBN may be the loss of THC.',
          'The commercial driver: CBN is the value-recovery product for degraded THC-rich material, which gave the claim a constituency.',
          'What would settle it: a placebo-controlled human trial of isolated CBN at defined doses with objective and subjective sleep endpoints. Not located in this pass.',
        ]),
        cites: F(['corroon2021', 'karniol1975', 'perezreyes1973', 'fairbairn1976']),
        evidence: 'human',
        contested: true,
        caveat: 'This is the contested claim on the page. CBN is widely sold as a sleep aid; the human evidence for a sedative effect of isolated CBN is thin, and a published review attributes the impression largely to co-administered THC in the older studies. Absence of good evidence is not evidence of absence — CBN may prove sedating — but the current record does not support the marketing.',
      }),
      F({
        h: 'Product category and shelf-life implications',
        body: 'Commercially CBN occupies a narrow and specific position. It appears as an isolate, as a minor component of full-spectrum products where it arrived by degradation rather than by design, and as the headline in sleep-positioned tinctures, gummies and capsules, often blended with melatonin or sedative botanicals whose contribution to any observed effect is not separable from the cannabinoid. A processor should understand three consequences. First, the material is itself a degradation product, which does not make it stable: the aromatic system is more robust than the alkene it replaced, but CBN products are still subject to oxidation and light exposure and still need the packaging discipline set out on the edibles page. Second, a CBN specification on a finished product is a moving target if the product also contains THC, because THC continues to become CBN on the shelf, so a product labelled for both will drift in one direction over its life, and a stability programme should quantify the drift rather than assume it away. Third, the analytical and compliance framing: CBN is on most modern cannabinoid panels, unlike cannabitriol, so it is visible and quantifiable, and the residual THC in a CBN product is the number a regulator and a buyer will look at. For a buyer, the useful diagnostic is the whole panel rather than the CBN figure alone — a CBN-rich product with a full complement of oxidised minor cannabinoids looks like aged or converted material, which may be exactly what it is and should be described as such.',
        bullets: F([
          'Category: isolate, incidental full-spectrum component, and sleep-positioned finished goods usually blended with other sedatives.',
          'CBN in a THC-containing product rises over shelf life. Label and stability data have to accommodate a moving ratio.',
          'CBN is on standard panels, so it is visible; residual THC in a CBN product is the compliance number.',
          'Blended sleep products confound their own evidence: melatonin and sedative botanicals are doing identifiable work.',
          'Transparency position: material made by deliberate oxidative aging should be described as such, which is a claim about process and not an admission of a defect.',
        ]),
        cites: F(['zamengo2019', 'trofin2012', 'fairbairn1976', 'corroon2021', 'tradePractice']),
        evidence: 'industry practice',
      }),
    ]),
    seeAlso: F(['processing/decarboxylation', 'cannabinoids/transformations', 'cannabinoids/structural-classes', 'products/viscosity-and-cbt', 'products/edibles', 'coa/reading-a-coa', 'coa/total-thc-math', 'coa/red-flags', 'safety/converted-cannabinoid-products']),
    cites: F(['turner1979', 'turner1980', 'elsohly2005', 'hanus2016', 'pollastro2018', 'fairbairn1976', 'trofin2012', 'zamengo2019', 'wang2016', 'hazekamp2007', 'rhee1997', 'showalter1996', 'perezreyes1973', 'karniol1975', 'corroon2021', 'tradePractice']),
  }),

]);

export default { SHELF, CITES, PAGES };
