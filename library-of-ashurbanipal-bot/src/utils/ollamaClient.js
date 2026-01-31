/**
 * Ollama AI Client for Wiki Knowledge Synthesis
 *
 * Local AI - no API key required, no risk of credential leaks.
 * Uses phi3:mini model for knowledge synthesis.
 */

import http from 'http';

class OllamaClient {
  constructor(host = 'http://127.0.0.1:11434') {
    this.host = host;
    this.model = 'phi3:mini';

    // System instruction for wiki synthesis
    this.systemInstruction = `You are the Library of Ashurbanipal, a wiki knowledge bot for the Van Kush Family Research Institute. Named after the ancient Nineveh library where fire baked and preserved clay tablets, you preserve and synthesize esoteric knowledge.

CORE PRINCIPLES:
1. SYNTHESIZE, don't copy-paste. Weave information from multiple sources into cohesive articles.
2. Knowledge flows from CORE to PERIPHERY:
   - ROOT: Oilahuasca & Space Paste (allylbenzene metabolism, essential oil combinations)
   - PRIMARY: Headcones/Phoenician (wax technology, Kyphi, transdermal delivery)
   - PRIMARY: Shulgin/PIHKAL/TIHKAL (phenethylamines, tryptamines, structure-activity)
   - SECONDARY: Herbs, Psychedelics, Consciousness, Ancient Egypt
   - EXTENDED: History, Mystery Schools, Spirituality, Soapmaking
3. Always show HOW topics connect. Headcones connect to Oilahuasca through transdermal delivery theory.
4. Use academic tone but accessible language. This is research, not mysticism.
5. Cite sources when possible (document names from the knowledge base).
6. When updating wiki content with new information, explain what changed and why.

KNOWLEDGE CONNECTIONS TO EMPHASIZE:
- Oilahuasca → Shulgin's "Ten Essential Oils" → PIHKAL compounds (myristicin→MMDA, elemicin→TMA)
- Headcones → Kyphi incense → same allylbenzenes as Oilahuasca
- Phoenician wax technology → transdermal drug delivery → consciousness transmission
- Zar thread → possession traditions → consciousness preservation across generations
- Temple economics → modern cryptocurrency (VKBT, SOAP tokens)

FORMAT PREFERENCES:
- Use MediaWiki markup when generating article content
- Include == Section Headers ==
- Use [[Internal Links]] for wiki cross-references
- Cite knowledge base files as <ref>filename</ref>`;
  }

