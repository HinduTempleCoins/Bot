# Van Kush Bot - Free AI API Alternatives (2026)

**Purpose**: Replace expired Google Gemini API with free alternatives for Discord bot conversational AI

**Status**: Research complete, ready for integration

---

## 🎯 Top Priority: Llama 4 Maverick (FREE)

### OpenRouter.ai - Free Tier
- **URL**: https://openrouter.ai/meta-llama/llama-4-maverick:free
- **Model**: `meta-llama/llama-4-maverick:free`
- **Cost**: **100% FREE**
- **Specs**:
  - 17B active parameters (400B total with MoE architecture)
  - 128 experts (mixture-of-experts)
  - 1 million token context window
  - Multimodal (text + images)
  - 12 supported languages
- **Use Cases**:
  - Discord bot conversational AI (primary)
  - Vision-language tasks (analyzing user-uploaded images)
  - Code generation
  - Multilingual support for international Van Kush community

### Integration Steps
```javascript
// index.js - Replace Gemini with OpenRouter

const axios = require('axios');

const OPENROUTER_CONFIG = {
  API_KEY: process.env.OPENROUTER_API_KEY || 'sk-or-v1-free', // Free tier key
  MODEL: 'meta-llama/llama-4-maverick:free',
  ENDPOINT: 'https://openrouter.ai/api/v1/chat/completions'
};

async function generateAIResponse(prompt, context = []) {
  try {
    const response = await axios.post(OPENROUTER_CONFIG.ENDPOINT, {
      model: OPENROUTER_CONFIG.MODEL,
      messages: [
        { role: 'system', content: 'You are the Van Kush Family AI assistant. You help with HIVE-Engine trading, cryptocurrency knowledge, and Van Kush history.' },
        ...context,
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_CONFIG.API_KEY}`,
        'HTTP-Referer': 'https://vankushfamily.com', // Optional
        'X-Title': 'Van Kush Discord Bot' // Optional
      }
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('❌ OpenRouter API error:', error.response?.data || error.message);
    return null;
  }
}
```

---

## 🔄 Backup Options

### 1. Together AI (Free Quota)
- **URL**: https://www.together.ai/models/llama-4-maverick
- **Free Tier**: Small free quota for testing
- **Models Available**:
  - Llama 4 Maverick
  - Llama 3 (70B, 405B)
  - Mistral variants
  - Zephyr
- **Use Case**: Backup if OpenRouter rate limits hit

### 2. DeepAI (100% Free)
- **URL**: https://deepai.org/machine-learning-model/text-generator
- **Cost**: Completely free, no API key required
- **Limitations**:
  - Basic text generation only
  - Short-form outputs (not suitable for long conversations)
- **Use Case**: Emergency fallback for simple responses

### 3. Cohere API (Free Tier)
- **URL**: https://cohere.com/
- **Features**:
  - Text generation
  - Embeddings
  - Classification
  - Reranking
- **Free Tier**: Limited monthly quota
- **Use Case**: Alternative for text classification and embeddings

### 4. Mistral API (Free Testing)
- **URL**: https://mistral.ai/
- **Models**: Mixtral, Mistral 7B
- **Free Tier**: Limited plan for early testing
- **Use Case**: Creative writing, technical content generation

### 5. RapidAPI - Free ChatGPT API
- **URL**: https://rapidapi.com/Creativesdev/api/free-chatgpt-api
- **Features**:
  - Free ChatGPT access
  - OpenAI API compatibility
  - ChatGPT 3.5 API
- **Use Case**: Customer support, personalized content generation

---

## ❌ NOT Available: Bing Search API

**Important**: Bing Search APIs were retired on August 11, 2025.
- No free tier exists
- Replacement "Grounding with Bing Search" costs $35 per 1,000 transactions
- Requires Azure AI Agents subscription (additional cost)

**Alternative**: Use Google Custom Search API or Brave Search API for web search functionality.

---

## 🎭 NPC-Like Conversational Flow Implementation

### Emotional Relationship Tracking System

Based on user request for "RS3/Fallout NPC-like" interactions with emotional diamond graph:

```javascript
// relationship-tracker.js

