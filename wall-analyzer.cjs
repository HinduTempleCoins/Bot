// ========================================
// BUY/SELL WALL ANALYZER
// ========================================
// Purpose: Analyze order book depth to find affordable opportunities
//          to raise VKBT/CURE prices through smart market making
// Strategy: Only push prices when CHEAP, not at all costs
// Author: Claude Code
// Date: 2026-01-10

const hiveAPI = require('./hive-engine-api.cjs');

// ========================================
// CONFIGURATION
// ========================================

const WALL_CONFIG = {
  // Price targets for VKBT/CURE
  VKBT_TARGET_PRICE: 0.001, // 1:1000 with HIVE (0.001 HIVE per VKBT)
  CURE_TARGET_PRICE: 1.0,   // 1:1 with HIVE minimum (CURE is 34x scarcer than VKBT!)

  // Cost thresholds for "cheap" opportunities
  CHEAP_THRESHOLD_USD: 2.00,        // Only buy up wall if costs < $2 USD
  MICRO_PUSH_COST_USD: 0.01,        // Micro-push costs ~$0.01 (0.0001 HIVE)
  MAX_DAILY_BUDGET_USD: 10.00,      // Max $10/day for price pushing

  // Cooldown periods (prevent spam)
  MAJOR_PUSH_COOLDOWN_HOURS: 6,     // Wait 6h between big buys
  MICRO_PUSH_COOLDOWN_HOURS: 1,     // Wait 1h between micro-pushes

  // Market health checks
  MIN_TRADES_WEEKLY: 5,             // Market must have 5+ trades/week to be alive
  MIN_UNIQUE_HOLDERS: 10,           // Need 10+ holders for healthy distribution

  // HIVE price (for USD calculations)
  HIVE_PRICE_USD: 0.30              // $0.30 per HIVE (update periodically)
};

// ========================================
// HIVE-ENGINE API (Using curl-based wrapper)
// ========================================

async function getOrderBook(token) {
  return await hiveAPI.getOrderBook(token);
}

async function getMarketMetrics(token) {
  return await hiveAPI.getMarketMetrics(token);
}

// ========================================
// WALL ANALYSIS
// ========================================

/**
 * Analyze sell wall depth and calculate cost to reach target price
 * @param {string} token - Token symbol (VKBT, CURE, etc.)
 * @param {number} targetPrice - Desired price to reach
 * @returns {Object} Analysis results
 */
async function analyzeSellWall(token, targetPrice = null) {
  // Use default target prices if not specified
  if (!targetPrice) {
    if (token === 'VKBT') targetPrice = WALL_CONFIG.VKBT_TARGET_PRICE;
    else if (token === 'CURE') targetPrice = WALL_CONFIG.CURE_TARGET_PRICE;
    else throw new Error(`No default target price for ${token}`);
  }

  console.log(`\n📊 Analyzing ${token} sell wall to ${targetPrice} HIVE...`);

  const orderBook = await getOrderBook(token);
  const metrics = await getMarketMetrics(token);

  if (!orderBook.asks || orderBook.asks.length === 0) {
    console.log(`⚠️ No sell orders for ${token}`);
    return {
      token,
      targetPrice,
      currentPrice: parseFloat(metrics?.lastPrice || 0),
      costToTarget: Infinity,
      costUSD: Infinity,
      tokensNeeded: 0,
      ordersToFill: 0,
      isAffordable: false,
      recommendation: 'NO_SELL_WALL'
    };
  }

  const currentPrice = parseFloat(metrics?.lastPrice || 0);
  let totalCost = 0; // In HIVE
  let tokensAccumulated = 0;
  let ordersFilled = 0;

  // Calculate cost to buy up wall to target price
  for (const order of orderBook.asks) {
    const orderPrice = parseFloat(order.price);
    const orderQuantity = parseFloat(order.quantity);

    if (orderPrice <= targetPrice) {
      // This order is below our target - include it
      totalCost += orderPrice * orderQuantity;
      tokensAccumulated += orderQuantity;
      ordersFilled++;
    } else {
      // Reached orders above target price
      break;
    }
  }

  const costUSD = totalCost * WALL_CONFIG.HIVE_PRICE_USD;
  const isAffordable = costUSD <= WALL_CONFIG.CHEAP_THRESHOLD_USD;

  // Determine recommendation
  let recommendation;
  if (costUSD === 0 && currentPrice >= targetPrice) {
    // All sells above target AND current price is high
    recommendation = 'ALREADY_AT_TARGET';
  } else if (costUSD === 0 && currentPrice < targetPrice) {
    // No sells below target, but price is still low - need to BID UP
    recommendation = 'PLACE_BUY_ORDER';
  } else if (costUSD <= WALL_CONFIG.MICRO_PUSH_COST_USD) {
    recommendation = 'MICRO_PUSH'; // Very cheap, just nudge it
  } else if (isAffordable) {
    recommendation = 'BUY_UP_WALL'; // Good opportunity to buy up wall
  } else {
    recommendation = 'TOO_EXPENSIVE'; // Wait for cheaper opportunity
  }

  const analysis = {
    token,
    targetPrice,
    currentPrice,
    costToTarget: totalCost,
    costUSD: costUSD,
    tokensNeeded: tokensAccumulated,
    ordersToFill: ordersFilled,
    isAffordable,
    recommendation,
    sellWallFloor: orderBook.asks[0] ? parseFloat(orderBook.asks[0].price) : 0,
    sellWallDepth: orderBook.asks.length
  };

  console.log(`   Current Price: ${currentPrice.toFixed(8)} HIVE`);
  console.log(`   Target Price: ${targetPrice.toFixed(8)} HIVE`);
  console.log(`   Cost to Target: ${totalCost.toFixed(4)} HIVE ($${costUSD.toFixed(2)} USD)`);
  console.log(`   Tokens Needed: ${tokensAccumulated.toFixed(4)} ${token}`);
  console.log(`   Orders to Fill: ${ordersFilled}`);
  console.log(`   Affordable: ${isAffordable ? '✅ YES' : '❌ NO'}`);
  console.log(`   Recommendation: ${recommendation}`);

  return analysis;
}

