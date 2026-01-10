#!/usr/bin/env node

// ========================================
// STAKING APR ANALYZER
// ========================================
// Purpose: Analyze staking rewards vs trading profits to make smart decisions
// Strategy: Stake high-APR tokens (BBH, DRIP), trade low-APR tokens
// Key Decision: Is 50% APR staking better than 5% trading profit?
// Author: Claude Code
// Date: 2026-01-10

const hiveAPI = require('./hive-engine-api.cjs');

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
  // Trading profit threshold (default)
  BASE_TRADING_RETURN: 5, // 5% trading return baseline

  // APR comparison multiplier
  APR_MULTIPLIER: 1.2, // Staking must be 1.2x better than trading

  // Tokens to analyze
  ANALYZE_TOKENS: [
    'BBH', 'DRIP', 'LEO', 'POB', 'PIZZA',
    'SPT', 'ONEUP', 'CTP', 'LGN', 'ALIVE'
  ],

  // Known high-APR stakeable tokens
  KNOWN_STAKEABLE: {
    'BBH': true,
    'DRIP': true,
    'LEO': true,
    'POB': true,
    'PIZZA': true,
    'SPT': true,
    'ONEUP': true,
    'CTP': true,
    'LGN': true,
    'ALIVE': true
  }
};

// ========================================
// STAKING ANALYSIS
// ========================================

/**
 * Get token staking info
 */
