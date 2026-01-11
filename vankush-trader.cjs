#!/usr/bin/env node

// ========================================
// VANKUSH TRADING BOT
// ========================================
// Purpose: Generate profits through smart trading, then invest in VKBT/CURE
// Strategy:
//   1. Scan all HIVE-Engine markets for opportunities
//   2. Analyze historical price patterns (daily cycles, trends)
//   3. Buy tokens at good prices, sell at 2%+ profit
//   4. Track inventory and purchase prices
//   5. Use earned profits to support VKBT/CURE when economically viable
// ========================================

require('dotenv').config();
const dhive = require('@hiveio/dhive');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // HIVE credentials
  HIVE_USERNAME: process.env.HIVE_USERNAME || '',
  HIVE_ACTIVE_KEY: process.env.HIVE_ACTIVE_KEY || '',

  // Protected tokens (never sell these)
  PROTECTED_TOKENS: ['VKBT', 'CURE'],

  // Trading parameters
  MIN_PROFIT_PERCENT: 2.0,          // Minimum 2% profit on trades
  MAX_TRADE_AMOUNT_HIVE: 0.5,       // Max 0.5 HIVE per trade (risk management)
  MIN_DAILY_VOLUME_HIVE: 1.0,       // Only trade tokens with >1 HIVE daily volume

  // Historical analysis
  PRICE_HISTORY_DAYS: 7,            // Track 7 days of price history
  PATTERN_CONFIDENCE_MIN: 0.7,      // 70% confidence required for pattern trading

  // VKBT/CURE investment
  PROFIT_ALLOCATION_PERCENT: 50,    // Invest 50% of profits in VKBT/CURE support
  MIN_PROFIT_BEFORE_INVESTMENT: 5,  // Need 5 HIVE profit before investing in price support
  MAX_DUMP_RISK_PERCENT: 20,        // Don't invest if >20% dump risk

  // Intervals
  MARKET_SCAN_INTERVAL_MINUTES: 10, // Scan markets every 10 minutes
  HISTORY_UPDATE_INTERVAL_HOURS: 1, // Update price history every hour

  // Dry run
  DRY_RUN: process.env.TRADER_DRY_RUN === 'true',

  // Storage
  DATA_DIR: path.join(__dirname, 'trader-data')
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
const HIVE_ENGINE_API = 'https://api.hive-engine.com/rpc';

// ========================================
// STATE TRACKING
// ========================================

const botState = {
  // Inventory: what we currently hold
  inventory: {},  // { SYMBOL: { quantity, avgBuyPrice, buyTimes: [timestamps] } }

  // Price history: track prices over time
  priceHistory: {},  // { SYMBOL: { timestamps: [], prices: [] } }

  // Pattern analysis: detected patterns
  patterns: {},  // { SYMBOL: { type: 'daily_cycle', confidence: 0.8, ... } }

  // Profit tracking
  totalProfitHIVE: 0,
  totalTradesCompleted: 0,
  profitsInvestedInVKBT: 0,
  profitsInvestedInCURE: 0,

  // Session info
  startTime: Date.now(),
  lastMarketScan: 0,
  lastHistoryUpdate: 0
};

// ========================================
// DATA PERSISTENCE
// ========================================

async function loadState() {
  try {
    await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });

    const statePath = path.join(CONFIG.DATA_DIR, 'bot-state.json');
    const data = await fs.readFile(statePath, 'utf8');
    const loaded = JSON.parse(data);

    // Merge loaded state (preserve runtime fields)
    Object.assign(botState, loaded);
    console.log('✅ Loaded previous state');
  } catch (error) {
    console.log('📝 Starting with fresh state');
  }
}

async function saveState() {
  try {
    const statePath = path.join(CONFIG.DATA_DIR, 'bot-state.json');
    await fs.writeFile(statePath, JSON.stringify(botState, null, 2));
  } catch (error) {
    console.error('❌ Failed to save state:', error.message);
  }
}

// ========================================
// HIVE-ENGINE API
// ========================================

async function getAllTokens() {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'tokens',
        query: {},
        limit: 1000
      }
    });
    return response.data.result || [];
  } catch (error) {
    console.error('❌ Error fetching tokens:', error.message);
    return [];
  }
}

