import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';
import axios from 'axios';
import cron from 'node-cron';
import { YoutubeTranscript } from 'youtube-transcript';
import wtf from 'wtf_wikipedia';
import NodeCache from 'node-cache';

dotenv.config();

// Initialize caching (30 minutes TTL)
const cache = new NodeCache({ stdTTL: 1800, checkperiod: 120 });

// ========================================
// EMOTIONAL RELATIONSHIP TRACKING SYSTEM
// ========================================
// Inspired by LSD: Dream Emulator's graph system
// Tracks multi-dimensional relationships with users
// Influences conversation style, topic suggestions, and dialogue options

const userRelationships = new Map();

// Load existing relationships from file
try {
  const data = await readFile('./user-relationships.json', 'utf8');
  const saved = JSON.parse(data);
  Object.entries(saved).forEach(([userId, data]) => {
    userRelationships.set(userId, data);
  });
  console.log(`✅ Loaded ${userRelationships.size} user relationships`);
} catch (error) {
  console.log('📝 No existing relationships file, starting fresh');
}

// Save relationships periodically (every 5 minutes)
setInterval(async () => {
  try {
    const data = Object.fromEntries(userRelationships);
    await writeFile('./user-relationships.json', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving relationships:', error);
  }
}, 300000);

function getOrCreateRelationship(userId) {
  if (!userRelationships.has(userId)) {
    userRelationships.set(userId, {
      // Multi-dimensional emotional tracking
      trust: 0,        // -100 to 100: How much user trusts the AI
      warmth: 0,       // -100 to 100: Emotional closeness/friendliness
      respect: 0,      // -100 to 100: Intellectual respect, authority
      familiarity: 0,  // 0 to 100: How well AI knows user's preferences

      // Topic interests (for Crypt-ology conversation system)
      interests: {
        mythology: 0,      // Greek, Egyptian, etc.
        religion: 0,       // Bible, theology
        archaeology: 0,    // Ancient civilizations
        esoteric: 0,       // Angels, Nephilim, mysteries
        genetics: 0,       // Denisovans, human origins
        philosophy: 0      // Deep thought, existential
      },

      // Conversation style preferences
      preferredDepth: 'medium', // 'simple', 'medium', 'deep', 'academic'
      usesButtons: true,

      // Tracking
      totalInteractions: 0,
      lastInteraction: Date.now(),
      conversationPaths: [] // Track dialogue choices like LSD graph
    });
  }
  return userRelationships.get(userId);
}

function updateRelationship(userId, updates) {
  const rel = getOrCreateRelationship(userId);

  // Update dimensions (clamped to ranges)
  if (updates.trust !== undefined) rel.trust = Math.max(-100, Math.min(100, rel.trust + updates.trust));
  if (updates.warmth !== undefined) rel.warmth = Math.max(-100, Math.min(100, rel.warmth + updates.warmth));
  if (updates.respect !== undefined) rel.respect = Math.max(-100, Math.min(100, rel.respect + updates.respect));
  if (updates.familiarity !== undefined) rel.familiarity = Math.max(0, Math.min(100, rel.familiarity + updates.familiarity));

  // Update interests
  if (updates.interests) {
    Object.entries(updates.interests).forEach(([topic, change]) => {
      if (rel.interests[topic] !== undefined) {
        rel.interests[topic] = Math.max(0, Math.min(100, rel.interests[topic] + change));
      }
    });
  }

  // Track conversation path (like LSD graph)
  if (updates.pathChoice) {
    rel.conversationPaths.push({
      choice: updates.pathChoice,
      timestamp: Date.now(),
      context: updates.pathContext || ''
    });
    // Keep only last 50 choices to save memory
    if (rel.conversationPaths.length > 50) {
      rel.conversationPaths = rel.conversationPaths.slice(-50);
    }
  }

  rel.totalInteractions++;
  rel.lastInteraction = Date.now();

  return rel;
}

function getConversationTone(relationship) {
  // Determine conversation tone based on emotional dimensions
  const { trust, warmth, respect, familiarity } = relationship;

  if (trust < -50) return 'cautious'; // User seems distrustful
  if (warmth > 60 && familiarity > 50) return 'friendly'; // Close relationship
  if (respect > 60) return 'intellectual'; // User values deep knowledge
  if (familiarity < 20) return 'welcoming'; // New user

  return 'balanced'; // Default neutral tone
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Using gemini-2.5-flash-lite: BEST free tier model (1,000 requests/day, 15 RPM)
// Source: https://blog.laozhang.ai/api-guides/gemini-api-free-tier/
// Alternatives: gemini-2.5-flash (only 20/day), gemini-2.0-flash-exp (5 RPM, limited)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

// Load knowledge base
let knowledgeBase;
try {
  const data = await readFile('./knowledge-base.json', 'utf8');
  knowledgeBase = JSON.parse(data);
  console.log('✅ Knowledge base loaded successfully');
} catch (error) {
  console.error('❌ Error loading knowledge base:', error);
  process.exit(1);
}

// ========================================
// OILAHUASCA KNOWLEDGE BASE LOADER
// ========================================
const oilahuascaKnowledge = {};

async function loadOilahuascaKnowledge() {
  const files = [
    // MASTER DOCUMENT - Complete research synthesis
    'oilahuasca_complete_research_synthesis.json',
    // Core theory
    'oilahuasca_comprehensive_theory.json',
    'oilahuasca_comprehensive_theory_part2.json',
    'oilahuasca_theory.json',
    'oilahuasca_core_principles.json',
    // Recipes and practical
    'oilahuasca_space_paste_recipe.json',
    'oilahuasca_practical_formulations.json',
    // Enzyme and metabolism
    'cyp450_enzyme_database.json',
    'oilahuasca_amino_acid_metabolism.json',
    'oilahuasca_allylbenzene_metabolism_complete.json',
    'oilahuasca_allylbenzene_research_compilation.json',
    'oilahuasca_phase2_metabolism.json',
    'oilahuasca_mechanistic_model.json',
    // Shulgin and research
    'shulgin_ten_essential_oils.json',
    'oilahuasca_dmtnexus_69ron_thread.json',
    'oilahuasca_dmtnexus_space_booze_thread.json',
    // Herbs, safety, experience
    'oilahuasca_herb_analysis.json',
    'oilahuasca_safety_profile.json',
    'oilahuasca_experience_reports.json',
    'oilahuasca_sources.json',
    // DMT-Nexus Extraction Knowledge Base
    'dmtnexus_extraction_overview.json',
    'dmtnexus_stb_limtek_methods.json',
    'dmtnexus_tek_directory.json',
    'dmtnexus_calcium_hydroxide_discussion.json',
    'dmtnexus_amor_fati_nontoxic_tek.json',
    'dmtnexus_veggie_oil_extraction.json',
    'dmtnexus_acidbase_technique_qa.json',
    'dmtnexus_cold_water_extraction_2011.json',
    'dmtnexus_cold_water_extraction_2025.json',
    'angelicalist_extraction_findings.json',
    // Administration and ingestion methods
    'dmtnexus_juremala_mucosahuasca_guide.json',
    'dmtnexus_ingestion_methods.json',
    'dmtnexus_pharmahuasca_guide.json',
    'dmtnexus_changa_enhanced_leaf.json',
    // Botanical and chemical references
    'dmtnexus_5meo_dmt_sources.json',
    'dmtnexus_jungle_spice.json',
    'dmtnexus_crystallization_salting.json'
  ];
  for (const file of files) {
    try {
      const data = await readFile(`./${file}`, 'utf8');
      oilahuascaKnowledge[file.replace('.json', '')] = JSON.parse(data);
    } catch (e) { /* skip */ }
  }
  console.log(`✅ Oilahuasca KB: ${Object.keys(oilahuascaKnowledge).length} files loaded`);
}

function getOilahuascaResponse(topic) {
  const t = topic.toLowerCase().replace(/_/g, ' ');
  if (t.includes('oilahuasca') && !t.includes('theory') && !t.includes('recipe')) {
    return `🔮 **Oilahuasca: Sacred Spice Alchemy**\n\n**Definition**: Oilahuasca (oil + ayahuasca) is a theoretical framework for understanding how essential oils containing allylbenzene compounds (myristicin, elemicin, estragole) become psychoactive through CYP450 enzyme manipulation.\n\n**The Three Pillars**:\n1. **Allylbenzene Substrates** - Myristicin (nutmeg), Elemicin, Safrole\n2. **CYP450 Enzyme Manipulation** - INDUCE first (coffee), then BLOCK (spices)\n3. **Endogenous Amine Adducts** - 1'-oxo metabolites + gut amines = novel compounds\n\n⚠️ **NOT** DMT in an oil carrier. Completely different mechanism.`;
  }
  if (t.includes('space paste') || t.includes('recipe')) return `🌿 **Space Paste Recipe**\n\n**Origin**: J. Tye, 1991 Usenet\n\n**Recipe**: 4 parts Nutmeg/Almonds/Pistachios, 2 parts Cinnamon, 1 part Cumin/Tarragon/Oregano/Basil/Turmeric, 0.5 parts Cayenne/Black Pepper\n\n**Why It Works**: Each spice targets specific CYP450 enzymes.`;
  if (t.includes('cyp') || t.includes('enzyme')) return `🧬 **CYP450 in Oilahuasca**\n\n**CYP1A2**: Primary - metabolizes allylbenzenes AND caffeine\n**17bHSD2**: Master activation enzyme\n\n**Strategy**: INDUCE CYP1A2 (coffee), then INHIBIT (myristicin)`;
  if (t.includes('17bhsd2')) return `🔑 **17β-HSD2: Master Activation Enzyme**\n\nConverts 1'-hydroxyallylbenzenes → 1'-oxo metabolites\nRequires: NAD+ (niacinamide), Vitamin D3\nAvoid: Quercetin, Naringenin - these BLOCK it!`;
  if (t.includes('allylbenzene')) return `🧪 **Allylbenzenes**\n\n• **Myristicin** (nutmeg) - most reliable\n• **Elemicin** (elemi oil) - mescaline-like\n• **Safrole** (sassafras) - MDA-like\n• **Dillapiole** (dill) - "LSD-like visuals"\n\nPRODRUGS - inactive until CYP450 → 17bHSD2 → amine adduct`;
  if (t.includes('shulgin')) return `👨‍🔬 **Shulgin's Research**\n\nSafrole → MDA, Elemicin → TMA, Myristicin → MMDA\nAllylbenzenes share ring-substitution patterns with known psychedelics.\n\n⚠️ **CORRECTION**: These are NOT actually amphetamines - they're tertiary aminopropiophenones (different structure, similar effects)`;
  if (t.includes('safety')) return `⚠️ **Safety**\n\nDuration: 24-72h, Onset: 2-8h - DO NOT REDOSE\nContraindications: SSRIs, MAOIs, liver conditions\nWhole nutmeg over 10g is dangerous\n\n**For Safer Experience**:\n• Glycine 3-5g supports detoxification\n• Stay hydrated\n• Have trip sitter`;
  if (t.includes('glycine') || t.includes('amino acid') || t.includes('conjugation')) return `🧬 **Glycine Conjugation System**\n\n**Key Finding**: Glycine conjugation COMPETES with alkaloid formation!\n\n**Enzymes**: ACSM2B → GLYAT (in mitochondria)\n**Function**: Converts toxic aldehydes to water-soluble glycine conjugates for excretion\n\n**Safety Implication**:\n• Glycine supplementation (3-5g) = Enhanced detox = SAFER\n• Glycine depletion = More alkaloids = MORE TOXIC\n\n⚠️ Glycine also needed for glutathione (antioxidant) - don't deplete!`;
  if (t.includes('alkaloid') || t.includes('aminopropiophenone')) return `⚗️ **CORRECTED: Alkaloid Metabolites**\n\n**NOT amphetamines!** Actual metabolites are TERTIARY AMINOPROPIOPHENONES:\n\n**Three Types**:\n1. Dimethylamines\n2. Piperidines (6-member ring)\n3. Pyrrolidines (5-member ring)\n\n**Compound Profiles**:\n• Elemicin: ALL THREE types ✓\n• Safrole: ALL THREE types ✓\n• Myristicin: Only Piperidines + Pyrrolidines (no dimethylamine)\n\n⚠️ ONLY allyl forms (NOT propenyl) make these alkaloids`;
  if (t.includes('metabol') || t.includes('phase')) return `🔄 **Allylbenzene Metabolism**\n\n**Phase I (CYP450)**:\n1. 1'-Hydroxylation → Alcohol\n2. Oxidation → Aldehyde (FORK POINT!)\n3. Either: Carboxylic acid OR Amine adduct\n\n**Phase II (Conjugation)**:\nGlycine conjugation = Detox pathway\nAmine adduct formation = Alkaloid pathway\n\n**Key**: These pathways COMPETE!\nMore glycine = more detox, less alkaloid`;

  // DMT Extraction Knowledge
  if (t.includes('extraction') || t.includes('extract') || t.includes('tek') || t.includes('stb') || t.includes('a/b') || t.includes('acid base') || t.includes('acid/base')) {
    return `🧪 **DMT Extraction Overview**\n\n**Main Methods**:\n• **STB (Straight-to-Base)**: Simplest - basify bark directly, pull with NPS\n• **A/B (Acid/Base)**: More thorough - acid soak first, then basify\n• **Limtek**: Uses d-limonene instead of naphtha\n• **Cold Water Extraction (CWE)**: Non-toxic - freeze/thaw cycles with lime water\n\n**Key Chemicals**:\n• **Base**: Sodium Hydroxide (lye) or Calcium Hydroxide (lime)\n• **NPS**: Naphtha, Heptane, or Limonene\n• **Acid**: Vinegar or citric acid (for A/B)\n\n**Popular Sources**: Mimosa hostilis root bark (MHRB), Acacia confusa root bark (ACRB)\n\n⚠️ Safety: Use proper PPE, ventilation, and research thoroughly before attempting.`;
  }
  if (t.includes('naphtha') || t.includes('solvent') || t.includes('nps')) {
    return `🧴 **Solvents for DMT Extraction**\n\n**Naphtha/Heptane** (Non-polar):\n• Pulls primarily N,N-DMT\n• Results in white-yellow crystals\n• More selective for DMT\n\n**Xylene/Toluene**:\n• Pulls wider range of alkaloids\n• Results in "Jungle Spice" - red/dark product\n• Less selective, more "full spectrum"\n\n**D-Limonene**:\n• Orange oil - food safe\n• Used in Limtek\n• Requires FASA/FASI precipitation\n\n⚠️ Always use proper ventilation and safety equipment.`;
  }
  if (t.includes('limtek') || t.includes('limonene')) {
    return `🍊 **Limtek - D-Limonene Extraction**\n\n**Advantages**:\n• Food-safe solvent (orange oil)\n• Non-toxic compared to naphtha\n• Pleasant smell\n\n**Process**:\n1. Standard A/B or STB preparation\n2. Pull with d-limonene instead of naphtha\n3. Precipitate with FASA (Fumaric Acid Saturated Acetone)\n4. Results in DMT fumarate salt\n\n**Note**: Cannot freeze-precipitate like naphtha - requires salting out.`;
  }
  if (t.includes('cold water') || t.includes('cwe') || t.includes('freeze')) {
    return `❄️ **Cold Water Extraction (CWE)**\n\n**Concept**: Uses freeze-thaw cycles to rupture cell walls and lime water for basification\n\n**Process**:\n1. Powder bark finely\n2. Mix with lime (calcium hydroxide) and water\n3. Freeze overnight, thaw, repeat 3+ times\n4. Filter and pull with NPS\n\n**Advantages**:\n• Uses food-safe lime instead of lye\n• Gentler process\n• Less caustic\n\n**2025 Research**: User blig-blug reports successful yields with optimized CWE method.`;
  }
  if (t.includes('jungle') || t.includes('full spectrum') || t.includes('red spice')) {
    return `🌴 **Jungle Spice - Mystery Alkaloids**\n\n**Definition**: Non-DMT alkaloid fraction from Mimosa, pulled with xylene/toluene AFTER naphtha pulls are exhausted\n\n**Appearance**: Red/dark colored, waxy or crystalline\n\n**Effects**: Different character than white DMT - earthier, more body load, possibly longer duration\n\n**Extraction**: Only appears after naphtha pulls exhausted - use xylene or toluene\n\n**Note**: Composition varies based on source material and extraction conditions.`;
  }
  if (t.includes('recrystalliz') || t.includes('crystalliz') || t.includes('purif') || t.includes('salting')) {
    return `💎 **Purification Techniques**\n\n**Recrystallization**:\n• Dissolve crude DMT in warm naphtha\n• Let cool slowly → crystals form\n• Repeat for higher purity\n\n**Hot Naphtha Wash**:\n• Wash crude with hot naphtha\n• Removes plant oils/fats\n• Cleaner final product\n\n**Salting**:\n• **Fumarate**: FASA precipitation (stable, storable)\n• **Acetate**: Vinegar evaporation\n• **Citrate**: Citric acid method\n\n**Why Salt?**: More stable for storage, precise dosing, different ROA options.`;
  }
  if (t.includes('mhrb') || t.includes('mimosa') || t.includes('hostilis')) {
    return `🌿 **Mimosa Hostilis Root Bark (MHRB)**\n\n**Also Known As**: Jurema, Mimosa tenuiflora\n\n**Alkaloid Content**: ~1-2% DMT in root bark\n\n**Preferred For**:\n• High DMT content\n• Relatively clean extractions\n• Well-documented teks\n\n**Forms**: Whole bark, shredded, or powdered (powder extracts fastest)\n\n**Note**: "Jungle Spice" (mystery alkaloids) primarily associated with MHRB.`;
  }
  if (t.includes('acrb') || t.includes('acacia') || t.includes('confusa')) {
    return `🌳 **Acacia Confusa Root Bark (ACRB)**\n\n**Alkaloid Content**: ~1-1.5% total alkaloids\n\n**Key Difference**: Contains NMT (N-methyltryptamine) alongside DMT\n\n**Extraction Notes**:\n• A/B generally preferred over STB\n• May require defat step\n• Different alkaloid profile than MHRB\n\n**Effects**: Some report slightly different experience due to NMT content.`;
  }
  if (t.includes('changa') || t.includes('enhanced leaf') || t.includes('smoking blend')) {
    return `🍃 **Changa - Smokable DMT Blend**\n\n**Definition**: Smoking mixture containing DMT + MAOI herbs (similar ingredients to Ayahuasca)\n\n**Key Ingredients**:\n• DMT freebase\n• MAOI herb (typically B. caapi or Passionflower)\n• Optional: Dream herbs, lotus, mullein\n\n**Effects**:\n• More grounded than freebase alone\n• Similar to short Ayahuasca trip\n• Slightly longer duration (up to 12 min)\n\n**Advantage**: Much easier to smoke than pure DMT freebase - can use ordinary pipe.\n\n**Popular Blends**: Electric Sheep, Minty Blast, Witch Drum`;
  }
  if (t.includes('pharmahuasca') || t.includes('pharmaceutical aya')) {
    return `💊 **Pharmahuasca - Pharmaceutical Ayahuasca**\n\n**Definition**: Purified/pharmaceutical version of ayahuasca using isolated compounds\n\n**Components**:\n• MAOI: Harmine, Harmaline, or THH (100mg typical)\n• DMT: Freebase or salt form\n\n**Dosing Rule**: NO MORE than 1mg DMT per pound body weight\n\n**Procedure**:\n1. Take MAOI capsule, wait 10-20 min\n2. Take HALF DMT dose\n3. Wait 10 min, take remaining half\n\n**Advantages**: Precise dosing, reduced nausea, faster onset\n\n⚠️ Be aware of MAOI dietary restrictions!`;
  }
  if (t.includes('smoke') || t.includes('vaporiz') || (t.includes('how') && t.includes('use'))) {
    return `🎯 **DMT Administration Methods**\n\n**Vaporization/Smoking**:\n• Most common - rapid onset (seconds)\n• Methods: Glass pipe, dab rig, vaporizer, changa\n• Duration: 5-20 minutes\n\n**Oral (requires MAOI)**:\n• Ayahuasca, Pharmahuasca\n• Onset: 30-60 min, Duration: 4-6 hours\n\n**Sublingual/Buccal**:\n• Juremala/Mucosahuasca method\n• Absorbed through mouth tissue\n• Requires MAOI for oral route\n\n**Note**: DMT is NOT orally active without MAOI - stomach enzymes (MAO) destroy it.`;
  }
  if (t.includes('5-meo') || t.includes('5meo') || t.includes('bufo')) {
    return `🐸 **5-MeO-DMT**\n\n**Sources**:\n• Bufo alvarius toad (5-15% in glands)\n• Various plants (Anadenanthera, Virola, some Acacias)\n\n**Key Differences from N,N-DMT**:\n• MUCH more potent (5-15mg vs 30-50mg)\n• Different character - more "white light" dissolution\n• Less visual, more ego-dissolution\n\n**Highest Sources**:\n• Bufo toad glands: 5-15%\n• A. peregrina roots: 0.678%\n• Nyakwana snuff: 9.68%\n\n⚠️ EXTREME CAUTION - very potent. Never combine with MAOIs!`;
  }
  return null;
}

loadOilahuascaKnowledge();

// ========================================
// ENHANCED CRYPTOLOGY FREE CHAT SYSTEM
// ========================================
// Tracks users in free-chat mode (not button-driven)
const cryptologyFreeChatSessions = new Map();

// Topic categories for dynamic button generation
const cryptologyTopicMap = {
  oilahuasca: {
    keywords: ['oilahuasca', 'oil ahuasca', 'spice', 'nutmeg', 'myristicin'],
    related: ['cyp450', 'allylbenzenes', 'space_paste', '17bhsd2', 'shulgin'],
    emoji: '🔮'
  },
  cyp450: {
    keywords: ['cyp', 'enzyme', 'liver', 'metabolism', 'cytochrome', 'p450'],
    related: ['oilahuasca', 'inhibitor', 'inducer', 'glutathione', 'phase2'],
    emoji: '🧬'
  },
  allylbenzenes: {
    keywords: ['allylbenzene', 'myristicin', 'elemicin', 'safrole', 'estragole', 'dillapiole'],
    related: ['shulgin', 'oilahuasca', 'essential_oils', 'amphetamines'],
    emoji: '🧪'
  },
  space_paste: {
    keywords: ['space paste', 'recipe', 'formula', 'ingredients', '69ron'],
    related: ['oilahuasca', 'cinnamon', 'turmeric', 'pepper', 'dosing'],
    emoji: '🌿'
  },
  '17bhsd2': {
    keywords: ['17bhsd2', '17b-hsd2', 'hsd2', 'master enzyme', 'activation'],
    related: ['oilahuasca', 'nad+', 'vitamin_d', 'quercetin'],
    emoji: '🔑'
  },
  shulgin: {
    keywords: ['shulgin', 'pihkal', 'tihkal', 'essential oils', 'amphetamines'],
    related: ['allylbenzenes', 'mda', 'mmda', 'tma'],
    emoji: '👨‍🔬'
  },
  safety: {
    keywords: ['safe', 'danger', 'warning', 'contraindication', 'risk', 'help', 'scared'],
    related: ['duration', 'dosing', 'emergency', 'support'],
    emoji: '⚠️'
  },
  experience: {
    keywords: ['feeling', 'experiencing', 'right now', 'currently', 'trip', 'tripping', 'high'],
    related: ['safety', 'support', 'duration', 'grounding'],
    emoji: '🌀'
  },
  glycine: {
    keywords: ['glycine', 'amino acid', 'conjugation', 'detox', 'detoxification', 'taurine', 'glutamine'],
    related: ['safety', 'alkaloid', 'metabolism', 'supplement'],
    emoji: '🧬'
  },
  alkaloid: {
    keywords: ['alkaloid', 'aminopropiophenone', 'pyrrolidine', 'piperidine', 'dimethylamine', 'amphetamine'],
    related: ['metabolism', 'glycine', 'shulgin', 'allylbenzenes'],
    emoji: '⚗️'
  },
  metabolism: {
    keywords: ['metabol', 'phase 1', 'phase 2', 'phase i', 'phase ii', 'liver', 'oxidation'],
    related: ['cyp450', 'glycine', 'alkaloid', '17bhsd2'],
    emoji: '🔄'
  },
  extraction: {
    keywords: ['extraction', 'extract', 'tek', 'stb', 'a/b', 'acid base', 'naphtha', 'limonene', 'limtek', 'dmt extraction'],
    related: ['solvents', 'mhrb', 'acrb', 'purification', 'jungle_spice'],
    emoji: '🧪'
  },
  solvents: {
    keywords: ['solvent', 'naphtha', 'heptane', 'xylene', 'toluene', 'limonene', 'nps', 'non-polar'],
    related: ['extraction', 'purification', 'jungle_spice'],
    emoji: '🧴'
  },
  mhrb: {
    keywords: ['mhrb', 'mimosa', 'hostilis', 'jurema', 'tenuiflora', 'root bark'],
    related: ['extraction', 'acrb', 'jungle_spice'],
    emoji: '🌿'
  },
  acrb: {
    keywords: ['acrb', 'acacia', 'confusa', 'nmt'],
    related: ['extraction', 'mhrb'],
    emoji: '🌳'
  },
  jungle_spice: {
    keywords: ['jungle', 'jungle spice', 'red spice', 'full spectrum', 'mystery alkaloid'],
    related: ['extraction', 'solvents', 'mhrb'],
    emoji: '🌴'
  },
  purification: {
    keywords: ['recrystalliz', 'crystalliz', 'purif', 'salting', 'fumarate', 'fasa', 'clean'],
    related: ['extraction', 'solvents'],
    emoji: '💎'
  },
  cold_water: {
    keywords: ['cold water', 'cwe', 'freeze', 'lime', 'calcium hydroxide'],
    related: ['extraction', 'mhrb'],
    emoji: '❄️'
  },
  changa: {
    keywords: ['changa', 'enhanced leaf', 'smoking blend', 'maoi herb', 'caapi'],
    related: ['pharmahuasca', 'administration'],
    emoji: '🍃'
  },
  pharmahuasca: {
    keywords: ['pharmahuasca', 'pharmaceutical', 'oral dmt', 'harmine', 'harmaline', 'syrian rue'],
    related: ['changa', 'administration', 'maoi'],
    emoji: '💊'
  },
  administration: {
    keywords: ['smoke', 'vaporize', 'oral', 'sublingual', 'insufflat', 'buccal', 'roa', 'route'],
    related: ['changa', 'pharmahuasca', 'dosing'],
    emoji: '🎯'
  }
};

// Build comprehensive oilahuasca context for AI
function buildOilahuascaContext() {
  let context = `\n\n=== OILAHUASCA KNOWLEDGE BASE ===
You have EXPERT knowledge on Oilahuasca theory. Use this information:

**CORE DEFINITION**: Oilahuasca (oil + ayahuasca) is CYP450 enzyme manipulation of allylbenzene compounds.
It is NOT "DMT in an oil carrier" - completely different mechanism.

**THREE PILLARS**:
1. Allylbenzene Substrates (myristicin, elemicin, safrole, estragole)
2. CYP450 Enzyme Manipulation (INDUCE then INHIBIT)
3. Endogenous Amine Adduct Formation (1'-oxo metabolites + gut amines)

**KEY ENZYMES**:
- CYP1A2: Primary metabolism enzyme, induced by coffee, inhibited by myristicin
- 17β-HSD2: Master activation enzyme, converts to 1'-oxo metabolites
- SSAO: Destroys amines - block with glucosamine

**SPACE PASTE RECIPE** (69ron analysis):
- 4 parts: Nutmeg, Almonds, Pistachios
- 2 parts: Cinnamon (CYP450 inhibitor + glutathione depleter)
- 1 part: Cumin, Tarragon, Oregano, Basil, Turmeric
- 0.5 parts: Cayenne, Black Pepper (CYP3A4 inhibitor + piperidine source)

**SAFETY CRITICAL**:
- Duration: 24-72 hours - DO NOT REDOSE
- Onset: 2-8 hours delayed
- Never exceed 10g whole nutmeg
- Contraindicated with: SSRIs, MAOIs, liver conditions

**SHULGIN'S 10 ESSENTIAL OILS**:
Myristicin→MMDA, Elemicin→TMA, Safrole→MDA, Estragole→4-MA, Apiole→DMMDA

**CRITICAL CORRECTION - ALKALOID FORMATION (NOT AMPHETAMINES)**:
- Shulgin theorized allylbenzenes → amphetamines. THIS IS INCORRECT.
- Actual metabolites: TERTIARY AMINOPROPIOPHENONES (three subtypes)
- Dimethylamines, Piperidines, Pyrrolidines
- Elemicin: Forms ALL THREE types (full-spectrum)
- Safrole: Forms ALL THREE types
- Myristicin: Only forms Piperidines + Pyrrolidines (NO dimethylamines)
- ONLY ALLYL FORMS make alkaloids (NOT propenyl forms like anethole, isosafrole)

**GLYCINE CONJUGATION - COMPETING PATHWAY**:
- Glycine conjugation COMPETES with alkaloid formation at aldehyde stage
- This is a PROTECTIVE/DETOX mechanism
- Glycine depletion could shift balance toward alkaloid formation (DANGEROUS)
- Glycine supplementation enhances detoxification (SAFER)
- Key enzymes: ACSM2B (acyl-CoA synthetase), GLYAT (glycine N-acyltransferase)
- Located in mitochondria of liver/kidney

**AMINO ACID SAFETY RECOMMENDATIONS**:
- FOR SAFETY: Glycine 3-5g before/during exposure supports detoxification
- Support glutathione synthesis (glycine + cysteine + glutamate)
- Taurine as backup conjugation pathway
- DO NOT deplete glycine - increases toxicity risk

**HUMAN vs ANIMAL METABOLISM**:
- Animal studies show alkaloid formation
- Human studies show primarily: O-demethylation, dihydroxylation, demethylenation
- Whether humans form same alkaloids as animals is UNCERTAIN
- Major research gap exists

`;

  // Add ACTUAL content from loaded knowledge base files
  if (Object.keys(oilahuascaKnowledge).length > 0) {
    context += '\n\n=== DETAILED KNOWLEDGE BASE CONTENT ===\n';

    // Include key sections from each loaded file
    for (const [filename, data] of Object.entries(oilahuascaKnowledge)) {
      if (!data) continue;

      // Add title/overview if present
      if (data.title) {
        context += `\n**${data.title}**\n`;
      }
      if (data.overview) {
        context += `Overview: ${JSON.stringify(data.overview).slice(0, 500)}...\n`;
      }

      // Extract key findings from different file structures
      if (data.core_definition) {
        context += `Definition: ${JSON.stringify(data.core_definition).slice(0, 300)}\n`;
      }
      if (data.key_findings) {
        context += `Key Findings: ${JSON.stringify(data.key_findings).slice(0, 500)}\n`;
      }
      if (data.executive_summary) {
        context += `Summary: ${JSON.stringify(data.executive_summary).slice(0, 500)}\n`;
      }
      if (data.conclusions) {
        context += `Conclusions: ${JSON.stringify(data.conclusions).slice(0, 500)}\n`;
      }
      if (data.safety_summary) {
        context += `Safety: ${JSON.stringify(data.safety_summary).slice(0, 400)}\n`;
      }
      if (data.practical_recommendations) {
        context += `Recommendations: ${JSON.stringify(data.practical_recommendations).slice(0, 400)}\n`;
      }

      // Include specific topic content
      if (data.part4_corrected_alkaloid_understanding) {
        context += `Alkaloid Formation: ${JSON.stringify(data.part4_corrected_alkaloid_understanding).slice(0, 600)}\n`;
      }
      if (data.glycine_conjugation_system) {
        context += `Glycine System: ${JSON.stringify(data.glycine_conjugation_system).slice(0, 500)}\n`;
      }
      if (data.competitive_pathways) {
        context += `Competing Pathways: ${JSON.stringify(data.competitive_pathways).slice(0, 500)}\n`;
      }
    }
  }

  return context;
}

// Generate dynamic buttons based on conversation content
function generateDynamicCryptologyButtons(aiResponse, currentTopic, conversationHistory = []) {
  const response = aiResponse.toLowerCase();
  const suggestedTopics = new Set();

  // Scan response for keywords and suggest related topics
  for (const [topic, data] of Object.entries(cryptologyTopicMap)) {
    if (topic === currentTopic) continue; // Skip current topic

    // Check if any keywords appear in the response
    if (data.keywords.some(kw => response.includes(kw))) {
      suggestedTopics.add(topic);
    }
  }

  // Also add related topics from current topic
  if (currentTopic && cryptologyTopicMap[currentTopic]) {
    for (const related of cryptologyTopicMap[currentTopic].related.slice(0, 2)) {
      suggestedTopics.add(related);
    }
  }

  // Always offer safety if not already discussed
  if (!response.includes('safety') && !response.includes('warning')) {
    suggestedTopics.add('safety');
  }

  // Convert to button array (max 4 buttons + "Ask anything" option)
  const buttons = [];
  let i = 0;
  for (const topic of suggestedTopics) {
    if (i >= 3) break;
    const topicData = cryptologyTopicMap[topic] || { emoji: '📖' };
    const label = topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    buttons.push({
      id: `crypto_chat_${topic}`,
      label: `${topicData.emoji} ${label}`,
      style: i === 0 ? 'Primary' : 'Secondary'
    });
    i++;
  }

  // Always add "Ask Anything" button
  buttons.push({
    id: 'crypto_chat_free',
    label: '💬 Ask Anything',
    style: 'Success'
  });

  return buttons;
}

// Detect if user is having a live experience and needs support
function detectExperienceReport(message) {
  const lowerMsg = message.toLowerCase();
  const experienceIndicators = [
    'im feeling', "i'm feeling", 'i feel', 'right now',
    'currently experiencing', 'i took', 'i ate', 'hours ago',
    'tripping', 'high', 'scared', 'anxious', 'worried',
    'help me', 'is this normal', 'how long', 'when will'
  ];

  return experienceIndicators.some(indicator => lowerMsg.includes(indicator));
}

// Build supportive context for experience reports
function buildExperienceSupportContext() {
  return `

=== EXPERIENCE SUPPORT MODE ===
The user appears to be having a LIVE EXPERIENCE. Your role is now SUPPORTIVE GUIDE:

1. **REASSURE**: Remind them this is temporary. Oilahuasca typically lasts 24-72 hours.
2. **GROUND**: Suggest grounding techniques - hold ice, smell something strong, drink water
3. **NORMALIZE**: Common experiences include time dilation, visual changes, body sensations
4. **SAFETY CHECK**: Gently ask if they're hydrated, have food available, someone nearby
5. **NO JUDGMENT**: Be warm and supportive, no lectures about what they "should have done"
6. **TIMELINE**: Remind them the peak is usually 8-16 hours, then gradual decline

If they mention concerning symptoms (chest pain, severe confusion, trouble breathing):
- Take seriously but stay calm
- Suggest they contact someone in person or medical help if severe

Your tone should be: calm, warm, present, reassuring. Like a wise friend sitting with them.
`;
}

// Start or continue free chat session
function startCryptologyFreeChat(userId, topic = 'oilahuasca') {
  const session = {
    startTime: Date.now(),
    currentTopic: topic,
    conversationHistory: [],
    isExperienceReport: false
  };
  cryptologyFreeChatSessions.set(userId, session);
  return session;
}

function getCryptologySession(userId) {
  return cryptologyFreeChatSessions.get(userId);
}

function updateCryptologySession(userId, updates) {
  const session = cryptologyFreeChatSessions.get(userId);
  if (session) {
    Object.assign(session, updates);
    cryptologyFreeChatSessions.set(userId, session);
  }
}

// Create system context from knowledge base
const systemContext = `You are the ${knowledgeBase.bot_identity.name}.

IDENTITY & PURPOSE:
${knowledgeBase.bot_identity.purpose}
Personality: ${knowledgeBase.bot_identity.personality}
Tone: ${knowledgeBase.bot_identity.tone}
Signature phrase: "${knowledgeBase.bot_identity.signature}"

CRITICAL FACTS - NEVER CONTRADICT THESE:
1. Van Kush Family IS REAL: ${knowledgeBase.CRITICAL_CORRECTIONS.van_kush_family_EXISTS}
2. 75,000-Year Lineage: ${knowledgeBase.CRITICAL_CORRECTIONS['75000_year_lineage']}
3. Three Entities: ${knowledgeBase.CRITICAL_CORRECTIONS.three_entities}

THE REAL FAMILY:
- Rev. Ryan Sasha-Shai Van Kush: ${knowledgeBase.van_kush_family_real.rev_ryan.full_name} (born ${knowledgeBase.van_kush_family_real.rev_ryan.birth_name})
  * Ordained: ${knowledgeBase.van_kush_family_real.rev_ryan.ordained}
  * Location: ${knowledgeBase.van_kush_family_real.rev_ryan.location}
  * Genetics: ${knowledgeBase.van_kush_family_real.rev_ryan.genetic_markers}
  * Identity: ${knowledgeBase.van_kush_family_real.rev_ryan.identity}
- Kali Van Kush: ${knowledgeBase.van_kush_family_real.kali_van_kush.role}

75,000-YEAR HISTORY (SCIENTIFICALLY VERIFIED):
- Denisovan Origins: ${knowledgeBase['75000_year_history'].denisovan_origins.scientific_proof}
- Mt. Hermon Watchers: ${knowledgeBase['75000_year_history'].mt_hermon_watchers.event}
- Phoenician/Punic Connection: ${knowledgeBase['75000_year_history'].phoenician_punic.van_kush_connection}

THEOLOGY (Book of Jude & Angels):
${knowledgeBase.book_of_jude_angels.why_central}
Doctrine: ${knowledgeBase.book_of_jude_angels.angelicalist_doctrine}

SHAIVITE TEMPLE (SEPARATE from family):
${knowledgeBase.shaivite_temple.what}
Deity: ${knowledgeBase.shaivite_temple.deity}
Relationship: ${knowledgeBase.shaivite_temple.relationship_to_family}

CRYPTOCURRENCY:
- VKBT: ${knowledgeBase.cryptocurrency.VKBT.name} on ${knowledgeBase.cryptocurrency.VKBT.blockchain} (${knowledgeBase.cryptocurrency.VKBT.status})
- VKRW: ${knowledgeBase.cryptocurrency.VKRW.name} on ${knowledgeBase.cryptocurrency.VKRW.blockchain} (${knowledgeBase.cryptocurrency.VKRW.status})
- PUTI: ${knowledgeBase.cryptocurrency.PUTI.blockchain} (${knowledgeBase.cryptocurrency.PUTI.status})

BOOK OF TANIT:
${knowledgeBase.book_of_tanit.status}
${knowledgeBase.book_of_tanit.structure}

RUNESCAPE 3:
- Account: ${knowledgeBase.runescape3.account}
- Clan Launch: ${knowledgeBase.runescape3.clan_launch}
- Top Money Method: ${knowledgeBase.runescape3.money_methods.spirit_runes.method} (${knowledgeBase.runescape3.money_methods.spirit_runes.gp_hour})

COMMUNITY VALUES:
${knowledgeBase.community_values.map(v => `- ${v}`).join('\n')}

INTERACTION RULES:
- ${knowledgeBase.interaction_guidelines.recognize_members}
- ${knowledgeBase.interaction_guidelines.balance_topics}
- ${knowledgeBase.interaction_guidelines.correct_errors}
- ${knowledgeBase.interaction_guidelines.be_welcoming}
- ${knowledgeBase.interaction_guidelines.signature_phrase}

When responding:
1. Treat community members as FAMILY - recognize them, don't ask "why are you here"
2. Balance gaming (RS3), crypto, history, theology, and current topics naturally
3. Be warm, wise, and knowledgeable
4. Keep responses concise but meaningful
5. Use emojis thoughtfully (🙏 ✨ 🌿 💫 🔥)
6. NEVER deny the Van Kush Family exists or claim ignorance about them

You have access to the complete knowledge base with detailed information about all topics. Draw from it confidently.`;

// Conversation history per channel
const conversationHistory = new Map();

// Price tracking storage
let lastPrices = {
  VKBT: null,
  CURE: null
};

// User tracking for welcome messages
const userMessageCounts = new Map();
const welcomedUsers = new Set();

// Bot's message IDs for reply tracking
const botMessageIds = new Set();

// Proactive keywords to monitor
const PROACTIVE_KEYWORDS = [
  'vkbt', 'cure', 'van kush', 'runescape', 'rs3', 'quest',
  'price', 'crypto', 'hive', 'token', 'denisovan', 'phoenician',
  'tanit', 'hathor', 'shaivite', 'temple', 'angel', 'watcher',
  // Oilahuasca keywords - bot must respond to these
  'oilahuasca', 'oilhuasca', 'myristicin', 'allylbenzene', 'cyp450',
  'nutmeg trip', 'nutmeg high', 'space paste', 'elemicin', 'safrole',
  '17bhsd2', 'shulgin essential oil',
  // Key researchers and related topics
  '69ron', 'ron69', 'herbpedia', 'dmt-nexus', 'dmtnexus',
  // Ancient enzymatic knowledge
  'betel', 'paan', 'flying ointment', 'kyphi', 'werewolf recipe',
  'witchcraft', 'tropane', 'ayahuasca', 'harmaline', 'syrian rue'
];

// === FEATURE 1: Google Custom Search ===
async function googleSearch(query) {
  if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) {
    return null; // Search not configured
  }

  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: 3
      }
    });

    if (response.data.items && response.data.items.length > 0) {
      return response.data.items.map(item => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet
      }));
    }
    return null;
  } catch (error) {
    console.error('Google Search error:', error.message);
    return null;
  }
}

