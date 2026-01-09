// ========================================
// OPENROUTER AI INTEGRATION
// ========================================
// Purpose: Free AI alternative to Google Gemini
// Uses Llama 4 Maverick (100% FREE via OpenRouter.ai)
// Author: Claude Code
// Date: 2026-01-09

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ========================================
// CONFIGURATION
// ========================================

const OPENROUTER_CONFIG = {
  API_KEY: process.env.OPENROUTER_API_KEY || '',
  MODEL: process.env.OPENROUTER_MODEL || 'meta-llama/llama-4-maverick:free',
  ENDPOINT: 'https://openrouter.ai/api/v1/chat/completions',
  MAX_TOKENS: 1000,
  TEMPERATURE: 0.7
};

// ========================================
// OPENROUTER AI CLASS
// ========================================

class OpenRouterAI {
  constructor(apiKey = OPENROUTER_CONFIG.API_KEY, model = OPENROUTER_CONFIG.MODEL) {
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = OPENROUTER_CONFIG.ENDPOINT;
    this.enabled = Boolean(apiKey);

    if (!this.enabled) {
      console.warn('⚠️  OpenRouter API key not configured. Set OPENROUTER_API_KEY in .env');
    } else {
      console.log(`✅ OpenRouter AI initialized with model: ${this.model}`);
    }
  }

  // ========================================
  // GENERATE CONTENT (Gemini-compatible interface)
  // ========================================

  async generateContent(prompt, options = {}) {
    if (!this.enabled) {
      throw new Error('OpenRouter API key not configured');
    }

    try {
      const messages = [
        {
          role: 'user',
          content: prompt
        }
      ];

      // If systemContext provided, add as system message
      if (options.systemContext) {
        messages.unshift({
          role: 'system',
          content: options.systemContext
        });
      }

      const response = await axios.post(
        this.endpoint,
        {
          model: this.model,
          messages: messages,
          max_tokens: options.maxTokens || OPENROUTER_CONFIG.MAX_TOKENS,
          temperature: options.temperature || OPENROUTER_CONFIG.TEMPERATURE
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://vankushfamily.com',
            'X-Title': 'Van Kush Discord Bot',
            'Content-Type': 'application/json'
          }
        }
      );

      // Return in Gemini-compatible format
      return {
        response: {
          text: () => response.data.choices[0].message.content
        }
      };
    } catch (error) {
      console.error('❌ OpenRouter API error:', error.response?.data || error.message);
      throw new Error(`OpenRouter API failed: ${error.message}`);
    }
  }

  // ========================================
  // CHAT COMPLETION (Native OpenRouter interface)
  // ========================================

  async chat(messages, options = {}) {
    if (!this.enabled) {
      throw new Error('OpenRouter API key not configured');
    }

    try {
      const response = await axios.post(
        this.endpoint,
        {
          model: this.model,
          messages: messages,
          max_tokens: options.maxTokens || OPENROUTER_CONFIG.MAX_TOKENS,
          temperature: options.temperature || OPENROUTER_CONFIG.TEMPERATURE
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://vankushfamily.com',
            'X-Title': 'Van Kush Discord Bot',
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        content: response.data.choices[0].message.content,
        model: response.data.model,
        usage: response.data.usage
      };
    } catch (error) {
      console.error('❌ OpenRouter chat error:', error.response?.data || error.message);
      throw new Error(`OpenRouter chat failed: ${error.message}`);
    }
  }

  // ========================================
  // MULTI-TURN CONVERSATION
  // ========================================

  async conversationTurn(conversationHistory, newMessage, systemContext = null) {
    const messages = [];

    // Add system context if provided
    if (systemContext) {
      messages.push({
        role: 'system',
        content: systemContext
      });
    }

    // Add conversation history
    messages.push(...conversationHistory);

    // Add new user message
    messages.push({
      role: 'user',
      content: newMessage
    });

    const response = await this.chat(messages);

    // Return updated conversation history
    return {
      history: [
        ...conversationHistory,
        { role: 'user', content: newMessage },
        { role: 'assistant', content: response.content }
      ],
      response: response.content
    };
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  isAvailable() {
    return this.enabled;
  }

  getModel() {
    return this.model;
  }

  setModel(model) {
    this.model = model;
    console.log(`✅ OpenRouter model changed to: ${model}`);
  }

  // Get available free models
  static getFreeModels() {
    return [
      {
        id: 'meta-llama/llama-4-maverick:free',
        name: 'Llama 4 Maverick (Free)',
        description: '17B active parameters, multimodal, 1M context',
        cost: 'FREE'
      },
      {
        id: 'meta-llama/llama-4-scout:free',
        name: 'Llama 4 Scout (Free)',
        description: 'Smaller, faster variant',
        cost: 'FREE'
      }
    ];
  }
}

// ========================================
// FALLBACK AI MANAGER
// ========================================
// Tries OpenRouter first, falls back to Gemini if it fails

class FallbackAI {
  constructor(openRouterAI, geminiModel = null) {
    this.openRouter = openRouterAI;
    this.gemini = geminiModel;
    this.lastSuccessfulProvider = null;
  }

  async generateContent(prompt, options = {}) {
    // Try OpenRouter first (free)
    if (this.openRouter && this.openRouter.isAvailable()) {
      try {
        console.log('🔄 Trying OpenRouter AI...');
        const result = await this.openRouter.generateContent(prompt, options);
        this.lastSuccessfulProvider = 'openrouter';
        console.log('✅ OpenRouter succeeded');
        return result;
      } catch (error) {
        console.warn('⚠️  OpenRouter failed, falling back to Gemini:', error.message);
      }
    }

    // Fallback to Gemini
    if (this.gemini) {
      try {
        console.log('🔄 Trying Gemini AI...');

        // Gemini expects different format
        const result = await this.gemini.generateContent(prompt);
        this.lastSuccessfulProvider = 'gemini';
        console.log('✅ Gemini succeeded');
        return result;
      } catch (error) {
        console.error('❌ Gemini also failed:', error.message);
        throw new Error('All AI providers failed');
      }
    }

    throw new Error('No AI providers configured');
  }

  getLastProvider() {
    return this.lastSuccessfulProvider;
  }
}

// ========================================
// EXPORT
// ========================================

export { OpenRouterAI, FallbackAI, OPENROUTER_CONFIG };
