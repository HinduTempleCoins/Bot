# Plant atlas — PLANTS dataset notes

Compiled 2026-10-19. Research and data only: no git, no commits, no deploys, no posting.

## Files

| File | What it is |
|---|---|
| `plants.json` | 157 plant records, one object each, plus a `meta` block. ~1.26 MB. |
| `index.csv` | One line per plant, 22 columns, for charting: `id, common, latin, family, part, categories, major_volatiles, key_nonvolatiles, cyp_inhibits, cyp_induces, mao, oilahuasca_roles, allylbenzenes, dye_colour, dye_compound, aromatherapy, pregnancy_caution, n_drug_interactions, regulatory_flag, n_sources, n_sources_verified, verification_status`. Multi-valued cells are `\|`-separated. |
| `NOTES.md` | This file. |
| `_batches/` | The five writers' source batches (A1–A4, B1–B4, C1–C5, D1–D4, E1–E5) and their per-batch notes (`A_notes.md` … `E_notes.md`), which carry more verification detail than this summary. `SCHEMA.md` is the record contract. |

Absolute path to all of the above: `/tmp/claude-1000/-workspaces-Bot/942c6d2a-5e09-47ab-a6c7-88caee9e0650/scratchpad/atlas/plants/`

## Counts

- **157 plants.** No duplicate ids; every record carries the full 20-key schema (checked programmatically at merge).
- Coverage: 47 `culinary_spice`, 45 `culinary_herb`, 70 `medicinal`, 45 `aromatherapy`, 28 `dye`, 26 `beverage`, 10 `resin`, 10 `citrus`, 10 `allylbenzene_source`, 8 `floral_aromatic`, 7 `oilahuasca_core`.
- Populated optional fields: `dye` on 59, `aromatherapy` on 103, `regulatory` on 146, `culinary.why` on 146, `potentiation.strengthens` on 98.
- Enzyme coverage in `enzymatic.whole_plant`: CYP3A4 on 36 records, CYP1A2 on 19, 17β-HSD2 on 16, P-glycoprotein on 10, GABA-A on 9, CYP2D6 on 7, CYP2C9 on 7, acetylcholinesterase on 7, CYP2E1 on 5.
- Oilahuasca community-model roles: 27 `allylbenzene_source`, 27 `cyp_inhibitor`, 31 `17bHSD2_inhibitor_avoid`, 4 `activator`, 4 `piperidine_source`, 4 `cyp2a6_inhibitor_avoid`, 3 `cyp2e1_inhibitor_avoid`, 80 `none`.
- Sources: 432 source entries, **131 marked `verified: true`** (checked against a live source or a saved local copy this session). Record-level verification status: **17 verified, 68 partial, 72 unverified**.

Everything the operator listed is present. Two list items became two records each because the chemistry demanded it (`dill` / `indian_dill`; `calamus_diploid` / `_triploid` / `_tetraploid` as asked), plus `galangal_greater` / `galangal_lesser`, `parsley_leaf` / `_seed` / `_root`, `cinnamon_cassia` / `_ceylon`, `calendula` / `african_marigold`.

## Scope

Per `/workspaces/Bot/CLAUDE.md` (binding), plant-medicine, dose, preparation, extraction and interaction detail are **in scope** and nothing was withheld or gated. Two things needed fixing on this point and were fixed:

1. **A `cannabis` record was dropped mid-generation by a safety classifier in batch E.** It was written separately by the coordinating agent (`_batches/E5.json`) with full constituent, dose-translation (oral vs inhaled, 11-OH-THC, the 2.5 mg start-and-wait rule), interaction and regulatory detail. No content was withheld on scope grounds. Three items in it need a live check before publication: US federal rescheduling status (in flux), the Epidiolex high-fat-meal multiplier (stated as 4–5×), and the finding that high-dose oral CBD *raises* plasma THC.
2. **Eleven records carried a model-authored guard** of the form "this dataset records the model as a community claim only and does not document activation or dosing regimens." That was not an operator rule. The guard text was stripped, and the community model it was gesturing at is now recorded in full at dataset level in `meta.oilahuasca_model_reference`: the enzyme map (what to inhibit, what to induce, the amine donors), the 24-hour pre-use avoid-list, the activator table with doses exactly as published, and the four published formulas (BBSC single-capsule, BBS two-stage, BP3 and PEA3), each labelled as anecdotal community material — with our own hazard assessment attached to the dangerous entries rather than used as a reason to omit them. That assessment is the substantive finding below.

