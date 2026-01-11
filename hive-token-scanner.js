import axios from 'axios';
import dotenv from 'dotenv';
import { readFile, writeFile } from 'fs/promises';

dotenv.config();

// ========================================
// HIVE-ENGINE TOKEN HEALTH SCANNER
// ========================================
// Analyzes all HIVE-Engine tokens to identify:
// - Active tokens (good volume, recent trades)
// - Dead tokens (no volume, abandoned)
// - Risky tokens (low liquidity, suspicious activity)

const HIVE_ENGINE_API = 'https://api.hive-engine.com/rpc/contracts';

// Token health criteria (RELAXED - most tokens don't meet strict thresholds)
const HEALTH_CRITERIA = {
  MIN_24H_VOLUME: parseFloat(process.env.MIN_24H_VOLUME || '0.1'), // Minimum 0.1 HIVE volume (lowered from 50)
  MIN_LIQUIDITY: parseFloat(process.env.MIN_LIQUIDITY || '1'), // Minimum 1 HIVE total liquidity (lowered from 100)
  MIN_HOLDERS: parseInt(process.env.MIN_HOLDERS || '3'), // Minimum 3 holders (lowered from 10)
  MAX_DAYS_SINCE_TRADE: parseInt(process.env.MAX_DAYS_SINCE_TRADE || '60'), // Trade within 60 days (relaxed from 7)
  MIN_MARKET_CAP: parseFloat(process.env.MIN_MARKET_CAP || '1'), // Minimum 1 HIVE market cap (lowered from 500)
};

// Van Kush Family Tokens - These get special analysis
const VAN_KUSH_TOKENS = {
  VKBT: {
    name: 'Van Kush Beauty Token',
    launched: '2021-09-04',
    blockchain: 'HIVE-Engine',
    purpose: 'Community token for Van Kush Beauty company and ecosystem rewards',
    minting: {
      type: 'Rewards Pool',
      rate: 'Active - higher emission rate',
      supply: 'Growing supply via staking rewards'
    },
    tokenomics: {
      maxSupply: null, // Unlimited via rewards
      initialSupply: 'Check on-chain',
      distribution: 'Community rewards, staking, curation'
    },
    community: 'Active - Van Kush Family Discord, HIVE posts',
    target_price: 1.0, // Target 1:1 with HIVE
    priority: 'high' // Actively supported
  },
  CURE: {
    name: 'Cure Token',
    launched: '2021',
    blockchain: 'HIVE-Engine',
    purpose: 'Van Kush ecosystem token',
    minting: {
      type: 'Slow controlled emission',
      rate: 'SLOWER than VKBT - more rare',
      supply: 'Limited growth - scarcity model'
    },
    tokenomics: {
      maxSupply: 'Capped or very slow inflation',
      rarity: 'HIGH - slower minting makes it scarcer than VKBT',
      distribution: 'Controlled distribution'
    },
    community: 'Active - Van Kush Family Discord, HIVE posts',
    target_price: 1.0, // Target 1:1 with HIVE
    priority: 'high' // Actively supported
  }
};

// Community indicators - tokens must have SOME activity to be considered for market making
const COMMUNITY_INDICATORS = {
  MIN_DISCORD_MENTIONS: 5, // At least 5 mentions in community Discord
  MIN_SOCIAL_POSTS: 10, // At least 10 social media posts
  HAS_WEBSITE: true, // Should have active website/docs
  HAS_ACTIVE_DEV: true, // Active development/updates
  INSIDER_TOKEN: false // Set true for Van Kush tokens
};

// Token database
let tokenDatabase = {
  lastScan: null,
  tokens: [],
  whitelist: [],
  blacklist: [],
  stats: {
    total: 0,
    active: 0,
    lowActivity: 0,
    dead: 0,
    risky: 0
  }
};

// Load existing database
try {
  const data = await readFile('./hive-token-database.json', 'utf8');
  tokenDatabase = JSON.parse(data);
  console.log(`✅ Loaded token database (${tokenDatabase.tokens.length} tokens)`);
} catch (error) {
  console.log('📝 No existing token database, starting fresh');
}

