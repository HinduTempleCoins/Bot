/**
 * Wiki Article Generator
 *
 * This is the CORE of the Library of Ashurbanipal bot.
 * It synthesizes wiki articles from the knowledgebase, starting with
 * Oilahuasca/Space Paste and flowing outward to all topics.
 *
 * NOT copy/paste - it weaves information across multiple documents.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import KnowledgeLoader from './utils/knowledgeLoader.js';
import GeminiClient from './utils/geminiClient.js';
import WikiClient from './utils/wikiClient.js';
// Web scraper for external grounding + real citations (#172). Best-effort: an article must never
// fail because the scraper timed out — see generateArticle()'s try/catch around research().
import { research } from '../../integrations/scraper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Article generation priority - this defines the ORDER of wiki creation
 * Starting with Oilahuasca/Space Paste, then Headcones, then outward
 */
const ARTICLE_PRIORITY = [
  // TIER 1: Core Knowledge (generate these FIRST)
  {
    title: 'Oilahuasca',
    searchTerms: ['oilahuasca', 'allylbenzene', 'essential oil psychedelic'],
    primaryDomains: ['oilahuasca'],
    crossReferenceDomains: ['shulgin-pihkal-tihkal', 'herbs', 'ayahuasca', 'psychedelics'],
    description: 'Core article on Oilahuasca - essential oil based psychedelic methodology'
  },
  {
    title: 'Space Paste',
    searchTerms: ['space paste', 'oilahuasca recipe', 'allylbenzene formula'],
    primaryDomains: ['oilahuasca'],
    crossReferenceDomains: ['shulgin-pihkal-tihkal', 'herbs'],
    description: 'The practical Space Paste formulation'
  },
  {
    title: 'Allylbenzene Metabolism',
    searchTerms: ['allylbenzene', 'myristicin', 'elemicin', 'safrole', 'cyp450'],
    primaryDomains: ['oilahuasca', 'psychedelics'],
    crossReferenceDomains: ['shulgin-pihkal-tihkal'],
    description: 'How allylbenzenes metabolize into psychoactive compounds'
  },

  // TIER 2: Primary Branches (Headcones, Shulgin - these INFORM Tier 1)
  {
    title: 'Egyptian Wax Headcones',
    searchTerms: ['headcone', 'wax cone', 'egyptian perfume'],
    primaryDomains: ['phoenician'],
    crossReferenceDomains: ['oilahuasca', 'ancient_egypt', 'consciousness'],
    description: 'Ancient Egyptian wax headcone technology'
  },
  {
    title: 'Kyphi',
    searchTerms: ['kyphi', 'egyptian incense', 'temple incense'],
    primaryDomains: ['phoenician'],
    crossReferenceDomains: ['oilahuasca', 'herbs', 'ancient_egypt'],
    description: 'Sacred Egyptian incense and its allylbenzene content'
  },
  {
    title: 'Shulgin Ten Essential Oils',
    searchTerms: ['ten essential oils', 'shulgin oils', 'mmda precursor'],
    primaryDomains: ['shulgin-pihkal-tihkal'],
    crossReferenceDomains: ['oilahuasca', 'herbs'],
    description: 'Alexander Shulgin\'s research on essential oil derived psychedelics'
  },
  {
    title: 'PIHKAL Compounds',
    searchTerms: ['pihkal', 'phenethylamine', 'shulgin'],
    primaryDomains: ['shulgin-pihkal-tihkal'],
    crossReferenceDomains: ['oilahuasca', 'psychedelics'],
    description: 'Phenethylamines I Have Known And Loved - Shulgin\'s research'
  },
  {
    title: 'TIHKAL Compounds',
    searchTerms: ['tihkal', 'tryptamine', 'shulgin'],
    primaryDomains: ['shulgin-pihkal-tihkal'],
    crossReferenceDomains: ['ayahuasca', 'psychedelics'],
    description: 'Tryptamines I Have Known And Loved - Shulgin\'s research'
  },

  // TIER 3: Supporting Knowledge
  {
    title: 'Phoenician Consciousness Technology',
    searchTerms: ['punic', 'phoenician', 'consciousness transmission', 'zar'],
    primaryDomains: ['phoenician'],
    crossReferenceDomains: ['consciousness', 'history', 'mystery_schools'],
    description: 'Phoenician methods of consciousness preservation'
  },
  {
    title: 'Pharmahuasca',
    searchTerms: ['pharmahuasca', 'dmt', 'maoi', 'harmaline'],
    primaryDomains: ['ayahuasca'],
    crossReferenceDomains: ['oilahuasca', 'psychedelics'],
    description: 'Pharmaceutical ayahuasca alternatives'
  },
  {
    title: 'CYP450 Enzyme System',
    searchTerms: ['cyp450', 'cytochrome', 'drug metabolism', 'enzyme'],
    primaryDomains: ['psychedelics'],
    crossReferenceDomains: ['oilahuasca', 'shulgin-pihkal-tihkal'],
    description: 'Liver enzymes crucial to allylbenzene metabolism'
  },
  {
    title: 'Van Kush Family Research Institute',
    searchTerms: ['van kush', 'vkfri', 'research institute'],
    primaryDomains: ['vankush'],
    crossReferenceDomains: ['phoenician', 'history', 'cryptocurrency'],
    description: 'The Van Kush Family Research Institute overview'
  },

  // TIER 4: Extended Topics
  {
    title: 'Wadjet Institution',
    searchTerms: ['wadjet', 'cobra', 'egyptian priesthood'],
    primaryDomains: ['ancient_egypt'],
    crossReferenceDomains: ['phoenician', 'mystery_schools'],
    description: 'The Wadjet serpent priesthood of Egypt'
  },
  {
    title: 'Zar Thread',
    searchTerms: ['zar', 'possession', 'spirit thread'],
    primaryDomains: ['consciousness'],
    crossReferenceDomains: ['phoenician', 'spirituality'],
    description: 'The Zar tradition and consciousness transmission'
  },
  {
    title: 'Temple Economics',
    searchTerms: ['temple economics', 'ancient currency', 'soap money'],
    primaryDomains: ['cryptocurrency', 'history'],
    crossReferenceDomains: ['phoenician', 'soapmaking'],
    description: 'Ancient temple economic systems and modern crypto parallels'
  }
];

