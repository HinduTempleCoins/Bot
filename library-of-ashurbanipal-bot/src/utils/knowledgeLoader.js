/**
 * Knowledge Loader - Loads and indexes the knowledge base
 *
 * Knowledge Flow Architecture:
 * OILAHUASCA/SPACE PASTE (root) → HEADCONES/PHOENICIAN → ALL OTHER TOPICS
 *
 * This creates a neural network of interconnected knowledge where
 * core concepts flow outward to inform all other subjects.
 */

import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';

// Knowledge domain hierarchy - defines how topics flow into each other
export const KNOWLEDGE_HIERARCHY = {
  // Tier 1: Root Knowledge (most complete, start here)
  root: ['oilahuasca'],

  // Tier 2: Primary Branches (directly connected to root)
  primary: ['phoenician', 'shulgin-pihkal-tihkal', 'ayahuasca'],

  // Tier 3: Secondary Branches (informed by Tier 1 & 2)
  secondary: ['herbs', 'psychedelics', 'consciousness', 'ancient_egypt'],

  // Tier 4: Extended Knowledge (synthesized from all above)
  extended: ['history', 'mystery_schools', 'spirituality', 'soapmaking', 'vankush'],

  // Tier 5: Peripheral Topics (connected but more distant)
  peripheral: ['cryptocurrency', 'ai_technology', 'revolution', 'space', 'media', 'linguistics', 'synthesis']
};

// Cross-domain bridges - how topics connect to each other
export const KNOWLEDGE_BRIDGES = {
  'oilahuasca': {
    bridges: ['shulgin-pihkal-tihkal', 'phoenician', 'herbs', 'psychedelics', 'ayahuasca', 'consciousness'],
    keywords: ['space paste', 'allylbenzene', 'essential oils', 'maoi', 'cyp450', 'transdermal', 'myristicin', 'elemicin', 'safrole']
  },
  'phoenician': {
    bridges: ['oilahuasca', 'ancient_egypt', 'consciousness', 'soapmaking', 'history', 'mystery_schools'],
    keywords: ['headcone', 'kyphi', 'punic', 'wax', 'beeswax', 'zar', 'transdermal', 'incense', 'wadjet']
  },
  'shulgin-pihkal-tihkal': {
    bridges: ['oilahuasca', 'psychedelics', 'herbs', 'ayahuasca'],
    keywords: ['pihkal', 'tihkal', 'phenethylamine', 'tryptamine', 'mmda', 'tma', 'allylbenzene', 'shulgin']
  },
  'ayahuasca': {
    bridges: ['oilahuasca', 'shulgin-pihkal-tihkal', 'consciousness', 'herbs'],
    keywords: ['dmt', 'pharmahuasca', 'changa', 'harmaline', 'maoi', 'vine', 'brew']
  },
  'herbs': {
    bridges: ['oilahuasca', 'phoenician', 'ayahuasca', 'soapmaking'],
    keywords: ['cannabis', 'nutmeg', 'cinnamon', 'terpene', 'essential oil', 'extraction']
  },
  'psychedelics': {
    bridges: ['oilahuasca', 'shulgin-pihkal-tihkal', 'ayahuasca', 'consciousness'],
    keywords: ['cyp450', 'enzyme', 'metabolism', 'interaction', 'safety']
  },
  'consciousness': {
    bridges: ['phoenician', 'oilahuasca', 'ayahuasca', 'ai_technology', 'spirituality'],
    keywords: ['zar', 'lucid', 'egregore', 'transmission', 'neurogenesis']
  },
  'ancient_egypt': {
    bridges: ['phoenician', 'mystery_schools', 'consciousness', 'history'],
    keywords: ['wadjet', 'temple', 'sistrum', 'hieroglyph', 'kyphi']
  }
};

class KnowledgeLoader {
  constructor(knowledgeBasePath) {
    // Default to the main knowledge base if not specified
    this.basePath = knowledgeBasePath || path.join(process.cwd(), '..', 'knowledge');
    this.documents = new Map();
    this.index = new Map(); // keyword -> document references
    this.domainDocuments = new Map(); // domain -> documents
    this.loaded = false;
  }

