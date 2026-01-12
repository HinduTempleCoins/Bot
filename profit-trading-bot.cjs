#!/usr/bin/env node

// ========================================
// PROFIT TRADING BOT
// ========================================
// Scans HIVE-Engine tokens for profitable trading opportunities
// Uses Bollinger Bands, RSI, SMA to identify entry/exit points
// Goal: Make HIVE profits through buy low, sell high cycles

require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const dhive = require('@hiveio/dhive');
const technicalIndicators = require('./technical-indicators.cjs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // Account credentials
  ACCOUNT: process.env.HIVE_USERNAME || 'angelicalist',
  ACTIVE_KEY: process.env.HIVE_ACTIVE_KEY,

  // Trading parameters
  DRY_RUN: process.env.DRY_RUN === 'true', // LIVE trading by default
  MIN_TRADE_SIZE_HIVE: 0.05, // Minimum 0.05 HIVE per trade
  MAX_TRADE_SIZE_HIVE: 0.3, // Maximum 0.3 HIVE per trade
  MIN_PROFIT_PERCENT: 3.0, // Minimum 3% profit target

  // Signal strength thresholds
  MIN_SIGNAL_STRENGTH: 60, // Only trade on high confidence (60+)

  // Token filtering
  MIN_VOLUME_24H: 10, // Min 10 HIVE volume
  MIN_LIQUIDITY: 50, // Min 50 HIVE liquidity
  MAX_SPREAD_PERCENT: 5, // Max 5% spread

  // Scan interval (2 minutes)
  SCAN_INTERVAL: 120000,

  // Price history depth
  PRICE_HISTORY_LIMIT: 50, // Get last 50 trades for analysis

  // Risk management
  MAX_OPEN_POSITIONS: 5, // Max 5 tokens held at once
  STOP_LOSS_PERCENT: 5, // 5% stop loss
  TAKE_PROFIT_PERCENT: 8, // 8% take profit

  // Files
  POSITIONS_FILE: './trading-positions.json',
  HISTORY_FILE: './trading-history.json',

  // API
  HIVE_ENGINE_RPC: 'https://api.hive-engine.com/rpc/contracts'
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

// ========================================
// DATA STORAGE
// ========================================

let activePositions = {}; // { symbol: {entryPrice, quantity, entryTime, ...} }
let tradingHistory = {
  startTime: new Date().toISOString(),
  totalTrades: 0,
  profitableTrades: 0,
  losingTrades: 0,
  totalProfit: 0,
  trades: []
};

// Load existing data
if (fs.existsSync(CONFIG.POSITIONS_FILE)) {
  try {
    activePositions = JSON.parse(fs.readFileSync(CONFIG.POSITIONS_FILE, 'utf8'));
    console.log(`📂 Loaded ${Object.keys(activePositions).length} active positions`);
  } catch (error) {
    console.error('⚠️ Could not load positions:', error.message);
  }
}

if (fs.existsSync(CONFIG.HISTORY_FILE)) {
  try {
    tradingHistory = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8'));
    console.log(`📊 Loaded trading history: ${tradingHistory.totalTrades} total trades`);
  } catch (error) {
    console.error('⚠️ Could not load history:', error.message);
  }
}

// ========================================
// API FUNCTIONS
// ========================================

function apiCall(payload) {
  const jsonPayload = JSON.stringify(payload);
  const escaped = jsonPayload.replace(/'/g, "'\\''");

  const cmd = `curl -s -X POST ${CONFIG.HIVE_ENGINE_RPC} \
    -H "Content-Type: application/json" \
    -d '${escaped}'`;

  const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(output);
}

function getMarketMetrics(symbol) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'findOne',
    params: {
      contract: 'market',
      table: 'metrics',
      query: { symbol }
    }
  });

  return result.result || null;
}

function getTradeHistory(symbol, limit = 50) {
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

function getOrderBook(symbol) {
  const buyResult = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { symbol },
      limit: 20
    }
  });

  const sellResult = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'sellBook',
      query: { symbol },
      limit: 20
    }
  });

  return {
    bids: buyResult.result || [],
    asks: sellResult.result || []
  };
}

function getAccountBalance(account, symbol) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'findOne',
    params: {
      contract: 'tokens',
      table: 'balances',
      query: { account, symbol }
    }
  });

  return result.result ? parseFloat(result.result.balance) : 0;
}

// ========================================
// TRADING FUNCTIONS
// ========================================