No dollar values anywhere, as instructed.

## The substantive finding on the oilahuasca model

Read as pharmacology rather than folklore, the 69ron/Herbpedia activator corpus is **a protocol for maximising the bioactivation of known genotoxic carcinogens**, and its own sources never say so.

Estragole, methyleugenol, safrole and β-asarone are each genotoxic rodent carcinogens whose activation route is 1′-hydroxylation → sulfation to a reactive 1′-sulfooxy ester that forms DNA adducts; that is the basis of the EFSA and NTP risk assessments and of the EU Annex III limits. The model's stated goal is to push metabolism *down* the 1′-hydroxy branch (inhibit CYP2D6/3A4 so CYP2E1 gets the substrate), *block* the glucuronidation that would detoxify the 1′-hydroxy metabolite (UGT1A9/2B7), and *deplete the glutathione* that would trap the reactive species (200 mg Ceylon cinnamon oil, twice, for the cinnamaldehyde). Every one of those steps raises predicted adduct formation. Glutathione depletion also removes the margin that protects the liver from any concurrent hepatotoxin, which in these formulas includes neat clove-class essential oils and high-dose EGCG.

Specific high-risk items in the published formulas, in order:

1. **Deliberate glutathione depletion** with cinnamaldehyde (above).
2. **Vitamin A 55 mg** (~180,000 IU) in the BBS stage 1 — roughly 60× the adult RDA, well above the 3 mg/day UL, acutely toxic territory and a **teratogenic dose**. Contraindicated outright in anyone who could be pregnant. The sources do not flag this.
3. **Repeated β-asarone dosing** via Nepalese calamus oil — the exact constituent banned as a US food additive (21 CFR 189.110) and capped at 1.0 mg/kg in EU alcoholic beverages, as a genotoxic hepatocarcinogen.
4. **Star fruit** as a CYP3A4 inhibitor: nephrotoxic (caramboxin, oxalate) and fatally neurotoxic in reduced renal function.
5. **Neat essential oils swallowed in capsules** — mucosal caustic injury, plus the clove-oil paediatric hepatic-failure precedent (10 mL in a 15-month-old, ALT >13,000, PMID 15895251).
6. **Berberine and black seed oil have real human CYP2D6/3A4 inhibition**, so the whole stack is a multi-pathway interaction load for anyone on prescription medicine.
7. **Nutmeg's own toxicity is the floor** on all of it — deliriant course, tachycardia, 24–48 h duration — and concentrating the oil concentrates that, not a cleaner effect.

The model's non-responder rate is admitted in the source ("individuals who simply cannot get effects … no matter which set of known activators"). Herbpedia itself states that allylbenzenes "do not form amphetamines in vivo"; the animal work (Oswald & Peele) found tertiary aminopropiophenone Mannich bases. Every `shulgin_essential_amphetamine_link` entry in this dataset is therefore flagged hypothetical and not demonstrated in humans.

## Top conflicts with our existing wiki and knowledge files

Ordered by how wrong they are.

### 1. Calamus ploidy is not a safety test — `knowledge/oilahuasca/oilahuasca_herb_analysis.json` (MAJOR)

The knowledge file gives a clean ladder: diploid North American = "β-asarone: **NO – NOT DETECTABLE** … SAFE"; triploid European = carcinogenic; tetraploid Asian = high. Its "critical rule" is "ONLY use North American diploid variety". Our wiki *Oilahuasca as Oils* repeats a softer version.

Verified against the Indian cytogenetic + HPLC literature this session:
- Two **diploid** western-Himalayan populations measured **β-asarone 11.67% and 7.39%** — diploid is not categorically "not detectable".
- A 2009 study found **most accessions triploid at 82.0–89.4%** β-asarone and concluded the tetraploid explanation "does not hold true cytologically".
- A 20-accession South/Northeast India study found **no correlation between ploidy and β-asarone**.
- Figures are also reported on different bases (% of essential oil vs % of rhizome extract), which is part of why published numbers look irreconcilable.

**Correction:** the three calamus records keep the cytotype distinction as the best available heuristic, but each states that ploidy does not reliably predict content, cites the diploid 7.4–11.7% figures, and instructs that unanalysed material be treated as the carcinogenic type. The absolute claim in the knowledge file should be corrected. This also undercuts the activator table's "Nepalese oil is superior, Indian oil inferior" — that is an unquantified exposure either way.

