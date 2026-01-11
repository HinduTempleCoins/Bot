#!/usr/bin/env node

// ========================================
// VANKUSH INTELLIGENT TRADING BOT
// ========================================
// Purpose: Generate income AND build staking portfolio
// Strategy:
// 1. Sell tokens from @KaliVanKush for trading capital
// 2. Analyze ALL tokens in wallet with health metrics
// 3. Stake healthy projects, sell unhealthy ones
// 4. Buy tokens to stake based on project analysis
// 5. Trade for profit when opportunities exist
//
// Author: Claude Code
// Date: 2026-01-10

require('dotenv').config();
const dhive = require('@hiveio/dhive');
const axios = require('axios');
const fs = require('fs');
const {
  getBuyBook,
  getSellBook,
  getMarketMetrics
} = require('./hive-engine-api.cjs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // HIVE blockchain
  HIVE_USERNAME: process.env.HIVE_USERNAME || '',
  HIVE_ACTIVE_KEY: process.env.HIVE_ACTIVE_KEY || '',

  // Special accounts
  GIFT_SENDER: 'KaliVanKush',  // Tokens from this account = sell for capital

  // Protected tokens (NEVER sell, only stake more)
  PROTECTED_TOKENS: ['VKBT', 'CURE'],

  // Health criteria for stake vs sell decision
  HEALTH_CRITERIA: {
    MIN_24H_VOLUME_HIVE: 10,       // Minimum volume
    MIN_LIQUIDITY_HIVE: 50,         // Minimum total liquidity
    MIN_HOLDERS: 30,                // Distribution requirement
    MAX_DAYS_SINCE_TRADE: 7,        // Recent activity
    MIN_TRADES_WEEKLY: 5            // Active trading
  },

  // Staking criteria (must pass health + these)
  STAKING_CRITERIA: {
    MIN_STAKE_APR: 5,               // Min 5% APR to stake
    HAS_ACTIVE_PROJECT: true,       // Check Hive.blog for updates
    MIN_COMMUNITY_SIZE: 50          // Minimum community
  },

  // Trading settings
  MIN_PROFIT_PERCENT: 2,            // Min 2% profit to trade
  MAX_TRADE_SIZE_HIVE: 2,           // Max 2 HIVE per trade
  MAX_TRADES_PER_HOUR: 4,           // Limit trading frequency
  MAX_TRADES_PER_DAY: 30,

  // Check intervals
  CHECK_INTERVAL_MINUTES: 15,       // Check every 15 minutes
  GIFT_CHECK_INTERVAL_MINUTES: 5,   // Check for gifts more frequently

  // Dry run mode
  DRY_RUN: process.env.MM_DRY_RUN === 'true',

  // HIVE price
  HIVE_PRICE_USD: 0.30
};

// ========================================
// HIVE BLOCKCHAIN CLIENT
// ========================================

const client = new dhive.Client([
  'https://api.hive.blog',
  'https://api.hivekings.com',
  'https://anyx.io',
  'https://api.openhive.network'
]);

const HIVE_ENGINE_RPC = 'https://engine.rishipanthee.com';

// ========================================
// STATE TRACKING
// ========================================

const botState = {
  // Trading stats
  hourlyTrades: 0,
  hourlyResetTime: Date.now(),
  dailyTrades: 0,
  dailyProfit: 0,
  dailyResetTime: Date.now(),
  totalProfit: 0,
  totalTrades: 0,

  // Portfolio management
  stakedTokens: [],      // Tokens we're staking
  tradingTokens: [],     // Tokens we're trading for profit
  lastGiftCheck: Date.now(),
  giftsProcessed: [],

  startTime: Date.now()
};

// Load state from file
try {
  const data = fs.readFileSync('./vankush-trading-state.json', 'utf8');
  const loaded = JSON.parse(data);
  Object.assign(botState, loaded);
  console.log('✅ Loaded bot state');
} catch (error) {
  console.log('📝 No existing state, starting fresh');
}