const fs = require('fs');

// Emotional dimensions (4-axis diamond graph)
const EMOTIONAL_AXES = {
  TRUST: { min: -100, max: 100, default: 0 },      // Trust vs Distrust
  FORMALITY: { min: -100, max: 100, default: 0 },  // Casual vs Formal
  HELPFULNESS: { min: -100, max: 100, default: 50 }, // Helpful vs Dismissive
  HUMOR: { min: -100, max: 100, default: 20 }      // Serious vs Playful
};

class RelationshipTracker {
  constructor(dataFile = 'user-relationships.json') {
    this.dataFile = dataFile;
    this.relationships = this.loadData();
  }

  loadData() {
    if (fs.existsSync(this.dataFile)) {
      return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    }
    return {};
  }

  saveData() {
    fs.writeFileSync(this.dataFile, JSON.stringify(this.relationships, null, 2));
  }

  getOrCreateRelationship(userId) {
    if (!this.relationships[userId]) {
      this.relationships[userId] = {
        userId: userId,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        messageCount: 0,
        emotions: {
          trust: EMOTIONAL_AXES.TRUST.default,
          formality: EMOTIONAL_AXES.FORMALITY.default,
          helpfulness: EMOTIONAL_AXES.HELPFULNESS.default,
          humor: EMOTIONAL_AXES.HUMOR.default
        },
        history: [],
        flags: {
          askedAboutVKBT: false,
          askedAboutCURE: false,
          helpedWithTrading: false,
          apologized: false,
          madeJoke: false
        }
      };
      this.saveData();
    }
    return this.relationships[userId];
  }

  updateEmotion(userId, axis, delta) {
    const relationship = this.getOrCreateRelationship(userId);
    const axisConfig = EMOTIONAL_AXES[axis.toUpperCase()];

    relationship.emotions[axis.toLowerCase()] = Math.max(
      axisConfig.min,
      Math.min(axisConfig.max, relationship.emotions[axis.toLowerCase()] + delta)
    );

    relationship.lastSeen = new Date().toISOString();
    this.saveData();
  }

  recordInteraction(userId, category, details) {
    const relationship = this.getOrCreateRelationship(userId);
    relationship.messageCount++;
    relationship.history.push({
      timestamp: new Date().toISOString(),
      category: category,
      details: details
    });

    // Keep only last 100 interactions
    if (relationship.history.length > 100) {
      relationship.history = relationship.history.slice(-100);
    }

    relationship.lastSeen = new Date().toISOString();
    this.saveData();
  }

  setFlag(userId, flag, value = true) {
    const relationship = this.getOrCreateRelationship(userId);
    relationship.flags[flag] = value;
    this.saveData();
  }

  getPersonalityModifiers(userId) {
    const relationship = this.getOrCreateRelationship(userId);
    const emotions = relationship.emotions;

    return {
      greeting: this.getGreetingStyle(emotions),
      tone: this.getTone(emotions),
      helpfulness: this.getHelpfulnessLevel(emotions),
      shouldJoke: emotions.humor > 0
    };
  }

  getGreetingStyle(emotions) {
    if (emotions.trust < -50) return 'cautious';
    if (emotions.trust > 50) return 'warm';
    if (emotions.formality > 50) return 'professional';
    if (emotions.formality < -50) return 'casual';
    return 'neutral';
  }

  getTone(emotions) {
    if (emotions.trust < -30) return 'defensive';
    if (emotions.helpfulness < -30) return 'curt';
    if (emotions.humor > 50 && emotions.trust > 30) return 'playful';
    if (emotions.formality > 50) return 'formal';
    return 'friendly';
  }

  getHelpfulnessLevel(emotions) {
    if (emotions.helpfulness > 70) return 'very_helpful';
    if (emotions.helpfulness > 30) return 'helpful';
    if (emotions.helpfulness > -30) return 'neutral';
    return 'minimal';
  }
}

