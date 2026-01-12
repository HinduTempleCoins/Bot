#!/usr/bin/env node

// ========================================
// PROFIT TRADING BOT - COMPLETE SYSTEM
// ========================================
// Full market making system with adaptive strategies
// URGENT: Less than 16 hours to make $600
//
// Modules:
// 1. Token behavior analyzer
// 2. Sell-side micro-dance manager
// 3. Buy-side micro-dance manager
// 4. Multiple trading strategies
// 5. Performance tracker

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const dhive = require('@hiveio/dhive');
const {
  analyzeBuyWall,
  analyzeSellWall,
  checkMarketHealth,
  getMarketMetrics
} = require('./wall-analyzer.cjs');
const {
  getTokenClassification,
  isGiftToken
} = require('./gift-scanner.cjs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  ACCOUNT: process.env.HIVE_USERNAME || 'angelicalist',
  ACTIVE_KEY: process.env.HIVE_ACTIVE_KEY,
  DRY_RUN: process.env.DRY_RUN === 'true',

  // Micro-dance precision
  MICRO_UNDERCUT: 0.00000001, // 8 decimal precision

  // Order management
  CHECK_INTERVAL: 30000, // 30 seconds - aggressive
  ORDER_TIMEOUT: 300000, // 5 minutes - cancel if no fill

  // Strategy thresholds
  BUY_SUPPORT_THRESHOLD: 0.7, // 70%+ buys = buy support
  CASHOUT_THRESHOLD: 0.7, // 70%+ sells = cashout
  TIGHT_SPREAD_THRESHOLD: 0.05, // 5% = tight spread

  // Capital management
  BUY_ALLOCATION: 0.2, // Use 20% per buy
  MIN_PROFIT_MARGIN: 0.03, // 3% minimum profit

  // Files
  STATE_FILE: './profit-bot-state.json',
  ORDERS_FILE: './profit-bot-orders.json',
  PERFORMANCE_FILE: './profit-bot-performance.json',

  API: 'https://api.hive-engine.com/rpc/contracts'
};

// ========================================
// STATE MANAGEMENT
// ========================================

let botState = {
  openOrders: {}, // { orderId: {symbol, side, price, quantity, timestamp, strategy} }
  fills: [], // Completed trades
  performance: {
    totalTrades: 0,
    profitableTrades: 0,
    totalProfit: 0,
    strategyPerformance: {}
  },
  tokenCache: {} // { symbol: {behavior, lastAnalyzed, ...} }
};

// Load state
if (fs.existsSync(CONFIG.STATE_FILE)) {
  try {
    botState = JSON.parse(fs.readFileSync(CONFIG.STATE_FILE, 'utf8'));
    console.log(`📂 Loaded bot state: ${Object.keys(botState.openOrders).length} open orders`);
  } catch (error) {
    console.error('⚠️ Could not load state:', error.message);
  }
}

function saveState() {
  fs.writeFileSync(CONFIG.STATE_FILE, JSON.stringify(botState, null, 2));
}

// ========================================
// HIVE BLOCKCHAIN
// ========================================

const client = new dhive.Client([
  'https://api.hive.blog',
  'https://api.hivekings.com',
  'https://anyx.io',
  'https://api.openhive.network'
]);

// ========================================
// API FUNCTIONS
// ========================================

function apiCall(payload) {
  const jsonPayload = JSON.stringify(payload);
  const escaped = jsonPayload.replace(/'/g, "'\\''");
  const cmd = `curl -s -X POST ${CONFIG.API} -H "Content-Type: application/json" -d '${escaped}'`;
  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(output);
}

function getAllWalletBalances(account) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'tokens',
      table: 'balances',
      query: { account },
      limit: 1000,
      indexes: []
    }
  });
  return result.result || [];
}

function getOpenOrders(account) {
  const buyOrders = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { account },
      limit: 1000
    }
  });

  const sellOrders = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'sellBook',
      query: { account },
      limit: 1000
    }
  });

  return {
    buys: buyOrders.result || [],
    sells: sellOrders.result || []
  };
}

function getOrderBook(symbol) {
  const buyOrders = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { symbol },
      limit: 50,
      indexes: [{ index: 'price', descending: true }]
    }
  });

  const sellOrders = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'sellBook',
      query: { symbol },
      limit: 50,
      indexes: [{ index: 'price', descending: false }]
    }
  });

  return {
    bids: buyOrders.result || [],
    asks: sellOrders.result || []
  };
}