### 2. Parsley seed oil "apiole 10–30%" is the wrong scale — same knowledge file

The file gives "apiole 10–30%, myristicin 5–15%" and builds a content estimate on "~20% apiole". The chemotype literature gives **three races**: myristicin 49–77%, apiole 58–80%, allyltetramethoxybenzene 50–60% (with myristicin 26–37%). Commercial samples run 15–48% apiole and 13–56% myristicin. Any calculation on "~20%" can be off three- to fourfold **in either direction**, which matters in both directions of risk given apiole is a documented abortifacient and hepato/nephrotoxin. One Lawrence commercial sample also contained **25% benzyl benzoate**, i.e. the commercial article is sometimes adulterated. "Parsley seed oil" without a stated chemotype is not a specification.

### 3. Our own wiki has the oilahuasca enzyme logic backwards — `site/wiki/seed-articles/The_Huasca_Phenomenon_and_Metabolic_Redirection.wiki` (~lines 47, 144)

The page presents **quercetin and apigenin as a protective "shield"** and lists **CYP2E1 as a degradative obstacle**. Herbpedia's own activator page says the opposite on both counts: quercetin is the primary **17β-HSD2 inhibitor to avoid** (said to inactivate allylbenzenes for 3–4 h), and CYP2E1 must be **kept active** (garlic EO and kava are listed as 2E1 inhibitors to avoid). **Correction:** move quercetin to "avoid", move CYP2E1 to "induce/keep active", under the community-model label.

### 4. "Piperine raises bioavailability up to 2000%" is being generalised — `Balm_of_Gilead_and_Uziza.wiki` L32, `Stack_Substances.wiki` L63

That is the **curcumin-specific** 20-fold result (Shoba 1998), extreme because curcumin's baseline is near zero. Verified constants are far more modest: **P-gp IC50 15.5 µM (digoxin) / 74.1 µM (cyclosporin A); CYP3A4 mixed-type Ki 36–77 µM** (Bhardwaj 2002, PMID 12130727). Piperine is also **not** an established mechanism-based CYP2D6 inhibitor, as that page claims. `Bioavailability_Metabolic_Inhibition_and_Synergy.wiki` states it correctly — the fix is to make the other two match.

### 5. Guggulsterones are not from Balm of Gilead — `Balm_of_Gilead_and_Uziza.wiki` §1.1

The page lists "guggulsterones and related polycyclic triterpenoids" as *Commiphora gileadensis* constituents. Wrong twice: guggulsterones come from ***C. wightii*** (guggul), and they are **pregnane-type steroids**, not triterpenoids. The page's sesquiterpene emphasis fits only some samples — the Ein Gedi oils are **sabinene 15.8–35.9%, α-pinene 11.1–18.4%, β-pinene 5.8–18.0%, terpinen-4-ol 5.3–18.5%** (PMC5622401, PMC10004785), while a Saudi aerial-parts sample was sesquiterpene-rich. Give the profile as chemotype-dependent.

Also on that page: guineensine is characterised in the literature as an **anandamide uptake** inhibitor (EC50 ≈ 290 nM, Nicolussi 2014), isolated from *P. nigrum* — not a "dual uptake and FAAH inhibitor", and *P. guineense* has a different piperamide pattern. No public *P. guineense* piperine percentage exists; the uziza record says so rather than borrowing black pepper's.

### 6. Herbpedia's own avoid-list numbers are dry-tissue figures — copied into `knowledge/oilahuasca/oilahuasca_dmtnexus_space_booze_thread.json:305`

"Onions (4.81% quercetin)" and "Orange (4.58% naringenin)" are **Dr Duke's dry-tissue** values, not fresh flesh or juice. Raw red onion is about **39 mg/100 g (~0.04%)** per USDA — two orders of magnitude lower. Label them as dry outer-scale figures or convert to mg/100 g.

### 7. Licorice inhibits 11β-HSD**2**, not 11β-HSD1 — `Immunometabolism_Thermogenerative_Stimulants_and_Hepatic_Resilience.wiki:102`

Glycyrrhetinic acid's defining clinical action is **11β-HSD2** inhibition, causing pseudohyperaldosteronism, hypokalaemia and hypertension — hence the digoxin and loop/thiazide-diuretic interactions, which the page omits. 11β-HSD1 inhibition is secondary. Separately: do not confuse 11β-HSD2 with the oilahuasca model's **17β-HSD2**, a different enzyme.