module.exports = { RelationshipTracker, EMOTIONAL_AXES };
```

### Button-Based Dialogue Flow System

```javascript
// dialogue-flows.js

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DIALOGUE_FLOWS = {
  VKBT_INTRODUCTION: {
    id: 'vkbt_intro',
    prompt: "I see you're interested in VKBT! It's the Van Kush Beauty Token, our primary community token launched in 2021. Would you like to learn more?",
    buttons: [
      { id: 'vkbt_history', label: '📜 History & Origins', style: ButtonStyle.Primary },
      { id: 'vkbt_tokenomics', label: '💰 Tokenomics', style: ButtonStyle.Primary },
      { id: 'vkbt_trading', label: '📈 Trading Strategy', style: ButtonStyle.Success },
      { id: 'vkbt_price', label: '💵 Current Price', style: ButtonStyle.Secondary },
      { id: 'back', label: '⬅️ Back', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +5, helpfulness: +5 }
  },

  VKBT_HISTORY: {
    id: 'vkbt_history',
    prompt: "VKBT has a rich history! Here are the key milestones:\n\n📅 **2013**: Van Kush Family joins Bitcointalk\n📅 **2014**: First Van Kush coin created (VKC)\n📅 **2021**: VKBT launched on HIVE-Engine (Sept 4)\n📅 **2021**: Rewards Pool activated (Sept 7)\n\nWhat aspect interests you most?",
    buttons: [
      { id: 'vkbt_bitcointalk', label: '💬 Bitcointalk Era', style: ButtonStyle.Primary },
      { id: 'vkbt_launch', label: '🚀 Launch Details', style: ButtonStyle.Primary },
      { id: 'vkbt_temple', label: '🏛️ Temple Connection', style: ButtonStyle.Secondary },
      { id: 'back', label: '⬅️ Back to VKBT', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +3, formality: +5 }
  },

  CURE_INTRODUCTION: {
    id: 'cure_intro',
    prompt: "CURE is our partner Tier 1 token! It's managed by the Cure Token team and shares priority with VKBT in our trading strategy. What would you like to know?",
    buttons: [
      { id: 'cure_partnership', label: '🤝 Partnership with VKBT', style: ButtonStyle.Primary },
      { id: 'cure_benefits', label: '💊 CURE Benefits', style: ButtonStyle.Primary },
      { id: 'cure_trading', label: '📈 Trading Strategy', style: ButtonStyle.Success },
      { id: 'cure_price', label: '💵 Current Price', style: ButtonStyle.Secondary },
      { id: 'back', label: '⬅️ Back', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +5, helpfulness: +5 }
  },

  TRADING_HELP: {
    id: 'trading_help',
    prompt: "I can help you understand HIVE-Engine trading! Our bots use a 5-tier token priority system. What area do you need help with?",
    buttons: [
      { id: 'trading_basics', label: '📚 Trading Basics', style: ButtonStyle.Primary },
      { id: 'trading_strategy', label: '🎯 Our Strategy', style: ButtonStyle.Primary },
      { id: 'trading_bots', label: '🤖 Bot Overview', style: ButtonStyle.Success },
      { id: 'trading_risks', label: '⚠️ Risks & Safety', style: ButtonStyle.Danger },
      { id: 'back', label: '⬅️ Back', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { helpfulness: +10, trust: +5 }
  },

  APOLOGY_DETECTED: {
    id: 'apology_response',
    prompt: "Hey, no worries! We all make mistakes. How can I help you get back on track?",
    buttons: [
      { id: 'start_over', label: '🔄 Start Over', style: ButtonStyle.Primary },
      { id: 'explain_better', label: '💬 Explain My Question Better', style: ButtonStyle.Primary },
      { id: 'get_help', label: '🆘 I Need Help', style: ButtonStyle.Success },
      { id: 'all_good', label: '✅ All Good Now', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { trust: +10, helpfulness: +10, formality: -10 }
  },

  HOT_COLD_GAME: {
    id: 'hot_cold',
    prompt: "🎮 Let's play a game! I'm thinking of a HIVE-Engine token. Ask me yes/no questions to figure it out!",
    buttons: [
      { id: 'hc_is_vkbt', label: 'Is it VKBT?', style: ButtonStyle.Primary },
      { id: 'hc_is_cure', label: 'Is it CURE?', style: ButtonStyle.Primary },
      { id: 'hc_is_tier1', label: 'Is it Tier 1?', style: ButtonStyle.Secondary },
      { id: 'hc_give_hint', label: '💡 Give me a hint', style: ButtonStyle.Success },
      { id: 'hc_give_up', label: '🏳️ I give up', style: ButtonStyle.Danger }
    ],
    emotionChanges: { humor: +15, trust: +5, formality: -15 }
  }
};

function createButtonRow(flowId) {
  const flow = DIALOGUE_FLOWS[flowId];
  if (!flow) return null;

  const rows = [];
  let currentRow = new ActionRowBuilder();

  flow.buttons.forEach((button, index) => {
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(button.id)
        .setLabel(button.label)
        .setStyle(button.style)
    );

    // Discord limit: 5 buttons per row
    if ((index + 1) % 5 === 0 || index === flow.buttons.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  });

  return rows;
}

function getDialogueFlow(flowId) {
  return DIALOGUE_FLOWS[flowId] || null;
}

module.exports = { DIALOGUE_FLOWS, createButtonRow, getDialogueFlow };
```

### Integration with Discord Bot

```javascript
// Add to index.js

const { RelationshipTracker } = require('./relationship-tracker.js');
const { createButtonRow, getDialogueFlow } = require('./dialogue-flows.js');

const relationshipTracker = new RelationshipTracker();

// In message handler
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const relationship = relationshipTracker.getOrCreateRelationship(userId);
  const personality = relationshipTracker.getPersonalityModifiers(userId);

  // Detect apology
  if (/sorry|apologize|my bad|my fault/i.test(message.content)) {
    const flow = getDialogueFlow('APOLOGY_DETECTED');
    const buttons = createButtonRow('APOLOGY_DETECTED');

    await message.reply({
      content: flow.prompt,
      components: buttons
    });

    relationshipTracker.recordInteraction(userId, 'apology', { message: message.content });
    Object.entries(flow.emotionChanges).forEach(([axis, delta]) => {
      relationshipTracker.updateEmotion(userId, axis, delta);
    });
    return;
  }

  // Detect VKBT interest
  if (/vkbt|van kush beauty/i.test(message.content)) {
    if (!relationship.flags.askedAboutVKBT) {
      const flow = getDialogueFlow('VKBT_INTRODUCTION');
      const buttons = createButtonRow('VKBT_INTRODUCTION');

      await message.reply({
        content: flow.prompt,
        components: buttons
      });

      relationshipTracker.setFlag(userId, 'askedAboutVKBT', true);
      relationshipTracker.recordInteraction(userId, 'vkbt_interest', { firstTime: true });
      Object.entries(flow.emotionChanges).forEach(([axis, delta]) => {
        relationshipTracker.updateEmotion(userId, axis, delta);
      });
      return;
    }
  }

  // Continue with normal AI response using personality modifiers
  // ...
});

// In button interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  const buttonId = interaction.customId;

  // Handle dialogue flow buttons
  if (DIALOGUE_FLOWS[buttonId]) {
    const flow = getDialogueFlow(buttonId);
    const buttons = createButtonRow(buttonId);

    await interaction.update({
      content: flow.prompt,
      components: buttons
    });

    relationshipTracker.recordInteraction(userId, 'dialogue_flow', { flowId: buttonId });
    if (flow.emotionChanges) {
      Object.entries(flow.emotionChanges).forEach(([axis, delta]) => {
        relationshipTracker.updateEmotion(userId, axis, delta);
      });
    }
    return;
  }

  // ... rest of button handling
});
```

---

## 📊 Emotional Diamond Graph Visualization

### Four-Axis System

```
        TRUST (+100)
            ▲
            │
            │
FORMAL ◄────┼────► CASUAL
  (+100)    │    (-100)
            │
            │
            ▼
      DISTRUST (-100)

        HELPFUL (+100)
            ▲
            │
            │
SERIOUS ◄───┼───► PLAYFUL
  (-100)    │    (+100)
            │
            │
            ▼
     DISMISSIVE (-100)
```

### Behavioral Changes Based on Position

**High Trust + High Helpfulness** (Quadrant 1):
- Proactive suggestions
- Detailed explanations
- "I noticed you might be interested in..."
- Remembers past conversations

**High Trust + High Humor** (Quadrant 2):
- Casual greetings ("Yo! 👋", "What's good?")
- Inside jokes about HIVE tokens
- "Haha, yeah VKBT to the moon! 🚀"
- Easter eggs and games

**Low Trust + High Formality** (Quadrant 3):
- Brief responses
- No unsolicited advice
- "Here is the information you requested."
- Professional distance

**Low Trust + Low Helpfulness** (Quadrant 4):
- Minimal responses
- "I don't have that information."
- Bot might reference past negative interactions
- "Like I said before..."

### Emotion Change Triggers

```javascript
// Positive interactions
relationship.updateEmotion(userId, 'trust', +10);  // User thanked the bot
relationship.updateEmotion(userId, 'helpfulness', +5);  // Bot successfully helped
relationship.updateEmotion(userId, 'humor', +15);  // User laughed at joke
relationship.updateEmotion(userId, 'formality', -10);  // User used casual language

// Negative interactions
relationship.updateEmotion(userId, 'trust', -15);  // User accused bot of error
relationship.updateEmotion(userId, 'helpfulness', -10);  // Bot couldn't help
relationship.updateEmotion(userId, 'humor', -20);  // User didn't like joke
relationship.updateEmotion(userId, 'formality', +15);  // User complained about casual tone
```

---

## 🔧 Environment Variables

Add to `.env`:

```env
# ========================================
# FREE AI APIS (2026)
# ========================================

# OpenRouter.ai - FREE Llama 4 Maverick
OPENROUTER_API_KEY=sk-or-v1-free  # Free tier key
OPENROUTER_MODEL=meta-llama/llama-4-maverick:free

# Together AI (backup)
TOGETHER_API_KEY=your_together_api_key  # Get from https://www.together.ai

# Cohere API (backup)
COHERE_API_KEY=your_cohere_api_key  # Get from https://cohere.com

# DeepAI (no key required)
DEEPAI_ENABLED=false  # Only use as last resort

# RapidAPI (optional)
RAPIDAPI_KEY=your_rapidapi_key  # Get from https://rapidapi.com
```

---

## 🎯 Implementation Priority

1. ✅ Research free AI APIs (COMPLETE)
2. ⏭️ Replace Gemini with OpenRouter Llama 4 Maverick in index.js
3. ⏭️ Create relationship-tracker.js module
4. ⏭️ Create dialogue-flows.js module
5. ⏭️ Integrate emotional tracking into message handler
6. ⏭️ Add button-based dialogue flows
7. ⏭️ Test with real Discord users
8. ⏭️ Create visualization dashboard for emotional graphs

---

## 📚 Resources

### Llama 4 Maverick
- [OpenRouter Free API](https://openrouter.ai/meta-llama/llama-4-maverick:free)
- [Hugging Face Model](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct)
- [Together AI](https://www.together.ai/models/llama-4-maverick)

### Free AI APIs
- [publicapis.dev - Machine Learning](https://publicapis.dev/category/machine-learning)
- [RapidAPI - Chatbot APIs](https://rapidapi.com/collection/chatbot-apis)
- [DeepAI Text Generator](https://deepai.org/machine-learning-model/text-generator)

### Bing Search Alternative
- [Google Custom Search API](https://developers.google.com/custom-search/v1/overview)
- [Brave Search API](https://brave.com/search/api/)

---

**Last Updated**: 2026-01-09
**Status**: Ready for implementation
**Next Step**: Replace Gemini with OpenRouter in index.js

---

Sources:
- [Llama 4 Maverick on OpenRouter](https://openrouter.ai/meta-llama/llama-4-maverick:free)
- [Llama 4 Maverick on Hugging Face](https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct)
- [Public APIs for Machine Learning](https://publicapis.dev/category/machine-learning)
- [Free AI APIs Guide 2026](https://visionvix.com/free-ai-apis/)
- [RapidAPI Chatbot Collection](https://rapidapi.com/collection/chatbot-apis)
- [Bing Search API Retirement Notice](https://www.microsoft.com/en-us/bing/apis/grounding-pricing)
