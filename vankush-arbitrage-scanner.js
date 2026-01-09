// ========================================
// VAN KUSH ARBITRAGE SCANNER BOT
// ========================================
// Purpose: Detect arbitrage opportunities between HIVE-Engine and external exchanges
// Phase 3 of Van Kush trading strategy (see TRADING_STRATEGY.md)
// Author: Claude Code
// Date: 2026-01-09

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // Target Swap.* tokens on HIVE-Engine
  SWAP_TOKENS: [
    { symbol: 'SWAP.BTC', coinGeckoId: 'bitcoin', minProfit: 3 },
    { symbol: 'SWAP.ETH', coinGeckoId: 'ethereum', minProfit: 3 },
    { symbol: 'SWAP.DOGE', coinGeckoId: 'dogecoin', minProfit: 5 },
    { symbol: 'SWAP.LTC', coinGeckoId: 'litecoin', minProfit: 5 },
    { symbol: 'SWAP.STEEM', coinGeckoId: 'steem', minProfit: 5 }
  ],

  // API endpoints
  HIVE_ENGINE_API: 'https://engine.rishipanthee.com',
  COINGECKO_API: 'https://api.coingecko.com/api/v3',
  BINANCE_API: 'https://api.binance.com/api/v3',

  // Scan interval (2 minutes)
  SCAN_INTERVAL: 120000,

  // Fee estimates (adjust based on your experience)
  FEES: {
    hiveEngineTrading: 0.0025,  // 0.25% trading fee
    withdrawal: 0.01,            // ~1% withdrawal fees (varies by token)
    externalExchange: 0.001,     // 0.1% on Binance/Coinbase
    slippage: 0.005              // 0.5% slippage buffer
  },

  // Calculate total fee percentage
  get totalFees() {
    return this.FEES.hiveEngineTrading +
           this.FEES.withdrawal +
           this.FEES.externalExchange +
           this.FEES.slippage;
  },

  // Minimum trade size in USD
  MIN_TRADE_SIZE: 100,

  // Historical opportunities file
  HISTORY_FILE: 'vankush-arbitrage-history.json',

  // Discord webhook (optional)
  DISCORD_WEBHOOK: process.env.HIVE_DISCORD_WEBHOOK || null,

  // Alert only mode (no auto-trading)
  ALERT_ONLY: true
};

// ========================================
// DATA STORAGE
// ========================================

let arbitrageHistory = {
  startTime: new Date().toISOString(),
  scans: 0,
  opportunitiesFound: 0,
  opportunities: []
};

// Load existing history
if (fs.existsSync(CONFIG.HISTORY_FILE)) {
  try {
    arbitrageHistory = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8'));
    console.log('📊 Loaded arbitrage history');
    console.log(`   Started: ${arbitrageHistory.startTime}`);
    console.log(`   Total scans: ${arbitrageHistory.scans}`);
    console.log(`   Opportunities found: ${arbitrageHistory.opportunitiesFound}`);
  } catch (error) {
    console.error('⚠️  Could not load history, starting fresh:', error.message);
  }
}

// ========================================
// HIVE-ENGINE API
// ========================================