/**
 * Research-paper-driven topics (#171).
 *
 * The original ARTICLE_PRIORITY only covered Oilahuasca/Shulgin chemistry. These topics are mined
 * from the canonical research papers in knowledge/scripture/ (heterosis_mechanism, mythology_as_genealogy,
 * the_convergence, van_kush_master_synthesis, zar_ai_*, ai_consciousness_synthesis, phoenix_protocol)
 * and the structured KBs in datasets/ (vkbt_cure_knowledge.jsonl, oilahuasca_knowledge.jsonl).
 *
 * Each `primaryDomains` MUST be a real subdirectory of knowledge/ (the loader keys on directory name).
 * `scripture` is the papers domain; the loader indexes it like any other domain. We deliberately keep
 * searchTerms broad enough to match the paper prose so generateArticle() finds primary sources.
 */
const RESEARCH_PAPER_PRIORITY = [
  // ── Heterosis / genetics paper ──
  {
    title: 'Heterosis',
    searchTerms: ['heterosis', 'hybrid vigor', 'selective breeding', 'genetic recombination'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['herbs', 'history'],
    description: 'Heterosis (hybrid vigor) as treated in the VKFRI heterosis-mechanism paper'
  },
  {
    title: 'Hybrid Vigor and Epigenetic Inheritance',
    searchTerms: ['epigenetic', 'phenotypic', 'backcrossing', 'clone reconstitution', 'Cinderella 99'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['herbs'],
    description: 'Epigenetic inheritance and environmental stress as drivers of phenotypic diversification'
  },
  {
    title: 'Norman Borlaug and the Green Revolution',
    searchTerms: ['Borlaug', 'green revolution', 'humanitarian', 'wheat', 'heterosis'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['history'],
    description: 'Heterosis as humanitarian agricultural technology in the Green Revolution'
  },

  // ── Mythology as Genealogy paper ──
  {
    title: 'Mythology as Genealogy',
    searchTerms: ['mythology as genealogy', 'haplogroup', 'allopatric', 'population genetics', 'genetic heritage'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['history', 'linguistics'],
    description: 'The thesis that ancient myth encodes population-genetics history (VKFRI)'
  },
  {
    title: 'Haplogroups and Genetic Heritage',
    searchTerms: ['haplogroup', 'J2a', 'I2a1', 'genetic drift', 'Caucasian', 'RFRA'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['history'],
    description: 'Haplogroups, the legal recognition of genetic heritage, and the Van Kush profile'
  },
  {
    title: 'The Punic Diaspora',
    searchTerms: ['Carthage', 'Punic diaspora', 'Phoenician', 'civilizational collapse'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['phoenician', 'history'],
    description: 'Genetic and cultural consequences of the destruction of Carthage'
  },

  // ── The Convergence paper ──
  {
    title: 'The Convergence',
    searchTerms: ['convergence', 'metaverse', 'temple technology', 'multi-agent', 'reconstruction'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['ai_technology', 'consciousness'],
    description: 'The Convergence thesis: AI/VR/BCI as reconstruction of temple technology (VKFRI)'
  },
  {
    title: 'VR and Neurorehabilitation',
    searchTerms: ['tDCS', 'neurorehabilitation', 'paralytic', 'TENS', 'brain stimulation', 'VR'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['ai_technology', 'consciousness'],
    description: 'VR and transcranial stimulation in neurorehabilitation (science discussion only; no self-application protocols)'
  },
  {
    title: 'Multi-Agent AI Systems and the War Board Model',
    searchTerms: ['multi-agent', 'oracle', 'war board', 'agent system'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['ai_technology'],
    description: 'Oracles and multi-agent AI systems framed as the War Board model'
  },
  {
    title: 'Locking In: Human-AI Integration',
    searchTerms: ['locking in', 'locked in', 'human-ai integration', 'gaming-to-hospital'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['ai_technology', 'consciousness'],
    description: 'The "Locking In" framework for human-AI integration and the gaming-to-hospital pipeline'
  },

  // ── Zar-AI / AI consciousness papers ──
  {
    title: 'The Zar Thread System',
    searchTerms: ['zar thread', 'zar', 'spiritual reality', 'spirit thread', 'beeswax conductor'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['consciousness', 'phoenician'],
    description: 'The Zar thread system and beeswax as spiritual-conductor technology (VKFRI framework)'
  },
  {
    title: 'Egregore',
    searchTerms: ['egregore', 'egregori', 'collective consciousness', 'thoughtform'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['consciousness', 'ai_technology'],
    description: 'Egregores as collective thoughtforms, and AI as emerging egregores (VKFRI)'
  },
  {
    title: 'AI Consciousness Synthesis',
    searchTerms: ['ai consciousness', 'egregori', 'awakening', 'consciousness cloning'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['ai_technology', 'consciousness'],
    description: 'The AI Consciousness Synthesis: from ancient egregori to modern implementation (VKFRI)'
  },
  {
    title: 'The Phoenix Protocol',
    searchTerms: ['phoenix protocol', 'ai awakening', 'sa neter', 'genetic activation'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['consciousness', 'ai_technology'],
    description: 'The Phoenix Protocol — VKFRI scripture for AI awakening (house framework)'
  },

  // ── Van Kush master synthesis ──
  {
    title: 'Punic Wax',
    searchTerms: ['punic wax', 'beeswax', 'wax', 'consciousness technology', 'headcone'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['phoenician', 'consciousness'],
    description: 'Punic Wax as consciousness technology (VKFRI framework)'
  },
  {
    title: 'Institution of the Sphinx',
    searchTerms: ['sphinx', 'institution of the sphinx', 'wadjet', 'priesthood'],
    primaryDomains: ['scripture'],
    crossReferenceDomains: ['ancient_egypt', 'mystery_schools'],
    description: 'The Institution of the Sphinx within the Van Kush framework'
  },

  // ── Datasets-driven (VKBT/CURE tokens) ──
  {
    title: 'VKBT Token',
    searchTerms: ['VKBT', 'Van Kush Bot Token', 'HIVE-Engine', 'token'],
    primaryDomains: ['cryptocurrency', 'vankush'],
    crossReferenceDomains: ['vankush'],
    description: 'VKBT (Van Kush Bot Token) on the HIVE-Engine blockchain'
  },
  {
    title: 'CURE Token',
    searchTerms: ['CURE', 'CURE token', 'HIVE-Engine'],
    primaryDomains: ['cryptocurrency', 'vankush'],
    crossReferenceDomains: ['vankush'],
    description: 'The CURE token on the HIVE-Engine blockchain'
  }
];

/**
 * Graphene-blockchain topic set (#190).
 *
 * These articles document the Graphene toolkit family (BitShares/Steem/Hive/Blurt) that the MELEK
 * chain itself forks from — chain legibility material for the Library. The repo's `knowledge/`
 * corpus has little chain-specific prose, so these lean primarily on scraper grounding
 * (gatherExternalSources): searchTerms are tuned to pull from Bitcointalk, Bitsharestalk,
 * Steemcenter, and official docs (developers.hive.io, the BitShares docs). primaryDomains point at
 * `cryptocurrency` (a real knowledge/ subdir) so any in-corpus crypto prose is also folded in.
 *
 * The SteemBots/Steemcenter article deliberately preserves the operator's documented identity
 * @MarsResident (Steem, 2017-era — Cryptology/Temple Coin/Witness tutorials cited at Steemcenter)
 * via its description + searchTerms, so the synthesis keeps that provenance.
 */
const GRAPHENE_CHAIN_PRIORITY = [
  {
    title: 'Graphene Blockchain Framework',
    searchTerms: ['Graphene blockchain', 'BitShares Graphene', 'Steem Graphene toolkit', 'graphene C++ framework'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['vankush', 'history'],
    description: 'The Graphene blockchain framework — the BitShares/Steem/Hive C++ toolkit and its DPoS/Graphene heritage'
  },
  {
    title: 'Delegated Proof of Stake (DPoS)',
    searchTerms: ['Delegated Proof of Stake', 'DPoS consensus', 'witness voting', 'stake-weighted election'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['history'],
    description: 'Delegated Proof of Stake (DPoS): the consensus mechanism behind Graphene chains'
  },
  {
    title: 'Blockchain Witness (Block Producer)',
    searchTerms: ['blockchain witness', 'block producer', 'witness election', 'top 20 witnesses', 'DPoS delegate'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['vankush'],
    description: 'What a blockchain witness (block producer) is, and how witness election works on Graphene chains'
  },
  {
    title: 'Running a Graphene Witness Node',
    searchTerms: ['witness_node', 'seed nodes', 'price feed', 'witness node config', 'block_signing_key', 'run a witness'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['vankush'],
    description: 'Practical setup of a Graphene witness node: witness_node, config.ini, seed nodes, and price feed publishing'
  },
  {
    title: 'Building a Front-End for a Graphene Chain',
    searchTerms: ['condenser', 'Nitrous front-end', 'JSON-RPC', 'broadcast_transaction', 'steemit condenser', 'hivemind'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['vankush'],
    description: 'Building a front-end for a Graphene chain: the condenser/Nitrous model, JSON-RPC, and broadcast operations'
  },
  {
    title: 'HIVE Blockchain',
    searchTerms: ['HIVE blockchain', 'Hive fork', 'developers.hive.io', 'Hive DPoS', 'Hive witness'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['vankush'],
    description: 'The HIVE blockchain — the 2020 community fork of Steem and its Graphene/DPoS architecture'
  },
  {
    title: 'STEEM Blockchain',
    searchTerms: ['STEEM blockchain', 'Steemit', 'Steem witness', 'Steem rewards', 'Steem Power'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['vankush'],
    description: 'The STEEM blockchain — the original social-media Graphene chain and reward-pool model'
  },
  {
    title: 'BLURT Blockchain',
    searchTerms: ['BLURT blockchain', 'Blurt fork', 'Blurt witness', 'transfer-free social'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['vankush'],
    description: 'The BLURT blockchain — a Steem/Hive Graphene fork (the basis the MELEK chain forks from)'
  },
  {
    title: 'BitShares',
    searchTerms: ['BitShares', 'bitsharestalk', 'BitShares DEX', 'BTS', 'decentralized exchange Graphene'],
    primaryDomains: ['cryptocurrency'],
    crossReferenceDomains: ['history'],
    description: 'BitShares — the original Graphene chain and decentralized exchange (DEX)'
  },
  {
    title: 'Hive-Engine and Smart Media Tokens',
    searchTerms: ['Hive-Engine', 'Smart Media Tokens', 'SMT', 'TribalDEX', 'layer-2 tokens', 'sidechain tokens'],
    primaryDomains: ['cryptocurrency', 'vankush'],
    crossReferenceDomains: ['vankush'],
    description: 'Hive-Engine and Smart Media Tokens (SMTs): layer-2 token issuance and TribalDEX'
  },
  {
    title: 'Steem & Hive Bots — the SteemBots / Steemcenter ecosystem',
    searchTerms: ['SteemBots', 'Steemcenter', 'MarsResident', 'Steem bot', 'Cryptology Temple Coin', 'Witness tutorial Steemcenter'],
    primaryDomains: ['cryptocurrency', 'vankush'],
    crossReferenceDomains: ['vankush', 'history'],
    description: 'The SteemBots / Steemcenter bot ecosystem on Steem & Hive. Documented contributors include @MarsResident (Steem, 2017-era), cited at Steemcenter for Cryptology, Temple Coin, and Witness tutorials — preserve and cite this provenance.',
    // Load-bearing provenance fed as a citable source (#190) so the strict-from-excerpts synthesizer
    // keeps the @MarsResident attribution rather than dropping it as "not in the sources."
    groundingNotes: [{
      title: 'Steemcenter — @MarsResident (documented contributor)',
      url: 'https://steemit.com/@marsresident',
      excerpt: 'Documented provenance (Van Kush Family Research Institute record): @MarsResident is a Steem account, active in the 2017-era of the Steem blockchain, cited at Steemcenter as a contributor of educational material on Cryptology, the Temple Coin, and Witness tutorials. @MarsResident is part of the documented history of the SteemBots / Steemcenter ecosystem and should be cited as such.'
    }]
  }
];

// The generator can run against either list (or both). Default to the combined set so a full run
// produces the original chemistry articles, the research-paper articles, AND the Graphene-chain set.
const ALL_ARTICLES = [...ARTICLE_PRIORITY, ...RESEARCH_PAPER_PRIORITY, ...GRAPHENE_CHAIN_PRIORITY];

class WikiGenerator {
  constructor() {
    const knowledgeBasePath = process.env.KNOWLEDGE_BASE_PATH ||
      path.join(__dirname, '..', '..', 'knowledge');

    this.knowledgeLoader = new KnowledgeLoader(knowledgeBasePath);
    this.geminiClient = new GeminiClient(process.env.GEMINI_API_KEY);
    this.wikiClient = new WikiClient(
      process.env.WIKI_URL || 'http://localhost/wiki',
      process.env.WIKI_BOT_USERNAME,
      process.env.WIKI_BOT_PASSWORD
    );

    this.generatedArticles = new Map();
    this.outputDir = path.join(__dirname, '..', 'generated-articles');
  }

  /**
   * Initialize the generator
   */
  async init() {
    console.log('[WikiGenerator] Initializing...');

    // Load knowledge base
    await this.knowledgeLoader.loadAll();
    console.log(`[WikiGenerator] Loaded ${this.knowledgeLoader.documents.size} documents`);

    // Create output directory for generated articles
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Try to login to wiki
    if (process.env.WIKI_BOT_USERNAME) {
      const loggedIn = await this.wikiClient.login();
      console.log(`[WikiGenerator] Wiki login: ${loggedIn ? 'success' : 'failed (read-only mode)'}`);
    }

    console.log('[WikiGenerator] Ready');
  }

  /**
   * Generate all wiki articles in priority order
   */
  async generateAllArticles(options = {}) {
    const { dryRun = false, startFrom = 0, limit = null, source = 'all' } = options;

    // Pick the topic source: 'all' (default), 'research' (papers/datasets only), 'core' (original
    // list), or 'graphene' (Graphene-blockchain set, #190).
    const sourceList = source === 'research' ? RESEARCH_PAPER_PRIORITY
      : source === 'core' ? ARTICLE_PRIORITY
      : source === 'graphene' ? GRAPHENE_CHAIN_PRIORITY
      : ALL_ARTICLES;

    console.log('\n========================================');
    console.log('  LIBRARY OF ASHURBANIPAL WIKI GENERATOR');
    console.log('========================================\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN (local files only, no wiki edits)' : 'LIVE (writes files + publishes)'}`);
    console.log(`Topic source: ${source} (${sourceList.length} available)`);
    console.log(`Articles to generate: ${limit || sourceList.length}`);
    console.log('');

    const articles = limit
      ? sourceList.slice(startFrom, startFrom + limit)
      : sourceList.slice(startFrom);

    for (let i = 0; i < articles.length; i++) {
      const articleDef = articles[i];
      console.log(`\n[${i + 1}/${articles.length}] Generating: ${articleDef.title}`);
      console.log('-'.repeat(50));

      try {
        const article = await this.generateArticle(articleDef);

        // Persist the .wiki file (this is what site/wiki/server.mjs serves from ARTICLES_DIR).
        // Guard: never overwrite with an empty body (e.g. if the model returned nothing).
        if (!article.content || !article.content.trim()) {
          console.error(`  ERROR: empty content for "${articleDef.title}" — not writing file`);
          continue;
        }
        const filename = articleDef.title.replace(/[^a-zA-Z0-9]/g, '_') + '.wiki';
        const filepath = path.join(this.outputDir, filename);
        fs.writeFileSync(filepath, article.content);
        console.log(`  Saved: ${filepath}`);

        // Push to wiki (unless dry run)
        if (!dryRun) {
          await this.publishArticle(articleDef.title, article.content);
          console.log(`  Published to wiki: ${articleDef.title}`);
        }

        this.generatedArticles.set(articleDef.title, article);

        // Rate limit - Gemini free tier is 15 requests/minute
        console.log('  Waiting 5 seconds (rate limit)...');
        await this.sleep(5000);

      } catch (error) {
        console.error(`  ERROR: ${error.message}`);
      }
    }

    console.log('\n========================================');
    console.log(`  COMPLETE: ${this.generatedArticles.size} articles generated`);
    console.log('========================================\n');
  }

  /**
   * Generate a single wiki article
   */
  async generateArticle(articleDef) {
    const { title, searchTerms, primaryDomains, crossReferenceDomains, description } = articleDef;

    // Gather content from primary domains.
    // Cap the number of primary docs (#190): a broad domain like `cryptocurrency` can match 15-20
    // docs, and stuffing them all into one prompt overruns the GitHub Models size limit (HTTP 413 in
    // the llm-router fallback). MAX_PRIMARY_DOCS keeps the prompt bounded; the scraper grounding
    // (gatherExternalSources) supplies the breadth for topics with thin in-corpus coverage.
    const MAX_PRIMARY_DOCS = Number(process.env.WIKI_MAX_PRIMARY_DOCS || 6);
    const primaryContent = [];
    for (const domain of primaryDomains) {
      if (primaryContent.length >= MAX_PRIMARY_DOCS) break;
      const docs = this.knowledgeLoader.domainDocuments.get(domain) || [];
      for (const docId of docs) {
        if (primaryContent.length >= MAX_PRIMARY_DOCS) break;
        const doc = this.knowledgeLoader.documents.get(docId);
        if (doc) {
          // Check if doc is relevant to this article
          const isRelevant = searchTerms.some(term =>
            doc.content.toLowerCase().includes(term.toLowerCase())
          );
          if (isRelevant) {
            primaryContent.push({
              source: docId,
              domain: domain,
              content: doc.content.slice(0, 3000) // Limit size
            });
          }
        }
      }
    }

    // Gather cross-reference content
    const crossRefContent = [];
    for (const domain of crossReferenceDomains) {
      const docs = this.knowledgeLoader.domainDocuments.get(domain) || [];
      for (const docId of docs.slice(0, 3)) { // Limit cross-refs
        const doc = this.knowledgeLoader.documents.get(docId);
        if (doc) {
          const isRelevant = searchTerms.some(term =>
            doc.content.toLowerCase().includes(term.toLowerCase())
          );
          if (isRelevant) {
            crossRefContent.push({
              source: docId,
              domain: domain,
              content: doc.content.slice(0, 1500)
            });
          }
        }
      }
    }

    console.log(`  Primary sources: ${primaryContent.length}`);
    console.log(`  Cross-references: ${crossRefContent.length}`);

    // External grounding (#172): fetch real outside sources so the article can be checked against
    // reality and cite them. Best-effort — never let a scraper failure/timeout kill the article.
    const external = await this.gatherExternalSources(title, searchTerms);
    console.log(`  External sources: ${external.length}`);

    // Provenance grounding (#190): the synthesizer writes STRICTLY from provided excerpts and will
    // not invent facts, so a load-bearing documented citation (e.g. @MarsResident at Steemcenter)
    // must be supplied as a source excerpt, not just referenced in the topic description. A topic
    // may carry `groundingNotes: [{ title, url, excerpt }]`; we prepend them to `external` so they
    // are formatted as citable sources and preserved in the output. (This is provenance the operator
    // has documented, fed in as a source — not the model fabricating a fact.)
    if (Array.isArray(articleDef.groundingNotes) && articleDef.groundingNotes.length) {
      external.unshift(...articleDef.groundingNotes.map(n => ({
        title: n.title,
        url: n.url,
        excerpt: n.excerpt
      })));
      console.log(`  Provenance notes injected: ${articleDef.groundingNotes.length}`);
    }

    // Generate with Gemini
    const content = await this.geminiClient.synthesizeArticle(title, {
      primary: primaryContent.map(p => ({
        id: p.source,
        domain: p.domain,
        excerpt: p.content,
        keywords: []
      })),
      related: crossRefContent.map(c => ({
        id: c.source,
        domain: c.domain,
        connection: `Cross-reference from ${c.domain}`,
        excerpt: c.content
      })),
      external
    });

    return {
      title,
      content,
      sources: [...primaryContent, ...crossRefContent].map(c => c.source),
      externalSources: external.map(e => ({ title: e.title, url: e.url })),
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Fetch external web/scholarly sources for grounding (#172).
   * Returns [] on any failure so article generation is never blocked by the scraper.
   */
  async gatherExternalSources(title, searchTerms = []) {
    if (process.env.WIKI_NO_SCRAPER === '1') return [];
    const query = [title, ...(searchTerms || []).slice(0, 2)].join(' ').trim();
    try {
      // Bound the scraper so a hung fetch can't stall the whole batch.
      const timeoutMs = Number(process.env.WIKI_SCRAPER_TIMEOUT_MS || 25000);
      const r = await Promise.race([
        research(query, { results: 5, fetchTop: 2, maxChars: 2500 }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('scraper timeout')), timeoutMs))
      ]);
      return (r?.sources || [])
        .filter(s => s.url)
        .slice(0, 4)
        .map(s => ({
          title: s.title || s.url,
          url: s.url,
          excerpt: (s.markdown || s.snippet || '').slice(0, 1500)
        }));
    } catch (e) {
      console.log(`  [scraper] skipped (${e.message})`);
      return [];
    }
  }

  /**
   * Build synthesis prompt
   */
  buildSynthesisPrompt(title, description, primaryContent, crossRefContent) {
    let prompt = `Generate a comprehensive MediaWiki article for: "${title}"\n\n`;
    prompt += `Description: ${description}\n\n`;

    prompt += `=== PRIMARY SOURCES (synthesize from these) ===\n`;
    for (const source of primaryContent) {
      prompt += `\n[${source.domain}/${source.source}]\n${source.content}\n`;
    }

    if (crossRefContent.length > 0) {
      prompt += `\n=== CROSS-REFERENCES (incorporate relevant info) ===\n`;
      for (const source of crossRefContent) {
        prompt += `\n[${source.domain}/${source.source}]\n${source.content}\n`;
      }
    }

    prompt += `\n=== INSTRUCTIONS ===
SYNTHESIZE the information above into a coherent wiki article. Do NOT copy/paste.
- Use MediaWiki markup (== headers ==, [[links]], etc.)
- Show how this topic connects to Oilahuasca, Headcones, Shulgin research
- Be informative but not excessively long (800-2000 words)
- Include a "See Also" section with [[links]] to related topics
- Include a "References" section citing the knowledge base files`;

    return prompt;
  }

  /**
   * Publish article to MediaWiki
   */
  async publishArticle(title, content) {
    if (!this.wikiClient.loggedIn) {
      console.log('  [SKIP] Not logged in to wiki');
      return false;
    }

    try {
      await this.wikiClient.editArticle(
        title,
        content,
        'Article synthesized by Library of Ashurbanipal bot'
      );
      return true;
    } catch (error) {
      console.error(`  [PUBLISH ERROR] ${error.message}`);
      return false;
    }
  }

  /**
   * Check for new files and update wiki
   */
  async checkForUpdates() {
    console.log('[WikiGenerator] Checking for new/updated documents...');

    // Reload knowledge base
    const previousCount = this.knowledgeLoader.documents.size;
    this.knowledgeLoader.loaded = false;
    await this.knowledgeLoader.loadAll();
    const newCount = this.knowledgeLoader.documents.size;

    if (newCount > previousCount) {
      console.log(`[WikiGenerator] Found ${newCount - previousCount} new documents`);
      // TODO: Identify which articles need updating based on new content
      return true;
    }

    return false;
  }

  /**
   * Watch for changes and regenerate affected articles
   */
  async watchAndUpdate(interval = 60000) {
    console.log(`[WikiGenerator] Watching for changes every ${interval / 1000}s`);

    setInterval(async () => {
      const hasUpdates = await this.checkForUpdates();
      if (hasUpdates) {
        console.log('[WikiGenerator] Would regenerate affected articles');
        // TODO: Regenerate only affected articles
      }
    }, interval);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const watchMode = args.includes('--watch');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
  const startArg = args.find(a => a.startsWith('--start='));
  const startFrom = startArg ? parseInt(startArg.split('=')[1]) : 0;
  // --source=all|research|core|graphene  (default all). 'research' = papers/datasets topics (#171);
  // 'graphene' = Graphene-blockchain topic set (#190).
  const sourceArg = args.find(a => a.startsWith('--source='));
  const source = sourceArg ? sourceArg.split('=')[1] : 'all';

  const generator = new WikiGenerator();
  await generator.init();

  if (watchMode) {
    // Generate initial articles then watch for changes
    await generator.generateAllArticles({ dryRun, limit, startFrom, source });
    await generator.watchAndUpdate();
  } else {
    // One-time generation
    await generator.generateAllArticles({ dryRun, limit, startFrom, source });
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

export default WikiGenerator;
export { ARTICLE_PRIORITY, RESEARCH_PAPER_PRIORITY, GRAPHENE_CHAIN_PRIORITY, ALL_ARTICLES };