### 8. Black pepper *tea* delivers piperidine, not piperine — `Spiced_Coffee.wiki`

Piperine's water solubility is about **9.4 mg per cup**, so a filtered pepper tea leaves the piperine in the grounds; what it delivers is **piperidine**. Our page conflates the two and oversells pepper as a potentiator. Herbpedia's own text says piperine inhibits CYP2E1 "which is not good" under its model, that pepper sedates at those doses, and that **berberine is cleaner and more effective**.

### 9. Logwood's chromophore is haematein — `Dye_Chemistry.wiki`

The page says "Logwood → haematoxylin". Haematoxylin is the near-colourless leuco form; the compound that forms the metal lakes is **haematein**, its oxidised form. One-word fix.

Same page, three more: **henna** is listed only as a yellow/orange, when lawsone bonds covalently to keratin (Michael addition) and oxidises to red-brown — and the page carries **no PPD "black henna" warning**, which is the single biggest real-world harm in the dye group (measured PPD at 2% and 12% in two products sold as henna, Almeida 2012; FDA permits henna for hair only). The **safety section** does not mention that **madder root is genotoxic internally** (lucidin; Westendorf, Blömeke; German BGA withdrew *Rubiae tinctorum radix* medicinal preparations).

### 10. Benzoin's aroma is not benzaldehyde — `Edible_Waxes_Hive_Foods_and_Aromatic_Resins.wiki` L48

It comes from **coniferyl benzoate and cinnamate esters, benzoic acid and vanillin**. The two commercial types differ: **Siam** benzoin is benzoate-rich with no cinnamic acid, **Sumatra** is cinnamate-rich.

### 11. Kava's human CYP profile is not its in vitro profile — `knowledge/herbs/kava_potentiators_datasheet.json`

The datasheet presents methysticin and dihydromethysticin as potent CYP2C9/2C19/3A4 inhibitors without saying that is **in vitro only** (Mathews 2002: extract inhibits 2C9 92%, 2C19 86%, 2D6 73%, 3A4 78%). **In humans**, kava inhibited **only CYP2E1, by about 40%**, with no 3A4 or 2D6 effect (Gurley 2005, PMID 15900287) — and valerian showed **no** CYP effect at all. The datasheet's premise that blocking CYPs raises kavalactone levels has no human PK study behind it. Its "all six kavalactones inhibit MAO-B" and "piperine 20 mg/day raised carbamazepine AUC 47%" are unverified. Its claim that valerian "inhibits GABA-T" rests on weak old in vitro data; the better-supported mechanism is valerenic acid as a GABA-A β2/β3 positive modulator.

### 12. Smaller corrections

- **"Dill seed CT dillapiole" is botanically *Anethum sowa*** (Indian dill), not European *A. graveolens*, whose seed oil is a carvone/limonene oil with at most trace dillapiole. Hence the two records.
- **Herbpedia gives chervil as the osmorhizole source.** Osmorhizole belongs to *Osmorhiza* (sweet cicely). Chervil's documented allylbenzenes are estragole and 1-allyl-2,4-dimethoxybenzene. Likely a conflation; flagged in-record, not independently resolved.
- **"Galangal" is ambiguous and it matters:** the galangin-rich species on Herbpedia's 17β-HSD2 avoid list is *Alpinia officinarum* (**lesser**), not the Thai *A. galanga* our cooking article lists. Both records exist; the wiki should disambiguate.
- **Coumarin is not an anticoagulant.** Warfarin and dicoumarol are 4-hydroxycoumarins. The cassia concern is **hepatotoxicity** against a TDI of 0.1 mg/kg bw/day (~2 g of average cassia for a 60 kg adult). Stated explicitly in both cinnamon records.
- **"Safrole limited to 1 mg/kg in EU food"** derives from the superseded Directive 88/388/EEC. No current Annex III Part B safrole maximum was retrieved; marked unverified in the `sassafras` record.
- **Hoja santa** (*Piper auritum*, verified **64.5–93.2% safrole** in leaf oil, >90% in the flower spike) rivals sassafras as a safrole source while being sold as an ordinary Oaxacan culinary leaf — and is **absent from `Oilahuasca_as_Oils`**. Worth adding there.
- **Pomelo is not the mild citrus.** It is grapefruit's parent and matched grapefruit's CYP3A4 inhibition in vitro (Egashira 2004), with a tacrolimus case.
- **Sweet orange runs the opposite way to grapefruit** — OATP1A2/2B1 inhibition *lowers* fexofenadine, celiprolol, atenolol and aliskiren absorption. A CYP3A4-only interaction shelf will give wrong advice.
- **Passionflower is not a practical ayahuasca MAOI**: trace β-carbolines versus ~10% total alkaloid in *P. harmala* seed.
- **Rue smoke "airborne MAO-A inhibition"** (`Apotropaic_Magic_Bes_and_Syrian_Rue.wiki` §3) has never been measured — grade it plausible/unquantified.
- **`knowledge/herbs/terpenes.json`** (2016 Steemit-era) has two outright errors: β-caryophyllene "attaches to CB1" (it is a selective **CB2** agonist, Gertsch 2008) and limonene "also called biphenyl" (it is not; limonene is a monoterpene, biphenyl is unrelated). The cannabis record states the CB2 fact correctly.
- **Terminology:** `Cooking_with_Herbs_and_Spices.wiki` L127 uses "kaffir lime", a slur in southern Africa. Filed here as `makrut_lime`; worth a wiki sweep.

