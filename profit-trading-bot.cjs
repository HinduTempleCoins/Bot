#!/usr/bin/env node

// ========================================
// PROFIT TRADING BOT
// ========================================
// Strategy: Sell wallet tokens when buy walls are strong → Use HIVE to buy profit opportunities
// Goal: Make HIVE profits through active trading cycles

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

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // Account credentials
  ACCOUNT: process.env.HIVE_USERNAME || 'angelicalist',
  ACTIVE_KEY: process.env.HIVE_ACTIVE_KEY,

  // Trading parameters
  DRY_RUN: process.env.DRY_RUN === 'true', // LIVE trading by default

  // Wallet token selling (SEED CAPITAL strategy)
  MIN_BUY_WALL_LIQUIDITY: 5.0, // Need 5+ HIVE buy wall to sell wallet tokens
  SELL_TO_TOP_ORDER: true, // Sell to highest buy order (market sell)

  // BLURT selling (FUEL strategy)
  SELL_BLURT_IMMEDIATELY: true, // BLURT is fuel - sell as soon as possible

  // VKBT/CURE special handling
  VKBT_CURE_TARGET_PRICE: 1.0, // Sell at 1 HIVE each (1:1 parity)

  // Profit trading (buying opportunities)
  BUY_CAPITAL_ALLOCATION: 20, // Use 20% of available HIVE per buy
  MIN_PROFIT_OPPORTUNITY: 5, // Need 5%+ profit potential
  MIN_VOLUME_24H: 10, // Min 10 HIVE volume

  // Scan interval (1 minute for aggressive trading)
  SCAN_INTERVAL: 60000,

  // Files
  POSITIONS_FILE: './trading-positions.json',
  HISTORY_FILE: './trading-history.json',
  WALLET_SNAPSHOT_FILE: './wallet-snapshot.json',

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

let tradingHistory = {
  startTime: new Date().toISOString(),
  totalTrades: 0,
  profitableTrades: 0,
  losingTrades: 0,
  totalProfitHIVE: 0,
  totalSalesHIVE: 0, // HIVE earned from selling wallet tokens
  totalPurchasesHIVE: 0, // HIVE spent on buys
  trades: []
};

// Load existing history
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

function getAllWalletBalances(account) {
  const result = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'tokens',
      table: 'balances',
      query: { account: account },
      limit: 1000,
      offset: 0,
      indexes: []
    }
  });

  return result.result || [];
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

function getOrderBook(symbol) {
  const buyResult = apiCall({
    jsonrpc: '2.0',
    id: 1,
    method: 'find',
    params: {
      contract: 'market',
      table: 'buyBook',
      query: { symbol },
      limit: 20,
      indexes: [{ index: 'price', descending: true }]
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
      limit: 20,
      indexes: [{ index: 'price', descending: false }]
    }
  });

  return {
    bids: buyResult.result || [],
    asks: sellResult.result || []
  };
}

// ========================================
// TRADING FUNCTIONS
// ========================================

