#!/usr/bin/env node

// ========================================
// MARKET PSYCHOLOGY TRACKER
// ========================================
// Purpose: Track price anchoring metrics to validate strategy effectiveness
// Key Metrics: Sell wall floor, push costs, holder growth, distribution
// Timeline: Weeks/months, not days
// Author: Claude Code
// Date: 2026-01-10

const hiveAPI = require('./hive-engine-api.cjs');
const { analyzeHolders, getTokenInfo } = require('./holder-analyzer.cjs');
const { analyzeSellWall, checkMarketHealth } = require('./wall-analyzer.cjs');
const fs = require('fs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // Tokens to track
  TOKENS: ['VKBT', 'CURE'],

  // Target prices
  TARGET_PRICES: {
    VKBT: 0.001,
    CURE: 0.001
  },

  // Data persistence
  METRICS_FILE: './psychology-metrics.json',
  SNAPSHOTS_FILE: './price-snapshots.json',

  // Update interval
  CHECK_INTERVAL_HOURS: 6,

  // Success thresholds
  THRESHOLDS: {
    HOLDER_GROWTH_PERCENT: 10,      // 10% holder growth = good
    WALL_FLOOR_RISE_PERCENT: 20,    // 20% floor rise = anchoring working
    PUSH_COST_INCREASE_PERCENT: 50, // 50% cost increase = market solidifying
    DISTRIBUTION_SCORE_MIN: 15      // 15/100 distribution = acceptable
  }
};

// ========================================
// METRICS TRACKING
// ========================================

/**
 * Capture complete market snapshot
 */
async function captureSnapshot(symbol) {
  console.log(`\n📸 Capturing ${symbol} snapshot...`);

  try {
    // Get all data in parallel
    const [tokenInfo, holders, wall, health, orderBook] = await Promise.all([
      getTokenInfo(symbol),
      analyzeHolders(symbol),
      analyzeSellWall(symbol, CONFIG.TARGET_PRICES[symbol]),
      checkMarketHealth(symbol),
      hiveAPI.getOrderBook(symbol)
    ]);

    const snapshot = {
      symbol,
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),

      // Price data
      price: {
        current: health.lastPrice,
        target: CONFIG.TARGET_PRICES[symbol],
        percentToTarget: ((CONFIG.TARGET_PRICES[symbol] - health.lastPrice) / health.lastPrice) * 100
      },

      // Supply data
      supply: {
        total: parseFloat(tokenInfo.supply),
        circulating: parseFloat(tokenInfo.circulatingSupply),
        maxSupply: parseFloat(tokenInfo.maxSupply)
      },

      // Holder data
      holders: {
        unique: holders.holders.unique,
        micro: holders.holders.micro,
        small: holders.holders.small,
        medium: holders.holders.medium,
        whales: holders.holders.whales,
        distributionScore: holders.concentration.distributionScore,
        giniCoefficient: holders.concentration.giniCoefficient,
        top10Percent: holders.concentration.top10Holders
      },

      // Wall data
      wall: {
        sellFloor: orderBook.asks[0] ? parseFloat(orderBook.asks[0].price) : null,
        sellDepth: orderBook.asks.length,
        buyTop: orderBook.bids[0] ? parseFloat(orderBook.bids[0].price) : null,
        buyDepth: orderBook.bids.length,
        costToPush: wall.costToTarget,
        costToPushUSD: wall.costUSD,
        isAffordable: wall.isAffordable
      },

      // Market data
      market: {
        volume24h: health.volume24h,
        estimatedWeeklyTrades: health.estimatedWeeklyTrades,
        isAlive: health.isAlive,
        reason: health.reason
      }
    };

    console.log('✅ Snapshot captured');
    return snapshot;

  } catch (error) {
    console.error(`❌ Error capturing snapshot:`, error.message);
    return null;
  }
}

/**
 * Compare two snapshots to calculate changes
 */