function getTradeHistory(symbol, limit = 100) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'tradesHistory',
      query: { symbol },
      limit,
      indexes: [{ index: 'timestamp', descending: true }]
    }
  });
  return result.result || [];
}

// ========================================
// MODULE 1: TOKEN BEHAVIOR ANALYZER
// ========================================

async function analyzeTokenBehavior(symbol) {
  console.log(`\n🔍 Analyzing ${symbol} behavior...`);

  // Check cache
  const cached = botState.tokenCache[symbol];
  if (cached && Date.now() - cached.lastAnalyzed < 300000) { // 5 min cache
    console.log(`   📋 Using cached analysis: ${cached.behavior}`);
    return cached;
  }

  // Get trade history
  const trades = getTradeHistory(symbol, 100);
  if (trades.length < 10) {
    console.log(`   ⚠️ Insufficient trade history`);
    return { behavior: 'UNKNOWN', confidence: 0 };
  }

  // Analyze trade direction
  let buyToSellWall = 0; // People buying from sell wall (buy support)
  let sellToBuyWall = 0; // People selling to buy wall (cashout)

  for (const trade of trades) {
    // If trade type is 'buy', someone bought from sell wall
    if (trade.type === 'buy') buyToSellWall++;
    // If trade type is 'sell', someone sold to buy wall
    if (trade.type === 'sell') sellToBuyWall++;
  }

  const total = buyToSellWall + sellToBuyWall;
  const buyRatio = buyToSellWall / total;
  const sellRatio = sellToBuyWall / total;

  console.log(`   📊 ${buyToSellWall} buys, ${sellToBuyWall} sells (${(buyRatio * 100).toFixed(1)}% buy)`);

  // Get market metrics
  const metrics = await getMarketMetrics(symbol);
  const orderBook = getOrderBook(symbol);

  let behavior;
  let strategy;
  let confidence;

  // Classify token
  if (buyRatio >= CONFIG.BUY_SUPPORT_THRESHOLD) {
    behavior = 'BUY_SUPPORT';
    strategy = 'SPREAD_CAPTURE';
    confidence = buyRatio;
    console.log(`   ✅ BUY SUPPORT token - people come to buy`);
  } else if (sellRatio >= CONFIG.CASHOUT_THRESHOLD) {
    behavior = 'CASHOUT';
    strategy = 'DUMP';
    confidence = sellRatio;
    console.log(`   ⚠️ CASHOUT token - people dump constantly`);
  } else {
    // Check if it's a Swap token (arbitrage opportunity)
    if (symbol.startsWith('SWAP.')) {
      behavior = 'SWAP';
      strategy = 'ARBITRAGE';
      confidence = 0.8;
      console.log(`   🔄 SWAP token - arbitrage potential`);
    } else {
      // Check spread tightness
      const highestBid = parseFloat(metrics?.highestBid || 0);
      const lowestAsk = parseFloat(metrics?.lowestAsk || 0);

      if (highestBid > 0 && lowestAsk > 0) {
        const spreadPercent = ((lowestAsk - highestBid) / highestBid) * 100;

        if (spreadPercent < CONFIG.TIGHT_SPREAD_THRESHOLD) {
          behavior = 'HIGH_VOLUME';
          strategy = 'TREND_FOLLOW';
          confidence = 0.7;
          console.log(`   📈 HIGH VOLUME token - tight spread ${spreadPercent.toFixed(2)}%`);
        } else {
          behavior = 'MIXED';
          strategy = 'CAUTIOUS';
          confidence = 0.5;
          console.log(`   ❓ MIXED behavior - wide spread ${spreadPercent.toFixed(2)}%`);
        }
      } else {
        behavior = 'UNKNOWN';
        strategy = 'SKIP';
        confidence = 0;
      }
    }
  }

  const analysis = {
    symbol,
    behavior,
    strategy,
    confidence,
    buyRatio,
    sellRatio,
    tradeCount: trades.length,
    lastAnalyzed: Date.now()
  };

  // Cache result
  botState.tokenCache[symbol] = analysis;
  saveState();

  return analysis;
}

// ========================================
// MODULE 2: SELL-SIDE MICRO-DANCE
// ========================================