/**
 * Analyze buy wall depth to determine optimal sell quantity
 * @param {string} token - Token symbol
 * @param {number} quantity - How many tokens we want to sell
 * @returns {Object} Analysis results
 */
async function analyzeBuyWall(token, quantity) {
  console.log(`\n📊 Analyzing ${token} buy wall for ${quantity} tokens...`);

  const orderBook = await getOrderBook(token);

  if (!orderBook.bids || orderBook.bids.length === 0) {
    console.log(`⚠️ No buy orders for ${token}`);
    return {
      token,
      quantity,
      canSell: false,
      totalRevenue: 0,
      averagePrice: 0,
      recommendation: 'NO_BUY_WALL'
    };
  }

  let remainingToSell = quantity;
  let totalRevenue = 0; // In HIVE
  let ordersFilled = 0;

  // Simulate selling into buy wall
  for (const order of orderBook.bids) {
    if (remainingToSell <= 0) break;

    const orderPrice = parseFloat(order.price);
    const orderQuantity = parseFloat(order.quantity);

    const sellQuantity = Math.min(remainingToSell, orderQuantity);
    totalRevenue += sellQuantity * orderPrice;
    remainingToSell -= sellQuantity;
    ordersFilled++;
  }

  const canSellAll = remainingToSell === 0;
  const averagePrice = quantity > 0 ? totalRevenue / (quantity - remainingToSell) : 0;
  const percentFilled = ((quantity - remainingToSell) / quantity) * 100;

  let recommendation;
  if (canSellAll) {
    recommendation = 'CAN_SELL_ALL';
  } else if (percentFilled >= 50) {
    recommendation = 'CAN_SELL_PARTIAL';
  } else {
    recommendation = 'INSUFFICIENT_LIQUIDITY';
  }

  const analysis = {
    token,
    quantity,
    canSell: canSellAll,
    totalRevenue,
    averagePrice,
    percentFilled,
    ordersFilled,
    recommendation,
    buyWallTop: orderBook.bids[0] ? parseFloat(orderBook.bids[0].price) : 0,
    buyWallDepth: orderBook.bids.length
  };

  console.log(`   Can Sell All: ${canSellAll ? '✅ YES' : '❌ NO'}`);
  console.log(`   Percent Filled: ${percentFilled.toFixed(2)}%`);
  console.log(`   Total Revenue: ${totalRevenue.toFixed(4)} HIVE`);
  console.log(`   Average Price: ${averagePrice.toFixed(8)} HIVE`);
  console.log(`   Recommendation: ${recommendation}`);

  return analysis;
}

/**
 * Check market health to determine if market is alive enough to trade
 * @param {string} token - Token symbol
 * @returns {Object} Health metrics
 */