async function executeBuy(symbol, quantity, price) {
  if (CONFIG.DRY_RUN) {
    console.log(`   [DRY RUN] Would BUY ${quantity.toFixed(4)} ${symbol} @ ${price.toFixed(8)} HIVE`);
    return { success: true, dryRun: true };
  }

  if (!CONFIG.ACTIVE_KEY) {
    console.error(`   ❌ HIVE_ACTIVE_KEY not configured`);
    return { success: false, error: 'Missing active key' };
  }

  try {
    const key = dhive.PrivateKey.fromString(CONFIG.ACTIVE_KEY);

    const json = {
      contractName: 'market',
      contractAction: 'buy',
      contractPayload: {
        symbol: symbol,
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

    console.log(`   💰 Executing BUY: ${quantity.toFixed(4)} ${symbol} @ ${price.toFixed(8)} HIVE`);
    const result = await client.broadcast.sendOperations([op], key);

    console.log(`   ✅ Buy order placed! TX: ${result.id}`);
    return { success: true, txId: result.id };

  } catch (error) {
    console.error(`   ❌ Buy order failed:`, error.message);
    return { success: false, error: error.message };
  }
}

async function executeSell(symbol, quantity, price) {
  if (CONFIG.DRY_RUN) {
    console.log(`   [DRY RUN] Would SELL ${quantity.toFixed(4)} ${symbol} @ ${price.toFixed(8)} HIVE`);
    return { success: true, dryRun: true };
  }

  if (!CONFIG.ACTIVE_KEY) {
    console.error(`   ❌ HIVE_ACTIVE_KEY not configured`);
    return { success: false, error: 'Missing active key' };
  }

  try {
    const key = dhive.PrivateKey.fromString(CONFIG.ACTIVE_KEY);

    const json = {
      contractName: 'market',
      contractAction: 'sell',
      contractPayload: {
        symbol: symbol,
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

    console.log(`   📤 Executing SELL: ${quantity.toFixed(4)} ${symbol} @ ${price.toFixed(8)} HIVE`);
    const result = await client.broadcast.sendOperations([op], key);

    console.log(`   ✅ Sell order placed! TX: ${result.id}`);
    return { success: true, txId: result.id };

  } catch (error) {
    console.error(`   ❌ Sell order failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// ========================================
// MARKET ANALYSIS
// ========================================

function isTokenTradeable(metrics, orderBook) {
  if (!metrics || !orderBook) return { tradeable: false, reason: 'No market data' };

  const volume24h = parseFloat(metrics.volume || 0);
  const highestBid = parseFloat(metrics.highestBid || 0);
  const lowestAsk = parseFloat(metrics.lowestAsk || 0);

  // Check volume
  if (volume24h < CONFIG.MIN_VOLUME_24H) {
    return { tradeable: false, reason: `Low volume: ${volume24h.toFixed(2)} HIVE` };
  }

  // Check liquidity
  const bidLiquidity = orderBook.bids.reduce((sum, order) =>
    sum + (parseFloat(order.price) * parseFloat(order.quantity)), 0
  );
  const askLiquidity = orderBook.asks.reduce((sum, order) =>
    sum + (parseFloat(order.price) * parseFloat(order.quantity)), 0
  );
  const totalLiquidity = bidLiquidity + askLiquidity;

  if (totalLiquidity < CONFIG.MIN_LIQUIDITY) {
    return { tradeable: false, reason: `Low liquidity: ${totalLiquidity.toFixed(2)} HIVE` };
  }

  // Check spread
  if (highestBid > 0 && lowestAsk > 0) {
    const spreadPercent = ((lowestAsk - highestBid) / highestBid) * 100;
    if (spreadPercent > CONFIG.MAX_SPREAD_PERCENT) {
      return { tradeable: false, reason: `Wide spread: ${spreadPercent.toFixed(2)}%` };
    }
  }

  // Check order book depth
  if (orderBook.bids.length < 3 || orderBook.asks.length < 3) {
    return { tradeable: false, reason: 'Thin order book' };
  }

  return { tradeable: true };
}

function analyzeToken(symbol) {
  console.log(`\n🔍 Analyzing ${symbol}...`);

  // Get market data
  const metrics = getMarketMetrics(symbol);
  if (!metrics) {
    console.log(`   ⚠️ No metrics available`);
    return null;
  }

  const orderBook = getOrderBook(symbol);
  const tradeHistory = getTradeHistory(symbol, CONFIG.PRICE_HISTORY_LIMIT);

  // Check if tradeable
  const tradeableCheck = isTokenTradeable(metrics, orderBook);
  if (!tradeableCheck.tradeable) {
    console.log(`   ❌ Not tradeable: ${tradeableCheck.reason}`);
    return null;
  }

  // Build price history from trades
  if (tradeHistory.length < 20) {
    console.log(`   ⚠️ Insufficient trade history (${tradeHistory.length} trades)`);
    return null;
  }

  const priceHistory = tradeHistory
    .reverse() // Oldest first
    .map(trade => parseFloat(trade.price));

  // Run technical analysis
  const analysis = technicalIndicators.analyzeTechnicals(priceHistory);

  if (analysis.error) {
    console.log(`   ❌ ${analysis.error}`);
    return null;
  }

  console.log(`   📊 Price: ${analysis.currentPrice.toFixed(8)} HIVE`);
  console.log(`   📈 Signal: ${analysis.signal.signal} (${analysis.signal.strength}/100 - ${analysis.signal.confidence})`);
  console.log(`   💡 Reasons: ${analysis.signal.reasons.join(', ')}`);

  if (analysis.indicators.rsi !== null) {
    console.log(`   📉 RSI: ${analysis.indicators.rsi.toFixed(1)}`);
  }

  if (analysis.indicators.bollingerBands) {
    const bb = analysis.indicators.bollingerBands;
    console.log(`   📊 BB: L=${bb.lower.toFixed(8)} M=${bb.middle.toFixed(8)} U=${bb.upper.toFixed(8)} (%B=${(bb.percentB * 100).toFixed(0)}%)`);
  }

  return {
    symbol,
    metrics,
    orderBook,
    analysis,
    timestamp: Date.now()
  };
}

// ========================================
// POSITION MANAGEMENT
// ========================================

function openPosition(symbol, entryPrice, quantity) {
  activePositions[symbol] = {
    entryPrice,
    quantity,
    entryTime: Date.now(),
    entryTimeISO: new Date().toISOString(),
    stopLoss: entryPrice * (1 - CONFIG.STOP_LOSS_PERCENT / 100),
    takeProfit: entryPrice * (1 + CONFIG.TAKE_PROFIT_PERCENT / 100)
  };

  savePositions();
  console.log(`   ✅ Opened position: ${quantity.toFixed(4)} ${symbol} @ ${entryPrice.toFixed(8)} HIVE`);
}

function closePosition(symbol, exitPrice, reason) {
  const position = activePositions[symbol];
  if (!position) return;

  const holdTime = Date.now() - position.entryTime;
  const profitPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
  const profitHIVE = (exitPrice - position.entryPrice) * position.quantity;

  const trade = {
    symbol,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    profitPercent,
    profitHIVE,
    holdTimeMs: holdTime,
    entryTime: position.entryTimeISO,
    exitTime: new Date().toISOString(),
    reason
  };

  tradingHistory.trades.push(trade);
  tradingHistory.totalTrades++;
  tradingHistory.totalProfit += profitHIVE;

  if (profitHIVE > 0) {
    tradingHistory.profitableTrades++;
  } else {
    tradingHistory.losingTrades++;
  }

  delete activePositions[symbol];
  savePositions();
  saveHistory();

  console.log(`   ✅ Closed position: ${profitPercent >= 0 ? '🟢' : '🔴'} ${profitPercent.toFixed(2)}% (${profitHIVE >= 0 ? '+' : ''}${profitHIVE.toFixed(4)} HIVE)`);
  console.log(`   📝 Reason: ${reason}`);
}

function savePositions() {
  fs.writeFileSync(CONFIG.POSITIONS_FILE, JSON.stringify(activePositions, null, 2));
}

function saveHistory() {
  fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(tradingHistory, null, 2));
}

// ========================================
// TRADING LOGIC
// ========================================

function checkExitConditions(symbol, currentPrice) {
  const position = activePositions[symbol];
  if (!position) return;

  // Check stop loss
  if (currentPrice <= position.stopLoss) {
    console.log(`   🛑 STOP LOSS triggered for ${symbol}`);
    executeSell(symbol, position.quantity, currentPrice);
    closePosition(symbol, currentPrice, 'Stop loss');
    return true;
  }

  // Check take profit
  if (currentPrice >= position.takeProfit) {
    console.log(`   🎯 TAKE PROFIT triggered for ${symbol}`);
    executeSell(symbol, position.quantity, currentPrice);
    closePosition(symbol, currentPrice, 'Take profit');
    return true;
  }

  return false;
}

async function scanForOpportunities() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🤖 PROFIT TRADING BOT - Scan ${new Date().toLocaleString()}`);
  console.log('='.repeat(80));

  // Check existing positions first
  console.log('\n📊 Checking existing positions...');
  for (const symbol of Object.keys(activePositions)) {
    const metrics = getMarketMetrics(symbol);
    if (metrics) {
      const currentPrice = parseFloat(metrics.lastPrice);
      checkExitConditions(symbol, currentPrice);
    }
  }

  // Don't open new positions if at limit
  if (Object.keys(activePositions).length >= CONFIG.MAX_OPEN_POSITIONS) {
    console.log(`\n⚠️ At max open positions (${CONFIG.MAX_OPEN_POSITIONS}), skipping new entries`);
    return;
  }

  // Get top traded tokens directly from API
  console.log('\n🔎 Fetching top traded tokens...');

  const metricsResult = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'metrics',
      query: {},
      limit: 100,
      indexes: [{ index: 'volume', descending: true }]
    }
  });

  const allMetrics = metricsResult.result || [];

  // Filter for good candidates
  const candidates = allMetrics
    .filter(m => {
      const volume = parseFloat(m.volume || 0);
      const price = parseFloat(m.lastPrice || 0);
      return volume >= CONFIG.MIN_VOLUME_24H && price > 0;
    })
    .filter(m => !activePositions.hasOwnProperty(m.symbol)) // Don't already have position
    .filter(m => !['VKBT', 'CURE', 'SWAP.HIVE'].includes(m.symbol)) // Don't trade these
    .slice(0, 20); // Top 20

  console.log(`\n🔎 Scanning ${candidates.length} candidate tokens...`);

  for (const candidate of candidates) {
    const tokenAnalysis = analyzeToken(candidate.symbol);

    if (!tokenAnalysis) continue;
    if (!tokenAnalysis.analysis.hasSignal) continue;
    if (tokenAnalysis.analysis.signal.strength < CONFIG.MIN_SIGNAL_STRENGTH) continue;

    // Only act on BUY signals
    if (tokenAnalysis.analysis.signal.signal === 'BUY') {
      console.log(`\n🚨 STRONG BUY SIGNAL: ${candidate.symbol}`);

      const entryPrice = parseFloat(tokenAnalysis.metrics.lowestAsk || tokenAnalysis.metrics.lastPrice);
      const tradeSize = CONFIG.MIN_TRADE_SIZE_HIVE +
        (Math.random() * (CONFIG.MAX_TRADE_SIZE_HIVE - CONFIG.MIN_TRADE_SIZE_HIVE));
      const quantity = tradeSize / entryPrice;

      const result = executeBuy(candidate.symbol, quantity, entryPrice);

      if (result.success) {
        openPosition(candidate.symbol, entryPrice, quantity);
      }

      // Only open one position per scan
      break;
    }
  }

  // Report status
  console.log(`\n📊 Status: ${Object.keys(activePositions).length} active positions, ${tradingHistory.totalTrades} total trades`);
  if (tradingHistory.totalTrades > 0) {
    const winRate = (tradingHistory.profitableTrades / tradingHistory.totalTrades) * 100;
    console.log(`💰 Profit: ${tradingHistory.totalProfit >= 0 ? '+' : ''}${tradingHistory.totalProfit.toFixed(4)} HIVE (${winRate.toFixed(1)}% win rate)`);
  }
}

// ========================================
// MAIN
// ========================================

async function main() {
  console.log('🤖 PROFIT TRADING BOT Starting...');
  console.log(`📊 Account: ${CONFIG.ACCOUNT}`);
  console.log(`${CONFIG.DRY_RUN ? '🧪 DRY RUN MODE' : '🔴 LIVE TRADING MODE'}`);
  console.log(`⏱️ Scan interval: ${CONFIG.SCAN_INTERVAL / 1000}s`);
  console.log(`💰 Trade size: ${CONFIG.MIN_TRADE_SIZE_HIVE}-${CONFIG.MAX_TRADE_SIZE_HIVE} HIVE`);
  console.log(`📈 Min signal strength: ${CONFIG.MIN_SIGNAL_STRENGTH}/100`);
  console.log(`🎯 Profit target: ${CONFIG.TAKE_PROFIT_PERCENT}% | Stop loss: ${CONFIG.STOP_LOSS_PERCENT}%`);

  // Run first scan
  await scanForOpportunities();

  // Schedule regular scans
  setInterval(scanForOpportunities, CONFIG.SCAN_INTERVAL);

  console.log('\n✅ Bot is running. Press Ctrl+C to stop.\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n💾 Saving data before exit...');
  savePositions();
  saveHistory();
  console.log('✅ Data saved. Goodbye!\n');
  process.exit(0);
});

// Start
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