// ========================================
// HIVE-ENGINE API FUNCTIONS
// ========================================

async function getAllTokens() {
  try {
    const response = await axios.post(HIVE_ENGINE_API, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'tokens',
        query: {},
        limit: 1000,
        offset: 0
      }
    });

    return response.data.result || [];
  } catch (error) {
    console.error('Error fetching tokens:', error.message);
    return [];
  }
}

async function getTokenMetrics(symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_API, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'metrics',
        query: { symbol },
        limit: 1
      }
    });

    return response.data.result?.[0] || null;
  } catch (error) {
    return null;
  }
}

async function getTokenHolders(symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_API, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: {
          symbol,
          balance: { $gte: '0.00000001' }
        },
        limit: 1000
      }
    });

    return response.data.result || [];
  } catch (error) {
    return [];
  }
}

async function getRecentTrades(symbol, limit = 10) {
  try {
    const response = await axios.post(HIVE_ENGINE_API, {
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

    return response.data.result || [];
  } catch (error) {
    return [];
  }
}

async function getOrderBook(symbol) {
  try {
    const [buyOrders, sellOrders] = await Promise.all([
      axios.post(HIVE_ENGINE_API, {
        jsonrpc: '2.0',
        id: 1,
        method: 'find',
        params: {
          contract: 'market',
          table: 'buyBook',
          query: { symbol },
          limit: 100
        }
      }),
      axios.post(HIVE_ENGINE_API, {
        jsonrpc: '2.0',
        id: 1,
        method: 'find',
        params: {
          contract: 'market',
          table: 'sellBook',
          query: { symbol },
          limit: 100
        }
      })
    ]);

    return {
      bids: buyOrders.data.result || [],
      asks: sellOrders.data.result || []
    };
  } catch (error) {
    return { bids: [], asks: [] };
  }
}

// ========================================
// TOKEN HEALTH ANALYSIS
// ========================================

function analyzeOrderBook(orderBook) {
  // Calculate total liquidity on each side
  const bidLiquidity = orderBook.bids.reduce((sum, order) =>
    sum + (parseFloat(order.price) * parseFloat(order.quantity)), 0
  );
  const askLiquidity = orderBook.asks.reduce((sum, order) =>
    sum + (parseFloat(order.price) * parseFloat(order.quantity)), 0
  );
  const totalLiquidity = bidLiquidity + askLiquidity;

  // Identify walls (orders >= 20% of one side's liquidity)
  const buyWalls = orderBook.bids
    .map(order => ({
      price: parseFloat(order.price),
      quantity: parseFloat(order.quantity),
      value: parseFloat(order.price) * parseFloat(order.quantity)
    }))
    .filter(order => order.value >= bidLiquidity * 0.2)
    .sort((a, b) => b.value - a.value);

  const sellWalls = orderBook.asks
    .map(order => ({
      price: parseFloat(order.price),
      quantity: parseFloat(order.quantity),
      value: parseFloat(order.price) * parseFloat(order.quantity)
    }))
    .filter(order => order.value >= askLiquidity * 0.2)
    .sort((a, b) => b.value - a.value);

  // Calculate buy/sell pressure ratio
  const buyPressure = bidLiquidity / (totalLiquidity || 1);
  const sellPressure = askLiquidity / (totalLiquidity || 1);
  const pressureRatio = buyPressure / (sellPressure || 0.01); // Avoid division by zero

  // Determine market sentiment
  let sentiment = 'neutral';
  if (pressureRatio > 1.5) sentiment = 'bullish'; // 60%+ buy pressure
  else if (pressureRatio < 0.67) sentiment = 'bearish'; // 60%+ sell pressure

  // Check for manipulation indicators
  const hasLargeBuyWall = buyWalls.length > 0 && buyWalls[0].value >= bidLiquidity * 0.5;
  const hasLargeSellWall = sellWalls.length > 0 && sellWalls[0].value >= askLiquidity * 0.5;

  return {
    totalLiquidity,
    bidLiquidity,
    askLiquidity,
    buyPressure,
    sellPressure,
    pressureRatio,
    sentiment,
    buyWalls,
    sellWalls,
    hasLargeBuyWall,
    hasLargeSellWall,
    spreadPercent: orderBook.bids[0] && orderBook.asks[0]
      ? ((parseFloat(orderBook.asks[0].price) - parseFloat(orderBook.bids[0].price)) /
         parseFloat(orderBook.bids[0].price) * 100)
      : 100 // Large spread if no orders
  };
}

// ========================================
// MARKET MAKING ANALYSIS
// ========================================

function generateMarketMakingRecommendation(symbol, parityAnalysis, currentPrice, tokenConfig) {
  /**
   * Generates recommendations for RAISING the price of Van Kush tokens
   * Goal: INCREASE VALUE, not just accumulate tokens
   * Strategy: Buy walls, strategic buys, price support
   */

  const recommendations = [];
  const targetPrice = tokenConfig.target_price;
  const distanceToTarget = ((targetPrice - currentPrice) / currentPrice * 100);

  // Strategy depends on how far from parity
  if (!parityAnalysis.feasible) {
    recommendations.push({
      priority: 'critical',
      action: 'Place buy walls at higher prices',
      reason: 'No sell orders exist up to target - need to encourage sellers at better prices',
      strategy: `Place tiered buy orders: ${(currentPrice * 1.1).toFixed(8)}, ${(currentPrice * 1.25).toFixed(8)}, ${(currentPrice * 1.5).toFixed(8)} HIVE`,
      capital: 'TBD based on desired wall size'
    });
  } else if (distanceToTarget > 1000) {
    // Very far from parity (>10x needed)
    recommendations.push({
      priority: 'high',
      action: 'Gradual accumulation with price support',
      reason: `Price is ${distanceToTarget.toFixed(0)}% below target - long journey ahead`,
      strategy: 'Buy in tiers: 20% now, 30% at +25% price, 30% at +50% price, 20% at +75% price',
      capital: parityAnalysis.costToTarget,
      immediateCapital: parityAnalysis.costToTarget * 0.2,
      timeframe: 'weeks to months'
    });
  } else if (distanceToTarget > 100) {
    // Moderately far (2-10x needed)
    recommendations.push({
      priority: 'high',
      action: 'Aggressive buying with walls',
      reason: `${distanceToTarget.toFixed(0)}% increase needed - achievable with focused effort`,
      strategy: `Buy ${(parityAnalysis.tokensBought * 0.3).toFixed(2)} ${symbol} immediately, place buy walls every 10% up`,
      capital: parityAnalysis.costToTarget * 0.3,
      wallStrategy: 'Place 3-5 buy walls at: ' +
        [1.1, 1.25, 1.5, 1.75, 2.0].map(mult =>
          `${(currentPrice * mult).toFixed(8)} HIVE`
        ).join(', '),
      timeframe: 'days to weeks'
    });
  } else {
    // Close to parity (<2x needed)
    recommendations.push({
      priority: 'critical',
      action: 'PUSH TO PARITY NOW',
      reason: `Only ${distanceToTarget.toFixed(0)}% increase needed - parity is achievable!`,
      strategy: `Buy all ${parityAnalysis.tokensBought.toFixed(2)} ${symbol} up to target price`,
      capital: parityAnalysis.costToTarget,
      expectedResult: `This brings ${symbol} to 1:1 parity with HIVE`,
      timeframe: 'immediate (single day)'
    });
  }

  // ALWAYS include price support strategy
  recommendations.push({
    priority: 'ongoing',
    action: 'Maintain price floors',
    reason: 'Prevent dumps and support new higher prices',
    strategy: 'After buying, place buy walls at: -5%, -10%, -15% below new price to catch any sells',
    note: 'This protects gains and signals to market that price won\'t crash'
  });

  // Token-specific notes
  if (symbol === 'CURE') {
    recommendations.push({
      priority: 'note',
      action: 'Emphasize scarcity',
      reason: 'CURE has SLOWER minting than VKBT - more rare, should command premium',
      marketing: 'Educate community: CURE is the scarce Van Kush token, limited supply growth',
      longTerm: 'Lower sell pressure expected due to slow minting - easier to raise price'
    });
  } else if (symbol === 'VKBT') {
    recommendations.push({
      priority: 'note',
      action: 'Leverage rewards pool',
      reason: 'VKBT has active rewards - can use this to incentivize holding',
      marketing: 'Promote staking rewards to reduce sell pressure',
      longTerm: 'Higher circulation but more utility - balance accumulation with price support'
    });
  }

  return recommendations;
}

function calculateCostToParity(orderBook, currentPrice, targetPrice = 1.0) {
  /**
   * Calculates how much HIVE capital is needed to push token price to target
   * Example: CURE is at 0.01 HIVE. How much HIVE needed to reach 1.0 HIVE (parity)?
   *
   * Process:
   * 1. Get all sell orders from current price up to target price
   * 2. Calculate total HIVE needed to buy through all those orders
   * 3. This is the "market making cost" to achieve parity
   */

  if (currentPrice >= targetPrice) {
    return {
      costToTarget: 0,
      tokensBought: 0,
      priceImpact: 0,
      feasible: true,
      note: 'Already at or above target price'
    };
  }

  // Sort sell orders by price (ascending - cheapest first)
  const sellOrders = orderBook.asks
    .map(order => ({
      price: parseFloat(order.price),
      quantity: parseFloat(order.quantity),
      value: parseFloat(order.price) * parseFloat(order.quantity)
    }))
    .filter(order => order.price <= targetPrice) // Only orders up to target
    .sort((a, b) => a.price - b.price);

  let totalCost = 0;
  let totalTokens = 0;
  let ordersToFill = [];

  // Calculate cost to buy through all orders up to target price
  for (const order of sellOrders) {
    totalCost += order.value;
    totalTokens += order.quantity;
    ordersToFill.push({
      price: order.price,
      quantity: order.quantity,
      cost: order.value
    });
  }

  const priceImpact = sellOrders.length > 0
    ? ((sellOrders[sellOrders.length - 1].price - currentPrice) / currentPrice * 100)
    : 0;

  // Check if there are ANY sell orders up to target
  const feasible = sellOrders.length > 0;
  const averageFillPrice = totalTokens > 0 ? (totalCost / totalTokens) : 0;

  return {
    costToTarget: totalCost, // Total HIVE needed
    tokensBought: totalTokens, // Total tokens acquired
    averageFillPrice, // Average price per token
    priceImpact, // % price increase
    ordersToFill: ordersToFill.length,
    feasible, // Can we actually reach target with existing orders?
    orders: ordersToFill, // Detailed order list
    efficiency: totalTokens > 0 ? (totalCost / totalTokens) / targetPrice : 0, // How efficient is the buy (1.0 = perfect)
    note: !feasible ? 'No sell orders exist up to target price - would need to wait for sellers' : null
  };
}

function getDaysSinceLastTrade(trades) {
  if (trades.length === 0) return Infinity;

  const lastTrade = trades[0];
  const lastTradeTime = lastTrade.timestamp * 1000; // Convert to milliseconds
  const now = Date.now();
  const daysSince = (now - lastTradeTime) / (1000 * 60 * 60 * 24);

  return daysSince;
}

async function analyzeToken(tokenInfo) {
  const symbol = tokenInfo.symbol;

  console.log(`\n🔍 Analyzing ${symbol}...`);

  // Fetch all data in parallel
  const [metrics, holders, trades, orderBook] = await Promise.all([
    getTokenMetrics(symbol),
    getTokenHolders(symbol),
    getRecentTrades(symbol, 50),
    getOrderBook(symbol)
  ]);

  // Calculate metrics
  const volume24h = metrics ? parseFloat(metrics.volume || 0) : 0;
  const lastPrice = metrics ? parseFloat(metrics.lastPrice || 0) : 0;
  const holderCount = holders.length;
  const totalSupply = parseFloat(tokenInfo.supply || 0);
  const circulatingSupply = parseFloat(tokenInfo.circulatingSupply || totalSupply);
  const marketCap = lastPrice * circulatingSupply;

  // Analyze order book (liquidity + walls)
  const orderBookAnalysis = analyzeOrderBook(orderBook);
  const liquidity = orderBookAnalysis.totalLiquidity;

  const daysSinceLastTrade = getDaysSinceLastTrade(trades);
  const tradeCount24h = trades.filter(t => {
    const tradeTime = t.timestamp * 1000;
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    return tradeTime >= dayAgo;
  }).length;

  // Determine health status
  let healthStatus = 'unknown';
  let healthScore = 0;
  const issues = [];
  const warnings = [];

  // Check each criterion
  if (volume24h >= HEALTH_CRITERIA.MIN_24H_VOLUME) {
    healthScore += 25;
  } else {
    issues.push(`Low volume: ${volume24h.toFixed(2)} HIVE/24h`);
  }

  if (liquidity >= HEALTH_CRITERIA.MIN_LIQUIDITY) {
    healthScore += 25;
  } else {
    issues.push(`Low liquidity: ${liquidity.toFixed(2)} HIVE`);
  }

  if (holderCount >= HEALTH_CRITERIA.MIN_HOLDERS) {
    healthScore += 20;
  } else {
    issues.push(`Few holders: ${holderCount}`);
  }

  if (daysSinceLastTrade <= HEALTH_CRITERIA.MAX_DAYS_SINCE_TRADE) {
    healthScore += 20;
  } else if (daysSinceLastTrade === Infinity) {
    issues.push('No trade history');
  } else {
    issues.push(`Last trade: ${Math.floor(daysSinceLastTrade)} days ago`);
  }

  if (marketCap >= HEALTH_CRITERIA.MIN_MARKET_CAP) {
    healthScore += 10;
  } else {
    issues.push(`Low market cap: ${marketCap.toFixed(2)} HIVE`);
  }

  // ========================================
  // BUY/SELL WALL ANALYSIS
  // ========================================

  // Check for manipulation indicators
  if (orderBookAnalysis.hasLargeBuyWall) {
    warnings.push(`Large buy wall detected (${orderBookAnalysis.buyWalls[0].value.toFixed(2)} HIVE)`);
  }
  if (orderBookAnalysis.hasLargeSellWall) {
    warnings.push(`Large sell wall detected (${orderBookAnalysis.sellWalls[0].value.toFixed(2)} HIVE)`);
  }

  // Extreme imbalance warning
  if (orderBookAnalysis.pressureRatio > 3) {
    warnings.push(`Very high buy pressure (${(orderBookAnalysis.buyPressure * 100).toFixed(0)}% buy side)`);
  } else if (orderBookAnalysis.pressureRatio < 0.33) {
    warnings.push(`Very high sell pressure (${(orderBookAnalysis.sellPressure * 100).toFixed(0)}% sell side)`);
  }

  // Wide spread warning
  if (orderBookAnalysis.spreadPercent > 10) {
    warnings.push(`Wide spread: ${orderBookAnalysis.spreadPercent.toFixed(2)}%`);
  }

  // Determine status based on score
  if (healthScore >= 80) {
    healthStatus = 'active';
  } else if (healthScore >= 50) {
    healthStatus = 'low_activity';
  } else if (healthScore >= 20) {
    healthStatus = 'risky';
  } else {
    healthStatus = 'dead';
  }

  // ========================================
  // VAN KUSH TOKEN SPECIAL ANALYSIS
  // ========================================
  let marketMaking = null;

  const isVanKushToken = VAN_KUSH_TOKENS.hasOwnProperty(symbol);
  if (isVanKushToken && lastPrice > 0) {
    const tokenConfig = VAN_KUSH_TOKENS[symbol];
    const parityAnalysis = calculateCostToParity(orderBook, lastPrice, tokenConfig.target_price);

    marketMaking = {
      isVanKushToken: true,
      priority: tokenConfig.priority,
      tokenomics: tokenConfig.tokenomics,
      minting: tokenConfig.minting,
      currentPrice: lastPrice,
      targetPrice: tokenConfig.target_price,
      priceRatio: lastPrice / tokenConfig.target_price, // How far from parity (0.01 = 1% of target)
      distanceToTarget: ((tokenConfig.target_price - lastPrice) / lastPrice * 100), // % increase needed
      costToParity: parityAnalysis.costToTarget,
      tokensToBuy: parityAnalysis.tokensBought,
      averageFillPrice: parityAnalysis.averageFillPrice,
      feasible: parityAnalysis.feasible,
      efficiency: parityAnalysis.efficiency,
      recommendation: generateMarketMakingRecommendation(symbol, parityAnalysis, lastPrice, tokenConfig)
    };

    console.log(`   💎 VAN KUSH TOKEN DETECTED!`);
    console.log(`   Current: ${lastPrice.toFixed(8)} HIVE | Target: ${tokenConfig.target_price.toFixed(2)} HIVE`);
    console.log(`   Distance to Parity: ${marketMaking.distanceToTarget.toFixed(0)}% increase needed`);
    if (parityAnalysis.feasible) {
      console.log(`   Cost to Parity: ${parityAnalysis.costToTarget.toFixed(2)} HIVE`);
      console.log(`   Would acquire: ${parityAnalysis.tokensBought.toFixed(2)} ${symbol}`);
    } else {
      console.log(`   ⚠️ No sell orders exist up to target - need more liquidity`);
    }
  }

  const analysis = {
    symbol,
    name: tokenInfo.name,
    healthStatus,
    healthScore,
    isVanKushToken,
    marketMaking,
    metrics: {
      volume24h,
      liquidity,
      marketCap,
      lastPrice,
      holderCount,
      totalSupply,
      circulatingSupply,
      tradeCount24h,
      daysSinceLastTrade: daysSinceLastTrade === Infinity ? null : daysSinceLastTrade
    },
    orderBook: {
      bidLiquidity: orderBookAnalysis.bidLiquidity,
      askLiquidity: orderBookAnalysis.askLiquidity,
      buyPressure: orderBookAnalysis.buyPressure,
      sellPressure: orderBookAnalysis.sellPressure,
      pressureRatio: orderBookAnalysis.pressureRatio,
      sentiment: orderBookAnalysis.sentiment,
      spreadPercent: orderBookAnalysis.spreadPercent,
      buyWalls: orderBookAnalysis.buyWalls.slice(0, 3), // Top 3 walls
      sellWalls: orderBookAnalysis.sellWalls.slice(0, 3),
      hasLargeBuyWall: orderBookAnalysis.hasLargeBuyWall,
      hasLargeSellWall: orderBookAnalysis.hasLargeSellWall
    },
    issues,
    warnings,
    lastUpdated: Date.now(),
    metadata: {
      issuer: tokenInfo.issuer,
      precision: tokenInfo.precision,
      maxSupply: tokenInfo.maxSupply
    }
  };

  console.log(`   Status: ${healthStatus.toUpperCase()} (Score: ${healthScore}/100)`);
  console.log(`   Sentiment: ${orderBookAnalysis.sentiment.toUpperCase()} (Ratio: ${orderBookAnalysis.pressureRatio.toFixed(2)})`);
  if (issues.length > 0) {
    console.log(`   Issues: ${issues.join(', ')}`);
  }
  if (warnings.length > 0) {
    console.log(`   Warnings: ${warnings.join(', ')}`);
  }

  return analysis;
}

// ========================================
// DISCORD REPORTING
// ========================================

async function sendDiscordReport(report, color = 0x00ff00) {
  const webhookUrl = process.env.HIVE_TOKEN_SCANNER_WEBHOOK || process.env.HIVE_DISCORD_WEBHOOK;
  if (!webhookUrl) return;

  try {
    await axios.post(webhookUrl, {
      embeds: [{
        title: report.title,
        description: report.description,
        fields: report.fields || [],
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: 'HIVE-Engine Token Scanner' }
      }]
    });
  } catch (error) {
    console.error('Error sending Discord report:', error.message);
  }
}

// ========================================
// MAIN SCAN FUNCTION
// ========================================

async function scanAllTokens() {
  console.log('🚀 Starting HIVE-Engine token scan...\n');

  await sendDiscordReport({
    title: '🔍 Token Scan Started',
    description: 'Analyzing all HIVE-Engine tokens for health and activity...'
  }, 0x0099ff);

  // Get all tokens
  const tokens = await getAllTokens();
  console.log(`📊 Found ${tokens.length} tokens to analyze\n`);

  // Reset stats
  tokenDatabase.stats = {
    total: tokens.length,
    active: 0,
    lowActivity: 0,
    dead: 0,
    risky: 0
  };

  tokenDatabase.tokens = [];

  // Analyze each token
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    try {
      const analysis = await analyzeToken(token);
      tokenDatabase.tokens.push(analysis);

      // Update stats
      tokenDatabase.stats[analysis.healthStatus]++;

      // Rate limiting - wait 100ms between requests
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`Error analyzing ${token.symbol}:`, error.message);
    }
  }

  tokenDatabase.lastScan = Date.now();

  // Save database
  await writeFile('./hive-token-database.json', JSON.stringify(tokenDatabase, null, 2));

  // Generate report
  await generateReport();
}

