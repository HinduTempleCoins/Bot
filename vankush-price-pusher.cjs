#!/usr/bin/env node

// ========================================
// VANKUSH PRICE PUSHER BOT
// ========================================
// Purpose: Implement market psychology strategy to raise VKBT/CURE prices
// Strategy: Patient buying when cheap, micro-pushes for anchoring
// NOT: Wasteful spending or forcing prices up at all costs
// Author: Claude Code
// Date: 2026-01-10

require('dotenv').config();
const dhive = require('@hiveio/dhive');
const axios = require('axios');
const {
  analyzeSellWall,
  checkMarketHealth,
  findBestPushOpportunity,
  WALL_CONFIG
} = require('./wall-analyzer.cjs');
const {
  checkCapitalNeeds,
  checkTradeableTokens
} = require('./capital-manager.cjs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // HIVE blockchain
  HIVE_USERNAME: process.env.HIVE_USERNAME || '',
  HIVE_ACTIVE_KEY: process.env.HIVE_ACTIVE_KEY || '',

  // Target tokens (Tier 1)
  TARGET_TOKENS: ['VKBT', 'CURE'],

  // Budget management
  CHEAP_THRESHOLD_USD: 2.00,        // Only buy if < $2
  MICRO_PUSH_HIVE: 0.0001,          // Micro-push amount (0.0001 HIVE)
  MAX_DAILY_BUDGET_HIVE: 5,         // Max 5 HIVE/day (~$1.50 USD) - CONSERVATIVE START

  // Cooldowns (prevent spam)
  MAJOR_PUSH_COOLDOWN_HOURS: 6,     // Wait 6h between big buys
  MICRO_PUSH_COOLDOWN_HOURS: 1,     // Wait 1h between micro-pushes
  CHECK_INTERVAL_MINUTES: 15,       // Check opportunities every 15 min

  // Market health
  MIN_TRADES_WEEKLY: 5,             // Market must be alive

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

const HIVE_ENGINE_RPC = 'https://api.hive-engine.com/rpc/contracts';

// ========================================
// STATE TRACKING
// ========================================

const botState = {
  lastMajorPush: {},      // token -> timestamp
  lastMicroPush: {},      // token -> timestamp
  dailySpent: 0,          // HIVE spent today
  dailyResetTime: Date.now(),
  totalPushes: 0,
  totalSpent: 0,
  startTime: Date.now()
};

// ========================================
// HIVE-ENGINE TRADING
// ========================================

async function getHiveBalance(username) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: { account: username, symbol: 'SWAP.HIVE' },
        limit: 1
      }
    });

    const balance = response.data.result && response.data.result[0]
      ? parseFloat(response.data.result[0].balance)
      : 0;

    return balance;
  } catch (error) {
    console.error('❌ Error fetching HIVE balance:', error.message);
    return 0;
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
// PRICE PUSHING LOGIC
// ========================================

async function executeMajorPush(token, analysis) {
  console.log(`\n💰 MAJOR PUSH: Buying up ${token} sell wall to ${analysis.targetPrice} HIVE`);
  console.log(`   Cost: ${analysis.costToTarget.toFixed(4)} HIVE ($${analysis.costUSD.toFixed(2)} USD)`);
  console.log(`   Tokens: ${analysis.tokensNeeded.toFixed(4)} ${token}`);

  // Place buy order at target price for the needed quantity
  const result = await buyToken(token, analysis.tokensNeeded, analysis.targetPrice);

  if (result.success) {
    console.log(`✅ Major push executed! TX: ${result.txId}`);

    // Update state
    botState.lastMajorPush[token] = Date.now();
    botState.dailySpent += analysis.costToTarget;
    botState.totalSpent += analysis.costToTarget;
    botState.totalPushes++;

    return true;
  } else {
    console.error(`❌ Major push failed: ${result.error}`);
    return false;
  }
}

async function executeMicroPush(token, targetPrice) {
  console.log(`\n🔹 MICRO PUSH: Nudging ${token} price to ${targetPrice} HIVE`);
  console.log(`   Cost: ${CONFIG.MICRO_PUSH_HIVE} HIVE (~$${(CONFIG.MICRO_PUSH_HIVE * CONFIG.HIVE_PRICE_USD).toFixed(3)} USD)`);

  // Calculate minimal quantity for micro-push
  const minQuantity = CONFIG.MICRO_PUSH_HIVE / targetPrice;

  const result = await buyToken(token, minQuantity, targetPrice);

  if (result.success) {
    console.log(`✅ Micro push executed! TX: ${result.txId}`);

    // Update state
    botState.lastMicroPush[token] = Date.now();
    botState.dailySpent += CONFIG.MICRO_PUSH_HIVE;
    botState.totalSpent += CONFIG.MICRO_PUSH_HIVE;
    botState.totalPushes++;

    return true;
  } else {
    console.error(`❌ Micro push failed: ${result.error}`);
    return false;
  }
}

function canExecuteMajorPush(token) {
  const lastPush = botState.lastMajorPush[token];
  if (!lastPush) return true;

  const hoursSince = (Date.now() - lastPush) / (1000 * 60 * 60);
  return hoursSince >= CONFIG.MAJOR_PUSH_COOLDOWN_HOURS;
}

function canExecuteMicroPush(token) {
  const lastPush = botState.lastMicroPush[token];
  if (!lastPush) return true;

  const hoursSince = (Date.now() - lastPush) / (1000 * 60 * 60);
  return hoursSince >= CONFIG.MICRO_PUSH_COOLDOWN_HOURS;
}

async function processOpportunity() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 Checking for price push opportunities...');
  console.log('='.repeat(60));

  // Reset daily budget if needed
  const hoursSinceReset = (Date.now() - botState.dailyResetTime) / (1000 * 60 * 60);
  if (hoursSinceReset >= 24) {
    console.log(`\n♻️  Resetting daily budget (spent: ${botState.dailySpent.toFixed(4)} HIVE yesterday)`);
    botState.dailySpent = 0;
    botState.dailyResetTime = Date.now();
  }

  // ========================================
  // CAPITAL MANAGEMENT CHECK
  // ========================================
  console.log('\n💼 Capital Manager: Checking liquidity needs...');

  try {
    const capitalNeeds = await checkCapitalNeeds(CONFIG.HIVE_USERNAME);

    if (capitalNeeds.recommendation.includes('SELL')) {
      console.log(`\n⚠️  Capital Manager Recommendation: ${capitalNeeds.recommendation}`);
      console.log(`   Status: ${capitalNeeds.status} (${capitalNeeds.urgency}% urgency)`);
      console.log(`   Reason: ${capitalNeeds.reason}`);

      if (capitalNeeds.recommendation === 'SELL_TO_TOP_ORDER') {
        console.log(`\n💡 Suggested Action: Sell ${capitalNeeds.amount.toFixed(2)} BLURT → ${capitalNeeds.expectedHIVE.toFixed(4)} HIVE`);
        console.log(`   This will replenish operational funds for price pushing`);
        // TODO: Implement automated BLURT selling in future update
      } else if (capitalNeeds.recommendation === 'WAIT_BETTER_PRICE') {
        console.log(`   BLURT price too low - will attempt to use BBH/POB instead`);

        const tradeableOps = await checkTradeableTokens(CONFIG.HIVE_USERNAME);
        if (tradeableOps.length > 0) {
          console.log(`\n📊 Tradeable Token Opportunities:`);
          tradeableOps.forEach(op => {
            console.log(`   ${op.symbol}: Sell ${op.sellAmount.toFixed(2)} → ${op.expectedHIVE.toFixed(4)} HIVE`);
          });
          console.log(`   Consider selling BBH/POB to fund operations`);
        }
      }
    } else {
      console.log(`✅ Capital status: ${capitalNeeds.status}`);
    }
  } catch (error) {
    console.error(`⚠️  Capital manager check failed: ${error.message}`);
  }

  // Check budget
  const remainingBudget = CONFIG.MAX_DAILY_BUDGET_HIVE - botState.dailySpent;
  console.log(`\n💰 Budget Status:`);
  console.log(`   Daily Spent: ${botState.dailySpent.toFixed(4)} HIVE / ${CONFIG.MAX_DAILY_BUDGET_HIVE} HIVE`);
  console.log(`   Remaining: ${remainingBudget.toFixed(4)} HIVE ($${(remainingBudget * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);

  if (remainingBudget <= 0) {
    console.log('⚠️ Daily budget exhausted - waiting for reset');
    return;
  }

  // Check HIVE balance
  const hiveBalance = await getHiveBalance(CONFIG.HIVE_USERNAME);
  console.log(`   HIVE Balance: ${hiveBalance.toFixed(4)} HIVE`);

  if (hiveBalance < CONFIG.MICRO_PUSH_HIVE) {
    console.log('⚠️ Insufficient HIVE balance for any push');
    console.log('💡 Capital Manager suggests selling BLURT/BBH/POB to replenish');
    return;
  }

  // Find best opportunity
  const opportunity = await findBestPushOpportunity();

  if (!opportunity) {
    console.log('⚠️ No viable opportunities found');
    return;
  }

  const token = opportunity.token;

  // Decide action based on cost and cooldowns
  if (opportunity.recommendation === 'ALREADY_AT_TARGET') {
    console.log(`✅ ${token} already at target price - no action needed`);
    return;
  }

  if (opportunity.recommendation === 'PLACE_BUY_ORDER') {
    console.log(`💡 ${token} needs buy support to push price from ${opportunity.currentPrice.toFixed(4)} → ${opportunity.targetPrice.toFixed(4)} HIVE`);
    console.log(`   Current price: ${opportunity.currentPrice.toFixed(4)} HIVE (below target)`);
    console.log(`   Sell wall floor: ${opportunity.sellWallFloor.toFixed(4)} HIVE (above target - paper wall)`);
    console.log(`   Strategy: Place buy orders to create floor and push price up`);

    // For now, use micro push to nudge price upward
    // TODO: Implement strategic buy order placement
    if (canExecuteMicroPush(token)) {
      await executeMicroPush(token, opportunity.currentPrice * 1.1); // 10% above current
    } else {
      console.log('⏰ Micro push on cooldown - waiting');
    }
    return;
  }

  if (opportunity.recommendation === 'BUY_UP_WALL') {
    // Affordable to buy up wall - but check cooldown
    if (!canExecuteMajorPush(token)) {
      const lastPush = botState.lastMajorPush[token];
      const hoursSince = (Date.now() - lastPush) / (1000 * 60 * 60);
      console.log(`⏰ Major push cooldown active (${hoursSince.toFixed(1)}h / ${CONFIG.MAJOR_PUSH_COOLDOWN_HOURS}h)`);
      console.log('   Falling back to micro push...');

      if (canExecuteMicroPush(token)) {
        await executeMicroPush(token, opportunity.targetPrice);
      } else {
        console.log('⏰ Micro push also on cooldown - waiting');
      }
      return;
    }

    // Check if we have enough budget and balance
    if (opportunity.costToTarget > remainingBudget) {
      console.log(`⚠️ Push costs ${opportunity.costToTarget.toFixed(4)} HIVE but only ${remainingBudget.toFixed(4)} HIVE remaining in daily budget`);
      console.log('   Falling back to micro push...');

      if (canExecuteMicroPush(token)) {
        await executeMicroPush(token, opportunity.targetPrice);
      }
      return;
    }

    if (opportunity.costToTarget > hiveBalance) {
      console.log(`⚠️ Push costs ${opportunity.costToTarget.toFixed(4)} HIVE but only ${hiveBalance.toFixed(4)} HIVE in wallet`);
      return;
    }

    // All checks passed - execute major push!
    await executeMajorPush(token, opportunity);

  } else if (opportunity.recommendation === 'MICRO_PUSH' || opportunity.recommendation === 'TOO_EXPENSIVE') {
    // Either super cheap (micro-push) or too expensive (fall back to micro-push)

    if (!canExecuteMicroPush(token)) {
      const lastPush = botState.lastMicroPush[token];
      const hoursSince = (Date.now() - lastPush) / (1000 * 60 * 60);
      console.log(`⏰ Micro push cooldown active (${hoursSince.toFixed(1)}h / ${CONFIG.MICRO_PUSH_COOLDOWN_HOURS}h)`);
      return;
    }

    if (CONFIG.MICRO_PUSH_HIVE > remainingBudget) {
      console.log(`⚠️ Micro push costs ${CONFIG.MICRO_PUSH_HIVE} HIVE but only ${remainingBudget.toFixed(4)} HIVE remaining`);
      return;
    }

    await executeMicroPush(token, opportunity.targetPrice);

  } else {
    console.log(`⚠️ No action for recommendation: ${opportunity.recommendation}`);
  }
}

// ========================================
// MAIN LOOP
// ========================================

async function main() {
  console.log('\n🚀 VANKUSH PRICE PUSHER BOT STARTED');
  console.log('='.repeat(60));
  console.log(`Username: ${CONFIG.HIVE_USERNAME}`);
  console.log(`Target Tokens: ${CONFIG.TARGET_TOKENS.join(', ')}`);
  console.log(`Dry Run: ${CONFIG.DRY_RUN ? '🔒 ENABLED' : '⚡ DISABLED (LIVE TRADING)'}`);
  console.log(`Check Interval: ${CONFIG.CHECK_INTERVAL_MINUTES} minutes`);
  console.log(`Max Daily Budget: ${CONFIG.MAX_DAILY_BUDGET_HIVE} HIVE ($${(CONFIG.MAX_DAILY_BUDGET_HIVE * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);
  console.log('='.repeat(60));

  if (!CONFIG.HIVE_USERNAME || !CONFIG.HIVE_ACTIVE_KEY) {
    console.error('\n❌ HIVE credentials not configured!');
    console.error('   Set HIVE_USERNAME and HIVE_ACTIVE_KEY in .env file');
    process.exit(1);
  }

  // Main loop
  while (true) {
    try {
      await processOpportunity();

      // Show stats
      const runtimeHours = (Date.now() - botState.startTime) / (1000 * 60 * 60);
      console.log(`\n📊 Session Stats:`);
      console.log(`   Runtime: ${runtimeHours.toFixed(2)} hours`);
      console.log(`   Total Pushes: ${botState.totalPushes}`);
      console.log(`   Total Spent: ${botState.totalSpent.toFixed(4)} HIVE ($${(botState.totalSpent * CONFIG.HIVE_PRICE_USD).toFixed(2)} USD)`);

    } catch (error) {
      console.error('\n❌ Error in main loop:', error.message);
      console.error(error.stack);
    }

    // Wait for next check
    const waitMinutes = CONFIG.CHECK_INTERVAL_MINUTES;
    console.log(`\n⏰ Waiting ${waitMinutes} minutes until next check...\n`);
    await new Promise(resolve => setTimeout(resolve, waitMinutes * 60 * 1000));
  }
}

// ========================================
// START BOT
// ========================================

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