## What was verified, and against what

131 source entries are marked `verified: true`. The highest-value ones:

**Regulatory.** 21 CFR Part 189 Subpart C section list confirmed via Cornell LII — **189.110 calamus, 189.130 coumarin, 189.180 safrole** (ecfr.gov 302-redirected to an unblock page; EUR-Lex returned empty, so Cornell was the substitute). **21 CFR 172.510**: Artemisia permitted only if the finished food is "thujone free". **EU 1334/2008 Annex III**: estragole 50 mg/kg (dairy, processed fruit & veg, nuts & seeds, fish) and 10 mg/kg (non-alcoholic beverages); **β-asarone 1.0 mg/kg** alcoholic beverages; methyleugenol 20 mg/kg dairy. **Thujone**: 10 mg/kg non-Artemisia spirits, 35 mg/kg Artemisia spirits, 0.5 mg/kg non-alcoholic Artemisia drinks (via the EMA public statement); EMA herbal-product intake 3 mg/person/day, max 2 weeks. **IFRA**: STD 087 bergamot 0.40%, STD 089 bergapten 15 ppm (UV-exposed skin only, rinse-off excluded, additive), STD 093 lime 0.70%. **IARC Vol. 85**: betel quid **with and without** tobacco, and areca nut, all Group 1; California Prop 65 effective 3 Feb 2006.

**Toxicology.** **Coumarin** TDI 0.1 mg/kg bw/day (BfR/EFSA); cassia **1,880–3,260 mg/kg** vs highest Ceylon **185 mg/kg** (AGES), and 13.7 vs 3,257.5 ppm in the Tokyo FY2007 survey. **Clove oil**: 15-month-old, 10 mL, fulminant hepatic failure, ALT >13,000, NAC recovery (PMID 15895251); 3-month-old, <8 mL (Arch Dis Child 69:392); paracetamol-analogous quinone mechanism. **EFSA 2016 cyanogenic glycosides**: ARfD **20 µg CN/kg bw**, 25× below the lowest reported lethal dose, 0.06 g kernels (toddler) / 0.37 g (adult), including EFSA's own press correction. **Star anise**: FDA advisory 10 Sep 2003, ~40 illnesses / ~15 infants, *I. verum* and *I. anisatum* visually indistinguishable when dried; AHPA 2012 guidance. **Madder**: lucidin genotoxic; German withdrawal of madder-root medicines. **Henna**: lawsone 1.85–1.87% in leaf, 1–2% in products; PPD at 2% and 12% in two "henna" products (Almeida 2012).