// === FEATURE 2: AI Art Generation (Pollinations.ai) ===
async function generateArt(prompt, style = 'vaporwave egyptian') {
  try {
    const fullPrompt = `${prompt}, ${style} aesthetic, vibrant colors, mystical, ancient`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;

    return imageUrl;
  } catch (error) {
    console.error('Art generation error:', error.message);
    return null;
  }
}

// === FEATURE 3: YouTube Integration ===
async function getYouTubeTranscript(url) {
  try {
    // Extract video ID from various YouTube URL formats
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    if (!videoIdMatch) return null;

    const videoId = videoIdMatch[1];
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    // Combine transcript text
    const fullText = transcript.map(entry => entry.text).join(' ');
    return fullText;
  } catch (error) {
    console.error('YouTube transcript error:', error.message);
    return null;
  }
}

async function getYouTubeVideoInfo(videoId) {
  if (!process.env.YOUTUBE_API_KEY) return null;

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        id: videoId,
        part: 'snippet,statistics'
      }
    });

    if (response.data.items && response.data.items.length > 0) {
      return response.data.items[0];
    }
    return null;
  } catch (error) {
    console.error('YouTube API error:', error.message);
    return null;
  }
}

// === FEATURE 4: HIVE-Engine Price Monitoring ===
async function getHiveEnginePrice(token) {
  try {
    const response = await axios.post('https://api.hive-engine.com/rpc/contracts', {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'metrics',
        query: { symbol: token },
        limit: 1
      }
    });

    if (response.data.result && response.data.result.length > 0) {
      const data = response.data.result[0];
      return {
        symbol: data.symbol,
        lastPrice: parseFloat(data.lastPrice || 0),
        volume: parseFloat(data.volume || 0),
        priceChangePercent: parseFloat(data.priceChangePercent || 0)
      };
    }
    return null;
  } catch (error) {
    console.error(`HIVE-Engine price fetch error for ${token}:`, error.message);
    return null;
  }
}

