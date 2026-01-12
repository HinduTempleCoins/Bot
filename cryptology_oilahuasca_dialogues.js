// ========================================
// CRYPTOLOGY DIALOGUE TREES: OILAHUASCA
// ========================================
// Add these to cryptologyDialogues.triggers and cryptologyDialogues.trees in index.js
// Topic: Oilahuasca - CYP450 enzyme activation of allylbenzenes from culinary spices

// ADD TO TRIGGERS:
const oilahuascaTriggers = {
  oilahuasca: ['oilahuasca', 'oil ahuasca', 'spice trip', 'nutmeg high', 'myristicin'],
  allylbenzenes: ['allylbenzene', 'allyl benzene', 'essential oil', 'estragole', 'safrole', 'elemicin'],
  cyp450: ['cyp450', 'cytochrome', 'p450', 'liver enzyme', 'drug metabolism'],
  shulgin: ['shulgin', 'pihkal', 'tihkal', 'essential amphetamines']
};

// ADD TO TREES:
const oilahuascaDialogueTrees = {

  // MAIN ENTRY POINT
  oilahuasca: {
    intro: "Oilahuasca - the theory that culinary spices can produce psychoactive effects through CYP450 enzyme manipulation, analogous to how ayahuasca uses MAO inhibitors. What aspect intrigues you?",
    choices: [
      { id: 'oilahuasca_theory', label: '🧪 The Theory Explained', interest: {esoteric: 15, philosophy: 10} },
      { id: 'oilahuasca_shulgin', label: '👨‍🔬 Shulgin\'s Framework', interest: {philosophy: 15} },
      { id: 'oilahuasca_metabolism', label: '🔬 Metabolic Pathway', interest: {philosophy: 20} },
      { id: 'oilahuasca_herbs', label: '🌿 Key Herbs', interest: {esoteric: 10} }
    ]
  },

  oilahuasca_theory: {
    intro: "The Oilahuasca theory proposes that common spices (nutmeg, cinnamon, basil, pepper) contain allylbenzenes that can be 'activated' by manipulating CYP450 liver enzymes - just like ayahuasca uses MAOIs to activate DMT. The key insight: INDUCE enzymes (coffee), then BLOCK them (nutmeg) = maximum accumulation.",
    choices: [
      { id: 'oilahuasca_paradox', label: '🤔 The Paradox Explained', interest: {philosophy: 15} },
      { id: 'oilahuasca_ron69', label: '🔍 Ron69\'s Discovery', interest: {esoteric: 10} },
      { id: 'oilahuasca_formula', label: '📋 Original Formula', interest: {esoteric: 15} },
      { id: 'back', label: '← Back to Oilahuasca', interest: {} }
    ]
  },

  oilahuasca_paradox: {
    intro: "Why INDUCE and INHIBIT the same enzyme? Naive logic says they cancel out. Reality: More enzyme (from coffee) = more 'targets' to block = BIGGER traffic jam when inhibited. Like building more highway lanes right before blocking them all - the bigger the highway, the worse the jam!",
    choices: [
      { id: 'oilahuasca_coffee', label: '☕ Coffee\'s Role (Inducer)', interest: {philosophy: 10} },
      { id: 'oilahuasca_nutmeg', label: '🥜 Nutmeg\'s Role (Inhibitor)', interest: {philosophy: 10} },
      { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 20} },
      { id: 'back', label: '← Back', interest: {} }
    ]
  },

  oilahuasca_shulgin: {
    intro: "Dr. Alexander Shulgin (1925-2014) proposed that 10 essential oils could convert to psychoactive compounds via liver metabolism. He called them 'Essential Amphetamines' - though modern research shows they actually form aminopropiophenones, not amphetamines.",
    choices: [
      { id: 'oilahuasca_ten_oils', label: '🧴 The 10 Essential Oils', interest: {esoteric: 15, philosophy: 10} },
      { id: 'oilahuasca_correction', label: '⚠️ Critical Correction', interest: {philosophy: 15} },
      { id: 'oilahuasca_rabbit', label: '🐰 The Rabbit Study', interest: {philosophy: 10} },
      { id: 'back', label: '← Back to Oilahuasca', interest: {} }
    ]
  },

  oilahuasca_ten_oils: {
    intro: "Shulgin's 10 Essential Oils → Theoretical Targets:\n• Estragole (basil) → 4-MA\n• Methyleugenol (bay) → 3,4-DMA\n• Safrole (sassafras) → MDA\n• Myristicin (nutmeg) → MMDA ★KEY\n• Elemicin (nutmeg) → TMA\n• Asarone (calamus) → TMA-2\n• Apiole (parsley) → DMMDA ★POTENT\n• Dillapiole (dill) → DMMDA-2 ★POTENT",
    choices: [
      { id: 'oilahuasca_myristicin', label: '⭐ Myristicin (The Key)', interest: {philosophy: 15} },
      { id: 'oilahuasca_potent', label: '💪 Potent Ones (Apiole/Dillapiole)', interest: {philosophy: 15} },
      { id: 'back', label: '← Back to Shulgin', interest: {} }
    ]
  },

  oilahuasca_correction: {
    intro: "CRITICAL: Modern research (1977-2024) shows allylbenzenes do NOT form amphetamines in vivo. They form TERTIARY AMINOPROPIOPHENONES (Mannich bases) - structurally different with different pharmacology. Three types: dimethylamines, piperidines, pyrrolidines.",
    choices: [
      { id: 'oilahuasca_metabolism', label: '🔬 Actual Metabolic Pathway', interest: {philosophy: 20} },
      { id: 'oilahuasca_metabolites', label: '🧬 Three Metabolite Types', interest: {philosophy: 15} },
      { id: 'back', label: '← Back to Shulgin', interest: {} }
    ]
  },

  oilahuasca_metabolism: {
    intro: "The 3-Step Pathway:\n1️⃣ CYP450 oxidation: Allylbenzene → 1'-Hydroxyallylbenzene\n2️⃣ Further oxidation: → 1'-Oxo metabolite (reactive ketone)\n3️⃣ Spontaneous Mannich: + Endogenous amines → Tertiary aminopropiophenones\nStep 3 requires NO enzyme - it's spontaneous chemistry!",
    choices: [
      { id: 'oilahuasca_cyp1a2', label: '🔑 CYP1A2 (Primary Enzyme)', interest: {philosophy: 15} },
      { id: 'oilahuasca_mannich', label: '⚗️ Mannich Reaction', interest: {philosophy: 15} },
      { id: 'oilahuasca_metabolites', label: '🧬 Metabolite Types', interest: {philosophy: 10} },
      { id: 'back', label: '← Back to Oilahuasca', interest: {} }
    ]
  },

  oilahuasca_herbs: {
    intro: "Key herbs in oilahuasca formulations work at different points:\n☕ COFFEE - CYP1A2 inducer (preparation)\n🥜 NUTMEG - CYP1A2 inhibitor + psychoactive\n🌿 CINNAMON - Multi-CYP inhibitor + GSH depletion\n🌶️ BLACK PEPPER - CYP3A4 inhibitor\n🌿 BASIL - SULT inhibitor + substrate\n🌿 FENNEL - CYP3A4 inhibitor + substrate",
    choices: [
      { id: 'oilahuasca_coffee', label: '☕ Coffee (Inducer)', interest: {philosophy: 10} },
      { id: 'oilahuasca_nutmeg', label: '🥜 Nutmeg (Star Player)', interest: {esoteric: 15} },
      { id: 'oilahuasca_blockers', label: '🚫 Pathway Blockers', interest: {philosophy: 10} },
      { id: 'oilahuasca_safety', label: '⚠️ Safety & Risks', interest: {philosophy: 10} },
      { id: 'back', label: '← Back to Oilahuasca', interest: {} }
    ]
  },

  oilahuasca_coffee: {
    intro: "Coffee induces CYP1A2 (the enzyme that metabolizes allylbenzenes) by 2-3x over 24-72 hours. This seems counterproductive - more enzyme should mean faster metabolism. BUT: More enzyme = more targets for inhibition = bigger 'traffic jam' when blocked by myristicin!",
    choices: [
      { id: 'oilahuasca_caffeine', label: '☕ Caffeine Metabolism', interest: {philosophy: 10} },
      { id: 'oilahuasca_paradox', label: '🤔 The Paradox', interest: {philosophy: 15} },
      { id: 'back', label: '← Back to Herbs', interest: {} }
    ]
  },

  oilahuasca_nutmeg: {
    intro: "Nutmeg is the KEYSTONE of oilahuasca:\n• Contains myristicin (psychoactive precursor)\n• MECHANISM-BASED CYP1A2 inhibitor (kills the enzyme permanently)\n• Also has MAO inhibitory properties\n• Dual nature: acute inhibitor + chronic inducer\n⚠️ Toxic at 10g+, effects last 24-72 hours!",
    choices: [
      { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 20} },
      { id: 'oilahuasca_myristicin', label: '🔬 Myristicin Studies', interest: {philosophy: 15} },
      { id: 'oilahuasca_nutmeg_effects', label: '🌀 Nutmeg Effects', interest: {esoteric: 10} },
      { id: 'back', label: '← Back to Herbs', interest: {} }
    ]
  },

  oilahuasca_mechanism_based: {
    intro: "Mechanism-based inhibition = 'suicide inhibition'. The enzyme processes myristicin, creating a REACTIVE intermediate that permanently destroys the enzyme. Evidence: 3.21-fold IC50 shift (gets stronger over time). Glutathione can 'rescue' the enzyme by trapping the reactive intermediate.",
    choices: [
      { id: 'oilahuasca_glutathione', label: '🛡️ Glutathione Connection', interest: {philosophy: 15} },
      { id: 'oilahuasca_recovery', label: '⏰ Recovery Time', interest: {philosophy: 10} },
      { id: 'back', label: '← Back to Nutmeg', interest: {} }
    ]
  },

  oilahuasca_blockers: {
    intro: "When CYP1A2 is blocked, the body tries alternate pathways. Oilahuasca blocks these too:\n🌿 CINNAMON - Blocks CYP3A4, 2C9, 2A6 + depletes glutathione\n🌶️ PEPPER - Blocks CYP3A4 + P-glycoprotein\n🌿 FENNEL - Blocks CYP3A4\n🌿 BASIL - Blocks SULT (Phase II)\nResult: NO ESCAPE ROUTES",
    choices: [
      { id: 'oilahuasca_cinnamon', label: '🌿 Cinnamon (Multi-Blocker)', interest: {philosophy: 10} },
      { id: 'oilahuasca_pepper', label: '🌶️ Black Pepper (Bioenhancer)', interest: {philosophy: 10} },
      { id: 'oilahuasca_phase2', label: '🧬 Phase II Blockade', interest: {philosophy: 15} },
      { id: 'back', label: '← Back to Herbs', interest: {} }
    ]
  },

  oilahuasca_safety: {
    intro: "⚠️ SERIOUS SAFETY CONCERNS:\n• Nutmeg toxic at 10g+ (nausea, tachycardia, convulsions)\n• Effects last 24-72 HOURS (extremely long)\n• Safrole/estragole are hepatotoxic & potentially carcinogenic long-term\n• CYP inhibition affects prescription drugs\n• NO controlled human studies on combinations\n• This is EXPERIMENTAL - harm reduction essential",
    choices: [
      { id: 'oilahuasca_harm_reduction', label: '🛡️ Harm Reduction', interest: {philosophy: 10} },
      { id: 'oilahuasca_drugs', label: '💊 Drug Interactions', interest: {philosophy: 15} },
      { id: 'back', label: '← Back to Herbs', interest: {} }
    ]
  },

  oilahuasca_harm_reduction: {
    intro: "If exploring (NOT a recommendation):\n• Start with VERY LOW doses\n• Never use alone - have a sitter\n• Plan for 24-72 hour duration\n• AVOID if on prescription meds\n• Do NOT use chronically (carcinogenicity)\n• Stay hydrated\n• Do not drive for 3 days\n• Know emergency resources",
    choices: [
      { id: 'oilahuasca_drugs', label: '💊 Drug Interactions', interest: {philosophy: 10} },
      { id: 'back', label: '← Back to Safety', interest: {} }
    ]
  },

  oilahuasca_nutmeg_effects: {
    intro: "Nutmeg psychoactive effects (verified):\n• 2-5g: Visual distortions, altered time, dream-like state\n• 5-10g: Strong hallucinations, dissociation, BUT severe nausea\n• Onset: 2-8 hours (very delayed!)\n• Duration: 24-72 hours\n• Character: Dream-like, dissociative - NOT like classic psychedelics\n• Different from LSD/mushrooms - more like deliriants",
    choices: [
      { id: 'oilahuasca_mao', label: '🧠 MAO Inhibition', interest: {philosophy: 10} },
      { id: 'back', label: '← Back to Nutmeg', interest: {} }
    ]
  },

  oilahuasca_myristicin: {
    intro: "Myristicin (5-allyl-1-methoxy-2,3-methylenedioxybenzene):\n• Primary psychoactive in nutmeg (1-3%)\n• CYP1A2 substrate AND mechanism-based inhibitor\n• Metabolites: piperidine + pyrrolidine conjugates (NOT dimethylamine)\n• PMID 26091900: 'most significantly inhibits CYP1A2'\n• PMID 8554622: Induces CYP1A1/2 2-20 fold (chronic)",
    choices: [
      { id: 'oilahuasca_studies', label: '📚 Research Citations', interest: {philosophy: 15} },
      { id: 'back', label: '← Back', interest: {} }
    ]
  },

  oilahuasca_formula: {
    intro: "The original anecdotal formula: Coffee + Almond + Cinnamon + Vanilla + Nutmeg.\nBreakdown:\n☕ Coffee: CYP1A2 induction\n🥜 Nutmeg: Myristicin + CYP1A2 inhibition\n🌿 Cinnamon: Multi-CYP inhibition + GSH depletion\n🍦 Vanilla: Metabolic modulator\n🥜 Almond: Minor (benzaldehyde)",
    choices: [
      { id: 'oilahuasca_herbs', label: '🌿 All Key Herbs', interest: {philosophy: 10} },
      { id: 'back', label: '← Back to Theory', interest: {} }
    ]
  },

  allylbenzenes: {
    intro: "Allylbenzenes are compounds with: benzene ring + allyl chain (-CH2-CH=CH2) + oxygen substituents. Found in many spices. CRITICAL: Only ALLYLbenzenes form psychoactive metabolites - PROPENYLbenzenes (like anethole) do NOT because the conjugated double bond blocks oxidation.",
    choices: [
      { id: 'oilahuasca_allyl_vs_propenyl', label: '⚗️ Allyl vs Propenyl', interest: {philosophy: 15} },
      { id: 'oilahuasca_ten_oils', label: '🧴 The 10 Essential Oils', interest: {esoteric: 10} },
      { id: 'oilahuasca_metabolism', label: '🔬 Metabolic Pathway', interest: {philosophy: 15} },
      { id: 'back', label: '← Back', interest: {} }
    ]
  },

  oilahuasca_allyl_vs_propenyl: {
    intro: "ALLYL: Benzene-CH2-CH=CH2 (oxidizable) ✓\nPROPENYL: Benzene-CH=CH-CH3 (conjugated, blocked) ✗\n\nPsychoactive (allyl): myristicin, safrole, estragole, elemicin, apiole\nNOT psychoactive (propenyl): anethole, asarone, isosafrole\n\nFennel is 80-90% anethole (NOT active) but 5-10% estragole (active)",
    choices: [
      { id: 'oilahuasca_metabolism', label: '🔬 Why This Matters', interest: {philosophy: 15} },
      { id: 'back', label: '← Back', interest: {} }
    ]
  },

  cyp450: {
    intro: "Cytochrome P450 (CYP450) enzymes are the liver's primary drug metabolizers. CYP3A4 handles >50% of all drugs. CYP1A2 handles allylbenzenes (and caffeine). Oilahuasca manipulates these enzymes to prevent metabolism of psychoactive precursors.",
    choices: [
      { id: 'oilahuasca_cyp1a2', label: '🔑 CYP1A2 (Primary)', interest: {philosophy: 15} },
      { id: 'oilahuasca_cyp3a4', label: '🔒 CYP3A4 (Backup)', interest: {philosophy: 10} },
      { id: 'oilahuasca_drugs', label: '💊 Drug Implications', interest: {philosophy: 15} },
      { id: 'back', label: '← Back', interest: {} }
    ]
  },

  oilahuasca_cyp1a2: {
    intro: "CYP1A2 - The primary enzyme for allylbenzene metabolism:\n• Also metabolizes caffeine (95%)\n• Induced by coffee (2-3x increase)\n• Inhibited by myristicin (mechanism-based)\n• Inhibited by apiole (from parsley)\n• The KEY target in oilahuasca strategy",
    choices: [
      { id: 'oilahuasca_coffee', label: '☕ Coffee Induction', interest: {philosophy: 10} },
      { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 15} },
      { id: 'back', label: '← Back to CYP450', interest: {} }
    ]
  },

  oilahuasca_studies: {
    intro: "Key Research Citations:\n• PMID 12523956: CYP3A4 and CYP1A2 in myristicin oxidation\n• PMID 26091900: Myristicin mechanism-based CYP1A2 inhibition\n• PMID 8554622: Myristicin induces CYP450s 2-20 fold\n• PMID 9245741: Myristicin induces GST 4-14 fold\n• Truitt 1963: MAO inhibition evidence",
    choices: [
      { id: 'back', label: '← Back', interest: {} }
    ]
  }
};

// EXPORT FOR INTEGRATION
module.exports = {
  oilahuascaTriggers,
  oilahuascaDialogueTrees
};