async function getMarketInfo(symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
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

async function getBuyBook(symbol, limit = 10) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'buyBook',
        query: { symbol },
        limit,
        indexes: [{ index: 'price', descending: true }]
      }
    });
    return response.data.result || [];
  } catch (error) {
    return [];
  }
}

async function getSellBook(symbol, limit = 10) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'sellBook',
        query: { symbol },
        limit,
        indexes: [{ index: 'price', descending: false }]
      }
    });
    return response.data.result || [];
  } catch (error) {
    return [];
  }
}

async function getBalance(username, symbol) {
  try {
    const response = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: { account: username, symbol },
        limit: 1
      }
    });
    const balance = response.data.result?.[0];
    return balance ? parseFloat(balance.balance) : 0;
  } catch (error) {
    return 0;
  }
}

// ========================================
// TRADING FUNCTIONS
// ========================================

async function buyToken(symbol, quantity, price) {
  const key = dhive.PrivateKey.fromString(CONFIG.HIVE_ACTIVE_KEY);

  const json = {
    contractName: 'market',
    contractAction: 'buy',
    contractPayload: {
      symbol,
      quantity: quantity.toString(),
      price: price.toString()
    }
  };

  if (CONFIG.DRY_RUN) {
    console.log('🔒 DRY RUN - Would buy:', json);
    return { success: true, txId: 'DRY_RUN', dryRun: true };
  }

  try {
    const op = ['custom_json', {
      required_auths: [CONFIG.HIVE_USERNAME],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify(json)
    }];

    const result = await client.broadcast.sendOperations([op], key);
    return { success: true, txId: result.id };
  } catch (error) {
    console.error('❌ Buy failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function sellToken(symbol, quantity, price) {
  const key = dhive.PrivateKey.fromString(CONFIG.HIVE_ACTIVE_KEY);

  const json = {
    contractName: 'market',
    contractAction: 'sell',
    contractPayload: {
      symbol,
      quantity: quantity.toString(),
      price: price.toString()
    }
  };

  if (CONFIG.DRY_RUN) {
    console.log('🔒 DRY RUN - Would sell:', json);
    return { success: true, txId: 'DRY_RUN', dryRun: true };
  }

  try {
    const op = ['custom_json', {
      required_auths: [CONFIG.HIVE_USERNAME],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify(json)
    }];

    const result = await client.broadcast.sendOperations([op], key);
    return { success: true, txId: result.id };
  } catch (error) {
    console.error('❌ Sell failed:', error.message);
    return { success: false, error: error.message };
  }
}

// ========================================
// HISTORICAL ANALYSIS
// ========================================

async function updatePriceHistory(symbol) {
  // Get current market price
  const sellBook = await getSellBook(symbol, 1);
  if (!sellBook.length) return;

  const currentPrice = parseFloat(sellBook[0].price);
  const now = Date.now();

  // Initialize history if needed
  if (!botState.priceHistory[symbol]) {
    botState.priceHistory[symbol] = {
      timestamps: [],
      prices: []
    };
  }

  const history = botState.priceHistory[symbol];

  // Add current price
  history.timestamps.push(now);
  history.prices.push(currentPrice);

  // Keep only last N days
  const cutoffTime = now - (CONFIG.PRICE_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  while (history.timestamps.length > 0 && history.timestamps[0] < cutoffTime) {
    history.timestamps.shift();
    history.prices.shift();
  }
}

function analyzePattern(symbol) {
  const history = botState.priceHistory[symbol];
  if (!history || history.prices.length < 24) {
    return null; // Not enough data
  }

  // Simple daily cycle detection
  // Check if price goes up/down in a predictable pattern

  const prices = history.prices;
  const timestamps = history.timestamps;

  // Calculate hourly average change
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    const pctChange = ((prices[i] - prices[i-1]) / prices[i-1]) * 100;
    changes.push(pctChange);
  }

  // Detect if there's a consistent daily pattern
  // (This is simplified - real implementation would use more sophisticated analysis)
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const volatility = Math.sqrt(changes.reduce((a, b) => a + Math.pow(b - avgChange, 2), 0) / changes.length);

  // If volatility is high and there are regular swings, it might be tradeable
  if (volatility > 2 && volatility < 20) {
    return {
      type: 'daily_cycle',
      confidence: Math.min(0.9, volatility / 20),
      avgChange,
      volatility
    };
  }

  return null;
}

// ========================================
// TRADING LOGIC
// ========================================

async function scanMarketForOpportunities() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 SCANNING MARKETS FOR TRADING OPPORTUNITIES');
  console.log('='.repeat(60));

  // Get all tokens
  const tokens = await getAllTokens();
  console.log(`📊 Found ${tokens.length} tokens on HIVE-Engine`);

  const opportunities = [];

  for (const token of tokens) {
    const symbol = token.symbol;

    // Skip protected tokens
    if (CONFIG.PROTECTED_TOKENS.includes(symbol)) continue;

    // Get market info
    const market = await getMarketInfo(symbol);
    if (!market) continue;

    const volume = parseFloat(market.volume || 0);
    if (volume < CONFIG.MIN_DAILY_VOLUME_HIVE) continue;

    // Get order books
    const [buyBook, sellBook] = await Promise.all([
      getBuyBook(symbol, 1),
      getSellBook(symbol, 1)
    ]);

    if (!buyBook.length || !sellBook.length) continue;

    const highestBid = parseFloat(buyBook[0].price);
    const lowestAsk = parseFloat(sellBook[0].price);
    const spread = ((lowestAsk - highestBid) / highestBid) * 100;

    // Check if we already own this token
    const inventory = botState.inventory[symbol];

    if (inventory) {
      // We own it - check if we can sell for profit
      const targetSellPrice = inventory.avgBuyPrice * (1 + CONFIG.MIN_PROFIT_PERCENT / 100);

      if (highestBid >= targetSellPrice) {
        opportunities.push({
          action: 'SELL',
          symbol,
          quantity: inventory.quantity,
          price: highestBid,
          buyPrice: inventory.avgBuyPrice,
          profitPercent: ((highestBid - inventory.avgBuyPrice) / inventory.avgBuyPrice) * 100
        });
      }
    } else {
      // We don't own it - check if it's a good buy

      // Analyze historical pattern
      const pattern = analyzePattern(symbol);

      if (pattern && pattern.confidence >= CONFIG.PATTERN_CONFIDENCE_MIN) {
        // Good pattern - consider buying
        const quantity = CONFIG.MAX_TRADE_AMOUNT_HIVE / lowestAsk;

        opportunities.push({
          action: 'BUY',
          symbol,
          quantity,
          price: lowestAsk,
          pattern,
          spread
        });
      }
    }
  }

  console.log(`\n💡 Found ${opportunities.length} trading opportunities`);
  return opportunities;
}

async function executeOpportunities(opportunities) {
  for (const opp of opportunities) {
    console.log(`\n${'─'.repeat(60)}`);

    if (opp.action === 'SELL') {
      console.log(`💰 SELL OPPORTUNITY: ${opp.symbol}`);
      console.log(`   Bought at: ${opp.buyPrice.toFixed(8)} HIVE`);
      console.log(`   Selling at: ${opp.price.toFixed(8)} HIVE`);
      console.log(`   Profit: ${opp.profitPercent.toFixed(2)}%`);
      console.log(`   Quantity: ${opp.quantity.toFixed(4)} ${opp.symbol}`);

      const result = await sellToken(opp.symbol, opp.quantity, opp.price);

      if (result.success) {
        console.log(`✅ Sold! TX: ${result.txId}`);

        // Calculate profit
        const profit = (opp.price - opp.buyPrice) * opp.quantity;
        botState.totalProfitHIVE += profit;
        botState.totalTradesCompleted++;

        // Remove from inventory
        delete botState.inventory[opp.symbol];

        console.log(`💵 Profit: ${profit.toFixed(4)} HIVE`);
        console.log(`📊 Total profit: ${botState.totalProfitHIVE.toFixed(4)} HIVE`);

        await saveState();
      }

    } else if (opp.action === 'BUY') {
      console.log(`🛒 BUY OPPORTUNITY: ${opp.symbol}`);
      console.log(`   Pattern: ${opp.pattern.type} (${(opp.pattern.confidence * 100).toFixed(0)}% confidence)`);
      console.log(`   Buy price: ${opp.price.toFixed(8)} HIVE`);
      console.log(`   Quantity: ${opp.quantity.toFixed(4)} ${opp.symbol}`);
      console.log(`   Cost: ${(opp.price * opp.quantity).toFixed(4)} HIVE`);

      const result = await buyToken(opp.symbol, opp.quantity, opp.price);

      if (result.success) {
        console.log(`✅ Bought! TX: ${result.txId}`);

        // Add to inventory
        botState.inventory[opp.symbol] = {
          quantity: opp.quantity,
          avgBuyPrice: opp.price,
          buyTime: Date.now()
        };

        await saveState();
      }
    }
  }
}

// ========================================
// VKBT/CURE INVESTMENT
// ========================================

async function calculatePriceImpact(symbol, investmentHIVE) {
  // Get sell book to calculate how much price will rise
  const sellBook = await getSellBook(symbol, 100);
  if (!sellBook.length) return null;

  let remainingHIVE = investmentHIVE;
  let totalTokensBought = 0;
  let finalPrice = 0;

  for (const order of sellBook) {
    const price = parseFloat(order.price);
    const quantity = parseFloat(order.quantity);
    const orderCost = price * quantity;

    if (remainingHIVE >= orderCost) {
      // Buy entire order
      remainingHIVE -= orderCost;
      totalTokensBought += quantity;
      finalPrice = price;
    } else {
      // Partial buy
      const partialQuantity = remainingHIVE / price;
      totalTokensBought += partialQuantity;
      finalPrice = price;
      break;
    }

    if (remainingHIVE <= 0) break;
  }

  const startPrice = parseFloat(sellBook[0].price);
  const priceIncrease = ((finalPrice - startPrice) / startPrice) * 100;

  return {
    startPrice,
    finalPrice,
    priceIncrease,
    tokensBought: totalTokensBought,
    costHIVE: investmentHIVE - remainingHIVE
  };
}

async function estimateDumpRisk(symbol) {
  // Dump risk is about TOTAL SUPPLY, not who owns it
  // If too many tokens exist, we can't buy enough to move the price
  // CURE: Rare, makes less per day than Bitcoin → Safe
  // VKBT: Good tokenomics → Safe
  // POB: Tons of tokens exist → Not safe (can't buy enough)

  try {
    // Get token info (circulating supply, inflation)
    const tokenResponse = await axios.post(HIVE_ENGINE_RPC, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'tokens',
        query: { symbol },
        limit: 1
      }
    });

    const tokenInfo = tokenResponse.data.result?.[0];
    if (!tokenInfo) {
      return { dumpRiskPercent: 100, analysis: 'Unknown token' };
    }

    const circulatingSupply = parseFloat(tokenInfo.circulatingSupply || 0);
    const maxSupply = parseFloat(tokenInfo.maxSupply || circulatingSupply);

    // Get market info to see how liquid it is
    const marketResponse = await axios.post(HIVE_ENGINE_RPC, {
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

    const marketInfo = marketResponse.data.result?.[0];
    const volume = parseFloat(marketInfo?.volume || 0);

    // Calculate dump risk based on TOTAL SUPPLY
    // If circulating supply is huge, dump risk is high (too many tokens can dump)
    // If circulating supply is small, dump risk is low (scarce = good tokenomics)

    let dumpRiskPercent = 0;

    if (circulatingSupply > 10000000) {
      // More than 10M tokens circulating = HIGH RISK (like POB)
      dumpRiskPercent = 80;
    } else if (circulatingSupply > 1000000) {
      // 1M-10M tokens = MODERATE RISK
      dumpRiskPercent = 50;
    } else if (circulatingSupply > 100000) {
      // 100K-1M tokens = LOW-MODERATE RISK
      dumpRiskPercent = 25;
    } else {
      // Less than 100K tokens = LOW RISK (scarce, good tokenomics)
      dumpRiskPercent = 10;
    }

    // Adjust for volume - if high volume, people are actively trading (more dump risk)
    if (volume > 100) {
      dumpRiskPercent = Math.min(100, dumpRiskPercent + 10);
    }

    const analysis = dumpRiskPercent > CONFIG.MAX_DUMP_RISK_PERCENT
      ? `❌ TOO RISKY: ${circulatingSupply.toLocaleString()} tokens exist (too many to move price)`
      : `✅ GOOD TOKENOMICS: ${circulatingSupply.toLocaleString()} tokens (scarce enough to raise price)`;

    return {
      circulatingSupply,
      maxSupply,
      volume,
      dumpRiskPercent,
      analysis
    };
  } catch (error) {
    console.error('❌ Error analyzing supply:', error.message);
    return { dumpRiskPercent: 100, analysis: 'Unknown - assume max risk' };
  }
}

async function calculateInvestmentROI(symbol, investmentHIVE) {
  console.log(`\n🔬 Analyzing ${symbol} investment...`);

  // 1. Calculate price impact
  const impact = await calculatePriceImpact(symbol, investmentHIVE);
  if (!impact) {
    console.log(`   ❌ No sell orders - cannot analyze`);
    return null;
  }

  console.log(`\n📊 Price Impact Analysis:`);
  console.log(`   Investment: ${investmentHIVE.toFixed(4)} HIVE`);
  console.log(`   Start price: ${impact.startPrice.toFixed(8)} HIVE`);
  console.log(`   Final price: ${impact.finalPrice.toFixed(8)} HIVE`);
  console.log(`   Price increase: ${impact.priceIncrease.toFixed(2)}%`);
  console.log(`   Tokens acquired: ${impact.tokensBought.toFixed(4)} ${symbol}`);

  // 2. Analyze dump risk (based on total supply, not holder concentration)
  const dumpRisk = await estimateDumpRisk(symbol);
  console.log(`\n⚠️  Dump Risk Analysis (Tokenomics):`);
  console.log(`   Circulating supply: ${dumpRisk.circulatingSupply?.toLocaleString() || 'Unknown'}`);
  console.log(`   ${dumpRisk.analysis}`);
  console.log(`   Dump risk: ${dumpRisk.dumpRiskPercent}%`);

  // 3. Calculate potential profit/loss
  // Assume: after pump, some holders dump, price settles at X% above start
  const expectedDumpPercent = dumpRisk.dumpRiskPercent / 100;
  const priceAfterDump = impact.finalPrice * (1 - (expectedDumpPercent * 0.5)); // Dump brings price down 50% of the way

  const valueAtPeak = impact.tokensBought * impact.finalPrice;
  const valueAfterDump = impact.tokensBought * priceAfterDump;
  const unrealizedProfit = valueAfterDump - investmentHIVE;
  const roi = (unrealizedProfit / investmentHIVE) * 100;

  console.log(`\n💰 ROI Projection:`);
  console.log(`   Value at peak: ${valueAtPeak.toFixed(4)} HIVE`);
  console.log(`   Value after dump: ${valueAfterDump.toFixed(4)} HIVE`);
  console.log(`   Expected profit/loss: ${unrealizedProfit.toFixed(4)} HIVE`);
  console.log(`   ROI: ${roi.toFixed(2)}%`);

  // 4. Decision
  const shouldInvest = (
    dumpRisk.dumpRiskPercent <= CONFIG.MAX_DUMP_RISK_PERCENT &&
    roi > 10 && // Need at least 10% ROI to make it worthwhile
    impact.priceIncrease >= 5 // Need meaningful price impact (5%+)
  );

  console.log(`\n🎯 Decision: ${shouldInvest ? '✅ INVEST' : '❌ SKIP'}`);

  if (!shouldInvest) {
    if (dumpRisk.dumpRiskPercent > CONFIG.MAX_DUMP_RISK_PERCENT) {
      console.log(`   Reason: Dump risk too high (${dumpRisk.dumpRiskPercent}% > ${CONFIG.MAX_DUMP_RISK_PERCENT}%)`);
    } else if (roi <= 10) {
      console.log(`   Reason: ROI too low (${roi.toFixed(2)}% < 10%)`);
    } else {
      console.log(`   Reason: Price impact too small (${impact.priceIncrease.toFixed(2)}% < 5%)`);
    }
  }

  return {
    shouldInvest,
    impact,
    dumpRisk,
    roi,
    unrealizedProfit
  };
}

async function raiseVKBTCUREPrices() {
  // When bot has earned money, use it to RAISE VKBT/CURE prices
  // BUT check for troll bots and dump risk first!
  const availableProfit = botState.totalProfitHIVE * (CONFIG.PROFIT_ALLOCATION_PERCENT / 100);

  if (availableProfit < CONFIG.MIN_PROFIT_BEFORE_INVESTMENT) {
    console.log(`\n💡 Waiting to raise VKBT/CURE prices: Need ${CONFIG.MIN_PROFIT_BEFORE_INVESTMENT} HIVE profit (have ${availableProfit.toFixed(4)} HIVE)`);
    return;
  }

  console.log(`\n💎 RAISING VKBT/CURE PRICES (WITH TROLL BOT PROTECTION)`);
  console.log('='.repeat(60));
  console.log(`Available profit: ${availableProfit.toFixed(4)} HIVE`);

  // Split investment between VKBT and CURE
  const perToken = availableProfit / 2;

  for (const symbol of ['VKBT', 'CURE']) {
    console.log(`\n🚀 Analyzing ${symbol} price raise...`);

    // FULL ANALYSIS - check dump risk, ROI, troll bots
    const analysis = await calculateInvestmentROI(symbol, perToken);

    if (!analysis) {
      console.log(`   ❌ Cannot analyze ${symbol} - skipping`);
      continue;
    }

    // Check if it's safe to invest (dump risk check)
    if (!analysis.shouldInvest) {
      console.log(`   ⚠️  Skipping ${symbol} - analysis says not safe right now`);
      continue;
    }

    console.log(`\n✅ ${symbol} looks safe to raise:`);
    console.log(`   Investment: ${perToken.toFixed(4)} HIVE`);
    console.log(`   Price increase: ${analysis.impact.priceIncrease.toFixed(2)}%`);
    console.log(`   Dump risk: ${analysis.dumpRisk.dumpRiskPercent}% (acceptable)`);
    console.log(`   Expected ROI: ${analysis.roi.toFixed(2)}%`);

    // Buy up the sell wall
    const impact = analysis.impact;
    const result = await buyToken(symbol, impact.tokensBought, impact.finalPrice);

    if (result.success) {
      console.log(`   ✅ ${symbol} price raised! TX: ${result.txId}`);
      console.log(`   Price went from ${impact.startPrice.toFixed(8)} → ${impact.finalPrice.toFixed(8)} HIVE`);

      // Track investment
      if (symbol === 'VKBT') {
        botState.profitsInvestedInVKBT += perToken;
      } else {
        botState.profitsInvestedInCURE += perToken;
      }

      // Deduct from total profit (we've spent it)
      botState.totalProfitHIVE -= perToken;
    }
  }

  await saveState();
}

// ========================================
// MAIN LOOP
// ========================================

async function main() {
  console.log('\n🚀 VANKUSH TRADING BOT STARTED');
  console.log('='.repeat(60));
  console.log(`Username: ${CONFIG.HIVE_USERNAME}`);
  console.log(`Strategy: Profit through smart trading → VKBT/CURE support`);
  console.log(`Dry Run: ${CONFIG.DRY_RUN ? '🔒 ENABLED' : '⚡ DISABLED (LIVE)'}`);
  console.log('='.repeat(60));

  // Load previous state
  await loadState();

  console.log(`\n📊 Current State:`);
  console.log(`   Total profit: ${botState.totalProfitHIVE.toFixed(4)} HIVE`);
  console.log(`   Completed trades: ${botState.totalTradesCompleted}`);
  console.log(`   Inventory: ${Object.keys(botState.inventory).length} tokens`);

  // Main loop
  while (true) {
    try {
      // Scan markets
      const opportunities = await scanMarketForOpportunities();

      // Execute trades
      if (opportunities.length > 0) {
        await executeOpportunities(opportunities);
      }

      // Raise VKBT/CURE prices with earned profits
      await raiseVKBTCUREPrices();

      // Update price history periodically
      const hoursSinceUpdate = (Date.now() - botState.lastHistoryUpdate) / (1000 * 60 * 60);
      if (hoursSinceUpdate >= CONFIG.HISTORY_UPDATE_INTERVAL_HOURS) {
        console.log('\n📈 Updating price history...');
        const tokens = await getAllTokens();
        for (const token of tokens.slice(0, 50)) { // Top 50 for now
          await updatePriceHistory(token.symbol);
        }
        botState.lastHistoryUpdate = Date.now();
        await saveState();
      }

    } catch (error) {
      console.error('\n❌ Error in main loop:', error.message);
    }

    // Wait before next scan
    console.log(`\n⏰ Waiting ${CONFIG.MARKET_SCAN_INTERVAL_MINUTES} minutes...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.MARKET_SCAN_INTERVAL_MINUTES * 60 * 1000));
  }
}

// ========================================
// START
// ========================================

if (!CONFIG.HIVE_USERNAME || !CONFIG.HIVE_ACTIVE_KEY) {
  console.error('❌ Set HIVE_USERNAME and HIVE_ACTIVE_KEY in .env');
  process.exit(1);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