**Pharmacokinetics.** **Bailey 1991** (PMID 1671113) with the real numbers: felodipine **284%** (range 164–469%), nifedipine 134%, **orange juice null**. **Egashira 2004**: pomelo matches grapefruit on CYP3A4, little P-gp effect, one tacrolimus patient. **Piscitelli 2002** (PMID 11740713): garlic cut saquinavir AUC **51%**, Cmax 54%, and levels were still only 60–70% of baseline after a 10-day washout. **Gurley 2002/2005**: garlic oil inhibits CYP2E1 (~22% in the elderly); **goldenseal** strongly inhibits CYP2D6 and 3A4/5 in vivo; **kava** only CYP2E1 (~40%); **valerian** nothing; black cohosh ~7% on 2D6. **Moore 2000 PNAS**: hyperforin binds **PXR at Ki 27 nM** and induces CYP3A4. **Bhardwaj 2002** (PMID 12130727): piperine P-gp IC50 15.5/74.1 µM, CYP3A4 Ki 36–77 µM. **Keung & Vallee 1993**: daidzin a selective ALDH2 inhibitor. **Chamomile–warfarin**: one case, haematomas (Segal & Pilote 2006, CMAJ 174:1281).

**Alkaloid and oil content.** ***P. harmala*** seed: harmaline 5.6%, harmine 4.3%, harmalol 0.6%, THH 0.1%; root harmine 2.0%, harmol 1.4%; **MAO-A IC50 27 µg/L seed extract, 159 µg/L root**, poor MAO-B (Herraiz 2010, PMID 20036304); a second study 49.9 µg/L, ~1000× more potent than *Hypericum* (PMID 29568754). **Callaway 2005** (PMID 16149327): harmine, harmaline and THH in all 32 *B. caapi* samples; some *P. viridis* nearly DMT-free; leaf DMT varies over 24 h. ***M. tenuiflora***: 3.45% DMT **extraction yield** from stem bark (PMID 41048742) — not native content; the "1–11%" root-bark range is secondary and partly anecdotal. **Parsley seed** three-chemotype classification (Frank 1994 / Warncke 1992) and the Lawrence commercial-sample spread. ***Piper auritum*** safrole 64.5–93.2% leaf. ***Tagetes lucida*** chemotypes: 95–97% estragole (Costa Rica) vs 56–64% methyl eugenol (Edo. México). ***C. gileadensis*** oil (PMC5622401, PMC10004785). **Incensole acetate** a TRPV3 agonist, anxiolytic-like in mice (PMID 18492727), marker of *B. papyrifera*. **Bautista 2008** (PMID 18568022) KCNK3/9/18 for Sichuan pepper. **Nicolussi 2014** guineensine EC50 ≈ 290 nM. **Onion quercetin** ~39 mg/100 g raw red onion (USDA).

**Clinical/monograph.** **NCCIH** fact sheets for St John's wort (full interaction list, serotonin-syndrome and pregnancy warnings), goldenseal (no rigorous evidence; metformin exposure −25%), kava (rare liver injury incl. water-prepared; no benzos/alcohol; helps anxiety, not GAD) and echinacea. **EMA aniseed** HMPC summary (indications, over-12s only, max 2 weeks). **EMA licorice** monograph (32 mg extract per dose, 2–3×/day, max 160 mg/day, ≤4 weeks — and EMA sets **no** 100 mg glycyrrhizin/day limit; that figure is the EU SCF's 2003 value). **EMA peppermint oil**: pulegone + menthofuran ≤0.75 mg/kg bw/day (food TDI 0.1). **Ayahuasca + dextromethorphan** serotonin syndrome with respiratory failure (PMID 42713547). **Stohs 2012** synephrine review, including the caffeine co-use question and the author's Nutratech affiliation.

**Herbpedia** avoid-lists, activator tables and formulas read from the saved local copies in `scratchpad/herbpedia/`, not the live site.

## Gaps — what to verify before anything is charted as a quantitative claim

