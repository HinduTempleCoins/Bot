/**
 * Gemini AI Client for Wiki Knowledge Synthesis
 *
 * This client is specifically designed to SYNTHESIZE knowledge,
 * not copy/paste from documents. It creates wiki-style articles
 * that weave together information from multiple sources.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// #181 — provider-agnostic LLM fallback. When the Gemini call fails (rate limit / no key / 5xx /
// safety block) we fall back to the shared router (OpenRouter → GitHub Models → Groq) so wiki
// generation continues instead of hard-failing. Imported lazily + guarded so a missing router file
// can NEVER break the bot; Gemini stays primary whenever its key is present.
let _routerComplete = null;        // resolved on first use: (prompt, opts) => {text, provider, model}
let _routerLoaded = false;
async function loadRouter() {
  if (_routerLoaded) return _routerComplete;
  _routerLoaded = true;
  try {
    const mod = await import('../../../integrations/llm-router.mjs');
    if (typeof mod.complete === 'function') _routerComplete = mod.complete;
  } catch (e) {
    // router unavailable — fallback simply won't engage; never crash the bot.
    console.error('[GeminiClient] LLM router unavailable, fallback disabled:', e?.message || e);
  }
  return _routerComplete;
}

// #88 — rate-limit / backoff + cost guard knobs (all env-overridable; safe defaults).
const LLM_MAX_RETRIES = Math.max(0, Number(process.env.LLM_MAX_RETRIES ?? 4));        // attempts AFTER the first
const LLM_BACKOFF_BASE_MS = Math.max(50, Number(process.env.LLM_BACKOFF_BASE_MS ?? 800));
const LLM_BACKOFF_MAX_MS = Math.max(1000, Number(process.env.LLM_BACKOFF_MAX_MS ?? 20000));
const LLM_MAX_CALLS_PER_RUN = Math.max(0, Number(process.env.LLM_MAX_CALLS_PER_RUN ?? 0)); // 0 = unlimited

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Raised when the per-run cost guard trips. Callers (the generator) can catch this to stop cleanly.
export class LLMBudgetExceededError extends Error {
  constructor(limit) { super(`LLM call budget exceeded (${limit} calls/run)`); this.name = 'LLMBudgetExceededError'; this.budget = limit; }
}

// Is this error worth retrying? Rate limits (429) and transient 5xx / network blips are; a bad
// request, auth failure, or safety block is not (retrying just burns the budget).
function isRetryable(err) {
  const s = err?.status ?? err?.response?.status ?? err?.statusCode;
  if (s === 429) return true;
  if (typeof s === 'number' && s >= 500) return true;
  const msg = String(err?.message || err).toLowerCase();
  return /rate|quota|429|timeout|temporarily|unavailable|overloaded|503|econn|socket|network|fetch failed/.test(msg);
}

class GeminiClient {
  constructor(apiKey) {
    // Whether a Gemini key is present. When ABSENT we skip the (doomed) Gemini SDK call entirely and
    // route straight through the keyless provider ladder (llm-router → pollinations), so article
    // generation runs with ZERO operator key. When a key IS present, Gemini stays primary and the
    // router is only a fallback (prior behaviour, unchanged).
    this.hasGemini = Boolean(apiKey && String(apiKey).trim());
    this.genAI = new GoogleGenerativeAI(apiKey);
    // #88 cost guard: count every LLM call (Gemini attempts + router fallbacks) against a per-run cap.
    this.callCount = 0;
    this.maxCallsPerRun = LLM_MAX_CALLS_PER_RUN;
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
   * #88 — cost guard. Charge one LLM call against the per-run budget. Logs and throws
   * LLMBudgetExceededError when the cap is reached so the run stops cleanly instead of silently
   * burning quota. A cap of 0 means unlimited.
   */
  _charge(label = 'llm') {
    this.callCount += 1;
    if (this.maxCallsPerRun > 0 && this.callCount > this.maxCallsPerRun) {
      console.error(`[GeminiClient] cost guard tripped: ${this.callCount - 1}/${this.maxCallsPerRun} calls used this run — stopping (${label}).`);
      throw new LLMBudgetExceededError(this.maxCallsPerRun);
    }
  }

  /**
   * #88 — run an async LLM operation with exponential backoff + retry. `fn` is called up to
   * (LLM_MAX_RETRIES + 1) times; only retryable errors (429 / 5xx / transient network) are retried,
   * with jittered exponential backoff. Each attempt is charged against the cost guard. The last
   * error is rethrown so the caller's existing fallback logic still runs.
   */
  async _withRetry(fn, label = 'llm') {
    let lastErr;
    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
      this._charge(label); // a LLMBudgetExceededError here is intentional and not retried
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (err instanceof LLMBudgetExceededError) throw err;
        if (attempt >= LLM_MAX_RETRIES || !isRetryable(err)) break;
        const backoff = Math.min(LLM_BACKOFF_MAX_MS, LLM_BACKOFF_BASE_MS * 2 ** attempt);
        const wait = Math.round(backoff * (0.5 + Math.random())); // jitter 0.5x–1.5x
        console.error(`[GeminiClient] ${label}: attempt ${attempt + 1} failed (${err?.status || err?.message || err}); retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  /**
   * #181 — fallback to the provider-agnostic router when the Gemini call fails. The SAME synthesis
   * prompt and grounding rules are preserved: the systemInstruction is passed as the router `system`
   * and the originally-built user prompt is passed verbatim. Returns the text, or rethrows the
   * ORIGINAL Gemini error if no fallback provider produced anything (so behaviour is unchanged when
   * there is genuinely no LLM available). Never prints any API key.
   * @param {string} prompt           the user prompt already built for Gemini
   * @param {Error}  geminiError      the error Gemini threw (rethrown if fallback also fails)
   * @param {object} [opts]           router opts (task hint, temperature, maxTokens)
   */
  async _routerFallback(prompt, geminiError, opts = {}) {
    // a budget trip on the Gemini path should NOT trigger a fallback that burns more quota.
    if (geminiError instanceof LLMBudgetExceededError) throw geminiError;
    const complete = await loadRouter();
    if (!complete) throw geminiError;               // no router on disk → preserve prior behaviour
    this._charge('router-fallback');                // the fallback is itself a (paid) LLM call
    const res = await complete(prompt, {
      system: this.systemInstruction,
      // Gemini is primary; the router skips it (no GEMINI_API_KEY or it just failed) and uses the
      // next rungs of the ladder. 'quality' biases toward the strongest remaining provider.
      task: opts.task || 'quality',
      temperature: opts.temperature ?? Number(process.env.GEMINI_TEMPERATURE ?? 0.25),
      maxTokens: opts.maxTokens ?? 4096,
      log: (m) => console.error(m),                 // router never logs key material
    });
    if (res && res.text && res.text.trim()) {
      console.error(`[GeminiClient] Gemini failed (${geminiError?.message || geminiError}); answered via fallback provider ${res.provider} (${res.model}).`);
      return res.text;
    }
    // all fallback providers failed too — surface the original Gemini error.
    throw geminiError;
  }

  /**
   * Run a prompt straight through the keyless provider ladder (no Gemini attempt). Used when no
   * GEMINI_API_KEY is configured so generation defaults to the free keyless models. Honours the same
   * cost guard. Throws if the router is unavailable or every provider failed, so callers can surface
   * the error exactly as the Gemini path would.
   * @param {string} prompt
   * @param {object} [opts] router opts (task hint, temperature, maxTokens)
   */
  async _routeKeyless(prompt, opts = {}) {
    const complete = await loadRouter();
    if (!complete) throw new Error('no LLM available: router not loaded and no GEMINI_API_KEY');
    this._charge('router-keyless');
    const res = await complete(prompt, {
      system: this.systemInstruction,
      task: opts.task || 'quality',
      temperature: opts.temperature ?? Number(process.env.GEMINI_TEMPERATURE ?? 0.25),
      maxTokens: opts.maxTokens ?? 4096,
      log: (m) => console.error(m),
    });
    if (res && res.text && res.text.trim()) {
      console.error(`[GeminiClient] no Gemini key — generated via keyless provider ${res.provider} (${res.model}).`);
      return res.text;
    }
    throw new Error(`keyless generation failed: ${res?.error || 'all providers returned empty'}`);
  }

  /**
   * Generate a wiki article synthesizing knowledge from multiple sources
   */
  async synthesizeArticle(topic, context, existingArticle = null) {
    const prompt = this.buildSynthesisPrompt(topic, context, existingArticle);

    // No Gemini key → go straight to the keyless ladder (don't waste a doomed Gemini round-trip).
    if (!this.hasGemini) return this._routeKeyless(prompt, { task: 'quality' });

    try {
      return await this._withRetry(async () => {
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
      }, 'synthesize');
    } catch (error) {
      if (error instanceof LLMBudgetExceededError) throw error;
      console.error('[GeminiClient] Synthesis error:', error);
      // #181 — keep generation alive on another provider instead of hard-failing.
      return this._routerFallback(prompt, error, { task: 'quality' });
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

    if (!this.hasGemini) return this._routeKeyless(prompt, { task: 'quality' });

    try {
      return await this._withRetry(async () => {
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
      }, 'answer');
    } catch (error) {
      if (error instanceof LLMBudgetExceededError) throw error;
      console.error('[GeminiClient] Answer error:', error);
      return this._routerFallback(prompt, error, { task: 'quality' });
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

    if (!this.hasGemini) return this._routeKeyless(prompt, { task: 'default' });

    try {
      return await this._withRetry(async () => {
        const result = await this.model.generateContent(prompt);
        return result.response.text();
      }, 'analyze');
    } catch (error) {
      if (error instanceof LLMBudgetExceededError) throw error;
      console.error('[GeminiClient] Update analysis error:', error);
      return this._routerFallback(prompt, error, { task: 'default' });
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

    if (!this.hasGemini) return this._routeKeyless(prompt, { task: 'cheap', maxTokens: 1024 });

    try {
      return await this._withRetry(async () => {
        const result = await this.model.generateContent(prompt);
        return result.response.text();
      }, 'brief');
    } catch (error) {
      if (error instanceof LLMBudgetExceededError) throw error;
      console.error('[GeminiClient] Brief response error:', error);
      // shorter Discord answer — bias to a cheap/fast provider on fallback.
      return this._routerFallback(prompt, error, { task: 'cheap', maxTokens: 1024 });
    }
  }
}

export default GeminiClient;