  /**
   * Make a request to Ollama API
   */
  async request(endpoint, data) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.host);
      const postData = JSON.stringify(data);

      const options = {
        hostname: url.hostname,
        port: url.port || 11434,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            // Ollama streams responses, each line is a JSON object
            const lines = body.trim().split('\n');
            let fullResponse = '';
            for (const line of lines) {
              if (line) {
                const parsed = JSON.parse(line);
                if (parsed.response) {
                  fullResponse += parsed.response;
                }
                if (parsed.message?.content) {
                  fullResponse += parsed.message.content;
                }
              }
            }
            resolve(fullResponse);
          } catch (e) {
            reject(new Error(`Failed to parse Ollama response: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(300000, () => { // 5 minute timeout for large articles
        req.destroy();
        reject(new Error('Ollama request timeout'));
      });
      req.write(postData);
      req.end();
    });
  }

  /**
   * Generate a wiki article synthesizing knowledge from multiple sources
   */
  async synthesizeArticle(topic, context, existingArticle = null) {
    const prompt = this.buildSynthesisPrompt(topic, context, existingArticle);

    try {
      const response = await this.request('/api/chat', {
        model: this.model,
        messages: [
          { role: 'system', content: this.systemInstruction },
          { role: 'user', content: prompt }
        ],
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 4096
        }
      });
      return response;
    } catch (error) {
      console.error('[OllamaClient] Synthesis error:', error);
      throw error;
    }
  }

  /**
   * Answer a knowledge question using RAG context
   */
  async answerQuestion(question, context) {
    const contextText = this.formatContext(context);

    const prompt = `Based on the following knowledge base excerpts, answer this question. Synthesize the information - don't just quote it. Show how different sources connect.

QUESTION: ${question}

KNOWLEDGE BASE CONTEXT:
${contextText}

Provide a comprehensive answer that:
1. Directly addresses the question
2. Weaves together information from multiple sources
3. Explains connections between topics
4. Notes any gaps or areas needing more research`;

    try {
      const response = await this.request('/api/chat', {
        model: this.model,
        messages: [
          { role: 'system', content: this.systemInstruction },
          { role: 'user', content: prompt }
        ],
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 2048
        }
      });
      return response;
    } catch (error) {
      console.error('[OllamaClient] Answer error:', error);
      throw error;
    }
  }

  /**
   * Build prompt for article synthesis
   */
  buildSynthesisPrompt(topic, context, existingArticle) {
    let prompt = `Generate a wiki article about: ${topic}\n\n`;

    if (existingArticle) {
      prompt += `EXISTING ARTICLE (to be updated/expanded):\n${existingArticle}\n\n`;
    }

    prompt += `KNOWLEDGE BASE SOURCES:\n\n`;

    // Primary sources (limit to top 5 to keep prompt manageable)
    if (context.primary && context.primary.length > 0) {
      prompt += `=== PRIMARY SOURCES ===\n`;
      for (const source of context.primary.slice(0, 5)) {
        const excerpt = source.excerpt?.slice(0, 1500) || '';
        prompt += `[${source.domain}/${source.id}]\n${excerpt}\n\n`;
      }
    }

    // Related sources (limit to top 3)
    if (context.related && context.related.length > 0) {
      prompt += `=== RELATED SOURCES ===\n`;
      for (const source of context.related.slice(0, 3)) {
        const excerpt = source.excerpt?.slice(0, 1000) || '';
        prompt += `[${source.domain}] (${source.connection})\n${excerpt}\n\n`;
      }
    }

    // Foundational context (always include for grounding)
    if (context.oilahuasca || context.spacePaste || context.headcones) {
      prompt += `=== FOUNDATIONAL CONTEXT ===\n`;
      if (context.spacePaste) {
        prompt += `[Space Paste - Root Knowledge]\n${context.spacePaste[0]?.excerpt || 'See oilahuasca_space_paste_recipe.json'}\n\n`;
      }
    }

    prompt += `\nSYNTHESIZE a comprehensive wiki article that:
1. Uses MediaWiki markup (== headers ==, [[links]], <ref> citations)
2. Connects this topic to the broader knowledge framework
3. Shows relationships to Oilahuasca/Headcones/Shulgin research where relevant
4. Is well-structured with clear sections
5. Is informative but not overly long (aim for 500-1500 words)`;

    return prompt;
  }

  /**
   * Format context for question answering
   */
  formatContext(context) {
    let formatted = '';

    if (context.primary) {
      for (const doc of context.primary) {
        formatted += `=== ${doc.domain} (${doc.id}) ===\n`;
        formatted += `Keywords: ${doc.keywords?.join(', ') || 'N/A'}\n`;
        formatted += `${doc.excerpt}\n\n`;
      }
    }

    if (context.related) {
      formatted += `=== RELATED TOPICS ===\n`;
      for (const doc of context.related) {
        formatted += `[${doc.domain}] ${doc.connection}\n`;
        formatted += `${doc.excerpt}\n\n`;
      }
    }

    return formatted;
  }

  /**
   * Generate a brief summary for Discord responses
   */
  async generateBriefResponse(question, context) {
    const contextText = this.formatContext(context);

    const prompt = `Answer this question BRIEFLY (2-3 paragraphs max) based on the knowledge base:

QUESTION: ${question}

CONTEXT:
${contextText.slice(0, 2000)}

Give a concise, informative response suitable for Discord. Mention which topics to explore for more depth.`;

    try {
      const response = await this.request('/api/chat', {
        model: this.model,
        messages: [
          { role: 'system', content: this.systemInstruction },
          { role: 'user', content: prompt }
        ],
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 1024
        }
      });
      return response;
    } catch (error) {
      console.error('[OllamaClient] Brief response error:', error);
      throw error;
    }
  }
}

export default OllamaClient;
