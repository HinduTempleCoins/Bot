// ========================================
// VAN KUSH PORTFOLIO TRACKER BOT
// ========================================
// Purpose: Monitor HIVE-Engine wallet balances and calculate portfolio value
// Phase 2 of Van Kush trading strategy (see TRADING_STRATEGY.md)
// Author: Claude Code
// Date: 2026-01-09

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // HIVE-Engine account to monitor
  ACCOUNT: process.env.HIVE_USERNAME || 'placeholder',

  // API endpoints
  HIVE_ENGINE_API: 'https://engine.rishipanthee.com',
  COINGECKO_API: 'https://api.coingecko.com/api/v3',

  // Tokens to track (Van Kush ecosystem)
  PRIORITY_TOKENS: ['VKBT', 'CURE', 'BLURT', 'SWAP.HIVE'],

  // Update interval (5 minutes)
  UPDATE_INTERVAL: 300000,

  // Historical data file
  DATA_FILE: 'vankush-portfolio-data.json',

  // Discord webhook (optional)
  DISCORD_WEBHOOK: process.env.HIVE_DISCORD_WEBHOOK || null,

  // Report interval (1 hour = 12 updates)
  REPORT_EVERY: 12
};

// ========================================
// DATA STORAGE
// ========================================

let portfolioHistory = {
  startTime: new Date().toISOString(),
  startingBalances: {},
  startingHivePrice: 0,
  updates: [],
  dailySnapshots: []
};

// Load existing data if available
if (fs.existsSync(CONFIG.DATA_FILE)) {
  try {
    portfolioHistory = JSON.parse(fs.readFileSync(CONFIG.DATA_FILE, 'utf8'));
    console.log('📊 Loaded historical portfolio data');
    console.log(`   Started tracking: ${portfolioHistory.startTime}`);
    console.log(`   Total updates: ${portfolioHistory.updates.length}`);
  } catch (error) {
    console.error('⚠️  Could not load historical data, starting fresh:', error.message);
  }
}

// ========================================
// HIVE-ENGINE API FUNCTIONS
// ========================================

async function getAccountBalances(account) {
  try {
    const response = await axios.post(`${CONFIG.HIVE_ENGINE_API}/contracts`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: { account: account },
        limit: 1000
      }
    });

    if (response.data && response.data.result) {
      return response.data.result;
    }
    return [];
  } catch (error) {
    console.error('Error fetching account balances:', error.message);
    return [];
  }
}

