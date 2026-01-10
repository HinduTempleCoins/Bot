#!/usr/bin/env node

// ========================================
// HIVE CONTENT & TIP FARMING BOT
// ========================================
// Purpose: Post daily content about VKBT/CURE to generate interest
//          Request tips using HIVE-Engine tip bot commands
//          Build community and awareness for Van Kush Family tokens
// Author: Claude Code
// Date: 2026-01-10

require('dotenv').config();
const dhive = require('@hiveio/dhive');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // HIVE credentials
  HIVE_USERNAME: process.env.HIVE_USERNAME || '',
  HIVE_POSTING_KEY: process.env.HIVE_POSTING_KEY || '',

  // Posting schedule
  POST_INTERVAL_HOURS: 24,          // Post once per day
  POST_TIME_UTC_HOUR: 14,           // Post at 2 PM UTC (optimal engagement)

  // Tip commands to include
  TIP_COMMANDS: [
    '!PIZZA',    // Pizza tip
    '!BEER',     // Beer tip
    '!LUV',      // LUV tip
    '!WINEX',    // Wine tip
    '!HUG',      // Hug tip
    '!hivebits', // Mining token (once per day)
    '!GM'        // Mining token (once per day)
  ],

  // Target tokens to promote
  TARGET_TOKENS: ['VKBT', 'CURE'],

  // Content tags
  TAGS: ['vankushfamily', 'vkbt', 'cure', 'hive-engine', 'cryptocurrency', 'token', 'investment'],

  // Dry run mode
  DRY_RUN: process.env.HIVE_BOT_DRY_RUN === 'true'
};

// ========================================
// HIVE CLIENT
// ========================================

const client = new dhive.Client([
  'https://api.hive.blog',
  'https://api.hivekings.com',
  'https://anyx.io',
  'https://api.openhive.network'
]);

// ========================================
// CONTENT TEMPLATES
// ========================================

const CONTENT_TEMPLATES = [
  {
    title: '🌟 VKBT & CURE: The Scarcity Advantage in Hive-Engine 🌟',
    body: `
# Why VKBT and CURE Are Different

Most tokens flood the market with billions of units. **VKBT and CURE take the opposite approach** - extreme scarcity combined with wide distribution.

## The Numbers That Matter

**CURE Token:**
- Total Supply: Just **55,575 CURE**
- That's rarer than Bitcoin's daily minting!
- Nearly 1,000 unique holders
- Wide distribution = Strong community

**VKBT Token:**
- Total Supply: **1.9 Million VKBT**
- Still far smaller than most tokens
- 986 unique holders
- Growing ecosystem

## Why Scarcity Matters

When fewer tokens exist AND they're widely distributed:
1. **Limited Sell Pressure** - Can't dump what doesn't exist
2. **Strong Community** - 1,000 holders all want price appreciation
3. **Price Discovery** - Small buy walls = easy price movement
4. **Long-term Value** - Scarcity preserves value over time

## Current Opportunity

Both tokens are trading well below their potential. With patient accumulation and community building, we're creating sustainable value for all holders.

Join the Van Kush Family movement! 🚀

---

*Like this content? Show some love with tips!*

{TIP_COMMANDS}

---

**Learn More:**
- Trade VKBT: https://tribaldex.com/trade/VKBT
- Trade CURE: https://tribaldex.com/trade/CURE
- Van Kush Family: Building value through scarcity

#VanKushFamily #VKBT #CURE #HiveEngine #Cryptocurrency #Scarcity
`
  },
  {
    title: '📊 Market Psychology & The Van Kush Strategy 📊',
    body: `
# How We\'re Building Sustainable Token Value

## The Traditional Problem

Most token projects:
- Launch with massive supply
- Hope for instant pump
- Crash when whales dump
- Community loses faith

## The Van Kush Approach

We\'re doing something different:

### 1. Scarcity First
- CURE: 55K tokens (rarer than Bitcoin\'s daily mint!)
- VKBT: 1.9M tokens (tiny compared to billions in other projects)

### 2. Wide Distribution
- Nearly 1,000 holders for each token
- No single whale can crash the market
- Community owns the majority

### 3. Patient Growth
- No pump and dump
- Gradual price anchoring
- Building buy walls slowly
- Sustainable long-term value

## Current Market Status

**CURE:**
- Price: Well positioned for growth
- Holders: 999 unique wallets
- Liquidity: Building steadily

**VKBT:**
- Price: Great entry opportunity
- Holders: 986 unique wallets
- Community: Active and growing

## The Opportunity

We\'re in the accumulation phase. Smart money recognizes:
- Limited supply can\'t be inflated
- Wide holder base = strong support
- Patient strategy = sustainable gains

This isn\'t a get-rich-quick scheme. It\'s building real, lasting value.

---

*Support this research!*

{TIP_COMMANDS}

---

Trade on TribalDEX:
- VKBT: https://tribaldex.com/trade/VKBT
- CURE: https://tribaldex.com/trade/CURE

#VanKushFamily #TokenEconomics #MarketPsychology #VKBT #CURE
`
  },
  {
    title: '🎯 Daily VKBT & CURE Update: Building the Foundation 🎯',
    body: `
# Van Kush Family Daily Report

## Token Snapshot

**CURE Token:**
- Supply: 55,575 (Ultra-scarce!)
- Holders: 999 unique wallets
- Status: Ready for patient accumulation

**VKBT Token:**
- Supply: 1,930,558
- Holders: 986 unique wallets
- Status: Strong community base

## Why These Numbers Matter

Think about it:
- Most tokens: Billions in supply
- CURE: Just 55K total
- VKBT: Under 2M total

**That\'s not a bug, it\'s a feature.**

## The Strategy in Action

We\'re not trying to force prices up overnight. Instead:

1. **Build gradually** - Small, consistent moves
2. **Wide distribution** - Get tokens in more hands
3. **Community first** - Value comes from people, not hype
4. **Sustainable growth** - No pump and dump

## Join the Movement

The Van Kush Family is building something different:
- Real scarcity (not artificial)
- Wide distribution (not whale-controlled)
- Patient growth (not pump and dump)
- Community value (not empty promises)

Every holder matters. Every trade matters. We\'re in this together.

---

*Enjoying these updates? Tips appreciated!*

{TIP_COMMANDS}

---

**Get Involved:**
- Trade: https://tribaldex.com
- Learn: Follow for daily updates
- Engage: Comment your thoughts below!

#VanKushFamily #DailyUpdate #VKBT #CURE #CommunityFirst
`
  }
];