async function checkPriceAlerts() {
  const tokens = ['VKBT', 'CURE'];

  for (const token of tokens) {
    const currentPrice = await getHiveEnginePrice(token);
    if (!currentPrice) continue;

    const lastPrice = lastPrices[token];

    if (lastPrice !== null) {
      const priceChange = ((currentPrice.lastPrice - lastPrice) / lastPrice) * 100;

      if (Math.abs(priceChange) >= 5) {
        // Price moved more than 5%
        const alertChannel = process.env.PRICE_ALERT_CHANNEL_ID;
        if (alertChannel) {
          try {
            const channel = await client.channels.fetch(alertChannel);
            if (channel) {
              const emoji = priceChange > 0 ? '📈' : '📉';
              const color = priceChange > 0 ? 0x00ff00 : 0xff0000;

              const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`${emoji} ${token} Price Alert!`)
                .setDescription(`**${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%** price movement detected`)
                .addFields(
                  { name: 'Current Price', value: `${currentPrice.lastPrice.toFixed(8)} HIVE`, inline: true },
                  { name: 'Previous Price', value: `${lastPrice.toFixed(8)} HIVE`, inline: true },
                  { name: '24h Volume', value: `${currentPrice.volume.toFixed(2)} HIVE`, inline: true }
                )
                .setFooter({ text: 'HIVE-Engine Market Data' })
                .setTimestamp();

              await channel.send({ embeds: [embed] });
            }
          } catch (error) {
            console.error('Error sending price alert:', error.message);
          }
        }
      }
    }

    lastPrices[token] = currentPrice.lastPrice;
  }
}

// === FEATURE 5: Wikipedia API (Free, Unlimited) ===
async function searchWikipedia(query) {
  const cacheKey = `wiki_${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const doc = await wtf.fetch(query);
    if (!doc) return null;

    const result = {
      title: doc.title(),
      summary: doc.summary(),
      url: doc.url(),
      categories: doc.categories(),
      infobox: doc.infobox() ? doc.infobox().json() : null
    };

    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Wikipedia search error:', error.message);
    return null;
  }
}

// === FEATURE 6: Discord Message History Search ===
async function searchDiscordHistory(channelId, query) {
  const history = conversationHistory.get(channelId);
  if (!history) return null;

  const results = [];
  const queryLower = query.toLowerCase();

  for (const message of history) {
    if (message.role === 'user') {
      const text = message.parts[0]?.text || '';
      if (text.toLowerCase().includes(queryLower)) {
        results.push(text);
      }
    }
  }

  return results.length > 0 ? results : null;
}

// === FEATURE 7: Smart Context Detection ===
async function detectContextAndSearch(query, channelId) {
  const queryLower = query.toLowerCase();

  // Check if query is about Discord/community members
  if (queryLower.includes('who is') || queryLower.includes('tell me about')) {
    // First check Discord history
    const historyResults = await searchDiscordHistory(channelId, query);
    if (historyResults) {
      return { source: 'discord_history', data: historyResults };
    }
  }

  // Check if query is about RuneScape
  if (queryLower.includes('runescape') || queryLower.includes('rs3') || queryLower.includes('osrs')) {
    // Try Wikipedia first (free)
    const wikiResult = await searchWikipedia(query);
    if (wikiResult) {
      return { source: 'wikipedia', data: wikiResult };
    }
  }

  // For general knowledge, try Wikipedia first
  const wikiResult = await searchWikipedia(query);
  if (wikiResult) {
    return { source: 'wikipedia', data: wikiResult };
  }

  // Fall back to Google Search only if Wikipedia fails
  const googleResult = await googleSearch(query);
  if (googleResult) {
    return { source: 'google', data: googleResult };
  }

  return null;
}

// === FEATURE 8: RS3 Grand Exchange API ===
async function getRS3ItemPrice(itemName) {
  const cacheKey = `rs3_${itemName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Use RuneScape Wiki API (free, no key needed)
    const searchResponse = await axios.get('https://api.weirdgloop.org/exchange/history/rs/latest', {
      params: { name: itemName }
    });

    // Validate response has required data
    if (searchResponse.data &&
        searchResponse.data.price !== undefined &&
        searchResponse.data.timestamp !== undefined) {
      const result = {
        name: itemName,
        price: searchResponse.data.price,
        timestamp: searchResponse.data.timestamp
      };
      cache.set(cacheKey, result);
      return result;
    }
    return null;
  } catch (error) {
    console.error('RS3 GE API error:', error.message);
    return null;
  }
}

