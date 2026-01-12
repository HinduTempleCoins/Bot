#!/usr/bin/env node

// ========================================
// HOLDER DISTRIBUTION ANALYZER
// ========================================
// Purpose: Track token ownership distribution to inform trading decisions
// Key Insight: Scarcity economics - fewer tokens = fewer can be dumped
// Strategy: Monitor concentration, growth, whale movements
// Author: Claude Code
// Date: 2026-01-10

const hiveAPI = require('./hive-engine-api.cjs');
const fs = require('fs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // Tokens to track
  TOKENS: ['VKBT', 'CURE'],

  // Whale thresholds (consider large holders)
  WHALE_THRESHOLDS: {
    VKBT: 10000,   // 10K+ VKBT = whale (0.5% of supply)
    CURE: 1000     // 1K+ CURE = whale (1.8% of supply)
  },

  // Data persistence
  HISTORY_FILE: './holder-history.json',

  // Update interval
  CHECK_INTERVAL_HOURS: 6
};

// ========================================
// HOLDER ANALYSIS
// ========================================

/**
 * Get all holders for a token
 */
async function getTokenHolders(symbol) {
  try {
    const response = await hiveAPI.apiCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: { symbol },
        limit: 1000,
        offset: 0
      }
    });

    return response.result || [];
  } catch (error) {
    console.error(`❌ Error fetching holders for ${symbol}:`, error.message);
    return [];
  }
}

/**
 * Get token supply info
 */