async function getHiveEnginePrice(symbol) {
  try {
    const response = await axios.post(`${CONFIG.HIVE_ENGINE_API}/contracts`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'findOne',
      params: {
        contract: 'market',
        table: 'metrics',
        query: { symbol: symbol }
      }
    });

    if (response.data && response.data.result) {
      const metrics = response.data.result;
      return {
        lastPrice: parseFloat(metrics.lastPrice),      // Price in SWAP.HIVE
        volume24h: parseFloat(metrics.volume || 0),
        highestBid: parseFloat(metrics.highestBid || 0),
        lowestAsk: parseFloat(metrics.lowestAsk || 0),
        priceChangePercent: parseFloat(metrics.priceChangePercent || 0)
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching HIVE-Engine price for ${symbol}:`, error.message);
    return null;
  }
}

async function getHivePrice() {
  try {
    const response = await axios.get(`${CONFIG.COINGECKO_API}/simple/price`, {
      params: {
        ids: 'hive',
        vs_currencies: 'usd'
      }
    });

    if (response.data && response.data.hive) {
      return response.data.hive.usd;
    }
    return null;
  } catch (error) {
    console.error('Error fetching HIVE price:', error.message);
    return null;
  }
}

// ========================================
// EXTERNAL EXCHANGE APIS
// ========================================

async function getCoinGeckoPrices(ids) {
  try {
    const response = await axios.get(`${CONFIG.COINGECKO_API}/simple/price`, {
      params: {
        ids: ids.join(','),
        vs_currencies: 'usd',
        include_24hr_change: true,
        include_24hr_vol: true
      }
    });

    return response.data || {};
  } catch (error) {
    console.error('Error fetching CoinGecko prices:', error.message);
    return {};
  }
}

async function getBinancePrice(symbol) {
  try {
    // Binance uses different symbol format (BTCUSDT, ETHUSDT, etc.)
    const binanceSymbol = symbol.replace('SWAP.', '') + 'USDT';

    const response = await axios.get(`${CONFIG.BINANCE_API}/ticker/24hr`, {
      params: { symbol: binanceSymbol }
    });

    if (response.data) {
      return {
        price: parseFloat(response.data.lastPrice),
        change24h: parseFloat(response.data.priceChangePercent),
        volume24h: parseFloat(response.data.volume)
      };
    }
    return null;
  } catch (error) {
    // Token might not be on Binance, that's okay
    return null;
  }
}

// ========================================
// ARBITRAGE CALCULATION
// ========================================

function calculateArbitrage(swapToken, hiveEngineData, externalPrice, hiveUSD) {
  // Calculate implied USD price on HIVE-Engine
  const swapPriceInHive = hiveEngineData.lastPrice;
  const swapPriceUSD = swapPriceInHive * hiveUSD;

  // Calculate potential profit percentage
  const priceDifference = externalPrice - swapPriceUSD;
  const profitPercent = (priceDifference / swapPriceUSD) * 100;

  // Subtract fees
  const netProfitPercent = profitPercent - (CONFIG.totalFees * 100);

  // Calculate example trade (if $1000 investment)
  const exampleInvestment = 1000;
  const tokensCanBuy = exampleInvestment / swapPriceUSD;
  const valueAtExternal = tokensCanBuy * externalPrice;
  const grossProfit = valueAtExternal - exampleInvestment;
  const fees = exampleInvestment * CONFIG.totalFees;
  const netProfit = grossProfit - fees;

  return {
    symbol: swapToken.symbol,
    hiveEnginePrice: {
      inHive: swapPriceInHive,
      inUSD: swapPriceUSD
    },
    externalPrice: externalPrice,
    priceDifference: priceDifference,
    profitPercent: profitPercent,
    netProfitPercent: netProfitPercent,
    isOpportunity: netProfitPercent >= swapToken.minProfit,
    exampleTrade: {
      investment: exampleInvestment,
      tokensCanBuy: tokensCanBuy,
      grossProfit: grossProfit,
      fees: fees,
      netProfit: netProfit,
      netProfitPercent: (netProfit / exampleInvestment) * 100
    },
    metadata: {
      hiveUSD: hiveUSD,
      volume24h: hiveEngineData.volume24h,
      timestamp: new Date().toISOString()
    }
  };
}

// ========================================
// SCANNING & REPORTING
// ========================================

function formatNumber(num, decimals = 2) {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPercent(num) {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

async function scanForOpportunities() {
  arbitrageHistory.scans++;
  console.log(`\n⏰ Arbitrage Scan #${arbitrageHistory.scans} - ${new Date().toLocaleString()}`);

  try {
    // Get HIVE price
    console.log('📡 Fetching HIVE/USD price...');
    const hiveUSD = await getHivePrice();

    if (!hiveUSD) {
      console.error('❌ Could not fetch HIVE price, skipping scan');
      return;
    }

    console.log(`   HIVE: $${formatNumber(hiveUSD, 4)}`);

    // Get external prices from CoinGecko
    console.log('📡 Fetching external exchange prices...');
    const coinGeckoIds = CONFIG.SWAP_TOKENS.map(t => t.coinGeckoId);
    const externalPrices = await getCoinGeckoPrices(coinGeckoIds);

    // Scan each Swap token
    const opportunities = [];

    for (const swapToken of CONFIG.SWAP_TOKENS) {
      console.log(`\n🔍 Scanning ${swapToken.symbol}...`);

      // Get HIVE-Engine price
      const heData = await getHiveEnginePrice(swapToken.symbol);
      if (!heData) {
        console.log(`   ⚠️  No data on HIVE-Engine`);
        continue;
      }

      // Get external price (prefer Binance, fallback to CoinGecko)
      let externalPrice = null;
      const binanceData = await getBinancePrice(swapToken.symbol);

      if (binanceData) {
        externalPrice = binanceData.price;
        console.log(`   Binance: $${formatNumber(externalPrice)}`);
      } else if (externalPrices[swapToken.coinGeckoId]) {
        externalPrice = externalPrices[swapToken.coinGeckoId].usd;
        console.log(`   CoinGecko: $${formatNumber(externalPrice)}`);
      } else {
        console.log(`   ⚠️  No external price found`);
        continue;
      }

      // Calculate arbitrage
      const result = calculateArbitrage(swapToken, heData, externalPrice, hiveUSD);

      console.log(`   HIVE-Engine: ${formatNumber(result.hiveEnginePrice.inHive, 8)} HIVE ($${formatNumber(result.hiveEnginePrice.inUSD)})`);
      console.log(`   Difference: $${formatNumber(result.priceDifference)} (${formatPercent(result.profitPercent)})`);
      console.log(`   Net Profit: ${formatPercent(result.netProfitPercent)} (after ${formatPercent(CONFIG.totalFees * 100)} fees)`);

      if (result.isOpportunity) {
        console.log(`   🚨 OPPORTUNITY DETECTED! Net profit: ${formatPercent(result.netProfitPercent)}`);
        opportunities.push(result);
      } else {
        console.log(`   ✅ No opportunity (need ${swapToken.minProfit}% min)`);
      }
    }

    // Process opportunities
    if (opportunities.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log(`🚨 ${opportunities.length} ARBITRAGE OPPORTUNIT${opportunities.length > 1 ? 'IES' : 'Y'} FOUND`);
      console.log('='.repeat(60));

      for (const opp of opportunities) {
        console.log(`\n💎 ${opp.symbol}`);
        console.log(`   Buy on HIVE-Engine: $${formatNumber(opp.hiveEnginePrice.inUSD)}`);
        console.log(`   Sell on external: $${formatNumber(opp.externalPrice)}`);
        console.log(`   Net Profit: ${formatPercent(opp.netProfitPercent)}`);
        console.log(`\n   Example $${formatNumber(opp.exampleTrade.investment)} trade:`);
        console.log(`   - Buy: ${formatNumber(opp.exampleTrade.tokensCanBuy, 4)} ${opp.symbol}`);
        console.log(`   - Gross Profit: $${formatNumber(opp.exampleTrade.grossProfit)}`);
        console.log(`   - Fees: $${formatNumber(opp.exampleTrade.fees)}`);
        console.log(`   - Net Profit: $${formatNumber(opp.exampleTrade.netProfit)} (${formatPercent(opp.exampleTrade.netProfitPercent)})`);
      }

      console.log('\n' + '='.repeat(60) + '\n');

      // Save opportunities to history
      arbitrageHistory.opportunitiesFound += opportunities.length;
      arbitrageHistory.opportunities.push(...opportunities.map(opp => ({
        ...opp,
        scanNumber: arbitrageHistory.scans
      })));

      // Keep only last 500 opportunities
      if (arbitrageHistory.opportunities.length > 500) {
        arbitrageHistory.opportunities = arbitrageHistory.opportunities.slice(-500);
      }

      // Send Discord alerts
      await sendDiscordAlerts(opportunities);

    } else {
      console.log('\n✅ No arbitrage opportunities found in this scan.\n');
    }

    // Save history
    fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(arbitrageHistory, null, 2));

  } catch (error) {
    console.error('❌ Error during arbitrage scan:', error);
  }
}

async function sendDiscordAlerts(opportunities) {
  if (!CONFIG.DISCORD_WEBHOOK) return;

  try {
    for (const opp of opportunities) {
      const embed = {
        title: `🚨 Arbitrage Opportunity: ${opp.symbol}`,
        color: 0xf39c12, // Orange
        fields: [
          {
            name: '💰 HIVE-Engine Price',
            value: `${formatNumber(opp.hiveEnginePrice.inHive, 8)} HIVE\n$${formatNumber(opp.hiveEnginePrice.inUSD)}`,
            inline: true
          },
          {
            name: '💵 External Price',
            value: `$${formatNumber(opp.externalPrice)}`,
            inline: true
          },
          {
            name: '📈 Net Profit',
            value: `${formatPercent(opp.netProfitPercent)}\n(after fees)`,
            inline: true
          },
          {
            name: '📊 Example $1,000 Trade',
            value: `Buy: ${formatNumber(opp.exampleTrade.tokensCanBuy, 4)} ${opp.symbol}\n` +
                   `Gross: $${formatNumber(opp.exampleTrade.grossProfit)}\n` +
                   `Fees: $${formatNumber(opp.exampleTrade.fees)}\n` +
                   `**Net: $${formatNumber(opp.exampleTrade.netProfit)}**`,
            inline: false
          },
          {
            name: '⚠️ Action Required',
            value: CONFIG.ALERT_ONLY ?
              '**ALERT ONLY MODE** - Manual review required' :
              '**AUTO-TRADE DISABLED** - Manual approval needed',
            inline: false
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: `Scan #${arbitrageHistory.scans} | Total Fees: ${formatPercent(CONFIG.totalFees * 100)}`
        }
      };

      await axios.post(CONFIG.DISCORD_WEBHOOK, { embeds: [embed] });
    }

    console.log('✅ Discord alerts sent');
  } catch (error) {
    console.error('Error sending Discord alerts:', error.message);
  }
}

// ========================================
// STATISTICS
// ========================================

function generateStatistics() {
  if (arbitrageHistory.opportunities.length === 0) {
    console.log('📊 No opportunities found yet to generate statistics.\n');
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 ARBITRAGE SCANNER STATISTICS');
  console.log('='.repeat(60));

  console.log(`\n⏰ Running since: ${arbitrageHistory.startTime}`);
  console.log(`🔍 Total scans: ${arbitrageHistory.scans}`);
  console.log(`🚨 Opportunities found: ${arbitrageHistory.opportunitiesFound}`);
  console.log(`📈 Hit rate: ${((arbitrageHistory.opportunitiesFound / arbitrageHistory.scans) * 100).toFixed(2)}%`);

  // Token frequency
  const tokenCounts = {};
  const tokenProfits = {};

  for (const opp of arbitrageHistory.opportunities) {
    tokenCounts[opp.symbol] = (tokenCounts[opp.symbol] || 0) + 1;

    if (!tokenProfits[opp.symbol]) {
      tokenProfits[opp.symbol] = [];
    }
    tokenProfits[opp.symbol].push(opp.netProfitPercent);
  }

  console.log('\n🏆 Opportunities by Token:');
  const sortedTokens = Object.entries(tokenCounts).sort(([,a], [,b]) => b - a);

  for (const [token, count] of sortedTokens) {
    const avgProfit = tokenProfits[token].reduce((sum, val) => sum + val, 0) / tokenProfits[token].length;
    const maxProfit = Math.max(...tokenProfits[token]);
    console.log(`   ${token}: ${count} times (Avg: ${formatPercent(avgProfit)}, Max: ${formatPercent(maxProfit)})`);
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

// ========================================
// MAIN LOOP
// ========================================

async function main() {
  console.log('🔍 Van Kush Arbitrage Scanner Starting...');
  console.log(`⏱️  Scan interval: ${CONFIG.SCAN_INTERVAL / 1000} seconds`);
  console.log(`💰 Min trade size: $${CONFIG.MIN_TRADE_SIZE}`);
  console.log(`📊 Total fees: ${formatPercent(CONFIG.totalFees * 100)}`);
  console.log(`🎯 Scanning tokens: ${CONFIG.SWAP_TOKENS.map(t => t.symbol).join(', ')}`);

  if (CONFIG.ALERT_ONLY) {
    console.log('\n⚠️  ALERT ONLY MODE - No auto-trading will occur');
  }

  console.log('');

  // Run first scan immediately
  await scanForOpportunities();

  // Generate statistics every 10 scans
  if (arbitrageHistory.scans % 10 === 0) {
    generateStatistics();
  }

  // Schedule regular scans
  setInterval(async () => {
    await scanForOpportunities();

    if (arbitrageHistory.scans % 10 === 0) {
      generateStatistics();
    }
  }, CONFIG.SCAN_INTERVAL);

  console.log('✅ Arbitrage scanner is running. Press Ctrl+C to stop.\n');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n💾 Saving final data before exit...');
  fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(arbitrageHistory, null, 2));
  generateStatistics();
  console.log('✅ Data saved. Goodbye!\n');
  process.exit(0);
});

// Start the scanner
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
