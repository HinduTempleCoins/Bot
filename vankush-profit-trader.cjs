#!/usr/bin/env node

// ========================================
// VANKUSH PROFIT TRADER BOT
// ========================================
// Purpose: Generate HIVE income by trading BBH, POB, and other profitable tokens
// Strategy: Buy low, sell high on healthy markets
// Income: Funds VKBT/CURE price pushing operations
// Author: Claude Code
// Date: 2026-01-10

require('dotenv').config();
const dhive = require('@hiveio/dhive');
const axios = require('axios');
const {
  checkTradeableTokens,
  getTopBuyOrder
} = require('./capital-manager.cjs');
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

  // Tradeable tokens (inflationary, sell freely for profit)
  TRADEABLE_TOKENS: ['BBH', 'POB', 'LEO', 'CTP', 'PIZZA', 'ONEUP'],

  // Trading thresholds
  MIN_PROFIT_PERCENT: 2,          // Trade if 2%+ profit (more aggressive)
  MAX_TRADE_SIZE_HIVE: 2,         // Max 2 HIVE per trade (conservative)
  MIN_LIQUIDITY_HIVE: 3,          // Lower liquidity requirement (more opportunities)

  // Market health requirements
  MIN_TRADES_WEEKLY: 5,           // Lower threshold (more markets qualify)
  MIN_HOLDERS: 30,                // Lower distribution requirement

  // Trading frequency
  CHECK_INTERVAL_MINUTES: 15,     // Check every 15 minutes (AGGRESSIVE)
  MAX_TRADES_PER_HOUR: 4,         // Allow multiple trades per hour
  MAX_TRADES_PER_DAY: 30,         // Higher daily limit (learn and adapt)

  // Dry run mode (use separate flag from pusher-live)
  DRY_RUN: process.env.PROFIT_DRY_RUN !== 'false', // Default TRUE (safe)

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
  hourlyTrades: 0,
  hourlyResetTime: Date.now(),
  dailyTrades: 0,
  dailyProfit: 0,         // HIVE earned today
  dailyResetTime: Date.now(),
  totalProfit: 0,         // Total HIVE earned
  totalTrades: 0,
  startTime: Date.now()
};

// ========================================
// TRADING FUNCTIONS
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
// PROFIT OPPORTUNITY SCANNING
// ========================================

async function findProfitOpportunity(token) {
  try {
    // Get market metrics
    const metrics = await getMarketMetrics(token);

    if (!metrics) {
      console.log(`⚠️  ${token}: No market metrics`);
      return null;
    }

    const lastPrice = parseFloat(metrics.lastPrice);
    const volume24h = parseFloat(metrics.volume) || 0;
    const volumeHIVE = volume24h * lastPrice;

    // Check liquidity
    if (volumeHIVE < CONFIG.MIN_LIQUIDITY_HIVE) {
      console.log(`⚠️  ${token}: Low liquidity (${volumeHIVE.toFixed(2)} HIVE/24h)`);
      return null;
    }

    // Get order books
    const [buyBook, sellBook] = await Promise.all([
      getBuyBook(token, 10),
      getSellBook(token, 10)
    ]);

    if (!buyBook || buyBook.length === 0 || !sellBook || sellBook.length === 0) {
      console.log(`⚠️  ${token}: Empty order book`);
      return null;
    }

    const highestBid = parseFloat(buyBook[0].price);
    const lowestAsk = parseFloat(sellBook[0].price);

    // Calculate spread
    const spread = ((lowestAsk - highestBid) / highestBid) * 100;

    if (spread < CONFIG.MIN_PROFIT_PERCENT) {
      console.log(`⚠️  ${token}: Spread too small (${spread.toFixed(2)}%)`);
      return null;
    }

    // Check our balance
    const balance = await getBalance(token);

    // Opportunity found!
    return {
      token,
      spread,
      highestBid,
      lowestAsk,
      balance,
      volumeHIVE,
      lastPrice,
      strategy: balance > 1 ? 'SELL' : 'BUY_THEN_SELL'
    };

  } catch (error) {
    console.error(`Error analyzing ${token}:`, error.message);
    return null;
  }
}