async function getTokenInfo(symbol) {
  try {
    const response = await hiveAPI.apiCall({
      jsonrpc: '2.0',
      id: 1,
      method: 'findOne',
      params: {
        contract: 'tokens',
        table: 'tokens',
        query: { symbol }
      }
    });

    return response.result || null;
  } catch (error) {
    console.error(`❌ Error fetching token info for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Analyze holder distribution
 */
async function analyzeHolders(symbol) {
  console.log(`\n📊 Analyzing ${symbol} holder distribution...`);
  console.log('='.repeat(60));

  const holders = await getTokenHolders(symbol);
  const tokenInfo = await getTokenInfo(symbol);

  if (!holders.length || !tokenInfo) {
    console.log('⚠️ No data available');
    return null;
  }

  // Parse balances
  const holdersWithBalance = holders
    .map(h => ({
      account: h.account,
      balance: parseFloat(h.balance),
      stake: parseFloat(h.stake || 0),
      total: parseFloat(h.balance) + parseFloat(h.stake || 0)
    }))
    .filter(h => h.total > 0)
    .sort((a, b) => b.total - a.total);

  const totalSupply = parseFloat(tokenInfo.supply);
  const circulatingSupply = parseFloat(tokenInfo.circulatingSupply);

  // Calculate distribution metrics
  const uniqueHolders = holdersWithBalance.length;
  const totalHeld = holdersWithBalance.reduce((sum, h) => sum + h.total, 0);

  // Whale analysis
  const whaleThreshold = CONFIG.WHALE_THRESHOLDS[symbol] || 1000;
  const whales = holdersWithBalance.filter(h => h.total >= whaleThreshold);
  const whaleBalance = whales.reduce((sum, w) => sum + w.total, 0);
  const whalePercent = (whaleBalance / totalSupply) * 100;

  // Top holders
  const top10 = holdersWithBalance.slice(0, 10);
  const top10Balance = top10.reduce((sum, h) => sum + h.total, 0);
  const top10Percent = (top10Balance / totalSupply) * 100;

  // Distribution categories
  const microHolders = holdersWithBalance.filter(h => h.total < 100).length;
  const smallHolders = holdersWithBalance.filter(h => h.total >= 100 && h.total < 1000).length;
  const mediumHolders = holdersWithBalance.filter(h => h.total >= 1000 && h.total < whaleThreshold).length;
  const whaleCount = whales.length;

  // Gini coefficient (concentration measure, 0 = equal, 1 = one person owns everything)
  const gini = calculateGini(holdersWithBalance.map(h => h.total));

  const analysis = {
    symbol,
    timestamp: new Date().toISOString(),
    supply: {
      total: totalSupply,
      circulating: circulatingSupply,
      held: totalHeld,
      accountedPercent: (totalHeld / totalSupply) * 100
    },
    holders: {
      unique: uniqueHolders,
      micro: microHolders,      // < 100
      small: smallHolders,      // 100-1K
      medium: mediumHolders,    // 1K-whale threshold
      whales: whaleCount        // >= whale threshold
    },
    concentration: {
      giniCoefficient: gini,
      top10Holders: top10Percent,
      whalePercent: whalePercent,
      distributionScore: calculateDistributionScore(gini, top10Percent)
    },
    whales: whales.slice(0, 10).map(w => ({
      account: w.account,
      total: w.total,
      percentOfSupply: (w.total / totalSupply) * 100
    })),
    top10: top10.map(h => ({
      account: h.account,
      total: h.total,
      percentOfSupply: (h.total / totalSupply) * 100
    }))
  };

  // Display results
  console.log(`\n📈 Supply:`);
  console.log(`   Total: ${totalSupply.toLocaleString()} ${symbol}`);
  console.log(`   Circulating: ${circulatingSupply.toLocaleString()} ${symbol}`);
  console.log(`   Held in wallets: ${totalHeld.toLocaleString()} ${symbol} (${analysis.supply.accountedPercent.toFixed(1)}%)`);

  console.log(`\n👥 Holders:`);
  console.log(`   Unique wallets: ${uniqueHolders}`);
  console.log(`   Micro (< 100): ${microHolders}`);
  console.log(`   Small (100-1K): ${smallHolders}`);
  console.log(`   Medium (1K-${whaleThreshold.toLocaleString()}): ${mediumHolders}`);
  console.log(`   Whales (${whaleThreshold.toLocaleString()}+): ${whaleCount}`);

  console.log(`\n🐋 Concentration:`);
  console.log(`   Gini coefficient: ${gini.toFixed(3)} (0 = equal, 1 = concentrated)`);
  console.log(`   Top 10 holders: ${top10Percent.toFixed(1)}% of supply`);
  console.log(`   Whales control: ${whalePercent.toFixed(1)}% of supply`);
  console.log(`   Distribution score: ${analysis.concentration.distributionScore}/100`);

  if (whales.length > 0) {
    console.log(`\n🐋 Top Whales:`);
    whales.slice(0, 5).forEach((w, i) => {
      const percent = (w.total / totalSupply) * 100;
      console.log(`   ${i + 1}. @${w.account}: ${w.total.toLocaleString()} (${percent.toFixed(2)}%)`);
    });
  }

  return analysis;
}

/**
 * Calculate Gini coefficient (inequality measure)
 */
function calculateGini(values) {
  if (values.length === 0) return 0;

  const sorted = values.sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);

  if (sum === 0) return 0;

  let numerator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i + 1) * sorted[i];
  }

  return (2 * numerator) / (n * sum) - (n + 1) / n;
}

/**
 * Calculate distribution score (0-100, higher = better distribution)
 */
function calculateDistributionScore(gini, top10Percent) {
  // Ideal: Low Gini (0.3 or less), Top 10 under 50%
  const giniScore = Math.max(0, (0.6 - gini) / 0.6 * 50); // 0-50 points
  const top10Score = Math.max(0, (70 - top10Percent) / 70 * 50); // 0-50 points

  return Math.round(giniScore + top10Score);
}

/**
 * Compare two snapshots to detect changes
 */
function compareSnapshots(oldSnapshot, newSnapshot) {
  if (!oldSnapshot) return null;

  const changes = {
    holderGrowth: newSnapshot.holders.unique - oldSnapshot.holders.unique,
    holderGrowthPercent: ((newSnapshot.holders.unique - oldSnapshot.holders.unique) / oldSnapshot.holders.unique) * 100,
    whaleChange: newSnapshot.holders.whales - oldSnapshot.holders.whales,
    concentrationChange: newSnapshot.concentration.giniCoefficient - oldSnapshot.concentration.giniCoefficient,
    distributionScoreChange: newSnapshot.concentration.distributionScore - oldSnapshot.concentration.distributionScore,

    // New whales (accounts that crossed threshold)
    newWhales: newSnapshot.whales.filter(nw =>
      !oldSnapshot.whales.some(ow => ow.account === nw.account)
    ),

    // Whales who sold (dropped below threshold)
    exitedWhales: oldSnapshot.whales.filter(ow =>
      !newSnapshot.whales.some(nw => nw.account === ow.account)
    )
  };

  return changes;
}

/**
 * Load historical data
 */
function loadHistory() {
  if (fs.existsSync(CONFIG.HISTORY_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8'));
    } catch (error) {
      console.error('⚠️ Error loading history:', error.message);
      return {};
    }
  }
  return {};
}

/**
 * Save historical data
 */
function saveHistory(history) {
  try {
    fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('⚠️ Error saving history:', error.message);
  }
}

/**
 * Analyze all configured tokens
 */
async function analyzeAll() {
  console.log('\n🔍 HOLDER DISTRIBUTION ANALYSIS');
  console.log('='.repeat(60));

  const history = loadHistory();
  const results = {};

  for (const symbol of CONFIG.TOKENS) {
    const analysis = await analyzeHolders(symbol);

    if (analysis) {
      results[symbol] = analysis;

      // Compare to previous snapshot
      if (history[symbol] && history[symbol].length > 0) {
        const lastSnapshot = history[symbol][history[symbol].length - 1];
        const changes = compareSnapshots(lastSnapshot, analysis);

        if (changes) {
          console.log(`\n📈 Changes since last check:`);
          console.log(`   Holder growth: ${changes.holderGrowth > 0 ? '+' : ''}${changes.holderGrowth} (${changes.holderGrowthPercent > 0 ? '+' : ''}${changes.holderGrowthPercent.toFixed(1)}%)`);
          console.log(`   Whale count: ${changes.whaleChange > 0 ? '+' : ''}${changes.whaleChange}`);
          console.log(`   Distribution score: ${changes.distributionScoreChange > 0 ? '+' : ''}${changes.distributionScoreChange}`);

          if (changes.newWhales.length > 0) {
            console.log(`   🐋 New whales: ${changes.newWhales.map(w => '@' + w.account).join(', ')}`);
          }

          if (changes.exitedWhales.length > 0) {
            console.log(`   📉 Whales who sold: ${changes.exitedWhales.map(w => '@' + w.account).join(', ')}`);
          }
        }
      }

      // Update history
      if (!history[symbol]) history[symbol] = [];
      history[symbol].push(analysis);

      // Keep last 100 snapshots
      if (history[symbol].length > 100) {
        history[symbol] = history[symbol].slice(-100);
      }
    }
  }

  saveHistory(history);

  console.log('\n✅ Analysis complete!');
  console.log(`📁 History saved to: ${CONFIG.HISTORY_FILE}`);

  return results;
}

/**
 * Get trading insights from holder analysis
 */
function getTradingInsights(analysis) {
  const insights = [];

  // Scarcity advantage
  if (analysis.supply.total < 100000) {
    insights.push({
      type: 'SCARCITY_ADVANTAGE',
      message: `Only ${analysis.supply.total.toLocaleString()} ${analysis.symbol} exist - sustainable high value!`,
      impact: 'POSITIVE'
    });
  }

  // Growing holder base
  if (analysis.holders.unique > 50) {
    insights.push({
      type: 'HEALTHY_DISTRIBUTION',
      message: `${analysis.holders.unique} unique holders - good distribution`,
      impact: 'POSITIVE'
    });
  } else if (analysis.holders.unique < 20) {
    insights.push({
      type: 'LIMITED_DISTRIBUTION',
      message: `Only ${analysis.holders.unique} holders - room for growth`,
      impact: 'NEUTRAL'
    });
  }

  // Concentration risk
  if (analysis.concentration.top10Percent > 80) {
    insights.push({
      type: 'HIGH_CONCENTRATION',
      message: `Top 10 holders own ${analysis.concentration.top10Percent.toFixed(1)}% - dump risk`,
      impact: 'NEGATIVE'
    });
  }

  // Good distribution
  if (analysis.concentration.distributionScore > 60) {
    insights.push({
      type: 'GOOD_DISTRIBUTION',
      message: `Distribution score ${analysis.concentration.distributionScore}/100 - healthy`,
      impact: 'POSITIVE'
    });
  }

  // Whale dominance
  if (analysis.concentration.whalePercent > 50) {
    insights.push({
      type: 'WHALE_DOMINANCE',
      message: `Whales control ${analysis.concentration.whalePercent.toFixed(1)}% - monitor movements`,
      impact: 'CAUTION'
    });
  }

  return insights;
}

// ========================================
// MAIN
// ========================================

if (require.main === module) {
  analyzeAll().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  analyzeHolders,
  analyzeAll,
  getTokenHolders,
  getTokenInfo,
  getTradingInsights,
  compareSnapshots,
  CONFIG
};