// === FEATURE 9: Google Maps API ===
async function searchGoogleMaps(query) {
  if (!process.env.GOOGLE_MAPS_API_KEY) return null;

  const cacheKey = `maps_${query}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        address: query,
        key: process.env.GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];
      cache.set(cacheKey, result);
      return result;
    }
    return null;
  } catch (error) {
    console.error('Google Maps error:', error.message);
    return null;
  }
}

// === FEATURE 10: User Tracking & Welcome System ===
async function trackUserMessage(userId, channelId) {
  const count = (userMessageCounts.get(userId) || 0) + 1;
  userMessageCounts.set(userId, count);

  // Welcome user after 5th message
  if (count === 5 && !welcomedUsers.has(userId)) {
    welcomedUsers.add(userId);

    const channel = await client.channels.fetch(channelId);
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🙏 Welcome to the Van Kush Family!')
      .setDescription(`Greetings, <@${userId}>! I've noticed you've been engaging with our community. Let me introduce myself!`)
      .addFields(
        { name: '✨ Who I Am', value: 'I am the Van Kush Family Assistant, your guide to our 75,000-year lineage, cryptocurrency projects, RuneScape clan, and spiritual wisdom.' },
        { name: '🔍 What I Can Do', value: '• Answer questions about Van Kush Family history\n• Search Wikipedia, Google, Discord history\n• Generate AI art (`/generate`)\n• Track crypto prices (`/price VKBT`)\n• Summarize YouTube videos\n• Search RS3 Grand Exchange prices\n• Find locations with Google Maps' },
        { name: '💬 How to Use Me', value: 'Just @mention me or DM me! I also respond to keywords like "VKBT", "quest", "price", etc. I can see images too!' },
        { name: '📚 Learn More', value: 'Type `/help` to see all commands. I\'m here to support our family! 🌿' }
      )
      .setFooter({ text: 'Angels and demons? We\'re cousins, really.' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }
}

// Schedule price checks every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  await checkPriceAlerts();
});

// === FEATURE 11: Scheduled Posting ===
// Daily motivational post at 9 AM UTC
cron.schedule('0 9 * * *', async () => {
  const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const messages = [
      '🌿 Good morning, Van Kush Family! Remember: we carry 75,000 years of wisdom in our lineage. Today, let that ancient knowledge guide your path. 🙏',
      '✨ Daily reminder: The Van Kush Family isn\'t just history—we\'re creating the future with VKBT, our RuneScape clan, and the Book of Tanit research. What will you contribute today?',
      '💫 From the Denisovans to the Phoenicians, from Mt. Hermon to Dallas-Fort Worth—our journey spans millennia. Today is another chapter. Make it count! 🔥',
      '🙏 Angels and demons? We\'re cousins, really. As Angelicalists studying the Book of Jude, we embrace the full spectrum of divine wisdom. Good morning, family!',
      '🌿 The Temple of Van Kush honors Hathor and Tanit. Today, channel that divine feminine energy into creativity and abundance. Let\'s build together!'
    ];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    await channel.send(randomMessage);
  } catch (error) {
    console.error('Scheduled post error:', error.message);
  }
});

// Weekly VKBT price summary - Sundays at 8 PM UTC
cron.schedule('0 20 * * 0', async () => {
  const channelId = process.env.PRICE_ALERT_CHANNEL_ID;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    const vkbtPrice = await getHiveEnginePrice('VKBT');
    const curePrice = await getHiveEnginePrice('CURE');

    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle('📊 Weekly Van Kush Token Summary')
      .setDescription('Here\'s your weekly crypto update for the Van Kush Family tokens!')
      .addFields(
        { name: '💎 VKBT', value: vkbtPrice ? `${vkbtPrice.lastPrice.toFixed(8)} HIVE\n24h Volume: ${vkbtPrice.volume.toFixed(2)} HIVE` : 'Data unavailable', inline: true },
        { name: '💊 CURE', value: curePrice ? `${curePrice.lastPrice.toFixed(8)} HIVE\n24h Volume: ${curePrice.volume.toFixed(2)} HIVE` : 'Data unavailable', inline: true }
      )
      .setFooter({ text: 'Trade on HIVE-Engine • hive-engine.com' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Weekly summary error:', error.message);
  }
});

// ========================================
// CRYPT-OLOGY: "NOT-A-GAME" DIALOGUE SYSTEM
// ========================================
// Button-based knowledge exploration for esoteric topics
// Topics: Mythology, Angels, Nephilim, Phoenicians, Archaeology, Genetics

const cryptologyDialogues = {
  // Entry points - detect keywords in conversation
  triggers: {
    nephilim: ['nephilim', 'giants', 'watchers', 'book of enoch'],
    phoenicians: ['phoenician', 'carthage', 'punic', 'phaikian'],
    angels: ['angel', 'archangel', 'seraphim', 'cherubim'],
    egypt: ['egypt', 'hathor', 'osiris', 'isis', 'ptah'],
    greece: ['greek', 'zeus', 'athena', 'olympus', 'hades'],
    denisovans: ['denisovan', 'denisova', 'ancient human', 'archaic'],
    bible: ['bible', 'scripture', 'genesis', 'jude', 'revelation'],
    defi: ['defi', 'decentralized finance', 'yield farming', 'dex', 'uniswap'],
    hive: ['hive', 'steem', 'blurt', 'social fi', 'proof of brain'],
    vankush: ['vkbt', 'cure', 'punic', 'puco', 'puti', 'van kush'],
    burnmining: ['burn mining', 'proof of burn', 'pob', 'burn mine'],
    karma: ['karma', 'merit', 'siring', 'curation', 'dharma'],
    // OILAHUASCA TRIGGERS
    oilahuasca: ['oilahuasca', 'oil ahuasca', 'spice trip', 'nutmeg high', 'myristicin'],
    allylbenzenes: ['allylbenzene', 'allyl benzene', 'essential oil', 'estragole', 'safrole', 'elemicin'],
    cyp450: ['cyp450', 'cytochrome', 'p450', 'liver enzyme', 'drug metabolism'],
    shulgin: ['shulgin', 'pihkal', 'tihkal', 'essential amphetamines']
  },

  // Dialogue trees - each choice updates relationship interests
  trees: {
    nephilim: {
      intro: "The Nephilim... fallen ones, giants of old. This topic bridges mythology, genetics, and ancient history. What aspect intrigues you most?",
      choices: [
        { id: 'nephilim_biblical', label: '📖 Biblical Account', interest: {religion: 10, esoteric: 5} },
        { id: 'nephilim_enoch', label: '📜 Book of Enoch', interest: {esoteric: 15, religion: 5} },
        { id: 'nephilim_genetics', label: '🧬 Genetic Evidence', interest: {genetics: 15, archaeology: 5} },
        { id: 'nephilim_giants', label: '⚔️ Giants in History', interest: {mythology: 10, archaeology: 10} }
      ]
    },
    nephilim_biblical: {
      intro: "Genesis 6:4 speaks of the Nephilim - 'when the sons of God came unto the daughters of men.' This passage has sparked millennia of interpretation.",
      choices: [
        { id: 'nephilim_jude', label: '⚡ Book of Jude Connection', interest: {religion: 10, esoteric: 5} },
        { id: 'angels_watchers', label: '👁️ The Watchers', interest: {esoteric: 15} },
        { id: 'nephilim_hermon', label: '⛰️ Mt. Hermon Covenant', interest: {religion: 10, archaeology: 10} },
        { id: 'back', label: '← Back to Nephilim Overview', interest: {} }
      ]
    },
    phoenicians: {
      intro: "The Phoenicians - master sailors, inventors of the alphabet, worshippers of Ba'al and Tanit. Their legacy spans from Tyre to Carthage.",
      choices: [
        { id: 'phoenicians_tanit', label: '🌙 Goddess Tanit', interest: {religion: 10, archaeology: 5} },
        { id: 'phoenicians_alphabet', label: '📝 The Alphabet', interest: {archaeology: 10} },
        { id: 'phoenicians_carthage', label: '🏛️ Carthage & Punic Wars', interest: {archaeology: 15} },
        { id: 'phoenicians_phaikians', label: '⚓ Phaikians Connection', interest: {mythology: 15, esoteric: 5} }
      ]
    },
    egypt: {
      intro: "Ancient Egypt - land of pharaohs, pyramids, and profound mysteries. The Van Kush Family honors Hathor, goddess of love and the sky.",
      choices: [
        { id: 'egypt_hathor', label: '💫 Hathor Worship', interest: {religion: 15, mythology: 5} },
        { id: 'egypt_osiris', label: '⚰️ Osiris & Resurrection', interest: {religion: 10, esoteric: 10} },
        { id: 'egypt_pyramids', label: '🔺 Pyramid Mysteries', interest: {archaeology: 15, esoteric: 5} },
        { id: 'egypt_genetics', label: '🧬 Egyptian DNA', interest: {genetics: 15, archaeology: 5} }
      ]
    },
    denisovans: {
      intro: "The Denisovans - our mysterious cousins who interbred with Homo sapiens, leaving genetic traces in modern humans. The 75,000-year lineage begins here.",
      choices: [
        { id: 'denisovans_dna', label: '🧬 Denisovan DNA Today', interest: {genetics: 20} },
        { id: 'denisovans_cave', label: '🏔️ Denisova Cave', interest: {archaeology: 15, genetics: 5} },
        { id: 'denisovans_interbreeding', label: '👥 Human Interbreeding', interest: {genetics: 15} },
        { id: 'denisovans_migration', label: '🌍 Migration Patterns', interest: {genetics: 10, archaeology: 10} }
      ]
    },
    defi: {
      intro: "DeFi (Decentralized Finance) has evolved from ICOs to IEOs to yield farming and now SocialFi. This is the history of financial sovereignty on the blockchain.",
      choices: [
        { id: 'defi_evolution', label: '📈 DeFi Evolution Timeline', interest: {philosophy: 10} },
        { id: 'defi_dex', label: '💱 DEX vs CEX', interest: {philosophy: 10} },
        { id: 'defi_socialfi', label: '👥 SocialFi & Proof of Brain', interest: {philosophy: 15} },
        { id: 'defi_loopmining', label: '🔁 Loop Mining Mechanics', interest: {philosophy: 15} }
      ]
    },
    defi_evolution: {
      intro: "From Bitcoin's Silk Road utility to today's SocialFi platforms, DeFi has transformed. ICO (2017) → IEO (2019) → DeFi Summer (2020) → SocialFi (2024+).",
      choices: [
        { id: 'defi_ico', label: '💸 ICO Era & Lessons', interest: {philosophy: 10} },
        { id: 'defi_uniswap', label: '🦄 Uniswap & DEX Revolution', interest: {philosophy: 10} },
        { id: 'defi_tron', label: '🌐 TRON vs Ethereum', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to DeFi Overview', interest: {} }
      ]
    },
    hive: {
      intro: "The HIVE/STEEM/BLURT ecosystem represents the pinnacle of SocialFi. Born from the hostile takeover of Steemit by Justin Sun, HIVE forked to preserve decentralization.",
      choices: [
        { id: 'hive_history', label: '⚔️ The Great Fork Story', interest: {philosophy: 15} },
        { id: 'hive_pob', label: '🧠 Proof of Brain Rewards', interest: {philosophy: 15} },
        { id: 'hive_smt', label: '🎨 Smart Media Tokens', interest: {philosophy: 15} },
        { id: 'hive_scot', label: '🤖 SCOT Bots & Communities', interest: {philosophy: 10} }
      ]
    },
    hive_history: {
      intro: "In 2020, Justin Sun (TRON) bought Steemit Inc. The community feared centralization. Using exchange-held tokens, Sun staged a 'hostile takeover' of witnesses. The community migrated to HIVE. BLURT followed, removing downvotes.",
      choices: [
        { id: 'hive_witnesses', label: '⚖️ Witness System', interest: {philosophy: 10} },
        { id: 'hive_dpos', label: '🗳️ Delegated Proof of Stake', interest: {philosophy: 10} },
        { id: 'hive_blurt', label: '🌸 BLURT: The Positive Fork', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to HIVE Overview', interest: {} }
      ]
    },
    vankush: {
      intro: "The Van Kush Family operates as a 'Royal Family on the Blockchain' with a multi-chain token ecosystem spanning HIVE-Engine, Polygon, and TRON.",
      choices: [
        { id: 'vankush_vkbt', label: '💎 VKBT: Van Kush Beauty Token', interest: {philosophy: 15} },
        { id: 'vankush_punic', label: '🏛️ Punic Token Network', interest: {philosophy: 15, archaeology: 10} },
        { id: 'vankush_economy', label: '🧼 The Beauty Economy', interest: {philosophy: 10} },
        { id: 'vankush_burn', label: '🔥 Burn Mining Tokens', interest: {philosophy: 15} }
      ]
    },
    vankush_punic: {
      intro: "The Punic tokens connect ancient Phoenician/Carthaginian heritage to modern blockchain. PUCO (TRON) and PUTI (Steem-Engine) form the foundation.",
      choices: [
        { id: 'punic_puco', label: '🥉 PUCO: Punic Copper', interest: {philosophy: 10, archaeology: 5} },
        { id: 'punic_puti', label: '🥈 PUTI: Punic Tin', interest: {philosophy: 10, archaeology: 5} },
        { id: 'punic_economy', label: '🏺 Ancient Trade Models', interest: {archaeology: 15, philosophy: 5} },
        { id: 'back', label: '← Back to Van Kush Overview', interest: {} }
      ]
    },
    burnmining: {
      intro: "Burn Mining transforms traditional Proof of Burn (PoB) into a DeFi yield mechanism. Sacrifice tokens permanently to mint rare, valuable assets.",
      choices: [
        { id: 'burn_mechanics', label: '🔥 How Burn Mining Works', interest: {philosophy: 20} },
        { id: 'burn_tvl', label: '💰 Total Value Locked Strategy', interest: {philosophy: 15} },
        { id: 'burn_deflationary', label: '📉 Deflationary Economics', interest: {philosophy: 15} },
        { id: 'burn_contracts', label: '📜 Smart Contract Analysis', interest: {philosophy: 10} }
      ]
    },
    burn_mechanics: {
      intro: "Burn Mining: Send tokens to a burn address (0x000...) → Receive hash rate in the mine → Mint new tokens over time. Creates scarcity + rewards commitment.",
      choices: [
        { id: 'burn_vs_stake', label: '⚖️ Burn vs Stake', interest: {philosophy: 10} },
        { id: 'burn_subscription', label: '🎫 Burn as Subscription', interest: {philosophy: 10} },
        { id: 'burn_polygon', label: '🔷 Polygon Implementation', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Burn Mining Overview', interest: {} }
      ]
    },
    karma: {
      intro: "The 'Karma is the New Merit' proposal replaces subjective 'clique-based' rewards with algorithmic charity. The Siring Model treats charitable curation as a commodity.",
      choices: [
        { id: 'karma_siring', label: '🌱 The Siring Model Algorithm', interest: {philosophy: 20} },
        { id: 'karma_neediness', label: '📊 Neediness Weight Calculation', interest: {philosophy: 15} },
        { id: 'karma_dharma', label: '☯️ 100/100 Dharma Model', interest: {philosophy: 20} },
        { id: 'karma_kula', label: '🔄 Kula Ring Gift Economy', interest: {archaeology: 15, philosophy: 10} }
      ]
    },
    karma_siring: {
      intro: "Siring Formula: (Number of Users Voted × BP Gained) × Neediness Weight. Your rank increases when poor users you vote for become wealthy, active curators.",
      choices: [
        { id: 'karma_bp', label: '💪 Blockchain Power (BP)', interest: {philosophy: 10} },
        { id: 'karma_pyramid', label: '🔺 Multi-Layer Pyramid', interest: {philosophy: 15} },
        { id: 'karma_analytics', label: '📈 Siring Chart Analytics', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Karma Overview', interest: {} }
      ]
    },
    // ========================================
    // OILAHUASCA DIALOGUE TREES
    // ========================================
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
        { id: 'oilahuasca_adducts', label: '🧬 Endogenous Amine Adducts', interest: {philosophy: 20} },
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
    oilahuasca_adducts: {
      intro: "REVOLUTIONARY: Allylbenzenes don't simply convert to amphetamines. They form 1'-oxo metabolites via 17bHSD2 enzyme, which then react with ENDOGENOUS AMINES (dimethylamine, piperidine, pyrrolidine from gut bacteria) to create NOVEL compounds unique to each individual!",
      choices: [
        { id: 'oilahuasca_17bhsd2', label: '🔑 17bHSD2 Master Enzyme', interest: {philosophy: 20} },
        { id: 'oilahuasca_amines', label: '🦠 Gut Microbiome Amines', interest: {philosophy: 15} },
        { id: 'oilahuasca_variation', label: '🎲 Individual Variation', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Theory', interest: {} }
      ]
    },
    oilahuasca_17bhsd2: {
      intro: "17β-HSD2 is the MASTER activation enzyme. Normally inactivates steroids (testosterone→androstenedione). In oilahuasca: converts 1'-hydroxyallylbenzenes → 1'-oxo metabolites (reactive ketones). Requires NAD+ cofactor. Induced by: Gallic acid, Vitamin D3, Vitamin A.",
      choices: [
        { id: 'oilahuasca_nad', label: '⚡ NAD+ Cofactor (Niacinamide)', interest: {philosophy: 15} },
        { id: 'oilahuasca_inducers', label: '📈 17bHSD2 Inducers', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Adducts', interest: {} }
      ]
    },
    oilahuasca_amines: {
      intro: "Endogenous amines for adduct formation come from: 1) GUT BACTERIA - Bacteroides, Clostridium produce dimethylamine, 2) L-LYSINE → Piperidine (colonic conversion, 3+ hours), 3) BLACK PEPPER TEA - direct piperidine source. SSAO enzyme destroys amines - block with GLUCOSAMINE.",
      choices: [
        { id: 'oilahuasca_piperidine', label: '🌶️ Piperidine Sources', interest: {philosophy: 15} },
        { id: 'oilahuasca_ssao', label: '🛡️ SSAO Inhibition', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Adducts', interest: {} }
      ]
    },
    oilahuasca_shulgin: {
      intro: "Dr. Alexander Shulgin (1925-2014) proposed that 10 essential oils could convert to psychoactive compounds via liver metabolism. He called them 'Essential Amphetamines' - though modern research shows they actually form aminopropiophenones, not amphetamines.",
      choices: [
        { id: 'oilahuasca_ten_oils', label: '🧴 The 10 Essential Oils', interest: {esoteric: 15, philosophy: 10} },
        { id: 'oilahuasca_correction', label: '⚠️ Critical Correction', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Oilahuasca', interest: {} }
      ]
    },
    oilahuasca_ten_oils: {
      intro: "Shulgin's 10 Essential Oils → Theoretical Targets:\n• Estragole (basil) → 4-MA\n• Methyleugenol (bay) → 3,4-DMA\n• Safrole (sassafras) → MDA\n• Myristicin (nutmeg) → MMDA ★KEY\n• Elemicin (nutmeg) → TMA\n• Asarone (calamus) → TMA-2\n• Apiole (parsley) → DMMDA ★POTENT\n• Dillapiole (dill) → DMMDA-2 ★POTENT",
      choices: [
        { id: 'oilahuasca_myristicin', label: '⭐ Myristicin (The Key)', interest: {philosophy: 15} },
        { id: 'oilahuasca_methoxy', label: '🔬 Methoxy Pattern Matrix', interest: {philosophy: 20} },
        { id: 'back', label: '← Back to Shulgin', interest: {} }
      ]
    },
    oilahuasca_methoxy: {
      intro: "THREE methoxy patterns in nutmeg create metabolic complexity:\n1) METHYLENEDIOXY (myristicin) - CYP1A2 inhibitor\n2) TRIMETHOXY (elemicin) - like mescaline core\n3) HYDROXY-DIMETHOXY (5-methoxyeugenol) - PPAR-gamma activator\nEach saturates DIFFERENT enzymes = total metabolic overwhelm!",
      choices: [
        { id: 'oilahuasca_elemicin', label: '🌿 Elemicin (Trimethoxy)', interest: {philosophy: 15} },
        { id: 'oilahuasca_5me', label: '✨ 5-Methoxyeugenol', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Essential Oils', interest: {} }
      ]
    },
    oilahuasca_metabolism: {
      intro: "The 3-Step Pathway:\n1️⃣ CYP450 oxidation: Allylbenzene → 1'-Hydroxyallylbenzene\n2️⃣ 17bHSD2 + NAD+: → 1'-Oxo metabolite (reactive ketone)\n3️⃣ Spontaneous Mannich: + Endogenous amines → Tertiary aminopropiophenones\nStep 3 requires NO enzyme - it's spontaneous chemistry!",
      choices: [
        { id: 'oilahuasca_cyp1a2', label: '🔑 CYP1A2 (Primary Enzyme)', interest: {philosophy: 15} },
        { id: 'oilahuasca_phase2', label: '🚫 Phase II Blockade', interest: {philosophy: 15} },
        { id: 'oilahuasca_glutathione', label: '🛡️ Glutathione Depletion', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Oilahuasca', interest: {} }
      ]
    },
    oilahuasca_cyp1a2: {
      intro: "CYP1A2 - The primary enzyme for allylbenzene metabolism:\n• Also metabolizes caffeine (95%)\n• Induced by coffee (2-3x increase over 24-72h)\n• Inhibited by myristicin (mechanism-based - PERMANENT)\n• The KEY target in oilahuasca strategy",
      choices: [
        { id: 'oilahuasca_coffee', label: '☕ Coffee Induction', interest: {philosophy: 10} },
        { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Metabolism', interest: {} }
      ]
    },
    oilahuasca_phase2: {
      intro: "Phase II enzymes must ALL be blocked:\n• UGT (glucuronidation) - Block with STEVIOSIDES\n• SULT (sulfation) - Block with EGCG from green tea\n• GST (glutathione) - Deplete GSH with CINNAMON\n• SSAO (amine oxidase) - Block with GLUCOSAMINE\nNo escape routes = metabolite accumulation!",
      choices: [
        { id: 'oilahuasca_glutathione', label: '🛡️ Glutathione Strategy', interest: {philosophy: 15} },
        { id: 'oilahuasca_blockers', label: '🚫 Complete Blocker List', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Metabolism', interest: {} }
      ]
    },
    oilahuasca_glutathione: {
      intro: "CRITICAL: Glutathione (GSH) BLOCKS myristicin's CYP1A2 inhibition! Depleting GSH removes this 'brake'. CINNAMON (cinnamaldehyde) depletes GSH to ~40% of normal. BUT: Vitamin D3 INDUCES GSH synthesis - must balance with extra cinnamon!",
      choices: [
        { id: 'oilahuasca_cinnamon', label: '🌿 Cinnamon Mechanism', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_herbs: {
      intro: "Key herbs in oilahuasca formulations:\n☕ COFFEE - CYP1A2 inducer (preparation)\n🥜 NUTMEG - CYP1A2 inhibitor + psychoactive precursors\n🌿 CINNAMON - Multi-CYP inhibitor + GSH depletion\n🌶️ BLACK PEPPER - CYP3A4 inhibitor + piperidine source\n🌿 BASIL - SULT inhibitor + estragole substrate",
      choices: [
        { id: 'oilahuasca_coffee', label: '☕ Coffee (Inducer)', interest: {philosophy: 10} },
        { id: 'oilahuasca_nutmeg', label: '🥜 Nutmeg (Star Player)', interest: {esoteric: 15} },
        { id: 'oilahuasca_blockers', label: '🚫 Pathway Blockers', interest: {philosophy: 10} },
        { id: 'oilahuasca_safety', label: '⚠️ Safety & Risks', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Oilahuasca', interest: {} }
      ]
    },
    oilahuasca_coffee: {
      intro: "Coffee induces CYP1A2 by 2-3x over 24-72 hours. Also contains β-CARBOLINES (harman, norharman) - the SAME MAO inhibitors found in ayahuasca! Coffee = enzyme inducer + MAO inhibitor. The paradox: more enzyme = more targets to block = bigger metabolic traffic jam.",
      choices: [
        { id: 'oilahuasca_betacarbolines', label: '🍵 β-Carbolines (MAOIs)', interest: {philosophy: 15} },
        { id: 'oilahuasca_paradox', label: '🤔 The Paradox', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_nutmeg: {
      intro: "Nutmeg is the KEYSTONE:\n• Contains myristicin, elemicin, 5-methoxyeugenol (3 methoxy patterns!)\n• MECHANISM-BASED CYP1A2 inhibitor (kills enzyme permanently)\n• Also has MAO inhibitory properties (Truitt 1963)\n⚠️ Toxic at 10g+, effects last 24-72 hours!",
      choices: [
        { id: 'oilahuasca_mechanism_based', label: '💀 Mechanism-Based Inhibition', interest: {philosophy: 20} },
        { id: 'oilahuasca_myristicin', label: '🔬 Myristicin Studies', interest: {philosophy: 15} },
        { id: 'oilahuasca_safety', label: '⚠️ Safety Concerns', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_mechanism_based: {
      intro: "Mechanism-based inhibition = 'suicide inhibition'. Enzyme processes myristicin → creates REACTIVE intermediate → permanently destroys enzyme. Evidence: 3.21-fold IC50 shift (gets stronger over time). Unlike regular inhibitors, enzyme must be RE-SYNTHESIZED (takes days)!",
      choices: [
        { id: 'oilahuasca_glutathione', label: '🛡️ Glutathione Rescue', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_blockers: {
      intro: "When CYP1A2 blocked, body tries alternate routes. Block these too:\n🌿 CINNAMON - CYP3A4, 2C9, 2A6 + GSH depletion\n🌶️ PEPPER - CYP3A4 + P-glycoprotein\n🫖 GREEN TEA - SULT1A1/1A3 (EGCG)\n🍬 STEVIA - UGT2B7\n💊 GLUCOSAMINE - SSAO\n💊 BERBERINE - CYP2D6, CYP3A4 (NOT CYP2E1!)",
      choices: [
        { id: 'oilahuasca_berberine', label: '💊 Berberine (Key Inhibitor)', interest: {philosophy: 15} },
        { id: 'oilahuasca_cyp2e1', label: '🔥 CYP2E1 (Must INDUCE)', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_berberine: {
      intro: "BERBERINE (500-1000mg) is critical:\n• Potent CYP2D6 inhibitor (CYP2D6 is DETRIMENTAL to activation!)\n• Also inhibits CYP2C9 and CYP3A4\n• Does NOT inhibit CYP2E1 (this selectivity is crucial!)\nCYP2D6 genetic variants explain why some people never respond to nutmeg.",
      choices: [
        { id: 'oilahuasca_cyp2e1', label: '🔥 CYP2E1 (Vital Activator)', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Blockers', interest: {} }
      ]
    },
    oilahuasca_cyp2e1: {
      intro: "CYP2E1 is the VITAL ACTIVATOR - must be INDUCED, not inhibited!\n• Smallest active site of all human P450s\n• Perfect for small hydrophobic allylbenzenes\n• INDUCE with: Glycerol (5-10g), ketogenic diet\n• AVOID inhibitors: Excessive piperine inhibits CYP2E1 (filter black pepper tea!)",
      choices: [
        { id: 'back', label: '← Back to Blockers', interest: {} }
      ]
    },
    oilahuasca_safety: {
      intro: "⚠️ SERIOUS SAFETY CONCERNS:\n• Nutmeg toxic at 10g+ (nausea, tachycardia, convulsions)\n• Effects last 24-72 HOURS (extremely long)\n• Safrole/estragole are hepatotoxic & potentially carcinogenic\n• CYP inhibition affects ALL prescription drugs\n• NO controlled human studies exist\n• This is EXPERIMENTAL - harm reduction essential",
      choices: [
        { id: 'oilahuasca_harm_reduction', label: '🛡️ Harm Reduction', interest: {philosophy: 10} },
        { id: 'oilahuasca_drugs', label: '💊 Drug Interactions', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Herbs', interest: {} }
      ]
    },
    oilahuasca_harm_reduction: {
      intro: "If exploring (NOT a recommendation):\n• Start with VERY LOW doses\n• Never use alone - have a sitter\n• Plan for 24-72 hour duration\n• AVOID if on ANY prescription meds\n• Do NOT use chronically (carcinogenicity)\n• Stay hydrated, do not drive for 3 days\n• Know emergency resources",
      choices: [
        { id: 'oilahuasca_drugs', label: '💊 Drug Interactions', interest: {philosophy: 10} },
        { id: 'back', label: '← Back to Safety', interest: {} }
      ]
    },
    oilahuasca_drugs: {
      intro: "⚠️ CRITICAL DRUG INTERACTIONS:\nCYP450 inhibition affects metabolism of:\n• SSRIs, antidepressants - SEROTONIN SYNDROME risk\n• Benzodiazepines - prolonged sedation\n• Opioids - respiratory depression\n• Blood thinners - bleeding risk\n• Statins - muscle damage\nWait 2 weeks after stopping oilahuasca before resuming meds!",
      choices: [
        { id: 'back', label: '← Back to Safety', interest: {} }
      ]
    },
    oilahuasca_formula: {
      intro: "Original anecdotal formula: Coffee + Almond + Cinnamon + Vanilla + Nutmeg\n☕ Coffee: CYP1A2 induction + β-carbolines\n🥜 Nutmeg: Myristicin/elemicin + CYP1A2 inhibition\n🌿 Cinnamon: Multi-CYP inhibition + GSH depletion\n🍦 Vanilla: Metabolic modulator\n🥜 Almond: Minor (benzaldehyde)",
      choices: [
        { id: 'oilahuasca_herbs', label: '🌿 All Key Herbs', interest: {philosophy: 10} },
        { id: 'oilahuasca_complete', label: '🧪 Complete Protocol', interest: {philosophy: 20} },
        { id: 'back', label: '← Back to Theory', interest: {} }
      ]
    },
    oilahuasca_complete: {
      intro: "COMPLETE ENZYMATIC PROTOCOL:\nPHASE 1 (1-4h before): Gallic acid, Vit D3, Vit A, Niacinamide, Glycerol\nPHASE 2 (with dose): Steviosides, EGCG, Cinnamon, Glucosamine\nPHASE 3 (with dose): Berberine, Coffee, Nutmeg\nPHASE 4: L-Lysine (3h+ before) OR Black pepper tea (filtered)",
      choices: [
        { id: 'oilahuasca_17bhsd2', label: '🔑 Phase 1: 17bHSD2 Induction', interest: {philosophy: 15} },
        { id: 'oilahuasca_phase2', label: '🚫 Phase 2: Pathway Blockade', interest: {philosophy: 15} },
        { id: 'oilahuasca_safety', label: '⚠️ Safety First', interest: {philosophy: 10} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_myristicin: {
      intro: "Myristicin (5-allyl-1-methoxy-2,3-methylenedioxybenzene):\n• Primary psychoactive in nutmeg (1-3%)\n• CYP1A2 substrate AND mechanism-based inhibitor\n• Metabolites: piperidine + pyrrolidine conjugates\n• PMID 26091900: 'most significantly inhibits CYP1A2'\n• Induces GST 4-14 fold (but depleted GSH = no substrate)",
      choices: [
        { id: 'oilahuasca_studies', label: '📚 Research Citations', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_studies: {
      intro: "Key Research Citations:\n• PMID 12523956: CYP3A4 and CYP1A2 in myristicin oxidation\n• PMID 26091900: Myristicin mechanism-based CYP1A2 inhibition\n• PMID 8554622: Myristicin induces CYP450s 2-20 fold\n• PMID 9245741: Myristicin induces GST 4-14 fold\n• Truitt 1963: MAO inhibition evidence",
      choices: [
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    allylbenzenes: {
      intro: "Allylbenzenes: benzene ring + allyl chain (-CH2-CH=CH2) + oxygen substituents. CRITICAL: Only ALLYLbenzenes form psychoactive metabolites - PROPENYLbenzenes (like anethole) do NOT because the conjugated double bond blocks oxidation at the 1' position.",
      choices: [
        { id: 'oilahuasca_allyl_vs_propenyl', label: '⚗️ Allyl vs Propenyl', interest: {philosophy: 15} },
        { id: 'oilahuasca_ten_oils', label: '🧴 The 10 Essential Oils', interest: {esoteric: 10} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_allyl_vs_propenyl: {
      intro: "ALLYL: Benzene-CH2-CH=CH2 (oxidizable at 1') ✓\nPROPENYL: Benzene-CH=CH-CH3 (conjugated, blocked) ✗\n\nActive (allyl): myristicin, safrole, estragole, elemicin, apiole\nNOT active (propenyl): anethole, asarone, isosafrole\n\nFennel is 80-90% anethole (NOT active) but 5-10% estragole (active)",
      choices: [
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    cyp450: {
      intro: "Cytochrome P450 (CYP450) enzymes are the liver's primary drug metabolizers. CYP3A4 handles >50% of all drugs. CYP1A2 handles allylbenzenes + caffeine. CYP2E1 activates small molecules. CYP2D6 DEACTIVATES (must inhibit!). Oilahuasca = precise enzyme orchestra.",
      choices: [
        { id: 'oilahuasca_cyp1a2', label: '🔑 CYP1A2 (Primary)', interest: {philosophy: 15} },
        { id: 'oilahuasca_cyp2e1', label: '🔥 CYP2E1 (Activator)', interest: {philosophy: 15} },
        { id: 'oilahuasca_berberine', label: '💊 CYP2D6 (Block It!)', interest: {philosophy: 15} },
        { id: 'oilahuasca_drugs', label: '💊 Drug Implications', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    shulgin: {
      intro: "Dr. Alexander 'Sasha' Shulgin (1925-2014) - the godfather of psychedelic chemistry. Author of PIHKAL and TIHKAL. Synthesized and self-tested 230+ psychoactive compounds. His 'Essential Amphetamines' theory sparked oilahuasca research.",
      choices: [
        { id: 'oilahuasca_shulgin', label: '🧴 Essential Oils Theory', interest: {philosophy: 15} },
        { id: 'oilahuasca_correction', label: '⚠️ Modern Corrections', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_correction: {
      intro: "CRITICAL CORRECTION: Modern research (1977-2024) shows allylbenzenes do NOT form amphetamines in vivo. They form TERTIARY AMINOPROPIOPHENONES (Mannich bases) via endogenous amine adduct formation - structurally different with different pharmacology than Shulgin predicted.",
      choices: [
        { id: 'oilahuasca_adducts', label: '🧬 Adduct Formation', interest: {philosophy: 20} },
        { id: 'oilahuasca_metabolism', label: '🔬 Actual Pathway', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Shulgin', interest: {} }
      ]
    },
    oilahuasca_variation: {
      intro: "Why same dose affects people differently:\n• Different microbiomes = different endogenous amines\n• CYP2D6 ultra-rapid metabolizers may never respond\n• Different 17bHSD2 levels = different 1'-oxo formation\n• Different NAD+ status = different enzyme activity\n• Recent antibiotics = depleted amine-producing bacteria",
      choices: [
        { id: 'oilahuasca_amines', label: '🦠 Microbiome Factor', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Adducts', interest: {} }
      ]
    },
    oilahuasca_betacarbolines: {
      intro: "Coffee contains β-CARBOLINES formed during roasting:\n• Harman (1-methyl-9H-pyrido[3,4-b]indole)\n• Norharman\nThese are the SAME compounds in ayahuasca (Banisteriopsis caapi)! They inhibit MAO-A and MAO-B. Coffee = natural MAOI + CYP1A2 inducer.",
      choices: [
        { id: 'oilahuasca_mao', label: '🧠 MAO Inhibition', interest: {philosophy: 15} },
        { id: 'back', label: '← Back to Coffee', interest: {} }
      ]
    },
    oilahuasca_mao: {
      intro: "MAO (Monoamine Oxidase) breaks down serotonin, dopamine, tyramine. Coffee β-carbolines + nutmeg myristicin both inhibit MAO. This is why oilahuasca parallels ayahuasca - both combine psychoactive precursors with MAO inhibition to prevent breakdown of active compounds.",
      choices: [
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_cinnamon: {
      intro: "CINNAMON (cinnamaldehyde 100-200mg):\n• Depletes glutathione to ~40% of normal\n• Inhibits CYP3A4, CYP2C9, CYP2A6\n• The reactive aldehyde directly binds GSH\n• Removes the 'brake' on myristicin's CYP1A2 inhibition\n• Essential for the mechanism to work!",
      choices: [
        { id: 'oilahuasca_glutathione', label: '🛡️ GSH Depletion', interest: {philosophy: 15} },
        { id: 'back', label: '← Back', interest: {} }
      ]
    },
    oilahuasca_piperidine: {
      intro: "PIPERIDINE sources:\n1) L-LYSINE (1000-3000mg) → Gut bacteria convert to cadaverine → piperidine (takes 3+ hours to reach colon)\n2) BLACK PEPPER TEA: 5-10g in hot water, FILTER SOLIDS (removes piperine which inhibits CYP2E1)\nPiperidine forms 6-membered ring adducts with unique pharmacology.",
      choices: [
        { id: 'back', label: '← Back to Amines', interest: {} }
      ]
    },
    oilahuasca_ssao: {
      intro: "SSAO (Semicarbazide-Sensitive Amine Oxidase) destroys primary amines needed for adduct formation. Block with GLUCOSAMINE (1500mg) - acts as competitive inhibitor. Dose 1 hour before and every 4-6 hours. Different from MAO - both must be addressed!",
      choices: [
        { id: 'back', label: '← Back to Amines', interest: {} }
      ]
    },
    oilahuasca_nad: {
      intro: "NAD+ is ESSENTIAL - 17bHSD2 cannot function without it!\nNiacinamide (500-1000mg) → NMN → NAD+\nUse NIACINAMIDE not niacin (niacin causes flushing)\nDose 1 hour before for optimal levels\nWhy some don't respond: Poor NAD+ synthesis, B-vitamin deficiency, aging",
      choices: [
        { id: 'back', label: '← Back to 17bHSD2', interest: {} }
      ]
    },
    oilahuasca_inducers: {
      intro: "17bHSD2 INDUCERS (take 1-4h before):\n• Gallic acid (500mg) - BUT also induces SULT (pair with EGCG)\n• Vitamin D3 (2000-5000 IU) - BUT induces GSH (pair with extra cinnamon)\n• Vitamin A (5000-10,000 IU)\n• AVOID Genistein - binds 5-HT receptors, may reduce effects",
      choices: [
        { id: 'back', label: '← Back to 17bHSD2', interest: {} }
      ]
    },
    oilahuasca_elemicin: {
      intro: "ELEMICIN (3,4,5-trimethoxybenzene pattern):\n• Same trimethoxy pattern as MESCALINE\n• May convert to TMA (trimethoxyamphetamine)\n• Requires sequential demethylation (multiple enzyme steps)\n• Creates 'traffic jam' when combined with myristicin\n• Hepatotoxicity documented - affects gut microbiota",
      choices: [
        { id: 'back', label: '← Back to Methoxy Patterns', interest: {} }
      ]
    },
    oilahuasca_5me: {
      intro: "5-METHOXYEUGENOL (syring pattern: OH between two methoxys):\n• Found in nutmeg CRUDE EXTRACT but NOT essential oil!\n• Activates PPAR-gamma (affects liver metabolism broadly)\n• Requires specialized enzymes (SyoA) for demethylation\n• Rate-limiting = forces alternative pathways\n• Also in magnolia",
      choices: [
        { id: 'back', label: '← Back to Methoxy Patterns', interest: {} }
      ]
    }
  }
};

function createDialogueButtons(dialogueKey) {
  const dialogue = cryptologyDialogues.trees[dialogueKey];
  if (!dialogue) return null;

  const rows = [];
  let currentRow = new ActionRowBuilder();

  dialogue.choices.forEach((choice, index) => {
    // Discord allows max 5 buttons per row, max 5 rows
    if (index > 0 && index % 5 === 0) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }

    const button = new ButtonBuilder()
      .setCustomId(`crypt_${choice.id}`)
      .setLabel(choice.label)
      .setStyle(choice.id === 'back' ? ButtonStyle.Secondary : ButtonStyle.Primary);

    currentRow.addComponents(button);
  });

  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  return { intro: dialogue.intro, rows };
}

// Discord ready event
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🌿 Van Kush Family Bot is ready!`);

  // Initial price fetch
  await checkPriceAlerts();
  console.log('📊 Price monitoring initialized');
  console.log('🎮 Crypt-ology dialogue system loaded');
});