async function checkMarketHealth(token) {
  console.log(`\n🏥 Checking ${token} market health...`);

  const metrics = await getMarketMetrics(token);
  const orderBook = await getOrderBook(token);

  if (!metrics) {
    return {
      token,
      isAlive: false,
      reason: 'NO_METRICS'
    };
  }

  const volume24h = parseFloat(metrics.volume || 0);
  const lastPrice = parseFloat(metrics.lastPrice || 0);
  const priceChange = parseFloat(metrics.priceChangePercent || 0);

  // Estimate weekly trades (rough approximation)
  const estimatedWeeklyTrades = volume24h > 0 ? Math.floor(volume24h / lastPrice) : 0;

  const hasLiquidity = orderBook.bids.length > 0 && orderBook.asks.length > 0;
  const hasVolume = estimatedWeeklyTrades >= WALL_CONFIG.MIN_TRADES_WEEKLY;

  // SPECIAL CASE: VKBT/CURE with strong holder base (~1000 holders each)
  // These tokens are NOT dead - people are holding and waiting for higher prices!
  // We don't need buy orders (we're CREATING demand), just sell orders to push
  const isTargetToken = token === 'VKBT' || token === 'CURE';
  const hasSellOrders = orderBook.asks.length > 0;

  let isAlive, reason;

  if (isTargetToken) {
    // For VKBT/CURE: If there are sell orders, we can push the price
    // Don't require buy orders or volume - we're creating the market!
    isAlive = hasSellOrders;
    if (isAlive) {
      reason = hasLiquidity && hasVolume ? 'HEALTHY' : 'READY_TO_PUSH';
    } else {
      reason = 'NO_SELL_ORDERS';
    }
  } else {
    // For other tokens: Use normal liquidity + volume checks
    isAlive = hasLiquidity && hasVolume;
    reason = isAlive ? 'HEALTHY' : (hasLiquidity ? 'LOW_VOLUME' : 'NO_LIQUIDITY');
  }

  const health = {
    token,
    isAlive,
    volume24h,
    lastPrice,
    priceChange,
    estimatedWeeklyTrades,
    bidDepth: orderBook.bids.length,
    askDepth: orderBook.asks.length,
    hasLiquidity,
    hasVolume,
    reason
  };

  console.log(`   Is Alive: ${isAlive ? '✅ YES' : '❌ NO'}`);
  console.log(`   24h Volume: ${volume24h.toFixed(8)} HIVE`);
  console.log(`   Estimated Weekly Trades: ${estimatedWeeklyTrades}`);
  console.log(`   Bid Depth: ${orderBook.bids.length} orders`);
  console.log(`   Ask Depth: ${orderBook.asks.length} orders`);
  if (isTargetToken) {
    console.log(`   🎯 Target token: ${hasSellOrders ? 'Ready to push!' : 'Waiting for sell orders'}`);
  }

  return health;
}

/**
 * Find the best opportunity among VKBT and CURE
 * @returns {Object} Best opportunity analysis
 */
async function findBestPushOpportunity() {
  console.log('\n🔍 Finding best price push opportunity...\n');

  // Analyze both tokens
  const vkbtAnalysis = await analyzeSellWall('VKBT');
  const cureAnalysis = await analyzeSellWall('CURE');

  // Check market health
  const vkbtHealth = await checkMarketHealth('VKBT');
  const cureHealth = await checkMarketHealth('CURE');

  // Filter out dead markets
  const opportunities = [];

  if (vkbtHealth.isAlive && vkbtAnalysis.recommendation !== 'NO_SELL_WALL') {
    opportunities.push({
      ...vkbtAnalysis,
      health: vkbtHealth,
      score: calculateOpportunityScore(vkbtAnalysis, vkbtHealth)
    });
  }

  if (cureHealth.isAlive && cureAnalysis.recommendation !== 'NO_SELL_WALL') {
    opportunities.push({
      ...cureAnalysis,
      health: cureHealth,
      score: calculateOpportunityScore(cureAnalysis, cureHealth)
    });
  }

  if (opportunities.length === 0) {
    console.log('⚠️ No viable opportunities found');
    return null;
  }

  // Sort by score (lower cost = higher score)
  opportunities.sort((a, b) => b.score - a.score);

  const best = opportunities[0];

  console.log(`\n🎯 Best Opportunity: ${best.token}`);
  console.log(`   Cost: $${best.costUSD.toFixed(2)} USD`);
  console.log(`   Recommendation: ${best.recommendation}`);
  console.log(`   Score: ${best.score.toFixed(2)}/100`);

  return best;
}

/**
 * Calculate opportunity score (0-100)
 * Higher score = better opportunity (cheaper, healthier market)
 */
function calculateOpportunityScore(analysis, health) {
  let score = 0;

  // Cost factor (0-50 points)
  // Cheaper = better
  if (analysis.costUSD <= WALL_CONFIG.MICRO_PUSH_COST_USD) {
    score += 50; // Free/micro-push
  } else if (analysis.costUSD <= WALL_CONFIG.CHEAP_THRESHOLD_USD) {
    score += 50 * (1 - (analysis.costUSD / WALL_CONFIG.CHEAP_THRESHOLD_USD));
  }

  // Market health (0-30 points)
  if (health.isAlive) {
    score += 15;
  }
  if (health.hasVolume) {
    score += 15;
  }

  // Liquidity (0-20 points)
  const totalDepth = health.bidDepth + health.askDepth;
  score += Math.min(20, totalDepth / 5); // Max 20 points at 100+ orders

  return Math.min(100, score);
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  analyzeSellWall,
  analyzeBuyWall,
  checkMarketHealth,
  findBestPushOpportunity,
  getOrderBook,
  getMarketMetrics,
  WALL_CONFIG
};
