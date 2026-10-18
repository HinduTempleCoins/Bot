# Topic research: folk remedies, homeopathy, holistic and Eastern medicine, enzymes, and how it all goes together

Research date: 2026-10-18. This is research only; nothing in it was published. It is the content companion to
`FORMAT_RESEARCH.md`, which covers what the posts look like.

**Sections:**
- **A1** Folk and kitchen remedies
- **A2** Homeopathy
- **A3** Holistic medicine
- **A4** Eastern medicine (TCM, Ayurveda, Unani, Kampo, Tibetan)
- **A5** The enzyme / "why it works" layer
- **A6** Herbs, gems and gods: what exists, gaps, extensions
- **A7** How the correspondence systems go together

**Source marks used throughout:**
- **[F]**: the page was fetched and read.
- **[F-EPMC] / [F-API]**: the abstract was read through the Europe PMC API, because the Cochrane/PubMed pages
  were walled.
- **[S]**: search-result summary only. **Verify before printing.**

Each section ends with its own numbered source list and a list of points that still need checking.

**facts.json corrections found during this research:**
- **Chamomile's planet.** The herb entry attributes chamomile to the Moon "per Culpeper". That is wrong.
  Culpeper gives camomile no planet of his own. The Moon line belongs to the next entry, Water-Caltrops. His
  only remark is "the Egyptians dedicated it to the Sun". See A6.
- **The Egyptian faces for Jupiter and Saturn** in the pantheon v3 table. "Horus who bounds the Two Lands" and
  similar names are ancient *astronomical* planet names, not cult gods, and that specific epithet was not
  confirmed by any source found. See A7.
- **Any "Western gem" column must name its source.** Agrippa, 777, Lilly and Brewer disagree on most planets.
  See A7.


Research date: 2026-10-18.

**How sources are marked.**
- **[F]** = I fetched the page myself and read the text cited.
- **[F-EPMC]** = I fetched the abstract record through the Europe PMC REST API (`ebi.ac.uk/europepmc/webservices/rest/search`). The link given is the record's canonical Europe PMC page (`europepmc.org/abstract/MED/<PMID>`), so readers can open it. These are **abstract-level** reads, not full texts, unless noted otherwise.
- **[S]** = I saw it only in search-result summaries and did not open it. Treat these as leads to verify before quoting.

Cochrane Library pages (cochranelibrary.com) and PubMed HTML returned 403 or cookie walls. Cochrane reviews below are cited from their Europe PMC abstract records.

---

## A1. Old wives' / folk and kitchen remedies

These are the remedies people actually use at home. Most are cheap and harmless, a few are genuinely useful, and a few cause real injuries. For each one, the useful questions are what it is meant to do, how people make it, what the evidence shows, and where it goes wrong.

### Honey (for cough)
- **Use:** cough from colds or other upper-respiratory infections, usually at bedtime.
- **How it's done:** 1–2 teaspoons, taken straight or stirred into a warm drink. Pediatric trials mostly gave one dose before sleep.
- **Evidence: helps (modest).** Cochrane (2018; 6 RCTs, 899 children aged 12 months to 18 years) found that honey probably reduces cough frequency more than no treatment (MD −1.05 on a 7-point scale, moderate certainty) and more than placebo (MD −1.62, moderate certainty). It may beat diphenhydramine (MD −0.57, low certainty). It probably makes little or no difference compared with dextromethorphan (MD −0.07, low certainty). Most children were treated for only one night [1]. A 2023 review of 10 studies reached the same direction, with low to very low quality evidence [1].
- **Safety:** **Never give honey to a baby under 12 months.** Honey can carry *Clostridium botulinum* spores, which can produce toxin in an infant's gut (infant botulism) [2][3]. Honey caused slightly more gastrointestinal complaints than placebo in the Cochrane review [1]. Diabetics should count it as sugar.

### Honey and lemon (hot)
- **Use:** cough and sore throat.
- **How it's done:** NHS recipe: the juice of half a lemon in a mug of boiled water, plus 1–2 teaspoons of honey, drunk warm [2].
- **Evidence: maybe / comfort.** The NHS says it "can have a similar effect to cough syrup" but adds that "there's limited evidence" that hot lemon and honey help a cough [2]. Warmth itself seems to help. In a 30-person RCT, a hot fruit drink did not change measured nasal airflow, but it gave immediate and sustained relief of runny nose, cough, sneezing, sore throat, chilliness and tiredness. The same drink at room temperature relieved only runny nose, cough and sneezing [4].
- **Safety:** not for babies under 1, because of the honey [2]. The NHS says "do not give hot drinks to small children" (scald risk) [2]. Acidic drinks taken often can erode tooth enamel.

### Garlic
- **Use:** "preventing colds", "immune boosting", lowering cholesterol and blood pressure. Raw cloves are sometimes put on the skin for warts or fungus.
- **How it's done:** raw or crushed cloves in food, or aged-garlic or allicin supplements. The single cold-prevention RCT used 180 mg of allicin daily for 12 weeks [6].
- **Evidence: maybe (cardiovascular, small); unproven (colds).** NCCIH: supplements may lower total and LDL cholesterol slightly in people with high cholesterol, and may lower blood pressure slightly in people with hypertension. Evidence for colds is "very little" [5]. Cochrane (2014) found one trial (n=146): 24 colds on garlic vs 65 on placebo, but recovery time was similar (4.63 vs 5.63 days). The authors judged the evidence insufficient, saying "claims of effectiveness appear to rely largely on poor-quality evidence" [6].
- **Safety:** breath and body odour, heartburn, gas and nausea [5]. Supplements **may increase bleeding risk**, which matters with anticoagulants or aspirin and before surgery [5]. **Drug interaction:** garlic supplements cut saquinavir (an HIV protease inhibitor) exposure by 51% (AUC), and levels were still only 60–70% of baseline after a 10-day washout [7]. This points to a general enzyme- and transporter-induction risk with some medicines. **Raw garlic on the skin can cause "severe skin irritation and chemical burns"** [5]. The usual scenario is a clove taped on overnight, sometimes on a child.

### Ginger
- **Use:** nausea (pregnancy, motion, after chemotherapy or surgery), colds and menstrual cramps.
- **How it's done:** fresh-root tea (slices steeped in hot water), crystallised ginger, or capsules. Trials mostly used supplements, not food [8].
- **Evidence: helps for pregnancy nausea; mixed elsewhere.** NCCIH: "ginger may be helpful for nausea and vomiting associated with pregnancy". Most studies of motion sickness show no benefit. It is uncertain as an add-on for chemotherapy nausea or postoperative nausea. Supplements may reduce menstrual cramp severity [8].
- **Safety:** abdominal discomfort, heartburn, diarrhoea and mouth or throat irritation [8]. Supplements in pregnancy "may be safe", but check with a clinician [8]. NCCIH lists no specific drug interactions [8]. Ginger is often grouped with garlic as a possible bleeding-risk herb at supplement doses. NCCIH does not state this, so treat it as a caution, not a finding.

### Onion poultice / onion in socks
- **Use:** to "draw out" a cold, flu, fever or "toxins" (sliced onion in the socks overnight), or a warm onion poultice on the chest or ear.
- **Evidence: myth.** No studies have tested the sock remedy. Its roots are 1500s plague-era "noxious air" ideas and later reflexology, and its benefits are unproven [9]. Fact-checkers and physicians agree that onions do not absorb germs or toxins through the feet [10]. A literature search turned up no clinical trials or harm reports for onion poultices [11].
- **Safety:** generally harmless [9]. Keep hot poultices away from children's skin (burn risk). Raw cut allium on thin skin can irritate it (compare the garlic burns above). Anything placed in the ear canal is a bad idea with a possible perforated eardrum.

### Chicken soup
- **Use:** colds and flu.
- **Evidence: maybe (modest), and it's fluid and food anyway.** Rennard et al. (*Chest* 2000) found that chicken soup inhibited neutrophil chemotaxis **in vitro**, which is a plausible mild anti-inflammatory mechanism. The effect was concentration-dependent and varied widely between commercial soups. This is not a clinical outcome [12]. A 2025 systematic review (4 studies, 342 adults, mostly chicken-based soups) reported modest reductions in symptom severity and in illness duration of about 1–2.5 days, plus lower IL-6/TNF-α/CRP in two studies. The review used a narrative synthesis with no pooled estimate and called the evidence preliminary [13].
- **Safety:** none in particular. Salt content matters for people on sodium restriction, and stock cubes should not be given to babies [3].