  /**
   * Load all documents from the knowledge base
   */
  async loadAll() {
    if (this.loaded) return;

    console.log(`[KnowledgeLoader] Loading from: ${this.basePath}`);

    if (!fs.existsSync(this.basePath)) {
      console.warn(`[KnowledgeLoader] Knowledge base path not found: ${this.basePath}`);
      return;
    }

    const domains = fs.readdirSync(this.basePath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .map(d => d.name);

    for (const domain of domains) {
      await this.loadDomain(domain);
    }

    // Build the keyword index
    this.buildIndex();

    this.loaded = true;
    console.log(`[KnowledgeLoader] Loaded ${this.documents.size} documents from ${domains.length} domains`);
  }

  /**
   * Load all documents from a single domain
   */
  async loadDomain(domain) {
    const domainPath = path.join(this.basePath, domain);
    const files = fs.readdirSync(domainPath).filter(f =>
      f.endsWith('.json') || f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.docx')
    );

    const domainDocs = [];

    for (const file of files) {
      try {
        const doc = await this.loadDocument(path.join(domainPath, file), domain);
        if (doc) {
          const docId = `${domain}/${file}`;
          this.documents.set(docId, doc);
          domainDocs.push(docId);
        }
      } catch (err) {
        console.error(`[KnowledgeLoader] Error loading ${domain}/${file}:`, err.message);
      }
    }

    this.domainDocuments.set(domain, domainDocs);
  }

  /**
   * Load a single document
   */
  async loadDocument(filePath, domain) {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    let content = '';
    let metadata = {};

    switch (ext) {
      case '.json':
        const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        content = this.flattenJSON(jsonData);
        metadata = jsonData.metadata || {};
        break;

      case '.md':
      case '.txt':
        content = fs.readFileSync(filePath, 'utf-8');
        break;

      case '.docx':
        const result = await mammoth.extractRawText({ path: filePath });
        content = result.value;
        break;

      default:
        return null;
    }

    return {
      domain,
      filename,
      path: filePath,
      content,
      metadata,
      tier: this.getDomainTier(domain),
      bridges: KNOWLEDGE_BRIDGES[domain]?.bridges || [],
      keywords: this.extractKeywords(content, domain)
    };
  }

  /**
   * Flatten JSON structure into searchable text
   */
  flattenJSON(obj, prefix = '') {
    let result = [];

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result.push(this.flattenJSON(value, newKey));
      } else if (Array.isArray(value)) {
        result.push(`${newKey}: ${value.map(v => typeof v === 'object' ? JSON.stringify(v) : v).join(', ')}`);
      } else {
        result.push(`${newKey}: ${value}`);
      }
    }