// ========================================
// CONTENT GENERATION
// ========================================

function getRandomTemplate() {
  return CONTENT_TEMPLATES[Math.floor(Math.random() * CONTENT_TEMPLATES.length)];
}

function generatePost() {
  const template = getRandomTemplate();
  const tipCommands = CONFIG.TIP_COMMANDS.join(' ');

  // Replace placeholders
  let body = template.body.replace('{TIP_COMMANDS}', tipCommands);

  // Add timestamp
  const timestamp = new Date().toISOString();
  body += `\n\n---\n*Posted: ${timestamp}*\n`;

  return {
    title: template.title,
    body: body.trim(),
    tags: CONFIG.TAGS
  };
}

// ========================================
// HIVE POSTING
// ========================================

async function publishPost() {
  const post = generatePost();

  console.log('\n' + '='.repeat(60));
  console.log('📝 PUBLISHING HIVE POST');
  console.log('='.repeat(60));
  console.log(`Title: ${post.title}`);
  console.log(`Tags: ${post.tags.join(', ')}`);
  console.log(`Length: ${post.body.length} characters`);
  console.log(`Dry Run: ${CONFIG.DRY_RUN ? '✅ ENABLED' : '⚡ LIVE'}`);

  if (CONFIG.DRY_RUN) {
    console.log('\n📄 Post Content Preview:');
    console.log(post.body.substring(0, 500) + '...\n');
    console.log('✅ DRY RUN - Post not actually published');
    return {
      success: true,
      dryRun: true
    };
  }

  try {
    // Create permalink-friendly version of title
    const permlink = post.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      + '-' + Date.now();

    // Prepare comment operation
    const commentOp = [
      'comment',
      {
        parent_author: '',
        parent_permlink: post.tags[0], // Primary tag
        author: CONFIG.HIVE_USERNAME,
        permlink: permlink,
        title: post.title,
        body: post.body,
        json_metadata: JSON.stringify({
          tags: post.tags,
          app: 'vankush-bot/1.0',
          format: 'markdown'
        })
      }
    ];

    // Broadcast to blockchain
    const key = dhive.PrivateKey.fromString(CONFIG.HIVE_POSTING_KEY);
    const result = await client.broadcast.sendOperations([commentOp], key);

    console.log('\n✅ Post published successfully!');
    console.log(`   Transaction ID: ${result.id}`);
    console.log(`   URL: https://hive.blog/@${CONFIG.HIVE_USERNAME}/${permlink}`);

    return {
      success: true,
      txId: result.id,
      url: `https://hive.blog/@${CONFIG.HIVE_USERNAME}/${permlink}`,
      permlink
    };

  } catch (error) {
    console.error('\n❌ Failed to publish post:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ========================================
// SCHEDULING
// ========================================

function getNextPostTime() {
  const now = new Date();
  const next = new Date();

  // Set to configured hour UTC
  next.setUTCHours(CONFIG.POST_TIME_UTC_HOUR, 0, 0, 0);

  // If that time has passed today, schedule for tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function getMillisecondsUntilNextPost() {
  const now = Date.now();
  const next = getNextPostTime().getTime();
  return next - now;
}

// ========================================
// MAIN LOOP
// ========================================

async function main() {
  console.log('\n🤖 HIVE CONTENT & TIP FARMING BOT STARTED');
  console.log('='.repeat(60));
  console.log(`Username: @${CONFIG.HIVE_USERNAME}`);
  console.log(`Posting Schedule: Every ${CONFIG.POST_INTERVAL_HOURS}h at ${CONFIG.POST_TIME_UTC_HOUR}:00 UTC`);
  console.log(`Target Tokens: ${CONFIG.TARGET_TOKENS.join(', ')}`);
  console.log(`Tip Commands: ${CONFIG.TIP_COMMANDS.join(' ')}`);
  console.log(`Dry Run: ${CONFIG.DRY_RUN ? '🔒 ENABLED' : '⚡ DISABLED (LIVE POSTING)'}`);
  console.log('='.repeat(60));

  if (!CONFIG.HIVE_USERNAME || !CONFIG.HIVE_POSTING_KEY) {
    console.error('\n❌ HIVE credentials not configured!');
    console.error('   Set HIVE_USERNAME and HIVE_POSTING_KEY in .env file');
    process.exit(1);
  }

  // Post immediately on startup (for testing)
  console.log('\n🚀 Publishing initial post...');
  await publishPost();

  // Then schedule regular posts
  while (true) {
    const msUntilNext = getMillisecondsUntilNextPost();
    const hoursUntilNext = (msUntilNext / (1000 * 60 * 60)).toFixed(1);
    const nextPostTime = getNextPostTime().toISOString();

    console.log(`\n⏰ Next post scheduled for: ${nextPostTime} (in ${hoursUntilNext} hours)`);

    // Wait until next post time
    await new Promise(resolve => setTimeout(resolve, msUntilNext));

    // Publish post
    await publishPost();
  }
}

// ========================================
// START BOT
// ========================================

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