### Apple cider vinegar (ACV)
- **Use:** weight loss, blood sugar, cholesterol, "detox", sore throat gargle, skin and warts.
- **How it's done:** typically 1–2 tablespoons **diluted** in a glass of water, often before meals. Some people use tablets.
- **Evidence: maybe for small glycaemic effects; weight loss unproven.** Meta-analyses from 2025 report reductions in fasting glucose (about 21–22 mg/dL) and HbA1c in people with type 2 diabetes. They find small changes in body weight and total cholesterol, and inconsistent effects on LDL, HDL and triglycerides [14]. The most widely publicised ACV weight-loss RCT (BMJ Nutrition, Prevention & Health, March 2024; 120 adults in Lebanon) was **retracted in September 2025**. The retraction cited statistical errors, implausible values, irregularities in the dataset, results that could not be reproduced and a trial that was never registered [15]. Do not cite it.
- **Safety:** use it diluted. Neat vinegar is an acid that erodes enamel and irritates the throat (rinse with water afterwards and don't brush teeth right after). **ACV tablets have caused oesophageal injury.** When eight tablet brands were tested, their pH, acid content and labelling varied widely, and some may not have contained ACV at all [16]. Put on the skin under a dressing (for warts or moles), vinegar can cause chemical burns. If you are on insulin or sulfonylureas, the glucose-lowering effect is a reason to monitor your blood sugar. That last point is inferred from the glycaemic data.

### Salt-water gargle
- **Use:** sore throat.
- **How it's done:** dissolve ½ teaspoon of salt in a glass of warm water, gargle, then **spit it out, don't swallow** [17].
- **Evidence: helps for comfort (standard advice).** The NHS lists it first in its sore-throat self-care advice, alongside fluids, cool or soft foods, rest and lozenges [17].
- **Safety:** "Children should not try this" (they swallow it) [17]. Repeatedly swallowing concentrated salt water is dangerous for small children. Don't give young children hard lozenges or ice (choking) [17].

### Steam inhalation
- **Use:** blocked nose, colds, sinusitis. A bowl of just-boiled water, a towel over the head, sometimes with menthol or eucalyptus.
- **Evidence: no proven benefit.** Cochrane (2017; 6 trials, 387 people) found inconsistent results for symptom relief and no significant improvement in symptom resolution, with low-quality evidence. The authors concluded the evidence "does not show any benefits or harms" for heated, humidified air [18].
- **Safety: real scald risk, especially in children.** One UK regional burns centre treated 19 steam-inhalation scald patients in two years, aged 2 weeks to 91 years. 84% of the burns were to the lower body, from bowls tipping into laps. Six needed surgery. There were 201 cases nationally in 2018–19 [19]. The literature increasingly advises against steam inhalation for children, and adult scald series show the same pattern [19]. If you do it anyway: use a stable, wide-based bowl on a table (not your lap), keep children and pets away, and never let a child do it unsupervised. A warm shower gives you humid air without the bowl.

### Mustard plaster
- **Use:** chest congestion, joint and muscle pain. A paste of ground mustard seed and flour, sometimes over petroleum jelly, under cloth.
- **Evidence: unsupported.** No trials. It works as a counter-irritant (mustard oil compounds are skin irritants).
- **Safety: causes chemical burns.** Case reports describe second-degree burns. In one, a 71-year-old woman had pulverised mustard seed on her knee for about 24 hours (debridement, about a month to heal). Others involved chest plasters for congestion and a paste left on for 5 hours [20][21]. The traditional limit given in the literature is **15 minutes maximum**. Longer application can cause burns and nerve damage [20]. Never use it on children, on numb skin (diabetic neuropathy) or overnight.

### Hot toddy
- **Use:** "knocking out" a cold at bedtime: whisky or brandy, hot water, honey and lemon.
- **Evidence: myth as a cure; the warm-drink part may comfort.** The heat and the honey likely account for any benefit [1][4]. Alcohol does help people fall asleep faster, but it increases sleep disruption in the second half of the night and reduces REM at moderate and high doses [22]. Sleep quality is therefore worse, not better.
- **Safety:** not for children (alcohol, and hot drinks in small children [2]). Avoid it with sedating antihistamines, opioid or codeine cough medicines, benzodiazepines or other sedatives (additive CNS depression). Avoid it with regular heavy paracetamol/acetaminophen use (liver), and while pregnant.

### Cold compress / ice / RICE (PRICE)
- **Use:** sprains, strains, bruises.
- **How it's done (NHS):** PRICE for the first 2–3 days: protect, rest, **ice** (an ice pack or frozen peas *wrapped in a towel*) for **up to 20 minutes every 2–3 hours**, compress with a bandage during the day, and elevate on a pillow. Avoid heat, alcohol and massage for the first couple of days, and avoid running or strenuous exercise for up to 8 weeks [23].
- **Evidence: standard first-aid advice.** The NHS still recommends it [23]. Current sports-medicine thinking puts less emphasis on prolonged rest and more on early gentle loading. That is not covered in my fetched sources.
- **Safety:** never put ice directly on skin (cold burn). Be especially careful with poor circulation or numbness.

### Baking soda (sodium bicarbonate)
- **Use:** indigestion and heartburn (½ teaspoon in water), "alkalising", UTI, beating drug tests, mouthwash, insect-bite paste, and baths for itch.
- **Evidence:** it is a genuine antacid, short-term. "Alkalising the body" and cancer claims are unsupported.
- **Safety: misuse is a documented poisoning pattern.** California Poison Control (2000–2012) recorded 192 symptomatic cases. 60% involved use as an antacid, 11.5% attempts to beat urine drug tests and 4.7% UTI self-treatment. 55% needed medical evaluation, and 12 were hospitalised with electrolyte imbalance, metabolic alkalosis or respiratory depression. Chronic antacid users, pregnant women and young children were at highest risk [24]. Case reports include hemorrhagic encephalopathy after acute ingestion [25] and alkalosis with arrhythmia [25]. Each ½ teaspoon carries a large sodium load, so avoid it with heart failure, kidney disease or hypertension. Never take it on a very full stomach or after a large meal or drink: it generates CO₂, and gastric rupture has been reported. That last point is a **[S]-level claim** I did not fetch a source for.

### Oatmeal bath (colloidal oatmeal)
- **Use:** itchy skin, eczema, chickenpox, sunburn, insect bites.
- **How it's done:** finely ground "colloidal" oatmeal, or plain oats blended to powder, sprinkled into lukewarm running bath water. Product labels say soak 15–30 minutes, then pat dry [26].
- **Evidence: supported as a skin protectant and moisturiser.** In a 2020 RCT (61 patients, mild-to-moderate eczema), 1% colloidal oat cream reduced EASI and ADSI by 51% and 54% versus a standard moisturiser. In a 2017 double-blind trial (90 children aged 6 months to 18 years), an OTC 1% oat cream was as effective as a prescription barrier cream [27]. In the US, colloidal oatmeal is regulated as an OTC skin protectant [26].
- **Safety:** low irritancy overall [27]. **However:** among 302 children with atopic dermatitis, oat sensitisation was common (14.6% patch-test positive, 19.2% prick-test positive). 32% of oat-cream users were patch-positive versus 0% of non-users, and under-2s were most affected. The authors advise avoiding oat-protein topicals in infants with atopic dermatitis [28]. Use lukewarm water, not hot, because hot water dries skin. Tubs get slippery.

### Cranberry (for UTI)
- **Use:** preventing (not treating) recurrent urinary tract infections.
- **How it's done:** juice, or tablets/capsules standardised for proanthocyanidins (PACs).
- **Evidence: helps for prevention in specific groups.** Cochrane (2023; 50 trials, 8,857 participants): cranberry products reduced symptomatic, culture-verified UTI overall (RR 0.70, moderate certainty). The reduction held for women with recurrent UTI (RR 0.74), children (RR 0.46) and people susceptible after interventions such as catheterisation or radiotherapy (RR 0.47). There was **little or no benefit** for elderly people in institutions (RR 0.93), pregnant women (RR 1.06) or people with neurogenic bladder (RR 0.97) [29].
- **Safety:** gastrointestinal side effects did not clearly differ from placebo (RR 1.33, CI 1.00–1.77) [29]. Juice adds sugar. Cranberry is **not a treatment for an active UTI**: fever, flank pain or blood in the urine need care. Warfarin users should keep intake consistent and tell their clinician. This interaction signal comes from case reports I did not fetch; mark it [S].

### Butter (or oil, toothpaste, egg white) on burns
- **Evidence: harmful.** The NHS says "do not put any creams, oils or butter on burns or scalds." Instead: **cool running water for 20 minutes**, ideally started within 3 hours. Remove nearby clothing and jewellery, but leave anything stuck to the burn. Afterwards cover loosely with cling film laid over the burn, not wrapped around it. Don't use sticky plasters and don't burst blisters [30]. Fats hold heat in and contaminate the wound.

### "Feed a cold, starve a fever"
- **Evidence: myth as a rule, though there is interesting biology.** A small 2002 human study found that eating raised interferon-γ (a Th1, antiviral-type response) and fasting raised IL-4, a shift in Th1/Th2 balance [31]. In mice, reduced eating protected against bacterial sepsis, while feeding (glucose) protected against influenza and viral sepsis [32]. A 2024 review concludes that the effects are context-dependent (pathogen, host, stage) and not a usable rule [33].
- **Practical:** eat if you are hungry and keep fluids up during any fever or illness [2]. Don't force a feverish child to fast.

### Vapour rub (camphor, menthol, eucalyptus; e.g. Vicks VapoRub)
- **Use:** rubbed on the chest and throat for night-time cough and congestion.
- **Evidence: maybe (subjective relief).** In an RCT of 138 children aged 2–11, parents rated vapour rub better than petrolatum or no treatment for night-time cough, congestion and sleep. It caused more mild irritant effects [34].
- **Safety: not under age 2.** Camphor is "highly toxic if ingested". Swallowing, inhaling or absorbing too much can cause seizures, breathing problems, coma or death in young children. Never apply it in or under the nostrils or on broken skin [35]. In a ferret study, the rub increased mucin secretion by 63% and cut ciliary beat by 35% in vitro. The authors linked this to a case of respiratory distress in an 18-month-old and suggested it could worsen airway obstruction in infants [36]. If a child swallows some: wipe out the mouth, give water, don't induce vomiting, and call Poison Control (US 1-800-222-1222) [35].

### Tea tree oil
- **Use:** acne, athlete's foot, nail fungus, lice, dandruff, cuts.
- **How it's done:** topical only, typically diluted (5% gels were used in acne studies).
- **Evidence: maybe (topical).** A small amount of research suggests it might help acne. It may help athlete's foot but less well than standard treatment. There is too little evidence for nail fungus, lice, Demodex blepharitis or gum disease [37].
- **Safety:** **"Tea tree oil should not be swallowed."** Ingestion can cause confusion, inability to walk, unsteadiness and coma [37]. Redness and irritation are more likely with old, oxidised oil exposed to heat, light or air [37]. **Toxic to cats and dogs.** It is the essential oil most commonly reported in pet poisonings [38] (see A3 aromatherapy). There are case reports of prepubertal gynaecomastia with lavender/tea tree products. NCCIH's tea-tree page does not cover this, and its lavender page notes the cases but says the cause is unclear [52].

### Peppermint (oil) for IBS
- **Use:** IBS cramps and bloating. Peppermint tea for indigestion.
- **How it's done:** **enteric-coated** peppermint oil capsules (the coating reduces heartburn).
- **Evidence: helps (adults with IBS).** A 2022 review of 10 studies found peppermint oil "better than placebo at improving overall IBS symptoms", with more mild side effects such as reflux and indigestion [39]. Peppermint oil alone has **not** been shown to help ordinary indigestion and may worsen it [39].
- **Safety:** heartburn, nausea, abdominal pain, dry mouth [39]. Avoid it with GERD or hiatal hernia. **Menthol should not be applied to the face of, or inhaled by, an infant or small child**, because it may affect breathing [39]. Breastfeeding mothers using it on nipples should wipe it off before feeds [39].

### Warm milk for sleep
- **Evidence: maybe / ritual.** A 2020 systematic review (14 studies, 1972–2019, mixed designs) concluded that a balanced diet including milk "appears" to support sleep, with mixed results [40]. The tryptophan dose in a glass of milk is small. Any benefit is plausibly the bedtime routine and the warmth. Comfort is legitimate, but this is not a treatment for insomnia (see CBT-I in A3).
- **Safety:** none, beyond lactose intolerance and calories.

### Raw egg and other common myths
- **Raw eggs (for strength, "protein", hangovers, hair, in eggnog):** *myth and a hazard.* Cooked egg protein is **better** absorbed: true ileal digestibility was 90.9% cooked versus 51.3% raw [41]. Raw or undercooked eggs can carry *Salmonella* even when the shell is clean and uncracked. The illness causes diarrhoea, fever, cramps and vomiting 12–72 hours later, lasting 4–7 days, and can become invasive [42]. Higher-risk groups are children, older adults, pregnant women and the immunocompromised [42]. Cook egg dishes to 160°F (71°C), or use pasteurised eggs for raw-egg recipes [42]. UK note: Lion-stamped hens' eggs may be served runny, even to babies, but other eggs must be cooked solid [3].
- **"Vitamin C cures colds":** *mostly myth.* Regular supplementation does not reduce cold incidence in the general population (RR 0.97). It does roughly halve colds in people under extreme physical stress such as marathoners, skiers and soldiers (RR 0.48). It shortens colds by about 8% in adults and 14% in children. Taking it **after** symptoms start shows no consistent effect [43].
- **"Milk makes more mucus":** *myth.* In a rhinovirus challenge study, milk intake was not associated with nasal secretion weight. Believers *felt* more congested [44], and the sensation is throat coating, not extra mucus [44].
- **"Going out cold or with wet feet gives you a cold":** *partly true.* In an RCT of 180 people, chilling the feet was followed by cold symptoms in 13/90 versus 5/90 controls. The likely explanation is reactivation of an infection already carried [45].

### A1 compact table

| Remedy | Common use | Verdict | Key caution |
|---|---|---|---|
| Honey | Cough | **Helps (modest)**; ≈ dextromethorphan | **Never under 12 months** (botulism) |
| Honey + hot lemon | Cough, sore throat | Comfort / maybe | No hot drinks for small children; not for babies under 1 |
| Garlic | Colds, cholesterol, BP | Unproven (colds); slight lipid/BP effect | Bleeding risk; cuts saquinavir levels about 51%; **raw garlic burns skin** |
| Ginger | Nausea | **Helps (pregnancy)**; weak for motion sickness | Heartburn; ask a clinician in pregnancy |
| Onion in socks / poultice | Colds, "toxins" | **Myth** | Hot poultices can burn |
| Chicken soup | Colds | Maybe (modest), and good hydration and food | Salt |
| Apple cider vinegar | Weight, glucose | Small glucose effect; weight claim unproven (key RCT retracted) | Dilute; tablets have injured the oesophagus; enamel; hypoglycaemia on diabetes drugs |
| Salt-water gargle | Sore throat | **Helps (comfort)** | Spit it out; not for young children |
| Steam inhalation | Congestion | **No proven benefit** | **Scalds**, especially children and laps |
| Mustard plaster | Congestion, pain | Unsupported | **Chemical burns**; 15 minutes maximum; never overnight or on children |
| Hot toddy | Colds, sleep | Myth as cure | Worsens second-half sleep; interacts with sedatives; not for children |
| Cold compress / PRICE | Sprains | **Standard first aid** | Wrap the ice; 20 minutes every 2–3 hours |
| Baking soda | Heartburn | Works short-term | **Overdose: alkalosis, high sodium**; risk in pregnancy, children, heart and kidney disease |
| Oatmeal bath | Itch, eczema | **Supported** (skin protectant) | Oat sensitisation in atopic infants; lukewarm water only |
| Cranberry | UTI prevention | **Helps** (recurrent UTI in women, children, after procedures) | Not a treatment for active UTI; no benefit in pregnancy, care homes or neurogenic bladder |
| Butter on burns | Burns | **Harmful** | Use 20 minutes of cool running water instead |
| Feed a cold / starve a fever | Fever, colds | **Myth as rule** | Keep fluids up |
| Vapour rub | Night cough | Maybe (subjective) | **Not under 2**; camphor is toxic if swallowed; not in nostrils |
| Tea tree oil | Acne, fungus | Maybe (topical) | **Never swallow**; toxic to pets; oxidised oil irritates |
| Peppermint oil | IBS | **Helps** (enteric-coated) | Heartburn; no menthol on infants' faces |
| Warm milk | Sleep | Maybe (ritual) | None significant |
| Raw egg | Protein, "strength" | **Myth** (less protein absorbed) | *Salmonella* |
| Vitamin C after a cold starts | Colds | **Myth** | None at normal doses |

### A1 sources
1. Cochrane, Oduwole et al. 2018, *Honey for acute cough in children*, plus Kuitunen & Renko 2023. **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22honey%20for%20acute%20cough%20in%20children%22&resultType=core&format=json
2. NHS, *Cough*. **[F]** https://www.nhs.uk/conditions/cough/
3. NHS, *Foods to avoid giving babies and young children*. **[F]** https://www.nhs.uk/baby/weaning-and-feeding/foods-to-avoid-giving-babies-and-young-children/
4. Sanu & Eccles 2008, *Rhinology* 46:271, PMID 19145994. **[F-EPMC]** https://europepmc.org/abstract/MED/19145994
5. NCCIH, *Garlic*. **[F]** https://www.nccih.nih.gov/health/garlic
6. Cochrane, *Garlic for the common cold* 2014, PMID 25386977. **[F-EPMC]** https://europepmc.org/abstract/MED/25386977
7. Piscitelli et al. 2002, *Clin Infect Dis* 34:234, PMID 11740713. **[F-EPMC]** https://europepmc.org/abstract/MED/11740713
8. NCCIH, *Ginger*. **[F]** https://www.nccih.nih.gov/health/ginger
9. Medical News Today, onion in socks. **[F]** https://www.medicalnewstoday.com/articles/320167
10. Lead Stories / Africa Check / Logically Facts fact-checks. **[S]** https://leadstories.com/hoax-alert/2022/11/fact-check-cut-onion-in-sock-does-not-combat-cold-and-flu.html ; https://africacheck.org/fact-checks/meta-programme-fact-checks/no-placing-onions-under-your-feet-wont-cure-cold-or-flu
11. Europe PMC search, onion + poultice (no clinical records). **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22onion%22%20AND%20poultice&resultType=core&format=json
12. Rennard et al. 2000, *Chest* 118:1150, PMID 11035691. **[F-EPMC]** https://europepmc.org/abstract/MED/11035691
13. Lucas et al. 2025, *Nutrients* 17:2247, PMID 40647351. **[F-EPMC]** https://europepmc.org/abstract/MED/40647351
14. ACV meta-analyses 2025 (PMIDs 41010525, 37608660, 39949546). **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22apple%20cider%20vinegar%22%20AND%20(meta-analysis%20OR%20systematic%20review)&resultType=core&format=json
15. Medical Republic, *BMJ retracts vinegar weight loss trial* (retraction notice doi 10.1136/bmjnph-2023-000823ret). **[F]** https://www.medicalrepublic.com.au/bmj-retracts-vinegar-weight-loss-trial/120152
16. Hill et al. 2005, *J Am Diet Assoc* 105:1141, PMID 15983536. **[F-EPMC]** https://europepmc.org/abstract/MED/15983536
17. NHS, *Sore throat*. **[F]** https://www.nhs.uk/conditions/sore-throat/
18. Cochrane, Singh et al. 2017, *Heated, humidified air for the common cold*, PMID 28849871. **[F-EPMC]** https://europepmc.org/abstract/MED/28849871
19. *Burns* 2021, "Steam inhalation: more harm than good?", PMID 32943275, and *JPRAS Open* 2022, PMID 35198720. **[F-EPMC]** https://europepmc.org/abstract/MED/32943275
20. Yabanoglu et al. 2012, *Case Rep Med*, mustard-seed burn. **[F]** https://pmc.ncbi.nlm.nih.gov/articles/PMC3362821/
21. Dermatology Online Journal 2017 (chest plaster burn); J Korean Burn Soc 2012. **[S]** https://pubmed.ncbi.nlm.nih.gov/28329477/
22. Ebrahim et al. 2013, *Alcohol Clin Exp Res*, "Alcohol and sleep I", PMID 23347102. **[F-EPMC]** https://europepmc.org/abstract/MED/23347102
23. NHS, *Sprains and strains*. **[F]** https://www.nhs.uk/conditions/sprains-and-strains/
24. Al-Abri & Olson 2014, *J Clin Pharm Ther* 39:73, PMID 24313600. **[F-EPMC]** https://europepmc.org/abstract/MED/24313600
25. Europe PMC search, baking soda misuse case reports (W J Emerg Med 2016; J Med Toxicol 2013). **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22baking%20soda%22%20AND%20(gastric%20rupture%20OR%20metabolic%20alkalosis)%20AND%20poison%20control&resultType=core&format=json&pageSize=5
26. Colloidal oatmeal OTC label directions and status (product labels via search). **[S]** https://otclabels.com/lib/otc/otc-meds/soothing-bath-treatment-2/ ; https://www.medicalnewstoday.com/articles/oatmeal-bath-for-eczema
27. Colloidal oatmeal trials: Capone 2020 PMID 32484623; Lisante 2017 PMID 28366039; Criquet 2012 PMID 23204849. **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22colloidal%20oatmeal%22&resultType=core&format=json&pageSize=10&sort=CITED%20desc
28. Boussault et al. 2007, *Allergy* 62:1251, PMID 17919139. **[F-EPMC]** https://europepmc.org/abstract/MED/17919139
29. Cochrane, Williams et al. 2023, *Cranberries for preventing UTIs* (CD001321.pub7). **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22cranberries%20for%20preventing%20urinary%20tract%20infections%22%20AND%20PUB_YEAR:2023&resultType=core&format=json
30. NHS, *Burns and scalds*. **[F]** https://www.nhs.uk/conditions/burns-and-scalds/
31. van den Brink et al. 2002, *Clin Diagn Lab Immunol* 9:182, PMID 11777851. **[F-EPMC]** https://europepmc.org/abstract/MED/11777851
32. Wang et al. 2016, *Cell* 166:1512, PMID 27610573. **[F-EPMC]** https://europepmc.org/abstract/MED/27610573
33. *Curr Nutr Rep* 2024, "Feed a cold, starve a fever?" review, PMID 38587572. **[F-EPMC]** https://europepmc.org/abstract/MED/38587572
34. Paul et al. 2010, *Pediatrics* 126:1092, PMID 21059712. **[F-EPMC]** https://europepmc.org/abstract/MED/21059712
35. Missouri Poison Center, *VapoRub*. **[F]** https://missouripoisoncenter.org/is-this-a-poison/vaporub/
36. Abanses et al. 2009, *Chest* 135:143, PMID 19136404. **[F-EPMC]** https://europepmc.org/abstract/MED/19136404 (the 18-month-old case link is from my background knowledge of the paper; the abstract I fetched gives the ferret data)
37. NCCIH, *Tea tree oil*. **[F]** https://www.nccih.nih.gov/health/tea-tree-oil
38. Merck Veterinary Manual, *Toxicoses from essential oils in animals*. **[F]** https://www.merckvetmanual.com/toxicology/toxicoses-from-household-hazards/toxicoses-from-essential-oils-in-animals
39. NCCIH, *Peppermint oil*. **[F]** https://www.nccih.nih.gov/health/peppermint-oil
40. Komada et al. 2020, *IJERPH*, PMID 33339284. **[F-EPMC]** https://europepmc.org/abstract/MED/33339284
41. Evenepoel et al. 1998, *J Nutr* 128:1716, PMID 9772141. **[F-EPMC]** https://europepmc.org/abstract/MED/9772141
42. FDA, *What you need to know about egg safety*. **[F]** https://www.fda.gov/food/buy-store-serve-safe-food/what-you-need-know-about-egg-safety
43. Cochrane, Hemilä & Chalker 2013, *Vitamin C for preventing and treating the common cold*, PMID 23440782. **[F-EPMC]** https://europepmc.org/abstract/MED/23440782
44. Pinnock et al. 1990, PMID 2154152; Arney & Pinnock 1993, PMID 8452377. **[F-EPMC]** https://europepmc.org/abstract/MED/2154152
45. Johnson & Eccles 2005, *Fam Pract* 22:608, PMID 16286463. **[F-EPMC]** https://europepmc.org/abstract/MED/16286463

---

## A2. Homeopathy

### What it is
Homeopathy is a medical system developed in Germany more than 200 years ago. Its remedies are usually sugar pellets placed under the tongue, chosen individually for each person [1]. Its founder, **Samuel Hahnemann** (born 10 April 1755, Meissen; died 2 July 1843, Paris), was translating William Cullen's *Materia Medica* when he doubted Cullen's explanation of how cinchona bark treats malaria. He took cinchona himself and developed malaria-like symptoms. He published his first homeopathic article in 1796 and the *Organon of the Rational Art of Healing* in 1810. He also compiled "provings" in *Materia Medica Pura* (1811–21) and set out the theory of chronic-disease "miasms" in *Chronic Diseases* (1828) [2].

### Principles
- **Similia similibus curentur ("like cures like"):** a substance that causes symptoms in a healthy person is used to cure similar symptoms in a sick person [1].
- **"Law of minimum dose" / potentisation:** the more dilute the remedy, the stronger it is supposed to be. Dilution is combined with **succussion** (vigorous shaking, "striking against an elastic surface") at each step [1][3].
- **Provings:** remedies are characterised by giving them to healthy volunteers and recording the symptoms [2].
- **Individualisation:** the remedy is matched to the whole symptom picture, not to the diagnosis [1].

### Dilution scales and the Avogadro limit
- **X (or D), decimal:** 1:10 per step, so 6X = 10⁻⁶ [3].
- **C, centesimal:** 1:100 per step, so nC = 10⁻²ⁿ. 6C = 10⁻¹², and **12C = 10⁻²⁴** (equal to 24X) [3].
- **Avogadro limit:** one mole holds about 6.02×10²³ molecules. Starting from a 1 mol/L solution, 12C leaves an expected 0.6 molecules per litre. **Beyond about 12C, the remedy most probably contains no molecule of the starting substance** [3]. Hahnemann's usual 30C is 10⁻⁶⁰ [3]. **Oscillococcinum** is a **200C** dilution of duck heart and liver extract (10⁻⁴⁰⁰) [3].
- **Q/LM scale:** 1:50,000 per step [3]. **Korsakovian ("K")** potencies are made by emptying a single vessel and refilling it, relying on the film left on the walls [3].
- NCCIH notes that many products are diluted to the point that no molecules of the original substance remain, and that some core concepts "are inconsistent with fundamental concepts of chemistry and physics" [1].

### Commonly used remedies (what they're marketed for, and what to know)

| Remedy | Source substance | Traditional homeopathic use | What to know |
|---|---|---|---|
| **Arnica montana** (pillules 6C/30C; gels and creams) | Mountain arnica (Asteraceae) | Bruising, trauma, after surgery | Systematic reviews mix homeopathic and herbal (phytotherapeutic) arnica. A 2024 review of 42 papers found both positive and negative outcomes. Reviews of facial plastic surgery report reduced bruising in about 63% of arnica studies, but the studies were too heterogeneous to pool [4]. **Crude arnica taken by mouth is toxic**; only dilute homeopathic pillules or external creams on unbroken skin are used. Avoid with Asteraceae (ragweed/daisy) allergy. These two cautions are background knowledge, marked [S]. |
| **Oscillococcinum** | 200C duck heart/liver | Flu prevention and treatment | Cochrane (2012): no significant prevention effect (RR 0.48, CI 0.17–1.34). Some symptom relief at 48 hours (RR 1.86) that faded by day 4–5. "Insufficient good evidence to enable robust conclusions" [5]. |
| **Belladonna** (teething tablets, "fever" remedies) | Deadly nightshade (atropine-type alkaloids) | Teething, fever, flushed face | **The FDA (January 2017) found inconsistent and sometimes elevated belladonna in Hyland's teething tablets, above the labelled amount.** It urged parents to stop using them and asked for a recall. Seek care for seizures, breathing difficulty, lethargy, excessive sleepiness, muscle weakness, flushing, constipation, difficulty urinating or agitation [6][7]. More than 400 adverse event reports and 10 deaths referencing these products were reported in coverage [7, S]. In the FDA's words, the body's response to belladonna in children under 2 is "unpredictable" [6]. |
| **Nux vomica** | *Strychnos nux-vomica* seed (strychnine, brucine) | Hangover, indigestion, "overindulgence" | High dilutions contain no strychnine. However, a **mother tincture** of Nux vomica produced confirmed strychnine poisoning in a 2012 French case (blood level 3 mg/L, with spasms and respiratory blockage) [8, S]. Low-potency or mother-tincture products are not inert. |
| **Apis mellifica** | Honeybee | Stings, swelling, hives | No trial support. Don't use it in place of adrenaline for anaphylaxis. |
| **Chamomilla** | Chamomile | Teething, irritability, colic | No trial support. Separate from chamomile *tea*, which is a herb. Asteraceae allergy is possible with herbal chamomile. |
| **Rhus toxicodendron** | Poison ivy | Joint and muscle stiffness, rash | No reliable trial support. Low potencies come from a contact allergen. |
| **Zicam** (marketed as homeopathic; zinc gluconate 2X nasal gel) | Zinc | Colds | **FDA (June 2009): stop using the intranasal products.** There were more than 130 reports of **anosmia (loss of smell), possibly permanent** [9, S]. This is the classic example of a "homeopathic" label on a pharmacologically active dose. |
| **Calendula** creams and tinctures | Marigold flower | Cuts, nappy rash, radiation dermatitis | **Usually a real herbal extract (mother tincture or ointment), not a high dilution**, so it has actual plant constituents. The evidence is weak and mixed. One phase III trial found less grade ≥2 radiation dermatitis than trolamine (41% vs 63%), but a 411-patient blinded RCT found no advantage over aqueous cream. MASCC does not recommend it [10]. Asteraceae allergy is possible. |

### The evidence verdict
- **Australia, NHMRC (March 2015):** "There are no health conditions for which there is reliable evidence that homeopathy is effective" [11][12]. The review covered 68 conditions. 29 had only single studies, which were judged unreliable because they were too small or poorly designed [12]. It drew on an overview of 57 systematic reviews. Its methods were challenged by homeopathy groups, including an Ombudsman complaint [13, S]. Australia's **Natural Therapies Review 2024 (published March 2025)** kept homeopathy excluded from private-insurance rebates because the evidence was low or very low certainty. Homeopathy has been rebate-ineligible since 1 April 2019. The RACGP advises doctors not to practise it, refer to it or recommend it, and pharmacists not to sell it [11].
- **UK, House of Commons Science & Technology Committee, *Evidence Check 2: Homeopathy* (February 2010):** the chair said "We could find no evidence outside the placebo effect that homeopathic medicines had any efficacy." It recommended that **NHS funding should cease** (about £4 million a year, plus a £20 million refurbishment of the Royal London Homeopathic Hospital, 2002–05) and that no further research funding be given. It called further trials of settled questions unethical. The report was not unanimous: one MP dissented [14]. It also recommended that the MHRA stop licensing homeopathic products with medical claims [15, S].
- **Shang et al., *Lancet* 2005:** compared 110 homeopathy trials with 110 matched conventional trials. Among large, higher-quality trials, homeopathy OR 0.88 (CI 0.65–1.19, not significant) versus conventional OR 0.58 (CI 0.39–0.85). The results are "compatible with the notion that the clinical effects of homoeopathy are placebo effects" [16].
- **Cochrane:** Oscillococcinum, as above [5].
- **US regulation:**
  - **FTC Enforcement Policy Statement (15 November 2016):** OTC homeopathic claims must meet the same "competent and reliable scientific evidence" standard as other OTC products. Claims based only on traditional homeopathic theory are likely misleading unless the label clearly states that "there is no scientific evidence that the product works" and that claims rest on 1700s theories most modern medical experts do not accept [17].
  - **FDA:** no homeopathic product is FDA-approved [1]. The FDA withdrew its 1988 compliance policy (CPG 400.400) and, on **7 December 2022**, finalised a **risk-based enforcement guidance** [1][18]. Priority targets are products with injury reports, ingredients with significant safety concerns, and non-oral, non-topical routes such as injectables and **eye drops**. Industry groups are litigating the guidance [18, S].
  - Some liquid homeopathic products contain more alcohol than allowed in conventional drugs, and some "homeopathic" products contain substantial active ingredients [1].
- **Canada (Health Canada, 6 March 2019):** **nosodes** are homeopathic preparations made from disease material and marketed as "homeopathic vaccines". Health Canada requires their labels to say "This product is neither a vaccine nor an alternative to vaccination" and "has not been proven to prevent infection" [19].

### What harm looks like
1. **Indirect harm (the big one): delaying or replacing effective care.** A systematic review of case reports counted 1,159 people harmed and 4 deaths. 30 reports involved direct effects and 8 involved harm from substituting homeopathy for conventional care [20]. Specific risk areas include **nosodes instead of vaccines** (measles, pertussis, polio) [19], asthma (the FDA warned in 2015 against relying on OTC homeopathic asthma products) [1], infant fever, and infections. For curable cancers, people who chose alternative medicine **alone** had about 2.5× the risk of death (breast cancer HR 5.68) [A3-ref 5]. That figure covers all alternative medicine, not homeopathy specifically.
2. **Direct harm from low dilutions and mislabelled products:** belladonna teething tablets [6], Zicam's intranasal zinc [9], Nux vomica mother tincture [8], and "homeopathic" eye drops and injectables (the FDA's enforcement priority) [18]. **Rule of thumb:** a potency **below about 12C/24X**, a "mother tincture (Ø)", or a combination product listing milligram amounts may contain a pharmacologically active dose. Read it like a drug label.
3. **Alcohol content** in liquid remedies given to children [1].
4. **Homeopathic "aggravations":** a 2022 meta-analysis of observational studies found adverse effects reported in 87% of studies, and homeopathic aggravations in 22.5% [21]. Most were mild. The true cause is hard to establish.

