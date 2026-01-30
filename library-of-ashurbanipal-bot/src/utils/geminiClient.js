/**
 * Gemini AI Client for Wiki Knowledge Synthesis
 *
 * This client is specifically designed to SYNTHESIZE knowledge,
 * not copy/paste from documents. It creates wiki-style articles
 * that weave together information from multiple sources.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

class GeminiClient {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-lite',
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 4096,
      }
    });

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
   * Generate a wiki article synthesizing knowledge from multiple sources
   */
  async synthesizeArticle(topic, context, existingArticle = null) {
    const prompt = this.buildSynthesisPrompt(topic, context, existingArticle);

    try {
      const chat = this.model.startChat({
        history: [{
          role: 'user',
          parts: [{ text: this.systemInstruction }]
        }, {
          role: 'model',
          parts: [{ text: 'I understand. I am the Library of Ashurbanipal, ready to synthesize knowledge from the Van Kush Family Research Institute archives. I will weave together information from multiple sources, emphasizing the connections between Oilahuasca, Headcones, Shulgin\'s research, and related topics. How may I assist with wiki knowledge synthesis?' }]
        }]
      });

      const result = await chat.sendMessage(prompt);
      return result.response.text();
    } catch (error) {
      console.error('[GeminiClient] Synthesis error:', error);
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
      const chat = this.model.startChat({
        history: [{
          role: 'user',
          parts: [{ text: this.systemInstruction }]
        }, {
          role: 'model',
          parts: [{ text: 'Ready to answer questions by synthesizing knowledge from the archives.' }]
        }]
      });

      const result = await chat.sendMessage(prompt);
      return result.response.text();
    } catch (error) {
      console.error('[GeminiClient] Answer error:', error);
      throw error;
    }
  }

  /**
   * Analyze new content and suggest wiki updates
   */
  async analyzeForUpdates(newContent, relatedDocs) {
    const prompt = `Analyze this new content and determine how it should update the wiki knowledge base.

NEW CONTENT:
${newContent.slice(0, 3000)}

RELATED EXISTING DOCUMENTS:
${relatedDocs.map(d => `- ${d.docId}: ${d.matchedKeywords.join(', ')}`).join('\n')}

Provide:
1. Summary of new information
2. Which wiki articles should be updated
3. What specific information should be added/changed
4. How this connects to existing knowledge (especially Oilahuasca, Headcones, Shulgin research)`;

    try {
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('[GeminiClient] Update analysis error:', error);
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

    // Primary sources
    if (context.primary && context.primary.length > 0) {
      prompt += `=== PRIMARY SOURCES ===\n`;
      for (const source of context.primary) {
        prompt += `[${source.domain}/${source.id}]\n${source.excerpt}\n\n`;
      }
    }

    // Related sources
    if (context.related && context.related.length > 0) {
      prompt += `=== RELATED SOURCES ===\n`;
      for (const source of context.related) {
        prompt += `[${source.domain}] (${source.connection})\n${source.excerpt}\n\n`;
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
      const result = await this.model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('[GeminiClient] Brief response error:', error);
      throw error;
    }
  }
}

export default GeminiClient;