    return result.join('\n');
  }

  /**
   * Get the tier of a domain in the knowledge hierarchy
   */
  getDomainTier(domain) {
    for (const [tier, domains] of Object.entries(KNOWLEDGE_HIERARCHY)) {
      if (domains.includes(domain)) return tier;
    }
    return 'peripheral';
  }

  /**
   * Extract keywords from content
   */
  extractKeywords(content, domain) {
    const domainKeywords = KNOWLEDGE_BRIDGES[domain]?.keywords || [];
    const found = [];
    const contentLower = content.toLowerCase();

    // Check for domain-specific keywords
    for (const kw of domainKeywords) {
      if (contentLower.includes(kw.toLowerCase())) {
        found.push(kw);
      }
    }

    // Extract common important terms
    const importantTerms = [
      'oilahuasca', 'space paste', 'headcone', 'kyphi', 'allylbenzene',
      'shulgin', 'pihkal', 'tihkal', 'phenethylamine', 'tryptamine',
      'dmt', 'maoi', 'cyp450', 'transdermal', 'consciousness',
      'phoenician', 'punic', 'wadjet', 'zar', 'temple'
    ];

    for (const term of importantTerms) {
      if (contentLower.includes(term) && !found.includes(term)) {
        found.push(term);
      }
    }

    return found;
  }

  /**
   * Build keyword index for fast search
   */
  buildIndex() {
    for (const [docId, doc] of this.documents) {
      for (const keyword of doc.keywords) {
        if (!this.index.has(keyword)) {
          this.index.set(keyword, []);
        }
        this.index.get(keyword).push(docId);
      }
    }
  }

  /**
   * Search for documents by query - returns synthesized context
   * Follows the knowledge flow: Oilahuasca → Headcones → Related Topics
   */
  search(query, maxResults = 10) {
    const queryLower = query.toLowerCase();
    const results = [];
    const seen = new Set();

    // Score each document
    for (const [docId, doc] of this.documents) {
      let score = 0;

      // Direct content match
      if (doc.content.toLowerCase().includes(queryLower)) {
        score += 10;
      }

      // Keyword matches
      for (const keyword of doc.keywords) {
        if (queryLower.includes(keyword.toLowerCase())) {
          score += 5;
        }
      }

      // Tier bonus (root topics get priority)
      const tierBonus = { root: 4, primary: 3, secondary: 2, extended: 1, peripheral: 0 };
      score += tierBonus[doc.tier] || 0;

      // Word-level matches
      const words = queryLower.split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && doc.content.toLowerCase().includes(word)) {
          score += 2;
        }
      }

      if (score > 0) {
        results.push({ docId, doc, score });
      }
    }

    // Sort by score (highest first) and tier
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tierOrder = ['root', 'primary', 'secondary', 'extended', 'peripheral'];
      return tierOrder.indexOf(a.doc.tier) - tierOrder.indexOf(b.doc.tier);
    });

    return results.slice(0, maxResults);
  }

  /**
   * Get context for a topic, following the knowledge flow
   * This synthesizes information across multiple documents
   */
  getTopicContext(topic, maxDepth = 2) {
    const context = {
      primary: [],
      related: [],
      bridges: []
    };

    // Find primary documents
    const primaryResults = this.search(topic, 5);
    context.primary = primaryResults.map(r => ({
      id: r.docId,
      domain: r.doc.domain,
      excerpt: this.getExcerpt(r.doc.content, topic, 500),
      keywords: r.doc.keywords
    }));

    // Find related topics through bridges
    if (maxDepth > 0) {
      const seenDomains = new Set(primaryResults.map(r => r.doc.domain));

      for (const result of primaryResults) {
        for (const bridge of result.doc.bridges) {
          if (!seenDomains.has(bridge)) {
            const bridgeDocs = this.domainDocuments.get(bridge) || [];
            for (const docId of bridgeDocs.slice(0, 2)) {
              const doc = this.documents.get(docId);
              if (doc) {
                context.related.push({
                  id: docId,
                  domain: bridge,
                  connection: `Connected via ${result.doc.domain}`,
                  excerpt: this.getExcerpt(doc.content, topic, 300)
                });
              }
            }
            seenDomains.add(bridge);
          }
        }
      }
    }

    return context;
  }

  /**
   * Get an excerpt from content centered around a search term
   */
  getExcerpt(content, searchTerm, maxLength = 500) {
    const contentLower = content.toLowerCase();
    const searchLower = searchTerm.toLowerCase();

    let startIndex = contentLower.indexOf(searchLower);
    if (startIndex === -1) startIndex = 0;

    // Expand to include surrounding context
    const halfLength = Math.floor(maxLength / 2);
    let start = Math.max(0, startIndex - halfLength);
    let end = Math.min(content.length, startIndex + halfLength);

    // Adjust to word boundaries
    while (start > 0 && content[start] !== ' ' && content[start] !== '\n') start--;
    while (end < content.length && content[end] !== ' ' && content[end] !== '\n') end++;

    let excerpt = content.slice(start, end).trim();
    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';

    return excerpt;
  }

  /**
   * Get the starting context for wiki article generation
   * Always begins with Oilahuasca/Space Paste as the foundation
   */
  getFoundationalContext() {
    const context = {
      oilahuasca: [],
      spacePaste: [],
      headcones: [],
      shulgin: []
    };

    // Load Oilahuasca documents
    const oilaDocs = this.domainDocuments.get('oilahuasca') || [];
    for (const docId of oilaDocs) {
      const doc = this.documents.get(docId);
      if (doc) {
        if (doc.filename.includes('space_paste')) {
          context.spacePaste.push({
            id: docId,
            excerpt: this.getExcerpt(doc.content, 'space paste', 1000)
          });
        } else {
          context.oilahuasca.push({
            id: docId,
            excerpt: this.getExcerpt(doc.content, 'oilahuasca', 500)
          });
        }
      }
    }

    // Load Headcone/Phoenician documents
    const phoenicianDocs = this.domainDocuments.get('phoenician') || [];
    for (const docId of phoenicianDocs) {
      const doc = this.documents.get(docId);
      if (doc && (doc.filename.includes('headcone') || doc.filename.includes('wax'))) {
        context.headcones.push({
          id: docId,
          excerpt: this.getExcerpt(doc.content, 'headcone', 500)
        });
      }
    }

    // Load Shulgin documents
    const shulginDocs = this.domainDocuments.get('shulgin-pihkal-tihkal') || [];
    for (const docId of shulginDocs) {
      const doc = this.documents.get(docId);
      if (doc) {
        context.shulgin.push({
          id: docId,
          excerpt: this.getExcerpt(doc.content, 'essential oil', 500)
        });
      }
    }

    return context;
  }

  /**
   * Check if new information should update existing knowledge
   * Used when TIHKAL entries or other new data is added
   */
  findUpdatableTopics(newContent) {
    const updates = [];
    const newContentLower = newContent.toLowerCase();

    // Check what existing topics this new content relates to
    for (const [docId, doc] of this.documents) {
      let relevance = 0;
      const matchedKeywords = [];

      for (const keyword of doc.keywords) {
        if (newContentLower.includes(keyword.toLowerCase())) {
          relevance++;
          matchedKeywords.push(keyword);
        }
      }

      if (relevance >= 2) {
        updates.push({
          docId,
          domain: doc.domain,
          relevance,
          matchedKeywords,
          suggestion: `New information may update ${doc.domain} knowledge about: ${matchedKeywords.join(', ')}`
        });
      }
    }

    return updates.sort((a, b) => b.relevance - a.relevance);
  }
}

export default KnowledgeLoader;
