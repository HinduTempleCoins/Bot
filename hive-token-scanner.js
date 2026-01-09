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

// Token health criteria
const HEALTH_CRITERIA = {
  MIN_24H_VOLUME: parseFloat(process.env.MIN_24H_VOLUME || '50'), // Minimum 50 HIVE volume
  MIN_LIQUIDITY: parseFloat(process.env.MIN_LIQUIDITY || '100'), // Minimum 100 HIVE total liquidity
  MIN_HOLDERS: parseInt(process.env.MIN_HOLDERS || '10'), // Minimum 10 holders
  MAX_DAYS_SINCE_TRADE: parseInt(process.env.MAX_DAYS_SINCE_TRADE || '7'), // Must have trade within 7 days
  MIN_MARKET_CAP: parseFloat(process.env.MIN_MARKET_CAP || '500'), // Minimum 500 HIVE market cap
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

  const analysis = {
    symbol,
    name: tokenInfo.name,
    healthStatus,
    healthScore,
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

  // Send Discord report
  const activeList = activeTokens.slice(0, 10).map((t, i) =>
    `${i + 1}. **${t.symbol}** - Score: ${t.healthScore}/100 | Vol: ${t.metrics.volume24h.toFixed(1)} HIVE`
  ).join('\n');

  await sendDiscordReport({
    title: '✅ Token Scan Complete',
    description: `Analyzed ${stats.total} tokens on HIVE-Engine`,
    fields: [
      { name: '📊 Statistics', value:
        `✅ Active: ${stats.active}\n` +
        `⚠️ Low Activity: ${stats.low_activity}\n` +
        `🔶 Risky: ${stats.risky}\n` +
        `💀 Dead: ${stats.dead}`,
        inline: false
      },
      { name: '🏆 Top Active Tokens', value: activeList || 'None found', inline: false },
      { name: '⚙️ Criteria', value:
        `Min Volume: ${HEALTH_CRITERIA.MIN_24H_VOLUME} HIVE/24h\n` +
        `Min Liquidity: ${HEALTH_CRITERIA.MIN_LIQUIDITY} HIVE\n` +
        `Min Holders: ${HEALTH_CRITERIA.MIN_HOLDERS}\n` +
        `Max Days Since Trade: ${HEALTH_CRITERIA.MAX_DAYS_SINCE_TRADE}`,
        inline: false
      }
    ]
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