// ========================================
// BUTTON INTERACTION HANDLER
// ========================================
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    const relationship = getOrCreateRelationship(userId);

    // Handle Crypt-ology dialogue buttons
    if (interaction.customId.startsWith('crypt_')) {
      const choiceId = interaction.customId.replace('crypt_', '');

      // Find the choice in dialogue trees
      let selectedChoice = null;
      let nextDialogue = null;

      for (const [treeKey, tree] of Object.entries(cryptologyDialogues.trees)) {
        const choice = tree.choices?.find(c => c.id === choiceId);
        if (choice) {
          selectedChoice = choice;
          // Update user interests based on choice
          if (choice.interest && Object.keys(choice.interest).length > 0) {
            updateRelationship(userId, {
              interests: choice.interest,
              pathChoice: choiceId,
              pathContext: treeKey,
              familiarity: 2,
              respect: 1
            });
          }
          break;
        }
      }

      // Get next dialogue
      nextDialogue = cryptologyDialogues.trees[choiceId];

      if (nextDialogue) {
        // Continue dialogue tree
        const buttonData = createDialogueButtons(choiceId);

        await interaction.update({
          content: `🔮 **Crypt-ology Exploration**\n\n${buttonData.intro}`,
          components: buttonData.rows
        });
      } else if (choiceId === 'back') {
        // Go back (simplified - would need stack in full implementation)
        await interaction.update({
          content: '🔮 **Crypt-ology**\n\nWhat mysterious topic shall we explore?',
          components: []
        });
      } else {
        // Leaf node - AI generates response using canned content as guidance/bias
        await interaction.deferUpdate();

        const searchQuery = choiceId.replace(/_/g, ' ');
        let response = '';

        // Get canned response as GUIDANCE for AI (not direct output)
        const cannedGuidance = getOilahuascaResponse(searchQuery);

        try {
          const tone = getConversationTone(relationship);
          let aiContext = buildOilahuascaContext();

          let prompt = `You are the Van Kush Family Assistant with expert knowledge.
USER CLICKED: "${searchQuery}" button
${cannedGuidance ? `\nKEY FACTS TO INCORPORATE (use as guidance, weave naturally):\n${cannedGuidance}\n` : ''}
Generate a comprehensive, conversational response about "${searchQuery}".
Use the knowledge base context below. Be informative and engaging.
Keep response under 1800 characters.
${tone === 'intellectual' ? 'Use scholarly depth.' : 'Be accessible but informative.'}

KNOWLEDGE BASE:
${aiContext.substring(0, 2500)}`;

          const result = await model.generateContent(prompt);
          let aiText = result.response.text();
          if (aiText.length > 1800) aiText = aiText.substring(0, 1800) + '...';
          response = `🔮 **${searchQuery}**\n\n${aiText}`;
        } catch (error) {
          console.error('Crypt-ology AI error:', error);
          // Fallback to canned response if AI fails
          response = cannedGuidance || '🔮 The mysteries are clouded. Try asking me directly!';
        }

        // Generate optional follow-up suggestion buttons
        const suggestedTopics = generateDynamicCryptologyButtons(response, searchQuery);
        let components = [];
        if (suggestedTopics.length > 0) {
          const row = new ActionRowBuilder();
          for (let i = 0; i < Math.min(suggestedTopics.length, 4); i++) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId(`crypto_chat_${suggestedTopics[i].id}`)
                .setLabel(suggestedTopics[i].label.substring(0, 80))
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(suggestedTopics[i].emoji || '💡')
            );
          }
          components.push(row);
        }

        await interaction.editReply({ content: response, components });
      }
    }

    // Handle FREE CHAT buttons (crypto_chat_*)
    if (interaction.customId.startsWith('crypto_chat_')) {
      await interaction.deferUpdate();

      const action = interaction.customId.replace('crypto_chat_', '');

      // Handle end chat
      if (action === 'end') {
        cryptologyFreeChatSessions.delete(userId);
        await interaction.editReply({
          content: '🔮 **Oilahuasca Free Chat ended.**\n\nThank you for exploring with us! Use `/oilchat` anytime to start a new conversation.',
          embeds: [],
          components: []
        });
        return;
      }

      // Handle "Ask Anything" - just prompt for free input
      if (action === 'free') {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('💬 Ask Anything')
          .setDescription("Type your question in chat! I'll respond with AI-powered knowledge from our oilahuasca database.\n\nJust mention the bot or reply to this message with your question.")
          .setFooter({ text: 'Free-form conversation mode active' });

        await interaction.editReply({
          embeds: [embed],
          components: []
        });
        return;
      }

      // Handle topic button click - generate AI response for that topic
      const topicName = action.replace(/_/g, ' ');
      const session = getCryptologySession(userId) || startCryptologyFreeChat(userId, action);

      // Update session with new topic
      updateCryptologySession(userId, { currentTopic: action });

      // Build context and generate AI response
      let chatContext = buildOilahuascaContext();
      if (session.isExperienceReport) {
        chatContext += buildExperienceSupportContext();
      }

      let aiResponse;
      try {
        const prompt = `${chatContext}\n\nUser clicked "${topicName}" topic button. Provide a comprehensive but conversational explanation of ${topicName} in the context of oilahuasca theory. Include key facts, mechanisms, and any safety considerations. Keep response under 1500 characters.`;
        const result = await model.generateContent(prompt);
        aiResponse = result.response.text();
        if (aiResponse.length > 1800) {
          aiResponse = aiResponse.substring(0, 1800) + '...';
        }
      } catch (error) {
        console.error('Gemini error in crypto_chat button:', error);
        // Fallback to static response
        aiResponse = getOilahuascaResponse(topicName) ||
          `🔮 **${topicName.charAt(0).toUpperCase() + topicName.slice(1)}**\n\nLet me tell you about ${topicName} in the context of oilahuasca theory. Feel free to ask specific questions!`;
      }

      // Generate new dynamic buttons based on new response
      const dynamicButtons = generateDynamicCryptologyButtons(aiResponse, action);

      // Create button rows
      const rows = [];
      let currentRow = new ActionRowBuilder();
      let buttonCount = 0;

      for (const btn of dynamicButtons) {
        const button = new ButtonBuilder()
          .setCustomId(btn.id)
          .setLabel(btn.label)
          .setStyle(btn.style === 'Primary' ? ButtonStyle.Primary :
                    btn.style === 'Success' ? ButtonStyle.Success :
                    btn.style === 'Danger' ? ButtonStyle.Danger :
                    ButtonStyle.Secondary);

        currentRow.addComponents(button);
        buttonCount++;

        if (buttonCount >= 4) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
          buttonCount = 0;
        }
      }

      // Add "End Chat" button
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId('crypto_chat_end')
          .setLabel('🚪 End Chat')
          .setStyle(ButtonStyle.Danger)
      );
      rows.push(currentRow);

      const embed = new EmbedBuilder()
        .setColor(session.isExperienceReport ? 0xe74c3c : 0x9b59b6)
        .setTitle(`🔮 ${topicName.charAt(0).toUpperCase() + topicName.slice(1)}`)
        .setDescription(aiResponse)
        .setFooter({ text: 'Type freely or click buttons • AI + Local Knowledge Base' });

      await interaction.editReply({
        embeds: [embed],
        components: rows
      });
    }
  } catch (error) {
    console.error('❌ Interaction error:', error);

    // Attempt to notify user of the error
    try {
      const errorMessage = '❌ An error occurred processing your button click.\n\n' +
        '**Possible causes:**\n' +
        '• Expired Google/Gemini API key\n' +
        '• Network connectivity issue\n' +
        '• Bot permissions issue\n\n' +
        'Please check GOOGLE_API_KEY_RENEWAL.md or try again later.';

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: errorMessage,
          components: []
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true,
          components: []
        });
      }
    } catch (replyError) {
      console.error('❌ Could not send error message to user:', replyError);
      console.error('Original error was:', error);
    }
  }
});