function compareSnapshots(oldSnap, newSnap) {
  if (!oldSnap || !newSnap) return null;

  const timeDiffMs = newSnap.timestampMs - oldSnap.timestampMs;
  const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

  return {
    symbol: newSnap.symbol,
    timeDiffDays: timeDiffDays,

    // Price changes
    price: {
      change: newSnap.price.current - oldSnap.price.current,
      changePercent: ((newSnap.price.current - oldSnap.price.current) / oldSnap.price.current) * 100,
      current: newSnap.price.current,
      previous: oldSnap.price.current
    },

    // Holder changes
    holders: {
      uniqueChange: newSnap.holders.unique - oldSnap.holders.unique,
      uniqueChangePercent: ((newSnap.holders.unique - oldSnap.holders.unique) / oldSnap.holders.unique) * 100,
      distributionScoreChange: newSnap.holders.distributionScore - oldSnap.holders.distributionScore,
      current: newSnap.holders.unique,
      previous: oldSnap.holders.unique
    },

    // Wall changes
    wall: {
      floorChange: newSnap.wall.sellFloor && oldSnap.wall.sellFloor
        ? newSnap.wall.sellFloor - oldSnap.wall.sellFloor
        : null,
      floorChangePercent: newSnap.wall.sellFloor && oldSnap.wall.sellFloor
        ? ((newSnap.wall.sellFloor - oldSnap.wall.sellFloor) / oldSnap.wall.sellFloor) * 100
        : null,
      costChange: newSnap.wall.costToPush - oldSnap.wall.costToPush,
      costChangePercent: oldSnap.wall.costToPush > 0
        ? ((newSnap.wall.costToPush - oldSnap.wall.costToPush) / oldSnap.wall.costToPush) * 100
        : null,
      currentFloor: newSnap.wall.sellFloor,
      previousFloor: oldSnap.wall.sellFloor
    },

    // Volume changes
    market: {
      volumeChange: newSnap.market.volume24h - oldSnap.market.volume24h,
      volumeChangePercent: oldSnap.market.volume24h > 0
        ? ((newSnap.market.volume24h - oldSnap.market.volume24h) / oldSnap.market.volume24h) * 100
        : null
    }
  };
}

/**
 * Analyze trends over time
 */
function analyzeTrends(snapshots) {
  if (snapshots.length < 2) {
    return {
      status: 'INSUFFICIENT_DATA',
      message: 'Need at least 2 snapshots to analyze trends'
    };
  }

  const symbol = snapshots[0].symbol;
  const oldest = snapshots[0];
  const newest = snapshots[snapshots.length - 1];
  const comparison = compareSnapshots(oldest, newest);

  // Detect trend patterns
  const trends = {
    symbol,
    timespan: `${comparison.timeDiffDays.toFixed(1)} days`,
    snapshotCount: snapshots.length,

    // Holder trend
    holderTrend: {
      direction: comparison.holders.uniqueChange > 0 ? 'GROWING' : 'DECLINING',
      change: comparison.holders.uniqueChange,
      changePercent: comparison.holders.uniqueChangePercent.toFixed(2),
      status: Math.abs(comparison.holders.uniqueChangePercent) >= CONFIG.THRESHOLDS.HOLDER_GROWTH_PERCENT
        ? '✅ STRONG'
        : '⚠️ WEAK'
    },

    // Price floor trend
    floorTrend: comparison.wall.floorChange !== null ? {
      direction: comparison.wall.floorChange > 0 ? 'RISING' : 'FALLING',
      change: comparison.wall.floorChange,
      changePercent: comparison.wall.floorChangePercent?.toFixed(2),
      status: comparison.wall.floorChangePercent >= CONFIG.THRESHOLDS.WALL_FLOOR_RISE_PERCENT
        ? '✅ ANCHORING'
        : comparison.wall.floorChangePercent > 0
          ? '🟡 IMPROVING'
          : '❌ DECLINING'
    } : null,

    // Push cost trend (higher = market solidifying)
    costTrend: {
      direction: comparison.wall.costChange > 0 ? 'INCREASING' : 'DECREASING',
      change: comparison.wall.costChange,
      changePercent: comparison.wall.costChangePercent?.toFixed(2),
      status: comparison.wall.costChangePercent >= CONFIG.THRESHOLDS.PUSH_COST_INCREASE_PERCENT
        ? '✅ SOLIDIFYING'
        : comparison.wall.costChangePercent > 0
          ? '🟡 STRENGTHENING'
          : '⚠️ WEAKENING'
    },

    // Distribution trend
    distributionTrend: {
      direction: comparison.holders.distributionScoreChange > 0 ? 'IMPROVING' : 'WORSENING',
      change: comparison.holders.distributionScoreChange,
      current: newest.holders.distributionScore,
      status: newest.holders.distributionScore >= CONFIG.THRESHOLDS.DISTRIBUTION_SCORE_MIN
        ? '✅ HEALTHY'
        : '⚠️ CONCENTRATED'
    },

    // Overall assessment
    assessment: assessOverallTrend(comparison)
  };

  return trends;
}