async function executeSellToTopBuyOrder(symbol, quantity) {
  if (CONFIG.DRY_RUN) {
    console.log(`   [DRY RUN] Would SELL ${quantity.toFixed(8)} ${symbol} to top buy order`);
    return { success: true, dryRun: true };
  }

  if (!CONFIG.ACTIVE_KEY) {
    console.error(`   ❌ HIVE_ACTIVE_KEY not configured`);
    return { success: false, error: 'Missing active key' };
  }

  try {
    // Get current order book to find top buy order
    const orderBook = getOrderBook(symbol);
    if (!orderBook.bids || orderBook.bids.length === 0) {
      console.error(`   ❌ No buy orders available for ${symbol}`);
      return { success: false, error: 'No buy orders' };
    }

    // Sell to highest buy order (market sell)
    const topBuyOrder = orderBook.bids[0];
    const sellPrice = parseFloat(topBuyOrder.price);

    console.log(`   📤 Selling to top buy order: ${quantity.toFixed(8)} ${symbol} @ ${sellPrice.toFixed(8)} HIVE`);

    const key = dhive.PrivateKey.fromString(CONFIG.ACTIVE_KEY);

    const json = {
      contractName: 'market',
      contractAction: 'sell',
      contractPayload: {
        symbol: symbol,
        quantity: quantity.toFixed(8),
        price: sellPrice.toFixed(8)
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

    const hiveReceived = sellPrice * quantity;
    console.log(`   ✅ Sell order placed! TX: ${result.id}`);
    console.log(`   💰 Expected to receive: ${hiveReceived.toFixed(4)} HIVE`);

    return { success: true, txId: result.id, price: sellPrice, hiveReceived };

  } catch (error) {
    console.error(`   ❌ Sell order failed:`, error.message);
    return { success: false, error: error.message };
  }
}

async function executeBuy(symbol, quantity, price) {
  if (CONFIG.DRY_RUN) {
    console.log(`   [DRY RUN] Would BUY ${quantity.toFixed(8)} ${symbol} @ ${price.toFixed(8)} HIVE`);
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

    console.log(`   💰 Executing BUY: ${quantity.toFixed(8)} ${symbol} @ ${price.toFixed(8)} HIVE`);
    const result = await client.broadcast.sendOperations([op], key);

    const hiveSpent = price * quantity;
    console.log(`   ✅ Buy order placed! TX: ${result.id}`);
    console.log(`   💸 HIVE spent: ${hiveSpent.toFixed(4)} HIVE`);

    return { success: true, txId: result.id, hiveSpent };

  } catch (error) {
    console.error(`   ❌ Buy order failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// ========================================
// WALLET TOKEN SELLING (SEED CAPITAL)
// ========================================

async function processWalletToken(symbol, balance) {
  console.log(`\n🔍 Processing wallet token: ${symbol} (${balance.toFixed(8)})`);

  // BLURT special handling - sell immediately as fuel
  if (symbol === 'BLURT' && CONFIG.SELL_BLURT_IMMEDIATELY) {
    console.log(`   ⛽ BLURT is FUEL - selling immediately`);
    const result = await executeSellToTopBuyOrder(symbol, balance);
    if (result.success && !result.dryRun) {
      recordTrade({
        type: 'FUEL_SALE',
        symbol,
        quantity: balance,
        price: result.price,
        hiveReceived: result.hiveReceived,
        reason: 'BLURT fuel sale'
      });
    }
    return result.success;
  }

  // VKBT/CURE special handling - sell at 1:1 parity
  if ((symbol === 'VKBT' || symbol === 'CURE')) {
    const metrics = await getMarketMetrics(symbol);
    if (!metrics) {
      console.log(`   ⚠️ No market metrics for ${symbol}`);
      return false;
    }

    const currentPrice = parseFloat(metrics.lastPrice || 0);
    const highestBid = parseFloat(metrics.highestBid || 0);

    console.log(`   📊 ${symbol} price: ${currentPrice.toFixed(8)} HIVE | Top bid: ${highestBid.toFixed(8)} HIVE`);
    console.log(`   🎯 Target: 1.0 HIVE (1:1 parity)`);

    // Only sell if we can get 1 HIVE or close to it (0.95+)
    if (highestBid >= 0.95) {
      console.log(`   ✅ Price target reached! Selling ${symbol} at ${highestBid.toFixed(8)} HIVE`);
      const result = await executeSellToTopBuyOrder(symbol, balance);
      if (result.success && !result.dryRun) {
        recordTrade({
          type: 'VKBT_CURE_SALE',
          symbol,
          quantity: balance,
          price: result.price,
          hiveReceived: result.hiveReceived,
          reason: 'VKBT/CURE 1:1 parity target'
        });
      }
      return result.success;
    } else {
      console.log(`   ⏳ Waiting for better price (target: 0.95+ HIVE)`);
      return false;
    }
  }

  // Regular token handling - check buy wall strength
  const metrics = await getMarketMetrics(symbol);
  if (!metrics) {
    console.log(`   ⚠️ No market metrics for ${symbol}`);
    return false;
  }

  const currentPrice = parseFloat(metrics.lastPrice || 0);
  const highestBid = parseFloat(metrics.highestBid || 0);

  if (currentPrice === 0 || highestBid === 0) {
    console.log(`   ❌ No active market`);
    return false;
  }

  console.log(`   📊 Price: ${currentPrice.toFixed(8)} HIVE | Top bid: ${highestBid.toFixed(8)} HIVE`);

  // Analyze buy wall strength
  const buyWallAnalysis = await analyzeBuyWall(symbol, highestBid);
  console.log(`   💰 Buy wall liquidity: ${buyWallAnalysis.totalLiquidity.toFixed(4)} HIVE`);

  // Check if buy wall is strong enough to sell into
  if (buyWallAnalysis.totalLiquidity < CONFIG.MIN_BUY_WALL_LIQUIDITY) {
    console.log(`   ⏳ Buy wall too weak (need ${CONFIG.MIN_BUY_WALL_LIQUIDITY}+ HIVE)`);
    return false;
  }

  // Strong buy wall - SELL!
  console.log(`   ✅ Strong buy wall detected! Selling to top buy order`);
  const result = await executeSellToTopBuyOrder(symbol, balance);

  if (result.success && !result.dryRun) {
    recordTrade({
      type: 'WALLET_SALE',
      symbol,
      quantity: balance,
      price: result.price,
      hiveReceived: result.hiveReceived,
      reason: 'Strong buy wall - seed capital liquidation'
    });
  }

  return result.success;
}

// ========================================
// PROFIT OPPORTUNITY SCANNING
// ========================================

async function findProfitOpportunity() {
  console.log(`\n🔎 Scanning market for profit opportunities...`);

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

  const allMetrics = metricsResult.result || [];

  // Filter for tradeable tokens
  const candidates = allMetrics
    .filter(m => {
      const volume = parseFloat(m.volume || 0);
      const price = parseFloat(m.lastPrice || 0);
      return volume >= CONFIG.MIN_VOLUME_24H && price > 0;
    })
    .filter(m => m.symbol !== 'SWAP.HIVE')
    .filter(m => m.symbol !== 'VKBT' && m.symbol !== 'CURE') // Don't buy VKBT/CURE (separate strategy)
    .slice(0, 20);

  console.log(`   📊 Evaluating ${candidates.length} candidates...`);

  let bestOpportunity = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const symbol = candidate.symbol;
    const currentPrice = parseFloat(candidate.lastPrice);
    const highestBid = parseFloat(candidate.highestBid);
    const lowestAsk = parseFloat(candidate.lowestAsk);
    const volume24h = parseFloat(candidate.volume);

    if (!highestBid || !lowestAsk) continue;

    // Calculate spread
    const spreadPercent = ((lowestAsk - highestBid) / highestBid) * 100;

    // Tight spread = good liquidity = profit opportunity
    if (spreadPercent > 5) continue; // Skip wide spreads

    // Analyze buy wall (can we exit profitably?)
    const profitTargetPrice = currentPrice * 1.05; // 5% profit target
    const buyWallAnalysis = await analyzeBuyWall(symbol, profitTargetPrice);

    if (!buyWallAnalysis.hasLiquidity) continue;
    if (buyWallAnalysis.totalLiquidity < 5) continue; // Need 5+ HIVE exit liquidity

    // Calculate opportunity score
    let score = 0;
    score += Math.min(volume24h, 100); // Volume (max 100 points)
    score += Math.max(0, 20 - spreadPercent) * 2; // Tight spread (max 40 points)
    score += Math.min(buyWallAnalysis.totalLiquidity, 50); // Buy wall strength (max 50 points)

    console.log(`   ${symbol}: Score ${score.toFixed(0)} | Spread ${spreadPercent.toFixed(2)}% | Buy wall ${buyWallAnalysis.totalLiquidity.toFixed(2)} HIVE`);

    if (score > bestScore) {
      bestScore = score;
      bestOpportunity = {
        symbol,
        currentPrice,
        entryPrice: lowestAsk,
        targetPrice: profitTargetPrice,
        spreadPercent,
        buyWallLiquidity: buyWallAnalysis.totalLiquidity,
        score
      };
    }
  }

  return bestOpportunity;
}

async function executeProfitTrade(opportunity) {
  console.log(`\n🚨 PROFIT OPPORTUNITY: ${opportunity.symbol}`);
  console.log(`   📊 Entry: ${opportunity.entryPrice.toFixed(8)} HIVE`);
  console.log(`   🎯 Target: ${opportunity.targetPrice.toFixed(8)} HIVE (5% profit)`);
  console.log(`   💰 Buy wall: ${opportunity.buyWallLiquidity.toFixed(4)} HIVE`);
  console.log(`   📈 Spread: ${opportunity.spreadPercent.toFixed(2)}%`);
  console.log(`   ⭐ Score: ${opportunity.score.toFixed(0)}/190`);

  // Get available HIVE
  const availableHIVE = getAccountBalance(CONFIG.ACCOUNT, 'SWAP.HIVE');
  console.log(`   💵 Available: ${availableHIVE.toFixed(4)} SWAP.HIVE`);

  if (availableHIVE < 0.01) {
    console.log(`   ❌ Insufficient HIVE balance`);
    return false;
  }

  // Calculate trade size (20% of available HIVE)
  const tradeSize = availableHIVE * (CONFIG.BUY_CAPITAL_ALLOCATION / 100);
  const quantity = tradeSize / opportunity.entryPrice;

  console.log(`   💰 Trade size: ${tradeSize.toFixed(4)} HIVE (${CONFIG.BUY_CAPITAL_ALLOCATION}% allocation)`);
  console.log(`   📦 Quantity: ${quantity.toFixed(8)} ${opportunity.symbol}`);

  const result = await executeBuy(opportunity.symbol, quantity, opportunity.entryPrice);

  if (result.success && !result.dryRun) {
    recordTrade({
      type: 'PROFIT_BUY',
      symbol: opportunity.symbol,
      quantity: quantity,
      price: opportunity.entryPrice,
      hiveSpent: result.hiveSpent,
      targetPrice: opportunity.targetPrice,
      reason: 'Profit opportunity purchase'
    });
  }

  return result.success;
}

// ========================================
// TRADE RECORDING
// ========================================

function recordTrade(trade) {
  trade.timestamp = new Date().toISOString();

  tradingHistory.trades.push(trade);
  tradingHistory.totalTrades++;

  if (trade.hiveReceived) {
    tradingHistory.totalSalesHIVE += trade.hiveReceived;
  }
  if (trade.hiveSpent) {
    tradingHistory.totalPurchasesHIVE += trade.hiveSpent;
  }

  // Calculate net profit
  tradingHistory.totalProfitHIVE = tradingHistory.totalSalesHIVE - tradingHistory.totalPurchasesHIVE;

  saveHistory();
}

function saveHistory() {
  fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(tradingHistory, null, 2));
}

// ========================================
// MAIN TRADING CYCLE
// ========================================

async function runTradingCycle() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🤖 PROFIT TRADING CYCLE - ${new Date().toLocaleString()}`);
  console.log('='.repeat(80));

  try {
    // STEP 1: Get ALL wallet token balances
    console.log(`\n📊 STEP 1: Reading wallet for seed capital...`);
    const allBalances = getAllWalletBalances(CONFIG.ACCOUNT);

    const walletTokens = allBalances
      .filter(b => parseFloat(b.balance) > 0)
      .filter(b => b.symbol !== 'SWAP.HIVE') // Don't sell HIVE itself
      .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));

    console.log(`   Found ${walletTokens.length} tokens in wallet`);

    // STEP 2: Process wallet tokens (sell when buy walls are strong)
    console.log(`\n💰 STEP 2: Processing wallet tokens (seed capital liquidation)...`);

    let soldCount = 0;
    for (const token of walletTokens) {
      const balance = parseFloat(token.balance);
      const sold = await processWalletToken(token.symbol, balance);
      if (sold) soldCount++;

      // Don't spam the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`   ✅ Sold ${soldCount}/${walletTokens.length} wallet tokens`);

    // STEP 3: Find and execute profit opportunities
    console.log(`\n🎯 STEP 3: Looking for profit opportunities...`);

    const opportunity = await findProfitOpportunity();

    if (opportunity) {
      await executeProfitTrade(opportunity);
    } else {
      console.log(`   ⏳ No strong opportunities right now`);
    }

    // STEP 4: Report status
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 STATUS REPORT`);
    console.log('='.repeat(80));
    console.log(`Total trades: ${tradingHistory.totalTrades}`);
    console.log(`Total HIVE from sales: ${tradingHistory.totalSalesHIVE.toFixed(4)} HIVE`);
    console.log(`Total HIVE spent: ${tradingHistory.totalPurchasesHIVE.toFixed(4)} HIVE`);
    console.log(`Net profit: ${tradingHistory.totalProfitHIVE >= 0 ? '✅ +' : '❌ '}${tradingHistory.totalProfitHIVE.toFixed(4)} HIVE`);

    const currentHIVE = getAccountBalance(CONFIG.ACCOUNT, 'SWAP.HIVE');
    console.log(`Current HIVE balance: ${currentHIVE.toFixed(4)} SWAP.HIVE`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error(`❌ Error in trading cycle:`, error);
  }
}

// ========================================
// MAIN
// ========================================

async function main() {
  console.log('🤖 PROFIT TRADING BOT Starting...');
  console.log('='.repeat(80));
  console.log(`📊 Account: ${CONFIG.ACCOUNT}`);
  console.log(`${CONFIG.DRY_RUN ? '🧪 DRY RUN MODE' : '🔴 LIVE TRADING MODE'}`);
  console.log(`\n💡 STRATEGY:`);
  console.log(`   1. Read ALL wallet tokens (seed capital)`);
  console.log(`   2. Sell wallet tokens when buy walls are strong`);
  console.log(`   3. Use HIVE from sales to buy profit opportunities`);
  console.log(`   4. Repeat cycle to accumulate HIVE`);
  console.log(`\n⚙️ SETTINGS:`);
  console.log(`   BLURT: ${CONFIG.SELL_BLURT_IMMEDIATELY ? 'Sell as fuel ⛽' : 'Normal strategy'}`);
  console.log(`   VKBT/CURE: Sell at ${CONFIG.VKBT_CURE_TARGET_PRICE} HIVE (1:1 parity)`);
  console.log(`   Buy wall threshold: ${CONFIG.MIN_BUY_WALL_LIQUIDITY}+ HIVE`);
  console.log(`   Trade size: ${CONFIG.BUY_CAPITAL_ALLOCATION}% of available HIVE`);
  console.log(`   Scan interval: ${CONFIG.SCAN_INTERVAL / 1000}s`);
  console.log('='.repeat(80));

  // Run first cycle
  await runTradingCycle();

  // Schedule regular cycles
  setInterval(runTradingCycle, CONFIG.SCAN_INTERVAL);

  console.log('\n✅ Bot is running. Press Ctrl+C to stop.\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n💾 Saving data before exit...');
  saveHistory();
  console.log('✅ Data saved. Goodbye!\n');
  process.exit(0);
});

// Start
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
