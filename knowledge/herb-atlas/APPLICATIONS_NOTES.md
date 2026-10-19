# NOTES: verification log, conflicts with existing wiki pages, and gaps

Compiled 2026-10-19. This folder holds research data only. Nothing in the repo was edited, committed or posted.

## Files

| File | Contents |
|---|---|
| `oils_butters.json` | 69 entries: 46 plant oils, 9 butters, 9 waxes, 3 animal fats, 1 liquid wax (jojoba), 1 semi-solid fat (palm) |
| `applications.json` | Sections (a)–(f), the 90-interaction library, and 63 agent-checked application sources (`verified_sources_applications`) |
| `APPLICATIONS.md` | The readable synthesis, with the full interaction table at the end |
| `_work/` | Raw downloads, parsers and builders. Rebuild with `python3 -I _work/scripts/build_oils.py _work/soapee_parsed.json oils_butters.json` and `python3 -I _work/scripts/build_apps.py _work applications.json` |

## What was verified, and against what

### Oils and butters

**Saponification values.** NaOH and KOH SAP values for every oil in the SoapCalc table come verbatim from `soapcalc.net/calc/OilList.asp` (fetched this session). Carnauba, rice bran wax, sunflower wax and bayberry are not in SoapCalc. Their values are pharmacopoeial or literature ranges, marked unverified.

**Fatty acids, iodine and INS.** These come from the Soapee seed database (github nazar/soapee-api, `seed/oils.js`), which mirrors SoapCalc. That makes them secondary data.

**Codex ranges [primary, verified].** Fatty-acid GLC ranges, SV and iodine value were read from the PDFs for:
- CXS 210-1999 (rev. 2015): peanut, babassu, coconut, cottonseed, grapeseed, corn, mustard, palm, palm kernel, rapeseed (both types), rice bran, safflower (both types), sesame, soya, sunflower (three types).
- CXS 33 (olive).

**Soapee rows corrected with literature ranges.** These rows were incomplete or wrong:
- **Borage:** omits GLA (20–24%).
- **Evening primrose:** its "linolenic" is GLA, not ALA.
- **Pomegranate:** its "linolenic 78" is punicic acid, and the iodine value of 22 is implausible.
- **Macadamia:** omits palmitoleic (16–23%).
- **Sea buckthorn fruit:** omits palmitoleic (25–40%).
- **Walnut:** omits ALA.
- **Mustard and high-erucic rapeseed:** omit erucic acid (Codex gives 22–50% and up to 60%).
- **Moringa:** omits behenic.
- **Cupuaçu and sal:** omit arachidic.
- **Ghee:** omits the short-chain acids.

**PMIDs confirmed via PubMed E-utilities:**
- Hourihane 1997 BMJ, peanut oil: 9133891
- Lack 2003 NEJM: 12637607
- Danby 2013, olive vs sunflower oil and the skin barrier: 22995032
- Lin 2017, plant oils: 29280987
- Chawla 2011, shea: 21146867
- Le Coz 2004, tamanu: 15500678
- Romita 2019, neem contact dermatitis: 30834541
- Dhongade 2008, neem poisoning: 18250509
- Fulton 1984: 6229554

**Not verified: melting points, shelf lives, smoke points, comedogenic numbers.** These are commonly cited ranges. Each record carries caveats. The comedogenic caveat (rabbit-ear assay of limited validity) is at the top level of the file.

**USDA FoodData Central was not queried.** Codex was used instead for edible oils, because Codex gives ranges and is the identity standard.

### Applications: 63 sources checked by a sub-agent, plus 6 PMIDs I re-checked

**Verified:**
- Billing & Sherman 1998: PMID 9586227. 4,578 recipes, 93 cookbooks, 36 countries, 43 spices.
- Ahn 2011: PMID 22355711. 56,498 recipes, 381 ingredients, 1,021 compounds.
- PNW 664 acidified-oil method and Oregon State SP 50-701 / SP 50-736.
- Garlic-in-oil outbreaks: PMIDs 3341673 and 2240308.
- CDC infant honey guidance.
- IFRA 51st Amendment limits.
- Tisserand & Young dermal maxima, from page-cited reproductions (the book itself was not read).
- Tisserand Institute dilution charts.
- EU Annex V limits.
- EU Regulation 2023/1545 dates.
- 21 CFR 701.3 and MoCRA status.
- Euxyl PE 9010 and Geogard ECT technical data sheets.
- Griffin 1949 HLB tables.
- Court & Greenblatt 2000: PMID 10862526.
- Khan 2014: PMID 24344857.
- ASPCA and Pet Poison Helpline wording.
- MSD Veterinary Manual, birds.
- EMA HMPC monographs for peppermint and eucalyptus.
- Nazaroff & Weschler 2004, Singer 2006, Weschler 2000 (PMID 11089331) and Wainman 2000.
- NFPA *Home Candle Fires* 2020.
- ASTM F2058, F2417, F2179 and F2601 titles.
- ECHA 2024 candle CLP guidance.
- CandleScience GB 464 and 444 data.
- Supplier SDS flash points.