### What is genuinely useful around it
- **The consultation.** A classical homeopathic intake is long (often an hour or more), attentive and holistic. In a double-blind RA trial (83 patients), the **homeopathic consultation**, not the remedy, improved DAS-28, swollen joints, pain and mood. The authors concluded: "Homeopathic consultations but not homeopathic remedies are associated with clinically relevant benefits" [22]. The lesson for any healer: time, listening and a coherent explanation have real effects.
- **Placebo and context effects** are real for subjective symptoms such as pain, nausea, fatigue and mood. They are not effects on tumours, infections or blood sugar. An inert remedy plus time also rides natural recovery and regression to the mean. The UK committee explicitly asked the government to set out its view on the ethics of prescribing placebos [14].
- **Homeopathic vs herbal: an important distinction for this library.** Herbal medicine (phytotherapy) uses measurable doses of plant constituents. It can work and can interact (see garlic, ginger, peppermint in A1). Homeopathy at 12C and above contains no starting material. Products labelled "homeopathic" sometimes contain **real herbal or mineral doses** (calendula ointments, arnica gels, mother tinctures, 2X zinc). Read the potency: Ø, 1X–6X or mg amounts mean "treat as an active substance"; 12C, 30C or 200C mean "sugar and water". Many shoppers believe homeopathic means "natural/herbal". It does not.

### A2 sources
1. NCCIH, *Homeopathy*. **[F]** https://www.nccih.nih.gov/health/homeopathy
2. Wikipedia, *Samuel Hahnemann* (biographical dates and publications). **[F]** https://en.wikipedia.org/wiki/Samuel_Hahnemann
3. Wikipedia, *Homeopathic dilutions* (scales and Avogadro arithmetic; the arithmetic checks). **[F]** https://en.wikipedia.org/wiki/Homeopathic_dilutions
4. Arnica reviews: Toma et al. 2024, *Plants*, PMID 39520030; Manouchehri 2026, PMID 42539591; Stack 2026, PMID 42698408. **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=homeopathic%20arnica%20(meta-analysis%20OR%20systematic%20review)%20postoperative%20OR%20bruising&resultType=core&format=json&pageSize=6
5. Cochrane, Mathie et al. 2012, *Homeopathic Oscillococcinum for preventing and treating influenza*, PMID 23235586. **[F-EPMC]** https://europepmc.org/abstract/MED/23235586
6. Pharmacy Times (30 January 2017) reporting the FDA belladonna teething finding. **[F]** https://www.pharmacytimes.com/view/fda-warns-belladonna-found-in-homeopathic-teething-products
7. Search summaries of the same FDA notice (adverse event and death counts via CNN coverage). **[S]** https://www.live5news.com/story/34367475/fda-confirms-elevated-levels-of-belladonna-in-certain-homeopathic-teething-products/
8. *Annales de Toxicologie Analytique* 2012, strychnine from Nux vomica mother tincture. **[S]** (fetch returned 403) https://www.ata-journal.org/10.1051/ata/2011134
9. FDA June 2009 Zicam advisory (via ABC News, Consumer Reports, AP). **[S]** https://abcnews.com/Health/ColdandFluNews/story?id=7853178
10. Kodiyan & Amber 2015, *Antioxidants*, topical calendula review. **[F]** https://pmc.ncbi.nlm.nih.gov/articles/PMC4665477
11. RACGP, *Homeopathy* position statement. **[F]** https://www.racgp.org.au/advocacy/position-statements/view-all-position-statements/clinical-and-practice-management/homeopathy
12. The Conversation, "Health experts find no evidence homeopathy works, again" (2015). **[F]** https://theconversation.com/health-experts-find-no-evidence-homeopathy-works-again-38651
13. Edzard Ernst blog on the Ombudsman complaint. **[S]** https://edzardernst.com/2017/04/ombudsman-investigates-flawed-homeopathic-study/ (NHMRC's own pages timed out on fetch: https://www.nhmrc.gov.au/about-us/resources/homeopathy)
14. Times Higher Education, "MPs call for halt to public funds for homeopathy" (February 2010). **[F]** https://www.timeshighereducation.com/node/79803
15. Search summaries of the HC 45 report's MHRA recommendations. **[S]** https://committees.parliament.uk/work/4566/ (parliament.uk returned 403)
16. Shang et al. 2005, *Lancet* 366:726, PMID 16125589. **[F-EPMC]** https://europepmc.org/abstract/MED/16125589
17. FTC press release, 15 November 2016. **[F]** https://www.ftc.gov/news-events/news/press-releases/2016/11/ftc-issues-enforcement-policy-statement-regarding-marketing-claims-over-counter-homeopathic-drugs
18. FDA Law Blog, "FDA finalizes guidance re enforcement policy for homeopathic drugs" (December 2022). **[F]** https://www.thefdalawblog.com/2022/12/fda-finalizes-guidance-re-enforcement-policy-for-homeopathic-drugs/ (priority categories from search summaries **[S]**: https://www.cps.bureauveritas.com/newsroom/us-fda-finalizes-homeopathic-drug-products-guidance)
19. Health Canada, "Homeopathic remedies are not substitute vaccines" (2019). **[F]** https://recalls-rappels.canada.ca/en/alert-recall/homeopathic-remedies-are-not-substitute-vaccines
20. Posadzki, Alotaibi & Ernst 2012, *Int J Clin Pract* 66:1178, PMID 23163497. **[F-EPMC]** https://europepmc.org/abstract/MED/23163497
21. Stub et al. 2022, *Explore*, PMID 33303386. **[F-EPMC]** https://europepmc.org/abstract/MED/33303386
22. Brien et al. 2011, *Rheumatology*, PMID 21076131. **[F-EPMC]** https://europepmc.org/abstract/MED/21076131

---

## A3. Holistic / wholistic medicine

"Holistic" means treating the whole person: body, mind, habits and environment. The **framing** is sound and mainstream; the lifestyle core of it (diet, sleep, movement, stress) is some of the best-evidenced medicine there is. The problems lie in particular **practitioner systems** that bundle that core with unproven tests, supplements and remedies. This section separates the two.

Labels used: **Supported** = consistent RCT or meta-analytic benefit for the stated use. **Mixed** = some benefit, low-quality or inconsistent. **Unsupported** = no reliable benefit shown.

