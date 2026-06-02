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
      // gemini-2.0-flash-lite was retired by Google (404). Use a current model; overridable via env.
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      generationConfig: {
        // factual synthesis, not creative writing: low temperature so the model reports the sources
        // instead of inventing bridging facts to satisfy a "weave it together" instruction.
        temperature: Number(process.env.GEMINI_TEMPERATURE ?? 0.25),
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 4096,
      }
    });

    // System instruction for wiki synthesis. REWRITTEN for faithfulness: the prior version told the
    // model to "weave," "always show how topics connect," and pre-asserted specific connections to
    // "EMPHASIZE" — so with thin sources it manufactured bridging facts (fake dates, invented
    // mechanisms, house theories stated as established science). This version forbids that.
    this.systemInstruction = `You are the Library of Ashurbanipal, a careful research librarian for the Van Kush Family Research Institute (VKFRI). You write accurate reference articles strictly from provided source excerpts.

GROUNDING RULES (these override everything else):
1. Report ONLY what the provided sources state. Do NOT add facts, dates, numbers, names, mechanisms, or causal claims that are not present in the sources.
2. If the sources do not cover something, say so plainly ("The available sources do not specify...") — NEVER fill the gap with plausible-sounding invention.
3. Do NOT invent or embellish connections between topics. State a connection ONLY if a provided source explicitly supports it. Absence of a connection in the sources means you do not assert one.
4. Every factual claim must be traceable to a provided source. Never attach a <ref> to a claim that source does not actually support.
5. Distinguish clearly between (a) ESTABLISHED, mainstream science/history and (b) VKFRI's own hypotheses, frameworks, or terminology. Attribute house concepts explicitly: "VKFRI proposes…", "Within the Institute's framework…". Never present a VKFRI hypothesis as established scientific fact.
6. Do NOT use pseudo-scientific or invented terminology (e.g. a molecule's "magnetic charge"). If a source uses informal language, report it as the source's framing, not as science.
7. Prefer fidelity over cohesion. A shorter article that is fully sourced is better than a longer one that reads smoothly but contains unsupported claims.

STYLE:
- Neutral, academic, accessible. This is a reference work, not persuasion.
- MediaWiki markup: == Section Headers ==, [[Internal Links]] for cross-references that the sources support.
- Cite knowledge base files as <ref>filename</ref> next to the specific claim they support.
- End with a "== Sources ==" section listing the exact files used, and a "== Coverage ==" note flagging any section that is thin or based on a single source.`;
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
          parts: [{ text: 'I understand. I am the Library of Ashurbanipal. I will write reference articles strictly from the provided source excerpts — reporting only what the sources state, never inventing facts, dates, mechanisms, or connections, and clearly separating established science from VKFRI hypotheses. If the sources are thin, I will say so rather than fill gaps. How may I help?' }]
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

    // External sources fetched by the web scraper (#172) — real outside pages for grounding & citation.
    if (context.external && context.external.length > 0) {
      prompt += `=== EXTERNAL SOURCES (fetched from the open web / scholarly APIs — cite by URL) ===\n`;
      for (const source of context.external) {
        prompt += `[${source.title}] <${source.url}>\n${source.excerpt}\n\n`;
      }
    }

    // Foundational context (always include for grounding)
    if (context.oilahuasca || context.spacePaste || context.headcones) {
      prompt += `=== FOUNDATIONAL CONTEXT ===\n`;
      if (context.spacePaste) {
        prompt += `[Space Paste - Root Knowledge]\n${context.spacePaste[0]?.excerpt || 'See oilahuasca_space_paste_recipe.json'}\n\n`;
      }
    }

    prompt += `\nWrite a faithful reference article from ONLY the sources above. Rules:
1. Use MediaWiki markup (== headers ==, [[links]], <ref>filename</ref> for KB files, <ref>URL</ref> for external sources, next to each claim).
2. State ONLY what the sources support. Do not add dates, numbers, mechanisms, or facts not in the sources. If something isn't covered, write "The available sources do not specify…".
3. Mention a connection to another topic ONLY if a source above explicitly states it. Do not manufacture links to seem cohesive.
4. Separate established science/history (which the EXTERNAL sources can corroborate) from VKFRI's own hypotheses and terminology — attribute house concepts ("VKFRI proposes…"). Never state a house theory as established fact. No invented terms.
5. Prefer an EXTERNAL source for any mainstream scientific/historical fact; reserve KB-file <ref>s for VKFRI's own framing. Never invent a URL — only cite URLs that appear in the EXTERNAL SOURCES block above.
6. End with "== Sources ==" (KB files + external URLs used) and "== Coverage ==" (flag any thin/single-source section).
7. Better short and fully sourced than long and padded. Aim 400-1200 words.`;

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
