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

class WikiGenerator {
  constructor() {
    const knowledgeBasePath = process.env.KNOWLEDGE_BASE_PATH ||
      path.join(__dirname, '..', '..', 'knowledge');

    this.knowledgeLoader = new KnowledgeLoader(knowledgeBasePath);
    this.geminiClient = new GeminiClient(process.env.GEMINI_API_KEY);
    this.wikiClient = new WikiClient(
      process.env.WIKI_URL || 'http://5.252.53.79/wiki',
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
    const { dryRun = false, startFrom = 0, limit = null } = options;

    console.log('\n========================================');
    console.log('  LIBRARY OF ASHURBANIPAL WIKI GENERATOR');
    console.log('========================================\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN (no wiki edits)' : 'LIVE'}`);
    console.log(`Articles to generate: ${limit || ARTICLE_PRIORITY.length}`);
    console.log('');

    const articles = limit
      ? ARTICLE_PRIORITY.slice(startFrom, startFrom + limit)
      : ARTICLE_PRIORITY.slice(startFrom);

    for (let i = 0; i < articles.length; i++) {
      const articleDef = articles[i];
      console.log(`\n[${i + 1}/${articles.length}] Generating: ${articleDef.title}`);
      console.log('-'.repeat(50));

      try {
        const article = await this.generateArticle(articleDef);

        // Save locally
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

    // Gather content from primary domains
    const primaryContent = [];
    for (const domain of primaryDomains) {
      const docs = this.knowledgeLoader.domainDocuments.get(domain) || [];
      for (const docId of docs) {
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

    // Build the synthesis prompt
    const prompt = this.buildSynthesisPrompt(title, description, primaryContent, crossRefContent);

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
      }))
    });

    return {
      title,
      content,
      sources: [...primaryContent, ...crossRefContent].map(c => c.source),
      generatedAt: new Date().toISOString()
    };
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

  const generator = new WikiGenerator();
  await generator.init();

  if (watchMode) {
    // Generate initial articles then watch for changes
    await generator.generateAllArticles({ dryRun, limit });
    await generator.watchAndUpdate();
  } else {
    // One-time generation
    await generator.generateAllArticles({ dryRun, limit });
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

export default WikiGenerator;
export { ARTICLE_PRIORITY };