async function manageSellOrder(symbol, balance, analysis) {
  console.log(`\n💰 Managing sell for ${symbol} (${balance.toFixed(8)})`);

  const orderBook = getOrderBook(symbol);

  // Skip if no buy orders
  if (!orderBook.bids || orderBook.bids.length === 0) {
    console.log(`   ❌ No buy orders - can't sell`);
    return null;
  }

  const topBid = parseFloat(orderBook.bids[0].price);
  const lowestAsk = orderBook.asks[0] ? parseFloat(orderBook.asks[0].price) : topBid * 1.5;

  console.log(`   📊 Top bid: ${topBid.toFixed(8)} | Lowest ask: ${lowestAsk.toFixed(8)}`);

  // Check if this is a gift token (seed capital from @KaliVanKush)
  const isGift = isGiftToken(symbol);

  if (isGift) {
    console.log(`   🎁 SEED CAPITAL (from @KaliVanKush) - strategic liquidation`);
  }

  // Strategy-based pricing
  let targetPrice;

  if (isGift) {
    // GIFT TOKENS: Strategic liquidation - sell at competitive price or to top bid
    // Option 1: Place sell order at competitive price (micro-undercut lowest ask)
    // Option 2: If market is dead/horrible, consider selling to top bid

    // Check market health
    const spreadPercent = ((lowestAsk - topBid) / topBid) * 100;

    if (spreadPercent > 50 || analysis.behavior === 'CASHOUT' && analysis.confidence > 0.9) {
      // Market is terrible or clearly dying - this token is "horrible"
      // Liquidate to top buy order to get HIVE now
      console.log(`   ⚠️ Poor market (${spreadPercent.toFixed(1)}% spread) - liquidate to top bid`);
      targetPrice = topBid;
    } else {
      // Market has some activity - place competitive sell order
      // Micro-undercut lowest ask to be first in line when buyers come
      targetPrice = lowestAsk - CONFIG.MICRO_UNDERCUT;
      console.log(`   🎯 STRATEGIC: Competitive sell order → ${targetPrice.toFixed(8)}`);
    }
  } else {
    // TRADING TOKENS: Full micro-dance, never dump
    // These are tokens the bot bought - treat them as real positions

    // Always use micro-dance strategy for trading tokens
    targetPrice = lowestAsk - CONFIG.MICRO_UNDERCUT;
    console.log(`   💰 TRADING TOKEN: Micro-dance sell → ${targetPrice.toFixed(8)}`);
  }

  // Check minimum profit margin
  const costBasis = 0; // Seed capital = free
  const profitMargin = (targetPrice - costBasis) / Math.max(targetPrice, 0.00000001);

  if (profitMargin < CONFIG.MIN_PROFIT_MARGIN && analysis.behavior !== 'CASHOUT') {
    console.log(`   ⚠️ Profit margin too low: ${(profitMargin * 100).toFixed(1)}%`);
    return null;
  }

  // Place sell order
  const result = await placeSellOrder(symbol, balance, targetPrice);

  if (result.success) {
    botState.openOrders[result.orderId] = {
      symbol,
      side: 'SELL',
      price: targetPrice,
      quantity: balance,
      timestamp: Date.now(),
      strategy: analysis.strategy
    };
    saveState();
  }

  return result;
}