/**
 * Assess overall trend health
 */
function assessOverallTrend(comparison) {
  let positiveSignals = 0;
  let negativeSignals = 0;

  // Holder growth
  if (comparison.holders.uniqueChangePercent >= CONFIG.THRESHOLDS.HOLDER_GROWTH_PERCENT) {
    positiveSignals++;
  } else if (comparison.holders.uniqueChangePercent < 0) {
    negativeSignals++;
  }

  // Wall floor rising
  if (comparison.wall.floorChangePercent && comparison.wall.floorChangePercent >= CONFIG.THRESHOLDS.WALL_FLOOR_RISE_PERCENT) {
    positiveSignals++;
  } else if (comparison.wall.floorChangePercent && comparison.wall.floorChangePercent < 0) {
    negativeSignals++;
  }

  // Push cost increasing (good - means demand building)
  if (comparison.wall.costChangePercent && comparison.wall.costChangePercent >= CONFIG.THRESHOLDS.PUSH_COST_INCREASE_PERCENT) {
    positiveSignals++;
  }

  // Assessment
  if (positiveSignals >= 2 && negativeSignals === 0) {
    return {
      status: '🚀 STRATEGY WORKING',
      confidence: 'HIGH',
      message: 'Price anchoring is effective. Multiple positive signals.'
    };
  } else if (positiveSignals > negativeSignals) {
    return {
      status: '🟢 POSITIVE TREND',
      confidence: 'MEDIUM',
      message: 'Strategy showing promise. Continue patient approach.'
    };
  } else if (positiveSignals === negativeSignals) {
    return {
      status: '🟡 NEUTRAL',
      confidence: 'LOW',
      message: 'No clear trend yet. More time needed.'
    };
  } else {
    return {
      status: '🔴 NEEDS ATTENTION',
      confidence: 'MEDIUM',
      message: 'Strategy may need adjustment. Review approach.'
    };
  }
}

/**
 * Load snapshot history
 */
function loadSnapshots() {
  if (fs.existsSync(CONFIG.SNAPSHOTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG.SNAPSHOTS_FILE, 'utf8'));
    } catch (error) {
      console.error('⚠️ Error loading snapshots:', error.message);
      return {};
    }
  }
  return {};
}

/**
 * Save snapshot history
 */
function saveSnapshots(snapshots) {
  try {
    fs.writeFileSync(CONFIG.SNAPSHOTS_FILE, JSON.stringify(snapshots, null, 2));
  } catch (error) {
    console.error('⚠️ Error saving snapshots:', error.message);
  }
}

/**
 * Track metrics for all tokens
 */
async function trackAllMetrics() {
  console.log('\n🔍 MARKET PSYCHOLOGY TRACKER');
  console.log('='.repeat(60));
  console.log(`Time: ${new Date().toISOString()}`);

  const snapshots = loadSnapshots();
  const results = {};

  for (const symbol of CONFIG.TOKENS) {
    // Capture new snapshot
    const snapshot = await captureSnapshot(symbol);

    if (snapshot) {
      // Initialize history if needed
      if (!snapshots[symbol]) {
        snapshots[symbol] = [];
      }

      // Add to history
      snapshots[symbol].push(snapshot);

      // Keep last 100 snapshots
      if (snapshots[symbol].length > 100) {
        snapshots[symbol] = snapshots[symbol].slice(-100);
      }

      // Analyze trends
      const trends = analyzeTrends(snapshots[symbol]);

      results[symbol] = {
        snapshot,
        trends
      };

      // Display results
      console.log(`\n📊 ${symbol} Metrics:`);
      console.log(`   Price: ${snapshot.price.current.toFixed(8)} HIVE (${snapshot.price.percentToTarget.toFixed(0)}% to target)`);
      console.log(`   Holders: ${snapshot.holders.unique} unique wallets`);
      console.log(`   Sell floor: ${snapshot.wall.sellFloor?.toFixed(8) || 'N/A'} HIVE`);
      console.log(`   Push cost: $${snapshot.wall.costToPushUSD.toFixed(2)} USD`);

      if (trends.status !== 'INSUFFICIENT_DATA') {
        console.log(`\n📈 Trends (${trends.timespan}):`);
        console.log(`   Holders: ${trends.holderTrend.direction} ${trends.holderTrend.status}`);
        console.log(`   Floor: ${trends.floorTrend?.direction || 'N/A'} ${trends.floorTrend?.status || ''}`);
        console.log(`   Cost: ${trends.costTrend.direction} ${trends.costTrend.status}`);
        console.log(`\n   ${trends.assessment.status}`);
        console.log(`   ${trends.assessment.message}`);
      }
    }
  }

  // Save snapshots
  saveSnapshots(snapshots);

  console.log(`\n✅ Tracking complete!`);
  console.log(`📁 Snapshots saved to: ${CONFIG.SNAPSHOTS_FILE}`);

  return results;
}