**Not verified:**
- Independent efficacy data for Leucidal (only manufacturer data exists).
- BTMS-25 use rate.
- Liquid-potpourri injuries in cats.
- Incense emissions epidemiology.
- Paraffin fragrance maximums.
- Lead-wick ban citation.
- Acrylamide regulation.

### Interactions (90)

**Count.** 90 entries: 43 in sub-agent batch 1 and 47 in batch 2.

**Sources.**
- 207 sources in total.
- 200 carry a PMID (188 distinct). Each was confirmed by esearch/esummary for title, first author and year.
- About 75 abstracts were read for the direction and size of the effect.

**My spot-check.** I independently re-checked 12 randomly sampled PMIDs. All matched.

**No PMID (7 sources):** WHO 2007 kava report; Sunter 1991; Harada 2002 (licorice and digoxin); Epidiolex label URL; Shader & Greenblatt 1985; FDA 2004 ephedra rule; FDA 2016 opioid–benzodiazepine boxed warning.

**Known limitation.** A few effect sizes were taken from widely cited summaries rather than re-read abstracts:
- indinavir −57%
- digoxin −25%
- CBD–warfarin dose cut of about 30%

## Conflicts with existing pages, and the corrections

1. **`site/soapcalc/soapcalc.mjs` (backs the Soap_Calculator page): the palm kernel SAP is too low.**
   - The calculator uses 0.156 NaOH.
   - SoapCalc gives 0.176.
   - Codex SV is 230–254 mg KOH/g, which is 0.164–0.181 g NaOH/g. So 0.156 is below the Codex range.
   - The error under-lyes the palm kernel portion by about 11%. A palm-kernel-heavy recipe comes out with more superfat than the user chose: softer and greasier. It does not make the soap caustic.
   - Smaller differences, all inside literature ranges and all erring toward less lye (the safe direction):

     | Oil | soapcalc.mjs | SoapCalc |
     |---|---|---|
     | sweet almond | 0.136 | 0.139 |
     | hemp | 0.1345 | 0.138 |
     | tallow | 0.1405 | 0.143 |
     | lard | 0.138 | 0.141 |
     | grapeseed | 0.1265 | 0.129 |
     | palm | 0.141 | 0.142 |
     | sunflower | 0.134 | 0.135 |
     | cocoa butter | 0.137 | 0.138 |

   - **Recommendation:** change palm kernel to 0.176. Then either align the others to SoapCalc, or document which source they come from. This is a code change and was not made.

2. **Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems** says that with reversible MAO-A inhibitors (harmine, moclobemide), tyramine "displaces the reversible inhibitor... preventing hypertensive spikes". That is overstated.
   - Reversible inhibitors reduce the pressor risk but do not remove it. The risk depends on dose. Moclobemide labelling still advises against large tyramine loads.
   - Interaction #17 rates harmala + tyramine as **moderate**, with an additive pressor effect possible. The risk window is the day of a ceremony, since harmine's half-life is hours.
   - **Fix:** "reduces, does not eliminate."