async function getTokenMetrics(symbol) {
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
      return response.data.result;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching metrics for ${symbol}:`, error.message);
    return null;
  }
}

// ========================================
// COINGECKO API FUNCTIONS
// ========================================

async function getHivePrice() {
  try {
    const response = await axios.get(`${CONFIG.COINGECKO_API}/simple/price`, {
      params: {
        ids: 'hive',
        vs_currencies: 'usd',
        include_24hr_change: true,
        include_24hr_vol: true
      }
    });

    if (response.data && response.data.hive) {
      return {
        usd: response.data.hive.usd,
        change_24h: response.data.hive.usd_24h_change || 0,
        volume_24h: response.data.hive.usd_24h_vol || 0
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching HIVE price:', error.message);
    return null;
  }
}

async function getCryptoPrices() {
  try {
    const response = await axios.get(`${CONFIG.COINGECKO_API}/simple/price`, {
      params: {
        ids: 'bitcoin,dogecoin,litecoin,ethereum',
        vs_currencies: 'usd'
      }
    });

    return response.data || {};
  } catch (error) {
    console.error('Error fetching crypto prices:', error.message);
    return {};
  }
}

// ========================================
// PORTFOLIO CALCULATION
// ========================================

async function calculatePortfolioValue(balances, hivePrice, tokenMetrics) {
  const portfolio = {
    timestamp: new Date().toISOString(),
    hivePrice: hivePrice,
    tokens: [],
    totalValueHive: 0,
    totalValueUSD: 0,
    priorityTokens: {}
  };

  for (const balance of balances) {
    const symbol = balance.symbol;
    const amount = parseFloat(balance.balance);

    if (amount === 0) continue;

    let valueInHive = 0;
    const metrics = tokenMetrics[symbol];

    // Calculate value in HIVE
    if (symbol === 'SWAP.HIVE') {
      valueInHive = amount; // 1:1 with HIVE
    } else if (metrics && metrics.lastPrice) {
      valueInHive = amount * parseFloat(metrics.lastPrice);
    }

    const valueInUSD = valueInHive * hivePrice.usd;

    const tokenData = {
      symbol: symbol,
      amount: amount,
      lastPrice: metrics ? parseFloat(metrics.lastPrice) : 0,
      valueHive: valueInHive,
      valueUSD: valueInUSD,
      volume24h: metrics ? parseFloat(metrics.volume) : 0
    };

    portfolio.tokens.push(tokenData);
    portfolio.totalValueHive += valueInHive;
    portfolio.totalValueUSD += valueInUSD;

    // Track priority tokens separately
    if (CONFIG.PRIORITY_TOKENS.includes(symbol)) {
      portfolio.priorityTokens[symbol] = tokenData;
    }
  }

  // Sort tokens by USD value (descending)
  portfolio.tokens.sort((a, b) => b.valueUSD - a.valueUSD);

  return portfolio;
}

// ========================================
// PERFORMANCE METRICS
// ========================================

function calculatePerformance(current, starting) {
  if (!starting || Object.keys(starting).length === 0) {
    return null;
  }

  const metrics = {
    hiveChange: 0,
    hivePriceChange: 0,
    vkbtChange: 0,
    cureChange: 0,
    totalValueChange: 0
  };

  // HIVE balance change
  const currentHive = current.priorityTokens['SWAP.HIVE']?.amount || 0;
  const startingHive = starting['SWAP.HIVE']?.amount || 0;
  if (startingHive > 0) {
    metrics.hiveChange = ((currentHive - startingHive) / startingHive) * 100;
  }

  // HIVE price change
  if (portfolioHistory.startingHivePrice > 0) {
    metrics.hivePriceChange = ((current.hivePrice.usd - portfolioHistory.startingHivePrice) / portfolioHistory.startingHivePrice) * 100;
  }

  // VKBT token change
  const currentVKBT = current.priorityTokens['VKBT']?.amount || 0;
  const startingVKBT = starting['VKBT']?.amount || 0;
  if (startingVKBT > 0) {
    metrics.vkbtChange = ((currentVKBT - startingVKBT) / startingVKBT) * 100;
  }

  // CURE token change
  const currentCURE = current.priorityTokens['CURE']?.amount || 0;
  const startingCURE = starting['CURE']?.amount || 0;
  if (startingCURE > 0) {
    metrics.cureChange = ((currentCURE - startingCURE) / startingCURE) * 100;
  }

  return metrics;
}

// ========================================
// REPORTING
// ========================================

function formatNumber(num, decimals = 2) {
  return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPercent(num) {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

function generateReport(portfolio, performance) {
  console.log('\n' + '='.repeat(60));
  console.log('💎 VAN KUSH PORTFOLIO REPORT');
  console.log('='.repeat(60));

  // HIVE Price
  console.log(`\n📊 HIVE Price: $${formatNumber(portfolio.hivePrice.usd, 4)}`);
  console.log(`   24h Change: ${formatPercent(portfolio.hivePrice.change_24h)}`);

  // Total Portfolio Value
  console.log(`\n💰 Total Portfolio Value:`);
  console.log(`   ${formatNumber(portfolio.totalValueHive)} HIVE`);
  console.log(`   $${formatNumber(portfolio.totalValueUSD)} USD`);

  // Performance (if available)
  if (performance) {
    console.log(`\n📈 Performance Since Start:`);
    console.log(`   HIVE Balance: ${formatPercent(performance.hiveChange)}`);
    console.log(`   HIVE Price: ${formatPercent(performance.hivePriceChange)}`);
    if (portfolio.priorityTokens['VKBT']) {
      console.log(`   VKBT Holdings: ${formatPercent(performance.vkbtChange)}`);
    }
    if (portfolio.priorityTokens['CURE']) {
      console.log(`   CURE Holdings: ${formatPercent(performance.cureChange)}`);
    }
  }

  // Priority Tokens
  console.log(`\n🎯 Priority Tokens:`);
  for (const token of CONFIG.PRIORITY_TOKENS) {
    const data = portfolio.priorityTokens[token];
    if (data) {
      console.log(`   ${token}: ${formatNumber(data.amount, 4)} (${formatNumber(data.valueHive, 2)} HIVE / $${formatNumber(data.valueUSD, 2)})`);
    } else {
      console.log(`   ${token}: 0`);
    }
  }

  // Top Holdings (non-priority)
  const topHoldings = portfolio.tokens
    .filter(t => !CONFIG.PRIORITY_TOKENS.includes(t.symbol))
    .slice(0, 5);

  if (topHoldings.length > 0) {
    console.log(`\n📦 Top 5 Other Holdings:`);
    topHoldings.forEach(token => {
      console.log(`   ${token.symbol}: ${formatNumber(token.amount, 4)} ($${formatNumber(token.valueUSD, 2)})`);
    });
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

async function sendDiscordReport(portfolio, performance) {
  if (!CONFIG.DISCORD_WEBHOOK) return;

  try {
    const embed = {
      title: '💎 Van Kush Portfolio Update',
      color: 0x9b59b6,
      fields: [
        {
          name: '📊 HIVE Price',
          value: `$${formatNumber(portfolio.hivePrice.usd, 4)} (${formatPercent(portfolio.hivePrice.change_24h)} 24h)`,
          inline: true
        },
        {
          name: '💰 Portfolio Value',
          value: `${formatNumber(portfolio.totalValueHive, 2)} HIVE\n$${formatNumber(portfolio.totalValueUSD, 2)} USD`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    // Add priority tokens
    const priorityFields = [];
    for (const token of CONFIG.PRIORITY_TOKENS) {
      const data = portfolio.priorityTokens[token];
      if (data && data.amount > 0) {
        priorityFields.push({
          name: `${token}`,
          value: `${formatNumber(data.amount, 4)}\n$${formatNumber(data.valueUSD, 2)}`,
          inline: true
        });
      }
    }
    embed.fields.push(...priorityFields);

    // Add performance if available
    if (performance) {
      embed.fields.push({
        name: '📈 Performance',
        value: `HIVE: ${formatPercent(performance.hiveChange)}\nPrice: ${formatPercent(performance.hivePriceChange)}`,
        inline: false
      });
    }

    await axios.post(CONFIG.DISCORD_WEBHOOK, {
      embeds: [embed]
    });

    console.log('✅ Discord report sent');
  } catch (error) {
    console.error('Error sending Discord report:', error.message);
  }
}

// ========================================
// MAIN UPDATE LOOP
// ========================================

let updateCounter = 0;

async function updatePortfolio() {
  console.log(`\n⏰ Portfolio update #${updateCounter + 1} - ${new Date().toLocaleString()}`);

  try {
    // Fetch data
    console.log('📡 Fetching account balances...');
    const balances = await getAccountBalances(CONFIG.ACCOUNT);

    console.log('📡 Fetching HIVE price...');
    const hivePrice = await getHivePrice();

    if (!hivePrice) {
      console.error('❌ Could not fetch HIVE price, skipping update');
      return;
    }

    // Get token metrics for price calculation
    console.log('📡 Fetching token metrics...');
    const tokenMetrics = {};
    for (const balance of balances) {
      if (balance.symbol !== 'SWAP.HIVE') {
        const metrics = await getTokenMetrics(balance.symbol);
        if (metrics) {
          tokenMetrics[balance.symbol] = metrics;
        }
      }
    }

    // Calculate portfolio value
    console.log('💹 Calculating portfolio value...');
    const portfolio = await calculatePortfolioValue(balances, hivePrice, tokenMetrics);

    // Initialize starting balances on first run
    if (Object.keys(portfolioHistory.startingBalances).length === 0) {
      console.log('📸 Recording starting balances...');
      for (const token of CONFIG.PRIORITY_TOKENS) {
        const data = portfolio.priorityTokens[token];
        portfolioHistory.startingBalances[token] = {
          amount: data ? data.amount : 0,
          valueHive: data ? data.valueHive : 0,
          valueUSD: data ? data.valueUSD : 0
        };
      }
      portfolioHistory.startingHivePrice = hivePrice.usd;
    }

    // Calculate performance
    const performance = calculatePerformance(portfolio, portfolioHistory.startingBalances);

    // Save update to history
    portfolioHistory.updates.push({
      timestamp: portfolio.timestamp,
      totalValueHive: portfolio.totalValueHive,
      totalValueUSD: portfolio.totalValueUSD,
      hivePrice: hivePrice.usd,
      priorityTokens: portfolio.priorityTokens
    });

    // Keep only last 1000 updates (prevent file bloat)
    if (portfolioHistory.updates.length > 1000) {
      portfolioHistory.updates = portfolioHistory.updates.slice(-1000);
    }

    // Save to file
    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(portfolioHistory, null, 2));

    // Generate reports
    if (updateCounter % CONFIG.REPORT_EVERY === 0) {
      generateReport(portfolio, performance);
      await sendDiscordReport(portfolio, performance);
    } else {
      console.log(`✅ Update complete. Total value: ${formatNumber(portfolio.totalValueHive, 2)} HIVE ($${formatNumber(portfolio.totalValueUSD, 2)})`);
    }

    updateCounter++;

  } catch (error) {
    console.error('❌ Error during portfolio update:', error);
  }
}

// ========================================
// STARTUP & MAIN LOOP
// ========================================

async function main() {
  console.log('💎 Van Kush Portfolio Tracker Starting...');
  console.log(`📊 Monitoring account: ${CONFIG.ACCOUNT}`);
  console.log(`⏱️  Update interval: ${CONFIG.UPDATE_INTERVAL / 1000} seconds`);
  console.log(`📢 Report every: ${CONFIG.REPORT_EVERY} updates`);

  if (CONFIG.ACCOUNT === 'placeholder') {
    console.log('\n⚠️  WARNING: Using placeholder account name!');
    console.log('   Set HIVE_USERNAME in .env for live tracking\n');
  }

  // Run first update immediately
  await updatePortfolio();

  // Schedule regular updates
  setInterval(updatePortfolio, CONFIG.UPDATE_INTERVAL);

  console.log('\n✅ Portfolio tracker is running. Press Ctrl+C to stop.\n');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n💾 Saving final data before exit...');
  fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(portfolioHistory, null, 2));
  console.log('✅ Data saved. Goodbye!\n');
  process.exit(0);
});

// Start the bot
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