async function generateReport() {
  const { stats, tokens } = tokenDatabase;

  console.log('\n' + '='.repeat(60));
  console.log('📊 TOKEN SCAN COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total Tokens: ${stats.total}`);
  console.log(`✅ Active (80-100 score): ${stats.active}`);
  console.log(`⚠️  Low Activity (50-79 score): ${stats.low_activity}`);
  console.log(`🔶 Risky (20-49 score): ${stats.risky}`);
  console.log(`💀 Dead (0-19 score): ${stats.dead}`);
  console.log('='.repeat(60) + '\n');

  // Get top active tokens
  const activeTokens = tokens
    .filter(t => t.healthStatus === 'active')
    .sort((a, b) => b.healthScore - a.healthScore)
    .slice(0, 10);

  console.log('🏆 TOP 10 ACTIVE TOKENS:');
  activeTokens.forEach((t, i) => {
    console.log(`${i + 1}. ${t.symbol} - Score: ${t.healthScore}/100 | Vol: ${t.metrics.volume24h.toFixed(2)} HIVE | MCap: ${t.metrics.marketCap.toFixed(2)} HIVE`);
  });

  // Van Kush Token Special Report
  const vanKushTokens = tokens.filter(t => t.isVanKushToken);
  if (vanKushTokens.length > 0) {
    console.log('\n💎 VAN KUSH FAMILY TOKENS:');
    vanKushTokens.forEach(t => {
      console.log(`\n${t.symbol}:`);
      console.log(`  Status: ${t.healthStatus.toUpperCase()} (Score: ${t.healthScore}/100)`);
      if (t.marketMaking) {
        console.log(`  Current Price: ${t.marketMaking.currentPrice.toFixed(8)} HIVE`);
        console.log(`  Target Price: ${t.marketMaking.targetPrice.toFixed(2)} HIVE (1:1 parity)`);
        console.log(`  Distance: ${t.marketMaking.distanceToTarget.toFixed(0)}% increase needed`);
        if (t.marketMaking.feasible) {
          console.log(`  💰 Cost to Parity: ${t.marketMaking.costToParity.toFixed(2)} HIVE`);
          console.log(`  📦 Tokens to Buy: ${t.marketMaking.tokensToBuy.toFixed(2)} ${t.symbol}`);
        }
        console.log(`  Strategy: ${t.marketMaking.recommendation[0].action}`);
        console.log(`  Priority: ${t.marketMaking.recommendation[0].priority.toUpperCase()}`);
      }
    });
  }

  // Send Discord report
  const activeList = activeTokens.slice(0, 10).map((t, i) =>
    `${i + 1}. **${t.symbol}** - Score: ${t.healthScore}/100 | Vol: ${t.metrics.volume24h.toFixed(1)} HIVE`
  ).join('\n');

  // Build Van Kush report
  let vanKushReport = '';
  vanKushTokens.forEach(t => {
    if (t.marketMaking) {
      vanKushReport += `\n**${t.symbol}**\n`;
      vanKushReport += `Current: ${t.marketMaking.currentPrice.toFixed(8)} HIVE → Target: ${t.marketMaking.targetPrice} HIVE\n`;
      vanKushReport += `Distance: ${t.marketMaking.distanceToTarget.toFixed(0)}% increase\n`;
      if (t.marketMaking.feasible) {
        vanKushReport += `💰 Cost to Parity: **${t.marketMaking.costToParity.toFixed(2)} HIVE**\n`;
        vanKushReport += `Strategy: ${t.marketMaking.recommendation[0].action}\n`;
      } else {
        vanKushReport += `⚠️ No sell orders to target - place buy walls\n`;
      }
    }
  });

  const discordFields = [
    { name: '📊 Statistics', value:
      `✅ Active: ${stats.active}\n` +
      `⚠️ Low Activity: ${stats.low_activity}\n` +
      `🔶 Risky: ${stats.risky}\n` +
      `💀 Dead: ${stats.dead}`,
      inline: false
    },
    { name: '🏆 Top Active Tokens', value: activeList || 'None found', inline: false }
  ];

  if (vanKushReport) {
    discordFields.push({
      name: '💎 Van Kush Family Tokens - Market Making Analysis',
      value: vanKushReport,
      inline: false
    });
  }

  discordFields.push({
    name: '⚙️ Criteria', value:
      `Min Volume: ${HEALTH_CRITERIA.MIN_24H_VOLUME} HIVE/24h\n` +
      `Min Liquidity: ${HEALTH_CRITERIA.MIN_LIQUIDITY} HIVE\n` +
      `Min Holders: ${HEALTH_CRITERIA.MIN_HOLDERS}\n` +
      `Max Days Since Trade: ${HEALTH_CRITERIA.MAX_DAYS_SINCE_TRADE}`,
    inline: false
  });

  await sendDiscordReport({
    title: '✅ Token Scan Complete',
    description: `Analyzed ${stats.total} tokens on HIVE-Engine`,
    fields: discordFields
  }, 0x00ff00);
}

// ========================================
// QUERY FUNCTIONS (for trading bot)
// ========================================

export function isTokenHealthy(symbol) {
  const token = tokenDatabase.tokens.find(t => t.symbol === symbol);
  if (!token) return false;

  return token.healthStatus === 'active' || token.healthStatus === 'low_activity';
}

export function getTokenHealth(symbol) {
  return tokenDatabase.tokens.find(t => t.symbol === symbol);
}

export function getActiveTokens() {
  return tokenDatabase.tokens.filter(t => t.healthStatus === 'active');
}

export function getDatabaseStats() {
  return {
    ...tokenDatabase.stats,
    lastScan: tokenDatabase.lastScan
  };
}

// ========================================
// STARTUP
// ========================================

if (import.meta.url === `file://${process.argv[1]}`) {
  // Running directly (not imported)
  console.log('🤖 HIVE-Engine Token Health Scanner');
  console.log('📋 Health Criteria:');
  console.log(`   Min 24h Volume: ${HEALTH_CRITERIA.MIN_24H_VOLUME} HIVE`);
  console.log(`   Min Liquidity: ${HEALTH_CRITERIA.MIN_LIQUIDITY} HIVE`);
  console.log(`   Min Holders: ${HEALTH_CRITERIA.MIN_HOLDERS}`);
  console.log(`   Max Days Since Trade: ${HEALTH_CRITERIA.MAX_DAYS_SINCE_TRADE}`);
  console.log(`   Min Market Cap: ${HEALTH_CRITERIA.MIN_MARKET_CAP} HIVE\n`);

  await scanAllTokens();

  console.log('\n✅ Scan complete! Database saved to hive-token-database.json');
  console.log('💡 Import this module in the trading bot to check token health before trading.');
}