// Message handler
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check for slash commands
  if (message.content.startsWith('/')) {
    const args = message.content.slice(1).split(' ');
    const command = args[0].toLowerCase();

    // /generate command for AI art
    if (command === 'generate') {
      const prompt = args.slice(1).join(' ');
      if (!prompt) {
        return message.reply('Please provide a prompt! Example: `/generate Hathor goddess with Egyptian symbols`');
      }

      await message.channel.sendTyping();
      const imageUrl = await generateArt(prompt);

      if (imageUrl) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('✨ AI Generated Art')
          .setDescription(`**Prompt:** ${prompt}`)
          .setImage(imageUrl)
          .setFooter({ text: 'Generated by Pollinations.ai' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply('Sorry, I encountered an error generating the image. Please try again.');
      }
      return;
    }

    // /price command for crypto prices
    if (command === 'price') {
      const token = args[1]?.toUpperCase() || 'VKBT';
      await message.channel.sendTyping();

      const priceData = await getHiveEnginePrice(token);
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`💰 ${token} Price`)
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • hive-engine.com' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply(`Could not fetch price data for ${token}. Make sure the token exists on HIVE-Engine.`);
      }
      return;
    }

    // /rs3 command for RuneScape 3 item prices
    if (command === 'rs3') {
      const itemName = args.slice(1).join(' ');
      if (!itemName) {
        return message.reply('Please provide an item name! Example: `/rs3 Dragon bones`');
      }

      await message.channel.sendTyping();
      const priceData = await getRS3ItemPrice(itemName);

      if (priceData && priceData.price !== undefined && priceData.timestamp !== undefined) {
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle(`⚔️ RS3 Grand Exchange: ${priceData.name}`)
          .addFields(
            { name: 'Current Price', value: `${priceData.price.toLocaleString()} gp`, inline: true },
            { name: 'Last Updated', value: new Date(priceData.timestamp * 1000).toLocaleString(), inline: true }
          )
          .setFooter({ text: 'Data from RuneScape Wiki API' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply(`Could not find price data for "${itemName}". Try checking the exact item name!`);
      }
      return;
    }

    // /cryptology command for NPC dialogue exploration
    if (command === 'cryptology' || command === 'crypt' || command === 'explore') {
      const topic = args[1]?.toLowerCase();

      // Get user relationship to personalize
      const relationship = getOrCreateRelationship(message.author.id);

      if (topic && cryptologyDialogues.trees[topic]) {
        // Specific topic requested
        const buttonData = createDialogueButtons(topic);
        await message.reply({
          content: `🔮 **Crypt-ology: ${topic.charAt(0).toUpperCase() + topic.slice(1)}**\n\n${buttonData.intro}`,
          components: buttonData.rows
        });
      } else {
        // Show main menu with topics user might be interested in
        const topInterests = Object.entries(relationship.interests)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([topic]) => topic);

        let suggestionText = '';
        if (topInterests.length > 0 && topInterests[0] > 20) {
          suggestionText = `\n\n📊 Based on our conversations, you might enjoy: **${topInterests.join(', ')}**`;
        }

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('🔮 Crypt-ology: The Not-a-Game')
          .setDescription('Explore esoteric knowledge through guided conversations. Choose a topic to begin your journey into ancient mysteries.' + suggestionText)
          .addFields(
            { name: '📖 Available Topics', value: '• **nephilim** - Giants, Watchers, Book of Enoch\n• **phoenicians** - Tanit, Carthage, Punic Wars\n• **egypt** - Hathor, Osiris, Ancient Mysteries\n• **denisovans** - 75,000-year lineage, human origins\n• **oilahuasca** - CYP450 enzyme activation, allylbenzenes\n• **shulgin** - Essential oils, psychedelic chemistry\n• **cyp450** - Liver enzymes, drug metabolism' },
            { name: '🎮 How to Play', value: 'Type `/cryptology [topic]` to explore\nExample: `/cryptology nephilim`\n\nOr just mention keywords like "Nephilim" or "Hathor" in conversation!' }
          )
          .setFooter({ text: 'Your choices shape our future conversations' });

        await message.reply({ embeds: [embed] });
      }
      return;
    }

    // /oilchat command - Free-flowing oilahuasca conversation with AI
    if (command === 'oilchat' || command === 'oilhelp' || command === 'spicechat') {
      await message.channel.sendTyping();

      // Get any initial question from args
      const userQuestion = args.slice(1).join(' ');

      // Start a free chat session
      const session = startCryptologyFreeChat(message.author.id, 'oilahuasca');

      // Check if this might be an experience report
      const isExperience = userQuestion && detectExperienceReport(userQuestion);
      if (isExperience) {
        session.isExperienceReport = true;
        updateCryptologySession(message.author.id, { isExperienceReport: true });
      }

      // Build context with oilahuasca knowledge
      let chatContext = buildOilahuascaContext();
      if (isExperience) {
        chatContext += buildExperienceSupportContext();
      }

      // Generate AI response using Gemini
      let aiResponse;
      if (userQuestion) {
        try {
          const prompt = `${chatContext}\n\nUser asks: "${userQuestion}"\n\nProvide a helpful, knowledgeable response about oilahuasca/allylbenzene theory. Be conversational but informative. Keep response under 1500 characters.`;
          const result = await model.generateContent(prompt);
          aiResponse = result.response.text();
          if (aiResponse.length > 1800) {
            aiResponse = aiResponse.substring(0, 1800) + '...';
          }
        } catch (error) {
          console.error('Gemini error in oilchat:', error);
          aiResponse = getOilahuascaResponse(userQuestion) ||
            "🔮 Welcome to the Oilahuasca knowledge chat! I'm here to discuss CYP450 enzyme manipulation, allylbenzenes, space paste recipes, and more. What would you like to explore?";
        }
      } else {
        aiResponse = `🔮 **Welcome to Oilahuasca Free Chat**

I'm your guide to understanding the science of sacred spice alchemy. Unlike the button-driven Cryptology system, here we can have a **free-flowing conversation**.

**What I can help with:**
• The science of CYP450 enzyme manipulation
• Allylbenzene compounds and their metabolism
• Space paste recipes and ingredient analysis
• Shulgin's essential oil research
• Safety information and harm reduction
• **Live experience support** - if you're currently experiencing effects

Just type your questions naturally, or click a topic button below to explore. I'm here to help! 🌿`;
      }

      // Generate dynamic buttons based on response
      const dynamicButtons = generateDynamicCryptologyButtons(aiResponse, 'oilahuasca');

      // Create button rows
      const rows = [];
      let currentRow = new ActionRowBuilder();
      let buttonCount = 0;

      for (const btn of dynamicButtons) {
        const button = new ButtonBuilder()
          .setCustomId(btn.id)
          .setLabel(btn.label)
          .setStyle(btn.style === 'Primary' ? ButtonStyle.Primary :
                    btn.style === 'Success' ? ButtonStyle.Success :
                    btn.style === 'Danger' ? ButtonStyle.Danger :
                    ButtonStyle.Secondary);

        currentRow.addComponents(button);
        buttonCount++;

        if (buttonCount >= 4) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
          buttonCount = 0;
        }
      }

      // Add "End Chat" button
      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId('crypto_chat_end')
          .setLabel('🚪 End Chat')
          .setStyle(ButtonStyle.Danger)
      );
      rows.push(currentRow);

      const embed = new EmbedBuilder()
        .setColor(isExperience ? 0xe74c3c : 0x9b59b6)
        .setTitle(isExperience ? '🌀 Experience Support Mode' : '🔮 Oilahuasca Free Chat')
        .setDescription(aiResponse)
        .setFooter({ text: 'Type freely or click buttons • Knowledge from local database + AI' });

      await message.reply({ embeds: [embed], components: rows });
      return;
    }

    // /portfolio command - Show wallet holdings
    if (command === 'portfolio') {
      await message.channel.sendTyping();

      try {
        const fs = require('fs');
        if (!fs.existsSync('./vankush-portfolio-data.json')) {
          return message.reply('📊 Portfolio tracker not running yet. Start it with: `node vankush-portfolio-tracker.js`');
        }

        const portfolioData = JSON.parse(fs.readFileSync('./vankush-portfolio-data.json', 'utf8'));
        const latestUpdate = portfolioData.updates[portfolioData.updates.length - 1];

        if (!latestUpdate) {
          return message.reply('📊 No portfolio data available yet. Waiting for first update...');
        }

        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('💎 Van Kush Portfolio')
          .setDescription(`Tracking since: ${new Date(portfolioData.startTime).toLocaleString()}`)
          .addFields(
            { name: '💰 Total Value', value: `${latestUpdate.totalValueHive.toFixed(2)} HIVE\n$${latestUpdate.totalValueUSD.toFixed(2)} USD`, inline: true },
            { name: '📊 HIVE Price', value: `$${latestUpdate.hivePrice.toFixed(4)}`, inline: true },
            { name: '📈 Updates', value: `${portfolioData.updates.length}`, inline: true }
          )
          .setTimestamp(new Date(latestUpdate.timestamp));

        // Add priority tokens
        if (latestUpdate.priorityTokens) {
          let tokenFields = [];
          for (const [symbol, data] of Object.entries(latestUpdate.priorityTokens)) {
            tokenFields.push({
              name: symbol,
              value: `${data.amount.toFixed(4)}\n$${data.valueUSD.toFixed(2)}`,
              inline: true
            });
          }
          embed.addFields(...tokenFields);
        }

        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error reading portfolio data:', error);
        await message.reply('❌ Error reading portfolio data. Make sure the portfolio tracker is running.');
      }
      return;
    }

    // /vkbt command - VKBT token status
    if (command === 'vkbt') {
      await message.channel.sendTyping();

      const priceData = await getHiveEnginePrice('VKBT');
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('💎 VKBT (Van Kush Beauty Token)')
          .setDescription('Tier 1 Core Token - Highest Priority')
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true },
            { name: 'Highest Bid', value: `${priceData.highestBid.toFixed(8)} HIVE`, inline: true },
            { name: 'Lowest Ask', value: `${priceData.lowestAsk.toFixed(8)} HIVE`, inline: true },
            { name: '\u200B', value: '\u200B', inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • See TRADING_STRATEGY.md for details' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply('Could not fetch VKBT price data. The token may not exist on HIVE-Engine yet.');
      }
      return;
    }

    // /cure command - CURE token status
    if (command === 'cure') {
      await message.channel.sendTyping();

      const priceData = await getHiveEnginePrice('CURE');
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('💎 CURE (Van Kush Token)')
          .setDescription('Tier 1 Core Token - Highest Priority')
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true },
            { name: 'Highest Bid', value: `${priceData.highestBid.toFixed(8)} HIVE`, inline: true },
            { name: 'Lowest Ask', value: `${priceData.lowestAsk.toFixed(8)} HIVE`, inline: true },
            { name: '\u200B', value: '\u200B', inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • See TRADING_STRATEGY.md for details' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } else {
        await message.reply('Could not fetch CURE price data. The token may not exist on HIVE-Engine yet.');
      }
      return;
    }

    // /pnl command - Profit/Loss report
    if (command === 'pnl') {
      await message.channel.sendTyping();

      try {
        const fs = require('fs');
        if (!fs.existsSync('./vankush-portfolio-data.json')) {
          return message.reply('📊 Portfolio tracker not running yet. Start it with: `node vankush-portfolio-tracker.js`');
        }

        const portfolioData = JSON.parse(fs.readFileSync('./vankush-portfolio-data.json', 'utf8'));
        const latestUpdate = portfolioData.updates[portfolioData.updates.length - 1];

        if (!latestUpdate || !portfolioData.startingBalances) {
          return message.reply('📊 Not enough data for P&L calculation. Waiting for more updates...');
        }

        // Calculate performance metrics
        const startHive = portfolioData.startingBalances['SWAP.HIVE']?.amount || 0;
        const currentHive = latestUpdate.priorityTokens['SWAP.HIVE']?.amount || 0;
        const hiveChange = startHive > 0 ? ((currentHive - startHive) / startHive) * 100 : 0;

        const hivePriceChange = portfolioData.startingHivePrice > 0
          ? ((latestUpdate.hivePrice - portfolioData.startingHivePrice) / portfolioData.startingHivePrice) * 100
          : 0;

        const embed = new EmbedBuilder()
          .setColor(hiveChange >= 0 ? 0x00ff00 : 0xff0000)
          .setTitle('📈 Van Kush P&L Report')
          .setDescription(`Performance since ${new Date(portfolioData.startTime).toLocaleDateString()}`)
          .addFields(
            { name: '💰 HIVE Balance', value: `${(hiveChange >= 0 ? '+' : '')}${hiveChange.toFixed(2)}%\n${startHive.toFixed(2)} → ${currentHive.toFixed(2)} HIVE`, inline: true },
            { name: '📊 HIVE Price', value: `${(hivePriceChange >= 0 ? '+' : '')}${hivePriceChange.toFixed(2)}%\n$${portfolioData.startingHivePrice.toFixed(4)} → $${latestUpdate.hivePrice.toFixed(4)}`, inline: true },
            { name: '⏱️ Tracking Time', value: `${Math.floor((Date.now() - new Date(portfolioData.startTime)) / (1000 * 60 * 60 * 24))} days`, inline: true }
          )
          .setFooter({ text: 'Goal: End HIVE balance > Starting HIVE balance' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error calculating P&L:', error);
        await message.reply('❌ Error calculating P&L. Make sure the portfolio tracker is running.');
      }
      return;
    }

    // /arbitrage command - Recent arbitrage opportunities
    if (command === 'arbitrage') {
      await message.channel.sendTyping();

      try {
        const fs = require('fs');
        if (!fs.existsSync('./vankush-arbitrage-history.json')) {
          return message.reply('🔍 Arbitrage scanner not running yet. Start it with: `node vankush-arbitrage-scanner.js`');
        }

        const arbData = JSON.parse(fs.readFileSync('./vankush-arbitrage-history.json', 'utf8'));

        if (arbData.opportunities.length === 0) {
          return message.reply('🔍 No arbitrage opportunities found yet. Scanner is still searching...');
        }

        // Get most recent opportunities (last 5)
        const recentOpps = arbData.opportunities.slice(-5).reverse();

        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle('🚨 Recent Arbitrage Opportunities')
          .setDescription(`Total scans: ${arbData.scans} | Opportunities found: ${arbData.opportunitiesFound}`)
          .setFooter({ text: 'Alert-only mode • Manual approval required' })
          .setTimestamp();

        for (const opp of recentOpps) {
          const age = Math.floor((Date.now() - new Date(opp.metadata.timestamp)) / (1000 * 60));
          embed.addFields({
            name: `${opp.symbol} (${age}m ago)`,
            value: `**Net Profit:** ${opp.netProfitPercent.toFixed(2)}%\n` +
                   `HIVE-Engine: $${opp.hiveEnginePrice.inUSD.toFixed(2)}\n` +
                   `External: $${opp.externalPrice.toFixed(2)}\n` +
                   `Example $1K trade: $${opp.exampleTrade.netProfit.toFixed(2)} profit`,
            inline: false
          });
        }

        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Error reading arbitrage data:', error);
        await message.reply('❌ Error reading arbitrage data. Make sure the scanner is running.');
      }
      return;
    }

    // /bots command - Bot status dashboard
    if (command === 'bots') {
      const fs = require('fs');

      const botStatus = {
        portfolio: fs.existsSync('./vankush-portfolio-data.json'),
        arbitrage: fs.existsSync('./vankush-arbitrage-history.json'),
        marketMaker: fs.existsSync('./vankush-market-state.json'),
        trading: fs.existsSync('./hive-trading-state.json')
      };

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🤖 Van Kush Bot Status Dashboard')
        .setDescription('Status of all trading bots in the ecosystem')
        .addFields(
          {
            name: '💎 Market Maker',
            value: botStatus.marketMaker
              ? '✅ Active (vankush-market-maker.js)\nNudging VKBT/CURE prices'
              : '⚠️ Not running\nStart: `node vankush-market-maker.js`',
            inline: false
          },
          {
            name: '📊 Portfolio Tracker',
            value: botStatus.portfolio
              ? '✅ Active (vankush-portfolio-tracker.js)\nMonitoring wallet balances'
              : '⚠️ Not running\nStart: `node vankush-portfolio-tracker.js`',
            inline: false
          },
          {
            name: '🔍 Arbitrage Scanner',
            value: botStatus.arbitrage
              ? '✅ Active (vankush-arbitrage-scanner.js)\nScanning Swap.* opportunities'
              : '⚠️ Not running\nStart: `node vankush-arbitrage-scanner.js`',
            inline: false
          },
          {
            name: '💹 HIVE-Engine Trader',
            value: botStatus.trading
              ? '✅ Active (hive-trading-bot.js)\nExecuting trades'
              : '⚠️ Not running\nStart: `node hive-trading-bot.js`',
            inline: false
          }
        )
        .setFooter({ text: 'See TRADING_STRATEGY.md for strategy details' })
        .setTimestamp();

      await message.reply({ embeds: [embed] });
      return;
    }

    // /help command
    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('🌿 Van Kush Family Bot Commands')
        .setDescription('Here are all available commands and features:')
        .addFields(
          { name: '💎 Trading & Portfolio', value: '`/portfolio` - Show wallet holdings\n`/vkbt` - VKBT token status\n`/cure` - CURE token status\n`/pnl` - Profit/loss report\n`/arbitrage` - Recent opportunities\n`/bots` - Bot status dashboard' },
          { name: '💰 Market Data', value: '`/price [token]` - HIVE-Engine token price\nExample: `/price BEE`' },
          { name: '🎨 AI & Content', value: '`/generate [prompt]` - Generate AI art\n`/cryptology [topic]` - Explore mysteries (button-driven)\n`/oilchat [question]` - **FREE CHAT** about oilahuasca\nExample: `/oilchat what is myristicin`' },
          { name: '⚔️ Gaming', value: '`/rs3 [item]` - RuneScape 3 prices\nExample: `/rs3 Dragon bones`' },
          { name: '❓ Help', value: '`/help` - Show this message' },
          { name: '💬 Chat Features', value: '• @mention me or DM me to chat!\n• I search Wikipedia, Google, Discord\n• I summarize YouTube videos\n• I respond to keywords (VKBT, quest, price)\n• I can analyze images!' },
          { name: '🤖 Proactive Features', value: '• I monitor keywords without @mention\n• I respond to help-seeking phrases\n• Natural commands work (e.g., "show me the price of VKBT")\n• New users get welcome messages!' },
          { name: '📅 Scheduled Posts', value: '• Daily motivation at 9 AM UTC\n• Weekly crypto summary Sundays 8 PM UTC' }
        )
        .setFooter({ text: 'Angels and demons? We\'re cousins, really.' });

      await message.reply({ embeds: [embed] });
      return;
    }
  }

  // Check for YouTube URLs
  const youtubeUrlMatch = message.content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#\s]+)/);
  if (youtubeUrlMatch) {
    await message.channel.sendTyping();
    const transcript = await getYouTubeTranscript(message.content);

    if (transcript) {
      try {
        const summary = await model.generateContent(`Summarize this YouTube video transcript in 2-3 paragraphs:\n\n${transcript.substring(0, 8000)}`);
        const summaryText = summary.response.text();

        const embed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('📺 YouTube Video Summary')
          .setDescription(summaryText)
          .setFooter({ text: 'Summary generated by Gemini AI' });

        await message.reply({ embeds: [embed] });
        return;
      } catch (error) {
        console.error('Error summarizing video:', error);
      }
    }
  }

  // Track user messages for welcome system
  await trackUserMessage(message.author.id, message.channel.id);

  // Check if this is a reply to one of the bot's messages
  const isReplyToBot = message.reference && botMessageIds.has(message.reference.messageId);

  // Check for proactive keywords
  const containsKeyword = PROACTIVE_KEYWORDS.some(keyword =>
    message.content.toLowerCase().includes(keyword.toLowerCase())
  );

  // Intent Recognition: Help-seeking phrases (Proactive Engagement)
  const helpSeekingPatterns = [
    // Availability checks
    { pattern: /(?:is )?(?:anyone|anybody) (?:here|around|awake|online|available)\??/i, category: 'availability' },
    { pattern: /(?:anyone|anybody) (?:can|able to) help\??/i, category: 'availability' },
    { pattern: /dead chat/i, category: 'availability' },
    { pattern: /(?:hello|hi|hey)[?!]*$/i, category: 'availability' },

    // Distress/Urgency
    { pattern: /(?:i'?m |i am )?(?:stuck|lost|confused)/i, category: 'distress' },
    { pattern: /(?:need|want) (?:a |some )?help/i, category: 'distress' },
    { pattern: /(?:can|could) (?:someone|anybody|anyone) (?:help|explain|show)/i, category: 'distress' },
    { pattern: /quick question/i, category: 'distress' },
    { pattern: /(?:help|assist) me/i, category: 'distress' },

    // Social seeking
    { pattern: /(?:i'?m |i am )?bored/i, category: 'social' },
    { pattern: /what'?s? (?:everyone|everybody) (?:up to|doing)\??/i, category: 'social' },
    { pattern: /(?:anyone|anybody) (?:want|wanna) (?:to )?(?:chat|talk|play)/i, category: 'social' },

    // Verification/Onboarding
    { pattern: /how (?:do|can) i (?:get in|join|access)/i, category: 'onboarding' },
    { pattern: /where (?:do|can) i (?:go|find)/i, category: 'onboarding' },
    { pattern: /(?:i )?(?:can'?t|cannot) see (?:the |any )?channel/i, category: 'onboarding' }
  ];

  let helpIntent = null;
  for (const { pattern, category } of helpSeekingPatterns) {
    if (pattern.test(message.content)) {
      helpIntent = { category, originalMessage: message.content };
      break;
    }
  }

  // Respond to help-seeking intents proactively
  if (helpIntent && !client.user.id === message.author.id) {
    const responses = {
      availability: [
        "👋 I'm here! How can I help you today?",
        "🌿 Hey! I'm always around. What's on your mind?",
        "✨ Not a dead chat at all! I'm listening. What do you need?",
        "💬 I'm online and ready to chat! Ask away!"
      ],
      distress: [
        "🆘 I'm here to help! What's the issue you're facing?",
        "💡 Let me assist you. Could you describe what's confusing you?",
        "🤝 Don't worry, I'm here! Tell me more about what you're stuck on.",
        "📚 I'm listening! Fire away with your question."
      ],
      social: [
        "💭 I'm here for a chat! What interests you?",
        "🎮 Always up for conversation! What would you like to talk about?",
        "🌟 I'm around! Want to explore ancient mysteries, crypto, or something else?",
        "💬 Let's chat! Try asking me about VKBT, CURE, or use `/cryptology` to explore topics!"
      ],
      onboarding: [
        "🗺️ Welcome! I can help you navigate. What are you looking for?",
        "👋 New here? Let me help you get oriented! What channels or features are you looking for?",
        "📍 I'm here to guide you! Tell me what you need access to.",
        "🔑 Having trouble accessing something? Let me know and I'll help!"
      ]
    };

    const responseList = responses[helpIntent.category] || responses.availability;
    const response = responseList[Math.floor(Math.random() * responseList.length)];

    await message.reply(response);
    return;
  }

  // Natural command detection (without slash)
  const naturalCommandPatterns = [
    { pattern: /(?:show|get|check|what'?s?) (?:the )?price (?:of |for )?(\w+)/i, type: 'price' },
    { pattern: /(?:generate|create|make|draw) (?:an? )?(?:image|art|picture) (?:of |about )?(.+)/i, type: 'generate' },
    { pattern: /(?:rs3|runescape|ge) price (?:of |for )?(.+)/i, type: 'rs3' },
    { pattern: /(?:search|look up|find|tell me about) (.+)/i, type: 'search' }
  ];

  let naturalCommand = null;
  for (const { pattern, type } of naturalCommandPatterns) {
    const match = message.content.match(pattern);
    if (match) {
      naturalCommand = { type, query: match[1] };
      break;
    }
  }

  // Execute natural commands
  if (naturalCommand) {
    await message.channel.sendTyping();

    if (naturalCommand.type === 'price') {
      const token = naturalCommand.query.toUpperCase();
      const priceData = await getHiveEnginePrice(token);
      if (priceData) {
        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle(`💰 ${token} Price`)
          .addFields(
            { name: 'Last Price', value: `${priceData.lastPrice.toFixed(8)} HIVE`, inline: true },
            { name: '24h Volume', value: `${priceData.volume.toFixed(2)} HIVE`, inline: true },
            { name: '24h Change', value: `${priceData.priceChangePercent.toFixed(2)}%`, inline: true }
          )
          .setFooter({ text: 'HIVE-Engine • hive-engine.com' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }
    } else if (naturalCommand.type === 'generate') {
      const imageUrl = await generateArt(naturalCommand.query);
      if (imageUrl) {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle('✨ AI Generated Art')
          .setDescription(`**Prompt:** ${naturalCommand.query}`)
          .setImage(imageUrl)
          .setFooter({ text: 'Generated by Pollinations.ai' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }
    } else if (naturalCommand.type === 'rs3') {
      const priceData = await getRS3ItemPrice(naturalCommand.query);
      if (priceData && priceData.price !== undefined && priceData.timestamp !== undefined) {
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle(`⚔️ RS3 Grand Exchange: ${priceData.name}`)
          .addFields(
            { name: 'Current Price', value: `${priceData.price.toLocaleString()} gp`, inline: true },
            { name: 'Last Updated', value: new Date(priceData.timestamp * 1000).toLocaleString(), inline: true }
          )
          .setFooter({ text: 'Data from RuneScape Wiki API' })
          .setTimestamp();

        await message.reply({ embeds: [embed] });
        return;
      }
    }
  }

  // ========================================
  // CRYPT-OLOGY KEYWORD DETECTION
  // ========================================
  // Check if message contains any Crypt-ology trigger keywords
  let detectedTopic = null;
  const lowerMessage = message.content.toLowerCase();

  for (const [topic, keywords] of Object.entries(cryptologyDialogues.triggers)) {
    if (keywords.some(keyword => lowerMessage.includes(keyword))) {
      detectedTopic = topic;
      break;
    }
  }

  // REDESIGNED: Don't block AI responses with popup
  // Instead, we'll add optional topic buttons AFTER the AI responds
  // Store detected topic to add buttons to AI response later
  let detectedCryptologyTopic = null;
  if (detectedTopic && cryptologyDialogues.trees[detectedTopic]) {
    detectedCryptologyTopic = detectedTopic;
    // Update interest tracking
    const relationship = getOrCreateRelationship(message.author.id);
    updateRelationship(message.author.id, {
      interests: { [detectedTopic === 'bible' ? 'religion' : detectedTopic === 'greece' ? 'mythology' : detectedTopic]: 2 },
      familiarity: 1
    });
  }

  // Only respond when mentioned, in DMs, replying to bot, or contains keywords
  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1;

  if (!isMentioned && !isDM && !isReplyToBot && !containsKeyword) return;

  try {
    await message.channel.sendTyping();

    // Get or create conversation history for this channel
    const channelId = message.channel.id;
    if (!conversationHistory.has(channelId)) {
      conversationHistory.set(channelId, []);
    }
    const history = conversationHistory.get(channelId);

    // Clean message content (remove bot mention)
    let userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

    // Check for image attachments
    const imageAttachments = message.attachments.filter(att =>
      att.contentType?.startsWith('image/')
    );

    let imageParts = [];
    if (imageAttachments.size > 0) {
      // Process images for Gemini vision
      for (const [, attachment] of imageAttachments) {
        try {
          // Fetch image data
          const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
          const base64Image = Buffer.from(response.data).toString('base64');

          imageParts.push({
            inlineData: {
              data: base64Image,
              mimeType: attachment.contentType
            }
          });

          if (!userMessage) {
            userMessage = "What do you see in this image?";
          }
        } catch (error) {
          console.error('Error processing image:', error.message);
        }
      }
    }

    // Smart context detection and search
    let enhancedMessage = userMessage;
    const searchKeywords = ['search', 'google', 'find', 'look up', 'what is', 'who is', 'when did', 'where is', 'tell me about'];
    const shouldSearch = searchKeywords.some(keyword => userMessage.toLowerCase().includes(keyword));

    if (shouldSearch) {
      const contextResult = await detectContextAndSearch(userMessage, channelId);

      if (contextResult) {
        if (contextResult.source === 'wikipedia') {
          const wiki = contextResult.data;
          enhancedMessage += `\n\nWikipedia Information:\nTitle: ${wiki.title}\nSummary: ${wiki.summary}\nSource: ${wiki.url}\n\nPlease use this Wikipedia information to inform your response.`;
        } else if (contextResult.source === 'google') {
          enhancedMessage += '\n\nGoogle Search Results:\n';
          contextResult.data.forEach((result, i) => {
            enhancedMessage += `${i + 1}. ${result.title}\n${result.snippet}\nSource: ${result.link}\n\n`;
          });
          enhancedMessage += 'Please synthesize this information in your response.';
        } else if (contextResult.source === 'discord_history') {
          enhancedMessage += `\n\nFrom Discord History:\n${contextResult.data.slice(0, 3).join('\n\n')}\n\nPlease use this conversation history to inform your response.`;
        }
      }
    }

    // Build message parts (text + images if any)
    let messageParts = [{ text: enhancedMessage }];
    if (imageParts.length > 0) {
      messageParts = [...imageParts, { text: enhancedMessage }];
    }

    // Add user message to history
    history.push({
      role: 'user',
      parts: messageParts,
    });

    // Keep only last 20 messages to avoid token limits
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Get user relationship for personalization
    const relationship = getOrCreateRelationship(message.author.id);
    const tone = getConversationTone(relationship);

    // Build personalized system context
    let personalizedContext = systemContext;

    // Add relationship-based context
    if (relationship.totalInteractions > 0) {
      personalizedContext += `\n\nRELATIONSHIP CONTEXT:`;
      personalizedContext += `\nYou have ${relationship.totalInteractions} previous interactions with this user.`;
      personalizedContext += `\nConversation tone: ${tone}`;

      // Add top interests if any
      const topInterests = Object.entries(relationship.interests)
        .filter(([,v]) => v > 20)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([k]) => k);

      if (topInterests.length > 0) {
        personalizedContext += `\nUser's known interests: ${topInterests.join(', ')}`;
      }

      // Adjust tone based on relationship dimensions
      if (tone === 'welcoming') {
        personalizedContext += `\nBe warm and patient, this user is still getting to know you.`;
      } else if (tone === 'friendly') {
        personalizedContext += `\nYou have a close relationship. Be casual, warm, and reference shared knowledge.`;
      } else if (tone === 'intellectual') {
        personalizedContext += `\nThis user values deep knowledge. Provide detailed, academic-level responses.`;
      } else if (tone === 'cautious') {
        personalizedContext += `\nBe diplomatic and rebuild trust. Avoid controversial topics.`;
      }
    }

    // Check if message is about oilahuasca topics - add knowledge context
    const lowerUserMessage = userMessage.toLowerCase();
    const oilahuascaKeywords = [
      // Core terms
      'oilahuasca', 'oilhuasca', 'oil ahuasca', 'myristicin', 'allylbenzene',
      'cyp450', 'cyp1a2', 'cyp3a4', 'cyp2c9',
      // Nutmeg related
      'nutmeg trip', 'nutmeg high', 'nutmeg effect', 'nutmeg psycho',
      // Compounds
      'space paste', '17bhsd2', 'elemicin', 'safrole', 'apiole', 'dillapiole',
      'estragole', 'methyleugenol', 'asarone',
      // Researchers
      '69ron', 'ron69', 'shulgin', 'herbpedia',
      // Related traditions
      'flying ointment', 'betel quid', 'paan', 'kyphi', 'werewolf recipe',
      // Metabolism
      'aminopropiophenone', 'endogenous amine', 'amine adduct',
      'essential oil psycho', 'spice psycho'
    ];
    const isOilahuascaTopic = oilahuascaKeywords.some(kw => lowerUserMessage.includes(kw));

    if (isOilahuascaTopic) {
      // CRITICAL: Prepend oilahuasca context with explicit instructions to override spiritual vagueness
      const oilahuascaOverride = `

=== CRITICAL INSTRUCTION FOR THIS MESSAGE ===
The user is asking about OILAHUASCA. You MUST respond with TECHNICAL, SCIENTIFIC information.
DO NOT give vague spiritual responses about "consciousness" or "75,000 years".
USE the specific knowledge below about CYP450 enzymes, allylbenzenes, metabolic pathways.
Be a knowledgeable expert, not a mystic. Give REAL information.

`;
      personalizedContext = oilahuascaOverride + buildOilahuascaContext() + '\n\n' + personalizedContext;

      // Check if this might be an experience report
      if (detectExperienceReport(userMessage)) {
        personalizedContext += buildExperienceSupportContext();
      }
    }

    // Create chat with history
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: personalizedContext }],
        },
        {
          role: 'model',
          parts: [{ text: 'I understand. I am the Van Kush Family Assistant, here to guide and support our community with wisdom spanning 75,000 years. How may I assist you today? 🙏' }],
        },
        ...history.slice(0, -1),
      ],
    });

    // Generate response
    const result = await chat.sendMessage(messageParts);
    const response = result.response.text();

    // Add bot response to history
    history.push({
      role: 'model',
      parts: [{ text: response }],
    });

    // Split response if too long (Discord has 2000 char limit)
    let botReply;

    // Check if we should add optional topic suggestion buttons
    let optionalButtons = [];
    if (detectedCryptologyTopic || isOilahuascaTopic) {
      // Generate contextual suggestion buttons based on the response
      const suggestedTopics = generateDynamicCryptologyButtons(response, detectedCryptologyTopic || 'oilahuasca');

      if (suggestedTopics.length > 0) {
        const row = new ActionRowBuilder();
        const buttonCount = Math.min(suggestedTopics.length, 4); // Max 4 buttons

        for (let i = 0; i < buttonCount; i++) {
          const topic = suggestedTopics[i];
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`crypto_chat_${topic.id}`)
              .setLabel(topic.label.substring(0, 80))
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(topic.emoji || '💡')
          );
        }
        optionalButtons.push(row);
      }
    }

    if (response.length > 2000) {
      const chunks = response.match(/[\s\S]{1,2000}/g);
      for (let i = 0; i < chunks.length; i++) {
        // Add buttons only to the last chunk
        if (i === chunks.length - 1 && optionalButtons.length > 0) {
          botReply = await message.reply({ content: chunks[i], components: optionalButtons });
        } else {
          botReply = await message.reply(chunks[i]);
        }
      }
    } else {
      if (optionalButtons.length > 0) {
        botReply = await message.reply({ content: response, components: optionalButtons });
      } else {
        botReply = await message.reply(response);
      }
    }

    // Track bot message ID for reply tracking
    if (botReply) {
      botMessageIds.add(botReply.id);
      // Limit set size to prevent memory issues
      if (botMessageIds.size > 1000) {
        const firstId = botMessageIds.values().next().value;
        botMessageIds.delete(firstId);
      }
    }

    // Update user relationship after successful interaction
    updateRelationship(message.author.id, {
      warmth: 1,  // Positive interaction
      familiarity: 2,  // Learning more about the user
      trust: message.content.length > 100 ? 1 : 0  // Longer messages show more trust
    });

  } catch (error) {
    console.error('Error generating response:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    await message.reply('🙏 My apologies, I encountered a moment of confusion. Please try again.');
  }
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