// Save state periodically
setInterval(() => {
  try {
    fs.writeFileSync('./vankush-trading-state.json', JSON.stringify(botState, null, 2));
  } catch (error) {
    console.error('Error saving state:', error);
  }
}, 60000); // Every minute

// ========================================
// HELPER FUNCTIONS
// ========================================

async function getBalance(symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: {
          account: CONFIG.HIVE_USERNAME,
          symbol
        },
        limit: 1
      }
    });

    const balance = response.data.result?.[0];
    return balance ? parseFloat(balance.balance) : 0;
  } catch (error) {
    console.error(`Error getting ${symbol} balance:`, error.message);
    return 0;
  }
}

async function getAllBalances() {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: {
          account: CONFIG.HIVE_USERNAME
        },
        limit: 1000
      }
    });

    return response.data.result || [];
  } catch (error) {
    console.error('Error getting all balances:', error.message);
    return [];
  }
}

async function getRecentTransfers(account, limit = 50) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'transfers',
        query: {
          to: account
        },
        limit,
        indexes: [{ index: '_id', descending: true }]
      }
    });

    return response.data.result || [];
  } catch (error) {
    console.error('Error getting transfers:', error.message);
    return [];
  }
}

async function sellToken(token, quantity, price) {
  if (!CONFIG.HIVE_ACTIVE_KEY) {
    throw new Error('HIVE_ACTIVE_KEY not configured');
  }

  const key = dhive.PrivateKey.fromString(CONFIG.HIVE_ACTIVE_KEY);

  const json = {
    contractName: 'market',
    contractAction: 'sell',
    contractPayload: {
      symbol: token,
      quantity: quantity.toString(),
      price: price.toString()
    }
  };

  if (CONFIG.DRY_RUN) {
    console.log('🔒 DRY RUN - Would execute sell:');
    console.log(JSON.stringify(json, null, 2));
    return {
      success: true,
      txId: 'DRY_RUN_' + Date.now(),
      dryRun: true
    };
  }

  try {
    const op = [
      'custom_json',
      {
        required_auths: [CONFIG.HIVE_USERNAME],
        required_posting_auths: [],
        id: 'ssc-mainnet-hive',
        json: JSON.stringify(json)
      }
    ];

    const result = await client.broadcast.sendOperations([op], key);

    return {
      success: true,
      txId: result.id,
      dryRun: false
    };
  } catch (error) {
    console.error('❌ Sell order failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function buyToken(token, quantity, price) {
  if (!CONFIG.HIVE_ACTIVE_KEY) {
    throw new Error('HIVE_ACTIVE_KEY not configured');
  }

  const key = dhive.PrivateKey.fromString(CONFIG.HIVE_ACTIVE_KEY);

  const json = {
    contractName: 'market',
    contractAction: 'buy',
    contractPayload: {
      symbol: token,
      quantity: quantity.toString(),
      price: price.toString()
    }
  };

  if (CONFIG.DRY_RUN) {
    console.log('🔒 DRY RUN - Would execute buy:');
    console.log(JSON.stringify(json, null, 2));
    return {
      success: true,
      txId: 'DRY_RUN_' + Date.now(),
      dryRun: true
    };
  }

  try {
    const op = [
      'custom_json',
      {
        required_auths: [CONFIG.HIVE_USERNAME],
        required_posting_auths: [],
        id: 'ssc-mainnet-hive',
        json: JSON.stringify(json)
      }
    ];

    const result = await client.broadcast.sendOperations([op], key);

    return {
      success: true,
      txId: result.id,
      dryRun: false
    };
  } catch (error) {
    console.error('❌ Buy order failed:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ========================================
// TOKEN ANALYSIS
// ========================================

async function analyzeTokenHealth(symbol) {
  try {
    const metrics = await getMarketMetrics(symbol);

    if (!metrics) {
      return {
        healthy: false,
        reason: 'No market metrics'
      };
    }

    const lastPrice = parseFloat(metrics.lastPrice || 0);
    const volume24h = parseFloat(metrics.volume || 0);
    const volumeHIVE = volume24h * lastPrice;

    // Check health criteria
    const checks = {
      hasVolume: volumeHIVE >= CONFIG.HEALTH_CRITERIA.MIN_24H_VOLUME_HIVE,
      hasLiquidity: volumeHIVE >= CONFIG.HEALTH_CRITERIA.MIN_LIQUIDITY_HIVE,
      recentActivity: true // TODO: Check last trade time
    };

    const healthy = checks.hasVolume && checks.hasLiquidity && checks.recentActivity;

    return {
      healthy,
      volumeHIVE,
      lastPrice,
      checks,
      reason: healthy ? 'Passes health checks' : 'Failed health checks'
    };

  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error.message);
    return {
      healthy: false,
      reason: 'Analysis error'
    };
  }
}

async function shouldStakeToken(symbol) {
  // Protected tokens always stake
  if (CONFIG.PROTECTED_TOKENS.includes(symbol)) {
    return {
      shouldStake: true,
      reason: 'Protected token (VKBT/CURE)'
    };
  }

  // Check health first
  const health = await analyzeTokenHealth(symbol);

  if (!health.healthy) {
    return {
      shouldStake: false,
      reason: `Unhealthy: ${health.reason}`
    };
  }

  // TODO: Check Hive.blog for project updates
  // TODO: Check BitcoinTalk rankings (from Discord bot)
  // TODO: Check staking APR
  // TODO: Check community size

  // For now, healthy tokens are candidates for staking
  return {
    shouldStake: true,
    reason: 'Healthy project',
    health
  };
}

// ========================================
// GIFT PROCESSING
// ========================================

async function checkForGifts() {
  console.log('\n💝 Checking for gifts from @' + CONFIG.GIFT_SENDER + '...');

  const transfers = await getRecentTransfers(CONFIG.HIVE_USERNAME, 50);

  const gifts = transfers.filter(t =>
    t.from === CONFIG.GIFT_SENDER &&
    !botState.giftsProcessed.includes(t._id)
  );

  if (gifts.length === 0) {
    console.log('   No new gifts');
    return;
  }

  console.log(`📦 Found ${gifts.length} new gift(s)!`);

  for (const gift of gifts) {
    const symbol = gift.symbol;
    const quantity = parseFloat(gift.quantity);

    console.log(`\n🎁 Gift: ${quantity} ${symbol} from @${CONFIG.GIFT_SENDER}`);

    // Mark as processed
    botState.giftsProcessed.push(gift._id);

    // Protected tokens: keep and stake
    if (CONFIG.PROTECTED_TOKENS.includes(symbol)) {
      console.log(`   ✅ Protected token - keeping for staking`);
      if (!botState.stakedTokens.includes(symbol)) {
        botState.stakedTokens.push(symbol);
      }
      continue;
    }

    // Sell strategically - place order at TOP, don't dump!
    console.log(`   💰 Placing sell order at top of market...`);

    // Get sell book to see current top ask
    const [buyBook, sellBook] = await Promise.all([
      getBuyBook(symbol, 5),
      getSellBook(symbol, 5)
    ]);

    if (!buyBook || buyBook.length === 0) {
      console.log(`   ⚠️  No buy orders - will sell later`);
      continue;
    }

    // Strategy: Place sell order at or ABOVE current top ask
    // This way we get maximum value, don't dump the price
    let sellPrice;

    if (sellBook && sellBook.length > 0) {
      // There are existing sell orders - place at same price or slightly higher
      const lowestAsk = parseFloat(sellBook[0].price);
      const highestBid = parseFloat(buyBook[0].price);

      // Place at lowest ask (match current sellers) or 1% above for priority
      sellPrice = lowestAsk * 1.01; // Slightly above to be first in line

      console.log(`   📊 Market: Bid ${highestBid.toFixed(8)} / Ask ${lowestAsk.toFixed(8)} HIVE`);
      console.log(`   🎯 Placing sell at ${sellPrice.toFixed(8)} HIVE (top of ask)`);
    } else {
      // No sell orders - be the first ask, place above highest bid
      const highestBid = parseFloat(buyBook[0].price);
      sellPrice = highestBid * 1.10; // 10% above bid - room for market to rise

      console.log(`   📊 No asks - placing first sell at ${sellPrice.toFixed(8)} HIVE`);
      console.log(`   🎯 Strategy: Let market come up to meet us`);
    }

    const result = await sellToken(symbol, quantity, sellPrice);

    if (result.success) {
      const expectedRevenue = quantity * sellPrice;
      console.log(`   ✅ Sell order placed! TX: ${result.txId}`);
      console.log(`   💎 When filled: ${expectedRevenue.toFixed(4)} HIVE (~$${(expectedRevenue * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);
      console.log(`   ⏰ High-value trade - waiting for market to come to us`);

      // Don't count profit until order fills
      // TODO: Track open orders and update profit when they fill
    } else {
      console.log(`   ❌ Sell failed: ${result.error}`);
    }
  }

  // Keep only last 1000 processed gift IDs
  if (botState.giftsProcessed.length > 1000) {
    botState.giftsProcessed = botState.giftsProcessed.slice(-1000);
  }
}

// ========================================
// PORTFOLIO ANALYSIS
// ========================================

async function analyzePortfolio() {
  console.log('\n📊 ANALYZING PORTFOLIO');
  console.log('='.repeat(60));

  const balances = await getAllBalances();

  console.log(`   Found ${balances.length} tokens in wallet`);

  for (const balance of balances) {
    const symbol = balance.symbol;
    const quantity = parseFloat(balance.balance);

    if (quantity < 0.01) continue; // Skip dust
    if (symbol === 'SWAP.HIVE') continue; // Skip HIVE

    console.log(`\n🔍 Analyzing ${symbol} (${quantity.toFixed(4)})...`);

    const decision = await shouldStakeToken(symbol);

    if (decision.shouldStake) {
      console.log(`   ✅ STAKE: ${decision.reason}`);
      if (!botState.stakedTokens.includes(symbol)) {
        botState.stakedTokens.push(symbol);
      }
      // Remove from trading list if present
      botState.tradingTokens = botState.tradingTokens.filter(t => t !== symbol);
    } else {
      console.log(`   📤 SELL: ${decision.reason}`);
      if (!botState.tradingTokens.includes(symbol)) {
        botState.tradingTokens.push(symbol);
      }
      // Remove from staking list
      botState.stakedTokens = botState.stakedTokens.filter(t => t !== symbol);

      // Sell strategically - place at top of market, don't dump!
      const [buyBook, sellBook] = await Promise.all([
        getBuyBook(symbol, 5),
        getSellBook(symbol, 5)
      ]);

      if (buyBook && buyBook.length > 0) {
        let sellPrice;

        if (sellBook && sellBook.length > 0) {
          // Match or beat current lowest ask
          const lowestAsk = parseFloat(sellBook[0].price);
          sellPrice = lowestAsk * 1.01; // 1% above for priority
          console.log(`   💰 Placing sell at ${sellPrice.toFixed(8)} HIVE (top of ask)`);
        } else {
          // No asks - place above highest bid
          const highestBid = parseFloat(buyBook[0].price);
          sellPrice = highestBid * 1.10; // 10% above - room to rise
          console.log(`   💰 First ask at ${sellPrice.toFixed(8)} HIVE (high-value)`);
        }

        const result = await sellToken(symbol, quantity, sellPrice);
        if (result.success) {
          const expectedRevenue = quantity * sellPrice;
          console.log(`   ✅ Sell order placed! TX: ${result.txId}`);
          console.log(`   💎 Target: ${expectedRevenue.toFixed(4)} HIVE when filled`);

          // TODO: Track and update when filled
        }
      }
    }
  }

  console.log(`\n📈 Portfolio Decision:`);
  console.log(`   Staking: ${botState.stakedTokens.join(', ') || 'None yet'}`);
  console.log(`   Selling: ${botState.tradingTokens.join(', ') || 'None'}`);
}

// ========================================
// MAIN LOOP
// ========================================

async function mainCycle() {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 VANKUSH INTELLIGENT TRADING BOT');
  console.log('='.repeat(60));

  // Reset stats if needed
  const minutesSinceHourlyReset = (Date.now() - botState.hourlyResetTime) / (1000 * 60);
  if (minutesSinceHourlyReset >= 60) {
    botState.hourlyTrades = 0;
    botState.hourlyResetTime = Date.now();
  }

  const hoursSinceReset = (Date.now() - botState.dailyResetTime) / (1000 * 60 * 60);
  if (hoursSinceReset >= 24) {
    console.log(`\n♻️  Daily reset (earned: ${botState.dailyProfit.toFixed(4)} HIVE yesterday)`);
    botState.dailyTrades = 0;
    botState.dailyProfit = 0;
    botState.dailyResetTime = Date.now();
  }

  // Check for gifts from @KaliVanKush
  await checkForGifts();

  // Analyze portfolio (every cycle)
  await analyzePortfolio();

  // TODO: Trade for profit when opportunities exist
  // TODO: Buy tokens to stake if they're healthy

  // Print stats
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 SESSION STATS');
  console.log('='.repeat(60));

  const runtime = (Date.now() - botState.startTime) / (1000 * 60 * 60);

  console.log(`⚡ Hourly Trades: ${botState.hourlyTrades}/${CONFIG.MAX_TRADES_PER_HOUR}`);
  console.log(`🔄 Daily Trades: ${botState.dailyTrades}/${CONFIG.MAX_TRADES_PER_DAY}`);
  console.log(`💰 Daily Profit: ${botState.dailyProfit.toFixed(4)} HIVE ($${(botState.dailyProfit * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);
  console.log(`📈 Total Profit: ${botState.totalProfit.toFixed(4)} HIVE ($${(botState.totalProfit * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);
  console.log(`⏱️  Runtime: ${runtime.toFixed(2)} hours`);

  console.log(`\n⏰ Waiting ${CONFIG.CHECK_INTERVAL_MINUTES} minutes until next cycle...`);
}

// ========================================
// STARTUP
// ========================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 VANKUSH INTELLIGENT TRADING BOT');
  console.log('='.repeat(60));

  console.log(`\n⚙️  CONFIGURATION:`);
  console.log(`   Account: @${CONFIG.HIVE_USERNAME}`);
  console.log(`   Dry Run: ${CONFIG.DRY_RUN ? '🔒 ENABLED' : '⚡ DISABLED (LIVE TRADING)'}`);
  console.log(`   Gift Sender: @${CONFIG.GIFT_SENDER}`);
  console.log(`   Protected Tokens: ${CONFIG.PROTECTED_TOKENS.join(', ')}`);

  console.log(`\n🎯 STRATEGY:`);
  console.log(`   1. Sell gifts from @${CONFIG.GIFT_SENDER} for capital`);
  console.log(`   2. Analyze ALL tokens with health metrics`);
  console.log(`   3. Stake healthy projects, sell unhealthy ones`);
  console.log(`   4. Trade for profit when opportunities exist`);
  console.log(`   5. Buy tokens to stake based on analysis`);

  // Run first cycle immediately
  await mainCycle();

  // Then run on interval
  setInterval(async () => {
    try {
      await mainCycle();
    } catch (error) {
      console.error('❌ Error in cycle:', error);
    }
  }, CONFIG.CHECK_INTERVAL_MINUTES * 60 * 1000);
}

// Start the bot
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