### Naturopathy: *mixed (depends entirely on which parts)*
- **What it is:** a system that grew from traditional practices and 19th-century European health approaches. It aims to treat "root causes", views symptoms as signals, and is holistic in approach. Its toolkit includes diet and lifestyle change, stress reduction, herbs and supplements, **homeopathy**, manipulation, exercise therapy, "practitioner-guided detoxification" and counselling [1].
- **Training:** in the US there are two very different groups. **Licensed naturopathic doctors (ND/NMD)** complete a 4-year graduate program accredited by the Council on Naturopathic Medical Education and pass national board exams in the states that license them. Scope varies by state. **Traditional naturopaths** come from non-accredited programs of variable length and **cannot be licensed** [1]. NCCIH: "regulations, licenses, or certificates do not guarantee safe, effective treatment" [1]. US adult use rose from 0.2% (2002) to 1.3% (2022) [1].
- **What is evidence-based in it:** the dietary, exercise, sleep, stress-reduction and counselling components, which are covered below. Some specific herbs have good evidence (peppermint oil for IBS, ginger for pregnancy nausea; see A1).
- **What isn't:** homeopathy (A2), "detox" protocols, and many lab-test-driven supplement regimens.
- **Cautions:** herb–drug interactions (St John's wort and garlic are classic examples), substituting it for effective treatment, and anti-vaccination advice from some practitioners (not covered in my fetched sources). For curable cancers, choosing alternative medicine **alone** was associated with HR 2.50 for death overall, 5.68 for breast cancer, 4.57 for colorectal and 2.17 for lung [5]. Use it alongside effective care, never instead of it.

### Functional medicine: *mixed (the lifestyle core supported; the testing-and-supplement apparatus unsupported)*
- **What it is:** a model that looks for "root causes" through lifestyle, genetics and environment, with **food as first-line therapy** [2]. The **Cleveland Clinic Center for Functional Medicine** offers in-person and virtual individual and group ("shared medical") visits [2]. It was set up after Cleveland Clinic recruited Mark Hyman in 2014 [3, S].
- **Evidence for:** a Cleveland Clinic retrospective cohort compared 398 propensity-matched pairs of functional-medicine and family-medicine patients. PROMIS global physical health improved more at 6 months in functional medicine (+1.59 vs +0.33, P=.004), but the difference was **not significant at 12 months** in the main comparison. It was a single health system and not randomised, and the authors call for prospective trials [4].
- **Critiques (Science-Based Medicine):** heavy use of non-validated or over-interpreted lab panels. Order enough tests and some result will be "abnormal", which leads to supplement prescriptions. Founders and leaders sell supplements. Its "biochemical individuality" principle and its claim that it can't be tested in RCTs are used to avoid evidence standards. A case review attributed the patient's real benefits to exercise, counselling and support, not to the vitamin C infusions and supplements [3].
- **Practical:** the parts with value are long appointments, diet change, group visits and attention to sleep and stress. Be sceptical of out-of-pocket "food sensitivity" IgG panels, stool "dysbiosis" profiles, hair analysis, and multi-supplement stacks. That list is a general SBM critique; the specific tests named are background, marked [S].

### Diet patterns: Mediterranean (PREDIMED): *supported*
- **PREDIMED** (Spain; 7,447 people aged 55–80 at high cardiovascular risk without CVD; median 4.8 years) compared a Mediterranean diet with extra-virgin olive oil (about 1 L per week per household) or with mixed nuts (30 g a day) against a reduced-fat control diet. Major cardiovascular events (MI, stroke, CV death): **HR 0.69 for olive oil and 0.72 for nuts** [6]. The **original 2013 NEJM paper was retracted and republished in 2018**. Some household members had been enrolled without randomisation, one of 11 sites assigned participants without randomisation, and another used randomisation tables inconsistently. The results held after excluding the 1,588 affected participants [6]. The olive-oil quantity and nut gram figures are from my background knowledge of the protocol, marked [S].
- **Cautions:** the trial tested a whole pattern (olive oil, vegetables, legumes, fish, nuts, moderate wine optional) against a low-fat comparison diet. It does not show that adding olive oil to an otherwise poor diet works. Nuts are a choking risk for under-5s [A1-3] and an allergy issue.

### Sleep hygiene vs CBT-I: *CBT-I supported; sleep hygiene alone unsupported as a treatment*
- **ACP (2016):** all adults with chronic insomnia should get **CBT-I as initial treatment** (strong recommendation, moderate-quality evidence). Medication is a second-line, shared decision (weak recommendation) [7].
- **AASM (2021):** multicomponent CBT-I is **strongly** recommended. Brief behavioural therapies, stimulus control, sleep restriction and relaxation are conditionally recommended. **Sleep hygiene as a single therapy: conditional recommendation *against*** [8].
- **Practical core (CBT-I elements):** fixed wake time; bed only for sleep and sex; get up if you've been awake about 20 minutes and return when sleepy (stimulus control); compress time in bed to actual sleep time, then expand (sleep restriction, done with a clinician if you have bipolar disorder, epilepsy or a drowsy-driving risk); and work on catastrophic thoughts about sleep. Hygiene points (caffeine cut-off, alcohol [A1-22], dark and cool room) help as support, not as the cure. The specific practical steps and cautions are standard CBT-I content, not quoted from the fetched guidelines.

### Exercise: WHO 2020 guideline numbers: *supported*
- **Adults (18–64), including people with chronic conditions or disability:** **150–300 minutes a week of moderate, or 75–150 minutes of vigorous, aerobic activity** (or an equivalent mix). **Muscle-strengthening on 2 or more days a week**. More than 300 minutes of moderate activity gives additional benefit [9][10].
- **Older adults (65+):** the same, plus **varied multicomponent activity emphasising balance and strength on 3 or more days a week** to prevent falls [10].
- **Children and adolescents (5–17):** an **average of 60 minutes a day** of moderate-to-vigorous activity. Vigorous aerobic and muscle- and bone-strengthening activity on **at least 3 days a week** [10].
- **Pregnancy and postpartum:** **at least 150 minutes a week of moderate activity** [10].
- **Sedentary time:** reduce it, and replace it with any activity. There was not enough evidence to set a threshold [9][10].
- **Benefits:** lower all-cause and CV mortality, hypertension, type 2 diabetes, certain cancers and falls, and better mental health, cognition and sleep. About 31% of adults (1.8 billion) and about 80% of adolescents are insufficiently active [9].

### Breathwork: *mixed-to-supported for stress and anxiety; specific named techniques thinly tested*
- **Slow breathing (<10 breaths a minute, often about 6):** a systematic review of 15 studies found increased HRV and respiratory sinus arrhythmia, increased EEG alpha, and greater relaxation and less anxiety, depression and anger in healthy people [11].
- **Breathwork meta-analysis (2023):** across RCTs, stress g = −0.35 (12 RCTs, 785 adults), anxiety g = −0.32, depression g = −0.40. The authors warn against a "miscalibration between hype and evidence" [12].
- **Head-to-head RCT (Stanford, 2023):** 5 minutes a day for a month of **cyclic sighing** (double inhale, long exhale), **box breathing** (equal inhale–hold–exhale–hold, e.g. 4-4-4-4) or **cyclic hyperventilation with retention**, compared with mindfulness meditation. Breathwork improved mood and lowered respiratory rate more than meditation. **Cyclic sighing was best** [13].
- **4-7-8 breathing** (inhale 4, hold 7, exhale 8): only small, mostly recent trials, such as a 34-person crossover and a 75-person pre-endoscopy RCT where a stress ball beat it for anxiety. No HRV effect was shown [14]. Plausible as a long-exhale technique, but thin evidence.
- **Cautions:** **never practise hyperventilation or breath-hold techniques (Wim Hof style, "power breathing") in or near water, or while driving.** Hyperventilating before a breath-hold is a recognised risk factor for hypoxic blackout, and freedivers can hyperventilate without noticing [15]. Rapid breathing can trigger tingling, dizziness and panic in people prone to panic. People with epilepsy, pregnancy or cardiovascular disease should stick to slow, gentle patterns. Those last cautions are standard advice, not from fetched sources.

### Aromatherapy (and oral lavender): *oral Silexan supported for anxiety; inhaled aromatherapy mixed or unsupported*
- **Oral lavender oil (Silexan, 80–160 mg a day capsules)** is a different thing from aromatherapy. A 2023 meta-analysis (5 RCTs, 1,213 outpatients) found it **superior to placebo on HAMA** (responder ratio 1.34) in subthreshold anxiety, GAD and mixed anxiety-depression. Adverse events and dropouts did not differ from placebo [16]. An earlier meta-analysis found a HAMA difference of 3.83 points over 10 weeks [16]. **Results apply to Silexan specifically, not to other lavender products** [16]. NCCIH agrees that oral lavender may help anxiety, while noting small, industry-funded studies; side effects include diarrhoea, headache, nausea and burping [17]. Its likely sedative additivity with other sedatives also matters before surgery [17].
- **Inhaled aromatherapy:** NCCIH says benefits for anxiety, stress, pain and sleep are unclear, with "little rigorous research". In one study, lemon scent improved mood but neither lemon nor lavender changed stress markers [17][18]. A systematic review that tried to compare oral Silexan with inhaled lavender for sleep found **zero eligible studies** [16].
- **Toxicity:**
  - **Never swallow essential oils** (tea tree [A1-37]). Wintergreen and birch oil are almost pure **methyl salicylate**, which causes aspirin poisoning [19]. Camphor and eucalyptus cause seizures in children [A1-35][19]. A 15-month-old who swallowed about 10 mL of clove oil developed liver failure (ALT >13,000) and recovered with IV N-acetylcysteine. The same paper documented a 14-fold rise in aromatherapy-related home accidents in one national database (1994–1999) [20]. Store oils child-proofed, like medicines.
  - **Skin:** dilute before use. Oxidised oils sensitise. Lavender and tea tree topical products have case reports of breast-tissue swelling in children, cause unclear [17].
  - **Contamination:** in 2021, a Walmart "Better Homes & Gardens" lavender-and-chamomile aromatherapy room spray carried *Burkholderia pseudomallei*. Four people in four states got melioidosis and **two died**; about 3,900 bottles were recalled [21].
  - **Cats (and birds, and dogs):** cats lack glucuronyl transferase and cannot clear phenolic compounds. They also groom oil off their fur. Tea tree oil is the most commonly reported pet essential-oil poisoning. Hepatotoxic oils include tea tree/melaleuca, pennyroyal, cinnamon, cassia and birch tar. Seizure-causing oils include eucalyptus, wintergreen, pennyroyal, sage, hyssop and wormwood. **Active (ultrasonic or nebulising) diffusers deposit microdroplets on fur and feathers.** Never apply oils to pets, keep pets out of the room while diffusing, ventilate afterwards, and keep diffusion under 30 minutes. Signs: drooling, vomiting, ataxia, tremors, breathing difficulty. Don't induce vomiting [19].

### Hydrotherapy: cold water immersion and sauna
- **Cold water immersion: *mixed*.** A 2025 meta-analysis (11 studies, 3,177 people) found reduced stress **12 hours** after immersion, with no effect at other time points. Sleep and quality of life improved, mood did not, and immunity showed no effect. Inflammation markers rose acutely. Cold showers were associated with 29% less sickness absence, from a narrative (unpooled) synthesis [22]. A 2026 review of psychological outcomes judged most studies at high risk of bias and said cold-water exposure should not be considered a standalone psychiatric treatment [23]. For athletes, repeated ice baths **blunt muscle growth and strength gains** after resistance training [23].
  - **Cold-water cautions:** the **cold shock response** (involuntary gasp, hyperventilation and arrhythmias) impairs safe behaviour and is a drowning risk. It habituates after about 4 immersions, and anxiety makes it worse [24]. Start gradually, never alone in open water, enter slowly rather than jumping in, keep your head out, and don't do it with uncontrolled heart disease or after drinking. Breathing exercises with breath-holds must be done on land (see breathwork). The procedural advice is standard water-safety guidance, not quoted from the fetched abstracts.
- **Sauna: *mixed-to-supported (observational)*.** In the Finnish KIHD cohort (2,315 men aged 42–60, median follow-up 20.7 years), sauna 4–7 times a week versus once a week was associated with **HR 0.37 for sudden cardiac death**. Sessions longer than 19 minutes versus under 11 minutes had HR 0.48. Fatal CHD, fatal CVD and all-cause mortality showed similar inverse trends [25]. This is **observational** and only in Finnish men, so healthier people may simply sauna more. A review of 40 clinical studies (only 13 RCTs, mostly small) generally reported benefits. Regular sauna reversibly disrupted sperm production in one small study [26].
  - **Sauna cautions:** dehydration, fainting, and **alcohol** (a major factor in sauna deaths). Avoid with unstable angina, recent MI or severe aortic stenosis, in pregnancy (especially very hot or long sessions), and if you are trying to conceive (males). The specific contraindication list is standard clinical guidance; the abstract I fetched mentioned only spermatogenesis [26].

### Massage: *mixed (short-term relief, low-quality evidence)*
- Low back pain: weak evidence of short-term relief. Neck and shoulder: brief benefit. Knee OA: small studies suggest short-term relief. Cancer: some evidence of reduced pain and anxiety (very low quality). Fibromyalgia: at least 5 weeks of massage improved pain, anxiety and depression but not sleep [27].
- **Safety:** low risk overall, but rare serious events have occurred: **blood clots (DVT/VTE), nerve injury, fractures** and hematomas, usually with vigorous deep-tissue work or in older adults. Use lighter pressure in cancer [27]. Avoid deep work over a suspected DVT, on anticoagulants, over fragile osteoporotic bone, or on recent injury in the first 48 hours (see PRICE in A1) [27][A1-23].

### Yoga: *supported (low back pain, neck pain) to mixed (mental health)*
- Low back pain: slight benefit, about equal to exercise and massage. Neck pain: reduced pain and disability. Promising for tension headache, migraine and knee OA. May help depressive symptoms as an add-on, and anxiety symptoms, though less so for diagnosed anxiety disorders (CBT beat Kundalini yoga in one trial). Improves sleep in several groups and helps menopause symptoms about as well as other exercise [28].
- **Safety:** generally safe with a qualified teacher. Most injuries are sprains and strains, and adults 65+ have higher ER rates. Beginners should avoid headstands, shoulder stands, lotus and forceful breathing. **Hot yoga** brings overheating and dehydration. In pregnancy, avoid hot yoga and long periods lying on the back. Glaucoma, severe hypertension, spine disease and balance problems need modifications [28].

### Tai chi: *supported (falls, knee OA)*
- Older adults: **high-certainty evidence that it reduces the number of people who fall by about 20%**. **Knee and hip OA:** strongly recommended by the 2019 ACR/Arthritis Foundation guideline. Promising for low back pain, fibromyalgia and COPD (exercise capacity and quality of life). Low-certainty evidence for Parkinson's balance. Evidence in RA is unclear [29].
- **Safety:** adverse events in trials were similar to control groups, with no serious events attributed to tai chi, mostly minor aches. There is no national instructor certification [29].

### Meditation / mindfulness (MBSR, MBCT): *supported (modest) for anxiety, depression, distress; mixed for pain and blood pressure*
- **Goyal et al., JAMA Intern Med 2014** (47 trials, 3,515 people): mindfulness programs gave moderate improvements in anxiety (ES 0.38 at 8 weeks, 0.22 at 3–6 months), depression (0.30 and 0.23) and pain (0.33). There was **no evidence they were better than active treatments** such as drugs, exercise or other behavioural therapy [30].
- **NCCIH summary:** mindfulness beats no treatment and roughly matches evidence-based therapies for anxiety and depression in the short term, with no clear effects beyond 2 months. MBSR helps low back pain short-term but not fibromyalgia. Blood pressure benefit is "possible but not established" (AHA). Sleep improved more than with education, but not more than CBT or exercise. In a 203-veteran trial, meditation was as good as prolonged exposure for PTSD. It reduces distress, fatigue and pain in cancer patients. Much of the research is low quality [31].
- **Safety:** usually low risk, but **about 8%** of participants across 83 studies (6,703 people) reported a negative effect, most often anxiety or depression, similar to rates in psychotherapy [31]. People with a history of psychosis, severe PTSD or dissociation should start with short, guided, eyes-open practices with a trained teacher. Long silent retreats are the higher-risk setting. This advice is commonly given but not from fetched sources. Don't use meditation to delay care [31].

### Acupuncture (brief; the Eastern detail is elsewhere): *mixed-to-supported for some chronic pain; much of the effect non-specific*
- Chronic low back pain and knee OA: better than no treatment and than sham, comparable to NSAIDs. The ACP 2017 guideline lists it among first-line non-drug options for chronic low back pain. Migraine prevention: moderate-quality evidence of fewer attacks, with a **small** advantage over sham [32]. Real acupuncture beats no treatment by more than it beats sham, which NCCIH attributes largely to **non-specific effects** (expectation, the practitioner relationship) [32]. The NHS offers it for some chronic pain, migraine-type headache and severe hiccups [33].
- **Safety:** serious complications are uncommon and mainly come from non-sterile needles or poor technique: infections, **punctured organs** (pneumothorax with chest needling) and CNS injury. US needles must be sterile and single-use [32]. Be cautious with anticoagulants and skin conditions [33].

### A3 summary table

| Approach | Label | Main caution |
|---|---|---|
| Naturopathy (as a system) | Mixed | Varies hugely by practitioner; homeopathy and "detox" components unsupported; never instead of effective cancer or infection care |
| Functional medicine | Mixed | Over-testing and supplement stacks; cost |
| Mediterranean diet | **Supported** (PREDIMED, republished 2018) | Whole pattern, not single foods; nut allergy and choking |
| CBT-I | **Supported** (first line) | Sleep restriction needs care in bipolar disorder, epilepsy and drowsy driving |
| Sleep hygiene alone | Unsupported as monotherapy | Fine as support |
| Exercise (WHO 150–300 / 75–150 min, strength 2+ days) | **Supported** | Build up gradually |
| Slow breathing, cyclic sighing | Supported (modest) | None at gentle pace |
| Hyperventilation / breath-hold methods | Mixed | **Never in water or while driving** |
| Oral lavender (Silexan) | **Supported** (anxiety) | Burping, GI; additive with sedatives |
| Inhaled aromatherapy | Mixed / unsupported | Ingestion poisoning; **cats and pets**; contaminated products |
| Cold water immersion | Mixed | **Cold shock and drowning**; blunts muscle gains |
| Sauna | Mixed-to-supported (observational) | Alcohol, unstable heart disease, pregnancy, male fertility |
| Massage | Mixed (short-term) | DVT, anticoagulants, fragile bones |
| Yoga | Supported (back, neck) / mixed | Inversions for beginners; hot yoga; pregnancy |
| Tai chi | **Supported** (falls, knee OA) | Very low risk |
| Mindfulness / MBSR | Supported (modest) | About 8% adverse psychological effects; trauma histories |
| Acupuncture | Mixed-to-supported (some chronic pain) | Sterile single-use needles; pneumothorax |

### A3 sources
1. NCCIH, *Naturopathy*. **[F]** https://www.nccih.nih.gov/health/naturopathy
2. Cleveland Clinic, *Center for Functional Medicine*. **[F]** https://my.clevelandclinic.org/departments/functional-medicine
3. Science-Based Medicine, "Functional medicine: the ultimate misnomer..." **[F]** https://sciencebasedmedicine.org/functional-medicine-the-ultimate-misnomer-in-the-world-of-integrative-medicine/ (the 2014 Hyman hiring detail comes from search summaries **[S]**: https://sciencebasedmedicine.org/tag/functional-medicine/)
4. Beidelschies et al. 2019, *JAMA Netw Open* 2:e1914017, PMID 31651966. **[F-EPMC]** https://europepmc.org/abstract/MED/31651966
5. Johnson et al. 2018, *JNCI* 110:121, PMID 28922780. **[F-EPMC]** https://europepmc.org/abstract/MED/28922780
6. Estruch et al. 2018, *NEJM* 378:e34 (PREDIMED republication), PMID 29897866. **[F-EPMC]** https://europepmc.org/abstract/MED/29897866
7. Qaseem et al. 2016, ACP guideline, *Ann Intern Med* 165:125, PMID 27136449. **[F-EPMC]** https://europepmc.org/abstract/MED/27136449
8. Edinger et al. 2021, AASM guideline, *J Clin Sleep Med* 17:255, PMID 33164742. **[F-EPMC]** https://europepmc.org/abstract/MED/33164742
9. WHO, *Physical activity* fact sheet. **[F]** https://www.who.int/news-room/fact-sheets/detail/physical-activity ; WHO news release, 25 November 2020. **[F]** https://www.who.int/news/item/25-11-2020-every-move-counts-towards-better-health-says-who
10. Bull et al. 2020, *Br J Sports Med*, WHO 2020 guidelines (full text). **[F]** https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/
11. Zaccaro et al. 2018, *Front Hum Neurosci*, PMID 30245619. **[F-EPMC]** https://europepmc.org/abstract/MED/30245619
12. Fincham et al. 2023, *Sci Rep* 13:432, PMID 36624160. **[F-EPMC]** https://europepmc.org/abstract/MED/36624160
13. Balban et al. 2023, *Cell Rep Med* 4:100895, PMID 36630953. **[F-EPMC]** https://europepmc.org/abstract/MED/36630953
14. 4-7-8 trials (PMIDs 42715135, 42771122). **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%224-7-8%22%20breathing&resultType=core&format=json&pageSize=6
15. Pernett et al. 2024, *Front Physiol*, PMID 39835203. **[F-EPMC]** https://europepmc.org/abstract/MED/39835203
16. Silexan meta-analyses: Dold 2023 PMID 36717399; Möller 2019 PMID 29150713; Yap 2019 PMID 31792285; Greenberg & Slyer 2018 PMID 30439747. **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:Silexan%20AND%20(TITLE:meta-analysis%20OR%20TITLE:%22systematic%20review%22)&resultType=core&format=json&pageSize=6
17. NCCIH, *Lavender*. **[F]** https://www.nccih.nih.gov/health/lavender
18. NCCIH, *Aromatherapy*. **[F]** https://www.nccih.nih.gov/health/aromatherapy
19. Merck Veterinary Manual, *Toxicoses from essential oils in animals*. **[F]** https://www.merckvetmanual.com/toxicology/toxicoses-from-household-hazards/toxicoses-from-essential-oils-in-animals
20. Eisen et al. 2005, *Eur J Pediatr*, clove-oil/eugenol liver failure, PMID 15895251. **[F-EPMC]** https://europepmc.org/abstract/MED/15895251
21. Contagion Live, melioidosis and the aromatherapy spray (2021). **[F]** https://contagionlive.com/view/better-homes-gardens-aromatherapy-spray-causes-melioidosis-outbreak
22. Cain et al. 2025, *PLoS One* 20:e0317615, PMID 39879231. **[F-EPMC]** https://europepmc.org/abstract/MED/39879231
23. Ngandeu Schepanski 2026, PMID 42819812; Tornero-Aguilera 2026, *Exp Physiol*. **[F-EPMC]** https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=cold%20water%20immersion%20health%20(meta-analysis%20OR%20systematic%20review)%20adults%20stress%20sleep%20inflammation&resultType=core&format=json&pageSize=6
24. Barwood et al. 2024, *J Therm Biol*, PMID 38211547; Barwood 2013, PMID 22918558. **[F-EPMC]** https://europepmc.org/abstract/MED/38211547
25. Laukkanen et al. 2015, *JAMA Intern Med* 175:542, PMID 25705824. **[F-EPMC]** https://europepmc.org/abstract/MED/25705824
26. Hussain & Cohen 2018, *eCAM*, PMID 29849692. **[F-EPMC]** https://europepmc.org/abstract/MED/29849692
27. NCCIH, *Massage therapy: what you need to know*. **[F]** https://www.nccih.nih.gov/health/massage-therapy-what-you-need-to-know
28. NCCIH, *Yoga: what you need to know*. **[F]** https://www.nccih.nih.gov/health/yoga-what-you-need-to-know
29. NCCIH, *Tai chi: what you need to know*. **[F]** https://www.nccih.nih.gov/health/tai-chi-what-you-need-to-know
30. Goyal et al. 2014, *JAMA Intern Med* 174:357, PMID 24395196. **[F-EPMC]** https://europepmc.org/abstract/MED/24395196
31. NCCIH, *Meditation and mindfulness: effectiveness and safety*. **[F]** https://www.nccih.nih.gov/health/meditation-and-mindfulness-effectiveness-and-safety
32. NCCIH, *Acupuncture: effectiveness and safety*. **[F]** https://www.nccih.nih.gov/health/acupuncture-effectiveness-and-safety
33. NHS, *Complementary and alternative medicine* (redirected from /conditions/homeopathy/). **[F]** https://www.nhs.uk/conditions/homeopathy/

---

### Open items / verification gaps for the merger
- NHMRC's own statement page timed out. The quote comes via RACGP and The Conversation. Re-fetch https://www.nhmrc.gov.au before publishing the exact wording.
- The FDA belladonna press release URL returned 404, so the finding is cited via Pharmacy Times. The "10 deaths / 400+ reports" figures are search-level [S].
- The Zicam anosmia advisory and the Nux vomica mother-tincture case are [S] only.
- Baking-soda gastric rupture, the cranberry–warfarin signal, PREDIMED dose details, sauna contraindications, and the arnica oral-toxicity and Asteraceae cautions are flagged in the text as background or [S]. Cite a primary source before stating them as sourced facts.
- No NCCIH page exists at /health/calendula (404). The calendula claims rest on the 2015 *Antioxidants* review.



Research notes for the herbal-cards library (`knowledge/herbal-cards/`). Written to extend, not repeat, `facts.json` and `Herbs_Gems_and_Gods_How_They_Go_Together.wiki`. Those files already carry full herb cards for ginger, licorice, astragalus, Asian ginseng, ashwagandha, turmeric, tulsi, triphala, black seed and others, with doses and interaction warnings. Where a herb already has a card, this file adds only what the card lacks, such as system context, regulatory history or a newer safety signal.

**Citation key.** Every factual claim carries an inline [n]. Each section ends with its own source list. Each source is marked one of three ways:
- **F**: fetched and read directly with WebFetch.
- **F-API**: the abstract was fetched from the Europe PMC REST API (`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:<PMID>...`). The canonical record URL is given.
- **S**: seen only in a search-result summary, not opened. Treat these as weaker, and verify them before quoting.

Arithmetic I did myself, such as the worked planetary-hours example, is labelled "worked example".

---

## A4. Eastern medicine in depth

### A4.1 Traditional Chinese Medicine (TCM)

**Core concepts.**
- **Qi.** In TCM, qi is "the vital force or energy of life". It is said to circulate through channels called meridians, which connect to the organs and bodily functions [1]. Science-based reviews have found no evidence that qi, meridians or acupuncture points exist as physical structures (a 2008 review cited in [1]). Teach qi as the tradition's model, not as anatomy.
- **Yin-yang.** Yin and yang are "two abstract and complementary aspects" into which every phenomenon can be divided. They trace back to the Shang dynasty (c. 1600–1100 BCE). TCM treats health as a set of balances, yin-yang among them [1].
- **Canonical texts.**
  - The *Huangdi Neijing* (Yellow Emperor's Inner Canon) was compiled around the 1st century BCE. It is "the oldest received work of Chinese medical theory" [1].
  - The *Shennong Bencao Jing* (Eastern Han, 200–250 CE) is "the first systematic summary of Chinese herbal medicine" [1].
  - The *Shanghan Lun* of Zhang Zhongjing (compiled before 220 CE) has 398 sections and 113 herbal prescriptions. It is organised into six stages: Tai Yang, Yang Ming, Shao Yang, Tai Yin, Shao Yin and Jue Yin [2]. It is the root text for most classical formulas, and for Japanese Kampo (see A4.4).

**The Five Phases (wu xing).** The system took shape in the Han dynasty (2nd–1st century BCE) from older ideas. Mawangdui texts dated before 168 BCE already link the phases to five virtues and five emotions [3]. Wu xing originally referred to the **five visible planets**, which were thought to produce the five forces of earthly life [3]. This is the historical hinge that ties TCM to the planetary systems in A7.

| Phase | Yin organ (zang) | Yang organ (fu) | Season | Colour | Taste | Emotion | Direction | Planet | Sense organ | Climate |
|---|---|---|---|---|---|---|---|---|---|---|
| Wood | Liver | Gallbladder | Spring | Blue-green (cyan) | Sour | Anger | East | Jupiter | Eyes | Wind |
| Fire | Heart (+ Pericardium) | Small intestine (+ San Jiao) | Summer | Red | Bitter | Joy | South | Mars | Tongue | Heat |
| Earth | Spleen | Stomach | Late summer | Yellow | Sweet | Worry / pensiveness | Centre | Saturn | Mouth | Damp |
| Metal | Lung | Large intestine | Autumn | White | Pungent | Grief | West | Venus | Nose | Dryness |
| Water | Kidney | Urinary bladder | Winter | Black | Salty | Fear | North | Mercury | Ears | Cold |

All rows are from [3]. The source gives no separate climate row; the climate column follows the source's seasonal descriptions.

- **Generating (sheng, "mother-son") cycle:** Wood feeds Fire, Fire makes Earth (ash), Earth bears Metal, Metal collects Water, Water nourishes Wood [3].
- **Controlling (ke, "grandfather-grandson") cycle:** Wood grasps Earth, Earth dams Water, Water quenches Fire, Fire melts Metal, Metal chops Wood [3].

**The organ clock (horary or meridian clock).** Each of the twelve channels is said to peak for two hours, starting with the Lung channel at 03:00–05:00 [4]:

| Time | Channel | Time | Channel |
|---|---|---|---|
| 03–05 | Lung | 15–17 | Bladder |
| 05–07 | Large intestine | 17–19 | Kidney |
| 07–09 | Stomach | 19–21 | Pericardium |
| 09–11 | Spleen | 21–23 | San Jiao (Triple Burner) |
| 11–13 | Heart | 23–01 | Gallbladder |
| 13–15 | Small intestine | 01–03 | Liver |

- **Where it comes from.** Acupuncture Today describes the clock as a Taoist "cosmological imaging system". It derives the sequence from the *Luo Shu* and the earthly branches, with the Lung matched to the Tiger branch [4].
- **Status.** Treat it as **tradition and a teaching device, not chronobiology.** My search found no peer-reviewed validation [5, S]. One German thesis that tested acupoint skin resistance over 24 hours could not be opened (the site blocked the bot) [5, S]. Never present the "wake at 1–3 a.m. = liver problem" idea as diagnostic.

**Common herbs (additions to the existing cards).**
- **Ginseng, astragalus, ginger, licorice.** These already have full cards in the wiki. Add one system note for licorice: across 148 insurance-covered Kampo formulas in Japan, glycyrrhiza is the main cause of drug-induced **pseudoaldosteronism**, meaning low potassium and high blood pressure [16, F-API]. Risk rises with:
  - daily glycyrrhiza dose (OR 2.1);
  - use for more than 14 days (OR 2.8);
  - age 70 or over (OR 5.0);
  - weight under 50 kg;
  - diuretic use;
  - dementia (OR 7.0) [16].

  Shakuyakukanzoto, yokukansan and ryokeijutsukanto were the formulas most often implicated [16]. TCM's habit of adding licorice "to harmonise" a formula therefore adds up across products.
- **Goji / gou qi zi (*Lycium barbarum*): warfarin.** There are several probable-interaction case reports.
  - A 71-year-old woman on warfarin had an INR too high to measure (prothrombin time over 120 s), with nosebleeds and rectal bleeding, after 4 days of goji juice. The Naranjo score was "probable" [6, F-API].
  - A 65-year-old man had a raised INR and bleeding after goji wine. The authors say doses above about 6–12 g can strengthen warfarin's effect [7, F-API].
  - **Teach:** goji in food amounts is common, but people on warfarin should keep intake steady and have their INR checked if they start or stop it.
- **Dang gui / dong quai (*Angelica sinensis*): warfarin.** A patient stable on warfarin had her prothrombin time and INR more than double after 4 weeks of dong quai [8, F-API]. The herb contains natural coumarin derivatives [8]. In rabbits, dang gui changed warfarin's effect (pharmacodynamics) but not its blood levels (pharmacokinetics) [9, F-API]. The interaction is pharmacodynamic, so blood levels of warfarin will not reveal it; only the INR will.
- **Ban xia (*Pinellia ternata*).** Used for phlegm-damp, cough and vomiting. "This plant is toxic in raw form and must be processed" [10]. Its alkaloids include ephedrine, in amounts that vary greatly by processing and study, from about 34 µg/g down to none detected [10]. A 2023 review counts about 212 isolated compounds and covers toxicity and quality control [11, F-API]. **Teach:** buy only processed ban xia (the ginger-, alum- or licorice-processed forms named in TCM pharmacies). I could not open a source for the processing names themselves, so mark that line as practitioner knowledge to verify.
- **Ma huang / ephedra (*Ephedra sinica*).** The source of ephedrine alkaloids, traditionally used for colds, wheeze and congestion [12].
  - **In 2004 the US FDA banned sale of dietary supplements containing ephedrine alkaloids.** Before the ban they had been marketed for weight loss, energy and athletic performance [12].
  - Harms include hypertension, heart attack, seizure, stroke and psychosis, even at relatively low doses and with short use. Harm is worse with caffeine and with heart disease. Ephedra is unsafe in pregnancy, while breastfeeding, and in children [12].
  - The NCCIH page does not say whether traditional teas or practitioner-dispensed TCM fall under the ban [12]. Leave that point open rather than guess.

**Classic formulas worth one line each.**
- **Xiao Chai Hu Tang** (Minor Bupleurum Decoction) is the Chinese original of Kampo **sho-saiko-to**; its safety history is under Kampo below. That equivalence is practitioner knowledge, not from a fetched source.
- **Ge Gen Tang** (Kudzu Decoction) is the Chinese original of **kakkonto**.
- Both are *Shanghan Lun* formulas, and the *Shanghan Lun* holds 113 prescriptions [2].

**Acupuncture: what the evidence actually says.**
- **Where it may help, per NCCIH [13]:**
  - Chronic back and neck pain. It beat sham and no treatment, with relief "comparable to that of NSAIDs". The American College of Physicians lists it as a first-line option for chronic low-back pain.
  - Knee osteoarthritis, which has the strongest of the arthritis evidence.
  - Migraine prevention (moderate evidence, but only a small advantage over sham).
  - Tension headache (moderate to low quality evidence).
  - Seasonal allergies, stress incontinence and chemotherapy nausea (supportive evidence, older research).
- **Little or no benefit over sham [13]:** IBS, IVF and infertility, smoking cessation and menopausal hot flashes. Carpal tunnel "may have little or no effect" against sham.
- **Sham versus no treatment.** Benefits are larger against no treatment than against sham, which points to substantial nonspecific (placebo-type) effects [13].
- **Safety [13].** Serious complications are uncommon. They come from nonsterile needles and poor technique: infection, punctured organs including collapsed lung, and nerve injury. The FDA requires needles to be sterile and labelled for single use.

**Self-acupressure points people actually use.** Point locations come from a University of Minnesota page [14] and a TCM clinic page [15]. Usual method: firm, comfortable pressure or slow circles for 30 seconds to 2 minutes. Avoid pressing over broken or inflamed skin [15].

| Point | Location | Common use | Evidence / caution |
|---|---|---|---|
| **LI4 Hegu** (Large Intestine 4) | Web between thumb and index finger. Press the thumb against the index finger; the point is at the highest part of the bulging muscle [14]. | Headache, facial and tooth pain; labour pain | A 2026 meta-analysis of 9 studies found LI4 acupressure reduced labour pain (MD −2.24 on pain scales) [17, F-API]. **Pregnancy caution:** classical texts list LI4 with SP6 (and CV4) as forbidden in pregnancy because they were used to hasten difficult labour [18, S]. Modern RCT data in healthy pregnancies have not shown serious harm, but strong stimulation can cause recordable uterine contractions [18, S]. Rule for the card: avoid strong LI4 or SP6 pressure while pregnant, except in labour with a midwife's agreement. |
| **PC6 Neiguan** (Pericardium 6) | Inner forearm, about 2 cun (about three finger-widths) above the wrist crease, between the two central tendons [15] | Nausea and vomiting (motion, post-surgery, pregnancy); the point used by "sea-band" wristbands | **Best evidence of any self-point.** The 2025 Cochrane update has 59 trials with 7,667 people [19]. Against sham, PC6 reduced nausea (RR 0.68), vomiting (RR 0.60) and rescue antiemetic use (RR 0.64), all at **low** certainty [19]. Against antiemetic drugs it showed no clear difference, at **moderate** certainty, so it is roughly comparable to the drugs [19]. Added to the drugs, it reduced vomiting (RR 0.56, very low certainty) [19]. Side effects were minor: skin irritation and blistering [19]. |
| **ST36 Zusanli** (Stomach 36) | Outer lower leg, about four finger-widths below the bottom of the kneecap and one finger-width out from the shinbone [15] | Digestion, fatigue ("leg three miles") | Tradition with weak evidence. Used with PC6 in digestive protocols [15]. |
| **GB20 Fengchi** (Gallbladder 20) | Base of the skull, about one finger-width out from the spine, in the hollow between the neck muscles. Slide outward along the skull edge until the fingers settle into a "small pool" [14] | Tension headache, neck stiffness | Tradition. Self-pressure is fine; needling is deep-risk (vertebral artery) and practitioner-only [18b, S]. |
| **Yintang** (EX-HN3) | Midline of the forehead, midway between the inner ends of the eyebrows [14] | Frontal headache, calming, sleep | Tradition. Gentle pressure only. |

Sources A4.1
1. F: https://en.wikipedia.org/wiki/Traditional_Chinese_medicine
2. F: https://en.wikipedia.org/wiki/Shanghan_Lun
3. F: https://en.wikipedia.org/wiki/Wuxing_(Chinese_philosophy)
4. F: https://acupuncturetoday.com/article/30030-the-meridian-clock-a-taoist-cosmological-imaging-system-part-one
5. S: search summary for "TCM organ clock ... evidence"; Marburg thesis https://open.uni-marburg.de/entities/thesis/03c755e3-3ff7-401d-920b-ff08a9390ae4 (fetch blocked by bot protection)
6. F-API: Rivera et al., *Pharmacotherapy* 2012, PMID 22392461, https://europepmc.org/article/MED/22392461
7. F-API: Zhang et al., *Toxicology Reports* 2015, PMID 28962463, https://europepmc.org/article/MED/28962463
8. F-API: Page & Lawrence, *Pharmacotherapy* 1999, PMID 10417036, https://europepmc.org/article/MED/10417036
9. F-API: Lo et al., *Eur J Drug Metab Pharmacokinet* 1995, PMID 7588995, https://europepmc.org/article/MED/7588995
10. F: https://en.wikipedia.org/wiki/Pinellia_ternata
11. F-API: Zou et al., *Heliyon* 2023, PMID 38058630, https://europepmc.org/article/MED/38058630
12. F: https://www.nccih.nih.gov/health/ephedra
13. F: https://www.nccih.nih.gov/health/acupuncture-what-you-need-to-know (with the general TCM page https://www.nccih.nih.gov/health/traditional-chinese-medicine-what-you-need-to-know, F)
14. F: https://www.takingcharge.csh.umn.edu/survivorship/frontal-headache-acupoints
15. F: https://pulsetcm.sg/bites/indigestion-acupressure-pc6-st36-cv12/
16. F-API: Uneda et al., *PLoS One* 2024, PMID 38165850, https://europepmc.org/article/MED/38165850
17. F-API: Deniz et al., *Explore* 2026, PMID 42208134, https://europepmc.org/article/MED/42208134
18. S: Chang et al. 2011, review of 28 classical texts, https://iam.biomedcentral.com/articles/10.1016/j.jams.2011.10.006 (redirected to a Springer login; not read), and POGP guidance PDF https://thepogp.co.uk/_userfiles/pages/files/gps_apr_prlb_pgp_07.pdf (search summary only). 18b. S: point-location search summary citing https://trialsjournal.biomedcentral.com/articles/10.1186/s13063-022-06532-1/tables/1 (redirect not followed).
19. F: Cochrane CD003281 (Lee et al., 2025 update), https://www.cochrane.org/CD003281

### A4.2 Ayurveda

**The three doshas.**

| Dosha | Elements (mahabhuta) | Qualities | Governs |
|---|---|---|---|
| **Vata** | Air + ether (space) | Dry, cold, light, subtle, mobile | All movement; pain marks imbalance |
| **Pitta** | Fire + water | Hot, sharp, liquid, slightly oily, sour; heat is the chief quality | Metabolism, digestion, bile |
| **Kapha** | Earth + water | Heavy, cold, soft, slow, unctuous | Structure, lubrication, nourishment |

All rows are from [1].

- **Prakriti** is a person's constitution, fixed at birth. **Vikriti** is the current imbalanced state [1].
- Each dosha has a subtle "healthy" counterpart: prana, tejas and ojas respectively [1].
- **Status:** doshas have no support from experimental science, and using them to diagnose disease is classed as pseudoscientific. Some Ayurvedic scholars treat tridosha as a heuristic framework [1]. That framing is the honest way to teach it.

**Dinacharya (daily routine).** Charaka's *Matrashitiya* chapter (Sutra Sthana 5) sets out the classical daily regimen [2]:
- **Tongue scraping.** The scraper is "curved without a sharp edge", made of gold, silver, copper, tin or brass. It is said to remove the coating at the tongue root that causes bad breath [2].
- **Tooth twigs** of astringent, pungent or bitter trees (karanja, arjuna and others), used twice a day [2].
- **Gandusha / kavala (oil holding or gargling).** Said to strengthen the jaws and voice and keep teeth firm. This is the classical basis for modern "oil pulling" [2].
- **Abhyanga (oil massage)** of head, ears, body and feet. Claimed to prevent headache and greying, relieve vata disorders and strengthen the skin [2].
- **Nasya** (nasal oil, anu taila), **anjana** (collyrium) and **dhumapana** (medicated smoke, contraindicated in pregnancy) [2].

**What the evidence shows for dinacharya.**
- **Oil pulling.**
  - A 2016 systematic review included 5 RCTs with 160 people. Evidence was limited but suggested short-term benefit for oral hygiene [3, S].
  - A 2023 meta-analysis found a probable benefit for gingival health, but chlorhexidine reduced plaque better. Certainty was **very low**: trials were small (20–90 people), lasted at most 30 days, and nearly all were at high risk of bias [3, S].
  - **Teach:** oil pulling is an add-on to brushing and flossing, not a replacement.
- **Tongue scraping.** A Cochrane review (2006) included 2 trials with 40 people. Neither reported its primary outcomes. One trial found volatile sulphur compounds fell by 42% with a tongue cleaner, 40% with a scraper and 33% with a toothbrush [4, F-API]. The review was later **withdrawn** (2016) [5, F-API]. Verdict: plausible and harmless, with only a weak evidence base.
- **Abhyanga.** Published work is mostly case reports and small trials. A 2026 RCT in 42 students found self-massage plus stretching beat stretching alone for hamstring flexibility over 4 weeks [6, F-API]. Treat it as safe self-care; beyond that, the evidence is unproven.

**Common herbs: additions to the existing cards.**
- **Ashwagandha (*Withania somnifera*).** The card already covers LiverTox's likelihood score "B" and cholestatic liver injury. Add:
  - **Denmark banned ashwagandha in food supplements in 2023.** The Danish Veterinary and Food Administration acted on a 2020 Technical University of Denmark (DTU) assessment. DTU could not set a safe intake level and flagged possible effects on thyroid and sex hormones [7, S].
  - Other EU states (Sweden, Finland and France are named) opened their own reviews [7, S].
  - Industry disputes the assessment. Its complaints: the assessment did not separate root from leaf, and the DTU report was not peer-reviewed [7, S].
  - Mark the ban "search-only" until the DVFA notice itself is fetched.
  - A 2026 scoping review found 13 publications covering 25 patients with ashwagandha-associated liver injury. Injury usually appeared after weeks of use, was mostly cholestatic or mixed, and was usually followed by recovery once the product was stopped [8, F-API].
- **Turmeric.** The card exists. Add the US Drug-Induced Liver Injury Network (DILIN) series of 10 cases, enrolled 2004–2022 [9, F-API]:
  - Injury was mostly hepatocellular, with a latency of 1–4 months. Five patients were hospitalised and one died of acute liver failure.
  - 3 of the 7 products tested also contained **piperine** (black pepper).
  - The injury showed a strong link to **HLA-B\*35:01** (allele frequency 0.45 versus about 0.06 in controls).
  - The authors suggest turmeric liver injury is rising, perhaps from greater use or from black-pepper combinations [9].
- **Guggul (*Commiphora mukul*).** A JAMA 2003 RCT gave guggulipid at 1,000 or 2,000 mg three times daily for 8 weeks. Instead of lowering LDL cholesterol, it **raised** it by 4–5%, a net change of +9–10% against placebo. Six participants on guggulipid developed a hypersensitivity rash [10, F-API].
- **Brahmi (*Bacopa monnieri*).** A 2026 network meta-analysis in healthy adults found Brahmi, particularly at high dose, improved some memory measures compared with Ginkgo and placebo. There were no head-to-head trials, which limits the strength of the result [11, F-API].
- **Shatavari (*Asparagus racemosus*).** Used as a female reproductive and lactation tonic. Recent reviews call it "promising" but say clinical trials and safety data are lacking. Pregnant and breastfeeding people are advised to consult a clinician first [12, F-API].
- **Tulsi and triphala.** Existing cards are sufficient. NCCIH's own Ayurveda evidence summary is thin and mostly small trials, for example turmeric in ulcerative colitis (n = 10 and n = 89) [13].

**Rasa shastra and heavy metals.** Rasa shastra is the Ayurvedic iatrochemical tradition that deliberately processes metals, minerals and gems (bhasmas) into medicines [15].
- **Saper et al., JAMA 2004 [14, F-API].**
  - 70 Ayurvedic herbal medicine products made in South Asia were bought in Boston-area stores in 2003.
  - **14 of 70 (20%) contained heavy metals:**
    - lead in 13 (median 40 µg/g, range 5–37,000);
    - mercury in 6 (median 20,225 µg/g, range 28–104,000);
    - arsenic in 6 (median 430 µg/g).
  - Taken at the labelled dose, every one of the 14 would give intakes above regulatory limits.
- **Saper et al., JAMA 2008 [15, F-API].**
  - 193 Ayurvedic medicines bought online in 2005 were analysed. **20.7%** contained detectable lead, mercury or arsenic.
  - US-made and Indian-made products were no different (21.7% vs 19.5%).
  - **Rasa shastra products contained metals far more often (40.6% vs 17.1%)**, with much higher median mercury (20,800 vs 34.5 µg/g).
  - 95% of the metal-containing products were sold by US websites, and 75% claimed Good Manufacturing Practice.
  - **All** of them exceeded at least one daily-intake standard.
- **Later data [13].** NCCIH cites a 2015 survey in which 40% of Ayurvedic-medicine users had elevated blood lead. In the same survey, about 1 in 4 supplements tested were high in lead and nearly half were high in mercury. NCCIH also cites a 2015 CDC *MMWR* lead-poisoning case linked to Ayurvedic preparations bought online.
- **US regulation.** There is "no significant regulation of Ayurvedic practice or education" in the US [13].
- **Harm-reduction line for the card:** a "GMP" or "Made in USA" label does not mean metal-free. Buy only products with a third-party heavy-metal certificate of analysis. Anyone who has taken a bhasma long term should ask for a blood lead test.

Sources A4.2
1. F: https://en.wikipedia.org/wiki/Dosha
2. F: https://www.carakasamhitaonline.com/index.php/Matrashiteeya_Adhyaya
3. S: search summary citing https://pubmed.ncbi.nlm.nih.gov/27261981/ (2016 systematic review) and https://www.nationalelfservice.net/dentistry/oral-health-other-health-conditions/oil-pulling-oral-health/ (commentary on the 2023 *Int Dent J* meta-analysis)
4. F-API: Outhouse et al., Cochrane 2006, CD005519.pub2, PMID 16625641, https://europepmc.org/article/MED/16625641
5. F-API: withdrawal notice CD005519.pub3, PMID 27227886, https://europepmc.org/article/MED/27227886
6. F-API: John et al., *Front Sports Act Living* 2026, PMID 42306132, https://europepmc.org/article/MED/42306132
7. S: search summary citing https://www.vitafoodsinsights.com/botanicals/incorrect-and-misleading-industry-defends-ashwagandha-root-extract-safety-amid-danish , https://esamskriti.com/sa/Ayurveda/Danish-ban-on-Ashwagandha-Truth,-evidence,-ethics,-and-regulations-1.aspx , https://www.nutraingredients.com/Article/2026/07/06/timeline-will-authorities-de-throne-the-king-of-herbs/
8. F-API: McIntyre et al., *Cureus* 2026, PMID 42367407, https://europepmc.org/article/MED/42367407
9. F-API: Halegoua-DeMarzio et al., *Am J Med* 2023, PMID 36252717, https://europepmc.org/article/MED/36252717
10. F-API: Szapary et al., *JAMA* 2003, PMID 12915429, https://europepmc.org/article/MED/12915429
11. F-API: Tiemtad et al., *Phytomedicine* 2026, PMID 41678913, https://europepmc.org/article/MED/41678913
12. F-API: Oyovwi et al., *Curr Nutr Rep* 2025, PMID 40974515, https://europepmc.org/article/MED/40974515
13. F: https://www.nccih.nih.gov/health/ayurvedic-medicine-in-depth
14. F-API: Saper et al., *JAMA* 2004;292:2868, PMID 15598918, https://europepmc.org/article/MED/15598918 (the pubmed.ncbi.nlm.nih.gov page was blocked by a cookie wall)
15. F-API: Saper et al., *JAMA* 2008;300:915, PMID 18728265, https://europepmc.org/article/MED/18728265

### A4.3 Unani (Unani Tibb)

- **What it is.** Unani is Greco-Arabic medicine. It is built on Hippocrates and Galen and expanded by al-Razi, Ibn Sina (Avicenna) and Ibn Rushd [1]. Its name means "Greek" [1].
- **History in South Asia.** It reached India by the 12th century [1].
- **Recognition today [1]:**
  - India: formal government recognition after 1947; 57 Unani colleges (2022) and an estimated 52,000 registered practitioners (2024).
  - Pakistan: up to 60,000 practitioners, regulated by the National Council for Tibb.
- **Scientific status.** Researchers regard it as pseudoscientific, and some traditional Unani drugs are known to be poisonous [1].

**Four humours and temperaments.** The humoral table, shared with Galenic medicine [2]:

| Humour | Element | Qualities | Season | Organ | Temperament |
|---|---|---|---|---|---|
| Blood (dam) | Air | Hot, moist | Spring | Liver | Sanguine (damvi) |
| Yellow bile (safra) | Fire | Hot, dry | Summer | Gallbladder | Choleric / bilious (safravi) |
| Black bile (sauda) | Earth | Cold, dry | Autumn | Spleen | Melancholic (saudawi) |
| Phlegm (balgham) | Water | Cold, moist | Winter | Brain / lungs | Phlegmatic (balghami) |

- **Galen's nine temperaments.** Galen counted nine: one balanced, four with a single dominant quality, and four mixed. The four mixed ones became the famous "four temperaments" [2]. Ibn Sina's *Canon* (1025) carried the system into Islamic medicine [2].
- **A caution on source quality.** One 2016 review mislabels the melancholic temperament as hot and moist in its table, though its own text implies cold and dry [3]. Check humoral tables against a second source before printing them.

**The six essential factors (asbab-e-sitta zarooriya)** [3]:
1. air and climate;
2. food and drink;
3. bodily movement and rest;
4. mental movement and rest (anger, joy, fear, grief);
5. sleep and wakefulness;
6. retention and evacuation.

These are regulated through regimen (tadbeer): diet suited to one's temperament, timing of water, exercise, sleep, and controlled evacuation (cupping, purging, sweating, bathing) [3]. Unani shares this "six non-naturals" lifestyle framework with Galenic medicine. It is the part of Unani that maps most easily onto modern lifestyle advice.

**Key remedies.**
- **Black seed (kalonji, habbat al-sauda, *Nigella sativa*).** The signature Unani and Prophetic-medicine remedy. A card already exists. New evidence: a 2025 umbrella meta-analysis of 7 meta-analyses found supplementation lowered CRP (ES −0.42) and TNF-α [4, F-API]. The size of any clinical benefit is still unclear.
- **Other staples** (rose, fennel, senna) are already listed on the wiki's Unani diagram.

Sources A4.3
1. F: https://en.wikipedia.org/wiki/Unani_medicine
2. F: https://en.wikipedia.org/wiki/Humorism
3. F: Rafieian-Kopaei et al., *J Clin Diagn Res* 2016, https://pmc.ncbi.nlm.nih.gov/articles/PMC5072067 (six factors also confirmed in a search summary [S] citing https://ayush.delhi.gov.in/ayush/unani, which refused the connection)
4. F-API: Lan & Xia, *Prostaglandins Other Lipid Mediat* 2025, PMID 39709091, https://europepmc.org/article/MED/39709091

### A4.4 Kampo (Japanese herbal medicine)

**What it is.**
- Kampo is Japan's adaptation of Chinese medicine. Chinese medicine reached Japan in the 6th–7th century [1].
- It was suppressed after the Meiji Restoration, when an 1883 law removed traditional practitioners' licences, and revived from the 1910s. The Japan Society for Oriental Medicine was founded in 1950 [1].
- **Its distinctive feature is fixed formulas in standardised proportions.** Most are dispensed as factory-made granule extracts, unlike TCM's individually adjusted decoctions [1].

**Licensed and insured.**
- Japan's Ministry of Health approved the first 4 Kampo medicines for National Health Insurance in 1967. Today **148 formula extracts**, 241 crude drugs and 5 crude-drug preparations are covered [1]. The 148-formula figure is confirmed independently as the set analysed in [5].
- A 2000 nationwide survey found **72% of registered physicians** prescribe Kampo [1].
- The *Shanghan Lun* is central to the classical school [1][2].

**Examples, with evidence.**
- **Kakkonto (Chinese: Ge Gen Tang)** is the standard early-cold formula, sold over the counter and by prescription. In an RCT of 340 adults started within 48 hours of the first cold symptoms, kakkonto (6 g/day) was **no better** than a Western multi-symptom cold medicine at preventing worsening (22.6% vs 25.0%; p = 0.66) [3, F-API]. Rare drug-induced pneumonitis has been reported, including a 2026 case after 4.5 months of self-dosing [4, F-API].
- **Yokukansan (TJ-54)** is used for agitation, irritability and night crying, and in Japan for behavioural and psychological symptoms of dementia (BPSD).
  - A 2016 meta-analysis of 5 RCTs (381 patients) found it reduced total BPSD scores (SMD −0.32) along with delusions, hallucinations and agitation. It did **not** help in the Alzheimer's-only subgroup, and it did not change cognition (MMSE) [6, F-API].
  - It did not prevent postoperative delirium (6 studies) [7, F-API].
  - Yokukansan contains licorice. It was the **second most common** Kampo cause of pseudoaldosteronism (ROR 8.1), and dementia itself was a strong risk factor (OR 7.0) [5].
  - **So the very patients it is marketed for are the highest-risk group:** check potassium and blood pressure.
- **Daikenchuto (TJ-100)** is a ginger, Japanese pepper (sansho) and ginseng formula used for bowel motility after abdominal surgery. A 2026 meta-analysis of 9 RCTs (1,158 patients) found it shortened time to first bowel movement by about 11 hours and hospital stay by about half a day. It did not reduce the incidence of postoperative ileus [8, F-API].

**Sho-saiko-to (Chinese: Xiao Chai Hu Tang) and interstitial pneumonitis.** This is the case history that teaches "a licensed, insured herbal formula can still kill".
- Sho-saiko-to was widely prescribed in Japan for chronic hepatitis.
- Case reports describe interstitial pneumonitis, including an autopsy-confirmed death in a woman who had taken it for 3 years for hepatitis C cirrhosis [9, F-API].
- Experimental work found sho-saiko-to **amplified interferon-induced lung neutrophil accumulation** and increased TNF-α output by monocytes [10, F-API]. This is the mechanism behind the rule **never combine sho-saiko-to with interferon** [10].
- A Japanese-language Toyama University paper reports that the Ministry's 1996 emergency safety notice disclosed **10 deaths** from sho-saiko-to-associated interstitial pneumonia [11, S].
- Product labelling advises against use in liver cancer and cirrhosis contexts [11, S].
- The 10-death figure is search-only; verify it against the original notice before printing.
- **Card rule:** stop at once and seek care for new dry cough, fever or breathlessness on any Kampo formula containing bupleurum (saiko) or scutellaria (ogon).

Sources A4.4
1. F: https://en.wikipedia.org/wiki/Kampo
2. F: https://en.wikipedia.org/wiki/Shanghan_Lun
3. F-API: Okabayashi et al., *Intern Med* 2014, PMID 24785885, https://europepmc.org/article/MED/24785885
4. F-API: Ooka et al., *Cureus* 2026, PMID 42437236, https://europepmc.org/article/MED/42437236
5. F-API: Uneda et al., *PLoS One* 2024, PMID 38165850, https://europepmc.org/article/MED/38165850
6. F-API: Matsunaga et al., *J Alzheimers Dis* 2016, PMID 27497482, https://europepmc.org/article/MED/27497482
7. F-API: Kotake et al., *Geriatr Nurs* 2023, PMID 37196515, https://europepmc.org/article/MED/37196515
8. F-API: Lech et al., *J Laparoendosc Adv Surg Tech A* 2026, PMID 41991345, https://europepmc.org/article/MED/41991345
9. F-API: Tomioka et al., *Nihon Kokyuki Gakkai Zasshi* 1999, PMID 10707545, https://europepmc.org/article/MED/10707545
10. F-API: Murakami et al., *Nihon Kyobu Shikkan Gakkai Zasshi* 1995, PMID 7540698, https://europepmc.org/article/MED/7540698
11. S: search summary citing https://toyama.repo.nii.ac.jp/record/2213/files/20000301.pdf and https://www.mskcc.org/cancer-care/integrative-medicine/herbs/sho-saiko (the MSKCC page returned HTTP 429 when fetched)

### A4.5 Tibetan medicine (Sowa Rigpa)

- **Origins and texts.** Sowa Rigpa developed in the 8th century under King Trisong Detsen. It rests on the *Four Tantras* (rGyud bzhi), whose 12th-century edition is still the basis. The four parts are the Root, Explanatory, Oral Instruction and Subsequent Tantras [1].
- **Recognition.** India officially recognised Sowa Rigpa in 2010 [1].
- **The three nyes-pa** ("faults" or humours) [1], each with five subtypes:
  - **rLung (wind):** movement of substances, energy and thought.
  - **mKhris-pa (bile):** heat and metabolism.
  - **Bad-kan (phlegm):** cold, digestion and the joints.
  - These sit close to Ayurveda's vata, pitta and kapha, which is useful to show on a layered table.
- **Diagnosis** relies on pulse, tongue and **urine** examination [1].
- **Medicines** are multi-ingredient pills of herbs, minerals, metals and animal products [1].

**Precious pills and mercury (tsotel / btso thal).**
- "Precious pills" (rinchen rilbu) contain **tsotel**, a mercury preparation "detoxified" through a long traditional process [2].
- **Sallon et al. 2017** is the only clinical study I found [2, F-API]:
  - Patients on tsotel-containing medicine took in about **130 µg Hg/kg/day**, against 30 µg/kg/day on other formulas. The US EPA chronic oral reference dose is 0.3 µg/kg/day.
  - Patients had taken mercury-containing medicine for a mean of 764 cumulative days.
  - The study found **no significant excess of 23 mercury-toxicity symptoms**, no neurological, cardiovascular or dental findings, and normal liver and kidney tests compared with healthy controls.
  - Urinary mercury was raised [2; urine value from a search summary, S].
  - The authors call it an initial cross-sectional study and ask for larger studies.
- **Product testing.** A separate study reported very high total mercury in Tibetan remedies, up to 12,000 µg/g and averaging about 5,600 µg/g [3, S].
- **Teach it straight.** The tradition holds that tsotel is "tamed" mercury, mostly mercury sulphide. Sulphide forms are far less absorbed than organic or vapour forms. Even so, exposures are hundreds of times the EPA reference dose, and the long-term human data are tiny.
  - Do not give precious pills to pregnant people or children.
  - Do not combine them with other mercury sources.
  - Anyone taking them regularly should have urine mercury checked.

Sources A4.5
1. F: https://en.wikipedia.org/wiki/Traditional_Tibetan_medicine
2. F-API: Sallon et al., *Exp Biol Med* 2017, PMID 27738246, https://europepmc.org/article/MED/27738246 (the search summary also linked https://www.ebm-journal.org/journals/experimental-biology-and-medicine/articles/10.1177/1535370216672748/full)
3. S: https://www.earthmagazine.org/article/mercury-roof-world/ (search summary of a 2018 *Environ Sci Technol* study)

### A4.6 Cross-cutting safety

**1. Aristolochic acid: the single most important herbal safety story.**
- **The Belgian slimming-clinic outbreak, 1990–92.** A manufacturing error replaced *Stephania tetrandra* (Chinese name *han fang ji*) with *Aristolochia fangchi* (*guang fang ji*) in weight-loss pills [1][2, F-API].
  - The result was "Chinese-herb nephropathy", a progressive scarring of the kidneys. Many women needed dialysis or a transplant [2].
  - The native kidneys and ureters were removed from 39 end-stage patients. **18 (46%) had urothelial carcinoma**, mostly of the ureter or renal pelvis [1].
  - Every tissue sample carried aristolochic-acid DNA adducts. Cumulative intake **above 200 g** raised the cancer risk [1].
- **The name-confusion trap.** In TCM practice, Aristolochia species are treated as interchangeable with certain other ingredients. They are sometimes mistaken for *Stephania*, *Akebia*, *Asarum*, *Clematis* and *Cocculus* [2]. The "fang ji", "mu tong" and "xi xin" name families are the danger zone.
- **Taiwan.** Taiwan has the **highest reported incidence of upper urinary tract cancer in the world** and a long history of Aristolochia remedy use [3, F-API].
  - In 151 patients, the TP53 mutation pattern was dominated by A:T→T:A transversions, which are otherwise rare. The same signature appears in Balkan endemic nephropathy [3].
  - Aristolactam-DNA adducts were found in the kidney cortex of 83% of patients with those mutations [3].
  - Conclusion: aristolochic acid "contributes significantly" to the country's upper urinary tract cancer [3].
- **Balkan endemic nephropathy** is thought to come from wheat flour contaminated with *Aristolochia clematitis* seed [4].
- **Regulation and carcinogen status.** The FDA issued a consumer alert in April 2001 [4]. Aristolochic acid is an IARC Group 1 carcinogen [4].
- **Card rule:** no product containing *Aristolochia*, *Asarum* or the "fang ji / mu tong" name families unless a lab certifies it free of aristolochic acid.

**2. Adulteration with pharmaceuticals.**
- Ernst's 2002 systematic review found 18 case reports, 2 case series and 4 analytical surveys of Chinese herbal medicines **spiked with prescription drugs**, including **corticosteroids**, with serious patient harm in several cases [5, F-API].
- One Taiwanese survey found **24% of samples** contained at least one conventional drug [5].
- NCCIH lists undeclared **warfarin** and **diclofenac** among the drugs found [6].
- Laboratories now screen "herbal" anti-hypertensives for 18 hidden blood-pressure drugs (diuretics, calcium blockers, ACE inhibitors) [7, F-API].
- **Teach this warning sign:** a "herbal" product that works dramatically and fast for pain, weight, sex or blood pressure may contain undeclared drugs.

**3. Contamination and substitution.** Undeclared plants or animal material, heavy metals (arsenic, lead, cadmium), pesticides and sulfites (an asthma and allergy trigger) have all been found in products. Mistakenly substituted herbs have caused organ damage [6]. The Ayurvedic and Tibetan metal data are in A4.2 and A4.5.

**4. Herb-drug interactions.** A systematic review found **more than 80 herbs** with clinically significant drug interactions. The "g" herbs (garlic, ginger, ginkgo, grapefruit) are among the most frequent [8, F-API]. The wiki's CYP450 diagram already covers the mechanism.

Eastern additions from this file:
- goji and dang gui with warfarin [A4.1];
- licorice with diuretics and the elderly (pseudoaldosteronism) [A4.4];
- sho-saiko-to with interferon [A4.4];
- turmeric with piperine and the HLA-B\*35:01 genotype (liver injury) [A4.2];
- ephedra with caffeine and heart disease [A4.1].

Sources A4.6
1. F-API: Nortier et al., *NEJM* 2000;342:1686, PMID 10841870, https://europepmc.org/article/MED/10841870
2. F-API: Nortier & Vanherweghem, *Toxicology* 2002, PMID 12505369, https://europepmc.org/article/MED/12505369
3. F-API: Chen et al., *PNAS* 2012, PMID 22493262, https://europepmc.org/article/MED/22493262
4. F: https://en.wikipedia.org/wiki/Aristolochic_acid
5. F-API: Ernst, *J Intern Med* 2002, PMID 12190885, https://europepmc.org/article/MED/12190885
6. F: https://www.nccih.nih.gov/health/traditional-chinese-medicine-what-you-need-to-know
7. F-API: Lu et al., *Food Addit Contam* 2010 (Europe PMC record; no PMID returned), found via the Europe PMC API title search
8. F-API: Ulbricht et al., *Curr Drug Metab* 2008, PMID 19075623, https://europepmc.org/article/MED/19075623

---



## A5. The enzyme / biochemistry layer: "why it works" (and why it interacts)

This is the layer our wiki already takes, and nobody in the witchy Pinterest space shows it (see
FORMAT_RESEARCH §3). The house articles to link from every card:

- `site/wiki/seed-articles/Cytochrome_P450_System_Inhibition_and_Induction.wiki`
- `Enzyme_Chemistry.wiki`
- `Monoamine_Oxidase_Inhibitors_and_Neurotransmitter_Systems.wiki`
- `Black_Pepper.wiki`
- `Allylbenzene_Metabolism.wiki`
- `Terpene_Map.wiki`

### Teaching card 1: the three ways a herb acts

1. **On a receptor.** Examples from facts.json:
   - Apigenin (chamomile) binds the benzodiazepine site of GABA-A weakly.
   - Gingerols (ginger) antagonise gut 5-HT3, which is the main proposed anti-nausea route.
   - Linalool (lavender) modulates GABA-A transmission and voltage-gated calcium channels.
2. **On an enzyme of the body's own chemistry.** Examples:
   - Gingerols and shogaols inhibit COX-2 and 5-LOX. This is the same pathway family as aspirin/NSAIDs.
   - Salicin (willow bark) is a prodrug of salicylic acid.
3. **On the enzymes that clear drugs (the interaction layer).** The CYP450 family and the P-glycoprotein pump.

### Teaching card 2: inducers vs inhibitors (the CYP450 crossroads; facts.json `diagram-cyp450-map`)

**Inducer → the drug is cleared faster → the drug FAILS.**
- St John's wort is the canonical inducer. NCCIH: it "is a potent inducer of both cytochrome P-450 enzymes and
  intestinal P-glycoprotein" [1].
- Documented clinically significant interactions [1]:
  - cyclosporine
  - indinavir
  - oral contraceptives
  - warfarin
  - digoxin
  - benzodiazepines
- Plus a serotonin-syndrome risk with some antidepressants [1].
- The mechanism (hyperforin as a PXR agonist driving CYP3A4 transcription) and its timing (days to weeks to
  build, and persisting after stopping) are set out in our wiki CYP450 article.

**Inhibitor → the drug piles up → TOXICITY.**
- **Grapefruit:** "Grapefruit juice can block the action of intestinal CYP3A4". Affected drugs include
  simvastatin, atorvastatin, nifedipine, cyclosporine, budesonide and amiodarone [2].
- **Grapefruit also blocks transporters,** which lowers absorption of fexofenadine. **The same food can raise
  one drug and lower another** [2].
- **Goldenseal** inhibits CYP2D6 and CYP3A4. A 2021 study found metformin levels dropped about 25% [1].
- **Piperine (black pepper)** is a mechanism-based inactivator of CYP3A4/2D6, per the wiki. It explains
  "with black pepper" turmeric formulas, and why they are an interaction risk.

**Other interactions to carry on the card cautions:**
- **Bleeding** (additive pharmacodynamics, not enzymes):
  - Ginkgo with warfarin is "associated with increased risk for major bleeding events" [1].
  - Ginger at more than 4 g/day, and chamomile, per facts.json.
- **Sedation stacking:** valerian, chamomile and lavender with alcohol, benzodiazepines or opioids
  (facts.json warnings).
- **Chamomile:** preliminary data suggest it may reduce oral-contraceptive effect, and there are reported
  warfarin interactions [1].

### Teaching card 3: prodrug vs active drug

The same inhibitor can be dangerous or merely useless, depending on the drug:
- If the drug is **active**, inhibiting its clearance raises its level, which risks toxicity.
- If the drug is a **prodrug** that needs a CYP to switch it on, inhibition means it never works. Examples:
  - Codeine → morphine via CYP2D6.
  - Clopidogrel via CYP2C19.

This is set out in the wiki article (section "The critical divergence: prodrugs vs. active drugs"). It is the
single most useful "why" line for a caution card.

### Teaching card 4: enzymes in the kitchen (facts.json `diagram-enzymes-in-the-kitchen`)

- Proteases: bromelain (pineapple), papain (papaya), actinidin (kiwi), zingibain (fresh ginger).
- Honey's glucose oxidase makes hydrogen peroxide, which is why medical honey dressings work.
- These make good, safe, "wow" posts for the top of the funnel.

**How to show it on a post:** a single Splendor-style or engraving-with-glow panel of the liver as a crossroads.
- Herbs enter at the left.
- CYP3A4, 2D6 and 1A2 are drawn as gates.
- Inducers are drawn as opening extra gates (in teal).
- Inhibitors are drawn as barring a gate (in terracotta).
- Drug-level arrows go up or down.

**Sources**
- [1] NCCIH, "Herb-Drug Interactions: What the Science Says" (fetched) https://www.nccih.nih.gov/health/providers/digest/herb-drug-interactions-science
- [2] FDA, "Grapefruit Juice and Some Drugs Don't Mix" (fetched) https://www.fda.gov/consumers/consumer-updates/grapefruit-juice-and-some-drugs-dont-mix
- House wiki: `site/wiki/seed-articles/Cytochrome_P450_System_Inhibition_and_Induction.wiki` (read in this
  session). Mechanism details there; check its own citations before printing numbers from it.
- facts.json in this folder: per-herb `enzyme_mechanism`, `dose` and `warnings`, each with a `source_ids`
  list (NCCIH, EMA, Cochrane, Culpeper).

## A6. Herbs, gemstones and gods: the existing set, gaps, and extensions

### What exists already (facts.json, built by the earlier research pass)

**27 herbs**, each with:
- Latin name
- traditions
- uses
- compounds
- enzyme/receptor mechanism
- an evidence grade
- dose
- warnings
- element/dosha
- a Culpeper/folk correspondence
- source IDs

The herbs: ginger, peppermint, chamomile, garlic, turmeric, honey, elderberry, echinacea, willow bark,
feverfew, valerian, lavender, St John's wort, cranberry, fennel, clove, aloe vera, Panax ginseng, ashwagandha,
tulsi, triphala/amla, licorice, astragalus, ginkgo, black seed, sage, fenugreek.

**14 gems**, each with:
- mineralogy (formula, Mohs)
- traditional correspondences
- history
- an evidence label (all are "tradition-only")
- practical safety (water, acids, dye)

The gems: amethyst, rose quartz, clear quartz, citrine, lapis, carnelian, turquoise, obsidian, moonstone,
malachite, garnet, jade, emerald, bloodstone.

**7 planets**, each with:
- metal
- Navaratna gem
- day
- four god-faces (Babylon / Egypt / Phoenicia / Hindu)
- Culpeper herbs

### Correction found this session

The chamomile entry's folk correspondence says "Moon (Culpeper, 'Camomile... under the dominion of the
Moon')". **That is wrong.**
- In Culpeper's text (Gutenberg #49513), the CAMOMILE entry has no "Government" line.
- The "under the dominion of the Moon" sentence belongs to the next entry, WATER-CALTROPS.
- Culpeper's only planetary remark on camomile is "Nechessor saith, the Egyptians dedicated it to the Sun".
- The planets table (Sun) is correct.

**Verified in the same text:**
- Lavender: "Mercury owns the herb".
- Dill: "Mercury has the dominion of this plant".
- Fennel: "an herb of Mercury, and under Virgo".
- Garden Valerian: "under the influence of Mercury".

### Gap 1: missing sleep/anxiety staples

The herb grid formats ("6 herbs for sleep", "for anxiety") need these. NCCIH has fact sheets for all of them
(URLs checked live, HTTP 200):
- passionflower https://www.nccih.nih.gov/health/passionflower
- kava https://www.nccih.nih.gov/health/kava (needs a liver-injury caution)
- hawthorn https://www.nccih.nih.gov/health/hawthorn
- milk thistle https://www.nccih.nih.gov/health/milk-thistle
- goldenseal https://www.nccih.nih.gov/health/goldenseal (the CYP inhibitor example)
- green tea https://www.nccih.nih.gov/health/green-tea
- rhodiola https://www.nccih.nih.gov/health/rhodiola
- black cohosh https://www.nccih.nih.gov/health/black-cohosh
- saw palmetto https://www.nccih.nih.gov/health/saw-palmetto
- cinnamon https://www.nccih.nih.gov/health/cinnamon
- butterbur https://www.nccih.nih.gov/health/butterbur (needs the hepatotoxic PA caution)
- bitter orange https://www.nccih.nih.gov/health/bitter-orange (stimulant caution)
- yohimbe https://www.nccih.nih.gov/health/yohimbe
- kratom https://www.nccih.nih.gov/health/kratom
- thunder god vine https://www.nccih.nih.gov/health/thunder-god-vine

**No NCCIH sheet** (checked, HTTP 404):
- rosemary
- lemon balm
- bacopa

These need EMA or other monograph sources.

### Gap 2: Eastern-system herbs for the TCM/Ayurveda/Kampo cards

These are listed with sources in section A4 of this file: dang gui, goji, ephedra/ma huang (FDA ban),
brahmi/bacopa, shatavari, guggul, yokukansan components and so on.

### Gap 3: herbs that witchy pins list with no warning

These need a "do not" card. Seen on real pins (FORMAT_RESEARCH §2.2):
- **Pennyroyal:** listed as "peace at home" on `herbsmagical`.
  - NIH LiverTox says pennyroyal oil taken by mouth "is highly toxic". It has been linked to toxic liver injury
    and death (acute hepatic necrosis, likelihood score B).
  - Pulegone is converted by CYP1A2 and 2E1 to hepatotoxins (menthofuran) and depletes glutathione.
  - N-acetylcysteine is considered appropriate treatment.
  - Source [S, search summary of the entry]: https://www.ncbi.nlm.nih.gov/books/NBK548673/
  - This is also the textbook example of **CYP *bioactivation*** (an enzyme making a herb more toxic), which
    gives the A5 cards a fourth mode.
- **Raspberry leaf:** a "uterine tonic" on `womb`, with no pregnancy caution.

A "the herbs Pinterest gets dangerously wrong" series is a strong, honest, in-scope harm-reduction format.

### Gems

The 14 cover the common Pinterest crystal set. The Navaratna stones that are **not yet carded:**
- ruby
- pearl
- red coral
- yellow sapphire
- diamond
- blue sapphire
- hessonite
- cat's-eye

They are needed for the planet plates (the pantheon v3 uses the Navaratna). Emerald is already carded.

### Gods

The pantheon is set in `.local/BOTANICA_PANTHEON_PICKS.md` (v2 venues, v3 planet layer: Sun = Shamash/Ra/
Shapash/Surya … Mercury = Nabu/Thoth/Taautos/Budha, and so on).

**Posts need per-god text.** Name, culture, planet/metal/gem, herbs, and 1 line of myth with a primary-source
citation. Use ETCSL for Sumerian, as already done for Inanna/lapis.

Only Mercury has been rendered so far. The art-style research recommends:
- Egyptian register-band charts for the Black Land patrons.
- Ishtar-Gate lapis-on-black for the Babylon faces.
- Pichwai/Kalamkari for the Navagraha.


## A7. How it all goes together: the correspondence systems

**The one-paragraph frame for learners.** Every pre-modern medicine organised the world into a small set of categories and hung everything on them. The categories were seven planets, four or five elements, three doshas or four humours. Herbs, metals, stones, organs, days, colours and gods were all filed under them. These are **memory and reasoning systems** (tradition). They are not measurements. They overlap because they share ancestors, notably Hellenistic astrology, which travelled east into India and west into Islamic and European medicine. They also **disagree**, sometimes sharply, and the disagreements are themselves good teaching material. Herb chemistry and safety belong on the herb cards; this section explains the grammar.

### A7.1 The Chaldean order, planetary days and planetary hours

- **The Chaldean order** ranks the seven classical planets from slowest to fastest across the sky: **Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon** [1].
- Despite the name, the sequence seems to be a **Hellenistic** innovation of about the 2nd century BCE, not Babylonian. The label "Chaldean" is modern [1].

**How the hours are computed [1]:**
1. Take the actual times of local **sunrise** and **sunset**.
2. Divide daylight (sunrise to sunset) into **12 equal "hours"**. Divide night (sunset to the next sunrise) into another 12.
3. These hours are **unequal**: long day-hours and short night-hours in summer, the reverse in winter. They match clock hours only at the equinoxes or near the equator.
4. The first hour after sunrise belongs to the **day's ruler**. Each later hour goes to the next planet in Chaldean order, wrapping from Moon back to Saturn.

**Why the weekdays fall in their order.**
- A day has 24 hours, and 24 = 3×7 + 3. So the first hour of each new day lands **three places further along** the Chaldean order [1].
- That gives Sun → Moon → Mars → Mercury → Jupiter → Venus → Saturn: Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday [1].
- Drawn on a circle, this is the **heptagram**, the seven-pointed star (worked example).
- Vettius Valens and Cassius Dio both explain the scheme, as does Chaucer's *Treatise on the Astrolabe* [1].
- Valens counted the day from sunset, as the Greeks and Babylonians did [1].
- The 16th-century *Key of Solomon* assigns kinds of work to each planet's days and hours [1].

**Worked example (my own arithmetic).**
- Take a summer Sunday with sunrise at 05:00 and sunset at 21:00.
  - Daylight is 16 h = 960 min, so each day-hour is **80 min**.
  - Night is 8 h = 480 min, so each night-hour is **40 min**.
- Day-hours run:
  - Hour 1, 05:00–06:20: Sun.
  - Hour 2: Venus. Hour 3: Mercury. Hour 4: Moon. Hour 5: Saturn. Hour 6: Jupiter. Hour 7: Mars.
  - Hour 8: Sun again, and so on.
- Hour 25 is the first hour of Monday, and it falls to the **Moon**, as it should.
- **Teaching tip:** have learners compute their own town's hours from the sunrise and sunset tables for the day. The arithmetic teaches the system better than a printed chart.

Sources A7.1
1. F: https://en.wikipedia.org/wiki/Planetary_hours

### A7.2 Agrippa, *Three Books of Occult Philosophy* (1531–33): the scales of the planets

Agrippa is the Renaissance master index. He gives two complementary kinds of table.

**(a) Book I, chapters 23–29: "what things are under" each planet.** Each chapter lists humours, tastes, metals, stones, plants and animals for one planet. Stones and selected plants, quoted closely from the Peterson edition [1]:

| Planet | Metals | Stones (Book I) | Selected plants (Book I) |
|---|---|---|---|
| Sun | Gold | Aetites, "eye of the Sun", carbuncle-type stones, topaz, chrysoprase, **ruby** (*Rubine*), balas, heliotrope (bloodstone) | Marigold, peony, celandine, balm, ginger, gentian, dittany, vervain, bay |
| Moon | Silver | Crystal, silver marcasite, all white and green stones, selenite, **pearls** | (lunar plants listed in the chapter) |
| Saturn | Lead, gold (for weight), golden marcasite | Onyx, ziazaa, camonius, **sapphire**, brown jasper, chalcedony, loadstone, "all dark, weighty, earthy things" | Daffodil, dragonwort, rue, cumin, hellebore, benzoin tree, mandrake, opium |
| Jupiter | Tin, silver, gold | Hyacinth, beryl, **sapphire**, emerald, green jasper, "airy colours" | Sea-green, **garden basil**, bugloss, mace, spikenard, mints, mastic, elecampane, violet, darnel, henbane, poplar |
| Mars | Iron, red brass | **Diamond**, loadstone, bloodstone, jasper, **amethyst** | Hellebore, **garlic**, euphorbium, radish, laurel, wolfsbane, scammony, "all such as are poisonous" |
| Venus | Silver, brass (yellow and red) | Beryl, chrysolite, emerald, sapphire, green jasper, carnelian, aetites, lapis lazuli, **coral** | Vervain, violet, maidenhair, **valerian** ("by the Arabian called Phu"), **thyme** |
| Mercury | Quicksilver, tin, silver marcasite | **Emerald**, agate, red marble, topaz, multicoloured and artificial stones (glass) | Hazel, cinquefoil, herb mercury, fumitory, pimpernel |

**(b) Book II, chapter 10: the "Scale of the Number Seven".** This is the cleanest single grid in Western magic. It lays the seven planets out in Chaldean order through every "world" [2]:

| Planet | Angel | Bird | Fish | Animal | **Metal** | **Stone** | Member | Head-opening |
|---|---|---|---|---|---|---|---|---|
| Saturn | Zaphkiel | Lapwing | Cuttlefish | Mole | Lead | **Onyx** | Right foot | Right ear |
| Jupiter | Zadkiel | Eagle | Dolphin | Hart | Tin | **Sapphire** | Head | Left ear |
| Mars | Camael | Vulture | Pike | Wolf | Iron | **Diamond** | Right hand | Right nostril |
| Sun | Raphael | Swan | Sea-calf | Lion | Gold | **Carbuncle** | Heart | Right eye |
| Venus | Haniel | Dove | Thymallus | Goat | Copper | **Emerald** | Genitals | Left nostril |
| Mercury | Michael | Stork | Mullet | Ape | Quicksilver | **Agate** (*achates*) | Left hand | Mouth |
| Moon | Gabriel | Owl | Sea-cat | Cat | Silver | **Crystal** | Left foot | Left eye |

All rows are from [2]. The column alignment is my reading of the scale's printed layout.

**(c) Book II, chapter 22: the "tables of the planets".** These are magic squares [3]:
- Saturn 3×3 (every line sums to 15, total 45);
- Jupiter 4×4;
- Mars 5×5 (the text has a typo, "square of four containing twenty five");
- Sun 6×6;
- Venus 7×7;
- Mercury 8×8;
- Moon 9×9.

Each square is engraved on its planet's metal "with a fortunate" planet: Saturn's on lead, Mars's on red brass, and so on [3]. Here number, metal and planet come together in a single object.

Sources A7.2
1. F (downloaded with curl and read): Agrippa, *Of Occult Philosophy* Book I part 2, J. H. Peterson digital edition, http://www.esotericarchives.com/agrippa/agripp1b.htm
2. F (curl): Book II, http://www.esotericarchives.com/agrippa/agrippa2.htm (Chapter x, "The Scale of the Number seven")
3. F (curl): Book II part 2, http://www.esotericarchives.com/agrippa/agripp2b.htm (Chap. xxii)

### A7.3 Culpeper's astrological botany (1652–53)

- **Who.** Nicholas Culpeper (1616–1654) wrote *The English Physitian* (1652), later known as the *Complete Herbal*. He wrote it in plain English and sold it cheaply, in open defiance of the College of Physicians [1].
- **Method.** He combined Galenic humoral theory with astrology [1]. More than 90% of his botanical entries come from Parkinson's *Theatrum Botanicum* (1640) [1].
- **His own instructions for using the book** [2]:
  1. Find which planet causes the disease. For this he refers readers to his *Astrological Judgment of Diseases*.
  2. Find which part of the body is afflicted.
  3. Find which planet governs that part.
  4. Treat either **by antipathy**, with herbs of the *opposite* planet, or **by sympathy**, where "every planet cures his own disease".
     - The antipathy pairs are: Jupiter against Mercury; the Luminaries against Saturn; Mars against Venus.
     - For sympathy, Sun and Moon herbs cure the eyes, Saturn's the spleen, Jupiter's the liver, Mars's the gall, and Venus's the organs of generation [2].

**Verification of facts.json's Culpeper herbs** against the Gutenberg text, which I downloaded and read [2]. Each entry's "Government and virtues" line names the ruler:
- **Sun.** St John's wort ("under the celestial sign Leo, and the dominion of the Sun"). Marigold/calendula ("an herb of the Sun, and under Leo"). Rosemary ("The Sun claims privilege in it").
  - **Chamomile: correction needed.** Culpeper gives no ruler of his own. He reports only that "the Egyptians dedicated it to the Sun". Mark chamomile = Sun as *reported tradition* on the card.
- **Moon.** Willow ("The Moon owns it"), chickweed, cucumber and poppy ("The herb is Lunar"). Culpeper also notes that opium is made from poppy juice.
- **Mercury.** Fennel ("an herb of Mercury, and under Virgo"), lavender ("Mercury owns the herb"), dill, and garden valerian.
- **Venus.** Damask rose. Culpeper splits roses by colour: red under Jupiter, damask under Venus, white under the Moon. Also yarrow ("under the influence of Venus"), thyme ("a notable herb of Venus") and elder.
- **Mars.** Garlic ("Mars owns this herb"), nettle, wormwood ("an herb of Mars, and if Pontanus say otherwise, he is beside the bridge") and basil ("an herb of Mars, and under the Scorpion").
- **Jupiter.** Sage ("Jupiter claims this"), dandelion, borage ("herbs of Jupiter and under Leo") and agrimony.
- **Saturn.** Comfrey ("an herb of Saturn"), horsetail, elm ("a cold and saturnine plant") and Solomon's seal ("Saturn owns the plant").

Every planet assignment in facts.json is confirmed except chamomile, which needs the label change above.

Sources A7.3
1. F: https://en.wikipedia.org/wiki/Nicholas_Culpeper
2. F (downloaded with curl and searched): *Culpeper's Complete Herbal*, Project Gutenberg #49513, https://www.gutenberg.org/cache/epub/49513/pg49513.txt (the "Instructions for the right use of the book" are dated 5 September 1653)

### A7.4 Paracelsus and the doctrine of signatures

- **The idea.** A plant's shape, colour or habit reveals what it treats [1].
- **History.** It is traced to Hippocratic writers and Dioscorides, and developed by **Paracelsus** and Giambattista della Porta. Jakob Böhme's *Signatura Rerum* (1621) popularised the term [1].
- **The theology.** William Coles held that God marked herbs so people could know their uses [1]. Culpeper's preface makes the same argument through Adam naming each creature "according to its nature" [A7.3, 2].
- **Classic examples [1]:**
  - walnut for the brain;
  - lungwort (spotted leaves) for the lungs;
  - eyebright for the eyes;
  - **birthwort (*Aristolochia*)**, womb-shaped, for childbirth.
- **The critique [1].** Resemblances are usually assigned after the fact, and there is no historical evidence that shape led to discovery. Birthwort shows the danger: it contains aristolochic acid, the kidney toxin and carcinogen in A4.6. **That one example is the best single argument in the library for testing claims rather than reading signs.** A few signature plants happen to hold real active compounds, for example anti-inflammatory compounds in figwort [1].

Sources A7.4
1. F: https://en.wikipedia.org/wiki/Doctrine_of_signatures

### A7.5 TCM five-phase correspondence (summary for the combined system)

The full table is in A4.1 [3 there]. The fact that matters for A7: **the five phases are named after the five visible planets** [A4.1, 3]:
- Jupiter = Wood (the "wood star");
- Mars = Fire;
- Saturn = Earth;
- Venus = Metal;
- Mercury = Water.

The Sun and Moon have no phase. They sit outside the five, as the great yang and yin luminaries; that framing is mine, and the source gives only the five planets. So the only legitimate "TCM column" in a planetary master table holds five entries and two blanks. Do not invent phases for the luminaries.

**The deepest disagreement in the whole library is a mechanical one.** TCM *metal* is Venus and Western Venus's *metal* is copper. The Chinese phase "Metal" is not the alchemical metal of any planet; it belongs to autumn, the lungs and the colour white. On the master table, label the column "TCM phase" and never "TCM metal".

### A7.6 Ayurveda: dosha, element and taste (rasa)

Charaka's six tastes, each made of two elements and each raising or lowering particular doshas [1]:

| Rasa (taste) | Elements (Charaka) | Increases | Decreases | Potency (virya) |
|---|---|---|---|---|
| Madhura (sweet) | Water + earth | Kapha | Vata, pitta | Cold |
| Amla (sour) | Earth + fire | Pitta, kapha | Vata | Hot |
| Lavana (salty) | Water + fire | Pitta, kapha | Vata | Hot |
| Katu (pungent) | Air + fire | Vata, pitta | Kapha | Hot |
| Tikta (bitter) | Air + space | Vata | Pitta, kapha | Cold |
| Kashaya (astringent) | Air + earth | Vata | Pitta, kapha | Cold |

All rows are from [1].

- The table follows Charaka. Sushruta and other authors assign some elements differently [1].
- **How a herb card uses this.** Ginger is pungent and hot, so it reduces kapha and can aggravate pitta in excess. Amla is sour but cooling by tradition, which shows why taste and potency are separate fields on the card.
- **The bridge to TCM.** Both systems classify taste: TCM has five flavours, Ayurveda six rasas. They roughly agree on sweet, sour, salty, bitter and pungent. Ayurveda adds astringent. TCM ties each flavour to a phase and organ (sour to Wood and liver); Ayurveda ties it to an element pair and dosha.
- Neither system assigns tastes to planets. Only Agrippa's Western scheme puts tastes under planets, for example sour, tart and "dead" under Saturn and sweet under Jupiter [A7.2, 1].

Sources A7.6
1. F: https://www.carakasamhitaonline.com/index.php/Rasa

### A7.7 Jyotish Navaratna: gem, planet, finger, setting

**The nine gems.** Sanskrit names are given with each [1]:
- Ruby (manikya): Sun
- Pearl (mukta): Moon
- Red coral (vidruma): Mars
- Emerald (marakata): Mercury
- Yellow sapphire (pushparaga): Jupiter
- Diamond (vajra): Venus
- Blue sapphire (nila): Saturn
- Hessonite (gomeda): Rahu
- Cat's eye (vaidurya): Ketu

**The classical Navaratna setting [1].** The **ruby sits in the centre for the Sun**. Clockwise from the top, the others are diamond, pearl, red coral, hessonite, blue sapphire, cat's eye, yellow sapphire and emerald. Traditionally only a ruby or red spinel may go in the centre.

**Textual sources** cited for the gem verse [1]:
- *Brihat Jataka*;
- *Mani-mala* (S. M. Tagore 1879);
- *Jataka Parijata*;
- *Garuda Purana* ch. 68, on gem purity;
- *Agni Purana* ch. 246.

**Finger, setting metal and day.** These come from current jeweller and astrologer practice, **not** from the classical verse [2]:

| Gem | Planet | Finger | Setting metal (modern practice) | Day |
|---|---|---|---|---|
| Ruby | Sun | Ring | Gold | Sunday morning |
| Pearl | Moon | Little or ring | Silver | Monday morning |
| Red coral | Mars | Ring | Gold or copper | Tuesday morning |
| Emerald | Mercury | Little | Gold | Wednesday morning |
| Yellow sapphire | Jupiter | Index | Gold | Thursday morning |
| Diamond | Venus | Middle or ring | Platinum or white gold | Friday morning |
| Blue sapphire | Saturn | Middle | Silver or gold | Saturday evening |
| Hessonite | Rahu | Middle | Silver | Saturday evening |
| Cat's eye | Ketu | Little or ring | Silver or gold | Thursday or Saturday |

All rows are from [2].

- Sellers disagree. One guide even puts yellow sapphire on the little finger on a Wednesday [3, S].
- **Note the metal clash.** The planetary *metal* in the Western and alchemical scheme is lead for Saturn and tin for Jupiter. The *setting* metal in Jyotish practice is gold, silver or platinum. The two "metal" fields mean different things, and facts.json uses the planetary metal.

Sources A7.7
1. F: https://en.wikipedia.org/wiki/Navaratna
2. F: https://www.grahaguru.in/learn/gemstone-101/navratna-9-gemstones-guide (a commercial astrology site, used only as evidence of current practice)
3. S: search summary of jeweller blogs, e.g. https://astrotalk.com/astrology-blog/gemstone-navratnas-wearing-method/

### A7.8 The Golden Dawn and Crowley's *777*

- **What it is.** *Liber 777* was published anonymously by Aleister Crowley in 1909. He reportedly wrote it from memory in about a week, largely from a Golden Dawn manuscript that initiates had to memorise [1].
- **Structure.** Its rows are the **32 paths of the Kabbalistic Tree of Life**: 10 sephiroth plus 22 connecting paths keyed to the Hebrew letters. Its columns cover colours, gods, stones, perfumes, plants, tarot and more [1]. A revised edition (1955) added compact tables for the elements, signs and planets [1].
- **How it is used** (the source's example): to evoke Venus, read down the Venus row for the colour of the robe and the incense [1].

**Planet rows** (the planetary Hebrew letters and their sephiroth) [2]:

| Planet | Path (letter) | Stones | Perfume | Egyptian god | Sephirah: stones |
|---|---|---|---|---|---|
| Mercury | 12 Beth | Opal, agate | Mastic, white sandal, mace, storax | Thoth (and Cynocephalus) | Hod: opal, especially fire opal |
| Moon | 13 Gimel | Moonstone, pearl, crystal | Camphor, aloes | Chomse (Khonsu) | Yesod: quartz |
| Venus | 14 Daleth | Emerald, turquoise | Sandalwood, myrtle | **Hathor** | Netzach: emerald |
| Jupiter | 21 Kaph | Amethyst, lapis lazuli | Saffron | Amoun-Ra | Chesed: amethyst, sapphire |
| Mars | 27 Peh | Ruby, any red stone | Pepper, dragon's blood | Horus | Geburah: ruby |
| Sun | 30 Resh | Chrysolith | Olibanum, cinnamon | Ra | Tiphareth: topaz, yellow diamond |
| Saturn | 32 Tav | Onyx | Asafoetida, scammony, sulphur | Sebek, Mako | Binah: star sapphire, pearl |

- **Caveat.** The fetched page lists paths and sephiroth but not their planets. The letter-to-planet pairing above (Beth = Mercury and so on) is the standard Golden Dawn attribution, supplied by me and not confirmed by a fetched source; mark it as a gap.
- Hermetic Qabalah sources do confirm Hod = Mercury and Chesed = Jupiter [3].
- **The useful convergence with facts.json.** *777*'s Egyptian column gives **Hathor for Venus, Khonsu for the Moon, Thoth for Mercury and Ra for the Sun**, matching facts.json exactly. It **diverges** on Jupiter (Amoun-Ra against facts.json's "Horus Who Bounds the Two Lands") and Saturn (Sebek against "Horus Bull of the Sky").
- **The two Egyptian lists are different kinds of thing.** The facts.json names are the ancient Egyptian *astronomical* names of the planets, which treat the outer planets as forms of Horus:
  - Mars: Her Desher, "Red Horus";
  - Jupiter: Heru-up-shta-taui;
  - Saturn: Heru-ka-pet;
  - Mercury: Sebegu;
  - Venus: Bennu [4].

  The *777* names are 19th–20th-century *cult-god* assignments. Label them separately. Note also that an 1858 source says most Egyptian planet names were not transmitted to us [5, S]. Jupiter's "bounds the Two Lands" translation was not confirmed in my search [5, S].

Sources A7.8
1. F: https://en.wikipedia.org/wiki/Liber_777
2. F: https://www.globalspiritualstudies.com/liber-777-correspondences/
3. F: https://en.wikipedia.org/wiki/Hermetic_Qabalah
4. F: https://satyori.com/archaeoastronomy/mars-across-civilizations/
5. S: search summary citing https://geology.19thcenturyscience.org/books/1858-Humboldt-Cosmos/Vol-IV/PDFpages/1858-Humboldt-Cosmos-IV-0092.pdf and https://astrobites.org/2024/04/12/saturn-history/

### A7.9 An honest note: the systems disagree

Show learners these side by side. Each is a documented clash, not an error in our tables.

1. **Planetary gems: Western and Jyotish.**

| Planet | Jyotish Navaratna [A7.7] | Agrippa, Scale of Seven [A7.2] | *777* path stone [A7.8] | Brewer (1895) [1] | Lilly, *Christian Astrology* 1647 [2] |
|---|---|---|---|---|---|
| Sun | Ruby | Carbuncle | Chrysolith | Diamond | Hyacinth, chrysolite, carbuncle, ruby |
| Moon | Pearl | Crystal | Moonstone, pearl, crystal | Crystal | Selenite, crystals |
| Mercury | Emerald | Agate | Opal, agate | Loadstone | Agate, topaz |
| Venus | **Diamond** | Emerald | Emerald, turquoise | Amethyst | Cornelian, sky sapphire, coral, lapis, beryl |
| Mars | **Red coral** | **Diamond** | Ruby | Emerald | Adamant, loadstone, bloodstone, jasper, amethyst |
| Jupiter | Yellow sapphire | Sapphire | Amethyst, lapis | Cornelian | Amethyst, sapphire, emerald, hyacinth, topaz |
| Saturn | Blue sapphire | Onyx | Onyx | Turquoise | Sapphire, lapis lazuli |

   - The **diamond moves**: Venus in Jyotish, Mars in Agrippa (and Lilly's "adamant"), the Sun in Brewer.
   - **Emerald** belongs to Mercury in Jyotish, Venus in Agrippa and *777*, and Mars in Brewer.
   - The Moon (pearl or crystal) and Saturn (dark stones: sapphire or onyx) are the most stable rows.
   - **Coral**: Jyotish gives it to Mars, but Agrippa and Lilly put it under **Venus**.
2. **Herb rulers: Agrippa and Culpeper.**
   - **Valerian** is under Venus in Agrippa ("which by the Arabian is called Phu") but under Mercury in Culpeper.
   - **Garden basil** is under Jupiter in Agrippa but under Mars in Culpeper ("under the Scorpion").
   - Both agree on garlic (Mars) and thyme (Venus) [A7.2, 1; A7.3, 2].
3. **Body parts.**
   - Agrippa's scale gives the **right eye to the Sun and the left eye to the Moon** [A7.2, 2].
   - The *Sefer Yetzirah* tradition, as summarised on Wikipedia, puts the **right eye under Saturn and the left eye under Jupiter** [3].
   - Culpeper's sympathy rule gives the eyes to both luminaries together [A7.3, 2].
4. **Angels.** Agrippa sets **Raphael at the Sun and Michael at Mercury** [A7.2, 2]. Hermetic Qabalah sources likewise place Michael at Hod, Mercury's sephirah [A7.8, 3]. Many later popular lists swap these two. That last claim comes from general knowledge, not a fetched source, so flag it if it goes on a card.
5. **What the "metal" field means.** It is the alchemical planetary metal in Agrippa and facts.json, the ring-setting metal in Jyotish practice, and a seasonal phase (autumn, lungs) in TCM [A7.5, A7.7].
6. **What an "element" is.**
   - Western: 4 elements (fire, air, water, earth).
   - Ayurveda: 5 (adding space/ether).
   - TCM: 5 *phases* (wood and metal instead of air and ether).
   - Humoral blood is air (Western [A4.3, 2]). Kapha is earth plus water (Ayurveda [A4.2, 1]).
   - These cannot be merged one-to-one.

**The teaching line:** the correspondences are traditions that grew up alongside one another, not one hidden truth. A learner who notices that the diamond belongs to Venus in India and to Mars in Renaissance Europe has understood the most important thing about them.

Sources A7.9
1. F: https://words.fromoldbooks.org/Brewer-DictionaryOfPhraseAndFable/p/precious-stones.html
2. F: https://skyscript.co.uk/lilmet.html
3. F: https://en.wikipedia.org/wiki/Sefer_Yetzirah

### A7.10 How to teach it clearly

**Recommended diagram types.**
1. **The heptagram wheel.** This is the best single image for days and hours.
   - Place the seven planets around a circle in Chaldean order (Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon).
   - Following the circle gives the order of the **hours**. Following the seven-pointed star (every third planet) gives the order of the **days** [A7.1].
   - Put the metal and day glyph at each node.
2. **The five-phase wheel and star.** Show the generating cycle as the outer circle and the controlling cycle as the inner pentagram [A4.1]. Print the organ pair, season, colour, taste and *planet* at each node, so learners see TCM's own planetary root.
3. **A grid (planet × attribute).** This is the master table below. It suits cards and lookup, and should always carry an "evidence: tradition" column.
4. **A layered or comparison table.** One row per planet, one column per *tradition* (as in A7.9). This is the honest view: it shows agreement where the colours line up and disagreement where they clash.
5. **A three-system bridge.** Three parallel columns compare the humours (4), the doshas (3) and the Tibetan nyes-pa (3), with qualities (hot/cold, wet/dry, light/heavy) as the connecting rows. Use it to show the shared Galenic and Indic logic of quality-based medicine without claiming they are identical.

**Design rules.**
- Use colour to encode the *tradition*, not the planet. That makes disagreements visible.
- Footnote every cell to its source tradition.
- Keep herb **chemistry and safety** off the correspondence diagram and link to the herb card instead.

**Master table: the seven classical planets.** This table is consistent with facts.json, and **every link in it is tradition**. "Western gem" uses Agrippa's Scale of Seven (1533) as the single named Western source; see A7.9 for alternatives. The "TCM phase" column holds the only attested mappings, and the luminaries have none. Herbs are Culpeper's rulers as listed in facts.json, with the chamomile correction.

| Planet | Day | Metal | Western gem (Agrippa) | Navaratna gem | TCM phase | Culpeper herbs | Egyptian | Phoenician | Babylonian | Hindu (Navagraha) |
|---|---|---|---|---|---|---|---|---|---|---|
| Sun | Sunday | Gold | Carbuncle | Ruby | none (luminary) | St John's wort, calendula, rosemary; chamomile (reported "Egyptian" dedication) | Ra | Shapash | Shamash | Surya |
| Moon | Monday | Silver | Crystal | Pearl | none (luminary) | White willow, chickweed, cucumber, white poppy | Khonsu | Yarikh | Sin (Nanna) | Chandra |
| Mercury | Wednesday | Quicksilver | Agate | Emerald | Water | Fennel, lavender, dill, valerian | Thoth | Taautos | Nabu | Budha |
| Venus | Friday | Copper | Emerald | Diamond | Metal | Damask rose, yarrow, thyme, elder | Hathor | Astarte | Ishtar | Shukra |
| Mars | Tuesday | Iron | Diamond | Red coral | Fire | Garlic, nettle, wormwood, basil | Horus the Red | Reshef | Nergal | Mangala |
| Jupiter | Thursday | Tin | Sapphire | Yellow sapphire | Wood | Sage, dandelion, borage, agrimony | Horus Who Bounds the Two Lands | Baal Hadad | Marduk | Brihaspati |
| Saturn | Saturday | Lead | Onyx | Blue sapphire | Earth | Comfrey, horsetail, elm, Solomon's seal | Horus Bull of the Sky | Baal Hammon | Ninurta | Shani |

**Evidence label for every cell: tradition (correspondence system).** No cell is a medical claim. The herb cards hold the pharmacology.

Notes for whoever builds the cards from this table:
- **Day, metal, Navaratna gem, Culpeper herbs and the Hindu column** match facts.json exactly.
- **Culpeper herbs** were verified against the Gutenberg text [A7.3]. Chamomile needs its label changed.
- **Egyptian column:** Ra, Khonsu, Thoth and Hathor agree with *777*. The three Horus names are the ancient astronomical names [A7.8, 4]. The Jupiter translation is unconfirmed [A7.8, 5].
- **TCM phase** comes from the Wuxing source's planet row [A4.1, 3].
- **Western gem** comes from Agrippa's Book II chapter 10 [A7.2, 2]. Using Agrippa's Book I or *777* instead would change at least five of the seven rows [A7.9]. If a card shows a "Western gem", it must name its source.
- **Babylonian Nergal = Mars** is confirmed [A7.8, 4]. The other Babylonian and Phoenician names are carried over from facts.json and were not re-verified in this pass.