async function getStakingInfo(symbol) {
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
    console.error(`❌ Error fetching staking info for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Calculate estimated APR from staking parameters
 * Note: This is an estimate - actual APR depends on many factors
 */
function calculateEstimatedAPR(tokenInfo) {
  if (!tokenInfo || !tokenInfo.stakingEnabled) {
    return {
      stakingEnabled: false,
      estimatedAPR: 0,
      method: 'NO_STAKING'
    };
  }

  // Check for inflation/reward parameters
  const metadata = tokenInfo.metadata ? JSON.parse(tokenInfo.metadata) : {};

  // Different tokens use different reward mechanisms
  // This is a simplified estimation

  if (metadata.rewardPool) {
    // Has dedicated reward pool
    const poolSize = parseFloat(metadata.rewardPool);
    const stakedSupply = parseFloat(tokenInfo.delegationEnabled ? tokenInfo.totalStaked || 0 : 0);

    if (stakedSupply > 0 && poolSize > 0) {
      // Annual rewards / staked supply * 100
      const estimatedAPR = (poolSize / stakedSupply) * 100;

      return {
        stakingEnabled: true,
        estimatedAPR: Math.min(estimatedAPR, 1000), // Cap at 1000% for sanity
        method: 'REWARD_POOL',
        poolSize,
        stakedSupply
      };
    }
  }

  if (metadata.inflation || tokenInfo.circulatingSupply) {
    // Inflation-based rewards
    const inflation = parseFloat(metadata.inflation || 0);
    const supply = parseFloat(tokenInfo.circulatingSupply || tokenInfo.supply);

    if (inflation > 0) {
      // Rough estimate: inflation goes to stakers
      const estimatedAPR = (inflation / supply) * 100;

      return {
        stakingEnabled: true,
        estimatedAPR: Math.min(estimatedAPR, 500),
        method: 'INFLATION',
        inflation,
        supply
      };
    }
  }

  // Default: Assume moderate APR if staking enabled but no clear parameters
  return {
    stakingEnabled: true,
    estimatedAPR: 10, // Conservative 10% estimate
    method: 'DEFAULT_ESTIMATE'
  };
}

/**
 * Analyze if staking or trading is better
 */
async function analyzeStakeVsTrade(symbol, tradingProfitPercent = CONFIG.BASE_TRADING_RETURN) {
  console.log(`\n📊 Analyzing ${symbol}...`);

  const tokenInfo = await getStakingInfo(symbol);

  if (!tokenInfo) {
    return {
      symbol,
      error: 'TOKEN_NOT_FOUND'
    };
  }

  const stakingData = calculateEstimatedAPR(tokenInfo);

  // Decision logic
  const requiredStakingAPR = tradingProfitPercent * CONFIG.APR_MULTIPLIER;
  const stakingBetter = stakingData.stakingEnabled && stakingData.estimatedAPR >= requiredStakingAPR;

  const decision = {
    symbol,
    stakingEnabled: stakingData.stakingEnabled,
    estimatedAPR: stakingData.estimatedAPR,
    aprMethod: stakingData.method,
    tradingReturn: tradingProfitPercent,
    requiredAPR: requiredStakingAPR,
    recommendation: stakingBetter ? 'STAKE' : 'TRADE',
    rationale: stakingBetter
      ? `${stakingData.estimatedAPR.toFixed(1)}% APR > ${requiredStakingAPR.toFixed(1)}% required - Staking is better!`
      : stakingData.stakingEnabled
        ? `${stakingData.estimatedAPR.toFixed(1)}% APR < ${requiredStakingAPR.toFixed(1)}% required - Trading is better`
        : 'Staking not available - Trade only',
    confidence: stakingData.method === 'REWARD_POOL' ? 'HIGH' :
               stakingData.method === 'INFLATION' ? 'MEDIUM' : 'LOW'
  };

  console.log(`   Staking: ${stakingData.stakingEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  if (stakingData.stakingEnabled) {
    console.log(`   Estimated APR: ${stakingData.estimatedAPR.toFixed(1)}% (${stakingData.method})`);
    console.log(`   Required APR: ${requiredStakingAPR.toFixed(1)}%`);
  }
  console.log(`   Trading return: ${tradingProfitPercent}%`);
  console.log(`   💡 Recommendation: ${decision.recommendation}`);
  console.log(`   📝 ${decision.rationale}`);

  return decision;
}

/**
 * Analyze multiple tokens and categorize
 */
async function analyzePortfolio(tokens = CONFIG.ANALYZE_TOKENS) {
  console.log('\n🔍 STAKING APR ANALYZER');
  console.log('='.repeat(60));

  const results = {
    shouldStake: [],
    shouldTrade: [],
    noStaking: [],
    analyzed: []
  };

  for (const symbol of tokens) {
    const analysis = await analyzeStakeVsTrade(symbol);

    if (!analysis.error) {
      results.analyzed.push(analysis);

      if (analysis.recommendation === 'STAKE') {
        results.shouldStake.push(analysis);
      } else if (analysis.stakingEnabled) {
        results.shouldTrade.push(analysis);
      } else {
        results.noStaking.push(analysis);
      }
    }
  }

  // Display summary
  console.log('\n📊 PORTFOLIO RECOMMENDATIONS');
  console.log('='.repeat(60));

  if (results.shouldStake.length > 0) {
    console.log('\n✅ STAKE THESE (High APR):');
    results.shouldStake
      .sort((a, b) => b.estimatedAPR - a.estimatedAPR)
      .forEach(t => {
        console.log(`   ${t.symbol}: ${t.estimatedAPR.toFixed(1)}% APR (${t.confidence} confidence)`);
      });
  }

  if (results.shouldTrade.length > 0) {
    console.log('\n📈 TRADE THESE (Low APR):');
    results.shouldTrade.forEach(t => {
      console.log(`   ${t.symbol}: ${t.estimatedAPR.toFixed(1)}% APR < ${t.requiredAPR.toFixed(1)}% needed`);
    });
  }

  if (results.noStaking.length > 0) {
    console.log('\n💱 NO STAKING AVAILABLE:');
    results.noStaking.forEach(t => {
      console.log(`   ${t.symbol}: Trade only`);
    });
  }

  console.log('\n✅ Analysis complete!');

  return results;
}

/**
 * Get trading recommendation based on staking analysis
 */
async function getTradingRecommendation(symbol, expectedTradingProfit) {
  const analysis = await analyzeStakeVsTrade(symbol, expectedTradingProfit);

  if (analysis.error) {
    return {
      action: 'SKIP',
      reason: 'Token not found or error'
    };
  }

  if (analysis.recommendation === 'STAKE') {
    return {
      action: 'STAKE',
      reason: `${analysis.estimatedAPR.toFixed(1)}% staking APR beats ${expectedTradingProfit}% trading`,
      apr: analysis.estimatedAPR
    };
  } else {
    return {
      action: 'TRADE',
      reason: analysis.rationale,
      expectedProfit: expectedTradingProfit
    };
  }
}

/**
 * Compare two opportunities (staking vs trading specific token)
 */
async function compareOpportunities(stakingToken, tradingToken, tradingProfit) {
  console.log(`\n⚖️ Comparing Opportunities:`);
  console.log(`   Option A: Stake ${stakingToken}`);
  console.log(`   Option B: Trade ${tradingToken} for ${tradingProfit}% profit`);

  const [stakingAnalysis, tradingAnalysis] = await Promise.all([
    analyzeStakeVsTrade(stakingToken),
    analyzeStakeVsTrade(tradingToken, tradingProfit)
  ]);

  // Annualized returns
  const stakingReturn = stakingAnalysis.estimatedAPR;
  const tradingReturn = tradingProfit * (365 / 7); // Assume weekly trading

  const better = stakingReturn > tradingReturn ? stakingToken : tradingToken;
  const action = stakingReturn > tradingReturn ? 'STAKE' : 'TRADE';

  console.log(`\n   Staking ${stakingToken}: ${stakingReturn.toFixed(1)}% annual return`);
  console.log(`   Trading ${tradingToken}: ${tradingReturn.toFixed(1)}% annual return`);
  console.log(`   💡 Better choice: ${action} ${better}`);

  return {
    stakingToken,
    tradingToken,
    stakingReturn,
    tradingReturn,
    recommendation: action,
    winningToken: better
  };
}

// ========================================
// HIVE-ENGINE SPECIFIC KNOWLEDGE
// ========================================

const HIVE_ENGINE_STAKING_GUIDE = {
  BBH: {
    name: 'BBH (BRO)',
    estimatedAPR: 50,
    confidence: 'HIGH',
    notes: 'Known high APR staking token, consistent rewards'
  },
  DRIP: {
    name: 'DRIP',
    estimatedAPR: 100,
    confidence: 'HIGH',
    notes: 'Very high APR drip token, compounds daily'
  },
  LEO: {
    name: 'LEO',
    estimatedAPR: 15,
    confidence: 'MEDIUM',
    notes: 'Established token with moderate staking rewards'
  },
  POB: {
    name: 'POB',
    estimatedAPR: 20,
    confidence: 'MEDIUM',
    notes: 'Proof of Brain token with curation rewards'
  },
  PIZZA: {
    name: 'PIZZA',
    estimatedAPR: 25,
    confidence: 'MEDIUM',
    notes: 'Community token with staking + delegation rewards'
  }
};

/**
 * Get known APR if available
 */
function getKnownAPR(symbol) {
  return HIVE_ENGINE_STAKING_GUIDE[symbol] || null;
}

// ========================================
// MAIN
// ========================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length >= 2 && args[0] === '--compare') {
    // Compare two opportunities
    compareOpportunities(args[1], args[2], parseFloat(args[3] || 5))
      .catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
      });
  } else if (args.length > 0) {
    // Analyze specific token
    analyzeStakeVsTrade(args[0], parseFloat(args[1] || 5))
      .catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
      });
  } else {
    // Analyze portfolio
    analyzePortfolio()
      .catch(error => {
        console.error('❌ Error:', error);
        process.exit(1);
      });
  }
}

module.exports = {
  analyzeStakeVsTrade,
  analyzePortfolio,
  getTradingRecommendation,
  compareOpportunities,
  getKnownAPR,
  CONFIG
};
