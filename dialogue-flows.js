// ========================================
// VAN KUSH DIALOGUE FLOWS
// ========================================
// Purpose: NPC-like button-based conversational flows
// Inspired by RS3/Fallout dialogue systems
// Author: Claude Code
// Date: 2026-01-09

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

// ========================================
// DIALOGUE FLOW DEFINITIONS
// ========================================

const DIALOGUE_FLOWS = {
  // ========================================
  // MAIN MENU
  // ========================================
  MAIN_MENU: {
    id: 'main_menu',
    title: '🌿 Van Kush Family AI',
    prompt: "Welcome to the Van Kush Family! I'm here to help you learn about our tokens, trading strategies, and ancient temple heritage.\n\nWhat would you like to explore?",
    embed: true,
    color: 0x9b59b6,
    buttons: [
      { id: 'vkbt_intro', label: '💎 VKBT Token', style: ButtonStyle.Primary, emoji: '💎' },
      { id: 'cure_intro', label: '💊 CURE Token', style: ButtonStyle.Primary, emoji: '💊' },
      { id: 'trading_help', label: '📈 Trading Help', style: ButtonStyle.Success, emoji: '📈' },
      { id: 'temple_history', label: '🏛️ Temple History', style: ButtonStyle.Secondary, emoji: '🏛️' },
      { id: 'bot_status', label: '🤖 Bot Status', style: ButtonStyle.Secondary, emoji: '🤖' }
    ],
    emotionChanges: { helpfulness: +5 }
  },

  // ========================================
  // VKBT FLOWS
  // ========================================
  VKBT_INTRODUCTION: {
    id: 'vkbt_intro',
    title: '💎 Van Kush Beauty Token (VKBT)',
    prompt: "VKBT is the primary community token for the Van Kush Family ecosystem!\n\n**Quick Facts:**\n• Launched: September 4, 2021\n• Blockchain: HIVE-Engine (Layer-2)\n• Priority: Tier 1 (highest)\n• Use: Community membership, rewards, governance\n\n**Origins:**\nThe Van Kush Family has been active in crypto since 2013 on Bitcointalk. VKBT represents 75,000 years of temple culture brought to the blockchain.\n\nWhat would you like to learn?",
    embed: true,
    color: 0xFFD700,
    buttons: [
      { id: 'vkbt_history', label: '📜 Full History', style: ButtonStyle.Primary },
      { id: 'vkbt_tokenomics', label: '💰 Tokenomics', style: ButtonStyle.Primary },
      { id: 'vkbt_trading', label: '📈 Trading Strategy', style: ButtonStyle.Success },
      { id: 'vkbt_price', label: '💵 Current Price', style: ButtonStyle.Secondary },
      { id: 'main_menu', label: '⬅️ Back', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +5, helpfulness: +5 }
  },

  VKBT_HISTORY: {
    id: 'vkbt_history',
    title: '📜 VKBT History',
    prompt: "**The Journey to VKBT:**\n\n**2013**: Van Kush Family joins Bitcointalk, begins cryptocurrency exploration\n\n**2014**: First experiment - Van Kush Coin (VKC) created as learning project\n\n**2017**: Rev. Ryan (Angelicalist) writes comprehensive cryptocurrency creation guide\n\n**2021 (Sept 4)**: VKBT launches on HIVE-Engine\n\n**2021 (Sept 7)**: Rewards Pool activated - VKBT becomes SCOT bot token\n\n**2021-2026**: Community growth, trading bots development, ecosystem expansion\n\nWhat aspect interests you most?",
    embed: true,
    color: 0xFFD700,
    buttons: [
      { id: 'vkbt_bitcointalk', label: '💬 Bitcointalk Era', style: ButtonStyle.Primary },
      { id: 'vkbt_launch', label: '🚀 Launch Details', style: ButtonStyle.Primary },
      { id: 'vkbt_temple', label: '🏛️ Temple Connection', style: ButtonStyle.Secondary },
      { id: 'vkbt_intro', label: '⬅️ Back to VKBT', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +3, formality: +5 }
  },

  VKBT_TOKENOMICS: {
    id: 'vkbt_tokenomics',
    title: '💰 VKBT Tokenomics',
    prompt: "**VKBT Token Economics:**\n\n**Token Type**: SCOT Bot Token (Smart Contract Organizational Token)\n\n**Earning Methods**:\n• Content creation (posts/comments with #vankush)\n• Curation (upvoting quality content)\n• Staking VKBT for influence\n• Trading on HIVE-Engine\n\n**Utility**:\n• Community membership badge\n• Voting power on Van Kush content\n• Trading asset\n• Future: DAO governance, NFT minting\n\n**Supply**: Check current market metrics\n\nWant to dive deeper?",
    embed: true,
    color: 0xFFD700,
    buttons: [
      { id: 'vkbt_scot', label: '🎯 SCOT Bot Explained', style: ButtonStyle.Primary },
      { id: 'vkbt_staking', label: '🔒 Staking Benefits', style: ButtonStyle.Success },
      { id: 'vkbt_price', label: '💵 Current Price', style: ButtonStyle.Secondary },
      { id: 'vkbt_intro', label: '⬅️ Back', style: ButtonStyle.Danger }
    ],
    emotionChanges: { helpfulness: +5 }
  },

  VKBT_TRADING: {
    id: 'vkbt_trading',
    title: '📈 VKBT Trading Strategy',
    prompt: "**Our 5-Tier Token Priority System:**\n\n**Tier 1 (PRIORITY)**: VKBT + CURE\n• All trading profits reinvested here\n• Never sell for other tokens\n• Always accumulate\n\n**Tier 2 (STRATEGIC)**: BLURT\n• 1.4x preference multiplier\n• Build position alongside Tier 1\n\n**Tier 3 (SWAP ARBITRAGE)**: BTC, ETH, LTC, DOGE\n• Exploit price differences\n• Convert profits to VKBT/CURE\n\n**Tier 4 (UTILITY)**: BEE, WORKERBEE, DEC, SPS\n• Hold for platform access\n\n**Tier 5 (SWING TRADING)**: Everything else\n• Quick profits only\n\nWant to learn how our bots execute this?",
    embed: true,
    color: 0x00FF00,
    buttons: [
      { id: 'trading_bots', label: '🤖 Our Trading Bots', style: ButtonStyle.Primary },
      { id: 'trading_risks', label: '⚠️ Risks & Safety', style: ButtonStyle.Danger },
      { id: 'vkbt_price', label: '💵 Check Price Now', style: ButtonStyle.Success },
      { id: 'vkbt_intro', label: '⬅️ Back', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { helpfulness: +10, trust: +5 }
  },

  // ========================================
  // CURE FLOWS
  // ========================================
  CURE_INTRODUCTION: {
    id: 'cure_intro',
    title: '💊 CURE Token',
    prompt: "CURE is our partner Tier 1 token, managed by the Cure Token team!\n\n**Quick Facts:**\n• Priority: Tier 1 (equal to VKBT)\n• Focus: Health and wellness content\n• Rewards Pool: Active for #cure posts\n• Partnership: Strategic alliance with Van Kush Family\n\n**Why Tier 1?**\nCURE shares our community values and mission. All trading profits are split between VKBT and CURE accumulation.\n\nWhat would you like to know?",
    embed: true,
    color: 0xFF69B4,
    buttons: [
      { id: 'cure_partnership', label: '🤝 Partnership Details', style: ButtonStyle.Primary },
      { id: 'cure_benefits', label: '💊 CURE Benefits', style: ButtonStyle.Primary },
      { id: 'cure_trading', label: '📈 Trading Strategy', style: ButtonStyle.Success },
      { id: 'cure_price', label: '💵 Current Price', style: ButtonStyle.Secondary },
      { id: 'main_menu', label: '⬅️ Back', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +5, helpfulness: +5 }
  },

  CURE_PARTNERSHIP: {
    id: 'cure_partnership',
    title: '🤝 VKBT ↔ CURE Partnership',
    prompt: "**Strategic Alliance:**\n\nVan Kush Family and Cure Token share common goals:\n• Building sustainable HIVE-Engine communities\n• Rewarding quality content creators\n• Long-term token value growth\n• Mutual support and promotion\n\n**Joint Strategy:**\n• Trading bots accumulate both tokens\n• Community cross-promotion\n• Shared liquidity support\n• Future: Joint DAO initiatives\n\n**Benefit to Holders:**\nBy prioritizing both tokens, we create stronger market support and more opportunities for community growth.",
    embed: true,
    color: 0xFF69B4,
    buttons: [
      { id: 'cure_benefits', label: '💊 CURE Benefits', style: ButtonStyle.Primary },
      { id: 'vkbt_intro', label: '💎 Back to VKBT', style: ButtonStyle.Secondary },
      { id: 'cure_intro', label: '⬅️ Back to CURE', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +8, helpfulness: +5 }
  },

  // ========================================
  // TRADING FLOWS
  // ========================================
  TRADING_HELP: {
    id: 'trading_help',
    title: '📈 HIVE-Engine Trading Help',
    prompt: "I can help you understand HIVE-Engine trading!\n\n**Available Topics:**\n• Trading basics and how HIVE-Engine works\n• Our 5-tier token priority strategy\n• Bot overview and automation\n• Risk management and safety\n• Advanced strategies (arbitrage, market making)\n\nWhat would you like to learn about?",
    embed: true,
    color: 0x00BFFF,
    buttons: [
      { id: 'trading_basics', label: '📚 Trading Basics', style: ButtonStyle.Primary },
      { id: 'trading_strategy', label: '🎯 Our Strategy', style: ButtonStyle.Primary },
      { id: 'trading_bots', label: '🤖 Bot Overview', style: ButtonStyle.Success },
      { id: 'trading_risks', label: '⚠️ Risks & Safety', style: ButtonStyle.Danger },
      { id: 'main_menu', label: '⬅️ Back', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { helpfulness: +10, trust: +5 }
  },

  TRADING_BASICS: {
    id: 'trading_basics',
    title: '📚 HIVE-Engine Trading Basics',
    prompt: "**What is HIVE-Engine?**\n\nHIVE-Engine is a Layer-2 sidechain on HIVE blockchain. Think of it like Uniswap for HIVE!\n\n**Key Concepts:**\n• **Tokens**: Created via smart contracts\n• **Order Book**: Buy/sell orders at specific prices\n• **Pairs**: All tokens trade against HIVE\n• **Fees**: 0.25% per trade (very low!)\n\n**Common Actions:**\n• Market Buy/Sell: Execute immediately at best price\n• Limit Orders: Set your desired price, wait for match\n• Staking: Lock tokens for voting power\n\n**Getting Started:**\n1. Get HIVE on exchange (Binance, Bittrex)\n2. Send to HIVE wallet\n3. Use Hive-Engine.com or TribalDex.com\n4. Start small, learn the interface\n\nReady for more advanced topics?",
    embed: true,
    color: 0x00BFFF,
    buttons: [
      { id: 'trading_strategy', label: '🎯 Our Strategy', style: ButtonStyle.Primary },
      { id: 'trading_bots', label: '🤖 Bot Automation', style: ButtonStyle.Success },
      { id: 'trading_risks', label: '⚠️ Risks to Know', style: ButtonStyle.Danger },
      { id: 'trading_help', label: '⬅️ Back', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { helpfulness: +10 }
  },

  TRADING_STRATEGY: {
    id: 'trading_strategy',
    title: '🎯 Van Kush Trading Strategy',
    prompt: "**Our 5-Tier System (Full Details):**\n\n**TIER 1 - ACCUMULATE FOREVER** 💎\n• VKBT, CURE\n• Never sell these for other tokens\n• All profits reinvested here\n• Goal: Raise token prices\n\n**TIER 2 - STRATEGIC PREFERENCE** 🎯\n• BLURT (1.4x profit multiplier)\n• Build position alongside Tier 1\n• Long-term hold\n\n**TIER 3 - ARBITRAGE OPPORTUNITIES** 🔄\n• SWAP.BTC, SWAP.ETH, SWAP.LTC, SWAP.DOGE\n• Exploit price differences vs external exchanges\n• Profits → VKBT/CURE\n\n**TIER 4 - UTILITY TOKENS** 🛠️\n• BEE, WORKERBEE, DEC, SPS\n• Hold for platform access (staking, games)\n• Don't trade away\n\n**TIER 5 - SWING TRADING** 📊\n• Everything else\n• Quick profits only\n• Exit when target hit\n• Profits → VKBT/CURE\n\nWant to see how our bots implement this?",
    embed: true,
    color: 0xFFD700,
    buttons: [
      { id: 'trading_bots', label: '🤖 Bot Implementation', style: ButtonStyle.Primary },
      { id: 'trading_risks', label: '⚠️ Risk Management', style: ButtonStyle.Danger },
      { id: 'vkbt_trading', label: '💎 VKBT Strategy', style: ButtonStyle.Success },
      { id: 'trading_help', label: '⬅️ Back', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { helpfulness: +15, trust: +10 }
  },

  TRADING_BOTS: {
    id: 'trading_bots',
    title: '🤖 Van Kush Trading Bot Ecosystem',
    prompt: "**Our Bot Army:**\n\n**1. Market Maker Bot** (Phase 1)\n• Creates buy walls for VKBT\n• Nudges price upward gradually\n• Tracks whale activity\n• Status: ✅ Ready\n\n**2. Portfolio Tracker** (Phase 2)\n• Monitors all token balances\n• Calculates P&L in real-time\n• Discord reports every hour\n• Status: ✅ Ready\n\n**3. Arbitrage Scanner** (Phase 3)\n• Finds Swap.* opportunities\n• Calculates net profit after fees\n• Auto-alerts to Discord\n• Status: ✅ Ready\n\n**4. General Trading Bot** (Phase 4)\n• Executes 5-tier strategy\n• BLURT preference logic\n• Stop-loss protection\n• Status: ✅ Ready (needs API key)\n\n**5. Token Intelligence** (Phase 5)\n• Analyzes holder distribution\n• Tracks market sentiment\n• Research Hive.blog posts\n• Status: 🔨 In Development\n\nUse `/bots` command to check live status!",
    embed: true,
    color: 0x00FF00,
    buttons: [
      { id: 'bot_deploy', label: '🚀 Deployment Guide', style: ButtonStyle.Primary },
      { id: 'bot_config', label: '⚙️ Configuration', style: ButtonStyle.Primary },
      { id: 'trading_risks', label: '⚠️ Bot Risks', style: ButtonStyle.Danger },
      { id: 'trading_help', label: '⬅️ Back', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { helpfulness: +10 }
  },

  TRADING_RISKS: {
    id: 'trading_risks',
    title: '⚠️ Trading Risks & Safety',
    prompt: "**CRITICAL WARNINGS:**\n\n**🔐 Security Risks:**\n• Never commit private keys to GitHub\n• Use .env files for all credentials\n• HIVE Active Key = full fund control\n• Read SECURITY.md before deploying\n\n**💸 Financial Risks:**\n• Crypto is volatile - prices can crash\n• Bots can malfunction - start with small amounts\n• HIVE-Engine has low liquidity - large orders move prices\n• No guarantees - you can lose money\n\n**🤖 Bot-Specific Risks:**\n• API failures can cause missed trades\n• Price data lag can trigger bad trades\n• Bugs in code = potential losses\n• Always test in DRY_RUN mode first\n\n**✅ Safety Best Practices:**\n• Start with $50-100 max\n• Enable dry run mode initially\n• Set stop-loss limits\n• Monitor Discord alerts\n• Keep separate trading account from main holdings\n• Use Oracle Cloud Free Tier (no hosting cost)\n\n**Remember**: Only trade what you can afford to lose!",
    embed: true,
    color: 0xFF0000,
    buttons: [
      { id: 'security_guide', label: '🔐 Security Guide', style: ButtonStyle.Danger },
      { id: 'trading_basics', label: '📚 Back to Basics', style: ButtonStyle.Primary },
      { id: 'trading_help', label: '⬅️ Back', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { trust: +15, helpfulness: +10, formality: +10 }
  },

  // ========================================
  // TEMPLE HISTORY
  // ========================================
  TEMPLE_HISTORY: {
    id: 'temple_history',
    title: '🏛️ Van Kush Temple Heritage',
    prompt: "**75,000 Years of Sacred Tradition:**\n\nThe Van Kush Family traces its lineage to ancient Phoenician/Punic temple culture in the Mediterranean region.\n\n**Historical Timeline:**\n• **~73,000 BCE**: Origins in sacred plant cultivation\n• **3000 BCE**: Phoenician temple establishment\n• **814 BCE**: Carthage founded (Punic era)\n• **146 BCE**: Roman conquest, traditions go underground\n• **2013 CE**: Cryptocurrency era begins\n• **2021 CE**: VKBT brings temple culture to blockchain\n\n**Core Beliefs:**\n• Sacred geometry and natural patterns\n• Community cooperation over competition\n• Preservation of ancient wisdom\n• Technological innovation honoring tradition\n\nWant to learn more about this connection?",
    embed: true,
    color: 0x8B4513,
    buttons: [
      { id: 'temple_phoenician', label: '⚓ Phoenician Era', style: ButtonStyle.Primary },
      { id: 'temple_crypto', label: '💻 Crypto Connection', style: ButtonStyle.Success },
      { id: 'vkbt_temple', label: '💎 VKBT & Temples', style: ButtonStyle.Secondary },
      { id: 'main_menu', label: '⬅️ Back', style: ButtonStyle.Danger }
    ],
    emotionChanges: { trust: +5, formality: +10 }
  },

  // ========================================
  // SPECIAL INTERACTIONS
  // ========================================
  APOLOGY_DETECTED: {
    id: 'apology_response',
    title: '💙 No Worries!',
    prompt: "Hey, it's all good! We all make mistakes. No hard feelings here. 😊\n\nHow can I help you get back on track?",
    embed: true,
    color: 0x87CEEB,
    buttons: [
      { id: 'main_menu', label: '🔄 Start Fresh', style: ButtonStyle.Primary },
      { id: 'trading_help', label: '📈 Trading Help', style: ButtonStyle.Success },
      { id: 'vkbt_intro', label: '💎 Learn About VKBT', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { trust: +15, helpfulness: +10, formality: -15, humor: +5 }
  },

  THANK_YOU_RESPONSE: {
    id: 'thank_you_response',
    title: '🌿 You\'re Welcome!',
    prompt: "Happy to help! That's what I'm here for. 😊\n\nNeed anything else?",
    embed: true,
    color: 0x90EE90,
    buttons: [
      { id: 'main_menu', label: '🏠 Main Menu', style: ButtonStyle.Primary },
      { id: 'trading_help', label: '📈 More Trading Help', style: ButtonStyle.Success },
      { id: 'vkbt_price', label: '💵 Check VKBT Price', style: ButtonStyle.Secondary }
    ],
    emotionChanges: { trust: +10, helpfulness: +5, humor: +5 }
  },

  HOT_COLD_GAME: {
    id: 'hot_cold',
    title: '🎮 Token Guessing Game!',
    prompt: "Let's play! I'm thinking of a HIVE-Engine token...\n\n🔥 **HOT** = You're close!\n❄️ **COLD** = Way off!\n\nAsk me yes/no questions to figure it out!",
    embed: true,
    color: 0xFF4500,
    buttons: [
      { id: 'hc_is_vkbt', label: 'Is it VKBT?', style: ButtonStyle.Primary },
      { id: 'hc_is_cure', label: 'Is it CURE?', style: ButtonStyle.Primary },
      { id: 'hc_is_tier1', label: 'Is it Tier 1?', style: ButtonStyle.Secondary },
      { id: 'hc_give_hint', label: '💡 Give Hint', style: ButtonStyle.Success },
      { id: 'main_menu', label: '❌ Quit Game', style: ButtonStyle.Danger }
    ],
    emotionChanges: { humor: +20, trust: +5, formality: -20 }
  }
};

// ========================================
// HELPER FUNCTIONS
// ========================================

function createButtonRows(flowId) {
  const flow = DIALOGUE_FLOWS[flowId];
  if (!flow) {
    console.error(`❌ Unknown dialogue flow: ${flowId}`);
    return [];
  }

  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  flow.buttons.forEach((button, index) => {
    const btn = new ButtonBuilder()
      .setCustomId(button.id)
      .setLabel(button.label)
      .setStyle(button.style);

    if (button.emoji) {
      btn.setEmoji(button.emoji);
    }

    currentRow.addComponents(btn);
    buttonCount++;

    // Discord limit: 5 buttons per row, 5 rows max
    if (buttonCount === 5 || index === flow.buttons.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      buttonCount = 0;
    }
  });

  return rows.filter(row => row.components.length > 0);
}

function getDialogueFlow(flowId) {
  return DIALOGUE_FLOWS[flowId] || null;
}

function createDialogueEmbed(flowId) {
  const flow = DIALOGUE_FLOWS[flowId];
  if (!flow || !flow.embed) return null;

  const embed = new EmbedBuilder()
    .setColor(flow.color || 0x9b59b6)
    .setDescription(flow.prompt)
    .setTimestamp();

  if (flow.title) {
    embed.setTitle(flow.title);
  }

  return embed;
}

function createDialogueResponse(flowId) {
  const flow = DIALOGUE_FLOWS[flowId];
  if (!flow) return null;

  const response = {
    components: createButtonRows(flowId)
  };

  if (flow.embed) {
    response.embeds = [createDialogueEmbed(flowId)];
  } else {
    response.content = flow.prompt;
  }

  return response;
}

// ========================================
// INTENT DETECTION
// ========================================

function detectDialogueIntent(message) {
  const content = message.toLowerCase();

  // VKBT interest
  if (/vkbt|van kush beauty/i.test(content)) {
    return 'vkbt_intro';
  }

  // CURE interest
  if (/\bcure\b/i.test(content) && !/cure token/i.test(content)) {
    return 'cure_intro';
  }

  // Trading help
  if (/trading|trade|buy|sell|how to trade|hive-engine/i.test(content)) {
    return 'trading_help';
  }

  // Temple/history
  if (/temple|history|phoenician|ancient|heritage/i.test(content)) {
    return 'temple_history';
  }

  // Apology
  if (/sorry|apologize|my bad|my fault/i.test(content)) {
    return 'apology_response';
  }

  // Thank you
  if (/thank|thanks|thx|appreciate/i.test(content)) {
    return 'thank_you_response';
  }

  // Game request
  if (/game|play|fun|bored/i.test(content)) {
    return 'hot_cold';
  }

  return null;
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  DIALOGUE_FLOWS,
  createButtonRows,
  getDialogueFlow,
  createDialogueEmbed,
  createDialogueResponse,
  detectDialogueIntent
};