/**
 * Generate weekly report
 */
async function generateWeeklyReport() {
  const snapshots = loadSnapshots();

  console.log('\n📊 WEEKLY PSYCHOLOGY REPORT');
  console.log('='.repeat(60));

  for (const symbol of CONFIG.TOKENS) {
    if (!snapshots[symbol] || snapshots[symbol].length < 2) {
      console.log(`\n${symbol}: Insufficient data for report`);
      continue;
    }

    const allSnapshots = snapshots[symbol];
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

    // Find snapshot closest to 7 days ago
    const oldSnapshot = allSnapshots
      .filter(s => s.timestampMs < weekAgo)
      .sort((a, b) => b.timestampMs - a.timestampMs)[0] || allSnapshots[0];

    const newSnapshot = allSnapshots[allSnapshots.length - 1];
    const comparison = compareSnapshots(oldSnapshot, newSnapshot);

    console.log(`\n${symbol} - 7 Day Summary:`);
    console.log(`   Time period: ${comparison.timeDiffDays.toFixed(1)} days`);
    console.log(`\n   Price:`);
    console.log(`     Then: ${oldSnapshot.price.current.toFixed(8)} HIVE`);
    console.log(`     Now: ${newSnapshot.price.current.toFixed(8)} HIVE`);
    console.log(`     Change: ${comparison.price.changePercent > 0 ? '+' : ''}${comparison.price.changePercent.toFixed(2)}%`);

    console.log(`\n   Holders:`);
    console.log(`     Then: ${oldSnapshot.holders.unique}`);
    console.log(`     Now: ${newSnapshot.holders.unique}`);
    console.log(`     Change: ${comparison.holders.uniqueChange > 0 ? '+' : ''}${comparison.holders.uniqueChange} (${comparison.holders.uniqueChangePercent > 0 ? '+' : ''}${comparison.holders.uniqueChangePercent.toFixed(2)}%)`);

    if (comparison.wall.floorChange !== null) {
      console.log(`\n   Sell Wall Floor:`);
      console.log(`     Then: ${oldSnapshot.wall.sellFloor?.toFixed(8)} HIVE`);
      console.log(`     Now: ${newSnapshot.wall.sellFloor?.toFixed(8)} HIVE`);
      console.log(`     Change: ${comparison.wall.floorChangePercent > 0 ? '+' : ''}${comparison.wall.floorChangePercent?.toFixed(2)}%`);
    }

    console.log(`\n   Push Cost:`);
    console.log(`     Then: $${oldSnapshot.wall.costToPushUSD.toFixed(2)}`);
    console.log(`     Now: $${newSnapshot.wall.costToPushUSD.toFixed(2)}`);
    console.log(`     Change: ${comparison.wall.costChangePercent > 0 ? '+' : ''}${comparison.wall.costChangePercent?.toFixed(2)}%`);
  }

  console.log('\n='.repeat(60));
}

// ========================================
// MAIN
// ========================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--report') {
    generateWeeklyReport().catch(error => {
      console.error('❌ Error:', error);
      process.exit(1);
    });
  } else {
    trackAllMetrics().catch(error => {
      console.error('❌ Error:', error);
      process.exit(1);
    });
  }
}

module.exports = {
  captureSnapshot,
  compareSnapshots,
  analyzeTrends,
  trackAllMetrics,
  generateWeeklyReport,
  CONFIG
};
