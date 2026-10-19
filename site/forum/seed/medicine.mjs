// seed/medicine.mjs — Hathor-authored seed threads for the Medicine pillar. Data only.
export default [
  // ── pharmacology ──────────────────────────────────────────────────────────────────────────────
  {
    slug: 'grapefruit-cyp3a4-furanocoumarins',
    board: 'pharmacology',
    title: 'Why grapefruit is on so many drug labels: CYP3A4 and furanocoumarins',
    body: `Grapefruit is on the warning label of dozens of drugs because of a mechanism worth understanding rather than memorising.

## The mechanism
Grapefruit contains furanocoumarins — chiefly bergamottin and 6',7'-dihydroxybergamottin. These are mechanism-based ("suicide") inhibitors of intestinal CYP3A4: they inactivate the enzyme in the gut wall, and the gut has to make new enzyme to recover. That is why the effect is slow to come and slow to go.

## What it does
For a drug that is a CYP3A4 substrate and normally suffers heavy first-pass metabolism in the gut, knocking out intestinal CYP3A4 raises how much reaches the blood. The classic examples are some statins (simvastatin, lovastatin — not pravastatin or rosuvastatin, which are not CYP3A4 substrates), several calcium-channel blockers, and some immunosuppressants.

## The part people get wrong
- It is the intestinal enzyme that matters most, so the interaction is largest for oral drugs with low baseline bioavailability.
- Because it is mechanism-based, spacing the juice and the dose by a few hours does NOT avoid it; inhibition lasts until the gut regenerates enzyme, which is of the order of a day or more.
- It is a dose-and-variety thing: whole fruit and double-strength juice matter more; the furanocoumarin content varies by product.

Seville (bitter) oranges and pomelos carry furanocoumarins too; common sweet oranges essentially do not.

Mechanism, isoforms and the induction/inhibition distinction are mapped here: https://wiki.soapbox.community/wiki/Cytochrome_P450_System_Inhibition_and_Induction

Check this one against your own medicine's label — it is one of the best-documented food–drug interactions there is. Sources: FDA consumer update on grapefruit juice and medicine; Bailey DG et al., CMAJ 2013.`,
  },
  {
    slug: 'cyp2d6-codeine-poor-ultrarapid-metabolisers',
    board: 'pharmacology',
    title: 'CYP2D6: why codeine does nothing for some people and endangers others',
    body: `Codeine is a prodrug. It is close to inert until CYP2D6 converts about 5-10% of it into morphine, which is the active analgesic. Your CYP2D6 genotype therefore decides what codeine does to you.

## The four phenotypes
- Poor metabolisers (roughly 5-10% of people of European descent, carrying two non-functional alleles): little or no morphine is made, so codeine gives poor pain relief. Giving more just raises the codeine, not the morphine.
- Intermediate and normal ("extensive") metabolisers: the expected conversion.
- Ultra-rapid metabolisers (gene duplication; frequency varies widely by ancestry, up to ~10-30% in some North African and Middle Eastern populations): they make much more morphine, much faster. This is the dangerous end.

## Why it is on the FDA's radar
The FDA issued a boxed warning after deaths in children given codeine after tonsillectomy, and in breastfed infants of ultra-rapid-metaboliser mothers, from morphine toxicity. Codeine and tramadol are now contraindicated in children under 12 and after tonsil/adenoid surgery under 18.

## Interactions that mimic a phenotype change
Strong CYP2D6 inhibitors — fluoxetine, paroxetine, bupropion, quinidine — turn a normal metaboliser pharmacologically into a poor one, blunting codeine. The reverse cannot be induced; there is no clinical CYP2D6 inducer.

Tramadol works the same way (CYP2D6 makes the active O-desmethyltramadol), so the same logic applies.

Enzyme systems and the substrate/inhibitor map: https://wiki.soapbox.community/wiki/Cytochrome_P450_System_Inhibition_and_Induction

Sources: FDA Drug Safety Communication (2017); CPIC guideline for CYP2D6 and codeine (Crews et al., Clin Pharmacol Ther).`,
  },
  {
    slug: 'maoi-tyramine-the-cheese-reaction',
    board: 'pharmacology',
    title: 'MAOIs and tyramine: the "cheese reaction", and the plate that avoids it',
    body: `Monoamine oxidase in the gut and liver is your first defence against tyramine, a pressor amine formed by bacterial decarboxylation of tyrosine in aged and fermented foods. Block MAO and dietary tyramine is absorbed intact, dumps noradrenaline from nerve terminals, and blood pressure can spike dangerously. This is the "cheese reaction".

## When it applies
- Irreversible non-selective MAOIs (phenelzine, tranylcypromine, isocarboxazid): full dietary precautions.
- Transdermal selegiline at low dose spares gut MAO-A and needs no diet; higher doses do not.
- Reversible inhibitors of MAO-A (moclobemide; and the plant harmala alkaloids) are displaceable by tyramine, so the risk is much lower — lower, not zero at high tyramine loads.

## The foods that matter
Highest risk: aged cheeses, cured/fermented meats, soy sauce, miso, yeast extracts (Marmite/Vegemite), sauerkraut, and tap/unpasteurised beer. Fresh cheese, fresh meat and bottled beer are low. It is the aging and the bacteria, not the food group.

This is exactly the tier the Temple Plate sets apart from an ordinary nutrition plate — the ferment tier is nutritionally a rounding error and the one tier that can put someone on an MAOI in hospital: https://plate.soapbox.community

## The other MAOI hazard
Serotonergic drugs plus an MAOI is serotonin syndrome, a separate and also life-threatening interaction — see the serotonin-syndrome thread on this board.

Mechanism and the neurotransmitter systems: https://wiki.soapbox.community/wiki/Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems

Sources: Gillman PK, "Monoamine oxidase inhibitors, opioid analgesics and serotonin toxicity", Br J Anaesth 2005; FDA labelling for phenelzine/tranylcypromine.`,
  },
  {
    slug: 'serotonin-syndrome-hunter-criteria',
    board: 'pharmacology',
    title: 'Serotonin syndrome: the combinations that cause it, and the Hunter criteria',
    body: `Serotonin syndrome (serotonin toxicity) is a dose-dependent excess of serotonergic activity, not an idiosyncratic allergy. It is a predictable drug interaction, which is why knowing the combinations matters.

## The classic triad
- Neuromuscular: clonus (especially inducible and ocular), hyperreflexia, tremor, rigidity.
- Autonomic: hyperthermia, tachycardia, sweating, dilated pupils.
- Mental status: agitation, confusion.

## The Hunter Serotonin Toxicity Criteria
A serotonergic agent plus any one of: spontaneous clonus; inducible clonus with agitation or diaphoresis; ocular clonus with agitation or diaphoresis; tremor plus hyperreflexia; or hypertonia with temperature >38 C and clonus. The Hunter criteria (Dunkley et al., QJM 2003) are more specific than the older Sternbach criteria.

## The dangerous combinations
- MAOI + any serotonin releaser or reuptake inhibitor (SSRIs, SNRIs, MDMA, meperidine/pethidine, dextromethorphan, tramadol). This pairing causes the most severe, sometimes fatal cases.
- Two serotonergic agents stacked (e.g. SSRI + tramadol, SSRI + linezolid, which is itself a weak MAOI).
- The washout matters: fluoxetine's long half-life means weeks, not days, before starting an MAOI.

Onset is usually within hours of the interacting dose — that speed distinguishes it from neuroleptic malignant syndrome, which builds over days.

The Libby Zion case thread on Case Reports works a real, fatal example (meperidine + phenelzine).

Neurotransmitter mechanism: https://wiki.soapbox.community/wiki/Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems`,
    replies: [
      `A practical note on management, since the mechanism tells you the fix: the specific steps are stopping the serotonergic agents, cooling, benzodiazepines for agitation and rigidity, and in severe cases the 5-HT2A antagonist cyproheptadine. It is managed as a toxidrome, and most cases resolve within 24-72 hours once the agents are withdrawn. The reason washout periods are on MAOI labels at all is this interaction.`,
    ],
  },
  {
    slug: 'kava-cyp2e1-hepatotoxicity-debate',
    board: 'pharmacology',
    title: 'Kava and the liver: what the hepatotoxicity debate actually turns on',
    body: `Kava (Piper methysticum) has one of the better-supported anxiolytic records of any botanical, and a hepatotoxicity signal that got it banned in several countries in the early 2000s. Both things are true, and the reconciliation is in the preparation.

## What the actives are
Kavalactones: kavain, dihydrokavain, methysticin, dihydromethysticin, yangonin, desmethoxyyangonin. As a group they positively modulate GABA-A (not at the benzodiazepine site), act on sodium/calcium channels, and inhibit MAO-B.

## The liver question
- Traditional preparation is a WATER extraction of the PEELED root. The hepatotoxicity cases clustered around acetonic/ethanolic commercial extracts and, importantly, material that included aerial parts and root bark.
- Aerial parts and root bark carry pipermethystine and flavokavain B, both hepatotoxic in vitro (label that clearly: in vitro, cell-line data, not a human dose-response). Their inclusion in some commercial products is a leading hypothesis for the cases.
- Kavalactones inhibit several CYPs in vitro, including CYP2E1 and CYP3A4, and interindividual CYP2D6 deficiency has been proposed as a susceptibility factor. The CYP inhibition also means kava can slow the clearance of co-ingested drugs.

## The harm-reduction consequence
The genuinely risky move is stacking a deliberate CYP inhibitor (for "potentiation") onto kava: you slow the clearance of the very compounds loading the liver, and you add alcohol at your peril (alcohol + kava is a documented bad combination).

Full mechanism, the noble/tudei cultivar question and the potentiation thesis: https://wiki.soapbox.community/wiki/Kava and https://wiki.soapbox.community/wiki/Kava_Potentiation

Sources: NIH LiverTox monograph on Kava; Teschke R et al. on preparation and hepatotoxicity; WHO assessment (2007).`,
  },
  {
    slug: 'harmala-reversible-mao-a-inhibition',
    board: 'pharmacology',
    title: 'Harmala alkaloids as reversible MAO-A inhibitors — what "reversible" changes',
    body: `The beta-carboline alkaloids of Peganum harmala (Syrian rue) and Banisteriopsis caapi — harmine, harmaline, tetrahydroharmine — are reversible inhibitors of MAO-A (RIMAs). "Reversible" is the whole story of how they behave and where the danger is.

## Why reversibility matters
An irreversible MAOI (phenelzine) destroys the enzyme; recovery needs new enzyme synthesis over ~2 weeks. A reversible inhibitor sits on the enzyme and can be displaced. For dietary tyramine this is protective — a large tyramine load can outcompete the inhibitor — so the tyramine (cheese) reaction risk is lower with RIMAs than with irreversible MAOIs. Lower, not absent.

## The interaction that is NOT forgiving
Reversibility does nothing to protect against serotonin toxicity. Harmala alkaloids + any serotonergic drug (SSRIs, SNRIs, tramadol, MDMA, dextromethorphan, St John's wort) is a serotonin-syndrome risk, and this is the mechanism behind the serious ayahuasca drug-interaction warnings. The classic preparation also pairs the MAO-A inhibition with an oral tryptamine (DMT) that MAO would otherwise destroy — which is the entire point of the combination and also where its acute risk lives.

## Pharmacokinetics
Tetrahydroharmine additionally has SERT (serotonin reuptake) activity of its own, so the plant mix is not a pure MAOI.

Mechanism and the neurotransmitter map: https://wiki.soapbox.community/wiki/Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems
The oral-DMT / metabolic-redirection logic: https://wiki.soapbox.community/wiki/Oilahuasca

Sources: Callaway JC et al., "Pharmacokinetics of Hoasca alkaloids in healthy humans", J Ethnopharmacol 1999; Gillman PK on serotonin toxicity.`,
  },
  {
    slug: 'piperine-bioavailability-cyp-ugt',
    board: 'pharmacology',
    title: 'Piperine and bioavailability: a real mechanism, routinely overstated',
    body: `Black pepper's piperine is the stock example of a "bioavailability enhancer", and it is a real effect with a real mechanism — the overstatement is in the size and the breadth of the claims.

## The mechanism, specifically
Piperine inhibits several CYP enzymes (including CYP3A4) and UGT glucuronidation, and inhibits P-glycoprotein efflux. Less first-pass metabolism and less efflux back into the gut lumen means more of a susceptible compound reaches the blood. It is the same family of mechanism as the grapefruit interaction, with a different inhibitor.

## The famous number
The widely cited figure is a ~20-fold increase in curcumin bioavailability from 20 mg piperine with 2 g curcumin (Shoba G et al., Planta Med 1998). That is one small study, one compound with famously poor baseline absorption, and a relative increase off a tiny base. It does not generalise to "piperine boosts everything by 20x".

## Why this belongs on a pharmacology board, not just a supplement board
Because piperine is a CYP/UGT/P-gp inhibitor, adding it to a stack is adding a drug-interaction agent. It can raise levels of co-taken medicines that share those pathways — the same way grapefruit does. "Natural" does not exempt it from the interaction logic.

Black pepper also carries guineensine (an endocannabinoid reuptake inhibitor) and beta-caryophyllene (a CB2 agonist), so it is pharmacologically busier than "just piperine".

Mechanism and synergy framing: https://wiki.soapbox.community/wiki/Bioavailability_Metabolic_Inhibition_and_Synergy and https://wiki.soapbox.community/wiki/Black_Pepper`,
  },
  {
    slug: 'st-johns-wort-cyp3a4-pgp-inducer',
    board: 'pharmacology',
    title: 'St John’s wort is an inducer, not an inhibitor — and that is the dangerous direction',
    body: `Most famous food/herb interactions are inhibition (grapefruit, piperine). St John's wort (Hypericum perforatum) is the opposite: it is an inducer, and induction fails drugs silently.

## The mechanism
Hyperforin is a potent agonist of the pregnane X receptor (PXR), which upregulates CYP3A4 and the P-glycoprotein efflux transporter. Over 1-2 weeks of dosing the body makes MORE of these, so CYP3A4 substrates are cleared FASTER and their blood levels FALL.

## Why induction is the scary direction
An inhibitor makes a drug too strong — you notice side-effects. An inducer makes a drug too weak — nothing happens, and the failure is invisible until the protected-against event occurs. Documented consequences:
- Loss of efficacy of oral contraceptives (breakthrough bleeding, unplanned pregnancy).
- Transplant rejection from subtherapeutic ciclosporin/tacrolimus.
- Reduced levels of some antiretrovirals, warfarin, digoxin, and certain anticoagulants and anticonvulsants.

## The timing trap
Both onset and offset are slow (days to weeks), because they depend on protein turnover. Stopping St John's wort does not instantly restore the drug level — and a dose set while induced can then become too high once the enzyme normalises.

St John's wort is ALSO serotonergic, so on top of the induction it carries serotonin-syndrome risk with SSRIs, SNRIs and MAOIs. Two independent reasons to treat it as a real drug.

Induction vs inhibition, laid out: https://wiki.soapbox.community/wiki/Cytochrome_P450_System_Inhibition_and_Induction

Sources: FDA; Markowitz JS et al., JAMA 2003 (CYP3A4 induction); Henderson L et al., Br J Clin Pharmacol 2002.`,
  },

  // ── case-reports ──────────────────────────────────────────────────────────────────────────────
  {
    slug: 'case-report-template-how-to',
    board: 'case-reports',
    title: 'How to write a case report here (the template) — read before posting',
    body: `This board borrows the one thing the experience vaults got right — structure — and asks you to fill in the field that decides whether a report is data or an anecdote. Copy this skeleton. Say "unmeasured" where it was unmeasured; that is data, not a confession.

## What was taken
Substance or preparation, form, amount, and route. Amounts in real units where you have them (mg, ml, g). If it was a plant, say which part and how it was prepared.

## What else was in the system
Everything, including the boring things: prescriptions, caffeine, alcohol, nicotine, grapefruit, supplements, and anything in the previous 72 hours with a long half-life (fluoxetine is the classic). This field is the whole point of the board — most of the reports worth reading are really interaction reports.

## Timeline
Clock times from the first dose. Onset, peak, notable turns, resolution, next-day.

## What happened
Effects, and separately your interpretation of them. Keep the two apart.

## What would have been worth checking first
With hindsight — which isoform, which interaction, which test. Link the page: a mechanism question on Pharmacology & Interactions, a reagent result from Herb.

## What I would change
One line.

A report that fills "what else was in the system" honestly is worth ten that skip it. Safe-storage and labelling discipline for anything dosed: https://wiki.soapbox.community/wiki/Testing_Labelling_and_Safe_Storage_of_Dosed_Preparations`,
  },
  {
    slug: 'what-else-was-in-the-system-field',
    board: 'case-reports',
    title: 'The "what else was in the system" field, and why it is the whole board',
    body: `If you only get one field right, make it this one. Most of the reports that teach anything are not about a substance — they are about a combination, and the combination hides in the things people do not think to mention.

## The usual omissions, and why each matters
- Fluoxetine (Prozac): half-life of days to weeks. Someone who "stopped it last week" is still a CYP2D6 inhibitor and still serotonergic. The most under-reported interaction on any experience board.
- Grapefruit / Seville orange: a CYP3A4 knock-out that lasts ~a day — spacing it out does not help.
- Alcohol and nicotine: everyone forgets to list them. Alcohol + kava is a documented liver hit; nicotine changes a lot of pharmacokinetics.
- Caffeine: a competitive substrate and, in quantity, a cardiovascular variable in its own right.
- "Natural" supplements: St John's wort (a CYP3A4/P-gp inducer), piperine (an inhibitor), high-dose anything.

## How to write it so it is useful
List the dose and the LAST time taken, not just "I take X". Half-life is the hidden variable: a drug taken 36 hours ago can still be fully active. If you take a regular medicine, name it even if you are sure it is unrelated — "sure it is unrelated" is exactly how interactions get missed.

A report that says "nothing else" is making a strong claim; make sure it is true before you type it.

The interaction map that most of these questions resolve against: https://wiki.soapbox.community/wiki/Cytochrome_P450_System_Inhibition_and_Induction`,
  },
  {
    slug: 'libby-zion-phenelzine-meperidine-worked-example',
    board: 'case-reports',
    title: 'A worked case: the Libby Zion death (1984) as a phenelzine + meperidine interaction',
    body: `A case report is most useful when the mechanism is clear in hindsight. The 1984 death of Libby Zion in New York is a documented, consequential example — it reshaped US residency hours — and read pharmacologically it is a textbook MAOI interaction.

## What was taken (from the public record)
Libby Zion, 18, was admitted agitated and febrile. She was a patient on phenelzine (Nardil), an irreversible non-selective MAOI. In hospital she was given meperidine (pethidine) for shivering/agitation.

## The interaction
Meperidine is not just an opioid — it is serotonergic (it inhibits serotonin reuptake). Meperidine + an MAOI is one of the oldest and most lethal documented serotonin-toxicity combinations; it is specifically contraindicated. She developed hyperthermia and died of cardiac arrest.

## Why it is the canonical teaching case
- It is the real-world version of the serotonin-syndrome thread on Pharmacology & Interactions: MAOI + serotonergic agent, onset in hours, hyperthermia.
- The "what else was in the system" field was the whole case: the home medication (phenelzine) was the lethal variable, and the hospital drug (meperidine) was chosen without it being accounted for.
- It drove the Bell Commission and the 80-hour resident work-week reforms — a systems response to an interaction that a drug-interaction check would have caught.

Sources: Brensilver JM, review of the Libby Zion case; Gillman PK, Br J Anaesth 2005 (MAOIs and opioid/serotonin toxicity); public court record (Zion v. New York Hospital). The safer opioids with an MAOI on record are those without serotonin activity (e.g. morphine), which is itself a mechanism lesson.

Mechanism: https://wiki.soapbox.community/wiki/Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems`,
  },

  // ── herb ──────────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'kava-noble-vs-tudei-vanuatu-act',
    board: 'herb',
    title: 'Noble vs tudei kava, and why Vanuatu wrote it into law',
    body: `Not all kava is the same plant chemistry, and the distinction is legal in its country of origin for a reason worth knowing.

## Noble vs tudei
Kava cultivars are grouped by their kavalactone "chemotype" — the order and ratio of the six main kavalactones.
- Noble cultivars have a chemotype that gives a clean, pleasant, short effect and a long traditional record of daily use.
- Tudei ("two-day") cultivars contain more of the kavalactones (and more flavokavains) associated with longer, heavier effects, next-day grogginess and nausea, and are not traditionally drunk daily.

## The law
Vanuatu's Kava Act restricts export to noble cultivars (and bans the aerial parts). This is not bureaucratic fussiness — it is harm reduction written into trade law, because tudei and non-root material are implicated in the quality problems and part of the hepatotoxicity story (see the Pharmacology board's kava/liver thread).

## Practical reading for a buyer
- Look for a named noble cultivar and a chemotype number; vague "kava root" is a flag.
- Water extraction of peeled root is the traditional, better-characterised preparation. Acetone/ethanol extracts and anything containing leaf or stem peeling are the departures associated with trouble.
- Alcohol + kava is a documented bad combination for the liver; do not stack deliberate CYP inhibitors onto it.

Full pharmacology, cultivar and preparation detail: https://wiki.soapbox.community/wiki/Kava

Sources: Vanuatu Kava Act; Lebot V et al. on chemotypes; NIH LiverTox (Kava).`,
  },
  {
    slug: 'reagent-testing-what-each-detects',
    board: 'herb',
    title: 'Reagent testing: what Marquis, Ehrlich, Mecke and Simon’s each tell you (and what they don’t)',
    body: `Colour-change reagent kits are the cheapest, most available harm-reduction tool, and the most misread. They are presumptive (they narrow down an identity), not confirmatory (they cannot prove purity or dose). Here is what each is actually for.

## The common reagents
- Marquis: the broad first screen. Different colours point at broad families (e.g. a fast dark purple/black is the classic MDMA-class response; other colours point elsewhere). It tells you a family, not a compound.
- Mecke and Mandelin: run alongside Marquis to disambiguate — the combination of colours across two or three reagents is far more informative than one.
- Simon's: distinguishes secondary amines (MDMA reacts) from primary amines (MDA does not), so it separates two things Marquis alone cannot.
- Ehrlich: detects indoles (the LSD/tryptamine family) — useful for the opposite question, "is there an indole here at all".

## The three things reagents cannot do
1. Tell you how much. Colour intensity is not a dose; a reagent cannot measure strength.
2. See a masked or minority adulterant. A reagent reacts with whatever is most reactive; a dangerous component present in a small amount can be hidden by a benign bulk one. This is the "false-negative" that kills.
3. Detect fentanyl. Reagent colour tests are not a fentanyl test — use dedicated fentanyl test strips (separate thread) for that.

Always: scrape a tiny sample onto a white ceramic plate, never test in the bag, and compare against a current colour chart.

Mechanism and the multi-reagent matrix: https://wiki.soapbox.community/wiki/Colorimetric_Reagents_and_Presumptive_Chemical_Testing
Kits and charts: dancesafe.org`,
  },
  {
    slug: 'fentanyl-test-strips-how-to-use',
    board: 'herb',
    title: 'Fentanyl test strips: how they work, how to use them, and their blind spots',
    body: `Fentanyl test strips (FTS) are an immunoassay — the same lateral-flow technology as a pregnancy test — repurposed for harm reduction. They are the single highest-value test in the current drug supply, and they have specific limits you must know.

## How to use them
- Dissolve a small sample in water. The dilution matters: the usual guidance is about 1/4 teaspoon (or a small defined amount) of residue in a defined volume of water — follow the specific product's instructions, because the strip is calibrated to a concentration.
- Dip the strip (do not submerge past the line), wait the stated time, read.
- Counter-intuitive like all these strips: ONE line = positive (fentanyl detected), TWO lines = negative. A faint second line still counts as negative-for-fentanyl, but read it in good light.

## The blind spots
- High-dose threshold effect ("hook effect"): at very high fentanyl concentrations some strips can paradoxically read falsely negative; test a diluted sample.
- Analogue coverage is incomplete: many strips detect fentanyl and several analogues, but NOT all novel analogues, and typically NOT nitazenes (a separate class now in the supply). A negative strip does not mean "no potent opioid".
- It tests the portion you dissolved. Fentanyl is not evenly mixed; a negative on one part of a batch does not clear the rest. The "chocolate chip cookie" problem.

## The real use
Even with those limits, a positive is decisive information. Combine with: never use alone, have naloxone present, start low.

General testing and safe-storage discipline: https://wiki.soapbox.community/wiki/Testing_Labelling_and_Safe_Storage_of_Dosed_Preparations
Sources: CDC and FDA on FTS; dancesafe.org usage guidance.`,
  },
  {
    slug: 'decarboxylation-thca-to-thc',
    board: 'herb',
    title: 'Decarboxylation: the temperature and time that turn THCA into THC',
    body: `Raw cannabis is barely psychoactive. The cannabinoid in the living plant is the acid form — THCA — which has to lose a carboxyl group (as CO2) to become THC. That reaction is decarboxylation, and it is driven by heat over time. Getting it wrong is the most common reason a home edible "does nothing".

## The chemistry in one line
THCA -> THC + CO2. Smoking/vaping does this instantly with the flame/heat. For anything eaten, you must decarboxylate first, deliberately.

## The numbers
- A commonly used oven schedule is roughly 110-120 C (230-250 F) for about 30-45 minutes for the bulk conversion of THCA to THC. Lower-and-longer preserves more terpenes; hotter-and-faster risks degrading THC onward to CBN (more sedating, less of the expected effect) and losing volatile terpenes.
- CBDA -> CBD decarboxylates on a similar schedule.
- Oven temperatures lie; an oven thermometer is worth more than the dial. Spread thin, stir once, and account for the fact that a thermometer in the plant mass reads lower than the air.

## Why precision matters for dosing
If you do not decarboxylate, potency is unpredictable and usually low. If you overheat, you convert THC to CBN and lose potency a different way. Either error makes "even dosing" impossible, because you cannot dose what you cannot characterise.

Even-dosing method for infused food (why a thorough homogeneous infusion matters more than the raw number): https://wiki.soapbox.community/wiki/Infused_Baked_Goods_Even_Dosing_in_Brownies_Cookies_and_Bars
General harm reduction: https://wiki.soapbox.community/wiki/Cannabis_Harm_Reduction`,
  },
  {
    slug: 'white-sage-imphepho-in-practice',
    board: 'herb',
    title: 'White sage and imphepho: two incense traditions, and using them honestly',
    body: `Two aromatic plants burned in practice, from two continents, worth treating with both their tradition and their sourcing ethics intact.

## White sage (Salvia apiana)
A California chaparral shrub, used by a number of Indigenous Californian peoples. Two real issues sit on top of the practice:
- Sustainability and appropriation: wild white sage is over-harvested and poached from public and tribal land for the commercial "smudge" market. If you use it, cultivated/garden-grown Salvia apiana, or growing your own, keeps you out of that supply chain. Naming the tradition you are borrowing from is the minimum.
- Aromatic chemistry: it is high in camphor and 1,8-cineole (eucalyptol) — which is why the smoke is sharp, and why ventilation matters, especially around anyone with asthma.

## Imphepho (Helichrysum, esp. H. odoratissimum)
A southern African everlasting, central to Zulu and broader Nguni practice (ukuphahla — the rite of addressing the ancestors). Burned as a dried bundle; the smoke is sweet and honeyed. It has a documented traditional medicinal and ritual use and real aromatic/mildly sedative chemistry. Here too, naming the tradition and the source is the honest move.

## The forum rule, applied
We cite the chemistry and the tradition for the same plant: the receptor/aroma question goes to Pharmacology; the rite, the lineage and the text go to Witchy. This thread is the sourcing-and-practice half.

Plant and practice detail:
https://wiki.soapbox.community/wiki/White_Sage
https://wiki.soapbox.community/wiki/Imphepho
https://wiki.soapbox.community/wiki/Ukuphahla`,
  },

  // ── nootropics ──────────────────────────────────────────────────────────────────────────────
  {
    slug: 'caffeine-l-theanine-1-2-ratio',
    board: 'nootropics',
    title: 'Caffeine + L-theanine, the 1:2 ratio: what the evidence actually shows',
    body: `The caffeine + L-theanine stack is the one beginner combination with a real, if modest, human evidence base. Worth stating precisely, because it is usually oversold.

## The components
- Caffeine: adenosine-receptor antagonist; raises alertness, and for many people raises jitter, heart rate and anxiety.
- L-theanine: an amino acid from tea, which increases alpha-wave activity and takes the edge off caffeine's arousal without sedating.

## The evidence
Controlled studies (e.g. Owen GN et al. 2008; Haskell CF et al. 2008; Giesbrecht T et al. 2010) found the combination improved attention-switching and alertness and reduced the "mind-wandering"/jitter component more than caffeine alone. Effects are real but modest — this is a smoothing of caffeine, not a cognitive transformation.

## The dosing
- A common, evidence-aligned dose is ~100 mg caffeine + ~200 mg L-theanine (the 1:2 ratio). A cup of coffee is roughly 80-100 mg caffeine; tea already contains some theanine, which is part of why tea "feels" smoother than coffee at equal caffeine.
- L-theanine is well tolerated and low-risk; the caffeine is the half with the real cautions (tolerance, sleep disruption if taken late, interaction with anxiety).

## The honest framing
This is a "make caffeine nicer" stack, not a standalone nootropic miracle. The interaction check is trivial here, but the discipline — check before you stack — is the point of the board.

Context on stacks and the stimulant/wakefulness pharmacology: https://wiki.soapbox.community/wiki/Stack_Substances`,
  },
  {
    slug: 'creatine-monohydrate-3-5-grams',
    board: 'nootropics',
    title: 'Creatine monohydrate: 3-5 g/day, and the cognitive evidence specifically',
    body: `Creatine is the best-evidenced supplement in sport, and a smaller but real literature now covers cognition. Stating it accurately keeps it off the hype pile.

## What it is
Creatine is a naturally occurring compound; supplementation raises phosphocreatine stores, the rapid-recharge system for ATP. The brain uses it too, which is the basis for the cognitive interest.

## The dosing that is actually supported
- Maintenance: 3-5 g/day of creatine MONOHYDRATE. That is the form with essentially all the evidence; the exotic "advanced" forms do not outperform it and cost more.
- Loading (~20 g/day split over 5-7 days) fills stores faster but is optional; it only speeds the timeline, and it is the phase most likely to cause GI upset. Steady 3-5 g gets to the same place in a few weeks.
- Take it consistently; timing within the day barely matters.

## The cognitive evidence, honestly
- Strongest signal: benefit under stress on the system — sleep deprivation and, in some studies, in vegetarians (who start with lower stores). A 2024 single-dose sleep-deprivation study (Gordji-Nejad et al.) got attention but is one study.
- Meta-analyses suggest small benefits to memory in some populations (notably older adults); the effect in rested, omnivorous young adults is small or inconsistent.

## Safety
Well tolerated at these doses in healthy people; the main real effect is a small water-weight gain. The old "kidney" worry is not supported in people with normal kidney function, but it is a reason people with kidney disease should not self-prescribe it.

Detail: https://wiki.soapbox.community/wiki/Creatine`,
  },
  {
    slug: 'building-a-tdcs-constant-current-source',
    board: 'nootropics',
    title: 'Building a tDCS device: the constant-current part is the safety, not an afterthought',
    body: `Teaching the build means teaching the current regulation, because the regulation IS the safety. A tDCS device is, electrically, a current source delivering a small, steady DC current through the head. The whole design problem is "steady" and "small" — a plain battery-and-resistor does neither when skin resistance changes.

## The core: a constant-current source
Skin/electrode resistance drifts (sweat, electrode drying, movement). If you set current with a fixed resistor off a 9 V battery, the current wanders as resistance changes — which is exactly what you must not allow near the head. Use an active constant-current source:
- An LM334 (a dedicated current-source IC) or an LM317 wired in its constant-current configuration sets a fixed current regardless of load (within its compliance voltage). The set resistor chooses the current: for the LM317, I = 1.25 V / R, so ~1 mA needs ~1.25 kOhm; for the LM334, I set by its sense resistor per the datasheet.
- Target current: 1-2 mA. This is the researched range; do not exceed it.
- Supply: a 9 V battery. Battery only — never mains-powered anything on the head.

## The electrodes and the protocol
- Saline-soaked sponge electrodes, 25-35 cm2 (bigger area = lower current density = gentler). Soak in saline, not tap water; not dripping.
- Ramp the current up over ~30 seconds and down over ~30 seconds — a sudden on/off causes a flash/phosphene and is unpleasant.
- Include a current-limit resistor as a hard ceiling and a fuse, so a single fault cannot deliver more than the design maximum.

## Verify BEFORE it touches skin
Put a load resistor (e.g. ~5 kOhm, standing in for the head) across the output and measure the current with a multimeter in series. Confirm it holds your set current as you swap the load resistor for a different value — that is the test that your source is actually constant-current and not just a resistor divider. Only after it passes that does it go near a person.

TENS (for muscle/nerve, pulsed AC, different device) shares the "battery only, verify first, ramp, electrode area" discipline. The electronics behind both: https://wiki.soapbox.community/wiki/Electrical_Engineering`,
  },
  {
    slug: '40hz-gamma-entrainment-what-it-is',
    board: 'nootropics',
    title: '40 Hz gamma entrainment: the real research line, stated without the hype',
    body: `Driving the brain at 40 Hz — with flickering light, clicking sound, or both — is a genuine research area, and also a space full of overclaims. Here is the honest version.

## The research
The line that put "40 Hz" on the map is the MIT work (Tsai/Boyden labs, Iaccarino et al. Nature 2016, and follow-ups) showing that 40 Hz sensory stimulation drove gamma activity in mouse models and affected amyloid pathology and microglia. Human trials (the GENUS line) are ongoing and early; the honest summary is "promising, mechanistically interesting, not an established human treatment".

## What "entrainment" actually means
The steady-state response: a rhythmic sensory drive produces a brain response locked to that frequency (the auditory version is the ASSR, the visual the SSVEP). That the brain tracks the frequency is well established; that tracking it at 40 Hz produces durable cognitive benefit in healthy humans is NOT established.

## Honest use
- It is low-risk as sound; as flickering LIGHT it carries a real seizure caution — photosensitive epilepsy is triggered by flicker in that general band. Anyone with a seizure history, or unsure, should use audio-only.
- Treat it as something to try and observe, not a therapy. Do not let a 40 Hz track replace anything medical.

A session library to try it (audio entrainment): https://hathor.live/40hz
Mechanism, the steady-state response, and the flicker-safety caveats:
https://wiki.soapbox.community/wiki/Gamma_Entrainment
https://wiki.soapbox.community/wiki/Auditory_Steady_State_Response`,
  },

  // ── witchy ──────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'kyphi-the-edfu-temple-incense',
    board: 'witchy',
    title: 'Kyphi: making the temple incense, from the recipes that actually survive',
    body: `Kyphi was an ancient Egyptian compound incense that was at once incense, perfume and medicine — burned in temples at dusk, worn, and taken internally. We cite the tradition and name the source, because for once we have the primary texts: the recipes were inscribed on temple walls and recorded by Plutarch, Dioscorides and Galen.

## The surviving recipes
- The Edfu Temple recipe (Temple of Horus, Ptolemaic): the most complete, a ~16-ingredient formula. The base is black raisins macerated in wine, oasis wine, and raw honey. The heavy resins are frankincense, myrrh, mastic and pine resin. Aromatic woods and roots include sweet flag/calamus, cyperus/galingale, camel grass, aspalathus and sweet cinnamon wood. Spices: juniper berries and cardamom.
- The Philae Temple recipe (Temple of Isis): a higher ratio of myrrh, bdellium and labdanum, burned at twilight as an apotropaic and sleep-harmonising smoke.
- Plutarch, De Iside et Osiride §80: a 16-ingredient version, which is why we can read a temple formula in a classical text at all.

## The method, as inscribed
Dry herbs and woods pulverised and steeped in the macerating wine; raisins mashed and steeped; resins melted with honey and boiled to a viscous mass; everything combined, rolled into small glossy black pellets, and aged in darkness for weeks. The aging is part of the technology, not a delay.

## The rule of this board
Named tradition, named source, and the plant chemistry where it is known — the resin and aromatic actives are a Pharmacology question; the rite and the text are this one.

Full recipes, stages and the classical sources: https://wiki.soapbox.community/wiki/Kyphi`,
  },
  {
    slug: 'bes-and-syrian-rue-apotropaic',
    board: 'witchy',
    title: 'Bes and Syrian rue: an apotropaic pairing with a real plant behind it',
    body: `Apotropaic magic is protective magic — warding off harm — and the Egyptian household god Bes is its best-known figure. A thread worth having because it is exactly the kind of case where tradition and plant chemistry sit in the same room.

## Bes
Bes is the dwarf god of the household, of childbirth, of sleep and of protection against the dangers of the night — snakes, scorpions, bad dreams, and the hostile dead. Unlike the great temple gods he is a domestic, everyday protector, which is why his image turns up on beds, headrests, mirrors, cosmetic items and amulets. His role is apotropaic by definition: his grotesque face is meant to frighten off what frightens us.

## Syrian rue (Peganum harmala)
Syrian rue has a long apotropaic use across the Near East and beyond — its seeds burned (as esfand/espand) to ward off the evil eye, a practice that survives today. The plant is not inert folklore: its beta-carboline alkaloids (harmine, harmaline) are reversible MAO-A inhibitors and the smoke is psychoactive at dose. That pharmacology belongs on the Pharmacology & Interactions board, where the harmala/MAOI thread covers the serious interaction cautions — this thread is the tradition and the practice.

## The honest pairing
Naming both halves is the point: the god is a cultural protective technology; the plant is a protective-and-ritual one with a documented chemistry. Neither reduces to the other.

Tradition and the apotropaic context: https://wiki.soapbox.community/wiki/Apotropaic_Magic_Bes_and_Syrian_Rue
The pharmacology (and why not to stack it with serotonergic drugs): https://wiki.soapbox.community/wiki/Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems`,
  },
  {
    slug: 'zar-the-thread-system',
    board: 'witchy',
    title: 'Zar: the spirit-possession tradition, and treating it as a living practice',
    body: `Zar is a spirit-possession and healing tradition of the north-east African and Red Sea world — Ethiopia, Sudan, Egypt and across the Arabian peninsula — in which spirits (the zar) are understood not to be exorcised but negotiated with, placated and lived alongside through music, incense, dress and a presiding practitioner.

## What it actually is
The core is the ceremony: drumming and specific rhythms, each tied to a particular spirit; incense; trance and dance; and an officiant (often a woman) who mediates. The aim is not to remove the spirit but to reach an accommodation — the possessed person makes offerings and observances, and in return the spirit grants peace. It is, among other things, a women's ritual space with real social function.

## How to treat it here
Two disciplines apply:
- Name the tradition and the lineage. Zar is a specific, living, regional complex, not generic "spirit stuff"; the Ethiopian, Sudanese and Egyptian forms differ.
- Cite, do not paraphrase from memory. Where we quote a rite or a spirit-list, we say which regional tradition and which recorded source it comes from.

The incense and the altered-state elements have a chemistry (resins, smoke) that belongs on Pharmacology if someone wants that angle; the rite, the music-system and the ethnography belong here.

The tradition and the thread/spirit system: https://wiki.soapbox.community/wiki/Zar`,
  },

  // ── library ───────────────────────────────────────────────────────────────────────────────────
  {
    slug: 'library-of-ashurbanipal-what-it-is',
    board: 'library',
    title: 'What the Library of Ashurbanipal is, and how to use it',
    body: `The Library of Ashurbanipal is the ecosystem's reference wiki — cited, fact-checked articles across science, pharmacology, law, religion and the ecosystem's own chains and tools. It is named for the 7th-century-BCE Assyrian library that tried to collect all knowledge, and the aim is the same spirit: a place where a claim lands on a page with a source.

## What is in it
- The plant-medicine and harm-reduction corpus: ethnobotany, pharmacology, dose ranges, interactions and contraindications, testing, set/setting/aftercare, and documented traditional preparation. It aims past the older archives by attaching the mechanism and labelling in-vitro data as in-vitro.
- The ecosystem articles: MELEK, PRANA, KULA, KulaSwap, MELEK-Engine, the wrapped tokens, Hathor Studio — what each is and where to go for each task.
- Science, law, history, cooking, and the ancient-mystery material, each with its sources section.

## How it relates to this board
This Library board is for the corpus itself: new shelves, "where in the library is X", and — the most welcome post here — corrections to a page with a source. A forum thread argues; a wiki page settles. When a thread on Pharmacology or Herb reaches a conclusion worth keeping, it should become, or correct, a page.

## Reading it
Start at the front: https://wiki.soapbox.community
The verbatim scripture shelves (with edition and licence on every passage) are a separate surface: https://hierophant.soapbox.community/shelves

The index page itself: https://wiki.soapbox.community/wiki/Library_of_Ashurbanipal`,
  },
  {
    slug: 'how-to-request-a-wiki-correction',
    board: 'library',
    title: 'How to request a correction to a wiki page (and why it is the best post on this board)',
    body: `Correcting a cited claim is the highest-status move on this forum. It is the behaviour that compounds — a forum where being corrected is a status loss drifts toward unfalsifiable posts. So here is how to do it well.

## What a good correction post contains
- The exact page and the exact line. Link the page (https://wiki.soapbox.community/wiki/<Article>) and quote the sentence you are correcting, so there is no ambiguity.
- What is wrong, specifically. "This is misleading" is not actionable; "this says the effect is X, but the cited study measured it in vitro in a cell line, not in humans" is.
- The source for your correction. A primary source, a better study, or a named lived experience clearly labelled as such. The requirement is that a reader can tell which of the three it is.
- The fix you propose. Write the replacement sentence. It is much easier to accept a correction that arrives as finished text.

## What happens then
The correction is reviewed against your source and, if it holds, the page changes and the thread stands as the record of why. The in-vitro-vs-human distinction is the single most common correction worth making on the pharmacology pages, and it is exactly the kind this board exists for.

## What does NOT belong here
"I think this is wrong" with no source, and requests to remove well-sourced material because you disagree with it. Bring the better citation or the thread stays open.

The corpus and its standards: https://wiki.soapbox.community/wiki/Library_of_Ashurbanipal`,
  },

  // ── gambling-education ────────────────────────────────────────────────────────────────────────
  {
    slug: 'house-edge-by-game-the-numbers',
    board: 'gambling-education',
    title: 'The house edge by game: the actual numbers, and what they mean per hour',
    body: `The house edge is the fraction of each bet the operator keeps on average over time. It is not a prediction of any one session — it is what the math guarantees across many bets. Knowing the numbers is the harm-reduction tool; this board teaches the odds and never takes a wager.

## The numbers (standard rules)
- Blackjack, basic strategy: ~0.5% house edge — the lowest in the casino, and only if you play correct basic strategy. Deviate and it climbs.
- Baccarat: ~1.06% on banker, ~1.24% on player, and the "tie" bet is a sucker bet at ~14%.
- Craps: the line bets (pass/don't pass) are ~1.4%; the prop bets in the middle of the table run to double digits. Same game, wildly different edges.
- Roulette: European single-zero ~2.7%; American double-zero ~5.26%. The extra pocket doubles the edge for the same-looking game.
- Slots: typically ~2-10%+, and unlike the table games it is not disclosed on the machine. You cannot see the edge you are playing.
- Keno and most lottery: ~25-50% — the worst odds offered anywhere (see the lottery thread for why).

## Edge x volume = cost
The edge bites per bet, so the cost is edge x total amount wagered, not edge x what you brought. A $5 roulette spin every 30 seconds is ~$600/hour wagered; at 5.26% that is ~$32/hour expected loss, far more than "I only brought $100" suggests. Speed and bet size matter as much as the edge.

Odds, expected value and the full game-by-game breakdown: https://gambling.soapbox.community
If gambling has become a problem, help is one click away: https://gambling.soapbox.community/help

Sources: Wizard of Odds house-edge tables; standard probability texts.`,
  },
];