3. **Cytochrome_P450_System_Inhibition_and_Induction** lists piperine as a CYP2D6 inhibitor capable of producing "zero analgesia" from codeine. No human data supports piperine as a clinically strong 2D6 inhibitor.
   - The human piperine data (#31, #32) cover propranolol, theophylline and phenytoin at about 20 mg piperine, and CYP3A4/P-gp effects in vitro.
   - Keep fluoxetine and paroxetine as the codeine example. Drop piperine, or mark it in vitro.
   - Its claim "smokers metabolise caffeine ~50% faster" is in the right range; it was not separately re-verified.

4. **Kava_Potentiation** has three problems.
   - (a) The "CYP450 inhibitors" category (grapefruit, turmeric, cinnamon, piperine "prolonging kavalactone half-life") is a theoretical mechanism with no human kavalactone pharmacokinetic data behind it.
   - (b) The "post-kava meal phenomenon" is presented as a "universal observation", but it is anecdote.
   - (c) Its Gurley 2005 CYP2E1 statement is **correct** and matches #22.
   - **Also add:** kava + alcohol results conflict (Foo & Lemon found more impairment; Herberg 1993 found none). The "coma" alprazolam case was a semi-comatose patient also taking cimetidine and terazosin (#21).

5. **Stack_Substances** and the Bioavailability page say "turmeric/piperine 2000% boost". The 20-fold figure is **curcumin's own** bioavailability (Shoba 1998: 2 g curcumin + 20 mg piperine), measured from a near-undetectable baseline. Absolute serum levels stayed low. It is not a 20-fold boost for co-administered drugs. Black_Pepper states it correctly.

6. **Preservation_Fermentation_and_Spice (fermented garlic honey)** has three problems:
   - "Keeps indefinitely" is unsupported.
   - "A tablespoon of vinegar to bring pH below 4.6" is not a tested method. pH must be **measured**.
   - The infant-under-12-months honey warning (CDC) is missing.

   No extension-tested protocol for fermented garlic honey was found.

7. **Cooking_with_Herbs_and_Spices** says a "lab test" found about 10× more thymol in oil than in water. The direction is right (partitioning), but the test is a popular test-kitchen experiment, not a citable study. Either cite it as such or replace it with the log P explanation (APPLICATIONS §a). Its "Mexican sofrito" (in the blooming section) is a Spanish/Caribbean term; recaudo or the toasted-chile technique is the Mexican analogue. This is minor.

8. **Tinctures_Glycerites_Syrups_and_Infused_Oils_and_Butters: garlic/herb oil** "refrigerated, 2–4 days, or frozen" is **consistent** with PNW 664. Oregon State says 4 days and Cornell says 10; the page's shorter figure is the right one. Two additions:
   - Oregon State applies the same rule to **dried** garlic and herbs in oil, while the page implies dried material is safe to store at room temperature.
   - Add the tested PNW 664 citric-acid method as the only route to an acidified home oil.

9. **Aroma_Wheels** says "cats metabolise phenols and monoterpenes poorly; tea tree oil is toxic to cats". This is consistent. Add the citation (Court & Greenblatt 2000, PMID 10862526; Khan 2014, PMID 24344857).

10. **Keeping_Liquids_Evenly_Mixed.** The HLB ranges and polysorbate values are consistent with Griffin 1949. Griffin's formula form (20 × Mh/M) comes from his 1954 paper, which is worth noting if the page ever adds the formula.

## Gaps and next steps

- **Smoke points.** No primary dataset was obtained. They are method-dependent, so every value is flagged. A measured source exists but its numbers were not fetched: De Alzaa, Guillaume & Ravetti 2018, *Acta Sci Nutr Health* (a deliberate-heating study).
- **Comedogenic numbers.** Fulton 1989 (*J Soc Cosmet Chem* 40:321–333) exists, but its oil table was not obtained. Every rating is marked attributed or unsourced.
- **Animal fats.** Codex CXS 211 (named animal fats) and CXS 86 (cocoa butter) were not fetched.
- **Allergen labelling.** FDA's 2025 tree-nut list revision (coconut, shea) was not verified. Neither were the EU erucic acid limits (Reg. 2019/1870, EFSA 2016 TDI of 7 mg/kg bw/day) or the US status of mustard oil.
- **Not covered here:** Billing & Sherman's per-spice minimum inhibitory concentrations. Wick-size charts are supplier-specific and were deliberately not tabulated.
- **Interactions not yet in the library** (candidates for the next pass): cassia with diabetes drugs; bitter melon and fenugreek with hypoglycaemics; grapefruit with buspirone, amiodarone and some oral oncology drugs; St John's wort with tacrolimus and irinotecan; hawthorn with digoxin; guarana and yerba mate (caffeine stacking); DMT/ayahuasca with lithium (seizure reports); kratom with alcohol; nitrous oxide with B12; ibogaine and QT drugs; Syrian rue alone (overdose); khat.
- **Leucidal and "natural" preservatives.** These need an independent challenge-test study. None was found.