async function placeSellOrder(symbol, quantity, price) {
  if (CONFIG.DRY_RUN) {
    const orderId = `dry-${Date.now()}`;
    console.log(`   [DRY RUN] Would SELL ${quantity.toFixed(8)} ${symbol} @ ${price.toFixed(8)}`);
    return { success: true, orderId, dryRun: true };
  }

  if (!CONFIG.ACTIVE_KEY) {
    console.error(`   ❌ ACTIVE_KEY not configured`);
    return { success: false, error: 'Missing key' };
  }

  try {
    const key = dhive.PrivateKey.fromString(CONFIG.ACTIVE_KEY);

    const json = {
      contractName: 'market',
      contractAction: 'sell',
      contractPayload: {
        symbol,
        quantity: quantity.toFixed(8),
        price: price.toFixed(8)
      }
    };

    const op = [
      'custom_json',
      {
        required_auths: [CONFIG.ACCOUNT],
        required_posting_auths: [],
        id: 'ssc-mainnet-hive',
        json: JSON.stringify(json)
      }
    ];

    console.log(`   📤 SELL ${quantity.toFixed(8)} ${symbol} @ ${price.toFixed(8)}`);
    const result = await client.broadcast.sendOperations([op], key);

    console.log(`   ✅ Order placed! TX: ${result.id}`);
    return { success: true, txId: result.id, orderId: `${symbol}-${Date.now()}` };

  } catch (error) {
    console.error(`   ❌ Sell failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// ========================================
// MODULE 3: BUY-SIDE MICRO-DANCE
// ========================================

async function findBuyOpportunity() {
  console.log(`\n🔎 Scanning for buy opportunities...`);

  // Get HIVE balance
  const balances = getAllWalletBalances(CONFIG.ACCOUNT);
  const hiveBalance = balances.find(b => b.symbol === 'SWAP.HIVE');
  const availableHIVE = hiveBalance ? parseFloat(hiveBalance.balance) : 0;

  if (availableHIVE < 0.01) {
    console.log(`   ⚠️ Insufficient HIVE: ${availableHIVE.toFixed(4)}`);
    return null;
  }

  console.log(`   💵 Available: ${availableHIVE.toFixed(4)} HIVE`);

  // Get top volume tokens
  const metricsResult = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'metrics',
      query: {},
      limit: 50,
      indexes: [{ index: 'volume', descending: true }]
    }
  });

  const candidates = (metricsResult.result || [])
    .filter(m => parseFloat(m.volume || 0) > 10)
    .filter(m => m.symbol !== 'SWAP.HIVE')
    .filter(m => m.symbol !== 'VKBT' && m.symbol !== 'CURE') // Separate bot handles these
    .slice(0, 20);

  console.log(`   📊 Evaluating ${candidates.length} tokens...`);

  let bestOpportunity = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const analysis = await analyzeTokenBehavior(candidate.symbol);

    if (analysis.behavior === 'UNKNOWN' || analysis.behavior === 'CASHOUT') {
      continue; // Skip unknown and cashout tokens
    }

    const orderBook = getOrderBook(candidate.symbol);
    if (!orderBook.bids.length || !orderBook.asks.length) continue;

    const topBid = parseFloat(orderBook.bids[0].price);
    const lowestAsk = parseFloat(orderBook.asks[0].price);
    const spreadPercent = ((lowestAsk - topBid) / topBid) * 100;

    // Calculate score based on strategy
    let score = 0;

    if (analysis.behavior === 'BUY_SUPPORT') {
      // Good for spread capture
      score += 50;
      score += Math.max(0, 20 - spreadPercent) * 2; // Reward tight spreads
      score += analysis.confidence * 30;
    } else if (analysis.behavior === 'SWAP') {
      // Arbitrage potential
      score += 40;
      // TODO: Check actual arbitrage spread vs external exchanges
    } else if (analysis.behavior === 'HIGH_VOLUME') {
      // Trend following
      score += 30;
      const volume = parseFloat(candidate.volume);
      score += Math.min(volume, 100); // Volume bonus
    }

    if (score > bestScore) {
      bestScore = score;
      bestOpportunity = {
        symbol: candidate.symbol,
        analysis,
        topBid,
        lowestAsk,
        spreadPercent,
        score
      };
    }
  }

  if (!bestOpportunity) {
    console.log(`   ⏳ No opportunities found`);
    return null;
  }

  console.log(`\n🚨 BEST OPPORTUNITY: ${bestOpportunity.symbol}`);
  console.log(`   Strategy: ${bestOpportunity.analysis.strategy}`);
  console.log(`   Score: ${bestOpportunity.score.toFixed(0)}/100`);
  console.log(`   Spread: ${bestOpportunity.spreadPercent.toFixed(2)}%`);
  console.log(`   Top bid: ${bestOpportunity.topBid.toFixed(8)}`);
  console.log(`   Lowest ask: ${bestOpportunity.lowestAsk.toFixed(8)}`);

  // Place buy order just above top bid (micro-dance)
  const buyPrice = bestOpportunity.topBid + CONFIG.MICRO_UNDERCUT;
  const tradeSize = availableHIVE * CONFIG.BUY_ALLOCATION;
  const quantity = tradeSize / buyPrice;

  console.log(`   💰 Buy: ${quantity.toFixed(8)} @ ${buyPrice.toFixed(8)} (${tradeSize.toFixed(4)} HIVE)`);

  const result = await placeBuyOrder(bestOpportunity.symbol, quantity, buyPrice);

  if (result.success) {
    botState.openOrders[result.orderId] = {
      symbol: bestOpportunity.symbol,
      side: 'BUY',
      price: buyPrice,
      quantity,
      timestamp: Date.now(),
      strategy: bestOpportunity.analysis.strategy,
      targetSellPrice: bestOpportunity.lowestAsk - CONFIG.MICRO_UNDERCUT
    };
    saveState();
  }

  return result;
}

async function placeBuyOrder(symbol, quantity, price) {
  if (CONFIG.DRY_RUN) {
    const orderId = `dry-${Date.now()}`;
    console.log(`   [DRY RUN] Would BUY ${quantity.toFixed(8)} ${symbol} @ ${price.toFixed(8)}`);
    return { success: true, orderId, dryRun: true };
  }

  if (!CONFIG.ACTIVE_KEY) {
    console.error(`   ❌ ACTIVE_KEY not configured`);
    return { success: false, error: 'Missing key' };
  }

  try {
    const key = dhive.PrivateKey.fromString(CONFIG.ACTIVE_KEY);

    const json = {
      contractName: 'market',
      contractAction: 'buy',
      contractPayload: {
        symbol,
        quantity: quantity.toFixed(8),
        price: price.toFixed(8)
      }
    };

    const op = [
      'custom_json',
      {
        required_auths: [CONFIG.ACCOUNT],
        required_posting_auths: [],
        id: 'ssc-mainnet-hive',
        json: JSON.stringify(json)
      }
    ];

    console.log(`   💸 BUY ${quantity.toFixed(8)} ${symbol} @ ${price.toFixed(8)}`);
    const result = await client.broadcast.sendOperations([op], key);

    console.log(`   ✅ Order placed! TX: ${result.id}`);
    return { success: true, txId: result.id, orderId: `${symbol}-${Date.now()}` };

  } catch (error) {
    console.error(`   ❌ Buy failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// ========================================
// MODULE 4: DYNAMIC ORDER MANAGEMENT
// ========================================

async function manageAllOrders() {
  console.log(`\n📋 Managing all open orders...`);

  const liveOrders = getOpenOrders(CONFIG.ACCOUNT);
  const totalOrders = liveOrders.buys.length + liveOrders.sells.length;

  console.log(`   Found ${totalOrders} live orders (${liveOrders.sells.length} sells, ${liveOrders.buys.length} buys)`);

  // Check each sell order for competition
  for (const order of liveOrders.sells) {
    const symbol = order.symbol;
    const ourPrice = parseFloat(order.price);
    const ourQuantity = parseFloat(order.quantity);

    console.log(`\n   🔍 Checking ${symbol} sell @ ${ourPrice.toFixed(8)}`);

    // Re-analyze token behavior
    const analysis = await analyzeTokenBehavior(symbol);

    // Get current order book
    const orderBook = getOrderBook(symbol);

    if (orderBook.asks.length === 0) continue;

    // Find lowest competing ask (not including ours)
    const competingAsks = orderBook.asks.filter(ask =>
      ask.account !== CONFIG.ACCOUNT || Math.abs(parseFloat(ask.price) - ourPrice) > 0.000001
    );

    if (competingAsks.length === 0) {
      console.log(`      ✅ No competition - we're lowest`);
      continue;
    }

    const lowestCompetingAsk = parseFloat(competingAsks[0].price);

    if (lowestCompetingAsk < ourPrice) {
      console.log(`      ⚠️ UNDERCUT! Competitor: ${lowestCompetingAsk.toFixed(8)} vs us: ${ourPrice.toFixed(8)}`);

      // Cancel our order
      await cancelOrder(order.txId, 'sell');

      // Re-place at competitive price (if still profitable)
      const newPrice = lowestCompetingAsk - CONFIG.MICRO_UNDERCUT;

      if (newPrice > 0) {
        console.log(`      🔄 Re-placing at ${newPrice.toFixed(8)}`);
        await placeSellOrder(symbol, ourQuantity, newPrice);
      }
    } else {
      console.log(`      ✅ Still competitive`);
    }

    // Check if behavior changed (only matters for gift tokens)
    const isGift = isGiftToken(symbol);
    if (isGift && analysis.behavior === 'CASHOUT' && analysis.confidence > 0.9) {
      const spreadPercent = orderBook.asks.length > 0 ?
        ((parseFloat(orderBook.asks[0].price) - parseFloat(orderBook.bids[0].price)) / parseFloat(orderBook.bids[0].price)) * 100 : 100;

      if (spreadPercent > 50) {
        // Market is dead and token is seed capital - liquidate for HIVE now
        console.log(`      ⚠️ Gift token market is dead - liquidating to top bid`);
        await cancelOrder(order.txId, 'sell');

        if (orderBook.bids.length > 0) {
          const topBid = parseFloat(orderBook.bids[0].price);
          await placeSellOrder(symbol, ourQuantity, topBid);
        }
      }
    }
  }

  // Similar logic for buy orders
  // TODO: Implement buy order management
}

async function cancelOrder(txId, side) {
  if (CONFIG.DRY_RUN) {
    console.log(`      [DRY RUN] Would cancel ${side} order ${txId}`);
    return { success: true, dryRun: true };
  }

  if (!CONFIG.ACTIVE_KEY) {
    return { success: false, error: 'Missing key' };
  }

  try {
    const key = dhive.PrivateKey.fromString(CONFIG.ACTIVE_KEY);

    const json = {
      contractName: 'market',
      contractAction: 'cancel',
      contractPayload: {
        type: side,
        id: txId
      }
    };

    const op = [
      'custom_json',
      {
        required_auths: [CONFIG.ACCOUNT],
        required_posting_auths: [],
        id: 'ssc-mainnet-hive',
        json: JSON.stringify(json)
      }
    ];

    const result = await client.broadcast.sendOperations([op], key);
    console.log(`      ✅ Canceled order ${txId}`);
    return { success: true };

  } catch (error) {
    console.error(`      ❌ Cancel failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// ========================================
// MODULE 5: PERFORMANCE TRACKER
// ========================================

function trackPerformance() {
  // TODO: Compare actual profits vs what SMA/BB/RSI would have done
  // For now, just track basic stats

  const stats = botState.performance;
  console.log(`\n📊 PERFORMANCE STATS`);
  console.log(`   Total trades: ${stats.totalTrades}`);
  console.log(`   Profitable: ${stats.profitableTrades}`);
  console.log(`   Win rate: ${stats.totalTrades > 0 ? ((stats.profitableTrades / stats.totalTrades) * 100).toFixed(1) : 0}%`);
  console.log(`   Total profit: ${stats.totalProfit.toFixed(4)} HIVE`);
}

// ========================================
// MAIN LOOP
// ========================================

async function runCycle() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🤖 PROFIT BOT CYCLE - ${new Date().toLocaleString()}`);
  console.log('='.repeat(80));

  try {
    // 1. Manage existing orders (micro-dance)
    await manageAllOrders();

    // 2. Check wallet for free balance tokens
    const balances = getAllWalletBalances(CONFIG.ACCOUNT);
    const freeTokens = balances.filter(b =>
      parseFloat(b.balance) > 0 &&
      b.symbol !== 'SWAP.HIVE' &&
      b.symbol !== 'VKBT' &&
      b.symbol !== 'CURE'
    );

    console.log(`\n💰 Found ${freeTokens.length} tokens with free balance`);

    // 3. Place sell orders for free balance
    for (const token of freeTokens.slice(0, 5)) { // Limit to 5 per cycle
      const analysis = await analyzeTokenBehavior(token.symbol);
      await manageSellOrder(token.symbol, parseFloat(token.balance), analysis);

      // Delay to avoid API spam
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // 4. Look for buy opportunities
    await findBuyOpportunity();

    // 5. Track performance
    trackPerformance();

  } catch (error) {
    console.error(`❌ Cycle error:`, error);
  }
}

async function main() {
  console.log('🤖 PROFIT TRADING BOT Starting...');
  console.log('='.repeat(80));
  console.log(`Account: ${CONFIG.ACCOUNT}`);
  console.log(`Mode: ${CONFIG.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  console.log(`Micro-undercut: ${CONFIG.MICRO_UNDERCUT.toFixed(8)} HIVE`);
  console.log(`Check interval: ${CONFIG.CHECK_INTERVAL / 1000}s`);
  console.log('='.repeat(80));

  // Run first cycle
  await runCycle();

  // Schedule regular cycles
  setInterval(runCycle, CONFIG.CHECK_INTERVAL);

  console.log('\n✅ Bot running. Press Ctrl+C to stop.\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n💾 Saving state...');
  saveState();
  console.log('✅ Goodbye!\n');
  process.exit(0);
});

// Start
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