async function executeProfitTrade(opportunity) {
  console.log(`\n💰 EXECUTING PROFIT TRADE: ${opportunity.token}`);
  console.log(`   Strategy: ${opportunity.strategy}`);
  console.log(`   Spread: ${opportunity.spread.toFixed(2)}%`);
  console.log(`   Bid: ${opportunity.highestBid.toFixed(8)} HIVE`);
  console.log(`   Ask: ${opportunity.lowestAsk.toFixed(8)} HIVE`);

  if (opportunity.strategy === 'SELL' && opportunity.balance > 1) {
    // We have tokens - sell at TOP of market (high-value, don't dump)
    const sellQuantity = Math.min(opportunity.balance, 100); // Max 100 tokens

    // High-value selling: place at top of market, wait for buyers
    let sellPrice;
    if (opportunity.lowestAsk) {
      // Place at lowest ask or 1% above for priority
      sellPrice = opportunity.lowestAsk * 1.01;
      console.log(`📊 Placing at top of asks (${opportunity.lowestAsk.toFixed(8)} HIVE)`);
    } else {
      // No sells - place 10% above bid with room to rise
      sellPrice = opportunity.highestBid * 1.10;
      console.log(`📊 No asks - creating first sell order`);
    }

    const expectedHIVE = sellQuantity * sellPrice;

    console.log(`📤 HIGH-VALUE SELL: ${sellQuantity.toFixed(4)} ${opportunity.token} at ${sellPrice.toFixed(8)} HIVE`);
    console.log(`   Expected income: ${expectedHIVE.toFixed(4)} HIVE (~$${(expectedHIVE * CONFIG.HIVE_PRICE_USD).toFixed(3)} USD)`);
    console.log(`   Strategy: Wait for market to come up to us (not dumping!)`);

    const result = await sellToken(opportunity.token, sellQuantity, sellPrice);

    if (result.success) {
      console.log(`✅ Profit trade executed! TX: ${result.txId}`);

      // Update stats
      botState.dailyProfit += expectedHIVE;
      botState.totalProfit += expectedHIVE;
      botState.dailyTrades++;
      botState.totalTrades++;

      return true;
    } else {
      console.error(`❌ Profit trade failed: ${result.error}`);
      return false;
    }

  } else if (opportunity.strategy === 'BUY_THEN_SELL') {
    // Buy low, then sell high (HIGH-VALUE, not dumping)
    const buyPrice = opportunity.lowestAsk;
    // High-value selling: place above current asks, not dump to bids
    const sellPrice = opportunity.lowestAsk * 1.05; // 5% above our buy price

    // Calculate quantity based on max trade size
    const buyQuantity = Math.min(
      CONFIG.MAX_TRADE_SIZE_HIVE / buyPrice,
      100 // Max 100 tokens
    );

    const cost = buyQuantity * buyPrice;

    console.log(`📥 Step 1: Buy ${buyQuantity.toFixed(4)} ${opportunity.token} at ${buyPrice.toFixed(8)} HIVE`);
    console.log(`   Cost: ${cost.toFixed(4)} HIVE`);

    // Execute buy
    const buyResult = await buyToken(opportunity.token, buyQuantity, buyPrice);

    if (!buyResult.success) {
      console.error(`❌ Buy failed: ${buyResult.error}`);
      return false;
    }

    console.log(`✅ Buy executed! TX: ${buyResult.txId}`);

    // Wait 5 seconds for order to fill
    console.log('⏰ Waiting 5 seconds for order to fill...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Now sell at higher price
    const expectedRevenue = buyQuantity * sellPrice;
    const profit = expectedRevenue - cost;

    console.log(`📤 Step 2: Sell ${buyQuantity.toFixed(4)} ${opportunity.token} at ${sellPrice.toFixed(8)} HIVE`);
    console.log(`   Expected revenue: ${expectedRevenue.toFixed(4)} HIVE`);
    console.log(`   Expected profit: ${profit.toFixed(4)} HIVE (~$${(profit * CONFIG.HIVE_PRICE_USD).toFixed(3)} USD)`);

    const sellResult = await sellToken(opportunity.token, buyQuantity, sellPrice);

    if (sellResult.success) {
      console.log(`✅ Sell executed! TX: ${sellResult.txId}`);

      // Update stats
      botState.dailyProfit += profit;
      botState.totalProfit += profit;
      botState.dailyTrades++;
      botState.totalTrades++;

      return true;
    } else {
      console.error(`❌ Sell failed: ${sellResult.error}`);
      return false;
    }
  }

  return false;
}

// ========================================
// MAIN LOOP
// ========================================

async function scanForProfits() {
  console.log('\n' + '='.repeat(60));
  console.log('💰 SCANNING FOR PROFIT OPPORTUNITIES');
  console.log('='.repeat(60));

  // Reset hourly stats if needed
  const minutesSinceHourlyReset = (Date.now() - botState.hourlyResetTime) / (1000 * 60);
  if (minutesSinceHourlyReset >= 60) {
    console.log(`\n♻️  Resetting hourly stats (${botState.hourlyTrades} trades last hour)`);
    botState.hourlyTrades = 0;
    botState.hourlyResetTime = Date.now();
  }

  // Reset daily stats if needed
  const hoursSinceReset = (Date.now() - botState.dailyResetTime) / (1000 * 60 * 60);
  if (hoursSinceReset >= 24) {
    console.log(`\n♻️  Resetting daily stats (earned: ${botState.dailyProfit.toFixed(4)} HIVE yesterday)`);
    botState.dailyTrades = 0;
    botState.dailyProfit = 0;
    botState.dailyResetTime = Date.now();
  }

  // Check hourly trade limit (more restrictive)
  if (botState.hourlyTrades >= CONFIG.MAX_TRADES_PER_HOUR) {
    console.log(`⚠️  Hourly trade limit reached (${botState.hourlyTrades}/${CONFIG.MAX_TRADES_PER_HOUR})`);
    console.log(`   Waiting ${Math.ceil((60 - minutesSinceHourlyReset))} minutes until hourly reset...`);
    return;
  }

  // Check daily trade limit
  if (botState.dailyTrades >= CONFIG.MAX_TRADES_PER_DAY) {
    console.log(`⚠️  Daily trade limit reached (${botState.dailyTrades}/${CONFIG.MAX_TRADES_PER_DAY})`);
    console.log('   Waiting until tomorrow...');
    return;
  }

  // Scan all tradeable tokens
  console.log(`\n🔍 Scanning ${CONFIG.TRADEABLE_TOKENS.length} tradeable tokens...`);

  const opportunities = [];

  for (const token of CONFIG.TRADEABLE_TOKENS) {
    console.log(`\n📊 Analyzing ${token}...`);
    const opportunity = await findProfitOpportunity(token);

    if (opportunity) {
      opportunities.push(opportunity);
      console.log(`✅ ${token}: Profit opportunity found! (${opportunity.spread.toFixed(2)}% spread)`);
    }
  }

  // Sort by spread (highest first)
  opportunities.sort((a, b) => b.spread - a.spread);

  if (opportunities.length === 0) {
    console.log('\n❌ No profitable opportunities found');
    console.log(`   Waiting ${CONFIG.CHECK_INTERVAL_MINUTES} minutes...`);
    return;
  }

  // Execute MULTIPLE opportunities (aggressive strategy)
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`🎯 FOUND ${opportunities.length} OPPORTUNITIES - EXECUTING TRADES`);
  console.log('='.repeat(60));

  let tradesExecuted = 0;
  const maxTradesToExecute = Math.min(
    opportunities.length,
    CONFIG.MAX_TRADES_PER_HOUR - botState.hourlyTrades,  // Don't exceed hourly limit
    3  // Max 3 trades per cycle (don't flood)
  );

  for (let i = 0; i < maxTradesToExecute; i++) {
    const opportunity = opportunities[i];

    console.log(`\n${'~'.repeat(60)}`);
    console.log(`🎯 TRADE ${i + 1}/${maxTradesToExecute}: ${opportunity.token}`);
    console.log('~'.repeat(60));

    const success = await executeProfitTrade(opportunity);

    if (success) {
      tradesExecuted++;
      botState.hourlyTrades++;

      // Small delay between trades
      if (i < maxTradesToExecute - 1) {
        console.log('\n⏰ Waiting 10 seconds before next trade...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  console.log(`\n✅ Executed ${tradesExecuted} profitable trades this cycle`);

  // Print session stats
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 SESSION STATS');
  console.log('='.repeat(60));

  const runtime = (Date.now() - botState.startTime) / (1000 * 60 * 60);

  console.log(`⚡ Hourly Trades: ${botState.hourlyTrades}/${CONFIG.MAX_TRADES_PER_HOUR}`);
  console.log(`🔄 Daily Trades: ${botState.dailyTrades}/${CONFIG.MAX_TRADES_PER_DAY}`);
  console.log(`💰 Daily Profit: ${botState.dailyProfit.toFixed(4)} HIVE ($${(botState.dailyProfit * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);
  console.log(`📈 Total Profit: ${botState.totalProfit.toFixed(4)} HIVE ($${(botState.totalProfit * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);
  console.log(`⏱️  Runtime: ${runtime.toFixed(2)} hours`);

  console.log(`\n⏰ Waiting ${CONFIG.CHECK_INTERVAL_MINUTES} minutes until next check...`);
}

// ========================================
// STARTUP
// ========================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('💰 VANKUSH PROFIT TRADER BOT');
  console.log('='.repeat(60));

  console.log(`\n⚙️  CONFIGURATION:`);
  console.log(`   Account: @${CONFIG.HIVE_USERNAME}`);
  console.log(`   Dry Run: ${CONFIG.DRY_RUN ? '🔒 ENABLED' : '⚡ DISABLED (LIVE TRADING)'}`);
  console.log(`   Min Profit: ${CONFIG.MIN_PROFIT_PERCENT}%`);
  console.log(`   Max Trade Size: ${CONFIG.MAX_TRADE_SIZE_HIVE} HIVE`);
  console.log(`   Max Daily Trades: ${CONFIG.MAX_TRADES_PER_DAY}`);
  console.log(`   Check Interval: ${CONFIG.CHECK_INTERVAL_MINUTES} minutes`);
  console.log(`   Tradeable Tokens: ${CONFIG.TRADEABLE_TOKENS.join(', ')}`);

  console.log(`\n🎯 PURPOSE: Generate HIVE income to fund VKBT/CURE price pushing`);
  console.log(`   Strategy: Buy low, sell high on healthy markets`);
  console.log(`   Income: Profits fund pusher-live bot operations`);

  // Run first scan immediately
  await scanForProfits();

  // Then run on interval
  setInterval(async () => {
    try {
      await scanForProfits();
    } catch (error) {
      console.error('❌ Error in scan cycle:', error);
    }
  }, CONFIG.CHECK_INTERVAL_MINUTES * 60 * 1000);
}

// Start the bot
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