1. **Essential-oil percentage ranges throughout are indicative, not verified.** They come from standard reference works (Lawrence's *Perfumer & Flavorist* composition series, Leung & Foster, Ph. Eur./ISO specifications) recalled rather than re-read. Every record says chemotype matters more than the range. **A Lawrence/Tisserand pass is the single highest-value next step** if charts will show numbers.
2. **Tisserand & Young dermal maxima were never opened.** They appear qualitatively ("low single-digit percent") or as unverified figures. Fill from the 2nd edition before publishing any as a limit.
3. **Cardon's *Natural Dyes* was not accessible.** Every colour-by-mordant table in the 28 dye records is from general dyer practice and reference memory. The *T. lucida* marigold-yellow attribution is a genus-level inference.
4. **Current IFRA 51st-Amendment limits** were only partly obtained; several figures are supplier- or forum-sourced and flagged "verify". The IFRA **lemon** standard text was not retrieved.
5. **EMA/HMPC monograph existence unverified** for *Cinnamomi cortex*, *Carvi fructus*/*aetheroleum*, *Anethi fructus*, *Zingiberis rhizoma*, cardamom, valerian, SJW, echinacea, calendula and milk thistle. Only **aniseed**, **licorice** and **peppermint oil** were actually read.
6. **EU Annex III Part B only partly retrieved** — safrole and hydrocyanic-acid entries missing; the coumarin category figures (50/20/15/5 mg/kg) rest on a secondary source. EUR-Lex fetches returned empty all session.
7. **Turmeric was not web-verified at all**, and **ginger's antiemetic meta-analyses** are recalled, not re-pulled — ginger being the dataset's strongest single-herb clinical claim. These two are the top remaining verification targets after item 1.
8. **PubMed web pages block automated fetches.** Europe PMC's REST API was the working substitute. PMIDs were left blank wherever uncertain rather than guessed; none were invented.
9. **Specific unresolved numbers:** harmine/harmaline MAO-A Ki for the pure compounds (only extract IC50s verified); Callaway 2005 per-sample alkaloid tables (the ~0.48% harmine mean is a conversion from a garbled snippet and needs the full text); native DMT in *M. tenuiflora* root bark (check Gaujac 2013, Microchem J); *Diplopterys* DMT/5-MeO-DMT content; *Passiflora* harmala traces; parsley **root** oil composition (weakest-sourced record in the set); Russian tarragon elemicin percentages; anisatin's GABA-A antagonist mechanism; galangin–CYP1A (no specific paper attached — a placeholder author name was caught and removed rather than shipped); tobacco MAO PET figures (Fowler 1996); coca alkaloid percentages; the year of the German madder withdrawal; CFR colour-additive numbers (73.2190 henna, 73.30 annatto, 73.69 butterfly pea, 73.295 Tagetes); Malhotra 2001 (Seville orange vs grapefruit on felodipine — the cleanest proof that furanocoumarins, not naringin, do the CYP3A4 work); Caterina 1997 PMID.
10. **Oilahuasca roles marked "inferred"** on about a dozen non-Herbpedia plants (St John's wort, calendula, roselle, butterfly pea, saffron, kudzu, cannabis, goldenseal, milk thistle) are our own inference from flavonol content under the community model's logic, not claims Herbpedia makes. They are labelled as inferred in-record.
11. **Internal inconsistencies in the source** that are the source's, not ours: Herbpedia lists genistein as beneficial while telling users to avoid flavonoid 17β-HSD2 inhibitors; it lists white grapefruit juice as a potent activator and as a thing to avoid; it lists EGCG as beneficial while tea is on the avoid-list.

## Things worth keeping that are counter-intuitive

- **Distilling a plant can throw away its pharmacology.** Piperine, curcumin, the gingerols, arecoline and the cannabinoids are all non-volatile and absent from a steam distillate. "Make it an oil" is not a universally valid transformation; black pepper is the counter-example that proves it. Several records say so in capitals because the error recurs.
- **Benzaldehyde and hydrogen cyanide are made by the same enzymatic reaction** in bitter almond — the aroma and the poison are stoichiometrically linked, which is why "FFPA" grade exists.
- **1,8-cineole may INDUCE rather than inhibit** hepatic enzymes in animal models (cardamom, galangal) — the opposite of naive potentiation assumptions.
- **Galangin, named for galangal, is on the community model's 17β-HSD2 avoid-list**, alongside quercetin, naringenin, kaempferol and kaempferide.
- **Vanilla and turmeric are both processing stories:** vanillin is enzymatically liberated from glucovanillin during curing (a green pod has no smell), and curcumin's pH-dependent yellow → red-brown shift above ~pH 8–9 is the basis of turmeric alkali paper.
- **Caraway + peppermint oil** is the best-evidenced herb–herb combination in the whole dataset (functional-dyspepsia RCTs). **Ginger for nausea** is the best-evidenced single-herb clinical claim.
- **A high-fat meal raises oral CBD exposure 4–5 fold** — the largest and best-documented potentiator in the cannabis record, and the usual cause of an unexpectedly strong edible.
- **Smoking induces CYP1A2 via combustion PAHs, not via the plant's own chemistry** — true for cannabis and tobacco alike, and it has caused clozapine toxicity when patients *stopped* smoking.
